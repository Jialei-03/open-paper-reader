import { useEffect, useId, useMemo, useState, type KeyboardEvent } from "react";
import { TextField } from "../../ui";
import styles from "./ModelForm.module.css";

/**
 * The model's name: typed freely, or picked from the provider's list. The list
 * opens under the field in the flow of the form (it pushes what follows down),
 * so every model the provider gave can be scrolled to and nothing is covered.
 * A native datalist was placed by the browser over the field and its hint.
 */
export function ModelNamePicker({
  label,
  value,
  models,
  placeholder,
  disabled,
  error,
  description,
  onChange,
}: {
  label: string;
  value: string;
  models: readonly string[] | null;
  placeholder?: string;
  disabled?: boolean;
  error?: string;
  description?: string;
  onChange(value: string): void;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const all = models ?? [];
  // A name that is one of the list shows the whole list; a typed part narrows it.
  const shown = useMemo(() => {
    const query = value.trim().toLowerCase();
    if (!query || all.includes(value)) return all;
    return all.filter((name) => name.toLowerCase().includes(query));
  }, [all, value]);
  const expanded = open && shown.length > 0;

  // Keeps the name the arrow keys reached in view inside the scrolled list.
  useEffect(() => {
    if (expanded) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [expanded, active, listId]);

  const pick = (name: string) => {
    onChange(name);
    setOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!expanded) {
        setOpen(true);
        return;
      }
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) => (index + step + shown.length) % shown.length);
    } else if (event.key === "Enter" && expanded) {
      event.preventDefault();
      pick(shown[Math.min(active, shown.length - 1)]);
    } else if (event.key === "Escape" && expanded) {
      event.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div className={styles.picker}>
      <TextField
        label={label}
        role="combobox"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={expanded ? `${listId}-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        error={error}
        description={description}
        onFocus={() => setOpen(true)}
        // A field focused before the list arrived opens it with a click.
        onClick={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        onChange={(event) => {
          onChange(event.target.value);
          setActive(0);
          setOpen(true);
        }}
      />
      {expanded && (
        <ul id={listId} role="listbox" aria-label={label} className={styles.options}>
          {shown.map((name, index) => (
            <li
              key={name}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={name === value}
              data-active={index === active || undefined}
              className={styles.option}
              // Before the field's blur, so the click lands on the name.
              onMouseDown={(event) => {
                event.preventDefault();
                pick(name);
              }}
              onMouseEnter={() => setActive(index)}
            >
              {name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
