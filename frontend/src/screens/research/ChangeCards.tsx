import { FileDiff, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { Button, Dialog, Spinner, toast } from "../../ui";
import { readChanges, undoRound, type CheckpointChanges } from "./research-api";
import styles from "./talk/Talk.module.css";

export function ChangeNumbers({
  changes,
}: {
  changes: Pick<CheckpointChanges, "added" | "removed">;
}) {
  return (
    <span className={styles.changeNumbers}>
      <span>+{changes.added}</span>
      <span>−{changes.removed}</span>
    </span>
  );
}

export function DiffDialog({
  changes,
  onClose,
  loadDiff,
}: {
  changes: {
    files: (Pick<
      CheckpointChanges["files"][number],
      "path" | "added" | "removed"
    > & {
      diff?: string;
      truncated?: boolean;
    })[];
  };
  onClose(): void;
  loadDiff?(path: string): Promise<{ diff: string; truncated?: boolean }>;
}) {
  const { t } = useI18n();
  return (
    <Dialog open title={t("research.changes.view")} onClose={onClose} size="lg">
      <div className={styles.diffFiles}>
        {changes.files.map((file, index) => (
          <DiffFile
            key={file.path}
            file={file}
            loadDiff={loadDiff}
            initialOpen={!loadDiff || index === 0}
          />
        ))}
      </div>
    </Dialog>
  );
}

function DiffFile({
  file,
  loadDiff,
  initialOpen,
}: {
  file: {
    path: string;
    added: number;
    removed: number;
    diff?: string;
    truncated?: boolean;
  };
  loadDiff?: (path: string) => Promise<{ diff: string; truncated?: boolean }>;
  initialOpen: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(initialOpen);
  const [patch, setPatch] = useState<{ diff: string; truncated?: boolean }>();
  const [error, setError] = useState("");
  const [reads, setReads] = useState(0);
  useEffect(() => {
    if (!open || !loadDiff || patch) return;
    let stale = false;
    setError("");
    loadDiff(file.path).then(
      (value) => !stale && setPatch(value),
      (reason: unknown) =>
        !stale &&
        setError(reason instanceof Error ? reason.message : String(reason)),
    );
    return () => {
      stale = true;
    };
  }, [open, file.path, loadDiff, patch, reads]);
  const value = loadDiff ? patch : file;
  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <code>{file.path}</code>
        <ChangeNumbers changes={file} />
      </summary>
      {open && (
        <>
          {error ? (
            <p role="alert">
              {error}{" "}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setReads((n) => n + 1)}
              >
                {t("common.retry")}
              </Button>
            </p>
          ) : (
            !value && <Spinner />
          )}
          {value?.truncated && <p>{t("research.changes.truncated")}</p>}
          {value && <pre>{value.diff}</pre>}
        </>
      )}
    </details>
  );
}

export function CheckpointCard({
  id,
  sprintId,
  refreshKey,
  onChanged,
}: {
  id: string;
  sprintId: string;
  refreshKey: string;
  onChanged?(): void;
}) {
  const { t } = useI18n();
  const [changes, setChanges] = useState<CheckpointChanges | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    readChanges(id, sprintId).then(
      (value) => {
        if (!cancelled) setChanges(value);
      },
      () => {
        if (!cancelled) setChanges(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [id, sprintId, refreshKey]);
  if (!changes?.files.length) return null;
  return (
    <article
      className={styles.checkpointCard}
      aria-label={t("research.changes.files", { n: changes.files.length })}
    >
      <FileDiff size={22} aria-hidden />
      <div>
        <strong>
          {t("research.changes.files", { n: changes.files.length })}
        </strong>
        <ChangeNumbers changes={changes} />
      </div>
      <div className={styles.checkpointActions}>
        <Button
          variant="ghost"
          size="sm"
          icon={Undo2}
          disabled={!changes.can_undo}
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await undoRound(id, sprintId, changes.commit_sha!);
              setChanges({ ...changes, can_undo: false });
              onChanged?.();
            } catch (error) {
              toast.show({
                message: error instanceof Error ? error.message : String(error),
                tone: "error",
              });
            } finally {
              setBusy(false);
            }
          }}
        >
          {t("research.changes.undo")}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
          {t("research.changes.view")}
        </Button>
      </div>
      {open && <DiffDialog changes={changes} onClose={() => setOpen(false)} />}
    </article>
  );
}
