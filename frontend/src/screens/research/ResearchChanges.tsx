import { GitFork, GitMerge, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "../../api";
import { useI18n } from "../../i18n/I18nProvider";
import { followLink } from "../../reader/route";
import { Button, Dialog, SegmentedControl, Spinner, TextArea } from "../../ui";
import { Prose } from "./talk/ThreadView";
import {
  applyMerge,
  cancelMerge,
  forkOptions,
  forkResearch,
  mergeOptions,
  previewMerge,
  researchMerges,
  type ForkRound,
  type MergeFile,
  type MergeKind,
  type ProjectDetail,
  type ResearchMerge,
  type ResearchProject,
  type ResearchPlan,
} from "./research-api";
import styles from "./ResearchChanges.module.css";
import { refreshResearchNavigation } from "./navigation-api";
import { useResearchNavigation } from "./ResearchNavigation";
import { workspaceMachine } from "./workspace-machine";
import {
  readWorkflows,
  workflowName,
  type Workflow,
} from "../workflows/workflows-api";

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export function ForkDialog({
  project,
  onClose,
  go,
  initialSprintId,
  rerun = false,
}: {
  initialSprintId?: string;
  rerun?: boolean;
  project: ResearchProject;
  onClose(): void;
  go(hash: string): void;
}) {
  const { t } = useI18n();
  const [options, setOptions] = useState<{
    can_fork: boolean;
    reason: string;
    rounds: ForkRound[];
  } | null>(null);
  const [selected, setSelected] = useState(initialSprintId || "");
  const [change, setChange] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reads, setReads] = useState(0);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [workflowId, setWorkflowId] = useState("");
  const request = useRef({ key: "", id: "" });
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      forkOptions(project.id),
      rerun
        ? readWorkflows(project.workspace_id || undefined)
        : Promise.resolve([]),
    ]).then(
      ([value, items]) => {
        if (cancelled) return;
        setOptions(value);
        setWorkflows(items);
        setWorkflowId((old) =>
          items.some((item) => item.id === old)
            ? old
            : items.find((item) => item.id !== project.workflow?.id)?.id || "",
        );
        setSelected((old) =>
          initialSprintId
            ? initialSprintId
            : value.rounds.some(
                  (round) => round.sprint_id === old && round.available,
                )
              ? old
              : [...value.rounds]
                  .sort((a, b) => b.number - a.number)
                  .find((round) => round.available)?.sprint_id || "",
        );
        setError("");
      },
      (reason: unknown) => !cancelled && setError(errorText(reason)),
    );
    return () => {
      cancelled = true;
    };
  }, [project.id, project.workflow?.id, initialSprintId, rerun, reads]);
  const round = options?.rounds.find((item) => item.sprint_id === selected);
  const create = async () => {
    if (
      !round?.available ||
      !options?.can_fork ||
      (rerun ? !workflowId : !change.trim())
    )
      return;
    setBusy(true);
    setError("");
    const note = rerun ? project.question : change.trim();
    const key = `${round.sprint_id}:${round.commit_sha}:${note}:${workflowId}`;
    if (request.current.key !== key)
      request.current = { key, id: crypto.randomUUID() };
    try {
      const child = await forkResearch(project.id, {
        sprint_id: round.sprint_id,
        expected_commit: round.commit_sha,
        change: note,
        client_id: request.current.id,
        ...(rerun ? { workflow_id: workflowId } : {}),
      });
      refreshResearchNavigation();
      go(`research/${child.id}`);
      onClose();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!busy}
      title={t(rerun ? "compare.rerun" : "research.fork.action")}
      size="md"
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={
              !options?.can_fork ||
              !round?.available ||
              (rerun ? !workflowId : !change.trim())
            }
            onClick={create}
          >
            {t("research.fork.create")}
          </Button>
        </>
      }
    >
      <div className={styles.stack}>
        <p className={styles.question}>{project.question}</p>
        {!options && !error && <Spinner />}
        {options && (
          <fieldset className={styles.rounds}>
            <legend>{t("research.fork.round")}</legend>
            {options.rounds.map((item) => (
              <label
                key={item.sprint_id}
                className={styles.round}
                data-disabled={!item.available || undefined}
              >
                <input
                  type="radio"
                  name="fork-round"
                  checked={selected === item.sprint_id}
                  disabled={!item.available || !options.can_fork || busy}
                  onChange={() => setSelected(item.sprint_id)}
                />
                <span>
                  <strong>
                    {t("research.sprint", { number: item.number })}
                  </strong>
                  <code title={item.commit_sha}>
                    {item.commit_sha?.slice(0, 10) || "—"}
                  </code>
                  {!item.available && <small>{item.reason}</small>}
                </span>
              </label>
            ))}
            {!options.rounds.length && (
              <p className={styles.empty}>{t("research.fork.noRounds")}</p>
            )}
          </fieldset>
        )}
        {options && !options.can_fork && (
          <p className={styles.error}>{options.reason}</p>
        )}
        {rerun ? (
          <fieldset className={styles.rounds} disabled={busy}>
            <legend>{t("workflows.title")}</legend>
            {workflows.map((workflow) => (
              <label key={workflow.id} className={styles.round}>
                <input
                  type="radio"
                  name="rerun-workflow"
                  checked={workflowId === workflow.id}
                  onChange={() => setWorkflowId(workflow.id)}
                />
                <span>{workflowName(workflow, t)}</span>
              </label>
            ))}
          </fieldset>
        ) : (
          <TextArea
            label={t("research.fork.change")}
            rows={3}
            value={change}
            onChange={(event) => setChange(event.target.value)}
            disabled={busy}
          />
        )}

        {error && (
          <p className={styles.error} role="alert">
            {error}
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setReads((n) => n + 1)}
            >
              {t("common.retry")}
            </Button>
          </p>
        )}
      </div>
    </Dialog>
  );
}

