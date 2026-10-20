import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/i18n";
import {
  Button,
  Dialog,
  SegmentedControl,
  TextArea,
  TextField,
  toast,
} from "../../ui";
import {
  environmentProgress,
  prepareEnvironment,
  readResearchSettings,
  saveResearchSettings,
  testCompute,
  type Compute,
  type EnvProgress,
  type Environment,
  type ResearchSettings,
} from "../research/research-api";
import { AgentRunView } from "../research/talk/AgentRunView";
import { Section } from "./Section";
import styles from "./Settings.module.css";

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "machine";

const describe = (env: Environment) =>
  [
    env.python && `Python ${env.python}`,
    env.packages?.torch && `torch ${env.packages.torch}`,
    env.gpus?.length ? env.gpus.join(", ") : env.cuda === false ? "CPU" : "",
  ]
    .filter(Boolean)
    .join(" · ");

interface Draft {
  name: string;
  host: string;
  gpus: string;
}

/**
 * Research environments: where experiments run. An SSH machine is prepared by
 * an agent that logs in and sets it up; the system checks the result itself
 * before the environment counts as ready. Also where run numbers are mirrored.
 */
export function ResearchSection({
  part,
}: {
  /** One half only: where experiments run, or where their numbers go. */
  part?: "environments" | "tracker";
} = {}) {
  const { t } = useI18n();
  const [data, setData] = useState<ResearchSettings | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [probe, setProbe] = useState<Record<string, string>>({});
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState<Compute | null>(null);
  const [watching, setWatching] = useState<Compute | null>(null);

  const reload = () =>
    readResearchSettings().then(setData, () => setData(null));
  useEffect(() => {
    reload();
  }, []);

  const fail = (error: unknown) =>
    toast.show({
      message: error instanceof Error ? error.message : String(error),
      tone: "error",
    });

  const save = async (body: Parameters<typeof saveResearchSettings>[0]) => {
    setBusy(true);
    try {
      setData(await saveResearchSettings(body));
      return true;
    } catch (error) {
      fail(error);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const check = async (id: string) => {
    setProbe((p) => ({ ...p, [id]: t("settings.research.testing") }));
    try {
      const env = await testCompute(id);
      setProbe((p) => ({ ...p, [id]: describe(env) }));
    } catch (error) {
      setProbe((p) => ({
        ...p,
        [id]: error instanceof Error ? error.message : String(error),
      }));
    }
  };

  if (!data)
    return (
      <Section title={t("settings.research.title")}>
        <p className={styles.muted}>{t("common.loading")}</p>
      </Section>
    );

  const tracker = data.tracker;
  const stateOf = (c: Compute) => data.states?.[c.id] ?? {};
  const statusKey = (c: Compute): MessageKey => {
    if (c.kind === "docker") return "settings.research.status.local";
    const status = stateOf(c).status;
    return status
      ? (`settings.research.status.${status}` as MessageKey)
      : "settings.research.status.new";
  };
  return (
    <Section
      title={t(
        part === "tracker"
          ? "settings.research.tracker"
          : "settings.research.title",
      )}
      lead={t(
        part === "tracker"
          ? "settings.research.trackerLead"
          : "settings.research.lead",
      )}
      action={
        part !== "tracker" && (
          <Button
            size="sm"
            variant="secondary"
            icon={Plus}
            onClick={() => setDraft({ name: "", host: "", gpus: "" })}
          >
            {t("settings.research.addSsh")}
          </Button>
        )
      }
    >
      {part !== "tracker" && (
        <div className={styles.list}>
          {data.computes.map((c) => {
            const state = stateOf(c);
            return (
              <div key={c.id} className={styles.row}>
                <div className={styles.rowText}>
                  <span className={styles.rowTitle}>
                    {c.name}
                    <span className={styles.badge}>
                      {t(statusKey(c), { version: state.version ?? 0 })}
                    </span>
                    {c.id === data.default_compute && (
                      <span className={styles.badge}>
                        {t("settings.research.default")}
                      </span>
                    )}
                  </span>
                  <span className={styles.rowMeta}>
                    {probe[c.id] ||
                      (c.kind === "ssh"
                        ? [
                            c.host,
                            state.probe ? describe(state.probe) : "",
                            state.status === "failed" ? state.error : "",
                          ]
                            .filter(Boolean)
                            .join(" · ")
                        : t("settings.research.localMeta", {
                            cpus: c.cpus ?? 2,
                            memory: c.memory_gb ?? 4,
                          }))}
                  </span>
                </div>
                <div className={styles.rowActions}>
                  {c.kind === "ssh" &&
                    (state.status === "preparing" ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setWatching(c)}
                      >
                        {t("settings.research.watch")}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant={state.status === "ready" ? "ghost" : "primary"}
                        onClick={() => setPreparing(c)}
                      >
                        {t(
                          state.status === "ready"
                            ? "settings.research.reprepare"
                            : "settings.research.prepare",
                        )}
                      </Button>
                    ))}
                  {c.kind === "ssh" &&
                    state.status &&
                    state.status !== "preparing" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setWatching(c)}
                      >
                        {t("settings.research.details")}
                      </Button>
                    )}
                  <Button size="sm" variant="ghost" onClick={() => check(c.id)}>
                    {t("settings.research.test")}
                  </Button>
                  {c.id !== data.default_compute && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => save({ default_compute: c.id })}
                    >
                      {t("settings.research.makeDefault")}
                    </Button>
                  )}
                  {c.id !== "local" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        save({
                          computes: data.computes.filter((x) => x.id !== c.id),
                          default_compute:
                            data.default_compute === c.id
                              ? "local"
                              : data.default_compute,
                        })
                      }
                    >
                      {t("settings.research.remove")}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {part !== "environments" && (
        <>
          {!part && (
            <>
              <h3 className={styles.subTitle}>
                {t("settings.research.tracker")}
              </h3>
              <p className={styles.settingHint}>
                {t("settings.research.trackerLead")}
              </p>
            </>
          )}
          <div className={styles.setting}>
            <SegmentedControl
              kind="radio"
              size="sm"
              label={t("settings.research.tracker")}
              value={tracker.kind}
              onChange={(kind) => save({ tracker: { kind } })}
              options={[
                { value: "none", label: t("settings.research.none") },
                { value: "swanlab", label: "SwanLab" },
                { value: "wandb", label: "W&B" },
              ]}
            />
          </div>
          {tracker.kind !== "none" && (
            <>
              <div className={styles.setting}>
                <SegmentedControl
                  kind="radio"
                  size="sm"
                  label={t("settings.research.mode")}
                  value={tracker.mode}
                  onChange={(mode) => save({ tracker: { mode } })}
                  options={[
                    { value: "local", label: t("settings.research.local") },
                    { value: "cloud", label: t("settings.research.cloud") },
                  ]}
                />
              </div>
              <TextField
                label={t("settings.research.project")}
                defaultValue={tracker.project}
                onBlur={(event) =>
                  event.target.value.trim() !== tracker.project &&
                  save({ tracker: { project: event.target.value.trim() } })
                }
              />
              {tracker.mode === "cloud" && (
                <form
                  className={styles.setting}
                  onSubmit={async (event) => {
                    event.preventDefault();
                    if (
                      key.trim() &&
                      (await save({ tracker: { api_key: key.trim() } }))
                    )
                      setKey("");
                  }}
                >
                  <TextField
                    label={t("settings.research.key")}
                    type="password"
                    autoComplete="off"
                    value={key}
                    placeholder={
                      tracker.has_key ? t("settings.research.keySaved") : ""
                    }
                    description={t("settings.research.keyHint")}
                    onChange={(event) => setKey(event.target.value)}
                  />
                  <Button
                    type="submit"
                    size="sm"
                    disabled={!key.trim() || busy}
                  >
                    {t("settings.research.save")}
                  </Button>
                </form>
              )}
            </>
          )}
        </>
      )}

      <Dialog
        open={!!draft}
        onClose={() => setDraft(null)}
        title={t("settings.research.addSsh")}
        description={t("settings.research.sshLead")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={!draft?.host.trim()}
              onClick={async () => {
                if (!draft) return;
                const item: Compute = {
                  id: slug(draft.name || draft.host),
                  name: draft.name.trim() || draft.host.trim(),
                  kind: "ssh",
                  host: draft.host.trim(),
                  remote_dir: "~/ora-research",
                  runner: "shell",
                  gpus: draft.gpus.trim(),
                };
                if (await save({ computes: [...data.computes, item] })) {
                  setDraft(null);
                  setPreparing(item);
                }
              }}
            >
              {t("settings.research.add")}
            </Button>
          </>
        }
      >
        {draft && (
          <div className={styles.column}>
            <TextField
              label={t("settings.research.name")}
              value={draft.name}
              placeholder={t("settings.research.namePlaceholder")}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
            <TextField
              label={t("settings.research.host")}
              value={draft.host}
              placeholder="research-wsl"
              description={t("settings.research.hostHint")}
              onChange={(e) => setDraft({ ...draft, host: e.target.value })}
            />
            <TextField
              label="GPU"
              value={draft.gpus}
              placeholder="0"
              description={t("settings.research.gpuHint")}
              onChange={(e) => setDraft({ ...draft, gpus: e.target.value })}
            />
          </div>
        )}
      </Dialog>

      <PrepareDialog
        env={preparing}
        initial={preparing ? stateOf(preparing) : {}}
        onClose={() => setPreparing(null)}
        onStarted={(env) => {
          setPreparing(null);
          reload();
          setWatching(env);
        }}
      />
      <ProgressDialog
        env={watching}
        onClose={() => {
          setWatching(null);
          reload();
        }}
      />
    </Section>
  );
}

function PrepareDialog({
  env,
  initial,
  onClose,
  onStarted,
}: {
  env: Compute | null;
  initial: { needs?: string; allow_sudo?: boolean };
  onClose(): void;
  onStarted(env: Compute): void;
}) {
  const { t } = useI18n();
  const [needs, setNeeds] = useState("");
  const [sudo, setSudo] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setNeeds(initial.needs || t("settings.research.needsDefault"));
    setSudo(!!initial.allow_sudo);
    // Filled anew each time the dialog opens for an environment.
  }, [env?.id]);
  return (
    <Dialog
      open={!!env}
      onClose={onClose}
      title={t("settings.research.prepareTitle", { name: env?.name ?? "" })}
      description={t("settings.research.prepareLead")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!needs.trim()}
            onClick={async () => {
              if (!env) return;
              setBusy(true);
              try {
                await prepareEnvironment(env.id, {
                  needs: needs.trim(),
                  allow_sudo: sudo,
                });
                onStarted(env);
              } catch (error) {
                toast.show({
                  message:
                    error instanceof Error ? error.message : String(error),
                  tone: "error",
                });
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("settings.research.prepareStart")}
          </Button>
        </>
      }
    >
      <div className={styles.column}>
        <TextArea
          label={t("settings.research.needs")}
          value={needs}
          rows={4}
          onChange={(e) => setNeeds(e.target.value)}
        />
        <label className={styles.setting}>
          <input
            type="checkbox"
            checked={sudo}
            onChange={(e) => setSudo(e.target.checked)}
          />
          <span className={styles.settingLabel}>
            {t("settings.research.allowSudo")}
          </span>
        </label>
      </div>
    </Dialog>
  );
}

function ProgressDialog({
  env,
  onClose,
}: {
  env: Compute | null;
  onClose(): void;
}) {
  const { t } = useI18n();
  const [progress, setProgress] = useState<EnvProgress | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!env) {
      setProgress(null);
      return;
    }
    environmentProgress(env.id).then(setProgress, () => undefined);
  }, [env?.id, tick]);
  const live = progress?.state.status === "preparing";
  useEffect(() => {
    if (!env || !live) return;
    const timer = window.setTimeout(() => setTick((n) => n + 1), 3000);
    return () => window.clearTimeout(timer);
  }, [env, live, tick]);
  const state = progress?.state;
  return (
    <Dialog
      open={!!env}
      onClose={onClose}
      size="lg"
      title={t("settings.research.progressTitle", { name: env?.name ?? "" })}
      description={
        state?.status
          ? t(`settings.research.status.${state.status}` as MessageKey, {
              version: state.version ?? 0,
            })
          : ""
      }
    >
      {!progress ? (
        <p className={styles.muted}>{t("common.loading")}</p>
      ) : (
        <div className={styles.column}>
          {state?.status === "ready" && (
            <>
              <p className={styles.settingHint}>{state.summary}</p>
              <p className={styles.settingHint}>
                {t("settings.research.readyPython", {
                  python: state.python ?? "",
                  probe: state.probe ? describe(state.probe) : "",
                })}
              </p>
              {state.recipe && (
                <details>
                  <summary className={styles.settingLabel}>
                    {t("settings.research.recipe")}
                  </summary>
                  <pre className={styles.code}>{state.recipe}</pre>
                </details>
              )}
            </>
          )}
          {state?.status === "failed" && (
            <p role="alert" className={styles.error}>
              {state.error}
            </p>
          )}
          {state?.run_id && <AgentRunView runId={state.run_id} />}
        </div>
      )}
    </Dialog>
  );
}
