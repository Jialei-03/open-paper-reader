import clsx from "clsx";
import { Info, Star, Trash2 } from "lucide-react";
import { useMemo, useRef } from "react";
import type { Paper } from "../../api";
import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/i18n";
import type { PaperMetadata } from "../../lib/cite";
import { followLink, readerHash } from "../../reader/route";
import { IconButton } from "../../ui";
import { PaperThumb } from "./PaperThumb";
import { usePaperFacts } from "./usePaperFacts";
import styles from "./PaperItem.module.css";

export const STATUS: Record<string, MessageKey> = {
  unread: "library.status.unread",
  reading: "library.status.reading",
  read: "library.status.read",
};

export interface PaperItemProps {
  paper: Paper;
  owner: string;
  go(hash: string): void;
  onDetails(paper: Paper): void;
  onStar(paper: Paper): void;
  onDelete(paper: Paper): void;
  formatDate: Intl.DateTimeFormat;
  /** What the public sources said about this paper, when they have. */
  meta?: PaperMetadata | null;
  /** While choosing papers to export, each has a checkbox. */
  selecting?: boolean;
  selected?: boolean;
  onSelect?(paper: Paper): void;
}

/** "NeurIPS · 2017 · 12,345 citations": where it appeared and how often it is cited. */
function useSourceLine(source: string, citations: number | null) {
  const { t, locale } = useI18n();
  return useMemo(() => {
    const count =
      citations === null
        ? ""
        : t("library.cited", {
            count: new Intl.NumberFormat(
              locale === "zh" ? "zh-CN" : "en",
            ).format(citations),
          });
    return [source, count].filter(Boolean).join(" · ");
  }, [source, citations, t, locale]);
}

function Pick({
  paper,
  selected,
  onSelect,
  className,
}: Pick<PaperItemProps, "paper" | "selected" | "onSelect"> & {
  className: string;
}) {
  const { t } = useI18n();
  return (
    <input
      type="checkbox"
      className={className}
      checked={!!selected}
      aria-label={t("library.select.paper", {
        title: paper.title || t("reader.untitled"),
      })}
      onChange={() => onSelect?.(paper)}
    />
  );
}

/** The page reached out of the pages there are, in words; empty when not read yet. */
export function useProgressText() {
  const { t } = useI18n();
  return (page: number | null, pages: number | null) => {
    if (!page) return t("library.progress.none");
    return pages
      ? t("library.progress", { page: Math.min(page, pages), pages })
      : t("library.progress.page", { page });
  };
}

function Actions({
  paper,
  onDetails,
  onStar,
  onDelete,
}: Pick<PaperItemProps, "paper" | "onDetails" | "onStar" | "onDelete">) {
  const { t } = useI18n();
  const title = paper.title || t("reader.untitled");
  return (
    <div className={styles.actions}>
      <IconButton
        size="sm"
        icon={Star}
        className={clsx(styles.star, paper.favorite && styles.starred)}
        label={t(paper.favorite ? "library.unstar" : "library.star", {
          title,
        })}
        aria-pressed={paper.favorite}
        onClick={() => onStar(paper)}
      />
      <IconButton
        size="sm"
        icon={Info}
        label={t("library.details", { title })}
        onClick={() => onDetails(paper)}
      />
      <IconButton
        size="sm"
        icon={Trash2}
        label={t("library.delete", { title })}
        onClick={() => onDelete(paper)}
      />
    </div>
  );
}

function Status({ paper }: { paper: Paper }) {
  const { t } = useI18n();
  return (
    <span className={styles.status} data-status={paper.reading_status}>
      {STATUS[paper.reading_status]
        ? t(STATUS[paper.reading_status])
        : paper.reading_status}
    </span>
  );
}

/** A paper as a card: its first page, then title, authors, where it comes from and how far the reading has got. */
export function PaperCard(props: PaperItemProps) {
  const { paper, owner, go, meta, selecting } = props;
  const { t } = useI18n();
  const progressText = useProgressText();
  const card = useRef<HTMLElement>(null);
  const facts = usePaperFacts(paper, owner, card, meta);
  const source = useSourceLine(facts.source, facts.citations);
  const hash = readerHash({ paperId: paper.id });
  return (
    <article
      ref={card}
      className={styles.card}
      data-paper={paper.id}
      data-selected={props.selected || undefined}
    >
      {selecting && <Pick {...props} className={styles.pickCard} />}
      <PaperThumb paper={paper} pdf={facts.pdf} className={styles.cover} />
      <div className={styles.text}>
        <h3 className={styles.title}>
          <a
            className={styles.link}
            href={hash}
            onClick={followLink(go, hash.slice(1))}
          >
            {paper.title || t("reader.untitled")}
          </a>
        </h3>
        {facts.byline && <p className={styles.byline}>{facts.byline}</p>}
        {source && (
          <p className={styles.source} title={source}>
            {source}
          </p>
        )}
        <div className={styles.foot}>
          <div
            className={styles.bar}
            role="progressbar"
            aria-label={t("library.progress.label")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(facts.progress * 100)}
            aria-valuetext={progressText(facts.page, facts.pages)}
          >
            <i style={{ width: `${facts.progress * 100}%` }} />
          </div>
          <div className={styles.meta}>
            <span className={styles.progress}>
              {progressText(facts.page, facts.pages)}
            </span>
            <Status paper={paper} />
          </div>
        </div>
      </div>
      <Actions {...props} />
    </article>
  );
}

/** A paper as a row of the compact list. */
export function PaperRow(props: PaperItemProps) {
  const { paper, owner, go, formatDate, meta, selecting } = props;
  const { t } = useI18n();
  const progressText = useProgressText();
  const row = useRef<HTMLTableRowElement>(null);
  const facts = usePaperFacts(paper, owner, row, meta);
  const source = useSourceLine(facts.source, facts.citations);
  const hash = readerHash({ paperId: paper.id });
  return (
    <tr
      ref={row}
      className={styles.row}
      data-paper={paper.id}
      data-selected={props.selected || undefined}
      data-selecting={selecting || undefined}
    >
      <td className={styles.cellMain}>
        {selecting && <Pick {...props} className={styles.pickRow} />}
        <a
          className={styles.rowLink}
          href={hash}
          onClick={followLink(go, hash.slice(1))}
        >
          <span className={styles.rowTitle}>
            {paper.favorite && (
              <Star
                className={styles.rowStar}
                size={13}
                aria-label={t("library.favorite")}
                role="img"
              />
            )}
            <span className={styles.rowName}>
              {paper.title || t("reader.untitled")}
            </span>
          </span>
          {(facts.byline || source) && (
            <span className={styles.rowBy}>
              {[facts.byline, source].filter(Boolean).join(" · ")}
            </span>
          )}
        </a>
      </td>
      <td className={styles.cellProgress}>
        <span className={styles.rowBar}>
          <i style={{ width: `${facts.progress * 100}%` }} />
        </span>
        <span className={styles.progress}>
          {progressText(facts.page, facts.pages)}
        </span>
      </td>
      <td className={styles.cellStatus}>
        <Status paper={paper} />
      </td>
      <td className={styles.cellDate}>
        {formatDate.format(new Date(paper.updated_at))}
      </td>
      <td className={styles.cellActions}>
        <Actions {...props} />
      </td>
    </tr>
  );
}
