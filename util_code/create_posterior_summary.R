library(MCMCvis)

# command-line args: <posterior_path> <output_csv_path>
# prints "multiyear", "independent" or "oneyear" to stdout so the caller can
# bundle the matching README
args <- commandArgs(trailingOnly = TRUE)
posterior_path <- if (length(args) >= 1) args[1] else "data/posterior_samples/twopulse.rds"
output_csv_path <- if (length(args) >= 2) args[2] else "data/posterior_samples/posterior_summary.csv"

dir.create(dirname(output_csv_path), recursive = TRUE, showWarnings = FALSE)

samp <- readRDS(posterior_path)

# add prop_2 (one per prop_1, which is indexed by year when years are fit
# independently)
samp <- lapply(samp, function(m) {
  p1 <- grep("^prop_1(\\[|$)", colnames(m), value = TRUE)
  p2 <- 1 - m[, p1, drop = FALSE]
  colnames(p2) <- sub("^prop_1", "prop_2", p1)
  cbind(m, p2)
})

# get summary
summary <- MCMCsummary(samp)

# get lambda rows
lambdaA_rows <- grep("^lambda_A(\\[|$)", rownames(summary), value = TRUE)
lambdaR_rows <- grep("^lambda_R(\\[|$)", rownames(summary), value = TRUE)
epsy_rows <- grep("^eps_y\\[", rownames(summary), value = TRUE)
nadult_rows <- grep("^N_adult\\[", rownames(summary), value = TRUE)

# parameters that are only in some model versions (most only when multiple
# years were fit)
hyper_rows <- intersect(c("mu_lambda", "sigma_lambda", "mu_eps", "b_o"),
                        rownames(summary))
# adult size distribution: single, per block of consecutive years, or per
# year depending on the model version
size_rows <- grep("^(log_mu_A|sigma_A)(\\[|$)", rownames(summary), value = TRUE)
prop_rows <- grep("^prop_[12](\\[|$)", rownames(summary), value = TRUE)

# get table to download as csv
table <- summary[c(lambdaA_rows, nadult_rows, lambdaR_rows, hyper_rows,
                   size_rows, epsy_rows, prop_rows),
                 c("mean", "sd", "2.5%", "97.5%")]

write.csv(table, output_csv_path)

# report which model version was summarized: mu_lambda (recruitment across
# years) only exists in the multi-year model, and lambda_A is indexed by
# year in the independent-years model
cat(if ("mu_lambda" %in% rownames(summary)) {
  "multiyear"
} else if (any(grepl("^lambda_A\\[", rownames(summary)))) {
  "independent"
} else {
  "oneyear"
})
