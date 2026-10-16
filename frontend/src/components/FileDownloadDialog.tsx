import { useEffect, useSyncExternalStore } from "react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import {
  closeFileDownload,
  downloadFile,
  fileDownloadSnapshot,
  mobileFileSave,
  sharePreparedFile,
  subscribeFileDownload,
} from "../lib/file-download";

export function FileDownloadDialog() {
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
      onOpenChange={(open) => {
        if (!open) closeFileDownload();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {transfer?.file
              ? "保存文件"
              : transfer?.error
                ? "下载失败"
                : "正在准备下载"}
          </DialogTitle>
          <DialogDescription>{transfer?.name}</DialogDescription>
        </DialogHeader>
        {transfer?.error && <p role="alert">{transfer.error}</p>}
        {transfer?.file ? (
          <>
            <p className="text-sm text-muted-foreground">
              文件已准备好。点击下方按钮，在系统面板中选择“存储到文件”或保存到其他应用。
            </p>
            <Button onClick={sharePreparedFile} disabled={transfer.sharing}>
              保存到文件
            </Button>
          </>
        ) : (
          !transfer?.error && (
            <div className="space-y-2" role="status">
              <progress
                className="w-full"
                aria-label="文件下载进度"
                max={100}
                value={percent}
              />
              <p className="text-sm text-muted-foreground">
                {percent === undefined ? "正在接收文件…" : `${percent}%`} ·{" "}
                {((transfer?.loaded || 0) / 1048576).toFixed(1)} MB
              </p>
            </div>
          )
        )}
        <Button variant="outline" onClick={closeFileDownload}>
          {transfer?.file || transfer?.error ? "关闭" : "取消下载"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
