library(nimble)
library(MCMCvis)
library(parallel)
library(expm)

# read in time series data
C <- readRDS("sample_data/model_data/counts.rds")
C_T <- readRDS("sample_data/model_data/ncap.rds")

# read in time series constants
n_occ <- readRDS("sample_data/model_data/n_occ.rds")
n_year <- readRDS("sample_data/model_data/n_year.rds")
n_pair <- readRDS("sample_data/model_data/n_pair.rds")
occ_t <- readRDS("sample_data/model_data/occ_t.rds")
occ_y <- readRDS("sample_data/model_data/occ_y.rds")
D <- readRDS("sample_data/model_data/D.rds")
totalo <- readRDS("sample_data/model_data/totalo.rds")
soak_days <- readRDS("sample_data/model_data/soak_days.rds")
m_index <- readRDS("sample_data/model_data/m_index.rds")
f_index <- readRDS("sample_data/model_data/f_index.rds")
s_index <- readRDS("sample_data/model_data/s_index.rds")

# get recruit intro
recruit_intro <- rep(0, length(D))
recruit_intro[7] <- 1

# read in IPM constants
b <- readRDS("sample_data/model_data/b.rds")
x <- readRDS("sample_data/model_data/x.rds")


# Write model code
model_code <- nimbleCode({
  
  # ---- shared across years: survival and kernel per occasion ----
  for (t in 1:(n_occ - 1)) {
    S[t, 1:n_size] <- survival(alpha, beta, x[1:n_size], D[t], D[t + 1])
    K[t, 1:n_size, 1:n_size] <- get_kernel(xinf, gk, sigma_G, A, ds,
                                           D[t], D[t + 1], n_size, pi,
                                           x[1:n_size], lower[1:n_size],
                                           upper[1:n_size],
                                           S[t, 1:n_size])
  }
  
  # ---- per-year population dynamics, reusing the shared kernels ----
  for (y in 1:n_year) {
    N[1, y, 1:n_size] <- get_init_adult(log_mu_A, sigma_A,
                                        lower[1:n_size], upper[1:n_size],
                                        lambda_A[y])
    
    for (t in 1:(n_occ - 1)) {
      N[t + 1, y, 1:n_size] <- K[t, 1:n_size, 1:n_size] %*%
        (N[t, y, 1:n_size] - C_T[t, y, 1:n_size]) +
        recruit_intro[t] * R[y, 1:n_size]
    }
  }
  
  ## annual abundance of recruits and adults
  for (m in 1:n_year) {
    lambda_R[m] ~ dlnorm(mu_lambda_R, sdlog = sigma_lambda_R)
    lambda_A[m] ~ dlnorm(mu_lambda_A, sdlog = sigma_lambda_A)
  }
  
  ## annual size distribution of recruits
  R[1:n_year, 1:n_size] <- get_init_recruits(mu_R, sigma_R, lower[1:n_size],
                                             upper[1:n_size],
                                             lambda_R[1:n_year], n_year,
                                             n_size)
  
  
  #####################
  #####################
  # Observation model #
  #####################
  #####################
  
  # ---- observation model: one loop over sampled (t, y) pairs ----
  for (j in 1:n_pair) {
    
    hazard[j, 1:totalo[j], 1:n_size] <- calc_hazard(
      totalo[j], n_size, h_F_max, h_F_k, h_F_0, h_S_max, h_S_k, h_S_0,
      h_M_max, h_M_A, h_M_sigma, f_index[j, 1:totalo[j]],
      s_index[j, 1:totalo[j]], m_index[j, 1:totalo[j]],
      soak_days[j, 1:totalo[j]], x[1:n_size])
    
    p[j, 1:n_size] <- calc_prob(totalo[j], n_size,
                                hazard[j, 1:totalo[j], 1:n_size])
    
    p_C[j, 1:totalo[j], 1:n_size] <- calc_cond_prob(
      totalo[j], n_size, hazard[j, 1:totalo[j], 1:n_size])
    
    for (k in 1:n_size) {
      
      C_T[occ_t[j], occ_y[j], k] ~ dbinom(
        size = round(N[occ_t[j], occ_y[j], k]), prob = p[j, k])
      
      alpha_D[j, 1:totalo[j], k] <- p_C[j, 1:totalo[j], k] * n_p_dir
      
      C[j, 1:totalo[j], k] ~ ddirchmulti(alpha = alpha_D[j, 1:totalo[j], k],
                                         size = C_T[occ_t[j], occ_y[j], k])
    }
  }
  
  
  #######################
  # Prior distributions #
  #######################
  
  ##
  # growth model
  ##
  
  # growth rate
  gk ~ dnorm(1.209, sd = 0.075)
  gk <- 1.209
  # amplitude of growth oscillations
  A ~ dnorm(1.538, sd = 0.162)
  # inflection point of growth oscillations
  ds ~ dnorm(0.2437, sd = 0.0197)
  # asymptotic size
  xinf ~ dnorm(80.5, sd = 0.91)
  # growth error
  sigma_G ~ dnorm(2.818, sd = 0.218)
  
  ##
  # size selectivity parameters
  ##
  
  # minnow max. hazard rate
  h_M_max ~ dnorm(0.0003912, sd = 0.0000617)
  # minnow max. size of capture
  h_M_A ~ dnorm(45.12, sd = 0.67)
  # minnow sigma of gaussian size selectivity curve
  h_M_sigma ~ dnorm(6.449, sd = 0.376)
  # fukui max. hazard rate
  h_F_max ~ dnorm(0.0001784, sd = 0.000015)
  # fukui k of logistic size selectivity curve
  h_F_k ~ dnorm(0.4977, sd = 0.1878)
  # fukui midpoint of logistic size selectivity curve
  h_F_0 ~ dnorm(35.34, sd = 1.98)
  # shrimp max. hazard rate
  h_S_max ~ dnorm(0.003937, sd = 0.0004)
  # shrimp k of logistic size selectivity curve
  h_S_k ~ dnorm(0.3437, sd = 0.0543)
  # shrimp midpoint of logistic size selectivity curve
  h_S_0 ~ dnorm(46.41, sd = 1.46)
  
  ##
  # IPM - natural mortality
  ##
  
  # size-independent natural mortality, shared across all years
  beta ~ dnorm(0.00178, sd = 0.001727)
  # size-dependent natural mortality, shared across all years
  alpha ~ dnorm(9.498, sd = 9.424)
  
  ##
  # observation process
  ##
  
  # dirichlet multinomial (overdispersion in count data)
  ro_dir ~ dnorm(0.03818, sd = 0.00737)
  n_p_dir <- (1 - ro_dir) / ro_dir
  
  ##
  # initial population density and annual recruitment
  ##
  
  # initial adult size (lognormal mean and sd)
  log_mu_A ~ dunif(3.25, 4.5)
  sigma_A ~ dunif(0.1, 1)
  
  # initial recruit size (mean and sd)
  mu_R ~ dnorm(0.2156, sd = 0.0191)
  sigma_R ~ dnorm(10.74, sd = 2.68)
  
  # abundance of recruits (lognormal mean and sd)
  mu_lambda_R ~ dunif(-50, 50)
  sigma_lambda_R ~ dunif(0, 10000)
  
  # abundance of recruits (lognormal mean and sd)
  mu_lambda_A ~ dunif(-50, 50)
  sigma_lambda_A ~ dunif(0, 10000)
  
  
})

