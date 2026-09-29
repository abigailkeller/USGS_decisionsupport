library(nimble)
library(MCMCvis)
library(parallel)
library(expm)
library(jsonlite)

# command-line args: <data_dir> <output_path> <progress_path> <iter> <thin> <nchains>
# falls back to the original standalone defaults when run with no args
args <- commandArgs(trailingOnly = TRUE)
data_dir <- if (length(args) >= 1) args[1] else "data/model_data"
output_path <- if (length(args) >= 2) args[2] else "data/posterior_samples/twopulse.rds"
progress_path <- if (length(args) >= 3) args[3] else "data/posterior_samples/progress.json"
iter <- if (length(args) >= 4) as.integer(args[4]) else 5000
thin <- if (length(args) >= 5) as.integer(args[5]) else 10
nchains <- if (length(args) >= 6) as.integer(args[6]) else 4

dir.create(dirname(output_path), recursive = TRUE, showWarnings = FALSE)
dir.create(dirname(progress_path), recursive = TRUE, showWarnings = FALSE)

# writes progress atomically (write to a temp file, then rename) so a reader
# polling progress_path never sees a half-written file
write_progress <- function(phase, completed, total, message = "",
                           done = FALSE, error = NULL) {
  payload <- list(phase = phase, completed = completed, total = total,
                  message = message, done = done, error = error,
                  updatedAt = format(Sys.time(), "%Y-%m-%dT%H:%M:%OS3Z",
                                     tz = "UTC"))
  tmp <- paste0(progress_path, ".tmp")
  writeLines(toJSON(payload, auto_unbox = TRUE, null = "null"), tmp)
  file.rename(tmp, progress_path)
}

run_model <- function() {

write_progress("preparing", 0, iter, "Loading prepared model data...")

# read in time series data
C <- readRDS(file.path(data_dir, "counts.rds"))
C_T <- readRDS(file.path(data_dir, "ncap.rds"))

# read in time series constants
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

# get recruit intro
recruit_intro1 <- recruit_intro2 <- rep(0, length(D))
recruit_intro1[1] <- 1
recruit_intro2[6] <- 1

# read in IPM constants
b <- readRDS(file.path(data_dir, "b.rds"))
x <- readRDS(file.path(data_dir, "x.rds"))


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
  # data structure to introduce recruits into the model at t = 2
  recruit_intro1 = recruit_intro1,
  # data structure to introduce recruits into the model at t = 6
  recruit_intro2 = recruit_intro2,
  pi = pi
)

data <- list(
  # total harvested within at time t, year y, size x
  C_T = C_T,
  # harvest count at time t, year y, trap j, size x
  C = C
)

# set up initial values
# crude capture probability from the fixed selectivity parameters
haz_one <- function(x) {                       # per-trap-day hazard by size
  0.0001784 / (1 + exp(-0.4977 * (x - 35.34))) +      # fukui
    0.003937  / (1 + exp(-0.3437 * (x - 46.41))) +      # shrimp
    0.0003912 * exp(-(x - 45.12)^2 / (2 * 6.449^2))     # minnow
}
# average traps per occasion, times occasions per year
traps_per_year <- tapply(totalo, occ_y, sum)
p_year <- sapply(traps_per_year, function(nt) 1 - exp(-nt * haz_one(x)))

catch_year <- apply(C_T, c(2, 3), sum) 

# implied abundance needed, with a safety factor
lambda_floor <- sapply(seq_len(n_year), function(yy) {
  needed <- catch_year[yy, ] / pmax(p_year[, yy], 1e-6)
  sum(needed, na.rm = TRUE) * 3
})

# initial values
inits <- function() {
  list(
    prop_1 = 0.1,
    h_M_max = 0.0003912, 
    h_F_max = 0.0001784, 
    h_S_max = 0.003937, 
    log_mu_A = 4, sigma_A = 0.2,
    lambda_A = pmax(lambda_floor, 1000), 
    lambda_R = pmax(lambda_floor, 1000), 
    mu_lambda_A = mean(log(pmax(lambda_floor, 1000))), 
    mu_lambda_R = mean(log(pmax(lambda_floor, 1000))),
    sigma_lambda_A = max(sd(log(pmax(lambda_floor, 1000))), 0.2), 
    sigma_lambda_R = max(sd(log(pmax(lambda_floor, 1000))), 0.2)
  )
}

