import { safeNoteImage } from "../lib/note-images";
import { useReferenceHighlight } from "../lib/reference";
import { ReadingBadge, ContentTypesContext } from "./ContentBadge";
import { Badge } from "./ui/badge";
import {
  Item as ListItem,
  ItemMedia,
  ItemContent,
  ItemTitle,
  ItemDescription,
  ItemActions,
} from "./ui/item";
import {
  Empty as EmptyRoot,
  EmptyHeader,
  EmptyMedia,
  EmptyDescription,
} from "./ui/empty";
import { Button } from "@/components/ui/button";
import React from "react";
import { BookOpen, ArrowUpRight, FileText, Star } from "lucide-react";
import { statusLabel, Paper } from "../api";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { safeMathOptions } from "../lib/note-math";
const EMPTY = "暂无内容";
export function Markdown({
  body,
  contentId,
  reference = "",
  prefix = "",
}: {
  body: string;
  contentId?: string;
  reference?: string;
  prefix?: string;
}) {
  const root = React.useRef<HTMLDivElement>(null);
  const [selection, setSelection] = React.useState<{
    text: string;
    prefix: string;
  } | null>(null);
  const [copied, setCopied] = React.useState(false);
  useReferenceHighlight(root, reference, prefix, body);
  const types = React.useContext(ContentTypesContext);
  return (
    <div>
      {selection && contentId && (
        <button
          className="reference-copy"
          onMouseDown={(e) => e.preventDefault()}
          onClick={async () => {
            const params = new URLSearchParams({
              quote: selection.text,
              prefix: selection.prefix,
            });
            await navigator.clipboard.writeText(
              `[${selection.text.replace(/[\[\]\n]/g, " ")}](#${contentId}?${params})`,
            );
            setCopied(true);
          }}
        >
          {copied ? "引用已复制" : "复制此处引用"}
        </button>
      )}
      <div
        className="markdown"
        ref={root}
        onMouseUp={() => {
          const selected = window.getSelection();
          if (
            !contentId ||
            !selected?.rangeCount ||
            !root.current?.contains(selected.anchorNode) ||
            !root.current.contains(selected.focusNode) ||
            selected.isCollapsed
          ) {
            setSelection(null);
            return;
          }
          const range = selected.getRangeAt(0),
            before = range.cloneRange();
          before.selectNodeContents(root.current);
          before.setEnd(range.startContainer, range.startOffset);
          setCopied(false);
          setSelection({
            text: selected.toString(),
            prefix: before.toString().slice(-40),
          });
        }}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[[rehypeKatex, safeMathOptions]]}
          skipHtml
          components={{
            img: ({ src, alt }) =>
              safeNoteImage(src) ? (
                <img src={src} alt={alt || "笔记图片"} loading="lazy" />
              ) : (
                <span className="muted">[外部图片已阻止；请通过附件查看]</span>
              ),
            a: ({ href, children }) =>
              href?.split("?")[0] === "#" + contentId ? (
                <span>{children}</span>
              ) : (
                <a
                  href={href}
                  onClick={() => {
                    if (href && window.location.hash === href)
                      window.dispatchEvent(new Event("reference-navigate"));
                  }}
                  data-kind={
                    href?.startsWith("#")
                      ? types[href.slice(1).split("?")[0]]
                      : undefined
                  }
                  target={href?.startsWith("#") ? undefined : "_blank"}
                  rel="noopener noreferrer"
                >
                  {children}
                </a>
              ),
          }}
        >
          {body}
        </ReactMarkdown>
      </div>
      {reference && (
        <p className="reference-missing">引用位置未找到，内容可能已被修改。</p>
      )}
    </div>
  );
}
export function Empty({ text = EMPTY }: { text?: string }) {
  return (
    <EmptyRoot>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <BookOpen />
        </EmptyMedia>
        <EmptyDescription>{text}</EmptyDescription>
      </EmptyHeader>
    </EmptyRoot>
  );
}
export function PageHead({
  title,
  subtitle,
  action,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
      </div>
      {action}
    </header>
  );
}
export function PaperRow({
  paper: p,
  go,
}: {
  paper: Paper;
  go: (r: string) => void;
}) {
  return (
    <ListItem variant="outline" asChild>
      <button type="button" onClick={() => go("paper/" + p.id)}>
        <ItemMedia variant="icon">
          <FileText />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>
            {p.title}
            {p.favorite && <Star />}
          </ItemTitle>
          <ItemDescription>{p.authors || p.external_id}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <ReadingBadge status={p.reading_status} />
        </ItemActions>
      </button>
    </ListItem>
  );
}
