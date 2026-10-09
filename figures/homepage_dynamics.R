library(tidyverse)
library(patchwork)

plot_adult <- ggplot() +
  geom_col(aes(x = c("Year 1", "Year 2", "Year 3"), 
               y = c(1000, 3000, 2500)), 
           fill = "cornflowerblue") +
  geom_errorbar(aes(x = c("Year 1", "Year 2", "Year 3"),
                    ymin = c(300, 2600, 2400), 
                    ymax = c(1700, 3400, 2600)), 
                width = 0.3, colour = "grey30") +
  labs(x = "", y = "Abundance") +
  ggtitle("Adult abundance") +
  theme_minimal() + 
  theme(axis.text.y = element_blank(),
        plot.title = element_text(hjust = 0.5))

plot_recruit <- ggplot() +
  geom_col(aes(x = c("Year 1", "Year 2", "Year 3"), 
               y = c(2000, 100, 4000)), 
           fill = "goldenrod") +
  geom_errorbar(aes(x = c("Year 1", "Year 2", "Year 3"),
                    ymin = c(700, 60, 3300), 
                    ymax = c(3300, 140, 4700)), 
                width = 0.3, colour = "grey30") +
  labs(x = "", y = "Abundance") +
  ggtitle("Recruit abundance") +
  theme_minimal() + 
  theme(axis.text.y = element_blank(),
        plot.title = element_text(hjust = 0.5))

plot_timing <- ggplot() +
  geom_col(aes(x = c("April", "June"), 
               y = c(0.1, 0.9)), 
           fill = "gray") +
  geom_errorbar(aes(x = c("April", "June"),
                    ymin = c(0.05, 0.85), 
                    ymax = c(0.15, 0.95)), 
                width = 0.3, colour = "grey30") +
  scale_y_continuous(breaks = c(0, 1), limits = c(0, 1)) +
  labs(x = "", y = "Proportion") +
  ggtitle("Recruit timing") +
  theme_minimal() + 
  theme(plot.title = element_text(hjust = 0.5))


dynamics_plot <- plot_adult + plot_recruit + plot_timing + plot_layout(ncol = 1)

ggsave("figures/homepage_dynamics.svg", dynamics_plot,
       width = 2.98, height = 4.42)
