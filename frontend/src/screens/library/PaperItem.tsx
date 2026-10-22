import {
  BookOpen,
  FileText,
  Info,
  MoreHorizontal,
  Star,
  Trash2,
} from "lucide-react";
import { useRef } from "react";
import type { Paper } from "../../api";
import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/i18n";
import type { PaperMetadata } from "../../lib/cite";
import { followLink, readerHash } from "../../reader/route";
import { IconButton, Menu } from "../../ui";
import { PaperThumb } from "./PaperThumb";
import { paperSource } from "./paper-meta";
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
  lastOpened?: number;
  /** What the public sources said about this paper, when they have. */
  meta?: PaperMetadata | null;
  /** While choosing papers to export, each has a checkbox. */
  selecting?: boolean;
  selected?: boolean;
  onSelect?(paper: Paper): void;
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
  go,
  onDetails,
  onStar,
  onDelete,
}: Pick<PaperItemProps, "paper" | "go" | "onDetails" | "onStar" | "onDelete">) {
  const { t } = useI18n();
  const title = paper.title || t("reader.untitled");
  return (
    <div className={styles.actions}>
      <Menu
        label={t("library.menu", { title })}
        placement={{ side: "bottom", align: "end" }}
        trigger={(props) => (
          <IconButton
            {...props}
            size="sm"
            icon={MoreHorizontal}
            label={t("library.menu", { title })}
          />
        )}
        items={[
          {
            id: "open",
            icon: BookOpen,
            label: t("details.open"),
            onSelect: () => go(readerHash({ paperId: paper.id }).slice(1)),
          },
          {
            id: "star",
            icon: Star,
            label: t(paper.favorite ? "library.unstar" : "library.star", {
              title,
            }),
            onSelect: () => onStar(paper),
          },
          {
            id: "details",
            icon: Info,
            label: t("details.title"),
            onSelect: () => onDetails(paper),
          },
          { kind: "separator", id: "delete-divider" },
          {
            id: "delete",
            icon: Trash2,
            label: t("details.delete"),
            danger: true,
            onSelect: () => onDelete(paper),
          },
        ]}
      />
    </div>
  );
}

/** A paper's cover, title and authors. */
export function PaperCard(props: PaperItemProps) {
  const { paper, owner, go, meta, selecting } = props;
  const { t } = useI18n();
  const card = useRef<HTMLElement>(null);
  const facts = usePaperFacts(paper, owner, card, meta);
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
      </div>
      <Actions {...props} />
    </article>
  );
}

/** A paper as a row of the compact list. */
export function PaperRow(props: PaperItemProps) {
  const { paper, go, formatDate, meta, selecting, lastOpened } = props;
  const { t } = useI18n();
  const source = paperSource(paper, meta);
  const hash = readerHash({ paperId: paper.id });
  return (
    <tr
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
          <span className={styles.rowFileIcon} aria-hidden>
            <FileText size={19} strokeWidth={1.5} />
          </span>
          <span className={styles.rowCopy}>
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
          </span>
        </a>
      </td>
      <td className={styles.cellSource} title={source}>
        {source || "—"}
      </td>
      <td className={styles.cellDate}>
        {lastOpened ? (
          <time dateTime={new Date(lastOpened).toISOString()}>
            {formatDate.format(lastOpened)}
          </time>
        ) : (
          "—"
        )}
      </td>
      <td className={styles.cellActions}>
        <Actions {...props} />
      </td>
    </tr>
  );
}
