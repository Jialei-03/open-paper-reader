import { Check, Plug } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { Button, SegmentedControl, TextField } from "../../ui";
import styles from "./ModelForm.module.css";
import { ModelNamePicker } from "./ModelNamePicker";
import {
  LOCAL_APPS,
  LOCAL_KEY,
  connectModel,
  failure,
  listModels,
  type LocalApp,
  type ModelDraft,
  type ModelSettings,
  type Protocol,
} from "./model-api";

type Kind = "key" | "local";

export interface ModelFormProps {
  /** Whether a model on this computer may be chosen (the local edition). */
  local: boolean;
  /** The model answered the test and is now the current one. */
  onConnected(result: {
    id: string;
    model: string;
    settings: ModelSettings;
  }): void;
  /** Once connected, the form stays filled in and stops taking changes. */
  connected?: boolean;
  compact?: boolean;
}

/**
 * The one way a model is added: how to reach it (a key for a service, or an app
 * on this computer), its address and name, then "Test connection", which only
 * keeps the model when it answers.
 */
export function ModelForm({
  local,
  onConnected,
  connected = false,
  compact = false,
}: ModelFormProps) {
  const i18n = useI18n();
  const { t, tn } = i18n;
  const [kind, setKind] = useState<Kind>("key");
  const [app, setApp] = useState<LocalApp>("ollama");
  const [draft, setDraft] = useState<ModelDraft>({
    protocol: "openai",
    base_url: "",
    model: "",
    api_key: "",
  });
  const [models, setModels] = useState<string[] | null>(null);
  const [listing, setListing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");
  const [listError, setListError] = useState("");
  // A newer request makes the answer of an older one stale.
  const request = useRef(0);

  const change = (values: Partial<ModelDraft>, service = false) => {
    setDraft((old) => ({ ...old, ...values }));
    setError("");
    if (service) {
      request.current++;
      setModels(null);
      setListError("");
      setListing(false);
    }
  };

  const chooseKind = (next: Kind) => {
    setKind(next);
    change(
      next === "local"
        ? { protocol: "openai", base_url: LOCAL_APPS[app], api_key: "" }
        : { base_url: "", api_key: "" },
      true,
    );
  };

  const chooseApp = (next: LocalApp) => {
    setApp(next);
    change({ base_url: LOCAL_APPS[next] }, true);
  };

  /** What is sent: a local app gets the stand-in key it ignores. */
  const outgoing = (): ModelDraft =>
    kind === "local" && !draft.api_key
      ? { ...draft, api_key: LOCAL_KEY }
      : draft;

  const fetchModels = async () => {
    const id = ++request.current;
    setListing(true);
    setListError("");
    try {
      const names = await listModels(outgoing());
      if (id !== request.current) return;
      setModels(names);
      if (!draft.model && names[0]) change({ model: names[0] });
    } catch (reason) {
      if (id === request.current)
        setListError(failure(reason, i18n, "model.error.list"));
    } finally {
      if (id === request.current) setListing(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (testing || connected) return;
    if (!draft.base_url.trim() || !draft.model.trim()) {
      setError(t("model.error.required"));
      return;
    }
    if (kind === "key" && !draft.api_key) {
      setError(t("model.error.key"));
      return;
    }
    setTesting(true);
    setError("");
    try {
      const result = await connectModel(outgoing());
      onConnected({ ...result, model: draft.model.trim() });
    } catch (reason) {
      setError(failure(reason, i18n, "model.error.test"));
    } finally {
      setTesting(false);
    }
  };

  const locked = connected || testing;
  const placeholder =
    draft.protocol === "anthropic"
      ? "https://api.anthropic.com"
      : "https://api.openai.com/v1";

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      {local && (
        <div className={styles.group}>
          <span className={styles.caption}>{t("model.kind.label")}</span>
          <SegmentedControl
            kind="radio"
            label={t("model.kind.label")}
            value={kind}
            onChange={(next) => !locked && chooseKind(next)}
            options={[
              { value: "key", label: t("model.kind.key") },
              { value: "local", label: t("model.kind.local") },
            ]}
          />
        </div>
      )}
      {kind === "key" ? (
        <div className={styles.group}>
          <span className={styles.caption}>{t("model.protocol.label")}</span>
          <SegmentedControl
            kind="radio"
            label={t("model.protocol.label")}
            value={draft.protocol}
            onChange={(protocol: Protocol) =>
              !locked && change({ protocol }, true)
            }
            options={[
              { value: "openai", label: t("model.protocol.openai") },
              { value: "anthropic", label: t("model.protocol.anthropic") },
            ]}
          />
        </div>
      ) : (
        <div className={styles.group}>
          <span className={styles.caption}>{t("model.local.label")}</span>
          <SegmentedControl
            kind="radio"
            label={t("model.local.label")}
            value={app}
            onChange={(next) => !locked && chooseApp(next)}
            options={[
              { value: "ollama", label: t("model.local.ollama") },
              { value: "lmstudio", label: t("model.local.lmstudio") },
            ]}
          />
          {!compact && (
            <p className={styles.hint}>
              {t("model.local.hint", {
                app: t(
                  app === "ollama"
                    ? "model.local.ollama"
                    : "model.local.lmstudio",
                ),
              })}
            </p>
          )}
        </div>
      )}
      <TextField
        label={t("model.baseUrl")}
        type="url"
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        value={draft.base_url}
        placeholder={
          compact ? undefined : kind === "local" ? LOCAL_APPS[app] : placeholder
        }
        description={
          !compact && kind === "key" ? t("model.baseUrl.hint") : undefined
        }
        disabled={locked}
        onChange={(event) => change({ base_url: event.target.value }, true)}
      />
      {kind === "key" && (
        <TextField
          label={t("model.key")}
          type="password"
          autoComplete="new-password"
          spellCheck={false}
          value={draft.api_key}
          placeholder={compact ? undefined : t("model.key.placeholder")}
          description={compact ? undefined : t("model.key.hint")}
          disabled={locked}
          onChange={(event) => change({ api_key: event.target.value }, true)}
        />
      )}
      <div className={styles.stack}>
        <ModelNamePicker
          label={t("model.name")}
          models={models}
          value={draft.model}
          placeholder={compact ? undefined : t("model.name.placeholder")}
          disabled={locked}
          error={listError || undefined}
          description={
            models && !listError
              ? tn("model.fetched", models.length)
              : undefined
          }
          onChange={(model) => change({ model })}
        />
        <div>
          <Button
            size="sm"
            variant="ghost"
            loading={listing}
            disabled={
              locked ||
              !draft.base_url.trim() ||
              (kind === "key" && !draft.api_key)
            }
            onClick={() => void fetchModels()}
          >
            {t("model.fetch")}
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <div className={styles.actions}>
        {connected ? (
          <p role="status" className={styles.success}>
            <Check size={14} aria-hidden="true" />
            {t("model.connected", { model: draft.model.trim() })}
          </p>
        ) : (
          <Button
            type="submit"
            variant="secondary"
            icon={Plug}
            loading={testing}
          >
            {testing ? t("model.testing") : t("model.test")}
          </Button>
        )}
      </div>
    </form>
  );
}
