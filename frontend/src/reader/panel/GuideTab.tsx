import clsx from "clsx";
import { Fragment, type ReactNode } from "react";
import type { Paper, SourceFile } from "../../api";
import { useI18n } from "../../i18n/I18nProvider";
import { Button, Spinner } from "../../ui";
import type { GuideContent, GuideSection } from "./guide";
import styles from "./GuideTab.module.css";
import { useGuide } from "./useGuide";

export interface GuideTabProps {
  paper: Paper;
  file: SourceFile;
  /** A page chip was pressed: the paper goes to that page. */
  onJumpToPage(page: number): void;
}

/** `**bold**` and `` `code` `` in a line of the guide; the rest is text as written. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/).map((part, index) => {
    if (part.length > 4 && part.startsWith("**") && part.endsWith("**"))
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.length > 2 && part.startsWith("`") && part.endsWith("`"))
      return <code key={index}>{part.slice(1, -1)}</code>;
    return <Fragment key={index}>{part}</Fragment>;
  });
}

function Paragraphs({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/\n{2,}/)
        .filter((paragraph) => paragraph.trim() !== "")
        .map((paragraph, index) => (
          <p key={index} className={styles.paragraph}>
            {inline(paragraph.trim())}
          </p>
        ))}
    </>
  );
}

function Section({
  section,
  className,
  onJumpToPage,
}: {
  section: GuideSection;
  className?: string;
  onJumpToPage(page: number): void;
}) {
  const { t } = useI18n();
  return (
    <section className={clsx(styles.section, className)}>
      <h2 className={styles.title}>{section.title}</h2>
      <div className={styles.body}>
        <Paragraphs text={section.body} />
      </div>
      {section.pages.length > 0 && (
        <ul className={styles.pages} aria-label={t("reader.guide.pages")}>
          {section.pages.map((page) => (
            <li key={page}>
              <button
                type="button"
                className={styles.page}
                onClick={() => onJumpToPage(page)}
              >
                {t("reader.guide.page", { page })}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The guide, or as much of it as has been written. What is new comes in; what was there stays. */
function Content({
  content,
  streaming,
  onJumpToPage,
}: {
  content: GuideContent;
  streaming: boolean;
  onJumpToPage(page: number): void;
}) {
  const { t } = useI18n();
  const arrive = streaming ? styles.arrive : undefined;
  return (
    <>
      {content.keywords.length > 0 && (
        <ul className={styles.keywords} aria-label={t("reader.guide.keywords")}>
          {content.keywords.map((keyword, index) => (
            <li
              key={`${index}:${keyword}`}
              className={clsx(styles.keyword, arrive)}
            >
              {keyword}
            </li>
          ))}
        </ul>
      )}
      {content.summary.length > 0 && (
        <div className={clsx(styles.block, arrive)}>
          <h2 className={styles.label}>{t("reader.guide.summary")}</h2>
          <ol className={styles.summary}>
            {content.summary.map((line, index) => (
              <li key={index}>{inline(line)}</li>
            ))}
          </ol>
        </div>
      )}
      {content.sections.map((section, index) => (
        <Section
          key={index}
          section={section}
          className={arrive}
          onJumpToPage={onJumpToPage}
        />
      ))}
    </>
  );
}

/**
 * The right panel's guide to the paper: its keywords, a summary in three lines
 * and four sections (question, method, results, limits), each with the pages it
 * rests on. It is made by the paper's automatic preparation when the paper is
 * opened, or by a press of the button; what has been written shows as it comes.
 */
export function GuideTab({ paper, file, onJumpToPage }: GuideTabProps) {
  const { t } = useI18n();
  const guide = useGuide(paper.id, file.id);
  const { view } = guide;

  switch (view.kind) {
    case "loading":
      return (
        <p className={styles.status} role="status">
          <Spinner size={14} />
          {t("reader.guide.loading")}
        </p>
      );
    case "noModel":
      return (
        <div className={styles.message}>
          <p className={styles.note}>{t("reader.guide.noModel")}</p>
          <a className={styles.link} href="#settings">
            {t("reader.guide.openSettings")}
          </a>
        </div>
      );
    case "working":
    case "ready":
      return (
        <div className={styles.guide}>
          {view.kind === "working" && (
            <p className={styles.status} role="status">
              <Spinner size={14} />
              {t("reader.guide.working")}
            </p>
          )}
          <Content
            content={view.content}
            streaming={view.kind === "working"}
            onJumpToPage={onJumpToPage}
          />
        </div>
      );
    case "failed":
      return (
        <div className={styles.message}>
          <p className={styles.error} role="alert">
            {guide.error || view.message || t("reader.guide.failed")}
          </p>
          <div>
            <Button size="sm" loading={guide.busy} onClick={guide.retry}>
              {t("common.retry")}
            </Button>
          </div>
        </div>
      );
    case "idle":
      return (
        <div className={styles.message}>
          <p className={styles.note}>
            {view.note ||
              t(view.stopped ? "reader.guide.stopped" : "reader.guide.idle")}
          </p>
          {guide.error && (
            <p className={styles.error} role="alert">
              {guide.error}
            </p>
          )}
          <div>
            <Button
              size="sm"
              variant="primary"
              loading={guide.busy}
              onClick={() => guide.generate(view.stopped)}
            >
              {t("reader.guide.generate")}
            </Button>
          </div>
        </div>
      );
  }
}
