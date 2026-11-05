OPTIMIZATION SUMMARY — README
==============================

This download contains the trap schedules found by the optimization for a
budget of 30 trap units (trap costs: fukui 1, shrimp 4, minnow 1).

The optimization minimizes the expected abundance of crabs at the start of
the next trapping season, after overwinter mortality.

optimization_summary.csv
-------------------------
The recommended schedule (option 1 in optimization_options.csv): the number
of traps of each type to set at each trapping occasion.

optimization_options.csv
-------------------------
The search was run several times with different step sizes (the number of
traps added at a time), using 100 posterior samples. Because the
objective is flat near its best value, different searches end at different
but similarly good schedules. Every distinct schedule found, and no trapping
for reference, was then scored on 500 fresh posterior samples
(new parameter draws, recruitment, catch randomness and winter severity), so
the options are compared fairly. Options are sorted best first.

  Option                       option number (1 = best)
  Recommended                  whether this is the recommended schedule
  Traps per search step        step size(s) of the search(es) that found it
  Total cost                   trap units used
  Expected abundance at start of next season
                               mean over the fresh posterior samples
  Abundance 95% CrI lower/upper
                               95% credible interval of that abundance;
                               mostly reflects uncertainty about next year's
                               recruitment and winter, which affects every
                               schedule alike
  Reduction vs no trapping (%) expected abundance compared with no trapping
  Difference from best (crabs) how many more crabs this schedule leaves than
                               the best one, compared within each posterior
                               sample (paired) and averaged
  Difference 95% lower/upper   middle 95% of those per-sample differences; an
                               interval that includes 0 means the option is
                               not reliably worse than the best
  Within 1% of best            whether the expected abundance is within 1% of
                               the best option's
  Schedule                     traps of each type and the dates they are set

Options with differences close to zero are effectively equivalent; choosing
among them can be based on practical considerations such as staffing or trap
availability.
