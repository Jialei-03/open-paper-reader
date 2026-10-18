import { useEffect, useSyncExternalStore } from "react";
import { api } from "../../api";
import { markKey, marksIn, type CiteMark } from "./marks";

/**
 * Whether the words of a marker are really on the page. The service looks them
 * up in the paper's text (`POST /files/{id}/citations/check`: a page that is
 * wrong is corrected, words that are nowhere are refused) and the answer is
 * kept for the session. A marker is drawn as a citation only when it was found;
 * while it is waited for, and when it was not found, it is not drawn at all
 * (showing one that may be wrong would send the reader to the wrong place).
 */
type Verdict = CiteMark | null;

const verdicts = new Map<string, Map<string, Verdict>>();
const asked = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

const BATCH = 100;

const notify = () => {
  version += 1;
  for (const listener of listeners) listener();
};

/** What is known of a mark: the mark as the service has it, `null` if it is not on the paper, `undefined` while unknown. */
export function peek(fileId: string, mark: CiteMark): Verdict | undefined {
  return verdicts.get(fileId)?.get(markKey(mark));
}

/** Asks about the marks not yet known; resolves when they are. Failures leave them unknown (not shown). */
export async function verifyMarks(
  fileId: string,
  marks: readonly CiteMark[],
): Promise<void> {
  const known = verdicts.get(fileId) ?? new Map<string, Verdict>();
  verdicts.set(fileId, known);
  const wanted = new Map<string, CiteMark>();
  for (const mark of marks) {
    const key = markKey(mark);
    if (known.has(key) || asked.has(`${fileId}\n${key}`)) continue;
    wanted.set(key, mark);
  }
  const list = [...wanted.entries()];
  for (let from = 0; from < list.length; from += BATCH) {
    const batch = list.slice(from, from + BATCH);
    for (const [key] of batch) asked.add(`${fileId}\n${key}`);
    try {
      const body = await api<{
        results: ({ page: number; quote: string } | null)[];
      }>(`/files/${encodeURIComponent(fileId)}/citations/check`, {
        method: "POST",
        body: JSON.stringify({
          marks: batch.map(([, mark]) => ({
            page: mark.page,
            quote: mark.quote.slice(0, 2000),
          })),
        }),
      });
      batch.forEach(([key], index) => {
        const found = body.results?.[index];
        known.set(
          key,
          found && Number.isInteger(found.page) && found.quote
            ? { page: found.page, quote: found.quote }
            : null,
        );
      });
    } catch {
      // Not known: not shown. Asked again the next time the text is shown.
    } finally {
      for (const [key] of batch) asked.delete(`${fileId}\n${key}`);
    }
    notify();
  }
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
export const subscribeVerdicts = subscribe;

/**
 * `resolve(mark)`: the mark as it truly is on the paper, or `null` while it is
 * not (yet) known to be. `active: false` (an answer still being written) asks
 * about nothing: it is checked once it is complete.
 */
export function useVerified(
  fileId: string | undefined,
  texts: readonly string[],
  active = true,
): (mark: CiteMark) => CiteMark | null {
  const all = texts.flatMap(marksIn);
  const signature = all.map(markKey).join("\n\n");
  useEffect(() => {
    if (fileId && active && all.length) void verifyMarks(fileId, all);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId, active, signature]);
  useSyncExternalStore(
    subscribe,
    () => version,
    () => version,
  );
  return (mark) => (fileId && active ? (peek(fileId, mark) ?? null) : null);
}

/** For tests: forget everything. */
export function resetVerdicts() {
  verdicts.clear();
  asked.clear();
  notify();
}

/**
 * What is known of one mark, for a view that draws one citation among many (the
 * note's editor asks about all of its marks at once): the mark as the paper has
 * it, or `null` while it is not known to be on the paper.
 */
export function useVerdict(
  fileId: string | undefined,
  mark: CiteMark,
): CiteMark | null {
  useSyncExternalStore(
    subscribe,
    () => version,
    () => version,
  );
  return fileId ? (peek(fileId, mark) ?? null) : null;
}
