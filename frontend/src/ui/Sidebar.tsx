import clsx from "clsx";
import { PanelLeftClose, PanelLeftOpen, type LucideIcon } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { useI18n } from "../i18n/I18nProvider";
import { IconButton } from "./IconButton";
import type { Placement } from "./position";
import {
  ariaKeyShortcuts,
  currentPlatformIsMac,
  matchesShortcut,
} from "./shortcut";
import { Tooltip } from "./Tooltip";
import styles from "./Sidebar.module.css";

/** Collapses and expands the sidebar. */
const TOGGLE_SHORTCUT = "mod+\\";

/** A collapsed item has no room for its label, so the tooltip goes to the right of it. */
const beside: Placement = { side: "right", align: "center" };

const SidebarContext = createContext({ collapsed: false });

const NON_TEXT_INPUTS = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/** Whether keys typed at this target are text: a shortcut of the page stays out of the way. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement)
    return true;
  return (
    target instanceof HTMLInputElement && !NON_TEXT_INPUTS.has(target.type)
  );
}

export interface SidebarProps {
  /** The accessible name of the navigation. */
  label: string;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  /** A mark or a name above the items. Hidden while the sidebar is collapsed. */
  header?: ReactNode;
  /** Items kept at the bottom, out of the scrolling list. */
  footer?: ReactNode;
  /** `SidebarSection`s and `SidebarItem`s. */
  children: ReactNode;
}

/**
 * The navigation down the left of the window. It has no surface of its own: it
 * sits on the shell, and its items are lit only when the pointer is on them or
 * they are current. 220px wide, 56px once collapsed, when only the icons are
 * left. Ctrl+\ (Command+\ on a Mac) collapses and expands it, from anywhere but
 * a text field.
 */
export function Sidebar({
  label,
  collapsed,
  onCollapsedChange,
  header,
  footer,
  children,
}: SidebarProps) {
  const { t } = useI18n();
  const mac = currentPlatformIsMac();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Not a held key, not an input method's, not text being typed, not taken already.
      if (event.repeat || event.isComposing || event.defaultPrevented) return;
      if (isTextEntry(event.target)) return;
      if (!matchesShortcut(event, TOGGLE_SHORTCUT, mac)) return;
      event.preventDefault();
      onCollapsedChange(!collapsed);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [collapsed, onCollapsedChange, mac]);

  return (
    <SidebarContext.Provider value={{ collapsed }}>
      <nav
        aria-label={label}
        className={clsx(styles.sidebar, collapsed && styles.collapsed)}
      >
        <div className={styles.top}>
          {header && <div className={styles.header}>{header}</div>}
          <IconButton
            icon={collapsed ? PanelLeftOpen : PanelLeftClose}
            label={t(collapsed ? "sidebar.expand" : "sidebar.collapse")}
            shortcut={TOGGLE_SHORTCUT}
            aria-expanded={!collapsed}
            aria-keyshortcuts={ariaKeyShortcuts(TOGGLE_SHORTCUT, mac)}
            onClick={() => onCollapsedChange(!collapsed)}
          />
        </div>
        <div className={styles.body}>{children}</div>
        {footer && <div className={styles.footer}>{footer}</div>}
      </nav>
    </SidebarContext.Provider>
  );
}

/** A group of items under a small title. Collapsed, the title goes and the gap stays. */
export function SidebarSection({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <div
      role="group"
      aria-labelledby={title ? titleId : undefined}
      className={styles.section}
    >
      {title && (
        <div id={titleId} className={styles.sectionTitle}>
          {title}
        </div>
      )}
      {children}
    </div>
  );
}

/** Whether the text of an element is cut short, kept current as the element is resized. */
function useTruncated(element: RefObject<HTMLElement | null>, text: string) {
  const [truncated, setTruncated] = useState(false);
  useLayoutEffect(() => {
    const target = element.current;
    if (!target) return;
    const measure = () => setTruncated(target.scrollWidth > target.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(target);
    return () => observer.disconnect();
  }, [element, text]);
  return truncated;
}

export interface SidebarItemProps {
  icon: LucideIcon;
  /** One line: a longer label is cut with an ellipsis, and shown whole in a tooltip. */
  label: string;
  /** A small note at the end of the row (a count, say). */
  meta?: string;
  /** The page this item stands for: it is lit, and marked as the current page. */
  active?: boolean;
  /** The paper being read right now: a dot with a soft ring. */
  dot?: boolean;
  onClick?: () => void;
  /** With an address the item is a link; without, a button. */
  href?: string;
}

export function SidebarItem({
  icon: Icon,
  label,
  meta,
  active = false,
  dot = false,
  onClick,
  href,
}: SidebarItemProps) {
  const { collapsed } = useContext(SidebarContext);
  const text = useRef<HTMLSpanElement>(null);
  const truncated = useTruncated(text, label);

  const content = (
    <>
      <Icon size={16} aria-hidden="true" />
      <span ref={text} className={styles.label}>
        {label}
      </span>
      {meta && <span className={styles.meta}>{meta}</span>}
      {dot && <span aria-hidden="true" className={styles.dot} />}
    </>
  );
  const props = {
    className: clsx(styles.item, active && styles.active),
    "aria-current": active ? ("page" as const) : undefined,
    // The label is not drawn while collapsed, so the name is given outright; it is the one the content makes.
    "aria-label": collapsed ? (meta ? `${label} ${meta}` : label) : undefined,
    onClick,
  };

  return (
    <Tooltip
      content={label}
      placement={beside}
      disabled={!collapsed && !truncated}
    >
      {href ? (
        <a {...props} href={href}>
          {content}
        </a>
      ) : (
        <button {...props} type="button">
          {content}
        </button>
      )}
    </Tooltip>
  );
}
