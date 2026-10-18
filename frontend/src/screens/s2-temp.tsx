// TEMP S2: mounts the home and library screens at #home2 / #library2 for S2's
// browser tests until S1's shell mounts them. The controller deletes this file.
import type { Paper } from "../api";
import { I18nProvider } from "../i18n/I18nProvider";
import { Shell } from "../ui";
import { HomeScreen } from "./HomeScreen";
import { LibraryScreen } from "./LibraryScreen";

export default function S2Screens(props: {
  screen: string;
  owner: string;
  papers: Paper[];
  go(hash: string): void;
  reload(): void;
}) {
  const Screen = props.screen === "home2" ? HomeScreen : LibraryScreen;
  return (
    <I18nProvider>
      <Shell>
        <Screen {...props} />
      </Shell>
    </I18nProvider>
  );
}
