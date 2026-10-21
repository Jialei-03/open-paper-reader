#!/bin/sh
# Installs Open Research Agent from its GitHub releases, as the `ora` command:
#
#   curl -fsSL https://raw.githubusercontent.com/Jialei-03/open-research-agent/main/install.sh | sh
#
# It installs uv (https://docs.astral.sh/uv/) first if it is missing, then the
# latest release's package with `uv tool install`. A version can be given:
# `sh install.sh v0.3.0`. ORA_WHEEL=<path or URL> installs that package instead.
set -eu

REPO="Jialei-03/open-research-agent"
VERSION="${1:-latest}"

say() { printf '%s\n' "$*"; }
fail() { say "安装失败：$*" >&2; exit 1; }

# The assistant and the research agent run on Node.js 20 or newer.
if command -v node >/dev/null 2>&1; then
  major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
  [ "$major" -ge 20 ] || say "提示：需要 Node.js 20 或更新（现在是 $(node -v)），助手和研究功能要用它。"
else
  say "提示：没有找到 Node.js。读论文可以用，助手和研究功能需要 Node.js 20+（https://nodejs.org，或 brew install node）。"
fi

if ! command -v uv >/dev/null 2>&1; then
  say "正在安装 uv（Python 的安装工具）…"
  curl -LsSf https://astral.sh/uv/install.sh | sh
  # Where the uv installer puts it, for the rest of this script.
  PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
  command -v uv >/dev/null 2>&1 || fail "uv 没有装好，请先手动安装：https://docs.astral.sh/uv/"
fi

if [ -n "${ORA_WHEEL:-}" ]; then
  wheel="$ORA_WHEEL"
else
  if [ "$VERSION" = "latest" ]; then
    api="https://api.github.com/repos/$REPO/releases/latest"
  else
    api="https://api.github.com/repos/$REPO/releases/tags/$VERSION"
  fi
  wheel=$(curl -fsSL "$api" | grep -o '"browser_download_url": *"[^"]*\.whl"' | head -n 1 | sed 's/.*"\(https[^"]*\)"/\1/') \
    || fail "读不到 GitHub 上的发布（$api）"
  [ -n "$wheel" ] || fail "这个发布里没有安装包（$api）"
fi

say "正在安装 $wheel …"
uv tool install --force "$wheel"

say ""
say "装好了。运行："
say "  ora"
say "浏览器会打开 http://127.0.0.1:8765。以后更新：重新运行这条安装命令。"
command -v ora >/dev/null 2>&1 || say "（如果提示找不到 ora，先运行 uv tool update-shell，再开一个新的终端。）"
