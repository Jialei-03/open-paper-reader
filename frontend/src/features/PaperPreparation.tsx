import { useEffect, useState } from "react";
import { api, send } from "../api";
import { Button } from "../components/ui/button";
import { Switch } from "../components/ui/switch";
import { Field, FieldDescription, FieldLabel } from "../components/ui/field";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover";
import { LoaderCircle, Check, Pause, Play, RefreshCw } from "lucide-react";

type Preparation = {
  enabled: boolean;
  status: "waiting" | "queued" | "running" | "completed" | "failed" | "paused";
  stage: string;
  error: string;
  completed: number;
  total: number;
  guide_status: string;
  translation_status: string;
  layout_status: string;
};
const statusNames: Record<string, string> = {
  waiting: "等待准备",
  queued: "排队中",
  running: "准备中",
  completed: "已就绪",
  failed: "需要重试",
  paused: "已暂停",
  pending: "等待准备",
  unavailable: "暂不可用",
};

export function PaperPreparation({
  paperId,
  versionId,
}: {
  paperId: string;
  versionId: string;
}) {
  const [state, setState] = useState<Preparation | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    setState(null);
    setError("");
    const load = async () => {
      try {
        const next = await api<Preparation>(`/papers/${paperId}/preparation`, {
          signal: controller.signal,
        });
        if (!live) return;
        setState(next);
        window.dispatchEvent(
          new CustomEvent("paper-preparation-updated", { detail: paperId }),
        );
        timer = setTimeout(
          load,
          ["running", "queued", "waiting"].includes(next.status) ? 3000 : 15000,
        );
      } catch {
        // Offline reading remains usable; retry when the page is visible or online.
        if (live) timer = setTimeout(load, 15000);
      }
    };
    const refresh = () => {
      clearTimeout(timer);
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("online", refresh);
    // The worker schedules imports independently. Opening a paper only promotes it.
    void send(`/papers/${paperId}/preparation`, {}).catch(() => {});
    void load();
    return () => {
      live = false;
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [paperId, versionId]);
  async function action(action: "pause" | "resume" | "retry") {
    setBusy(true);
    setError("");
    try {
      await send(`/papers/${paperId}/preparation`, { action });
      setState(await api<Preparation>(`/papers/${paperId}/preparation`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!state) return null;
  const processing =
    state.enabled && ["queued", "running", "waiting"].includes(state.status);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" aria-label="论文准备进度">
          {processing ? (
            <LoaderCircle className="animate-spin" />
          ) : state.status === "completed" ? (
            <Check />
          ) : (
            <Pause />
          )}
          <span className="hidden sm:inline">
            {!state.enabled && state.status !== "completed"
              ? "自动准备已关闭"
              : statusNames[state.status]}
          </span>
          {state.total > 0 && processing && (
            <span>
              {state.completed}/{state.total}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="space-y-3" aria-label="论文自动准备">
          <p className="font-medium">导读与翻译</p>
          <dl className="space-y-2 text-sm">
            {[
              ["导读", state.guide_status],
              ["共用正文译文", state.translation_status],
              ["布局 PDF", state.layout_status],
            ].map(([label, status]) => (
              <div className="flex justify-between gap-3" key={label}>
                <dt>{label}</dt>
                <dd>{statusNames[status] || status || "等待准备"}</dd>
              </div>
            ))}
          </dl>
          {state.stage && (
            <p className="text-sm text-muted-foreground">{state.stage}</p>
          )}
          {state.total > 0 && (
            <progress
              aria-label="正文翻译进度"
              className="w-full"
              value={state.completed}
              max={state.total}
            />
          )}
          {(error || state.error) && (
            <p role="alert" className="text-sm text-destructive">
              {error || state.error}
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            对照翻译和布局翻译共用正文译文。关闭页面后仍会继续，已完成的内容会保留。
          </p>
          {state.status === "paused" ? (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => void action("resume")}
            >
              <Play />
              继续准备
            </Button>
          ) : state.status === "failed" ? (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => void action("retry")}
            >
              <RefreshCw />
              重试未完成部分
            </Button>
          ) : processing ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void action("pause")}
            >
              <Pause />
              暂停本篇
            </Button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function PreparationSettings() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    void api<{ enabled: boolean }>("/preparation-settings")
      .then((value) => {
        if (live) setEnabled(value.enabled);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return (
    <Field className="my-6">
      <div className="flex items-center justify-between gap-4">
        <FieldLabel htmlFor="automatic-paper-preparation">
          自动准备导读与翻译
        </FieldLabel>
        <Switch
          id="automatic-paper-preparation"
          checked={enabled === true}
          disabled={enabled === null || busy}
          onCheckedChange={async (next) => {
            setBusy(true);
            setError("");
            try {
              const value = await send(
                "/preparation-settings",
                { enabled: next },
                "PATCH",
              );
              setEnabled(value.enabled);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        />
      </div>
      <FieldDescription>
        导入后自动准备，并补齐文库中缺少的导读、对照译文和布局
        PDF。使用默认翻译模型，已完成结果自动复用。
      </FieldDescription>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </Field>
  );
}
