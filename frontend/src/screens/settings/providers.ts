import type { Protocol, ModelRow } from "../setup/model-api";

/** A service the import form can fill in the address of. */
export interface Preset {
  id: string;
  /** Proper names are shown as they are; the custom entry is translated. */
  label: string;
  protocol: Protocol;
  base_url: string;
  /** A model server on this computer: no key, and only where the service allows it. */
  local?: boolean;
}

export const CUSTOM = "custom";

export const PRESETS: Preset[] = [
  {
    id: "openai",
    label: "OpenAI",
    protocol: "openai",
    base_url: "https://api.openai.com/v1",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    protocol: "anthropic",
    base_url: "https://api.anthropic.com",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    protocol: "openai",
    base_url: "https://openrouter.ai/api/v1",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    protocol: "openai",
    base_url: "https://api.deepseek.com/v1",
  },
  {
    id: "moonshot",
    label: "Moonshot",
    protocol: "openai",
    base_url: "https://api.moonshot.cn/v1",
  },
  {
    id: "zhipu",
    label: "Zhipu",
    protocol: "openai",
    base_url: "https://open.bigmodel.cn/api/paas/v4",
  },
  {
    id: "ollama",
    label: "Ollama",
    protocol: "openai",
    base_url: "http://127.0.0.1:11434/v1",
    local: true,
  },
  {
    id: "lmstudio",
    label: "LM Studio",
    protocol: "openai",
    base_url: "http://127.0.0.1:1234/v1",
    local: true,
  },
];

export function hostOf(address: string): string {
  try {
    return new URL(address).host;
  } catch {
    return address;
  }
}

/** The models whose name contains the words typed (any case, any order). */
export function searchModels(names: string[], query: string): string[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return words.length === 0
    ? names
    : names.filter((name) => {
        const lower = name.toLowerCase();
        return words.every((word) => lower.includes(word));
      });
}

/** The saved models by the service they belong to, in the order the services first appear. */
export function groupByHost(
  rows: ModelRow[],
): { host: string; rows: ModelRow[] }[] {
  const groups = new Map<string, ModelRow[]>();
  for (const row of rows) {
    const host = row.shared ? "" : hostOf(row.base_url);
    groups.set(host, [...(groups.get(host) ?? []), row]);
  }
  return [...groups].map(([host, list]) => ({ host, rows: list }));
}

/** The model of `rows` that a draft's address and name already is (same service, same name). */
export function isOwned(
  rows: ModelRow[],
  base_url: string,
  model: string,
): boolean {
  const same = (a: string, b: string) =>
    a.trim().replace(/\/+$/, "") === b.trim().replace(/\/+$/, "");
  return rows.some(
    (row) => !row.shared && row.model === model && same(row.base_url, base_url),
  );
}
