import { Check, Eye, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Paper } from "../../api";
import { useI18n } from "../../i18n/I18nProvider";
import { Button, SegmentedControl, Spinner, TextField } from "../../ui";
import { PreviewPanel } from "../citations/PreviewPanel";
import { byline, type CitedWork } from "../citations/lookup";
import { useLibraryAdd } from "../citations/useLibraryAdd";
import { readerHash } from "../route";
import { inLibrary } from "./match";
import styles from "./RelatedTab.module.css";
import { useLibraryIndex } from "./useLibraryIndex";
import { useRelations, type RelatedWork } from "./useRelations";

const asCited = (work: RelatedWork): CitedWork => ({
  title: work.title,
  authors: work.authors,
  year: work.year,
  venue: work.venue,
  abstract: work.abstract,
  citation_count: work.citation_count,
  reference_count: null,
  doi: work.doi,
  arxiv: work.arxiv,
  url: "",
});

const searchable = (work: RelatedWork) =>
  [work.title, work.authors.join(" "), work.venue, work.year ?? ""]
    .join(" ")
    .toLowerCase();

/**
 * The papers this one cites and the papers that cite it, from the public
 * citation index: each with what is known of it, a preview beside the paper, and
 * a way into the library (or a mark that it is there already).
 */
export function RelatedTab({
  paper,
  active,
}: {
  paper: Paper;
  /** The tab is the one shown: nothing is asked before. */
  active: boolean;
}) {
  const { t } = useI18n();
  const { relation, setRelation, state, more, retry } = useRelations(
    paper.id,
    active,
  );
  const library = useLibraryIndex(active);
  const adding = useLibraryAdd();
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<RelatedWork | null>(null);

  // Another paper has its own related papers.
  useEffect(() => {
    setQuery("");
    setPreview(null);
  }, [paper.id]);
  // A paper added from here is in the library now.
  const addedCount = Object.values(adding.states).filter(
    (s) => s.status === "added",
  ).length;
  const { refresh } = library;
  useEffect(() => {
    if (addedCount) refresh();
  }, [addedCount, refresh]);

  // The end of the list coming into view asks for the next page.
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = end.current;
    if (!active || !element || state.status !== "idle" || state.next === null)
      return;
    const watcher = new IntersectionObserver(
      (entries) => entries.some((e) => e.isIntersecting) && more(),
      { rootMargin: "240px" },
    );
    watcher.observe(element);
    return () => watcher.disconnect();
  }, [active, state.status, state.next, state.items.length, more]);

  const asked = query.trim().toLowerCase();
  const shown = asked
    ? state.items.filter((work) => searchable(work).includes(asked))
    : state.items;
  const more_ = state.next !== null;

  const problemText = () => {
    const kind = state.problem?.kind;
    if (kind === "noId") return t("reader.related.noId");
    if (kind === "notIndexed") return t("reader.related.notIndexed");
    if (kind === "unavailable") return t("reader.related.unavailable");
    return t("reader.related.failed", { reason: state.problem?.message ?? "" });
  };

  const row = (work: RelatedWork, key: string) => {
    const added = work.arxiv ? adding.states[work.arxiv] : undefined;
    const known =
      inLibrary(library.index, work) ??
      (added?.status === "added" ? added.paperId : undefined);
    return (
      <li key={key} className={styles.row}>
        <p className={styles.title}>{work.title}</p>
        <p className={styles.meta}>
          {[
            byline(work, (authors) => t("reader.link.etAl", { authors }), 3),
            work.citation_count != null &&
              t("reader.related.cites", {
                count: work.citation_count.toLocaleString(),
              }),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <div className={styles.actions}>
          <Button
            size="sm"
            variant="ghost"
            icon={Eye}
            onClick={() => setPreview(work)}
            aria-label={`${t("reader.cite.preview")}: ${work.title}`}
          >
            {t("reader.cite.preview")}
          </Button>
          {known ? (
            <a
              className={styles.inLibrary}
              href={readerHash({ paperId: known })}
              aria-label={`${t("reader.related.inLibrary")}: ${work.title}`}
            >
              <Check size={14} aria-hidden="true" />
              {t("reader.related.inLibrary")}
            </a>
          ) : work.arxiv ? (
            <Button
              size="sm"
              variant="ghost"
              icon={Plus}
              loading={added?.status === "adding"}
              onClick={() => adding.add(work.arxiv)}
              aria-label={`${t("reader.cite.add")}: ${work.title}`}
            >
              {t("reader.cite.add")}
            </Button>
          ) : (
            <span className={styles.noAdd}>
              <Button
                size="sm"
                variant="ghost"
                icon={Plus}
                disabled
                aria-label={`${t("reader.cite.add")}: ${work.title}`}
                aria-describedby={`${paper.id}-noarxiv`}
              >
                {t("reader.cite.add")}
              </Button>
              <span id={`${paper.id}-noarxiv`} className={styles.reason}>
                {t("reader.related.noArxiv")}
              </span>
            </span>
          )}
        </div>
        {added?.status === "failed" && (
          <p className={styles.problem} role="alert">
            {t("reader.cite.addFailed", { reason: added.message })}
          </p>
        )}
      </li>
    );
  };

  return (
    <div className={styles.tab}>
      <div className={styles.controls}>
        <SegmentedControl
          kind="radio"
          size="sm"
          label={t("reader.related.relation")}
          value={relation}
          onChange={setRelation}
          options={[
            { value: "references", label: t("reader.related.references") },
            { value: "citations", label: t("reader.related.citations") },
          ]}
        />
        <TextField
          label={t("reader.related.filter")}
          hideLabel
          type="search"
          placeholder={t("reader.related.filter.placeholder")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {asked && more_ && state.items.length > 0 && (
          <p className={styles.note}>
            {t("reader.related.filterNote", { count: state.items.length })}
          </p>
        )}
      </div>

      {shown.length > 0 && (
        <ul
          className={styles.list}
          aria-label={t(`reader.related.${relation}`)}
        >
          {shown.map((work, i) =>
            row(work, `${work.s2_id || work.title}-${i}`),
          )}
        </ul>
      )}
      {state.status === "loading" && (
        <p className={styles.note} role="status" aria-busy="true">
          <Spinner size={14} />
          {t("reader.related.loading")}
        </p>
      )}
      {state.status === "failed" && (
        <div className={styles.problem} role="alert">
          <p>{problemText()}</p>
          {state.problem?.kind !== "noId" && (
            <Button size="sm" onClick={retry}>
              {t("common.retry")}
            </Button>
          )}
        </div>
      )}
      {asked && shown.length === 0 && state.items.length > 0 && (
        <p className={styles.note}>
          {t("reader.related.noMatch", { query: query.trim() })}
        </p>
      )}
      {state.status === "done" && state.items.length === 0 && (
        <p className={styles.note}>{t(`reader.related.none.${relation}`)}</p>
      )}
      {more_ && state.items.length > 0 && state.status !== "failed" && (
        <div ref={end} className={styles.end}>
          {state.status === "idle" && (
            <Button size="sm" variant="ghost" onClick={more}>
              {t("reader.related.more")}
            </Button>
          )}
        </div>
      )}

      {preview && (
        <PreviewPanel
          work={asCited(preview)}
          add={preview.arxiv ? adding.states[preview.arxiv] : undefined}
          onAdd={adding.add}
          onOpenPaper={(id) => {
            setPreview(null);
            window.location.hash = readerHash({ paperId: id });
          }}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}
