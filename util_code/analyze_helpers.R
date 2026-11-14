# converts an n-dimensional array into nested lists (outer to inner in the
# same order as dim(x)) so jsonlite renders it as properly nested JSON arrays
# instead of a flattened vector
to_nested <- function(x) {
  if (is.null(dim(x)) || length(dim(x)) <= 1) return(as.list(as.numeric(x)))
  apply(x, 1, to_nested, simplify = FALSE)
}

# Builds the JSON-ready result list consumed by the frontend's "Analyze
# results" charts, from a completed posterior-predictive simulation. Shared
# by simulate_dynamics.R (compiles its own model) and run_model.R (reuses the
# model it already compiled for MCMC), so both paths produce identical output.
summarize_dynamics <- function(N_post, C_T, n_occ, n_year, occ_t, occ_y,
                               totalo, x, years, biweek) {
  N_med <- apply(N_post, c(2, 3, 4), median)
  N_lo  <- apply(N_post, c(2, 3, 4), quantile, 0.025)
  N_hi  <- apply(N_post, c(2, 3, 4), quantile, 0.975)

  # total abundance per occasion/year
  tot <- apply(N_post, c(1, 2, 3), sum)      # draw x occasion x year
  tot_med <- apply(tot, c(2, 3), median)
  tot_lo  <- apply(tot, c(2, 3), quantile, 0.025)
  tot_hi  <- apply(tot, c(2, 3), quantile, 0.975)

  # CPUE from the observed catch and effort
  traps <- matrix(0L, nrow = n_occ, ncol = n_year)
  traps[cbind(occ_t, occ_y)] <- totalo
  cpue <- sweep(C_T, c(1, 2), traps, "/")
  cpue[!is.finite(cpue)] <- NA

  list(
    biweek = as.list(biweek),
    years = as.list(as.integer(years)),
    x = as.list(x),
    nOcc = n_occ,
    nYear = n_year,
    # [occasion][year][size]
    N_med = to_nested(N_med),
    N_lo = to_nested(N_lo),
    N_hi = to_nested(N_hi),
    # [occasion][year]
    tot_med = to_nested(tot_med),
    tot_lo = to_nested(tot_lo),
    tot_hi = to_nested(tot_hi),
    # [occasion][year][size]
    cpue = to_nested(cpue)
  )
}

# Posterior overwinter survival by size for each winter the data can inform
# (a winter followed by another year of data), for the frontend's "Explore
# overwinter survival" chart. Survival of a crab of size x in the winter
# after year y is exp(-exp(mu_eps + eps_y[y]) * (x / 50) ^ -b_o) (see
# model_code_multiyear.R). eps_y columns are indexed by position in `years`,
# so a winter's label is taken from that index: with gaps (e.g. 2020,
# 2022-2023) only eps_y[2] is estimated, and it is the 2022 to 2023 winter.
# The winter after the last year has no data following it, so is left out.
# Returns NULL for a single year of data; with multiple years but no two
# consecutive, returns `available = FALSE` (no winter can be estimated).
summarize_overwinter <- function(samp_mat, x, years, ci = 0.95) {
  n_year <- length(years)
  if (n_year < 2) return(NULL)
  if (!"mu_eps" %in% colnames(samp_mat)) {
    return(list(available = FALSE, years = as.list(as.integer(years))))
  }

  eps_cols <- grep("^eps_y\\[", colnames(samp_mat), value = TRUE)
  eps_idx <- as.integer(gsub("\\D", "", eps_cols))
  years <- as.integer(years)
  # only winters followed by the next calendar year's data are estimated
  next_year <- years[pmin(eps_idx + 1, n_year)]
  keep <- eps_idx < n_year & next_year == years[eps_idx] + 1
  eps_cols <- eps_cols[keep]
  eps_idx <- eps_idx[keep]
  ord <- order(eps_idx)
  eps_cols <- eps_cols[ord]
  eps_idx <- eps_idx[ord]

  # highest density interval if bayestestR is installed, else equal-tailed
  interval <- if (requireNamespace("bayestestR", quietly = TRUE)) {
    function(v) {
      h <- bayestestR::hdi(v, ci = ci)
      c(h$CI_low, h$CI_high)
    }
  } else {
    function(v) unname(quantile(v, c((1 - ci) / 2, 1 - (1 - ci) / 2)))
  }

  mu_eps <- samp_mat[, "mu_eps"]
  b_o <- samp_mat[, "b_o"]
  winters <- lapply(seq_along(eps_cols), function(i) {
    haz <- exp(mu_eps + samp_mat[, eps_cols[i]])
    surv <- sapply(x, function(xi) exp(-haz * (xi / 50) ^ (-b_o)))
    bounds <- apply(surv, 2, interval)
    from <- years[eps_idx[i]]
    list(
      from = from,
      to = from + 1L,
      label = sprintf("%d to %d", from, from + 1L),
      median = as.list(apply(surv, 2, median)),
      lo = as.list(bounds[1, ]),
      hi = as.list(bounds[2, ])
    )
  })

  list(available = TRUE, years = as.list(as.integer(years)),
       x = as.list(x), winters = winters)
}

