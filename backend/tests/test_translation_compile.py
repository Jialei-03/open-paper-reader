from types import SimpleNamespace

import pytest

from backend import translation_engine as engine


def test_unicode_daggers_keep_text_and_math_symbols_and_are_idempotent(tmp_path):
    main = tmp_path / 'main.tex'
    original = r'\documentclass{article}\begin{document}Author† $x‡$ 中文\end{document}'
    main.write_text(original)
    engine.prepare_compile_source(main)
    prepared = main.read_text()
    assert original.split(r'\begin{document}', 1)[1] in prepared
    assert r'\ensuremath{\dagger}' in prepared
    assert r'\ensuremath{\ddagger}' in prepared
    engine.prepare_compile_source(main)
    assert main.read_text() == prepared


def test_compiler_reports_missing_font_instead_of_generic_error(tmp_path, monkeypatch):
    (tmp_path / 'main.tex').write_text(r'\documentclass{article}\begin{document}中文\end{document}')
    log = b'./main.tex:8: Package fontspec Error: The font "LinLibertine_R" cannot be found.\n'
    monkeypatch.setattr(engine.subprocess, 'run', lambda *a, **kw: SimpleNamespace(returncode=1, stdout=log, stderr=b''))
    with pytest.raises(ValueError, match='fontspec.*LinLibertine_R'):
        engine.compile_project(tmp_path)


def test_compiler_still_rejects_missing_cjk_glyph(tmp_path, monkeypatch):
    (tmp_path / 'main.tex').write_text(r'\documentclass{article}\begin{document}中文\end{document}')
    (tmp_path / 'build').mkdir()
    (tmp_path / 'build/main.pdf').write_bytes(b'%PDF-1.7')
    log = 'Missing character: There is no 中 in font Broken!'.encode()
    monkeypatch.setattr(engine.subprocess, 'run', lambda *a, **kw: SimpleNamespace(returncode=0, stdout=log, stderr=b''))
    with pytest.raises(ValueError, match='缺失字形'):
        engine.compile_project(tmp_path)


def test_malformed_title_suffix_recovers_only_plain_preamble_text(tmp_path):
    main = tmp_path / 'main.tex'
    main.write_text(r'\documentclass{article}' + '\n' + r'\title{中文\textbf{标题}}遗漏尾部' + '\n' + r'\begin{document}\title{Body} untouched\end{document}')
    engine.prepare_compile_source(main)
    assert r'\title{中文\textbf{标题}遗漏尾部}' in main.read_text()
    assert r'\title{Body} untouched' in main.read_text()


def test_unused_pdftex_emoji_package_omitted_but_used_glyph_retained(tmp_path):
    main = tmp_path / 'main.tex'
    (tmp_path / 'apple_emoji.sty').write_text(r'\UTFviii@four@octets\DeclareUnicodeCharacter{1F600}{emoji}')
    original = r'\documentclass{article}\usepackage{apple_emoji}\begin{document}中文\end{document}'
    main.write_text(original)
    engine.prepare_compile_source(main)
    assert r'\usepackage{apple_emoji}' not in main.read_text()
    main.write_text(original.replace('中文', '中文😀'))
    engine.prepare_compile_source(main)
    assert r'\usepackage{apple_emoji}' in main.read_text()


def test_conflicting_subfigure_only_removed_when_commands_unused(tmp_path):
    main = tmp_path / 'main.tex'
    original = r'\documentclass{article}\usepackage{subfigure}\usepackage{subcaption}\begin{document}中文\end{document}'
    main.write_text(original)
    engine.prepare_compile_source(main)
    assert r'\usepackage{subfigure}' not in main.read_text()
    main.write_text(original.replace('中文', r'\subfigure{中文}'))
    engine.prepare_compile_source(main)
    assert r'\usepackage{subfigure}' in main.read_text()


def test_escaped_citation_keys_recover_only_with_original_source_evidence(tmp_path):
    source = tmp_path / 'source'
    source.mkdir()
    (source / 'main.tex').write_text(r'\citep[Original][]' + '{nguyen2023language, hamrick2019combining}')
    out = tmp_path / 'translated'
    out.mkdir()
    main = out / 'main.tex'
    broken = r'\citep[中文][]\{{\}nguyen2023language、hamrick2019combining}'
    unknown = r'\citep[]\{{\}unknown}'
    main.write_text(r'\documentclass{article}\begin{document}' + broken + unknown + r'\end{document}')
    engine.prepare_compile_source(main)
    assert r'\citep[中文][]{nguyen2023language, hamrick2019combining}' in main.read_text()
    assert unknown in main.read_text()


