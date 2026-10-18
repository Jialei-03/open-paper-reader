import { Plus, Star, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { api, type Paper } from "../api";
import { useI18n } from "../i18n/I18nProvider";
import type { MessageKey } from "../i18n/i18n";
import { useImports } from "../import/useImports";
import { followLink, readerHash } from "../reader/route";
import {
  Button,
  Card,
  CardHeader,
  Dialog,
  IconButton,
  SegmentedControl,
  TextField,
} from "../ui";
import { ImportDrop, ImportJobs, useFileDrop } from "./home/ImportDrop";
import styles from "./library/LibraryScreen.module.css";

export interface LibraryScreenProps {
  owner: string;
  papers: Paper[];
  go(hash: string): void;
  reload(): void;
}

type Filter = "all" | "unread" | "reading" | "read";

const STATUS: Record<string, MessageKey> = {
  unread: "library.status.unread",
  reading: "library.status.reading",
  read: "library.status.read",
};

/** Whether `paper` has every word of `query` in its title, authors, id or tags. */
function matches(paper: Paper, query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = [paper.title, paper.authors, paper.external_id, ...paper.tags]
    .join(" ")
    .toLowerCase();
  return words.every((word) => text.includes(word));
}

/**
 * Every paper: searched and filtered by reading status, opened in the reader,
 * deleted after a confirmation. Importing is a dialog; a drop on the list imports too.
 */
export function LibraryScreen({ papers, go, reload }: LibraryScreenProps) {
  const { t, tn, locale } = useI18n();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [importing, setImporting] = useState(false);
  const [doomed, setDoomed] = useState<Paper | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const imports = useImports((paper, only) => {
    reload();
    if (only) {
      setImporting(false);
      go(readerHash({ paperId: paper.id }).slice(1));
    }
  });
  const { over, handlers } = useFileDrop(imports.importFiles);

  const shown = useMemo(
    () =>
      papers.filter(
        (paper) =>
          (filter === "all" || paper.reading_status === filter) &&
          matches(paper, query),
      ),
    [papers, filter, query],
  );
  const formatDate = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", {
        year: "numeric",
        month: "short",
        day: "numeric",
      }),
    [locale],
  );

  const confirmDelete = async () => {
    if (!doomed) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await api("/papers/" + doomed.id, {
        method: "DELETE",
        headers: {
          "If-Match": String(doomed.revision),
          "X-Confirm-Delete": doomed.id,
        },
      });
      setDoomed(null);
      reload();
    } catch (error) {
      setDeleteError((error as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  const title = (paper: Paper) => paper.title || t("reader.untitled");

  return (
    <Card as="main" className={styles.root} aria-labelledby="library-title">
      <div className={styles.frame} data-over={over || undefined} {...handlers}>
        <CardHeader>
          <h1 id="library-title" className={styles.heading}>
            {t("library.title")}
          </h1>
          <span className={styles.count}>
            {tn("library.count", papers.length)}
          </span>
          <span className={styles.spacer} />
          <Button
            variant="primary"
            size="sm"
            icon={Plus}
            onClick={() => setImporting(true)}
          >
            {t("library.import")}
          </Button>
        </CardHeader>
        <div className={styles.tools}>
          <div className={styles.search}>
            <TextField
              type="search"
              label={t("library.search")}
              hideLabel
              placeholder={t("library.search.placeholder")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <SegmentedControl
            kind="radio"
            size="sm"
            label={t("library.filter")}
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: t("library.filter.all") },
              { value: "unread", label: t("library.status.unread") },
              { value: "reading", label: t("library.status.reading") },
              { value: "read", label: t("library.status.read") },
            ]}
          />
        </div>
        {!importing && (
          <div className={styles.jobs}>
            <ImportJobs imports={imports} />
          </div>
        )}
        <div className={styles.list}>
          {papers.length === 0 ? (
            <p className={styles.message}>{t("library.empty")}</p>
          ) : shown.length === 0 ? (
            <p className={styles.message}>{t("library.noMatch")}</p>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">{t("library.column.title")}</th>
                  <th scope="col" className={styles.status}>
                    {t("library.column.status")}
                  </th>
                  <th scope="col" className={styles.updated}>
                    {t("library.column.updated")}
                  </th>
                  <th scope="col" className={styles.actions}>
                    <span className={styles.visuallyHidden}>
                      {t("library.delete.confirm")}
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((paper) => {
                  const hash = readerHash({ paperId: paper.id });
                  return (
                    <tr key={paper.id}>
                      <td>
                        <a
                          className={styles.paper}
                          href={hash}
                          onClick={followLink(go, hash.slice(1))}
                        >
                          <span className={styles.titleLine}>
                            {paper.favorite && (
                              <Star
                                className={styles.star}
                                size={13}
                                aria-label={t("library.favorite")}
                                role="img"
                              />
                            )}
                            <span className={styles.title}>{title(paper)}</span>
                          </span>
                          {paper.authors && (
                            <span className={styles.byline}>
                              {paper.authors}
                            </span>
                          )}
                        </a>
                      </td>
                      <td className={styles.status}>
                        {STATUS[paper.reading_status]
                          ? t(STATUS[paper.reading_status])
                          : paper.reading_status}
                      </td>
                      <td className={styles.updated}>
                        {formatDate.format(new Date(paper.updated_at))}
                      </td>
                      <td className={styles.actions}>
                        <IconButton
                          size="sm"
                          icon={Trash2}
                          label={t("library.delete", { title: title(paper) })}
                          onClick={() => {
                            setDeleteError("");
                            setDoomed(paper);
                          }}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
      <Dialog
        open={importing}
        onClose={() => setImporting(false)}
        title={t("library.import.title")}
      >
        <ImportDrop imports={imports} />
      </Dialog>
      <Dialog
        open={doomed !== null}
        onClose={() => !deleting && setDoomed(null)}
        title={t("library.delete.title")}
        description={
          doomed ? t("library.delete.body", { title: title(doomed) }) : ""
        }
        size="sm"
        footer={
          <>
            <Button onClick={() => setDoomed(null)} disabled={deleting}>
              {t("common.cancel")}
            </Button>
            <Button variant="danger" loading={deleting} onClick={confirmDelete}>
              {t("library.delete.confirm")}
            </Button>
          </>
        }
      >
        {deleteError && (
          <p className={styles.error} role="alert">
            {deleteError}
          </p>
        )}
      </Dialog>
    </Card>
  );
}