# Posterior box-plot statistics for the frontend's "Adults and recruit
# abundance" charts: annual recruit abundance (lambda_R), adult abundance at
# the start of each year, and the proportion of recruits entering in each of
# the two recruitment pulses (prop_1 and 1 - prop_1). Each summary is the
# 2.5%, 25%, 50%, 75% and 97.5% quantiles (whiskers = 95% credible interval,
# box = middle 50%).
#   Adults: N_adult[y] in the multi-year model (adults surviving the winter
#   in later years of a consecutive run); lambda_A[y] in the independent-years
#   model; lambda_A in the one-year model.
#   Pulse proportions: one pair per year when prop_1 is indexed by year
#   (independent years), otherwise a single pair shared by all years.
# `pulse_days` are the days of year the two pulses enter the population.
summarize_population <- function(samp_mat, years, pulse_days) {
  years <- as.integer(years)
  n_year <- length(years)
  box <- function(v) {
    q <- unname(quantile(v, c(0.025, 0.25, 0.5, 0.75, 0.975)))
    list(lo = q[1], q1 = q[2], median = q[3], q3 = q[4], hi = q[5], mean = mean(v))
  }
  # one column per year: "name[y]" if indexed, else the scalar column
  per_year <- function(name) {
    indexed <- sprintf("%s[%d]", name, seq_len(n_year))
    if (all(indexed %in% colnames(samp_mat))) return(indexed)
    if (name %in% colnames(samp_mat) && n_year == 1) return(name)
    NULL
  }
  by_year <- function(cols) {
    if (is.null(cols)) return(list())
    lapply(seq_along(cols), function(y) c(list(year = years[y]), box(samp_mat[, cols[y]])))
  }

  recruit_cols <- per_year("lambda_R")
  adult_cols <- per_year("N_adult")
  if (is.null(adult_cols)) adult_cols <- per_year("lambda_A")

  prop_cols <- per_year("prop_1")
  prop_by_year <- !is.null(prop_cols) && n_year > 1
  if (!prop_by_year) prop_cols <- intersect(c("prop_1", "prop_1[1]"), colnames(samp_mat))[1]
  pulses <- lapply(seq_along(prop_cols), function(k) {
    p1 <- samp_mat[, prop_cols[k]]
    list(year = if (prop_by_year) years[k] else NA,
         first = box(p1), second = box(1 - p1))
  })

  list(
    years = as.list(years),
    recruits = by_year(recruit_cols),
    adults = by_year(adult_cols),
    pulse_days = as.list(as.integer(pulse_days)),
    pulses_by_year = prop_by_year,
    pulses = pulses
  )
}