########################
# run MCMC in parallel #
########################

cl <- makeCluster(nchains)

set.seed(10120)

fun_path <- normalizePath("util_code/model_code_2pulse.R")

clusterExport(cl, c("inits", "data", "constants", "n_year",
                    "lambda_floor", "fun_path"),
             envir = environment())

write_progress("compiling", 0, iter, "Building and compiling the model...")

# One-time setup per worker: define the custom nimble functions, build the
# model and MCMC, and compile them. Each worker keeps its compiled MCMC
# (`cmodel_mcmc`) alive in its own global environment across the later
# clusterEvalQ() calls that advance the chain in chunks below.
invisible(clusterEvalQ(cl, {
  library(nimble); library(coda); library(expm)
  source(fun_path, local = FALSE)
  
  # build model
  myModel <- nimbleModel(code = model_code,
                         data = data,
                         constants = constants,
                         inits = inits())
  
  
  # build the MCMC
  mcmcConf_myModel <- configureMCMC(
    myModel,
    monitors = c("mu_lambda_A", "sigma_lambda_A",
                 "mu_lambda_R", "sigma_lambda_R",
                 "lambda_R", "lambda_A", "prop_1", 
                 "h_M_max", "h_F_max", "h_S_max"
                 ),
    useConjugacy = FALSE#, enableWAIC = TRUE
    )
  
  # build MCMC
  myMCMC <- buildMCMC(mcmcConf_myModel)
  
  # compile the model and MCMC
  CmyModel <- compileNimble(myModel)
  
  # compile the MCMC
  cmodel_mcmc <- compileNimble(myMCMC, project = myModel)

  NULL
}))

# ---- run the MCMC in chunks, checkpointing progress after each one ----
# nimble's MCMC$run() accumulates samples across repeated calls as long as
# reset = FALSE after the first call, so this produces the same `iter` total
# samples as a single run(iter) call would, just with progress visibility.
n_chunks <- max(1, min(20, iter))
chunk_size <- ceiling(iter / n_chunks)
completed <- 0
write_progress("sampling", 0, iter, "Starting MCMC sampling...")
while (completed < iter) {
  this_chunk <- min(chunk_size, iter - completed)
  is_first_chunk <- completed == 0
  clusterExport(cl, c("this_chunk", "thin", "is_first_chunk"),
               envir = environment())
  invisible(clusterEvalQ(cl, {
    cmodel_mcmc$run(this_chunk, thin = thin, reset = is_first_chunk)
    NULL
  }))
  completed <- completed + this_chunk
  write_progress("sampling", completed, iter,
                 sprintf("Sampling: %d of %d iterations", completed, iter))
}

write_progress("saving", iter, iter, "Collecting posterior samples...")

out <- clusterEvalQ(cl, as.mcmc(as.matrix(cmodel_mcmc$mvSamples)))

# discard burn-in
n_keep <- nrow(out[[1]])
burnin <- floor(n_keep * 0.4)
out_sub <- lapply(out, function(chain) chain[(burnin + 1):n_keep, , 
                                             drop = FALSE])

# save samples
saveRDS(out_sub, output_path)

stopCluster(cl)

write_progress("done", iter, iter, "MCMC run complete.", done = TRUE)

}

tryCatch(
  run_model(),
  error = function(e) {
    write_progress("error", 0, iter, "MCMC run failed.", done = TRUE,
                   error = conditionMessage(e))
    quit(status = 1)
  }
)

# calculate WAIC
# samples_mat <- rbind(out_sub[[1]], out_sub[[2]],
#                      out_sub[[3]], out_sub[[4]])
# calculateWAIC(samples_mat, CmyModel)
