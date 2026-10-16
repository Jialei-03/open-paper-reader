import { recentPapers } from "../lib/recent-papers";
import { owningPaper } from "../lib/organization";
import type { Item } from "../api";
import { LibraryCollections } from "./LibraryCollections";
import { PreparationOverviewLink } from "./PreparationOverview";
import { Checkbox } from "@/components/ui/checkbox";
import { PaperBatchActions } from "../components/PaperBatchActions";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { ReadingBadge } from "../components/ContentBadge";
import { PaperCover } from "./PaperCover";
import { PaperTable } from "../components/PaperTable";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import "./library.css";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  InputGroup,
  InputGroupInput,
  InputGroupAddon,
} from "@/components/ui/input-group";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Choice } from "@/components/Choice";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  SlidersHorizontal,
  ListChecks,
  Info,
  ChevronDown,
  Rows2,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  LayoutGrid,
  List,
  Plus,
  Search,
  Star,
  X,
} from "lucide-react";
import { api, date, Paper, statusLabel } from "../api";
import { Empty } from "../components/shared";

function bibtex(papers: Paper[]) {
  const escape = (text: string) =>
    text
      .replace(/[{}\\]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  return papers
    .map(
      (p) =>
        `@misc{paper_${p.id.replace(/-/g, "")},\n  title = {${escape(p.title)}},\n  author = {${escape(p.authors).replace(/;/g, " and ")}},\n  note = {${escape(p.external_id)}}\n}`,
    )
    .join("\n\n");
}
function shortAuthors(text: string) {
  const list = text
    .split(/[;；]/)
    .map((x) => x.trim())
    .filter(Boolean);
  if (!list.length) return "作者待补充";
  return list.length > 3
    ? list.slice(0, 3).join("、") + " 等 " + list.length + " 人"
    : list.join("、");
}
export function LibraryView({
  tick,
  route,
  go,
  add,
  onError,
  allPapers,
  toggleFavorite,
  onUpdated,
  recent = false,
  ownerId = "",
  notes = [],
}: {
  recent?: boolean;
  ownerId?: string;
  notes?: Item[];
  tick: number;
  route: string;
  go: (r: string) => void;
  add: () => void;
  onError: (s: string) => void;
  allPapers: Paper[];
  toggleFavorite: (p: Paper) => Promise<unknown>;
  onUpdated: () => void;
}) {
  const [collectionFilter, setCollectionFilter] = useState<{
    ids: string[] | null;
    label: string;
  }>({ ids: null, label: "" });
  const filterCollection = useCallback(
    (ids: string[] | null, label: string) =>
      setCollectionFilter({ ids, label }),
    [],
  );
  const [batch, setBatch] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const toggleSelection = (id: string) =>
    setSelectedIds((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const params = new URLSearchParams(route.split("?")[1]);
  const q = params.get("q") || "",
    status =
      params.get("status") === "queued" ? "unread" : params.get("status") || "",
    tag = params.get("tag") || "";
  const archived = params.get("archived") === "true",
    favorite = params.get("favorite") === "true";
  const visits = useMemo(() => recentPapers(ownerId), [ownerId, route, tick]);
  const notesByPaper = useMemo(() => {
    const result: Record<string, { id: string; count: number }> = {};
    for (const note of notes.filter((row) => row.kind === "note")) {
      const paperId = owningPaper(note);
      if (paperId)
        result[paperId] = {
          id: result[paperId]?.id || note.id,
          count: (result[paperId]?.count || 0) + 1,
        };
    }
    return result;
  }, [notes]);
  const sort = params.get("sort") || (recent ? "recent" : "updated"),
    view = params.get("view") === "grid" ? "grid" : "list";
  const detailed = params.get("density") === "detailed";
  const [searchOpen, setSearchOpen] = useState(!!q);
  const pageNumber = Math.max(1, Math.floor(Number(params.get("page"))) || 1);
  const [papers, setPapers] = useState<Paper[] | null>(null),
    [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState(""),
    [retry, setRetry] = useState(0),
    [pending, setPending] = useState<string[]>([]);
  const update = (values: Record<string, string>) => {
    setSelectedIds(new Set());
    const next = new URLSearchParams(route.split("?")[1]);
    next.delete("page");
    Object.entries(values).forEach(([key, value]) => {
      if (value && value !== "false") next.set(key, value);
      else next.delete(key);
    });
    window.history.replaceState(
      null,
      "",
      (recent ? "#dashboard" : "#library") + (next.size ? "?" + next : ""),
    );
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  };
  const loadedQuery = useRef<string | null>(null);
  const queryKey = JSON.stringify([q, status, tag, archived, favorite]);
  useEffect(() => {
    const controller = new AbortController();
    const foreground = loadedQuery.current !== queryKey;
    if (foreground) setLoading(true);
    setFailure("");
    const timer = setTimeout(() => {
      api<Paper[]>(
        "/papers?" +
          new URLSearchParams({
            q,
            status,
            tag,
            archived: String(archived),
            favorite: String(favorite),
          }),
        { signal: controller.signal },
      )
        .then((data) => {
          loadedQuery.current = queryKey;
          setPapers(data);
          setLoading(false);
        })
        .catch((error) => {
          if (error.name !== "AbortError") {
            if (foreground) setFailure(error.message);
            setLoading(false);
          }
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [tick, q, status, tag, archived, favorite, retry, queryKey]);
  const sorted = useMemo(
    () =>
      [...(papers || [])]
        .filter(
          (p) =>
            collectionFilter.ids === null ||
            collectionFilter.ids.includes(p.id),
        )
        .sort((a, b) =>
          sort === "recent"
            ? (visits[b.id] || 0) - (visits[a.id] || 0) ||
              b.updated_at.localeCompare(a.updated_at)
            : sort === "title"
              ? a.title.localeCompare(b.title, "zh-CN")
              : sort === "oldest"
                ? a.updated_at.localeCompare(b.updated_at)
                : b.updated_at.localeCompare(a.updated_at),
        ),
    [papers, sort, collectionFilter.ids, visits],
  );
  const pages = Math.max(1, Math.ceil(sorted.length / 18)),
    current = Math.min(pageNumber, pages);
  const visible = sorted.slice((current - 1) * 18, current * 18);
  const tags = [
    ...new Set([...allPapers, ...(papers || [])].flatMap((p) => p.tags)),
  ].sort();
  const filtered = !!(
    q ||
    status ||
    tag ||
    favorite ||
    archived ||
    collectionFilter.ids
  );
  const selectedPapers = sorted.filter((p) => selectedIds.has(p.id));
  const exportBib = (rows = sorted) => {
    const url = URL.createObjectURL(
      new Blob([bibtex(rows)], {
        type: "application/x-bibtex;charset=utf-8",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "paper-workspace.bib";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className={`page library-page${recent ? " recent-page" : ""}`}>
      <div className="library-heading-row">
        <div className="library-title-group">
          <h1>{recent ? "最近" : "我的文库"}</h1>
          {recent && (
            <span
              tabIndex={0}
              className="recent-info"
              aria-label="最近打开仅记录此设备；无打开记录时按更新时间排列"
              title="最近打开仅记录此设备；无打开记录时按更新时间排列"
            >
              <Info size={14} />
            </span>
          )}
          <div className="library-scope-inline">
            {!recent && (
              <>
                <Choice
                  aria-label="文库范围"
                  value={archived ? "archived" : favorite ? "favorite" : "all"}
                  onValueChange={(value) =>
                    update({
                      archived: String(value === "archived"),
                      favorite: String(value === "favorite"),
                    })
                  }
                >
                  <option value="all">全部论文</option>
                  <option value="favorite">收藏</option>
                  <option value="archived">已归档</option>
                </Choice>
              </>
            )}
            <span role="status">
              {loading ? "正在查找论文…" : `${sorted.length} 篇论文`}
            </span>
          </div>
        </div>
        <div className="library-tools">
          <Button
            variant="ghost"
            size="sm"
            aria-label="批量管理"
            title="批量管理"
            aria-pressed={batch}
            onClick={() => {
              setBatch((v) => !v);
              setSelectedIds(new Set());
            }}
          >
            <ListChecks />
          </Button>
          <ToggleGroup
            type="single"
            value={view === "grid" ? "grid" : detailed ? "detailed" : "compact"}
            onValueChange={(value) => {
              if (value)
                update({
                  view: "list",
                  density: value === "detailed" ? "detailed" : "",
                });
            }}
            aria-label="列表密度"
            className="library-density"
            size="sm"
          >
            <ToggleGroupItem
              value="compact"
              aria-label="紧凑列表"
              title="紧凑列表"
            >
              <List />
            </ToggleGroupItem>
            <ToggleGroupItem
              value="detailed"
              aria-label="详细列表"
              title="详细列表"
            >
              <Rows2 />
            </ToggleGroupItem>
          </ToggleGroup>
          {searchOpen || q ? (
            <InputGroup className="library-search">
              <InputGroupInput
                autoFocus
                aria-label="搜索论文"
                placeholder="搜索论文…"
                value={q}
                onChange={(e) => update({ q: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Escape" && !q) setSearchOpen(false);
                }}
              />
              <InputGroupAddon>
                <Search aria-hidden="true" />
              </InputGroupAddon>
              <InputGroupAddon align="inline-end">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={q ? "清空搜索" : "收起搜索"}
                  onClick={() => {
                    update({ q: "" });
                    setSearchOpen(false);
                  }}
                >
                  <X aria-hidden="true" />
                </Button>
              </InputGroupAddon>
            </InputGroup>
          ) : (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="搜索论文"
              title="搜索论文"
              onClick={() => setSearchOpen(true)}
            >
              <Search />
            </Button>
          )}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" aria-label="筛选与排序">
                <SlidersHorizontal />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="library-filter-popover flex flex-col gap-3"
            >
              <span className="text-sm font-medium">筛选与排序</span>
              {recent && (
                <>
                  <Choice
                    aria-label="文库范围"
                    value={
                      archived ? "archived" : favorite ? "favorite" : "all"
                    }
                    onValueChange={(value) =>
                      update({
                        archived: String(value === "archived"),
                        favorite: String(value === "favorite"),
                      })
                    }
                  >
                    <option value="all">全部论文</option>
                    <option value="favorite">收藏</option>
                    <option value="archived">已归档</option>
                  </Choice>
                </>
              )}
              <Choice
                aria-label="阅读状态筛选"
                className="filter-choice"
                value={status}
                onValueChange={(value) => update({ status: value })}
              >
                <option value="">阅读状态</option>
                {["unread", "reading", "read"].map((s) => (
                  <option key={s} value={s}>
                    {statusLabel[s]}
                  </option>
                ))}
              </Choice>
              <Input
                className="tag-filter"
                list="library-tags"
                aria-label="标签筛选"
                placeholder="筛选标签"
                value={tag}
                onChange={(e) => update({ tag: e.target.value })}
              />
              <datalist id="library-tags">
                {tags.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
              <Choice
                aria-label="论文排序"
                className="sort-choice"
                value={sort}
                onValueChange={(value) => update({ sort: value })}
              >
                {recent && <option value="recent">最近打开（此设备）</option>}
                <option value="updated">最近更新</option>
                <option value="oldest">最久未回顾</option>
                <option value="title">标题 A-Z</option>
              </Choice>
              {recent && (
                <Button variant="ghost" onClick={() => go("library")}>
                  管理文库集合
                </Button>
              )}
            </PopoverContent>
          </Popover>
          <div className="library-import-group">
            <Button size="sm" className="library-import" onClick={add}>
              <Plus aria-hidden="true" />
              导入论文
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  size="icon-sm"
                  className="library-import-menu"
                  aria-label="更多文库操作"
                >
                  <ChevronDown />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="library-actions-popover">
                <Button
                  variant="ghost"
                  disabled={!sorted.length || loading}
                  onClick={() => exportBib()}
                >
                  <Download />
                  导出 BibTeX
                </Button>
                <Button
                  variant="ghost"
                  onClick={() =>
                    update({ view: view === "grid" ? "list" : "grid" })
                  }
                >
                  {view === "grid" ? <List /> : <LayoutGrid />}
                  {view === "grid" ? "列表视图" : "卡片视图"}
                </Button>
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <PreparationOverviewLink go={go} />
      </div>
      {filtered && (
        <div className="active-filters">
          <span>{tag ? `标签：${tag}` : "已应用筛选"}</span>
          <Button
            variant="ghost"
            size="xs"
            onClick={() =>
              update({
                q: "",
                status: "",
                tag: "",
                favorite: "",
                archived: "",
              })
            }
          >
            <X aria-hidden="true" />
            清除筛选
          </Button>
        </div>
      )}
      {!recent && (
        <>
          <LibraryCollections
            tick={tick}
            selectedIds={[...selectedIds]}
            onFilter={filterCollection}
            onError={onError}
          />
        </>
      )}
      {batch && selectedPapers.length > 0 && (
        <PaperBatchActions
          papers={selectedPapers}
          onClear={() => setSelectedIds(new Set())}
          onError={onError}
          onExport={() => exportBib(selectedPapers)}
          onUpdated={(updated) => {
            setPapers((old) =>
              (old || []).map((p) => updated.find((x) => x.id === p.id) || p),
            );
            onUpdated();
            setRetry((n) => n + 1);
          }}
        />
      )}
      {failure ? (
        <div className="empty" role="alert">
          <p>文库加载失败：{failure}</p>
          <Button variant="outline" onClick={() => setRetry((n) => n + 1)}>
            重新加载
          </Button>
        </div>
      ) : loading ? (
        <div
          className="library-loading"
          aria-busy="true"
          aria-label="正在加载论文"
        >
          {[1, 2, 3, 4].map((n) => (
            <Card className="paper-card" key={n}>
              <div className="skeleton-content">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            </Card>
          ))}
        </div>
      ) : visible.length ? (
        <>
          {view === "list" ? (
            <PaperTable
              selection={
                batch
                  ? {
                      ids: selectedIds,
                      toggle: toggleSelection,
                      togglePage: () =>
                        setSelectedIds((old) => {
                          const next = new Set(old);
                          const all = visible.every((p) => old.has(p.id));
                          visible.forEach((p) =>
                            all ? next.delete(p.id) : next.add(p.id),
                          );
                          return next;
                        }),
                    }
                  : undefined
              }
              recentVisits={recent ? visits : undefined}
              notesByPaper={notesByPaper}
              detailed={detailed}
              papers={visible}
              go={go}
              toggleFavorite={toggleFavorite}
              onError={onError}
            />
          ) : (
            <div className="paper-grid">
              {visible.map((p) => (
                <Card className="paper-card" key={p.id}>
                  <button
                    type="button"
                    className="paper-card-open"
                    aria-label={"阅读：" + p.title}
                    onClick={() => go("paper/" + p.id)}
                  >
                    <PaperCover
                      paperId={p.id}
                      versionId={p.current_version}
                      title={p.title}
                    />
                  </button>
                  <div className="paper-card-body">
                    <div className="paper-card-top">
                      {batch && (
                        <Checkbox
                          aria-label={"选择论文：" + p.title}
                          checked={selectedIds.has(p.id)}
                          onCheckedChange={() => toggleSelection(p.id)}
                        />
                      )}
                      <span className="paper-card-source">
                        <FileText aria-hidden="true" />
                        {p.external_id || "本地论文"}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className={p.favorite ? "favorite active" : "favorite"}
                        aria-label={
                          (p.favorite ? "取消收藏：" : "收藏：") + p.title
                        }
                        aria-pressed={p.favorite}
                        disabled={pending.includes(p.id)}
                        onClick={async () => {
                          setPending((ids) => [...ids, p.id]);
                          try {
                            await toggleFavorite(p);
                          } catch (e) {
                            onError((e as Error).message);
                          } finally {
                            setPending((ids) =>
                              ids.filter((id) => id !== p.id),
                            );
                          }
                        }}
                      >
                        <Star
                          aria-hidden="true"
                          fill={p.favorite ? "currentColor" : "none"}
                        />
                      </Button>
                    </div>
                    <button
                      type="button"
                      className="paper-card-text"
                      onClick={() => go("paper/" + p.id)}
                    >
                      <h2>{p.title}</h2>
                      <span className="paper-card-authors">
                        {shortAuthors(p.authors)}
                      </span>
                      <p>{p.abstract || ""}</p>
                    </button>
                    {p.tags.length > 0 && (
                      <div className="paper-card-tags">
                        {p.tags.map((t) => (
                          <Button
                            key={t}
                            className="paper-tag max-w-full"
                            title={t}
                            size="xs"
                            variant="secondary"
                            onClick={() => update({ tag: t })}
                          >
                            <span className="truncate">{t}</span>
                          </Button>
                        ))}
                      </div>
                    )}
                    <div className="paper-card-foot">
                      <ReadingBadge status={p.reading_status} />
                      <time dateTime={p.updated_at}>{date(p.updated_at)}</time>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="library-empty">
          <Empty text={filtered ? "没有匹配的论文" : "文库为空"} />
          <Button
            variant="outline"
            onClick={
              filtered
                ? () =>
                    update({
                      q: "",
                      status: "",
                      tag: "",
                      favorite: "",
                      archived: "",
                    })
                : add
            }
          >
            {filtered ? "清除筛选" : "导入第一篇论文"}
          </Button>
        </div>
      )}
      {pages > 1 && (
        <nav className="pagination" aria-label="论文分页">
          <Button
            variant="ghost"
            disabled={current === 1}
            onClick={() => update({ page: String(current - 1) })}
          >
            <ChevronLeft aria-hidden="true" />
            上一页
          </Button>
          <span>
            {current} / {pages}
          </span>
          <Button
            variant="ghost"
            disabled={current === pages}
            onClick={() => update({ page: String(current + 1) })}
          >
            下一页
            <ChevronRight aria-hidden="true" />
          </Button>
        </nav>
      )}
    </div>
  );
}
