import {
  ArrowDown,
  ArrowUp,
  Copy,
  GripVertical,
  MoreHorizontal,
  Plus,
  Trash2,
  Workflow as WorkflowIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import {
  Button,
  Dialog,
  IconButton,
  Menu,
  TextArea,
  TextField,
} from "../../ui";
import { CustomizeHeader } from "../customize/CustomizeHeader";
import {
  createWorkflow,
  deleteWorkflow,
  moveStep,
  readWorkflows,
  stepName,
  updateWorkflow,
  workflowName,
  type StepType,
  type Workflow,
  type WorkflowInput,
  type WorkflowStep,
} from "./workflows-api";
import styles from "./Workflows.module.css";

const blankStep = (): WorkflowStep => ({
  name: "",
  type: "agent",
  instructions: "",
  outputs: [],
  confirmation: false,
  max_rounds: 3,
  max_retries: 2,
});
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
export function WorkflowsSection() {
  const { t } = useI18n();
  const [items, setItems] = useState<Workflow[] | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [reads, setReads] = useState(0);
  const [editing, setEditing] = useState<Workflow | "new" | null>(null);
  const [deleting, setDeleting] = useState<Workflow | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    readWorkflows().then(
      (value) => {
        if (!cancelled) {
          setItems(value);
          setError("");
        }
      },
      (reason) => {
        if (!cancelled) setError(errorText(reason));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [reads]);
  return (
    <div className={styles.manager}>
      <CustomizeHeader
        title={t("workflows.title")}
        query={query}
        onQuery={setQuery}
        action={
          <Button
            variant="primary"
            size="sm"
            icon={Plus}
            onClick={() => setEditing("new")}
          >
            {t("workflows.create")}
          </Button>
        }
      />
      {error && (
        <div role="alert">
          {error}
          <Button onClick={() => setReads((n) => n + 1)}>
            {t("common.retry")}
          </Button>
        </div>
      )}
      {!items ? (
        <div className={styles.skeleton} aria-label={t("common.loading")} />
      ) : (
        <ul className={styles.list}>
          {items
            .filter((item) =>
              workflowName(item, t).toLowerCase().includes(query.toLowerCase()),
            )
            .map((item) => (
              <li key={item.id} className={styles.row}>
                <WorkflowIcon aria-hidden />
                <button
                  className={styles.name}
                  onClick={() => setEditing(item)}
                >
                  {workflowName(item, t)}
                </button>
                <span className={styles.status}>
                  {item.builtin
                    ? t("workflows.builtin")
                    : t("workflows.version", { n: item.version })}
                </span>
                <Menu
                  label={t("customize.more", { name: workflowName(item, t) })}
                  items={[
                    {
                      id: "edit",
                      label: t(
                        item.builtin ? "customize.view" : "workflows.edit",
                      ),
                      onSelect: () => setEditing(item),
                    },
                    {
                      id: "copy",
                      label: t("workflows.copy"),
                      icon: Copy,
                      onSelect: () =>
                        setEditing({
                          ...item,
                          id: "",
                          name: t("workflows.copyName", {
                            name: workflowName(item, t),
                          }),
                          builtin: false,
                          steps: item.steps.map((step, index) => ({
                            ...step,
                            name: stepName(item, index, t),
                          })),
                        }),
                    },
                    ...(!item.builtin
                      ? [
                          {
                            id: "delete",
                            label: t("details.delete"),
                            danger: true,
                            onSelect: () => setDeleting(item),
                          },
                        ]
                      : []),
                  ]}
                  trigger={(props) => (
                    <IconButton
                      {...props}
                      icon={MoreHorizontal}
                      label={t("customize.more", {
                        name: workflowName(item, t),
                      })}
                    />
                  )}
                />
              </li>
            ))}
        </ul>
      )}
      {editing && (
        <WorkflowEditor
          key={editing === "new" ? "new" : editing.id}
          item={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setReads((n) => n + 1);
          }}
          onCopy={(item) =>
            setEditing({
              ...item,
              id: "",
              name: t("workflows.copyName", { name: workflowName(item, t) }),
              builtin: false,
              steps: item.steps.map((step, index) => ({
                ...step,
                name: stepName(item, index, t),
              })),
            })
          }
        />
      )}
      <Dialog
        open={!!deleting}
        title={t("workflows.deleteQuestion")}
        onClose={() => setDeleting(null)}
        footer={
          <>
            <Button onClick={() => setDeleting(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              loading={busy}
              onClick={async () => {
                if (!deleting) return;
                setBusy(true);
                try {
                  await deleteWorkflow(deleting.id);
                  setDeleting(null);
                  setReads((n) => n + 1);
                } catch (error) {
                  setError(errorText(error));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t("details.delete")}
            </Button>
          </>
        }
      />
    </div>
  );
}
function WorkflowEditor({
  item,
  onClose,
  onSaved,
  onCopy,
}: {
  item: Workflow | "new";
  onClose(): void;
  onSaved(): void;
  onCopy(item: Workflow): void;
}) {
  const { t } = useI18n();
  const readonly = item !== "new" && item.builtin;
  const [draft, setDraft] = useState<WorkflowInput>(() =>
    item === "new"
      ? { name: "", steps: [blankStep()] }
      : {
          name: workflowName(item, t),
          version: item.version,
          steps: item.steps.map((step, index) => ({
            name: stepName(item, index, t),
            type: step.type,
            instructions: step.instructions,
            outputs: [...step.outputs],
            confirmation: step.confirmation,
            max_rounds: step.max_rounds,
            max_retries: step.max_retries,
            action: step.action,
          })),
        },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dragged = useRef<number | null>(null);
  const update = (index: number, patch: Partial<WorkflowStep>) =>
    setDraft((old) => ({
      ...old,
      steps: old.steps.map((step, i) =>
        i === index ? { ...step, ...patch } : step,
      ),
    }));
  const move = (from: number, to: number) =>
    setDraft((old) => ({ ...old, steps: moveStep(old.steps, from, to) }));
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      if (item !== "new" && item.id)
        await updateWorkflow(item.id, {
          ...draft,
          steps: draft.steps.map((step) => ({
            ...step,
            outputs: step.outputs.map((path) => path.trim()).filter(Boolean),
          })),
        });
      else
        await createWorkflow({
          ...draft,
          steps: draft.steps.map((step) => ({
            ...step,
            outputs: step.outputs.map((path) => path.trim()).filter(Boolean),
          })),
        });
      onSaved();
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      title={t(readonly ? "customize.view" : "workflows.edit")}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          {readonly ? (
            <Button variant="primary" onClick={() => onCopy(item)}>
              {t("workflows.copy")}
            </Button>
          ) : (
            <Button
              variant="primary"
              loading={busy}
              disabled={
                !draft.name.trim() ||
                !draft.steps.length ||
                draft.steps.some((step) => !step.name.trim())
              }
              onClick={() => void save()}
            >
              {t("details.save")}
            </Button>
          )}
        </>
      }
    >
      <div className={styles.form}>
        {error && <p role="alert">{error}</p>}
        <TextField
          label={t("workflows.name")}
          value={draft.name}
          disabled={readonly || busy}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
        />
        {draft.steps.map((step, index) => (
          <fieldset
            key={index}
            disabled={readonly || busy}
            className={styles.step}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (dragged.current !== null) move(dragged.current, index);
              dragged.current = null;
            }}
          >
            <legend>{t("workflows.step", { n: index + 1 })}</legend>
            {!readonly && (
              <div className={styles.stepActions}>
                <IconButton
                  icon={GripVertical}
                  label={t("workflows.reorder")}
                  draggable
                  onDragStart={() => {
                    dragged.current = index;
                  }}
                />
                <IconButton
                  icon={ArrowUp}
                  label={t("workflows.moveUp")}
                  disabled={index === 0}
                  onClick={() => move(index, index - 1)}
                />
                <IconButton
                  icon={ArrowDown}
                  label={t("workflows.moveDown")}
                  disabled={index === draft.steps.length - 1}
                  onClick={() => move(index, index + 1)}
                />
                <IconButton
                  icon={Trash2}
                  label={t("common.remove")}
                  onClick={() =>
                    setDraft((old) => ({
                      ...old,
                      steps: old.steps.filter((_, i) => i !== index),
                    }))
                  }
                />
              </div>
            )}
            <TextField
              label={t("workflows.name")}
              value={step.name}
              onChange={(event) => update(index, { name: event.target.value })}
            />
            <label className={styles.field}>
              {t("workflows.type")}
              <select
                value={step.type}
                onChange={(event) =>
                  update(index, { type: event.target.value as StepType })
                }
              >
                {(["agent", "plan", "experiment", "review"] as const).map(
                  (type) => (
                    <option key={type} value={type}>
                      {t(`workflows.type.${type}`)}
                    </option>
                  ),
                )}
              </select>
            </label>
            <TextArea
              label={t("workflows.instructions")}
              rows={3}
              value={step.instructions}
              onChange={(event) =>
                update(index, { instructions: event.target.value })
              }
            />
            <TextArea
              label={t("workflows.outputs")}
              rows={2}
              value={step.outputs.join("\n")}
              onChange={(event) =>
                update(index, { outputs: event.target.value.split("\n") })
              }
            />
            <TextField
              label={t("workflows.maxRounds")}
              type="number"
              min={1}
              max={200}
              value={step.max_rounds ?? ""}
              onChange={(event) =>
                update(index, {
                  max_rounds: event.target.value
                    ? Number(event.target.value)
                    : null,
                })
              }
            />
            {step.type === "review" && (
              <TextField
                label={t("workflows.maxRetries")}
                type="number"
                min={0}
                max={10}
                value={step.max_retries}
                onChange={(event) =>
                  update(index, { max_retries: Number(event.target.value) })
                }
              />
            )}
            <label className={styles.checkbox}>
              <input
                type="checkbox"
                checked={step.confirmation}
                onChange={(event) =>
                  update(index, { confirmation: event.target.checked })
                }
              />
              {t("workflows.confirmation")}
            </label>
          </fieldset>
        ))}
        {!readonly && (
          <Button
            onClick={() =>
              setDraft((old) => ({
                ...old,
                steps: [...old.steps, blankStep()],
              }))
            }
          >
            <Plus aria-hidden />
            {t("workflows.addStep")}
          </Button>
        )}
      </div>
    </Dialog>
  );
}
