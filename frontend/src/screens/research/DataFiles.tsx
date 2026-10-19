import { Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { Button, toast } from "../../ui";
import { listFiles, uploadFile, type WorkspaceFile } from "./research-api";
import styles from "./Research.module.css";

const size = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** The data the experiments run on: what is in /work/data, and a way to add more. */
export function DataFiles({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const [files, setFiles] = useState<WorkspaceFile[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [reads, setReads] = useState(0);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listFiles(projectId).then(setFiles, () => setFiles([]));
  }, [projectId, reads]);

  const add = async (chosen: File[]) => {
    if (!chosen.length) return;
    setBusy(true);
    try {
      for (const file of chosen) await uploadFile(projectId, file);
      setReads((n) => n + 1);
    } catch (error) {
      toast.show({
        message: error instanceof Error ? error.message : String(error),
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.files} aria-labelledby="research-files">
      <div className={styles.filesHead}>
        <h2 id="research-files" className={styles.sectionTitle}>
          {t("research.files")}
        </h2>
        <Button
          size="sm"
          variant="ghost"
          icon={Upload}
          loading={busy}
          onClick={() => picker.current?.click()}
        >
          {t("research.files.add")}
        </Button>
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            void add(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
      </div>
      {files && files.length === 0 ? (
        <p className={styles.hint}>{t("research.files.none")}</p>
      ) : (
        <ul className={styles.fileList}>
          {(files ?? []).map((file) => (
            <li key={file.path}>
              <code>/work/{file.path}</code>
              <span className={styles.hint}>{size(file.size)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
