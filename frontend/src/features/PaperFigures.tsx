import { PageStructure } from "./PageStructure";
import { useEffect, useState } from "react";
import { api, type Paper, type SourceFile } from "../api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Choice } from "../components/Choice";
import { Alert, AlertDescription } from "../components/ui/alert";
import type { ReaderRequest } from "../lib/reader-agent";
import "./paper-figures.css";

type Caption = { page: number; quote: string; kind: "figure" | "table" };
type Asset = { id: string; asset: string; supported: boolean };
/**
 * Figures and tables of the paper: the page in view first (recognised from the
 * page image), then every caption found in the text. Explaining one opens the
 * 解释 panel, like explaining any other selection.
 */
export function PaperFigures({
  paper,
  files,
  onLocate,
  currentFileId,
  currentPage = 1,
}: {
  paper: Paper;
  files: SourceFile[];
  currentFileId?: string;
  currentPage?: number;
  onLocate: (
    fileId: string,
    page: number,
    quote?: string,
    rect?: number[],
  ) => void;
}) {
  const pdfs = files.filter((file) => file.mime === "application/pdf");
  const [fileId, setFileId] = useState(currentFileId || pdfs[0]?.id || "");
  const [assets, setAssets] = useState<Asset[]>([]),
    [captions, setCaptions] = useState<Caption[]>([]);
  const [query, setQuery] = useState(""),
    [error, setError] = useState("");
  const [assetError, setAssetError] = useState("");
  const [notice, setNotice] = useState(""),
    [loading, setLoading] = useState(false),
    [reload, setReload] = useState(0),
    [preview, setPreview] = useState<Asset | null>(null);
  const file = pdfs.find((row) => row.id === fileId);
  useEffect(() => {
    if (!pdfs.some((row) => row.id === fileId)) setFileId(pdfs[0]?.id || "");
  }, [files, fileId]);
  useEffect(() => {
    let live = true;
    setAssets([]);
    setAssetError("");
    api<{ source_images: Asset[] }>(`/papers/${paper.id}/figure-assets`)
      .then((data) => {
        if (live) setAssets(data.source_images);
      })
      .catch((e) => {
        if (live) setAssetError(e.message);
      });
    return () => {
      live = false;
    };
  }, [paper.id, reload]);
  useEffect(() => {
    if (!fileId) return;
    let live = true;
    setLoading(true);
    setCaptions([]);
    setError("");
    api<{
      items: Caption[];
      pages_scanned: number;
      total_pages: number;
      limited: boolean;
    }>(`/files/${fileId}/figure-captions`)
      .then((data) => {
        if (live) {
          setCaptions(data.items);
          setNotice(
            `已检查 ${data.pages_scanned} / ${data.total_pages} 页${data.limited ? "（已达检查上限）" : ""}。按图表编号找标题，扫描件或复杂排版可能遗漏。`,
          );
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [fileId, reload]);
  function explain(caption?: Caption, asset?: Asset) {
    if (!file) return;
    const prompt = asset
      ? `请使用 view_image 查看这篇论文的 LaTeX 源码图片：文件 ID ${asset.id}，asset 为 ${JSON.stringify(asset.asset)}。解释图中结构、变量和论文上下文；不能仅凭文件名猜测。不要自动新建笔记。`
      : `请查看论文第 ${caption!.page} 页，解释图表“${caption!.quote}”，说明坐标、变量、结论及局限，给出原文依据。不要自动新建笔记。`;
    window.dispatchEvent(
      new CustomEvent<ReaderRequest>("reader-explanation", {
        detail: {
          context: {
            category: caption?.kind === "table" ? "table" : "image",
            paper_id: paper.id,
            file_id: file.id,
            version_id: file.version_id,
            page: caption?.page || 1,
            source: caption ? "selection" : "paper",
            action: "explain",
            ...(caption ? { quote: caption.quote } : {}),
          },
          label: asset
            ? `${paper.title} · ${asset.asset}`
            : `${paper.title} · ${caption!.quote}`,
          prompt,
        },
      }),
    );
  }
  const visibleCaptions = captions.filter((row) =>
    row.quote.toLowerCase().includes(query.toLowerCase()),
  );
  const visibleAssets = assets.filter((row) =>
    row.asset.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <section className="paper-figures" aria-label="图表与解释">
      {(error || assetError) && (
        <Alert variant="destructive">
          <AlertDescription>
            {error || assetError}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setReload((n) => n + 1)}
            >
              重试
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {/* One PDF has nothing to choose; never show its stored name. */}
      {pdfs.length > 1 && (
        <Choice
          aria-label="图表来源 PDF"
          value={fileId}
          onValueChange={setFileId}
        >
          {pdfs.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </Choice>
      )}
      {file && (
        <PageStructure
          key={file.id}
          file={file}
          page={file.id === currentFileId ? currentPage : 1}
          title={paper.title}
          onLocate={onLocate}
        />
      )}
      <h3>全文图表</h3>
      <Input
        aria-label="搜索图表"
        placeholder="搜索图表标题"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <p className="paper-tools-caption">{notice}</p>
      {loading && <p role="status">正在查找图表…</p>}
      {visibleCaptions.map((row, index) => (
        <article key={`${fileId}:${index}`}>
          <small>
            {row.kind === "table" ? "表格" : "图"} · 第 {row.page} 页
          </small>
          {/* Soft hyphens from the PDF's text layer show up as stray glyphs. */}
          <p>{row.quote.replace(/\u00ad/g, "")}</p>
          <div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onLocate(fileId, row.page, row.quote)}
            >
              定位原文
            </Button>
            <Button variant="ghost" size="sm" onClick={() => explain(row)}>
              解释
            </Button>
          </div>
        </article>
      ))}
      {!loading && !visibleCaptions.length && !error && (
        <p className="paper-tools-caption">
          没有找到带编号的图表标题。可以用侧栏的「框选」直接选取图表，再点「解释」。
        </p>
      )}
      {assets.length > 0 && (
        <details className="paper-source-images">
          <summary>论文源码里的图片 · {assets.length}</summary>
          {!visibleAssets.length && (
            <p className="paper-tools-caption">没有匹配的图片。</p>
          )}
          {visibleAssets.map((asset) => (
            <article key={asset.id + asset.asset}>
              <p>{asset.asset}</p>
              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!asset.supported}
                  onClick={() => setPreview(preview === asset ? null : asset)}
                >
                  预览
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!asset.supported || !file}
                  onClick={() => explain(undefined, asset)}
                >
                  解释
                </Button>
              </div>
              {!asset.supported && (
                <small>此格式暂不支持预览，请查看 PDF 原文。</small>
              )}
              {preview === asset && (
                <img
                  alt={asset.asset}
                  src={`/api/v1/agent/files/${asset.id}/image?${new URLSearchParams({ page: "1", asset: asset.asset })}`}
                  onError={() => setError("图片预览失败，请稍后重试")}
                />
              )}
            </article>
          ))}
        </details>
      )}
    </section>
  );
}