def test_orphan_break_after_heading_removed_but_table_rows_preserved(tmp_path):
    main = tmp_path / 'main.tex'
    main.write_text(r'\documentclass{article}\begin{document}' + '\n' + r'\section{实验}' + '\n\n' + r'\\' + '\n' + r'\textbf{研究问题} 中文\\' + '\n' + r'\begin{tabular}{c}Row\\' + '\n' + r'\\' + '\n' + r'\end{tabular}\end{document}')
    engine.prepare_compile_source(main)
    content = main.read_text()
    assert r'\section{实验}' + '\n\n' + r'\\' not in content
    assert r'\textbf{研究问题} 中文\\' in content
    assert r'\begin{tabular}{c}Row\\' + '\n' + r'\\' in content


def test_bundled_class_pdfoutput_is_guarded_idempotently(tmp_path):
    main = tmp_path / 'main.tex'
    main.write_text(r'\documentclass{article}\begin{document}中文\end{document}')
    cls = tmp_path / 'memtensor.cls'
    cls.write_text('\\pdfoutput=1\n')
    engine.prepare_compile_source(main)
    assert cls.read_text() == '\\ifdefined\\XeTeXversion\\else\\ifdefined\\pdfoutput\\pdfoutput=1\\fi\\fi\n'
    engine.prepare_compile_source(main)
    assert cls.read_text() == '\\ifdefined\\XeTeXversion\\else\\ifdefined\\pdfoutput\\pdfoutput=1\\fi\\fi\n'


def test_curly_quotes_are_rendered_and_xcolor_options_precede_class(tmp_path):
    main = tmp_path / 'main.tex'
    original = r'\documentclass{article}\usepackage[table]{xcolor}\begin{document}作者’s “文本”\end{document}'
    main.write_text(original)
    engine.prepare_compile_source(main)
    content = main.read_text()
    assert content.index(r'\PassOptionsToPackage{table}{xcolor}') < content.index(r'\documentclass')
    assert r'\newunicodechar{’}{\ifmmode\mbox{\textquoteright}\else\textquoteright\fi}' in content
    assert original.split(r'\begin{document}', 1)[1] in content
    engine.prepare_compile_source(main)
    assert main.read_text() == content


def test_bibliography_accents_get_lossless_glyph_commands(tmp_path):
    main = tmp_path / 'main.tex'
    main.write_text(r'\documentclass{article}\begin{document}中文\end{document}')
    (tmp_path / 'references.bib').write_text('author={Željko and č}, title={†}')
    engine.prepare_compile_source(main)
    content = main.read_text()
    assert r'\newunicodechar{Ž}{\v{Z}}' in content
    assert r'\newunicodechar{č}{\v{c}}' in content
    assert r'\newunicodechar{†}' in content


def test_corrupted_reference_dash_only_recovers_existing_original_label(tmp_path):
    source = tmp_path / 'source'
    source.mkdir()
    (source / 'main.tex').write_text(r'\label{appendix-evaluation-metric}')
    out = tmp_path / 'translated'
    out.mkdir()
    main = out / 'main.tex'
    main.write_text(r'\documentclass{article}\begin{document}\Cref{appendix-evaluation–metric}\Cref{unknown–label}\end{document}')
    engine.prepare_compile_source(main)
    assert r'\Cref{appendix-evaluation-metric}' in main.read_text()
    assert r'\Cref{unknown–label}' in main.read_text()


def test_disable_ligatures_guard_and_dagger_override_are_idempotent(tmp_path):
    main = tmp_path / 'main.tex'
    main.write_text(r'\documentclass{article}\begin{document}中文\end{document}')
    cls = tmp_path / 'template.cls'
    cls.write_text('\\DisableLigatures{encoding=*, family=*}\n')
    engine.prepare_compile_source(main)
    assert cls.read_text() == '\\ifdefined\\XeTeXversion\\else \\DisableLigatures{encoding=*, family=*}\\fi\n'
    assert r'\renewcommand{\textdagger}{\ensuremath{\dagger}}' in main.read_text()
    assert r'\renewcommand{\textdaggerdbl}{\ensuremath{\ddagger}}' in main.read_text()
    before = (main.read_text(), cls.read_text())
    engine.prepare_compile_source(main)
    assert (main.read_text(), cls.read_text()) == before


def test_unicode_symbol_mapping_precedes_stored_author_macros(tmp_path):
    main = tmp_path / 'main.tex'
    original = r'\documentclass[twocolumn]{article}\author{Name\thanks{† Equal contribution}}\begin{document}\texttt{step→next}\end{document}'
    main.write_text(original)
    engine.prepare_compile_source(main)
    content = main.read_text()
    dagger = content.index(r'\newunicodechar{†}{\ensuremath{\dagger}}')
    arrow = content.index(r'\newunicodechar{→}{\ensuremath{\rightarrow}}')
    assert content.index(r'\documentclass') < dagger < content.index(r'\author')
    assert arrow < content.index(r'\author')
    assert r'Name\thanks{† Equal contribution}' in content
    assert r'\texttt{step→next}' in content
    engine.prepare_compile_source(main)
    assert main.read_text() == content
    assert content.count('% paper-workspace early Unicode symbol mappings') == 1


