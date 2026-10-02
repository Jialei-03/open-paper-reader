#!/usr/bin/env bash
# 为本机开发环境配置共享模型：把一个模型服务写入 data/platform-model.json
# （已在 .gitignore 中，权限 0600）。密钥通过不回显的提示输入，不会留在命令历史里。
#
#   scripts/set-local-model.sh
#   BASE_URL=https://api.openai.com/v1 MODEL=gpt-4.1-mini scripts/set-local-model.sh
#
# 可用环境变量：BASE_URL、MODEL、PROTOCOL（openai 或 anthropic，默认 openai）、
# VISION（true 表示模型能识图，默认 false）。格式见 docs/CONFIGURATION.md。
set -euo pipefail
cd "$(dirname "$0")/.."

BASE_URL="${BASE_URL:-}"
MODEL="${MODEL:-}"
PROTOCOL="${PROTOCOL:-openai}"
VISION="${VISION:-false}"

[[ -n "$BASE_URL" ]] || read -r -p "接口地址（如 https://api.openai.com/v1）: " BASE_URL
[[ -n "$MODEL" ]] || read -r -p "模型名称（如 gpt-4.1-mini）: " MODEL
read -rs -p "API Key（不回显）: " KEY
echo
[[ -n "$BASE_URL" && -n "$MODEL" && -n "$KEY" ]] || { echo "接口地址、模型名称和密钥都不能为空，未写入。" >&2; exit 1; }

mkdir -p data
umask 077
BASE_URL="$BASE_URL" MODEL="$MODEL" PROTOCOL="$PROTOCOL" VISION="$VISION" KEY="$KEY" python3 - <<'PY'
import json
import os

json.dump(
    {
        "enabled": True,
        "name": os.environ["MODEL"],
        "base_url": os.environ["BASE_URL"],
        "protocol": os.environ["PROTOCOL"],
        "model": os.environ["MODEL"],
        "api_key": os.environ["KEY"],
        "vision": os.environ["VISION"].lower() == "true",
    },
    open("data/platform-model.json", "w"),
    indent=2,
    ensure_ascii=False,
)
PY
chmod 600 data/platform-model.json
echo "已写入 data/platform-model.json。重启 API 与 agent worker 后生效。"
echo "提示：服务端只允许内置名单里的主机；其他主机名需加入 TRANSLATION_ALLOWED_HOSTS。"
