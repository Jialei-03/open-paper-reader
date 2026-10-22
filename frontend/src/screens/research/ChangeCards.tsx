import { FileDiff, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { Button, Dialog, toast } from "../../ui";
import { readChanges, undoRound, type CheckpointChanges } from "./research-api";
import styles from "./talk/Talk.module.css";

export function ChangeNumbers({ changes }: { changes: CheckpointChanges }) {
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
}: {
  changes: CheckpointChanges;
  onClose(): void;
}) {
  const { t } = useI18n();
  return (
    <Dialog open title={t("research.changes.view")} onClose={onClose} size="lg">
      <div className={styles.diffFiles}>
        {changes.files.map((file) => (
          <details key={file.path} open>
            <summary>
              <code>{file.path}</code>
              <ChangeNumbers
                changes={{
                  ...changes,
                  added: file.added,
                  removed: file.removed,
                }}
              />
            </summary>
            {file.truncated && <p>{t("research.merge.truncated")}</p>}
            <pre>{file.diff}</pre>
          </details>
        ))}
      </div>
    </Dialog>
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
