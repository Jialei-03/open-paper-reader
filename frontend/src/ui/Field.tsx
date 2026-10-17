import clsx from "clsx";
import {
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type AriaAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type TextareaHTMLAttributes,
} from "react";
import styles from "./Field.module.css";

/** What both fields add to the native attributes. The texts come from the caller. */
interface FieldOwnProps {
  /** The visible name of the field. */
  label: string;
  /** Keep the label for assistive technology only, when the surroundings already name the field. */
  hideLabel?: boolean;
  /** Help below the field; it is part of the field's accessible description. */
  description?: string;
  /** What is wrong; marks the field invalid and is part of its description. */
  error?: string;
}

export interface TextFieldProps
  extends InputHTMLAttributes<HTMLInputElement>,
    FieldOwnProps {
  ref?: Ref<HTMLInputElement>;
}

export interface TextAreaProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement>,
    FieldOwnProps {
  /** Grow with the content, up to `maxRows`, then scroll. Starts at one row unless `rows` says otherwise. */
  autoGrow?: boolean;
  /** The most rows an `autoGrow` area shows before it scrolls. */
  maxRows?: number;
  ref?: Ref<HTMLTextAreaElement>;
}

/** The label, the control and the messages below it; the ids tie them together. */
function Frame({
  id,
  label,
  hideLabel,
  description,
  error,
  children,
}: FieldOwnProps & { id: string; children: ReactNode }) {
  return (
    <div className={styles.field}>
      <label
        htmlFor={id}
        className={clsx(styles.label, hideLabel && styles.hidden)}
      >
        {label}
      </label>
      {children}
      {description && (
        <p id={`${id}-description`} className={styles.description}>
          {description}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className={styles.error}>
          {error}
        </p>
      )}
    </div>
  );
}

/** The attributes that point a control at its messages and mark it invalid. */
function controlAria(
  id: string,
  { description, error }: Pick<FieldOwnProps, "description" | "error">,
  given: { describedBy?: string; invalid?: AriaAttributes["aria-invalid"] },
) {
  const describedBy = [
    given.describedBy,
    description && `${id}-description`,
    error && `${id}-error`,
  ]
    .filter(Boolean)
    .join(" ");
  return {
    "aria-describedby": describedBy || undefined,
    "aria-invalid": error ? true : given.invalid,
  };
}

export function TextField({
  label,
  hideLabel,
  description,
  error,
  id: givenId,
  className,
  "aria-describedby": describedBy,
  "aria-invalid": invalid,
  ref,
  ...rest
}: TextFieldProps) {
  const generatedId = useId();
  const id = givenId ?? generatedId;
  return (
    <Frame
      id={id}
      label={label}
      hideLabel={hideLabel}
      description={description}
      error={error}
    >
      <input
        {...rest}
        ref={ref}
        id={id}
        className={clsx(styles.control, className)}
        {...controlAria(id, { description, error }, { describedBy, invalid })}
      />
    </Frame>
  );
}

/** Sets the height of an auto-growing area to its content, or to `maxRows` rows. */
function fit(element: HTMLTextAreaElement, maxRows: number) {
  if (!element.isConnected) return;
  const style = getComputedStyle(element);
  const fontSize = parseFloat(style.fontSize);
  // "normal" does not parse; it is about this tall.
  const lineHeight = parseFloat(style.lineHeight) || fontSize * 1.3;
  const padding =
    parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  const border =
    parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);

  // Measure from the shortest height, or an area that has shrunk would stay tall.
  element.style.height = "auto";
  const wanted = element.scrollHeight + border;
  const cap = lineHeight * maxRows + padding + border;
  element.style.height = `${Math.min(wanted, cap)}px`;
  // A pixel of slack: scrollHeight is rounded, so a full last row must not show a bar.
  element.style.overflowY = wanted > cap + 1 ? "auto" : "";
}

export function TextArea({
  label,
  hideLabel,
  description,
  error,
  autoGrow = false,
  maxRows = 8,
  rows,
  id: givenId,
  className,
  value,
  onInput,
  "aria-describedby": describedBy,
  "aria-invalid": invalid,
  ref,
  ...rest
}: TextAreaProps) {
  const generatedId = useId();
  const id = givenId ?? generatedId;
  const own = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => own.current!, []);

  // Before paint, so the first render of an initial value is already its size.
  useLayoutEffect(() => {
    if (autoGrow && own.current) fit(own.current, maxRows);
  }, [autoGrow, maxRows, value]);

  // The same text wraps into a different number of rows when the width or the
  // font changes, and neither is a change of value.
  useLayoutEffect(() => {
    const element = own.current;
    if (!autoGrow || !element) return;
    const refit = () => fit(element, maxRows);
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === width) return;
      width = element.clientWidth;
      refit();
    });
    observer.observe(element);
    void document.fonts?.ready.then(refit);
    return () => {
      observer.disconnect();
      element.style.height = "";
      element.style.overflowY = "";
    };
  }, [autoGrow, maxRows]);

  return (
    <Frame
      id={id}
      label={label}
      hideLabel={hideLabel}
      description={description}
      error={error}
    >
      <textarea
        {...rest}
        ref={own}
        id={id}
        value={value}
        rows={rows ?? (autoGrow ? 1 : undefined)}
        className={clsx(
          styles.control,
          styles.textarea,
          autoGrow && styles.autoGrow,
          className,
        )}
        onInput={(event) => {
          if (autoGrow) fit(event.currentTarget, maxRows);
          onInput?.(event);
        }}
        {...controlAria(id, { description, error }, { describedBy, invalid })}
      />
    </Frame>
  );
}
