import {
  ArrowUp,
  PanelRight,
  PictureInPicture2,
  RotateCcw,
  Square,
  X,
} from "lucide-react";
import clsx from "clsx";
import {
  useEffect,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { Button, IconButton, TextArea, Tooltip } from "../../ui";
import type { AskRequest } from "../types";
import { conversation, isActive, shorten } from "./runs";
import type { Assistant } from "./useAssistant";
import type { ComposerDraft, Place } from "./useComposerDock";
import styles from "./Composer.module.css";

/** How much of a selected sentence the context label shows. */
const QUOTE_LENGTH = 28;

export interface ComposerProps {
  assistant: Assistant;
  /** What the question is about (a selection, a page), shown as a label that can be taken off. */
  pending: AskRequest | null;
  onClearPending(): void;
  /**
   * How far up from the foot of the card the composer reaches, in px, each time
   * that changes (it grows with the question); 0 once it is gone. The pages
   * leave that much room under the last one, so it never covers the paper's end.
   */
  onCover?(height: number): void;
  /** The question typed so far, kept by the screen so it survives the box moving. */
  draft: ComposerDraft;
  /** In the panel's foot, or floating over the paper. */
  placement: "docked" | "floating";
  /** Where the floating box rests (null: the middle of the card's foot). */
  place?: Place | null;
  /** Lifted: it is being dragged. */
  lifted?: boolean;
  /** Receives the box's element (the screen glides it into place and puts the keyboard back in it). */
  boxRef(element: HTMLDivElement | null): void;
  /** A press on the grip starts a drag; without it (a window too narrow to float it) there is no grip. */
  onGrip?(event: PointerEvent): void;
  /** The button that moves the box out of the panel or back; absent where it cannot move. */
  onToggleDock?(): void;
  /** A question is being sent: the panel shows the thread then. */
  onAsk?(): void;
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
  onCover,
  draft: kept,
  placement,
  place,
  lifted = false,
  boxRef,
  onGrip,
  onToggleDock,
  onAsk,
}: ComposerProps) {
  const { t } = useI18n();
  const { text: draft, setText: setDraft, unsent, setUnsent } = kept;
  const floating = placement === "floating";
  const field = useRef<HTMLTextAreaElement>(null);
  const box = useRef<HTMLDivElement | null>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const hold = (element: HTMLDivElement | null) => {
    box.current = element;
    boxRef(element);
  };
  const onCoverNow = useRef(onCover);
  onCoverNow.current = onCover;
  const shown = assistant.paperId !== "";
  const latest = conversation(assistant.runs).at(-1);
  const answering = latest !== undefined && isActive(latest);
  const unavailable = !assistant.ready;

  // A context handed over (asking about a selection) puts the keyboard here, to type the question.
  useEffect(() => {
    if (pending) field.current?.focus();
  }, [pending]);

  // How far up the card's foot it reaches, measured whenever it changes size or place: the pages
  // leave that room under the last one. Docked it covers nothing; dragged up out of the foot, nothing at the end.
  useEffect(() => {
    const element = box.current;
    const line = anchor.current;
    if (!floating || !shown || !element || !line) return;
    const measure = () => {
      const reach =
        line.getBoundingClientRect().bottom -
        element.getBoundingClientRect().top;
      const card = line.parentElement?.clientHeight ?? 0;
      onCoverNow.current?.(
        reach > 0 && reach < card / 3 ? Math.ceil(reach) : 0,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
      onCoverNow.current?.(0);
    };
  }, [floating, shown, place]);

  if (!shown) return null;

  const submit = async () => {
    const prompt = draft.trim();
    if (!prompt || unavailable || assistant.sending || answering) return;
    const request = pending ? { ...pending, question: prompt } : undefined;
    onAsk?.();
    setDraft("");
    if (await assistant.send({ prompt, request })) {
      setUnsent(false);
      if (request) onClearPending();
    }
    // Not sent: the question comes back, unless something new has been typed meanwhile.
    else {
      setUnsent(true);
      setDraft((typed) => typed || draft);
    }
  };
  // What the error is about, again: the question in the box if it was this box's, else the hook's.
  const recover = assistant.recover;
  const again = recover && (() => (unsent ? void submit() : recover()));

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

  const body = (
    <div
      ref={hold}
      className={clsx(
        styles.composer,
        floating ? styles.floating : styles.docked,
        lifted && styles.lifted,
      )}
      style={
        floating && place
          ? ({
              "--composer-x": place.x,
              "--composer-y": `${place.y}px`,
            } as CSSProperties)
          : undefined
      }
    >
      {onGrip && (
        <div
          className={styles.grip}
          data-composer-grip=""
          aria-hidden="true"
          onPointerDown={onGrip}
        />
      )}
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
            <>
              <p className={styles.error} role="alert">
                {assistant.error}
              </p>
              {again && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={RotateCcw}
                  className={styles.retry}
                  onClick={again}
                >
                  {t("common.retry")}
                </Button>
              )}
            </>
          )
        )}
        <div className={styles.actions}>
          {onToggleDock && (
            <IconButton
              icon={floating ? PanelRight : PictureInPicture2}
              label={t(
                floating
                  ? "reader.assistant.dock.attach"
                  : "reader.assistant.dock.detach",
              )}
              size="sm"
              className={styles.dockToggle}
              onClick={onToggleDock}
            />
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
  return floating ? (
    <div ref={anchor} className={styles.anchor}>
      {body}
    </div>
  ) : (
    body
  );
}
