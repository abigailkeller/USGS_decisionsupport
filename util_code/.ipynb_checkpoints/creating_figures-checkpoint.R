
# create parameters for IPM mesh
min.size <- 0
max.size <- 110
nsize <- 22 #number of cells in the discretized kernel
b=min.size+c(0:nsize)*(max.size-min.size)/nsize #boundary points (the edges of the cells defining the kernel)
y=0.5*(b[1:nsize]+b[2:(nsize+1)]) # mesh points (midpoints of the cells)

# get size column names
size_colnames <- rep(NA,length(b)-1)
for(i in 1:(length(b)-1)){
  size_colnames[i] <- paste0('s',b[i],'_',b[i+1])
}

biweek <- c(59,76,91,106,121,137,152,167,182,198,213,229,244,259,274,290,305,320,335)


# convert date
DH2021_effort$Date_Retrieved <- as.Date(DH2021_effort$Date_Retrieved,'%m/%d/%Y')
DH2021_effort$Date_Deployed <- as.Date(DH2021_effort$Date_Deployed,'%m/%d/%Y')
DH2021_effort$Date_Checked <- as.Date(DH2021_effort$Date_Checked,'%m/%d/%Y')
DH2021_catch$Date_Observed <- as.Date(DH2021_catch$Date_Observed,'%m/%d/%Y')

# remove traps that were not retrieved
DH2021_effort <- DH2021_effort[!is.na(DH2021_effort$Date_Retrieved),]

# remove spaces in data
DH2021_catch$Trap_Number <- gsub(" ","",DH2021_catch$Trap_Number)
DH2021_effort$Trap_Number <- gsub(" ","",DH2021_effort$Trap_Number)

# remove traps without lat/lon
DH2021_catch <- DH2021_catch[!is.na(DH2021_catch$Latitude),]

# standard shrimp trap type
DH2021_effort$Trap_Type[DH2021_effort$Trap_Type == 'Shrimp - 1/2"'] <- 'Shrimp'
DH2021_catch$Trap_Type[DH2021_catch$Trap_Type == 'Shrimp - 1/2"'] <- 'Shrimp'

# add Julian day
DH2021_effort$julian_day <- as.POSIXlt(DH2021_effort$Date_Checked,format='%m/%d/%Y')$yday

# remove traps that were not checked
DH2021_effort <- DH2021_effort[!is.na(DH2021_effort$julian_day),]

# remove data from 'Central'
DH2021_effort <- DH2021_effort[!DH2021_effort$Site_Name=='Central',]
DH2021_catch <- DH2021_catch[!DH2021_catch$Site_Name=='Central',]

# remove grid survey traps in effort
DH2021_gridsurvey <- DH2021_effort[c(DH2021_effort$julian_day==235|
                                       DH2021_effort$julian_day==236),]
DH2021_effort <- DH2021_effort[!c(DH2021_effort$julian_day==235|
                                    DH2021_effort$julian_day==236),]
# add back Dakota Creek grid survey
DH2021_effort <- rbind(DH2021_effort,
                       DH2021_gridsurvey[DH2021_gridsurvey$Site_Name=='Dakota Creek',])

# add biweekly index
for(i in 1:length(DH2021_effort$julian_day)){
  index <- tail(biweek[as.numeric(DH2021_effort[i,'julian_day']) > biweek],1)
  DH2021_effort[i,'biweek'] <- which(index == biweek)
}

# add dummy variables for trap type and create trap_ID column
DH2021_effort <- DH2021_effort %>%
  mutate(Shrimp = ifelse(Trap_Type=='Shrimp',1,0),
         Fukui = ifelse(Trap_Type=='Fukui',1,0),
         Minnow = ifelse(Trap_Type=='Minnow',1,0)) %>%
  unite('ID',c('Trap_Number','julian_day'),
        sep='_',remove=FALSE)

# keep only core sites
DH2021_effort <- DH2021_effort[DH2021_effort$Site_Name%in%c('California Creek',
                                                            'Dakota Creek',
                                                            'North'),]

# ggplot()+
#   geom_point(data=DH2021_effort,
#              aes(x=as.numeric(Longitude),
#                  y=as.numeric(Latitude),color=Site_Name))

# add unique site id for subsites
DH2021_subsite_unique <- DH2021_effort %>%
  group_by(Site_Name) %>%
  summarize(lat=median(as.numeric(Latitude)),
            lon=median(as.numeric(Longitude)),
            minnow_total=sum(Minnow),
            fukui_total=sum(Fukui),
            shrimp_total=sum(Shrimp)) %>% 
  mutate(subsite_index=1:n())
DH2021_shrimp_subsites <- DH2021_subsite_unique[DH2021_subsite_unique$shrimp_total>0,]$subsite_index
DH2021_minnow_subsites <- DH2021_subsite_unique[DH2021_subsite_unique$minnow_total>0,]$subsite_index
DH2021_fukui_subsites <- DH2021_subsite_unique[DH2021_subsite_unique$fukui_total>0,]$subsite_index

# add unique subsite id to effort
DH2021_effort <- left_join(DH2021_effort,DH2021_subsite_unique,by='Site_Name')

# add unique trap id for biweekly index
DH2021_effort_unique <- DH2021_effort %>%
  group_by(biweek) %>%
  tally()

# create new empty dataframe
DH2021_effort2 <- as.data.frame(matrix(NA,nrow=0,ncol=ncol(DH2021_effort)+1))
colnames(DH2021_effort2) <- c(colnames(DH2021_effort),'trap_int')

