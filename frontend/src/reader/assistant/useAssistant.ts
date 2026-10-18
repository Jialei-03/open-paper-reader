import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, send as post, type Paper, type SourceFile } from "../../api";
import { useI18n } from "../../i18n/I18nProvider";
import { serviceReason } from "../service-error";
import { readerContext, type AskRequest } from "../types";
import { useModel } from "../useModel";
import { isActive, resendable, sameRuns, type AgentRun } from "./runs";

/** The paper's conversation with the assistant, as the reader's parts share it. */
export interface Assistant {
  /** Oldest first, translations included (`conversation` leaves those out for the thread). */
  runs: AgentRun[];
  /** Until the model and the first list of runs are known. */
  loading: boolean;
  /** Why the last thing asked of the service did not happen, in a sentence; empty when it did. */
  error: string;
  /**
   * Tries again what `error` is about (the question that was not sent, the stop
   * that did not reach the service); `null` when there is nothing to try again
   * by hand (the runs are read again by themselves).
   */
  recover: (() => void) | null;
  /** Asks the assistant; whether the run was created (`error` says why not). */
  send(input: { prompt: string; request?: AskRequest }): Promise<boolean>;
  cancel(runId: string): void;
  /** Asks the same question again, with the same context. */
  retry(runId: string): void;
  /** There is a model to answer with. */
  ready: boolean;
  /** The paper this is about; empty while there is none. */
  paperId: string;
  /** A question is on its way to the service. */
  sending: boolean;
}

/** How often the runs are read: often while one is being written, seldom otherwise. */
const ACTIVE_POLL = 700;
const IDLE_POLL = 3000;
const NO_RUNS: AgentRun[] = [];

interface Conversation {
  paperId: string;
  /** The paper's discussion session; empty until the service has given it. */
  session: string;
  runs: AgentRun[];
  /** The runs have been read once (or could not be). */
  listed: boolean;
  error: string;
}

/**
 * The paper's discussion with the assistant (`POST /papers/{id}/discussion`):
 * its runs, read again every 700ms while one is queued or running and every 3s
 * otherwise (not while the tab is hidden; at once when it is seen again), and
 * the asking, stopping and asking again. Questions are sent with the model
 * chosen in the settings, read-only (`writable: false`).
 */
