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
  lambda_A[k]   estimated adult abundance (lambda) in the first year of the
                k-th run of consecutive years in your data (a single
                lambda_A[1] if there are no gaps between years); adults in
                later years of a run are projected from the previous year
                through overwinter survival; see N_adult[y]
  N_adult[y]    estimated adult abundance at the start of the season in year y
                (in the first year of each run of consecutive years this
                matches that run's lambda_A, in later years it is the crabs
                that survived the previous winter)
  lambda_R[y]   estimated recruit abundance (lambda) in year y
  mu_lambda     Mean annual abundance of recruits across years
  sigma_lambda  Standard deviation of annual abundance of recruits across years
  mu_eps        Log of the density-independent overwinter mortality rate for
                a 50 mm crab; density-independent overwinter survival of a
                50 mm crab in an average winter is exp(-exp(mu_eps))
  b_o           Size dependence of density-independent overwinter
                mortality, which scales as (carapace width / 50) ^ -b_o
                (0 = same for all sizes; larger = concentrated on small crabs)
  log_mu_A[k]   Log of the median carapace width (mm) of adults in the first
                year of the k-th run of consecutive years (lognormal size
                distribution)
  sigma_A[k]    Log-scale standard deviation of that adult size distribution
  eps_y[y]      Year-specific deviation in density-independent overwinter
                mortality for the winter following year y, on the log scale;
                only included for winters followed by another year of data
                and for the winter after the last year (a winter before a gap
                in the data is not modelled)
                (positive = harsher winter; e.g. 0.2 means about 22% more
                density-independent mortality than an average winter); the
                winter after the last year has no data following it, so its
                deviation reflects only the assumed year-to-year variation
                (standard deviation fixed at 0.3)
  prop_1        proportion of recruits entering in the first pulse on Julian day 91 (April)
  prop_2        proportion of recruits entering in the second pulse on Julian day 152 (June)

Year indices (y) correspond to the years present in your uploaded data, in
the order they were processed (year 1 = earliest year). If there are gaps
between years (e.g. 2011 and 2013-2016), the indices count only the years
present (2011 = year 1, 2013 = year 2, and so on).
