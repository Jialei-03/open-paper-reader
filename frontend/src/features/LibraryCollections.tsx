import { useEffect, useRef, useState } from "react";
import {
  FolderPlus,
  FolderInput,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import { api, send } from "../api";
import { Choice } from "../components/Choice";
import { Modal } from "../components/Modal";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Field, FieldLabel } from "../components/ui/field";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";

type Collection = {
  id: string;
  name: string;
  paper_ids: string[];
  revision: number;
};
type Props = {
  selectedIds: string[];
  onFilter: (paperIds: string[] | null, label: string) => void;
  onError: (message: string) => void;
  tick?: number;
};

export function LibraryCollections({
  selectedIds,
  onFilter,
  onError,
  tick = 0,
}: Props) {
  const [rows, setRows] = useState<Collection[]>([]);
  const [activeId, setActiveId] = useState("");
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<"create" | "rename" | "delete" | null>(
    null,
  );
  const [name, setName] = useState("");
  const [creationId, setCreationId] = useState("");
  const filter = useRef(onFilter);
  filter.current = onFilter;
  const error = useRef(onError);
  error.current = onError;
  const active = rows.find((row) => row.id === activeId);
  const replace = (row: Collection) =>
    setRows((previous) =>
      previous.some((item) => item.id === row.id)
        ? previous.map((item) => (item.id === row.id ? row : item))
        : [...previous, row],
    );
  useEffect(() => {
    let alive = true;
    api<Collection[]>("/library-collections")
      .then((data) => {
        if (alive) setRows(data);
      })
      .catch((e) => {
        if (alive) error.current(e.message);
      });
    return () => {
      alive = false;
    };
  }, [tick]);
  useEffect(() => {
    if (activeId && !active) setActiveId("");
    filter.current(active ? active.paper_ids : null, active?.name || "");
  }, [active, activeId]);
  async function perform(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } catch (e) {
      error.current((e as Error).message);
      // Conflict recovery refreshes membership before the next explicit attempt.
      try {
        setRows(await api<Collection[]>("/library-collections"));
      } catch {
        /* Keep previous list usable offline. */
      }
    } finally {
      setBusy(false);
    }
  }
  function open(kind: "create" | "rename" | "delete") {
    setName(kind === "create" ? "" : active?.name || "");
    if (kind === "create") setCreationId(crypto.randomUUID());
    setDialog(kind);
  }
  async function membership(row: Collection, remove = false) {
    await perform(async () => {
      const paper_ids = remove
        ? row.paper_ids.filter((id) => !selectedIds.includes(id))
        : [...new Set([...row.paper_ids, ...selectedIds])];
      replace(
        await send(
          `/library-collections/${row.id}`,
          { revision: row.revision, paper_ids },
          "PATCH",
        ),
      );
    });
  }
  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-2"
      aria-label="文库集合"
    >
      <Choice
        aria-label="集合筛选"
        value={activeId}
        onValueChange={setActiveId}
        disabled={busy}
        className="min-w-32 max-w-64"
      >
        <option value="">全部集合</option>
        {rows.map((row) => (
          <option key={row.id} value={row.id}>
            {row.name} · {row.paper_ids.length}
          </option>
        ))}
      </Choice>
      <Button
        variant="ghost"
        size="icon"
        aria-label="新建集合"
        title="新建集合"
        disabled={busy}
        onClick={() => open("create")}
      >
        <FolderPlus />
      </Button>
      {active && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="管理当前集合"
              disabled={busy}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => open("rename")}>
                <Pencil />
                重命名集合
              </DropdownMenuItem>
              {selectedIds.some((id) => active.paper_ids.includes(id)) && (
                <DropdownMenuItem onClick={() => void membership(active, true)}>
                  将所选论文移出集合
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                variant="destructive"
                onClick={() => open("delete")}
              >
                <Trash2 />
                删除集合
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {selectedIds.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" disabled={busy}>
              <FolderInput />
              加入集合
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuGroup>
              {rows.map((row) => (
                <DropdownMenuItem
                  key={row.id}
                  onClick={() => void membership(row)}
                >
                  {row.name}
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem onClick={() => open("create")}>
                <FolderPlus />
                新建集合并加入
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {dialog && (
        <Modal
          title={
            dialog === "create"
              ? "新建集合"
              : dialog === "rename"
                ? "重命名集合"
                : "删除集合"
          }
          close={() => {
            if (!busy) setDialog(null);
          }}
        >
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void perform(async () => {
                if (dialog === "delete" && active) {
                  await api(
                    `/library-collections/${active.id}?revision=${active.revision}`,
                    { method: "DELETE" },
                  );
                  setRows((previous) =>
                    previous.filter((row) => row.id !== active.id),
                  );
                  setActiveId("");
                } else if (dialog === "create") {
                  const row = await send("/library-collections", {
                    id: creationId,
                    name: name.trim(),
                    paper_ids: selectedIds,
                  });
                  replace(row);
                  setActiveId(row.id);
                } else if (active) {
                  replace(
                    await send(
                      `/library-collections/${active.id}`,
                      { revision: active.revision, name: name.trim() },
                      "PATCH",
                    ),
                  );
                }
                setDialog(null);
              });
            }}
          >
            {dialog === "delete" ? (
              <p className="text-sm">
                删除“{active?.name}”集合？其中的论文和笔记会保留。
              </p>
            ) : (
              <Field>
                <FieldLabel htmlFor="collection-name">集合名称</FieldLabel>
                <Input
                  id="collection-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  maxLength={100}
                  autoFocus
                  disabled={busy}
                />
                {dialog === "create" && selectedIds.length > 0 && (
                  <p className="text-sm text-muted-foreground">
                    将加入已选的 {selectedIds.length} 篇论文。
                  </p>
                )}
              </Field>
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setDialog(null)}
              >
                取消
              </Button>
              <Button
                type="submit"
                variant={dialog === "delete" ? "destructive" : "default"}
                disabled={busy || (dialog !== "delete" && !name.trim())}
              >
                {busy
                  ? "保存中…"
                  : dialog === "delete"
                    ? "删除集合"
                    : "保存集合"}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
