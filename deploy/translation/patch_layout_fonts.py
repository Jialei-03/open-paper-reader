"""Pinned BabelDOC 0.6.4 job-local font reuse and paragraph batching.

The original pipeline loads an identical, large font collection at each stage.
Reuse a mapper only within the exact same TranslationConfig; never across jobs.
No fonts, glyphs, or layout stages are removed. Fail if upstream source changes.
"""

import importlib.util
from pathlib import Path

root = Path(importlib.util.find_spec("babeldoc").origin).parent
il = root / "format/pdf/document_il"
fontmap = il / "utils/fontmap.py"
source = fontmap.read_text()
anchor = 'class FontMapper:\n    stage_name = "Add Fonts"\n'
assert source.count(anchor) == 1
source = "import threading\n" + source.replace(
    anchor,
    anchor
    + """
    _shared_lock = threading.RLock()

    @classmethod
    def shared(cls, config):
        with cls._shared_lock:
            mapper = getattr(config, "_paper_font_mapper", None)
            # A split configuration can be a shallow copy; do not retain the
            # original configuration's progress monitor in that case.
            if mapper is None or mapper.translation_config is not config:
                mapper = cls(config)
                config._paper_font_mapper = mapper
            return mapper
""",
)
fontmap.write_text(source)
for name in (
    "midend/il_translator.py",
    "midend/il_translator_llm_only.py",
    "frontend/il_creater.py",
    "frontend/il_creater_active.py",
    "midend/styles_and_formulas.py",
    "midend/paragraph_finder.py",
    "midend/typesetting.py",
    "backend/pdf_creater.py",
):
    path = il / name
    source = path.read_text()
    old = "self.font_mapper = FontMapper(translation_config)"
    assert source.count(old) == 1, name
    path.write_text(
        source.replace(old, "self.font_mapper = FontMapper.shared(translation_config)")
    )

path = il / "midend/il_translator_llm_only.py"
source = path.read_text()
# Keep whole paragraphs. The parent selects 4K source tokens for M3/M3.1,
# 1K for other models, instead of upstream's 200-token request batches.
batch = "if total_token_count > 200 or len(paragraphs) > 5:"
assert source.count(batch) == 1
path.write_text(
    source.replace(
        batch,
        'if total_token_count > getattr(self.translation_config, "paper_batch_tokens", 1000) or len(paragraphs) > 24:',
    )
)

# Validate before mutating the paragraph. Upstream then retries only that
# paragraph through its existing single-paragraph fallback, once; the worker's
# final tracking check still refuses output if that fallback fails too.
path = il / "midend/il_translator.py"
source = path.read_text()
anchor = "        tracker.set_output(translated_text)\n"
assert source.count(anchor) == 1
guard = r'''
        from collections import Counter

        def markers(value):
            return Counter(
                re.sub(r"\s+", "", match.group()).lower()
                for match in re.finditer(
                    r"<\s*/?\s*b\s*\d+\s*>|\{\s*v\s*\d+\s*\}",
                    value, re.IGNORECASE,
                )
            )

        if markers(translate_input.unicode) != markers(translated_text):
            raise ValueError("Translation changed formula or style markers")
'''
path.write_text(source.replace(anchor, guard + anchor))
