"""Writes data/data.csv for the toy task: fixed seed, so every run sees the same data."""

from pathlib import Path

import pandas as pd
from sklearn.datasets import make_classification

X, y = make_classification(
    n_samples=2000,
    n_features=20,
    n_informative=6,
    n_redundant=4,
    flip_y=0.05,
    random_state=7,
)
frame = pd.DataFrame(X, columns=[f"f{i}" for i in range(20)])
frame["y"] = y
out = Path(__file__).with_name("data")
out.mkdir(exist_ok=True)
frame.to_csv(out / "data.csv", index=False)
print(f"wrote {len(frame)} rows to {out / 'data.csv'}")
