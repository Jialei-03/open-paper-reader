"""Writes data/data.csv for the threshold task: an imbalanced binary problem, fixed seed."""

from pathlib import Path

import pandas as pd
from sklearn.datasets import make_classification

X, y = make_classification(
    n_samples=3000,
    n_features=12,
    n_informative=5,
    weights=[0.9, 0.1],
    flip_y=0.02,
    class_sep=0.8,
    random_state=5,
)
frame = pd.DataFrame(X, columns=[f"f{i}" for i in range(12)])
frame["y"] = y
out = Path(__file__).with_name("data")
out.mkdir(exist_ok=True)
frame.to_csv(out / "data.csv", index=False)
print(f"wrote {len(frame)} rows, positives {int(y.sum())}")
