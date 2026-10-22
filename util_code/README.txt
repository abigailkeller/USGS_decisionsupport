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
                (when multiple years of data were uploaded, a single lambda_A
                is reported for the first year only; adults in later years are
                projected from the previous year through overwinter survival)
  lambda_R[y]   estimated recruit abundance (lambda) in year y
  mu_lambda     Mean annual abundance of recruits across years
                (only included when multiple years of data were uploaded)
  sigma_lambda  Standard deviation of annual abundance of recruits across years
                (only included when multiple years of data were uploaded)
  alpha_o       Strength of size- and density-dependent overwinter mortality
                (only included when multiple years of data were uploaded)
  log_alpha_o   Natural log of alpha_o (the scale its prior is placed on); if
                the data show little density dependence, this is easier to
                interpret than alpha_o's mean
                (only included when multiple years of data were uploaded)
  mu_eps        Log of the density-independent overwinter mortality rate;
                density-independent overwinter survival is exp(-exp(mu_eps))
                (only included when multiple years of data were uploaded)
  prop_1        proportion of recruits entering in the first pulse on Julian day 91 (April)
  prop_2        proportion of recruits entering in the second pulse on Julian day 152 (June)

Year indices (y) correspond to the years present in your uploaded data, in
the order they were processed (year 1 = earliest year).
