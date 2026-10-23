import type {
  Workflow,
  WorkflowChannel,
  WorkflowMember,
} from "../screens/team/workflow/workflow-model";

// Shared only by unit tests and the isolated e2e-ui entry.
export const workflowMembers: WorkflowMember[] = [
  { id: "owner", name: "Leslie", kind: "human", role: "owner" },
  { id: "executor", name: "Alex", kind: "agent", role: "executor" },
  { id: "reviewer", name: "Morgan", kind: "agent", role: "reviewer" },
  { id: "writer", name: "Sam", kind: "agent", role: "writer" },
];
export const workflowChannels: WorkflowChannel[] = [
  { id: "lab", name: "Lab", kind: "channel" },
  { id: "papers", name: "Papers", kind: "channel" },
  { id: "writing", name: "Writing", kind: "channel" },
];
export const workflowFixture: Workflow = {
  id: "test-workflow",
  name: "Research",
  builtin: false,
  version: 1,
  rules: [
    {
      id: "review",
      enabled: true,
      when: {
        event: "message",
        channel: "lab",
        from_member: "executor",
        kind: "result",
      },
      then: {
        action: "review",
        member: "reviewer",
        instruction: "Check results",
        on_fail: "executor",
        max_rounds: 3,
      },
      limit: { per_thread: 10 },
    },
    {
      id: "wait",
      enabled: true,
      when: { event: "conclusion_proposed", from_role: "reviewer" },
      then: { action: "wait_for_owner" },
      limit: { per_thread: 5 },
    },
    {
      id: "subscribe",
      enabled: true,
      when: { event: "message", channel: "papers" },
      then: { action: "wake", role: "executor" },
      limit: { per_thread: 10 },
    },
    {
      id: "schedule",
      enabled: true,
      when: {
        event: "schedule",
        cron: "0 9 * * *",
        timezone: "Asia/Singapore",
      },
      then: { action: "post", channel: "papers", text: "Daily papers" },
      limit: { per_thread: 1 },
      position: { x: 0, y: 380 },
    },
  ],
  layout: {
    members: {
      executor: { x: 0, y: 0 },
      reviewer: { x: 340, y: 0 },
      owner: { x: 680, y: 0 },
    },
    channels: { lab: { x: 0, y: 190 }, papers: { x: 340, y: 190 } },
  },
};
