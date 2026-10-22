import { LineChart, MoreHorizontal } from "lucide-react";
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
        <p className={styles.status}>{t("common.loading")}</p>
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
                        label: t("settings.research.edit"),
                        onSelect: () => setEditing(true),
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
        onClose={() => {
          setEditing(false);
          setKey("");
        }}
        title={
          providers.find((p) => p.id === tracker?.kind)?.name ||
          t("customize.tracking")
        }
      >
        {tracker && (
          <div className={styles.fields}>
            <SegmentedControl
              kind="radio"
              size="sm"
              label={t("settings.research.mode")}
              value={tracker.mode}
              onChange={(mode) => {
                if (!busy) void save({ mode });
              }}
              options={[
                { value: "local", label: t("settings.research.local") },
                { value: "cloud", label: t("settings.research.cloud") },
              ]}
            />
            <TextField
              key={tracker.kind}
              label={t("settings.research.project")}
              defaultValue={tracker.project}
              disabled={busy}
              onBlur={(event) => {
                if (event.target.value.trim() !== tracker.project)
                  void save({ project: event.target.value.trim() });
              }}
            />
            {tracker.mode === "cloud" && (
              <form
                className={styles.fields}
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (key.trim() && (await save({ api_key: key.trim() })))
                    setKey("");
                }}
              >
                <TextField
                  label={t("settings.research.key")}
                  type="password"
                  autoComplete="off"
                  value={key}
                  onChange={(event) => setKey(event.target.value)}
                />
                {tracker.has_key && (
                  <span className={styles.status}>
                    {t("customize.keySaved")}
                  </span>
                )}
                <Button type="submit" size="sm" disabled={!key.trim() || busy}>
                  {t("settings.research.save")}
                </Button>
              </form>
            )}
          </div>
        )}
      </Dialog>
    </>
  );
}
