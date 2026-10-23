import { LineChart, MoreHorizontal, Pencil } from "lucide-react";
import { useEffect, useId, useState } from "react";
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
  readResearchSettings,
  saveResearchSettings,
  type ResearchSettings,
} from "../research/research-api";
import { CustomizeHeader } from "./CustomizeHeader";
import styles from "./CustomizeScreen.module.css";
import settings from "../settings/Settings.module.css";

const providers = [
  { id: "swanlab", name: "SwanLab" },
  { id: "wandb", name: "W&B" },
] as const;

export function TrackingSection() {
  const { t } = useI18n();
  const [data, setData] = useState<ResearchSettings | null>(null);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(false);
  const formId = useId();
  const [mode, setMode] = useState<"local" | "cloud">("local");
  const [project, setProject] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [reads, setReads] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setError(false);
    readResearchSettings().then(
      (value) => {
        if (!cancelled) setData(value);
      },
      () => {
        if (!cancelled) setError(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [reads]);

  const save = async (
    tracker: Parameters<typeof saveResearchSettings>[0]["tracker"],
  ) => {
    setBusy(true);
    try {
      setData(await saveResearchSettings({ tracker }));
      return true;
    } catch (error) {
      toast.show({
        tone: "error",
        message: error instanceof Error ? error.message : String(error),
      });
      return false;
    } finally {
      setBusy(false);
    }
  };
  const tracker = data?.tracker;
  const edit = () => {
    if (!tracker) return;
    setMode(tracker.mode);
    setProject(tracker.project);
    setKey("");
    setEditing(true);
  };
  const close = () => {
    if (busy) return;
    setEditing(false);
    setKey("");
  };
  const rows = providers.filter((p) =>
    p.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <>
      <CustomizeHeader
        title={t("customize.tracking")}
        query={query}
        onQuery={setQuery}
      />
      {error ? (
        <div role="alert">
          <p>{t("settings.loadError")}</p>
          <Button onClick={() => setReads((n) => n + 1)}>
            {t("common.retry")}
          </Button>
        </div>
      ) : !tracker ? (
        <div
          className={styles.skeleton}
          role="status"
          aria-label={t("common.loading")}
        />
      ) : (
        <ul className={styles.list}>
          {rows.map((provider) => {
            const enabled = tracker.kind === provider.id;
            return (
              <li key={provider.id} className={styles.row}>
                <LineChart className={styles.icon} size={22} aria-hidden />
                <div className={styles.rowText}>
                  <span className={styles.name}>{provider.name}</span>
                  <span className={styles.status}>
                    {enabled
                      ? t(
                          tracker.mode === "cloud"
                            ? "settings.research.cloud"
                            : "settings.research.local",
                        )
                      : t("settings.research.off")}
                  </span>
                </div>
                <input
                  type="checkbox"
                  role="switch"
                  className={settings.switch}
                  checked={enabled}
                  disabled={busy}
                  aria-label={provider.name}
                  onChange={async () => {
                    if (await save({ kind: enabled ? "none" : provider.id })) {
                      setKey("");
                      setMode(tracker.mode);
                      setProject(tracker.project);
                      setEditing(!enabled);
                    }
                  }}
                />
                {enabled && (
                  <Menu
                    label={t("customize.more", { name: provider.name })}
                    placement={{ side: "bottom", align: "end" }}
                    items={[
                      {
                        id: "edit",
                        icon: Pencil,
                        label: t("settings.research.edit"),
                        onSelect: edit,
                      },
                    ]}
                    trigger={(props) => (
                      <IconButton
                        {...props}
                        icon={MoreHorizontal}
                        label={t("customize.more", { name: provider.name })}
                      />
                    )}
                  />
                )}
              </li>
            );
          })}
          {!rows.length && (
            <li className={styles.empty}>{t("customize.empty")}</li>
          )}
        </ul>
      )}
      <Dialog
        open={editing && !!tracker && tracker.kind !== "none"}
        onClose={close}
        title={
          providers.find((p) => p.id === tracker?.kind)?.name ||
          t("customize.tracking")
        }
        footer={
          <>
            <Button variant="ghost" disabled={busy} onClick={close}>
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              form={formId}
              variant="primary"
              loading={busy}
            >
              {t("settings.research.save")}
            </Button>
          </>
        }
      >
        {tracker && (
          <form
            id={formId}
            className={styles.fields}
            onSubmit={async (event) => {
              event.preventDefault();
              if (
                await save({
                  mode,
                  project: project.trim(),
                  ...(mode === "cloud" && key.trim()
                    ? { api_key: key.trim() }
                    : {}),
                })
              ) {
                setEditing(false);
                setKey("");
              }
            }}
          >
            <SegmentedControl
              kind="radio"
              label={t("settings.research.mode")}
              value={mode}
              onChange={(value) => !busy && setMode(value)}
              options={[
                { value: "local", label: t("settings.research.local") },
                { value: "cloud", label: t("settings.research.cloud") },
              ]}
            />
            <TextField
              label={t("settings.research.project")}
              value={project}
              disabled={busy}
              onChange={(event) => setProject(event.target.value)}
            />
            {mode === "cloud" && (
              <TextField
                label={t("settings.research.key")}
                type="password"
                autoComplete="off"
                value={key}
                disabled={busy}
                onChange={(event) => setKey(event.target.value)}
              />
            )}
            {mode === "cloud" && tracker.has_key && (
              <span className={styles.status}>{t("customize.keySaved")}</span>
            )}
          </form>
        )}
      </Dialog>
    </>
  );
}
