import { Check, ChevronDown, Download } from "lucide-react";
import { useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import {
  Button,
  Dialog,
  Menu,
  SegmentedControl,
  TextField,
  type MenuEntry,
} from "../../ui";
import {
  addModel,
  failure,
  listModels,
  LOCAL_KEY,
  readModels,
  removeModel,
  testModel,
  type ModelDraft,
  type ModelSettings,
  type Protocol,
} from "../setup/model-api";
import {
  CUSTOM,
  PRESETS,
  hostOf,
  isOwned,
  searchModels,
  type Preset,
} from "./providers";
import styles from "./ImportModels.module.css";

export interface ImportModelsProps {
  open: boolean;
  onClose(): void;
  settings: ModelSettings | null;
  /** Models were added: the settings as they are now. */
  onImported(settings: ModelSettings, count: number): void;
  local: boolean;
}

/**
 * Brings in a provider's models in one go: choose the provider (or a custom
 * address), give the key, fetch the list, tick the ones wanted and add them.
 * Each becomes its own model sharing the key; the first is tested before the
 * rest are added, and is taken off again if it does not answer.
 */
export function ImportModels({
  open,
  onClose,
  settings,
  onImported,
  local,
}: ImportModelsProps) {
  const i18n = useI18n();
  const { t, tn } = i18n;
  const allowed = settings?.allowed_hosts;
  const presets = PRESETS.filter(
    (preset) =>
      (!preset.local || local) &&
      (preset.local || !allowed || allowed.includes(hostOf(preset.base_url))),
  );
  const [preset, setPreset] = useState<string>(presets[0]?.id ?? CUSTOM);
  const current: Preset | undefined = presets.find((p) => p.id === preset);
  const [protocol, setProtocol] = useState<Protocol>(
    current?.protocol ?? "openai",
  );
  const [baseUrl, setBaseUrl] = useState(current?.base_url ?? "");
  const [apiKey, setApiKey] = useState("");
  const [names, setNames] = useState<string[] | null>(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [listing, setListing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(0);

  const localPreset = current?.local === true;
  const draft = (): ModelDraft => ({
    protocol,
    base_url: baseUrl,
    model: "",
    api_key: localPreset && !apiKey ? LOCAL_KEY : apiKey,
  });
  /** A new address or key means the old list no longer applies. */
  const reset = () => {
    request.current++;
    setNames(null);
    setPicked([]);
    setQuery("");
    setError("");
    setListing(false);
  };

  const choose = (id: string) => {
    const next = presets.find((p) => p.id === id);
    setPreset(id);
    if (next) {
      setProtocol(next.protocol);
      setBaseUrl(next.base_url);
    } else setBaseUrl("");
    setApiKey("");
    reset();
  };

  const fetchList = async () => {
    if (!baseUrl.trim() || (!localPreset && !apiKey)) {
      setError(t("settings.import.required"));
      return;
    }
    const id = ++request.current;
    setListing(true);
    setError("");
    try {
      const list = await listModels(draft());
      if (id !== request.current) return;
      setNames(list);
      setPicked([]);
    } catch (reason) {
      if (id === request.current)
        setError(failure(reason, i18n, "settings.import.listError"));
    } finally {
      if (id === request.current) setListing(false);
    }
  };

  const shown = searchModels(names ?? [], query);
  const owned = (name: string) =>
    isOwned(settings?.models ?? [], baseUrl, name);
  const choosable = shown.filter((name) => !owned(name));
  const toggle = (name: string) =>
    setPicked((old) =>
      old.includes(name) ? old.filter((n) => n !== name) : [...old, name],
    );

  const submit = async () => {
    if (adding || picked.length === 0) return;
    setAdding(true);
    setError("");
    let added = 0;
    let latest = settings;
    let known = new Set((settings?.models ?? []).map((row) => row.id));
    try {
      for (const name of picked) {
        let next: ModelSettings;
        try {
          next = await addModel({ ...draft(), model: name });
        } catch (reason) {
          if (added === 0) throw reason;
          setError(
            t("settings.import.partial", {
              done: added,
              name,
              reason: failure(reason, i18n, "model.error.test"),
            }),
          );
          break;
        }
        const row = [...next.models]
          .reverse()
          .find((model) => !model.shared && !known.has(model.id));
        if (row) known.add(row.id);
        // The first model proves the address and key; if it does not answer, nothing stays.
        if (added === 0 && row) {
          try {
            await testModel(row.id);
          } catch {
            await removeModel(row.id).catch(() => undefined);
            setError(t("settings.import.testFailed"));
            return;
          }
        }
        latest = next;
        added++;
      }
      if (added > 0) {
        latest = await readModels().catch(() => latest);
        onImported(latest!, added);
        if (!picked.length || added === picked.length) {
          close();
        } else {
          setPicked([]);
          setNames((old) => old);
        }
      }
    } catch (reason) {
      setError(failure(reason, i18n, "model.error.test"));
    } finally {
      setAdding(false);
    }
  };

  const close = () => {
    if (adding) return;
    setApiKey("");
    reset();
    onClose();
  };

  const providerItems: MenuEntry[] = [
    ...presets.map((p) => ({
      id: p.id,
      label: p.label,
      icon: p.id === preset ? Check : undefined,
      onSelect: () => choose(p.id),
    })),
    {
      id: CUSTOM,
      label: t("settings.import.custom"),
      icon: preset === CUSTOM ? Check : undefined,
      onSelect: () => choose(CUSTOM),
    },
  ];

  return (
    <Dialog
      open={open}
      onClose={close}
      title={t("settings.import.title")}
      description={t("settings.import.lead")}
      size="lg"
      footer={
        names && (
          <>
            <span className={styles.count} role="status">
              {tn("settings.import.selected", picked.length)}
            </span>
            <Button
              variant="primary"
              icon={Download}
              loading={adding}
              disabled={picked.length === 0}
              onClick={() => void submit()}
            >
              {adding
                ? t("settings.import.adding")
                : tn("settings.import.add", picked.length)}
            </Button>
          </>
        )
      }
    >
      <div className={styles.form}>
        <div className={styles.field}>
          <span className={styles.caption}>
            {t("settings.import.provider")}
          </span>
          <Menu
            label={t("settings.import.provider")}
            items={providerItems}
            trigger={(props) => (
              <Button {...props} size="sm" disabled={adding}>
                {current?.label ?? t("settings.import.custom")}
                <ChevronDown size={14} aria-hidden="true" />
              </Button>
            )}
          />
          {localPreset && (
            <p className={styles.hint}>
              {t("settings.import.localHint", { app: current!.label })}
            </p>
          )}
        </div>
        {preset === CUSTOM && (
          <div className={styles.field}>
            <span className={styles.caption}>
              {t("settings.import.protocol")}
            </span>
            <SegmentedControl
              kind="radio"
              label={t("settings.import.protocol")}
              value={protocol}
              onChange={(next: Protocol) => {
                setProtocol(next);
                reset();
              }}
              options={[
                { value: "openai", label: t("model.protocol.openai") },
                { value: "anthropic", label: t("model.protocol.anthropic") },
              ]}
            />
          </div>
        )}
        <TextField
          label={t("settings.import.baseUrl")}
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={baseUrl}
          placeholder="https://api.example.com/v1"
          disabled={adding}
          onChange={(event) => {
            setBaseUrl(event.target.value);
            reset();
          }}
        />
        {!localPreset && (
          <TextField
            label={t("settings.import.key")}
            type="password"
            autoComplete="new-password"
            spellCheck={false}
            value={apiKey}
            description={t("settings.import.keyHint")}
            disabled={adding}
            onChange={(event) => {
              setApiKey(event.target.value);
              reset();
            }}
          />
        )}
        <div>
          <Button
            size="sm"
            variant="secondary"
            loading={listing}
            disabled={adding}
            onClick={() => void fetchList()}
          >
            {t("settings.import.fetch")}
          </Button>
        </div>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        {names && (
          <div className={styles.picker}>
            <p className={styles.hint}>
              {tn("settings.import.found", names.length)}
            </p>
            <TextField
              label={t("settings.import.search")}
              hideLabel
              placeholder={t("settings.import.search")}
              type="search"
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <div className={styles.bulk}>
              <Button
                size="sm"
                variant="ghost"
                disabled={choosable.length === 0 || adding}
                onClick={() =>
                  setPicked((old) => [...new Set([...old, ...choosable])])
                }
              >
                {t("settings.import.all")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={picked.length === 0 || adding}
                onClick={() => setPicked([])}
              >
                {t("settings.import.clear")}
              </Button>
            </div>
            {shown.length === 0 ? (
              <p className={styles.hint}>{t("settings.import.none")}</p>
            ) : (
              <ul
                className={styles.list}
                aria-label={t("settings.import.list")}
              >
                {shown.map((name) => {
                  const have = owned(name);
                  return (
                    <li key={name}>
                      <label className={styles.item}>
                        <input
                          type="checkbox"
                          checked={have || picked.includes(name)}
                          disabled={have || adding}
                          onChange={() => toggle(name)}
                        />
                        <span className={styles.itemName}>{name}</span>
                        {have && (
                          <span className={styles.owned}>
                            {t("settings.import.owned")}
                          </span>
                        )}
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
