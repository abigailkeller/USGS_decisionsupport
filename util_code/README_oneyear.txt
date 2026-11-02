POSTERIOR SUMMARY — README
===========================

This download contains a summary of the posterior samples from the
population model fitted in the "Estimate regime" step, using one year of
data.

posterior_summary.csv
----------------------
One row per parameter, summarizing its posterior distribution across all
MCMC chains and post-burn-in iterations:

  mean    posterior mean
  sd      posterior standard deviation
  2.5%    lower bound of the 95% credible interval
  97.5%   upper bound of the 95% credible interval

Rows included:
  lambda_A      estimated adult abundance (lambda) at the start of the season
  lambda_R      estimated recruit abundance (lambda) in the season
  log_mu_A      Log of the median carapace width (mm) of adults at the start
                of the season (lognormal size distribution)
  sigma_A       Log-scale standard deviation of the adult size distribution
                at the start of the season
  prop_1        proportion of recruits entering in the first pulse on Julian day 91 (April)
  prop_2        proportion of recruits entering in the second pulse on Julian day 152 (June)
