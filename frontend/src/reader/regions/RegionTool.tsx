import {
  Copy,
  FunctionSquare,
  Image as ImageIcon,
  MessageSquare,
  NotebookPen,
  Sigma,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Paper, SourceFile } from "../../api";
import type { PdfRect } from "../../features/PdfAnnotations";
import { useI18n } from "../../i18n/I18nProvider";
import { Floating, MenuList, toast, type MenuEntry, type Rect } from "../../ui";
import { outOfView, spotRect } from "../selection/anchor";
import type { SelectionNote } from "../selection/SelectionMenu";
import type { AskRequest } from "../types";
import { copyRegionImage } from "./copy-image";
import {
  rectParameter,
  regionBetween,
  regionImageUrl,
  regionMarkdown,
  type Point,
  type RegionKind,
} from "./geometry";
import { RegionResult } from "./RegionResult";
import styles from "./RegionTool.module.css";

export interface RegionToolProps {
  /** The pages' scroller (`PdfController.root`), where the box is drawn. */
  scroller: HTMLElement | null;
  paper: Paper;
  file: SourceFile;
  /** The toolbar's region mode: a drag on a page draws a box instead of selecting text. */
  active: boolean;
  /** Region mode asks to end (Escape with no box open). */
  onActiveChange(active: boolean): void;
  /** Ask the assistant about the box (`action: "ask"`, or `"explain"` to have it answered at once). */
  onAsk(request: AskRequest): void;
  /** Keep the box in the note: `markdown` is the picture, what was made of it, and the way back. */
  onNote(request: SelectionNote): void;
}

type Drag = { sheet: HTMLElement; page: number; from: Point; to: Point };
type Region = {
  page: number;
  rect: PdfRect;
  /** The menu of what to do with it, or the run that was chosen. */
  stage: "menu" | RegionKind;
  /** What the run asks, made once when it is chosen (a new object would start the run over). */
  asked?: AskRequest;
};

const sheetOf = (scroller: HTMLElement, page: number) =>
  scroller.querySelector<HTMLElement>(`[data-page="${page}"]`);

const clamp = (value: number) => Math.min(1, Math.max(0, value));

const percent = (rect: PdfRect) => ({
  left: `${rect.x * 100}%`,
  top: `${rect.y * 100}%`,
  width: `${rect.w * 100}%`,
  height: `${rect.h * 100}%`,
});

const pointOn = (sheet: HTMLElement, event: PointerEvent): Point => {
  const box = sheet.getBoundingClientRect();
  return {
    x: (event.clientX - box.left) / (box.width || 1),
    y: (event.clientY - box.top) / (box.height || 1),
  };
};

/**
 * Draws a box on a page and says what can be done with what is in it: explain
 * the figure or table, explain the formula, write it as LaTeX, ask the
 * assistant, keep it in the note, copy its picture. The box is drawn by a drag
 * in region mode (the toolbar's), or with Alt held; otherwise a drag selects text
 * as always. The box follows its page as the paper scrolls and goes with Escape,
 * a press outside it, or once it has scrolled out of view.
 */
