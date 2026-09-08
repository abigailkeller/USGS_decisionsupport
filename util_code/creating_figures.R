library(tidyverse)


# create parameters for IPM mesh
min.size <- 0
max.size <- 110
nsize <- 22 # number of cells in the discretized kernel
b <- min.size + c(0:nsize) * (max.size - min.size) / nsize 
y <- 0.5 * (b[1:nsize] + b[2:(nsize + 1)]) # mesh points (midpoints of the cells)

# get size column names
size_colnames <- rep(NA, length(b) - 1)
for(i in 1:(length(b) - 1)){
  size_colnames[i] <- paste0('s', b[i], '_', b[i + 1])
}

biweek <- c(59, 76, 91, 106, 121, 137, 152, 167, 182, 198, 213, 229, 
            244, 259, 274, 290, 305, 320, 335)

# read in sample data
catch <- read.csv("sample_data/DraytonHarbor_2021_catch.csv")
effort <- read.csv("sample_data/DraytonHarbor_2021_effort.csv")

# date formats
date_format_catch <- '%m/%d/%Y'
date_format_effort <- '%m/%d/%Y'

# convert date
# DH2021_effort$Date_Retrieved <- as.Date(DH2021_effort$Date_Retrieved,'%m/%d/%Y')
# DH2021_effort$Date_Deployed <- as.Date(DH2021_effort$Date_Deployed,'%m/%d/%Y')
effort$Date_Checked <- as.Date(effort$Date_Checked, date_format_catch)
catch$Date_Observed <- as.Date(catch$Date_Observed, date_format_effort)

# get relevant columns and rename
catch <- catch[, c("Date_Observed", "CW_mm", "Trap_Type", "Trap_Number")]
colnames(catch) <- c("date", "crab_size", "trap_type", "trap_id")
effort <- effort[, c("Date_Checked", "Trap_Type", "Trap_Number", "CAMA_Total")]
colnames(effort) <- c("date", "trap_type", "trap_id", "crab_count")

# convert to lower and remove spaces
catch <- catch %>% 
  mutate(across(c(trap_type, trap_id), tolower)) %>% 
  mutate(across(c(trap_type, trap_id),  ~ gsub(" ", "", .x)))
effort <- effort %>% 
  mutate(across(c(trap_type, trap_id), tolower)) %>% 
  mutate(across(c(trap_type, trap_id),  ~ gsub(" ", "", .x)))

# keep only fukui, minnow, shrimp
catch <- catch[catch$trap_type %in% c("minnow", "fukui", "shrimp"), ]
effort <- effort[effort$trap_type %in% c("minnow", "fukui", "shrimp"), ]

# remove effort data where crab count is NA, negative
cc <- as.numeric(effort$crab_count)
effort <- effort[!is.na(cc) & cc >= 0, ]

# add Julian day
effort$julian_day <- as.POSIXlt(effort$date, format = date_format_effort)$yday
catch$julian_day <- as.POSIXlt(catch$date, format = date_format_effort)$yday

# add biweekly index
for (i in 1:length(effort$julian_day)){
  index <- tail(biweek[as.numeric(effort[i, 'julian_day']) > biweek], 1)
  effort[i, 'biweek'] <- which(index == biweek)
}

# add dummy variables for trap type and create trap_ID column
effort <- effort %>%
  mutate(shrimp = ifelse(trap_type == 'shrimp', 1, 0),
         fukui = ifelse(trap_type == 'fukui', 1, 0),
         minnow = ifelse(trap_type == 'minnow', 1, 0)) %>%
  unite('ID', c('trap_id', 'julian_day'),
        sep = '_', remove = FALSE)


# add unique trap id for biweekly index
effort_unique <- effort %>%
  group_by(biweek) %>%
  tally()
effort_unique_type <- effort %>%
  group_by(biweek, trap_type) %>%
  tally()

# create new empty dataframe
effort2 <- as.data.frame(matrix(NA, nrow = 0, ncol = ncol(effort) + 1))
colnames(effort2) <- c(colnames(effort), 'trap_int')

# create new effort df with trap integer for each trap in each biweekly index of trapping
for (i in 1:length(effort_unique$biweek)) {
  # make subset of original effort data
  subset <- effort[c(effort$biweek == as.numeric(effort_unique[i, 'biweek'])), ]
  # find count for unique combination
  count <- effort_unique[c(effort_unique$biweek == as.numeric(effort_unique[i, 'biweek'])), 'n']
  # add count to df
  subset <- subset %>%
    mutate(trap_int = 1:as.integer(count))
  
  # rbind with empty df
  effort2 <- rbind(effort2, subset)
}


