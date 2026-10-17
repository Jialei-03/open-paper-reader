import type { ReactNode } from "react";
import { I18nProvider, useI18n } from "../i18n/I18nProvider";
import { isLocale } from "../i18n/i18n";
import { parseAppearance, useAppearance } from "../ui";
import styles from "./KitApp.module.css";

// The kit's own chrome (headings, labels) is not localized: it is a developer
// page, not the product. Only the demos of localized components are.

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

function I18nDemo() {
  const { tn } = useI18n();
  return (
    <Section id="i18n" title="I18n">
      <p>{tn("kit.sample.pages", 1)}</p>
      <p>{tn("kit.sample.pages", 3)}</p>
    </Section>
  );
}

function Kit() {
  const { mode, setMode } = useAppearance();
  const { locale, setLocale } = useI18n();
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
          onChange={(event) => {
            if (isLocale(event.target.value)) setLocale(event.target.value);
          }}
        >
          <option value="zh">中文</option>
          <option value="en">English</option>
        </select>
      </header>
      <main className={styles.main}>
        <Tokens />
        <I18nDemo />
      </main>
    </div>
  );
}

export function KitApp() {
  return (
    <I18nProvider>
      <Kit />
    </I18nProvider>
  );
}
