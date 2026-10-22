import { Monitor, Server, MoreHorizontal, Plus } from "lucide-react";
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
import { CustomizeHeader } from "./CustomizeHeader";
import layout from "./CustomizeScreen.module.css";
import styles from "../settings/Settings.module.css";

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

export function MachinesSection() {
  const { t } = useI18n();
  const [data, setData] = useState<ResearchSettings | null>(null);
  const [hosts, setHosts] = useState<SshHost[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [checking, setChecking] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState("");
  const [error, setError] = useState(false);
  const [reads, setReads] = useState(0);
  const [concurrency, setConcurrency] = useState<Compute | null>(null);
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
    let cancelled = false;
    setError(false);
    readResearchSettings().then(
      (d) => {
        if (cancelled) return;
        setData(d);
        // Whether each environment can be reached now, checked on opening.
        for (const c of d.computes) if (c.kind !== "docker") void check(c.id);
      },
      () => {
        if (!cancelled) setError(true);
      },
    );
    sshHosts().then(
      (value) => {
        if (!cancelled) setHosts(value);
      },
      () => {
        if (!cancelled) setHosts([]);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [reads]);

  const save = async (body: Parameters<typeof saveResearchSettings>[0]) => {
    setBusy(true);
    try {
      const next = await saveResearchSettings(body);
      setData((current) => ({
        ...next,
        states: next.states ?? current?.states ?? {},
      }));
      return true;
    } catch (error) {
      fail(error);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const header = (
    <CustomizeHeader
      title={t("customize.machines")}
      query={query}
      onQuery={setQuery}
      action={
        <Button
          size="sm"
          icon={Plus}
          disabled={!data}
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
      }
    />
  );
  if (!data || error)
    return (
      <>
        {header}
        {error ? (
          <div role="alert">
            <p>{t("settings.loadError")}</p>
            <Button onClick={() => setReads((n) => n + 1)}>
              {t("common.retry")}
            </Button>
          </div>
        ) : (
          <p className={layout.status}>{t("common.loading")}</p>
        )}
      </>
    );

  const computes = data.computes;
  const enabled = async (item: Compute) => {
    const done = await save({ computes: [...computes, item] });
    if (done) void check(item.id);
    return done;
  };
  const disable = (c: Compute) =>
    save({
      computes: computes.filter((x) => x.id !== c.id),
      default_compute:
        data.default_compute === c.id ? "host" : data.default_compute,
    });
  const newSsh = (host: string, name = host, gpus = "", dir = ""): Compute => {
    let id = slug(name);
    let suffix = 2;
    while (computes.some((c) => c.id === id))
      id = `${slug(name).slice(0, 32)}-${suffix++}`;
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
        ...(c.kind === "host"
          ? [
              {
                id: "concurrency",
                label: t("settings.research.concurrency", { name: c.name }),
                onSelect: () => setConcurrency(c),
              },
            ]
          : []),
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
          disabled={busy}
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
      </>
    );
  };

  const q = query.trim().toLowerCase();
  const localRows = computes.filter(
    (c) => c.kind !== "ssh" && c.name.toLowerCase().includes(q),
  );
  const sshRows = rows.filter((r) =>
    `${r.compute?.name || ""} ${r.host} ${r.meta}`.toLowerCase().includes(q),
  );
  return (
    <>
      {header}
      <ul className={layout.list}>
        {localRows.map((c) => (
          <li key={c.id} className={layout.row}>
            <Monitor className={layout.icon} size={22} aria-hidden />
            {line(c, c.name, "")}
            {actions(c)}
          </li>
        ))}
        {sshRows.map((r) => (
          <li key={r.compute?.id || r.host} className={layout.row}>
            <Server className={layout.icon} size={22} aria-hidden />
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
                  <span className={styles.dot} data-tone="off" aria-hidden />
                  {t("settings.research.off")}
                </span>
              </div>
            )}
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
            {r.compute && actions(r.compute)}
          </li>
        ))}
        {!localRows.length && !sshRows.length && (
          <li className={layout.empty}>{t("customize.empty")}</li>
        )}
      </ul>
      <Dialog
        open={!!concurrency}
        onClose={() => setConcurrency(null)}
        title={t("settings.research.concurrency", {
          name: concurrency?.name || "",
        })}
      >
        {concurrency && (
          <SegmentedControl
            kind="radio"
            size="sm"
            label={t("settings.research.concurrency", {
              name: concurrency.name,
            })}
            value={String(
              computes.find((c) => c.id === concurrency.id)?.concurrency ?? 1,
            )}
            onChange={(n) =>
              save({
                computes: computes.map((c) =>
                  c.id === concurrency.id
                    ? { ...c, concurrency: Number(n) }
                    : c,
                ),
              })
            }
            options={["1", "2", "3", "4"].map((n) => ({ value: n, label: n }))}
          />
        )}
      </Dialog>
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
                            gpus: "",
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
                if (await enabled(newSsh(host, name, "", dir))) setDraft(null);
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
              onChange={(e) => setDraft({ ...draft, host: e.target.value })}
            />
            <TextField
              label={t("settings.research.name")}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
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
    </>
  );
}
