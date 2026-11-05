library(tidyverse)
library(patchwork)

data <- read.csv("data/posterior_samples/test/optimization_summary_drayton_budget30/optimization_options.csv")

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
schedule <- ggplot(long, aes(x = date, y = n, fill = trap)) +
  geom_col(position = position_dodge2(preserve = "single")) +
  facet_grid(id ~ ., 
             labeller = labeller(id = function(x) paste("Option", x))) +
  labs(x = "date", y = "number of traps", fill = "trap type") +
  ggtitle(title) + 
  theme_minimal() +
  theme(plot.title = element_text(hjust = 0.5))

# abundance
abundance <- ggplot(data, aes(x = Option, 
                              y = Expected.abundance.at.start.of.next.season)) +
  geom_errorbar(aes(ymin = Abundance.95..CrI.lower, 
                    ymax = Abundance.95..CrI.upper), width = 0.15) +
  geom_point(size = 3) +
  labs(x = "Option", y = "Abundance") +
  ggtitle("Abundance at the start\nof next season") +
  theme_minimal() +
  theme(plot.title = element_text(hjust = 0.5))

right <- plot_spacer() / abundance / plot_spacer() +
  plot_layout(heights = c(1, 2, 1))

schedule + right + plot_layout(nrow = 1)
