import { useId, type ReactNode } from "react";
import { Button, Dialog } from "../../ui";
import { useI18n } from "../../i18n/I18nProvider";
import styles from "./Settings.module.css";

/** One settings section with its actions. */
export function Section({
  title,
  action,
  children,
  headingLevel = 2,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  headingLevel?: 1 | 2;
}) {
  const id = useId();
  const Heading = headingLevel === 1 ? "h1" : "h2";
  return (
    <section className={styles.section} aria-labelledby={id}>
      <div className={styles.sectionHead}>
        <div>
          <Heading id={id} className={styles.sectionTitle}>
            {title}
          </Heading>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Asks before something that cannot be undone (removing, revoking). */
export function ConfirmDialog({
  open,
  title,
  description,
  confirm,
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirm: string;
  busy: boolean;
  onConfirm(): void;
  onClose(): void;
}) {
  const { t } = useI18n();
  return (
    <Dialog
      open={open}
      onClose={() => !busy && onClose()}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="danger" loading={busy} onClick={onConfirm}>
            {confirm}
          </Button>
        </>
      }
    />
  );
}

/** A date as the interface's language writes it. */
export function formatDate(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", {
    dateStyle: "medium",
  }).format(date);
}

/** A number of bytes, in MB or GB. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

export const formatCount = (value: number, locale: string) =>
  new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en").format(value);
