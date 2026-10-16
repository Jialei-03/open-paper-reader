import { ModelOptions, type InferenceModel } from "./ModelOptions";
import { useEffect, useRef, useState } from "react";
import { api, send } from "../api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Plus,
  MoreHorizontal,
  Check,
  Pencil,
  Plug,
  Image,
  Trash2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

type Model = InferenceModel & {
  shared?: boolean;
  badge?: string;
  concurrency_limit?: number;
  vision: boolean;
  context_length?: number | null;
  id: string;
  name: string;
  model: string;
  protocol: "openai" | "anthropic";
  base_url: string;
};
type Draft = Model & { api_key: string };
const empty: Draft = {
  vision: false,
  id: "",
  name: "",
  model: "",
  protocol: "openai",
  base_url: "",
  api_key: "",
};
export function TranslationSettings({ run }: any) {
  const [config, setConfig] = useState<{
    active_id: string;
    models: Model[];
  } | null>(null);
  const [parameterModel, setParameterModel] = useState<Model | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [manual, setManual] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  useEffect(() => {
    api("/translation-settings")
      .then(setConfig)
      .catch((e) => run(() => Promise.reject(e)));
  }, []);
  function edit(value?: Model) {
    request.current++;
    setDraft(value ? { ...value, api_key: "" } : { ...empty });
    setModels([]);
    setError("");
    setManual(false);
    setLoading(false);
  }
  function change(values: Partial<Draft>, invalidate = false) {
    setDraft((old) => old && { ...old, ...values });
    if (invalidate) {
      request.current++;
      setModels([]);
      setLoading(false);
      setError("");
    }
  }
  async function loadModels() {
    if (!draft) return;
    const id = ++request.current;
    setLoading(true);
    setError("");
    try {
      const value = await send("/translation-settings/models", draft);
      if (id === request.current) {
        setModels(value.models);
        setManual(false);
      }
    } catch (e) {
      if (id === request.current) setError((e as Error).message);
    } finally {
      if (id === request.current) setLoading(false);
    }
  }
  async function action(
    fn: () => Promise<any>,
    message: string,
    replace = true,
  ) {
    setBusy(true);
    try {
      await run(async () => {
        const value = await fn();
        if (replace) setConfig(value);
      }, message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="settings-model-section">
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <CardTitle>模型</CardTitle>
          <Button variant="outline" onClick={() => edit()}>
            <Plus data-icon="inline-start" />
            添加模型
          </Button>
        </div>
        <CardDescription>供翻译与研究助手使用</CardDescription>
      </CardHeader>
      <CardContent>
        {config?.models.length ? (
          <div className="settings-model-list">
            {config.models.map((row) => (
              <div key={row.id} className="settings-model-row">
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="truncate">
                      {row.name || row.model}
                    </strong>
                    {row.shared && (
                      <Badge
                        title={
                          row.concurrency_limit != null
                            ? row.concurrency_limit === 0
                              ? "共享并发不限"
                              : `共享并发最多 ${row.concurrency_limit}`
                            : undefined
                        }
                      >
                        {row.badge || "共享模型"}
                      </Badge>
                    )}
                    {config.active_id === row.id && (
                      <Badge variant="secondary">默认翻译</Badge>
                    )}
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {row.name !== row.model && <>{row.model} · </>}
                    上下文{" "}
                    {row.context_length
                      ? new Intl.NumberFormat("en", {
                          notation: "compact",
                          maximumFractionDigits: 1,
                        }).format(row.context_length)
                      : "未提供"}
                    {" · 输入："}
                    {row.vision ? "文本、图片" : "文本"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`${row.name || row.model}的操作`}
                      >
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuGroup>
                        <DropdownMenuItem
                          onSelect={() => setParameterModel(row)}
                        >
                          <Pencil />
                          模型参数
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={busy || config.active_id === row.id}
                          onSelect={() =>
                            void action(
                              () =>
                                send(
                                  `/translation-settings/configs/${row.id}/select`,
                                  {},
                                ),
                              "默认模型已切换",
                            )
                          }
                        >
                          <Check />
                          {config.active_id === row.id
                            ? "当前默认模型"
                            : "设为默认"}
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                      {!row.shared && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuGroup>
                            <DropdownMenuItem onSelect={() => edit(row)}>
                              <Pencil />
                              编辑模型
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={busy}
                              onSelect={() =>
                                void action(
                                  () =>
                                    send(
                                      `/translation-settings/configs/${row.id}/test`,
                                      {},
                                    ),
                                  "模型连接成功",
                                  false,
                                )
                              }
                            >
                              <Plug />
                              测试连接
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={busy}
                              onSelect={() =>
                                void action(
                                  () =>
                                    send(
                                      `/translation-settings/configs/${row.id}/vision-test`,
                                      {},
                                    ),
                                  "图片识别测试通过，已开启视觉输入",
                                )
                              }
                            >
                              <Image />
                              测试图片输入
                            </DropdownMenuItem>
                          </DropdownMenuGroup>
                          <DropdownMenuSeparator />
                          <DropdownMenuGroup>
                            <DropdownMenuItem
                              variant="destructive"
                              disabled={busy}
                              onSelect={() =>
                                void action(
                                  () =>
                                    send(
                                      `/translation-settings/configs/${row.id}`,
                                      {},
                                      "DELETE",
                                    ),
                                  "模型已移除",
                                )
                              }
                            >
                              <Trash2 />
                              移除模型
                            </DropdownMenuItem>
                          </DropdownMenuGroup>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {config ? "尚未添加模型。" : "正在加载模型…"}
          </p>
        )}
      </CardContent>
      {parameterModel && (
        <ModelOptions
          model={parameterModel}
          onClose={() => setParameterModel(null)}
          onSaved={setConfig}
        />
      )}
      <Dialog
        open={!!draft}
        onOpenChange={(open) => {
          if (!open && !busy) {
            request.current++;
            setDraft(null);
          }
        }}
      >
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "编辑模型" : "添加模型"}</DialogTitle>
            <DialogDescription>
              支持 OpenAI 与 Anthropic 兼容服务，密钥仅保存在服务器。
            </DialogDescription>
          </DialogHeader>
          {draft && (
            <form
              className="flex min-h-0 flex-col"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError("");
                try {
                  const value = await send(
                    draft.id
                      ? "/translation-settings"
                      : "/translation-settings/configs",
                    draft,
                    draft.id ? "PUT" : "POST",
                  );
                  setConfig(value);
                  request.current++;
                  setDraft(null);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <FieldGroup className="min-h-0 overflow-y-auto pr-1">
                <Field>
                  <FieldLabel htmlFor="model-name">显示名称</FieldLabel>
                  <Input
                    id="model-name"
                    value={draft.name}
                    onChange={(e) => change({ name: e.target.value })}
                    placeholder="例如 MiniMax 翻译"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="model-protocol">接口协议</FieldLabel>
                  <Select
                    value={draft.protocol}
                    onValueChange={(value) =>
                      change({ protocol: value as Draft["protocol"] }, true)
                    }
                  >
                    <SelectTrigger id="model-protocol" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="openai">OpenAI</SelectItem>
                        <SelectItem value="anthropic">Anthropic</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="translation-url">
                    模型服务地址
                  </FieldLabel>
                  <Input
                    id="translation-url"
                    type="url"
                    required
                    value={draft.base_url}
                    onChange={(e) => change({ base_url: e.target.value }, true)}
                    placeholder={
                      draft.protocol === "anthropic"
                        ? "https://api.anthropic.com"
                        : "https://api.minimax.cn/v1"
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="translation-key">API Key</FieldLabel>
                  <Input
                    id="translation-key"
                    type="password"
                    autoComplete="new-password"
                    required={!draft.id}
                    value={draft.api_key}
                    onChange={(e) => change({ api_key: e.target.value }, true)}
                    placeholder={
                      draft.id ? "已保存，留空保持不变" : "填写服务商提供的 Key"
                    }
                  />
                  <FieldDescription>
                    更换服务地址或协议时需重新填写 Key。
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="translation-model">模型名称</FieldLabel>
                  {manual ? (
                    <Input
                      id="translation-model"
                      required
                      value={draft.model}
                      onChange={(e) => change({ model: e.target.value })}
                    />
                  ) : (
                    <Select
                      value={draft.model}
                      onValueChange={(model) => change({ model })}
                    >
                      <SelectTrigger id="translation-model" className="w-full">
                        <SelectValue placeholder="获取上游模型后选择" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {[
                            ...new Set(
                              [draft.model, ...models].filter(Boolean),
                            ),
                          ].map((name) => (
                            <SelectItem key={name} value={name}>
                              {name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  )}
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      type="button"
                      size="sm"
                      disabled={busy || loading || !draft.base_url}
                      onClick={() => void loadModels()}
                    >
                      {loading ? "正在查询…" : "获取上游模型"}
                    </Button>
                    <Button
                      variant="ghost"
                      type="button"
                      size="sm"
                      onClick={() => setManual(!manual)}
                    >
                      {manual ? "从列表选择" : "手动填写"}
                    </Button>
                  </div>
                  {/^MiniMax-M2/i.test(draft.model) && (
                    <FieldDescription>
                      MiniMax M2 系列无法关闭思考；非思考翻译请选择 M3。
                    </FieldDescription>
                  )}
                </Field>
                <Field>
                  <FieldLabel htmlFor="model-context">
                    上下文长度（tokens）
                  </FieldLabel>
                  <Input
                    id="model-context"
                    type="number"
                    min={1}
                    max={100000000}
                    step={1}
                    value={draft.context_length ?? ""}
                    placeholder="未提供"
                    onChange={(e) =>
                      change({
                        context_length: e.target.value
                          ? Number(e.target.value)
                          : null,
                      })
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="model-vision">
                    图片输入（视觉）
                  </FieldLabel>
                  <Switch
                    id="model-vision"
                    checked={!!draft.vision}
                    onCheckedChange={(vision) => change({ vision })}
                  />
                  <FieldDescription>
                    所选模型支持识图时开启。Agent 会发送 PDF
                    页面或图表图片；未开启时仅展示图片。此开关不代表已验证模型能力。
                  </FieldDescription>
                </Field>
                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
              </FieldGroup>
              <div className="flex shrink-0 justify-end pt-4">
                <Button disabled={busy || !draft.model} type="submit">
                  {busy ? "正在保存…" : "保存模型"}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
