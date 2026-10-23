import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../api";
import { useI18n } from "../../i18n/I18nProvider";
import { IconButton } from "../../ui";
import { Prose } from "./talk/ThreadView";
import styles from "./Team.module.css";

export function TeamFilePreview({
  workspace,
  path,
  onClose,
}: {
  workspace: string;
  path: string;
  onClose(): void;
}) {
  const { t } = useI18n();
  const [file, setFile] = useState<{ kind: string; content: string } | null>(
    null,
  );
  const [error, setError] = useState("");
  const url = `/research/workspaces/${workspace}/team/file?path=${encodeURIComponent(path)}`;
  useEffect(() => {
    let stale = false;
    setFile(null);
    setError("");
    api<{ kind: string; content: string }>(url).then(
      (value) => !stale && setFile(value),
      (reason: unknown) => !stale && setError(String(reason)),
    );
    return () => {
      stale = true;
    };
  }, [url]);
  return (
    <aside className={styles.thread} aria-label={path}>
      <header className={styles.header}>
        <h2>{path}</h2>
        <div className={styles.actions}>
          <IconButton icon={X} label={t("common.close")} onClick={onClose} />
        </div>
      </header>
      <div className={styles.messages}>
        {error && <p role="alert">{error}</p>}
        {!file && !error && (
          <div className={styles.skeleton} aria-busy="true">
            <span />
          </div>
        )}
        {file?.kind === "markdown" ? (
          <Prose text={file.content} />
        ) : file?.kind === "image" ? (
          <img
            className={styles.fileImage}
            src={`/api/v1${url}&raw=true`}
            alt={path}
          />
        ) : file?.kind === "pdf" ? (
          <iframe
            className={styles.filePdf}
            src={`/api/v1${url}&raw=true`}
            title={path}
          />
        ) : file?.kind === "binary" ? (
          <p>{t("research.files.binary")}</p>
        ) : (
          file && <pre className={styles.fileText}>{file.content}</pre>
        )}
      </div>
    </aside>
  );
}