# create new effort df with trap integer for each trap in each biweekly index of trapping
for(i in 1:length(DH2021_effort_unique$biweek)){
  #make subset of original effort data
  subset <- DH2021_effort[c(DH2021_effort$biweek==as.numeric(DH2021_effort_unique[i,'biweek'])),]
  #find count for unique combination
  count <- DH2021_effort_unique[c(DH2021_effort_unique$biweek==as.numeric(DH2021_effort_unique[i,'biweek'])),'n']
  #add count to df
  subset <- subset %>%
    mutate(trap_int=1:as.integer(count))
  
  #rbind with empty df
  DH2021_effort2 <- rbind(DH2021_effort2,subset)
}


DH2021_effort2$Soak_days <- 1

# keep only crabs caught in fukui, minnow, and shrimp traps
DH2021_catch <- DH2021_catch[c(DH2021_catch$Trap_Type=='Fukui'|
                                 DH2021_catch$Trap_Type=='Shrimp'|
                                 DH2021_catch$Trap_Type=='Minnow'),]

# convert catch size to numeric
DH2021_catch$CW_mm <- as.numeric(DH2021_catch$CW_mm)

# add size ID to catch data
for(i in 1:(length(b)-1)){
  DH2021_catch[[size_colnames[i]]] <- ifelse(DH2021_catch$CW_mm>=b[i] & DH2021_catch$CW_mm < b[i+1],1,0)
}

# add julian day to catch data
DH2021_catch$julian_day <- as.POSIXlt(DH2021_catch$Date_Observed,format='%m/%d/%Y')$yday

# remove grid survey traps
DH2021_catch_gridsurvey <- DH2021_catch[c(DH2021_catch$julian_day==235|
                                            DH2021_catch$julian_day==236),]
DH2021_catch <- DH2021_catch[!c(DH2021_catch$julian_day==235|
                                  DH2021_catch$julian_day==236),]
# add back Dakota Creek grid DH2021_catch
DH2021_catch <- rbind(DH2021_catch,
                      DH2021_catch_gridsurvey[DH2021_catch_gridsurvey$Site_Name=='Dakota Creek',])


#add trap ID to catch data
DH2021_catch_total <- DH2021_catch %>%
  unite('ID',c('Trap_Number','julian_day'),
        sep='_',remove=FALSE) %>%
  group_by(ID,julian_day,Trap_Type) %>%
  summarise_at(size_colnames,sum)

#add catch to effort data
DH2021_effort2 <- left_join(DH2021_effort2,DH2021_catch_total,by=c('ID','Trap_Type')) %>%
  replace(is.na(.),0)

# create counts
counts_DH2021 <- array(data=NA,
                       dim=c(length(unique(DH2021_effort2$biweek)),
                             max(DH2021_effort2$trap_int),
                             length(y)))
for(i in 1:length(unique(DH2021_effort2$biweek))){
  time <- unique(DH2021_effort2$biweek)[i]
  subset <- DH2021_effort2[DH2021_effort2$biweek==time,size_colnames]
  counts_DH2021[i,1:dim(subset)[1],] <- as.matrix(subset)
}

# create ncap
ncap_DH2021 <- DH2021_effort2 %>% 
  group_by(biweek) %>% 
  summarize(across(all_of(size_colnames), ~sum(.), .names = "{.col}"))
ncap_DH2021 <- as.data.frame(ncap_DH2021)
rownames(ncap_DH2021) <- ncap_DH2021[,1]
ncap_DH2021 <- ncap_DH2021[,-1]

# create julian day index
index_DH2021 <- unique(DH2021_effort2$biweek)

# total time
totalt_DH2021 <- length(unique(DH2021_effort2$biweek))

# total obs
totalo_DH2021 <- as.vector(table(DH2021_effort2$biweek))

# create soak days
soak_days_DH2021 <- DH2021_effort2 %>% 
  dplyr::select(biweek,trap_int,Soak_days) %>% 
  pivot_wider(id_cols=biweek,
              names_from=trap_int,
              values_from=Soak_days)
soak_days_DH2021 <- as.data.frame(soak_days_DH2021)
rownames(soak_days_DH2021) <- soak_days_DH2021[,1]
soak_days_DH2021 <- soak_days_DH2021[,-1]

# trap type binary indicators
# m
m_index_DH2021 <- DH2021_effort2 %>% 
  dplyr::select(biweek,trap_int,Minnow) %>% 
  pivot_wider(id_cols=biweek,
              names_from=trap_int,
              values_from=Minnow)
m_index_DH2021 <- as.data.frame(m_index_DH2021)
rownames(m_index_DH2021) <- m_index_DH2021[,1]
m_index_DH2021 <- m_index_DH2021[,-1]
# f
f_index_DH2021 <- DH2021_effort2 %>% 
  dplyr::select(biweek,trap_int,Fukui) %>% 
  pivot_wider(id_cols=biweek,
              names_from=trap_int,
              values_from=Fukui)
f_index_DH2021 <- as.data.frame(f_index_DH2021)
rownames(f_index_DH2021) <- f_index_DH2021[,1]
f_index_DH2021 <- f_index_DH2021[,-1]
# s
s_index_DH2021 <- DH2021_effort2 %>% 
  dplyr::select(biweek,trap_int,Shrimp) %>% 
  pivot_wider(id_cols=biweek,
              names_from=trap_int,
              values_from=Shrimp)
s_index_DH2021 <- as.data.frame(s_index_DH2021)
rownames(s_index_DH2021) <- s_index_DH2021[,1]
s_index_DH2021 <- s_index_DH2021[,-1]