export function MergeDialog({
  project,
  onClose,
  onChanged,
}: {
  project: ResearchProject;
  onClose(): void;
  onChanged(): void;
}) {
  const { t } = useI18n();
  const { data: navigation, connections } = useResearchNavigation();
  const [options, setOptions] = useState<{
    memory: boolean;
    code: boolean;
    reason: string;
    memory_reason?: string;
    code_reason?: string;
  } | null>(null);
  const [kind, setKind] = useState<MergeKind>("memory");
  const [preview, setPreview] = useState<ResearchMerge | null>(null);
  const [records, setRecords] = useState<ResearchMerge[]>([]);
  const [paths, setPaths] = useState<string[]>([]);
  const [files, setFiles] = useState<MergeFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [reads, setReads] = useState(0);
  useEffect(() => {
    let cancelled = false;
    mergeOptions(project.id).then(
      (value) => {
        if (!cancelled) {
          setOptions(value);
          if (!value.memory && value.code) setKind("code");
        }
      },
      (reason: unknown) => !cancelled && setError(errorText(reason)),
    );
    researchMerges(project.id).then(
      (rows) => !cancelled && setRecords(rows),
      (reason: unknown) => !cancelled && setError(errorText(reason)),
    );
    return () => {
      cancelled = true;
    };
  }, [project.id, reads]);
  const selectedChanged =
    kind === "code" &&
    !!preview &&
    JSON.stringify([...paths].sort()) !==
      JSON.stringify([...preview.paths].sort());
  const read = async (selection?: string[]) => {
    setBusy(true);
    setError("");
    setConfirmed(false);
    try {
      if (preview && ["preview", "conflict"].includes(preview.status)) {
        const previous = await cancelMerge(project.id, preview.id);
        if (previous.status === "applied") {
          setPreview(previous);
          setRecords((old) => [
            previous,
            ...old.filter((item) => item.id !== previous.id),
          ]);
          refreshResearchNavigation();
          onChanged();
          return;
        }
        setPreview(null);
      }
      const value = await previewMerge(project.id, kind, selection);
      setPreview(value);
      setPaths(value.paths);
      if (!selection) setFiles(value.files);
      setStale(false);
    } catch (reason) {
      setError(errorText(reason));
      setStale(true);
    } finally {
      setBusy(false);
    }
  };
  const changeKind = async (value: MergeKind) => {
    if (busy || kind === value) return;
    setBusy(true);
    try {
      if (preview && ["preview", "conflict"].includes(preview.status)) {
        const previous = await cancelMerge(project.id, preview.id);
        if (previous.status === "applied") {
          setPreview(previous);
          setConfirmed(false);
          refreshResearchNavigation();
          onChanged();
          return;
        }
      }
      setKind(value);
      setPreview(null);
      setPaths([]);
      setFiles([]);
      setConfirmed(false);
      setStale(false);
      setError("");
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };
  const apply = async () => {
    if (!preview || !confirmed || selectedChanged || stale) return;
    setBusy(true);
    setError("");
    try {
      const value = await applyMerge(project.id, preview);
      setPreview(value);
      setRecords((old) => [
        value,
        ...old.filter((item) => item.id !== value.id),
      ]);
      setConfirmed(false);
      refreshResearchNavigation();
      onChanged();
    } catch (reason) {
      setError(errorText(reason));
      if (reason instanceof ApiError && reason.status === 409) {
        setStale(true);
        setConfirmed(false);
      }
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    if (preview && ["preview", "conflict"].includes(preview.status)) {
      setBusy(true);
      try {
        const value = await cancelMerge(project.id, preview.id);
        if (value.status === "applied") {
          refreshResearchNavigation();
          onChanged();
        }
        onClose();
      } catch (reason) {
        setError(errorText(reason));
      } finally {
        setBusy(false);
      }
    } else onClose();
  };
  const targetLocation: ResearchMerge["target_location"] =
    preview?.target_location ||
    navigation.workspaces.find(
      (workspace) => workspace.id === project.workspace_id,
    )?.location;
  const targetMachine = workspaceMachine(
    targetLocation,
    connections,
    t("workspace.local"),
    t("workspace.remote"),
  );
  const allowed = !!options?.[kind];
  const applicable =
    allowed &&
    preview?.status === "preview" &&
    !preview.conflicts.length &&
    !selectedChanged &&
    !stale &&
    (kind !== "code" || paths.length > 0);
  return (
    <Dialog
      open
      onClose={() => {
        if (!busy) void cancel();
      }}
      dismissible={!busy}
      title={t("research.merge.action")}
      size="lg"
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={cancel}>
            {t(
              preview?.status === "applied" ? "common.close" : "common.cancel",
            )}
          </Button>
          {preview?.status !== "applied" && (
            <Button
              variant="primary"
              loading={busy}
              disabled={!applicable || !confirmed}
              onClick={apply}
            >
              {t("research.merge.confirm")}
            </Button>
          )}
        </>
      }
    >
      <div className={styles.stack}>
        <p className={styles.question}>{project.question}</p>
        {targetLocation?.path && (
          <p className={styles.boundary}>
            {t("workspace.mergeInto")} ·{" "}
            <span title={targetMachine.title}>{targetMachine.label}</span>{" "}
            <code>{targetLocation.path}</code>
          </p>
        )}
        <SegmentedControl
          kind="radio"
          size="sm"
          label={t("research.merge.kind")}
          value={kind}
          onChange={(value) => void changeKind(value)}
          options={[
            { value: "memory", label: t("research.merge.memory") },
            { value: "code", label: t("research.merge.code") },
          ]}
        />
        {!options && !error && <Spinner />}
        {options && !allowed && (
          <p className={styles.empty}>
            {options[`${kind}_reason`] ||
              options.reason ||
              t("research.merge.unavailable")}
          </p>
        )}
        {allowed && preview?.status !== "applied" && (
          <Button
            size="sm"
            variant="secondary"
            icon={RefreshCw}
            loading={busy}
            disabled={kind === "code" && !!preview && paths.length === 0}
            onClick={() => read(kind === "code" && preview ? paths : undefined)}
          >
            {t(preview ? "research.merge.refresh" : "research.merge.preview")}
          </Button>
        )}
        {error && (
          <p className={styles.error} role="alert">
            {error}
            {!options && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setReads((n) => n + 1)}
              >
                {t("common.retry")}
              </Button>
            )}
          </p>
        )}
        {stale && (
          <p className={styles.warning} role="status">
            {t("research.merge.stale")}
          </p>
        )}
        {preview && (
          <>
            {preview.error && (
              <p className={styles.error} role="alert">
                {preview.error}
              </p>
            )}
            <div className={styles.commits}>
              <span>
                main{" "}
                <code title={preview.expected_main_commit}>
                  {preview.expected_main_commit.slice(0, 10)}
                </code>
              </span>
              <span>
                {t("research.merge.source")}{" "}
                <code title={preview.expected_source_commit}>
                  {preview.expected_source_commit.slice(0, 10)}
                </code>
              </span>
            </div>
            {preview.status === "applied" ? (
              <p className={styles.applied} role="status">
                {t("research.merge.applied")}{" "}
                <code>{preview.commit_sha.slice(0, 12)}</code>
              </p>
            ) : (
              <>
                {kind === "memory" && preview.memory_text && (
                  <div className={styles.memoryPreview}>
                    <Prose text={preview.memory_text} />
                  </div>
                )}
                {kind === "code" && (
                  <fieldset className={styles.fileChoices}>
                    <legend>{t("research.merge.paths")}</legend>
                    {files.map((file) => (
                      <label key={file.path}>
                        <input
                          type="checkbox"
                          checked={paths.includes(file.path)}
                          disabled={busy}
                          onChange={(event) => {
                            setPaths((old) =>
                              event.target.checked
                                ? [...old, file.path]
                                : old.filter((path) => path !== file.path),
                            );
                            setConfirmed(false);
                          }}
                        />
                        <code>{file.path}</code>
                        <small>{file.status}</small>
                      </label>
                    ))}
                    {!files.length && (
                      <p className={styles.empty}>
                        {t("research.merge.noChanges")}
                      </p>
                    )}
                  </fieldset>
                )}
                {preview.files.map((file) => (
                  <details key={file.path} className={styles.diff}>
                    <summary>
                      {file.path}
                      {file.binary && ` · ${t("research.merge.binary")}`}
                    </summary>
                    {file.truncated && (
                      <p className={styles.warning}>
                        {t("research.merge.truncated")}
                      </p>
                    )}
                    <pre>{file.diff}</pre>
                  </details>
                ))}
                {preview.conflicts.length > 0 && (
                  <section
                    className={styles.conflicts}
                    aria-label={t("research.merge.conflicts")}
                  >
                    <h3>{t("research.merge.conflicts")}</h3>
                    {preview.conflicts.map((file) => (
                      <details key={file.path} open>
                        <summary>{file.path}</summary>
                        <pre>{file.diff}</pre>
                      </details>
                    ))}
                  </section>
                )}
                {selectedChanged && (
                  <p className={styles.warning}>
                    {t("research.merge.selectionChanged")}
                  </p>
                )}
                {applicable && (
                  <label className={styles.confirm}>
                    <input
                      type="checkbox"
                      disabled={busy}
                      checked={confirmed}
                      onChange={(event) => setConfirmed(event.target.checked)}
                    />
                    {t(
                      kind === "memory"
                        ? "research.merge.confirmMemory"
                        : "research.merge.confirmCode",
                    )}
                  </label>
                )}
              </>
            )}
          </>
        )}
        {records.filter((item) => item.status === "applied").length > 0 && (
          <details className={styles.records}>
            <summary>{t("research.merge.history")}</summary>
            {records
              .filter((item) => item.status === "applied")
              .map((item) => (
                <div key={item.id}>
                  <span>
                    {t(
                      item.kind === "memory"
                        ? "research.merge.memory"
                        : "research.merge.code",
                    )}
                  </span>
                  <code>{item.commit_sha.slice(0, 12)}</code>
                  <time>{item.created_at}</time>
                </div>
              ))}
          </details>
        )}
      </div>
    </Dialog>
  );
}

