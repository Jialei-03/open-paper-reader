import { useEffect, useState } from "react";
import { api } from "../api";
import { PageHead, Empty } from "../components/shared";
import { Button } from "../components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Checkbox } from "../components/ui/checkbox";
import { Field, FieldLabel, FieldGroup } from "../components/ui/field";
import { Badge } from "../components/ui/badge";
import { Tags } from "lucide-react";
export function Directions({ tick, run, onError }: any) {
  const [data, setData] = useState<{
    revision: string;
    items: { name: string; papers: number }[];
  } | null>(null);
  const [selected, setSelected] = useState<string[]>([]),
    [target, setTarget] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    api("/research-directions")
      .then((d) => {
        if (live) setData(d);
      })
      .catch((e) => {
        if (live) onError(e.message);
      });
    return () => {
      live = false;
    };
  }, [tick]);
  return (
    <div className="page directions-page flex flex-col gap-5">
      <PageHead title="研究方向" subtitle="" eyebrow="" />
      <Card>
        <CardHeader>
          <CardTitle>编辑与合并</CardTitle>
          <CardDescription>
            选择一个方向重命名，选择多个方向合并；不选择则新建方向。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!data) return;
              setBusy(true);
              await run(
                async () => {
                  setData(
                    await api("/research-directions", {
                      method: "POST",
                      headers: { "If-Match": data.revision },
                      body: JSON.stringify({
                        sources: selected,
                        target: target.trim(),
                      }),
                    }),
                  );
                  setSelected([]);
                  setTarget("");
                },
                selected.length > 1 ? "方向已合并" : "方向已保存",
              );
              setBusy(false);
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="direction-target">方向名称</FieldLabel>
                <Input
                  id="direction-target"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  required
                  maxLength={80}
                  placeholder="输入新名称或合并后的名称"
                />
              </Field>
              <div className="flex flex-wrap gap-2">
                {/* Grey until there is a name: a faded blue button reads as broken. */}
                <Button
                  type="submit"
                  variant={target.trim() ? "default" : "secondary"}
                  disabled={busy || !target.trim() || !data}
                >
                  {selected.length > 1
                    ? "合并方向"
                    : selected.length
                      ? "保存名称"
                      : "新建方向"}
                </Button>
                {!!selected.length && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setSelected([]);
                      setTarget("");
                    }}
                  >
                    取消选择
                  </Button>
                )}
              </div>
              <div className="flex flex-col gap-3">
                {data?.items.map((d) => (
                  <Field orientation="horizontal" key={d.name}>
                    <Checkbox
                      id={"direction-" + d.name}
                      checked={selected.includes(d.name)}
                      onCheckedChange={(v) => {
                        setSelected((s) =>
                          v ? [...s, d.name] : s.filter((t) => t !== d.name),
                        );
                        if (v && !selected.length) setTarget(d.name);
                      }}
                    />
                    <FieldLabel
                      htmlFor={"direction-" + d.name}
                      className="min-w-0 flex-1 break-words"
                    >
                      {d.name}
                    </FieldLabel>
                    <Badge variant="secondary">{d.papers} 篇论文</Badge>
                  </Field>
                ))}
              </div>
              {data && !data.items.length && (
                <Empty
                  icon={Tags}
                  text="还没有研究方向。在上面输入名称新建，或者给论文加标签，标签会出现在这里。"
                />
              )}
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
