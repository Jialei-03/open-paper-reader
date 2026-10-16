import {
  importArxiv,
  type ImportProgress as ImportState,
} from "../lib/arxiv-import";
import { ImportProgress } from "../components/ImportProgress";
import { useEffect, useRef, useState } from "react";
import {
  Bookmark,
  BookmarkCheck,
  Copy,
  Download,
  ExternalLink,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import { api, send, type Paper } from "../api";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Field, FieldLabel } from "../components/ui/field";
import { Alert, AlertDescription } from "../components/ui/alert";
import { Spinner } from "../components/ui/spinner";

type Citation = {
  title: string;
  abstract?: string;
  authors: string[];
  year: number | null;
  doi: string;
  arxiv: string;
  s2_id: string;
  saved_id?: string;
};
type Result = { items: Citation[]; next: number | null; source: string };
type Relation = "saved" | "references" | "citations";
const arxiv = (value: string) =>
  /^(?:\d{4}\.\d{4,5}|[a-zA-Z.-]+\/\d{7})(?:v\d+)?$/.test(value) ? value : "";
const sameCitation = (a: Citation, b: Citation) =>
  (a.doi && b.doi && a.doi.toLowerCase() === b.doi.toLowerCase()) ||
  (a.arxiv &&
    b.arxiv &&
    a.arxiv.replace(/v\d+$/, "") === b.arxiv.replace(/v\d+$/, "")) ||
  (a.s2_id && a.s2_id === b.s2_id) ||
  (!a.doi && !a.arxiv && !a.s2_id && a.title === b.title);
