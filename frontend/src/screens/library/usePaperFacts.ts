import { useMemo, type RefObject } from "react";
import type { Paper } from "../../api";
import { useI18n } from "../../i18n/I18nProvider";
import { lastPage } from "../../reader/engine/page-memory";
import { authorList, paperIds, progressOf, type PaperIds } from "./paper-meta";
import { usePaperPdf, type PaperPdf } from "./thumbnail";

/** What a card or a row says about a paper, besides what the paper itself holds. */
export interface PaperFacts {
  pdf: PaperPdf | null;
  /** The page it was last read at on this device, if any. */
  page: number | null;
  pages: number | null;
  /** 0 to 1. */
  progress: number;
  ids: PaperIds;
  /** The authors cut to a few names and "et al."; empty without authors. */
  byline: string;
  /** "arXiv 2301.12345 · 2023", as far as it is known. */
  source: string;
}

const NAMES_SHOWN = 3;

export function usePaperFacts(
  paper: Paper,
  owner: string,
  target: RefObject<HTMLElement | null>,
): PaperFacts {
  const { t } = useI18n();
  const pdf = usePaperPdf(paper, target);
  const page = useMemo(() => lastPage(owner, paper.id), [owner, paper.id]);
  const pages = pdf?.file?.pages ?? null;
  const ids = useMemo(() => paperIds(paper.external_id), [paper.external_id]);
  const byline = useMemo(() => {
    const names = authorList(paper.authors);
    if (names.length <= NAMES_SHOWN) return names.join(", ");
    return t("library.authors.more", {
      names: names.slice(0, NAMES_SHOWN).join(", "),
    });
  }, [paper.authors, t]);
  const source = [
    ids.arxiv ? `arXiv ${ids.arxiv}` : ids.doi ? `DOI ${ids.doi}` : "",
    ids.year ? String(ids.year) : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    pdf,
    page,
    pages,
    progress: progressOf(page, pages),
    ids,
    byline,
    source,
  };
}
