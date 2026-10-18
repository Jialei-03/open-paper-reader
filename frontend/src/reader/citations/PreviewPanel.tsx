import { LibraryBig, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { SourceFile } from "../../api";
import { useI18n } from "../../i18n/I18nProvider";
import { Button, IconButton, SegmentedControl, Spinner } from "../../ui";
import { PdfPages } from "../engine/PdfPages";
import { usePdfDocument } from "../engine/usePdfDocument";
import styles from "./PreviewPanel.module.css";
import {
  arxivAddress,
  arxivPdfUrl,
  byline,
  doiAddress,
  type CitedWork,
} from "./lookup";
import type { AddState } from "./useLibraryAdd";

export interface PreviewPanelProps {
  work: CitedWork;
  add: AddState | undefined;
  onAdd(arxiv: string): void;
  onOpenPaper(paperId: string): void;
  onClose(): void;
}

type View = "abstract" | "fulltext";

/**
 * A cited work, read beside the paper without leaving it: its abstract, and
 * (when arXiv has it) its PDF in the same engine, read-only. Nothing is added
 * to the library by looking.
 */
export function PreviewPanel({
  work,
  add,
  onAdd,
  onOpenPaper,
  onClose,
}: PreviewPanelProps) {
  const { t } = useI18n();
  const panel = useRef<HTMLElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const [view, setView] = useState<View>("abstract");

  // Focus comes in, and goes back to where it was when the panel is put away.
  useEffect(() => {
    const before = document.activeElement;
    const element = panel.current;
    if (element && !element.matches(":popover-open")) element.showPopover();
    close.current?.focus();
    return () => {
      if (element?.matches(":popover-open")) element.hidePopover();
      if (before instanceof HTMLElement && before.isConnected) before.focus();
    };
  }, []);

  // Esc puts it away from wherever the keyboard is (a button that was pressed may be gone).
  const closeNow = useRef(onClose);
  closeNow.current = onClose;
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      closeNow.current();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, []);

  const links = [
    work.arxiv && {
      href: arxivAddress(work.arxiv),
      label: `arXiv:${work.arxiv}`,
    },
    work.doi && { href: doiAddress(work.doi), label: "DOI" },
  ].filter((link) => !!link);

  return (
    <aside
      ref={panel}
      popover="manual"
      className={styles.panel}
      role="complementary"
      aria-label={t("reader.cite.panel")}
    >
      <header className={styles.header}>
        <div className={styles.heading}>
          <p className={styles.title}>{work.title}</p>
          <p className={styles.meta}>
            {byline(work, (authors) => t("reader.link.etAl", { authors }), 5)}
          </p>
        </div>
        <IconButton
          ref={close}
          icon={X}
          label={t("reader.cite.close")}
          onClick={onClose}
        />
      </header>
      <div className={styles.bar}>
        {work.arxiv ? (
          <SegmentedControl
            kind="radio"
            size="sm"
            label={t("reader.cite.view")}
            value={view}
            onChange={setView}
            options={[
              { value: "abstract", label: t("reader.cite.abstract") },
              { value: "fulltext", label: t("reader.cite.fulltext") },
            ]}
          />
        ) : (
          <p className={styles.note}>{t("reader.cite.noPdf")}</p>
        )}
        {work.arxiv &&
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
      </div>
      {add?.status === "failed" && (
        <p className={styles.problem} role="alert">
          {t("reader.cite.addFailed", { reason: add.message })}
        </p>
      )}
      {view === "abstract" || !work.arxiv ? (
        <div className={styles.abstract}>
          {(work.citation_count != null || work.reference_count != null) && (
            <p className={styles.meta}>
              {[
                work.citation_count != null &&
                  t("reader.cite.cited", {
                    count: work.citation_count.toLocaleString(),
                  }),
                work.reference_count != null &&
                  t("reader.cite.references", {
                    count: work.reference_count.toLocaleString(),
                  }),
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
          {work.abstract ? (
            <p className={styles.text}>{work.abstract}</p>
          ) : (
            <p className={styles.note}>{t("reader.cite.noAbstract")}</p>
          )}
          {links.length > 0 && (
            <p className={styles.links}>
              {links.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {link.label}
                </a>
              ))}
            </p>
          )}
        </div>
      ) : (
        <FullText arxiv={work.arxiv} />
      )}
    </aside>
  );
}

/** The cited paper's PDF from arXiv, in the reader's own pages. */
function FullText({ arxiv }: { arxiv: string }) {
  const { t } = useI18n();
  const key = `citation-preview:${arxiv}`;
  const { doc, error, retry } = usePdfDocument(key, arxivPdfUrl(arxiv));
  const [page, setPage] = useState(1);
  // The pages only need the file's name; the panel never reads it from the library.
  const file: SourceFile = {
    id: key,
    paper_id: "",
    version_id: "",
    name: arxiv,
    source_path: "",
    mime: "application/pdf",
    size: 0,
    sha256: "",
    pages: null,
  };
  return (
    <div className={styles.fulltext}>
      <p className={styles.note}>{t("reader.cite.fulltextNote")}</p>
      <div className={styles.pages}>
        {doc ? (
          <PdfPages
            doc={doc}
            file={file}
            page={page}
            onPageChange={setPage}
            controllerRef={null}
          />
        ) : error ? (
          <p className={styles.problem} role="alert">
            {error}
            <Button size="sm" variant="ghost" onClick={retry}>
              {t("reader.cite.retry")}
            </Button>
          </p>
        ) : (
          <p className={styles.note} aria-busy="true">
            <Spinner size={14} />
            {t("reader.pdf.opening")}
          </p>
        )}
      </div>
    </div>
  );
}
