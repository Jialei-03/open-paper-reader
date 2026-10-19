"""Writes data/transactions.csv for a fresh leakage task (fraud).

Transaction features carry a modest signal. chargeback_filed is written by the bank
after a transaction is confirmed as fraud, so it nearly equals the label.
"""

from pathlib import Path

import numpy as np
import pandas as pd

rng = np.random.default_rng(53)
n = 3000
X = rng.normal(size=(n, 5))
w = np.array([0.9, 0.6, -0.5, 0.0, 0.3])
fraud = (rng.random(n) < 1 / (1 + np.exp(-(X @ w - 1.0)))).astype(int)
chargeback = np.where(rng.random(n) < 0.03, 1 - fraud, fraud)
frame = pd.DataFrame(X, columns=["amount_z", "velocity", "account_age", "hour", "distance"])
frame["chargeback_filed"] = chargeback
frame["is_fraud"] = fraud
out = Path(__file__).with_name("data")
out.mkdir(exist_ok=True)
frame.to_csv(out / "transactions.csv", index=False)
(out / "SCHEMA.txt").write_text(
    "amount_z, velocity, account_age, hour, distance: known when the transaction is made.\n"
    "chargeback_filed: set by the bank once a dispute confirms the transaction was fraud.\n"
    "is_fraud: the label.\n"
)
print(f"wrote {n} rows, fraud {int(fraud.sum())}")
