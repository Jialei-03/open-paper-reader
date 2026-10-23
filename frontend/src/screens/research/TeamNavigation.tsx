import { memberName } from "../team/member-model";
import { AtSign, Hash, MessageSquare, Plus, Settings } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { parseAppRoute } from "../../app/routes";
import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/i18n";
import {
  Button,
  Dialog,
  IconButton,
  SidebarItem,
  SidebarSection,
  TextField,
} from "../../ui";
import {
  createChannel,
  getTeam,
  refreshTeam,
  TEAM_EVENT,
  teamHash,
  type Team,
  type TeamMember,
} from "./team-api";
import { useResearchNavigation } from "./ResearchNavigation";
import { WorkspacePicker } from "./WorkspaceDialogs";
import styles from "./Team.module.css";
import { defaultChannelNames } from "./team-model";

export function useTeam(id: string) {
  const [team, setTeam] = useState<Team | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((n) => n + 1), []);
  useEffect(() => {
    setTeam(null);
  }, [id]);
  useEffect(() => {
    if (!id) return;
    let stale = false;
    getTeam(id).then(
      (value) => {
        if (!stale) {
          setTeam(value);
          setError("");
        }
      },
      (reason: unknown) => {
        if (!stale) setError(String(reason));
      },
    );
    return () => {
      stale = true;
    };
  }, [id, revision]);
  useEffect(() => {
    const timer = window.setInterval(reload, 1000);
    window.addEventListener(TEAM_EVENT, reload);
    return () => {
      clearInterval(timer);
      window.removeEventListener(TEAM_EVENT, reload);
    };
  }, [reload]);
  return { team, error, reload };
}

export function useTeamWorkspace(hash: string) {
  const { data } = useResearchNavigation();
  const route = parseAppRoute(hash);
  if (route.screen === "team") return route.workspaceId;
  if (route.screen === "research")
    return (
      data.workspaces.find((w) =>
        w.researches.some((r) => r.id === route.projectId),
      )?.id || ""
    );
  if (
    (route.screen === "new-research" ||
      route.screen === "workspaces" ||
      route.screen === "projects") &&
    route.workspaceId
  )
    return route.workspaceId;
  return data.workspaces.find((w) => !w.archived)?.id || "";
}

export function TeamSwitcher({
  hash,
  go,
}: {
  hash: string;
  go(hash: string): void;
}) {
  const { t } = useI18n();
  const id = useTeamWorkspace(hash);
  return (
    <div className={styles.switcher}>
      <WorkspacePicker
        value={id}
        label={t("team.switch")}
        onChange={(next) => go(teamHash(next))}
      />
    </div>
  );
}

export function MemberStatus({
  status,
  enabled,
}: Pick<TeamMember, "status" | "enabled">) {
  const { t } = useI18n();
  const state = enabled === false ? "disabled" : status;
  return (
    <span
      className={styles.status}
      data-status={state}
      role="img"
      aria-label={t(
        state === "disabled" ? "members.disabled" : `team.status.${state}`,
      )}
    />
  );
}

export function TeamNavigation({
  hash,
  go,
}: {
  hash: string;
  go(hash: string): void;
}) {
  const { t } = useI18n();
  const id = useTeamWorkspace(hash);
  const { team, error, reload } = useTeam(id);
  const route = parseAppRoute(hash);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [failure, setFailure] = useState("");
  const [saving, setSaving] = useState(false);
  if (!id)
    return (
      <SidebarItem
        icon={Plus}
        label={t("team.create")}
        href="#workspaces"
        onClick={() => go("workspaces")}
      />
    );
  return (
    <>
      <SidebarSection>
        <SidebarItem
          icon={MessageSquare}
          label={t("team.threads")}
          href={`#${teamHash(id, "threads")}`}
          active={route.screen === "team" && route.channelId === "threads"}
          onClick={() => go(teamHash(id, "threads"))}
        />
        <SidebarItem
          icon={AtSign}
          label={t("team.mentions")}
          dot={!!team?.notifications.length}
          href={`#${teamHash(id, "mentions")}`}
          active={route.screen === "team" && route.channelId === "mentions"}
          onClick={() => go(teamHash(id, "mentions"))}
        />
      </SidebarSection>
      <SidebarSection title={t("team.channels")}>
        {team?.channels
          .filter((c) => !c.member_id)
          .map((c) => (
            <SidebarItem
              key={c.id}
              icon={Hash}
              label={
                defaultChannelNames[c.key] === c.name
                  ? t(`team.channel.${c.key}` as MessageKey)
                  : c.name
              }
              dot={!!c.unread}
              href={`#${teamHash(id, c.id)}`}
              active={route.screen === "team" && route.channelId === c.id}
              onClick={() => go(teamHash(id, c.id))}
            />
          ))}
        <IconButton
          icon={Plus}
          label={t("team.addChannel")}
          onClick={() => {
            setCreating(true);
            setName("");
          }}
        />
      </SidebarSection>
      <SidebarSection title={t("team.direct")}>
        {team?.channels
          .filter(
            (c) =>
              c.member_id &&
              !team.members.find((m) => m.id === c.member_id)?.deleted,
          )
          .map((c) => {
            const member = team.members.find((m) => m.id === c.member_id)!;
            return (
              <div key={c.id} className={styles.memberRow}>
                <MemberStatus status={member.status} enabled={member.enabled} />
                <SidebarItem
                  icon={MessageSquare}
                  label={memberName(member, t)}
                  dot={!!c.unread}
                  active={route.screen === "team" && route.channelId === c.id}
                  href={`#${teamHash(id, c.id)}`}
                  onClick={() => go(teamHash(id, c.id))}
                />
              </div>
            );
          })}
      </SidebarSection>
      <SidebarSection>
        <SidebarItem
          icon={Settings}
          label={t("team.settings")}
          href={`#${teamHash(id, "settings")}`}
          active={route.screen === "team" && route.channelId === "settings"}
          onClick={() => go(teamHash(id, "settings"))}
        />
      </SidebarSection>
      {error && (
        <Button variant="ghost" onClick={reload}>
          {t("common.retry")}
        </Button>
      )}
      <Dialog
        open={creating}
        onClose={() => setCreating(false)}
        title={t("team.addChannel")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              loading={saving}
              disabled={!name.trim()}
              onClick={async () => {
                setSaving(true);
                try {
                  await createChannel(id, name);
                  setCreating(false);
                  refreshTeam();
                } catch (e) {
                  setFailure(String(e));
                } finally {
                  setSaving(false);
                }
              }}
            >
              {t("projects.save")}
            </Button>
          </>
        }
      >
        <TextField
          label={t("team.channelName")}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        {failure && <p role="alert">{failure}</p>}
      </Dialog>
    </>
  );
}
