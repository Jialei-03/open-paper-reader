import { BookOpen, Check, MoreHorizontal, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/i18n";
import { Button, Dialog, IconButton, Menu, toast } from "../../ui";
import {
  readPlaybook,
  reviewRule,
  sortRules,
  type Playbook,
  type PlaybookRule,
} from "./playbook";
import { CustomizeHeader } from "../customize/CustomizeHeader";
import layout from "../customize/CustomizeScreen.module.css";

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
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<PlaybookRule | null>(null);

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

  const header = (
    <CustomizeHeader
      title={t("customize.playbook")}
      query={query}
      onQuery={setQuery}
      status={
        book ? t("customize.version", { version: book.version }) : undefined
      }
    />
  );

  if (error)
    return (
      <>
        {header}
        <section className={layout.fields}>
          <p className={layout.status} role="alert">
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
      </>
    );
  if (!book)
    return (
      <>
        {header}
        <section className={layout.fields} aria-label={t("common.loading")}>
          <p className={layout.status}>{t("common.loading")}</p>
        </section>
      </>
    );
  const rules = sortRules(book.rules, true);

  const review = async (rule: PlaybookRule, approve: boolean) => {
    setBusy(rule.id);
    try {
      await reviewRule(rule.id, approve);
      setReads((n) => n + 1);
      setSelected(null);
    } catch (error) {
      toast.show({
        message: error instanceof Error ? error.message : String(error),
        tone: "error",
      });
    } finally {
      setBusy("");
    }
  };

  const q = query.trim().toLowerCase();
  const rows = rules.filter((rule) =>
    `${rule.when} ${rule.do} ${rule.why} ${t(rule.status === "pending" ? "customize.pending" : (`research.playbook.${rule.status}` as MessageKey))}`
      .toLowerCase()
      .includes(q),
  );
  return (
    <>
      {header}
      <ul className={layout.list}>
        {rows.map((rule) => (
          <li key={rule.id} className={layout.row}>
            <BookOpen className={layout.icon} size={22} aria-hidden />
            <button
              className={layout.rowButton}
              onClick={() => setSelected(rule)}
            >
              <span className={layout.name}>{rule.do}</span>
              <span className={layout.status}>
                {t(
                  rule.status === "pending"
                    ? "customize.pending"
                    : (`research.playbook.${rule.status}` as MessageKey),
                )}
              </span>
            </button>
            <Menu
              label={t("customize.more", { name: rule.do })}
              placement={{ side: "bottom", align: "end" }}
              items={[
                {
                  id: "view",
                  label: t("customize.view"),
                  onSelect: () => setSelected(rule),
                },
              ]}
              trigger={(props) => (
                <IconButton
                  {...props}
                  icon={MoreHorizontal}
                  label={t("customize.more", { name: rule.do })}
                />
              )}
            />
          </li>
        ))}
        {!rows.length && (
          <li className={layout.empty}>{t("customize.empty")}</li>
        )}
      </ul>
      <Dialog
        open={!!selected}
        onClose={() => setSelected(null)}
        title={t("customize.playbook")}
        footer={
          selected?.status === "pending" && (
            <>
              <Button
                variant="ghost"
                icon={X}
                disabled={!!busy}
                onClick={() => void review(selected, false)}
              >
                {t("research.playbook.drop")}
              </Button>
              <Button
                icon={Check}
                loading={busy === selected.id}
                disabled={!!busy}
                onClick={() => void review(selected, true)}
              >
                {t("research.playbook.admit")}
              </Button>
            </>
          )
        }
      >
        {selected && (
          <div className={layout.fields}>
            <span className={layout.status}>
              {t(
                selected.status === "pending"
                  ? "customize.pending"
                  : (`research.playbook.${selected.status}` as MessageKey),
              )}
            </span>
            <p>
              <strong>{t("research.playbook.when")}</strong> {selected.when}
            </p>
            <p>
              <strong>{t("research.playbook.do")}</strong> {selected.do}
            </p>
            <p>{selected.why}</p>
            <span className={layout.status}>
              {t("research.playbook.meta", {
                sources: selected.sources.length,
                helpful: selected.helpful,
                harmful: selected.harmful,
              })}
            </span>
          </div>
        )}
      </Dialog>
    </>
  );
}
