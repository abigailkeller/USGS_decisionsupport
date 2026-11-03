POSTERIOR SUMMARY — README
===========================

This download contains a summary of the posterior samples from the
population model fitted in the "Estimate regime" step, using multiple years
of data with no two years in a row (e.g. 2011, 2013 and 2015). Without
consecutive years, nothing in the data links one year to the next, so each
year was fit on its own, in the same way as a single year of data.

posterior_summary.csv
----------------------
One row per parameter, summarizing its posterior distribution across all
MCMC chains and post-burn-in iterations:

  mean    posterior mean
  sd      posterior standard deviation
  2.5%    lower bound of the 95% credible interval
  97.5%   upper bound of the 95% credible interval

Rows included:
  lambda_A[y]   estimated adult abundance (lambda) at the start of the season
                in year y
  lambda_R[y]   estimated recruit abundance (lambda) in year y
  log_mu_A[y]   Log of the median carapace width (mm) of adults at the start
                of the season in year y (lognormal size distribution)
  sigma_A[y]    Log-scale standard deviation of that adult size distribution
  prop_1[y]     proportion of recruits entering in the first pulse on Julian
                day 91 (April) in year y
  prop_2[y]     proportion of recruits entering in the second pulse on Julian
                day 152 (June) in year y

Year indices (y) count only the years present in your uploaded data, in
order (e.g. for 2011, 2013 and 2015: 2011 = year 1, 2013 = year 2, 2015 =
year 3).
