library(tidyverse)
library(patchwork)

source("util_code/constants.R")
source("util_code/model_code_2pulse.R")

apr <- 3
july <- 9
oct <- 15

y <- 2

N_apr <- unlist(result$N_med[[apr]][[y]])
N_july <- unlist(result$N_med[[july]][[y]])
N_oct <- unlist(result$N_med[[oct]][[y]])

get_obs <- function(N, totalo, f_index, s_index, m_index) {
  hazard <- calc_hazard(
    totalo, n_size = 22, h_F_max = 0.0001784, h_F_k = 0.45977, h_F_0 = 35.34, 
    h_S_max = 0.003937, h_S_k = 0.3437, h_S_0 = 46.41,
    h_M_max = 0.0003912, h_M_A = 45.12, h_M_sigma = 6.449, 
    f_index, s_index, m_index,
    soak_days = rep(1, totalo), x = x)
  
  p <- calc_prob(totalo, n_size = 22, hazard)
  
  p_C <- calc_cond_prob(totalo, n_size = 22, hazard)
  
  C_T <- rep(NA, 22)
  alpha_D <- matrix(NA, nrow = totalo, ncol = 22)
  C <- matrix(NA, nrow = totalo, ncol = 22)
  
  for (k in 1:22) {
    
    C_T[k] <- rbinom(1, size = round(N[k]), prob = p[k])
    
    alpha_D[, k] <- p_C[, k] * 25.19172
    
    C[, k] <- rdirchmulti(1, alpha = alpha_D[, k],
                          size = C_T[k])
  }
  
  return(C)
} 

totalo_apr <- 500
f_index_apr = c(rep(1, totalo_apr * 0.45), rep(0, totalo_apr * 0.55))
m_index_apr = c(rep(0, totalo_apr * 0.45), rep(1, totalo_apr * 0.45), rep(0, totalo_apr * 0.1))
s_index_apr = c(rep(0, totalo_apr * 0.9), rep(1, totalo_apr * 0.1))
C_apr <- get_obs(N = N_apr, totalo = totalo_apr, 
                 f_index = f_index_apr, 
                 m_index = m_index_apr, 
                 s_index = s_index_apr)

totalo_july <- 200
f_index_july = c(rep(1, totalo_july * 0.45), rep(0, totalo_july * 0.55))
m_index_july = c(rep(0, totalo_july * 0.45), rep(1, totalo_july * 0.45), rep(0, totalo_july * 0.1))
s_index_july = c(rep(0, totalo_july * 0.9), rep(1, totalo_july * 0.1))
C_july <- get_obs(N = N_july, totalo = totalo_july, 
                  f_index = f_index_july, 
                  m_index = m_index_july, 
                  s_index = s_index_july)

totalo_oct <- 300
f_index_oct = c(rep(1, totalo_oct * 0.45), rep(0, totalo_oct * 0.55))
m_index_oct = c(rep(0, totalo_oct * 0.45), rep(1, totalo_oct * 0.45), rep(0, totalo_oct * 0.1))
s_index_oct = c(rep(0, totalo_oct * 0.9), rep(1, totalo_oct * 0.1))
C_oct <- get_obs(N = N_oct, totalo = totalo_oct, 
                 f_index = f_index_oct, 
                 m_index = m_index_oct, 
                 s_index = s_index_oct)

total <- data.frame(
  size = c(1:22, 1:22, 1:22, 1:22, 1:22, 1:22, 1:22, 1:22, 1:22),
  type = c(rep("fukui", 22), rep("minnow", 22), rep("shrimp", 22),
           rep("fukui", 22), rep("minnow", 22), rep("shrimp", 22),
           rep("fukui", 22), rep("minnow", 22), rep("shrimp", 22)),
  count = c(colSums(C_apr[f_index_apr == 1, ]), colSums(C_apr[m_index_apr == 1, ]),
            colSums(C_apr[s_index_apr == 1, ]), 
            colSums(C_july[f_index_july == 1, ]), colSums(C_july[m_index_july == 1, ]),
            colSums(C_july[s_index_july == 1, ]), 
            colSums(C_oct[f_index_oct == 1, ]), colSums(C_oct[m_index_oct == 1, ]),
            colSums(C_oct[s_index_oct == 1, ])),
  month = c(rep("April", 66), rep("July", 66), rep("October", 66))
)

plot_catch <- ggplot(data = total) +
  geom_col(aes(x = size, y = count, fill = type)) +
  facet_grid(type ~ month) +
  labs(x = "crab size", y = "count", fill = "trap type") +
  scale_fill_manual(values = c("#4a9974", "#eb806b", "#8452c9")) +
  theme_minimal() +
  ggtitle("Size-structured catch") +
  theme(axis.text = element_blank(),
        strip.text.y = element_blank(),
        plot.title = element_text(hjust = 0.5))

effort <- data.frame(
  month = c(rep("April", 3), rep("July", 3), rep("October", 3)),
  type = c("fukui", "minnow", "shrimp", "fukui", "minnow", "shrimp",
           "fukui", "minnow", "shrimp"),
  count = c(sum(f_index_apr), sum(m_index_apr), sum(s_index_apr), 
            sum(f_index_july), sum(m_index_july), sum(s_index_july),
            sum(f_index_oct), sum(m_index_oct), sum(s_index_oct))
)

plot_effort <- ggplot(effort) +
  geom_col(aes(x = month, y = count, fill = type),
           position = "dodge") +
  labs(x = "month", y = "number\nof traps", fill = "trap type") +
  scale_fill_manual(values = c("#4a9974", "#eb806b", "#8452c9")) +
  ggtitle("Effort") +
  theme_minimal() +
  theme(axis.text.y = element_blank(),
        plot.title = element_text(hjust = 0.5))

final_plot <- plot_catch + plot_effort + plot_layout(ncol = 1, 
                                                     guides = "collect",
                                                     heights = c(2, 1)) &
  theme(legend.position = "bottom",
        legend.key.size = unit(0.3, "cm"))

ggsave("figures/homepage_catch_effort.svg", final_plot,
       width = 2.98, height = 4.42)

## cpue

total <- total %>% mutate(cpue = NA)

for (i in 1:nrow(total)) {
  
  index <- which(effort$month == total[i, "month"] &
                   effort$type == total[i, "type"])
  
  total[i, "cpue"] <- total[i, "count"] / effort[index, "count"]
  
}

cpue_plot <- ggplot(data = total) +
  geom_col(aes(x = size, y = cpue, fill = type)) +
  facet_grid(type ~ month, scales = "free_y") +
  labs(x = "crab size", y = "CPUE", fill = "trap type") +
  scale_fill_manual(values = c("#4a9974", "#eb806b", "#8452c9")) +
  theme_minimal() +
  ggtitle("Size-structured CPUE") +
  theme(axis.text = element_blank(),
        strip.text.y = element_blank(),
        plot.title = element_text(hjust = 0.5)) +
  theme(legend.position = "bottom")

ggsave("figures/homepage_cpue.svg", cpue_plot,
       width = 2.98, height = 3.2)
