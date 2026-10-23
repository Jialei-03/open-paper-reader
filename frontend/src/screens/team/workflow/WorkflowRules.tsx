import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  MoreHorizontal,
  Trash2,
  Workflow as WorkflowIcon,
} from "lucide-react";
import { useRef, useState } from "react";
import { useI18n } from "../../../i18n/I18nProvider";
import { Button, Dialog, IconButton, Menu } from "../../../ui";
import {
  moveRule,
  ruleSummary,
  saveRule,
  type WorkflowDataProps,
  type WorkflowRule,
} from "./workflow-model";
import styles from "./Workflow.module.css";

export interface WorkflowRulesProps extends WorkflowDataProps {
  onEdit(rule: WorkflowRule): void;
  query?: string;
}

export function WorkflowRules({
  workflow,
  members,
  channels,
  onChange,
  onEdit,
  query = "",
  readOnly = false,
}: WorkflowRulesProps) {
  const { t } = useI18n();
  const dragged = useRef<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const rows = workflow.rules.filter((rule) =>
    ruleSummary(rule, members, channels, t)
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <>
      <ol className={styles.rules} aria-label={t("teamWorkflow.list")}>
        {rows.map((rule) => {
          const index = workflow.rules.indexOf(rule);
          const summary = ruleSummary(rule, members, channels, t);
          return (
            <li
              key={rule.id}
              className={styles.row}
              data-rule-id={rule.id}
              onDragOver={(event) => {
                if (dragged.current) event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (!readOnly && dragged.current)
                  onChange(moveRule(workflow, dragged.current, index));
                dragged.current = null;
              }}
            >
              <IconButton
                disabled={readOnly}
                icon={GripVertical}
                label={t("workflows.reorder")}
                draggable={!readOnly}
                onDragStart={(event) => {
                  dragged.current = rule.id;
                  event.dataTransfer.setData("text/plain", rule.id);
                  event.dataTransfer.effectAllowed = "move";
                }}
                onDragEnd={() => {
                  dragged.current = null;
                }}
                onKeyDown={(event) => {
                  if (
                    event.altKey &&
                    ["ArrowUp", "ArrowDown"].includes(event.key)
                  ) {
                    event.preventDefault();
                    onChange(
                      moveRule(
                        workflow,
                        rule.id,
                        index + (event.key === "ArrowUp" ? -1 : 1),
                      ),
                    );
                  }
                }}
              />
              <button className={styles.ruleText} onClick={() => onEdit(rule)}>
                {summary}
              </button>
              <button
                type="button"
                disabled={readOnly}
                role="switch"
                aria-checked={rule.enabled}
                aria-label={t("teamWorkflow.enable")}
                title={t(
                  rule.enabled
                    ? "teamWorkflow.enabled"
                    : "teamWorkflow.disabled",
                )}
                className={styles.switch}
                onClick={() =>
                  onChange(
                    saveRule(workflow, { ...rule, enabled: !rule.enabled }),
                  )
                }
              >
                <span />
              </button>
              <Menu
                label={t("teamWorkflow.more")}
                placement={{ side: "bottom", align: "end" }}
                items={[
                  {
                    id: "up",
                    icon: ArrowUp,
                    label: t("workflows.moveUp"),
                    disabled: readOnly || index === 0,
                    onSelect: () =>
                      onChange(moveRule(workflow, rule.id, index - 1)),
                  },
                  {
                    id: "down",
                    icon: ArrowDown,
                    label: t("workflows.moveDown"),
                    disabled: readOnly || index === workflow.rules.length - 1,
                    onSelect: () =>
                      onChange(moveRule(workflow, rule.id, index + 1)),
                  },
                  {
                    id: "delete",
                    disabled: readOnly,
                    icon: Trash2,
                    label: t("teamWorkflow.delete"),
                    danger: true,
                    onSelect: () => setDeleting(rule.id),
                  },
                ]}
                trigger={(props) => (
                  <IconButton
                    {...props}
                    className={styles.rowMore}
                    icon={MoreHorizontal}
                    label={t("teamWorkflow.more")}
                  />
                )}
              />
            </li>
          );
        })}
      </ol>
      {!rows.length && (
        <div className={styles.empty}>
          <WorkflowIcon size={32} aria-hidden />
          <span>{t("teamWorkflow.empty")}</span>
        </div>
      )}
      <Dialog
        open={deleting !== null}
        title={t("teamWorkflow.deleteConfirm")}
        onClose={() => setDeleting(null)}
        size="sm"
        footer={
          <>
            <Button onClick={() => setDeleting(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                onChange({
                  ...workflow,
                  rules: workflow.rules.filter((rule) => rule.id !== deleting),
                });
                setDeleting(null);
              }}
            >
              {t("teamWorkflow.delete")}
            </Button>
          </>
        }
      />
    </>
  );
}
