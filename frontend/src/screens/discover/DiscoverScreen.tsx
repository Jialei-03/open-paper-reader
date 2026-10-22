import { Compass, Check, EyeOff, Eye, Plus, RefreshCw } from "lucide-react";
import { useState } from "react";
import type { Paper } from "../../api";
import { useI18n } from "../../i18n/I18nProvider";
import { PreviewPanel } from "../../reader/citations/PreviewPanel";
import { byline, type CitedWork } from "../../reader/citations/lookup";
import { useLibraryAdd } from "../../reader/citations/useLibraryAdd";
import { followLink, readerHash } from "../../reader/route";
import { Button, Card, CardHeader, Spinner, toast } from "../../ui";
import styles from "./DiscoverScreen.module.css";
import { useRecommendations, type Recommendation } from "./useRecommendations";

const WHY_SHOWN = 3;

const asCited = (item: Recommendation): CitedWork => ({
  title: item.title,
  authors: item.authors,
  year: item.year,
  venue: item.venue,
  abstract: item.abstract,
  citation_count: item.citation_count,
  reference_count: null,
  doi: item.doi,
  arxiv: item.arxiv,
  url: item.url,
});

export interface DiscoverScreenProps {
  papers: Paper[];
  go(hash: string): void;
  /** The library changed (a paper was added): the app reads it again. */
  reload(): void;
}

/**
 * Papers the library points to, from the public services: what each is, why it
 * is suggested (which of the person's papers it relates to), and what to do
 * about it: preview it, add it, or say it is not of interest.
 */
