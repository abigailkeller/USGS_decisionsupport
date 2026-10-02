# Reads the prepped model-data structures from `data_dir` (written by
# prep_model_data.R) and builds the nimble `constants`/`data`/`inits`
# arguments shared by both run_model.R (MCMC) and simulate_dynamics.R
# (posterior-predictive simulation). Keeping this in one place means both
# scripts build the exact same model from the exact same inputs.
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

  constants <- list(
    n_year = n_year,
    n_occ = n_occ,
    n_pair = n_pair,
    occ_t = occ_t,
    occ_y = occ_y,
    totalo = totalo,
    n_size = length(x),
    upper = b[2:length(b)],
    lower = b[1:length(x)],
    f_index = f_index,
    m_index = m_index,
    s_index = s_index,
    x = x,
    D = D,
    soak_days = soak_days,
    recruit_intro1 = recruit_intro1,
    recruit_intro2 = recruit_intro2,
    pi = pi
  )

  data <- list(
    C_T = C_T,
    C = C
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

  inits <- function() {
    list(
      prop_1 = 0.1,
      h_M_max = 0.0003912,
      h_F_max = 0.0001784,
      h_S_max = 0.003937,
      log_mu_A = 4, sigma_A = 0.2,
      lambda_A = pmax(lambda_floor, 1000),
      lambda_R = pmax(lambda_floor, 1000)
    )
  }

  list(
    constants = constants,
    data = data,
    inits = inits,
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
