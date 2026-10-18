import { ExternalLink, Pencil, Star, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError, send, type Paper, type SourceFile } from "../../api";
import { useI18n } from "../../i18n/I18nProvider";
import { lastPage } from "../../reader/engine/page-memory";
import { followLink, readerHash } from "../../reader/route";
import { Button, Dialog, TextArea, TextField } from "../../ui";
import { STATUS, useProgressText } from "./PaperItem";
import {
  arxivUrl,
  authorList,
  doiUrl,
  paperIds,
  progressOf,
} from "./paper-meta";
import styles from "./PaperDetails.module.css";

interface Guide {
  kind: string;
  status: string;
  result?: { summary?: string[] } | null;
}

interface Extras {
  paperId: string;
  files: SourceFile[];
  highlights: number | null;
  summary: string[];
}

export interface PaperDetailsProps {
  /** The paper to show; null keeps the sheet shut. */
  paper: Paper | null;
  /** The person, for the page the paper was last read at on this device. */
  owner: string;
  onClose(): void;
  /** Takes an address without its `#`. */
  go(hash: string): void;
  /** The paper was changed (starred, retitled): the lists around should read it again. */
  onChanged?(paper: Paper): void;
  /** Asks to delete it; absent where the paper may not be deleted from here. */
  onDelete?(paper: Paper): void;
}

/** A size in bytes in the unit it reads best in. */
function sizeText(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.fact}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * Everything the library knows about one paper, in a sheet at the side:
 * the full title and authors, the abstract (or, without one, the guide's
 * summary), where it came from, how far it has been read, and what can be done
 * with it. Title and authors can be edited in place.
 */
