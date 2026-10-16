import { useEffect, useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

type Appearance = "system" | "light" | "dark";
const modes: Appearance[] = ["system", "light", "dark"];
const labels = { system: "跟随系统", light: "浅色", dark: "深色" };
function stored(): Appearance {
  try {
    const value = localStorage.getItem("paper-appearance") as Appearance;
    return modes.includes(value) ? value : "system";
  } catch {
    return "system";
  }
}
let current = stored();
const listeners = new Set<() => void>();
function apply(mode: Appearance) {
  const dark =
    mode === "dark" ||
    (mode === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}
function publish(mode: Appearance) {
  current = mode;
  apply(mode);
  listeners.forEach((listener) => listener());
}
window.addEventListener("storage", (event) => {
  if (event.key === "paper-appearance" || event.key === null) publish(stored());
});
apply(current);
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function setMode(mode: Appearance) {
  try {
    localStorage.setItem("paper-appearance", mode);
  } catch {
    /* Remain usable without storage. */
  }
  publish(mode);
}
export function useAppearance() {
  const mode = useSyncExternalStore(subscribe, () => current);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => apply(current);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return { mode, setMode };
}
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