def test_subfig_beside_subcaption_drops_the_unused_package(tmp_path):
    main = tmp_path / 'main.tex'
    main.write_text(
        '\\documentclass{article}\n\\usepackage{subfig}\n\\usepackage{graphicx,subcaption}\n'
        '\\begin{document}\\begin{figure}\\begin{subfigure}{.5\\linewidth}x\\end{subfigure}\\end{figure}\\end{document}'
    )
    engine.prepare_compile_source(main)
    prepared = main.read_text()
    assert '% \\usepackage{subfig}' in prepared
    assert '\\usepackage{graphicx,subcaption}' in prepared
    # Running again changes nothing.
    engine.prepare_compile_source(main)
    assert main.read_text() == prepared


def test_subcaption_goes_when_only_subfloat_is_used_and_both_stay_when_both_are(tmp_path):
    main = tmp_path / 'main.tex'
    main.write_text(
        '\\documentclass{article}\n\\usepackage{subfig,subcaption}\n'
        '\\begin{document}\\subfloat{x}\\end{document}'
    )
    engine.prepare_compile_source(main)
    assert '\\usepackage{subfig}' in main.read_text()
    both = (
        '\\documentclass{article}\n\\usepackage{subfig}\n\\usepackage{subcaption}\n'
        '\\begin{document}\\subfloat{x}\\subcaptionbox{a}{b}\\end{document}'
    )
    main.write_text(both)
    engine.prepare_compile_source(main)
    assert '\\usepackage{subfig}\n\\usepackage{subcaption}' in main.read_text()


def test_a_recoverable_error_compiles_again_past_it_once(tmp_path, monkeypatch):
    (tmp_path / 'main.tex').write_text(r'\documentclass{article}\begin{document}x\end{document}')
    commands = []

    def run(command, **kw):
        if command[:2] == ['docker', 'run']:
            commands.append(command)
            if '-f' in command:
                (tmp_path / 'build').mkdir(exist_ok=True)
                (tmp_path / 'build/main.pdf').write_bytes(b'%PDF-1.7')
                return SimpleNamespace(returncode=1, stdout=b'', stderr=b'')
            return SimpleNamespace(returncode=1, stdout=b'./main.tex:3: LaTeX Error: Something recoverable.\n', stderr=b'')
        return SimpleNamespace(returncode=0, stdout=b'', stderr=b'')

    monkeypatch.setattr(engine.subprocess, 'run', run)
    pdf = engine.compile_project(tmp_path)
    assert str(pdf).endswith('main.pdf')
    strict, forced = commands
    assert '-halt-on-error' in strict and '-f' not in strict
    assert '-halt-on-error' not in forced and '-f' in forced
    assert 'max_print_line=10000' in strict


def test_when_the_retry_makes_no_pdf_the_first_error_is_reported(tmp_path, monkeypatch):
    (tmp_path / 'main.tex').write_text(r'\documentclass{article}\begin{document}x\end{document}')
    log = b'./main.tex:3: Package subcaption Error: This package can\'t be used in cooperation with the subfig package.\n'
    monkeypatch.setattr(engine.subprocess, 'run', lambda *a, **kw: SimpleNamespace(returncode=1, stdout=log, stderr=b''))
    with pytest.raises(ValueError, match='subcaption Error'):
        engine.compile_project(tmp_path)


def test_chinese_punctuation_put_inside_a_formula_goes_back_to_ascii():
    fix = engine.ascii_math_punctuation
    displayed = (
        '乐观价值：\\begin{equation}\\frac{\\alpha}{|\\mathcal{N}(s)|}。\\label{eq:x}'
        '\\end{equation}结束。'
    )
    assert fix(displayed) == displayed.replace('|}。', '|}.')
    assert fix('$a，b$ 和 \\[x：y\\]') == '$a,b$ 和 \\[x:y\\]'
    # Text outside formulas, words set with \text inside them, and escaped dollars stay.
    assert fix('即 $x = 0$），我们。') == '即 $x = 0$），我们。'
    assert fix('$\\text{中文，好。} x。$') == '$\\text{中文，好。} x.$'
    assert fix('价格 \\$5。后面 $x$。') == '价格 \\$5。后面 $x$。'


