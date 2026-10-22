import { Check, ChevronDown, Workflow as WorkflowIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { Menu } from "../../ui";
import { readWorkflows, workflowName, type Workflow } from "./workflows-api";
import styles from "./Workflows.module.css";

export function WorkflowPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange(id: string): void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const [items, setItems] = useState<Workflow[]>([]);
  const [failed, setFailed] = useState(false);
  const [reads, setReads] = useState(0);
  useEffect(() => {
    let cancelled = false;
    readWorkflows().then(
      (value) => {
        if (!cancelled) {
          setItems(value);
          setFailed(false);
        }
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [reads]);
  const current = items.find((item) => item.id === value);
  return (
    <Menu
      label={t("workflows.title")}
      placement={{ side: "top", align: "start" }}
      items={[
        ...items.map((item) => ({
          id: item.id,
          label: workflowName(item, t),
          icon: item.id === value ? Check : undefined,
          onSelect: () => onChange(item.id),
        })),
        ...(failed
          ? [
              {
                id: "retry",
                label: t("common.retry"),
                onSelect: () => setReads((n) => n + 1),
              },
            ]
          : []),
      ]}
      trigger={(props) => (
        <button
          type="button"
          className={styles.picker}
          aria-label={t("workflows.title")}
          disabled={disabled || (!items.length && !failed)}
          {...props}
        >
          <WorkflowIcon aria-hidden />
          <span>
            {current
              ? workflowName(current, t)
              : t("workflows.builtin.research")}
          </span>
          <ChevronDown aria-hidden />
        </button>
      )}
    />
  );
}
