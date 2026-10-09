# rocker/r2u bundles R with the r2u binary package repo, so install.packages()
# below pulls prebuilt .debs instead of compiling tidyverse/nimble's heavy
# dependency tree from source. "resolute" matches the Ubuntu release (and R
# 4.6.1) this project has been developed and tested against.
FROM rocker/r2u:resolute

# Node.js (server.js is a plain Node http server with no npm dependencies)
# and a compiler toolchain (nimble generates and compiles C++ for each model
# at runtime via compileNimble(), so g++/gfortran/make must be present in the
# final image, not just at package-install time).
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
  && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
  && apt-get install -y --no-install-recommends \
    nodejs \
    build-essential \
    gfortran \
  && rm -rf /var/lib/apt/lists/*

# R packages used across util_code/*.R
RUN Rscript -e 'install.packages(c("tidyverse", "nimble", "coda", "MCMCvis", "expm", "jsonlite"))'

WORKDIR /app

COPY index.html script.js server.js styles.css ./
COPY util_code ./util_code
COPY sample_data ./sample_data
COPY img ./img

# Uploaded CSVs land in data/staging, prepped model inputs in
# data/model_data, and MCMC/analysis output in data/posterior_samples --
# all written at runtime by server.js and the R scripts it spawns. Declared
# as a volume so a run's results survive the container being recreated.
RUN mkdir -p data/staging data/model_data data/posterior_samples
VOLUME /app/data

EXPOSE 8000

CMD ["node", "server.js"]
