library(tidyverse); library(patchwork)


samp <- readRDS("data/posterior_samples/twopulse.rds")
samp_mat <- do.call(rbind, samp)

index <- 100

lambdaA_cols <- grep("^lambda_A\\[", colnames(samp_mat), value = TRUE)
lambdaR_cols <- grep("^lambda_R\\[", colnames(samp_mat), value = TRUE)

CmyModel <- compileNimble(myModel)

deps <- CmyModel$getDependencies(c("h_F_max", "h_S_max", "h_M_max",
                                "lambda_A", "lambda_R", "prop_1"))


simulate_dynamics <- function(model, index, lambdaA_cols, lambdaR_cols, deps) {
  
  # add param values
  CmyModel$h_F_max <- samp_mat[index, "h_F_max"]
  CmyModel$h_S_max <- samp_mat[index, "h_S_max"]
  CmyModel$h_M_max <- samp_mat[index, "h_M_max"]
  CmyModel$lambda_A <- samp_mat[index, lambdaA_cols]
  CmyModel$lambda_R <- samp_mat[index, lambdaR_cols]
  CmyModel$prop_1 <- samp_mat[index, "prop_1"]
  
  # update model
  CmyModel$calculate(deps)
  
  # get N
  N <- CmyModel$N
  
  # get C_T
  C_T <- CmyModel$C_T
}

traps <- matrix(0L, nrow = n_occ, ncol = n_year)
traps[cbind(occ_t, occ_y)] <- totalo
cpue <- sweep(C_T, c(1, 2), traps, "/")
cpue[!is.finite(cpue)] <- NA

biweek <- c(59, 76, 91, 106, 121, 137, 152, 167, 182, 198, 213, 229, 
            244, 259, 274, 290, 305, 320, 335)
year <- 4
for (i in 1:dim(N)[1]) {
  time <- i
  lab <- paste0("Julian day: ", biweek[time])
  
  plot_N <- ggplot() +
    geom_col(aes(x = x, y = round(N[time, year, ])), fill = "cornflowerblue") +
    labs(x = "carapace width (mm)", y = "estimated abundance") +
    scale_y_continuous(limits = c(0, max(round(N[, year, ])))) +
    ggtitle(lab) +
    theme_minimal()
  
  vals <- cpue[time, year, ]
  
  plot_cpue <- if (all(is.na(vals))) {
    ggplot() +
      annotate("text", x = mean(range(x)), y = max(cpue[, year, ], 
                                                   na.rm = TRUE) / 2,
               label = "no observations", size = 5, colour = "grey40") +
      scale_x_continuous(limits = range(x)) +
      scale_y_continuous(limits = c(0, max(cpue[, year, ], na.rm = TRUE))) +
      labs(x = "carapace width (mm)", y = "captured crabs / trap (CPUE)") +
      theme_minimal()
  } else {
    ggplot() +
      geom_col(aes(x = x, y = vals), fill = "goldenrod") +
      labs(x = "carapace width (mm)", y = "captured crabs / trap (CPUE)") +
      scale_y_continuous(limits = c(0, max(cpue[, year, ], na.rm = TRUE))) +
      theme_minimal()
  }
  
  print(plot_N + plot_cpue + plot_layout(ncol = 1))
}



