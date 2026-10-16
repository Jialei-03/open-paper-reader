# Adapted from NiuTrans/LaTeXTrans, MIT; see NOTICE.md.
import os, re, json, regex
from pathlib import Path
options = r"\[[^\[\]]*?\]"
spaces = r"[ \t]*"
get_pattern_brace = lambda index: rf"\{{((?:[^{{}}]++|(?{index}))*+)\}}"

def get_pattern_command_full(name, n=None):
    pattern = f'\\\\({name})'
    if n is None:
        pattern += f'{spaces}({options})?'
        n = 1
        begin_brace = 3
    else:
        begin_brace = 2
    for i in range(n):
        tmp = get_pattern_brace(i * 2 + begin_brace)
        pattern += f'{spaces}({tmp})'
    if n == 0:
        pattern += '(?=[^a-zA-Z])'
    return pattern

def loop_files(dir):
    all_files = []
    for root, dirs, files in os.walk(dir):
        for file in files:
            all_files.append(os.path.join(root, file))
    return all_files

def read_tex_file(path):
    with open(path, 'r', encoding='utf-8') as f:
        latex_code = f.read()
    return latex_code

def read_json_file(path):
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    return data

def find_tex_files(dir):
    all_files = loop_files(dir)
    tex_files = [f for f in all_files if f.endswith('.tex')]
    return tex_files

def remove_comments(tex: str) -> str:
    """
    Remove both % line comments and \\begin{comment} ... \\end{comment} blocks from LaTeX code.
    """
    tex = re.sub('\\\\begin\\s*\\{comment\\}.*?\\\\end\\s*\\{comment\\}', '', tex, flags=re.DOTALL)
    lines = tex.splitlines()
    cleaned = []
    for line in lines:
        stripped_line = line.lstrip()
        if re.match('^(?<!\\\\)%', stripped_line):
            continue
        line = re.sub('(?<!\\\\)%.*', '', line)
        cleaned.append(line.rstrip())
    return '\n'.join(cleaned)

def compress_newlines(tex):
    """
    Replace consecutive newlines (including spaces) exceeding four with exactly two newlines.

    Args:
        content (str): The input string to process.

    Returns:
        str: The processed string with normalized newlines.
    """
    return re.sub('(\\s*\\n\\s*){3,}', '\n\n', tex)

def get_env_pattern(command_name):
    """
    Get the regex pattern for matching environments.
    """
    get_command_env = lambda name: f'\\\\begin{spaces}\\{{(?!document\\b|center\\b|proof\\b|multicols\\b)({name})\\}}{spaces}({options})?(.*?)\\\\end{spaces}\\{{\\1\\}}'
    command_env = get_command_env(command_name)
    env_pattern = regex.compile(command_env, regex.DOTALL)
    return env_pattern

def get_begin_document_pattern():
    """
    Get the regex pattern for matching \x08egin{document} command.
    """
    pattern = regex.compile('\\\\begin\\s*\\{\\s*document\\s*\\}', regex.DOTALL)
    return pattern

def get_newcommand_pattern():
    """
    Get the regex pattern for matching 
ewcommand commands.
    """
    newcommand = f'\\\\(?:newcommand\\*?|def|renewcommand|newenvironment|renewenvironment){spaces}(?:\\{{\\\\([a-zA-Z]+)\\}}|\\\\([a-zA-Z]+)){spaces}(?:\\[(\\d)\\])?{spaces}({get_pattern_brace(4)})'
    newcommand_pattern = regex.compile(newcommand, regex.DOTALL)
    return newcommand_pattern

def get_command_pattern(name):
    """
    Get the regex pattern for matching LaTeX commands.
    """
    command = get_pattern_command_full(name)
    command_pattern = regex.compile(command, regex.DOTALL)
    return command_pattern

def add_ctex_package(latex_code):
    if '\\usepackage[UTF8]{ctex}' not in latex_code:
        ctex_package = '\\usepackage[UTF8]{ctex}'
        documentclass = 'documentclass'
        documentclass_pattern = get_command_pattern(documentclass)
        match = documentclass_pattern.search(latex_code)
        if match:
            position = match.end()
            latex_code = latex_code[:position] + '\n' + ctex_package + '\n' + latex_code[position:]
    return latex_code

def find_main_tex_file(dir):
    """
    Find the main LaTeX file in the given directory.
    """
    readme_path = os.path.join(dir, '00README.json')
    if os.path.exists(readme_path):
        config = read_json_file(readme_path)
        for source in config.get('sources', []):
            if source.get('usage') == 'toplevel':
                main_file_name = source.get('filename')
                main_file_path = os.path.join(dir, main_file_name)
                if not Path(main_file_path).resolve().is_relative_to(Path(dir).resolve()):
                    raise ValueError('Unsafe main file path')
                return main_file_path if os.path.exists(main_file_path) else None
    tex_files = find_tex_files(dir)
    documentclass_pattern = re.compile('\\\\document(class|style)(\\[.*?\\])?\\{.*?\\}', re.DOTALL)
    for tex_file in tex_files:
        with open(tex_file, 'r', encoding='utf-8') as f:
            latex_code = f.read()
        latex_code = remove_comments(latex_code)
        if not documentclass_pattern.search(latex_code):
            continue
        return tex_file
    return None