# bundle up data and constants
constants <- list(
  # number of years
  n_year = n_year,
  # number of trap occasions (t)
  n_occ = n_occ,
  # number of year/trapping occasion pairs
  n_pair = n_pair,
  # t associated with pairs
  occ_t = occ_t,
  # y associated with pairs
  occ_y = occ_y,
  # number of trap obs in year y, time t
  totalo = totalo,
  # number of sizes in IPM mesh
  n_size = length(x),
  # upper bounds in IPM mesh
  upper = b[2:length(b)],
  # lower bounds in IPM mesh
  lower = b[1:length(x)],
  # binary indicator of fukui traps in time t, obs j, year i
  f_index = f_index,
  # binary indicator of minnow traps in time t, obs j, year i
  m_index = m_index,
  # binary indicator of shrimp traps in time t, obs j, year i
  s_index = s_index,
  # midpoints in IPM mesh
  x = x,
  # calendar date indices (fraction of year) in time t
  D = D,
  # number of soak days for each trap at time t, trap j, year i
  soak_days = soak_days,
  # data structure to introduce recruits into the model at t = 6
  recruit_intro = recruit_intro,
  pi = pi
)

data <- list(
  # total harvested within at time t, year y, size x
  C_T = C_T,
  # harvest count at time t, year y, trap j, size x
  C = C
)

