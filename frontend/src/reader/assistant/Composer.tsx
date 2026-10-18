import { ArrowUp, Square, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { Button, TextArea, Tooltip } from "../../ui";
import type { AskRequest } from "../types";
import { conversation, isActive, shorten } from "./runs";
import type { Assistant } from "./useAssistant";
import styles from "./Composer.module.css";

/** How much of a selected sentence the context label shows. */
const QUOTE_LENGTH = 28;

export interface ComposerProps {
  assistant: Assistant;
  /** What the question is about (a selection, a page), shown as a label that can be taken off. */
  pending: AskRequest | null;
  onClearPending(): void;
}

/**
 * The question box floating at the bottom of the paper's card (spec 6.3): the
 * context the question carries, the question (Enter sends it, Shift+Enter is a
 * new line), and a round send button, which is a stop button while the latest
 * answer is being written. Without a model it says where to add one.
 */
export function Composer({
  assistant,
  pending,
  onClearPending,
}: ComposerProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  const latest = conversation(assistant.runs).at(-1);
  const answering = latest !== undefined && isActive(latest);
  const unavailable = !assistant.ready;

  // A context handed over (asking about a selection) puts the keyboard here, to type the question.
  useEffect(() => {
    if (pending) field.current?.focus();
  }, [pending]);

  if (!assistant.paperId) return null;

  const submit = async () => {
    const prompt = draft.trim();
    if (!prompt || unavailable || assistant.sending || answering) return;
    const request = pending ? { ...pending, question: prompt } : undefined;
    setDraft("");
    if (await assistant.send({ prompt, request })) {
      if (request) onClearPending();
    }
    // Not sent: the question comes back, unless something new has been typed meanwhile.
    else setDraft((typed) => typed || draft);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    )
      return;
    event.preventDefault();
    void submit();
  };

  const context = pending
    ? pending.source === "selection" && pending.quote
      ? t("reader.assistant.context.selection", {
          quote: shorten(pending.quote, QUOTE_LENGTH),
        })
      : pending.source === "region"
        ? t("reader.assistant.context.region", { page: pending.page })
        : t("reader.assistant.context.page", { page: pending.page })
    : "";

  return (
    <div className={styles.anchor}>
      <div className={styles.composer}>
        <TextArea
          ref={field}
          label={t("reader.assistant.input")}
          hideLabel
          autoGrow
          maxRows={8}
          className={styles.input}
          placeholder={t("reader.assistant.placeholder")}
          value={draft}
          disabled={unavailable}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className={styles.tools}>
          {pending && (
            <span className={styles.chip}>
              <span className={styles.chipText}>{context}</span>
              <button
                type="button"
                className={styles.chipRemove}
                aria-label={t("reader.assistant.context.remove")}
                onClick={() => {
                  onClearPending();
                  field.current?.focus();
                }}
              >
                <X size={12} aria-hidden="true" />
              </button>
            </span>
          )}
          {unavailable && !assistant.loading ? (
            <p className={styles.hint}>
              {t("reader.assistant.noModel")}{" "}
              <a className={styles.settings} href="#settings">
                {t("reader.assistant.toSettings")}
              </a>
            </p>
          ) : (
            assistant.error && (
              <p className={styles.error} role="alert">
                {assistant.error}
              </p>
            )
          )}
          {answering ? (
            <Tooltip content={t("reader.assistant.stop")}>
              <Button
                variant="primary"
                className={`${styles.round} ${styles.stop}`}
                icon={Square}
                aria-label={t("reader.assistant.stop")}
                onClick={() => assistant.cancel(latest.id)}
              />
            </Tooltip>
          ) : (
            <Tooltip content={t("reader.assistant.send")}>
              <Button
                variant="primary"
                className={styles.round}
                icon={ArrowUp}
                aria-label={t("reader.assistant.send")}
                disabled={unavailable || !draft.trim()}
                loading={assistant.sending}
                onClick={() => void submit()}
              />
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  );
}
