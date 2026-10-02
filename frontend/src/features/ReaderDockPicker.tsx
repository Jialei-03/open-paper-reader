import { PanelBottom, PanelRight } from "lucide-react";
import { ReaderButton } from "../components/ReaderControls";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
export type ReaderDock = "right" | "bottom";
export function ReaderDockPicker({
  value,
  onChange,
}: {
  value: ReaderDock;
  onChange: (value: ReaderDock) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ReaderButton
          size="icon"
          variant="ghost"
          aria-label="阅读面板停靠位置"
          title="阅读面板停靠位置"
        >
          {value === "bottom" ? <PanelBottom /> : <PanelRight />}
        </ReaderButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(value) => onChange(value as ReaderDock)}
        >
          <DropdownMenuRadioItem value="right">停靠右侧</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="bottom">停靠底部</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
