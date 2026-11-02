library(nimble)

source("util_code/constants.R")
source("util_code/build_model_inputs.R")
source("util_code/progress.R")

# Finds an integer trap-deployment schedule (count of each trap type at each
# occasion) that minimizes expected abundance at the start of the next
# trapping season (after overwinter mortality), subject to a
# cost-weighted trap budget (e.g. shrimp traps costing more units than fukui
# or minnow traps). This is a mixed-integer *nonlinear* program -- the
# capture term 1 - exp(-hazard) saturates with trap count, and that
# nonlinearity compounds through the growth-kernel recursion across
# occasions -- so it isn't solvable with a linear MILP solver. Instead this
# uses a greedy marginal-value allocation (spend one trap-unit at a time
# wherever it reduces predicted next-season abundance the most per unit cost) and
# then polishes the result with a local search over single-unit swaps. This
# reuses the model's own growth/survival/selectivity nimbleFunctions
# (get_kernel, survival, size_sel_log, size_sel_norm,
# get_init_recruits) uncompiled, which is just as correct as the compiled
# versions and fast enough here since each forward simulation is a short
# loop over occasions and size classes.
#
# The planning season starts from the crabs that survived the winter after
# the last fitted year (N_optim, monitored in both model versions), and the
# objective is the number expected to survive the following winter, i.e. the
# abundance at the start of the next trapping season. With multiple years of
# data, overwinter survival is the multi-year model's estimated size- and
# year-dependent survival; with one year it is ordinary natural
# survival, which is built into the one-year model's overwinter kernel.

# command-line args:
# <data_dir> <posterior_path> <output_path> <progress_path> <budget>
# <cost_fukui> <cost_shrimp> <cost_minnow> <n_draw> <n_draw_score>
args <- commandArgs(trailingOnly = TRUE)
data_dir <- if (length(args) >= 1) args[1] else "data/model_data"
posterior_path <- if (length(args) >= 2) args[2] else "data/posterior_samples/twopulse.rds"
output_path <- if (length(args) >= 3) args[3] else "data/posterior_samples/optimal_trap_schedule.json"
progress_path <- if (length(args) >= 4) args[4] else "data/posterior_samples/optimize_progress.json"
budget <- if (length(args) >= 5) as.numeric(args[5]) else 100
cost <- c(
  fukui  = if (length(args) >= 6) as.numeric(args[6]) else 1,
  shrimp = if (length(args) >= 7) as.numeric(args[7]) else 4,
  minnow = if (length(args) >= 8) as.numeric(args[8]) else 1
)
n_draw <- if (length(args) >= 9) as.integer(args[9]) else 100
# fresh posterior draws used to score and compare the candidate schedules
n_score_target <- if (length(args) >= 10) as.integer(args[10]) else 500

dir.create(dirname(output_path), recursive = TRUE, showWarnings = FALSE)
write_progress <- make_progress_writer(progress_path)

