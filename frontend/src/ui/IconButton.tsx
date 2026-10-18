import clsx from "clsx";
import type { LucideIcon } from "lucide-react";
import { Button, type ButtonProps } from "./Button";
import styles from "./Button.module.css";
import { Tooltip } from "./Tooltip";

export type IconButtonProps = Omit<
  ButtonProps,
  "children" | "icon" | "variant"
> & {
  icon: LucideIcon;
  /** The accessible name. There is no visible text, so it is required. */
  label: string;
  /** The shortcut that does the same, written as for `formatShortcut`. */
  shortcut?: string;
  variant?: "ghost" | "secondary";
};

export function IconButton({
  icon,
  label,
  shortcut,
  variant = "ghost",
  className,
  ...rest
}: IconButtonProps) {
  return (
    <Tooltip content={label} shortcut={shortcut}>
      <Button
        {...rest}
        icon={icon}
        variant={variant}
        className={clsx(styles.iconButton, className)}
        aria-label={label}
      />
    </Tooltip>
  );
}
