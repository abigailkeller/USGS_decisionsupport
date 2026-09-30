library(nimble)
library(MCMCvis)
library(parallel)
library(expm)
library(jsonlite)

source("util_code/build_model_inputs.R")

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

model_inputs <- build_model_inputs(data_dir)
constants <- model_inputs$constants
data <- model_inputs$data
inits <- model_inputs$inits
n_year <- model_inputs$n_year
lambda_floor <- model_inputs$lambda_floor

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
