import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { Button, Dialog, IconButton, toast } from "../../ui";
import { ModelForm } from "../setup/ModelForm";
import {
  allowsLocal,
  announceModels,
  failure,
  readModels,
  removeModel,
  selectModel,
  testModel,
  type ModelRow,
  type ModelSettings,
} from "../setup/model-api";
import { ConfirmDialog, Section } from "./Section";
import styles from "./Settings.module.css";

const displayName = (row: ModelRow) => row.name || row.model;

function host(address: string): string {
  try {
    return new URL(address).host;
  } catch {
    return address;
  }
}

/** The models: the current one, the others (use, test, remove), and adding one with the setup's form. */
export function ModelsSection() {
  const i18n = useI18n();
  const { t } = i18n;
  const [settings, setSettings] = useState<ModelSettings | null>(null);
  const [loadError, setLoadError] = useState("");
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<ModelRow | null>(null);
  const [busy, setBusy] = useState("");

  const load = (signal?: AbortSignal) =>
    readModels(signal).then(
      (value) => {
        setSettings(value);
        setLoadError("");
      },
      (reason) => {
        if (!signal?.aborted)
          setLoadError(failure(reason, i18n, "settings.loadError"));
      },
    );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
    // Read once; later changes come back from the requests themselves.
  }, []);

  /** Runs one action on a model; the row shows it as busy until it is done. */
  async function act(
    row: ModelRow,
    work: () => Promise<ModelSettings | void>,
    done: string,
    fallback: Parameters<typeof failure>[2],
  ) {
    setBusy(row.id);
    try {
      const value = await work();
      if (value) {
        setSettings(value);
        announceModels();
      }
      toast.show({ tone: "success", message: done });
      return true;
    } catch (reason) {
      toast.show({ tone: "error", message: failure(reason, i18n, fallback) });
      return false;
    } finally {
      setBusy("");
    }
  }

  const models = settings?.models ?? [];
  return (
    <Section
      title={t("settings.models.title")}
      lead={t("settings.models.lead")}
      action={
        <Button size="sm" icon={Plus} onClick={() => setAdding(true)}>
          {t("settings.models.add")}
        </Button>
      }
    >
      {loadError ? (
        <p role="alert" className={styles.error}>
          {loadError}
        </p>
      ) : !settings ? (
        <p className={styles.muted}>{t("common.loading")}</p>
      ) : models.length === 0 ? (
        <p className={styles.muted}>{t("settings.models.empty")}</p>
      ) : (
        <ul className={styles.list} aria-label={t("settings.models.title")}>
          {models.map((row) => {
            const current = row.id === settings.active_id;
            const name = displayName(row);
            return (
              <li key={row.id} className={styles.row}>
                <div className={styles.rowText}>
                  <span className={styles.rowTitle}>
                    <span>{name}</span>
                    {current && (
                      <span className={`${styles.badge} ${styles.current}`}>
                        {t("settings.models.current")}
                      </span>
                    )}
                    {row.shared && (
                      <span className={styles.badge}>
                        {row.badge || t("settings.models.shared")}
                      </span>
                    )}
                  </span>
                  <span className={styles.rowMeta}>
                    {[
                      row.name && row.name !== row.model ? row.model : "",
                      host(row.base_url),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
                <div className={styles.rowActions}>
                  {!current && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!!busy}
                      onClick={() =>
                        void act(
                          row,
                          () => selectModel(row.id),
                          t("settings.models.selected", { name }),
                          "settings.models.selectError",
                        )
                      }
                      aria-label={t("settings.models.useNamed", { name })}
                    >
                      {t("settings.models.use")}
                    </Button>
                  )}
                  {!row.shared && (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={busy === row.id && !removing}
                        disabled={!!busy}
                        aria-label={t("settings.models.testNamed", { name })}
                        onClick={() =>
                          void act(
                            row,
                            async () => {
                              await testModel(row.id);
                            },
                            t("settings.models.testOk", { name }),
                            "model.error.test",
                          )
                        }
                      >
                        {t("settings.models.test")}
                      </Button>
                      <IconButton
                        size="sm"
                        icon={Trash2}
                        label={t("settings.models.remove", { name })}
                        disabled={!!busy}
                        onClick={() => setRemoving(row)}
                      />
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Dialog
        open={adding}
        onClose={() => setAdding(false)}
        title={t("settings.models.dialog")}
        description={t("settings.models.dialogLead")}
      >
        {adding && (
          <ModelForm
            local={allowsLocal(settings)}
            onConnected={({ settings: next, model }) => {
              setSettings(next);
              setAdding(false);
              toast.show({
                tone: "success",
                message: t("settings.models.added", { name: model }),
              });
            }}
          />
        )}
      </Dialog>
      <ConfirmDialog
        open={!!removing}
        title={t("settings.models.removeTitle")}
        description={t("settings.models.removeBody", {
          name: removing ? displayName(removing) : "",
        })}
        confirm={t("settings.models.removeConfirm")}
        busy={!!removing && busy === removing.id}
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return;
          const row = removing;
          const ok = await act(
            row,
            () => removeModel(row.id),
            t("settings.models.removed", { name: displayName(row) }),
            "settings.models.removeError",
          );
          if (ok) setRemoving(null);
        }}
      />
    </Section>
  );
}
