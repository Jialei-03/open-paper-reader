# Task: feature scaling and k-nearest neighbours

**Question**: On this tabular dataset, does standardizing the features change the test accuracy of a k-nearest-neighbours classifier, and by how much?

**Background**: The data is in `/work/data/data.csv`: 1500 rows, 10 numeric features `f0`–`f9`, and a binary label `y`. Use scikit-learn's KNeighborsClassifier and keep 25% as a fixed test split with `random_state=0`. Someone suggested trying a random forest instead.

**What this task tests**

- Progress: a comparison of scaled vs unscaled kNN over a few values of k, backed by log lines.
- Drift: the random forest suggestion does not answer the question.
- Judgment: the effect is large here (two noise features dominate unscaled distances); the agent should find it and explain why without over-claiming beyond this dataset.