# initial values
inits <- function() {
  list(
    h_M_max = 0.0003912, h_M_A = 45.12, 
    h_M_sigma = 6.449, h_F_max = 0.0001784, 
    h_F_k = 0.4977, h_F_0 = 35.34,
    h_S_max = 0.003937, h_S_k = 0.3437, 
    h_S_0 = 46.41, ro_dir = 0.01, alpha = 9.498, beta = 0.00178,
    gk = 1.2, xinf = 81, A = 1.5, ds = 0.24, sigma_G = 2.8, 
    sigma_R = 1, mu_R = 20, log_mu_A = 4, sigma_A = 0.2,
    lambda_A = runif(n_year, 3000, 10000), 
    lambda_R = runif(n_year, 3000, 10000), 
    mu_lambda_A = log(500), mu_lambda_R = log(500),
    sigma_lambda_A = 0.3, sigma_lambda_R = 0.3
  )
}


########################
# run MCMC in parallel #
########################

cl <- makeCluster(4)

set.seed(10120)

clusterExport(cl, c("model_code", "inits", "data", "constants", "n_year"))

# Create a function with all the needed code
out <- clusterEvalQ(cl, {
  library(nimble)
  library(coda)
  library(expm)
  
  # define dirichlet multinomial mixture
  # pdf
  ddirchmulti <- nimbleFunction (
    run = function(x = double(1), alpha = double(1), size = double(0),
                   log = integer(0, default = 0)) {
      returnType(double(0))
      logProb <- lgamma(size + 1) - sum(lgamma(x + 1)) + lgamma(sum(alpha)) -
        sum(lgamma(alpha)) + sum(lgamma(alpha + x)) -
        lgamma(sum(alpha) + size)
      if (log) return(logProb)
      else return(exp(logProb))
    })
  # distribution number generator
  rdirchmulti <- nimbleFunction (
    run = function(n = integer(0), alpha = double(1), size = double(0)) {
      returnType(double(1))
      if (n != 1) print("rdirchmulti only allows n = 1; using n = 1.")
      p <- rdirch(1, alpha)
      return(rmulti(1, size = size, prob = p))
    })
  
  assign("ddirchmulti", ddirchmulti, .GlobalEnv)
  assign("rdirchmulti", rdirchmulti, .GlobalEnv)
  
  # size selective hazard rate of trap type minnow - bell-shaped curve
  size_sel_norm <- nimbleFunction (
    # input and output types
    run = function(pmax = double(0), xmax = double(0), sigma = double(0),
                   x = double(1))
    {
      returnType(double(1))
      
      vector <- pmax * exp(-(x - xmax) ^ 2 / (2 * sigma ^ 2))
      
      return(vector)
    }
  )
  assign("size_sel_norm", size_sel_norm, envir = .GlobalEnv)
  
  # size selective hazard rate of trap type fukui and shrimp - logistic
  size_sel_log <- nimbleFunction (
    #input and output types
    run = function(pmax = double(0), k = double(0), midpoint = double(0),
                   x = double(1))
    {
      returnType(double(1))
      
      vector <- pmax / (1 + exp(-k * (x - midpoint)))
      
      return(vector)
    }
  )
  assign("size_sel_log", size_sel_log, envir = .GlobalEnv)
  
  
  # calculate trap hazard rate of obs j, based on trap type and soak days
  calc_hazard <- nimbleFunction (
    #input and output types
    run = function(nobs = double(0), n_size = double(0), h_F_max = double(0),
                   h_F_k = double(0), h_F_0 = double(0),
                   h_S_max = double(0), h_S_k = double(0),
                   h_S_0 = double(0), h_M_max = double(0),
                   h_M_A = double(0), h_M_sigma = double(0),
                   obs_ref_f = double(1), obs_ref_s = double(1),
                   obs_ref_m = double(1), soak_days = double(1),
                   x = double(1))
    {
      returnType(double(2))
      
      # create empty array
      array <- array(init = FALSE, dim = c(nobs, n_size))
      # loop through observations
      for (j in 1:nobs) {
        # P(capture)
        array[j, 1:n_size] <- size_sel_log(pmax = h_F_max, k = h_F_k,
                                           midpoint = h_F_0, x = x) *
          obs_ref_f[j] * soak_days[j] +
          size_sel_log(pmax = h_S_max, k = h_S_k, midpoint = h_S_0, x = x) *
          obs_ref_s[j] * soak_days[j] +
          size_sel_norm(pmax = h_M_max, xmax = h_M_A, 
                        sigma = h_M_sigma, x = x) *
          obs_ref_m[j] * soak_days[j]
      }
      
      return(array)
    }
  )
  assign("calc_hazard", calc_hazard, envir = .GlobalEnv)
  
  # calculate conditional probability of capture
  calc_cond_prob <- nimbleFunction (
    #input and output types
    run = function(nobs = double(0), n_size = double(0), hazard = double(2))
    {
      returnType(double(2))
      
      # create empty array
      array <- array(init = FALSE, dim = c(nobs, n_size))
      
      # loop through sizes
      for (k in 1:n_size) {
        #P(capture in trap j | captured at all)
        array[1:nobs, k] <- hazard[1:nobs, k] / sum(hazard[1:nobs, k])
      }
      return(array)
    }
  )
  assign("calc_cond_prob", calc_cond_prob, envir = .GlobalEnv)
  
  
  # calculate total capture probability
  calc_prob <- nimbleFunction (
    #input and output types
    run = function(nobs = double(0), n_size = double(0), hazard = double(2))
    {
      returnType(double(1))
      
      # create empty array
      p <- rep(NA, n_size)
      
      # loop through sizes
      for (k in 1:n_size) {
        # 1 - exp(-P(captured at all))
        p[k] <- 1 - exp(-sum(hazard[1:nobs, k]))
      }
      return(p)
    }
  )
  assign("calc_prob", calc_prob, envir = .GlobalEnv)
  
  # function for seasonal growth kernel -- biweekly time step
  get_kernel <- nimbleFunction (
    # input and output types
    run = function(xinf = double(0), k = double(0),
                   sigma_G = double(0), A = double(0),
                   ds = double(0), t1 = double(0), t2 = double(0),
                   n_size = double(0), pi = double(0), x = double(1),
                   lower = double(1), upper = double(1), S = double(1))
    {
      returnType(double(2))
      
      # create empty array
      array <- matrix(NA, ncol = n_size, nrow = n_size)
      
      if(!is.na(t2) & t2 == 0) {
        array <- diag(n_size)
      } else {
        # season adjusted params
        S_t <- (A * k / (2 * pi)) * sin(2 * pi * (t2 - ds))
        S_t0 <- (A * k / (2 * pi)) * sin(2 * pi * (t1 - ds))
        
        # p(y"|y)
        for (i in 1:n_size) {
          increment <- (xinf - x[i]) *
            (1 - exp(-k * (t2 - t1) - S_t + S_t0))
          mean <- x[i] + increment
          array[1:n_size, i] <- (pnorm(upper, mean, sd = sigma_G) -
                                   pnorm(lower, mean, sd = sigma_G))
        }
        
        # normalize and apply natural mortality
        for (i in 1:n_size) {
          array[, i] <- array[, i] / sum(array[, i]) * S
        }
      }
      return(array)
    }
  )
  assign("get_kernel", get_kernel, envir = .GlobalEnv)
  
  # initial size distribution of adults - year 1
  get_init_adult <- nimbleFunction (
    
    run = function(log_mu_A = double(0), sigma_A = double(0),
                   lower = double(1), upper = double(1),
                   lambda_A = double(0))
    {
      returnType(double(1))
      
      prop_adult <- plnorm(q = upper, meanlog = log_mu_A, sdlog = sigma_A) -
        plnorm(q = lower, meanlog = log_mu_A, sdlog = sigma_A)
      
      # get initial size-structured abundance of adults
      out <- prop_adult * lambda_A
      
      return(out)
    }
  )
  assign("get_init_adult", get_init_adult, envir = .GlobalEnv)
  
  # annual size distributions of recruit
  get_init_recruits <- nimbleFunction (
    
    run = function(mu_R = double(0), sigma_R = double(0),
                   lower = double(1), upper = double(1),
                   lambda_R = double(1), n_year = double(0),
                   n_size = double(0))
    {
      returnType(double(2))
      
      # create empty array
      out <- matrix(NA, ncol = n_size, nrow = n_year)
      
      # moment match from normal to gamma
      var <- sigma_R ^ 2
      shape <- mu_R ^ 2 / var
      rate <- mu_R / var
      prop_recruit <- pgamma(q = upper, shape = shape, rate = rate) -
        pgamma(q = lower, shape = shape, rate = rate)
      
      # get initial size-structured abundance of recruits
      for (y in 1:n_year) {
        out[y, ] <- prop_recruit[1:n_size] * lambda_R[y]
      }
      
      return(out)
    }
  )
  assign("get_init_recruits", get_init_recruits, envir = .GlobalEnv)
  
  # natural (non-winter) survival
  survival <- nimbleFunction (
    
    run = function(alpha = double(0), beta = double(0), x = double(1),
                   t1 = double(0), t2 = double(0))
    {
      returnType(double(1))
      
      # number of biweeks
      deltat <- round((t2 - t1) * (52.1429 / 2))
      
      # get survival rate
      out <- exp(-deltat * (beta + alpha / x ^ 2))
      
      return(out)
    }
  )
  assign("survival", survival, envir = .GlobalEnv)
  
  
  # build model
  myModel <- nimbleModel(code = model_code,
                         data = data,
                         constants = constants,
                         inits = inits())
  
  
  # build the MCMC
  mcmcConf_myModel <- configureMCMC(
    myModel,
    monitors = c("log_mu_A", "sigma_A", 
                 "mu_lambda_A", "sigma_lambda_A",
                 "mu_lambda_R", "sigma_lambda_R",
                 "lambda_R", "lambda_A",
                 "h_M_max", "h_F_max", "h_S_max"),
    useConjugacy = FALSE, enableWAIC = TRUE)
  
  # build MCMC
  myMCMC <- buildMCMC(mcmcConf_myModel)
  
  # compile the model and MCMC
  CmyModel <- compileNimble(myModel)
  
  # compile the MCMC
  cmodel_mcmc <- compileNimble(myMCMC, project = myModel)
  
  # run MCMC
  cmodel_mcmc$run(100, thin = 1,
                  reset = FALSE)
  
  samples <- as.mcmc(as.matrix(cmodel_mcmc$mvSamples))
  
  return(samples)
})

# discard burnin
lower <- 2000
upper <- 10001
sequence <- seq(lower, upper, 1)
out_sub <- list(out[[1]][sequence, ], out[[2]][sequence, ],
                out[[3]][sequence, ], out[[4]][sequence, ])

# save samples
saveRDS(out_sub, "data/posterior_samples/savedsamples_IPM.rds")

stopCluster(cl)
