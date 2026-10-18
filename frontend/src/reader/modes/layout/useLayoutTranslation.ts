import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, send, type Paper, type SourceFile } from "../../../api";
import { useI18n } from "../../../i18n/I18nProvider";
import {
  resolveModel,
  useTranslationSettings,
} from "../useTranslationSettings";
import { isActive, layoutState, pickJob, type LayoutJob } from "./job";

/** The layout translation of a paper's PDF, as the reader's parts share it. */
export interface Layout {
  /** The job that matters for this PDF (see `pickJob`); `null` when none was ever made. */
  job: LayoutJob | null;
  /** The translated PDF, once a job has completed. */
  translatedFile: SourceFile | null;
  /** The service can make one (it is switched on). */
  available: boolean;
  /** There is a model to translate with. */
  hasModel: boolean;
  /** Until the jobs and the settings have been heard. */
  loading: boolean;
  /** Starting or stopping has been asked for and is not answered yet. */
  busy: boolean;
  /** Why the last thing asked of the service did not happen, in its words; empty when it did. */
  error: string;
  /** Translates the PDF; a failed attempt is made again. */
  start(): void;
  /** Stops the running translation. */
  cancel(): void;
}

/** How often the jobs are read: often while one runs, seldom otherwise, and after a failed read a little sooner. */
const ACTIVE_POLL = 1500;
const IDLE_POLL = 15000;
const RETRY_POLL = 5000;

interface Read {
  key: string;
  job: LayoutJob | null;
  translated: SourceFile | null;
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
  const key = `${paperId}:${fileId}`;
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
    // The translated PDF is looked up once, not at every tick.
    let known: SourceFile | null = null;

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
        const job = pickJob(rows, fileId);
        let translated: SourceFile | null = null;
        if (job && layoutState(job) === "done") {
          if (known?.id !== job.translated_file) {
            const files = await api<SourceFile[]>(`/papers/${id}/files`, {
              signal,
            });
            known =
              files.find(
                (row) =>
                  row.id === job.translated_file &&
                  row.mime === "application/pdf",
              ) ?? null;
          }
          translated = known;
        }
        if (signal.aborted) return;
        setRead({ key, job, translated, failure: "" });
        if (isActive(job)) next = ACTIVE_POLL;
      } catch (reason) {
        if (signal.aborted) return;
        next = RETRY_POLL;
        const message = reasonOf(reason);
        setRead((old) => ({
          key,
          job: old?.key === key ? old.job : null,
          translated: old?.key === key ? old.translated : null,
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

  const start = () => {
    if (busy || !paperId || !fileId || !model) return;
    setBusy(true);
    setFailure({ key, message: "" });
    send(`/papers/${encodeURIComponent(paperId)}/translations`, {
      model_config_id: model,
      engine: "pdf",
      source_file_id: fileId,
    }).then(
      (job: LayoutJob) => {
        // Shown at once; the next read says how it goes.
        setRead({ key, job, translated: null, failure: "" });
        setBusy(false);
        kick.current();
      },
      (reason: unknown) => {
        fail(reason, t("reader.layout.startFailed"));
        setBusy(false);
      },
    );
  };

  const cancel = () => {
    const job = current?.job;
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
    job: current?.job ?? null,
    translatedFile: current?.translated ?? null,
    available: settings.layoutEnabled,
    hasModel: model !== "",
    loading:
      Boolean(paperId && fileId) && (current === null || !settings.loaded),
    busy,
    error: ours || current?.failure || "",
    start,
    cancel,
  };
}
