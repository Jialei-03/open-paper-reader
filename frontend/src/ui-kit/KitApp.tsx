import { useEffect, useState, type ReactNode } from "react";
import { parseAppearance, useAppearance } from "../ui";
import styles from "./KitApp.module.css";

// The kit's own text is not localized: it is a developer page, not the product.
type KitLocale = "zh" | "en";

/** One component's demo. Each task adds its own <Section> to KitApp. */
function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  const headingId = `kit-${id}`;
  return (
    <section aria-labelledby={headingId} className={styles.section}>
      <h2 id={headingId} className={styles.sectionTitle}>
        {title}
      </h2>
      {children}
    </section>
  );
}

const surfaces = [
  "--ui-bg",
  "--ui-bg-1",
  "--ui-bg-2",
  "--ui-bg-3",
  "--ui-elev",
  "--ui-desk",
];
const fills = [
  "--ui-accent",
  "--ui-accent-soft",
  "--ui-primary",
  "--ui-danger",
  "--ui-danger-soft",
  "--ui-highlight",
  "--ui-selection",
];
const texts = [
  "--ui-fg",
  "--ui-fg-1",
  "--ui-fg-2",
  "--ui-fg-3",
  "--ui-accent-text",
  "--ui-danger-text",
  "--ui-success-text",
  "--ui-warning-text",
];
const sizes = [11, 12, 13, 14, 15, 16, 18, 20, 24, 30];
const radii = [4, 6, 8, 10, 12, 16, 20, 24];
const shadows = ["--ui-elev-1", "--ui-elev-2", "--ui-elev-composer"];

function Swatches({ names }: { names: string[] }) {
  return (
    <div className={styles.grid}>
      {names.map((name) => (
        <figure key={name} className={styles.swatch}>
          <div
            className={styles.swatchColor}
            style={{ background: `var(${name})` }}
          />
          <figcaption>{name}</figcaption>
        </figure>
      ))}
    </div>
  );
}

function Tokens() {
  return (
    <Section id="tokens" title="Tokens">
      <h3 className={styles.groupTitle}>Surfaces</h3>
      <Swatches names={surfaces} />
      <h3 className={styles.groupTitle}>Fills</h3>
      <Swatches names={fills} />
      <h3 className={styles.groupTitle}>Text</h3>
      <div className={styles.texts}>
        {texts.map((name) => (
          <p key={name} style={{ color: `var(${name})` }}>
            纸间 Zhijian <code>{name}</code>
          </p>
        ))}
      </div>
      <h3 className={styles.groupTitle}>Type scale</h3>
      <div className={styles.texts}>
        {sizes.map((size) => (
          <p key={size} style={{ fontSize: `var(--ui-text-${size})` }}>
            纸间 Zhijian {size}
          </p>
        ))}
      </div>
      <h3 className={styles.groupTitle}>Radius</h3>
      <div className={styles.grid}>
        {radii.map((radius) => (
          <figure key={radius} className={styles.swatch}>
            <div
              className={styles.swatchColor}
              style={{ borderRadius: `var(--ui-r-${radius})` }}
            />
            <figcaption>--ui-r-{radius}</figcaption>
          </figure>
        ))}
      </div>
      <h3 className={styles.groupTitle}>Elevation</h3>
      <div className={styles.grid}>
        {shadows.map((name) => (
          <figure key={name} className={styles.swatch}>
            <div
              className={styles.elevation}
              style={{ boxShadow: `var(${name})` }}
            />
            <figcaption>{name}</figcaption>
          </figure>
        ))}
      </div>
    </Section>
  );
}

export function KitApp() {
  const { mode, setMode } = useAppearance();
  const [locale, setLocale] = useState<KitLocale>("zh");
  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  }, [locale]);
  return (
    <div className={styles.kit}>
      <header className={styles.toolbar}>
        <h1 className={styles.heading}>UI kit</h1>
        <select
          className={styles.select}
          aria-label="Kit theme"
          value={mode}
          onChange={(event) => setMode(parseAppearance(event.target.value))}
        >
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
        <select
          className={styles.select}
          aria-label="Kit locale"
          value={locale}
          onChange={(event) => setLocale(event.target.value as KitLocale)}
        >
          <option value="zh">中文</option>
          <option value="en">English</option>
        </select>
      </header>
      <main className={styles.main}>
        <Tokens />
      </main>
    </div>
  );
}
