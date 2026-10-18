import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  ApiError,
  send as post,
  type Paper,
  type SourceFile,
} from "../../api";
import { useI18n } from "../../i18n/I18nProvider";
import { readerContext, type AskRequest } from "../types";
import { isActive, resendable, type AgentRun } from "./runs";

/** The paper's conversation with the assistant, as the reader's parts share it. */
export interface Assistant {
  /** Oldest first, translations included (`conversation` leaves those out for the thread). */
  runs: AgentRun[];
  /** Until the model and the first list of runs are known. */
  loading: boolean;
  /** Why the last thing asked of the service did not happen, in its words; empty when it did. */
  error: string;
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

type Settings = {
  active_id?: string;
  configured?: boolean;
  models?: { id: string }[];
};

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
 * otherwise, and the asking, stopping and asking again. Questions are sent with
 * the model chosen in the settings, read-only (`writable: false`).
 */
export function useAssistant({
  paper,
}: {
  paper: Paper | null;
  /** The PDF being read. Questions carry their file in the request; it is here for what comes next. */
  file?: SourceFile | null;
}): Assistant {
  const { t } = useI18n();
  const paperId = paper?.id ?? "";
  const [model, setModel] = useState<{ id: string; known: boolean }>({
    id: "",
    known: false,
  });
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [failure, setFailure] = useState<{
    paperId: string;
    message: string;
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

  const describe = useCallback(
    (reason: unknown) =>
      reason instanceof ApiError && reason.message
        ? reason.message
        : t("reader.assistant.offline"),
    [t],
  );
  const describeNow = useRef(describe);
  describeNow.current = describe;

  // The model the settings have chosen; again when the settings change.
  useEffect(() => {
    const controller = new AbortController();
    const read = () =>
      api<Settings>("/translation-settings", {
        signal: controller.signal,
      }).then(
        (settings) => {
          const chosen =
            settings.models?.find((row) => row.id === settings.active_id)?.id ??
            "";
          setModel({
            id: settings.configured === false ? "" : chosen,
            known: true,
          });
        },
        () => {
          if (!controller.signal.aborted) setModel({ id: "", known: true });
        },
      );
    void read();
    window.addEventListener("model-settings-updated", read);
    return () => {
      controller.abort();
      window.removeEventListener("model-settings-updated", read);
    };
  }, []);

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

    const schedule = (delay: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(poll, delay);
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
        update((old) => ({ ...old, runs, listed: true, error: "" }));
        if (runs.some(isActive)) delay = ACTIVE_POLL;
      } catch (reason) {
        if (signal.aborted) return;
        update((old) => ({
          ...old,
          listed: true,
          error: describeNow.current(reason),
        }));
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
    return () => {
      controller.abort();
      window.clearTimeout(timer);
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
      if (!modelId || !session) {
        setFailure({
          paperId: forPaper,
          message: t(
            modelId ? "reader.assistant.notReady" : "reader.assistant.noModel",
          ),
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
          setFailure({ paperId: forPaper, message: describe(reason) });
        return false;
      } finally {
        setSending(false);
      }
    },
    [describe, place, t],
  );

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
      post(`/agent/runs/${encodeURIComponent(runId)}/cancel`, {}).then(
        (run: AgentRun) => {
          if (now.current.paperId !== forPaper) return;
          place(forPaper, run);
          kick.current();
        },
        (reason: unknown) => {
          if (now.current.paperId === forPaper)
            setFailure({ paperId: forPaper, message: describe(reason) });
        },
      );
    },
    [describe, place],
  );

  const runs = current?.runs;
  const error =
    (failure?.paperId === paperId ? failure.message : "") ||
    (current?.error ?? "");
  const loading = !model.known || !current?.listed;
  return useMemo(
    () => ({
      runs: runs ?? NO_RUNS,
      loading,
      error,
      send,
      cancel,
      retry,
      ready: model.id !== "",
      paperId,
      sending,
    }),
    [runs, loading, error, send, cancel, retry, model.id, paperId, sending],
  );
}
