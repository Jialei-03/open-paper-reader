import { useEffect, useState } from "react";
import { LibraryBig, X } from "lucide-react";
import { api, type Paper } from "../api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "../components/ui/popover";
import { Alert, AlertDescription } from "../components/ui/alert";

export function AgentReferencePicker({
  value,
  onChange,
  disabled,
  showLabel = false,
}: {
  value: Paper[];
  onChange: (rows: Paper[]) => void;
  disabled: boolean;
  showLabel?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [rows, setRows] = useState<Paper[]>([]),
    [query, setQuery] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    let live = true;
    api<Paper[]>("/papers")
      .then((rows) => {
        if (live) {
          setRows(rows);
          setError("");
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [open]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size={showLabel ? "sm" : "icon-sm"}
          variant={showLabel ? "outline" : "ghost"}
          disabled={disabled}
          aria-label="添加参考论文"
          title="添加参考论文"
        >
          <LibraryBig />
          {showLabel && "添加参考论文"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <p className="mb-2 text-sm font-medium">参考论文 · {value.length}/5</p>
        <div className="mb-2 flex flex-wrap gap-1">
          {value.map((p) => (
            <Badge key={p.id} variant="secondary" className="max-w-full">
              <span className="truncate">{p.title}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`移除参考论文 ${p.title}`}
                onClick={() => onChange(value.filter((r) => r.id !== p.id))}
              >
                <X />
              </Button>
            </Badge>
          ))}
        </div>
        <Input
          aria-label="搜索参考论文"
          placeholder="搜索文库中的论文…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="mt-2 flex max-h-64 flex-col gap-1 overflow-y-auto">
          {rows
            .filter((p) =>
              (p.title + " " + p.authors)
                .toLowerCase()
                .includes(query.toLowerCase()),
            )
            .map((p) => (
              <Button
                type="button"
                key={p.id}
                variant={
                  value.some((r) => r.id === p.id) ? "secondary" : "ghost"
                }
                className="h-auto justify-start whitespace-normal text-left"
                disabled={
                  value.length >= 5 && !value.some((r) => r.id === p.id)
                }
                onClick={() =>
                  onChange(
                    value.some((r) => r.id === p.id)
                      ? value.filter((r) => r.id !== p.id)
                      : [...value, p],
                  )
                }
              >
                {p.title}
              </Button>
            ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
