import clsx from "clsx";
import type { LucideIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, type KeyboardEvent } from "react";
import styles from "./SegmentedControl.module.css";

export interface SegmentedOption<V extends string> {
  value: V;
  /** The text of the item. It is one line: a longer label is cut with an ellipsis. */
  label: string;
  icon?: LucideIcon;
  /**
   * The id of the panel this tab shows (`kind="tabs"`, where it is required).
   * The tab gets the id `${panelId}-tab`, for the panel's `aria-labelledby`.
   */
  panelId?: string;
}

interface SegmentedBase<V extends string> {
  /** The accessible name of the whole control. */
  label: string;
  value: V;
  onChange: (value: V) => void;
  size?: "sm" | "md";
}

export type SegmentedControlProps<V extends string> =
  | (SegmentedBase<V> & {
      /** Switches between panels: a tab list. */
      kind: "tabs";
      options: (SegmentedOption<V> & { panelId: string })[];
    })
  | (SegmentedBase<V> & {
      /** Chooses one of a few values: a radio group. */
      kind: "radio";
      options: SegmentedOption<V>[];
    });

const SELECTED = '[aria-selected="true"], [aria-checked="true"]';

/**
 * Puts the thumb under an item. The thumb sits by itself (`data-state`): hidden
 * while nothing is chosen, "resting" where a jump is right (the first place, a
 * resize), "sliding" when the choice moved and the thumb should travel.
 */
function placeThumb(
  thumb: HTMLElement | null,
  item: HTMLElement | null | undefined,
  slide: boolean,
) {
  if (!thumb) return;
  if (!item) {
    delete thumb.dataset.state;
    return;
  }
  // `offset*` ignore the transforms of the ancestors (a dialog is scaled as it opens).
  const transform = `translateX(${item.offsetLeft}px)`;
  const width = `${item.offsetWidth}px`;
  // Already there: leave a slide that is on its way alone.
  if (
    thumb.dataset.state &&
    thumb.style.transform === transform &&
    thumb.style.width === width
  )
    return;
  thumb.dataset.state = slide ? "sliding" : "resting";
  thumb.style.transform = transform;
  thumb.style.width = width;
}

/**
 * A short row of exclusive choices on a pill, the chosen one raised on a thumb
 * that slides along. `kind="tabs"` is the pattern of a tab list (the panels are
 * the caller's, tied by `panelId`), `kind="radio"` that of a radio group. In
 * both only the chosen item is in the tab order, the left and right arrows move
 * to the next item and choose it, and Home and End go to the ends.
 */
export function SegmentedControl<V extends string>({
  label,
  kind,
  value,
  onChange,
  size = "md",
  ...rest
}: SegmentedControlProps<V>) {
  const options: SegmentedOption<V>[] = rest.options;
  const control = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLSpanElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const placedFor = useRef<V | null>(null);

  const tabs = kind === "tabs";
  const selected = options.findIndex((option) => option.value === value);
  // With nothing chosen the first item is the way in, or the keyboard could not reach the control.
  const entry = Math.max(selected, 0);
  const iconSize = size === "sm" ? 12 : 14;

  // Before the paint, so that the thumb is never seen in a wrong place. Only a change
  // of the value slides it; the first place and a new size jump.
  useLayoutEffect(() => {
    const slide = placedFor.current !== null && placedFor.current !== value;
    placedFor.current = value;
    placeThumb(thumb.current, items.current[selected], slide);
  }, [value, selected, size]);

  // The items change their width without a word from React: a label in the other
  // language, a font that has arrived. The thumb jumps to the new place.
  const values = options.map((option) => option.value).join("\n");
  useEffect(() => {
    const root = control.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() =>
      placeThumb(
        thumb.current,
        root.querySelector<HTMLElement>(SELECTED),
        false,
      ),
    );
    observer.observe(root);
    for (const item of items.current) if (item) observer.observe(item);
    return () => observer.disconnect();
  }, [values]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // A shortcut of the browser (Alt+Left is "back") is not for the control.
    if (event.nativeEvent.isComposing) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const count = options.length;
    const at = items.current.findIndex((item) => item === event.target);
    const from = at >= 0 ? at : entry;
    let to: number;
    switch (event.key) {
      case "ArrowRight":
        to = (from + 1) % count;
        break;
      case "ArrowLeft":
        to = (from - 1 + count) % count;
        break;
      case "Home":
        to = 0;
        break;
      case "End":
        to = count - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    items.current[to]?.focus();
    if (options[to].value !== value) onChange(options[to].value);
  };

  return (
    <div
      ref={control}
      role={tabs ? "tablist" : "radiogroup"}
      aria-label={label}
      className={clsx(styles.control, size === "sm" && styles.sm)}
      onKeyDown={onKeyDown}
    >
      <span ref={thumb} aria-hidden="true" className={styles.thumb} />
      {options.map((option, index) => {
        const chosen = index === selected;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            ref={(element) => {
              items.current[index] = element;
            }}
            type="button"
            role={tabs ? "tab" : "radio"}
            id={tabs && option.panelId ? `${option.panelId}-tab` : undefined}
            aria-selected={tabs ? chosen : undefined}
            aria-checked={tabs ? undefined : chosen}
            aria-controls={tabs ? option.panelId : undefined}
            tabIndex={index === entry ? 0 : -1}
            className={clsx(styles.item, chosen && styles.selected)}
            onClick={() => {
              if (!chosen) onChange(option.value);
            }}
          >
            {Icon && <Icon size={iconSize} aria-hidden="true" />}
            <span className={styles.text}>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
