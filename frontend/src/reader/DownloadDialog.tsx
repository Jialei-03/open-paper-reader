import { useId, useState } from "react";
import { useI18n } from "../i18n/I18nProvider";
import { Button, Dialog } from "../ui";
import type { Engine } from "./modes/layout/job";
import styles from "./DownloadDialog.module.css";

/** Which PDF of the paper is saved. */
export type DownloadKind = "original" | "annotated" | `translated:${Engine}`;

export interface DownloadDialogProps {
  open: boolean;
  onClose(): void;
  /** The methods whose full translation has completed: each is offered as its own PDF. */
  translated: Engine[];
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
  const choices: { value: DownloadKind; label: string }[] = [
    {
      value: "original",
      label: t("reader.download.original"),
    },
    {
      value: "annotated",
      label: t("reader.download.annotated"),
    },
    ...translated.map((engine) => ({
      value: `translated:${engine}` as const,
      // With two to choose from, each says which method made it.
      label:
        translated.length > 1
          ? t("reader.engine.download", {
              kind: t("reader.download.translated"),
              name: t(`reader.engine.${engine}.name`),
            })
          : t("reader.download.translated"),
    })),
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
            </span>
          </label>
        ))}
      </div>
    </Dialog>
  );
}
