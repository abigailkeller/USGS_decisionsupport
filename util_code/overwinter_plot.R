library(tidyverse)
library(bayestestR)
library(viridis)

# read in samples
out <- readRDS("data/posterior_samples/twopulse.rds")

# get years associated with the uploaded data (may have gaps, e.g. 2020,
# 2022, 2023)
years <- as.character(readRDS("data/model_data/years.rds"))

min_size <- 0
max_size <- 110
n <- 22
b <- min_size + c(0:n) * (max_size - min_size) / n
x <- 0.5 * (b[1:n] + b[2:(n + 1)])

# function for getting samples
get_samples <- function(samples, param) {
  out <- unlist(lapply(samples, function(ch) ch[, param]), use.names = FALSE)
  return(out)
}
get_hdi_low <- function(input, ci) {
  out <- as.numeric(hdi(input, ci)[2])
  return(out)
}
get_hdi_high <- function(input, ci) {
  out <- as.numeric(hdi(input, ci)[3])
  return(out)
}

# get winters to plot: eps_y[y] is the winter after the y-th uploaded year,
# and it is only estimated if the next uploaded year is the next calendar
# year (not before a gap, and not after the last year)
eps_names <- grep("^eps_y\\[", colnames(out[[1]]), value = TRUE)
eps_idx <- as.integer(gsub("\\D", "", eps_names))
next_year <- as.integer(years[pmin(eps_idx + 1, length(years))])
keep <- eps_idx < length(years) & next_year == as.integer(years[eps_idx]) + 1
eps_names <- eps_names[keep]
winter_years <- years[eps_idx[keep]]
nwinter <- length(eps_names)
if (nwinter == 0) stop("No consecutive years in the data, so no overwinter survival was estimated")

# get overwinter survival
o_survival <- lapply(eps_names, function(cn) {
  eps    <- get_samples(out, cn)
  mu_eps <- get_samples(out, "mu_eps")
  b_o    <- get_samples(out, "b_o")
  haz    <- exp(mu_eps + eps)
  sapply(x, function(xi) exp(-haz * (xi / 50) ^ (-b_o)))
})

# get overwinter survival summaries
wsurv_summaries <- data.frame(
  year = rep(winter_years, 3),
  stat = c(rep("median", nwinter), rep("lower_ci", nwinter), 
           rep("upper_ci", nwinter))
)
wsurv_summaries <- cbind(wsurv_summaries,
                         as.data.frame(matrix(NA,
                                              nrow = dim(wsurv_summaries)[1],
                                              ncol = length(x))))
colnames(wsurv_summaries)[3:(2 + length(x))] <- x

for (i in seq_len(nwinter)) {
  wsurv_summaries[i, -(1:2)] <- apply(o_survival[[i]], 2, median)
  wsurv_summaries[i + nwinter, -(1:2)] <- apply(o_survival[[i]], 2, 
                                              get_hdi_low, ci = 0.95)
  wsurv_summaries[i + nwinter * 2, -(1:2)] <- apply(o_survival[[i]], 2, 
                                                  get_hdi_high, ci = 0.95)
}

# convert from wide to long
wsurv_summaries_long <- wsurv_summaries %>%
  pivot_longer(cols = ! c("year", "stat"),
               values_to = "p",
               names_to = "size") %>%
  pivot_wider(values_from = "p",
              names_from = "stat")

# get labels
winter_labs <- setNames(paste0(winter_years, " to ",
                               as.integer(winter_years) + 1), winter_years)
winter_cols <- setNames(viridis::viridis(nwinter), winter_years)

# plot
wsurv_plot <- ggplot(data = wsurv_summaries_long) +
  geom_ribbon(aes(x = as.numeric(size),
                  ymin = lower_ci, ymax = upper_ci,
                  fill = as.factor(year)), alpha = 0.4,
              show.legend = c(fill = FALSE)) +
  geom_line(aes(x = as.numeric(size), y = median,
                color = as.factor(year)),
            linewidth = 1, show.legend = c(fill = FALSE)) +
  labs(x = "size (mm)", y = "overwinter survival", color = "year") +
  scale_colour_manual(values = winter_cols, labels = winter_labs) +
  scale_fill_manual(values = winter_cols) +
  theme_minimal() +
  theme(legend.title = element_text(hjust = 0.5))
