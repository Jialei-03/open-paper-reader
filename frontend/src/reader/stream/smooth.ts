/**
 * The pure part of the smooth reveal: streamed text arrives in bursts (a poll
 * brings a sentence at once), and is shown at an even pace instead. How many
 * characters to release, where it is safe to cut the text (never inside a
 * citation, a formula or a code span, which would flicker as raw markup), and
 * what to hold back at the stream's tail until its construct is closed.
 */

/** The slowest the text flows, in characters per second (a calm reading pace). */
export const MIN_RATE = 48;
/** The time the reveal takes to close most of a gap while the stream goes on, in seconds. */
export const CATCH_UP = 0.7;
/** The time constant of showing whatever is left once the stream is done, in seconds. */
export const FLUSH = 0.06;
/** The slowest the end of a finished stream flows, so the last characters do not trail off. */
export const FLUSH_RATE = 400;
/** An unfinished construct longer than this is not waited for: it was never a construct. */
export const HOLD_LIMIT = 300;

/** Characters per second for a gap of `backlog` characters: faster the further behind. */
export function releaseRate(backlog: number, done: boolean): number {
  const rate = Math.max(MIN_RATE, backlog / CATCH_UP);
  return done ? Math.max(rate, backlog / FLUSH, FLUSH_RATE) : rate;
}

/**
 * Whole characters to release in `dt` ms, and the fraction carried to the
 * next frame (so a slow rate still moves, a fast one does not overshoot).
 */
export function advance(
  carry: number,
  backlog: number,
  dt: number,
  done: boolean,
): { whole: number; carry: number } {
  if (backlog <= 0) return { whole: 0, carry: 0 };
  const owed = carry + (releaseRate(backlog, done) * dt) / 1000;
  const whole = Math.min(backlog, Math.floor(owed));
  return { whole, carry: owed - whole };
}

/** A complete construct of markdown that must appear whole or not at all. */
export type Span = readonly [start: number, end: number];

const CONSTRUCT =
  /\[[^\[\]\n]*\]\([^)\n]*\)|\$\$[\s\S]+?\$\$|\$[^$\n]+\$|`[^`\n]+`|\*\*[^*\n]+\*\*/g;

/** Where the complete links, formulas, code spans and bold runs of `text` lie. */
export function constructSpans(text: string): Span[] {
  const spans: Span[] = [];
  for (const match of text.matchAll(CONSTRUCT))
    spans.push([match.index, match.index + match[0].length]);
  return spans;
}

/**
 * Where the text may be shown up to, at most: the start of a construct still
 * being written at its tail ("[第 3", "[页](#pap", "$x^", "`co", "**bo"),
 * so it never shows as raw markup first. A finished stream holds nothing back.
 */
export function holdBack(text: string, done: boolean): number {
  if (done) return text.length;
  const from = Math.max(0, text.length - HOLD_LIMIT);
  const tail = text.slice(from);
  let cut = text.length;
  const open = (pattern: RegExp) => {
    const hit = pattern.exec(tail);
    if (hit) cut = Math.min(cut, from + hit.index);
  };
  // An unclosed "[", or a closed one whose "(" is not closed yet.
  open(/\[[^\[\]\n]*$/);
  open(/\[[^\[\]\n]*\]\([^)\n]*$/);
  open(/\[[^\[\]\n]*\]$/);
  // An odd number of "$", "`" or "**" on the last line: the last one opens something.
  const line = tail.slice(tail.lastIndexOf("\n") + 1);
  const lineStart = from + tail.length - line.length;
  const mark = (token: string) => {
    const at: number[] = [];
    for (
      let i = line.indexOf(token);
      i !== -1;
      i = line.indexOf(token, i + token.length)
    )
      if (line[i - 1] !== "\\") at.push(i);
    if (at.length % 2 === 1) cut = Math.min(cut, lineStart + at[at.length - 1]);
  };
  mark("$$");
  mark("`");
  mark("**");
  // A lone "$" (not part of "$$").
  const singles = [...line.matchAll(/(?<![$\\])\$(?!\$)/g)];
  if (singles.length % 2 === 1)
    cut = Math.min(cut, lineStart + singles[singles.length - 1].index);
  return cut;
}

const EXTENDS = /^[\p{M}‍️\u{1f3fb}-\u{1f3ff}]/u;

/**
 * The nearest cut at or after `index` that falls between whole characters
 * (never inside a surrogate pair, a combining mark or an emoji sequence) and
 * outside every construct in `spans`.
 */
export function settle(
  text: string,
  spans: readonly Span[],
  index: number,
): number {
  let at = Math.min(index, text.length);
  for (let guard = 0; guard < 8; guard += 1) {
    const before = at;
    for (const [start, end] of spans) if (start < at && at < end) at = end;
    if (at > 0 && at < text.length) {
      const low = text.charCodeAt(at);
      if (low >= 0xdc00 && low <= 0xdfff) at += 1;
      while (at < text.length) {
        const next = String.fromCodePoint(text.codePointAt(at)!);
        if (!EXTENDS.test(next)) break;
        at += next.length;
        // A joiner binds the character after it too (a family, a flag with its tag).
        if (next === "\u200d" && at < text.length)
          at += String.fromCodePoint(text.codePointAt(at)!).length;
      }
    }
    if (at === before) break;
  }
  return at;
}

/**
 * The next cut after `shown` when `whole` more characters are owed. A
 * construct that straddles the limit cannot be shown yet: the cut stops
 * before it, and `shown` is returned when nothing more may be shown.
 */
export function reveal(
  text: string,
  spans: readonly Span[],
  shown: number,
  whole: number,
  limit: number,
): number {
  if (whole <= 0 || shown >= limit) return Math.min(shown, limit);
  let ceiling = limit;
  for (const [start, end] of spans)
    if (start < ceiling && ceiling < end) ceiling = start;
  const cut = Math.min(settle(text, spans, shown + whole), ceiling);
  return cut > shown ? cut : shown;
}

/** How many of the trailing characters of the shown text are still fading in. */
export const FRESH = 14;
