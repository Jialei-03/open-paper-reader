export type PdfLoadBytes = { loaded: number; total: number };

export function PdfLoadProgress({ progress }: { progress: PdfLoadBytes }) {
  const { loaded, total } = progress;
  const percent =
    total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : undefined;
  const size = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return (
    <div
      className="mx-auto flex w-full max-w-sm flex-col gap-3 p-6 text-sm text-muted-foreground"
      role="status"
      aria-busy="true"
    >
      <p>{percent === 100 ? "正在解析 PDF 页面…" : "正在加载 PDF…"}</p>
      <progress
        className="h-2 w-full accent-primary"
        aria-label="PDF 加载进度"
        max={100}
        value={percent}
      />
      <p className="text-xs tabular-nums">
        {total > 0
          ? `${size(Math.min(loaded, total))} / ${size(total)} · ${percent}%`
          : loaded > 0
            ? `已接收 ${size(loaded)}`
            : "正在连接文件…"}
      </p>
    </div>
  );
}
