library(tidyverse); library(patchwork)

source("util_code/sim_functions.R")

# read in samples
samp <- readRDS("data/posterior_samples/twopulse.rds")
samp_mat <- do.call(rbind, samp)

# get lambda columns
lambdaA_cols <- grep("^lambda_A\\[", colnames(samp_mat), value = TRUE)
lambdaR_cols <- grep("^lambda_R\\[", colnames(samp_mat), value = TRUE)

# build model and get dependencies
CmyModel <- compileNimble(myModel)
deps <- CmyModel$getDependencies(c("h_F_max", "h_S_max", "h_M_max",
                                   "lambda_A", "lambda_R", "prop_1"))

# simulate N
n_draw <- 200
dimN <- dim(CmyModel$N)
indices <- sample(nrow(samp_mat), n_draw)

N_post <- array(NA_real_, dim = c(n_draw, dimN))

for (i in seq_along(indices)) {
  N_post[i, , , ] <- simulate_dynamics(CmyModel, samp_mat, indices[i],
                                       lambdaA_cols, lambdaR_cols, deps)
}

# summarize acrosss draws
N_med <- apply(N_post, c(2, 3, 4), median)
N_lo  <- apply(N_post, c(2, 3, 4), quantile, 0.025)
N_hi  <- apply(N_post, c(2, 3, 4), quantile, 0.975)

# total abundance per occasion/year
tot <- apply(N_post, c(1, 2, 3), sum)      # draw x occasion x year
tot_med <- apply(tot, c(2, 3), median)
tot_lo  <- apply(tot, c(2, 3), quantile, 0.025)
tot_hi  <- apply(tot, c(2, 3), quantile, 0.975)

# get C_T
C_T <- CmyModel$C_T

# get CPUE
traps <- matrix(0L, nrow = n_occ, ncol = n_year)
traps[cbind(occ_t, occ_y)] <- totalo
cpue <- sweep(C_T, c(1, 2), traps, "/")
cpue[!is.finite(cpue)] <- NA

biweek <- c(59, 76, 91, 106, 121, 137, 152, 167, 182, 198, 213, 229, 
            244, 259, 274, 290, 305, 320, 335)

create_plot(biweek = biweek, year = 3, time = 4, 
            cpue = cpue, N_med = N_med, N_lo = N_lo, N_hi = N_hi,
            tot_med = tot_med, tot_lo = tot_lo, tot_hi = tot_hi)

