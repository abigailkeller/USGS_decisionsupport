# rocker/r2u bundles R with the r2u binary package repo, so install.packages()
# below pulls prebuilt .debs instead of compiling tidyverse/nimble's heavy
# dependency tree from source. "resolute" matches the Ubuntu release (and R
# 4.6.1) this project has been developed and tested against.
FROM rocker/r2u:resolute

# Node.js (server.js is a plain Node http server; its only npm dependency is
# the Anthropic SDK used by the optional chatbot in chat/)
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
RUN Rscript -e 'install.packages(c("tidyverse", "nimble", "coda", "MCMCvis", "expm", "jsonlite", "patchwork", "bayestestR"))'

WORKDIR /app

# npm packages first, so they're only reinstalled when package*.json change
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY index.html script.js server.js styles.css ./
COPY chat ./chat
COPY util_code ./util_code
COPY sample_data ./sample_data
COPY img ./img
# only the images the page shows (not the .ai / .R sources in figures/)
COPY figures/*.png figures/*.svg ./figures/

# Uploaded CSVs land in data/staging, prepped model inputs in
# data/model_data, and MCMC/analysis output in data/posterior_samples --
# all written at runtime by server.js and the R scripts it spawns. Declared
# as a volume so a run's results survive the container being recreated.
RUN mkdir -p data/staging data/model_data data/posterior_samples
VOLUME /app/data

# Chatbot settings (see chat/chat.js). Pass secrets at run time, never in the
# image: docker run -e ANTHROPIC_API_KEY=... (or CHAT_PROVIDER=ollama with
# CHAT_MODEL and OLLAMA_URL for a model you host yourself)
EXPOSE 8000

CMD ["node", "server.js"]