export function PaperDetails({
  paper: given,
  owner,
  onClose,
  go,
  onChanged,
  onDelete,
}: PaperDetailsProps) {
  const { t, locale } = useI18n();
  const progressText = useProgressText();
  // The paper as last saved from here.
  const [saved, setSaved] = useState<Paper | null>(null);
  const [extras, setExtras] = useState<Extras | null>(null);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [authors, setAuthors] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const id = given?.id ?? null;
  useEffect(() => {
    setEditing(false);
    setError("");
  }, [id]);
  // What was saved from here, unless the list around has since read a later revision.
  const paper =
    saved && given && saved.id === given.id && saved.revision >= given.revision
      ? saved
      : given;

  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    const { signal } = controller;
    void (async () => {
      const files = await api<SourceFile[]>(`/papers/${id}/files`, {
        signal,
      }).catch(() => [] as SourceFile[]);
      const pdf = files.find((file) => file.mime === "application/pdf");
      const [highlights, guides] = await Promise.all([
        pdf
          ? api<unknown[]>(`/files/${pdf.id}/annotations`, { signal }).then(
              (rows) => rows.length,
              () => null,
            )
          : Promise.resolve(null),
        api<Guide[]>(`/papers/${id}/reading-artifacts`, { signal }).catch(
          () => [] as Guide[],
        ),
      ]);
      if (signal.aborted) return;
      const guide = guides.find(
        (row) => row.kind === "guide" && row.status === "completed",
      );
      setExtras({
        paperId: id,
        files,
        highlights,
        summary: guide?.result?.summary?.filter(Boolean) ?? [],
      });
    })();
    return () => controller.abort();
  }, [id]);

  const mine = extras && extras.paperId === id ? extras : null;
  const pdf = mine?.files.find((file) => file.mime === "application/pdf");
  const formatDate = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", {
        year: "numeric",
        month: "short",
        day: "numeric",
      }),
    [locale],
  );
  const ids = useMemo(() => paperIds(paper?.external_id ?? ""), [paper]);
  const names = useMemo(() => authorList(paper?.authors ?? ""), [paper]);
  const page = paper ? lastPage(owner, paper.id) : null;
  const pages = pdf?.pages ?? null;

  const apply = async (patch: Partial<Paper>, then?: () => void) => {
    if (!paper) return;
    setBusy(true);
    setError("");
    try {
      const next = (await send(
        "/papers/" + paper.id,
        patch,
        "PATCH",
        paper.revision,
      )) as Paper;
      setSaved(next);
      onChanged?.(next);
      then?.();
    } catch (reason) {
      setError(
        reason instanceof ApiError && reason.status === 412
          ? t("details.conflict")
          : reason instanceof Error
            ? reason.message
            : t("details.saveFailed"),
      );
    } finally {
      setBusy(false);
    }
  };

  const open = (target?: number) => {
    if (!paper) return;
    onClose();
    go(readerHash({ paperId: paper.id, page: target }).slice(1));
  };

  const heading = paper?.title || t("reader.untitled");
  return (
    <Dialog
      side
      open={paper !== null}
      onClose={onClose}
      title={t("details.title")}
      footer={
        paper &&
        (editing ? (
          <>
            <Button onClick={() => setEditing(false)} disabled={busy}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={!title.trim()}
              onClick={() =>
                void apply(
                  { title: title.trim(), authors: authors.trim() },
                  () => setEditing(false),
                )
              }
            >
              {t("details.save")}
            </Button>
          </>
        ) : (
          <>
            {onDelete && (
              <Button
                variant="ghost"
                icon={Trash2}
                className={styles.delete}
                onClick={() => {
                  onClose();
                  onDelete(paper);
                }}
              >
                {t("details.delete")}
              </Button>
            )}
            <Button
              icon={Pencil}
              onClick={() => {
                setTitle(paper.title);
                setAuthors(paper.authors);
                setError("");
                setEditing(true);
              }}
            >
              {t("details.edit")}
            </Button>
            <Button
              icon={Star}
              aria-pressed={paper.favorite}
              loading={busy}
              onClick={() => void apply({ favorite: !paper.favorite })}
            >
              {t(paper.favorite ? "details.unstar" : "details.star")}
            </Button>
            {page && page > 1 && (
              <Button onClick={() => open(page)}>
                {t("details.openLast", { page })}
              </Button>
            )}
            <Button variant="primary" onClick={() => open()}>
              {t("details.open")}
            </Button>
          </>
        ))
      }
    >
      {paper && (
        <div className={styles.sheet} data-testid="paper-details">
          {editing ? (
            <form
              className={styles.form}
              onSubmit={(event) => {
                event.preventDefault();
              }}
            >
              <TextField
                label={t("details.field.title")}
                value={title}
                maxLength={500}
                onChange={(event) => setTitle(event.target.value)}
                data-autofocus
              />
              <TextArea
                label={t("details.field.authors")}
                value={authors}
                rows={3}
                onChange={(event) => setAuthors(event.target.value)}
              />
            </form>
          ) : (
            <>
              <h3 className={styles.name}>{heading}</h3>
              {names.length > 0 && (
                <p className={styles.authors}>{names.join(", ")}</p>
              )}
              {(ids.arxiv || ids.doi) && (
                <p className={styles.ids}>
                  {ids.arxiv && (
                    <a
                      href={arxivUrl(ids.arxiv)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      arXiv:{ids.arxiv}
                      <ExternalLink size={12} aria-hidden="true" />
                    </a>
                  )}
                  {ids.doi && (
                    <a href={doiUrl(ids.doi)} target="_blank" rel="noreferrer">
                      DOI:{ids.doi}
                      <ExternalLink size={12} aria-hidden="true" />
                    </a>
                  )}
                </p>
              )}
              {paper.abstract.trim() ? (
                <section className={styles.block}>
                  <h4>{t("details.abstract")}</h4>
                  <p className={styles.abstract}>{paper.abstract.trim()}</p>
                </section>
              ) : (
                mine &&
                mine.summary.length > 0 && (
                  <section className={styles.block}>
                    <h4>{t("details.summary")}</h4>
                    <ul className={styles.summary}>
                      {mine.summary.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </section>
                )
              )}
            </>
          )}
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <dl className={styles.facts}>
            <Fact label={t("details.progress")}>
              <span className={styles.progressLine}>
                <span className={styles.bar}>
                  <i style={{ width: `${progressOf(page, pages) * 100}%` }} />
                </span>
                {progressText(page, pages)}
              </span>
            </Fact>
            <Fact label={t("details.status")}>
              {STATUS[paper.reading_status]
                ? t(STATUS[paper.reading_status])
                : paper.reading_status}
            </Fact>
            {mine && pdf && (
              <Fact label={t("details.file")}>
                {[
                  pages ? t("details.pages", { count: pages }) : "",
                  sizeText(pdf.size),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Fact>
            )}
            {mine?.highlights != null && (
              <Fact label={t("details.highlights")}>{mine.highlights}</Fact>
            )}
            {paper.created_at && (
              <Fact label={t("details.added")}>
                {formatDate.format(new Date(paper.created_at))}
              </Fact>
            )}
            <Fact label={t("details.updated")}>
              {formatDate.format(new Date(paper.updated_at))}
            </Fact>
          </dl>
        </div>
      )}
    </Dialog>
  );
}