export function useAssistant({
  paper,
}: {
  paper: Paper | null;
  /** The PDF being read. Questions carry their file in the request; it is here for what comes next. */
  file?: SourceFile | null;
}): Assistant {
  const i18n = useI18n();
  const { t } = i18n;
  const paperId = paper?.id ?? "";
  const model = useModel();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [failure, setFailure] = useState<{
    paperId: string;
    message: string;
    retry: (() => void) | null;
  } | null>(null);
  const [sending, setSending] = useState(false);

  // What the callbacks below read when they run, not when they were made.
  const now = useRef({
    paperId,
    session: "",
    model: "",
    runs: [] as AgentRun[],
  });
  const current = conversation?.paperId === paperId ? conversation : null;
  now.current = {
    paperId,
    session: current?.session ?? "",
    model: model.id,
    runs: current?.runs ?? NO_RUNS,
  };
  /** Reads the runs now rather than at the next tick. */
  const kick = useRef<() => void>(() => {});
  /** Runs made here that the list has not shown yet, so a list read before they were made does not drop them. */
  const made = useRef(new Map<string, AgentRun>());

  // The runs that could not be read are read again by themselves: so the message says.
  const i18nNow = useRef(i18n);
  i18nNow.current = i18n;
  const describeList = (reason: unknown) =>
    serviceReason(reason, i18nNow.current, {
      offline: "reader.assistant.offline",
    });

  // The paper's session, then its runs, again and again until the paper changes.
  useEffect(() => {
    if (!paperId) return;
    const controller = new AbortController();
    const { signal } = controller;
    let session = "";
    let timer: number | undefined;
    let reading = false;
    let again = false;
    made.current = new Map();
    const update = (change: (old: Conversation) => Conversation) =>
      setConversation((old) => (old?.paperId === paperId ? change(old) : old));
    setConversation({
      paperId,
      session: "",
      runs: [],
      listed: false,
      error: "",
    });

    // A hidden tab does not ask; it asks once it can be seen again.
    const schedule = (delay: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!document.hidden) void poll();
      }, delay);
    };
    const seen = () => {
      if (!document.hidden) void poll();
    };
    async function poll() {
      if (signal.aborted) return;
      if (reading) {
        again = true;
        return;
      }
      reading = true;
      window.clearTimeout(timer);
      let delay = IDLE_POLL;
      try {
        if (!session) {
          const discussion = await api<{ id: string }>(
            `/papers/${encodeURIComponent(paperId)}/discussion`,
            { method: "POST", body: "{}", signal },
          );
          session = discussion.id;
          update((old) => ({ ...old, session }));
        }
        const rows = await api<AgentRun[]>(
          `/agent/sessions/${encodeURIComponent(session)}/runs`,
          { signal },
        );
        const listed = new Set(rows.map((row) => row.id));
        for (const id of made.current.keys())
          if (listed.has(id)) made.current.delete(id);
        const runs = [...rows, ...made.current.values()];
        // Read again with nothing new: the same state, so nothing is drawn again.
        update((old) =>
          old.listed && !old.error && sameRuns(old.runs, runs)
            ? old
            : { ...old, runs, listed: true, error: "" },
        );
        if (runs.some(isActive)) delay = ACTIVE_POLL;
      } catch (reason) {
        if (signal.aborted) return;
        const error = describeList(reason);
        update((old) =>
          old.listed && old.error === error
            ? old
            : { ...old, listed: true, error },
        );
      } finally {
        reading = false;
      }
      if (signal.aborted) return;
      if (again) {
        again = false;
        schedule(0);
      } else schedule(delay);
    }
    kick.current = () => void poll();
    void poll();
    document.addEventListener("visibilitychange", seen);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", seen);
      kick.current = () => {};
    };
  }, [paperId]);

  /** Puts a run the service has answered with into the list, in place of the one it was. */
  const place = useCallback((forPaper: string, run: AgentRun) => {
    setConversation((old) => {
      if (old?.paperId !== forPaper) return old;
      const at = old.runs.findIndex((row) => row.id === run.id);
      const runs =
        at < 0
          ? [...old.runs, run]
          : old.runs.map((row, index) => (index === at ? run : row));
      return { ...old, runs };
    });
  }, []);

  const create = useCallback(
    async (prompt: string, context?: Record<string, unknown>) => {
      const { paperId: forPaper, session, model: modelId } = now.current;
      const question = prompt.trim();
      if (!forPaper || !question) return false;
      // Asked again by hand, the same question about the same words.
      const again = () => void createNow.current(prompt, context);
      if (!modelId || !session) {
        setFailure({
          paperId: forPaper,
          message: t(
            modelId ? "reader.assistant.notReady" : "reader.assistant.noModel",
          ),
          retry: modelId ? again : null,
        });
        return false;
      }
      setSending(true);
      setFailure(null);
      try {
        const run: AgentRun = await post(
          `/agent/sessions/${encodeURIComponent(session)}/runs`,
          {
            prompt: question,
            model_config_id: modelId,
            ...(context ? { reader_context: context } : {}),
            writable: false,
            context: `paper/${forPaper}`,
          },
        );
        if (now.current.paperId === forPaper) {
          made.current.set(run.id, run);
          place(forPaper, run);
          kick.current();
        }
        return true;
      } catch (reason) {
        if (now.current.paperId === forPaper)
          setFailure({
            paperId: forPaper,
            message: serviceReason(reason, i18nNow.current, {
              offline: "reader.assistant.unsent",
              fallback: "reader.assistant.sendFailed",
            }),
            retry: again,
          });
        return false;
      } finally {
        setSending(false);
      }
    },
    [place, t],
  );
  const createNow = useRef(create);
  createNow.current = create;

  const send = useCallback(
    ({ prompt, request }: { prompt: string; request?: AskRequest }) =>
      create(prompt, request ? readerContext(request) : undefined),
    [create],
  );

  const retry = useCallback(
    (runId: string) => {
      const run = now.current.runs.find((row) => row.id === runId);
      if (run) void create(run.prompt, resendable(run.runtime?.reader_context));
    },
    [create],
  );

  const cancel = useCallback(
    (runId: string) => {
      const forPaper = now.current.paperId;
      setFailure(null);
      post(`/agent/runs/${encodeURIComponent(runId)}/cancel`, {}).then(
        (run: AgentRun) => {
          if (now.current.paperId !== forPaper) return;
          place(forPaper, run);
          kick.current();
        },
        (reason: unknown) => {
          if (now.current.paperId === forPaper)
            setFailure({
              paperId: forPaper,
              message: serviceReason(reason, i18nNow.current, {
                offline: "reader.assistant.unstopped",
                fallback: "reader.assistant.stopFailed",
              }),
              retry: () => cancelNow.current(runId),
            });
        },
      );
    },
    [place],
  );
  const cancelNow = useRef(cancel);
  cancelNow.current = cancel;

  const runs = current?.runs;
  const failed = failure?.paperId === paperId ? failure : null;
  const error = failed?.message || (current?.error ?? "");
  const recover = failed?.message ? failed.retry : null;
  const loading = !model.known || !current?.listed;
  return useMemo(
    () => ({
      runs: runs ?? NO_RUNS,
      loading,
      error,
      recover,
      send,
      cancel,
      retry,
      ready: model.id !== "",
      paperId,
      sending,
    }),
    [
      runs,
      loading,
      error,
      recover,
      send,
      cancel,
      retry,
      model.id,
      paperId,
      sending,
    ],
  );
}
