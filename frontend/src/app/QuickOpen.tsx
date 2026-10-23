import {
  FileText,
  Folder,
  Library,
  MessageSquare,
  Microscope,
} from "lucide-react";
import { useEffect, useId, useMemo, useState, type KeyboardEvent } from "react";
import { api, type Paper } from "../api";
import { useI18n } from "../i18n/I18nProvider";
import { readerHash } from "../reader/route";
import { Dialog, TextField } from "../ui";
import type { ProjectSession } from "../screens/research/research-api";
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
  includeProjects = false,
  go,
}: {
  open: boolean;
  onClose: () => void;
  papers: Paper[];
  visits: Record<string, number>;
  includeProjects?: boolean;
  /** Takes an address without its `#`. */
  go: (hash: string) => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState(0);
  const [sessions, setSessions] = useState<
    (ProjectSession & { workspace_name: string })[]
  >([]);
  const [searchFailed, setSearchFailed] = useState(false);
  const [searching, setSearching] = useState(false);
  const list = useId();
  const matches = useMemo(
    () => matchPapers(papers, query, visits),
    [papers, query, visits],
  );
  useEffect(() => {
    if (open) setQuery("");
  }, [open]);
  useEffect(() => setChosen(0), [query, open]);
  useEffect(() => {
    if (!open || !includeProjects) return;
    const controller = new AbortController();
    setSessions([]);
    setSearchFailed(false);
    setSearching(true);
    const timer = window.setTimeout(() => {
      api<{ items: (ProjectSession & { workspace_name: string })[] }>(
        `/research/sessions?limit=8&search=${encodeURIComponent(query.trim())}`,
        { signal: controller.signal },
      ).then(
        (result) => {
          if (!controller.signal.aborted) {
            setSessions(result.items);
            setSearching(false);
          }
        },
        () => {
          if (!controller.signal.aborted) {
            setSearchFailed(true);
            setSearching(false);
          }
        },
      );
    }, 150);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, includeProjects, query]);

  // With something typed, one more choice after the papers: the same words searched in the library.
  const asked = query.trim();
  const total = matches.length + sessions.length + (asked ? 1 : 0);
  const openLibrary = () => {
    onClose();
    go("library?q=" + encodeURIComponent(asked));
  };
  const openPaper = (paper: Paper) => {
    onClose();
    go(readerHash({ paperId: paper.id }).slice(1));
  };
  const openSession = (session: ProjectSession) => {
    onClose();
    go(
      session.kind === "research" && session.research_id
        ? `research/${session.research_id}`
        : session.kind === "project_lead"
          ? `projects/${session.workspace_id}`
          : `projects/${session.workspace_id}/chats/${session.id}`,
    );
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!total) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setChosen((at) => (at + step + total) % total);
    } else if (event.key === "Enter") {
      if (searching && !matches[chosen]) {
        event.preventDefault();
        return;
      }
      if (matches[chosen]) {
        event.preventDefault();
        openPaper(matches[chosen]);
      } else if (sessions[chosen - matches.length]) {
        event.preventDefault();
        openSession(sessions[chosen - matches.length]);
      } else if (asked) {
        event.preventDefault();
        openLibrary();
      }
    }
  };

  const optionId = (index: number) => `${list}-${index}`;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t(includeProjects ? "app.quickOpen.all" : "app.quickOpen")}
      size="md"
    >
      <TextField
        label={t(includeProjects ? "app.quickOpen.all" : "app.quickOpen.field")}
        hideLabel
        placeholder={t(
          includeProjects
            ? "app.quickOpen.allPlaceholder"
            : "app.quickOpen.placeholder",
        )}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={total > 0}
        aria-controls={list}
        aria-autocomplete="list"
        aria-activedescendant={chosen < total ? optionId(chosen) : undefined}
        autoComplete="off"
        spellCheck={false}
        data-autofocus
      />
      {matches.length === 0 && sessions.length === 0 && !searchFailed && (
        <p className={styles.empty} role="status">
          {t(
            includeProjects && searching
              ? "common.loading"
              : includeProjects
                ? "app.quickOpen.allNone"
                : papers.length
                  ? "app.quickOpen.none"
                  : "app.quickOpen.noPapers",
          )}
        </p>
      )}
      {searchFailed && (
        <p className={styles.empty} role="status">
          {t("app.quickOpen.projectsFailed")}
        </p>
      )}
      {total > 0 && (
        <ul
          id={list}
          role="listbox"
          aria-label={t(
            includeProjects ? "app.quickOpen.all" : "app.quickOpen.results",
          )}
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
          {sessions.map((session, offset) => {
            const index = matches.length + offset;
            const project = session.kind === "project_lead";
            const Icon = project
              ? Folder
              : session.kind === "research"
                ? Microscope
                : MessageSquare;
            return (
              <li
                key={`session-${session.id}`}
                id={optionId(index)}
                role="option"
                aria-selected={index === chosen}
                className={styles.option}
                onPointerMove={() => setChosen(index)}
                onClick={() => openSession(session)}
              >
                <Icon size={16} aria-hidden="true" />
                <span className={styles.text}>
                  <span className={styles.title}>
                    {project ? session.workspace_name : session.title}
                  </span>
                  <span className={styles.authors}>
                    {t(
                      project
                        ? "projects.title"
                        : session.kind === "research"
                          ? "projects.kind.research"
                          : "projects.kind.chat",
                    )}
                    {!project && ` · ${session.workspace_name}`}
                  </span>
                </span>
              </li>
            );
          })}
          {asked && (
            <li
              id={optionId(matches.length + sessions.length)}
              role="option"
              aria-selected={chosen === matches.length + sessions.length}
              className={styles.option}
              onPointerMove={() => setChosen(matches.length + sessions.length)}
              onClick={openLibrary}
            >
              <Library size={16} aria-hidden="true" />
              <span className={styles.text}>
                <span className={styles.title}>
                  {t("app.quickOpen.library", { query: asked })}
                </span>
              </span>
            </li>
          )}
        </ul>
      )}
    </Dialog>
  );
}
