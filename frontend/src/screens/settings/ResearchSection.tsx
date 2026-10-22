import { MoreHorizontal, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import {
  Button,
  Dialog,
  IconButton,
  Menu,
  SegmentedControl,
  TextField,
  toast,
} from "../../ui";
import {
  checkEnvironment,
  readResearchSettings,
  saveResearchSettings,
  sshHosts,
  type Compute,
  type Environment,
  type ResearchSettings,
  type SshHost,
} from "../research/research-api";
import { Section } from "./Section";
import styles from "./Settings.module.css";

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "machine";

/** "8 × RTX 2080 Ti", "Apple M5 Pro", "CPU": what experiments get there. */
const hardware = (env: Environment & { chip?: string }) => {
  // nvidia-smi says "NVIDIA GeForce RTX 2080 Ti, 11264 MiB".
  const gpus = (env.gpus ?? []).map((g) =>
    g.split(",")[0].replace(/^NVIDIA (GeForce )?/, ""),
  );
  if (gpus.length) {
    const same = gpus.every((g) => g === gpus[0]);
    return same && gpus.length > 1
      ? `${gpus.length} × ${gpus[0]}`
      : gpus.join(", ");
  }
  if (env.mps) return env.chip || "Apple GPU (MPS)";
  return env.chip || (env.cpus ? `${env.cpus} CPU` : "CPU");
};

const describe = (env: Environment & { chip?: string }) =>
  [hardware(env), env.python && `Python ${env.python}`]
    .filter(Boolean)
    .join(" · ");

interface Draft {
  name: string;
  host: string;
  gpus: string;
  remote_dir: string;
  /** Editing this environment; a new one otherwise. */
  id?: string;
}

/**
 * Research environments: this machine, and the SSH connections of this Mac
 * (~/.ssh/config), each switched on to run experiments there. Nothing is
 * prepared ahead: an environment is checked (reachable, and what it offers),
 * and experiments install what they lack in their own workspace. Also where
 * run numbers are mirrored.
 */
export function ResearchSection({
  part,
}: {
  /** One half only: where experiments run, or where their numbers go. */
  part?: "environments" | "tracker";
} = {}) {
  const { t } = useI18n();
  const [data, setData] = useState<ResearchSettings | null>(null);
  const [hosts, setHosts] = useState<SshHost[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [checking, setChecking] = useState<Record<string, boolean>>({});
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);

  const fail = (error: unknown) =>
    toast.show({
      message: error instanceof Error ? error.message : String(error),
      tone: "error",
    });

  const check = async (id: string) => {
    setChecking((c) => ({ ...c, [id]: true }));
    try {
      const state = await checkEnvironment(id);
      setData((d) => d && { ...d, states: { ...d.states, [id]: state } });
    } catch (error) {
      fail(error);
    } finally {
      setChecking((c) => ({ ...c, [id]: false }));
    }
  };

  useEffect(() => {
    readResearchSettings().then(
      (d) => {
        setData(d);
        // Whether each environment can be reached now, checked on opening.
        if (part !== "tracker")
          for (const c of d.computes) if (c.kind !== "docker") void check(c.id);
      },
      () => setData(null),
    );
    if (part !== "tracker") sshHosts().then(setHosts, () => setHosts([]));
  }, []);

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

  if (!data)
    return (
      <Section title={t("settings.research.title")}>
        <p className={styles.muted}>{t("common.loading")}</p>
      </Section>
    );

  const tracker = data.tracker;
  const computes = data.computes;
  const enabled = async (item: Compute) => {
    if (await save({ computes: [...computes, item] })) void check(item.id);
  };
  const disable = (c: Compute) =>
    save({
      computes: computes.filter((x) => x.id !== c.id),
      default_compute:
        data.default_compute === c.id ? "host" : data.default_compute,
    });
  const newSsh = (host: string, name = host, gpus = "", dir = ""): Compute => {
    let id = slug(name);
    while (computes.some((c) => c.id === id)) id = `${id}-2`.slice(0, 40);
    return {
      id,
      name,
      kind: "ssh",
      host,
      remote_dir: dir || "~/ora-research",
      runner: "shell",
      gpus,
    };
  };
  // The SSH list: every connection of this Mac, then those added by hand.
  const rows: { host: string; meta: string; compute?: Compute }[] = [
    ...hosts.map((h) => ({
      host: h.name,
      meta: [h.user, h.hostname].filter(Boolean).join("@"),
      compute: computes.find((c) => c.kind === "ssh" && c.host === h.name),
    })),
    ...computes
      .filter((c) => c.kind === "ssh" && !hosts.some((h) => h.name === c.host))
      .map((c) => ({ host: c.host ?? "", meta: "", compute: c })),
  ];

  const status = (c: Compute) => {
    const state = data.states?.[c.id] ?? {};
    if (checking[c.id] && !state.status)
      return { tone: "busy", text: t("settings.research.checking") };
    if (state.status === "disconnected")
      return {
        tone: "off",
        text: checking[c.id]
          ? t("settings.research.checking")
          : t("settings.research.disconnected"),
        detail: state.error,
      };
    if (state.status === "connected")
      return {
        tone: "on",
        text: state.probe
          ? hardware(state.probe)
          : t("settings.research.connected"),
        detail: state.probe ? describe(state.probe) : "",
      };
    return {
      tone: "busy",
      text: checking[c.id]
        ? t("settings.research.checking")
        : t("settings.research.unchecked"),
    };
  };

  const actions = (c: Compute) => (
    <Menu
      label={t("settings.research.more", { name: c.name })}
      placement={{ side: "bottom", align: "end" }}
      items={[
        {
          id: "check",
          label: t("settings.research.recheck"),
          onSelect: () => void check(c.id),
        },
        ...(c.id !== data.default_compute
          ? [
              {
                id: "default",
                label: t("settings.research.makeDefault"),
                onSelect: () => void save({ default_compute: c.id }),
              },
            ]
          : []),
        ...(c.kind === "ssh"
          ? [
              {
                id: "edit",
                label: t("settings.research.edit"),
                onSelect: () =>
                  setDraft({
                    id: c.id,
                    name: c.name,
                    host: c.host ?? "",
                    gpus: c.gpus ?? "",
                    remote_dir: c.remote_dir ?? "~/ora-research",
                  }),
              },
            ]
          : []),
      ]}
      trigger={(props) => (
        <IconButton
          {...props}
          size="sm"
          icon={MoreHorizontal}
          label={t("settings.research.more", { name: c.name })}
        />
      )}
    />
  );

  const line = (c: Compute, title: string, meta: string) => {
    const s = status(c);
    return (
      <>
        <div className={styles.rowText}>
          <span className={styles.rowTitle}>
            {title}
            {c.id === data.default_compute && (
              <span className={styles.badge}>
                {t("settings.research.default")}
              </span>
            )}
          </span>
          <span className={styles.rowMeta} title={s.detail || undefined}>
            <span className={styles.dot} data-tone={s.tone} aria-hidden />
            {[s.text, meta].filter(Boolean).join(" · ")}
          </span>
        </div>
        {actions(c)}
      </>
    );
  };

  return (
    <Section
      title={t(
        part === "tracker"
          ? "settings.research.tracker"
          : "settings.research.title",
      )}
    >
      {part !== "tracker" && (
        <>
          <div className={styles.list}>
            {computes
              .filter((c) => c.kind !== "ssh")
              .map((c) => (
                <div key={c.id} className={styles.row}>
                  {line(c, c.name, "")}
                </div>
              ))}
          </div>
          <div className={styles.listHead}>
            <h3 className={styles.subTitle}>
              {t("settings.research.sshTitle")}
            </h3>
            <Button
              size="sm"
              variant="secondary"
              icon={Plus}
              onClick={() =>
                setDraft({
                  name: "",
                  host: "",
                  gpus: "",
                  remote_dir: "~/ora-research",
                })
              }
            >
              {t("settings.research.addSsh")}
            </Button>
          </div>
          {rows.length === 0 ? (
            <p className={styles.settingHint}>
              {t("settings.research.sshEmpty")}
            </p>
          ) : (
            <div className={styles.list}>
              {rows.map((r) => (
                <div key={r.host} className={styles.row}>
                  <input
                    type="checkbox"
                    role="switch"
                    className={styles.switch}
                    checked={!!r.compute}
                    disabled={busy}
                    aria-label={t("settings.research.use", { name: r.host })}
                    onChange={() =>
                      r.compute ? disable(r.compute) : enabled(newSsh(r.host))
                    }
                  />
                  {r.compute ? (
                    line(
                      r.compute,
                      r.compute.name,
                      r.compute.name !== r.host ? r.host : r.meta,
                    )
                  ) : (
                    <div className={styles.rowText}>
                      <span className={styles.rowTitle}>{r.host}</span>
                      <span className={styles.rowMeta}>
                        {r.meta || t("settings.research.off")}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {part !== "tracker" &&
        computes
          .filter((c) => c.kind === "host")
          .map((c) => (
            <div key={`${c.id}-at-once`}>
              <h3 className={styles.subTitle}>
                {t("settings.research.concurrency", { name: c.name })}
              </h3>
              <div className={styles.setting}>
                <SegmentedControl
                  kind="radio"
                  size="sm"
                  label={t("settings.research.concurrency", { name: c.name })}
                  value={String(c.concurrency ?? 1)}
                  onChange={(n) =>
                    save({
                      computes: computes.map((x) =>
                        x.id === c.id ? { ...x, concurrency: Number(n) } : x,
                      ),
                    })
                  }
                  options={["1", "2", "3", "4"].map((n) => ({
                    value: n,
                    label: n,
                  }))}
                />
              </div>
            </div>
          ))}

      {part !== "environments" && (
        <>
          {!part && (
            <>
              <h3 className={styles.subTitle}>
                {t("settings.research.tracker")}
              </h3>
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
        title={t(
          draft?.id ? "settings.research.editSsh" : "settings.research.addSsh",
        )}
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
                const host = draft.host.trim();
                const name = draft.name.trim() || host;
                const dir = draft.remote_dir.trim();
                if (draft.id) {
                  const done = await save({
                    computes: computes.map((c) =>
                      c.id === draft.id
                        ? {
                            ...c,
                            name,
                            host,
                            gpus: draft.gpus.trim(),
                            remote_dir: dir || c.remote_dir,
                          }
                        : c,
                    ),
                  });
                  if (done) {
                    setDraft(null);
                    void check(draft.id);
                  }
                  return;
                }
                setDraft(null);
                await enabled(newSsh(host, name, draft.gpus.trim(), dir));
              }}
            >
              {t(
                draft?.id ? "settings.research.save" : "settings.research.add",
              )}
            </Button>
          </>
        }
      >
        {draft && (
          <div className={styles.column}>
            <TextField
              label={t("settings.research.host")}
              value={draft.host}
              placeholder="user@server"
              onChange={(e) => setDraft({ ...draft, host: e.target.value })}
            />
            <TextField
              label={t("settings.research.name")}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
            <TextField
              label="GPU"
              value={draft.gpus}
              placeholder="0"
              onChange={(e) => setDraft({ ...draft, gpus: e.target.value })}
            />
            <TextField
              label={t("settings.research.remoteDir")}
              value={draft.remote_dir}
              onChange={(e) =>
                setDraft({ ...draft, remote_dir: e.target.value })
              }
            />
          </div>
        )}
      </Dialog>
    </Section>
  );
}
