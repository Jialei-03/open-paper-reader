"""Keyword search using the discovery/recommendation transports and parsers."""

import xml.etree.ElementTree as ET

import httpx

from . import discovery, recommendations, scholar


def search(query, source="all", limit=10):
    query = str(query or "").strip()
    if (
        not query
        or len(query) > 300
        or source not in {"all", "arxiv", "openalex", "semantic_scholar"}
    ):
        raise ValueError("检索参数不合法 / Invalid search parameters")
    if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= 20:
        raise ValueError("结果数量须为 1–20 / Limit must be 1–20")
    rows, errors = [], []
    for provider in ("arxiv", "openalex", "semantic_scholar"):
        if source not in {"all", provider}:
            continue
        try:
            if provider == "arxiv":
                found = [
                    {
                        **item,
                        "authors": item["authors"].split("; "),
                        "year": int(item["published"][:4])
                        if item["published"][:4].isdigit()
                        else None,
                        "arxiv": item["external_id"][6:],
                        "citation_count": None,
                    }
                    for item in discovery.fetch_arxiv([query])[:limit]
                ]
            else:
                if provider == "openalex":
                    data = scholar._json(
                        recommendations.OPENALEX, {"search": query, "per-page": limit}
                    )
                    found = [
                        scholar._from_openalex(item)
                        for item in (data or {}).get("results", [])
                    ]
                else:
                    data = scholar._json(
                        "https://api.semanticscholar.org/graph/v1/paper/search",
                        {
                            "query": query,
                            "limit": limit,
                            "fields": recommendations.S2_FIELDS,
                        },
                    )
                    found = [
                        scholar._from_s2(item) for item in (data or {}).get("data", [])
                    ]
            rows.extend(
                {**recommendations._shown(item), "source": provider}
                for item in found
                if item.get("title")
            )
        except (
            scholar.ScholarUnavailable,
            httpx.HTTPError,
            ET.ParseError,
            ValueError,
            TypeError,
            KeyError,
        ) as error:
            errors.append(f"{provider}: {error}")
    if errors and not rows:
        raise ValueError("学术检索失败 / Academic search failed: " + "; ".join(errors))
    unique = {}
    for row in rows:
        key = recommendations.primary_key(row) or row["url"]
        unique.setdefault(key, row)
    return {"papers": list(unique.values())[:limit], "errors": errors}
