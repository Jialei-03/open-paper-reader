import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api, type Paper, type SourceFile } from "../../../api";

/** What a line of the translation is on the page (the service's `kind`). */
export type ParagraphKind =
  | "text"
  | "heading"
  | "caption"
  | "figure_text"
  | "page_number";

/** A sentence of the page and its translation, in the page's order. */
export interface ParallelParagraph {
  kind?: ParagraphKind;
  original: string;
  translation: string;
}

/** A `page_translation` reading artifact, as the service returns it. */
interface Artifact {
  id: string;
  file_id: string;
  kind: string;
  model_config_id: string;
  status: string;
  error?: string;
  parameters?: { page?: number; language?: string };
  result?: { paragraphs?: ParallelParagraph[] } | null;
  preview?: { paragraphs?: ParallelParagraph[] } | null;
  /** What a new run is replacing: shown until it completes, and again if it fails. */
  previous?: { paragraphs?: ParallelParagraph[] } | null;
}

/** What the column beside a page shows. */
export type ParallelPageView =
  /** Not started: it will be once the page is near the view and there is room for it. */
  | { status: "waiting" }
  /** Being translated: what has come so far. */
  | { status: "working"; paragraphs: ParallelParagraph[] }
  | { status: "done"; paragraphs: ParallelParagraph[] }
  /**
   * `error` is the service's own words, or "" when it gave none; `paragraphs`
   * is the earlier translation of the page, kept when a new one failed.
   */
  | { status: "failed"; error: string; paragraphs?: ParallelParagraph[] };

export interface Parallel {
  /** The translations made before are still being read. */
  loading: boolean;
  /** There is no model to translate with: the column says to add one in settings. */
  noModel: boolean;
  page(page: number): ParallelPageView;
  /** Translates the page anew (after a failure), or reads everything again if that is what failed. */
  retry(page: number): void;
}

type Settings = { models?: { id: string }[]; active_id?: string };
/** A translation asked for here: on its way (and waiting through "busy" answers), or refused. */
type Ask = { state: "sending" } | { state: "failed"; error: string };

/** At most this many pages are translated at once, the current one first. */
const IN_FLIGHT = 2;
/** A page being translated is read this often, for what has come of it. */
const POLL = 700;
/** The service is translating as many pages as it will at once: ask again after this. */
const BUSY_RETRY = 2000;

const pending = (row: Artifact | undefined) =>
  !!row && (row.status === "queued" || row.status === "running");
const message = (error: unknown) =>
  error instanceof Error ? error.message : "";
const busy = (error: unknown) =>
  error instanceof ApiError &&
  error.status === 409 &&
  /同时翻译/.test(error.message);
const sleep = (ms: number) =>
  new Promise((resolve) => window.setTimeout(resolve, ms));

/**
 * Which of a page's translations to show: the chosen model's own (the newest),
 * unless it failed and another model's is done; else another model's that is
 * done; else the chosen model's failed one.
 */
function rank(row: Artifact, model: string) {
  const own = row.model_config_id === model;
  if (own && (row.status === "completed" || pending(row))) return 3;
  if (row.status === "completed") return 2;
  return own ? 1 : 0;
}

/**
 * The 对照 reading: the translation of each page of the PDF, sentence by
 * sentence, to show beside it. The pages near the view are translated as they
 * come into it, the current one first and at most `IN_FLIGHT` at once; what a
 * page's translation has come to is shown while it is written. Translations
 * made before (here, or by the paper's preparation) are shown as they are.
 * Nothing is asked of the service until there are pages to translate.
 */
