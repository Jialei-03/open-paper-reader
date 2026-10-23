import { workflowName } from "../../workflows/workflows-api";
import { List, Plus, Search, Workflow as WorkflowIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useI18n } from "../../../i18n/I18nProvider";
import { Button, SegmentedControl } from "../../../ui";
import { RuleEditor } from "./RuleEditor";
import { WorkflowCanvas } from "./WorkflowCanvas";
import { WorkflowRules } from "./WorkflowRules";
import {
  newRule,
  saveRule,
  type WorkflowDataProps,
  type WorkflowNodeTarget,
  type WorkflowRule,
  type WorkflowRuntime,
} from "./workflow-model";
import styles from "./Workflow.module.css";

export interface WorkflowViewProps extends WorkflowDataProps {
  runtime?: WorkflowRuntime;
  focusedRule?: string;
  initialView?: "list" | "canvas";
  hideTitle?: boolean;
  onOpenNode?(target: WorkflowNodeTarget): void;
}

/** The caller owns persistence and the current workflow, including its version. */
function WorkflowContent({
  runtime,
  focusedRule,
  initialView = "list",
  hideTitle = false,
  onOpenNode,
  ...props
}: WorkflowViewProps) {
  const { t } = useI18n();
  const id = useId();
  const [view, setView] = useState(initialView);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<WorkflowRule | null>(null);
  useEffect(() => {
    if (focusedRule)
      setEditing(
        props.workflow.rules.find((r) => r.id === focusedRule) || null,
      );
  }, [focusedRule, props.workflow.id, props.workflow.version]);
  return (
    <section
      className={styles.page}
      data-view={view}
      aria-label={t("teamWorkflow.title")}
    >
      <div className={styles.content}>
        <header className={styles.header}>
          {!hideTitle && (
            <h1 className={styles.heading}>
              {workflowName(props.workflow, t) || t("teamWorkflow.title")}
            </h1>
          )}
          <div className={styles.actions}>
            {view === "list" && (
              <label className={styles.search}>
                <Search size={16} aria-hidden />
                <input
                  type="search"
                  aria-label={t("teamWorkflow.search")}
                  placeholder={t("teamWorkflow.search")}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
            )}
            <Button
              variant="primary"
              disabled={props.readOnly}
              icon={Plus}
              onClick={() => setEditing(newRule(`r-${crypto.randomUUID()}`))}
            >
              {t("teamWorkflow.new")}
            </Button>
          </div>
        </header>
        <div className={styles.viewSwitch}>
          <SegmentedControl
            kind="tabs"
            label={t("teamWorkflow.title")}
            value={view}
            onChange={setView}
            options={[
              {
                value: "list",
                label: t("teamWorkflow.list"),
                icon: List,
                panelId: `${id}-list`,
              },
              {
                value: "canvas",
                label: t("teamWorkflow.canvas"),
                icon: WorkflowIcon,
                panelId: `${id}-canvas`,
              },
            ]}
          />
        </div>
        <div
          role="tabpanel"
          id={`${id}-${view}`}
          aria-labelledby={`${id}-${view}-tab`}
        >
          {view === "list" ? (
            <WorkflowRules {...props} query={query} onEdit={setEditing} />
          ) : (
            <WorkflowCanvas
              {...props}
              runtime={runtime}
              onEdit={setEditing}
              onCreate={setEditing}
              onOpenNode={onOpenNode}
            />
          )}
        </div>
        {editing && (
          <RuleEditor
            key={editing.id}
            rule={editing}
            readOnly={props.readOnly}
            members={props.members}
            channels={props.channels}
            onClose={() => setEditing(null)}
            onSave={(rule) => {
              props.onChange(saveRule(props.workflow, rule));
              setEditing(null);
            }}
          />
        )}
      </div>
    </section>
  );
}

export function WorkflowView(props: WorkflowViewProps) {
  return <WorkflowContent key={props.workflow.id} {...props} />;
}
