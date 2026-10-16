import { createContext } from "react";
export const ContentTypesContext = createContext<Record<string, string>>({});
import {
  FileText,
  Quote,
  NotebookPen,
  Sparkles,
  CircleHelp,
  Layers,
  Link,
  Circle,
  CircleDot,
  CircleCheck,
} from "lucide-react";
import { Badge } from "./ui/badge";
import { kindLabel, statusLabel } from "../api";
const icons = {
  paper: FileText,
  evidence: Quote,
  note: NotebookPen,
  analysis: Sparkles,
  question: CircleHelp,
  topic: Layers,
  link: Link,
};
export function ContentBadge({ kind }: { kind: string }) {
  const Icon = icons[kind as keyof typeof icons] || NotebookPen;
  return (
    <Badge variant="semantic" data-kind={kind}>
      <Icon />
      {kind === "paper" ? "论文" : kindLabel[kind] || kind}
    </Badge>
  );
}
export function ReadingBadge({ status }: { status: string }) {
  const Icon =
    status === "read" ? CircleCheck : status === "reading" ? CircleDot : Circle;
  return (
    <Badge variant="semantic" data-kind={status}>
      <Icon />
      {statusLabel[status]}
    </Badge>
  );
}

const tagTones = [
  "blue",
  "green",
  "orange",
  "pink",
  "purple",
  "yellow",
] as const;
export function TagBadge({ label }: { label: string }) {
  const hash = Array.from(label.normalize()).reduce(
    (value, char) => (value * 31 + char.codePointAt(0)!) >>> 0,
    0,
  );
  return (
    <Badge variant="secondary" data-tag-tone={tagTones[hash % tagTones.length]}>
      {label}
    </Badge>
  );
}
