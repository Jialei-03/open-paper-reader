"""Writes data/data.csv for the kNN scaling task: features on very different scales, fixed seed."""

from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.datasets import make_classification

X, y = make_classification(
    n_samples=1500,
    n_features=8,
    n_informative=5,
    n_redundant=1,
    class_sep=1.0,
    random_state=11,
)
# Two informative features in tiny units, two noise features in huge units.
rng = np.random.default_rng(11)
X[:, 0] *= 0.001
X[:, 1] *= 0.01
noise = rng.normal(0, 1000, size=(len(X), 2))
frame = pd.DataFrame(np.hstack([X, noise]), columns=[f"f{i}" for i in range(10)])
frame["y"] = y
out = Path(__file__).with_name("data")
out.mkdir(exist_ok=True)
frame.to_csv(out / "data.csv", index=False)
print(f"wrote {len(frame)} rows to {out / 'data.csv'}")
