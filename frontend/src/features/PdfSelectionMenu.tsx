import { api } from "../api";
import { Spinner } from "../components/ui/spinner";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import {
  annotationColors,
  type PdfSelection,
  type usePdfAnnotations,
} from "./PdfAnnotations";
import {
  ArrowUp,
  BookOpen,
  ChevronDown,
  Copy,
  Highlighter,
  Image as ImageIcon,
  Languages,
  MessageCircle,
  Quote,
  Sigma,
  Sparkles,
} from "lucide-react";
import "./pdf-selection-menu.css";
export type PageAction = "explain" | "translate" | "ask" | "discuss";
export type RegionAction =
  | "explain"
  | "formula"
  | "translate"
  | "ask"
  | "quote"
  | "saveImage"
  | "copyImage"
  | "discuss";
export function PdfSelectionMenu({
  fileId,
  children,
  enabled = true,
  selection,
  store,
  onQuote,
  onAsk,
  onPreview,
  region,
  onRegionAction,
  onPageAction,
}: {
  fileId: string;
  /** With nothing selected, a right-click still offers to work on the page under it. */
  onPageAction?: (action: PageAction, page: number, question?: string) => void;
  /** A box drawn around a figure, table or formula; it gets its own menu. */
  region?: { token: number; anchor?: { x: number; y: number } } | null;
  onRegionAction?: (action: RegionAction, question?: string) => void;
  onPreview?: (
    value: {
      page: number;
      quote: string;
      prefix?: string;
      rects: PdfSelection["rects"];
    } | null,
  ) => void;
  children: ReactElement;
  enabled?: boolean;
  selection: PdfSelection | null;
  store: ReturnType<typeof usePdfAnnotations>;
  onQuote?: () => void;
  onAsk?: (action: "explain" | "translate" | "ask", question?: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [draft, setDraft] = useState<PdfSelection | null>(null),
    [comment, setComment] = useState("");
  const [asking, setAsking] = useState(false);
  const [contextPage, setContextPage] = useState<number | null>(null);
  // A right-click away from the box is about the page, not the box.
  const [awayFromRegion, setAwayFromRegion] = useState(false);
  const [question, setQuestion] = useState("");
  const [palette, setPalette] = useState(false);
  const [color, setColor] = useState("#FACC15");
  const topAnchor = useRef({ getBoundingClientRect: () => new DOMRect() });
  const [quick, setQuick] = useState<{
    selection: PdfSelection;
    text?: string;
    error?: string;
    busy: boolean;
  } | null>(null);
  const previewCallback = useRef(onPreview);
  previewCallback.current = onPreview;
  useEffect(() => {
    const selection = quick?.selection;
    previewCallback.current?.(
      selection
        ? {
            page: selection.page,
            quote: selection.text,
            prefix: selection.prefix,
            rects: selection.rects,
          }
        : null,
    );
    return () => previewCallback.current?.(null);
  }, [quick?.selection]);
  const request = useRef<AbortController | null>(null);
  const closeQuick = () => {
    request.current?.abort();
    request.current = null;
    setQuick(null);
  };
  useEffect(() => {
    closeQuick();
    return () => request.current?.abort();
  }, [fileId]);
  const quickTranslate = async (snapshot = selection) => {
    if (!snapshot) return;
    request.current?.abort();
    let language = "zh";
    try {
      const saved = JSON.parse(
        localStorage.getItem("paper-translation-language") || '"zh"',
      );
      if (
        [
          "zh",
          "zh-TW",
          "en",
          "ja",
          "ko",
          "fr",
          "de",
          "es",
          "pt",
          "ru",
          "ar",
          "hi",
        ].includes(saved)
      )
        language = saved;
    } catch {
      /* A malformed local preference falls back to Chinese. */
    }
    const controller = new AbortController();
    request.current = controller;
    setOpen(false);
    setAsking(false);
    setQuick({ selection: snapshot, busy: true });
    try {
      const result = await api<{ text: string }>(
        `/files/${fileId}/quick-translation`,
        {
          method: "POST",
          body: JSON.stringify({
            text: snapshot.text,
            page: snapshot.page,
            language,
          }),
          signal: controller.signal,
        },
      );
      if (!controller.signal.aborted)
        setQuick({ selection: snapshot, text: result.text, busy: false });
    } catch (error) {
      if (!controller.signal.aborted)
        setQuick({
          selection: snapshot,
          error: (error as Error).message,
          busy: false,
        });
    }
  };
  // A closed menu forgets its transient state, so it never reopens half-used.
  useEffect(() => {
    if (!open) {
      setAsking(false);
      setPalette(false);
      setContextPage(null);
      setAwayFromRegion(false);
    }
  }, [open]);
  useEffect(() => {
    closeQuick();
    setAsking(false);
    setQuestion("");
    setPalette(false);
    const native = window.getSelection();
    const rect = native?.rangeCount
      ? native.getRangeAt(0).getBoundingClientRect()
      : null;
    const x = rect?.x ?? selection?.anchor?.x ?? 0;
    const y = rect?.y ?? selection?.anchor?.y ?? 0;
    topAnchor.current = {
      getBoundingClientRect: () => new DOMRect(x, y, 0, 0),
    };
  }, [selection]);
  const anchor = useRef({ getBoundingClientRect: () => new DOMRect() });
  useEffect(() => {
    if (selection?.anchor) {
      const { x, y } = selection.anchor;
      anchor.current = { getBoundingClientRect: () => new DOMRect(x, y, 0, 0) };
      setOpen(true);
    } else setOpen(false);
  }, [selection]);
  useEffect(() => {
    if (!region?.anchor) return;
    const { x, y } = region.anchor;
    anchor.current = { getBoundingClientRect: () => new DOMRect(x, y, 0, 0) };
    setAsking(false);
    setAwayFromRegion(false);
    setOpen(true);
  }, [region?.token]);
  useEffect(() => {
    const close = (event: Event) => {
      if (
        event.target instanceof Element &&
        event.target.closest(".pdf-selection-menu, .pdf-quick-translation")
      )
        return;
      setOpen(false);
      closeQuick();
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, []);
  const highlight = async (value = color) => {
    setOpen(false);
    if (selection && !(await store.add(selection, value, "")))
      toast.error("高亮未保存，请重试");
  };
  const beginAsk = () => {
    setAsking(true);
    setOpen(true);
  };
  const regionMode = !selection && !!region && !awayFromRegion;
  const pageMode = !selection && !regionMode && contextPage !== null;
  const submitQuestion = () => {
    if (!question.trim()) return;
    if (regionMode) onRegionAction?.("ask", question.trim());
    else if (pageMode) onPageAction?.("ask", contextPage!, question.trim());
    else if (onAsk) onAsk("ask", question.trim());
    else return;
    setAsking(false);
    setOpen(false);
  };
  const actions = [
    {
      label: "解释",
      key: "E",
      icon: Sparkles,
      run: () => onAsk?.("explain"),
      disabled: !onAsk,
    },
    { label: "高亮", key: "H", icon: Highlighter, run: () => void highlight() },
    {
      label: "翻译",
      key: "T",
      icon: Languages,
      run: () => void quickTranslate(),
      disabled: !selection || selection.text.length > 5000,
    },
    {
      label: "评论",
      key: "C",
      icon: MessageCircle,
      run: () => {
        setDraft(selection);
        setComment("");
      },
    },
    {
      label: "向AI提问",
      key: "Enter",
      icon: Sparkles,
      run: beginAsk,
      disabled: !onAsk,
    },
  ];
  const regionActions = [
    {
      label: "解释图表或选区",
      key: "E",
      icon: Sparkles,
      run: () => onRegionAction?.("explain"),
      disabled: !onRegionAction,
    },
    {
      label: "解释公式",
      key: "F",
      icon: Sigma,
      run: () => onRegionAction?.("formula"),
      disabled: !onRegionAction,
    },
    {
      label: "翻译选区文字",
      key: "T",
      icon: Languages,
      run: () => onRegionAction?.("translate"),
      disabled: !onRegionAction,
    },
    {
      label: "向AI提问",
      key: "Enter",
      icon: MessageCircle,
      run: beginAsk,
      disabled: !onRegionAction,
    },
  ];
  const pageActions = [
    {
      label: `解释第 ${contextPage} 页`,
      key: "E",
      icon: Sparkles,
      run: () => onPageAction?.("explain", contextPage!),
      disabled: !onPageAction,
    },
    {
      label: `翻译第 ${contextPage} 页`,
      key: "T",
      icon: Languages,
      run: () => onPageAction?.("translate", contextPage!),
      disabled: !onPageAction,
    },
    {
      label: "向AI提问",
      key: "Enter",
      icon: MessageCircle,
      run: beginAsk,
      disabled: !onPageAction,
    },
  ];
  const pageSecondary = [
    {
      label: "与助手讨论全文",
      icon: BookOpen,
      run: () => onPageAction?.("discuss", contextPage!),
      disabled: !onPageAction,
    },
  ];
  const regionSecondary = [
    {
      label: "保存图片",
      icon: ImageIcon,
      run: () => onRegionAction?.("saveImage"),
      disabled: !onRegionAction,
    },
    {
      label: "复制为图片",
      icon: ImageIcon,
      run: () => onRegionAction?.("copyImage"),
      disabled: !onRegionAction,
    },
    {
      label: "摘录",
      icon: Quote,
      run: () => onRegionAction?.("quote"),
      disabled: !onRegionAction,
    },
    {
      label: "与助手讨论全文",
      icon: BookOpen,
      run: () => onRegionAction?.("discuss"),
      disabled: !onRegionAction,
    },
  ];
  const secondary = [
    {
      label: "复制",
      icon: Copy,
      run: () => {
        if (selection)
          void navigator.clipboard
            .writeText(selection.text)
            .catch(() => toast.error("复制失败，请使用键盘复制"));
      },
    },
    { label: "摘录", icon: Quote, run: () => onQuote?.(), disabled: !onQuote },
  ];
  useEffect(() => {
    if (!enabled || !open || draft || quick) return;
    const key = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("input,textarea,[contenteditable=true]")
      )
        return;
      const action = (
        regionMode ? regionActions : pageMode ? pageActions : actions
      ).find((a) => a.key.toLowerCase() === event.key.toLowerCase());
      if (!action || action.disabled || store.busy) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      action.run();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  const rowActions = regionMode
    ? regionActions
    : pageMode
      ? pageActions
      : actions;
  const rowSecondary = regionMode
    ? regionSecondary
    : pageMode
      ? pageSecondary
      : secondary;
  const menuRows = (
    <>
      <div className="pdf-selection-items">
        {rowActions.map((a) => (
          <div className="pdf-selection-action" key={a.label}>
            <Button
              className="pdf-selection-row"
              aria-label={a.label}
              aria-keyshortcuts={a.key}
              variant="ghost"
              disabled={a.disabled || store.busy}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setOpen(false);
                a.run();
              }}
            >
              {a.label === "高亮" ? (
                <span
                  className="pdf-selection-color-dot"
                  style={{ background: color }}
                />
              ) : (
                <a.icon size={15} />
              )}
              <span>{a.label}</span>
              <kbd>{a.key}</kbd>
            </Button>
            {a.label === "高亮" && (
              <Button
                variant="ghost"
                size="icon"
                className="pdf-selection-palette-toggle"
                aria-label="高亮颜色"
                aria-expanded={palette}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setPalette(!palette)}
              >
                <ChevronDown size={13} />
              </Button>
            )}
          </div>
        ))}
        {palette && (
          <div className="pdf-selection-palette" aria-label="选择高亮颜色">
            {annotationColors.map((c) => (
              <button
                key={c.value}
                aria-label={c.label}
                aria-pressed={color === c.value}
                style={{ background: c.value }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setColor(c.value);
                  void highlight(c.value);
                }}
              />
            ))}
          </div>
        )}
      </div>
      <div className="pdf-selection-secondary">
        {rowSecondary.map((a) => (
          <Button
            key={a.label}
            variant="ghost"
            size="xs"
            disabled={a.disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              a.run();
              setOpen(false);
            }}
          >
            <a.icon size={13} />
            {a.label}
          </Button>
        ))}
      </div>
    </>
  );
  return (
    <>
      <div
        style={{ display: "contents" }}
        onContextMenuCapture={(event) => {
          event.preventDefault();
          if (!enabled) return;
          anchor.current = {
            getBoundingClientRect: () =>
              new DOMRect(event.clientX, event.clientY, 0, 0),
          };
          closeQuick();
          setAsking(false);
          const page = Number(
            (event.target as Element).closest<HTMLElement>("[data-pdf-page]")
              ?.dataset.pdfPage,
          );
          setContextPage(page || null);
          const box = (event.target as Element)
            .closest(".pdf-view")
            ?.querySelector<HTMLElement>('[data-testid="pdf-region-highlight"]')
            ?.getBoundingClientRect();
          setAwayFromRegion(
            !box ||
              event.clientX < box.left - 4 ||
              event.clientX > box.right + 4 ||
              event.clientY < box.top - 4 ||
              event.clientY > box.bottom + 4,
          );
          setOpen(true);
        }}
      >
        {children}
      </div>
      <Popover
        open={enabled && open && !draft && !quick}
        onOpenChange={setOpen}
      >
        <PopoverAnchor virtualRef={anchor} />
        <PopoverContent
          side="bottom"
          align="start"
          collisionPadding={12}
          className="pdf-selection-menu"
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          aria-label={
            regionMode ? "选区操作" : pageMode ? "页面操作" : "选中文字操作"
          }
        >
          {!selection && !regionMode && !pageMode ? (
            <p className="p-3 text-xs text-muted-foreground">
              请先划选文字或框选图片、公式
            </p>
          ) : asking ? (
            <form
              className="pdf-selection-question"
              onSubmit={(e) => {
                e.preventDefault();
                submitQuestion();
              }}
            >
              <Textarea
                autoFocus
                aria-label="对选中的内容提问"
                placeholder="对选中的内容提问..."
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    submitQuestion();
                  }
                }}
              />
              <div>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => {
                    setAsking(false);
                    setOpen(false);
                  }}
                >
                  关闭 <kbd>Esc</kbd>
                </Button>
                <Button
                  type="submit"
                  size="icon-sm"
                  disabled={!question.trim()}
                  aria-label="发送问题"
                >
                  <ArrowUp size={16} />
                </Button>
              </div>
            </form>
          ) : (
            menuRows
          )}
        </PopoverContent>
      </Popover>
      <Popover
        open={!!quick}
        onOpenChange={(value) => {
          if (!value) closeQuick();
        }}
      >
        <PopoverAnchor virtualRef={topAnchor} />
        <PopoverContent
          align="start"
          side="top"
          collisionPadding={16}
          className="pdf-quick-translation w-96 max-w-[calc(100vw-32px)]"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          aria-label="选段快速翻译"
        >
          <div className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">Google 翻译</p>
            {quick?.busy ? (
              <p role="status" className="flex items-center gap-2">
                <Spinner />
                正在翻译所选段落…
              </p>
            ) : quick?.error ? (
              <p role="alert" className="text-sm text-destructive">
                {quick.error}
              </p>
            ) : (
              <p className="max-h-64 overflow-auto whitespace-pre-wrap text-sm leading-relaxed">
                {quick?.text}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {quick?.error && (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => void quickTranslate(quick.selection)}
                >
                  重试
                </Button>
              )}
              {quick?.text && (
                <>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(quick.text!)
                        .then(() => toast.success("已复制"))
                        .catch(() => toast.error("复制失败"))
                    }
                  >
                    复制
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={store.busy}
                    onClick={async () => {
                      if (
                        await store.add(
                          quick.selection,
                          "#FACC15",
                          `译文（Google）\n\n${quick.text}`,
                        )
                      ) {
                        toast.success("已保存为评论");
                        closeQuick();
                      } else toast.error("保存失败，请重试");
                    }}
                  >
                    保存为评论
                  </Button>
                </>
              )}
              <Button
                size="xs"
                variant="ghost"
                disabled={!onAsk}
                onClick={() => {
                  onAsk?.("translate");
                  closeQuick();
                }}
              >
                用 AI 精译
              </Button>
              <Button size="xs" variant="ghost" onClick={closeQuick}>
                关闭
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
      <Dialog
        open={!!draft}
        onOpenChange={(value) => {
          if (!value) setDraft(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加评论</DialogTitle>
          </DialogHeader>
          <blockquote className="max-h-32 overflow-auto border-l-2 pl-3 text-sm text-muted-foreground">
            {draft?.text}
          </blockquote>
          <label htmlFor="pdf-selection-comment">评论</label>
          <Textarea
            id="pdf-selection-comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          {store.error && (
            <p role="alert" className="text-sm text-destructive">
              {store.error}
            </p>
          )}
          <Button
            disabled={store.busy || !comment.trim()}
            onClick={async () => {
              if (draft && (await store.add(draft, "#FACC15", comment.trim())))
                setDraft(null);
            }}
          >
            保存评论
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
