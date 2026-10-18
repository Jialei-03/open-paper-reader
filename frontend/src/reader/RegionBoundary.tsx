import type { ReactNode } from "react";
import { useI18n } from "../i18n/I18nProvider";
import { ErrorBoundary } from "../ui";

/** The parts of the screen that fail on their own. */
export type Region = "paper" | "sidebar" | "panel";

/**
 * An `ErrorBoundary` that names its region in the person's language: when one
 * part of the reader breaks, it says which ("Paper ran into a problem") and the
 * other parts stay as they are.
 */
export function RegionBoundary({
  region,
  className,
  onReset,
  children,
}: {
  region: Region;
  className?: string;
  onReset?: () => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <ErrorBoundary
      label={t(`reader.region.${region}`)}
      className={className}
      onReset={onReset}
    >
      {children}
    </ErrorBoundary>
  );
}
