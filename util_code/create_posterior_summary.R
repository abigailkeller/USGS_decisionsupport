library(MCMCvis)

samp <- readRDS("data/posterior_samples/twopulse.rds")

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
