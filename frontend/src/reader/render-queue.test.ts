import { describe, expect, it } from "vitest";
import { RenderQueue } from "./render-queue";

/** A job that runs until `finish()`, and records that it started. */
function job() {
  let finish!: () => void;
  const state = { started: false };
  const run = () => {
    state.started = true;
    return new Promise<void>((resolve) => {
      finish = resolve;
    });
  };
  return { run, state, finish: () => finish() };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("RenderQueue", () => {
  it("runs at most `limit` jobs at a time, in order", async () => {
    const queue = new RenderQueue(2);
    const jobs = [job(), job(), job(), job()];
    for (const { run } of jobs) queue.add(run);
    await tick();
    expect(jobs.map((j) => j.state.started)).toEqual([
      true,
      true,
      false,
      false,
    ]);

    jobs[0].finish();
    await tick();
    expect(jobs.map((j) => j.state.started)).toEqual([true, true, true, false]);

    jobs[2].finish();
    jobs[1].finish();
    await tick();
    expect(jobs.map((j) => j.state.started)).toEqual([true, true, true, true]);
  });

  it("never lets a job that gave up start", async () => {
    const queue = new RenderQueue(1);
    const [first, second, third] = [job(), job(), job()];
    queue.add(first.run);
    const giveUp = queue.add(second.run);
    queue.add(third.run);
    await tick();
    giveUp();
    first.finish();
    await tick();
    expect(second.state.started).toBe(false);
    expect(third.state.started).toBe(true);
  });

  it("frees the place of a job that fails, or throws", async () => {
    const queue = new RenderQueue(1);
    const after = job();
    queue.add(() => Promise.reject(new Error("render failed")));
    queue.add(() => {
      throw new Error("could not even begin");
    });
    queue.add(after.run);
    await tick();
    await tick();
    expect(after.state.started).toBe(true);
  });

  it("leaves a job that has started to the caller when it gives up", async () => {
    const queue = new RenderQueue(1);
    const running = job();
    const waiting = job();
    const giveUp = queue.add(running.run);
    queue.add(waiting.run);
    await tick();
    // Too late to take it back: it holds its place until it settles.
    giveUp();
    await tick();
    expect(waiting.state.started).toBe(false);
    running.finish();
    await tick();
    expect(waiting.state.started).toBe(true);
  });
});
