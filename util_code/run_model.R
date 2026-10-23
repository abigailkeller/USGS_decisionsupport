library(nimble)
library(MCMCvis)
library(parallel)
library(expm)

source("util_code/constants.R")
source("util_code/build_model_inputs.R")
source("util_code/analyze_helpers.R")
source("util_code/sim_functions.R")
source("util_code/progress.R")

# command-line args: <data_dir> <output_path> <progress_path> <iter> <thin> <nchains>
# falls back to the original standalone defaults when run with no args;
# <iter> may be "auto" (or omitted) to use 20,000 iterations for multiple
# years of data and 5,000 for a single year
args <- commandArgs(trailingOnly = TRUE)
data_dir <- if (length(args) >= 1) args[1] else "data/model_data"
output_path <- if (length(args) >= 2) args[2] else "data/posterior_samples/twopulse.rds"
progress_path <- if (length(args) >= 3) args[3] else "data/posterior_samples/progress.json"
iter <- if (length(args) >= 4) suppressWarnings(as.integer(args[4])) else NA
thin <- if (length(args) >= 5) as.integer(args[5]) else 10
nchains <- if (length(args) >= 6) as.integer(args[6]) else 4

dir.create(dirname(output_path), recursive = TRUE, showWarnings = FALSE)
write_progress <- make_progress_writer(progress_path)

