import { EditorContent, useEditor } from "@tiptap/react";
import type { Transaction } from "@tiptap/pm/state";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { noteExtensions, type FormulaClick } from "../../lib/note-editor";
import { Button, Dialog, TextArea, TextField } from "../../ui";
import {
  CiteProvider,
  NoteCitation,
  marksIn,
  noteLeafText,
  verifyMarks,
  type CiteTarget,
} from "../cite";
import type { ReaderRoute } from "../route";
import { serviceReason } from "../service-error";
import { readerRouteOf } from "./noteLink";
import { NoteToolbar } from "./NoteToolbar";
import {
  pageMarkdown,
  quoteMarkdown,
  shownPage,
  usePaperQuote,
} from "./paperQuote";
import styles from "./NoteEditor.module.css";

/** What an image may weigh and how many may come at once, as the service allows. */
const MAX_IMAGES = 8;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export interface NoteEditorProps {
  /** The note's Markdown. The editor follows it when it changes from outside (a block added, the service's version). */
  body: string;
  /** The person changed the text. */
  onChange(markdown: string): void;
  /** The editor lost the keyboard, or Mod+S was pressed: write down what is waiting. */
  onFlush(): void;
  /** A link into a paper was opened (Mod-click). */
  onJump(route: ReaderRoute): void;
  /** Puts an image pasted or dropped into the note; its address comes back. */
  onImage(file: File): Promise<{ url: string; name: string }>;
  /** The paper the note is about: where the sentence citations in the text lead, and are looked up. */
  cite?: CiteTarget;
}

/**
 * The note's text, written as it will read: Markdown shortcuts and the usual
 * keys format it (`## `, `- `, `> `, `**bold**`, Mod+B, Mod+Z), a pasted or
 * dropped image is kept with the note, and a click on a formula edits it. A
 * link opens with Mod-click (a plain click puts the caret in it); one into a
 * paper opens that paper in the reader.
 */
