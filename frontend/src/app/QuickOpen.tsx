import { FileText } from "lucide-react";
import { useEffect, useId, useMemo, useState, type KeyboardEvent } from "react";
import type { Paper } from "../api";
import { useI18n } from "../i18n/I18nProvider";
import { readerHash } from "../reader/route";
import { Dialog, TextField } from "../ui";
import styles from "./QuickOpen.module.css";

/** How many papers the list shows at once. */
const LIMIT = 8;

/**
 * The papers that match `query`, best first: every word of it must be in the
 * title or the authors; a title that starts with it comes before one that only
 * has it. Without a query, the papers read last come first.
 */
export function matchPapers(
  papers: Paper[],
  query: string,
  visits: Record<string, number>,
): Paper[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length)
    return [...papers]
      .sort((a, b) => (visits[b.id] ?? 0) - (visits[a.id] ?? 0))
      .slice(0, LIMIT);
  const whole = words.join(" ");
  return papers
    .map((paper) => {
      const title = paper.title.toLowerCase();
      const text = `${title} ${paper.authors.toLowerCase()}`;
      if (!words.every((word) => text.includes(word))) return null;
      const score =
        (title.startsWith(whole) ? 2 : title.includes(whole) ? 1 : 0) +
        (visits[paper.id] ? 0.5 : 0);
      return { paper, score };
    })
    .filter((row): row is { paper: Paper; score: number } => !!row)
    .sort((a, b) => b.score - a.score)
    .slice(0, LIMIT)
    .map((row) => row.paper);
}

/**
 * Quick open (Ctrl/⌘ K): type a few words of a title or an author, and Enter
 * opens the paper in the reader. Up and down choose among the matches.
 */
export function QuickOpen({
  open,
  onClose,
  papers,
  visits,
  go,
}: {
  open: boolean;
  onClose: () => void;
  papers: Paper[];
  visits: Record<string, number>;
  /** Takes an address without its `#`. */
  go: (hash: string) => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState(0);
  const list = useId();
  const matches = useMemo(
    () => matchPapers(papers, query, visits),
    [papers, query, visits],
  );
  useEffect(() => {
    if (open) setQuery("");
  }, [open]);
  useEffect(() => setChosen(0), [query, open]);

  const openPaper = (paper: Paper) => {
    onClose();
    go(readerHash({ paperId: paper.id }).slice(1));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!matches.length) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setChosen((at) => (at + step + matches.length) % matches.length);
    } else if (event.key === "Enter" && matches[chosen]) {
      event.preventDefault();
      openPaper(matches[chosen]);
    }
  };

  const optionId = (index: number) => `${list}-${index}`;
  return (
    <Dialog open={open} onClose={onClose} title={t("app.quickOpen")} size="md">
      <TextField
        label={t("app.quickOpen.field")}
        hideLabel
        placeholder={t("app.quickOpen.placeholder")}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={matches.length > 0}
        aria-controls={list}
        aria-autocomplete="list"
        aria-activedescendant={matches[chosen] ? optionId(chosen) : undefined}
        autoComplete="off"
        spellCheck={false}
        data-autofocus
      />
      {matches.length > 0 ? (
        <ul
          id={list}
          role="listbox"
          aria-label={t("app.quickOpen.results")}
          className={styles.list}
        >
          {matches.map((paper, index) => (
            <li
              key={paper.id}
              id={optionId(index)}
              role="option"
              aria-selected={index === chosen}
              className={styles.option}
              onPointerMove={() => setChosen(index)}
              onClick={() => openPaper(paper)}
            >
              <FileText size={16} aria-hidden="true" />
              <span className={styles.text}>
                <span className={styles.title}>
                  {paper.title || t("reader.untitled")}
                </span>
                {paper.authors && (
                  <span className={styles.authors}>{paper.authors}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.empty} role="status">
          {t(papers.length ? "app.quickOpen.none" : "app.quickOpen.noPapers")}
        </p>
      )}
    </Dialog>
  );
}
