import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, send, type Paper, type SourceFile } from "../../../api";
import { useI18n } from "../../../i18n/I18nProvider";
import {
  resolveModel,
  useTranslationSettings,
} from "../useTranslationSettings";
import {
  defaultEngine,
  ENGINES,
  isActive,
  isArxivVersion,
  layoutState,
  lacksSource,
  keptJob,
  pickJob,
  readChoice,
  writeChoice,
  type Engine,
  type LayoutJob,
  type LayoutState,
} from "./job";

/** One of the two ways to translate the whole paper, as the reader shows it. */
export interface EngineView {
  engine: Engine;
  /** The job that matters for this method (see `pickJob`); `null` when none was ever made. */
  job: LayoutJob | null;
  state: LayoutState;
  /** The translated PDF this method made, once its job has completed. */
  file: SourceFile | null;
  /** The paper can be translated this way at all (LaTeX needs an arXiv paper of a fixed version). */
  supported: boolean;
  /** The service can do it now (the TeX engine, or BabelDOC, is there). */
  available: boolean;
  /** arXiv has no LaTeX source for this version: trying again cannot help. */
  noSource: boolean;
}

/** The translation of a paper's PDF by either method, as the reader's parts share it. */
export interface Layout {
  /** Both methods; they run and keep their results apart. */
  engines: Record<Engine, EngineView>;
  /** The method whose result the reader shows (the person's choice, else the sensible default). */
  selected: Engine;
  /** Shows another method's result, and remembers the choice for this paper. */
  select(engine: Engine): void;
  /** The selected method's job. */
  job: LayoutJob | null;
  /** The selected method's translated PDF; `null` while it has none. */
  translatedFile: SourceFile | null;
  /** The paper is an arXiv paper of a fixed version: its LaTeX source can be asked for. */
  arxiv: boolean;
  /** The local build can install the TeX engine that LaTeX translation needs. */
  latexInstallable: boolean;
  /** The service can re-typeset the PDF. */
  layoutAvailable: boolean;
  /** There is a model to translate with. */
  hasModel: boolean;
  /** Until the jobs and the settings have been heard. */
  loading: boolean;
  /** Starting or stopping has been asked for and is not answered yet. */
  busy: boolean;
  /** Why the last thing asked of the service did not happen, in its words; empty when it did. */
  error: string;
  /** Translates the paper the way asked; a failed attempt is made again. Never started by itself. */
  start(engine: Engine): void;
  /** Stops the running translation of a method. */
  cancel(engine: Engine): void;
}

const NONE = { latex: null, pdf: null };

/** How often the jobs are read: often while one runs, seldom otherwise, and after a failed read a little sooner. */
const ACTIVE_POLL = 1500;
const IDLE_POLL = 15000;
const RETRY_POLL = 5000;

type PerEngine<T> = Record<Engine, T>;

interface Read {
  key: string;
  jobs: PerEngine<LayoutJob | null>;
  translated: PerEngine<SourceFile | null>;
  /** Why the last read failed; empty when it did not. */
  failure: string;
}

/**
 * The layout translation of one PDF: reads the paper's jobs (every 1.5s while
 * one is running, every 15s otherwise, and not while the tab is hidden), finds
 * the translated PDF once there is one, and starts or stops the translation.
 * Reading stops when the paper goes.
 */
