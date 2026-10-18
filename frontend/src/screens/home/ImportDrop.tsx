import clsx from "clsx";
import { FileUp, X } from "lucide-react";
import { useRef, useState, type DragEvent, type FormEvent } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/i18n";
import type { ImportJob, Imports } from "../../import/useImports";
import { Button, IconButton, Spinner, TextField } from "../../ui";
import styles from "./ImportDrop.module.css";

const hasFiles = (event: DragEvent) =>
  Array.from(event.dataTransfer.types).includes("Files");

/**
 * Whether files are being dragged over `onFiles`'s element; spread `handlers`
 * on the element that takes the drop (a whole card, or the drop zone itself).
 */
export function useFileDrop(onFiles: (files: File[]) => void) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const handlers = {
    onDragEnter(event: DragEvent) {
      if (!hasFiles(event)) return;
      depth.current += 1;
      setOver(true);
    },
    onDragOver(event: DragEvent) {
      if (hasFiles(event)) event.preventDefault();
    },
    onDragLeave(event: DragEvent) {
      if (!hasFiles(event)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (!depth.current) setOver(false);
    },
    onDrop(event: DragEvent) {
      depth.current = 0;
      setOver(false);
      if (!hasFiles(event) || event.defaultPrevented) return;
      event.preventDefault();
      const files = Array.from(event.dataTransfer.files);
      if (files.length) onFiles(files);
    },
  };
  return { over, handlers };
}

/**
 * The place to import from: a drop zone that is also a button for picking
 * files, and a field for an arXiv address. `large` is the empty home screen's.
 */
export function ImportDrop({
  imports,
  large = false,
  compact = false,
  over = false,
}: {
  imports: Imports;
  large?: boolean;
  /** Files are being dragged over the screen around it. */
  over?: boolean;
  /** One row, for a screen that has papers to show first. */
  compact?: boolean;
}) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!url.trim()) return;
    imports.importUrl(url);
    setUrl("");
  };
  return (
    <div
      className={clsx(
        styles.drop,
        large && styles.large,
        compact && styles.compact,
      )}
    >
      <button
        type="button"
        className={styles.zone}
        data-over={over || undefined}
        onClick={() => input.current?.click()}
      >
        <FileUp
          className={styles.icon}
          size={large ? 24 : compact ? 16 : 18}
          aria-hidden
        />
        <span className={styles.title}>
          {over ? t("import.drop.release") : t("import.drop.title")}
        </span>
        <span className={styles.hint}>{t("import.drop.hint")}</span>
        <span className={styles.visuallyHidden}>{t("import.drop.choose")}</span>
      </button>
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        hidden
        data-testid="import-file-input"
        onChange={(event) => {
          const files = Array.from(event.target.files || []);
          event.target.value = "";
          if (files.length) imports.importFiles(files);
        }}
      />
      <form className={styles.arxiv} onSubmit={submit}>
        <TextField
          label={t("import.arxiv.label")}
          hideLabel
          placeholder={t("import.arxiv.placeholder")}
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          spellCheck={false}
          autoComplete="off"
        />
        <Button type="submit" disabled={!url.trim()}>
          {t("import.arxiv.submit")}
        </Button>
      </form>
      <ImportJobs imports={imports} />
    </div>
  );
}

/** A size in bytes, as the progress line shows it. */
function bytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

const STAGES: Record<string, MessageKey> = {
  reading: "import.stage.reading",
  creating: "import.stage.creating",
  uploading: "import.stage.uploading",
  metadata: "import.stage.metadata",
  checking: "import.stage.checking",
  pdf: "import.stage.pdf",
  saving: "import.stage.saving",
};

function stageText(t: ReturnType<typeof useI18n>["t"], job: ImportJob) {
  if (job.waitingSeconds)
    return t("import.stage.waiting", {
      seconds: Math.ceil(job.waitingSeconds),
    });
  if (job.stage === "pdf" && job.total)
    return t("import.stage.pdfBytes", {
      received: bytes(job.received),
      total: bytes(job.total),
    });
  const text = t(STAGES[job.stage] ?? "import.stage.working");
  return job.attempt && job.attempt > 1
    ? `${text} · ${t("import.stage.attempt", { attempt: job.attempt })}`
    : text;
}

function errorText(t: ReturnType<typeof useI18n>["t"], job: ImportJob) {
  const error = job.error;
  if (!error) return "";
  if ("message" in error) return error.message;
  return t(`import.error.${error.code}`);
}

/** The imports that are running or failed, one line each. */
export function ImportJobs({ imports }: { imports: Imports }) {
  const { t } = useI18n();
  if (!imports.jobs.length) return null;
  return (
    <ul className={styles.jobs} aria-label={t("import.jobs.label")}>
      {imports.jobs.map((job) => (
        <li key={job.id} className={styles.job} data-status={job.status}>
          {job.status === "running" ? (
            <>
              <div className={styles.jobLine}>
                <Spinner size={14} />
                <span className={styles.jobName}>{job.label}</span>
              </div>
              <p className={styles.jobStage} role="status">
                {stageText(t, job)}
              </p>
              <div
                className={styles.bar}
                role="progressbar"
                aria-label={t("import.progress", { name: job.label })}
                aria-valuemin={job.total ? 0 : undefined}
                aria-valuemax={job.total ?? undefined}
                aria-valuenow={job.total ? job.received : undefined}
                data-indeterminate={!job.total || undefined}
              >
                <span
                  style={
                    job.total
                      ? {
                          transform: `scaleX(${Math.min(1, job.received / job.total)})`,
                        }
                      : undefined
                  }
                />
              </div>
            </>
          ) : (
            <>
              <div className={styles.jobLine}>
                <span className={styles.jobName}>
                  {t("import.failed", { name: job.label })}
                </span>
                {job.error && "message" in job.error && (
                  <Button size="sm" onClick={() => imports.retry(job.id)}>
                    {t("import.retry")}
                  </Button>
                )}
                <IconButton
                  size="sm"
                  icon={X}
                  label={t("import.dismiss")}
                  onClick={() => imports.dismiss(job.id)}
                />
              </div>
              <p className={styles.jobError} role="alert">
                {errorText(t, job)}
              </p>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
