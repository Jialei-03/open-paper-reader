import { useRef, useState, type ComponentProps } from "react";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
} from "./ui/dropdown-menu";
import { InputGroup, InputGroupInput, InputGroupAddon } from "./ui/input-group";
import { ChevronDown } from "lucide-react";
import { cn } from "../lib/utils";

// The visual contract is measured from the reference; behavior stays in Radix.
export function ReaderButton({
  className,
  title,
  ...props
}: ComponentProps<typeof Button>) {
  const label = title || props["aria-label"];
  const button = (
    <Button
      {...props}
      data-reader-control=""
      className={cn("reader-control", className)}
    />
  );
  return label ? (
    <Tooltip delayDuration={500}>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent
        className="reader-control-tooltip"
        side="bottom"
        sideOffset={7}
      >
        {label}
      </TooltipContent>
    </Tooltip>
  ) : (
    button
  );
}

export function ReaderMenuContent({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuContent>) {
  return (
    <DropdownMenuContent
      align="start"
      sideOffset={8}
      {...props}
      className={cn("reader-component-menu", className)}
    />
  );
}

export function ReaderZoom({
  percent,
  mode,
  onPercent,
  apply,
  automatic,
  fitWidth,
  fitPage,
}: {
  percent: string;
  mode: string;
  onPercent: (value: string) => void;
  apply: (value: string) => void;
  automatic: () => void;
  fitWidth: () => void;
  fitPage: () => void;
}) {
  const edited = useRef(false);
  // Keep a user's draft intact while a resized pane recalculates its fit scale.
  const [draft, setDraft] = useState<string | null>(null);
  const modeLabel =
    mode === "auto" ? "自动缩放" : mode === "fit" ? "适合页宽" : "";
  const items = [
    { label: "自动缩放", selected: mode === "auto", action: automatic },
    { label: "实际大小", selected: mode === "1", action: () => apply("100") },
    { label: "适合页面", selected: false, action: fitPage },
    { label: "适合页宽", selected: mode === "fit", action: fitWidth },
    ...[50, 75, 100, 125, 150, 200, 300, 400].map((value) => ({
      label: `${value}%`,
      selected: mode === String(value / 100),
      action: () => apply(String(value)),
    })),
  ];
  return (
    <InputGroup className="reader-zoom-field" data-mode-label={!!modeLabel}>
      <InputGroupInput
        aria-label="PDF 缩放"
        aria-description={
          modeLabel
            ? `${modeLabel}，实际 ${percent}%；可输入自定义比例`
            : "可输入10%至800%的自定义比例"
        }
        inputMode="decimal"
        value={draft ?? percent}
        onChange={(e) => {
          edited.current = true;
          setDraft(e.target.value);
          onPercent(e.target.value);
        }}
        onFocus={(e) => {
          edited.current = false;
          setDraft(e.target.value);
          e.target.select();
        }}
        onBlur={() => {
          if (edited.current) apply(draft ?? percent);
          edited.current = false;
          setDraft(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
      {modeLabel && (
        <span className="reader-zoom-mode" aria-hidden="true">
          {modeLabel}
        </span>
      )}
      <InputGroupAddon align="inline-end">
        <span className="reader-zoom-percent" aria-hidden="true">
          %
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-xs" aria-label="缩放预设">
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <ReaderMenuContent aria-label="缩放预设">
            <DropdownMenuGroup>
              {items.map((item) => (
                <DropdownMenuItem
                  key={item.label}
                  data-selected={item.selected || undefined}
                  onSelect={item.action}
                >
                  {item.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </ReaderMenuContent>
        </DropdownMenu>
      </InputGroupAddon>
    </InputGroup>
  );
}
