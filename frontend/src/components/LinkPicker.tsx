import { ReferencePosition } from "./ReferencePosition";
import { useState } from "react";
import { Link } from "lucide-react";
import { Button } from "./ui/button";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "./ui/command";
import { kindLabel } from "../api";
import { KnowledgeNode, linkMarkdown } from "../lib/knowledge";
export function LinkPicker({
  nodes,
  insert,
}: {
  nodes: KnowledgeNode[];
  insert: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(false);
  const [target, setTarget] = useState<KnowledgeNode | null>(null);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          setPosition(false);
          setOpen(true);
        }}
      >
        <Link data-icon="inline-start" />
        插入关联
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          setPosition(true);
          setOpen(true);
        }}
      >
        引用具体位置
      </Button>
      {target && (
        <ReferencePosition
          key={target.id}
          target={target}
          close={() => setTarget(null)}
          insert={insert}
        />
      )}
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="插入关联"
        description="搜索论文或其他笔记"
      >
        <CommandInput placeholder="搜索要关联的内容…" />
        <CommandList>
          <CommandEmpty>没有可关联的内容</CommandEmpty>
          <CommandGroup heading="工作区内容">
            {nodes
              .filter((n) => n.kind === "paper" || n.kind === "note")
              .map((n) => (
                <CommandItem
                  key={n.id}
                  value={n.id + " " + n.title}
                  onSelect={() => {
                    if (position) setTarget(n);
                    else insert(linkMarkdown(n));
                    setOpen(false);
                  }}
                >
                  <span className="truncate">{n.title}</span>
                  <span className="ml-auto text-muted-foreground">
                    {n.kind === "paper" ? "论文" : kindLabel[n.kind]}
                  </span>
                </CommandItem>
              ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
