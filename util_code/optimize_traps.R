library(nimble)

source("util_code/constants.R")
source("util_code/build_model_inputs.R")
source("util_code/progress.R")

# Finds an integer trap-deployment schedule (count of each trap type at each
# occasion) that minimizes expected final-season abundance, subject to a
# cost-weighted trap budget (e.g. shrimp traps costing more units than fukui
# or minnow traps). This is a mixed-integer *nonlinear* program -- the
# capture term 1 - exp(-hazard) saturates with trap count, and that
# nonlinearity compounds through the growth-kernel recursion across
# occasions -- so it isn't solvable with a linear MILP solver. Instead this
# uses a greedy marginal-value allocation (spend one trap-unit at a time
# wherever it reduces predicted final abundance the most per unit cost) and
# then polishes the result with a local search over single-unit swaps. This
# reuses the model's own growth/survival/selectivity nimbleFunctions
# (get_kernel, survival, size_sel_log, size_sel_norm, get_init_adult,
# get_init_recruits) uncompiled, which is just as correct as the compiled
# versions and fast enough here since each forward simulation is a short
# loop over occasions and size classes.

# command-line args:
# <data_dir> <posterior_path> <output_path> <progress_path> <budget>
# <cost_fukui> <cost_shrimp> <cost_minnow> <n_draw> <year_index>
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
n_draw <- if (length(args) >= 9) as.integer(args[9]) else 50
year_index_arg <- if (length(args) >= 10) as.integer(args[10]) else NA

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
year_index <- if (is.na(year_index_arg)) n_year else year_index_arg

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
log_mu_A <- scaffold_model$log_mu_A; sigma_A <- scaffold_model$sigma_A
mu_R <- scaffold_model$mu_R; sigma_R <- scaffold_model$sigma_R

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
lambdaA_col <- sprintf("lambda_A[%d]", year_index)
lambdaR_col <- sprintf("lambda_R[%d]", year_index)

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

draws <- lapply(draw_indices, function(i) list(
  h_F_max = samp_mat[i, "h_F_max"],
  h_S_max = samp_mat[i, "h_S_max"],
  h_M_max = samp_mat[i, "h_M_max"],
  prop_1 = samp_mat[i, "prop_1"],
  lambda_A = samp_mat[i, lambdaA_col],
  lambda_R = draw_recruits(i)
))

soak_days <- rep(1, n_occ - 1)
trap_types <- names(cost)

# Forward-simulates the latent population under a candidate trap schedule
# `n` (an (n_occ - 1) x 3 integer matrix of trap counts per occasion/type),
# for one posterior draw. Unlike the fitted model's N update (which
# subtracts the literal *observed* catch C_T), this subtracts a hazard-based
# *expected* removal, since there's no real catch for a hypothetical future
# schedule.
simulate_policy <- function(n, draw) {
  N <- matrix(0, n_occ, n_size)
  N[1, ] <- get_init_adult(log_mu_A, sigma_A, lower, upper, draw$lambda_A)
  R <- get_init_recruits(mu_R, sigma_R, lower, upper, draw$lambda_R, n_size)
  R1 <- draw$prop_1 * R
  R2 <- (1 - draw$prop_1) * R

  for (t in 1:(n_occ - 1)) {
    hazard <- n[t, "fukui"] * size_sel_log(pmax = draw$h_F_max, k = h_F_k,
                                           midpoint = h_F_0, x = x) * soak_days[t] +
      n[t, "shrimp"] * size_sel_log(pmax = draw$h_S_max, k = h_S_k,
                                    midpoint = h_S_0, x = x) * soak_days[t] +
      n[t, "minnow"] * size_sel_norm(pmax = draw$h_M_max, xmax = h_M_A,
                                     sigma = h_M_sigma, x = x) * soak_days[t]
    removed <- N[t, ] * (1 - exp(-hazard))
    N[t + 1, ] <- as.vector(K[[t]] %*% (N[t, ] - removed)) +
      recruit_intro1[t] * R1 + recruit_intro2[t] * R2
  }
  N[n_occ, ]
}

objective <- function(n) {
  mean(vapply(draws, function(d) sum(simulate_policy(n, d)), numeric(1)))
}

n <- matrix(0L, n_occ - 1, length(trap_types), dimnames = list(NULL, trap_types))
remaining_budget <- budget
current_objective <- objective(n)
spent <- 0

write_progress("optimizing", 0, budget, "Allocating trap units...")

# greedy marginal-value allocation: repeatedly add the single trap-unit
# (occasion, type) that reduces expected final abundance the most per unit
# cost, until the budget is exhausted or no option helps
repeat {
  best <- NULL
  for (t in 1:(n_occ - 1)) {
    for (type in trap_types) {
      if (cost[[type]] > remaining_budget) next
      candidate <- n
      candidate[t, type] <- candidate[t, type] + 1L
      candidate_objective <- objective(candidate)
      gain_per_cost <- (current_objective - candidate_objective) / cost[[type]]
      if (is.null(best) || gain_per_cost > best$gain_per_cost) {
        best <- list(t = t, type = type, gain_per_cost = gain_per_cost,
                     candidate = candidate, objective = candidate_objective)
      }
    }
  }
  if (is.null(best) || best$gain_per_cost <= 0) break
  n <- best$candidate
  current_objective <- best$objective
  remaining_budget <- remaining_budget - cost[[best$type]]
  spent <- budget - remaining_budget
  write_progress("optimizing", spent, budget, "Allocating trap units")
  if (remaining_budget <= 0) break
}

write_progress("polishing", spent, budget, "Refining the trap schedule...")

# local search: repeatedly try moving a single trap-unit from one
# occasion/type slot to another (keeping the budget the same), keeping any
# swap that improves the objective, until no improving swap is found
max_passes <- 50
for (pass in seq_len(max_passes)) {
  improved <- FALSE
  for (t1 in 1:(n_occ - 1)) {
    for (type1 in trap_types) {
      if (n[t1, type1] == 0) next
      for (t2 in 1:(n_occ - 1)) {
        for (type2 in trap_types) {
          if (t1 == t2 && type1 == type2) next
          candidate <- n
          candidate[t1, type1] <- candidate[t1, type1] - 1L
          candidate[t2, type2] <- candidate[t2, type2] + 1L
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

write_progress("saving", budget, budget, "Saving optimal trap schedule...")

occasions <- biweek[1:(n_occ - 1)]
result <- list(
  budget = budget,
  cost = as.list(cost),
  total_cost = sum(n %*% cost[trap_types]),
  n_draw = n_draw,
  year_index = year_index,
  objective_value = current_objective,
  occasions = occasions,
  schedule = lapply(trap_types, function(type) as.integer(n[, type]))
)
names(result$schedule) <- trap_types

tmp <- paste0(output_path, ".tmp")
writeLines(jsonlite::toJSON(result, auto_unbox = TRUE, na = "null", digits = NA), tmp)
file.rename(tmp, output_path)

write_progress("done", budget, budget, "Optimization complete.", done = TRUE)

}

tryCatch(
  optimize_traps(),
  error = function(e) {
    write_progress("error", 0, budget, "Optimization failed.", done = TRUE,
                   error = conditionMessage(e))
    quit(status = 1)
  }
)
