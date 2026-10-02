import { useState } from "react";
import {
  Archive,
  Star,
  Download,
  X,
  Tags,
  GitCompareArrows,
} from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Popover, PopoverTrigger, PopoverContent } from "./ui/popover";
import { Field, FieldLabel } from "./ui/field";
import { Paper, send } from "../api";

export function PaperBatchActions({
  papers,
  onClear,
  onUpdated,
  onError,
  onExport,
}: {
  papers: Paper[];
  onClear: () => void;
  onUpdated: (papers: Paper[]) => void;
  onError: (message: string) => void;
  onExport: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [tag, setTag] = useState("");
  const [tagOpen, setTagOpen] = useState(false);
  const apply = async (patch: (p: Paper) => Record<string, unknown>) => {
    if (busy) return;
    setBusy(true);
    const updated: Paper[] = [];
    const failed: string[] = [];
    for (const paper of papers) {
      try {
        updated.push(
          await send(
            `/papers/${paper.id}`,
            patch(paper),
            "PATCH",
            paper.revision,
          ),
        );
      } catch {
        failed.push(paper.title);
      }
    }
    onUpdated(updated);
    if (failed.length)
      onError(
        `${updated.length} 篇已更新，${failed.length} 篇未更新（可能已有新版本）：${failed.slice(0, 3).join("、")}。请刷新后重试。`,
      );
    else {
      onClear();
      setTagOpen(false);
      setTag("");
    }
    setBusy(false);
  };
  const allFavorite = papers.every((p) => p.favorite);
  const allArchived = papers.every((p) => p.archived);
  return (
    <div
      className="flex flex-wrap items-center gap-2 py-2"
      role="toolbar"
      aria-label="批量管理论文"
    >
      <span role="status">已选 {papers.length} 篇</span>
      <Button
        variant="outline"
        size="sm"
        disabled={busy || papers.length < 2 || papers.length > 5}
        title="选择 2–5 篇论文比较"
        onClick={() =>
          window.dispatchEvent(
            new CustomEvent("compare-research-papers", {
              detail: {
                prompt: `请实际读取以下 ${papers.length} 篇论文并比较研究问题、方法、数据与实验结果、各自局限。用表格整理差异，每项结论链接到具体论文和证据页；读取失败或证据不足请明确说明，不要自动创建笔记。\n\n${papers.map((p) => `- ${p.title}（论文 ID：${p.id}）`).join("\n")}`,
              },
            }),
          )
        }
      >
        <GitCompareArrows />
        比较论文
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => void apply(() => ({ favorite: !allFavorite }))}
      >
        <Star />
        {allFavorite ? "取消收藏" : "收藏"}
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => void apply(() => ({ archived: !allArchived }))}
      >
        <Archive />
        {allArchived ? "移出归档" : "归档"}
      </Button>
      <Popover open={tagOpen} onOpenChange={setTagOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" disabled={busy}>
            <Tags />
            添加标签
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const value = tag.trim();
              if (value)
                void apply((p) => ({ tags: [...new Set([...p.tags, value])] }));
            }}
            className="flex flex-col gap-3"
          >
            <Field>
              <FieldLabel htmlFor="batch-tag">标签</FieldLabel>
              <Input
                id="batch-tag"
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                maxLength={80}
              />
            </Field>
            <Button type="submit" disabled={busy || !tag.trim()}>
              应用到所选论文
            </Button>
          </form>
        </PopoverContent>
      </Popover>
      <Button variant="outline" size="sm" disabled={busy} onClick={onExport}>
        <Download />
        导出所选 BibTeX
      </Button>
      <Button variant="ghost" size="sm" disabled={busy} onClick={onClear}>
        <X />
        取消选择
      </Button>
    </div>
  );
}
