/**
 * Lets a few jobs run at a time and holds the rest in the order they came. The
 * thumbnails use it: a panel of a long PDF wants dozens of small pictures, and
 * drawing them all at once would stall the pages being read.
 */
export class RenderQueue {
  private running = 0;
  private waiting: Array<() => Promise<unknown>> = [];

  constructor(private readonly limit: number) {}

  /**
   * Runs `job` as soon as there is room. Returns what to call to give up: a
   * job that has not started then never does. One that has started is the
   * caller's to stop (it frees its place when it settles, however it ends).
   */
  add(job: () => Promise<unknown>): () => void {
    this.waiting.push(job);
    this.pump();
    return () => {
      const at = this.waiting.indexOf(job);
      if (at >= 0) this.waiting.splice(at, 1);
    };
  }

  private pump() {
    while (this.running < this.limit && this.waiting.length > 0) {
      const job = this.waiting.shift()!;
      this.running++;
      // A job that throws, or rejects, is over all the same: its place is free.
      Promise.resolve()
        .then(job)
        .catch(() => undefined)
        .finally(() => {
          this.running--;
          this.pump();
        });
    }
  }
}
