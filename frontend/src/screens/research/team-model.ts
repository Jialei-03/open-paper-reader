import { zh } from "../../i18n/messages/zh";
import type { TeamMember, TeamMessage } from "./team-api";
import { memberName } from "../team/member-model";

export const memberLabel = (
  member: TeamMember | undefined,
  t: Parameters<typeof memberName>[1],
) => (member ? memberName(member, t) : "");

export const normalizedText = (text: string) => text.replaceAll("\\n", "\n");
export function mentionQuery(text: string, caret: number) {
  const match = text.slice(0, caret).match(/(?:^|\s)@([^\s@]*)$/u);
  return match
    ? {
        query: match[1].toLocaleLowerCase(),
        start: caret - match[1].length - 1,
        end: caret,
      }
    : null;
}
export function mentionMatches(
  members: TeamMember[],
  query: string,
  name: (member: TeamMember) => string,
) {
  return members.filter(
    (m) =>
      m.enabled !== false &&
      !m.deleted &&
      `${m.name} ${m.role} ${name(m)}`.toLocaleLowerCase().includes(query),
  );
}
export const sendMode = (event: { metaKey: boolean; ctrlKey: boolean }) =>
  event.metaKey || event.ctrlKey ? ("immediate" as const) : ("queue" as const);
export function orderedMessages(messages: TeamMessage[]) {
  return [
    ...new Map(
      messages.map((m) => [m.id, { ...m, text: normalizedText(m.text) }]),
    ).values(),
  ].sort(
    (a, b) =>
      a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  );
}

export const defaultChannelNames: Record<string, string> = {
  review: zh["team.channel.review"],
  experiments: zh["team.channel.experiments"],
  writing: zh["team.channel.writing"],
  general: zh["team.channel.general"],
};
