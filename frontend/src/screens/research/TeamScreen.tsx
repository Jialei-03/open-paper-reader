import { memberName as displayMemberName } from "../team/member-model";
import { MemberAvatar } from "../team/MemberEditor";
import { TeamSettings } from "../team/TeamSettings";
import settingStyles from "../team/TeamSettings.module.css";
import {
  ArrowUp,
  ArrowRight,
  AtSign,
  Bot,
  ChevronRight,
  Copy,
  GitFork,
  FileText,
  Hash,
  Maximize2,
  MessageSquare,
  Minimize2,
  MoreHorizontal,
  Paperclip,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Plus,
  Search,
  Send,
  Square,
  Trash2,
  Users,
  X,
} from "lucide-react";
import {
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { api } from "../../api";
import { AppActions } from "../../app/AppSidebar";
import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/i18n";
import { Button, Dialog, IconButton, Menu, TextField, toast } from "../../ui";
import { readModels, type ModelRow } from "../setup/model-api";
import { AddModelButton, openModelSetup } from "../setup/ModelSetup";
import { ModelPicker } from "./talk/Pickers";
import { Prose } from "./talk/ThreadView";
import { RunTurn, SummaryLine, Trail } from "./process/Process";
import { summary } from "./process/model";
import { ResearchProject } from "./ResearchProject";
import { TeamFilePreview } from "./TeamFilePreview";
import { TeamMessageChanges } from "./TeamMessageChanges";
import { TeamFileCard, TeamSidePanel } from "./TeamSidePanel";
import { startProject } from "./research-api";
import { useResearchNavigation } from "./ResearchNavigation";
import { MemberStatus, useTeam } from "./TeamNavigation";
import {
  deleteChannel,
  continueTeamMessage,
  editDelivery,
  getDeliveries,
  getMessages,
  readChannel,
  refreshTeam,
  renameChannel,
  sendTeamMessage,
  teamHash,
  ruleHash,
  teamThreads,
  TEAM_EVENT,
  type Delivery,
  type Team,
  type TeamChannel,
  type TeamMember,
  type TeamMessage,
} from "./team-api";
import {
  defaultChannelNames,
  memberLabel,
  mentionMatches,
  mentionQuery,
  orderedMessages,
  recentThreads,
  sendMode,
  threadActivity,
  threadDate,
} from "./team-model";
import styles from "./Team.module.css";

export function TeamScreen({
  id,
  channelId,
  threadId,
  full = false,
  go,
}: {
  id: string;
  channelId?: string;
  threadId?: string;
  full?: boolean;
  go(hash: string): void;
}) {
  const { t } = useI18n();
  const { data } = useResearchNavigation();
  const { quickOpen } = useContext(AppActions);
  const workspace = data.workspaces.find((w) => w.id === id);
  const { team, error } = useTeam(id);
  const [models, setModels] = useState<ModelRow[]>([]);
  const [modelsKnown, setModelsKnown] = useState(false);
  const [model, setModel] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState("");
  const [file, setFile] = useState("");
  const [panelOpen, setPanelOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return defaultPanelOpen(
        window.innerWidth,
        localStorage.getItem("team-side-panel"),
      );
    } catch {
      return defaultPanelOpen(window.innerWidth, null);
    }
  });
  const [fileRequest, setFileRequest] = useState(0);
  const [locateMessage, setLocateMessage] = useState("");
  const [conversation, setConversation] = useState<{
    channelId: string;
    messages: TeamMessage[];
    deliveries: Delivery[];
  }>({ channelId: "", messages: [], deliveries: [] });
  const channelElement = useRef<HTMLElement>(null);
  const togglePanel = (open: boolean) => {
    setPanelOpen(open);
    try {
      localStorage.setItem("team-side-panel", String(open));
    } catch {
      /* Optional preference. */
    }
  };
  useEffect(() => {
    const media = window.matchMedia("(max-width: 899px)");
    const resize = () => {
      try {
        setPanelOpen(
          defaultPanelOpen(
            window.innerWidth,
            localStorage.getItem("team-side-panel"),
          ),
        );
      } catch {
        setPanelOpen(!media.matches);
      }
    };
    media.addEventListener("change", resize);
    return () => media.removeEventListener("change", resize);
  }, []);
  useEffect(() => setFile(""), [id, channelId, threadId]);
  const channel =
    team?.channels.find((c) => c.id === channelId || c.key === channelId) ||
    (!channelId
      ? team?.channels.find((c) => c.key === "experiments")
      : undefined);
  useEffect(() => {
    let stale = false;
    readModels().then(
      (value) => {
        if (!stale) {
          setModels(value.models);
          setModelsKnown(true);
          setModel(
            value.models.find((m) => m.id === workspace?.model_config_id)?.id ||
              value.active_id ||
              value.models[0]?.id ||
              "",
          );
        }
      },
      () => undefined,
    );
    return () => {
      stale = true;
    };
  }, [id, workspace?.model_config_id]);
  const memberModel = team?.members.find(
    (m) => m.id === channel?.member_id,
  )?.model_config_id;
  useEffect(() => {
    if (channel?.member_id)
      setModel(
        models.find((m) => m.id === memberModel)?.id ||
          models.find((m) => m.id === workspace?.model_config_id)?.id ||
          models[0]?.id ||
          "",
      );
  }, [channel?.member_id, memberModel, workspace?.model_config_id, models]);
  const fail = (reason: unknown) =>
    toast.show({ message: String(reason), tone: "error" });
  const memberName = (member: TeamMember | undefined) =>
    memberLabel(member, t) || channel?.name || "";
  const title = channel?.member_id
    ? memberName(team!.members.find((m) => m.id === channel.member_id))
    : (channel
        ? defaultChannelNames[channel.key] === channel.name
          ? t(`team.channel.${channel.key}` as MessageKey)
          : channel.name
        : "") || t(channelId === "mentions" ? "team.mentions" : "team.threads");
  const receiveConversation = useCallback(
    (messages: TeamMessage[], deliveries: Delivery[]) => {
      setConversation({ channelId: channel?.id || "", messages, deliveries });
    },
    [channel?.id],
  );
  const panelVisible = panelOpen && !!channel && !threadId && !file;
  const participants = team?.members.filter((m) => !m.deleted) || [];
  const humanCount = participants.filter((m) => m.role === "human").length;
  const agentCount = participants.filter(
    (m) =>
      m.role !== "human" && (!channel?.member_id || m.id === channel.member_id),
  ).length;
  const openThread = (message: TeamMessage) =>
    go(teamHash(id, message.channel_id, message.thread_id || message.id));
  const fork = async (message: TeamMessage) => {
    try {
      const project = await startProject({
        workspace_id: id,
        model_config_id: model,
        message: message.text,
      });
      const experiments = team!.channels.find((c) => c.key === "experiments")!;
      go(teamHash(id, experiments.id, `research:${project.id}`));
    } catch (reason) {
      fail(reason);
    }
  };
  if (channelId === "settings" && team)
    return <TeamSettings key={id} team={team} target={threadId} go={go} />;
  return (
    <div className={styles.page} data-testid="team-screen">
      {(!full || !threadId) && (
        <section
          ref={channelElement}
          className={styles.channel}
          aria-label={title}
        >
          <header className={styles.header}>
            {channel?.member_id ||
            ["threads", "mentions"].includes(channelId || "") ? (
              <MessageSquare size={16} aria-hidden />
            ) : (
              <Hash size={16} aria-hidden />
            )}
            <h1>{title}</h1>
            {team && channel && (
              <div
                className={styles.counts}
                role="group"
                aria-label={t("team.participants", {
                  humans: humanCount,
                  agents: agentCount,
                })}
              >
                <Users aria-hidden />
                <span>{humanCount}</span>
                <span aria-hidden>·</span>
                <Bot aria-hidden />
                <span>{agentCount}</span>
              </div>
            )}
            <div className={styles.actions}>
              {channel && (
                <>
                  <IconButton
                    icon={Search}
                    label={t("team.search")}
                    onClick={quickOpen}
                    disabled={!quickOpen}
                  />
                  <IconButton
                    icon={FileText}
                    label={t("team.files")}
                    onClick={() => {
                      setFile("");
                      togglePanel(true);
                      setFileRequest((n) => n + 1);
                      if (threadId) go(teamHash(id, channel.id));
                    }}
                  />
                  <IconButton
                    icon={panelVisible ? PanelRightClose : PanelRightOpen}
                    label={t(
                      panelVisible ? "team.hidePanel" : "team.showPanel",
                    )}
                    aria-expanded={panelVisible}
                    onClick={() => {
                      togglePanel(!panelVisible);
                      if (!panelVisible && threadId)
                        go(teamHash(id, channel.id));
                      if (!panelVisible) setFile("");
                    }}
                  />
                </>
              )}
              {channel && !channel.member_id && (
                <Menu
                  label={t("research.actions")}
                  trigger={(props) => (
                    <IconButton
                      {...props}
                      icon={MoreHorizontal}
                      label={t("research.actions")}
                    />
                  )}
                  items={[
                    {
                      id: "new",
                      icon: Plus,
                      label: t("projects.newResearch"),
                      onSelect: () => go(`new?workspace=${id}`),
                    },
                    {
                      id: "rename",
                      icon: Pencil,
                      label: t("team.renameChannel"),
                      onSelect: () => {
                        setName(channel.name);
                        setRenaming(true);
                      },
                    },
                    {
                      id: "delete",
                      icon: Trash2,
                      label: t("team.deleteChannel"),
                      danger: true,
                      disabled: channel.key === "experiments",
                      onSelect: () => setDeleting(true),
                    },
                  ]}
                />
              )}
            </div>
          </header>
          {!team && !error && (
            <div className={styles.skeleton} aria-busy="true">
              <span />
              <span />
              <span />
            </div>
          )}
          {team && channel ? (
            <MessagePane
              key={channel.id}
              team={team}
              channel={channel}
              models={models}
              modelsKnown={modelsKnown}
              model={model}
              onModel={setModel}
              openThread={openThread}
              fork={fork}
              onFile={setFile}
              onConversation={receiveConversation}
            />
          ) : (
            team && (
              <ThreadList
                id={id}
                mentions={channelId === "mentions"}
                open={openThread}
              />
            )
          )}
          {error && <p role="alert">{error}</p>}
        </section>
      )}
      {team && channel && panelVisible && (
        <TeamSidePanel
          team={team}
          messages={
            conversation.channelId === channel.id ? conversation.messages : []
          }
          deliveries={
            conversation.channelId === channel.id ? conversation.deliveries : []
          }
          onFile={setFile}
          onClose={() => togglePanel(false)}
          fileRequest={fileRequest}
          onLocate={(messageId) => {
            const row = [
              ...(channelElement.current?.querySelectorAll<HTMLElement>(
                "[data-message-id]",
              ) || []),
            ].find((el) => el.dataset.messageId === messageId);
            row?.scrollIntoView({ block: "center", behavior: "smooth" });
            row?.focus({ preventScroll: true });
            if (!row) {
              const message = conversation.messages.find(
                (m) => m.id === messageId,
              );
              if (message?.thread_id) {
                setLocateMessage(messageId);
                go(teamHash(id, channel.id, message.thread_id));
              }
            }
          }}
        />
      )}
      {file && (
        <TeamFilePreview
          workspace={id}
          path={file}
          onClose={() => setFile("")}
        />
      )}
      {!file && team && channel && threadId && (
        <section
          className={styles.thread}
          data-full={full || undefined}
          aria-label={t("team.thread")}
        >
          <header className={styles.header}>
            <h2>{t("team.thread")}</h2>
            <div className={styles.actions}>
              <IconButton
                icon={full ? Minimize2 : Maximize2}
                label={t(full ? "team.collapse" : "team.expand")}
                onClick={() => go(teamHash(id, channel.id, threadId, !full))}
              />
              <IconButton
                icon={X}
                label={t("common.close")}
                onClick={() => go(teamHash(id, channel.id))}
              />
            </div>
          </header>
          <MessagePane
            key={`${channel.id}:${threadId}`}
            team={team}
            channel={channel}
            threadId={threadId}
            models={models}
            modelsKnown={modelsKnown}
            model={model}
            onModel={setModel}
            openThread={openThread}
            fork={fork}
            onFile={setFile}
            go={go}
            locateId={locateMessage}
          />
        </section>
      )}
      <Dialog
        open={renaming}
        title={t("team.renameChannel")}
        onClose={() => setRenaming(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRenaming(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              disabled={!name.trim()}
              onClick={async () => {
                try {
                  await renameChannel(id, channel!.id, name);
                  setRenaming(false);
                  refreshTeam();
                } catch (reason) {
                  fail(reason);
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
      </Dialog>
      <Dialog
        open={deleting}
        title={t("team.deleteConfirm")}
        onClose={() => setDeleting(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              onClick={async () => {
                try {
                  await deleteChannel(id, channel!.id);
                  setDeleting(false);
                  refreshTeam();
                  go(teamHash(id));
                } catch (reason) {
                  fail(reason);
                }
              }}
            >
              {t("team.deleteChannel")}
            </Button>
          </>
        }
      />
    </div>
  );
}

function ThreadList({
  id,
  mentions,
  open,
}: {
  id: string;
  mentions: boolean;
  open(message: TeamMessage): void;
}) {
  const { locale } = useI18n();
  const [messages, setMessages] = useState<TeamMessage[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let stale = false;
    const reload = () =>
      teamThreads(id, mentions).then(
        (rows) => {
          if (!stale) setMessages(rows);
        },
        (reason: unknown) => {
          if (!stale) setError(String(reason));
        },
      );
    void reload();
    const timer = window.setInterval(reload, 2500);
    return () => {
      stale = true;
      clearInterval(timer);
    };
  }, [id, mentions]);
  return (
    <div className={styles.list}>
      {error && <p role="alert">{error}</p>}
      {(mentions ? orderedMessages(messages) : recentThreads(messages)).map(
        (message) => (
          <button type="button" key={message.id} onClick={() => open(message)}>
            <MessageSquare size={16} aria-hidden />
            <span>{message.data.title || message.text}</span>
            <time dateTime={threadActivity(message)}>
              {threadDate(threadActivity(message), locale)}
            </time>
          </button>
        ),
      )}
    </div>
  );
}

function MessagePane({
  team,
  channel,
  threadId,
  models,
  modelsKnown,
  model,
  onModel,
  openThread,
  fork,
  go,
  onFile,
  onConversation,
  locateId,
}: {
  onConversation?(messages: TeamMessage[], deliveries: Delivery[]): void;
  locateId?: string;
  onFile(path: string): void;
  team: Team;
  channel: TeamChannel;
  threadId?: string;
  models: ModelRow[];
  modelsKnown: boolean;
  model: string;
  onModel(id: string): void;
  openThread(message: TeamMessage): void;
  fork(message: TeamMessage): void;
  go?(hash: string): void;
}) {
  const { t } = useI18n();
  const [messages, setMessages] = useState<TeamMessage[]>([]);
  const [root, setRoot] = useState<TeamMessage | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const scroll = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const located = useRef("");
  const reload = useCallback(() => setVersion((n) => n + 1), []);
  const researchId = threadId?.startsWith("research:") ? threadId.slice(9) : "";
  useEffect(() => {
    let stale = false;
    Promise.all([
      getMessages(team.workspace_id, channel.id, threadId),
      getDeliveries(team.workspace_id),
    ]).then(
      ([result, pending]) => {
        if (stale) return;
        setLoaded(true);
        setMessages(result.messages);
        setRoot(result.root);
        setDeliveries(pending);
        onConversation?.(
          (result.activity || result.messages).filter(
            (m) => !m.data.research_forwarded,
          ),
          pending.filter((d) => d.channel_id === channel.id),
        );
        setError("");
        if (document.hasFocus() && !document.hidden && result.messages.length) {
          const through =
            result.messages[result.messages.length - 1].created_at;
          void readChannel(
            team.workspace_id,
            channel.id,
            through,
            threadId,
          ).catch(() => undefined);
        }
      },
      (reason: unknown) => {
        if (!stale) {
          setLoaded(true);
          setError(String(reason));
        }
      },
    );
    return () => {
      stale = true;
    };
  }, [team.workspace_id, channel.id, threadId, version, onConversation]);
  useEffect(() => {
    const timer = window.setInterval(reload, 2000);
    window.addEventListener(TEAM_EVENT, reload);
    return () => {
      clearInterval(timer);
      window.removeEventListener(TEAM_EVENT, reload);
    };
  }, [reload]);
  useEffect(() => {
    if (pinned.current)
      scroll.current?.scrollTo({ top: scroll.current.scrollHeight });
  }, [messages]);
  useEffect(() => {
    if (!locateId || located.current === locateId) return;
    const row = [
      ...(scroll.current?.querySelectorAll<HTMLElement>("[data-message-id]") ||
        []),
    ].find((el) => el.dataset.messageId === locateId);
    if (row) {
      row.scrollIntoView({ block: "center" });
      row.focus({ preventScroll: true });
      pinned.current = false;
      located.current = locateId;
    }
  }, [locateId, messages]);
  const pending = deliveries.filter(
    (d) =>
      d.editable &&
      d.channel_id === channel.id &&
      d.thread_id === (threadId || null),
  );
  const visibleMessages = orderedMessages(messages).filter(
    (m) => !m.data.research_forwarded,
  );
  const dmMember = team.members.find((m) => m.id === channel.member_id);
  const modelName = (member?: TeamMember, message?: TeamMessage) => {
    const id =
      message?.run?.model_config_id || member?.model_config_id || model;
    return message?.run?.model || models.find((m) => m.id === id)?.model || id;
  };
  return (
    <>
      {researchId && go && (
        <div className={styles.research}>
          <ResearchProject id={researchId} go={go} embedded />
        </div>
      )}
      <div
        className={`${styles.messages} ${researchId ? styles.researchMessages : ""}`}
        ref={scroll}
        onScroll={() => {
          const el = scroll.current;
          if (el)
            pinned.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {root && !researchId && (
          <MessageRow
            message={root}
            team={team}
            openThread={openThread}
            fork={fork}
            onFile={onFile}
            modelName={modelName(
              team.members.find((m) => m.id === root.author_id),
              root,
            )}
          />
        )}
        {!loaded && (
          <div className={styles.skeleton} aria-busy="true">
            <span />
            <span />
            <span />
          </div>
        )}
        {loaded && !messages.length && !threadId && (
          <div className={styles.empty} data-testid="team-empty">
            {dmMember ? (
              <>
                <div className={styles.memberCardAvatar}>
                  <MemberAvatar member={dmMember} size="lg" />
                </div>
                <strong>{displayMemberName(dmMember, t)}</strong>
                {dmMember.description && <p>{dmMember.description}</p>}
                {modelName(dmMember) && (
                  <span className={styles.memberModel}>
                    {modelName(dmMember)}
                  </span>
                )}
                <div className={styles.toolTags}>
                  {dmMember.tools?.map((tool) => (
                    <span key={tool}>
                      {t(`members.tool.${tool}` as MessageKey) || tool}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <>
                <Hash size={32} aria-hidden />
                <span>
                  {defaultChannelNames[channel.key] === channel.name
                    ? t(`team.channel.${channel.key}` as MessageKey)
                    : channel.name}
                </span>
              </>
            )}
          </div>
        )}
        {visibleMessages.map((message, index) => (
          <MessageRow
            key={message.id}
            message={message}
            grouped={groupMessages(
              visibleMessages[index - 1] ||
                (!researchId && root
                  ? { ...root, thread_id: threadId || null }
                  : undefined),
              message,
            )}
            modelName={modelName(
              team.members.find((m) => m.id === message.author_id),
              message,
            )}
            team={team}
            openThread={openThread}
            fork={fork}
            onFile={onFile}
          />
        ))}
        {error && <p role="alert">{error}</p>}
      </div>
      <div className={styles.dock}>
        {pending.map((d) => (
          <QueueRow
            key={d.id}
            delivery={d}
            workspace={team.workspace_id}
            changed={reload}
          />
        ))}
        <TeamComposer
          key={`${team.workspace_id}:${channel.id}:${threadId || ""}`}
          team={team}
          channel={channel}
          threadId={threadId}
          models={models}
          modelsKnown={modelsKnown}
          model={model}
          onModel={onModel}
          sent={() => {
            pinned.current = true;
            reload();
            refreshTeam();
          }}
        />
      </div>
    </>
  );
}

export const defaultPanelOpen = (width: number, stored: string | null) =>
  width >= 900 && stored !== "false";

const systemMessage = (message: TeamMessage) =>
  ["budget", "relay_limit"].includes(message.kind) ||
  (!message.author_id && message.kind !== "research");

const emptyReply = (message: TeamMessage) =>
  message.run?.status === "completed" &&
  !message.run.error &&
  !message.run.runtime?.time_limit_reached &&
  !message.run.runtime?.budget_limit &&
  !message.text.trim() &&
  !message.data.files?.length &&
  !message.data.attachments?.length &&
  !message.data.changes?.files.length &&
  !message.data.links?.length &&
  !message.data.file_error;

export function groupMessages(
  previous: TeamMessage | undefined,
  message: TeamMessage,
) {
  const gap = previous
    ? Date.parse(message.created_at) - Date.parse(previous.created_at)
    : NaN;
  return (
    !!previous &&
    !!message.author_id &&
    previous.author_id === message.author_id &&
    previous.channel_id === message.channel_id &&
    previous.thread_id === message.thread_id &&
    !systemMessage(previous) &&
    !systemMessage(message) &&
    previous.kind !== "research" &&
    message.kind !== "research" &&
    previous.run?.status !== "queued" &&
    message.run?.status !== "queued" &&
    !emptyReply(previous) &&
    !emptyReply(message) &&
    gap >= 0 &&
    gap <= 5 * 60 * 1000
  );
}

function MessageRun({
  message,
  member,
  name,
}: {
  message: TeamMessage;
  member?: TeamMember;
  name: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const run = message.run!;
  const error = run.runtime?.time_limit_reached
    ? t("team.timeLimit")
    : run.runtime?.budget_limit
      ? t("team.executionLimit")
      : run.runtime?.no_answer
        ? t("team.noAnswer")
        : run.error;
  const final = message.text === run.error ? "" : message.text;
  // Reuse the process summary and trail, keeping the answer outside the fold.
  if (run.steps.length)
    return (
      <section
        className={styles.run}
        data-live={run.status === "running" || undefined}
      >
        {run.status === "running" ? (
          <Button
            variant="ghost"
            size="sm"
            icon={ChevronRight}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {[
              t("team.status.working"),
              ...summary(run.steps).map(([kind, n]) =>
                t(`research.process.sum.${kind}` as MessageKey, { n }),
              ),
            ].join(" · ")}
          </Button>
        ) : (
          <SummaryLine
            steps={run.steps}
            status={run.status}
            open={open}
            onToggle={() => setOpen(!open)}
          />
        )}
        {open && <Trail steps={run.steps} live={run.status === "running"} />}
        {(final || (run.status === "running" && run.response)) && (
          <Prose text={final || run.response} />
        )}
        {run.status === "failed" && error && <p role="alert">{error}</p>}
      </section>
    );
  return (
    <RunTurn
      hideAuthor
      run={{ ...run, error, role: member?.role || "advisor" }}
      role={member?.role || "advisor"}
      title={name}
      final={final}
    />
  );
}

export function MessageRow({
  message,
  team,
  openThread,
  fork,
  onFile,
  grouped = false,
  modelName,
}: {
  onFile(path: string): void;
  message: TeamMessage;
  team: Team;
  openThread(message: TeamMessage): void;
  fork(message: TeamMessage): void;
  grouped?: boolean;
  modelName?: string;
}) {
  const { t, locale } = useI18n();
  const member =
    team.members.find((m) => m.id === message.author_id) ??
    (message.kind === "research"
      ? team.members.find((m) => m.role === "human")
      : undefined);
  const human = member?.role === "human" || message.kind === "research";
  const name = member
    ? displayMemberName(member, t)
    : t(human ? "team.member.human" : "team.system");
  const systemText =
    message.kind === "relay_limit"
      ? message.data.waiting
        ? t("team.status.waiting")
        : message.data.limit == null
          ? t("team.limitReached")
          : t(
              message.data.reason === "review"
                ? "team.reviewLimit"
                : "team.relayLimit",
              { n: message.data.limit },
            )
      : message.kind === "budget"
        ? t(
            message.data.reason === "concurrent"
              ? "team.concurrentLimit"
              : "team.budgetExhausted",
          )
        : message.data.waiting
          ? t("team.status.waiting")
          : message.text;
  if (systemMessage(message))
    return (
      <article
        className={styles.systemMessage}
        data-message-id={message.id}
        aria-label={t("team.system")}
        tabIndex={-1}
      >
        <span>{systemText}</span>
      </article>
    );
  const avatar = (
    <div className={styles.avatar} data-member={member ? "" : undefined}>
      <MemberAvatar member={member} seed={member ? undefined : name} />
      {member && (
        <MemberStatus status={member.status} enabled={member.enabled} />
      )}
    </div>
  );
  const stop = (message.run?.status === "queued" ||
    message.run?.status === "running") && (
    <IconButton
      size="sm"
      icon={Square}
      label={t("research.stop")}
      onClick={() =>
        void api(`/agent/runs/${encodeURIComponent(message.run!.id)}/cancel`, {
          method: "POST",
        })
          .then(refreshTeam)
          .catch((e: unknown) =>
            toast.show({ message: String(e), tone: "error" }),
          )
      }
    />
  );
  if (message.run?.status === "queued" || emptyReply(message))
    return (
      <article
        className={`${styles.message} ${styles.queuedMessage}`}
        data-message-id={message.id}
        aria-label={name}
        tabIndex={-1}
      >
        {avatar}
        <strong>{name}</strong>
        <span className={styles.messageStatus} role="status">
          {t(
            message.run?.status === "queued" ? "team.queued" : "team.noContent",
          )}
        </span>
        {stop && <div className={styles.hoverActions}>{stop}</div>}
      </article>
    );
  // Only members are woken; older records may still name the researcher.
  const recipients = message.data.to
    ?.map((id) =>
      team.members.find((m) => m.id === id || m.role === id || m.name === id),
    )
    .filter((target) => target && target.role !== "human")
    .map((target) => displayMemberName(target!, t));
  return (
    <article
      className={styles.message}
      data-message-id={message.id}
      data-author={human ? "human" : "agent"}
      data-grouped={grouped || undefined}
      aria-label={name}
      tabIndex={-1}
    >
      {!human && !grouped && avatar}
      <div className={styles.messageBody}>
        {!human && !grouped && (
          <header>
            <strong>{name}</strong>
            <span className={styles.agentTag}>{t("team.agent")}</span>
          </header>
        )}
        <div className={styles.bubble} data-testid="team-message-bubble">
          {message.kind === "research" ? (
            <button
              className={styles.researchCard}
              onClick={() => openThread(message)}
            >
              <MessageSquare size={16} aria-hidden />
              {message.data.title || message.text}
            </button>
          ) : message.run ? (
            <MessageRun message={message} member={member} name={name} />
          ) : (
            <Prose text={message.text} />
          )}
          {(message.run?.runtime?.time_limit_reached ||
            message.run?.runtime?.budget_limit) && (
            <Button
              variant="ghost"
              onClick={() =>
                void continueTeamMessage(team.workspace_id, message.id)
                  .then(refreshTeam)
                  .catch((reason: unknown) =>
                    toast.show({ message: String(reason), tone: "error" }),
                  )
              }
            >
              {t("team.continue")}
            </Button>
          )}
          {message.data.links?.map((link) => (
            <p key={`${link.channel_id}:${link.thread_id}`}>
              <a
                href={`#${teamHash(team.workspace_id, link.channel_id, link.thread_id)}`}
              >
                {t("team.resultIn", { name: link.name })}
              </a>
            </p>
          ))}
          {message.data.files?.map((file) => (
            <TeamFileCard key={file.path} file={file} onFile={onFile} />
          ))}
          {message.data.attachments?.map((file) => (
            <TeamFileCard key={file.id} file={file} onFile={onFile} />
          ))}
          {!human && (
            <TeamMessageChanges
              workspace={team.workspace_id}
              message={message}
            />
          )}
          {message.data.file_error && (
            <p role="alert">{message.data.file_error}</p>
          )}
        </div>
        <footer className={styles.metadata}>
          {!!recipients?.length && (
            <span className={styles.handoff}>
              <ArrowRight aria-hidden />
              {t("team.handoff", {
                name: new Intl.ListFormat(locale, {
                  style: "short",
                  type: "conjunction",
                }).format(recipients),
              })}
            </span>
          )}
          {!human && (modelName || member?.model_config_id) && (
            <span>{modelName || member?.model_config_id}</span>
          )}
          <time dateTime={message.created_at}>
            {new Date(message.created_at).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </time>
          {message.replies > 0 && (
            <button
              className={styles.replies}
              onClick={() => openThread(message)}
            >
              {t("team.replies", { n: message.replies })}
            </button>
          )}
          {message.data.rule && message.data.rule !== "@mention" && (
            <a
              className={settingStyles.ruleLink}
              href={`#${ruleHash(team.workspace_id, message.data.workflow || "research", message.data.workflow_version || 1, message.data.rule)}`}
            >
              {message.data.rule}
            </a>
          )}
        </footer>
      </div>
      <div className={styles.hoverActions}>
        <IconButton
          size="sm"
          icon={Copy}
          label={t("team.copy")}
          onClick={() =>
            void navigator.clipboard
              .writeText(message.text)
              .catch((e: unknown) =>
                toast.show({ message: String(e), tone: "error" }),
              )
          }
        />
        <IconButton
          size="sm"
          icon={MessageSquare}
          label={t("team.reply")}
          onClick={() => openThread(message)}
        />
        {stop}
        <Menu
          label={t("research.actions")}
          trigger={(props) => (
            <IconButton
              {...props}
              size="sm"
              icon={MoreHorizontal}
              label={t("research.actions")}
            />
          )}
          items={[
            {
              id: "fork",
              icon: GitFork,
              label: t("research.fork.action"),
              onSelect: () => fork(message),
            },
          ]}
        />
      </div>
    </article>
  );
}

function QueueRow({
  delivery,
  workspace,
  changed,
}: {
  delivery: Delivery;
  workspace: string;
  changed(): void;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(delivery.text);
  const [busy, setBusy] = useState(false);
  const act = async (body: Parameters<typeof editDelivery>[2]) => {
    setBusy(true);
    try {
      await editDelivery(workspace, delivery.id, body);
      setEditing(false);
      changed();
      refreshTeam();
    } catch (error) {
      toast.show({ message: String(error), tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={styles.queue} data-testid="team-queue">
      <span>
        {t(
          delivery.status === "queued"
            ? "team.queued"
            : delivery.status === "steering"
              ? "team.sending"
              : "team.failed",
        )}
      </span>
      {editing ? (
        <textarea
          aria-label={t("team.editQueued")}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      ) : (
        <span className={styles.queueText}>
          {delivery.error || delivery.text}
        </span>
      )}
      {delivery.status !== "steering" && delivery.editable !== false && (
        <>
          <IconButton
            size="sm"
            icon={editing ? ArrowUp : Pencil}
            disabled={busy}
            label={t(editing ? "projects.save" : "team.editQueued")}
            onClick={() => (editing ? void act({ text }) : setEditing(true))}
          />
          <IconButton
            size="sm"
            icon={Send}
            disabled={busy}
            label={t("team.immediate")}
            onClick={() =>
              void act({ mode: "immediate", ...(editing ? { text } : {}) })
            }
          />
          <IconButton
            size="sm"
            icon={X}
            disabled={busy}
            label={t("team.withdraw")}
            onClick={() => void act({ cancel: true })}
          />
        </>
      )}
    </div>
  );
}

export function TeamComposer({
  team,
  channel,
  threadId,
  models,
  modelsKnown = true,
  model,
  onModel,
  sent,
}: {
  team: Team;
  channel: TeamChannel;
  threadId?: string;
  models: ModelRow[];
  modelsKnown?: boolean;
  model: string;
  onModel(id: string): void;
  sent(): void;
}) {
  const { t } = useI18n();
  const needsModel =
    modelsKnown &&
    models.length === 0 &&
    (!!channel.member_id || !!threadId?.startsWith("research:"));
  const key = `team-draft:${team.workspace_id}:${channel.id}:${threadId || ""}`;
  const [text, setText] = useState(() => {
    try {
      return localStorage.getItem(key) || "";
    } catch {
      return "";
    }
  });
  const [busy, setBusy] = useState(false);
  const [caret, setCaret] = useState(0);
  const [option, setOption] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const field = useRef<HTMLTextAreaElement>(null);
  const upload = useRef<HTMLInputElement>(null);
  const listId = useId();
  const client = useRef(crypto.randomUUID());
  const name = (m: TeamMember) => displayMemberName(m, t);
  const dmMember = team.members.find((m) => m.id === channel.member_id);
  const conversationName = channel.member_id
    ? dmMember
      ? name(dmMember)
      : channel.name
    : `#${defaultChannelNames[channel.key] === channel.name ? t(`team.channel.${channel.key}` as MessageKey) : channel.name}`;
  const query = !dismissed ? mentionQuery(text, caret) : null;
  const matches = query ? mentionMatches(team.members, query.query, name) : [];
  const active = team.members.some(
    (m) =>
      m.status === "working" &&
      (m.id === channel.member_id ||
        [m.name, m.role, name(m)].some((n) =>
          text.toLocaleLowerCase().includes(`@${n.toLocaleLowerCase()}`),
        ) ||
        (!!threadId?.startsWith("research:") &&
          ["advisor", "executor"].includes(m.role))),
  );
  const change = (next: string) => {
    setText(next);
    client.current = crypto.randomUUID();
    try {
      next ? localStorage.setItem(key, next) : localStorage.removeItem(key);
    } catch {
      /* Optional draft. */
    }
  };
  const complete = (member: TeamMember) => {
    if (!query) return;
    const insert = `@${name(member)} `;
    change(text.slice(0, query.start) + insert + text.slice(query.end));
    setDismissed(true);
    requestAnimationFrame(() => {
      field.current?.focus();
      field.current?.setSelectionRange(
        query.start + insert.length,
        query.start + insert.length,
      );
    });
  };
  const submit = async (mode: "queue" | "immediate") => {
    if (!text.trim() || busy) return;
    if (needsModel) {
      openModelSetup();
      return;
    }
    // Clear at once so typing the next message is never wiped by this send.
    const [sending, sendingFiles, clientId] = [text, files, client.current];
    change("");
    setFiles([]);
    setBusy(true);
    try {
      const attachmentIds: string[] = [];
      for (const file of sendingFiles) {
        const body = new FormData();
        body.append("file", file);
        const result = await api<{ id: string }>("/agent/attachments", {
          method: "POST",
          body,
        });
        attachmentIds.push(result.id);
      }
      await sendTeamMessage(team.workspace_id, channel.id, {
        text: sending,
        mode,
        ...(threadId ? { thread_id: threadId } : {}),
        ...(channel.member_id ? { model_config_id: model } : {}),
        client_id: clientId,
        attachment_ids: attachmentIds,
      });
      sent();
    } catch (error) {
      toast.show({ message: String(error), tone: "error" });
      if (!field.current?.value) {
        change(sending);
        client.current = clientId;
        setFiles(sendingFiles);
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className={styles.composer}
      onSubmit={(event) => {
        event.preventDefault();
        void submit("queue");
      }}
    >
      {!!matches.length && (
        <div
          id={listId}
          className={styles.mentionMenu}
          role="listbox"
          aria-label={t("team.members")}
        >
          {matches.map((member, index) => (
            <button
              type="button"
              key={member.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === option % matches.length}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => complete(member)}
            >
              <MemberAvatar member={member} size="sm" />
              {name(member)}
              <span className={styles.mentionStatus}>
                {t(`team.status.${member.status}`)}
              </span>
            </button>
          ))}
        </div>
      )}
      {files.map((file, index) => (
        <span key={index} className={styles.file}>
          {file.name}
          <IconButton
            size="sm"
            icon={X}
            label={t("team.withdraw")}
            onClick={() => setFiles((old) => old.filter((_, i) => i !== index))}
          />
        </span>
      ))}
      <textarea
        ref={field}
        rows={2}
        value={text}
        maxLength={12000}
        aria-label={t("team.message")}
        placeholder={t("team.sendTo", { name: conversationName })}
        aria-autocomplete="list"
        aria-controls={matches.length ? listId : undefined}
        aria-activedescendant={
          matches.length ? `${listId}-${option % matches.length}` : undefined
        }
        aria-expanded={!!matches.length}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
        onChange={(e) => {
          change(e.target.value);
          setCaret(e.target.selectionStart);
          setOption(0);
          setDismissed(false);
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (matches.length) {
            if (e.key === "Escape") {
              e.preventDefault();
              setDismissed(true);
              return;
            }
            if (["ArrowDown", "ArrowUp"].includes(e.key)) {
              e.preventDefault();
              setOption(
                (n) =>
                  (n + (e.key === "ArrowDown" ? 1 : -1) + matches.length) %
                  matches.length,
              );
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              complete(matches[option % matches.length]);
              return;
            }
          }
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void submit(sendMode(e));
          }
        }}
      />
      <footer>
        <input
          ref={upload}
          hidden
          type="file"
          multiple
          onChange={(e) => {
            setFiles((old) =>
              [...old, ...Array.from(e.target.files || [])].slice(0, 5),
            );
            e.target.value = "";
          }}
        />
        {needsModel ? (
          <AddModelButton disabled={busy} />
        ) : (
          channel.member_id && (
            <ModelPicker
              models={models}
              value={model}
              onChange={onModel}
              label={t("commands.model")}
            />
          )
        )}
        <div className={styles.actions}>
          <IconButton
            icon={AtSign}
            label={t("team.mention")}
            disabled={busy}
            onClick={() => {
              const start = field.current?.selectionStart ?? text.length;
              const end = field.current?.selectionEnd ?? start;
              const prefix = text.slice(0, start);
              const insert = prefix && !/\s$/u.test(prefix) ? " @" : "@";
              const nextCaret = start + insert.length;
              change(prefix + insert + text.slice(end));
              setCaret(nextCaret);
              setDismissed(false);
              setOption(0);
              requestAnimationFrame(() => {
                field.current?.focus();
                field.current?.setSelectionRange(nextCaret, nextCaret);
              });
            }}
          />
          <IconButton
            icon={Paperclip}
            label={t("research.attach")}
            disabled={busy}
            onClick={() => upload.current?.click()}
          />
          {active && (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy || !text.trim()}
              onClick={() => void submit("immediate")}
            >
              {t("team.immediate")}
            </Button>
          )}
          <IconButton
            icon={Send}
            label={t(active ? "team.queue" : "research.home.send")}
            disabled={busy || !text.trim()}
            type="submit"
          />
        </div>
      </footer>
    </form>
  );
}
