import { BookOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/i18n";
import { followLink } from "../../reader/route";
import { Button, Dialog, toast } from "../../ui";
import { readModels, type ModelRow } from "../setup/model-api";
import { PlaybookPanel } from "./PlaybookPanel";
import {
  listProjects,
  readResearchSettings,
  startProject,
  type Compute,
  type ResearchProject,
} from "./research-api";
import { Composer } from "./talk/Composer";
import { ComputePicker, ModelPicker } from "./talk/Pickers";
import styles from "./talk/Talk.module.css";

const RECENT = 8;
const STARTERS: MessageKey[] = [
  "research.home.starter.mnist",
  "research.home.starter.ablation",
  "research.home.starter.replicate",
];

/** Whether the project waits for the researcher, is at work, or is over. */
export function projectState(p: ResearchProject): {
  key: MessageKey;
  you: boolean;
  live: boolean;
} {
  if (p.status === "finished")
    return {
      key: `research.end.${p.end_reason || "stopped"}` as MessageKey,
      you: false,
      live: false,
    };
  if (p.status === "waiting")
    return { key: "research.state.decide", you: true, live: false };
  if (p.status === "paused")
    return { key: "research.status.paused", you: false, live: false };
  if (p.stage === "scoping")
    return { key: "research.state.talking", you: false, live: true };
  return {
    key: `research.stage.${p.stage}` as MessageKey,
    you: false,
    live: true,
  };
}

/**
 * Where research begins: a question in the researcher's own words, and the
 * projects already under way. Nothing is filled in here; the plan is talked
 * through with the advisor on the next page.
 */
export function ResearchHome({ go }: { go(hash: string): void }) {
  const { t, locale } = useI18n();
  const [projects, setProjects] = useState<ResearchProject[]>([]);
  const [models, setModels] = useState<ModelRow[]>([]);
  const [modelId, setModelId] = useState("");
  const [computes, setComputes] = useState<Compute[]>([]);
  const [computeId, setComputeId] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [book, setBook] = useState(false);
  const [picked, setPicked] = useState(0);
  const [all, setAll] = useState(false);

  useEffect(() => {
    listProjects().then(setProjects, () => setProjects([]));
    readModels().then(
      (s) => {
        setModels(s.models);
        setModelId(s.active_id || s.models[0]?.id || "");
      },
      () => undefined,
    );
    readResearchSettings().then(
      (s) => {
        setComputes(s.computes);
        setComputeId(s.default_compute);
      },
      () => undefined,
    );
  }, []);

  const start = async () => {
    if (!modelId) {
      toast.show({ message: t("research.home.noModel"), tone: "error" });
      return;
    }
    setBusy(true);
    try {
      const project = await startProject({
        message: text.trim(),
        model_config_id: modelId,
        compute_id: computeId || undefined,
      });
      go(`research/${project.id}`);
    } catch (error) {
      toast.show({
        message: t("research.createFailed", {
          reason: error instanceof Error ? error.message : String(error),
        }),
        tone: "error",
      });
      setBusy(false);
    }
  };

  const when = (stamp: string) =>
    new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(stamp));

  return (
    <div className={styles.home}>
      <div className={styles.homeTools}>
        <Button
          size="sm"
          variant="ghost"
          icon={BookOpen}
          onClick={() => setBook(true)}
        >
          {t("research.home.playbook")}
        </Button>
      </div>
      <div className={styles.homeInner}>
        <h1 className={styles.greeting}>{t("research.home.greeting")}</h1>
        <p className={styles.greetingSub}>{t("research.home.sub")}</p>
        <Composer
          value={text}
          onChange={setText}
          onSend={start}
          busy={busy}
          autoFocus
          focusKey={picked}
          label={t("research.home.label")}
          placeholder={t("research.home.placeholder")}
          sendLabel={t("research.home.send")}
          tools={
            <>
              <ModelPicker
                models={models}
                value={modelId}
                onChange={setModelId}
                label={t("research.home.model")}
              />
              {computes.length > 1 && (
                <ComputePicker
                  computes={computes}
                  value={computeId}
                  onChange={setComputeId}
                  label={t("research.home.compute")}
                />
              )}
            </>
          }
        />
        {!text && (
          <div className={styles.starters}>
            {STARTERS.map((key) => (
              <button
                key={key}
                type="button"
                className={styles.starter}
                onClick={() => {
                  setText(t(key));
                  setPicked((n) => n + 1);
                }}
              >
                {t(key)}
              </button>
            ))}
          </div>
        )}
        {projects.length > 0 && (
          <section className={styles.recent} aria-labelledby="recent-title">
            <h2 id="recent-title" className={styles.recentTitle}>
              {t("research.home.recent")}
            </h2>
            {(all ? projects : projects.slice(0, RECENT)).map((p) => {
              const state = projectState(p);
              return (
                <a
                  key={p.id}
                  href={`#research/${p.id}`}
                  className={styles.recentRow}
                  onClick={followLink(go, `research/${p.id}`)}
                >
                  <span className={styles.recentQuestion}>{p.question}</span>
                  <span className={styles.recentMeta}>
                    {when(p.updated_at)}
                  </span>
                  <span className={styles.recentState}>
                    <span
                      className={styles.dot}
                      data-you={state.you || undefined}
                      data-live={state.live || undefined}
                    />
                    <span className={state.you ? styles.yourTurn : undefined}>
                      {t(state.key)}
                    </span>
                  </span>
                </a>
              );
            })}
            {!all && projects.length > RECENT && (
              <Button size="sm" variant="ghost" onClick={() => setAll(true)}>
                {t("research.home.all", { n: projects.length })}
              </Button>
            )}
          </section>
        )}
      </div>
      <Dialog
        open={book}
        onClose={() => setBook(false)}
        title={t("research.home.playbook")}
      >
        <PlaybookPanel />
      </Dialog>
    </div>
  );
}