optimize_traps <- function() {

write_progress("preparing", 0, budget, "Loading model inputs and posterior samples...")

model_inputs <- build_model_inputs(data_dir)
source(model_inputs$model_code_path)
n_occ <- model_inputs$n_occ
n_year <- model_inputs$n_year
x <- model_inputs$x
constants <- model_inputs$constants
lower <- constants$lower
upper <- constants$upper
D <- constants$D
n_size <- constants$n_size
recruit_intro1 <- constants$recruit_intro1
recruit_intro2 <- constants$recruit_intro2
# both model versions only carry survivors forward from the last fitted
# year (N_optim), so this always plans the season after the last year
year_index <- n_year

# An uncompiled nimbleModel is cheap to build (the slow part is
# compileNimble(), which this skips entirely) and gives us both the fixed
# growth/mortality/selectivity-shape constants baked into the model code file
# (so they can't drift out of sync with the fitted model) and the
# nimbleFunctions themselves, callable directly as ordinary R functions.
scaffold_model <- nimbleModel(code = model_code, data = model_inputs$data,
                              constants = constants, inits = model_inputs$inits())

gk <- scaffold_model$gk; A_amp <- scaffold_model$A; ds <- scaffold_model$ds
xinf <- scaffold_model$xinf; sigma_G <- scaffold_model$sigma_G
alpha <- scaffold_model$alpha; beta <- scaffold_model$beta
h_F_k <- scaffold_model$h_F_k; h_F_0 <- scaffold_model$h_F_0
h_S_k <- scaffold_model$h_S_k; h_S_0 <- scaffold_model$h_S_0
h_M_A <- scaffold_model$h_M_A; h_M_sigma <- scaffold_model$h_M_sigma
mu_R <- scaffold_model$mu_R; sigma_R <- scaffold_model$sigma_R
multiyear <- model_inputs$multiyear

K_overwinter <- scaffold_model$K_overwinter
# lowest overwinter survival allowed in the multi-year planning simulation
min_winter_survival <- 0.05

# growth/survival kernel per occasion transition -- identical for every
# candidate trap schedule, so computed once up front
K <- lapply(1:(n_occ - 1), function(t) {
  S_t <- survival(alpha, beta, x, D[t], D[t + 1])
  get_kernel(xinf, gk, sigma_G, A_amp, ds, D[t], D[t + 1], n_size, pi,
            x, lower, upper, S_t)
})

samp <- readRDS(posterior_path)
samp_mat <- do.call(rbind, samp)
n_draw <- min(n_draw, nrow(samp_mat))
set.seed(10120)
draw_indices <- sample(nrow(samp_mat), n_draw)
# only used with one year of data, where lambda_R is a single node
lambdaR_col <- "lambda_R"

# crabs expected to survive the winter after the last fitted year, per size
# class, monitored as N_optim
N_optim_cols <- sprintf("N_optim[%d]", seq_len(n_size))
if (!all(N_optim_cols %in% colnames(samp_mat))) {
  stop("The posterior samples don't include N_optim. Rerun the population model before optimizing.")
}

# Recruitment in the planning year is unknown, so each posterior draw gets
# its own random recruit abundance: from the across-year truncated normal
# (mu_lambda, sigma_lambda) when multiple years were fit, otherwise Poisson
# around that draw's lambda_R. Drawn once here (not inside objective()) so
# every candidate schedule is compared against the same recruit abundances.
draw_recruits <- function(i) {
  if (model_inputs$multiyear) {
    mu <- samp_mat[i, "mu_lambda"]
    sigma <- samp_mat[i, "sigma_lambda"]
    # inverse-CDF draw from a normal truncated below at 0
    qnorm(runif(1, pnorm(0, mu, sigma), 1), mu, sigma)
  } else {
    rpois(1, samp_mat[i, lambdaR_col])
  }
}

# One simulated "version of reality" per posterior draw: the draw's
# parameters plus its own random recruitment, catch luck (u_catch) and
# next-winter severity
make_draw <- function(i) {
  draw <- list(
    h_F_max = samp_mat[i, "h_F_max"],
    h_S_max = samp_mat[i, "h_S_max"],
    h_M_max = samp_mat[i, "h_M_max"],
    prop_1 = samp_mat[i, "prop_1"],
    lambda_R = draw_recruits(i),
    N_start = unname(samp_mat[i, N_optim_cols]),
    # uniform draws behind each occasion x size class's random catch, fixed
    # per posterior draw so every candidate schedule faces the same catch
    # randomness (more traps then always catch at least as many crabs)
    u_catch = matrix(runif((n_occ - 1) * n_size), n_occ - 1, n_size)
  )
  if (multiyear) {
    draw$b_o <- samp_mat[i, "b_o"]
    # the winter after the planning season gets its own year-specific
    # deviation, so schedules are compared across harsh and mild winters
    draw$eps <- exp(samp_mat[i, "mu_eps"] +
                      rnorm(1, 0, constants$sigma_o))
  }
  draw
}

soak_days <- rep(1, n_occ - 1)
trap_types <- names(cost)

# transposed kernels, for the draws-as-rows layout
Kt <- lapply(K, t)
Kt_overwinter <- t(K_overwinter)
recruit_dist <- get_init_recruits(mu_R, sigma_R, lower, upper, 1, n_size)
base_F <- size_sel_log(pmax = 1, k = h_F_k, midpoint = h_F_0, x = x)
base_S <- size_sel_log(pmax = 1, k = h_S_k, midpoint = h_S_0, x = x)
base_M <- size_sel_norm(pmax = 1, xmax = h_M_A, sigma = h_M_sigma, x = x)

# ---- precompute everything that doesn't depend on the trap schedule ----
# All draws are simulated together as draws x size-class matrices, so each
# occasion is one matrix product instead of one per draw. Selectivity and
# the recruit size distribution are linear in h_*_max and lambda_R, so each
# is a fixed curve scaled per draw.
build_sim <- function(draws) {
  lambda_R_d <- vapply(draws, `[[`, numeric(1), "lambda_R")
  prop_1_d <- vapply(draws, `[[`, numeric(1), "prop_1")
  list(
    sel_F = outer(vapply(draws, `[[`, numeric(1), "h_F_max"), base_F),
    sel_S = outer(vapply(draws, `[[`, numeric(1), "h_S_max"), base_S),
    sel_M = outer(vapply(draws, `[[`, numeric(1), "h_M_max"), base_M),
    R1 = outer(prop_1_d * lambda_R_d, recruit_dist),
    R2 = outer((1 - prop_1_d) * lambda_R_d, recruit_dist),
    N_start = t(vapply(draws, `[[`, numeric(n_size), "N_start")),
    # fixed uniforms behind the random catch, as occasion x draw x size class
    u_catch = aperm(simplify2array(lapply(draws, `[[`, "u_catch")), c(1, 3, 2)),
    # overwinter survival per draw and size class; density-independent, so
    # fixed for every schedule. Floored at min_winter_survival so no
    # simulated winter wipes out the population. The one-year overwinter
    # kernel already applies natural survival.
    winter_surv = if (multiyear) {
      t(vapply(draws, function(d) pmax(overwinter_survival(x, d$eps, d$b_o),
                                       min_winter_survival), numeric(n_size)))
    } else {
      matrix(1, length(draws), n_size)
    }
  )
}

# Forward-simulates the latent population under a candidate trap schedule
# `n` (an (n_occ - 1) x 3 integer matrix of trap counts per occasion/type),
# for all draws in `sim` at once. Unlike the fitted model's N update (which
# subtracts the literal *observed* catch C_T), this subtracts a random
# binomial catch, matching the fitted model's catch distribution, since
# there's no real catch for a hypothetical future schedule. Returns each
# draw's total abundance at the start of the following season, which the
# objective is based on.
simulate_policy <- function(n, sim) {
  N <- sim$N_start
  for (t in 1:(n_occ - 1)) {
    hazard <- (n[t, "fukui"] * sim$sel_F + n[t, "shrimp"] * sim$sel_S +
                 n[t, "minnow"] * sim$sel_M) * soak_days[t]
    # random catch: binomial with the capture probability, as in the fitted
    # model, drawn by inverse CDF from each draw's fixed uniforms (and capped
    # at N, since rounding N up could otherwise remove more than are there)
    removed <- pmin(qbinom(sim$u_catch[t, , ], round(N), 1 - exp(-hazard)), N)
    N <- (N - removed) %*% Kt[[t]] +
      recruit_intro1[t] * sim$R1 + recruit_intro2[t] * sim$R2
  }
  rowSums((N %*% Kt_overwinter) * sim$winter_surv)
}

# draws used by the search
draws <- lapply(draw_indices, make_draw)
sim_search <- build_sim(draws)
objective <- function(n) mean(simulate_policy(n, sim_search))

empty_schedule <- matrix(0L, n_occ - 1, length(trap_types),
                         dimnames = list(NULL, trap_types))

# One greedy search plus refinement. `step` is the number of traps added per
# greedy step and moved per coarse refinement swap; progress is reported as
# `progress_offset` + budget spent, out of `progress_total`.
search_schedule <- function(step, progress_offset, progress_total, label) {
  n <- empty_schedule
  remaining_budget <- budget
  current_objective <- objective(n)

  # greedy marginal-value allocation: repeatedly add `step` traps at the
  # single (occasion, type) that reduces expected next-season abundance the
  # most per unit cost, until the budget is exhausted or no option helps.
  # Near the end of the budget, fewer traps are added if a full step no
  # longer fits.
  repeat {
    best <- NULL
    for (t in 1:(n_occ - 1)) {
      for (type in trap_types) {
        k <- min(step, floor(remaining_budget / cost[[type]]))
        if (k < 1) next
        candidate <- n
        candidate[t, type] <- candidate[t, type] + as.integer(k)
        candidate_objective <- objective(candidate)
        gain_per_cost <- (current_objective - candidate_objective) / (k * cost[[type]])
        if (is.null(best) || gain_per_cost > best$gain_per_cost) {
          best <- list(t = t, type = type, k = k, gain_per_cost = gain_per_cost,
                       candidate = candidate, objective = candidate_objective)
        }
      }
    }
    if (is.null(best) || best$gain_per_cost <= 0) break
    n <- best$candidate
    current_objective <- best$objective
    remaining_budget <- remaining_budget - best$k * cost[[best$type]]
    write_progress("optimizing", progress_offset + budget - remaining_budget,
                   progress_total, paste0("Allocating trap units (", label, ")"))
    if (remaining_budget <= 0) break
  }

  write_progress("polishing", progress_offset + budget, progress_total,
                 paste0("Refining the trap schedule (", label, ")"))

  # local search, coarse to fine: repeatedly try moving `swap` traps from one
  # occasion/type slot to another (keeping within the budget), keeping any
  # move that improves the objective, until no improving move is found;
  # first with moves the size of the greedy step, then with single traps
  max_passes <- 50
  for (swap in unique(c(step, 1L))) {
    for (pass in seq_len(max_passes)) {
      improved <- FALSE
      for (t1 in 1:(n_occ - 1)) {
        for (type1 in trap_types) {
          if (n[t1, type1] < swap) next
          for (t2 in 1:(n_occ - 1)) {
            for (type2 in trap_types) {
              if (t1 == t2 && type1 == type2) next
              # an accepted move below can empty this slot, so re-check
              # before taking more traps from it (otherwise trap counts go
              # negative)
              if (n[t1, type1] < swap) next
              candidate <- n
              candidate[t1, type1] <- candidate[t1, type1] - as.integer(swap)
              candidate[t2, type2] <- candidate[t2, type2] + as.integer(swap)
              candidate_cost <- sum(candidate %*% cost[trap_types])
              if (candidate_cost > budget) next
              candidate_objective <- objective(candidate)
              if (candidate_objective < current_objective) {
                n <- candidate
                current_objective <- candidate_objective
                improved <- TRUE
              }
            }
          }
        }
      }
      if (!improved) break
    }
  }
  n
}

# ---- multi-start search ----
# The greedy search with refinement is a heuristic, and with an objective
# this flat, different step sizes end at different, similarly good
# schedules. Searching with several step sizes gives a set of good options
# rather than one apparent optimum. The base step is scaled to the budget
# (1 for a budget of 30, 5 for 300).
base_step <- max(1, round(budget / 60))
steps <- sort(unique(c(1, base_step, 2 * base_step, 5 * base_step)))
schedules <- list()
for (r in seq_along(steps)) {
  schedules[[r]] <- search_schedule(steps[r], (r - 1) * budget,
                                    length(steps) * budget,
                                    sprintf("search %d of %d, %d trap%s per step",
                                            r, length(steps), steps[r],
                                            if (steps[r] == 1) "" else "s"))
}
# searches that ended at the same schedule count once
keys <- vapply(schedules, function(n) paste(n, collapse = ","), character(1))
keep <- !duplicated(keys)
option_steps <- lapply(seq_along(steps), function(r) steps[keys == keys[r]])[keep]
schedules <- schedules[keep]

# ---- score every schedule on fresh posterior draws ----
# All schedules were chosen using the same search draws, so scoring them on
# those draws would favour whichever happened to fit them best. Instead each
# schedule (and no trapping, for reference) is scored on a fresh, larger set
# of draws -- different posterior rows where possible, with new random
# recruitment, catch luck and winter severity -- and compared with the best
# schedule within each draw (paired), so the shared variation between draws
# cancels out of the comparison.
write_progress("scoring", length(steps) * budget, length(steps) * budget,
               "Scoring the candidate schedules on fresh posterior samples...")
n_score <- min(n_score_target, nrow(samp_mat))
unused_rows <- setdiff(seq_len(nrow(samp_mat)), draw_indices)
set.seed(20240101)
score_indices <- if (length(unused_rows) >= n_score) {
  sample(unused_rows, n_score)
} else {
  sample(nrow(samp_mat), n_score)
}
sim_score <- build_sim(lapply(score_indices, make_draw))
no_trap_totals <- simulate_policy(empty_schedule, sim_score)
totals <- sapply(schedules, simulate_policy, sim = sim_score)
totals <- matrix(totals, nrow = n_score)
best <- which.min(colMeans(totals))
q <- function(v) unname(quantile(v, c(0.025, 0.975)))
options <- lapply(seq_along(schedules), function(k) {
  n <- schedules[[k]]
  diff <- totals[, k] - totals[, best]
  list(
    search_steps = option_steps[[k]],
    total_cost = sum(n %*% cost[trap_types]),
    expected_abundance = mean(totals[, k]),
    abundance_95 = q(totals[, k]),
    reduction_vs_no_trapping = 1 - mean(totals[, k]) / mean(no_trap_totals),
    difference_from_best = mean(diff),
    difference_from_best_95 = q(diff),
    within_1pct_of_best = mean(totals[, k]) <= 1.01 * mean(totals[, best]),
    schedule = lapply(trap_types, function(type) as.integer(n[, type]))
  )
})
for (k in seq_along(options)) names(options[[k]]$schedule) <- trap_types
# best first
options <- options[order(vapply(options, `[[`, numeric(1), "expected_abundance"))]

write_progress("saving", length(steps) * budget, length(steps) * budget,
               "Saving the trap schedule options...")

# the best option also fills the single-schedule fields used by the app
occasions <- biweek[1:(n_occ - 1)]
result <- list(
  budget = budget,
  cost = as.list(cost),
  total_cost = options[[1]]$total_cost,
  n_draw = n_draw,
  n_draw_score = n_score,
  year_index = year_index,
  objective_value = options[[1]]$expected_abundance,
  occasions = occasions,
  schedule = options[[1]]$schedule,
  no_trapping = list(expected_abundance = mean(no_trap_totals),
                     abundance_95 = q(no_trap_totals)),
  options = options
)

tmp <- paste0(output_path, ".tmp")
writeLines(jsonlite::toJSON(result, auto_unbox = TRUE, na = "null", digits = NA), tmp)
file.rename(tmp, output_path)

write_progress("done", length(steps) * budget, length(steps) * budget,
               "Optimization complete.", done = TRUE)

}

tryCatch(
  optimize_traps(),
  error = function(e) {
    write_progress("error", 0, budget, "Optimization failed.", done = TRUE,
                   error = conditionMessage(e))
    quit(status = 1)
  }
)
