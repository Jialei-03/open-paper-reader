import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import {
  matchCommands,
  parseCommand,
  slashQuery,
  type SlashCommand,
} from "../lib/slash";
import styles from "./SlashMenu.module.css";

/**
 * A composer's slash commands (after pi-web's ChatInput, MIT): the palette
 * over the field while a command name is typed, the arrows and Enter/Tab to
 * pick, Escape to close, and an exact command run instead of being sent.
 */
export function useSlashCommands({
  value,
  onChange,
  commands,
}: {
  value: string;
  onChange(value: string): void;
  commands: SlashCommand[] | undefined;
}) {
  const [active, setActive] = useState(0);
  const [closedFor, setClosedFor] = useState<string | null>(null);
  const query = commands?.length ? slashQuery(value) : null;
  const matches = useMemo(
    () => (query === null || !commands ? [] : matchCommands(commands, query)),
    [commands, query],
  );
  const open = matches.length > 0 && closedFor !== value;
  useEffect(() => setActive(0), [query]);

  const run = (command: SlashCommand, argument: string) => {
    onChange("");
    void command.run(argument);
  };
  const pick = (command: SlashCommand) => {
    if (command.takesArgument && query !== command.name.toLowerCase())
      onChange(`/${command.name} `);
    else run(command, "");
  };

  return {
    open,
    /** Runs the command the text is, if it is one; true when it did (nothing to send). */
    submit(): boolean {
      const found = commands ? parseCommand(value, commands) : null;
      if (!found) return false;
      run(found.command, found.argument);
      return true;
    },
    /** True when the key was the palette's (the composer does nothing more with it). */
    onKeyDown(event: KeyboardEvent): boolean {
      if (!open || event.nativeEvent.isComposing) return false;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActive((n) => (n + step + matches.length) % matches.length);
      } else if (
        (event.key === "Enter" && !event.shiftKey) ||
        event.key === "Tab"
      ) {
        pick(matches[Math.min(active, matches.length - 1)]);
      } else if (event.key === "Escape") {
        setClosedFor(value);
      } else return false;
      event.preventDefault();
      return true;
    },
    menu: open ? (
      <SlashMenu
        commands={matches}
        active={Math.min(active, matches.length - 1)}
        onHover={setActive}
        onPick={pick}
      />
    ) : null,
  };
}

function SlashMenu({
  commands,
  active,
  onHover,
  onPick,
}: {
  commands: SlashCommand[];
  active: number;
  onHover(index: number): void;
  onPick(command: SlashCommand): void;
}) {
  return (
    <div className={styles.menu} role="listbox" data-testid="slash-menu">
      {commands.map((command, index) => (
        <div
          key={command.name}
          role="option"
          aria-selected={index === active}
          className={styles.item}
          // The field keeps the focus: pressing an item must not blur it.
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => onHover(index)}
          onClick={() => onPick(command)}
        >
          <span className={styles.name}>/{command.name}</span>
          <span className={styles.description}>{command.description}</span>
        </div>
      ))}
    </div>
  );
}