# convert catch size to numeric
catch$crab_size <- as.numeric(catch$crab_size)

# add size ID to catch data
for (i in 1:(length(b) - 1)){
  catch[[size_colnames[i]]] <- ifelse(catch$crab_size >= b[i] & 
                                        catch$crab_size < b[i + 1], 1, 0)
}

# add trap ID to catch data
catch_total <- catch %>%
  unite('ID', c('trap_id','julian_day'),
        sep = '_', remove = FALSE) %>%
  group_by(ID, julian_day, trap_type) %>%
  summarise_at(size_colnames, sum)

# add catch to effort data
effort2 <- left_join(effort2, catch_total, 
                     by = c('ID', 'trap_type', 'julian_day')) %>%
  replace(is.na(.), 0)

# create counts
counts <- array(data = NA,
                dim = c(length(unique(effort2$biweek)),
                        max(effort2$trap_int),
                        length(y)))

for (i in 1:length(unique(effort2$biweek))) {
  time <- unique(effort2$biweek)[i]
  subset <- effort2[effort2$biweek == time, size_colnames]
  counts[i, 1:dim(subset)[1], ] <- as.matrix(subset)
}

# create ncap
ncap <- effort2 %>% 
  group_by(biweek) %>% 
  summarize(across(all_of(size_colnames), ~sum(.), .names = "{.col}"))
ncap <- as.data.frame(ncap)
rownames(ncap) <- ncap[, 1]
ncap <- ncap[, -1]

# create julian day index
index <- unique(effort2$biweek)

# total time
totalt <- length(unique(effort2$biweek))

# total obs
totalo <- as.vector(table(effort2$biweek))

# trap type binary indicators
# m
m_index <- effort2 %>% 
  dplyr::select(biweek, trap_int, minnow) %>% 
  pivot_wider(id_cols = biweek,
              names_from = trap_int,
              values_from = minnow)
m_index <- as.data.frame(m_index)
rownames(m_index) <- m_index[, 1]
m_index <- m_index[, -1]
# f
f_index <- effort2 %>% 
  dplyr::select(biweek, trap_int, fukui) %>% 
  pivot_wider(id_cols = biweek,
              names_from = trap_int,
              values_from = fukui)
f_index <- as.data.frame(f_index)
rownames(f_index) <- f_index[, 1]
f_index <- f_index[, -1]
# s
s_index <- effort2 %>% 
  dplyr::select(biweek, trap_int, shrimp) %>% 
  pivot_wider(id_cols = biweek,
              names_from = trap_int,
              values_from = shrimp)
s_index <- as.data.frame(s_index)
rownames(s_index) <- s_index[, 1]
s_index <- s_index[, -1]


###########
# figures #
###########

# catch over time
trap_cols <- c(fukui = "violet",
               minnow = "darkviolet",
               shrimp = "goldenrod")

ggplot() +
  geom_point(data = catch,
             aes(x = date, y = as.numeric(crab_size),
                 color = trap_type)) +
  scale_color_manual(values = trap_cols) +
  labs(x = "date", y = "size (mm)", color = "trap type") +
  theme_minimal()

# cpue over time
jday <- biweek
count_sum <- effort2 %>%
  group_by(biweek, trap_type) %>%
  summarise(total_catch = sum(as.numeric(crab_count)))
cpue <- left_join(effort_unique_type, count_sum, 
                  by = c("biweek", "trap_type")) %>%
  mutate(cpue = total_catch / n) %>%
  mutate(jday = jday[biweek])

ggplot(data = cpue) +
  geom_point(aes(x = jday, y = cpue, color = trap_type)) +
  geom_line(aes(x = jday, y = cpue, color = trap_type)) +
  labs(x = "julian day", y = "CPUE (crabs/trap)", color = "trap type") +
  scale_color_manual(values = trap_cols) +
  theme_minimal()

# effort over time
ggplot(data = cpue) +
  geom_point(aes(x = jday, y = n, color = trap_type)) +
  geom_line(aes(x = jday, y = n, color = trap_type)) +
  labs(x = "julian day", y = "number of traps", color = "trap type") +
  scale_color_manual(values = trap_cols) +
  theme_minimal()

# catch over time
ggplot(data = cpue) +
  geom_point(aes(x = jday, y = total_catch, color = trap_type)) +
  geom_line(aes(x = jday, y = total_catch, color = trap_type)) +
  labs(x = "julian day", y = "crab count", color = "trap type") +
  scale_color_manual(values = trap_cols) +
  theme_minimal()
