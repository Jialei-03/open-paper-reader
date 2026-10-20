import { ArrowUp } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import styles from "./Talk.module.css";

/**
 * The one place the researcher writes: grows with the text, Enter sends,
 * Shift+Enter breaks the line, and typing an IME candidate never sends.
 */
export function Composer({
  value,
  onChange,
  onSend,
  placeholder,
  label,
  sendLabel,
  busy = false,
  disabled = false,
  autoFocus = false,
  tools,
  focusKey = 0,
}: {
  value: string;
  onChange(value: string): void;
  onSend(): void;
  placeholder: string;
  label: string;
  sendLabel: string;
  busy?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Pickers on the left of the foot (model, compute). */
  tools?: ReactNode;
  /** Changing it puts the cursor at the end of the text (after a starter was picked). */
  focusKey?: number;
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = field.current;
    if (!focusKey || !el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [focusKey]);
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [value]);
  const ready = value.trim().length > 0 && !busy && !disabled;
  return (
    <form
      className={styles.composer}
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) onSend();
      }}
    >
      <textarea
        ref={field}
        className={styles.field}
        rows={1}
        value={value}
        placeholder={placeholder}
        aria-label={label}
        disabled={disabled}
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            if (ready) onSend();
          }
        }}
      />
      <div className={styles.composerFoot}>
        {tools}
        <button
          type="submit"
          className={styles.send}
          disabled={!ready}
          aria-label={sendLabel}
        >
          <ArrowUp size={16} strokeWidth={2.2} aria-hidden />
        </button>
      </div>
    </form>
  );
}
