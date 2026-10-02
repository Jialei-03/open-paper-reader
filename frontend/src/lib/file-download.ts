export type FileDownloadState = {
  name: string;
  loaded: number;
  total: number;
  file?: File;
  error?: string;
  sharing?: boolean;
} | null;
let state: FileDownloadState = null;
let controller: AbortController | null = null;
const listeners = new Set<() => void>();
function update(next: FileDownloadState) {
  state = next;
  listeners.forEach((notify) => notify());
}
export const fileDownloadSnapshot = () => state;
export const subscribeFileDownload = (notify: () => void) => {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
};
export function closeFileDownload() {
  controller?.abort();
  controller = null;
  update(null);
}
export function mobileFileSave() {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 0 &&
      (navigator.platform === "MacIntel" ||
        matchMedia("(pointer: coarse)").matches))
  );
}
function cleanName(name: string) {
  // File names are data, including names supplied by an uploaded attachment.
  // eslint-disable-next-line no-control-regex
  return (
    name
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
      .trim()
      .slice(0, 180) || "下载文件"
  );
}
function responseName(response: Response) {
  const disposition = response.headers.get("Content-Disposition") || "";
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      /* use the plain name */
    }
  }
  return /filename="([^"]+)"/i.exec(disposition)?.[1] || "下载文件";
}
export function browserSave(file: File) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.dataset.fileSave = "true";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Safari needs the object URL to remain alive while the OS receives the file.
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}
/** Fetch authenticated bytes without navigating the installed web app. */
export async function downloadFile(source: string | Blob, name?: string) {
  closeFileDownload();
  const operation = new AbortController();
  controller = operation;
  update({
    name: name || "下载文件",
    loaded: 0,
    total: source instanceof Blob ? source.size : 0,
  });
  try {
    let blob: Blob;
    if (source instanceof Blob) blob = source;
    else {
      const response = await fetch(source, {
        credentials: "same-origin",
        signal: operation.signal,
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        throw new Error(
          typeof detail?.detail === "string"
            ? detail.detail
            : `下载失败（${response.status}），请重试`,
        );
      }
      if (operation.signal.aborted || controller !== operation) return;
      name ||= responseName(response);
      const total = Number(response.headers.get("Content-Length")) || 0;
      update({ name, loaded: 0, total });
      if (!response.body) blob = await response.blob();
      else {
        const reader = response.body.getReader();
        const chunks: BlobPart[] = [];
        let loaded = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          loaded += value.byteLength;
          if (controller === operation) update({ name, loaded, total });
        }
        blob = new Blob(chunks, {
          type:
            response.headers.get("Content-Type")?.split(";")[0] ||
            "application/octet-stream",
        });
      }
    }
    if (operation.signal.aborted || controller !== operation) return;
    if (!blob.size) throw new Error("文件为空，请重试");
    const file = new File([blob], cleanName(name || "下载文件"), {
      type: blob.type || "application/octet-stream",
    });
    controller = null;
    if (mobileFileSave())
      update({ name: file.name, loaded: file.size, total: file.size, file });
    else {
      browserSave(file);
      update(null);
    }
  } catch (error) {
    if (operation.signal.aborted) return;
    if (controller === operation) {
      controller = null;
      update(
        mobileFileSave()
          ? {
              name: name || "下载文件",
              loaded: 0,
              total: 0,
              error:
                error instanceof Error ? error.message : "下载失败，请重试",
            }
          : null,
      );
    }
    throw error;
  }
}
/** Called directly by the Save button, preserving Safari's user activation. */
export function sharePreparedFile() {
  if (!state?.file || state.sharing) return;
  const prepared = state;
  const file = state.file;
  if (!navigator.share || !navigator.canShare?.({ files: [file] })) {
    browserSave(file);
    update(null);
    return;
  }
  update({ ...prepared, sharing: true, error: undefined });
  // No await before share: long network operations happen in downloadFile.
  void navigator
    .share({ files: [file] })
    .then(() => {
      if (state?.file === file) update(null);
    })
    .catch((error: unknown) => {
      if (state?.file !== file) return;
      update({
        ...prepared,
        sharing: false,
        error:
          error instanceof DOMException && error.name === "AbortError"
            ? undefined
            : "保存面板未能打开，请再次点击保存",
      });
    });
}
