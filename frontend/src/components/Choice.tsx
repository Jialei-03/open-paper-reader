import { Children, isValidElement, useState, type ReactNode } from "react";
import {
  Select,
  SelectItem,
  SelectGroup,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

export function Choice({
  children,
  value,
  defaultValue,
  onValueChange,
  className,
  ...props
}: {
  children: ReactNode;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  className?: string;
  name?: string;
  required?: boolean;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  const items = Children.toArray(children)
    .filter(isValidElement<{ value?: string; children: ReactNode }>)
    .map((child) => ({
      value: String(child.props.value ?? child.props.children),
      label: child.props.children,
    }));
  const [selected, setSelected] = useState(
    defaultValue ?? items[0]?.value ?? "",
  );
  return (
    <>
      {props.name && (
        <input type="hidden" name={props.name} value={value ?? selected} />
      )}
      <Select
        {...props}
        name={undefined}
        value={value === undefined ? undefined : value || "__empty__"}
        defaultValue={
          (defaultValue ??
            (value === undefined ? items[0]?.value : undefined)) ||
          "__empty__"
        }
        onValueChange={(v) => {
          const next = v === "__empty__" ? "" : v;
          setSelected(next);
          onValueChange?.(next);
        }}
      >
        <SelectTrigger className={className} aria-label={props["aria-label"]}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          <SelectGroup>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value || "__empty__"}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </>
  );
}
