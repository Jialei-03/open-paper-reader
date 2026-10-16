import { useLayoutEffect, useRef } from "react";
import {
  Bold,
  Italic,
  Heading2,
  List,
  ListTodo,
  Quote,
  Code,
  Table2,
} from "lucide-react";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
const formats = [
  { label: "加粗", icon: Bold, before: "**", after: "**", sample: "文字" },
  { label: "斜体", icon: Italic, before: "*", after: "*", sample: "文字" },
  {
    label: "二级标题",
    icon: Heading2,
    before: "\n## ",
    after: "\n",
    sample: "标题",
  },
  {
    label: "无序列表",
    icon: List,
    before: "\n- ",
    after: "\n",
    sample: "列表项",
  },
  {
    label: "任务清单",
    icon: ListTodo,
    before: "\n- [ ] ",
    after: "\n",
    sample: "待办事项",
  },
  {
    label: "引用",
    icon: Quote,
    before: "\n> ",
    after: "\n",
    sample: "引用内容",
  },
  {
    label: "代码块",
    icon: Code,
    before: "\n```\n",
    after: "\n```\n",
    sample: "code",
  },
  {
    label: "表格",
    template: true,
    icon: Table2,
    before: "\n\n",
    after: "\n",
    sample: "| 项目 | 内容 |\n| --- | --- |\n| 示例 | 内容 |",
  },
];
export function MarkdownEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const pendingSelection = useRef<[number, number] | null>(null);
  useLayoutEffect(() => {
    if (!pendingSelection.current || !ref.current) return;
    ref.current.focus();
    ref.current.setSelectionRange(...pendingSelection.current);
    pendingSelection.current = null;
  }, [value]);
  const apply = (format: (typeof formats)[number]) => {
    const el = ref.current;
    if (!el) return;
    const start = format.template ? el.selectionEnd : el.selectionStart,
      end = el.selectionEnd;
    const selection = format.template
      ? format.sample
      : value.slice(start, end) || format.sample;
    pendingSelection.current = [
      start + format.before.length,
      start + format.before.length + selection.length,
    ];
    onChange(
      value.slice(0, start) +
        format.before +
        selection +
        format.after +
        value.slice(end),
    );
  };
  return (
    <div className="markdown-editor">
      <div
        className="flex flex-wrap gap-1 border-b p-2"
        role="group"
        aria-label="Markdown 格式工具"
      >
        {formats.map((f) => (
          <Button
            key={f.label}
            type="button"
            variant="ghost"
            size="icon"
            aria-label={f.label}
            title={f.label}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => apply(f)}
          >
            <f.icon />
          </Button>
        ))}
      </div>
      <Textarea
        ref={ref}
        id="item-body"
        rows={12}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="写下你的笔记…"
        onKeyDown={(e) => {
          if (e.metaKey || e.ctrlKey) {
            const key = e.key.toLowerCase();
            if (key === "b" || key === "i") {
              e.preventDefault();
              apply(formats[key === "b" ? 0 : 1]);
            }
            if (key === "s") {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }
        }}
      />
      <div className="flex flex-wrap justify-between gap-2 p-2 text-xs text-muted-foreground">
        <span>{value.length} 字符</span>
        <span>⌘ / Ctrl B 加粗 · I 斜体 · S 保存</span>
      </div>
    </div>
  );
}
