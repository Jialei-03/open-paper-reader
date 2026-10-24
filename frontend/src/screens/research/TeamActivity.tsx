import { Bell, CheckCheck, MessageSquare } from "lucide-react";
import { useEffect, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { IconButton, SegmentedControl, toast } from "../../ui";
import { MemberAvatar } from "../team/MemberEditor";
import {
  readTeamActivity,
  refreshTeam,
  teamActivity,
  teamThreads,
  TEAM_EVENT,
  type Team,
  type TeamActivity,
  type TeamMessage,
} from "./team-api";
import {
  activityMessages,
  conversationName,
  memberLabel,
  recentThreads,
  threadActivity,
  threadDate,
} from "./team-model";
import styles from "./TeamActivity.module.css";

type MessageTarget = Pick<TeamMessage, "id" | "channel_id" | "thread_id">;

export function TeamInbox({
  team,
  activity,
  open,
}: {
  team: Team;
  activity: boolean;
  open(message: MessageTarget): void;
}) {
  const { t } = useI18n();
  const [events, setEvents] = useState<TeamActivity[]>([]);
  const [threads, setThreads] = useState<TeamMessage[]>([]);
  const [filter, setFilter] = useState<"all" | "mention" | "reply">("all");
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  useEffect(() => {
    let stale = false;
    setLoaded(false);
    setEvents([]);
    setThreads([]);
    setError("");
    const reload = async () => {
      try {
        if (activity) {
          const rows = await teamActivity(team.workspace_id);
          if (!stale) setEvents(rows);
        } else {
          const rows = await teamThreads(team.workspace_id);
          if (!stale) setThreads(rows);
        }
        if (!stale) setError("");
      } catch (reason) {
        if (!stale) setError(String(reason));
      } finally {
        if (!stale) setLoaded(true);
      }
    };
    void reload();
    const timer = window.setInterval(reload, 2500);
    window.addEventListener(TEAM_EVENT, reload);
    return () => {
      stale = true;
      clearInterval(timer);
      window.removeEventListener(TEAM_EVENT, reload);
    };
  }, [team.workspace_id, activity]);

  const read = async (event?: TeamActivity) => {
    const latest = activityMessages(events, "all")[0];
    if (!latest) return;
    await readTeamActivity(
      team.workspace_id,
      (event || latest).created_at,
      event?.id,
    );
    setEvents((current) =>
      current.map((row) =>
        (!event || row.id === event.id) &&
        row.created_at <= (event || latest).created_at
          ? { ...row, unread: false }
          : row,
      ),
    );
    refreshTeam();
  };
  const fail = (reason: unknown) =>
    toast.show({ message: String(reason), tone: "error" });
  const visible = activityMessages(events, filter);
  const rows = recentThreads(threads);
  return (
    <div className={styles.inbox}>
      {activity && (
        <div className={styles.toolbar}>
          <SegmentedControl
            kind="radio"
            label={t("team.activity")}
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: t("team.activity.all") },
              { value: "mention", label: t("team.activity.mentions") },
              { value: "reply", label: t("team.activity.replies") },
            ]}
          />
          <IconButton
            icon={CheckCheck}
            label={t("team.activity.readAll")}
            disabled={reading || !events.some((event) => event.unread)}
            onClick={async () => {
              setReading(true);
              try {
                await read();
              } catch (reason) {
                fail(reason);
              } finally {
                setReading(false);
              }
            }}
          />
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {!loaded && (
        <div className={styles.loading} aria-busy="true">
          <span />
          <span />
          <span />
        </div>
      )}
      {loaded && !(activity ? visible : rows).length && !error && (
        <div className={styles.empty}>
          {activity ? <Bell aria-hidden /> : <MessageSquare aria-hidden />}
        </div>
      )}
      <div className={styles.rows}>
        {activity
          ? visible.map((event) => (
              <ActivityRow
                key={event.id}
                team={team}
                event={event}
                open={() => {
                  if (event.unread) void read(event).catch(fail);
                  open(event);
                }}
              />
            ))
          : rows.map((message) => (
              <ThreadRow
                key={message.id}
                team={team}
                message={message}
                open={() =>
                  open({
                    ...message,
                    thread_id: message.id,
                  })
                }
              />
            ))}
      </div>
    </div>
  );
}

export function ActivityRow({
  team,
  event,
  open,
}: {
  team: Team;
  event: TeamActivity;
  open(): void;
}) {
  const { t, locale } = useI18n();
  const actor = team.members.find((member) => member.id === event.actor_id);
  const channel =
    event.channel ||
    team.channels.find((channel) => channel.id === event.channel_id);
  const action = t(`team.activity.${event.activity_type}`);
  const preview =
    event.preview ||
    event.text ||
    event.data.files?.map((file) => file.name).join(", ") ||
    action;
  return (
    <button
      type="button"
      className={styles.row}
      data-activity-id={event.id}
      data-unread={event.unread || undefined}
      onClick={open}
    >
      <span
        className={styles.dot}
        aria-label={
          event.unread ? t("team.unreadCount", { count: 1 }) : undefined
        }
      />
      <MemberAvatar member={actor} seed={actor ? undefined : "system"} />
      <span className={styles.content}>
        <span className={styles.line}>
          <span className={styles.title}>
            {t(
              channel?.member_id
                ? "team.activity.eventDirect"
                : "team.activity.event",
              {
                name: memberLabel(actor, t) || t("team.system"),
                channel: conversationName(channel, team.members, t),
                action,
              },
            )}
          </span>
          <time dateTime={event.created_at}>
            {threadDate(event.created_at, locale, new Date(), "relative")}
          </time>
        </span>
        <span className={styles.preview}>{preview}</span>
      </span>
    </button>
  );
}

export function ThreadRow({
  team,
  message,
  open,
}: {
  team: Team;
  message: TeamMessage;
  open(): void;
}) {
  const { t, locale } = useI18n();
  const channel =
    message.channel ||
    team.channels.find((channel) => channel.id === message.channel_id);
  const direct = team.members.find(
    (member) => member.id === channel?.member_id,
  );
  const author = team.members.find((member) => member.id === message.author_id);
  const participants = (message.participant_ids || [])
    .flatMap((id) => {
      const member = team.members.find((member) => member.id === id);
      return member ? [member] : [];
    })
    .slice(0, 3);
  return (
    <button
      type="button"
      className={styles.row}
      data-thread-id={message.id}
      data-unread={!!message.unread || undefined}
      onClick={open}
    >
      <span className={styles.content}>
        <span className={styles.line}>
          <span className={styles.source}>
            {direct && <MemberAvatar member={direct} size="sm" />}
            <span className={styles.title}>
              {conversationName(channel, team.members, t)}
            </span>
          </span>
          <time dateTime={threadActivity(message)}>
            {threadDate(threadActivity(message), locale)}
          </time>
        </span>
        <span className={styles.line}>
          <MemberAvatar
            member={author}
            seed={author ? undefined : "system"}
            size="sm"
          />
          <span className={styles.title}>
            {message.preview || message.data.title || message.text}
          </span>
        </span>
        <span className={styles.line}>
          {!!participants.length && (
            <span
              className={styles.participants}
              aria-label={participants
                .map((member) => memberLabel(member, t))
                .join(", ")}
            >
              {participants.map((member) => (
                <MemberAvatar key={member.id} member={member} size="sm" />
              ))}
            </span>
          )}
          <span className={styles.meta}>
            {t("team.replies", { n: message.replies })}
          </span>
        </span>
      </span>
    </button>
  );
}
