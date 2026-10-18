import { useEffect, useRef, useState } from "react";
import { api, send } from "../../api";
import type { MessageKey } from "../../i18n/i18n";
import { useI18n } from "../../i18n/I18nProvider";
import { serviceReason, serviceWords } from "../service-error";
import { readerContext, type AskRequest } from "../types";
import { useModel } from "../useModel";

/** How often a translation that is still being written is read again. */
const POLL_MS = 700;
/** How many reads in a row may fail (offline for a moment, a restart) before the translation is given up; each waits twice as long. */
const MISSES = 3;

/**
 * What the model is asked (the old reader's words, `lib/reader-agent.ts`). It is
 * an instruction to the model, not interface text; the server takes a selection
 * to translate down its direct path, from the reader context.
 */
const PROMPT =
  "请将所选文字翻译成中文，保留公式、术语和引用编号。只翻译这段内容，不自动新建笔记。";

type Run = {
  id: string;
  response: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  error: string;
};

export type Translation =
  | { status: "working"; text: string }
  | { status: "done"; text: string }
  /** `error` is why, in a sentence (empty for the reader's own words); `stopped` when it was cancelled. */
  | { status: "failed"; text: string; error: string; stopped: boolean }
  /** There is no model to translate with. */
  | { status: "noModel" };

const pending = (run: Run) =>
  run.status === "queued" || run.status === "running";

/** Two states that show the same: the popover is not drawn again for a read that brought nothing new. */
const same = (a: Translation, b: Translation) =>
  JSON.stringify(a) === JSON.stringify(b);

const cancel = (id: string) =>
  void send(`/agent/runs/${id}/cancel`, {}).catch(() => undefined);

/**
 * Translates a selection: a run in the paper's discussion session, read again
 * every 700 ms while it is being written (not while the tab is hidden), so the
 * text grows as it comes; a read that fails is tried again a few times before
 * the translation is given up. A run still going when the request goes (the
 * popover closed) is cancelled. `retry` starts a new run.
 */
export function useSelectionTranslation(
  request: AskRequest,
  options: {
    /** What the model is asked, when it is not to translate (a boxed region explained). */
    prompt?: string;
    /** The words for a run that failed without a reason of its own. */
    failed?: MessageKey;
  } = {},
) {
  const { prompt = PROMPT, failed = "reader.translate.failed" } = options;
  const i18n = useI18n();
  const i18nNow = useRef(i18n);
  i18nNow.current = i18n;
  const model = useModel();
  const [translation, setTranslation] = useState<Translation>({
    status: "working",
    text: "",
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!model.known) return;
    if (!model.id) {
      setTranslation({ status: "noModel" });
      return;
    }
    let live = true;
    let timer = 0;
    let runId = "";
    let settled = false;
    let misses = 0;
    const show = (next: Translation) =>
      setTranslation((old) => (same(old, next) ? old : next));
    const shown = (run: Run): Translation => {
      if (pending(run)) return { status: "working", text: run.response ?? "" };
      if (run.status === "completed")
        return { status: "done", text: run.response ?? "" };
      return {
        status: "failed",
        text: run.response ?? "",
        error: serviceWords(run.error, i18nNow.current),
        stopped: run.status === "cancelled",
      };
    };
    const fail = (error: unknown) =>
      live &&
      setTranslation({
        status: "failed",
        text: "",
        error: serviceReason(error, i18nNow.current, {
          fallback: failed,
        }),
        stopped: false,
      });
    const later = (session: string, delay: number) => {
      timer = window.setTimeout(() => void follow(session), delay);
    };
    const follow = async (session: string) => {
      // A hidden tab does not ask; it looks again when it may be seen.
      if (document.hidden) return later(session, POLL_MS);
      try {
        const runs = await api<Run[]>(`/agent/sessions/${session}/runs`);
        if (!live) return;
        misses = 0;
        const run = runs.find((item) => item.id === runId);
        if (run) {
          show(shown(run));
          if (!pending(run)) {
            settled = true;
            return;
          }
        }
        later(session, POLL_MS);
      } catch (error) {
        if (!live) return;
        // The run goes on without the reads: try again, more slowly, before giving up on it.
        // Given up, it is still stopped when the popover closes.
        misses += 1;
        if (misses < MISSES) later(session, POLL_MS * 2 ** misses);
        else fail(error);
      }
    };
    setTranslation({ status: "working", text: "" });
    void (async () => {
      try {
        const session = await send(`/papers/${request.paperId}/discussion`, {});
        if (!live) return;
        const run: Run = await send(`/agent/sessions/${session.id}/runs`, {
          prompt,
          model_config_id: model.id,
          reader_context: readerContext(request),
          writable: false,
          context: `paper/${request.paperId}`,
        });
        runId = run.id;
        // Closed while the run was being made: it is not wanted any more.
        if (!live) {
          if (pending(run)) cancel(run.id);
          return;
        }
        show(shown(run));
        if (pending(run)) later(session.id, POLL_MS);
        else settled = true;
      } catch (error) {
        settled = true;
        fail(error);
      }
    })();
    return () => {
      live = false;
      window.clearTimeout(timer);
      if (runId && !settled) cancel(runId);
    };
  }, [request, prompt, failed, attempt, model.known, model.id]);

  return { translation, retry: () => setAttempt((count) => count + 1) };
}
