"""Writes data/customers.csv for a learning task about leakage (churn this time).

Usage features carry a modest real signal. cancel_reason is recorded by support when a
customer cancels, so it is blank (0) exactly for those who stay: the high accuracy it
gives is leakage.
"""

from pathlib import Path

import numpy as np
import pandas as pd

rng = np.random.default_rng(41)
n = 2000
X = rng.normal(size=(n, 6))
w = np.array([-0.9, 0.7, 0.0, 0.5, 0.0, -0.3])
churned = (rng.random(n) < 1 / (1 + np.exp(-(X @ w - 0.4)))).astype(int)
cancel_reason = np.where(churned == 1, rng.integers(1, 6, n), 0)
cancel_reason = np.where(rng.random(n) < 0.02, rng.integers(0, 6, n), cancel_reason)
frame = pd.DataFrame(X, columns=["logins", "tickets", "tenure", "discount", "region", "seats"])
frame["cancel_reason"] = cancel_reason
frame["churned"] = churned
out = Path(__file__).with_name("data")
out.mkdir(exist_ok=True)
frame.to_csv(out / "customers.csv", index=False)
(out / "FIELDS.md").write_text(
    "- logins, tickets, tenure, discount, region, seats: account activity over the last quarter.\n"
    "- cancel_reason: code entered by support when the customer cancels (0 = none).\n"
    "- churned: 1 if the customer left within the quarter.\n"
)
print(f"wrote {n} rows, churned {int(churned.sum())}")
