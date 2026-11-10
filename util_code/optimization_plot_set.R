library(tidyverse)
library(patchwork)

# command-line args (used by the app): <options_csv> <output_png>
# with no args, plots the test file below and prints the plot
args <- commandArgs(trailingOnly = TRUE)
options_path <- if (length(args) >= 1) args[1] else "data/posterior_samples/test/optimization_summary_drayton_budget30/optimization_options.csv"
output_png <- if (length(args) >= 2) args[2] else NA

data <- read.csv(options_path, check.names = TRUE)

parse_schedule <- function(sched, id = seq_along(sched), year = 2024) {
  out <- lapply(seq_along(sched), function(i) {
    blocks <- str_split(sched[i], ";")[[1]] |> str_trim()
    blocks <- blocks[str_detect(blocks, ":")]
    
    do.call(rbind, lapply(blocks, function(b) {
      trap <- str_trim(str_extract(b, "^[^:]+"))
      rest <- str_remove(b, "^[^:]+:")
      m <- str_match_all(rest, "(\\d+)\\s+on\\s+([A-Za-z]{3})\\s+(\\d+)")[[1]]
      if (!nrow(m)) return(NULL)
      data.frame(id    = id[i],
                 trap  = trap,
                 month = m[,3],
                 day   = as.integer(m[,4]),
                 date  = paste(m[,3], m[,4]),      # "Oct 1"
                 n     = as.integer(m[,2]),
                 stringsAsFactors = FALSE)
    }))
  })
  bind_rows(out)
}

# get schedule
long <- parse_schedule(data$Schedule)


# reorder dates
MONTHS <- c("Jan", "Feb", "Mar", "Apr", "May", "Jun",
            "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
long <- long |> 
  mutate(month = factor(month, levels = MONTHS)) |>
  arrange(id, month, day)
lvls <- long |> distinct(month, day) |> arrange(month, day) |>
  mutate(lab = paste(month, day)) |> pull(lab)
long$date <- factor(long$date, levels = lvls)

# plot schedule
title <- ifelse(length(unique(long$id)) > 1,
                "Optimal trapping schedules",
                "Optimal trapping schedule")
trap_cols <- c(Fukui  = "#4a9974",
               Minnow = "#eb806b",
               Shrimp = "#8452c9")
opt_label <- function(x) {
  x <- as.character(x)
  ifelse(x == "1", "Optimal",
         ifelse(grepl("^[0-9]+$", x), paste("Option", x), x))
}
schedule <- ggplot(long, aes(x = date, y = n, fill = trap)) +
  geom_col(position = position_dodge2(preserve = "single")) +
  scale_fill_manual(values = trap_cols) +
  facet_grid(id ~ ., 
             labeller = labeller(id = opt_label)) +
  labs(x = "Date", y = "Number of traps", fill = "Trap type") +
  ggtitle(title) + 
  theme_minimal() +
  theme(plot.title = element_text(hjust = 0.5))

# abundance
abundance <- ggplot(data, aes(x = Option,
                              y = Expected.abundance.at.start.of.next.season)) +
  geom_errorbar(aes(ymin = Abundance.95..CrI.lower,
                    ymax = Abundance.95..CrI.upper), width = 0.15) +
  geom_point(size = 3) +
  scale_x_discrete(labels = opt_label) +
  geom_text(aes(y = Abundance.95..CrI.upper,
                label = paste0(round(Expected.abundance.at.start.of.next.season, 1), "\n(",
                               round(Abundance.95..CrI.lower), ", ",
                               round(Abundance.95..CrI.upper), ")")),
            vjust = -0.3, size = 3, lineheight = 0.9) +
  scale_y_continuous(expand = expansion(mult = c(0.05, 0.25))) +
  labs(x = "Option", y = "Abundance") +
  ggtitle("Abundance at the start\nof next season") +
  theme_minimal() +
  theme(plot.title = element_text(hjust = 0.5))

right <- plot_spacer() / abundance / plot_spacer() +
  plot_layout(heights = c(1, 4, 1))

p <- schedule + right + plot_layout(nrow = 1) &
  theme(plot.margin = margin(5, 15, 5, 15))

if (is.na(output_png)) {
  print(p)
} else {
  # one facet row per option, so the height grows with the number of options
  n_options <- length(unique(long$id))
  ggsave(output_png, p, width = 11, height = max(4.5, 1.5 + 1.6 * n_options),
         dpi = 150, bg = "white")
}
