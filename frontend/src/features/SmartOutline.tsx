import { useEffect, useState } from "react";
import { api, send, type SourceFile } from "../api";
import { Button } from "../components/ui/button";
import { Choice } from "../components/Choice";
import { Spinner } from "../components/ui/spinner";
import type { InferenceModel } from "./ModelOptions";
type Outline = {
  id: string;
  file_id: string;
  kind: string;
  status: string;
  error: string;
  run_id: string;
  result?: { entries: { title: string; page: number; level: number }[] };
  preview?: { entries?: { title: string; page: number; level: number }[] };
};
export function SmartOutline({
  file,
  navigate,
}: {
  file: SourceFile;
  navigate: (page: number) => void;
}) {
  const [models, setModels] = useState<InferenceModel[]>([]),
    [model, setModel] = useState(""),
    [row, setRow] = useState<Outline | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    setRow(null);
    setError("");
    Promise.all([
      api<{ models: InferenceModel[]; active_id: string }>(
        "/translation-settings",
      ),
      api<Outline[]>(`/papers/${file.paper_id}/reading-artifacts`),
    ])
      .then(([config, rows]) => {
        if (!live) return;
        setModels(config.models);
        setModel(config.active_id || config.models[0]?.id || "");
        setRow(
          rows.find((r) => r.kind === "outline" && r.file_id === file.id) ||
            null,
        );
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [file.id]);
  const running = !!row && ["queued", "running"].includes(row.status);
  useEffect(() => {
    if (!running || !row) return;
    let live = true;
    let timer: number;
    const poll = async () => {
      try {
        const next = await api<Outline>(`/reading-artifacts/${row.id}`);
        if (!live) return;
        setRow(next);
        if (["queued", "running"].includes(next.status))
          timer = window.setTimeout(poll, 700);
      } catch (e) {
        if (live) {
          setError((e as Error).message);
          timer = window.setTimeout(poll, 5000);
        }
      }
    };
    timer = window.setTimeout(poll, 700);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [running, row?.id, row?.run_id]);
  const entries =
    row?.status === "completed"
      ? row.result?.entries
      : running
        ? row?.preview?.entries
        : undefined;

  return (
    <div className="flex flex-col gap-2 p-2" aria-label="智能目录">
      {entries?.length ? (
        <ul>
          {entries.map((entry, i) => (
            <li key={i} className={running ? "streaming-item" : undefined}>
              <button
                style={{ paddingInlineStart: (entry.level - 1) * 12 + 8 }}
                onClick={() => navigate(entry.page)}
              >
                {entry.title}
                <small className="ml-2 text-muted-foreground">
                  {entry.page}
                </small>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            此 PDF 没有内嵌目录，可从原文生成章节导航。
          </p>
          <Choice
            aria-label="生成目录使用模型"
            value={model}
            onValueChange={setModel}
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name || m.model}
              </option>
            ))}
          </Choice>
        </>
      )}
      {(error || row?.error) && (
        <p role="alert" className="text-xs text-destructive">
          {error || row?.error}
        </p>
      )}
      {running && (
        <p
          role="status"
          className="text-xs text-muted-foreground streaming-status"
        >
          {entries?.length
            ? `正在生成 · 已显示 ${entries.length} 个章节`
            : "正在读取章节…"}
        </p>
      )}
      {running ? (
        <Button
          variant="outline"
          size="sm"
          aria-label="生成中 · 停止"
          onClick={async () => {
            try {
              await send(`/agent/runs/${row!.run_id}/cancel`, {});
              setRow(await api(`/reading-artifacts/${row!.id}`));
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <Spinner />
          生成中 · 停止
        </Button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          disabled={busy || !model}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              setRow(
                await send(`/papers/${file.paper_id}/reading-artifacts`, {
                  file_id: file.id,
                  model_config_id: model,
                  kind: "outline",
                  regenerate: !!row,
                }),
              );
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <Spinner /> : null}
          {row?.status === "completed" ? "重新生成目录" : "生成智能目录"}
        </Button>
      )}
    </div>
  );
}
