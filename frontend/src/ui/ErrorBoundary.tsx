import clsx from "clsx";
import { CircleAlert, RotateCcw } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { useI18n } from "../i18n/I18nProvider";
import { Button } from "./Button";
import styles from "./ErrorBoundary.module.css";

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** What failed, as a noun the message can start with ("Paper"): "{label} ran into a problem". */
  label: string;
  /** Called when the person retries, before the children are mounted again. */
  onReset?: () => void;
  /** For the box the message sits in (how much of the room it takes): the one using it knows the layout. */
  className?: string;
}

function Failure({
  label,
  className,
  onRetry,
}: Pick<ErrorBoundaryProps, "label" | "className"> & { onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div className={clsx(styles.region, className)}>
      <div role="alert" className={styles.card}>
        <CircleAlert size={20} aria-hidden="true" className={styles.icon} />
        <p className={styles.message}>{t("errorBoundary.title", { label })}</p>
        <Button size="sm" icon={RotateCcw} onClick={onRetry}>
          {t("common.retry")}
        </Button>
      </div>
    </div>
  );
}

interface State {
  failed: boolean;
}

/**
 * Keeps a failure in its own corner. When anything below it throws as it draws,
 * the corner shows a small card with the problem in a word and a way to try
 * again, and the rest of the page goes on. Trying again mounts the children
 * anew (while the message is up they are gone, so nothing of their old state
 * is left). The error is written to the console (once), where a developer
 * will see it.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(
      `ErrorBoundary (${this.props.label}):`,
      error,
      info.componentStack,
    );
  }

  private retry = () => {
    this.props.onReset?.();
    this.setState({ failed: false });
  };

  render() {
    if (this.state.failed) {
      const { label, className } = this.props;
      return (
        <Failure label={label} className={className} onRetry={this.retry} />
      );
    }
    return this.props.children;
  }
}