export function useParallelTranslation({
  paper,
  file,
  language,
  modelId,
  visiblePages,
}: {
  paper: Paper | null;
  file: SourceFile | null;
  language: "zh" | "en";
  /** The model to translate with; `null` for the one chosen in settings. */
  modelId: string | null;
  /** The pages to translate now, the current one first (`PdfPages`' `onVisiblePages`). */
  visiblePages: number[];
}): Parallel {
  const paperId = paper?.id ?? "";
  const fileId = file?.id ?? "";
  const [wanted, setWanted] = useState(false);
  const [config, setConfig] = useState<Settings | null>(null);
  const [rows, setRows] = useState<Artifact[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [reloads, setReloads] = useState(0);
  const [asks, setAsks] = useState<Record<string, Ask>>({});

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Only once there is something to translate is anything read.
  useEffect(() => {
    if (!wanted && paperId && fileId && visiblePages.length) setWanted(true);
  }, [wanted, paperId, fileId, visiblePages.length]);

  // The models, and the translations of this PDF there are already.
  useEffect(() => {
    if (!wanted || !paperId || !fileId) return;
    const controller = new AbortController();
    const { signal } = controller;
    let live = true;
    setRows(null);
    setLoadError("");
    Promise.all([
      api<Settings>("/translation-settings", { signal }),
      api<Artifact[]>(`/papers/${paperId}/reading-artifacts`, { signal }),
    ]).then(
      ([settings, list]) => {
        if (!live) return;
        setConfig(settings);
        setRows(
          list.filter(
            (row) => row.kind === "page_translation" && row.file_id === fileId,
          ),
        );
      },
      (reason: unknown) => {
        if (live && !signal.aborted) setLoadError(message(reason));
      },
    );
    return () => {
      live = false;
      controller.abort();
    };
  }, [wanted, paperId, fileId, reloads]);

  // A model added or changed in settings (the old interface announces it).
  useEffect(() => {
    if (!wanted) return;
    const controller = new AbortController();
    const refresh = () =>
      void api<Settings>("/translation-settings", { signal: controller.signal })
        .then((settings) => {
          if (alive.current) setConfig(settings);
        })
        .catch(() => {});
    window.addEventListener("model-settings-updated", refresh);
    return () => {
      controller.abort();
      window.removeEventListener("model-settings-updated", refresh);
    };
  }, [wanted]);

  const model = modelId || config?.active_id || config?.models?.[0]?.id || "";
  const noModel = config !== null && !model;
  const scope = `${fileId}|${model}|${language}`;
  const keyOf = useCallback((page: number) => `${scope}|${page}`, [scope]);

  /** A row the service sent, in place of the one it was (the newest first, as the service lists them). */
  const merge = useCallback((row: Artifact) => {
    setRows((previous) => {
      const old = previous?.find((each) => each.id === row.id);
      if (old && JSON.stringify(old) === JSON.stringify(row)) return previous;
      return [row, ...(previous ?? []).filter((each) => each.id !== row.id)];
    });
  }, []);

  // Each page's translation in this language, as `rank` chooses it.
  const chosen = useMemo(() => {
    const map = new Map<number, Artifact>();
    for (const row of rows ?? []) {
      const page = row.parameters?.page;
      if (!page || row.parameters?.language !== language) continue;
      const value = rank(row, model);
      const held = map.get(page);
      if (value > 0 && (!held || value > rank(held, model))) map.set(page, row);
    }
    return map;
  }, [rows, language, model]);

  const visibleNow = useRef(visiblePages);
  visibleNow.current = visiblePages;
  const scopeNow = useRef(scope);
  scopeNow.current = scope;
  /** The pages whose translation was asked for here (by key), and those still on their way. */
  const started = useRef(new Set<string>());
  const sending = useRef(new Set<string>());
  /** Bumped when a page's ask is done, for the queue to look again. */
  const [settled, setSettled] = useState(0);

  const start = useCallback(
    (page: number, regenerate: boolean) => {
      const key = keyOf(page);
      if (sending.current.has(key) || !model || !paperId || !fileId) return;
      sending.current.add(key);
      started.current.add(key);
      setAsks((all) => ({ ...all, [key]: { state: "sending" } }));
      const body = JSON.stringify({
        file_id: fileId,
        model_config_id: model,
        kind: "page_translation",
        page,
        language,
        ...(regenerate ? { regenerate: true } : {}),
      });
      const done = (ask: Ask | null) => {
        sending.current.delete(key);
        if (!alive.current) return;
        setAsks((all) => {
          const next = { ...all };
          if (ask) next[key] = ask;
          else delete next[key];
          return next;
        });
        setSettled((count) => count + 1);
      };
      void (async () => {
        for (;;) {
          try {
            const row = await api<Artifact>(
              `/papers/${paperId}/reading-artifacts`,
              { method: "POST", body },
            );
            if (alive.current) merge(row);
            return done(null);
          } catch (reason) {
            if (!busy(reason))
              return done({ state: "failed", error: message(reason) });
            await sleep(BUSY_RETRY);
            // Moved on meanwhile (another model, language, or far from the page): asked again when it is near.
            if (
              !alive.current ||
              scopeNow.current !== key.slice(0, key.lastIndexOf("|")) ||
              (!regenerate && !visibleNow.current.includes(page))
            )
              return done(null);
          }
        }
      })();
    },
    [keyOf, model, paperId, fileId, language, merge],
  );

  // The queue: the pages near the view that have no translation yet, in their order, while fewer
  // than `IN_FLIGHT` are being translated.
  const visibleKey = visiblePages.join(",");
  useEffect(() => {
    if (!rows || noModel || !model || loadError) return;
    const pages = visibleKey ? visibleKey.split(",").map(Number) : [];
    const working = new Set<number>();
    for (const key of sending.current) {
      const at = key.lastIndexOf("|");
      if (key.slice(0, at) === scope) working.add(Number(key.slice(at + 1)));
    }
    for (const [page, row] of chosen)
      if (
        pending(row) &&
        (started.current.has(keyOf(page)) || pages.includes(page))
      )
        working.add(page);
    for (const page of pages) {
      if (working.size >= IN_FLIGHT) break;
      if (working.has(page) || chosen.has(page) || asks[keyOf(page)]) continue;
      working.add(page);
      start(page, false);
    }
  }, [
    rows,
    chosen,
    asks,
    noModel,
    model,
    loadError,
    visibleKey,
    scope,
    keyOf,
    start,
    settled,
  ]);

  // The pages being translated that are near the view, or were asked for here: read until they are done.
  const following = [...chosen]
    .filter(
      ([page, row]) =>
        pending(row) &&
        (visiblePages.includes(page) || started.current.has(keyOf(page))),
    )
    .map(([, row]) => row.id)
    .sort()
    .join(",");
  useEffect(() => {
    if (!following) return;
    const ids = following.split(",");
    const controller = new AbortController();
    let live = true;
    let timer = 0;
    const tick = async () => {
      if (!live) return;
      // A hidden tab does not ask; it looks again when it may be seen.
      if (!document.hidden)
        await Promise.all(
          ids.map((id) =>
            api<Artifact>(`/reading-artifacts/${id}`, {
              signal: controller.signal,
            }).then(
              (row) => {
                if (live) merge(row);
              },
              () => {},
            ),
          ),
        );
      if (live) timer = window.setTimeout(tick, POLL);
    };
    timer = window.setTimeout(tick, POLL);
    return () => {
      live = false;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [following, merge]);

  const page = useCallback(
    (number: number): ParallelPageView => {
      if (loadError) return { status: "failed", error: loadError };
      const row = chosen.get(number);
      // The translation made before stays while a new one is made, and if it fails.
      const earlier =
        (row?.status === "completed" ? row.result : row?.previous)
          ?.paragraphs ?? [];
      const ask = asks[keyOf(number)];
      if (ask?.state === "failed")
        return { status: "failed", error: ask.error, paragraphs: earlier };
      if (row?.status === "completed")
        return { status: "done", paragraphs: row.result?.paragraphs ?? [] };
      if (pending(row))
        return {
          status: "working",
          paragraphs: row?.preview?.paragraphs?.length
            ? row.preview.paragraphs
            : earlier,
        };
      if (ask?.state === "sending")
        return { status: "working", paragraphs: earlier };
      if (row)
        return {
          status: "failed",
          error: row.error ?? "",
          paragraphs: earlier,
        };
      return { status: "waiting" };
    },
    [loadError, asks, keyOf, chosen],
  );

  const retry = useCallback(
    (number: number) => {
      if (loadError) setReloads((count) => count + 1);
      else start(number, true);
    },
    [loadError, start],
  );

  return useMemo(
    () => ({
      loading: wanted && rows === null && !loadError,
      noModel,
      page,
      retry,
    }),
    [wanted, rows, loadError, noModel, page, retry],
  );
}