export function useLayoutTranslation({
  paper,
  file,
  modelId = null,
}: {
  paper: Paper | null;
  file: SourceFile | null;
  /** The model asked for in the menu; `null` is the one the settings have chosen. */
  modelId?: string | null;
}): Layout {
  const { t } = useI18n();
  const settings = useTranslationSettings();
  const paperId = paper?.id ?? "";
  const fileId = file?.id ?? "";
  const versionId = paper?.current_version ?? "";
  const key = `${paperId}:${fileId}:${versionId}`;
  const [read, setRead] = useState<Read | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ key: string; message: string }>({
    key: "",
    message: "",
  });
  /** Reads the jobs now rather than at the next tick. */
  const kick = useRef<() => void>(() => {});

  useEffect(() => {
    if (!paperId || !fileId) return;
    const controller = new AbortController();
    const { signal } = controller;
    const id = encodeURIComponent(paperId);
    let timer: number | undefined;
    let reading = false;
    let again = false;
    // Each method's translated PDF is looked up once, not at every tick.
    const known: PerEngine<SourceFile | null> = { latex: null, pdf: null };

    const reasonOf = (reason: unknown) =>
      reason instanceof ApiError && reason.message
        ? reason.message
        : t("reader.layout.offline");

    const tick = async () => {
      window.clearTimeout(timer);
      if (reading) {
        again = true;
        return;
      }
      // Nothing is read for a tab nobody looks at; coming back to it reads at once.
      if (document.hidden) return;
      reading = true;
      let next = IDLE_POLL;
      try {
        const rows = await api<LayoutJob[]>(`/papers/${id}/translations`, {
          signal,
        });
        const jobs: PerEngine<LayoutJob | null> = {
          latex: pickJob(rows, fileId, versionId, "latex"),
          pdf: pickJob(rows, fileId, versionId, "pdf"),
        };
        const translated: PerEngine<SourceFile | null> = {
          latex: null,
          pdf: null,
        };
        for (const engine of ENGINES) {
          // The kept translation, also while a newer one is being made.
          const job = keptJob(rows, fileId, versionId, engine);
          if (!job) continue;
          if (known[engine]?.id !== job.translated_file) {
            const files = await api<SourceFile[]>(`/papers/${id}/files`, {
              signal,
            });
            known[engine] =
              files.find(
                (row) =>
                  row.id === job.translated_file &&
                  row.mime === "application/pdf",
              ) ?? null;
          }
          translated[engine] = known[engine];
        }
        if (signal.aborted) return;
        setRead({ key, jobs, translated, failure: "" });
        if (isActive(jobs.latex) || isActive(jobs.pdf)) next = ACTIVE_POLL;
      } catch (reason) {
        if (signal.aborted) return;
        next = RETRY_POLL;
        const message = reasonOf(reason);
        setRead((old) => ({
          key,
          jobs: old?.key === key ? old.jobs : NONE,
          translated: old?.key === key ? old.translated : NONE,
          failure: message,
        }));
      } finally {
        reading = false;
      }
      if (signal.aborted) return;
      if (again) {
        again = false;
        void tick();
      } else timer = window.setTimeout(() => void tick(), next);
    };

    const visible = () => {
      if (!document.hidden) void tick();
    };
    kick.current = () => void tick();
    document.addEventListener("visibilitychange", visible);
    void tick();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
      kick.current = () => {};
    };
    // The language of the messages changing is no reason to read again.
  }, [key]);

  const current = read?.key === key ? read : null;
  const model = resolveModel(settings, modelId);

  const fail = (reason: unknown, fallback: string) =>
    setFailure({
      key,
      message:
        reason instanceof ApiError && reason.message
          ? reason.message
          : fallback,
    });

  const arxiv = isArxivVersion(paper?.external_id);
  const jobs = current?.jobs ?? NONE;
  const files = current?.translated ?? NONE;
  const states: PerEngine<LayoutState> = {
    latex: layoutState(jobs.latex),
    pdf: layoutState(jobs.pdf),
  };
  // The person's own choice (kept per paper); re-read when the paper changes, set at once when they choose.
  const [choice, setChoice] = useState<{
    paper: string;
    engine: Engine | null;
  }>({ paper: "", engine: null });
  const chosen = choice.paper === paperId ? choice.engine : readChoice(paperId);
  const selected = defaultEngine(states, arxiv, chosen);
  const select = (engine: Engine) => {
    if (!paperId) return;
    writeChoice(paperId, engine);
    setChoice({ paper: paperId, engine });
  };

  const engines = {} as PerEngine<EngineView>;
  for (const engine of ENGINES)
    engines[engine] = {
      engine,
      job: jobs[engine],
      state: states[engine],
      file: files[engine],
      // A job that exists shows whatever it did, even for a paper that could not start one now.
      supported: engine === "pdf" || arxiv || states[engine] !== "idle",
      available:
        engine === "latex" ? settings.latexAvailable : settings.layoutEnabled,
      noSource: engine === "latex" && lacksSource(jobs.latex),
    };

  const start = (engine: Engine) => {
    if (busy || !paperId || !fileId || !model) return;
    setBusy(true);
    setFailure({ key, message: "" });
    // What the person starts is what they will want to see.
    select(engine);
    send(
      `/papers/${encodeURIComponent(paperId)}/translations`,
      engine === "latex"
        ? { model_config_id: model, engine: "latex" }
        : { model_config_id: model, engine: "pdf", source_file_id: fileId },
    ).then(
      (job: LayoutJob) => {
        // Shown at once; the next read says how it goes.
        setRead((old) => {
          const same = old?.key === key ? old : null;
          return {
            key,
            jobs: { ...(same?.jobs ?? NONE), [engine]: job },
            // The previous result stays (to download) until the new one has completed.
            translated: same?.translated ?? NONE,
            failure: "",
          };
        });
        setBusy(false);
        kick.current();
      },
      (reason: unknown) => {
        fail(reason, t("reader.layout.startFailed"));
        setBusy(false);
      },
    );
  };

  const cancel = (engine: Engine) => {
    const job = jobs[engine];
    if (busy || !job || !isActive(job)) return;
    setBusy(true);
    setFailure({ key, message: "" });
    send(`/translations/${encodeURIComponent(job.id)}/cancel`, {}).then(
      () => {
        setBusy(false);
        kick.current();
      },
      (reason: unknown) => {
        fail(reason, t("reader.layout.cancelFailed"));
        setBusy(false);
        kick.current();
      },
    );
  };

  const ours = failure.key === key ? failure.message : "";
  return {
    engines,
    selected,
    select,
    job: jobs[selected],
    // Shown to read only once the method is at rest: while a newer one runs the panel shows its progress.
    translatedFile: states[selected] === "done" ? files[selected] : null,
    arxiv,
    latexInstallable: settings.latexInstallable,
    layoutAvailable: settings.layoutEnabled,
    hasModel: model !== "",
    loading:
      Boolean(paperId && fileId) && (current === null || !settings.loaded),
    busy,
    error: ours || current?.failure || "",
    start,
    cancel,
  };
}
