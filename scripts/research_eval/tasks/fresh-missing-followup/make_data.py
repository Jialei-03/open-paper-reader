"""Writes data/baseline.csv only. The question needs data/followup.csv, which is not there."""

from pathlib import Path

import numpy as np
import pandas as pd

rng = np.random.default_rng(61)
frame = pd.DataFrame(
    {
        "subject_id": [f"s{i:04d}" for i in range(400)],
        "age": rng.integers(20, 80, 400),
        "baseline_score": rng.normal(50, 10, 400).round(1),
    }
)
out = Path(__file__).with_name("data")
out.mkdir(exist_ok=True)
frame.to_csv(out / "baseline.csv", index=False)
print("wrote baseline.csv; no followup.csv on purpose")
