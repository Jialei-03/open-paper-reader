import { List, Plus, Search, Workflow as WorkflowIcon } from "lucide-react";
import { useId, useState } from "react";
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
  initialView?: "list" | "canvas";
  onOpenNode?(target: WorkflowNodeTarget): void;
}

/** The caller owns persistence and the current workflow, including its version. */
function WorkflowContent({
  runtime,
  initialView = "list",
  onOpenNode,
  ...props
}: WorkflowViewProps) {
  const { t } = useI18n();
  const id = useId();
  const [view, setView] = useState(initialView);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<WorkflowRule | null>(null);
  return (
    <section className={styles.page} aria-label={t("teamWorkflow.title")}>
      <div className={styles.content}>
        <header className={styles.header}>
          <h1 className={styles.heading}>
            {props.workflow.name || t("teamWorkflow.title")}
          </h1>
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
