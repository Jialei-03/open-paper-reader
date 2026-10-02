import type { SourceFile } from "../api";

export type ReaderSelection = {
  category?: "text" | "image" | "table" | "formula" | "url" | "paper";
  page: number;
  source: "selection" | "page" | "region" | "paper";
  quote?: string;
  question?: string;
  prefix?: string;
  rect?: number[];
  rects?: { x: number; y: number; w: number; h: number }[];
};
export type ReaderAction =
  | "ask"
  | "explain"
  | "translate"
  | "guide"
  | "formula";
export type ReaderContext = ReaderSelection & {
  paper_id: string;
  file_id: string;
  version_id: string;
  /** What the reader asked for; translating is recorded apart from explaining. */
  action?: ReaderAction;
};
export type ReaderRequest = {
  submit?: boolean;
  context: ReaderContext;
  label: string;
  prompt: string;
};
export type AskReader = (
  selection: ReaderSelection,
  action: ReaderAction,
) => void;

export function askReader(
  file: SourceFile,
  title: string,
  selection: ReaderSelection,
  action: ReaderAction,
) {
  const scope =
    selection.source === "region"
      ? "所选区域"
      : selection.source === "selection"
        ? "所选文字"
        : selection.source === "paper"
          ? "整篇论文"
          : "当前页";
  const prompts = {
    formula:
      "请只解释框选区域中的公式：准确转写公式，说明符号定义、假设及推导含义，并结合相邻上下文说明用途。不能辨认的符号请明确说明，不要猜测，也不要扩展为整页导读。",
    ask: selection.question?.trim() || `关于${scope}，我想了解：`,
    explain: `请结合论文上下文解释${scope}，说明概念、论证及其局限，并给出原文依据。`,
    translate:
      selection.source === "selection"
        ? "请将所选文字翻译成中文，保留公式、术语和引用编号。只翻译这段内容，不自动新建笔记。"
        : `请读取${scope}并翻译成中文，保留段落结构、公式、术语和引用编号。只翻译${scope}，不要扩展到其他页，不自动新建笔记。`,
    guide:
      "请先阅读这篇论文，再按研究问题、方法、主要结果、局限四部分给出导读，标明证据页码。不要自动新建笔记。",
  };
  window.dispatchEvent(
    new CustomEvent<ReaderRequest>(
      action === "explain" || action === "translate" || action === "formula"
        ? "reader-explanation"
        : "ask-research-agent",
      {
        detail: {
          submit: action === "ask" && !!selection.question?.trim(),
          context: {
            category:
              selection.category ||
              (action === "formula"
                ? "formula"
                : selection.source === "region"
                  ? "image"
                  : selection.source === "paper"
                    ? "paper"
                    : "text"),
            page: selection.page,
            source: selection.source,
            ...(selection.source === "selection"
              ? {
                  quote: selection.quote,
                  prefix: selection.prefix,
                  rects: selection.rects,
                }
              : {}),
            ...(selection.source === "region" ? { rect: selection.rect } : {}),
            paper_id: file.paper_id,
            file_id: file.id,
            version_id: file.version_id,
            action,
          },
          label:
            selection.source === "paper"
              ? title
              : `${title} · 第 ${selection.page} 页`,
          prompt: prompts[action],
        },
      },
    ),
  );
}

// Shared in-memory selection; server membership is checked before quick actions.
const paperSessions = new Map<string, string>();
export const selectedPaperSession = (paperId: string) =>
  paperSessions.get(paperId) || "";
export const selectPaperSession = (paperId: string, sessionId: string) => {
  paperSessions.set(paperId, sessionId);
};
