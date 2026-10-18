import { useId, useState } from "react";
import { useI18n } from "../i18n/I18nProvider";
import { Button, Dialog } from "../ui";
import styles from "./DownloadDialog.module.css";

/** Which PDF of the paper is saved. */
export type DownloadKind = "original" | "annotated" | "translated";

export interface DownloadDialogProps {
  open: boolean;
  onClose(): void;
  /** The translated PDF is offered only where a full translation has completed. */
  translated: boolean;
  /** Saves the PDF (it says when it is done, whether it worked or not). */
  onDownload(kind: DownloadKind): Promise<void>;
}

/**
 * The one place the paper is downloaded from: the original, the original with
 * its annotations drawn on, or (once there is one) the full translation.
 */
export function DownloadDialog({
  open,
  onClose,
  translated,
  onDownload,
}: DownloadDialogProps) {
  const { t } = useI18n();
  const name = useId();
  const [kind, setKind] = useState<DownloadKind>("original");
  const [busy, setBusy] = useState(false);
  const choices: { value: DownloadKind; label: string; hint: string }[] = [
    {
      value: "original",
      label: t("reader.download.original"),
      hint: t("reader.download.originalHint"),
    },
    {
      value: "annotated",
      label: t("reader.download.annotated"),
      hint: t("reader.download.annotatedHint"),
    },
    ...(translated
      ? [
          {
            value: "translated" as const,
            label: t("reader.download.translated"),
            hint: t("reader.download.translatedHint"),
          },
        ]
      : []),
  ];

  const download = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onDownload(kind);
    } finally {
      setBusy(false);
      onClose();
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      title={t("reader.download.title")}
      description={t("reader.download.description")}
      dismissible={!busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={() => void download()}
          >
            {t("reader.download.action")}
          </Button>
        </>
      }
    >
      <div
        role="radiogroup"
        aria-label={t("reader.download.choice")}
        className={styles.choices}
      >
        {choices.map((choice) => (
          <label key={choice.value} className={styles.choice}>
            <input
              type="radio"
              name={name}
              aria-labelledby={`${name}-${choice.value}`}
              aria-describedby={`${name}-${choice.value}-hint`}
              value={choice.value}
              checked={kind === choice.value}
              disabled={busy}
              data-autofocus={choice.value === kind ? "" : undefined}
              onChange={() => setKind(choice.value)}
            />
            <span className={styles.text}>
              <span id={`${name}-${choice.value}`} className={styles.label}>
                {choice.label}
              </span>
              <span id={`${name}-${choice.value}-hint`} className={styles.hint}>
                {choice.hint}
              </span>
            </span>
          </label>
        ))}
      </div>
    </Dialog>
  );
}
