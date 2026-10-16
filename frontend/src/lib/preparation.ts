import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";

export type Preparation = {
  id?: string;
  paper_id?: string;
  title?: string;
  enabled: boolean;
  status: string;
  stage: string;
  error: string;
  completed: number;
  total: number;
  guide_status: string;
  translation_status: string;
  layout_status: string;
  layout_progress?: {
    status: string;
    stage: string;
    error: string;
    completed: number;
    total: number;
  } | null;
};
export const preparationNames: Record<string, string> = {
  waiting: "等待准备",
  queued: "排队中",
  running: "准备中",
  completed: "已就绪",
  failed: "需要重试",
  paused: "已暂停",
  cancelled: "已暂停",
  pending: "等待准备",
  unavailable: "暂不可用",
};
export type PreparationFilter =
  | "all"
  | "active"
  | "failed"
  | "completed"
  | "paused";
export type PreparationOverview = {
  enabled: boolean;
  summary: Record<string, number>;
  total: number;
  items: Preparation[];
};

export function usePreparations(filter: PreparationFilter = "all", page = 0) {
  const [data, setData] = useState<PreparationOverview | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const loadedKey = useRef("");
  const refresh = useCallback(() => setRevision((n) => n + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    let loading = false;
    const key = `${filter}:${page}`;
    if (loadedKey.current !== key) {
      setData(null);
      setError("");
      loadedKey.current = key;
    }
    const load = async () => {
      if (loading || !live || document.hidden) return;
      loading = true;
      try {
        const next = await api<PreparationOverview>(
          `/preparations?status=${filter}&offset=${page * 50}&limit=50`,
          { signal: controller.signal },
        );
        if (!live) return;
        setData(next);
        setError("");
        timer = setTimeout(load, next.summary.active ? 3000 : 15000);
      } catch (e) {
        if (live) {
          setError((e as Error).message);
          timer = setTimeout(load, 15000);
        }
      } finally {
        loading = false;
      }
    };
    const visible = () => {
      clearTimeout(timer);
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("online", visible);
    void load();
    return () => {
      live = false;
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("online", visible);
    };
  }, [filter, page, revision]);
  return { data, error, refresh };
}
