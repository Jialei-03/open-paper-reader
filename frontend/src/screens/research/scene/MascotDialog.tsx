import { Upload } from "lucide-react";
import { useI18n } from "../../../i18n/I18nProvider";
import type { MessageKey } from "../../../i18n/i18n";
import { Button, Dialog, TextField, toast } from "../../../ui";
import type { Agent } from "./frames";
import { Mascot } from "./Mascot";
import { IMAGE_BYTES, saveLooks, type Look } from "./mascots";
import styles from "./scene.module.css";

const AGENTS: Agent[] = ["executor", "advisor", "system", "distiller"];
const ROLE: Record<Agent, MessageKey> = {
  executor: "research.role.executor",
  advisor: "research.role.advisor",
  system: "research.role.system",
  distiller: "research.role.distiller",
};

/** Name each agent, or give it a figure of one's own design; kept in this browser. */
export function MascotDialog({
  open,
  looks,
  onChange,
  onClose,
}: {
  open: boolean;
  looks: Partial<Record<Agent, Look>>;
  onChange(looks: Partial<Record<Agent, Look>>): void;
  onClose(): void;
}) {
  const { t } = useI18n();
  const update = (agent: Agent, change: Partial<Look>) => {
    const next = {
      ...looks,
      [agent]: { name: "", image: "", ...looks[agent], ...change },
    };
    onChange(next);
    if (!saveLooks(next))
      toast.show({
        message: t("research.scene.looks.notSaved"),
        tone: "error",
      });
  };
  const upload = (agent: Agent, file: File | undefined) => {
    if (!file) return;
    if (file.size > IMAGE_BYTES) {
      toast.show({ message: t("research.scene.looks.tooBig"), tone: "error" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => update(agent, { image: String(reader.result) });
    reader.readAsDataURL(file);
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("research.scene.looks")}
      size="md"
    >
      <ul className={styles.looks}>
        {AGENTS.map((agent) => (
          <li key={agent} className={styles.look}>
            <div className={styles.lookFigure}>
              <Mascot agent={agent} look={looks[agent]} size={56} />
            </div>
            <div className={styles.lookFields}>
              <TextField
                label={`${t(ROLE[agent])} · ${t("research.scene.looks.name")}`}
                value={looks[agent]?.name ?? ""}
                placeholder={t(ROLE[agent])}
                maxLength={20}
                onChange={(event) =>
                  update(agent, { name: event.target.value })
                }
              />
              <div className={styles.lookActions}>
                <label className={styles.uploadLabel}>
                  <Upload size={14} aria-hidden="true" />
                  {t("research.scene.looks.upload")}
                  <input
                    type="file"
                    accept="image/png,image/svg+xml,image/gif,image/webp"
                    className={styles.visuallyHidden}
                    onChange={(event) => upload(agent, event.target.files?.[0])}
                  />
                </label>
                {(looks[agent]?.image || looks[agent]?.name) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => update(agent, { name: "", image: "" })}
                  >
                    {t("research.scene.looks.reset")}
                  </Button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
