import { ArrowRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n/I18nProvider";
import { Button, Card } from "../ui";
import { ModelForm } from "./setup/ModelForm";
import { allowsLocal, readModels, type ModelSettings } from "./setup/model-api";
import styles from "./setup/SetupScreen.module.css";

/**
 * The first thing seen while there is no model to read with: one card on the
 * window's background that says why, the ways to connect a model, and a test
 * that has to pass before going on.
 */
export function SetupScreen({ onDone }: { onDone(): void }) {
  const { t } = useI18n();
  const [settings, setSettings] = useState<ModelSettings | null>(null);
  const [connected, setConnected] = useState(false);
  const next = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    readModels(controller.signal).then(setSettings, () => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (connected) next.current?.focus();
  }, [connected]);

  return (
    <div className={styles.root}>
      <Card as="main" className={styles.card} aria-labelledby="setup-title">
        <header className={styles.header}>
          <h1 id="setup-title" className={styles.title}>
            {t("setup.title")}
          </h1>
          <p className={styles.lead}>{t("setup.lead")}</p>
        </header>
        <ModelForm
          local={allowsLocal(settings)}
          connected={connected}
          onConnected={() => setConnected(true)}
        />
        <footer className={styles.footer}>
          <Button
            ref={next}
            variant="primary"
            icon={ArrowRight}
            disabled={!connected}
            onClick={onDone}
          >
            {t("setup.continue")}
          </Button>
        </footer>
      </Card>
    </div>
  );
}