export function ResearchOrigin({
  detail,
  go,
  onResume,
}: {
  detail: ProjectDetail;
  go(hash: string): void;
  onResume(): void;
}) {
  const { t } = useI18n();
  const [historyOpen, setHistoryOpen] = useState(false);
  const source = detail.project.forked_from;
  if (!source || !source.research_id) return null;
  const hash = `research/${source.research_id}`;
  const history = detail.inherited_history;
  return (
    <section className={styles.origin} aria-label={t("research.fork.source")}>
      <div className={styles.originHead}>
        <GitFork size={15} aria-hidden />
        <a href={`#${hash}`} onClick={followLink(go, hash)}>
          {source.question || source.research_id}
        </a>
        <span>{t("research.sprint", { number: source.number })}</span>
        <code title={source.commit}>{source.commit.slice(0, 10)}</code>
      </div>
      <p>{source.change}</p>
      <div className={styles.originFoot}>
        {detail.project.status === "paused" &&
          detail.project.stage === "scoping" && (
            <Button size="sm" variant="secondary" onClick={onResume}>
              {t("research.fork.resume")}
            </Button>
          )}
      </div>
      {history && (history.events.length > 0 || history.sprints.length > 0) && (
        <details
          className={styles.inherited}
          onToggle={(event) => setHistoryOpen(event.currentTarget.open)}
        >
          <summary>{t("research.fork.history")}</summary>
          {historyOpen && (
            <>
              {history.events
                .filter((event) =>
                  [
                    "message",
                    "plan_proposed",
                    "decision_requested",
                    "human_decision",
                  ].includes(event.action),
                )
                .map((event) => {
                  const plan = event.detail.plan as ResearchPlan | undefined;
                  const text =
                    event.action === "plan_proposed"
                      ? plan?.summary || plan?.goal || plan?.question || ""
                      : event.action === "human_decision"
                        ? `${t(event.detail.approve ? "research.ask.yes" : "research.ask.no")} ${event.detail.note || ""}`
                        : String(
                            event.detail.text ||
                              event.detail.question ||
                              event.detail.summary ||
                              event.detail.reason ||
                              "",
                          );
                  const actor =
                    event.actor === "human"
                      ? t("research.fork.researcher")
                      : event.actor === "lead"
                        ? t("projects.lead")
                        : event.actor === "executor"
                          ? t("research.role.executor")
                          : event.actor === "distiller"
                            ? t("research.role.distiller")
                            : event.actor === "discussion"
                              ? t("research.role.discussion")
                              : event.actor === "system"
                                ? t("workspace.system")
                                : event.actor === "advisor" ||
                                    event.actor === "scoping"
                                  ? t("research.role.advisor")
                                  : event.actor;
                  const label =
                    event.action === "plan_proposed"
                      ? t("research.plan.title")
                      : event.action === "decision_requested"
                        ? t("projects.notes.history.decision")
                        : event.action === "human_decision"
                          ? t("research.ask.answered")
                          : "";
                  return (
                    <div key={event.id} className={styles.oldMessage}>
                      <small>
                        {actor} · {label && `${label} · `}
                        <time dateTime={event.created_at}>
                          {event.created_at}
                        </time>
                      </small>
                      <Prose text={text} />
                    </div>
                  );
                })}
              {history.sprints.map((sprint) => (
                <div key={sprint.id} className={styles.oldMessage}>
                  <strong>
                    {t("research.sprint", { number: sprint.number })}
                  </strong>
                  <Prose text={sprint.summary} />
                </div>
              ))}
            </>
          )}
        </details>
      )}
    </section>
  );
}
