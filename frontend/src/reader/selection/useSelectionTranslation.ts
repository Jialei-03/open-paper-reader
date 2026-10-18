import { useEffect, useState } from "react";
import { api, send } from "../../api";
import { readerContext, type AskRequest } from "../types";

/** How often a translation that is still being written is read again. */
const POLL_MS = 700;

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
  /** `error` is the server's reason, or empty for the reader's own words; `stopped` when it was cancelled. */
  | { status: "failed"; text: string; error: string; stopped: boolean }
  /** There is no model to translate with. */
  | { status: "noModel" };

const pending = (run: Run) =>
  run.status === "queued" || run.status === "running";

function shown(run: Run): Translation {
  if (pending(run)) return { status: "working", text: run.response ?? "" };
  if (run.status === "completed")
    return { status: "done", text: run.response ?? "" };
  return {
    status: "failed",
    text: run.response ?? "",
    error: run.error ?? "",
    stopped: run.status === "cancelled",
  };
}

const cancel = (id: string) =>
  void send(`/agent/runs/${id}/cancel`, {}).catch(() => undefined);

/**
 * Translates a selection: a run in the paper's discussion session, read again
 * every 700 ms while it is being written, so the text grows as it comes. A
 * run still going when the request goes (the popover closed) is cancelled.
 * `retry` starts a new run.
 */
export function useSelectionTranslation(request: AskRequest) {
  const [translation, setTranslation] = useState<Translation>({
    status: "working",
    text: "",
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    let timer = 0;
    let runId = "";
    let settled = false;
    setTranslation({ status: "working", text: "" });
    const fail = (error: unknown) => {
      settled = true;
      if (live)
        setTranslation({
          status: "failed",
          text: "",
          error: error instanceof Error ? error.message : "",
          stopped: false,
        });
    };
    const follow = async (session: string) => {
      try {
        const runs = await api<Run[]>(`/agent/sessions/${session}/runs`);
        if (!live) return;
        const run = runs.find((item) => item.id === runId);
        if (run) {
          setTranslation(shown(run));
          if (!pending(run)) {
            settled = true;
            return;
          }
        }
        timer = window.setTimeout(() => void follow(session), POLL_MS);
      } catch (error) {
        fail(error);
      }
    };
    void (async () => {
      try {
        const settings = await api<{
          models: { id: string }[];
          active_id: string;
        }>("/translation-settings");
        if (!live) return;
        const model =
          settings.models.find((item) => item.id === settings.active_id)?.id ??
          settings.models[0]?.id;
        if (!model) {
          settled = true;
          setTranslation({ status: "noModel" });
          return;
        }
        const session = await send(`/papers/${request.paperId}/discussion`, {});
        if (!live) return;
        const run: Run = await send(`/agent/sessions/${session.id}/runs`, {
          prompt: PROMPT,
          model_config_id: model,
          reader_context: readerContext({ ...request, action: "translate" }),
          writable: false,
          context: `paper/${request.paperId}`,
        });
        runId = run.id;
        // Closed while the run was being made: it is not wanted any more.
        if (!live) {
          if (pending(run)) cancel(run.id);
          return;
        }
        setTranslation(shown(run));
        if (pending(run))
          timer = window.setTimeout(() => void follow(session.id), POLL_MS);
        else settled = true;
      } catch (error) {
        fail(error);
      }
    })();
    return () => {
      live = false;
      window.clearTimeout(timer);
      if (runId && !settled) cancel(runId);
    };
  }, [request, attempt]);

  return { translation, retry: () => setAttempt((count) => count + 1) };
}
