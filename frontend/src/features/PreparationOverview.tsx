import { useEffect, useState } from "react";
import {
  Check,
  ListChecks,
  LoaderCircle,
  Pause,
  Play,
  RefreshCw,
} from "lucide-react";
import { send } from "../api";
import { Button } from "../components/ui/button";
import "./preparation-overview.css";
import {
  preparationNames,
  usePreparations,
  type Preparation,
  type PreparationFilter,
} from "../lib/preparation";

export function PreparationOverviewLink({
  go,
}: {
  go: (route: string) => void;
}) {
  const { data } = usePreparations();
  return (
    <Button size="sm" variant="ghost" onClick={() => go("preparations")}>
      <ListChecks />
      准备任务
      {data && (
        <span className="text-muted-foreground">
          {data.summary.failed
            ? `${data.summary.failed} 篇待重试`
            : data.summary.active
              ? `${data.summary.active} 篇准备中`
              : `${data.summary.completed} 篇已就绪`}
        </span>
      )}
    </Button>
  );
}

function Phase({
  name,
  status,
  completed,
  total,
  stage,
}: {
  name: string;
  status: string;
  completed?: number;
  total?: number;
  stage?: string;
}) {
  const active = ["queued", "running", "waiting"].includes(status);
  return (
    <div className="preparation-phase" data-status={status}>
      <div className="flex items-center justify-between gap-2 text-sm">
        <span>{name}</span>
        <span
          className={
            status === "failed" ? "text-destructive" : "text-muted-foreground"
          }
        >
          {preparationNames[status] || status}
        </span>
      </div>
      {total && total > 0 ? (
        <>
          <progress
            className="preparation-progress"
            aria-label={`${name}进度`}
            value={completed || 0}
            max={total}
          />
          <p className="text-xs text-muted-foreground">
            {completed || 0}/{total}
            {name === "正文翻译" ? " 页" : ""}
          </p>
        </>
      ) : (
        active && (
          <p className="text-xs text-muted-foreground">
            {status === "running" ? "正在处理" : "等待处理"}
          </p>
        )
      )}
      {stage && (
        <p className="break-words text-xs text-muted-foreground">{stage}</p>
      )}
    </div>
  );
}

export function PreparationOverview({ go }: { go: (route: string) => void }) {
  const [filter, setFilter] = useState<PreparationFilter>("all");
  const [page, setPage] = useState(0);
  const { data, error, refresh } = usePreparations(filter, page);
  useEffect(() => {
    if (data && page > 0 && page * 50 >= data.total)
      setPage(Math.max(0, Math.ceil(data.total / 50) - 1));
  }, [data, page]);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState("");
  async function action(
    row: Preparation,
    command: "pause" | "resume" | "retry",
  ) {
    const id = row.paper_id!;
    setBusy((old) => new Set(old).add(id));
    setActionError("");
    try {
      await send(`/papers/${id}/preparation`, { action: command });
      refresh();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy((old) => {
        const next = new Set(old);
        next.delete(id);
        return next;
      });
    }
  }
  return (
    <section className="page preparation-page" aria-label="论文准备任务总览">
      <header className="preparation-heading">
        <div>
          <h1 className="preparation-title">准备任务</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            统一查看导读、正文翻译和布局
            PDF。关闭页面后仍会继续，重试会复用已完成内容。
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh}>
          <RefreshCw />
          刷新
        </Button>
      </header>
      {data && !data.enabled && (
        <p role="status" className="text-sm text-muted-foreground">
          自动准备已关闭。可在空间设置中开启，已生成的内容仍然保留。
        </p>
      )}
      <div className="preparation-filters" aria-label="任务状态筛选">
        {(
          [
            ["all", "全部", "total"],
            ["active", "准备中", "active"],
            ["failed", "待重试", "failed"],
            ["paused", "已暂停", "paused"],
            ["completed", "已就绪", "completed"],
          ] as const
        ).map(([key, label, count]) => (
          <Button
            key={key}
            size="sm"
            variant={filter === key ? "secondary" : "ghost"}
            aria-pressed={filter === key}
            onClick={() => {
              setFilter(key);
              setPage(0);
            }}
          >
            {label}
            {data && ` ${data.summary[count] || 0}`}
          </Button>
        ))}
      </div>
      {(error || actionError) && (
        <p role="alert" className="text-sm text-destructive">
          {actionError || `任务状态暂时无法更新：${error}`}
        </p>
      )}
      {!data && !error && (
        <p role="status" className="flex gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          正在加载任务…
        </p>
      )}
      {data?.items.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {data.summary.total
            ? "这个状态下没有任务。"
            : "导入可读取的 PDF 后，自动准备任务会显示在这里。"}
        </p>
      )}
      {data?.items.map((row) => (
        <article
          key={row.id}
          className="preparation-row"
          aria-label={`准备任务：${row.title}`}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <Button
                variant="link"
                className="preparation-paper-title"
                onClick={() => go(`paper/${row.paper_id}`)}
              >
                {row.title}
              </Button>
              <p className="mt-1 break-words text-sm text-muted-foreground">
                {row.stage}
              </p>
            </div>
            <span className="flex items-center gap-1 text-sm">
              {row.status === "completed" && <Check className="size-4" />}
              {preparationNames[row.status] || row.status}
            </span>
          </div>
          <div className="preparation-phases">
            <Phase name="导读" status={row.guide_status} />
            <Phase
              name="正文翻译"
              status={row.translation_status}
              completed={row.completed}
              total={row.total}
            />
            <Phase
              name="布局 PDF"
              status={row.layout_status}
              completed={row.layout_progress?.completed}
              total={row.layout_progress?.total}
              stage={row.layout_progress?.stage}
            />
          </div>
          {row.error && (
            <p className="break-words text-sm text-destructive">{row.error}</p>
          )}
          {row.status !== "completed" && (
            <div className="preparation-actions">
              {row.status === "failed" ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy.has(row.paper_id!) || !data.enabled}
                  onClick={() => action(row, "retry")}
                >
                  <RefreshCw />
                  重试未完成部分
                </Button>
              ) : row.status === "paused" ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy.has(row.paper_id!) || !data.enabled}
                  onClick={() => action(row, "resume")}
                >
                  <Play />
                  继续准备
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy.has(row.paper_id!)}
                  onClick={() => action(row, "pause")}
                >
                  <Pause />
                  暂停本篇
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => go(`paper/${row.paper_id}`)}
              >
                打开论文
              </Button>
            </div>
          )}
        </article>
      ))}
      {data && data.total > 50 && (
        <nav
          className="flex flex-wrap items-center justify-center gap-3"
          aria-label="任务分页"
        >
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage((n) => n - 1)}
          >
            上一页
          </Button>
          <span className="text-sm">
            第 {page + 1} / {Math.ceil(data.total / 50)} 页
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={(page + 1) * 50 >= data.total}
            onClick={() => setPage((n) => n + 1)}
          >
            下一页
          </Button>
        </nav>
      )}
    </section>
  );
}
