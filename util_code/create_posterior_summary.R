library(MCMCvis)

# command-line args: <posterior_path> <output_csv_path>
args <- commandArgs(trailingOnly = TRUE)
posterior_path <- if (length(args) >= 1) args[1] else "data/posterior_samples/twopulse.rds"
output_csv_path <- if (length(args) >= 2) args[2] else "data/posterior_samples/posterior_summary.csv"

dir.create(dirname(output_csv_path), recursive = TRUE, showWarnings = FALSE)

samp <- readRDS(posterior_path)

# add prop_2
samp <- lapply(samp, function(m) cbind(m, prop_2 = 1 - m[, "prop_1"]))

# get summary
summary <- MCMCsummary(samp)

# get lambda rows
lambdaA_rows <- grep("^lambda_A\\[", rownames(summary), value = TRUE)
lambdaR_rows <- grep("^lambda_R\\[", rownames(summary), value = TRUE)

# get table to download as csv
table <- summary[c(lambdaA_rows, lambdaR_rows, "prop_1", "prop_2"),
                 c("mean", "sd", "2.5%", "97.5%")]

write.csv(table, output_csv_path)
