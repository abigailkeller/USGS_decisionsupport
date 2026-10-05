POSTERIOR SUMMARY — README
===========================

This download contains a summary of the posterior samples from the
population model fitted in the "Estimate regime" step.

posterior_summary.csv
----------------------
One row per parameter, summarizing its posterior distribution across all
MCMC chains and post-burn-in iterations:

  mean    posterior mean
  sd      posterior standard deviation
  2.5%    lower bound of the 95% credible interval
  97.5%   upper bound of the 95% credible interval

Rows included:
  lambda_A[y]   estimated adult abundance (lambda) in year y
  lambda_R[y]   estimated recruit abundance (lambda) in year y
  prop_1        proportion of recruits entering in the first pulse on Julian day 91 (April)
  prop_2        proportion of recruits entering in the second pulse on Julian day 152 (June)

Year indices (y) correspond to the years present in your uploaded data, in
the order they were processed (year 1 = earliest year).
