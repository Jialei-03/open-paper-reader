import { describe, expect, it } from "vitest";
import { en } from "../../i18n/messages/en";
import {
  moveStep,
  stepName,
  workflowName,
  type Workflow,
} from "./workflows-api";
import { buildThread } from "../research/talk/thread";
import type { ResearchEvent } from "../research/research-api";

const workflow: Workflow = {
  id: "literature-review",
  name: "Literature",
  version: 1,
  builtin: true,
  steps: [
    {
      name: "Collect",
      type: "agent",
      instructions: "",
      outputs: [],
      confirmation: false,
      max_rounds: 3,
      max_retries: 2,
    },
  ],
};
describe("workflows", () => {
  it("reorders steps without mutating a saved definition", () => {
    const steps = ["read", "write", "review"];
    expect(moveStep(steps, 0, 2)).toEqual(["write", "review", "read"]);
    expect(steps).toEqual(["read", "write", "review"]);
    expect(moveStep(steps, -1, 0)).toBe(steps);
  });
  it("localizes built-in names and preserves user names", () => {
    const t = (key: keyof typeof en) => en[key];
    expect(workflowName(workflow, t)).toBe("Literature review");
    expect(stepName(workflow, 0, t)).toBe("Collect papers");
    expect(
      workflowName({ ...workflow, builtin: false, name: "Custom" }, t),
    ).toBe("Custom");
  });
  it("keeps start, completion, outputs and checkpoints in the conversation", () => {
    const event = (
      id: string,
      action: string,
      detail: Record<string, unknown>,
    ): ResearchEvent => ({
      id,
      action,
      detail,
      actor: "system",
      node_id: null,
      sprint_id: null,
      created_at: id,
    });
    const thread = buildThread(
      [
        event("1", "workflow_step_started", { index: 0, status: "running" }),
        event("2", "workflow_step_finished", {
          index: 0,
          status: "waiting",
          outputs: ["review/sources.md"],
        }),
        event("3", "decision_requested", { kind: "workflow_step", index: 0 }),
        event("4", "workflow_step_checkpoint", {
          index: 0,
          outputs: ["workflow/step-1-1.md"],
        }),
      ],
      [],
      [],
      [],
      "workflow",
    );
    expect(thread.map((item) => item.kind)).toEqual([
      "workflow",
      "workflow",
      "decision",
      "workflow",
    ]);
    expect(thread[1]).toMatchObject({
      kind: "workflow",
      status: "waiting",
      outputs: ["review/sources.md"],
    });
  });
});
