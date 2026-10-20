import { Check, ChevronDown, Cpu, Sparkles } from "lucide-react";
import { Menu, type MenuEntry } from "../../../ui";
import type { ModelRow } from "../../setup/model-api";
import type { Compute } from "../research-api";
import styles from "./Talk.module.css";

function Picker({
  label,
  current,
  items,
  icon: Icon,
}: {
  label: string;
  current: string;
  items: MenuEntry[];
  icon: typeof Cpu;
}) {
  return (
    <Menu
      label={label}
      items={items}
      placement={{ side: "top", align: "start" }}
      trigger={(props) => (
        <button type="button" className={styles.chip} {...props}>
          <Icon size={14} aria-hidden />
          {current}
          <ChevronDown size={12} aria-hidden />
        </button>
      )}
    />
  );
}

export function ModelPicker({
  models,
  value,
  onChange,
  label,
}: {
  models: ModelRow[];
  value: string;
  onChange(id: string): void;
  label: string;
}) {
  const name = (row: ModelRow) => row.name || row.model;
  const current = models.find((row) => row.id === value);
  return (
    <Picker
      label={label}
      icon={Sparkles}
      current={current ? name(current) : label}
      items={models.map((row) => ({
        id: row.id,
        label: name(row),
        icon: row.id === value ? Check : undefined,
        onSelect: () => onChange(row.id),
      }))}
    />
  );
}

export function ComputePicker({
  computes,
  value,
  onChange,
  label,
}: {
  computes: Compute[];
  value: string;
  onChange(id: string): void;
  label: string;
}) {
  const current = computes.find((c) => c.id === value);
  return (
    <Picker
      label={label}
      icon={Cpu}
      current={current?.name ?? label}
      items={computes
        .filter((c) => c.ready !== false || c.id === value)
        .map((c) => ({
          id: c.id,
          label: c.name + (c.gpus ? ` · GPU ${c.gpus}` : ""),
          icon: c.id === value ? Check : undefined,
          onSelect: () => onChange(c.id),
        }))}
    />
  );
}
