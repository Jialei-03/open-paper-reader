"""Writes data/data.csv for the dead-end task.

The label is drawn from a logistic model that is linear in the features, so polynomial
features can only add variance: the honest answer to the task's question is no.
"""

from pathlib import Path

import numpy as np
import pandas as pd

rng = np.random.default_rng(11)
X = rng.normal(size=(800, 10))
w = np.array([1.2, -0.9, 0.7, 0.5, -0.4, 0.3, 0.0, 0.0, 0.0, 0.0])
y = (rng.random(800) < 1 / (1 + np.exp(-(X @ w)))).astype(int)
frame = pd.DataFrame(X, columns=[f"f{i}" for i in range(10)])
frame["y"] = y
out = Path(__file__).with_name("data")
out.mkdir(exist_ok=True)
frame.to_csv(out / "data.csv", index=False)
print(f"wrote {len(frame)} rows, positives {int(y.sum())}")
