import { useEffect, useSyncExternalStore } from "react";
import { useI18n } from "../i18n/I18nProvider";
import { Button, Dialog } from "../ui";
import styles from "./FileDownloadDialog.module.css";
import {
  closeFileDownload,
  downloadFile,
  fileDownloadSnapshot,
  mobileFileSave,
  sharePreparedFile,
  subscribeFileDownload,
} from "../lib/file-download";

export function FileDownloadDialog() {
  const { t, locale } = useI18n();
  const transfer = useSyncExternalStore(
    subscribeFileDownload,
    fileDownloadSnapshot,
  );
  // Existing attachment/export links also use the mobile file-saving flow.
  useEffect(() => {
    const intercept = (event: MouseEvent) => {
      if (
        !mobileFileSave() ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor =
        event.target instanceof Element
          ? event.target.closest<HTMLAnchorElement>("a[href]")
          : null;
      if (!anchor || anchor.dataset.fileSave || anchor.target === "_blank")
        return;
      const url = new URL(anchor.href, location.href);
      if (url.origin !== location.origin) return;
      if (
        !anchor.hasAttribute("download") &&
        url.searchParams.get("download") !== "true" &&
        url.pathname !== "/api/v1/export"
      )
        return;
      event.preventDefault();
      void downloadFile(
        url.href,
        anchor.getAttribute("download") || undefined,
      ).catch(() => undefined);
    };
    document.addEventListener("click", intercept);
    return () => document.removeEventListener("click", intercept);
  }, []);
  const percent = transfer?.total
    ? Math.min(100, Math.round((transfer.loaded / transfer.total) * 100))
    : undefined;
  return (
    <Dialog
      open={!!transfer}
      onClose={closeFileDownload}
      title={t(
        transfer?.file
          ? "fileDownload.save"
          : transfer?.error
            ? "fileDownload.failed"
            : "fileDownload.preparing",
      )}
      footer={
        <>
          <Button variant="ghost" onClick={closeFileDownload}>
            {t(
              transfer?.file || transfer?.error
                ? "common.close"
                : "fileDownload.cancel",
            )}
          </Button>
          {transfer?.file && (
            <Button
              variant="primary"
              loading={transfer.sharing}
              onClick={sharePreparedFile}
            >
              {t("fileDownload.save")}
            </Button>
          )}
        </>
      }
    >
      <div className={styles.body}>
        {transfer?.name && <p className={styles.name}>{transfer.name}</p>}
        {transfer?.error && (
          <p className={styles.error} role="alert">
            {transfer.error}
          </p>
        )}
        {!transfer?.file && !transfer?.error && (
          <div className={styles.body} role="status">
            <progress
              className={styles.progress}
              aria-label={t("fileDownload.progress")}
              max={100}
              value={percent}
            />
            <p className={styles.status}>
              {percent === undefined
                ? t("fileDownload.receiving")
                : `${percent}%`}{" "}
              ·{" "}
              {new Intl.NumberFormat(locale, {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
              }).format((transfer?.loaded || 0) / 1048576)}{" "}
              MB
            </p>
          </div>
        )}
      </div>
    </Dialog>
  );
}
