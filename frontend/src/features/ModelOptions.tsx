import { useState } from "react";
import { send } from "../api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from "@/components/ui/field";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";

export type InferenceModel = {
  id: string;
  model: string;
  name: string;
  thinking_mode?: string;
  reasoning_effort?: string;
  controls?: {
    thinking_modes: string[];
    effort_levels: string[];
    note: string;
  };
};
const labels: Record<string, string> = {
  default: "模型默认",
  disabled: "关闭",
  adaptive: "自适应",
  enabled: "开启（固定预算）",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "很高",
  max: "最高",
};

export function ModelOptions({
  model,
  onClose,
  onSaved,
}: {
  model: InferenceModel;
  onClose: () => void;
  onSaved: (config: any) => void;
}) {
  const [mode, setMode] = useState(model.thinking_mode || "default");
  const [effort, setEffort] = useState(model.reasoning_effort || "default");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const controls = model.controls;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>模型参数</DialogTitle>
          <DialogDescription>
            {model.name || model.model} ·
            仅对你的账户生效，用于助手对话、解释、导读与测验。翻译、目录、重点建议等固定任务会自动使用较低的思考强度，速度更快。
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-6"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            try {
              const config = await send(
                `/translation-settings/configs/${model.id}/options`,
                {
                  thinking_mode: mode,
                  reasoning_effort: mode === "disabled" ? "default" : effort,
                },
                "PUT",
              );
              onSaved(config);
              window.dispatchEvent(new Event("model-settings-updated"));
              onClose();
            } catch (error) {
              setError((error as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="thinking-mode">思考模式</FieldLabel>
              <Select
                value={mode}
                onValueChange={(value) => {
                  setMode(value);
                  if (value === "disabled") setEffort("default");
                }}
                disabled={busy}
              >
                <SelectTrigger id="thinking-mode" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {(controls?.thinking_modes || ["default"]).map((value) => (
                      <SelectItem key={value} value={value}>
                        {labels[value]}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              {controls?.note && (
                <FieldDescription>{controls.note}</FieldDescription>
              )}
              {mode === "enabled" && (
                <FieldDescription>
                  固定思考预算为 1,024 tokens。
                </FieldDescription>
              )}
            </Field>
            <Field>
              <FieldLabel htmlFor="reasoning-effort">
                思考强度（effort）
              </FieldLabel>
              <Select
                value={effort}
                onValueChange={setEffort}
                disabled={
                  busy ||
                  mode === "disabled" ||
                  controls?.effort_levels.length === 1
                }
              >
                <SelectTrigger id="reasoning-effort" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {(controls?.effort_levels || ["default"]).map((value) => (
                      <SelectItem key={value} value={value}>
                        {labels[value]}
                        {value !== "default" && ` · ${value}`}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onClose}
            >
              取消
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "正在保存…" : "保存参数"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