export function RegionTool({
  scroller,
  paper,
  file,
  active,
  onActiveChange,
  onAsk,
  onNote,
}: RegionToolProps) {
  const i18n = useI18n();
  const { t } = i18n;
  const [drag, setDrag] = useState<Drag | null>(null);
  const [region, setRegion] = useState<Region | null>(null);
  const [sheet, setSheet] = useState<HTMLElement | null>(null);
  const [anchor, setAnchor] = useState<Rect | null>(null);
  const [held, setHeld] = useState(false);
  const activeNow = useRef(active);
  activeNow.current = active;

  const close = useCallback(() => {
    setRegion(null);
    setSheet(null);
    setAnchor(null);
  }, []);

  // The cursor says the drag will draw a box, not select.
  const drawing = active || held;
  useEffect(() => {
    if (!scroller) return;
    scroller.style.cursor = drawing ? "crosshair" : "";
    scroller.style.userSelect = active ? "none" : "";
    scroller.style.touchAction = active ? "none" : "";
    return () => {
      scroller.style.cursor = "";
      scroller.style.userSelect = "";
      scroller.style.touchAction = "";
    };
  }, [scroller, drawing, active]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Alt") setHeld(event.type === "keydown");
    };
    const blur = () => setHeld(false);
    window.addEventListener("keydown", key);
    window.addEventListener("keyup", key);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("keyup", key);
      window.removeEventListener("blur", blur);
    };
  }, []);

  // The drag. In capture, before the page's own handling of the press: text is not selected from it.
  useEffect(() => {
    if (!scroller) return;
    let current: Drag | null = null;
    let suppress = false;
    const wanted = (event: MouseEvent) =>
      event.button === 0 &&
      (activeNow.current || event.altKey) &&
      event.target instanceof Element &&
      !!event.target.closest("[data-page]") &&
      scroller.contains(event.target);
    const down = (event: PointerEvent) => {
      if (!wanted(event)) return;
      const sheet = (event.target as Element).closest<HTMLElement>(
        "[data-page]",
      )!;
      event.preventDefault();
      event.stopPropagation();
      window.getSelection()?.removeAllRanges();
      close();
      const start = pointOn(sheet, event);
      current = {
        sheet,
        page: Number(sheet.dataset.page),
        from: start,
        to: start,
      };
      setDrag(current);
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", cancel);
    };
    const move = (event: PointerEvent) => {
      if (!current) return;
      current = { ...current, to: pointOn(current.sheet, event) };
      setDrag(current);
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
    };
    const up = (event: PointerEvent) => {
      const done = current;
      current = null;
      finish();
      setDrag(null);
      if (!done) return;
      const box = done.sheet.getBoundingClientRect();
      const rect = regionBetween(done.from, pointOn(done.sheet, event), box);
      // The click that follows a drag would follow a link under the pointer.
      suppress = true;
      window.setTimeout(() => (suppress = false), 0);
      if (!rect) return;
      setSheet(done.sheet);
      setRegion({ page: done.page, rect, stage: "menu" });
    };
    const cancel = () => {
      current = null;
      finish();
      setDrag(null);
    };
    // A press that would start a text selection or a drag of the page's own.
    const press = (event: MouseEvent) => {
      if (wanted(event)) event.preventDefault();
    };
    const click = (event: MouseEvent) => {
      if (!suppress) return;
      event.preventDefault();
      event.stopPropagation();
    };
    scroller.addEventListener("pointerdown", down, true);
    scroller.addEventListener("mousedown", press, true);
    scroller.addEventListener("click", click, true);
    return () => {
      finish();
      scroller.removeEventListener("pointerdown", down, true);
      scroller.removeEventListener("mousedown", press, true);
      scroller.removeEventListener("click", click, true);
    };
  }, [scroller, close]);

  // The box follows its page as the paper scrolls, and goes once it has left the view.
  useEffect(() => {
    if (!scroller || !region) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const where = { page: region.page, rect: region.rect };
      const rect = spotRect(scroller, where);
      if (!rect || outOfView(scroller, rect)) return close();
      setAnchor(rect);
      const current = sheetOf(scroller, region.page);
      setSheet((old) => (old === current ? old : current));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    scroller.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [scroller, region, close]);

  // Escape ends region mode once there is no box to put away first.
  useEffect(() => {
    if (!active || region) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented)
        onActiveChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, region, onActiveChange]);

  const request = (action: AskRequest["action"]): AskRequest | null =>
    region && {
      paperId: paper.id,
      fileId: file.id,
      versionId: file.version_id,
      page: region.page,
      source: "region",
      action,
      rect: [region.rect.x, region.rect.y, region.rect.w, region.rect.h],
    };

  const note = (text = "", latex = false) => {
    const asked = request("ask");
    if (!asked || !region) return;
    onNote({
      ...asked,
      markdown: regionMarkdown({
        paperId: paper.id,
        fileId: file.id,
        page: region.page,
        rect: region.rect,
        text,
        latex,
        source: t("reader.notes.source", { page: region.page }),
        alt: t("reader.region.alt", { page: region.page }),
      }),
    });
  };

  const copyImage = () => {
    if (!region) return;
    const url = regionImageUrl(file.id, region.page, region.rect);
    close();
    copyRegionImage(
      url,
      t("reader.region.fileName", { page: region.page }),
    ).then(
      (done) =>
        toast.show({
          message: t(
            done === "copied"
              ? "reader.region.imageCopied"
              : "reader.region.saved",
          ),
          tone: "success",
        }),
      () =>
        toast.show({ message: t("reader.region.imageFailed"), tone: "error" }),
    );
  };

  const run = (stage: RegionKind) => {
    const asked = request(stage);
    if (asked) setRegion((r) => r && { ...r, stage, asked });
  };

  const items: MenuEntry[] = [
    {
      id: "explain",
      label: t("reader.region.explain"),
      icon: ImageIcon,
      onSelect: () => run("explain"),
    },
    {
      id: "formula",
      label: t("reader.region.formula"),
      icon: Sigma,
      onSelect: () => run("formula"),
    },
    {
      id: "latex",
      label: t("reader.region.latex"),
      icon: FunctionSquare,
      onSelect: () => run("latex"),
    },
    { kind: "separator", id: "then" },
    {
      id: "ask",
      label: t("reader.region.ask"),
      icon: MessageSquare,
      onSelect: () => {
        const asked = request("ask");
        close();
        if (asked) onAsk(asked);
      },
    },
    {
      id: "note",
      label: t("reader.region.note"),
      icon: NotebookPen,
      onSelect: () => {
        note();
        close();
      },
    },
    {
      id: "copy",
      label: t("reader.region.copyImage"),
      icon: Copy,
      onSelect: copyImage,
    },
  ];

  const running = region && region.stage !== "menu" ? region.stage : null;
  const asked = region?.asked;

  return (
    <>
      {drag &&
        createPortal(
          <div
            className={`${styles.box} ${styles.dragging}`}
            style={percent({
              x: clamp(Math.min(drag.from.x, drag.to.x)),
              y: clamp(Math.min(drag.from.y, drag.to.y)),
              w:
                clamp(Math.max(drag.from.x, drag.to.x)) -
                clamp(Math.min(drag.from.x, drag.to.x)),
              h:
                clamp(Math.max(drag.from.y, drag.to.y)) -
                clamp(Math.min(drag.from.y, drag.to.y)),
            })}
            aria-hidden="true"
          />,
          drag.sheet,
        )}
      {region &&
        sheet &&
        createPortal(
          <div
            className={styles.box}
            style={percent(region.rect)}
            data-region={rectParameter(region.rect)}
            aria-hidden="true"
          />,
          sheet,
        )}
      <Floating
        open={!!region && region.stage === "menu" && !!anchor}
        anchor={anchor}
        placement={{ side: "bottom", align: "start" }}
        onDismiss={close}
      >
        {/* A press on the menu must not clear what was selected before. */}
        <div onMouseDown={(event) => event.preventDefault()}>
          <MenuList
            label={t("reader.region.menu")}
            items={items}
            autoFocus="first"
            onClose={(reason) => {
              if (reason === "escape") close();
            }}
          />
        </div>
      </Floating>
      {region && running && asked && anchor && (
        <RegionResult
          key={`${region.page}:${rectParameter(region.rect)}:${running}`}
          request={asked}
          kind={running}
          anchor={anchor}
          onClose={close}
          onNote={(text) => {
            note(text, running === "latex");
            close();
          }}
          onAsk={() => {
            onAsk({ ...asked, action: "ask" });
            close();
          }}
        />
      )}
    </>
  );
}
