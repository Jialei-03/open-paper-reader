import { useEffect, useState } from "react";
import { api } from "../api";
import { Button } from "@/components/ui/button";
import {
  Item,
  ItemContent,
  ItemTitle,
  ItemDescription,
  ItemActions,
} from "@/components/ui/item";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";

type Asset = {
  id: string;
  kind: string;
  name: string;
  size: number;
  reference: string;
  can_delete: boolean;
  url: string;
};
type Inventory = { items: Asset[]; total: number; has_more: boolean };
export function StorageFiles({ onChange }: { onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const [version, setVersion] = useState(0);
  const [data, setData] = useState<Inventory | null>(null);
  const [selected, setSelected] = useState<Asset | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    let current = true;
    setData(null);
    setError("");
    api<Inventory>(`/storage-files?offset=${offset}&limit=30`)
      .then((value) => {
        if (current) setData(value);
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, [open, offset, version]);
  async function remove() {
    if (!selected || busy) return;
    setBusy(true);
    setError("");
    try {
      await api(`/storage-files/${selected.kind}/${selected.id}`, {
        method: "DELETE",
        headers: { "X-Confirm-Delete": selected.id },
      });
      setSelected(null);
      setOffset(0);
      setVersion((value) => value + 1);
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setOpen(true);
          setError("");
        }}
      >
        管理附件
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) {
            setOpen(value);
            setSelected(null);
          }
        }}
      >
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>附件管理</DialogTitle>
            <DialogDescription>
              仅清理未被已保存内容引用的附件；论文附件请在对应论文中管理。
            </DialogDescription>
          </DialogHeader>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {selected ? (
            <>
              <p className="break-words">
                确认删除「{selected.name}」？删除后无法再使用这个附件。
              </p>
              <DialogFooter>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => setSelected(null)}
                >
                  取消
                </Button>
                <Button
                  variant="destructive"
                  disabled={busy}
                  onClick={() => void remove()}
                >
                  确认删除
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
                {!data ? (
                  <p role="status">{error ? "未能读取附件" : "读取中…"}</p>
                ) : data.items.length === 0 ? (
                  <p>暂无附件</p>
                ) : (
                  data.items.map((file) => (
                    <Item key={file.id} variant="outline" size="sm">
                      <ItemContent className="min-w-0">
                        <ItemTitle className="break-all">{file.name}</ItemTitle>
                        <ItemDescription>
                          {file.size < 1024
                            ? `${file.size} B`
                            : `${(file.size / 1024).toFixed(1)} KB`}
                        </ItemDescription>
                        <Badge variant="secondary">
                          {file.reference || "未引用"}
                        </Badge>
                      </ItemContent>
                      <ItemActions>
                        {file.can_delete ? (
                          <Button
                            variant="outline"
                            size="sm"
                            aria-label={`清理 ${file.name}`}
                            onClick={() => {
                              setError("");
                              setSelected(file);
                            }}
                          >
                            清理
                          </Button>
                        ) : file.url ? (
                          <Button variant="ghost" size="sm" asChild>
                            <a href={file.url} onClick={() => setOpen(false)}>
                              查看论文
                            </a>
                          </Button>
                        ) : null}
                      </ItemActions>
                    </Item>
                  ))
                )}
              </div>
              <DialogFooter className="flex-row flex-wrap items-center">
                <span className="mr-auto text-sm text-muted-foreground">
                  {data?.total ?? "—"} 个附件
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!offset}
                  onClick={() => setOffset(Math.max(0, offset - 30))}
                >
                  上一页
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!data?.has_more}
                  onClick={() => setOffset(offset + 30)}
                >
                  下一页
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
