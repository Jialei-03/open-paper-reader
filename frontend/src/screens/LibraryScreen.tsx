import { ArrowUpDown, Download, LayoutGrid, List, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, send, type Paper } from "../api";
import { useI18n } from "../i18n/I18nProvider";
import { useImports } from "../import/useImports";
import {
  citeRecord,
  formatBibtexFile,
  useMetadataFill,
  useMetadataMap,
} from "../lib/cite";
import { recentPapers } from "../lib/recent-papers";
import { readerHash } from "../reader/route";
import {
  Button,
  Card,
  CardHeader,
  Dialog,
  Menu,
  SegmentedControl,
  TextField,
  toast,
  type MenuEntry,
} from "../ui";
import { ImportDrop, ImportJobs, useFileDrop } from "./home/ImportDrop";
import { PaperDetails } from "./library/PaperDetails";
import { PaperCard, PaperRow } from "./library/PaperItem";
import { sortPapers, type SortKey } from "./library/paper-meta";
import { usePreference } from "./library/usePreference";
import styles from "./library/LibraryScreen.module.css";

export interface LibraryScreenProps {
  owner: string;
  papers: Paper[];
  go(hash: string): void;
  reload(): void;
}

type Filter = "all" | "unread" | "reading" | "read";
type View = "grid" | "list";

const VIEWS: readonly View[] = ["grid", "list"];
const SORTS: readonly SortKey[] = ["opened", "added", "title", "citations"];

/** Whether `paper` has every word of `query` in its title, authors, id or tags. */
function matches(paper: Paper, query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = [paper.title, paper.authors, paper.external_id, ...paper.tags]
    .join(" ")
    .toLowerCase();
  return words.every((word) => text.includes(word));
}

/** The search a quick-open jump leaves in the address: `#library?q=…`. */
function queryFromAddress() {
  const [path, search = ""] = location.hash.slice(1).split("?");
  return path === "library" ? (new URLSearchParams(search).get("q") ?? "") : "";
}

/**
 * Every paper, as cards with the first page or as a compact list: searched,
 * filtered by reading status and sorted, opened in the reader, looked into in a
 * sheet at the side, deleted after a confirmation. Importing is a dialog; a
 * drop on the list imports too.
 */
