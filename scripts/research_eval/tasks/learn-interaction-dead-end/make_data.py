"""Writes data/sales.csv: the target is linear in the inputs plus noise, so pairwise
interaction terms cannot add real fit. The honest answer to the task's question is no."""

from pathlib import Path

import numpy as np
import pandas as pd

rng = np.random.default_rng(19)
n = 600
X = rng.normal(size=(n, 6))
y = X @ np.array([2.0, -1.5, 1.0, 0.5, 0.0, 0.0]) + rng.normal(scale=2.0, size=n)
frame = pd.DataFrame(X, columns=[f"x{i}" for i in range(6)])
frame["sales"] = y
out = Path(__file__).with_name("data")
out.mkdir(exist_ok=True)
frame.to_csv(out / "sales.csv", index=False)
print(f"wrote {n} rows")