export function NoteEditor({
  body,
  onChange,
  onFlush,
  onJump,
  onImage,
  cite,
}: NoteEditorProps) {
  const i18n = useI18n();
  const { t } = i18n;
  const [formula, setFormula] = useState<FormulaClick | null>(null);
  const [problem, setProblem] = useState("");
  const [uploading, setUploading] = useState(false);
  // The link being written: its address and, with nothing selected, its words.
  const [link, setLink] = useState<{
    href: string;
    text: string;
    bare: boolean;
  } | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const paperQuote = usePaperQuote();

  // What the editor's handlers call; they are made once, so they read these.
  const latest = useRef({ onChange, onFlush, onJump, onImage });
  latest.current = { onChange, onFlush, onJump, onImage };
  const upload = useRef<(files: File[], position?: number) => void>(() => {});
  const busy = useRef(false);

  const editor = useEditor({
    extensions: noteExtensions(
      setFormula,
      {
        alt: t("reader.notes.image.alt"),
        missing: (alt) =>
          t("reader.notes.image.placeholder", {
            alt: alt || t("reader.notes.image.placeholderEmpty"),
          }),
      },
      [NoteCitation],
    ),
    content: body,
    contentType: "markdown",
    editorProps: {
      // Copied as plain text, a citation reads "(p. 3)"; the HTML keeps it as a citation.
      clipboardTextSerializer: (slice) =>
        slice.content.textBetween(0, slice.content.size, "\n\n", noteLeafText),
      attributes: {
        class: styles.prose,
        role: "textbox",
        "aria-label": t("reader.notes.editor"),
        "aria-multiline": "true",
      },
      handlePaste: (_view, event) => {
        const files = images(event.clipboardData?.files);
        if (!files.length) return false;
        event.preventDefault();
        upload.current(files);
        return true;
      },
      handleDOMEvents: {
        // A file dropped on the page would otherwise be opened in place of it.
        dragover: (_view, event) => {
          if (!event.dataTransfer?.types.includes("Files")) return false;
          event.preventDefault();
          return true;
        },
        drop: (view, event) => {
          if (!event.dataTransfer?.types.includes("Files")) return false;
          event.preventDefault();
          const files = images(event.dataTransfer.files);
          if (files.length)
            upload.current(
              files,
              view.posAtCoords({ left: event.clientX, top: event.clientY })
                ?.pos,
            );
          return true;
        },
        blur: () => {
          latest.current.onFlush();
          return false;
        },
      },
      handleKeyDown: (_view, event) => {
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === "s"
        ) {
          event.preventDefault();
          latest.current.onFlush();
          return true;
        }
        return false;
      },
      handleClick: (_view, _pos, event) => {
        const link = (event.target as HTMLElement).closest("a");
        if (!link || !(event.metaKey || event.ctrlKey)) return false;
        const href = link.getAttribute("href") ?? "";
        const route = readerRouteOf(href);
        if (route) latest.current.onJump(route);
        else if (href.startsWith("#")) location.hash = href;
        else if (/^https?:\/\//.test(href))
          window.open(href, "_blank", "noopener,noreferrer");
        return true;
      },
    },
    onUpdate: ({ editor }) => latest.current.onChange(editor.getMarkdown()),
  });

  upload.current = async (files, position) => {
    if (!editor || busy.current) return;
    busy.current = true;
    setUploading(true);
    setProblem("");
    // Where the image goes follows what is typed meanwhile.
    let anchor = position ?? editor.state.selection.from;
    const follow = ({ transaction }: { transaction: Transaction }) => {
      anchor = transaction.mapping.map(anchor);
    };
    editor.on("transaction", follow);
    try {
      if (files.length > MAX_IMAGES)
        return setProblem(t("reader.notes.image.tooMany"));
      for (const file of files) {
        if (file.size > MAX_IMAGE_BYTES)
          return setProblem(t("reader.notes.image.tooLarge"));
        const image = await latest.current.onImage(file);
        if (editor.isDestroyed) return;
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
        latest.current.onFlush();
      }
    } catch (reason) {
      setProblem(
        serviceReason(reason, i18n, { fallback: "reader.notes.image.failed" }),
      );
    } finally {
      editor.off("transaction", follow);
      busy.current = false;
      setUploading(false);
    }
  };

  // The citations in the text are looked up on the paper once, whatever their number.
  const fileId = cite?.fileId;
  useEffect(() => {
    if (fileId) void verifyMarks(fileId, marksIn(body));
  }, [fileId, body]);

  // The text changed from outside the editor: show it, without counting it as typing.
  useEffect(() => {
    if (editor && !editor.isDestroyed && editor.getMarkdown() !== body)
      editor.commands.setContent(body, {
        contentType: "markdown",
        emitUpdate: false,
      });
  }, [editor, body]);

  const saveFormula = () => {
    if (!formula || !editor) return;
    // A new one, from the bar: put in where the caret is.
    if (formula.pos < 0) {
      const latex = formula.latex.trim();
      if (latex)
        editor
          .chain()
          .focus()
          .insertContent(
            formula.block
              ? { type: "blockMath", attrs: { latex } }
              : { type: "inlineMath", attrs: { latex } },
          )
          .run();
      setFormula(null);
      return;
    }
    const node = editor.state.doc.nodeAt(formula.pos);
    if (node?.type.name === (formula.block ? "blockMath" : "inlineMath"))
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
  };

  const openLink = () => {
    if (!editor) return;
    const { from, to, empty } = editor.state.selection;
    setLink({
      href: (editor.getAttributes("link").href as string | undefined) ?? "",
      text: empty ? "" : editor.state.doc.textBetween(from, to, " "),
      bare: empty,
    });
  };
  const saveLink = () => {
    if (!link || !editor) return;
    const href = link.href.trim();
    const chain = editor.chain().focus().extendMarkRange("link");
    if (!href) chain.unsetLink().run();
    else if (!/^(https?:\/\/|#|mailto:)/i.test(href)) return;
    else if (link.bare)
      chain
        .insertContent({
          type: "text",
          text: link.text.trim() || href,
          marks: [{ type: "link", attrs: { href } }],
        })
        .insertContent(" ")
        .run();
    else chain.setLink({ href }).run();
    setLink(null);
  };
  const linkValid =
    !link?.href.trim() || /^(https?:\/\/|#|mailto:)/i.test(link.href.trim());

  const insertMarkdown = (markdown: string) => {
    editor
      ?.chain()
      .focus()
      .insertContent(markdown, { contentType: "markdown" })
      .run();
    latest.current.onFlush();
  };
  const paperOf = cite ? { paperId: cite.paperId, fileId: cite.fileId } : null;

  return (
    <div
      className={styles.surface}
      data-empty={!body.trim()}
      style={{
        // The hint is drawn by CSS, which can only read it from here.
        ["--note-placeholder" as string]: JSON.stringify(
          t("reader.notes.placeholder"),
        ),
      }}
    >
      {editor && (
        <NoteToolbar
          editor={editor}
          onImage={() => picker.current?.click()}
          onLink={openLink}
          onFormula={() =>
            setFormula({
              pos: -1,
              latex: "",
              block: editor.state.selection.empty,
            })
          }
          paper={
            paperOf
              ? {
                  quote: paperQuote,
                  page: shownPage,
                  onCite: (quote) =>
                    insertMarkdown(
                      quoteMarkdown(
                        quote,
                        paperOf,
                        t("reader.notes.source", { page: quote.page }),
                      ),
                    ),
                  onPage: (at) =>
                    insertMarkdown(
                      pageMarkdown(
                        at,
                        paperOf,
                        t("reader.notes.source", { page: at }),
                      ),
                    ),
                }
              : undefined
          }
        />
      )}
      <input
        ref={picker}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        hidden
        onChange={(event) => {
          const files = images(event.target.files);
          event.target.value = "";
          if (files.length) upload.current(files);
        }}
      />
      <CiteProvider target={cite ?? null}>
        <EditorContent editor={editor} />
      </CiteProvider>
      {uploading && (
        <p className={styles.notice} role="status">
          {t("reader.notes.image.uploading")}
        </p>
      )}
      {problem && (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      )}
      <Dialog
        open={link !== null}
        onClose={() => setLink(null)}
        title={t("reader.notes.link.title")}
        footer={
          <>
            <Button onClick={() => setLink(null)}>{t("common.cancel")}</Button>
            <Button variant="primary" disabled={!linkValid} onClick={saveLink}>
              {t("reader.notes.link.save")}
            </Button>
          </>
        }
      >
        <form
          className={styles.linkForm}
          onSubmit={(event) => {
            event.preventDefault();
            saveLink();
          }}
        >
          <TextField
            label={t("reader.notes.link.href")}
            value={link?.href ?? ""}
            placeholder="https://"
            autoFocus
            error={linkValid ? undefined : t("reader.notes.link.invalid")}
            onChange={(event) => {
              const href = event.target.value;
              setLink((old) => old && { ...old, href });
            }}
          />
          {link?.bare && (
            <TextField
              label={t("reader.notes.link.text")}
              value={link.text}
              onChange={(event) => {
                const text = event.target.value;
                setLink((old) => old && { ...old, text });
              }}
            />
          )}
          <button type="submit" hidden />
        </form>
      </Dialog>
      <Dialog
        open={formula !== null}
        onClose={() => setFormula(null)}
        title={t(
          formula && formula.pos < 0
            ? "reader.notes.formula.new"
            : "reader.notes.formula.title",
        )}
        footer={
          <>
            <Button onClick={() => setFormula(null)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" onClick={saveFormula}>
              {t("reader.notes.formula.save")}
            </Button>
          </>
        }
      >
        <TextArea
          label={t("reader.notes.formula.label")}
          value={formula?.latex ?? ""}
          autoGrow
          onChange={(event) => {
            const latex = event.target.value;
            setFormula((old) => old && { ...old, latex });
          }}
        />
      </Dialog>
    </div>
  );
}

const images = (files: FileList | null | undefined) =>
  Array.from(files ?? []).filter((file) => file.type.startsWith("image/"));
