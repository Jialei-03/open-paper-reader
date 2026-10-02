import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  createContext,
  useContext,
  useId,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ArrowLeftRight, AlignStartVertical, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Choice } from "@/components/Choice";

export type PdfSlot = "original" | "translated";
export type PdfController = {
  position: () => number;
  move: (position: number) => void;
  zoom: (value: number | "fit" | "auto") => void;
  scale: () => number;
  fitScale: () => number;
};
const PairContext = createContext<{
  toolbarHost: HTMLDivElement | null;
  toolbarSlot: PdfSlot;
  outlineHost: HTMLDivElement | null;
  annotationHost: HTMLDivElement | null;
  register: (slot: PdfSlot, controller: PdfController | null) => void;
  activate: (slot: PdfSlot) => void;
  pauseFollow: () => void;
  geometry: () => void;
  scroll: (slot: PdfSlot) => void;
  zoom: (slot: PdfSlot, value: number | "fit" | "auto") => void;
} | null>(null);
export const usePdfComparison = () => useContext(PairContext);

export function PdfComparison({
  alignmentStatus = "",
  dual,
  children,
  externalToolbarHost = null,
  outlineHost = null,
  annotationHost = null,
}: {
  alignmentStatus?: string;
  dual: boolean;
  externalToolbarHost?: HTMLDivElement | null;
  outlineHost?: HTMLDivElement | null;
  annotationHost?: HTMLDivElement | null;
  children: ReactNode;
}) {
  const viewId = useId();
  const [toolbarHost, setToolbarHost] = useState<HTMLDivElement | null>(null);
  const [toolbarSlot, setToolbarSlot] = useState<PdfSlot>("original");
  const [narrow, setNarrow] = useState(() => window.innerWidth <= 700);
  const [mobileView, setMobileView] = useState("original");
  useEffect(() => {
    const media = window.matchMedia("(max-width: 700px)");
    const adapt = () => {
      setNarrow(media.matches);
      if (media.matches) setMobileView("original");
    };
    media.addEventListener("change", adapt);
    return () => media.removeEventListener("change", adapt);
  }, []);
  const compact = dual && narrow && mobileView !== "split";
  const [swapped, setSwapped] = useState(false);
  const [linkedZoom, setLinkedZoom] = useState(true);
  const [follow, setFollow] = useState("off");
  const controllers = useRef<Partial<Record<PdfSlot, PdfController>>>({});
  const active = useRef<PdfSlot | null>(null);
  const sharedZoom = useRef<number | "fit" | "auto">("auto");
  const fitTogether = () => {
    const panes = compact
      ? [controllers.current[mobileView as PdfSlot]].filter(
          (pane): pane is PdfController => !!pane,
        )
      : Object.values(controllers.current);
    if (
      !dual ||
      !linkedZoom ||
      typeof sharedZoom.current === "number" ||
      panes.length !== (compact ? 1 : 2)
    )
      return;
    const scales = panes.map((pane) => pane.fitScale());
    if (scales.some((value) => !value)) return;
    const value =
      Math.floor(
        Math.min(...scales, sharedZoom.current === "auto" ? 1 : 8) * 10000,
      ) / 10000;
    panes.forEach((pane) => {
      if (Math.abs(pane.scale() - value) > 0.001) pane.zoom(value);
    });
  };
  useEffect(() => {
    if (!dual && linkedZoom && typeof sharedZoom.current !== "number")
      controllers.current.original?.zoom(sharedZoom.current);
  }, [dual, linkedZoom]);
  const left: PdfSlot = swapped ? "translated" : "original";
  const right: PdfSlot = swapped ? "original" : "translated";
  const other = (slot: PdfSlot) =>
    slot === "original" ? "translated" : "original";
  const allowed = (slot: PdfSlot) =>
    dual &&
    !compact &&
    follow !== "off" &&
    (follow === "both" || slot === (follow === "left" ? left : right));
  const synchronize = () => {
    const source = active.current;
    if (!source || !allowed(source)) return;
    const from = controllers.current[source],
      to = controllers.current[other(source)];
    if (from && to && Math.abs(from.position() - to.position()) > 0.001)
      to.move(from.position());
  };
  const align = () => {
    const source =
      follow === "right"
        ? right
        : follow === "left"
          ? left
          : active.current || left;
    const from = controllers.current[source],
      to = controllers.current[other(source)];
    if (from && to) {
      to.move(from.position());
      active.current = source;
    }
  };
  return (
    <PairContext.Provider
      value={{
        toolbarHost: externalToolbarHost || toolbarHost,
        outlineHost,
        annotationHost,
        toolbarSlot: !dual
          ? "original"
          : compact
            ? (mobileView as PdfSlot)
            : toolbarSlot,
        register: (slot, controller) => {
          if (controller) {
            controllers.current[slot] = controller;
            const existing = controllers.current[other(slot)];
            if (dual && linkedZoom && existing) {
              if (typeof sharedZoom.current !== "number") fitTogether();
              else controller.zoom(sharedZoom.current);
            }
          } else delete controllers.current[slot];
        },
        geometry: () => {
          fitTogether();
          synchronize();
        },
        activate: (slot) => {
          active.current = slot;
          setToolbarSlot(slot);
        },
        pauseFollow: () => {
          active.current = null;
        },
        // Follower layout/scroll restoration can also move its viewport.
        // Correct from the last user-operated pane instead of feeding it back.
        scroll: synchronize,
        zoom: (slot, value) => {
          active.current = null;
          sharedZoom.current = value;
          if (dual && linkedZoom) {
            if (typeof value !== "number") fitTogether();
            else controllers.current[other(slot)]?.zoom(value);
          }
        },
      }}
    >
      <div className="reader-tool-dock" hidden={!dual && !!externalToolbarHost}>
        {dual && !compact && (
          <ToggleGroup
            type="single"
            size="sm"
            value={toolbarSlot}
            onValueChange={(v) => {
              if (v) setToolbarSlot(v as PdfSlot);
            }}
            aria-label="工具作用页面"
          >
            <ToggleGroupItem value="original">原文</ToggleGroupItem>
            <ToggleGroupItem value="translated">译文</ToggleGroupItem>
          </ToggleGroup>
        )}
        <div ref={setToolbarHost} className="reader-tool-host" />
        {dual && narrow && (
          <Tabs
            value={mobileView}
            onValueChange={setMobileView}
            className="pdf-mobile-tabs"
          >
            <TabsList aria-label="阅读版本">
              <TabsTrigger
                value="original"
                id={`${viewId}-original`}
                aria-controls={viewId}
              >
                原文
              </TabsTrigger>
              <TabsTrigger
                value="translated"
                id={`${viewId}-translated`}
                aria-controls={viewId}
              >
                译文
              </TabsTrigger>
              <TabsTrigger
                value="split"
                id={`${viewId}-split`}
                aria-controls={viewId}
              >
                并排
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}
        {dual && !compact && (
          <div
            className="pdf-comparison-tools"
            role="toolbar"
            aria-label="双栏阅读工具"
          >
            <Button
              size="sm"
              variant={linkedZoom ? "secondary" : "ghost"}
              aria-pressed={linkedZoom}
              onClick={() => {
                if (!linkedZoom) {
                  const source = active.current || left;
                  const scale = controllers.current[source]?.scale();
                  if (scale) controllers.current[other(source)]?.zoom(scale);
                }
                setLinkedZoom(!linkedZoom);
              }}
            >
              <Link2 />
              联动缩放
            </Button>
            <Choice
              aria-label="同步滚动"
              value={follow}
              onValueChange={(value) => {
                setFollow(value);
                active.current = null;
              }}
            >
              <option value="off">独立滚动</option>
              <option value="both">双向同步</option>
              <option value="left">跟随左侧</option>
              <option value="right">跟随右侧</option>
            </Choice>
            <Button
              size="sm"
              variant="ghost"
              onClick={align}
              title="按当前主侧的页码和页内位置对齐；不进行段落匹配"
            >
              <AlignStartVertical />
              一键对齐
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                active.current = null;
                setSwapped(!swapped);
              }}
            >
              <ArrowLeftRight />
              交换左右
            </Button>
            <span className="text-xs text-muted-foreground">
              {alignmentStatus || (swapped ? "译文 / 原文" : "原文 / 译文")}
            </span>
          </div>
        )}
      </div>
      <div
        className="translation-pdfs"
        id={viewId}
        role={narrow && dual ? "tabpanel" : undefined}
        aria-labelledby={narrow && dual ? `${viewId}-${mobileView}` : undefined}
        data-dual={dual}
        data-mobile-view={narrow && dual ? mobileView : undefined}
        data-swapped={dual && swapped}
      >
        {children}
      </div>
    </PairContext.Provider>
  );
}
