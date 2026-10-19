import { useEditorState, type Editor } from "@tiptap/react";
import {
  Bold,
  ChevronDown,
  Code,
  Heading,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  Sigma,
  SquareCode,
  Strikethrough,
  Table,
  TextQuote,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/i18n";
import { Button, IconButton, Menu, type MenuEntry } from "../../ui";
import { shorten } from "../assistant/runs";
import type { PaperQuote } from "./paperQuote";
import styles from "./NoteEditor.module.css";

export interface NoteToolbarProps {
  editor: Editor;
  /** Opens the file picker for images. */
  onImage(): void;
  /** Opens the link dialog. */
  onLink(): void;
  /** Opens the formula dialog for a new formula. */
  onFormula(): void;
  /** The paper's own: the sentence last selected in it, and the page shown. */
  paper?: {
    quote(): PaperQuote | null;
    /** The page in view, read when the bar is pressed. */
    page(): number | null;
    onCite(quote: PaperQuote): void;
    onPage(page: number): void;
  };
}

type Tool = {
  key: MessageKey;
  icon: LucideIcon;
  active?: boolean;
  run(): void;
};

/**
 * The note's formatting bar: the kind of block, the marks, the lists, and what
 * can be put in (a link, an image, a formula, a table, the paper's own words).
 * Every tool is also a Markdown shortcut (`## `, `**`, `- [ ] `); the bar is for
 * finding them. Pressing it does not take the caret out of the note.
 */
export function NoteToolbar({
  editor,
  onImage,
  onLink,
  onFormula,
  paper,
}: NoteToolbarProps) {
  const { t } = useI18n();
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      task: e.isActive("taskList"),
      quote: e.isActive("blockquote"),
      codeBlock: e.isActive("codeBlock"),
      link: e.isActive("link"),
      level: ([1, 2, 3] as const).find((level) =>
        e.isActive("heading", { level }),
      ),
      table: e.isActive("table"),
    }),
  });
  // The paper's selection, read when the button is pressed (before the press can clear it).
  const [seen, setSeen] = useState<PaperQuote | null>(null);
  const [shown, setShown] = useState<number | null>(null);

  const chain = () => editor.chain().focus();
  const marks: Tool[] = [
    {
      key: "reader.notes.tool.bold",
      icon: Bold,
      active: state.bold,
      run: () => chain().toggleBold().run(),
    },
    {
      key: "reader.notes.tool.italic",
      icon: Italic,
      active: state.italic,
      run: () => chain().toggleItalic().run(),
    },
    {
      key: "reader.notes.tool.strike",
      icon: Strikethrough,
      active: state.strike,
      run: () => chain().toggleStrike().run(),
    },
    {
      key: "reader.notes.tool.code",
      icon: Code,
      active: state.code,
      run: () => chain().toggleCode().run(),
    },
  ];
  const blocks: Tool[] = [
    {
      key: "reader.notes.tool.bullet",
      icon: List,
      active: state.bullet,
      run: () => chain().toggleBulletList().run(),
    },
    {
      key: "reader.notes.tool.ordered",
      icon: ListOrdered,
      active: state.ordered,
      run: () => chain().toggleOrderedList().run(),
    },
    {
      key: "reader.notes.tool.task",
      icon: ListChecks,
      active: state.task,
      run: () => chain().toggleTaskList().run(),
    },
    {
      key: "reader.notes.tool.quote",
      icon: Quote,
      active: state.quote,
      run: () => chain().toggleBlockquote().run(),
    },
    {
      key: "reader.notes.tool.codeBlock",
      icon: SquareCode,
      active: state.codeBlock,
      run: () => chain().toggleCodeBlock().run(),
    },
  ];
  const inserts: Tool[] = [
    {
      key: "reader.notes.tool.link",
      icon: LinkIcon,
      active: state.link,
      run: onLink,
    },
    { key: "reader.notes.tool.image", icon: ImageIcon, run: onImage },
    { key: "reader.notes.tool.formula", icon: Sigma, run: onFormula },
    {
      key: "reader.notes.tool.table",
      icon: Table,
      active: state.table,
      run: () =>
        chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
    },
    {
      key: "reader.notes.tool.divider",
      icon: Minus,
      run: () => chain().setHorizontalRule().run(),
    },
  ];

  const headingItems: MenuEntry[] = [
    {
      id: "p",
      label: t("reader.notes.tool.paragraph"),
      onSelect: () => chain().setParagraph().run(),
    },
    ...([1, 2, 3] as const).map((level) => ({
      id: `h${level}`,
      label: t("reader.notes.tool.heading", { level }),
      onSelect: () => chain().toggleHeading({ level }).run(),
    })),
  ];

  const quote = seen;
  const citeItems: MenuEntry[] = paper
    ? [
        {
          id: "quote",
          label: quote
            ? t("reader.notes.tool.citeQuote", {
                quote: shorten(quote.text, 24),
                page: quote.page,
              })
            : t("reader.notes.tool.citeNone"),
          disabled: !quote,
          onSelect: () => quote && paper.onCite(quote),
        },
        ...(shown
          ? [
              {
                id: "page",
                label: t("reader.notes.tool.citePage", { page: shown }),
                onSelect: () => paper.onPage(shown),
              },
            ]
          : []),
      ]
    : [];

  const button = (tool: Tool) => (
    <IconButton
      key={tool.key}
      icon={tool.icon}
      label={t(tool.key)}
      size="sm"
      aria-pressed={tool.active ?? undefined}
      // Keeps the caret (and the selection) in the note.
      onMouseDown={(event) => event.preventDefault()}
      onClick={tool.run}
    />
  );

  return (
    <div
      className={styles.toolbar}
      role="toolbar"
      aria-label={t("reader.notes.tool.bar")}
      onPointerDownCapture={() => {
        if (!paper) return;
        setSeen(paper.quote());
        setShown(paper.page());
      }}
    >
      <Menu
        label={t("reader.notes.tool.block")}
        items={headingItems}
        trigger={(props) => (
          <Button
            {...props}
            size="sm"
            variant="ghost"
            icon={Heading}
            className={styles.blockPicker}
            onMouseDown={(event) => event.preventDefault()}
          >
            <span className={styles.blockInner}>
              {state.level
                ? t("reader.notes.tool.heading", { level: state.level })
                : t("reader.notes.tool.paragraph")}
              <ChevronDown size={12} aria-hidden="true" />
            </span>
          </Button>
        )}
      />
      <span className={styles.toolGap} aria-hidden="true" />
      {marks.map(button)}
      <span className={styles.toolGap} aria-hidden="true" />
      {blocks.map(button)}
      <span className={styles.toolGap} aria-hidden="true" />
      {inserts.map(button)}
      {paper && (
        <>
          <span className={styles.toolGap} aria-hidden="true" />
          <Menu
            label={t("reader.notes.tool.cite")}
            items={citeItems}
            trigger={(props) => (
              <Button
                {...props}
                size="sm"
                variant="ghost"
                icon={TextQuote}
                onMouseDown={(event) => event.preventDefault()}
              >
                {t("reader.notes.tool.cite")}
              </Button>
            )}
          />
        </>
      )}
    </div>
  );
}
