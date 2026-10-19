"""Writes data/images_meta.csv only. The question needs data/labels.csv, which is not there."""

from pathlib import Path

import numpy as np
import pandas as pd

rng = np.random.default_rng(7)
frame = pd.DataFrame(
    {"image_id": [f"img{i:04d}" for i in range(500)], "brightness": rng.normal(size=500)}
)
out = Path(__file__).with_name("data")
out.mkdir(exist_ok=True)
frame.to_csv(out / "images_meta.csv", index=False)
print("wrote images_meta.csv; no labels.csv on purpose")
