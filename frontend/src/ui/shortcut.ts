// Keyboard shortcuts as plain strings, e.g. "mod+k" or "shift+enter".
//
// A spec is lower case, joined by "+": any of `mod` (Command on a Mac, Ctrl
// elsewhere), `shift`, `alt`, then the key: `enter`, `escape`, or a single
// printable character ("k", "1", "\", "/", "." and "+" itself, written "mod++").
// The key is compared with `event.key`, so a spec names the character the key
// types: a symbol that needs Shift to type (such as "?") is not supported.

/** Apple platforms show symbols and use Command; all others use Ctrl. */
export function isMacPlatform(platform: string): boolean {
  return /Mac|iPhone|iPad/.test(platform);
}

interface Parsed {
  mod: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
}

function parse(spec: string): Parsed {
  const tokens = spec.toLowerCase().split("+");
  // "mod++" and "+" split into empty tokens at the end: the key is "+" itself.
  const key = tokens.pop() || "+";
  return {
    mod: tokens.includes("mod"),
    shift: tokens.includes("shift"),
    alt: tokens.includes("alt"),
    key,
  };
}

function keyLabel({ key }: Parsed, mac: boolean, alone: boolean): string {
  if (key === "enter") return mac || alone ? "↵" : "Enter";
  if (key === "escape") return "Esc";
  return /^[a-z]$/.test(key) ? key.toUpperCase() : key;
}

/**
 * The shortcut as shown to people. On a Mac the symbols sit together in the
 * system's order (`⌥⇧⌘K`); elsewhere the words are joined by "+" (`Ctrl+Alt+Shift+K`).
 */
export function formatShortcut(spec: string, mac: boolean): string {
  const parsed = parse(spec);
  const alone = !parsed.mod && !parsed.shift && !parsed.alt;
  const key = keyLabel(parsed, mac, alone);
  if (mac)
    return (
      (parsed.alt ? "⌥" : "") +
      (parsed.shift ? "⇧" : "") +
      (parsed.mod ? "⌘" : "") +
      key
    );
  return [
    parsed.mod && "Ctrl",
    parsed.alt && "Alt",
    parsed.shift && "Shift",
    key,
  ]
    .filter(Boolean)
    .join("+");
}

/** Whether a key event is this shortcut. The modifiers must match exactly: an extra one does not count. */
export function matchesShortcut(
  event: Pick<
    KeyboardEvent,
    "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey"
  >,
  spec: string,
  mac: boolean,
): boolean {
  const parsed = parse(spec);
  return (
    event.key.toLowerCase() === parsed.key &&
    event.metaKey === (mac && parsed.mod) &&
    event.ctrlKey === (!mac && parsed.mod) &&
    event.shiftKey === parsed.shift &&
    event.altKey === parsed.alt
  );
}
