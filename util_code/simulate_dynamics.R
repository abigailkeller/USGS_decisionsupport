library(nimble)

source("util_code/constants.R")
source("util_code/build_model_inputs.R")
source("util_code/model_code_2pulse.R")
source("util_code/sim_functions.R")
source("util_code/analyze_helpers.R")
source("util_code/progress.R")

# command-line args: <data_dir> <posterior_path> <output_path> <progress_path> <n_draw>
args <- commandArgs(trailingOnly = TRUE)
data_dir <- if (length(args) >= 1) args[1] else "data/model_data"
posterior_path <- if (length(args) >= 2) args[2] else "data/posterior_samples/twopulse.rds"
output_path <- if (length(args) >= 3) args[3] else "data/posterior_samples/simulated_dynamics.json"
progress_path <- if (length(args) >= 4) args[4] else "data/posterior_samples/analyze_progress.json"
n_draw <- if (length(args) >= 5) as.integer(args[5]) else 200

dir.create(dirname(output_path), recursive = TRUE, showWarnings = FALSE)
write_progress <- make_progress_writer(progress_path)

analyze <- function() {

write_progress("preparing", 0, n_draw, "Loading posterior samples and model inputs...")

model_inputs <- build_model_inputs(data_dir)
years <- readRDS(file.path(data_dir, "years.rds"))

samp <- readRDS(posterior_path)
samp_mat <- do.call(rbind, samp)

lambdaA_cols <- grep("^lambda_A\\[", colnames(samp_mat), value = TRUE)
lambdaR_cols <- grep("^lambda_R\\[", colnames(samp_mat), value = TRUE)

write_progress("compiling", 0, n_draw, "Building and compiling the model...")

# This standalone path is used when no already-compiled model is available to
# reuse (e.g. the app wasn't run in this same server session -- see
# run_model.R's stdin-driven reuse path for the fast path). Only a single
# compiled model instance is needed here (no MCMC, no parallel chains) since
# we're just calling $calculate() once per posterior draw.
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

result <- summarize_dynamics(N_post, CmyModel$C_T, model_inputs$n_occ,
                             model_inputs$n_year, model_inputs$occ_t,
                             model_inputs$occ_y, model_inputs$totalo,
                             model_inputs$x, years, biweek)

tmp <- paste0(output_path, ".tmp")
writeLines(jsonlite::toJSON(result, auto_unbox = TRUE, na = "null", digits = NA), tmp)
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
