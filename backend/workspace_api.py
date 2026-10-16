"""Business API discovery and dispatch boundaries for the workspace Agent."""

import re
from urllib.parse import urlsplit

ROOTS = {
    "papers",
    "storage-usage",
    "model-usage",
    "storage-files",
    "items",
    "history",
    "dashboard",
    "research-directions",
    "research-profile",
    "discovery",
    "recommendations",
    "translations",
    "arxiv",
    "library-collections",
    "reading-artifacts",
}


def catalog(app):
    return {
        path.removeprefix("/api/v1"): ops
        for path, ops in app.openapi()["paths"].items()
        if path.startswith("/api/v1/")
        and (path.split("/")[3] in ROOTS or re.fullmatch(r"/api/v1/files/\{[^}]+\}/annotations(?:/\{[^}]+\})?", path))
        and not path.endswith(("/files", "/images"))
    }


def operation(app, path, method):
    url = urlsplit(path)
    if (
        url.scheme
        or url.netloc
        or url.fragment
        or "%" in url.path
        or not path.startswith("/")
    ):
        raise ValueError("只能使用工作台业务 API 路径")
    for template, ops in catalog(app).items():
        pattern = re.sub(r"\\\{[^}]+\\\}", r"[^/]+", re.escape(template))
        if re.fullmatch(pattern, url.path) and method.lower() in ops:
            return ops[method.lower()]
    raise ValueError(
        "此路径或方法不属于允许的工作台业务 API；不能访问账号、密钥或服务器"
    )


def describe(app, path="", method="GET"):
    if not path:
        return {
            "operations": [
                {"path": p, "methods": list(ops)} for p, ops in catalog(app).items()
            ],
            "usage": "先按 path/method 查询参数格式，再调用 workspace_read 或 workspace_write；修改仍需当前 revision。",
        }
    value = operation(app, path, method)
    schemas = app.openapi().get("components", {}).get("schemas", {})
    needed = {}

    def refs(obj):
        if isinstance(obj, dict):
            ref = obj.get("$ref", "").removeprefix("#/components/schemas/")
            if ref in schemas and ref not in needed:
                needed[ref] = schemas[ref]
                refs(schemas[ref])
            for v in obj.values():
                refs(v)
        elif isinstance(obj, list):
            for v in obj:
                refs(v)

    refs(value)
    return {"operation": value, "schemas": needed}
