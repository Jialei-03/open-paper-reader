import { paperFileName } from "../lib/paper-file-name";
import { createPortal } from "react-dom";
import { useReaderPanels } from "../lib/reader-panels";
import { Choice } from "@/components/Choice";
import { Checkbox } from "@/components/ui/checkbox";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useEffect, useRef, useState } from "react";
import { api, send } from "../api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ReaderButton } from "../components/ReaderControls";
import {
  Highlighter,
  MessageSquarePlus,
  ListFilter,
  Download,
  Trash2,
  Pencil,
} from "lucide-react";
import "./pdf-annotations.css";
export type PdfRect = { x: number; y: number; w: number; h: number };
export type PdfSelection = {
  text: string;
  prefix: string;
  /** The page where the selection starts; `rects` belong to this page. */
  page: number;
  rects: PdfRect[];
  anchor?: { x: number; y: number };
  /** Present only when the selection crosses a page break: one fragment per page. */
  parts?: { page: number; text: string; prefix: string; rects: PdfRect[] }[];
};
export type PdfAnnotation = {
  id: string;
  file_id: string;
  paper_id: string;
  version_id: string;
  page: number;
  quote: string;
  prefix: string;
  rects: PdfRect[];
  color: string;
  comment: string;
  revision: number;
  created_at: string;
  updated_at: string;
};
export const annotationColors = [
  { value: "#FACC15", label: "黄色" },
  { value: "#86EFAC", label: "绿色" },
  { value: "#93C5FD", label: "蓝色" },
  { value: "#F9A8D4", label: "粉色" },
  { value: "#FCA5A5", label: "红色" },
];
export function usePdfAnnotations(fileId: string) {
  const [rows, setRows] = useState<PdfAnnotation[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const current = useRef(fileId);
  current.current = fileId;
  const epoch = useRef(0);
  const failure = useRef("");
  async function reload() {
    const version = ++epoch.current;
    try {
      const data = await api<PdfAnnotation[]>(`/files/${fileId}/annotations`);
      if (current.current === fileId && version === epoch.current) {
        setRows(data);
        setError("");
      }
    } catch (e) {
      if (current.current === fileId && version === epoch.current)
        setError(e instanceof Error ? e.message : "读取批注失败");
    }
  }
  useEffect(() => {
    setRows([]);
    setBusy(false);
    setError("");
    void reload();
    return () => {
      epoch.current++;
    };
  }, [fileId]);
  async function mutate(
    path: string,
    body: unknown,
    method: string,
    created?: PdfAnnotation[],
  ) {
    if (busy) return false;
    setBusy(true);
    setError("");
    try {
      const row = await send(
        `/files/${fileId}/annotations/${path}`,
        body,
        method,
      );
      if (method !== "DELETE" && created) created.push(row);
      if (current.current === fileId) {
        epoch.current++;
        setRows((rows) =>
          method === "DELETE"
            ? rows.filter((item) => item.id !== path.split("?")[0])
            : [
                ...rows.filter((item) => item.id !== row.id),
                ...(row.deleted ? [] : [row]),
              ].sort(
                (a, b) =>
                  a.page - b.page || a.created_at.localeCompare(b.created_at),
              ),
        );
      }
      window.dispatchEvent(new Event("reading-activity-changed"));
      return true;
    } catch (e) {
      failure.current = e instanceof Error ? e.message : "保存批注失败";
      if (current.current === fileId) setError(failure.current);
      return false;
    } finally {
      if (current.current === fileId) setBusy(false);
    }
  }
  return {
    rows,
    error,
    busy,
    reload,
    add: async (selection: PdfSelection, color: string, comment: string) => {
      // A selection across a page break is stored once per page it touches;
      // the comment rides on the first so it is not repeated.
      const parts = selection.parts ?? [selection];
      if (parts.some((part) => part.rects.length > 64)) {
        setError("所选内容超过 64 行，请分段添加批注。");
        return false;
      }
      const created: PdfAnnotation[] = [];
      for (const [index, part] of parts.entries()) {
        const ok = await mutate(
          crypto.randomUUID(),
          {
            page: part.page,
            quote: part.text,
            prefix: part.prefix,
            rects: part.rects,
            color,
            comment: index === 0 ? comment : "",
          },
          "PUT",
          created,
        );
        if (!ok) {
          // It lands on every page it touches, or on none.
          const reason = failure.current;
          for (const row of created)
            await mutate(
              `${row.id}?revision=${row.revision}`,
              undefined,
              "DELETE",
            );
          if (current.current === fileId) setError(reason);
          return false;
        }
      }
      // What was made, one per page it touches (true-ish for the callers that only ask whether).
      return created;
    },
    update: (row: PdfAnnotation, color: string, comment: string) =>
      mutate(row.id, { revision: row.revision, color, comment }, "PATCH"),
    remove: (row: PdfAnnotation) =>
      mutate(`${row.id}?revision=${row.revision}`, undefined, "DELETE"),
  };
}
export function PdfAnnotationLayer({
  rows,
  page,
}: {
  rows: PdfAnnotation[];
  page: number;
}) {
  return (
    <div className="pdf-saved-annotations" aria-hidden="true">
      {rows
        .filter((row) => row.page === page)
        .map((row) => (
          <div
            key={row.id}
            data-annotation-id={row.id}
            data-testid="pdf-saved-annotation"
          >
            {row.rects.map((rect, index) => (
              <span
                key={index}
                style={{
                  left: `${rect.x * 100}%`,
                  top: `${rect.y * 100}%`,
                  width: `${rect.w * 100}%`,
                  height: `${rect.h * 100}%`,
                  backgroundColor: row.color,
                }}
              />
            ))}
          </div>
        ))}
    </div>
  );
}
function ColorPicker({
  value,
  change,
}: {
  value: string;
  change: (value: string) => void;
}) {
  return (
    <ToggleGroup
      type="single"
      className="pdf-annotation-colors"
      value={value.toUpperCase()}
      onValueChange={(value) => {
        if (value) change(value);
      }}
      aria-label="高亮颜色"
    >
      {annotationColors.map((color) => (
        <ToggleGroupItem
          value={color.value}
          key={color.value}
          aria-label={color.label}
          title={color.label}
          style={{ background: color.value }}
        />
      ))}
    </ToggleGroup>
  );
}
export function PdfAnnotationTools({
  store,
  selection,
  navigate,
  fileName,
  fileId,
}: {
  store: ReturnType<typeof usePdfAnnotations>;
  selection: PdfSelection | null;
  navigate: (row: PdfAnnotation) => void;
  fileName: string;
  fileId: string;
}) {
  const panels = useReaderPanels();
  const docked = panels?.fileId === fileId ? panels : null;
  const [open, setOpen] = useState(false),
    [color] = useState(annotationColors[0].value),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState(""),
    [commentsOnly, setCommentsOnly] = useState(false),
    [kind, setKind] = useState<"all" | "highlight" | "comment">("all");
  const [draft, setDraft] = useState<{
    selection?: PdfSelection;
    row?: PdfAnnotation;
    comment: string;
    color: string;
  } | null>(null);
  const valid = !!selection?.rects.length;
  function exportNotes() {
    const text =
      `# ${fileName} · 批注\n\n` +
      store.rows
        .map(
          (row) =>
            `## 第 ${row.page} 页\n\n> ${row.quote.replace(/\n/g, "\n> ")}\n\n${row.comment ? row.comment + "\n\n" : ""}`,
        )
        .join("\n");
    const url = URL.createObjectURL(
      new Blob([text], { type: "text/markdown;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = paperFileName(
      fileName.replace(/\.pdf$/i, ""),
      "-批注",
      "md",
    );
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const rows = store.rows.filter(
    (row) =>
      (!filter || row.color.toUpperCase() === filter) &&
      (docked
        ? kind === "all" || (kind === "comment" ? !!row.comment : !row.comment)
        : !commentsOnly || !!row.comment) &&
      (!query ||
        (row.quote + " " + row.comment)
          .toLocaleLowerCase()
          .includes(query.toLocaleLowerCase())),
  );
  const content = (
    <>
      {" "}
      <div className="pdf-annotations-heading">
        {docked ? (
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            aria-label="批注类型"
            value={kind}
            onValueChange={(value) => {
              if (value) setKind(value as typeof kind);
            }}
          >
            <ToggleGroupItem value="all">全部</ToggleGroupItem>
            <ToggleGroupItem value="highlight">高亮</ToggleGroupItem>
            <ToggleGroupItem value="comment">评论</ToggleGroupItem>
          </ToggleGroup>
        ) : (
          <strong>
            批注 <span>{rows.length}</span>
          </strong>
        )}
        <Button
          size="icon"
          variant="ghost"
          aria-label="导出批注 Markdown"
          disabled={!store.rows.length}
          onClick={exportNotes}
        >
          <Download />
        </Button>
      </div>
      {store.error && (
        <div role="alert" className="pdf-annotation-error">
          {store.error}
          <Button size="sm" variant="ghost" onClick={() => void store.reload()}>
            重新读取
          </Button>
        </div>
      )}
      {draft && (
        <div className="pdf-annotation-editor">
          <blockquote>{draft.row?.quote || draft.selection?.text}</blockquote>
          <ColorPicker
            value={draft.color}
            change={(color) => setDraft({ ...draft, color })}
          />
          <Textarea
            autoFocus
            aria-label="批注评论"
            placeholder="记录你的想法…"
            value={draft.comment}
            onChange={(event) =>
              setDraft({ ...draft, comment: event.target.value })
            }
          />
          <div>
            <Button
              size="sm"
              disabled={store.busy}
              onClick={async () => {
                const ok = draft.row
                  ? await store.update(draft.row, draft.color, draft.comment)
                  : draft.selection
                    ? await store.add(
                        draft.selection,
                        draft.color,
                        draft.comment,
                      )
                    : false;
                if (ok) setDraft(null);
              }}
            >
              保存批注
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
              取消
            </Button>
          </div>
        </div>
      )}
      <Input
        aria-label="搜索批注"
        placeholder="搜索引文或评论…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="pdf-annotation-filters">
        <Choice
          aria-label="按批注颜色筛选"
          value={filter}
          onValueChange={setFilter}
        >
          <option value="">所有颜色</option>
          {annotationColors.map((color) => (
            <option key={color.value} value={color.value}>
              {color.label}
            </option>
          ))}
        </Choice>
        {!docked && (
          <label>
            <Checkbox
              aria-label="有评论"
              checked={commentsOnly}
              onCheckedChange={(value) => setCommentsOnly(value === true)}
            />
            有评论
          </label>
        )}
      </div>
      <div className="pdf-annotation-list">
        {rows.length ? (
          rows.map((row) => (
            <article key={row.id} data-testid="pdf-annotation-row">
              <button
                className="pdf-annotation-jump"
                onClick={() => {
                  navigate(row);
                  setOpen(false);
                }}
              >
                <span>
                  <i style={{ background: row.color }} />第 {row.page} 页
                </span>
                <blockquote>{row.quote}</blockquote>
                {row.comment && <p>{row.comment}</p>}
              </button>
              <div className="pdf-annotation-row-actions">
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="编辑批注"
                  onClick={() =>
                    setDraft({
                      row,
                      comment: row.comment,
                      color: row.color,
                    })
                  }
                >
                  <Pencil />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="删除批注"
                  disabled={store.busy}
                  onClick={() => void store.remove(row)}
                >
                  <Trash2 />
                </Button>
              </div>
            </article>
          ))
        ) : (
          <p className="pdf-annotations-empty">
            {store.rows.length
              ? "没有符合条件的批注"
              : "选择论文文字后，点击高亮或评论。"}
          </p>
        )}
      </div>
    </>
  );
  return (
    <>
      {!docked && (
        <>
          <ReaderButton
            variant="ghost"
            size="icon"
            aria-label="高亮所选文字"
            title="高亮所选文字"
            disabled={!valid || store.busy}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => {
              if (selection)
                void store.add(selection, color, "").then((ok) => {
                  if (!ok) {
                    setOpen(true);
                  }
                });
            }}
          >
            <Highlighter />
          </ReaderButton>
          <ReaderButton
            variant="ghost"
            size="icon"
            aria-label="评论所选文字"
            title="评论所选文字"
            disabled={!valid || store.busy}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => {
              if (selection) {
                setDraft({ selection, comment: "", color });
                setOpen(true);
              }
            }}
          >
            <MessageSquarePlus />
          </ReaderButton>
        </>
      )}
      {docked ? (
        docked.annotationHost &&
        createPortal(
          <div className="pdf-annotations-docked">{content}</div>,
          docked.annotationHost,
        )
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <ReaderButton
              variant="ghost"
              size="icon"
              aria-label="查看批注"
              title={`批注 (${store.rows.length})`}
            >
              <ListFilter />
            </ReaderButton>
          </PopoverTrigger>
          <PopoverContent align="start" className="pdf-annotations-panel">
            {content}
          </PopoverContent>
        </Popover>
      )}
    </>
  );
}
