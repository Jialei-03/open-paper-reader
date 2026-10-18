import { noteExtensions } from "../lib/note-editor";
import {
  appendToNote,
  getNoteDraft,
  NOTE_STATUS,
  noteDocument,
  saveNote,
} from "../lib/note-document";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";
import { Textarea } from "./ui/textarea";
import { Field, FieldLabel } from "./ui/field";
import { ReaderButton } from "./ReaderControls";
import { Popover, PopoverTrigger, PopoverContent } from "./ui/popover";
import { NoteConflict } from "./NoteConflict";
import { LinkPicker } from "./LinkPicker";
import type { KnowledgeNode } from "../lib/knowledge";
import { useReferenceHighlight } from "../lib/reference";
import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import {
  Link as LinkIcon,
  Bold,
  Italic,
  Heading2,
  List,
  ListTodo,
  Quote,
  Code,
  Table2,
  Undo,
  Redo,
  ImagePlus,
} from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Alert, AlertDescription } from "./ui/alert";
import { api, type Item } from "../api";

export { appendToNote, getNoteDraft, saveNote };
/** The old reader speaks Chinese only: its images are named as they always were. */
const LIVE_NOTE_IMAGES = {
  alt: "笔记图片",
  missing: (alt: string) => `[图片：${alt || "请通过附件查看"}]`,
};
export function LiveNote({
  note,
  nodes = [],
}: {
  note: Item;
  nodes?: KnowledgeNode[];
}) {
  const root = useRef<HTMLDivElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const [imageError, setImageError] = useState("");
  const [uploading, setUploading] = useState(false);
  const busy = useRef(false);
  const uploadImages = useRef<(files: File[], position?: number) => void>(
    () => {},
  );
  const query = new URLSearchParams(location.hash.split("?")[1]);
  const [doc] = useState(() => noteDocument(note));
  const [state, setState] = useState(doc.state);
  const update = useRef((body: string) => doc.update({ body }));
  const [formula, setFormula] = useState<{
    pos: number;
    latex: string;
    block: boolean;
  } | null>(null);
  const editor = useEditor({
    extensions: noteExtensions(setFormula, LIVE_NOTE_IMAGES),
    content: state.body,
    contentType: "markdown",
    editorProps: {
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files || []).filter((f) =>
          f.type.startsWith("image/"),
        );
        if (!files.length) return false;
        event.preventDefault();
        uploadImages.current(files);
        return true;
      },
      handleDOMEvents: {
        dragover: (_view, event) => {
          if (!event.dataTransfer?.types.includes("Files")) return false;
          event.preventDefault();
          return true;
        },
        drop: (view, event) => {
          const files = Array.from(event.dataTransfer?.files || []).filter(
            (f) => f.type.startsWith("image/"),
          );
          if (!files.length) return false;
          event.preventDefault();
          uploadImages.current(
            files,
            view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos,
          );
          return true;
        },
      },
      handleKeyDown: (_view, e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
          e.preventDefault();
          void doc.save();
          return true;
        }
        return false;
      },
      attributes: {
        class: "markdown live-note-editor",
        role: "textbox",
        "aria-label": "笔记正文",
        "aria-multiline": "true",
      },
      handleClick: (_view, _pos, e) => {
        const a = (e.target as HTMLElement).closest("a");
        if (!a || !(e.metaKey || e.ctrlKey)) return false;
        const href = a.getAttribute("href") || "";
        if (href.startsWith("#")) {
          location.hash = href;
          window.dispatchEvent(new Event("reference-navigate"));
        } else if (/^https?:\/\//.test(href))
          window.open(href, "_blank", "noopener,noreferrer");
        return true;
      },
    },
    onUpdate: ({ editor }) => update.current(editor.getMarkdown()),
  });
  uploadImages.current = async (files, position) => {
    if (!editor || busy.current) return;
    busy.current = true;
    setUploading(true);
    setImageError("");
    let anchor = position ?? editor.state.selection.from;
    const track = ({
      transaction,
    }: {
      transaction: import("@tiptap/pm/state").Transaction;
    }) => {
      anchor = transaction.mapping.map(anchor);
    };
    editor.on("transaction", track);
    try {
      if (files.length > 8) throw new Error("一次最多插入 8 张图片");
      for (const file of files) {
        if (file.size > 8 * 1024 * 1024)
          throw new Error("单张图片不能超过 8 MB");
        const form = new FormData();
        form.append("file", file);
        const image = await api<{ url: string; name: string }>(
          `/items/${note.id}/images`,
          { method: "POST", body: form },
        );
        if (editor.isDestroyed) {
          await appendToNote(note, `\n\n![图片](${image.url})\n`);
        } else {
          editor
            .chain()
            .insertContentAt(anchor, {
              type: "image",
              attrs: {
                src: image.url,
                alt: image.name.replace(/[\[\]\\\r\n]/g, " "),
              },
            })
            .run();
          await doc.save();
        }
      }
    } catch (error) {
      setImageError(
        error instanceof Error ? error.message : "图片上传失败，请重试",
      );
    } finally {
      editor.off("transaction", track);
      busy.current = false;
      setUploading(false);
    }
  };
  useEffect(() => {
    const listener = () => setState({ ...doc.state });
    doc.listeners.add(listener);
    void doc.save();
    const leave = (e: BeforeUnloadEvent) => {
      if (doc.state.status !== NOTE_STATUS.saved) {
        e.preventDefault();
        void doc.save();
      }
    };
    window.addEventListener("beforeunload", leave);
    return () => {
      doc.listeners.delete(listener);
      window.removeEventListener("beforeunload", leave);
      void doc.save();
    };
  }, [doc]);
  useEffect(() => doc.accept(note), [note, doc]);
  useEffect(() => {
    if (editor && editor.getMarkdown() !== state.body)
      editor.commands.setContent(state.body, {
        contentType: "markdown",
        emitUpdate: false,
      });
  }, [editor, state.body]);
  useReferenceHighlight(
    root,
    query.get("quote") || "",
    query.get("prefix") || "",
    state.body,
  );
  const tools = editor
    ? [
        {
          label: "加粗",
          icon: Bold,
          run: () => editor.chain().focus().toggleBold().run(),
        },
        {
          label: "斜体",
          icon: Italic,
          run: () => editor.chain().focus().toggleItalic().run(),
        },
        {
          label: "二级标题",
          icon: Heading2,
          run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
        },
        {
          label: "无序列表",
          icon: List,
          run: () => editor.chain().focus().toggleBulletList().run(),
        },
        {
          label: "任务清单",
          icon: ListTodo,
          run: () => editor.chain().focus().toggleTaskList().run(),
        },
        {
          label: "引用",
          icon: Quote,
          run: () => editor.chain().focus().toggleBlockquote().run(),
        },
        {
          label: "代码块",
          icon: Code,
          run: () => editor.chain().focus().toggleCodeBlock().run(),
        },
        {
          label: "表格",
          icon: Table2,
          run: () =>
            editor
              .chain()
              .focus()
              .insertTable({ rows: 3, cols: 2, withHeaderRow: true })
              .run(),
        },
        {
          label: "撤销",
          icon: Undo,
          run: () => editor.chain().focus().undo().run(),
        },
        {
          label: "重做",
          icon: Redo,
          run: () => editor.chain().focus().redo().run(),
        },
      ]
    : [];
  return (
    <div className="live-note" onBlur={() => void doc.save()}>
      <div className="note-title-row">
        <Input
          aria-label="笔记标题"
          value={state.title}
          maxLength={500}
          onChange={(e) => doc.update({ title: e.target.value })}
        />
        <span className="note-save-status" role="status">
          {state.status}
        </span>
      </div>
      <div
        className="note-format-toolbar"
        role="group"
        aria-label="笔记格式工具"
      >
        <input
          ref={imageInput}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          hidden
          aria-label="上传笔记图片"
          onChange={(e) => {
            uploadImages.current(Array.from(e.target.files || []));
            e.target.value = "";
          }}
        />
        <ReaderButton
          size="icon-sm"
          variant="ghost"
          title="插入图片"
          aria-label="插入图片"
          disabled={uploading}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => imageInput.current?.click()}
        >
          <ImagePlus />
        </ReaderButton>
        {tools.map((t) => (
          <ReaderButton
            key={t.label}
            size="icon-sm"
            variant="ghost"
            title={t.label}
            aria-label={t.label}
            onMouseDown={(e) => e.preventDefault()}
            onClick={t.run}
          >
            <t.icon />
          </ReaderButton>
        ))}
        <Popover>
          <PopoverTrigger asChild>
            <ReaderButton
              variant="ghost"
              size="icon-sm"
              aria-label="关联与引用"
              title="关联与引用"
            >
              <LinkIcon />
            </ReaderButton>
          </PopoverTrigger>
          <PopoverContent className="note-reference-menu" align="end">
            <div className="note-reference-actions">
              <LinkPicker
                nodes={nodes.filter((n) => n.id !== "item/" + note.id)}
                insert={(text) => {
                  editor
                    ?.chain()
                    .focus()
                    .insertContent(text, { contentType: "markdown" })
                    .run();
                }}
              />
            </div>
            <p>可粘贴或拖入图片 · ⌘ / Ctrl + 点击打开链接</p>
          </PopoverContent>
        </Popover>
      </div>
      {uploading && (
        <p role="status" className="text-xs text-muted-foreground">
          正在上传图片…
        </p>
      )}
      {imageError && (
        <Alert variant="destructive">
          <AlertDescription>{imageError}</AlertDescription>
        </Alert>
      )}
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>
            {state.error}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigator.clipboard.writeText(state.body)}
              >
                复制本地草稿
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void doc.reload().catch(() => {})}
              >
                使用服务器版本（放弃草稿）
              </Button>
              {!state.error.includes("新版本") && (
                <Button variant="outline" size="sm" onClick={() => doc.retry()}>
                  重试保存
                </Button>
              )}
            </div>
          </AlertDescription>
        </Alert>
      )}
      <Dialog
        open={!!formula}
        onOpenChange={(open) => {
          if (!open) setFormula(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑公式</DialogTitle>
            <DialogDescription>
              修改 LaTeX 内容，保存后自动更新笔记。
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="note-formula">LaTeX 公式</FieldLabel>
            <Textarea
              id="note-formula"
              value={formula?.latex || ""}
              onChange={(event) =>
                setFormula(
                  (old) => old && { ...old, latex: event.target.value },
                )
              }
            />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormula(null)}>
              取消
            </Button>
            <Button
              onClick={() => {
                if (!formula || !editor) return;
                const node = editor.state.doc.nodeAt(formula.pos);
                if (
                  node?.type.name !==
                  (formula.block ? "blockMath" : "inlineMath")
                ) {
                  setFormula(null);
                  return;
                }
                editor
                  .chain()
                  .focus()
                  .command(({ tr }) => {
                    tr.setNodeMarkup(formula.pos, undefined, {
                      ...node.attrs,
                      latex: formula.latex,
                    });
                    return true;
                  })
                  .run();
                setFormula(null);
              }}
            >
              保存公式
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <NoteConflict
        available={state.error.includes("新版本")}
        stage={doc.update}
        compare={doc.compare}
        merge={doc.merge}
      />
      <div
        ref={root}
        className="note-reference"
        data-empty={!state.body.trim()}
      >
        <EditorContent editor={editor} />
      </div>
      {query.get("quote") && (
        <p className="reference-missing">引用位置未找到，内容可能已被修改。</p>
      )}
    </div>
  );
}
