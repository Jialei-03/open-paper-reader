import { useEffect, useRef, useState } from "react";
import { useAppearance } from "../components/Appearance";
import {
  offlineOwner,
  offlinePapers,
  offlineNotes,
  saveOfflineBody,
  syncOfflineNotes,
  saveConflictCopy,
  removeOfflinePaper,
  type OfflinePaper,
  type OfflineNote,
} from "../lib/offline";
import "./offline.css";

function LocalPdf({ paper }: { paper: OfflinePaper }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [error, setError] = useState("");
  const [doc, setDoc] = useState<import("pdfjs-dist").PDFDocumentProxy | null>(
    null,
  );
  useEffect(() => {
    let cancelled = false;
    let task: ReturnType<typeof import("pdfjs-dist").getDocument> | undefined;
    setDoc(null);
    setPage(1);
    setError("");
    void (async () => {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();
      if (cancelled) return;
      task = pdfjs.getDocument({
        data: new Uint8Array(await paper.pdf.arrayBuffer()),
        isEvalSupported: false,
        cMapUrl: "/assets/pdfjs/cmaps/",
        cMapPacked: true,
        standardFontDataUrl: "/assets/pdfjs/standard_fonts/",
        wasmUrl: "/assets/pdfjs/wasm/",
      });
      const loaded = await task.promise;
      if (!cancelled) {
        setDoc(loaded);
        setPages(loaded.numPages);
      }
    })().catch((e) => {
      if (!cancelled) setError(e.message);
    });
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [paper.key, paper.savedAt]);
  useEffect(() => {
    if (!doc || !canvas.current) return;
    let cancelled = false;
    let rendering: import("pdfjs-dist").RenderTask | undefined;
    void doc
      .getPage(page)
      .then(async (pdfPage) => {
        if (cancelled || !canvas.current) return;
        const target = canvas.current;
        const base = pdfPage.getViewport({ scale: 1 });
        const width = Math.min(1100, target.parentElement!.clientWidth - 24);
        const scale = width / base.width;
        const viewport = pdfPage.getViewport({
          scale: scale * Math.min(2, devicePixelRatio || 1),
        });
        target.width = viewport.width;
        target.height = viewport.height;
        target.style.width = width + "px";
        target.style.height =
          viewport.height / Math.min(2, devicePixelRatio || 1) + "px";
        rendering = pdfPage.render({ canvas: target, viewport });
        await rendering.promise;
      })
      .catch((e) => {
        if (!cancelled && e.name !== "RenderingCancelledException")
          setError(e.message);
      });
    return () => {
      cancelled = true;
      rendering?.cancel();
    };
  }, [doc, page]);
  return (
    <section className="offline-pdf" aria-label="离线 PDF">
      <div className="offline-pagination">
        <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
          上一页
        </button>
        <span>
          第 {page} / {pages || "…"} 页
        </span>
        <button disabled={page >= pages} onClick={() => setPage(page + 1)}>
          下一页
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="offline-canvas">
        <canvas ref={canvas} aria-label={`论文第 ${page} 页`} />
      </div>
    </section>
  );
}
export function OfflineWorkspace() {
  useAppearance();
  const [papers, setPapers] = useState<OfflinePaper[]>([]);
  const [notes, setNotes] = useState<OfflineNote[]>([]);
  const [selected, setSelected] = useState("");
  const [noteKey, setNoteKey] = useState("");
  const [message, setMessage] = useState("正在读取本机论文…");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const saving = useRef(0);
  const owner = offlineOwner();
  async function reload() {
    const [p, n] = await Promise.all([
      offlinePapers(owner),
      offlineNotes(owner),
    ]);
    setPapers(p);
    setNotes(n);
    setSelected((current) =>
      p.some((x) => x.key === current) ? current : p[0]?.key || "",
    );
  }
  async function sync() {
    if (saving.current) {
      setMessage("笔记正在保存，请稍后同步");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await syncOfflineNotes();
      await reload();
      setMessage("同步完成；存在冲突的笔记已保留在本机");
    } catch (e) {
      setError(e instanceof Error ? e.message : "同步失败，本机笔记已保留");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void reload()
      .then(() =>
        setMessage(
          navigator.onLine ? "本机论文已就绪" : "离线模式 · 修改仅保存到本机",
        ),
      )
      .catch((e) => setError(e.message));
  }, [owner]);
  useEffect(() => {
    const change = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) void sync();
    };
    window.addEventListener("online", change);
    window.addEventListener("offline", change);
    return () => {
      window.removeEventListener("online", change);
      window.removeEventListener("offline", change);
    };
  }, [owner]);
  useEffect(() => {
    const protect = (e: BeforeUnloadEvent) => {
      if (saving.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, []);
  const paper = papers.find((p) => p.key === selected);
  const paperNotes = notes.filter((n) => n.item.paper_id === paper?.paper.id);
  const note = paperNotes.find((n) => n.key === noteKey) || paperNotes[0];
  async function edit(body: string) {
    if (!note) return;
    const key = note.key;
    ++saving.current;
    setMessage("正在保存到本机…");
    setNotes((current) =>
      current.map((n) =>
        n.key === key ? { ...n, item: { ...n.item, body }, pending: true } : n,
      ),
    );
    try {
      await saveOfflineBody(key, body);
      if (--saving.current === 0) setMessage("已保存到本机 · 待同步");
    } catch (e) {
      --saving.current;
      setError(e instanceof Error ? e.message : "本机保存失败，请导出笔记");
    }
  }
  function exportNotes() {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            exportedAt: new Date().toISOString(),
            notes: notes.map((n) => ({
              title: n.item.title,
              paperId: n.item.paper_id,
              body: n.item.body,
              pending: n.pending,
            })),
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "纸间-本机笔记备份.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <main className="offline-workspace">
      <header>
        <div>
          <h1>本机论文</h1>
          <p>{online ? "可联网同步" : "当前离线"} · PDF 与笔记保存在当前设备</p>
        </div>
        <nav>
          <a href="#dashboard">返回在线空间</a>
          <button disabled={!online || busy} onClick={() => void sync()}>
            {busy ? "同步中…" : "同步笔记"}
          </button>
          <button onClick={exportNotes}>导出本机笔记</button>
        </nav>
      </header>
      <p role="status">{message}</p>
      {error && <p role="alert">{error}</p>}
      {!owner || !papers.length ? (
        <p>
          尚未保存离线论文。联网打开论文，点击“保存供离线使用”，下载完成后即可断网阅读。请使用普通浏览模式。
        </p>
      ) : (
        <div className="offline-layout">
          <aside aria-label="离线论文列表">
            {papers.map((p) => (
              <div key={p.key}>
                <button
                  aria-pressed={p.key === selected}
                  onClick={() => setSelected(p.key)}
                >
                  {p.paper.title}
                </button>
                <small>{(p.pdf.size / 1048576).toFixed(1)} MB · 已下载</small>
                <button
                  onClick={() => {
                    if (
                      !confirm(
                        "仅移除此设备上的离线下载，云端论文不会删除。继续？",
                      )
                    )
                      return;
                    void removeOfflinePaper(p)
                      .then(reload)
                      .catch((e) => setError(e.message));
                  }}
                >
                  移除本机下载
                </button>
              </div>
            ))}
          </aside>
          {paper && <LocalPdf key={paper.key} paper={paper} />}
          <section className="offline-notes" aria-label="离线笔记">
            <h2>笔记</h2>
            {paperNotes.length > 0 && (
              <select
                aria-label="选择离线笔记"
                value={note?.key || ""}
                onChange={(e) => setNoteKey(e.target.value)}
              >
                {paperNotes.map((n) => (
                  <option key={n.key} value={n.key}>
                    {n.item.title || "论文笔记"}
                    {n.pending ? " · 待同步" : ""}
                  </option>
                ))}
              </select>
            )}
            {note ? (
              <>
                <textarea
                  aria-label="离线笔记内容"
                  value={note.item.body}
                  onChange={(e) => void edit(e.target.value)}
                  maxLength={100000}
                  placeholder="使用 Markdown 记录阅读笔记…"
                />
                <p>{note.pending ? "修改待同步到服务器" : "已与服务器同步"}</p>
                {note.conflict && (
                  <div role="alert">
                    <p>{note.conflict}</p>
                    <button
                      disabled={!online || busy}
                      onClick={() => {
                        setBusy(true);
                        void saveConflictCopy(note)
                          .then(reload)
                          .catch((e) => setError(e.message))
                          .finally(() => setBusy(false));
                      }}
                    >
                      另存为新笔记并同步
                    </button>
                  </div>
                )}
              </>
            ) : (
              <p>此论文尚无笔记，请联网添加笔记后重新保存离线论文。</p>
            )}
            <p>
              本版支持离线阅读 PDF 和编辑文字笔记。新的 AI
              请求、翻译与导入需要联网；批注请在在线阅读器中使用。
            </p>
          </section>
        </div>
      )}
    </main>
  );
}
