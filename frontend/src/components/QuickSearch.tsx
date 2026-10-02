import { useState } from "react";
import { FileText, NotebookPen, Plus, Library } from "lucide-react";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from "./ui/command";
import type { Paper, Item } from "../api";
export function QuickSearch({
  open,
  onOpenChange,
  papers,
  items,
  go,
  add,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  papers: Paper[];
  items: Item[];
  go: (route: string) => void;
  add: () => void;
}) {
  const [query, setQuery] = useState("");
  const select = (route: string) => {
    onOpenChange(false);
    go(route);
  };
  const match = (text: string) =>
    text.toLowerCase().includes(query.toLowerCase().trim());
  return (
    <CommandDialog
      title="搜索工作区"
      description="搜索论文、笔记或执行操作"
      open={open}
      onOpenChange={onOpenChange}
    >
      <CommandInput
        placeholder="搜索论文、笔记…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>没有找到结果</CommandEmpty>
        <CommandGroup heading="快捷操作">
          <CommandItem onSelect={() => select("library")}>
            <Library />
            打开文库
          </CommandItem>
          <CommandItem
            onSelect={() => {
              onOpenChange(false);
              add();
            }}
          >
            <Plus />
            导入论文
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="论文">
          {papers
            .filter((p) =>
              match(p.title + " " + p.authors + " " + p.tags.join(" ")),
            )
            .slice(0, 8)
            .map((p) => (
              <CommandItem
                key={p.id}
                value={
                  p.id +
                  " " +
                  p.title +
                  " " +
                  p.authors +
                  " " +
                  p.tags.join(" ")
                }
                onSelect={() => select("paper/" + p.id)}
              >
                <FileText />
                <span className="truncate">{p.title}</span>
              </CommandItem>
            ))}
        </CommandGroup>
        <CommandGroup heading="笔记">
          {items
            .filter((i) => match(i.title + " " + i.body))
            .slice(0, 6)
            .map((i) => (
              <CommandItem
                key={i.id}
                value={i.id + " " + i.title + " " + i.body}
                onSelect={() =>
                  select(i.paper_id ? "paper/" + i.paper_id : "topics")
                }
              >
                <NotebookPen />
                <span className="truncate">
                  {i.title || i.body.slice(0, 70)}
                </span>
              </CommandItem>
            ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
