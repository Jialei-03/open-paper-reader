import { Check, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/i18n";
import { Button, Spinner, toast } from "../../ui";
import {
  readPlaybook,
  reviewRule,
  sortRules,
  type Playbook,
  type PlaybookRule,
} from "./playbook";
import styles from "./Playbook.module.css";

/**
 * The research playbook: the judgment rules distilled from finished projects.
 * Active rules are read by every new project; pending ones wait for a second
 * project, or for the researcher to admit or drop them here.
 */
export function PlaybookPanel() {
  const { t } = useI18n();
  const [book, setBook] = useState<Playbook | null>(null);
  const [busy, setBusy] = useState("");
  const [reads, setReads] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setError("");
    readPlaybook().then(
      (value) => {
        if (cancelled) return;
        setBook(value);
      },
      (reason: unknown) => {
        if (cancelled) return;
        setError(
          reason instanceof Error && reason.message
            ? reason.message
            : t("settings.loadError"),
        );
      },
    );
    return () => {
      cancelled = true;
    };
  }, [reads, t]);

  if (error)
    return (
      <section className={styles.playbook}>
        <p className={styles.hint} role="alert">
          {error}
        </p>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setReads((n) => n + 1)}
        >
          {t("common.retry")}
        </Button>
      </section>
    );
  if (!book)
    return (
      <section className={styles.playbook} aria-label={t("common.loading")}>
        <Spinner />
        <p className={styles.hint}>{t("common.loading")}</p>
      </section>
    );
  const rules = sortRules(book.rules);

  const review = async (rule: PlaybookRule, approve: boolean) => {
    setBusy(rule.id);
    try {
      await reviewRule(rule.id, approve);
      setReads((n) => n + 1);
    } catch (error) {
      toast.show({
        message: error instanceof Error ? error.message : String(error),
        tone: "error",
      });
    } finally {
      setBusy("");
    }
  };

  return (
    <section className={styles.playbook} aria-labelledby="playbook-title">
      <h2 id="playbook-title" className={styles.sectionTitle}>
        {t("research.playbook.title", { version: book.version })}
      </h2>
      <p className={styles.hint}>{t("research.playbook.intro")}</p>
      {rules.length === 0 ? (
        <p className={styles.hint}>{t("research.playbook.empty")}</p>
      ) : (
        <ul className={styles.rules}>
          {rules.map((rule) => (
            <li key={rule.id} className={styles.rule} data-status={rule.status}>
              <div className={styles.ruleHead}>
                <span className={styles.state} data-status={rule.status}>
                  {t(`research.playbook.${rule.status}` as MessageKey)}
                </span>
                <span className={styles.hint}>
                  {t("research.playbook.meta", {
                    sources: rule.sources.length,
                    helpful: rule.helpful,
                    harmful: rule.harmful,
                  })}
                </span>
              </div>
              <p>
                <strong>{t("research.playbook.when")}</strong> {rule.when}
              </p>
              <p>
                <strong>{t("research.playbook.do")}</strong> {rule.do}
              </p>
              <p className={styles.hint}>{rule.why}</p>
              {rule.status === "pending" && (
                <div className={styles.actions}>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={X}
                    disabled={busy === rule.id}
                    onClick={() => void review(rule, false)}
                  >
                    {t("research.playbook.drop")}
                  </Button>
                  <Button
                    size="sm"
                    icon={Check}
                    loading={busy === rule.id}
                    onClick={() => void review(rule, true)}
                  >
                    {t("research.playbook.admit")}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
