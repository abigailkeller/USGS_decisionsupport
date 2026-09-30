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
