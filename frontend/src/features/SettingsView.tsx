import { AppearanceSettings } from "../components/Appearance";
import { ModelUsage } from "./ModelUsage";
import { StorageUsage } from "./StorageUsage";
import { TranslationSettings } from "./TranslationSettings";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Item as ListItem,
  ItemGroup,
  ItemContent,
  ItemTitle,
  ItemDescription,
  ItemActions,
} from "@/components/ui/item";
import { AccountSettings } from "./AccountRecovery";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState, useEffect } from "react";
import {
  Plus,
  ArrowUpRight,
  Download,
  Bot,
  UserRound,
  HardDrive,
  Code2,
  Palette,
} from "lucide-react";
import { api, send, date } from "../api";
import { Empty } from "../components/shared";
import { Modal } from "../components/Modal";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import "./settings.css";

export function SettingsView({ user, tick, run, setModal, close }: any) {
  const [compact, setCompact] = useState(
    () => window.matchMedia("(max-width: 768px)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia("(max-width: 768px)");
    const update = () => setCompact(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const [tokens, setTokens] = useState<any[]>([]);
  useEffect(() => {
    api<any[]>("/tokens")
      .then(setTokens)
      .catch((e) => run(() => Promise.reject(e)));
  }, [tick]);
  const createToken = () =>
    setModal(
      <Modal title="创建 Agent API 凭据" close={close}>
        <p className="muted">
          凭据只绑定当前用户空间。只读权限也包含文件与工作空间导出，请仅交给你信任的
          Agent。
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            await run(async () => {
              const t = await send("/tokens", {
                name: f.get("name"),
                days: Number(f.get("days")),
                scopes: f.get("write") ? ["read", "write"] : ["read"],
              });
              setModal(
                <Modal title="凭据仅展示这一次" close={close}>
                  <p>请立即复制保存。关闭后无法再次查看，可以随时撤销。</p>
                  <Textarea
                    aria-label="新 Agent 凭据"
                    readOnly
                    value={t.token}
                    rows={3}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <Button
                    variant="default"
                    type="button"
                    className="primary"
                    onClick={() => navigator.clipboard.writeText(t.token)}
                  >
                    复制凭据
                  </Button>
                  <p className="muted">到期时间：{date(t.expires)}</p>
                </Modal>,
              );
            }, "凭据已创建");
          }}
        >
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel className="flex flex-col items-start gap-2">
                名称
                <Input name="name" required placeholder="例如：研究助理" />
              </FieldLabel>
            </Field>
            <Field>
              <FieldLabel className="flex flex-col items-start gap-2">
                有效期（天）
                <Input
                  name="days"
                  type="number"
                  min={1}
                  max={365}
                  defaultValue={30}
                  required
                />
              </FieldLabel>
            </Field>
            <Field>
              <FieldLabel className="check">
                <Checkbox name="write" />
                同时允许写入资料、证据、解读与问题
              </FieldLabel>
            </Field>
            <p className="muted">
              Agent 始终无法修改个人笔记、确认本人已读、管理凭据或邀请其他用户。
            </p>
            <footer>
              <Button variant="default" type="submit" className="primary">
                创建凭据
              </Button>
            </footer>
          </FieldGroup>
        </form>
      </Modal>,
    );
  return (
    <div className="page settings-page">
      <section className="settings-surface" aria-labelledby="settings-title">
        <header className="settings-heading">
          <h1 id="settings-title">设置</h1>
        </header>
        <Tabs
          defaultValue="models"
          orientation={compact ? "horizontal" : "vertical"}
          className="settings-layout"
        >
          <TabsList aria-label="设置分类" className="settings-navigation">
            <TabsTrigger value="models">
              <Bot />
              模型
            </TabsTrigger>
            <TabsTrigger value="appearance">
              <Palette />
              外观
            </TabsTrigger>
            <TabsTrigger value="account">
              <UserRound />
              账户
            </TabsTrigger>
            <TabsTrigger value="storage">
              <HardDrive />
              数据与存储
            </TabsTrigger>
            <TabsTrigger value="developer">
              <Code2 />
              开发者
            </TabsTrigger>
          </TabsList>
          <div className="settings-panels">
            <TabsContent value="models" className="settings-panel">
              <TranslationSettings run={run} />
              <ModelUsage key={`model-${user.id}`} tick={tick} />
            </TabsContent>
            <TabsContent value="appearance" className="settings-panel">
              <AppearanceSettings />
            </TabsContent>
            <TabsContent value="account" className="settings-panel">
              <AccountSettings user={user} />
              {user.admin && (
                <Card>
                  <CardHeader>
                    <CardTitle>邀请新用户</CardTitle>
                    <CardDescription>
                      绑定用户名，48 小时内有效，仅可使用一次。
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        await run(async () => {
                          const r = await send("/invitations", {
                            username: f.get("username"),
                          });
                          setModal(
                            <Modal title="专属邀请已创建" close={close}>
                              <p className="mb-4">受邀用户：{r.username}</p>
                              <Textarea
                                aria-label="邀请凭据"
                                readOnly
                                value={r.invitation}
                                rows={3}
                                onFocus={(e) => e.currentTarget.select()}
                              />
                            </Modal>,
                          );
                        }, "邀请已创建");
                      }}
                    >
                      <FieldGroup className="max-w-md">
                        <Field>
                          <FieldLabel htmlFor="invite-username">
                            受邀用户名
                          </FieldLabel>
                          <Input
                            id="invite-username"
                            name="username"
                            required
                            placeholder="例如 colleague"
                          />
                        </Field>
                        <Button variant="outline" type="submit">
                          生成邀请
                        </Button>
                      </FieldGroup>
                    </form>
                  </CardContent>
                </Card>
              )}
            </TabsContent>
            <TabsContent value="storage" className="settings-panel">
              <StorageUsage key={user.id} tick={tick} />
              <Card>
                <CardHeader>
                  <CardTitle>导出工作区</CardTitle>
                  <CardDescription>
                    论文、附件与笔记，打包为 ZIP。
                  </CardDescription>
                </CardHeader>
                <CardFooter>
                  <Button asChild variant="outline">
                    <a href="/api/v1/export">
                      <Download data-icon="inline-start" />
                      下载完整导出 ZIP
                    </a>
                  </Button>
                </CardFooter>
              </Card>
            </TabsContent>
            <TabsContent value="developer" className="settings-panel">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle>Agent 凭据</CardTitle>
                  <Button onClick={createToken}>
                    <Plus data-icon="inline-start" />
                    创建凭据
                  </Button>
                </CardHeader>
                <CardContent>
                  {tokens.length ? (
                    <ItemGroup role={undefined}>
                      {tokens.map((t) => (
                        <ListItem variant="outline" key={t.id}>
                          <ItemContent>
                            <ItemTitle>{t.name}</ItemTitle>
                            <ItemDescription>
                              {t.scopes.join(" + ")} · {date(t.expires)} 到期
                            </ItemDescription>
                          </ItemContent>
                          <ItemActions>
                            <Badge variant="secondary">
                              {t.revoked
                                ? "已撤销"
                                : new Date(t.expires) < new Date()
                                  ? "已过期"
                                  : "有效"}
                            </Badge>
                            <Button
                              variant="ghost"
                              disabled={t.revoked}
                              onClick={() => {
                                if (
                                  confirm(
                                    "撤销此凭据？对应 Agent 将立即失去访问权。",
                                  )
                                )
                                  run(
                                    () =>
                                      api("/tokens/" + t.id, {
                                        method: "DELETE",
                                      }),
                                    "凭据已撤销",
                                  );
                              }}
                            >
                              撤销
                            </Button>
                          </ItemActions>
                        </ListItem>
                      ))}
                    </ItemGroup>
                  ) : (
                    <Empty text="暂无 Agent 凭据" />
                  )}
                </CardContent>
                <CardFooter>
                  <Button asChild variant="link">
                    <a href="/api/v1/docs" target="_blank" rel="noreferrer">
                      API 文档
                      <ArrowUpRight data-icon="inline-end" />
                    </a>
                  </Button>
                </CardFooter>
              </Card>
            </TabsContent>
          </div>
        </Tabs>
      </section>
    </div>
  );
}