def test_missing_glyphs_are_named(tmp_path, monkeypatch):
    (tmp_path / 'main.tex').write_text(r'\documentclass{article}\begin{document}中文\end{document}')
    (tmp_path / 'build').mkdir()
    (tmp_path / 'build/main.pdf').write_bytes(b'%PDF-1.7')
    log = 'Missing character: There is no 。 ("3002) in font cmr10!'.encode()
    monkeypatch.setattr(engine.subprocess, 'run', lambda *a, **kw: SimpleNamespace(returncode=0, stdout=log, stderr=b''))
    with pytest.raises(ValueError, match='缺失字形：。'):
        engine.compile_project(tmp_path)


def test_curly_quotes_become_ligatures_only_under_8bit_fonts_and_never_beside_chinese(tmp_path):
    main = tmp_path / 'main.tex'
    main.write_text('\\documentclass{article}\n\\usepackage[T1]{fontenc}\n\\begin{document}\nThe agent’s “memory” — here.\n中文“引号”和 agent’s。\n\\end{document}\n')
    (tmp_path / 'main.bbl').write_text('\\bibitem{a} A. Author’s book – 2020.\n')
    engine.prepare_compile_source(main)
    body = main.read_text()
    assert "The agent's ``memory'' --- here." in body
    assert '中文“引号”和 agent’s。' in body
    assert (tmp_path / 'main.bbl').read_text() == "\\bibitem{a} A. Author's book -- 2020.\n"
    plain = tmp_path / 'plain'
    plain.mkdir()
    other = plain / 'main.tex'
    other.write_text('\\documentclass{article}\\begin{document}agent’s\\end{document}')
    engine.prepare_compile_source(other)
    assert 'agent’s' in other.read_text()


def test_an_8bit_encoding_chosen_by_a_bundled_style_counts_too(tmp_path):
    main = tmp_path / 'main.tex'
    main.write_text('\\documentclass{article}\n\\usepackage{journal}\n\\begin{document}agent’s\\end{document}\n')
    (tmp_path / 'journal.sty').write_text('\\usepackage[T1]{fontenc}\n')
    engine.prepare_compile_source(main)
    assert "agent's" in main.read_text()


def test_tectonic_errors_are_reported_by_what_went_wrong(tmp_path, monkeypatch):
    (tmp_path / 'main.tex').write_text(r'\documentclass{article}\begin{document}x\end{document}')
    log = (
        b'warning: main.tex:3: Underfull \\vbox\n'
        b'error: hpdftex.def:207: Undefined control sequence\n'
        b'error: halted on potentially-recoverable error as specified\n'
    )
    monkeypatch.setattr(engine.subprocess, 'run', lambda *a, **kw: SimpleNamespace(returncode=1, stdout=log, stderr=b''))
    with pytest.raises(ValueError, match='hpdftex.def:207: Undefined control sequence'):
        engine.compile_project(tmp_path, tectonic='tectonic', tex_env={})


def test_hangul_and_kana_get_a_fallback_font_only_where_one_exists(tmp_path):
    main = tmp_path / 'main.tex'
    main.write_text('\\documentclass{article}\n\\usepackage[UTF8]{ctex}\n\\begin{document}\n中文 유지\n\\end{document}\n')
    engine.prepare_compile_source(main)
    tex = main.read_text()
    block = tex[tex.index('% open-paper-reader CJK fallback fonts'):tex.index('\\begin{document}')]
    assert '\\@ifpackageloaded{xeCJK}' in block
    assert '\\IfFontExistsTF{Noto Serif CJK KR}' in block
    assert '\\IfFontExistsTF{Apple SD Gothic Neo}' in block
    engine.prepare_compile_source(main)
    assert main.read_text().count('% open-paper-reader CJK fallback fonts') == 1


def test_a_guard_written_by_an_earlier_release_is_made_xetex_safe(tmp_path):
    main = tmp_path / 'main.tex'
    main.write_text('\\documentclass{article}\n\\ifdefined\\pdfoutput\\pdfoutput=1\\fi\n\\begin{document}x\\end{document}\n')
    engine.prepare_compile_source(main)
    assert '\\ifdefined\\XeTeXversion\\else\\ifdefined\\pdfoutput\\pdfoutput=1\\fi\\fi' in main.read_text()


def test_tectonic_missing_glyphs_are_named_from_their_code_points(tmp_path, monkeypatch):
    (tmp_path / 'main.tex').write_text(r'\documentclass{article}\begin{document}中文\end{document}')
    (tmp_path / 'build').mkdir()
    (tmp_path / 'build/main.pdf').write_bytes(b'%PDF-1.7')
    log = 'warning: x:8: Missing character: There is no \ufffd\ufffd (U+C720) in font [Fandol]!'.encode()
    monkeypatch.setattr(engine.subprocess, 'run', lambda *a, **kw: SimpleNamespace(returncode=0, stdout=log, stderr=b''))
    with pytest.raises(ValueError, match='缺失字形：유'):
        engine.compile_project(tmp_path, tectonic='tectonic', tex_env={})
