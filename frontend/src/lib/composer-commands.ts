import type { MessageKey } from "../i18n/i18n";
import type { SlashCommand } from "./slash";
import type { ModelRow } from "../screens/setup/model-api";

type T = (key: MessageKey, values?: Record<string, string | number>) => string;

/** "/model <name>" for each model there is to go on with (the current one marked). */
export function modelCommands(
  t: T,
  models: ModelRow[],
  current: string | null | undefined,
  choose: (id: string) => void | Promise<void>,
): SlashCommand[] {
  return models.map((row) => ({
    name: `model ${row.name || row.model}`,
    description: t(
      row.id === current ? "commands.model.current" : "commands.model",
    ),
    group: "model",
    run: () => choose(row.id),
  }));
}

/** "/copy": the last answer to the clipboard. */
export function copyCommand(t: T, last: () => string): SlashCommand {
  return {
    name: "copy",
    description: t("commands.copy"),
    run: () => navigator.clipboard?.writeText(last()),
  };
}

/** How full the conversation's context is, the way pi-web shows it: "32k / 128k". */
export function contextStatus(
  t: T,
  context: { tokens?: number | null; contextWindow?: number } | undefined,
): string {
  if (!context?.contextWindow || context.tokens == null) return "";
  const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`);
  return t("commands.context", {
    used: k(context.tokens),
    window: k(context.contextWindow),
  });
}
