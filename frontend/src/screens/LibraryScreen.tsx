import {
  ArrowUpDown,
  BookOpen,
  Download,
  LayoutGrid,
  List,
  Plus,
  Search,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, send, type Paper } from "../api";
import { useLocal } from "../app/edition";
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

/** The reading-status view selected in the materials sidebar. */
function filterFromAddress(): Filter {
  const [path, search = ""] = location.hash.slice(1).split("?");
  const value =
    path === "library" ? new URLSearchParams(search).get("view") : null;
  return value === "unread" || value === "reading" || value === "read"
    ? value
    : "all";
}

function importFromAddress() {
  const [path, search = ""] = location.hash.slice(1).split("?");
  return (
    path === "library" && new URLSearchParams(search).get("import") === "1"
  );
}

/** Dismissing a sidebar import keeps the selected view and search on reload. */
function clearImportRequest() {
  const [path, search = ""] = location.hash.slice(1).split("?");
  if (path !== "library") return;
  const params = new URLSearchParams(search);
  if (!params.has("import")) return;
  params.delete("import");
  history.replaceState(
    history.state,
    "",
    `#library${params.size ? `?${params}` : ""}`,
  );
  window.dispatchEvent(new HashChangeEvent("hashchange"));
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
  const local = useLocal();
  const [query, setQuery] = useState(queryFromAddress);
  const changeQuery = (value: string) => {
    setQuery(value);
    const params = new URLSearchParams(location.hash.split("?")[1] || "");
    if (value) params.set("q", value);
    else params.delete("q");
    history.replaceState(
      history.state,
      "",
      `#library${params.size ? `?${params}` : ""}`,
    );
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  };
  const [filter, setFilter] = useState<Filter>(filterFromAddress);
  const [view, setView] = usePreference<View>(
    "paper-library-view",
    "list",
    VIEWS,
  );
  const [sort, setSort] = usePreference<SortKey>(
    "paper-library-sort",
    "opened",
    SORTS,
  );
  const [importing, setImporting] = useState(importFromAddress);
  const [looking, setLooking] = useState<string | null>(null);
  const [doomed, setDoomed] = useState<Paper | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const imports = useImports((paper, only) => {
    reload();
    if (only) {
      setImporting(false);
      clearImportRequest();
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
      setQuery(queryFromAddress());
      setFilter(filterFromAddress());
      setImporting(importFromAddress());
    };
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);

  const closeImport = () => {
    setImporting(false);
    clearImportRequest();
  };

  const chooseFilter = (next: Filter, search = query) => {
    setFilter(next);
    const params = new URLSearchParams();
    if (next !== "all") params.set("view", next);
    if (search.trim()) params.set("q", search);
    go(`library${params.size ? `?${params}` : ""}`);
  };

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
  const allShownSelected =
    shown.length > 0 && shown.every((paper) => chosen.has(paper.id));
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
        <header className={styles.header}>
          <div className={styles.headingGroup}>
            <div className={styles.titleLine}>
              <h1 id="library-title" className={styles.heading}>
                {t("library.title")}
              </h1>
              <span className={styles.count}>
                {tn("library.count", papers.length)}
              </span>
            </div>
          </div>
          <div
            className={styles.search}
            role="search"
            aria-label={t("library.search")}
          >
            <Search size={16} aria-hidden className={styles.searchIcon} />
            <TextField
              type="search"
              label={t("library.search")}
              hideLabel
              placeholder={t("library.search.placeholder")}
              value={query}
              onChange={(event) => changeQuery(event.target.value)}
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
        </header>
        <div className={styles.tools}>
          {local === true ? (
            <div className={styles.currentView}>
              <h2>
                {t(
                  filter === "all"
                    ? "library.filter.all"
                    : filter === "reading"
                      ? "reader.sidebar.reading"
                      : filter === "unread"
                        ? "library.status.unread"
                        : "library.status.read",
                )}
              </h2>
              <span className={styles.resultCount} aria-live="polite">
                {tn("library.count", shown.length)}
              </span>
            </div>
          ) : (
            <SegmentedControl
              kind="radio"
              size="sm"
              label={t("library.filter")}
              value={filter}
              onChange={chooseFilter}
              options={[
                { value: "all", label: t("library.filter.all") },
                { value: "unread", label: t("library.status.unread") },
                { value: "reading", label: t("library.status.reading") },
                { value: "read", label: t("library.status.read") },
              ]}
            />
          )}
          {local !== true && (query || filter !== "all") && (
            <span className={styles.resultCount} role="status">
              {t("library.filteredCount", {
                shown: shown.length,
                total: papers.length,
              })}
            </span>
          )}
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
                    allShownSelected
                      ? new Set()
                      : new Set(shown.map((paper) => paper.id)),
                  )
                }
              >
                {t(
                  allShownSelected
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
          <div className={styles.viewSwitch}>
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
        </div>
        {!importing && (
          <div className={styles.jobs}>
            <ImportJobs imports={imports} />
          </div>
        )}
        <div className={styles.list}>
          {papers.length === 0 ? (
            <div className={styles.message}>
              <BookOpen size={36} aria-hidden />
              <p>{t("library.empty")}</p>
              <Button size="sm" icon={Plus} onClick={() => setImporting(true)}>
                {t("library.import.title")}
              </Button>
            </div>
          ) : shown.length === 0 ? (
            <div className={styles.message}>
              <Search size={30} aria-hidden />
              <p>{t("library.noMatch")}</p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setQuery("");
                  chooseFilter("all", "");
                }}
              >
                {t("library.resetFilters")}
              </Button>
            </div>
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
        onClose={closeImport}
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
