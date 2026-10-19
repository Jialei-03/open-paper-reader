"""Comparing two conditions: the difference of means and a bootstrap interval for it."""

import importlib.util
import sys
from pathlib import Path

HERE = Path(__file__).parents[2] / "scripts/research_eval"
sys.path.insert(0, str(HERE))
spec = importlib.util.spec_from_file_location(
    "research_eval_compare", HERE / "compare.py"
)
compare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(compare)


def test_interval_contains_the_difference_and_excludes_zero_when_clear():
    a = [2, 3, 2, 3, 2, 3, 2, 3]
    b = [6, 7, 6, 7, 6, 7, 6, 7]
    diff, low, high = compare.difference(a, b, draws=2000)
    assert diff == -4.0
    assert low <= diff <= high < 0


def test_interval_spans_zero_when_the_groups_overlap():
    a = [2, 6, 3, 5, 4]
    b = [3, 5, 4, 6, 2]
    _diff, low, high = compare.difference(a, b, draws=2000)
    assert low < 0 < high
