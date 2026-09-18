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

# create counts
biweeks <- sort(unique(effort2$biweek))
years <- sort(unique(effort2$year))

counts <- array(data = NA,
                dim = c(length(biweeks),
                        length(years),
                        max(effort2$trap_int),
                        length(size_colnames)),
                dimnames = list(biweeks, years, NULL, size_colnames))

for (i in seq_along(biweeks)) {
  for (t in seq_along(years)) {
    subset <- effort2[effort2$biweek == biweeks[i] & effort2$year == years[t],
                      size_colnames, drop = FALSE]
    if (nrow(subset) > 0) {
      counts[i, t, 1:nrow(subset), ] <- as.matrix(subset)
    }
  }
}

# create ncap
ncap <- array(0, dim = c(length(biweeks), length(years), length(size_colnames)),
              dimnames = list(biweeks, years, size_colnames))

agg <- effort2 %>%
  summarize(across(all_of(size_colnames), sum), .by = c(biweek, year))

for (r in 1:nrow(agg)) {
  bw <- match(agg$biweek[r], biweeks)
  t <- match(agg$year[r], years)
  ncap[bw, t, ] <- as.numeric(agg[r, size_colnames])
}

# total time
totalt <- unname(tapply(effort2$biweek, effort2$year, 
                        function(x) length(unique(x))))

# total obs
totalo <- unclass(table(effort2$biweek, effort2$year))

# shift_up <- function(x) {
#   first <- which(x != 0)[1]
#   if (is.na(first)) return(rep(0, length(x)))
#   c(x[first:length(x)], rep(0, first - 1))
# }
# 
# totalo_shifted <- apply(totalo, 2, shift_up)
# rownames(totalo_shifted) <- NULL
# totalo_shifted <- totalo_shifted[rowSums(totalo_shifted) > 0, , drop = FALSE]

# trap type index
ntrap <- max(effort2$trap_int)

make_index <- function(col) {
  out <- array(NA, dim = c(length(biweeks), length(years), ntrap),
               dimnames = list(biweeks, years, NULL))
  b <- match(effort2$biweek, biweeks)
  t <- match(effort2$year, years)
  out[cbind(b, t, effort2$trap_int)] <- effort2[[col]]
  out
}

m_index <- make_index("minnow")
f_index <- make_index("fukui")
s_index <- make_index("shrimp")

# get biweek index
years <- sort(unique(effort2$year))

bw_list <- lapply(years, 
                  function(y) sort(unique(effort2$biweek[effort2$year == y])))
nmax <- max(lengths(bw_list))

index <- sapply(bw_list, function(v) c(v, rep(NA, nmax - length(v))))

# get year fraction
index_full <- index - 3
index_frac <- index_full * 14 / 365

# get temporary soak days
soak_days <- array(1, dim = dim(m_index))


# save model data
saveRDS(counts, "sample_data/model_data/counts.rds")
saveRDS(ncap, "sample_data/model_data/ncap.rds")
saveRDS(m_index, "sample_data/model_data/m_index.rds")
saveRDS(f_index, "sample_data/model_data/f_index.rds")
saveRDS(s_index, "sample_data/model_data/s_index.rds")
saveRDS(totalo_shifted, "sample_data/model_data/totalo.rds")
saveRDS(totalt, "sample_data/model_data/totalt.rds")
saveRDS(index, "sample_data/model_data/index.rds")
saveRDS(index_frac, "sample_data/model_data/index_frac.rds")
saveRDS(soak_days, "sample_data/model_data/soak_days.rds")
saveRDS(y, "sample_data/model_data/x.rds")
saveRDS(b, "sample_data/model_data/b.rds")
