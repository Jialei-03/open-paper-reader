import { FileText } from "lucide-react";
import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/i18n";
import { Button } from "../../ui";
import { stepName, type Workflow } from "./workflows-api";
import styles from "./Workflows.module.css";

export function WorkflowBoundary({
  id,
  index,
  status,
  outputs,
  workflow,
  open,
}: {
  id: string;
  index: number;
  status: string;
  outputs: string[];
  workflow?: Workflow;
  open?(path: string): void;
}) {
  const { t } = useI18n();
  return (
    <div id={`workflow-event-${id}`} data-workflow-step={index} tabIndex={-1}>
      <div className={styles.mark}>
        <span>
          {workflow
            ? stepName(workflow, index, t)
            : t("workflows.step", { n: index + 1 })}
        </span>
        <span>·</span>
        <span>{t(`workflows.status.${status}` as MessageKey)}</span>
      </div>
      {!!outputs.length && (
        <div className={styles.output}>
          {outputs.map((path) => (
            <Button
              key={path}
              variant="ghost"
              onClick={() => open?.(path)}
              disabled={!open}
            >
              <FileText aria-hidden />
              {path}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
export function WorkflowProgress({ workflow }: { workflow: Workflow }) {
  const { t } = useI18n();
  return (
    <div className={styles.steps}>
      {workflow.steps.map((_, index) => {
        const status = workflow.state?.steps[index]?.status || "pending";
        return (
          <button
            key={index}
            type="button"
            disabled={
              status === "pending" ||
              (workflow.id === "research" &&
                !workflow.state?.steps[index]?.started_at)
            }
            onClick={() => {
              const el = document.querySelector<HTMLElement>(
                `[data-workflow-step="${index}"]`,
              );
              el?.scrollIntoView({ block: "start", behavior: "smooth" });
              el?.focus({ preventScroll: true });
            }}
          >
            <span>{stepName(workflow, index, t)}</span>
            <small>{t(`workflows.status.${status}` as MessageKey)}</small>
          </button>
        );
      })}
    </div>
  );
}