export function LibraryScreen({
  owner,
  papers,
  go,
  reload,
}: LibraryScreenProps) {
  const { t, tn, locale } = useI18n();
  const [query, setQuery] = useState(queryFromAddress);
  const [filter, setFilter] = useState<Filter>("all");
  const [view, setView] = usePreference<View>(
    "paper-library-view",
    "grid",
    VIEWS,
  );
  const [sort, setSort] = usePreference<SortKey>(
    "paper-library-sort",
    "opened",
    SORTS,
  );
  const [importing, setImporting] = useState(false);
  const [looking, setLooking] = useState<string | null>(null);
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
  const { map: records, ready: recordsReady } = useMetadataMap();
  useMetadataFill(papers, records, recordsReady);
  const [selecting, setSelecting] = useState(false);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());

  // Quick open sends a search here, also while this screen is already showing.
  useEffect(() => {
    const changed = () => {
      const asked = queryFromAddress();
      if (asked) setQuery(asked);
    };
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);

  const visits = useMemo(() => recentPapers(owner), [owner]);
  const shown = useMemo(
    () =>
      sortPapers(
        papers.filter(
          (paper) =>
            (filter === "all" || paper.reading_status === filter) &&
            matches(paper, query),
        ),
        sort,
        visits,
        locale,
        Object.fromEntries(
          Object.values(records).map((meta) => [
            meta.paper_id,
            meta.status === "ok" ? meta.citation_count : null,
          ]),
        ),
      ),
    [papers, filter, query, sort, visits, locale, records],
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

  const star = async (paper: Paper) => {
    try {
      await send(
        "/papers/" + paper.id,
        { favorite: !paper.favorite },
        "PATCH",
        paper.revision,
      );
      reload();
    } catch (error) {
      toast.show({ message: (error as Error).message, tone: "error" });
    }
  };

  const title = (paper: Paper) => paper.title || t("reader.untitled");
  const asked = (paper: Paper) => {
    setDeleteError("");
    setDoomed(paper);
  };
  const sortLabel = {
    opened: t("library.sort.opened"),
    added: t("library.sort.added"),
    title: t("library.sort.title"),
    citations: t("library.sort.citations"),
  } satisfies Record<SortKey, string>;
  const sortItems: MenuEntry[] = SORTS.map((key) => ({
    id: key,
    label: sortLabel[key],
    icon: key === sort ? ArrowUpDown : undefined,
    onSelect: () => setSort(key),
  }));
  const itemProps = {
    owner,
    go,
    formatDate,
    onDetails: (paper: Paper) => setLooking(paper.id),
    onStar: star,
    onDelete: asked,
    selecting,
    onSelect: (paper: Paper) =>
      setChosen((current) => {
        const next = new Set(current);
        if (!next.delete(paper.id)) next.add(paper.id);
        return next;
      }),
  };
  const stopSelecting = () => {
    setSelecting(false);
    setChosen(new Set());
  };
  const exportBib = () => {
    const picked = papers.filter((paper) => chosen.has(paper.id));
    const text = formatBibtexFile(
      picked.map((paper) => citeRecord(paper, records[paper.id])),
    );
    const url = URL.createObjectURL(
      new Blob([text], { type: "application/x-bibtex;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "references.bib";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.show({
      message: t("library.export.done", { count: picked.length }),
      tone: "success",
    });
  };

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
          <span className={styles.spacer} />
          {selecting ? (
            <>
              <span className={styles.chosen} aria-live="polite">
                {t("library.select.count", { count: chosen.size })}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setChosen(
                    chosen.size === shown.length
                      ? new Set()
                      : new Set(shown.map((paper) => paper.id)),
                  )
                }
              >
                {t(
                  chosen.size === shown.length && shown.length > 0
                    ? "library.select.none"
                    : "library.select.all",
                )}
              </Button>
              <Button
                size="sm"
                icon={Download}
                disabled={chosen.size === 0}
                onClick={exportBib}
              >
                {t("library.export.bib")}
              </Button>
              <Button variant="ghost" size="sm" onClick={stopSelecting}>
                {t("library.select.done")}
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelecting(true)}
            >
              {t("library.select")}
            </Button>
          )}
          <Menu
            label={t("library.sort")}
            placement={{ side: "bottom", align: "end" }}
            items={sortItems}
            trigger={(props) => (
              <Button {...props} variant="ghost" size="sm" icon={ArrowUpDown}>
                {t("library.sort.current", { sort: sortLabel[sort] })}
              </Button>
            )}
          />
          <SegmentedControl
            kind="radio"
            size="sm"
            label={t("library.view")}
            value={view}
            onChange={setView}
            options={[
              {
                value: "grid",
                label: t("library.view.grid"),
                icon: LayoutGrid,
              },
              { value: "list", label: t("library.view.list"), icon: List },
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
          ) : view === "grid" ? (
            <div className={styles.grid} data-view="grid">
              {shown.map((paper) => (
                <PaperCard
                  key={paper.id}
                  paper={paper}
                  meta={records[paper.id]}
                  selected={chosen.has(paper.id)}
                  {...itemProps}
                />
              ))}
            </div>
          ) : (
            <table className={styles.table} data-view="list">
              <thead>
                <tr>
                  <th scope="col">{t("library.column.title")}</th>
                  <th scope="col" className={styles.progress}>
                    {t("library.column.progress")}
                  </th>
                  <th scope="col" className={styles.status}>
                    {t("library.column.status")}
                  </th>
                  <th scope="col" className={styles.updated}>
                    {t("library.column.updated")}
                  </th>
                  <th scope="col" className={styles.actions}>
                    <span className={styles.visuallyHidden}>
                      {t("library.column.actions")}
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((paper) => (
                  <PaperRow
                    key={paper.id}
                    paper={paper}
                    meta={records[paper.id]}
                    selected={chosen.has(paper.id)}
                    {...itemProps}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      <PaperDetails
        paper={papers.find((paper) => paper.id === looking) ?? null}
        owner={owner}
        go={go}
        onClose={() => setLooking(null)}
        onChanged={reload}
        onDelete={asked}
      />
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
