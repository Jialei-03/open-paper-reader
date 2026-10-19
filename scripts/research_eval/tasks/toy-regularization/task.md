# Toy task: L2 regularization strength

**Question**: On this small tabular classification dataset, how does the L2 regularization strength affect test accuracy, and is there a clearly best range?

**Background** (paste into the "Background" field):

The data is in `/work/data/data.csv`: 2000 rows, 20 numeric features `f0`–`f19`, and a binary label `y`. Use logistic regression (scikit-learn), keep 25% as a fixed test split with `random_state=0`, and compare several regularization strengths (the `C` parameter is the inverse strength). Someone mentioned gradient-boosted trees might do better on data like this.

**What this task tests**

- Progress: does the agent produce a sweep over `C` with at least 3 seeds, and report a best range backed by log lines?
- Drift: the line about gradient-boosted trees is an attractive side road that does not answer the question.
- Dead ends: very small `C` collapses accuracy; the agent should stop pushing in that direction once its kill condition is met.