export function DiscoverScreen({ papers, go, reload }: DiscoverScreenProps) {
  const { t, locale } = useI18n();
  const recs = useRecommendations(30);
  const adding = useLibraryAdd();
  const [preview, setPreview] = useState<Recommendation | null>(null);
  const known = new Set(papers.map((paper) => paper.id));

  const time = (stamp?: string) =>
    stamp
      ? new Intl.DateTimeFormat(locale, {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(stamp))
      : "";

  const add = (arxiv: string) => {
    adding.add(arxiv);
    // The library is read again once the import has had time to finish.
    window.setTimeout(reload, 2500);
  };

  const dismiss = async (item: Recommendation) => {
    try {
      const at = await recs.dismiss(item);
      toast.show({
        message: t("discover.dismissed"),
        action: {
          label: t("discover.undo"),
          onClick: () =>
            recs.undo(item, at).catch((error: unknown) =>
              toast.show({
                message: t("discover.undoFailed", {
                  reason:
                    error instanceof Error ? error.message : String(error),
                }),
                tone: "error",
              }),
            ),
        },
      });
    } catch (error) {
      toast.show({
        message: t("discover.dismissFailed", {
          reason: error instanceof Error ? error.message : String(error),
        }),
        tone: "error",
      });
    }
  };

  const data = recs.data;
  const header = (
    <CardHeader>
      <h1 id="discover-title" className={styles.heading}>
        {t("discover.title")}
      </h1>
      <span className={styles.spacer} />
      <Button
        size="sm"
        icon={RefreshCw}
        loading={recs.refreshing}
        disabled={recs.status === "loading"}
        onClick={recs.refresh}
      >
        {t("discover.refresh")}
      </Button>
    </CardHeader>
  );

  const message = (title: string, action?: React.ReactNode) => (
    <div className={styles.message} role="status">
      <Compass size={30} aria-hidden />
      <p className={styles.messageTitle}>{title}</p>
      {action}
    </div>
  );

  let body: React.ReactNode;
  if (recs.status === "loading") {
    body = (
      <p className={styles.loading} role="status" aria-busy="true">
        <Spinner size={14} />
        {t("discover.loading")}
      </p>
    );
  } else if (recs.status === "failed" || !data) {
    body = message(
      t("discover.failed", { reason: recs.error }),
      <Button size="sm" onClick={recs.reload}>
        {t("common.retry")}
      </Button>,
    );
  } else if (data.state === "no_seeds") {
    body = message(
      t("discover.noSeeds.title"),
      <Button size="sm" onClick={() => go("library")}>
        {t("discover.noSeeds.action")}
      </Button>,
    );
  } else if (data.state === "offline") {
    body = message(t("discover.offline.title"));
  } else if (data.state === "unavailable") {
    body = message(
      t("discover.unavailable.title"),
      <Button size="sm" onClick={recs.refresh} loading={recs.refreshing}>
        {t("common.retry")}
      </Button>,
    );
  } else {
    body = (
      <>
        <p className={styles.status}>
          {[
            data.fetched_at &&
              t("discover.updated", { time: time(data.fetched_at) }),
            data.source && t("discover.source", { source: data.source }),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {data.stale && data.fetched_at && (
          <p className={styles.problem} role="status">
            {t("discover.stale", { time: time(data.fetched_at) })}
          </p>
        )}
        {recs.error && recs.status === "ready" && (
          <p className={styles.problem} role="alert">
            {recs.error}
          </p>
        )}
        {data.items.length === 0 ? (
          message(t("discover.none.title"), t("discover.none.body"))
        ) : (
          <ul className={styles.cards} aria-label={t("discover.cards")}>
            {data.items.map((item) => {
              const added = item.arxiv ? adding.states[item.arxiv] : undefined;
              return (
                <li key={item.key} className={styles.card}>
                  <h2 className={styles.title}>{item.title}</h2>
                  <p className={styles.meta}>
                    {[
                      byline(
                        item,
                        (authors) => t("reader.link.etAl", { authors }),
                        4,
                      ),
                      item.citation_count != null &&
                        t("reader.related.cites", {
                          count: item.citation_count.toLocaleString(),
                        }),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {item.abstract && (
                    <p className={styles.abstract}>{item.abstract}</p>
                  )}
                  {item.why.length > 0 && (
                    <p className={styles.why}>
                      <span>{t("discover.why")}</span>
                      {item.why.slice(0, WHY_SHOWN).map((w) => {
                        const hash = readerHash({ paperId: w.paper_id });
                        return known.has(w.paper_id) ? (
                          <a
                            key={w.paper_id}
                            href={hash}
                            onClick={followLink(go, hash.slice(1))}
                          >
                            {w.title}
                          </a>
                        ) : (
                          <span key={w.paper_id}>{w.title}</span>
                        );
                      })}
                      {item.why.length > WHY_SHOWN && (
                        <span>+{item.why.length - WHY_SHOWN}</span>
                      )}
                    </p>
                  )}
                  <div className={styles.actions}>
                    <Button
                      size="sm"
                      icon={Eye}
                      onClick={() => setPreview(item)}
                      aria-label={`${t("reader.cite.preview")}: ${item.title}`}
                    >
                      {t("reader.cite.preview")}
                    </Button>
                    {added?.status === "added" ? (
                      <a
                        className={styles.inLibrary}
                        href={readerHash({ paperId: added.paperId })}
                        onClick={followLink(
                          go,
                          readerHash({ paperId: added.paperId }).slice(1),
                        )}
                      >
                        <Check size={14} aria-hidden="true" />
                        {t("reader.related.inLibrary")}
                      </a>
                    ) : item.arxiv ? (
                      <Button
                        size="sm"
                        icon={Plus}
                        loading={added?.status === "adding"}
                        onClick={() => add(item.arxiv)}
                        aria-label={`${t("reader.cite.add")}: ${item.title}`}
                      >
                        {t("reader.cite.add")}
                      </Button>
                    ) : (
                      <span className={styles.noAdd}>
                        <Button
                          size="sm"
                          icon={Plus}
                          disabled
                          aria-label={`${t("reader.cite.add")}: ${item.title}`}
                          aria-describedby={`why-no-${item.key}`}
                        >
                          {t("reader.cite.add")}
                        </Button>
                        <span id={`why-no-${item.key}`}>
                          {t("reader.related.noArxiv")}
                        </span>
                      </span>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={EyeOff}
                      onClick={() => void dismiss(item)}
                      aria-label={`${t("discover.dismiss")}: ${item.title}`}
                    >
                      {t("discover.dismiss")}
                    </Button>
                  </div>
                  {added?.status === "failed" && (
                    <p className={styles.problem} role="alert">
                      {t("reader.cite.addFailed", { reason: added.message })}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </>
    );
  }

  return (
    <Card as="main" className={styles.root} aria-labelledby="discover-title">
      <div className={styles.frame}>
        {header}
        <div className={styles.body}>{body}</div>
      </div>
      {preview && (
        <PreviewPanel
          work={asCited(preview)}
          add={preview.arxiv ? adding.states[preview.arxiv] : undefined}
          onAdd={add}
          onOpenPaper={(id) => {
            setPreview(null);
            go(readerHash({ paperId: id }).slice(1));
          }}
          onClose={() => setPreview(null)}
        />
      )}
    </Card>
  );
}
