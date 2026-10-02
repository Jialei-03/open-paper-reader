import {
  importWithProgress,
  type ImportProgress as ImportState,
} from "../lib/arxiv-import";
import { ImportProgress } from "../components/ImportProgress";
import { useEffect, useState } from "react";
import { ArrowUpRight, Download, Plus, RefreshCw, Save } from "lucide-react";
import { api, send } from "../api";
import { Empty, Markdown, PageHead } from "../components/shared";
import { Button } from "../components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "../components/ui/card";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "../components/ui/tabs";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from "../components/ui/field";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Checkbox } from "../components/ui/checkbox";
import { Badge } from "../components/ui/badge";
import { Spinner } from "../components/ui/spinner";

type Candidate = {
  id: string;
  title: string;
  authors: string;
  abstract: string;
  published: string;
  url: string;
  reasons: string[];
};
type Profile = {
  revision: number;
  body: string;
  interests: string[];
  excluded: string[];
  tracking: boolean;
  document: string;
  terms: string[];
  signals: {
    title: string;
    reason: string;
    tags: string[];
    updated_at: string;
  }[];
  feedback: { id: string; title: string; action: string; updated_at: string }[];
};
export function Recommendations({ tick, go, run, onError }: any) {
  const [data, setData] = useState<{
    items: Candidate[];
    terms: string[];
  } | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [busy, setBusy] = useState(false),
    [tab, setTab] = useState("discover");
  const [body, setBody] = useState(""),
    [interests, setInterests] = useState(""),
    [excluded, setExcluded] = useState(""),
    [tracking, setTracking] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [importProgress, setImportProgress] = useState<ImportState | null>(
    null,
  );
  useEffect(() => {
    if (!importing) return;
    const started = Date.now();
    setElapsed(0);
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [importing]);
  useEffect(() => {
    let alive = true;
    api<Profile>("/research-profile")
      .then(async (p) => {
        if (!alive) return;
        if (!dirty) {
          setProfile(p);
          setBody(p.body);
          setInterests(p.interests.join(", "));
          setExcluded(p.excluded.join(", "));
          setTracking(p.tracking);
        }
        const result = await api("/discovery");
        if (alive) setData(result);
      })
      .catch((e) => {
        if (alive) onError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [tick, dirty]);
  const act = async (id: string, action: string) => {
    if (busy) return;
    setBusy(true);
    if (action === "import") {
      setImporting(id);
      setImportProgress(null);
    }
    try {
      await run(
        async () => {
          const result =
            action === "import"
              ? await importWithProgress<{ paper_id: string }>(
                  `/discovery/${id}/feedback`,
                  { action },
                  setImportProgress,
                )
              : await send(`/discovery/${id}/feedback`, { action });
          if (action === "import") {
            setData((previous) =>
              previous
                ? {
                    ...previous,
                    items: previous.items.filter((p) => p.id !== id),
                  }
                : previous,
            );
            go("paper/" + result.paper_id);
          } else {
            setData(await api("/discovery"));
          }
        },
        action === "import" ? "论文与原版 PDF 已加入文库" : "已更新反馈",
      );
    } finally {
      setBusy(false);
      setImporting(null);
    }
  };
  const split = (s: string) =>
    s
      .split(/[,，\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
  return (
    <div className="page recommendations-page flex flex-col gap-5">
      <PageHead title="发现论文" eyebrow="" subtitle="" />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="discover">新论文</TabsTrigger>
          <TabsTrigger value="profile">研究偏好</TabsTrigger>
        </TabsList>
        <TabsContent value="discover" className="flex flex-col gap-4 pt-4">
          <Card>
            <CardHeader>
              <CardTitle>从你的研究方向出发</CardTitle>
              <CardDescription>
                搜索 arXiv，自动排除已入库和已归档论文。
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {data?.terms.map((t) => (
                <Badge variant="secondary" key={t}>
                  {t}
                </Badge>
              ))}
              {data && !data.terms.length && (
                <span className="text-sm text-muted-foreground">
                  先填写关注关键词，建立你的推荐方向。
                </span>
              )}
            </CardContent>
            <CardFooter className="flex flex-wrap gap-2">
              <Button
                disabled={busy || !data?.terms.length}
                onClick={async () => {
                  setBusy(true);
                  await run(
                    async () => setData(await send("/discovery/refresh", {})),
                    "已更新外部论文",
                  );
                  setBusy(false);
                }}
              >
                {busy ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <RefreshCw data-icon="inline-start" />
                )}
                查找新论文
              </Button>
              <Button variant="outline" onClick={() => setTab("profile")}>
                调整研究偏好
              </Button>
            </CardFooter>
          </Card>
          {!data && (
            <div className="flex items-center gap-2">
              <Spinner />
              正在加载
            </div>
          )}
          <div className="grid items-start gap-4 lg:grid-cols-2">
            {data?.items.map((p) => (
              <Card key={p.id}>
                <CardHeader>
                  <div className="flex gap-2">
                    <Badge variant="outline">arXiv</Badge>
                    <span className="text-sm text-muted-foreground">
                      {p.published}
                    </span>
                  </div>
                  <CardTitle>
                    <a href={p.url} target="_blank" rel="noopener noreferrer">
                      {p.title}
                    </a>
                  </CardTitle>
                  <CardDescription>{p.authors}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <p className="text-sm leading-relaxed">
                    {p.abstract.slice(0, 400)}
                    {p.abstract.length > 400 ? "…" : ""}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {p.reasons.map((r) => (
                      <Badge variant="secondary" key={r}>
                        {r}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
                <CardFooter className="flex flex-wrap gap-2">
                  {importing === p.id && (
                    <div className="w-full text-sm text-muted-foreground">
                      <ImportProgress value={importProgress} />
                      已等待 {elapsed} 秒。
                      {elapsed >= 20
                        ? "arXiv 响应较慢，请勿重复提交。"
                        : "完成后会自动打开论文。"}
                    </div>
                  )}
                  <Button disabled={busy} onClick={() => act(p.id, "import")}>
                    {importing === p.id ? (
                      <Spinner data-icon="inline-start" />
                    ) : (
                      <Plus data-icon="inline-start" />
                    )}
                    {importing === p.id ? "正在获取 PDF…" : "加入文库"}
                  </Button>
                  <Button variant="outline" asChild>
                    <a href={p.url} target="_blank" rel="noopener noreferrer">
                      原文
                      <ArrowUpRight data-icon="inline-end" />
                    </a>
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => act(p.id, "dismiss")}
                  >
                    忽略
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => act(p.id, "not_interested")}
                  >
                    不感兴趣
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
          {data && !data.items.length && (
            <Empty text="暂无未入库的匹配论文。点击“查找新论文”，或调整关注方向。" />
          )}
        </TabsContent>
        <TabsContent value="profile" className="flex flex-col gap-4 pt-4">
          {profile && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>用户描述</CardTitle>
                  <CardDescription>
                    由你维护。系统观察单独记录，不会覆盖你填写的内容。
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form
                    id="research-profile"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      setBusy(true);
                      await run(async () => {
                        const p = await send(
                          "/research-profile",
                          {
                            body,
                            interests: split(interests),
                            excluded: split(excluded),
                            tracking,
                          },
                          "PUT",
                          profile.revision,
                        );
                        setProfile(p);
                        setDirty(false);
                      }, "研究偏好已保存");
                      setBusy(false);
                    }}
                  >
                    <FieldGroup>
                      <Field>
                        <FieldLabel htmlFor="profile-body">
                          研究目标与偏好
                        </FieldLabel>
                        <Textarea
                          id="profile-body"
                          rows={6}
                          value={body}
                          maxLength={12000}
                          placeholder="我正在研究什么？看重哪些方法、证据或应用？"
                          onChange={(e) => {
                            setBody(e.target.value);
                            setDirty(true);
                          }}
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="profile-interests">
                          关注关键词
                        </FieldLabel>
                        <Input
                          id="profile-interests"
                          value={interests}
                          onChange={(e) => {
                            setInterests(e.target.value);
                            setDirty(true);
                          }}
                          placeholder="例如 agent memory, memory consolidation"
                        />
                        <FieldDescription>
                          用逗号分隔，建议英文。检索只发送最多 4
                          个关键词，不发送用户描述或笔记正文。
                        </FieldDescription>
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="profile-excluded">
                          排除关键词
                        </FieldLabel>
                        <Input
                          id="profile-excluded"
                          value={excluded}
                          onChange={(e) => {
                            setExcluded(e.target.value);
                            setDirty(true);
                          }}
                          placeholder="不希望出现的研究方向"
                        />
                      </Field>
                      <Field orientation="horizontal">
                        <Checkbox
                          id="profile-tracking"
                          checked={tracking}
                          onCheckedChange={(v) => {
                            setTracking(v === true);
                            setDirty(true);
                          }}
                        />
                        <FieldLabel htmlFor="profile-tracking">
                          根据收藏、阅读和推荐反馈更新偏好线索
                        </FieldLabel>
                      </Field>
                    </FieldGroup>
                  </form>
                </CardContent>
                <CardFooter>
                  <Button
                    form="research-profile"
                    type="submit"
                    disabled={busy || !dirty}
                  >
                    <Save data-icon="inline-start" />
                    保存偏好
                  </Button>
                  {dirty && (
                    <Button variant="ghost" onClick={() => setDirty(false)}>
                      放弃修改
                    </Button>
                  )}
                </CardFooter>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>持续更新的偏好文档</CardTitle>
                  <CardDescription>
                    行为线索会随阅读记录和反馈更新；入库本身不等于喜欢。
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <details>
                    <summary className="cursor-pointer">
                      查看用户描述与观察记录
                    </summary>
                    <div className="pt-4">
                      <Markdown body={profile.document} />
                    </div>
                  </details>
                </CardContent>
                <CardFooter>
                  <Button
                    variant="outline"
                    onClick={() => {
                      const url = URL.createObjectURL(
                        new Blob([profile.document], {
                          type: "text/markdown;charset=utf-8",
                        }),
                      );
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = "research-profile.md";
                      a.click();
                      setTimeout(() => URL.revokeObjectURL(url), 1000);
                    }}
                  >
                    <Download data-icon="inline-start" />
                    导出 Markdown
                  </Button>
                </CardFooter>
              </Card>
              {!!profile.feedback.length && (
                <Card>
                  <CardHeader>
                    <CardTitle>推荐反馈</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    {profile.feedback.map((f) => (
                      <div key={f.id} className="flex items-center gap-3">
                        <span className="min-w-0 flex-1 text-sm">
                          {f.title}
                        </span>
                        <Badge variant="outline">
                          {f.action === "dismiss" ? "已忽略" : "不感兴趣"}
                        </Badge>
                        <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={() => act(f.id, "reset")}
                        >
                          撤销
                        </Button>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
