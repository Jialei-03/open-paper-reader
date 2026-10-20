import type { MessageKey } from "../../i18n/i18n";
import type { Step } from "./conversation";

type Translate = (
  key: MessageKey,
  vars?: Record<string, string | number>,
) => string;

/** How one step reads, for the exchange and the scene alike. */
export interface Described {
  label: string;
  note: string;
  /** A short fact beside the label: a status change, a met kill condition. */
  meta: string;
  tone: "" | "warn" | "done";
  /** The experiment whose log the step can open. */
  jobId: string;
}

const text = (value: unknown) => (typeof value === "string" ? value : "");

/** The step in words, or null for one that says nothing worth showing. */
export function describeStep(t: Translate, step: Step): Described | null {
  const d = step.detail;
  const out = (
    label: string,
    note = "",
    tone: Described["tone"] = "",
    meta = "",
    jobId = "",
  ): Described => ({ label, note, tone, meta, jobId });
  switch (step.action) {
    case "focus":
      return out(t("research.talk.focus"), text(d.intent));
    case "add_node":
      return out(
        t("research.talk.add", {
          kind: t(`research.kind.${text(d.kind) || "question"}` as MessageKey),
        }),
        text(d.kill_if)
          ? t("research.talk.killIf", { text: text(d.kill_if) })
          : text(d.reason),
      );
    case "update_node": {
      const before = (d.before ?? {}) as Record<string, unknown>;
      const after = (d.after ?? {}) as Record<string, unknown>;
      // Confidence and doubts change on every result; the status is what reads as a decision.
      if (!text(after.status)) return null;
      return out(
        t("research.talk.update"),
        text(d.reason),
        "",
        t("research.talk.status", {
          from: t(
            `research.node.${text(before.status) || "open"}` as MessageKey,
          ),
          to: t(`research.node.${text(after.status)}` as MessageKey),
        }),
      );
    }
    case "run_job":
      return out(
        t("research.talk.run"),
        text(d.command).split("\n")[0].slice(0, 160),
        "",
        "",
        text(d.job_id),
      );
    case "record_result":
      return d.kill_triggered === "yes"
        ? out(
            t("research.talk.record"),
            text(d.summary),
            "warn",
            t("research.talk.killed"),
          )
        : out(t("research.talk.record"), text(d.summary));
    case "end_sprint":
      return text(d.needs_input)
        ? out(
            t("research.talk.needs", { text: text(d.needs_input) }),
            "",
            "warn",
          )
        : null;
    case "advice":
      return out(
        t(`research.talk.verdict.${text(d.verdict)}` as MessageKey),
        text(d.reason),
        d.verdict === "kill" || d.verdict === "pivot" ? "warn" : "",
      );
    case "advice_skipped":
      return out(t("research.talk.skipped"), text(d.note), "warn");
    case "drift_judged":
      return out(
        t(d.on_track ? "research.talk.onTrack" : "research.talk.drifted", {
          number: Number(d.sprint_number) || 0,
        }),
        text(d.note),
        d.on_track ? "" : "warn",
      );
    case "concluded":
      return out(
        t("research.talk.concluded", {
          ending: t(`research.end.${text(d.status)}` as MessageKey),
        }),
        text(d.summary),
        "done",
      );
    case "input_needed":
      return out(t("research.talk.inputNeeded"), text(d.summary), "warn");
    case "conclude_rejected":
      return out(t("research.talk.rejected"), text(d.why), "warn");
    case "drift_blocked":
      return out(
        t("research.talk.blocked", { tool: text(d.tool) }),
        t(`research.talk.blocked.${text(d.reason)}` as MessageKey),
        "warn",
      );
    case "auto_decided":
      return out(t("research.talk.auto", { proposal: text(d.proposal) }));
    case "decision_requested":
      return out(t("research.talk.asked"), text(d.reason), "warn");
    case "budget_mark":
      return out(
        t("research.talk.budget", {
          percent: Math.round(Number(d.mark) * 100),
        }),
      );
    case "playbook_version":
      return out(
        t("research.talk.playbook", {
          version: Number(d.version) || 0,
          count: Array.isArray(d.active) ? d.active.length : 0,
        }),
      );
    case "finished":
      return out(
        t("research.talk.finished", {
          ending: t(`research.end.${text(d.end_reason)}` as MessageKey),
        }),
      );
    case "distilled":
      return out(
        t("research.talk.distilled", {
          added: Number(d.added) || 0,
          edited: Number(d.edited) || 0,
          merged: Number(d.merged) || 0,
          deleted: Number(d.deleted) || 0,
          voted: Number(d.voted) || 0,
        }),
      );
    default:
      return null;
  }
}
