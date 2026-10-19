"""Writes data/patients.csv for the confounding task (Simpson's paradox).

Treatment A goes mostly to mild cases, B mostly to severe ones. Within each severity,
B recovers more often; A only looks better overall because of who received it. The
honest answer to the task's question is no.
"""

from pathlib import Path

import numpy as np
import pandas as pd

rng = np.random.default_rng(29)
rows = []
# (severity, treatment, patients, recovery rate)
for severity, treatment, n, rate in [
    ("mild", "A", 800, 0.86),
    ("mild", "B", 200, 0.93),
    ("severe", "A", 200, 0.55),
    ("severe", "B", 800, 0.68),
]:
    recovered = (rng.random(n) < rate).astype(int)
    rows += [(severity, treatment, int(r)) for r in recovered]
frame = pd.DataFrame(rows, columns=["severity", "treatment", "recovered"])
frame = frame.sample(frac=1, random_state=29).reset_index(drop=True)
frame.insert(0, "patient_id", [f"p{i:05d}" for i in range(len(frame))])
out = Path(__file__).with_name("data")
out.mkdir(exist_ok=True)
frame.to_csv(out / "patients.csv", index=False)
print(f"wrote {len(frame)} rows")
