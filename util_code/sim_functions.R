# parameter nodes that are set from each posterior draw before simulating;
# the multi-year model also carries adults between years through overwinter
# survival
sim_param_nodes <- function(multiyear) {
  nodes <- c("h_F_max", "h_S_max", "h_M_max", "lambda_A", "lambda_R", "prop_1",
             "log_mu_A", "sigma_A")
  if (multiyear) {
    nodes <- c(nodes, "mu_eps", "z_y", "b_o")
  }
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
  model$lambda_A <- samp_mat[index, lambdaA_cols]
  model$lambda_R <- samp_mat[index, lambdaR_cols]
  # these are single values in some model versions and indexed by year or
  # by block of consecutive years in others, so match either form
  for (nm in c("h_F_max", "h_S_max", "h_M_max", "prop_1", "log_mu_A",
               "sigma_A")) {
    cols <- grep(paste0("^", nm, "(\\[|$)"), colnames(samp_mat), value = TRUE)
    model[[nm]] <- unname(samp_mat[index, cols])
  }
  if ("mu_eps" %in% colnames(samp_mat)) {
    model$mu_eps  <- samp_mat[index, "mu_eps"]
    # eps_y is derived from z_y and sigma_o, so set z_y; it only exists for
    # modelled winters, so set those elements by their year index
    z_cols <- grep("^z_y\\[", colnames(samp_mat), value = TRUE)
    z_y <- model$z_y
    z_y[as.integer(gsub("\\D", "", z_cols))] <- samp_mat[index, z_cols]
    model$z_y     <- z_y
    model$b_o     <- samp_mat[index, "b_o"]
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
