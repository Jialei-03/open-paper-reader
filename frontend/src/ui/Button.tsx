import clsx from "clsx";
import type { LucideIcon } from "lucide-react";
import type { ButtonHTMLAttributes, Ref } from "react";
import styles from "./Button.module.css";
import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  /** Busy: shows a spinner in place of the icon and ignores clicks. */
  loading?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  variant = "secondary",
  size = "md",
  icon: Icon,
  loading = false,
  type = "button",
  disabled,
  className,
  children,
  ref,
  ...rest
}: ButtonProps) {
  const iconSize = 16;
  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      className={clsx(styles.button, styles[variant], styles[size], className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading ? (
        <Spinner size={iconSize} />
      ) : (
        Icon && <Icon size={iconSize} aria-hidden="true" />
      )}
      {children != null && <span className={styles.label}>{children}</span>}
    </button>
  );
}
