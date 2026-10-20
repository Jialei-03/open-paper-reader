/**
 * Slash commands typed in a composer ("/compact 只留结论"), after pi-web's
 * ChatInput (agegr/pi-web, MIT): a palette opens on "/", filters as the name
 * is typed, and an exact command with its words runs instead of being sent.
 */

export interface SlashCommand {
  /** What follows the slash; may hold a space ("model MiniMax-M3"). */
  name: string;
  description: string;
  /** The palette's group (e.g. "model" for the models one can switch to). */
  group?: string;
  /** Takes words after the name: picking it fills "/name " instead of running. */
  takesArgument?: boolean;
  run(argument: string): void | Promise<void>;
}

/** The query while only a command name is being typed: "/comp" → "comp"; else null. */
export function slashQuery(value: string): string | null {
  if (!value.startsWith("/")) return null;
  const rest = value.slice(1);
  // A space ends the name, except inside a two-word command still being typed.
  return /\n/.test(rest) ? null : rest.toLowerCase();
}

/** Best first: the name starts with the query, then contains it, then the description does. */
function rank(command: SlashCommand, query: string): number {
  const name = command.name.toLowerCase();
  if (!query || name.startsWith(query)) return 0;
  if (name.includes(query)) return 1;
  if (command.description.toLowerCase().includes(query)) return 2;
  return -1;
}

/** The commands the query matches, grouped in the order the groups first appear. */
export function matchCommands(
  commands: SlashCommand[],
  query: string,
): SlashCommand[] {
  const words = query.trim();
  const ranked = commands
    .map((command, index) => ({ command, index, rank: rank(command, words) }))
    .filter((row) => row.rank >= 0);
  const groups = [...new Set(commands.map((c) => c.group ?? ""))];
  return ranked
    .sort(
      (a, b) =>
        groups.indexOf(a.command.group ?? "") -
          groups.indexOf(b.command.group ?? "") ||
        a.rank - b.rank ||
        a.index - b.index,
    )
    .map((row) => row.command);
}

/** The command a message invokes and the words after it, or null (it is a message). */
export function parseCommand(
  value: string,
  commands: SlashCommand[],
): { command: SlashCommand; argument: string } | null {
  const text = value.trim();
  if (!text.startsWith("/")) return null;
  // The longest name that the text is, or starts with followed by a space.
  const found = [...commands]
    .sort((a, b) => b.name.length - a.name.length)
    .find((c) => text === `/${c.name}` || text.startsWith(`/${c.name} `));
  if (!found) return null;
  const argument = text.slice(found.name.length + 1).trim();
  if (argument && !found.takesArgument) return null;
  return { command: found, argument };
}
