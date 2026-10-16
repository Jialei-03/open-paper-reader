import { useState } from "react";
import { ChevronDown, RotateCcw, Zap } from "lucide-react";
import { send } from "../api";
import type { InferenceModel } from "./ModelOptions";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  PopoverHeader,
  PopoverTitle,
} from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Alert, AlertDescription } from "@/components/ui/alert";

const labels: Record<string, string> = {
  default: "默认",
  disabled: "关闭",
  adaptive: "自适应",
  enabled: "开启",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "很高",
  max: "最高",
};
type Model = InferenceModel & { shared?: boolean; badge?: string };
export function QuickModelPicker({
  models,
  value,
  onChange,
  onModels,
  onBusy,
  disabled = false,
  label,
  onAdd,
  fixed = false,
}: {
  models: Model[];
  value: string;
  onChange: (id: string) => void;
  onModels: (models: Model[]) => void;
  onBusy: (busy: boolean) => void;
  disabled?: boolean;
  label: string;
  onAdd: () => void;
  /** The app picks the thinking strength for this job (translation, locating
   * text), so there is nothing for the reader to set and no chip to show. */
  fixed?: boolean;
}) {
  const [modelOpen, setModelOpen] = useState(false);
  const [effortOpen, setEffortOpen] = useState(false);
  const [sliderMoved, setSliderMoved] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<number | null>(null);
  const selected = models.find((model) => model.id === value);
  const modes = selected?.controls?.thinking_modes || ["default"];
  const efforts = selected?.controls?.effort_levels || ["default"];
  const mode = selected?.thinking_mode || "default";
  const effort = selected?.reasoning_effort || "default";
  const hasEffort = efforts.length > 1;
  const steps = hasEffort ? efforts : modes;
  const current = hasEffort ? effort : mode;
  const index = preview ?? Math.max(0, steps.indexOf(current));
  const strength =
    mode === "disabled" ? "关闭" : labels[hasEffort ? effort : mode];
  const blocked = disabled || saving;
  const name = selected?.name || selected?.model || "选择模型";
  const shortName =
    name === selected?.model ? name.replace(/^MiniMax-/, "") : name;

  async function save(nextMode: string, nextEffort: string) {
    if (!selected || saving) return;
    setSaving(true);
    onBusy(true);
    setError("");
    try {
      const config = await send(
        `/translation-settings/configs/${selected.id}/options`,
        {
          thinking_mode: nextMode,
          reasoning_effort: nextMode === "disabled" ? "default" : nextEffort,
        },
        "PUT",
      );
      onModels(config.models);
      window.dispatchEvent(new Event("model-settings-updated"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
      onBusy(false);
      setPreview(null);
    }
  }
  return (
    <div
      className="flex min-w-0 items-center gap-0.5"
      data-testid={label + "-picker"}
    >
      <DropdownMenu
        open={modelOpen}
        onOpenChange={(open) => {
          setModelOpen(open);
          if (open) setEffortOpen(false);
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={blocked}
            aria-label={label + " 模型"}
            title={fixed ? `${name} · 自动使用较低的思考强度，速度更快` : name}
            className="quick-model-trigger min-w-0 max-w-52 shrink"
          >
            <span className="truncate">{shortName}</span>
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          side="top"
          className="quick-model-surface max-w-[calc(100vw-2rem)]"
        >
          <DropdownMenuLabel>选择模型</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={value}
            onValueChange={(id) => {
              setError("");
              setPreview(null);
              onChange(id);
            }}
          >
            {models.map((model) => (
              <DropdownMenuRadioItem key={model.id} value={model.id}>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{model.name || model.model}</span>
                  {model.shared && (
                    <span className="text-xs text-muted-foreground">
                      {model.badge || "共享模型"}
                    </span>
                  )}
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          {!models.length && (
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={onAdd}>添加模型</DropdownMenuItem>
            </DropdownMenuGroup>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {!fixed && (
        <Popover
          open={effortOpen}
          onOpenChange={(open) => {
            setEffortOpen(open);
            if (open) {
              setModelOpen(false);
              setSliderMoved(false);
            }
          }}
        >
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={blocked || !selected}
              aria-label={label + " 思考强度"}
              title="调整思考模式与强度"
              className="quick-model-trigger"
              aria-busy={saving}
            >
              {/* The bolt says what a bare "默认" or "关闭" is the strength of. */}
              <Zap className="size-3.5 text-muted-foreground" />
              {strength}
              <ChevronDown />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="end"
            className="quick-model-surface flex max-w-[calc(100vw-2rem)] flex-col gap-3 rounded-xl"
            aria-label={label + " 快捷参数"}
            onCloseAutoFocus={(event) => {
              setPreview(null);
              if (modelOpen) event.preventDefault();
            }}
          >
            <PopoverHeader className="flex-row items-center justify-between">
              <Zap className="size-4 text-muted-foreground" />
              <PopoverTitle className="quick-effort-label">
                <span key={mode === "disabled" ? "disabled" : steps[index]}>
                  {mode === "disabled" ? "关闭思考" : labels[steps[index]]}
                </span>
              </PopoverTitle>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={blocked}
                aria-label="恢复模型默认"
                onClick={() => void save("default", "default")}
              >
                <RotateCcw />
              </Button>
            </PopoverHeader>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-w-0"
              disabled={blocked}
              title={name}
              onClick={() => {
                setEffortOpen(false);
                setModelOpen(true);
              }}
            >
              <span className="truncate">{name}</span>
              <ChevronDown />
            </Button>
            {steps.length > 1 && (
              <div className="flex flex-col gap-3 px-1">
                <Slider
                  className="quick-effort-slider"
                  marks={steps.length}
                  data-dragging={dragging}
                  data-animated={sliderMoved}
                  onPointerDownCapture={() => setDragging(true)}
                  onPointerUpCapture={() => setDragging(false)}
                  onPointerCancel={() => setDragging(false)}
                  aria-label={label + " 强度滑杆"}
                  aria-valuetext={labels[steps[index]]}
                  min={0}
                  max={steps.length - 1}
                  step={1}
                  value={[index]}
                  disabled={blocked || (hasEffort && mode === "disabled")}
                  onValueChange={([next]) => {
                    setSliderMoved(true);
                    setPreview(next);
                  }}
                  onValueCommit={([next]) => {
                    setDragging(false);
                    void save(
                      hasEffort ? mode : steps[next],
                      hasEffort ? steps[next] : "default",
                    );
                  }}
                />
                <div
                  className="flex justify-between text-xs text-muted-foreground"
                  aria-hidden
                >
                  {steps.map((step) => (
                    <span key={step}>{labels[step]}</span>
                  ))}
                </div>
              </div>
            )}
            {hasEffort && modes.includes("disabled") && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={blocked}
                    aria-label={label + " 思考模式"}
                  >
                    思考：{labels[mode]}
                    <ChevronDown />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="center">
                  <DropdownMenuRadioGroup
                    value={mode}
                    onValueChange={(next) => void save(next, effort)}
                  >
                    {modes.map((item) => (
                      <DropdownMenuRadioItem key={item} value={item}>
                        {labels[item]}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {!modes.includes("disabled") && (
              <p className="text-xs text-muted-foreground">思考始终开启</p>
            )}
            <span role="status" className="sr-only">
              {saving ? "正在保存…" : "用于下一次任务"}
            </span>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
