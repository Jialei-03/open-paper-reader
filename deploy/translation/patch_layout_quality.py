"""Pinned BabelDOC 0.6.4: preserve code constants and avoid symbol-only retries."""

import importlib.util
import inspect
import re
from pathlib import Path


def symbol_only(text):
    text = re.sub(r"<\s*/?\s*b\s*\d+\s*>|\{\s*v\s*\d+\s*\}", "", text, flags=re.IGNORECASE)
    # Unicode letters include non-English prose. Do not exempt names, variables,
    # identifiers, headings or actual words: only numbers/punctuation/symbols.
    return not re.search(r"[^\W\d_]", text, flags=re.UNICODE)


def patch(root):
    middle = Path(root) / "format/pdf/document_il/midend"
    path = middle / "il_translator_llm_only.py"
    source = path.read_text()
    anchor = "                    same_as_input = trimed_input == output_unicode\n"
    assert source.count(anchor) == 1
    source += "\n\n" + inspect.getsource(symbol_only)
    source = source.replace(
        anchor,
        anchor
        + "                    preserved_symbols = same_as_input and symbol_only(trimed_input)\n",
    )
    guards = (
        (
            "                        and not self.translation_config.disable_same_text_fallback",
            "                        and not preserved_symbols\n                        and not self.translation_config.disable_same_text_fallback",
        ),
        (
            "                    if not (0.3 < output_token_count / input_token_count < 3):",
            "                    if not preserved_symbols and not (0.3 < output_token_count / input_token_count < 3):",
        ),
        (
            "                    if not self.translation_config.disable_same_text_fallback:",
            "                    if not preserved_symbols and not self.translation_config.disable_same_text_fallback:",
        ),
    )
    for old, new in guards:
        assert source.count(old) == 1, old
        source = source.replace(old, new)
    path.write_text(source)

    path = middle / "il_translator.py"
    source = path.read_text()
    anchor = "        tracker.set_output(translated_text)\n"
    assert source.count(anchor) == 1
    guard = """
        from collections import Counter
        def code_constants(value):
            return Counter(re.findall(r"[\\\"']([A-Z][A-Z0-9_]{1,40})[\\\"']", value))
        if code_constants(translate_input.unicode) != code_constants(translated_text):
            raise ValueError("Translation changed code constants")
"""
    path.write_text(source.replace(anchor, guard + anchor))


if __name__ == "__main__":
    patch(Path(importlib.util.find_spec("babeldoc").origin).parent)
