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
  size_colnames[i] <- paste0("s", b[i], "_", b[i + 1])
}

biweek <- c(59, 76, 91, 106, 121, 137, 152, 167, 182, 198, 213, 229, 
            244, 259, 274, 290, 305, 320, 335)

# read in sample data
catch <- read.csv("sample_data/draytonharbor_catch.csv")
effort <- read.csv("sample_data/draytonharbor_effort.csv")

# date formats
date_format_catch <- "%m/%d/%Y"
date_format_effort <- "%m/%d/%Y"

# convert date
effort$Date <- as.Date(effort$Date, date_format_catch)
catch$Date <- as.Date(catch$Date, date_format_effort)

# remove rows without date
effort <- effort[!is.na(effort$Date), ]
catch <- catch[!is.na(catch$Date), ]

# get relevant columns and rename
colnames(catch) <- c("date", "trap_type", "trap_id", "crab_size")
colnames(effort) <- c("date", "trap_type", "trap_id")

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

# add Julian day
effort$julian_day <- as.POSIXlt(effort$date, format = date_format_effort)$yday
catch$julian_day <- as.POSIXlt(catch$date, format = date_format_effort)$yday

# add year
effort$year <- as.integer(format(as.Date(effort$date, 
                                         format = date_format_effort), "%Y"))
catch$year <- as.integer(format(as.Date(catch$date, 
                                        format = date_format_catch), "%Y"))

# add biweekly index
effort$biweek <- findInterval(as.numeric(effort$julian_day), biweek)

# add dummy variables for trap type and create trap_ID column
effort <- effort %>%
  mutate(shrimp = ifelse(trap_type == "shrimp", 1, 0),
         fukui = ifelse(trap_type == "fukui", 1, 0),
         minnow = ifelse(trap_type == "minnow", 1, 0)) %>%
  unite("ID", c("trap_id", "julian_day", "year"),
        sep = "_", remove = FALSE)


# add unique trap id for biweekly index/year
effort_unique <- effort %>%
  group_by(biweek, year) %>%
  tally()
effort_unique_type <- effort %>%
  group_by(biweek, year, trap_type) %>%
  tally()

# create new empty dataframe
effort2 <- as.data.frame(matrix(NA, nrow = 0, ncol = ncol(effort) + 1))
colnames(effort2) <- c(colnames(effort), "trap_int")

# create new effort df with trap integer for each trap in each biweekly index of trapping
for (i in 1:nrow(effort_unique)) {
  bw <- as.numeric(effort_unique[i, "biweek"])
  yr <- as.numeric(effort_unique[i, "year"])
  
  # subset of original effort data for this biweek/year
  subset <- effort[effort$biweek == bw & effort$year == yr, ]
  
  # sequential index within this combination
  subset <- subset %>% mutate(trap_int = 1:nrow(subset))
  
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
  unite("ID", c("trap_id", "julian_day", "year"),
        sep = "_", remove = FALSE) %>%
  group_by(ID, julian_day, trap_type) %>%
  summarise_at(size_colnames, sum)

# add catch to effort data
effort2 <- left_join(effort2, catch_total, 
                     by = c("ID", "trap_type", "julian_day")) %>%
  replace(is.na(.), 0)

# global occasion axis: every biweek sampled in ANY year
occasions <- sort(unique(effort2$biweek))
n_occ     <- length(occasions)
years     <- sort(unique(effort2$year))
n_year    <- length(years)

effort2$occ  <- match(effort2$biweek, occasions)
effort2$yidx <- match(effort2$year,   years)

# D is now a vector: same calendar date for occasion t in every year
D <- biweek[occasions] / 365 
D <- D - min(D)

# which (t, y) pairs were actually sampled
pairs <- unique(effort2[, c("occ", "yidx")])
pairs <- pairs[order(pairs$yidx, pairs$occ), ]
occ_t <- as.integer(pairs$occ)
occ_y <- as.integer(pairs$yidx)
n_pair <- nrow(pairs)

# the complement — occasions with no sampling
all_pairs <- expand.grid(occ = 1:n_occ, yidx = 1:n_year)
un <- all_pairs[!paste(all_pairs$occ, all_pairs$yidx) %in%
                  paste(occ_t, occ_y), ]
un_t <- as.integer(un$occ); un_y <- as.integer(un$yidx)
n_un <- nrow(un)

# map every row of effort2 to its pair index
effort2$pair <- match(paste(effort2$occ, effort2$yidx),
                      paste(occ_t, occ_y))
stopifnot(!any(is.na(effort2$pair)))

# renumber traps within each pair
effort2 <- effort2 %>%
  arrange(pair) %>%
  mutate(trap_j = row_number(), .by = pair)

totalo <- as.integer(tabulate(effort2$pair, nbins = n_pair))
ntrap  <- max(totalo)
nsizes <- length(size_colnames)

# ---- trap-type indicators and soak days: [pair, trap] ----
make_index <- function(col) {
  out <- matrix(0, nrow = n_pair, ncol = ntrap)
  out[cbind(effort2$pair, effort2$trap_j)] <- effort2[[col]]
  out
}
m_index <- make_index("minnow")
f_index <- make_index("fukui")
s_index <- make_index("shrimp")

soak_days <- matrix(1, nrow = n_pair, ncol = ntrap)
# if you have real soak days in effort2:
# soak_days <- matrix(1, n_pair, ntrap)
# soak_days[cbind(effort2$pair, effort2$trap_j)] <- effort2$soak

# ---- catch: [pair, trap, size] ----
C <- array(0, dim = c(n_pair, ntrap, nsizes),
           dimnames = list(NULL, NULL, size_colnames))
idx <- cbind(effort2$pair, effort2$trap_j)
for (k in seq_len(nsizes)) {
  C[cbind(idx, k)] <- effort2[[size_colnames[k]]]
}

# ---- total catch
C_T <- array(0L, dim = c(n_occ, n_year, nsizes),
             dimnames = list(NULL, years, size_colnames))

for (j in 1:n_pair) {
  C_T[occ_t[j], occ_y[j], ] <- apply(C[j, 1:totalo[j], , drop = FALSE], 3, sum)
}

# save model data
saveRDS(C, "sample_data/model_data/counts.rds")
saveRDS(C_T, "sample_data/model_data/ncap.rds")
saveRDS(m_index, "sample_data/model_data/m_index.rds")
saveRDS(f_index, "sample_data/model_data/f_index.rds")
saveRDS(s_index, "sample_data/model_data/s_index.rds")
saveRDS(n_occ, "sample_data/model_data/n_occ.rds")
saveRDS(n_year, "sample_data/model_data/n_year.rds")
saveRDS(n_pair, "sample_data/model_data/n_pair.rds")
saveRDS(occ_t, "sample_data/model_data/occ_t.rds")
saveRDS(occ_y, "sample_data/model_data/occ_y.rds")
saveRDS(totalo, "sample_data/model_data/totalo.rds")
saveRDS(D, "sample_data/model_data/D.rds")
saveRDS(soak_days, "sample_data/model_data/soak_days.rds")
saveRDS(y, "sample_data/model_data/x.rds")
saveRDS(b, "sample_data/model_data/b.rds")
