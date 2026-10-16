import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Choice } from "./Choice";
import { Markdown } from "./shared";
import { api, type SourceFile } from "../api";
import type { KnowledgeNode } from "../lib/knowledge";

export function ReferencePosition({
  target,
  close,
  insert,
}: {
  target: KnowledgeNode;
  close: () => void;
  insert: (text: string) => void;
}) {
  const [files, setFiles] = useState<SourceFile[]>([]),
    [fileId, setFileId] = useState(""),
    [position, setPosition] = useState("1"),
    [quote, setQuote] = useState(""),
    [prefix, setPrefix] = useState(""),
    [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const file = files.find((f) => f.id === fileId);
  useEffect(() => {
    let active = true;
    if (target.kind === "paper")
      api<SourceFile[]>(`/papers/${target.id.split("/")[1]}/files`)
        .then((rows) => {
          if (!active) return;
          const valid = rows.filter(
            (f) => f.mime === "application/pdf" || f.mime.startsWith("text/"),
          );
          setFiles(valid);
          setFileId(valid[0]?.id || "");
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [target.id]);
  return (
    <Dialog open onOpenChange={close}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>引用具体位置</DialogTitle>
          <DialogDescription>{target.title}</DialogDescription>
        </DialogHeader>
        {target.kind === "paper" ? (
          <div className="flex flex-col gap-3">
            {files.length > 1 && (
              <Choice
                aria-label="引用文件"
                value={fileId}
                onValueChange={setFileId}
              >
                {files.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </Choice>
            )}
            {!files.length && (
              <p className="text-sm text-muted-foreground">
                {error || "需要先上传 PDF 或文本附件。"}
              </p>
            )}
            <label>
              {file?.mime === "application/pdf" ? "页码" : "行号"}
              <Input
                aria-label="引用位置"
                type="number"
                min={1}
                max={file?.pages || undefined}
                value={position}
                onChange={(e) => setPosition(e.target.value)}
              />
            </label>
            <Input
              aria-label="引用原文"
              placeholder="原文文字（可选，用于精确高亮）"
              value={quote}
              onChange={(e) => setQuote(e.target.value)}
            />
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              选中要引用的文字，再点击插入。
            </p>
            <div
              ref={root}
              className="max-h-80 overflow-auto rounded-md border p-4"
              onPointerUp={() => {
                const selection = window.getSelection();
                if (
                  !selection?.rangeCount ||
                  !root.current?.contains(selection.anchorNode) ||
                  !root.current.contains(selection.focusNode) ||
                  selection.isCollapsed
                )
                  return;
                const r = selection.getRangeAt(0),
                  before = r.cloneRange();
                before.selectNodeContents(root.current);
                before.setEnd(r.startContainer, r.startOffset);
                setQuote(selection.toString());
                setPrefix(before.toString().slice(-40));
              }}
            >
              <Markdown body={target.body} />
            </div>
            {quote && <p className="line-clamp-2 text-sm">已选：{quote}</p>}
          </>
        )}
        <Button
          disabled={
            target.kind === "paper"
              ? !file ||
                !Number.isInteger(Number(position)) ||
                Number(position) < 1 ||
                (!!file.pages && Number(position) > file.pages)
              : !quote
          }
          onClick={() => {
            const params = new URLSearchParams();
            if (file) {
              params.set("file", file.id);
              params.set(
                file.mime === "application/pdf" ? "page" : "line",
                position,
              );
            }
            if (quote) {
              params.set("quote", quote);
              if (prefix) params.set("prefix", prefix);
            }
            const label = (
              quote ||
              `${target.title} · ${file?.mime === "application/pdf" ? "第" + position + "页" : "第" + position + "行"}`
            ).replace(/[\[\]\n]/g, " ");
            insert(`[${label}](#${target.route}?${params})`);
            close();
          }}
        >
          插入位置引用
        </Button>
      </DialogContent>
    </Dialog>
  );
}
