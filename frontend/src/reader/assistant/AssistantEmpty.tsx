import { useI18n } from "../../i18n/I18nProvider";
import { Kbd } from "../../ui";
import type { Assistant } from "./useAssistant";
import styles from "./AssistantEmpty.module.css";

/** The questions offered before anything has been asked: what one asks of a paper first. */
const SUGGESTIONS = [
  "reader.assistant.suggest.contributions",
  "reader.assistant.suggest.method",
  "reader.assistant.suggest.limitations",
  "reader.assistant.suggest.related",
] as const;

/**
 * The assistant's view before the first question: what it can do with this
 * paper, a few questions to start from (a press sends one), and the keys that
 * ask about a passage. Quiet, like the guide's and the notes' empty views.
 */
export function AssistantEmpty({ assistant }: { assistant: Assistant }) {
  const { t } = useI18n();
  const blocked = !assistant.ready || assistant.sending;
  return (
    <div className={styles.empty}>
      <p className={styles.lead}>{t("reader.assistant.empty.lead")}</p>
      <ul
        className={styles.suggestions}
        aria-label={t("reader.assistant.suggest")}
      >
        {SUGGESTIONS.map((key) => (
          <li key={key}>
            <button
              type="button"
              className={styles.suggestion}
              disabled={blocked}
              onClick={() => void assistant.send({ prompt: t(key) })}
            >
              {t(key)}
            </button>
          </li>
        ))}
      </ul>
      {assistant.error && (
        <p className={styles.error} role="alert">
          {assistant.error}
        </p>
      )}
      <p className={styles.hint}>{t("reader.assistant.empty.select")}</p>
      <ul className={styles.keys}>
        <li>
          <Kbd shortcut="enter" />
          {t("reader.assistant.empty.keys.send")}
        </li>
        <li>
          <Kbd shortcut="shift+enter" />
          {t("reader.assistant.empty.keys.newline")}
        </li>
      </ul>
    </div>
  );
}
