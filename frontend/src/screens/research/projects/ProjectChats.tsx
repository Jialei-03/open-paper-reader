import { ArrowLeft } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../../../i18n/I18nProvider";
import { followLink } from "../../../reader/route";
import { IconButton, Spinner, toast } from "../../../ui";
import { RunTurn } from "../process/Process";
import { isLive } from "../process/model";
import {
  askChat,
  chatTurns,
  listChats,
  startChat,
  type ChatTurn,
  type ProjectChat,
  type Workspace,
} from "../research-api";
import { Composer } from "../talk/Composer";
import talk from "../talk/Talk.module.css";
import styles from "./Projects.module.css";

const POLL = 1500;

function fail(error: unknown) {
  toast.show({
    message: error instanceof Error ? error.message : String(error),
    tone: "error",
  });
}

/**
 * Where the researcher asks about the project: how far the work has got,
 * what a result means. Asking here never touches a research in progress.
 */
export function ProjectChats({
  workspace,
  go,
}: {
  workspace: Workspace;
  go(hash: string): void;
}) {
  const { t, locale } = useI18n();
  const [chats, setChats] = useState<ProjectChat[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listChats(workspace.id).then(setChats, () => setChats([]));
  }, [workspace.id]);

  const when = (stamp: string) =>
    new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(stamp));

  return (
    <div className={styles.researches}>
      <p className={styles.chatLead}>{t("projects.chats.lead")}</p>
      <Composer
        value={text}
        onChange={setText}
        busy={busy}
        autoFocus
        label={t("projects.chats.ask")}
        placeholder={t("projects.chats.placeholder")}
        sendLabel={t("research.home.send")}
        onSend={async () => {
          setBusy(true);
          try {
            const chat = await startChat(workspace.id, text.trim());
            go(`projects/${workspace.id}/chats/${chat.id}`);
          } catch (error) {
            fail(error);
            setBusy(false);
          }
        }}
      />
      {chats === null ? null : chats.length === 0 ? (
        <p className={styles.empty}>{t("projects.chats.none")}</p>
      ) : (
        <ul className={styles.rows}>
          {chats.map((chat) => (
            <li key={chat.id}>
              <a
                href={`#projects/${workspace.id}/chats/${chat.id}`}
                className={styles.row}
                onClick={followLink(
                  go,
                  `projects/${workspace.id}/chats/${chat.id}`,
                )}
              >
                <span className={styles.rowQuestion}>{chat.title}</span>
                <span className={styles.rowFacts}>
                  <span>{when(chat.updated_at)}</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** One conversation: the researcher's questions and the answers, as they come. */
export function ProjectChat({
  workspace,
  chatId,
  go,
}: {
  workspace: Workspace;
  chatId: string;
  go(hash: string): void;
}) {
  const { t } = useI18n();
  const [turns, setTurns] = useState<ChatTurn[] | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [reads, setReads] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const live = !!turns?.some(isLive);

  const read = useCallback(
    () => chatTurns(chatId).then(setTurns, fail),
    [chatId],
  );
  useEffect(() => {
    read();
  }, [read, reads]);
  // Asked again while an answer is being written; quiet once it is done.
  useEffect(() => {
    if (!live) return;
    const timer = window.setTimeout(() => setReads((n) => n + 1), POLL);
    return () => window.clearTimeout(timer);
  }, [live, turns]);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns?.length, turns?.at(-1)?.response]);

  const back = `projects/${workspace.id}/chats`;
  return (
    <div className={styles.chat}>
      <div className={styles.chatBar}>
        <IconButton
          icon={ArrowLeft}
          label={t("projects.chats.back")}
          size="sm"
          onClick={() => go(back)}
        />
        <span>{t("projects.chats.readOnly")}</span>
      </div>
      <div className={talk.scroll} ref={scroller}>
        <div className={talk.thread}>
          {turns === null && <Spinner />}
          {turns?.map((turn) => (
            <div key={turn.id} className={styles.chatTurn}>
              <div className={talk.mine}>{turn.prompt}</div>
              <RunTurn
                run={{ ...turn, role: "chat" }}
                role="chat"
                title={t("projects.chats.assistant")}
                final={turn.response}
              />
            </div>
          ))}
        </div>
      </div>
      <div className={talk.dock}>
        <Composer
          value={text}
          onChange={setText}
          busy={sending}
          disabled={live}
          label={t("projects.chats.ask")}
          placeholder={t(
            live ? "projects.chats.answering" : "projects.chats.more",
          )}
          sendLabel={t("research.home.send")}
          onSend={async () => {
            setSending(true);
            try {
              await askChat(chatId, text.trim());
              setText("");
              setReads((n) => n + 1);
            } catch (error) {
              fail(error);
            } finally {
              setSending(false);
            }
          }}
        />
      </div>
    </div>
  );
}
