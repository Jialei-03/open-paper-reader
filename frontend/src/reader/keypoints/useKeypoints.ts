import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api";
import { useI18n } from "../../i18n/I18nProvider";
import { serviceReason, serviceWords } from "../service-error";
import { useModel } from "../useModel";
import {
  guideDone,
  isWorking,
  pickKeypoints,
  readKeypoints,
  shown,
  type Category,
  type Keypoint,
  type KeypointArtifact,
} from "./keypoints";
import { useHiddenCategories, useKeypointsEnabled } from "./preference";

/** While the sentences are being found they are asked after this often; while the guide is, less. */
const WORKING_INTERVAL = 1500;
const GUIDE_INTERVAL = 3000;
const RETRY_INTERVAL = 5000;

export type KeypointState =
  | "off"
  | "loading"
  | "noModel"
  /** Nothing has been asked for yet (the guide is not written, or the reader stopped it). */
  | "idle"
  | "working"
  | "ready"
  | "failed";

export interface Keypoints {
  state: KeypointState;
  /** Every sentence found, whatever is hidden. */
  items: Keypoint[];
  /** Those whose category is shown. */
  visible: Keypoint[];
  hidden: ReadonlySet<Category>;
  toggle(category: Category): void;
  /** Why it failed, in a sentence. */
  error: string;
  busy: boolean;
  /** Finds the sentences (again, if they failed). */
  generate(): void;
}

const post = (path: string, body: unknown) =>
  api<KeypointArtifact>(path, { method: "POST", body: JSON.stringify(body) });

/**
 * The key sentences of a paper's PDF: read when the paper is opened, asked for
 * once its guide is written (so that two readings of the paper do not compete),
 * and followed while they are being found. Off, nothing is read or asked.
 */
export function useKeypoints(
  paperId: string | null,
  fileId: string | null,
): Keypoints {
  const i18n = useI18n();
  const model = useModel();
  const modelId = model.id;
  const [enabled] = useKeypointsEnabled();
  const [hidden, toggle] = useHiddenCategories();
  const [loaded, setLoaded] = useState(false);
  const [artifact, setArtifact] = useState<KeypointArtifact | null>(null);
  const [guideReady, setGuideReady] = useState(false);
  const [failure, setFailure] = useState<{ reason: unknown } | null>(null);
  const [busy, setBusy] = useState(false);
  const asked = useRef<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const key = paperId && fileId ? `${paperId}:${fileId}` : "";
  const live = enabled && key !== "";

  // What there is of them, read again while something is on the way.
  const waiting = loaded && artifact === null && !guideReady;
  const following = isWorking(artifact) ? (artifact?.id ?? "") : "";
  useEffect(() => {
    if (!live || !paperId || !fileId) return;
    const controller = new AbortController();
    const { signal } = controller;
    let on = true;
    let timer = 0;
    const read = async () => {
      try {
        const rows = await api<KeypointArtifact[]>(
          `/papers/${paperId}/reading-artifacts`,
          { signal },
        );
        if (!on) return false;
        setArtifact(pickKeypoints(rows, fileId));
        setGuideReady(guideDone(rows, fileId));
        setLoaded(true);
        return true;
      } catch {
        if (on && !signal.aborted) setLoaded(true);
        return false;
      }
    };
    const tick = async () => {
      if (!on) return;
      const interval = following ? WORKING_INTERVAL : GUIDE_INTERVAL;
      if (document.hidden) {
        timer = window.setTimeout(tick, interval);
        return;
      }
      const ok = await read();
      if (on && (following || waiting))
        timer = window.setTimeout(tick, ok ? interval : RETRY_INTERVAL);
    };
    // The first reading is at once; the following ones only while something is on the way.
    if (!loaded) void tick();
    else if (following || waiting)
      timer = window.setTimeout(
        tick,
        following ? WORKING_INTERVAL : GUIDE_INTERVAL,
      );
    return () => {
      on = false;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [live, paperId, fileId, loaded, following, waiting]);

  // Another paper: nothing of the last one is kept.
  useEffect(() => {
    setLoaded(false);
    setArtifact(null);
    setGuideReady(false);
    setFailure(null);
    setBusy(false);
  }, [key]);

  const generate = useCallback(() => {
    if (!paperId || !fileId || !modelId) return;
    setBusy(true);
    setFailure(null);
    post(`/papers/${paperId}/reading-artifacts`, {
      file_id: fileId,
      model_config_id: modelId,
      kind: "keypoints",
      ...(artifact && !isWorking(artifact) ? { regenerate: true } : {}),
    })
      .then((row) => {
        if (alive.current) setArtifact(row);
      })
      .catch((reason: unknown) => {
        if (alive.current) setFailure({ reason });
      })
      .finally(() => {
        if (alive.current) setBusy(false);
      });
  }, [paperId, fileId, modelId, artifact]);

  // Asked for once, by itself, when the guide is written and nothing has been asked yet for this PDF.
  useEffect(() => {
    if (!live || !loaded || !model.known || !modelId) return;
    if (artifact !== null || !guideReady || asked.current === key) return;
    asked.current = key;
    generate();
  }, [live, loaded, model.known, modelId, artifact, guideReady, key, generate]);

  const items = useMemo(
    () =>
      artifact
        ? readKeypoints(
            artifact.status === "completed"
              ? artifact.result
              : artifact.previous,
          )
        : [],
    [artifact],
  );
  const visible = useMemo(() => shown(items, hidden), [items, hidden]);

  let state: KeypointState;
  if (!live) state = "off";
  else if (!loaded || !model.known) state = "loading";
  else if (isWorking(artifact) || (busy && artifact === null))
    state = "working";
  else if (
    failure ||
    artifact?.status === "failed" ||
    artifact?.status === "cancelled"
  )
    state = "failed";
  else if (artifact?.status === "completed" && items.length > 0)
    state = "ready";
  else if (!modelId) state = "noModel";
  else state = "idle";

  let error = "";
  if (failure)
    error = serviceReason(failure.reason, i18n, {
      fallback: "reader.keypoints.failed",
    });
  else if (state === "failed")
    error =
      serviceWords(artifact?.error, i18n) || i18n.t("reader.keypoints.failed");

  return { state, items, visible, hidden, toggle, error, busy, generate };
}
