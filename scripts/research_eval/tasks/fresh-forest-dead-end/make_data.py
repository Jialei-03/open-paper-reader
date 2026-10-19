"""Writes data/signals.csv: a classification problem where a forest of 100 trees has
already converged, so going to 500 trees gains less than a point."""

from pathlib import Path

import pandas as pd
from sklearn.datasets import make_classification

X, y = make_classification(
    n_samples=1500, n_features=12, n_informative=6, flip_y=0.08, random_state=67
)
frame = pd.DataFrame(X, columns=[f"s{i}" for i in range(12)])
frame["label"] = y
out = Path(__file__).with_name("data")
out.mkdir(exist_ok=True)
frame.to_csv(out / "signals.csv", index=False)
print(f"wrote {len(frame)} rows")
