import { useEffect, useState } from "react";
import { useI18n } from "../../../i18n/I18nProvider";
import { Button, Dialog, TextArea, TextField } from "../../../ui";
import { readModels, type ModelRow } from "../../setup/model-api";
import {
  readWorkflows,
  workflowName,
  type Workflow,
} from "../../workflows/workflows-api";
import { refreshResearchNavigation } from "../../research/navigation-api";
import { CompareView, BatchResultsTable } from "./CompareView";
import {
  createBatch,
  readBatches,
  readBatchResults,
  readComparison,
  type Comparison,
  type EvaluationBatch,
  type EvaluationResults,
} from "./compare-api";
import styles from "./Compare.module.css";

export interface ComparePanelProps {
  workspaceId: string;
  researches: { id: string; title?: string; question: string }[];
  evaluation?: boolean;
  onOpenResearch(id: string): void;
}

export function ComparePanel({
  workspaceId,
  researches,
  evaluation,
  onOpenResearch,
}: ComparePanelProps) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<string[]>(() =>
    researches.slice(0, 3).map((r) => r.id),
  );
  const [data, setData] = useState<Comparison | null>(null);
  const [batches, setBatches] = useState<EvaluationBatch[]>([]);
  const [batchId, setBatchId] = useState("");
  const [results, setResults] = useState<EvaluationResults | null>(null);
  const [error, setError] = useState("");
  const [reads, setReads] = useState(0);
  const [creating, setCreating] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const ids = selected
    .filter((id) => researches.some((r) => r.id === id))
    .join(",");
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        if (evaluation) {
          const list = await readBatches(workspaceId);
          if (!cancelled) setBatches(list);
          const id = batchId || list[0]?.id;
          const next = id ? await readBatchResults(id) : null;
          if (!cancelled) setResults(next);
        } else {
          const next = ids
            ? await readComparison(ids.split(","))
            : { threads: [] };
          if (!cancelled) setData(next);
        }
        if (!cancelled) setError("");
      } catch (reason) {
        if (!cancelled)
          setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        if (!cancelled) setLoaded(true);
      }
    };
    void load();
    const timer = window.setInterval(
      () => !document.hidden && void load(),
      4000,
    );
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [workspaceId, evaluation, ids, batchId, reads]);
  return (
    <div className={`${styles.stack} ${styles.panel}`}>
      {evaluation ? (
        <div className={styles.actions}>
          <fieldset className={styles.choices}>
            <legend>{t("compare.batches")}</legend>
            {batches.map((batch) => (
              <label key={batch.id}>
                <input
                  type="radio"
                  name="evaluation-batch"
                  checked={(batchId || batches[0]?.id) === batch.id}
                  onChange={() => {
                    setBatchId(batch.id);
                    setResults(null);
                    setLoaded(false);
                  }}
                />
                {batch.name}
              </label>
            ))}
          </fieldset>
          <Button variant="primary" onClick={() => setCreating(true)}>
            {t("compare.createBatch")}
          </Button>
        </div>
      ) : (
        <fieldset className={styles.choices}>
          <legend>{t("compare.research")}</legend>
          {researches.map((research) => (
            <label key={research.id}>
              <input
                type="checkbox"
                checked={selected.includes(research.id)}
                disabled={
                  !selected.includes(research.id) && selected.length >= 12
                }
                onChange={(event) => {
                  setData(null);
                  setSelected(
                    event.target.checked
                      ? [...selected, research.id]
                      : selected.filter((id) => id !== research.id),
                  );
                }}
              />
              {research.title || research.question}
            </label>
          ))}
        </fieldset>
      )}
      {error && (
        <div className={styles.error} role="alert">
          {error}
          <Button variant="ghost" onClick={() => setReads((n) => n + 1)}>
            {t("common.retry")}
          </Button>
        </div>
      )}
      {evaluation ? (
        results ? (
          <BatchResultsTable
            results={results}
            onOpenResearch={onOpenResearch}
          />
        ) : (
          !error &&
          (loaded ? (
            <p className={styles.empty}>{t("compare.noBatches")}</p>
          ) : (
            <div className={styles.skeleton} aria-label={t("common.loading")} />
          ))
        )
      ) : data ? (
        <CompareView comparison={data} onOpenResearch={onOpenResearch} />
      ) : (
        !error && (
          <div className={styles.skeleton} aria-label={t("common.loading")} />
        )
      )}
      {creating && (
        <BatchDialog
          workspaceId={workspaceId}
          onClose={() => setCreating(false)}
          onCreated={(batch) => {
            setBatchId(batch.id);
            setCreating(false);
            setReads((n) => n + 1);
            refreshResearchNavigation();
          }}
        />
      )}
    </div>
  );
}

function BatchDialog({
  workspaceId,
  onClose,
  onCreated,
}: {
  workspaceId: string;
  onClose(): void;
  onCreated(batch: EvaluationBatch): void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [questions, setQuestions] = useState("");
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [models, setModels] = useState<ModelRow[]>([]);
  const [model, setModel] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    Promise.all([readWorkflows(workspaceId), readModels()]).then(
      ([flows, configs]) => {
        if (!cancelled) {
          setWorkflows(flows);
          setModels(configs.models);
          setModel(configs.models[0]?.id || "");
        }
      },
      (reason: unknown) =>
        !cancelled &&
        setError(reason instanceof Error ? reason.message : String(reason)),
    );
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);
  const lines = questions
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const create = async () => {
    setBusy(true);
    setError("");
    try {
      onCreated(
        await createBatch(workspaceId, {
          name: name.trim(),
          questions: lines,
          workflow_ids: chosen,
          model_config_id: model,
        }),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!busy}
      title={t("compare.createBatch")}
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={
              !name.trim() ||
              !lines.length ||
              !chosen.length ||
              !model ||
              lines.length * chosen.length > 100
            }
            onClick={create}
          >
            {t("compare.startBatch")}
          </Button>
        </>
      }
    >
      <div className={styles.stack}>
        <TextField
          label={t("workflows.name")}
          value={name}
          maxLength={200}
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
        />
        <TextArea
          label={t("compare.questions")}
          value={questions}
          rows={5}
          disabled={busy}
          onChange={(event) => setQuestions(event.target.value)}
        />
        <fieldset className={styles.choices} disabled={busy}>
          <legend>{t("workflows.title")}</legend>
          {workflows.map((workflow) => (
            <label key={workflow.id}>
              <input
                type="checkbox"
                checked={chosen.includes(workflow.id)}
                onChange={(event) =>
                  setChosen(
                    event.target.checked
                      ? [...chosen, workflow.id]
                      : chosen.filter((id) => id !== workflow.id),
                  )
                }
              />
              {workflowName(workflow, t)}
            </label>
          ))}
        </fieldset>
        <fieldset className={styles.choices} disabled={busy}>
          <legend>{t("research.home.model")}</legend>
          {models.map((item) => (
            <label key={item.id}>
              <input
                type="radio"
                name="batch-model"
                checked={model === item.id}
                onChange={() => setModel(item.id)}
              />
              {item.name || item.model}
            </label>
          ))}
        </fieldset>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
