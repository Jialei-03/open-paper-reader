import { useState } from "react";
import { Download } from "lucide-react";
import type { Paper, SourceFile } from "../api";
import { downloadOfflinePaper } from "../lib/offline";
import { ReaderButton } from "../components/ReaderControls";
export function OfflineDownload({
  paper,
  file,
}: {
  paper: Paper;
  file: SourceFile;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  return (
    <details className="relative shrink-0">
      <summary
        className="list-none cursor-pointer rounded-md p-2"
        aria-label="离线阅读选项"
        title="离线阅读"
      >
        <Download size={18} />
      </summary>
      <div className="fixed z-50 flex flex-col gap-3 rounded-lg border bg-background p-4 shadow-lg max-w-72">
        <ReaderButton
          disabled={busy}
          aria-label="保存供离线使用"
          onClick={() => {
            setBusy(true);
            void downloadOfflinePaper(paper, file, setMessage)
              .catch((e) => setMessage(e.message))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? "正在下载…" : "保存供离线使用"}
        </ReaderButton>
        <a href="#offline" className="text-sm">
          打开本机论文
        </a>
        {message && (
          <span role="status" className="text-xs">
            {message}
          </span>
        )}
      </div>
    </details>
  );
}
