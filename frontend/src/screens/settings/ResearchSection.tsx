import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { Button, Dialog, SegmentedControl, TextField, toast } from "../../ui";
import {
  readResearchSettings,
  saveResearchSettings,
  testCompute,
  type Compute,
  type Environment,
  type ResearchSettings,
} from "../research/research-api";
import { Section } from "./Section";
import styles from "./Settings.module.css";

const BLANK: Compute = {
  id: "",
  name: "",
  kind: "ssh",
  host: "",
  remote_dir: "~/ora-research",
  runner: "shell",
  python: "python3",
  gpus: "",
};

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "gpu";

const describe = (env: Environment) =>
  [
    env.python && `Python ${env.python}`,
    env.packages?.torch && `torch ${env.packages.torch}`,
    env.gpus?.length ? env.gpus.join(", ") : env.cuda === false ? "CPU" : "",
  ]
    .filter(Boolean)
    .join(" · ");

/**
 * Where research experiments run (this machine's Docker, or machines over
 * SSH) and where their numbers are mirrored (SwanLab or Weights & Biases).
 */
export function ResearchSection() {
  const { t } = useI18n();
  const [data, setData] = useState<ResearchSettings | null>(null);
  const [draft, setDraft] = useState<Compute | null>(null);
  const [probe, setProbe] = useState<Record<string, string>>({});
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    readResearchSettings().then(setData, () => setData(null));
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
  return (
    <Section
      title={t("settings.research.title")}
      lead={t("settings.research.lead")}
      action={
        <Button
          size="sm"
          variant="secondary"
          icon={Plus}
          onClick={() => setDraft({ ...BLANK })}
        >
          {t("settings.research.addSsh")}
        </Button>
      }
    >
      <h3 className={styles.subTitle}>{t("settings.research.computes")}</h3>
      <div className={styles.list}>
        {data.computes.map((c) => (
          <div key={c.id} className={styles.row}>
            <div className={styles.rowText}>
              <span className={styles.rowTitle}>
                {c.name}
                {c.id === data.default_compute && (
                  <span className={styles.badge}>
                    {t("settings.research.default")}
                  </span>
                )}
              </span>
              <span className={styles.rowMeta}>
                {probe[c.id] ||
                  (c.kind === "ssh"
                    ? `${c.host} · ${c.runner} · GPU ${c.gpus || t("settings.research.noGpu")}`
                    : t("settings.research.localMeta", {
                        cpus: c.cpus ?? 2,
                        memory: c.memory_gb ?? 4,
                      }))}
              </span>
            </div>
            <div className={styles.rowActions}>
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
        ))}
      </div>

      <h3 className={styles.subTitle}>{t("settings.research.tracker")}</h3>
      <p className={styles.settingHint}>{t("settings.research.trackerLead")}</p>
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
              <Button type="submit" size="sm" disabled={!key.trim() || busy}>
                {t("settings.research.save")}
              </Button>
            </form>
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
              disabled={!draft?.host?.trim()}
              onClick={async () => {
                if (!draft) return;
                const item = {
                  ...draft,
                  name: draft.name.trim() || draft.host!.trim(),
                  id: slug(draft.name || draft.host || ""),
                };
                if (await save({ computes: [...data.computes, item] })) {
                  setDraft(null);
                  check(item.id);
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
              placeholder="gpu-box"
              description={t("settings.research.hostHint")}
              onChange={(e) => setDraft({ ...draft, host: e.target.value })}
            />
            <TextField
              label={t("settings.research.remoteDir")}
              value={draft.remote_dir}
              onChange={(e) =>
                setDraft({ ...draft, remote_dir: e.target.value })
              }
            />
            <SegmentedControl
              kind="radio"
              size="sm"
              label={t("settings.research.runner")}
              value={draft.runner ?? "shell"}
              onChange={(runner) => setDraft({ ...draft, runner })}
              options={[
                { value: "shell", label: t("settings.research.shell") },
                { value: "docker", label: "Docker" },
              ]}
            />
            {draft.runner !== "docker" && (
              <TextField
                label={t("settings.research.python")}
                value={draft.python}
                description={t("settings.research.pythonHint")}
                onChange={(e) => setDraft({ ...draft, python: e.target.value })}
              />
            )}
            <TextField
              label="GPU"
              value={draft.gpus}
              placeholder="all"
              description={t("settings.research.gpuHint")}
              onChange={(e) => setDraft({ ...draft, gpus: e.target.value })}
            />
          </div>
        )}
      </Dialog>
    </Section>
  );
}
