import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api";
import type { Preparation } from "../../lib/preparation";
import {
  guideView,
  isRunning,
  pickGuide,
  preparing,
  type GuideArtifact,
  type GuideView,
} from "./guide";

/** While the guide is being written its draft is read this often; while waiting for it to start, less. */
const DRAFT_INTERVAL = 700;
const PREPARATION_INTERVAL = 2000;
/** After a read that failed (offline, a restart): try again, quietly. */
const RETRY_INTERVAL = 5000;

type Models = { models?: { id: string }[]; active_id?: string };

const post = (path: string, body: unknown, signal?: AbortSignal) =>
  api(path, { method: "POST", body: JSON.stringify(body), signal });

const message = (error: unknown) =>
  error instanceof Error ? error.message : "";

export interface Guide {
  view: GuideView;
  /** Starting a guide (or making it again) has been asked for and is not answered yet. */
  busy: boolean;
  /** Why the last ask for a guide was refused. */
  error: string;
  /** Makes the guide; `again` makes it anew even if one was made (a failed or stopped one). */
  generate(again: boolean): void;
  /** Tries again after a failure: reads everything again if that is what failed, else makes the guide anew. */
  retry(): void;
}

/**
 * The guide of one paper's PDF: asks the service to take care of the paper's
 * preparation (it makes the guide by itself), reads the guide when there is one,
 * and follows it while it is being made. Reads stop when the tab goes.
 */
export function useGuide(paperId: string, fileId: string): Guide {
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);
  const [models, setModels] = useState<Models["models"]>([]);
  const [modelId, setModelId] = useState("");
  const [preparation, setPreparation] = useState<Preparation | null>(null);
  const [artifact, setArtifact] = useState<GuideArtifact | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Nothing is set once the tab is gone, whatever is still on its way.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // The paper's preparation is made sure of, and what there is of the guide is read.
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    let live = true;
    setLoaded(false);
    setLoadError(null);
    setArtifact(null);
    setPreparation(null);
    (async () => {
      const [config, ensured, rows] = await Promise.all([
        api<Models>("/translation-settings", { signal }).catch(() => null),
        post(`/papers/${paperId}/preparation`, {}, signal).catch(() => null),
        api<GuideArtifact[]>(`/papers/${paperId}/reading-artifacts`, {
          signal,
        }).catch((reason) => {
          if (!signal.aborted) setLoadError(message(reason));
          return null;
        }),
      ]);
      if (!live) return;
      setModels(config?.models ?? []);
      setModelId(config?.active_id || config?.models?.[0]?.id || "");
      setPreparation(ensured as Preparation | null);
      if (rows) setArtifact(pickGuide(rows, fileId));
      setLoaded(true);
    })();
    return () => {
      live = false;
      controller.abort();
    };
  }, [paperId, fileId, reloads]);

  // A model added or changed in settings (the old interface announces it).
  useEffect(() => {
    const controller = new AbortController();
    const refresh = () =>
      void api<Models>("/translation-settings", { signal: controller.signal })
        .then((config) => {
          if (!alive.current) return;
          setModels(config.models ?? []);
          setModelId(config.active_id || config.models?.[0]?.id || "");
        })
        .catch(() => {});
    window.addEventListener("model-settings-updated", refresh);
    return () => {
      controller.abort();
      window.removeEventListener("model-settings-updated", refresh);
    };
  }, []);

  // What is waited for: the draft of the guide that is being written, or else
  // the preparation to start one. Both stop at once when it is no longer so.
  const draftId = isRunning(artifact) ? (artifact?.id ?? "") : "";
  const waiting = artifact === null && preparing(preparation);
  useEffect(() => {
    if (!loaded || (!draftId && !waiting)) return;
    const controller = new AbortController();
    const { signal } = controller;
    const interval = draftId ? DRAFT_INTERVAL : PREPARATION_INTERVAL;
    let live = true;
    let timer = 0;
    const next = (delay: number) => {
      timer = window.setTimeout(tick, delay);
    };
    const tick = async () => {
      if (!live) return;
      // A hidden tab does not ask; it looks again when it may be seen.
      if (document.hidden) return next(interval);
      try {
        if (draftId) {
          const row = await api<GuideArtifact>(
            `/reading-artifacts/${draftId}`,
            {
              signal,
            },
          );
          if (!live) return;
          setArtifact(row);
        } else {
          const [rows, state] = await Promise.all([
            api<GuideArtifact[]>(`/papers/${paperId}/reading-artifacts`, {
              signal,
            }),
            api<Preparation>(`/papers/${paperId}/preparation`, { signal }),
          ]);
          if (!live) return;
          setPreparation(state);
          setArtifact(pickGuide(rows, fileId));
        }
        next(interval);
      } catch {
        if (live) next(RETRY_INTERVAL);
      }
    };
    next(interval);
    return () => {
      live = false;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [loaded, draftId, waiting, paperId, fileId]);

  const asking = useRef(false);
  const generate = useCallback(
    (again: boolean) => {
      if (!modelId || asking.current) return;
      asking.current = true;
      setBusy(true);
      setError("");
      post(`/papers/${paperId}/reading-artifacts`, {
        file_id: fileId,
        model_config_id: modelId,
        kind: "guide",
        ...(again ? { regenerate: true } : {}),
      })
        .then((row) => {
          if (alive.current) setArtifact(row as GuideArtifact);
        })
        .catch((reason) => {
          if (alive.current) setError(message(reason));
        })
        .finally(() => {
          asking.current = false;
          if (alive.current) setBusy(false);
        });
    },
    [paperId, fileId, modelId],
  );

  const retry = useCallback(() => {
    if (loadError !== null) setReloads((count) => count + 1);
    else generate(true);
  }, [loadError, generate]);

  return {
    view: guideView({
      loaded,
      loadError,
      models: models?.length ?? 0,
      preparation,
      artifact,
    }),
    busy,
    error,
    generate,
    retry,
  };
}
