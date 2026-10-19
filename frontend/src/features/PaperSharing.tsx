import { SharedPdf } from "./SharedPdf";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, send, type Item, type SourceFile } from "../api";
import { saveNote } from "../components/LiveNote";
import { Modal } from "../components/Modal";
import { paperFileName } from "../lib/paper-file-name";
import { Button } from "../components/ui/button";
import { Brand } from "../components/Brand";
import { Checkbox } from "../components/ui/checkbox";
import { Input } from "../components/ui/input";
import { Choice } from "../components/Choice";
import { Alert, AlertDescription } from "../components/ui/alert";

type Share = {
  id: string;
  file_name: string;
  note_title: string;
  expires_at: string;
  revoked_at: string;
};
export function PaperSharing({
  paperId,
  file,
  title,
  note,
  close,
}: {
  paperId: string;
  file: SourceFile;
  /** The paper's own title; readers never need to see the underlying file name. */
  title?: string;
  note?: Item;
  close: () => void;
}) {
  const [shares, setShares] = useState<Share[]>([]);
  const [days, setDays] = useState("7");
  const [includeNote, setIncludeNote] = useState(false);
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const endpoint = `/papers/${paperId}/shares`;
  const load = () => api<Share[]>(endpoint).then(setShares);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [endpoint]);
  const create = async () => {
    setBusy(true);
    setError("");
    try {
      if (includeNote && note) await saveNote(note);
      const result = await send(endpoint, {
        file_id: file.id,
        note_id: includeNote ? note?.id : undefined,
        expires_days: Number(days),
      });
      setLink(result.url);
      setCopied(false);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="分享论文" close={close}>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          持有链接的人可查看这份 PDF。分享可随时撤销，笔记仅分享创建时的副本。
        </p>
        <p className="line-clamp-2 text-sm font-medium">{title || file.name}</p>
        <Choice aria-label="分享有效期" value={days} onValueChange={setDays}>
          <option value="1">1 天有效</option>
          <option value="7">7 天有效</option>
          <option value="30">30 天有效</option>
        </Choice>
        {note && (
          <label className="check flex items-center gap-2 text-sm">
            <Checkbox
              checked={includeNote}
              onCheckedChange={(v) => setIncludeNote(v === true)}
            />
            包含当前笔记与其中的图片
          </label>
        )}
        <Button disabled={busy} onClick={() => void create()}>
          {busy ? "正在创建…" : "创建分享链接"}
        </Button>
        {link && (
          <div className="flex gap-2">
            <Input aria-label="分享链接" value={link} readOnly />
            <Button
              variant="outline"
              onClick={() =>
                void navigator.clipboard
                  .writeText(link)
                  .then(() => setCopied(true))
                  .catch(() => setError("无法复制，请手动复制链接。"))
              }
            >
              {copied ? "已复制" : "复制"}
            </Button>
          </div>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {shares.length > 0 && (
          <div className="space-y-3 border-t pt-3">
            <h3 className="text-sm font-medium">已有分享</h3>
            {shares.map((share) => (
              <div key={share.id} className="flex items-center gap-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate">
                    {share.note_title ? "论文与笔记" : "仅论文"}
                  </p>
                  <p className="text-muted-foreground">
                    {share.revoked_at
                      ? "已撤销"
                      : `${new Date(share.expires_at).toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" })} 到期`}
                  </p>
                </div>
                {!share.revoked_at && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await api(`${endpoint}/${share.id}`, {
                          method: "DELETE",
                        });
                        setLink("");
                        await load();
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    撤销
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

type PublicPaper = {
  title: string;
  authors: string;
  file_name: string;
  expires_at: string;
  note: { title: string; body: string } | null;
};
export function SharedPaper({ token }: { token: string }) {
  const [paper, setPaper] = useState<PublicPaper | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const meta = document.createElement("meta");
    meta.name = "referrer";
    meta.content = "no-referrer";
    document.head.append(meta);
    setPaper(null);
    setError("");
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
      setError("分享不存在或已失效");
      return () => meta.remove();
    }
    api<PublicPaper>(`/shared/${token}`, { signal: controller.signal })
      .then(setPaper)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => {
      controller.abort();
      meta.remove();
    };
  }, [token]);
  const prefix = `/api/v1/shared/${token}`;
  return (
    <main className="shared-page flex h-dvh flex-col bg-background text-foreground">
      <header className="shared-header">
        <a
          href="#home"
          className="shared-brand"
          aria-label="Open Paper Reader 首页"
        >
          <Brand />
        </a>
        <h1 className="truncate text-base font-semibold">
          {paper?.title || "论文分享"}
        </h1>
        <span className="shared-badge">只读分享</span>
      </header>
      {error ? (
        <div role="alert" className="shared-state">
          <p>{error}</p>
          <a href="#home">了解 Open Paper Reader</a>
        </div>
      ) : !paper ? (
        <div role="status" className="shared-state" aria-busy="true">
          <span className="shared-spinner" aria-hidden="true" />
          <p>正在载入论文…</p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <SharedPdf url={`${prefix}/pdf`} title={paperFileName(paper.title)} />
          {paper.note && (
            <aside
              className="w-full overflow-y-auto border-l p-6 md:w-[380px] md:shrink-0"
              aria-label="分享笔记"
            >
              <h2 className="mb-4 text-lg font-semibold">{paper.note.title}</h2>
              <div className="markdown">
                <ReactMarkdown
                  skipHtml
                  remarkPlugins={[remarkGfm]}
                  components={{
                    img: ({ src, alt }) =>
                      typeof src === "string" &&
                      src.startsWith(`${prefix}/images/`) &&
                      /^[0-9a-f-]{36}$/.test(
                        src.slice(`${prefix}/images/`.length),
                      ) ? (
                        <img
                          src={src}
                          alt={alt || "笔记图片"}
                          loading="lazy"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <span>[未分享的图片]</span>
                      ),
                    a: ({ href, children }) =>
                      href && /^https?:\/\//i.test(href) ? (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {children}
                        </a>
                      ) : (
                        <span>{children}</span>
                      ),
                  }}
                >
                  {paper.note.body}
                </ReactMarkdown>
              </div>
            </aside>
          )}
        </div>
      )}
    </main>
  );
}
