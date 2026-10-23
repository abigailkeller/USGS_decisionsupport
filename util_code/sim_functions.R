# parameter nodes that are set from each posterior draw before simulating;
# the multi-year model also carries adults between years through overwinter
# survival
sim_param_nodes <- function(multiyear) {
  nodes <- c("h_F_max", "h_S_max", "h_M_max", "lambda_A", "lambda_R", "prop_1")
  if (multiyear) nodes <- c(nodes, "log_alpha_o", "mu_eps", "eps_y")
  nodes
}

# the one-year model's abundance and catch arrays have no year dimension
# (occasion x size); add a length-1 year dimension so both model versions
# give occasion x year x size arrays for summarizing
with_year_dim <- function(a) {
  if (length(dim(a)) == 2) array(a, c(dim(a)[1], 1, dim(a)[2])) else a
}

simulate_dynamics <- function(model, samp_mat, index,
                              lambdaA_cols, lambdaR_cols, deps) {
  model$h_F_max  <- samp_mat[index, "h_F_max"]
  model$h_S_max  <- samp_mat[index, "h_S_max"]
  model$h_M_max  <- samp_mat[index, "h_M_max"]
  model$lambda_A <- samp_mat[index, lambdaA_cols]
  model$lambda_R <- samp_mat[index, lambdaR_cols]
  model$prop_1   <- samp_mat[index, "prop_1"]
  if ("log_alpha_o" %in% colnames(samp_mat)) {
    # alpha_o is derived from log_alpha_o, so set the log-scale node
    model$log_alpha_o <- samp_mat[index, "log_alpha_o"]
    model$mu_eps  <- samp_mat[index, "mu_eps"]
    model$eps_y   <- samp_mat[index, grep("^eps_y\\[", colnames(samp_mat))]
  }
  
  model$calculate(deps)
  with_year_dim(model$N)
}

create_plot <- function(biweek, year, time, cpue, N_med, N_lo, N_hi,
                        tot_med, tot_lo, tot_hi) {
  
  # get plot title
  lab <- paste0("Julian day: ", biweek[time])
  
  # get total label
  total <- paste0("Total: ", round(tot_med[time, year]), 
                  " (", round(tot_lo[time, year]),
                  ", ", round(tot_hi[time, year]), " 95% CrI)")
  
  plot_N <- ggplot() +
    geom_col(aes(x = x, y = round(N_med[time, year, ])), 
             fill = "cornflowerblue") +
    geom_errorbar(aes(x = x,
                      ymin = round(N_lo[time, year, ]), 
                      ymax = round(N_hi[time, year, ])), 
                  width = 2, colour = "grey30") +
    annotate("text", x = max(x), y = max(round(N_hi[, year, ])),
             label = total, hjust = 1, vjust = 1, size = 3.5, 
             colour = "grey20") +
    labs(x = "carapace width (mm)", y = "estimated abundance") +
    scale_y_continuous(limits = c(0, max(round(N_hi[, year, ])))) +
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
  
  return(plot_N + plot_cpue + plot_layout(ncol = 1))
  
}
