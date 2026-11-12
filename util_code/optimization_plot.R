library(tidyverse)
library(patchwork)

# command-line args (used by the app): <summary_csv> <options_csv> <output_svg_or_png>
# with no args, plots the test files below and prints the plot
args <- commandArgs(trailingOnly = TRUE)
summary_path <- if (length(args) >= 1) args[1] else "data/posterior_samples/test/optimization_summary_drayton_budget30/optimization_summary.csv"
options_path <- if (length(args) >= 2) args[2] else "data/posterior_samples/test/optimization_summary_drayton_budget30/optimization_options.csv"
output_png <- if (length(args) >= 3) args[3] else NA

data <- read.csv(summary_path, check.names = TRUE)
compare <- read.csv(options_path, check.names = TRUE)

# convert data to long
long <- data |> 
  pivot_longer(cols = -Date,
               values_to = "N",
               names_to = "type")

# get no trap comparison
# (option 1 is the recommended schedule; the Recommended column is left out
# when the search found only one schedule)
notraps <- compare[compare$Option %in% c("1", "No trapping"), ]

# convert dates
MONTHS <- c("Jan","Feb","Mar","Apr","May","Jun",
            "Jul","Aug","Sep","Oct","Nov","Dec")

lvls <- long |>
  dplyr::distinct(Date) |>
  tidyr::separate(Date, c("mon", "day"), sep = " ", remove = FALSE) |>
  dplyr::mutate(mon = factor(mon, MONTHS), day = as.integer(day)) |>
  dplyr::arrange(mon, day) |>
  dplyr::pull(Date)

long$Date <- factor(long$Date, levels = lvls)

# plot schedule
trap_cols <- c(Fukui  = "#4a9974",
               Minnow = "#eb806b",
               Shrimp = "#8452c9")
schedule <- ggplot(long, aes(x = Date, y = N, fill = type)) +
  geom_col(position = position_dodge2(preserve = "single")) +
  scale_fill_manual(values = trap_cols) +
  labs(x = "Date", y = "Number of traps", fill = "Trap type") +
  ggtitle("Optimal trapping schedule") +
  theme_minimal() +
  theme(axis.text.x = element_text(angle = 45, hjust = 1),
        plot.title = element_text(hjust = 0.5))

# abundance
abundance <- ggplot(notraps, 
                    aes(x = Option,
                        y = Expected.abundance.at.start.of.next.season)) +
  geom_errorbar(aes(ymin = Abundance.95..CrI.lower,
                    ymax = Abundance.95..CrI.upper), width = 0.15) +
  geom_point(size = 3) +
  geom_text(aes(y = Abundance.95..CrI.upper,
                label = paste0(round(Expected.abundance.at.start.of.next.season, 1), "\n(",
                               round(Abundance.95..CrI.lower), ", ",
                               round(Abundance.95..CrI.upper), ")")),
            vjust = -0.3, size = 3, lineheight = 0.9) +
  scale_x_discrete(labels = c("Optimal", "No trapping")) +
  scale_y_continuous(expand = expansion(mult = c(0.05, 0.25))) +
  labs(x = "Option", y = "Abundance") +
  ggtitle("Abundance at the start\nof next season") +
  theme_minimal() +
  theme(plot.title = element_text(hjust = 0.5))

right <- plot_spacer() / abundance / plot_spacer() +
  plot_layout(heights = c(1, 4, 1))

p <- schedule + right + 
  plot_layout(nrow = 1, widths = c(2, 1)) &
  theme(plot.margin = margin(5, 15, 5, 15))

# saves the plot as a vector SVG (used by the app, so it stays sharp at any
# size) or, for any other extension, as a 300 dpi image. R's built-in Cairo
# SVG device draws text as shapes, so the SVG looks the same in every browser
# and needs no extra package.
save_plot <- function(path, plot, width, height) {
  if (grepl("\\.svg$", path, ignore.case = TRUE)) {
    grDevices::svg(path, width = width, height = height, bg = "white")
    print(plot)
    invisible(grDevices::dev.off())
  } else {
    ggsave(path, plot, width = width, height = height, dpi = 300, bg = "white")
  }
}

if (is.na(output_png)) {
  print(p)
} else {
  save_plot(output_png, p, width = 10, height = 6)
}
