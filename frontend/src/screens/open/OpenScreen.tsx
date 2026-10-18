import { useCallback, useEffect, useRef, useState } from "react";
import type { Paper } from "../../api";
import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/i18n";
import { importUrl, type ImportProgress } from "../../lib/arxiv-import";
import { Button, Card, Spinner } from "../../ui";
import styles from "./OpenScreen.module.css";

const STAGES: Record<string, MessageKey> = {
  metadata: "import.stage.metadata",
  checking: "import.stage.checking",
  pdf: "import.stage.pdf",
  saving: "import.stage.saving",
};

/**
 * `#open?url=…`, the address the browser extension (or a bookmarklet) sends:
 * imports the paper at that address, shows how far it is, and opens it in the
 * reader. A paper that is already in the library is simply opened.
 */
export function OpenScreen({
  url,
  go,
  reload,
}: {
  url: string;
  go(hash: string): void;
  reload(): void;
}) {
  const { t } = useI18n();
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const started = useRef("");

  useEffect(() => {
    // One import per address and attempt (the effect may run twice in development).
    const key = `${url}#${attempt}`;
    if (started.current === key) return;
    started.current = key;
    setError("");
    setProgress(null);
    importUrl(url, setProgress).then(
      (paper: Paper) => {
        reload();
        // Replace this address so that "back" does not import again.
        location.replace("#read/" + paper.id);
      },
      (failure) =>
        setError(failure instanceof Error ? failure.message : String(failure)),
    );
  }, [url, attempt, reload]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const stage = progress?.stage ?? "metadata";
  return (
    <div className={styles.root}>
      <Card as="main" className={styles.card} aria-labelledby="open-title">
        <h1 id="open-title" className={styles.title}>
          {error ? t("open.failed") : t("open.title")}
        </h1>
        <p className={styles.address}>{url}</p>
        {error ? (
          <>
            <p className={styles.error} role="alert">
              {error}
            </p>
            <div className={styles.actions}>
              <Button onClick={() => go("home")}>{t("open.home")}</Button>
              <Button variant="primary" onClick={retry}>
                {t("import.retry")}
              </Button>
            </div>
          </>
        ) : (
          <p className={styles.stage} role="status">
            <Spinner size={14} />
            {t(STAGES[stage] ?? "import.stage.working")}
          </p>
        )}
      </Card>
    </div>
  );
}
