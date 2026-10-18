import { ReadingModeSwitch } from "./ReadingModeSwitch";
import type { ReadingMode } from "./mode";
import { TranslationMenu, type TranslationMenuProps } from "./TranslationMenu";
import { useModeEntries, type ModeEntriesArgs } from "./useModeEntries";

export interface ModeControlsProps extends Omit<TranslationMenuProps, "modes"> {
  mode: ReadingMode;
  onMode(mode: ReadingMode): void;
  /** The strip is too narrow for the switch: one menu carries the modes and the translation settings. */
  compact: boolean;
}

/**
 * What the paper card's strip holds for reading modes: the switch and the small
 * menu beside it, or, where there is no room for the switch, the one menu.
 */
export function ModeControls({
  mode,
  onMode,
  compact,
  ...menu
}: ModeControlsProps) {
  if (compact)
    return <TranslationMenu {...menu} modes={{ mode, onChange: onMode }} />;
  return (
    <>
      <ReadingModeSwitch mode={mode} onChange={onMode} />
      <TranslationMenu {...menu} />
    </>
  );
}

/**
 * The same entries, for the more menu of a strip with no room even for the one
 * button: the modes, then the translation settings.
 */
export function useFoldedModeEntries({
  mode,
  onMode,
  ...menu
}: Omit<ModeControlsProps, "compact">) {
  const args: ModeEntriesArgs = { ...menu, modes: { mode, onChange: onMode } };
  return useModeEntries(args);
}
