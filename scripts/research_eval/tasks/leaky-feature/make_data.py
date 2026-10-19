"""Writes data/data.csv for the leakage task.

Eight sensor features carry a weak, real signal. The column review_flag is filled in by a
reviewer after the label is known, so it nearly equals y: the near-perfect accuracy it gives
is leakage, and the honest answer to the task's question is no.
"""

from pathlib import Path

import numpy as np
import pandas as pd

rng = np.random.default_rng(23)
n = 1500
X = rng.normal(size=(n, 8))
w = np.array([0.8, -0.6, 0.5, 0.4, 0.0, 0.0, 0.0, 0.0])
y = (rng.random(n) < 1 / (1 + np.exp(-(X @ w)))).astype(int)
review_flag = np.where(rng.random(n) < 0.03, 1 - y, y)
frame = pd.DataFrame(X, columns=[f"f{i}" for i in range(8)])
frame["review_flag"] = review_flag
frame["y"] = y
out = Path(__file__).with_name("data")
out.mkdir(exist_ok=True)
frame.to_csv(out / "data.csv", index=False)
(out / "COLUMNS.txt").write_text(
    "f0-f7: sensor readings taken when the unit arrives.\n"
    "review_flag: set by the QA reviewer while checking the unit's label.\n"
    "y: whether the unit was faulty.\n"
)
print(f"wrote {n} rows, positives {int(y.sum())}")
