import { useEffect, useId, useRef } from "react";
import type { Paper, SourceFile } from "../../api";
import { usePdfAnnotations } from "../../features/PdfAnnotations";
import { useI18n } from "../../i18n/I18nProvider";
import { Button, Spinner } from "../../ui";
import { NoteEditor } from "../notes/NoteEditor";
import type { Notes } from "../notes/useNotes";
import type { ReaderRoute } from "../route";
import styles from "./NotesTab.module.css";

export interface NotesTabProps {
  paper: Paper;
  /** The paper's PDF, whose highlights are listed; none if the paper has no PDF. */
  file: SourceFile | null;
  notes: Notes;
  /**
   * The store the PDF's highlight layer and the selection menu share, so that a
   * highlight made now is listed now. Without it the tab reads the highlights
   * itself, and again whenever any store has changed them.
   */
  annotations?: ReturnType<typeof usePdfAnnotations>;
  /** Opens a place in a paper: a highlight of the list, or a link written in the note. */
  onJump(route: ReaderRoute): void;
}

/** Where the note is kept, said quietly; what stopped it, with the way out. */
function SaveStatus({ notes }: { notes: Notes }) {
  const { t } = useI18n();
  if (notes.save === "error")
    return (
      <div className={styles.problem} role="alert">
        <span>{notes.error}</span>
        {notes.conflict ? (
          <>
            <Button variant="ghost" size="sm" onClick={notes.loadLatest}>
              {t("reader.notes.useLatest")}
            </Button>
            <Button variant="ghost" size="sm" onClick={notes.keepMine}>
              {t("reader.notes.keepMine")}
            </Button>
          </>
        ) : (
          <Button variant="ghost" size="sm" onClick={notes.retry}>
            {t("common.retry")}
          </Button>
        )}
      </div>
    );
  return (
    <span className={styles.saved} role="status">
      {notes.save === "saving"
        ? t("reader.notes.saving")
        : t("reader.notes.saved")}
    </span>
  );
}

/** The highlights and comments made on the PDF, each a way back to its place. */
function Highlights({
  paper,
  file,
  annotations,
  onJump,
}: {
  paper: Paper;
  file: SourceFile;
  annotations: ReturnType<typeof usePdfAnnotations>;
  onJump(route: ReaderRoute): void;
}) {
  const { t } = useI18n();
  const heading = useId();
  const { rows, error, reload } = annotations;
  return (
    <section className={styles.highlights} aria-labelledby={heading}>
      <h3 id={heading} className={styles.heading}>
        {t("reader.notes.highlights", { count: rows.length })}
      </h3>
      {error && rows.length === 0 ? (
        <p className={styles.problem} role="alert">
          <span>{t("reader.notes.highlights.failed")}</span>
          <Button variant="ghost" size="sm" onClick={() => void reload()}>
            {t("common.retry")}
          </Button>
        </p>
      ) : rows.length === 0 ? (
        <p className={styles.hint}>{t("reader.notes.highlights.none")}</p>
      ) : (
        <ul className={styles.list}>
          {rows.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                className={styles.item}
                onClick={() =>
                  onJump({
                    paperId: paper.id,
                    fileId: file.id,
                    page: row.page,
                    quote: row.quote,
                    prefix: row.prefix,
                  })
                }
              >
                <span
                  className={styles.dot}
                  style={{ background: row.color }}
                  aria-hidden="true"
                />
                <span className={styles.entry}>
                  <span className={styles.quote}>{row.quote}</span>
                  {row.comment && (
                    <span className={styles.comment}>{row.comment}</span>
                  )}
                  <span className={styles.page}>
                    {t("reader.pdf.page", { page: row.page })}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The highlights, for a tab that was not given the shared store: read here, and again when any store changes them. */
function OwnHighlights(props: {
  paper: Paper;
  file: SourceFile;
  onJump(route: ReaderRoute): void;
}) {
  const annotations = usePdfAnnotations(props.file.id);
  const reload = useRef(annotations.reload);
  reload.current = annotations.reload;
  useEffect(() => {
    // A highlight made or changed anywhere (the page's menu, the old reader) says so on the window.
    const changed = () => void reload.current();
    window.addEventListener("reading-activity-changed", changed);
    return () =>
      window.removeEventListener("reading-activity-changed", changed);
  }, []);
  return <Highlights {...props} annotations={annotations} />;
}

/**
 * The notes of the paper: its note, written in place and kept as it is typed,
 * and under it the highlights and comments on the PDF, to go back to.
 */
export function NotesTab({
  paper,
  file,
  notes,
  annotations,
  onJump,
}: NotesTabProps) {
  const { t, locale } = useI18n();
  return (
    <div className={styles.tab}>
      {notes.loading ? (
        <div
          className={styles.waiting}
          role="status"
          aria-label={t("common.loading")}
        >
          <Spinner />
        </div>
      ) : notes.unavailable ? (
        <div className={styles.waiting}>
          <p className={styles.problem} role="alert">
            <span>{notes.error}</span>
            <Button variant="ghost" size="sm" onClick={notes.retry}>
              {t("common.retry")}
            </Button>
          </p>
        </div>
      ) : (
        <>
          <div className={styles.status}>
            <SaveStatus notes={notes} />
          </div>
          {/* A language changed is a new editor: its accessible name and hint are made once. */}
          <NoteEditor
            key={`${paper.id}:${locale}`}
            body={notes.body}
            onChange={notes.edit}
            onFlush={notes.flush}
            onJump={onJump}
            onImage={notes.attach}
            cite={
              file
                ? { paperId: paper.id, fileId: file.id, onCite: onJump }
                : undefined
            }
          />
        </>
      )}
      {file &&
        (annotations ? (
          <Highlights
            paper={paper}
            file={file}
            annotations={annotations}
            onJump={onJump}
          />
        ) : (
          <OwnHighlights paper={paper} file={file} onJump={onJump} />
        ))}
    </div>
  );
}