run_model <- function() {

model_inputs <- build_model_inputs(data_dir)
if (is.na(iter)) iter <<- if (model_inputs$multiyear) 20000 else 5000

write_progress("preparing", 0, iter, "Loading prepared model data...")

constants <- model_inputs$constants
data <- model_inputs$data
inits <- model_inputs$inits
n_year <- model_inputs$n_year
lambda_floor <- model_inputs$lambda_floor
monitors <- c("lambda_R", "lambda_A", "prop_1",
              "h_M_max", "h_F_max", "h_S_max", "N_optim")
if (model_inputs$multiyear) {
  monitors <- c(monitors, "mu_lambda", "sigma_lambda", "log_sigma_lambda",
                "alpha_o", "log_alpha_o", "mu_eps", "eps_y", "N_adult")
}
years <- readRDS(file.path(data_dir, "years.rds"))

########################
# run MCMC in parallel #
########################

cl <- makeCluster(nchains)

set.seed(10120)

fun_path <- normalizePath(model_inputs$model_code_path)
sim_fun_path <- normalizePath("util_code/sim_functions.R")

multiyear <- model_inputs$multiyear
clusterExport(cl, c("inits", "data", "constants", "n_year", "multiyear",
                    "lambda_floor", "monitors", "fun_path", "sim_fun_path"),
             envir = environment())

write_progress("compiling", 0, iter, "Building and compiling the model...")

# One-time setup per worker: define the custom nimble functions, build the
# model and MCMC, and compile them. Each worker keeps its compiled MCMC
# (`cmodel_mcmc`) alive in its own global environment across the later
# clusterEvalQ() calls that advance the chain in chunks below -- and, if the
# app requests an "analyze results" step before this process exits, worker 1
# also keeps its compiled `CmyModel` alive so that step can reuse it instead
# of recompiling from scratch (see the stdin-driven reuse loop below).
invisible(clusterEvalQ(cl, {
  library(nimble); library(coda); library(expm)
  source(fun_path, local = FALSE)
  source(sim_fun_path, local = FALSE)

  # build model
  myModel <- nimbleModel(code = model_code,
                         data = data,
                         constants = constants,
                         inits = inits())


  # build the MCMC
  mcmcConf_myModel <- configureMCMC(
    myModel,
    monitors = monitors,
    useConjugacy = FALSE#, enableWAIC = TRUE
    )

  # the overwinter mortality parameters trade off against each other
  # (density-dependent vs. baseline vs. year-specific mortality), so sample
  # them jointly with an automated factor slice sampler rather than one at
  # a time. The last winter's eps_y has no data after it (it's only a
  # forecast), so nimble won't sample it jointly with the others; it keeps
  # its own sampler
  if (multiyear) {
    overwinter_nodes <- c("log_alpha_o", "mu_eps",
                          sprintf("eps_y[%d]", seq_len(n_year - 1)))
    mcmcConf_myModel$removeSamplers(overwinter_nodes)
    mcmcConf_myModel$addSampler(target = overwinter_nodes, type = "AF_slice")
  }

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

write_progress("done", iter, iter, "MCMC run complete.", done = TRUE)

# ---- optional reuse: fulfill one "analyze results" request in-process ----
# nimble does not cache compiled model code across separate R processes (a
# fresh session recompiling into the same output directory takes just as long
# as the first compile), so the only way to actually reuse the compiled
# model is to keep this process alive and hand it the request directly.
# server.js sends one line of the form:
#   ANALYZE\t<posterior_path>\t<output_path>\t<progress_path>\t<n_draw>\n
# over this process's stdin if it's still waiting here when the user clicks
# "Analyze results"; otherwise it falls back to spawning simulate_dynamics.R
# standalone, which recompiles its own model.
run_analysis_reusing_worker <- function(posterior_path, analyze_output_path,
                                        analyze_progress_path, n_draw) {
  analyze_write_progress <- make_progress_writer(analyze_progress_path)
  analyze_write_progress("preparing", 0, n_draw, "Loading posterior samples...")

  samp <- readRDS(posterior_path)
  samp_mat <- do.call(rbind, samp)
  lambdaA_cols <- grep("^lambda_A(\\[|$)", colnames(samp_mat), value = TRUE)
  lambdaR_cols <- grep("^lambda_R(\\[|$)", colnames(samp_mat), value = TRUE)
  # cap n_draw to the number of posterior samples actually available
  n_draw <- min(n_draw, nrow(samp_mat))
  indices <- sample(nrow(samp_mat), n_draw)

  sim_nodes <- sim_param_nodes(model_inputs$multiyear)
  clusterExport(cl[1], c("samp_mat", "lambdaA_cols", "lambdaR_cols", "indices",
                         "sim_nodes"),
               envir = environment())
  invisible(clusterEvalQ(cl[1], {
    deps <- CmyModel$getDependencies(sim_nodes)
    N_post <- array(NA_real_, dim = c(length(indices),
                                      dim(with_year_dim(CmyModel$N))))
    NULL
  }))

  analyze_write_progress("simulating", 0, n_draw,
                         "Simulating posterior draws (reusing the compiled model)...")
  n_chunks <- max(1, min(10, n_draw))
  chunk_size <- ceiling(n_draw / n_chunks)
  completed_draws <- 0
  while (completed_draws < n_draw) {
    this_chunk_idx <- (completed_draws + 1):min(completed_draws + chunk_size, n_draw)
    clusterExport(cl[1], "this_chunk_idx", envir = environment())
    invisible(clusterEvalQ(cl[1], {
      for (i in this_chunk_idx) {
        N_post[i, , , ] <- simulate_dynamics(CmyModel, samp_mat, indices[i],
                                             lambdaA_cols, lambdaR_cols, deps)
      }
      NULL
    }))
    completed_draws <- completed_draws + length(this_chunk_idx)
    analyze_write_progress("simulating", completed_draws, n_draw,
                           sprintf("Simulating: %d of %d posterior draws",
                                  completed_draws, n_draw))
  }

  analyze_write_progress("saving", n_draw, n_draw, "Summarizing results...")

  N_post_result <- clusterEvalQ(cl[1], N_post)[[1]]
  C_T_result <- clusterEvalQ(cl[1], with_year_dim(CmyModel$C_T))[[1]]

  result <- summarize_dynamics(N_post_result, C_T_result, model_inputs$n_occ,
                               model_inputs$n_year, model_inputs$occ_t,
                               model_inputs$occ_y, model_inputs$totalo,
                               model_inputs$x, years, biweek)

  tmp <- paste0(analyze_output_path, ".tmp")
  writeLines(jsonlite::toJSON(result, auto_unbox = TRUE, na = "null", digits = NA), tmp)
  file.rename(tmp, analyze_output_path)

  analyze_write_progress("done", n_draw, n_draw, "Analysis complete.", done = TRUE)
}

stdin_con <- file("stdin", "r")
repeat {
  line <- tryCatch(readLines(stdin_con, n = 1), error = function(e) character(0))
  if (length(line) == 0) break
  parts <- strsplit(line, "\t", fixed = TRUE)[[1]]
  if (identical(parts[1], "ANALYZE") && length(parts) == 5) {
    tryCatch(
      run_analysis_reusing_worker(parts[2], parts[3], parts[4], as.integer(parts[5])),
      error = function(e) {
        analyze_write_progress <- make_progress_writer(parts[4])
        analyze_write_progress("error", 0, 1, "Analysis failed.", done = TRUE,
                               error = conditionMessage(e))
      }
    )
  }
  break  # one-shot: fulfill at most one analyze request, then exit
}
close(stdin_con)

stopCluster(cl)

}

tryCatch(
  run_model(),
  error = function(e) {
    write_progress("error", 0, if (is.na(iter)) 1 else iter, "MCMC run failed.", done = TRUE,
                   error = conditionMessage(e))
    quit(status = 1)
  }
)
