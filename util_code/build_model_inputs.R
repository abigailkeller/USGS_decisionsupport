# Reads the prepped model-data structures from `data_dir` (written by
# prep_model_data.R) and builds the nimble `constants`/`data`/`inits`
# arguments shared by both run_model.R (MCMC) and simulate_dynamics.R
# (posterior-predictive simulation), and picks which model code file to use. Keeping this in one place means both
# scripts build the exact same model from the exact same inputs.
# Groups the traps within each occasion (pair) j that have identical catch
# rates -- same trap type and soak time -- and summarizes their catches as
# C_hist[j, k, g, c], the number of traps in group g that caught c crabs of
# size class k. The models' grouped trap-level likelihood uses these in place
# of per-trap catches, which gives the same likelihood with far less work
# when there are many traps per occasion.
group_traps <- function(C, totalo, f_index, s_index, m_index, soak_days) {
  n_pair <- length(totalo)
  n_size <- dim(C)[3]
  keys <- lapply(seq_len(n_pair), function(j) {
    i <- seq_len(totalo[j])
    paste(f_index[j, i], s_index[j, i], m_index[j, i], soak_days[j, i])
  })
  n_grp <- vapply(keys, function(key) length(unique(key)), integer(1))
  # every occasion gets the same number of groups, padded with empty groups
  # (no traps), and at least 2 so a single group isn't dropped to a vector
  # when the model is run uncompiled
  max_grp <- max(2, n_grp)
  max_count <- max(1, C)

  grp_n <- grp_f <- grp_s <- grp_m <- grp_soak <-
    matrix(0, n_pair, max_grp)
  C_hist <- array(0, c(n_pair, n_size, max_grp, max_count))
  for (j in seq_len(n_pair)) {
    i <- seq_len(totalo[j])
    g <- match(keys[[j]], unique(keys[[j]]))
    first <- !duplicated(g)
    grp_n[j, 1:n_grp[j]] <- tabulate(g, n_grp[j])
    grp_f[j, g[first]] <- f_index[j, i[first]]
    grp_s[j, g[first]] <- s_index[j, i[first]]
    grp_m[j, g[first]] <- m_index[j, i[first]]
    grp_soak[j, g[first]] <- soak_days[j, i[first]]
    for (k in seq_len(n_size)) {
      catch <- C[j, i, k]
      for (r in which(catch > 0)) {
        C_hist[j, k, g[r], catch[r]] <- C_hist[j, k, g[r], catch[r]] + 1
      }
    }
  }

  list(max_grp = max_grp, grp_n = grp_n, grp_f = grp_f, grp_s = grp_s,
       grp_m = grp_m, grp_soak = grp_soak, C_hist = C_hist,
       max_count = max_count)
}

