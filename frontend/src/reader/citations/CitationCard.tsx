import { ArrowDownToLine, Eye, LibraryBig, Plus } from "lucide-react";
import { useI18n } from "../../i18n/I18nProvider";
import { Button, Spinner } from "../../ui";
import styles from "./CitationCard.module.css";
import { arxivAddress, byline, doiAddress, type CitedWork } from "./lookup";
import type { AddState } from "./useLibraryAdd";

/** What the card knows: the entry as the paper prints it, and what the lookup came to. */
export type CitationState =
  | { state: "looking" }
  | { state: "found"; work: CitedWork }
  | { state: "missing" }
  | { state: "failed"; message: string };
export type Citation = { entry: string } & CitationState;

export interface CitationCardProps {
  citation: Citation;
  add: AddState | undefined;
  onRetry(): void;
  onPreview(work: CitedWork): void;
  onAdd(arxiv: string): void;
  onOpenPaper(paperId: string): void;
  onJump(): void;
}

/** The card a citation opens: the work cited, with what can be done with it. */
export function CitationCard({
  citation,
  add,
  onRetry,
  onPreview,
  onAdd,
  onOpenPaper,
  onJump,
}: CitationCardProps) {
  const { t } = useI18n();
  const work = citation.state === "found" ? citation.work : null;
  const number = new Intl.NumberFormat();
  const counts = work
    ? [
        work.citation_count != null &&
          t("reader.cite.cited", { count: number.format(work.citation_count) }),
        work.reference_count != null &&
          t("reader.cite.references", {
            count: number.format(work.reference_count),
          }),
      ].filter(Boolean)
    : [];
  return (
    <div className={styles.card}>
      {citation.state === "looking" && (
        <p className={styles.status} aria-busy="true">
          <Spinner size={14} />
          {t("reader.link.looking")}
        </p>
      )}
      {work && (
        <>
          <p className={styles.title}>{work.title}</p>
          <p className={styles.meta}>
            {byline(work, (authors) => t("reader.link.etAl", { authors }))}
          </p>
          {counts.length > 0 && (
            <p className={styles.meta}>{counts.join(" · ")}</p>
          )}
          {work.abstract && <p className={styles.abstract}>{work.abstract}</p>}
          {(work.arxiv || work.doi) && (
            <p className={styles.links}>
              {work.arxiv && (
                <a
                  href={arxivAddress(work.arxiv)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  arXiv:{work.arxiv}
                </a>
              )}
              {work.doi && (
                <a
                  href={doiAddress(work.doi)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  DOI
                </a>
              )}
            </p>
          )}
        </>
      )}
      {citation.state === "missing" && (
        <p className={styles.note}>{t("reader.cite.missing")}</p>
      )}
      {citation.state === "failed" && (
        <p className={styles.problem} role="alert">
          {t("reader.cite.failed", { reason: citation.message })}
          <Button size="sm" variant="ghost" onClick={onRetry}>
            {t("reader.cite.retry")}
          </Button>
        </p>
      )}
      <div className={styles.entry}>
        <p className={styles.label}>{t("reader.cite.entry")}</p>
        <p className={styles.entryText}>{citation.entry}</p>
      </div>
      <div className={styles.actions}>
        {work && (
          <Button size="sm" icon={Eye} onClick={() => onPreview(work)}>
            {t("reader.cite.preview")}
          </Button>
        )}
        {work?.arxiv &&
          (add?.status === "added" ? (
            <Button
              size="sm"
              icon={LibraryBig}
              onClick={() => onOpenPaper(add.paperId)}
            >
              {t("reader.cite.open")}
            </Button>
          ) : (
            <Button
              size="sm"
              icon={Plus}
              loading={add?.status === "adding"}
              onClick={() => onAdd(work.arxiv)}
            >
              {t("reader.cite.add")}
            </Button>
          ))}
        <Button
          size="sm"
          variant="ghost"
          icon={ArrowDownToLine}
          onClick={onJump}
        >
          {t("reader.cite.jump")}
        </Button>
      </div>
      {work?.arxiv && add?.status === "failed" && (
        <p className={styles.problem} role="alert">
          {t("reader.cite.addFailed", { reason: add.message })}
        </p>
      )}
    </div>
  );
}