const escapeBib = (value: string) =>
  value
    .replace(/[\\{}%&#_$]/g, (c) =>
      c === "\\" ? "\\textbackslash{}" : "\\" + c,
    )
    .replace(/[\r\n]+/g, " ");
function bibtex(row: Citation) {
  const fields = [
    `title = {${escapeBib(row.title)}}`,
    `author = {${escapeBib(row.authors.join(" and "))}}`,
    ...(row.year ? [`year = {${row.year}}`] : []),
    ...(row.doi ? [`doi = {${escapeBib(row.doi)}}`] : []),
    ...(arxiv(row.arxiv)
      ? [`eprint = {${escapeBib(row.arxiv)}}`, "archivePrefix = {arXiv}"]
      : []),
  ];
  return `@article{paper${row.year || ""},\n  ${fields.join(",\n  ")}\n}\n`;
}

export function CitationCards({ paper }: { paper: Paper }) {
  const [relation, setRelation] = useState<Relation>("saved");
  const [saved, setSaved] = useState<Citation[]>([]);
  const [rows, setRows] = useState<Citation[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [savedLoading, setSavedLoading] = useState(true);
  const lookupVersion = useRef(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState<ImportState | null>(
    null,
  );
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    setRelation("saved");
    setQuery("");
    setSaved([]);
    setStatus("");
  }, [paper.id]);
  useEffect(() => {
    let alive = true;
    setSavedLoading(true);
    api<Result>(`/papers/${paper.id}/citations`)
      .then((data) => {
        if (alive) setSaved(data.items);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setSavedLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [paper.id]);
  useEffect(() => {
    let alive = true;
    lookupVersion.current += 1;
    setError("");
    setRows([]);
    setNext(null);
    if (relation === "saved") {
      setLoading(false);
      return;
    }
    setLoading(true);
    api<Result>(`/papers/${paper.id}/citations?relation=${relation}`)
      .then((data) => {
        if (alive) {
          setRows(data.items);
          setNext(data.next);
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [paper.id, relation, retry]);
  const visible = (relation === "saved" ? saved : rows).filter((row) =>
    `${row.title} ${row.authors.join(" ")} ${row.year || ""} ${row.doi} ${row.arxiv}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  async function action(row: Citation, operation: () => Promise<void>) {
    if (busy) return;
    setBusy(row.title);
    setError("");
    setStatus("");
    try {
      await operation();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className="flex min-h-0 flex-col gap-3 p-4" aria-label="引用卡片">
      <Tabs
        value={relation}
        onValueChange={(value) => {
          setRelation(value as Relation);
          setQuery("");
        }}
      >
        <TabsList className="w-full">
          <TabsTrigger value="saved">已保存</TabsTrigger>
          <TabsTrigger value="references">参考文献</TabsTrigger>
          <TabsTrigger value="citations">被引用</TabsTrigger>
        </TabsList>
      </Tabs>
      <Field>
        <FieldLabel htmlFor="citation-search" className="sr-only">
          搜索引用
        </FieldLabel>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <Input
            id="citation-search"
            className="pl-9"
            value={query}
            placeholder="搜索已加载的引用"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </Field>
      {relation !== "saved" && (
        <p className="text-xs text-muted-foreground">
          来源：Semantic Scholar · 只发送论文的公开 DOI 或 arXiv
          标识；检索范围可能不完整。
        </p>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            {error}
            <Button
              size="sm"
              variant="ghost"
              disabled={loading}
              onClick={() => {
                if (relation === "saved")
                  void api<Result>(`/papers/${paper.id}/citations`)
                    .then((data) => {
                      setSaved(data.items);
                      setError("");
                    })
                    .catch((e) => setError(e.message));
                else setRetry((value) => value + 1);
              }}
            >
              <RefreshCw />
              重试
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {status && (
        <p role="status" className="text-xs text-muted-foreground">
          {status}
        </p>
      )}
      {(relation === "saved" ? savedLoading : loading) && (
        <p
          role="status"
          className="flex items-center gap-2 text-sm text-muted-foreground"
        >
          <Spinner />
          正在加载引用…
        </p>
      )}
      {!(relation === "saved" ? savedLoading : loading) &&
        !error &&
        !visible.length && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {query
              ? "没有匹配的引用"
              : relation === "saved"
                ? "尚未保存引用，可从参考文献或被引用中添加。"
                : "公开引用库暂未返回文献。"}
          </p>
        )}
      <div className="flex flex-col divide-y">
        {visible.map((row, index) => {
          const stored = saved.find((entry) => sameCitation(entry, row));
          const archive = arxiv(row.arxiv);
          const doiUrl = /^10\.\d{4,9}\/\S+$/.test(row.doi)
            ? "https://doi.org/" + encodeURIComponent(row.doi)
            : "";
          const sourceUrl =
            doiUrl ||
            (archive
              ? "https://arxiv.org/abs/" + archive
              : /^[0-9a-f]{40}$/i.test(row.s2_id)
                ? "https://www.semanticscholar.org/paper/" + row.s2_id
                : "");
          return (
            <article
              key={
                row.saved_id || row.s2_id || row.doi || `${row.title}-${index}`
              }
              className="flex flex-col gap-2 py-4"
            >
              <h3 className="text-sm font-medium leading-relaxed">
                {sourceUrl ? (
                  <a
                    href={sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline"
                  >
                    {row.title}
                    <ExternalLink className="ml-1 inline size-3" />
                  </a>
                ) : (
                  row.title
                )}
              </h3>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {row.authors.join("; ") || "作者信息暂缺"}
                {row.year ? ` · ${row.year}` : ""}
              </p>
              {row.abstract ? (
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted-foreground">
                    查看摘要
                  </summary>
                  <p className="mt-2 whitespace-pre-wrap leading-relaxed">
                    {row.abstract}
                  </p>
                </details>
              ) : (
                <p className="text-xs text-muted-foreground">来源未提供摘要</p>
              )}
              <div className="flex flex-wrap items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!!busy}
                  aria-label={
                    (stored ? "取消保存：" : "保存引用：") + row.title
                  }
                  onClick={() =>
                    void action(row, async () => {
                      if (stored?.saved_id) {
                        await api(
                          `/papers/${paper.id}/citations/${stored.saved_id}`,
                          { method: "DELETE" },
                        );
                        setSaved((previous) =>
                          previous.filter(
                            (entry) => entry.saved_id !== stored.saved_id,
                          ),
                        );
                      } else {
                        const { saved_id: _saved, ...data } = row;
                        const result = await send(
                          `/papers/${paper.id}/citations`,
                          data,
                        );
                        setSaved((previous) => [
                          ...previous.filter(
                            (entry) => !sameCitation(entry, result),
                          ),
                          result,
                        ]);
                      }
                    })
                  }
                >
                  {stored ? <BookmarkCheck /> : <Bookmark />}
                  {stored ? "已保存" : "保存"}
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={"复制 BibTeX：" + row.title}
                  title="复制 BibTeX"
                  onClick={() =>
                    void action(row, async () => {
                      await navigator.clipboard.writeText(bibtex(row));
                      setStatus("BibTeX 已复制");
                    })
                  }
                >
                  <Copy />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={"下载 BibTeX：" + row.title}
                  title="下载 BibTeX"
                  onClick={() => {
                    const url = URL.createObjectURL(
                      new Blob([bibtex(row)], {
                        type: "application/x-bibtex;charset=utf-8",
                      }),
                    );
                    const link = document.createElement("a");
                    link.href = url;
                    link.download = "citation.bib";
                    link.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                  }}
                >
                  <Download />
                </Button>
                {archive && (
                  <>
                    <Button size="sm" variant="ghost" asChild>
                      <a
                        href={"https://arxiv.org/abs/" + archive}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        arXiv
                      </a>
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!!busy}
                      onClick={() =>
                        void action(row, async () => {
                          setImportProgress(null);
                          const imported = await importArxiv(
                            "https://arxiv.org/abs/" + archive,
                            setImportProgress,
                          );
                          window.location.hash = "paper/" + imported.id;
                          window.location.reload();
                        })
                      }
                    >
                      {busy === row.title ? <Spinner /> : <Plus />}
                      {busy === row.title ? "正在处理…" : "导入论文"}
                    </Button>
                    {busy === row.title && importProgress && (
                      <ImportProgress value={importProgress} />
                    )}
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {next !== null && relation !== "saved" && (
        <Button
          variant="outline"
          disabled={loading || !!busy}
          onClick={async () => {
            const version = lookupVersion.current;
            setLoading(true);
            setError("");
            try {
              const data = await api<Result>(
                `/papers/${paper.id}/citations?relation=${relation}&offset=${next}`,
              );
              if (version !== lookupVersion.current) return;
              setRows((previous) => [
                ...previous,
                ...data.items.filter(
                  (row) => !previous.some((entry) => sameCitation(entry, row)),
                ),
              ]);
              setNext(data.next);
            } catch (e) {
              if (version === lookupVersion.current)
                setError((e as Error).message);
            } finally {
              if (version === lookupVersion.current) setLoading(false);
            }
          }}
        >
          加载下一页
        </Button>
      )}
    </section>
  );
}
