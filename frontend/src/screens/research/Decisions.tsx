import { Check, X } from "lucide-react";
import { useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/i18n";
import { Button, TextArea, toast } from "../../ui";
import { decide, type Decision, type ResearchNode } from "./research-api";
import styles from "./Research.module.css";

/**
 * What the advisor asked the researcher to decide: its proposal, why, and the
 * node it is about; agree (the proposal is carried out) or not, with a word
 * the agent reads next sprint.
 */
export function Decisions({
  projectId,
  decisions,
  nodes,
  onDecided,
}: {
  projectId: string;
  decisions: Decision[];
  nodes: ResearchNode[];
  onDecided(): void;
}) {
  const { t } = useI18n();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const open = decisions.filter((decision) => decision.open);
  if (open.length === 0) return null;
  const answer = async (decision: Decision, approve: boolean) => {
    setBusy(decision.id);
    try {
      await decide(projectId, decision.id, approve, notes[decision.id] ?? "");
      onDecided();
    } catch (error) {
      toast.show({
        message: error instanceof Error ? error.message : String(error),
        tone: "error",
      });
    } finally {
      setBusy("");
    }
  };
  return (
    <section className={styles.decisions} aria-labelledby="research-decisions">
      <h2 id="research-decisions" className={styles.sectionTitle}>
        {t("research.decisions")}
      </h2>
      {open.map((decision) => {
        const node = nodes.find((row) => row.id === decision.detail.node_id);
        return (
          <div key={decision.id} className={styles.decision}>
            <p>
              <strong>
                {t(
                  `research.proposal.${decision.detail.proposal}` as MessageKey,
                )}
              </strong>
              {node && (
                <span className={styles.decisionNode}>{node.title}</span>
              )}
            </p>
            <p className={styles.hint}>{decision.detail.reason}</p>
            {decision.detail.new_hypothesis && (
              <p className={styles.hint}>
                {t("research.proposal.newHypothesis", {
                  title: decision.detail.new_hypothesis.title,
                })}
              </p>
            )}
            <TextArea
              label={t("research.decisionNote")}
              value={notes[decision.id] ?? ""}
              autoGrow
              maxRows={4}
              onChange={(event) =>
                setNotes((old) => ({
                  ...old,
                  [decision.id]: event.target.value,
                }))
              }
            />
            <div className={styles.actions}>
              <Button
                variant="ghost"
                icon={X}
                disabled={busy === decision.id}
                onClick={() => void answer(decision, false)}
              >
                {t("research.reject")}
              </Button>
              <Button
                variant="primary"
                icon={Check}
                loading={busy === decision.id}
                onClick={() => void answer(decision, true)}
              >
                {t("research.approve")}
              </Button>
            </div>
          </div>
        );
      })}
    </section>
  );
}
