import { useRef, useState } from "react";
import { type Item, api } from "../api";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Field, FieldLabel, FieldGroup } from "./ui/field";
import { Alert, AlertDescription } from "./ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";

type Draft = { title: string; body: string };
type Comparison = { origin: Draft | null; local: Draft; latest: Item };
export function NoteConflict({
  compare,
  merge,
  available,
  stage,
}: {
  available: boolean;
  stage: (draft: Draft) => void;
  compare: () => Promise<Comparison>;
  merge: (latest: Item, draft: Draft, expected: Draft) => Promise<void>;
}) {
  const copyKeys = useRef(new Map<string, string>());
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Comparison | null>(null);
  const [draft, setDraft] = useState<Draft>({ title: "", body: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = async () => {
    setBusy(true);
    setError("");
    try {
      const value = await compare();
      setData(value);
      setDraft(value.local);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const save = async (copy: boolean) => {
    if (!data) return;
    setBusy(true);
    setError("");
    try {
      if (copy) {
        const latest = data.latest;
        const payload = {
          kind: "note",
          paper_id: latest.paper_id,
          title: `${draft.title.slice(0, 490)}（副本）`,
          body: draft.body,
          status: latest.status,
          tags: latest.tags,
          paper_ids: latest.paper_ids,
          evidence_ids: latest.evidence_ids,
          locator: latest.locator.file_id ? latest.locator : null,
        };
        const body = JSON.stringify(payload);
        if (!copyKeys.current.has(body))
          copyKeys.current.set(body, crypto.randomUUID());
        const created = await api<Item>("/items", {
          method: "POST",
          body,
          headers: { "Idempotency-Key": copyKeys.current.get(body)! },
        });
        window.dispatchEvent(
          new CustomEvent("note-saved", { detail: created }),
        );
        location.hash = `item/${created.id}`;
      } else await merge(data.latest, draft, draft);
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) setOpen(value);
      }}
    >
      {available && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setOpen(true);
            void load();
          }}
        >
          对比与合并
        </Button>
      )}
      <DialogContent className="flex max-h-[90dvh] flex-col overflow-hidden sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>合并笔记修改</DialogTitle>
          <DialogDescription>
            对照三个版本编辑保存结果，也可以另存副本。原笔记只在确认合并时更新。
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {data && (
            <FieldGroup>
              <div className="grid gap-4 md:grid-cols-3">
                {(
                  [
                    ["编辑起点", data.origin],
                    ["本地草稿", data.local],
                    ["服务器最新版", data.latest],
                  ] as const
                ).map(([label, value]) => (
                  <Field key={label}>
                    <FieldLabel>{label}</FieldLabel>
                    <Input
                      aria-label={`${label}标题`}
                      readOnly
                      value={value?.title || ""}
                    />
                    <Textarea
                      aria-label={label}
                      readOnly
                      value={
                        value?.body ??
                        "旧草稿没有保留编辑起点，请比较本地与服务器版本。"
                      }
                      className="h-40 min-h-40 max-h-64 [field-sizing:fixed]"
                    />
                  </Field>
                ))}
              </div>
              <Field>
                <FieldLabel htmlFor="merge-note-title">保存标题</FieldLabel>
                <Input
                  id="merge-note-title"
                  maxLength={490}
                  value={draft.title}
                  onChange={(e) => {
                    const next = { ...draft, title: e.target.value };
                    setDraft(next);
                    stage(next);
                  }}
                  disabled={busy}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="merge-note-body">
                  合并结果（Markdown）
                </FieldLabel>
                <Textarea
                  id="merge-note-body"
                  className="h-48 min-h-48 [field-sizing:fixed]"
                  value={draft.body}
                  onChange={(e) => {
                    const next = { ...draft, body: e.target.value };
                    setDraft(next);
                    stage(next);
                  }}
                  disabled={busy}
                />
              </Field>
            </FieldGroup>
          )}
        </div>
        <DialogFooter className="flex-wrap">
          <Button variant="ghost" disabled={busy} onClick={() => void load()}>
            重新读取版本
          </Button>
          <Button
            variant="outline"
            disabled={busy || !data}
            onClick={() => void save(true)}
          >
            另存为新笔记
          </Button>
          <Button
            disabled={busy || !data || !draft.title.trim()}
            onClick={() => void save(false)}
          >
            {busy ? "处理中…" : "保存合并结果"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
