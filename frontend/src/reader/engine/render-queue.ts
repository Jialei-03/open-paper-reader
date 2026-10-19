/**
 * Draws pages one at a time, the ones in the view first.
 *
 * pdf.js draws a page on the main thread (measuring every run of text as it
 * goes), and a dense page takes tens to hundreds of milliseconds. Left to
 * themselves, every page near the view starts at once, so a scroll across a
 * few pages piles seconds of work on the one thread and the scroll stutters.
 * Here a page is drawn when it is in the view; the pages merely near it (the
 * prefetch) wait for the view to be still. Every pane of every document shares
 * one queue, as they share the one thread.
 */

/** The view must have been still this long before a page that is only near it is drawn. */
export const QUIET_MS = 150;

/** What a page tells the queue about itself. */
export interface RenderSource {
  /** Whether the page is in the view now. */
  visible(): boolean;
  /** How far the page is from the middle of the view (smaller is sooner). */
  distance(): number;
  /** How long the view has been still, in milliseconds. */
  quietFor(): number;
  /** The view is being flung: pages that are passing are not worth drawing. */
  hurried(): boolean;
}

/** A drawing that can be stopped; the queue moves on when `done` settles. */
export interface Drawing {
  done: Promise<unknown>;
  cancel(): void;
}

interface Job {
  source: RenderSource;
  start(): Drawing;
}

const jobs = new Set<Job>();
let running: { job: Job; drawing: Drawing } | null = null;
let timer = 0;

function pick(): { job: Job; wait: number } | null {
  let best: Job | null = null;
  let bestKey = Infinity;
  let soonest = Infinity;
  for (const job of jobs) {
    const { source } = job;
    const visible = source.visible();
    if (source.hurried()) {
      soonest = Math.min(soonest, 60);
      continue;
    }
    if (!visible) soonest = Math.min(soonest, QUIET_MS - source.quietFor());
    if (!visible && source.quietFor() < QUIET_MS) continue;
    const key = (visible ? 0 : 1e9) + source.distance();
    if (key < bestKey) {
      best = job;
      bestKey = key;
    }
  }
  if (best) return { job: best, wait: 0 };
  return Number.isFinite(soonest)
    ? { job: null as never, wait: soonest }
    : null;
}

function pump() {
  if (running || timer) return;
  const next = pick();
  if (!next) return;
  if (!next.job) {
    timer = window.setTimeout(
      () => {
        timer = 0;
        pump();
      },
      Math.max(16, next.wait),
    );
    return;
  }
  // Let the frame that asked for it be painted first.
  timer = window.setTimeout(() => {
    timer = 0;
    const again = pick();
    if (!again?.job || running) return pump();
    const { job } = again;
    jobs.delete(job);
    const drawing = job.start();
    running = { job, drawing };
    const finish = () => {
      if (running?.drawing === drawing) running = null;
      pump();
    };
    drawing.done.then(finish, finish);
  }, 0);
}

/**
 * Asks for a page to be drawn when its turn comes. The returned function takes
 * the request back, and stops the drawing if it has begun.
 */
export function enqueueRender(
  source: RenderSource,
  start: () => Drawing,
): () => void {
  const job: Job = { source, start };
  jobs.add(job);
  // A wait for the view to be still does not hold back a page that is in it.
  if (!running) {
    window.clearTimeout(timer);
    timer = 0;
  }
  pump();
  return () => {
    jobs.delete(job);
    if (running?.job === job) {
      const { drawing } = running;
      running = null;
      drawing.cancel();
      pump();
    }
  };
}
