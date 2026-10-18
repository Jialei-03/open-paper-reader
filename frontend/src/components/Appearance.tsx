import { Monitor, Moon, Sun } from "lucide-react";
import { useAppearance, type Appearance } from "../ui/theme";

// The mode, its storage and the theme it applies live in ui/theme (imported
// from that file, not ui/index, so the old interface does not pick up the new
// tokens and fonts). It stays exported from here for the entries that use it.
export { useAppearance };

const modes: Appearance[] = ["system", "light", "dark"];
const labels = { system: "跟随系统", light: "浅色", dark: "深色" };
export function AppearanceSettings() {
  const { mode, setMode } = useAppearance();
  return (
    <section aria-labelledby="appearance-title">
      <h2 id="appearance-title">外观</h2>
      <p className="muted">
        选择此设备上的显示模式。跟随系统会随系统外观自动切换。
      </p>
      <div
        className="appearance-options"
        role="radiogroup"
        aria-label="显示模式"
      >
        {modes.map((value) => {
          const Icon =
            value === "system" ? Monitor : value === "dark" ? Moon : Sun;
          return (
            <label className="appearance-option" key={value}>
              <input
                type="radio"
                name="appearance"
                value={value}
                checked={mode === value}
                onChange={() => setMode(value)}
              />
              <Icon aria-hidden="true" />
              {labels[value]}
            </label>
          );
        })}
      </div>
    </section>
  );
}
