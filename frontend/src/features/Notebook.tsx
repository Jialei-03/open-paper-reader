import { Search, NotebookPen, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Input } from "../components/ui/input";
import { Empty } from "../components/shared";
import type { Item, Paper } from "../api";

export function Notebook({
  items,
  papers,
}: {
  items: Item[];
  papers: Paper[];
  jump: (item: Item) => void;
  edit: (item: Item) => void;
  add: () => void;
}) {
  const [query, setQuery] = useState("");
  const notes = items.filter(
    (i) =>
      i.kind === "note" &&
      [i.title, i.body, papers.find((p) => p.id === i.paper_id)?.title]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <div className="page notebook-page">
      <header className="notes-library-header">
        <h1>笔记</h1>
        <label className="notes-library-search">
          <Search aria-hidden="true" />
          <Input
            aria-label="搜索笔记"
            placeholder="搜索笔记或论文…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </header>
      <div className="notes-library-caption">{notes.length} 篇笔记</div>
      <div className="notes-library-list">
        {notes.map((i) => {
          const paper = papers.find((p) => p.id === i.paper_id);
          return (
            <a
              className="notes-library-row"
              key={i.id}
              href={
                i.paper_id
                  ? "#paper/" + i.paper_id + "?note=" + i.id
                  : "#item/" + i.id
              }
            >
              <NotebookPen aria-hidden="true" />
              <div className="notes-library-content">
                <h2>{paper?.title || i.title || "阅读笔记"}</h2>
                {paper && i.title && (
                  <span className="notes-library-title">{i.title}</span>
                )}
                <p>
                  {i.body
                    .replace(/!\[.*?\]\(.*?\)/g, "[图片]")
                    .replace(/[#*_`>]/g, "")
                    .slice(0, 180) || "在此自由记录……"}
                </p>
              </div>
              <ChevronRight
                className="notes-library-arrow"
                aria-hidden="true"
              />
            </a>
          );
        })}
      </div>
      {!notes.length && (
        <Empty
          text={query ? "没有找到笔记" : "导入论文后，会自动创建一篇阅读笔记。"}
        />
      )}
    </div>
  );
}
