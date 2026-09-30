library(jsonlite)

# Returns a function that writes progress atomically (write to a temp file,
# then rename) to `progress_path`, so a reader polling that path never sees a
# half-written file. Shared by run_model.R and simulate_dynamics.R.
make_progress_writer <- function(progress_path) {
  dir.create(dirname(progress_path), recursive = TRUE, showWarnings = FALSE)
  function(phase, completed, total, message = "", done = FALSE, error = NULL) {
    payload <- list(phase = phase, completed = completed, total = total,
                    message = message, done = done, error = error,
                    updatedAt = format(Sys.time(), "%Y-%m-%dT%H:%M:%OS3Z",
                                       tz = "UTC"))
    tmp <- paste0(progress_path, ".tmp")
    writeLines(toJSON(payload, auto_unbox = TRUE, null = "null"), tmp)
    file.rename(tmp, progress_path)
  }
}
