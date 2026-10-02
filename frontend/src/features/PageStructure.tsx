import { useEffect, useState } from "react";
import { api, send, type SourceFile } from "../api";
import { Button } from "../components/ui/button";
import { Alert, AlertDescription } from "../components/ui/alert";
import { Choice } from "../components/Choice";
import { askReader } from "../lib/reader-agent";

type Block = { kind: "picture" | "table" | "formula"; rect: number[] };
type Result = {
  status: string;
  blocks: Block[];
  error?: string;
  model?: string;
};
type Model = { id: string; name: string; model: string; vision?: boolean };
const labels = { picture: "图片", table: "表格", formula: "公式" };
export function PageStructure({
  file,
  page,
  title,
  onLocate,
}: {
  file: SourceFile;
  page: number;
  title: string;
  onLocate: (
    file: string,
    page: number,
    quote?: string,
    rect?: number[],
  ) => void;
}) {
  const [result, setResult] = useState<Result>({ status: "idle", blocks: [] });
  const [models, setModels] = useState<Model[]>([]);
  const [model, setModel] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let live = true;
    api<{ models: Model[]; active_id: string }>("/translation-settings")
      .then((data) => {
        if (!live) return;
        const available = data.models.filter((row) => row.vision);
        setModels(available);
        setModel(
          available.find((row) => row.id === data.active_id)?.id ||
            available[0]?.id ||
            "",
        );
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    setResult({ status: "idle", blocks: [] });
    setError("");
    const poll = async () => {
      try {
        const data = await api<Result>(
          `/files/${file.id}/structure?page=${page}`,
        );
        if (!live) return;
        setResult(data);
        if (data.status === "running") timer = setTimeout(poll, 2000);
      } catch (e) {
        if (live) setError((e as Error).message);
      }
    };
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [file.id, page, refresh]);
  return (
    <section className="flex flex-col gap-3" aria-label="当前页图表识别">
      <div className="flex items-center justify-between gap-2">
        <h3>第 {page} 页的图表与公式</h3>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || result.status === "running" || !model}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await send(`/files/${file.id}/structure`, {
                page,
                model_config_id: model,
              });
              setRefresh((n) => n + 1);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy || result.status === "running"
            ? "正在识别…"
            : result.status === "completed"
              ? "重新识别"
              : "识别当前页"}
        </Button>
      </div>
      {/* One model needs no choosing. */}
      {models.length > 1 && (
        <Choice
          aria-label="图表识别模型"
          value={model}
          onValueChange={setModel}
        >
          {models.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name || row.model}
            </option>
          ))}
        </Choice>
      )}
      <p className="paper-tools-caption">
        用模型找出本页的图片、表格和公式，再逐个解释，通常需要几十秒。识别可能有偏差，请核对原图；也可以用侧栏的「框选」手动选取。
      </p>
      {!models.length && (
        <p className="paper-tools-caption">
          识别需要支持图片输入的模型，<a href="#settings">去模型设置添加</a>。
        </p>
      )}
      {(error || result.error) && (
        <Alert variant="destructive">
          <AlertDescription>{error || result.error}</AlertDescription>
        </Alert>
      )}
      {result.status === "running" && (
        <p role="status">正在定位图片、表格和公式，可继续阅读。</p>
      )}
      {result.status === "completed" && !result.blocks.length && (
        <p>未识别到带有效位置的图表或公式，可手动框选。</p>
      )}
      {result.blocks.map((block, index) => (
        <article key={index}>
          <small>
            {labels[block.kind]} {index + 1}
          </small>
          <img
            loading="lazy"
            alt={`${labels[block.kind]}选区预览`}
            src={`/api/v1/agent/files/${file.id}/image?${new URLSearchParams({ page: String(page), rect: block.rect.join(",") })}`}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onLocate(file.id, page, undefined, block.rect)}
            >
              定位原文
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                askReader(
                  file,
                  title,
                  {
                    page,
                    source: "region",
                    rect: block.rect,
                    category: block.kind === "picture" ? "image" : block.kind,
                  },
                  block.kind === "formula" ? "formula" : "explain",
                )
              }
            >
              解释{labels[block.kind]}
            </Button>
          </div>
        </article>
      ))}
    </section>
  );
}
