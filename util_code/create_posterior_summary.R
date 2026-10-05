library(MCMCvis)

samp <- readRDS("data/posterior_samples/twopulse.rds")

summary <- MCMCsummary(samp)
