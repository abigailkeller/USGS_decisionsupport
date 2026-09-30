library(nimble)
library(jsonlite)

source("util_code/constants.R")
source("util_code/build_model_inputs.R")
source("util_code/model_code_2pulse.R")
source("util_code/sim_functions.R")

# command-line args: <data_dir> <posterior_path> <output_path> <progress_path> <n_draw>
args <- commandArgs(trailingOnly = TRUE)
data_dir <- if (length(args) >= 1) args[1] else "data/model_data"
posterior_path <- if (length(args) >= 2) args[2] else "data/posterior_samples/twopulse.rds"
output_path <- if (length(args) >= 3) args[3] else "data/posterior_samples/simulated_dynamics.json"
progress_path <- if (length(args) >= 4) args[4] else "data/posterior_samples/analyze_progress.json"
n_draw <- if (length(args) >= 5) as.integer(args[5]) else 200

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

# converts an n-dimensional array into nested lists (outer to inner in the
# same order as dim(x)) so jsonlite renders it as properly nested JSON arrays
# instead of a flattened vector
to_nested <- function(x) {
  if (is.null(dim(x)) || length(dim(x)) <= 1) return(as.list(as.numeric(x)))
  apply(x, 1, to_nested, simplify = FALSE)
}

analyze <- function() {

write_progress("preparing", 0, n_draw, "Loading posterior samples and model inputs...")

model_inputs <- build_model_inputs(data_dir)
years <- readRDS(file.path(data_dir, "years.rds"))

samp <- readRDS(posterior_path)
samp_mat <- do.call(rbind, samp)

lambdaA_cols <- grep("^lambda_A\\[", colnames(samp_mat), value = TRUE)
lambdaR_cols <- grep("^lambda_R\\[", colnames(samp_mat), value = TRUE)

write_progress("compiling", 0, n_draw, "Building and compiling the model...")

# Only a single compiled model instance is needed here (no MCMC, no parallel
# chains) since we're just calling $calculate() once per posterior draw.
myModel <- nimbleModel(code = model_code,
                       data = model_inputs$data,
                       constants = model_inputs$constants,
                       inits = model_inputs$inits())
CmyModel <- compileNimble(myModel)

deps <- CmyModel$getDependencies(c("h_F_max", "h_S_max", "h_M_max",
                                   "lambda_A", "lambda_R", "prop_1"))

dimN <- dim(CmyModel$N)
# cap n_draw to the number of posterior samples actually available (e.g. a
# short test run may keep fewer post-burn-in rows than the requested n_draw)
n_draw <- min(n_draw, nrow(samp_mat))
indices <- sample(nrow(samp_mat), n_draw)
N_post <- array(NA_real_, dim = c(n_draw, dimN))

write_progress("simulating", 0, n_draw, "Simulating posterior draws...")
for (i in seq_along(indices)) {
  N_post[i, , , ] <- simulate_dynamics(CmyModel, samp_mat, indices[i],
                                       lambdaA_cols, lambdaR_cols, deps)
  if (i %% 5 == 0 || i == n_draw) {
    write_progress("simulating", i, n_draw,
                   sprintf("Simulating: %d of %d posterior draws", i, n_draw))
  }
}

write_progress("saving", n_draw, n_draw, "Summarizing results...")

# summarize across draws
N_med <- apply(N_post, c(2, 3, 4), median)
N_lo  <- apply(N_post, c(2, 3, 4), quantile, 0.025)
N_hi  <- apply(N_post, c(2, 3, 4), quantile, 0.975)

# total abundance per occasion/year
tot <- apply(N_post, c(1, 2, 3), sum)      # draw x occasion x year
tot_med <- apply(tot, c(2, 3), median)
tot_lo  <- apply(tot, c(2, 3), quantile, 0.025)
tot_hi  <- apply(tot, c(2, 3), quantile, 0.975)

# CPUE from the observed catch and effort
C_T <- CmyModel$C_T
traps <- matrix(0L, nrow = model_inputs$n_occ, ncol = model_inputs$n_year)
traps[cbind(model_inputs$occ_t, model_inputs$occ_y)] <- model_inputs$totalo
cpue <- sweep(C_T, c(1, 2), traps, "/")
cpue[!is.finite(cpue)] <- NA

result <- list(
  biweek = as.list(biweek),
  years = as.list(as.integer(years)),
  x = as.list(model_inputs$x),
  nOcc = model_inputs$n_occ,
  nYear = model_inputs$n_year,
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

tmp <- paste0(output_path, ".tmp")
writeLines(toJSON(result, auto_unbox = TRUE, na = "null", digits = NA), tmp)
file.rename(tmp, output_path)

write_progress("done", n_draw, n_draw, "Analysis complete.", done = TRUE)

}

tryCatch(
  analyze(),
  error = function(e) {
    write_progress("error", 0, n_draw, "Analysis failed.", done = TRUE,
                   error = conditionMessage(e))
    quit(status = 1)
  }
)
