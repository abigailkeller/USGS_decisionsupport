POSTERIOR SUMMARY — README
===========================

This download contains a summary of the posterior samples from the
population model fitted in the "Estimate regime" step, using multiple years
of data.

posterior_summary.csv
----------------------
One row per parameter, summarizing its posterior distribution across all
MCMC chains and post-burn-in iterations:

  mean    posterior mean
  sd      posterior standard deviation
  2.5%    lower bound of the 95% credible interval
  97.5%   upper bound of the 95% credible interval

Rows included:
  lambda_A      estimated adult abundance (lambda) in the first year
                (adults in later years are projected from the previous year
                through overwinter survival; see N_adult[y])
  N_adult[y]    estimated adult abundance at the start of the season in year y
                (in the first year this matches lambda_A, in later years it is
                the crabs that survived the previous winter)
  lambda_R[y]   estimated recruit abundance (lambda) in year y
  mu_lambda     Mean annual abundance of recruits across years
  sigma_lambda  Standard deviation of annual abundance of recruits across years
  mu_eps        Log of the density-independent overwinter mortality rate for
                a 50 mm crab; density-independent overwinter survival of a
                50 mm crab in an average winter is exp(-exp(mu_eps))
  b_o           Size dependence of density-independent overwinter
                mortality, which scales as (carapace width / 50) ^ -b_o
                (0 = same for all sizes; larger = concentrated on small crabs)
  log_mu_A      Log of the median carapace width (mm) of adults in the first
                year (lognormal size distribution)
  sigma_A       Log-scale standard deviation of the first-year adult size
                distribution
  eps_y[y]      Year-specific deviation in density-independent overwinter
                mortality for the winter following year y, on the log scale
                (positive = harsher winter; e.g. 0.2 means about 22% more
                density-independent mortality than an average winter); the
                winter after the last year has no data following it, so its
                deviation reflects only the assumed year-to-year variation
                (standard deviation fixed at 0.3)
  prop_1        proportion of recruits entering in the first pulse on Julian day 91 (April)
  prop_2        proportion of recruits entering in the second pulse on Julian day 152 (June)

Year indices (y) correspond to the years present in your uploaded data, in
the order they were processed (year 1 = earliest year).