build_model_inputs <- function(data_dir) {
  C <- readRDS(file.path(data_dir, "counts.rds"))
  C_T <- readRDS(file.path(data_dir, "ncap.rds"))

  n_occ <- readRDS(file.path(data_dir, "n_occ.rds"))
  n_year <- readRDS(file.path(data_dir, "n_year.rds"))
  n_pair <- readRDS(file.path(data_dir, "n_pair.rds"))
  occ_t <- readRDS(file.path(data_dir, "occ_t.rds"))
  occ_y <- readRDS(file.path(data_dir, "occ_y.rds"))
  D <- readRDS(file.path(data_dir, "D.rds"))
  totalo <- readRDS(file.path(data_dir, "totalo.rds"))
  soak_days <- readRDS(file.path(data_dir, "soak_days.rds"))
  m_index <- readRDS(file.path(data_dir, "m_index.rds"))
  f_index <- readRDS(file.path(data_dir, "f_index.rds"))
  s_index <- readRDS(file.path(data_dir, "s_index.rds"))

  b <- readRDS(file.path(data_dir, "b.rds"))
  x <- readRDS(file.path(data_dir, "x.rds"))

  # data structures to introduce recruits into the model at t = 2 and t = 6
  recruit_intro1 <- recruit_intro2 <- rep(0, length(D))
  recruit_intro1[2] <- 1
  recruit_intro2[6] <- 1

  grp <- group_traps(C, totalo, f_index, s_index, m_index, soak_days)

  constants <- list(
    n_year = n_year,
    n_occ = n_occ,
    n_pair = n_pair,
    occ_t = occ_t,
    occ_y = occ_y,
    n_size = length(x),
    upper = b[2:length(b)],
    lower = b[1:length(x)],
    max_grp = grp$max_grp,
    grp_n = grp$grp_n,
    grp_f = grp$grp_f,
    grp_s = grp$grp_s,
    grp_m = grp$grp_m,
    grp_soak = grp$grp_soak,
    max_count = grp$max_count,
    x = x,
    D = D,
    recruit_intro1 = recruit_intro1,
    recruit_intro2 = recruit_intro2,
    pi = pi
  )

  # the one-year model has no year dimension (occasion x size)
  data <- list(
    C_T = if (n_year > 1) C_T else C_T[, 1, ],
    C_hist = grp$C_hist
  )

  # crude capture probability from the fixed selectivity parameters, used
  # only to seed reasonable initial abundances (not part of the model itself)
  haz_one <- function(xx) {
    0.0001784 / (1 + exp(-0.4977 * (xx - 35.34))) +      # fukui
      0.003937  / (1 + exp(-0.3437 * (xx - 46.41))) +      # shrimp
      0.0003912 * exp(-(xx - 45.12) ^ 2 / (2 * 6.449 ^ 2)) # minnow
  }
  traps_per_year <- tapply(totalo, occ_y, sum)
  p_year <- sapply(traps_per_year, function(nt) 1 - exp(-nt * haz_one(x)))
  catch_year <- apply(C_T, c(2, 3), sum)
  lambda_floor <- sapply(seq_len(n_year), function(yy) {
    needed <- catch_year[yy, ] / pmax(p_year[, yy], 1e-6)
    sum(needed, na.rm = TRUE) * 3
  })

  # multiple years share a truncated normal hyperprior on recruit abundance
  # (model_code_multiyear.R); a single year can't inform it, so it uses
  # independent priors instead (model_code_oneyear.R)
  multiyear <- n_year > 1
  model_code_path <- if (multiyear) {
    "util_code/model_code_multiyear.R"
  } else {
    "util_code/model_code_oneyear.R"
  }

  # the multi-year model projects adults from one year into the next
  # through an overwinter growth kernel with no natural mortality applied
  # (overwinter mortality is modelled separately), so needs a vector of ones
  if (multiyear) constants$ones <- rep(1, length(x))

  # lower bound for the log-uniform prior on alpha_o (multi-year model).
  # Below it, density-dependent overwinter mortality is negligible -- a
  # hazard under 0.01 for a 20 mm crab even at 10x the largest catch-based
  # abundance -- so the likelihood is flat there; letting the prior extend
  # far into that region makes chains wander it slowly. Scaled by the data's
  # abundance so it works across sites of very different sizes.
  log_alpha_o_min <- log(0.01 * 20 ^ 2 / (10 * max(lambda_floor, 1)))
  if (multiyear) constants$log_alpha_o_min <- log_alpha_o_min

  inits <- function() {
    out <- list(
      prop_1 = 0.1,
      h_M_max = 0.0003912,
      h_F_max = 0.0001784,
      h_S_max = 0.003937,
      log_mu_A = 4, sigma_A = 0.2,
      lambda_A = pmax(lambda_floor, 1000),
      lambda_R = pmax(lambda_floor, 1000)
    )
    if (multiyear) {
      out$mu_lambda <- mean(out$lambda_R)
      out$log_sigma_lambda <- log(max(sd(out$lambda_R), 1000))
      # adults are only estimated in the first year; later years are
      # projected through overwinter survival
      out$lambda_A <- out$lambda_A[1]
      out$log_alpha_o <- max(log(0.01), log_alpha_o_min + 1)
      out$mu_eps <- -2
      out$eps_y <- rep(0, n_year)
    }
    out
  }

  list(
    constants = constants,
    data = data,
    inits = inits,
    multiyear = multiyear,
    model_code_path = model_code_path,
    n_year = n_year,
    n_occ = n_occ,
    n_pair = n_pair,
    occ_t = occ_t,
    occ_y = occ_y,
    totalo = totalo,
    x = x,
    lambda_floor = lambda_floor
  )
}
