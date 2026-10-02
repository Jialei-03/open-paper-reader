import { useState } from "react";
import { Download, Paperclip } from "lucide-react";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../components/ui/dialog";

type Attachment = {
  id: string;
  name: string;
  mime: string;
  url: string;
  pages?: number | null;
};
export function ChatAttachments({
  files,
  compact = false,
}: {
  files: Attachment[];
  compact?: boolean;
}) {
  const [selected, setSelected] = useState<Attachment | null>(null);
  const [page, setPage] = useState(1);
  const [failed, setFailed] = useState(false);
  const safe = files.filter((f) =>
    /^\/api\/v1\/agent\/attachments\/[0-9a-f-]{36}\/content$/.test(f.url),
  );
  const isImage = (f: Attachment) =>
    /^image\/(png|jpeg|webp|gif)$/.test(f.mime);
  const source =
    selected &&
    (isImage(selected)
      ? `${selected.url}?preview=true`
      : `/api/v1/agent/files/${selected.id}/image?page=${page}&asset=`);
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {safe.map((f) =>
          isImage(f) || f.mime === "application/pdf" ? (
            <Button
              type="button"
              key={f.id}
              variant="outline"
              size="sm"
              className={compact ? "max-w-60" : "h-auto max-w-64 flex-col p-2"}
              aria-label={`预览附件：${f.name}`}
              onClick={() => {
                setSelected(f);
                setPage(1);
                setFailed(false);
              }}
            >
              {isImage(f) && !compact && (
                <img
                  src={`${f.url}?preview=true`}
                  alt={f.name}
                  loading="lazy"
                  className="max-h-32 max-w-full rounded object-contain"
                />
              )}
              <span className="flex max-w-full items-center gap-1">
                <Paperclip className="size-4 shrink-0" />
                <span className="truncate">{f.name}</span>
              </span>
            </Button>
          ) : (
            <Button key={f.id} variant="outline" size="sm" asChild>
              <a href={f.url} download={f.name}>
                <Paperclip />
                {f.name}
              </a>
            </Button>
          ),
        )}
      </div>
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent className="sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>{selected?.name}</DialogTitle>
            <DialogDescription>附件预览 · 下载请使用下方按钮</DialogDescription>
          </DialogHeader>
          {selected && (
            <>
              <div className="max-h-[70dvh] overflow-auto">
                {failed ? (
                  <p role="alert">预览加载失败，请重试或下载附件。</p>
                ) : (
                  <img
                    key={source}
                    src={source || undefined}
                    alt={selected.name}
                    className="mx-auto h-auto max-w-full"
                    onError={() => setFailed(true)}
                  />
                )}
              </div>
              <div className="flex items-center justify-between gap-2">
                {selected.mime === "application/pdf" && (
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={page <= 1}
                      onClick={() => {
                        setPage((p) => p - 1);
                        setFailed(false);
                      }}
                    >
                      上一页
                    </Button>
                    <span>
                      {page} / {selected.pages || 1}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={page >= (selected.pages || 1)}
                      onClick={() => {
                        setPage((p) => p + 1);
                        setFailed(false);
                      }}
                    >
                      下一页
                    </Button>
                  </div>
                )}
                {failed && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setFailed(false)}
                  >
                    重试预览
                  </Button>
                )}
                <Button type="button" variant="outline" asChild>
                  <a href={selected.url} download={selected.name}>
                    <Download />
                    下载附件
                  </a>
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
