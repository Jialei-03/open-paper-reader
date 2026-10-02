import { Checkbox } from "./ui/checkbox";
import { ReadingBadge, TagBadge } from "./ContentBadge";
import { useState } from "react";
import { Star, NotebookPen } from "lucide-react";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "./ui/table";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Paper, date } from "../api";
export function PaperTable({
  papers,
  go,
  toggleFavorite,
  onError,
  detailed = false,
  selection,
  recentVisits,
  notesByPaper = {},
}: {
  papers: Paper[];
  recentVisits?: Record<string, number>;
  notesByPaper?: Record<string, { id: string; count: number }>;
  selection?: {
    ids: Set<string>;
    toggle: (id: string) => void;
    togglePage: () => void;
  };
  detailed?: boolean;
  go: (route: string) => void;
  toggleFavorite: (paper: Paper) => Promise<any>;
  onError: (error: string) => void;
}) {
  const [pending, setPending] = useState<string[]>([]);
  return (
    <div className={`paper-table${detailed ? " paper-table-detailed" : ""}`}>
      <Table aria-label="论文列表">
        <TableHeader>
          <TableRow>
            {selection && (
              <TableHead className="w-10">
                <Checkbox
                  aria-label="选择当前页论文"
                  checked={
                    papers.every((p) => selection.ids.has(p.id))
                      ? true
                      : papers.some((p) => selection.ids.has(p.id))
                        ? "indeterminate"
                        : false
                  }
                  onCheckedChange={selection.togglePage}
                />
              </TableHead>
            )}
            <TableHead className="w-12">
              <span className="sr-only">收藏</span>
            </TableHead>
            <TableHead className="paper-title-heading">标题</TableHead>
            <TableHead className="paper-notes-heading">笔记</TableHead>
            <TableHead className="paper-tags-heading">标签</TableHead>
            <TableHead className="paper-status-heading">状态</TableHead>
            <TableHead className="paper-date-heading">
              {recentVisits ? "最后打开 · 此设备" : "最近更新"}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {papers.map((p) => (
            <TableRow
              key={p.id}
              data-state={selection?.ids.has(p.id) ? "selected" : undefined}
            >
              {selection && (
                <TableCell>
                  <Checkbox
                    aria-label={"选择论文：" + p.title}
                    checked={selection.ids.has(p.id)}
                    onCheckedChange={() => selection.toggle(p.id)}
                  />
                </TableCell>
              )}
              <TableCell>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={(p.favorite ? "取消收藏：" : "收藏：") + p.title}
                  aria-pressed={p.favorite}
                  disabled={pending.includes(p.id)}
                  onClick={async () => {
                    setPending((ids) => [...ids, p.id]);
                    try {
                      await toggleFavorite(p);
                    } catch (e) {
                      onError((e as Error).message);
                    } finally {
                      setPending((ids) => ids.filter((id) => id !== p.id));
                    }
                  }}
                >
                  <Star fill={p.favorite ? "currentColor" : "none"} />
                </Button>
              </TableCell>
              <TableCell className="paper-title-cell">
                <Button asChild variant="link" className="paper-title-link">
                  <a
                    title={p.title}
                    href={"#paper/" + p.id}
                    onClick={(e) => {
                      e.preventDefault();
                      go("paper/" + p.id);
                    }}
                  >
                    {p.title}
                  </a>
                </Button>
                {detailed && (
                  <div className="paper-table-preview">
                    {p.authors && (
                      <p className="paper-table-authors">{p.authors}</p>
                    )}
                    {p.abstract && (
                      <p className="paper-table-abstract">{p.abstract}</p>
                    )}
                  </div>
                )}
              </TableCell>
              <TableCell className="paper-notes-cell">
                {notesByPaper[p.id] ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={"查看笔记：" + p.title}
                    onClick={() =>
                      go("paper/" + p.id + "?note=" + notesByPaper[p.id].id)
                    }
                  >
                    <NotebookPen />
                    {notesByPaper[p.id].count}
                  </Button>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell>
                <div className="paper-table-tags">
                  {p.tags.slice(0, 2).map((t) => (
                    <TagBadge key={t} label={t} />
                  ))}
                </div>
              </TableCell>
              <TableCell>
                <ReadingBadge status={p.reading_status} />
              </TableCell>
              <TableCell className="text-muted-foreground">
                {recentVisits
                  ? recentVisits[p.id]
                    ? date(new Date(recentVisits[p.id]).toISOString())
                    : "尚未打开"
                  : date(p.updated_at)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
