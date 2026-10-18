import { afterEach, describe, expect, it, vi } from "vitest";
import type { Item } from "../api";
import {
  addToNote,
  appendToNote,
  hasConflict,
  mergeDrafts,
  noteDocument,
  recoverNote,
} from "./note-document";

const draft = (body: string, title = "T") => ({ title, body });

describe("mergeDrafts", () => {
  it("keeps ours when the service still has what ours started from", () => {
    expect(mergeDrafts(draft("a"), draft("a b"), draft("a"))).toEqual(
      draft("a b"),
    );
  });

  it("takes the service's when we changed nothing", () => {
    expect(mergeDrafts(draft("a"), draft("a"), draft("a c"))).toEqual(
      draft("a c"),
    );
  });

  it("takes each side's own field when they changed different ones", () => {
    expect(
      mergeDrafts(draft("a", "T"), draft("a b", "T"), draft("a", "New")),
    ).toEqual({ title: "New", body: "a b" });
  });

  it("puts what was added after a line break after the other side's work", () => {
    expect(
      mergeDrafts(draft("a"), draft("a\n\nours\n"), draft("a theirs")),
    ).toEqual(draft("a theirs\n\nours\n"));
  });

  it("leaves it to a person when both changed the same text", () => {
    expect(mergeDrafts(draft("a"), draft("a b"), draft("a c"))).toBeNull();
    expect(mergeDrafts(draft("abc"), draft("abXc"), draft("Yabc"))).toBeNull();
  });

  it("does not guess without knowing what ours started from", () => {
    expect(mergeDrafts(null, draft("a b"), draft("a c"))).toBeNull();
    expect(mergeDrafts(null, draft("same"), draft("same"))).toEqual(
      draft("same"),
    );
  });
});

let made = 0;

/** A note on a service that checks revisions as the real one does (409 when If-Match is not the current one). */
function service(body: string) {
  let item: Item = {
    id: `note-${++made}`,
    kind: "note",
    paper_id: "paper-1",
    title: "Notes",
    body,
    status: "open",
    tags: [],
    paper_ids: [],
    evidence_ids: [],
    locator: {},
    attribution: "alice",
    revision: 1,
    updated_at: "2026-10-18T00:00:00Z",
  };
  const puts: string[] = [];
  /** Answers the next PUTs with this status instead (the service down, say). */
  let refuse: number | null = null;
  /** The next PUT waits for this before it is answered. */
  let gate: Promise<void> | null = null;
  const json = (status: number, data: unknown) =>
    new Response(JSON.stringify(data), { status });
  vi.stubGlobal("document", { cookie: "" });
  vi.stubGlobal("window", { dispatchEvent: () => true });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit = {}) => {
      if (init.method !== "PUT") return json(200, item);
      const sent = new Headers(init.headers).get("If-Match") ?? "";
      puts.push(sent);
      const waiting = gate;
      gate = null;
      if (waiting) await waiting;
      if (refuse) return json(refuse, { detail: "服务暂时不可用" });
      if (sent !== String(item.revision))
        return json(409, {
          detail: "Revision conflict; reload before editing",
        });
      const next = JSON.parse(String(init.body));
      item = {
        ...item,
        title: next.title,
        body: next.body,
        revision: item.revision + 1,
      };
      return json(200, item);
    }),
  );
  const first = item;
  return {
    first,
    puts,
    server: () => item,
    /** Someone else writes: the text, or (without one) only a new revision. */
    elsewhere(text?: string) {
      item = { ...item, body: text ?? item.body, revision: item.revision + 1 };
    },
    /** From now on the saves are refused with `status`; `null` takes them again. */
    refuse(status: number | null) {
      refuse = status;
    },
    /** Holds the next save on its way until `release` is called. */
    hold() {
      let release = () => {};
      gate = new Promise((resolve) => (release = resolve));
      return () => release();
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("the note's queue", () => {
  it("adds a block at the end and saves it against the note's revision", async () => {
    const remote = service("First.\n");
    await appendToNote(remote.first, "\nSecond.\n");
    expect(remote.puts).toEqual(["1"]);
    expect(remote.server().body).toBe("First.\n\nSecond.\n");
    expect(noteDocument(remote.first).state.error).toBe("");
  });

  it("asks for the latest and tries once more when the revision has moved but the text has not", async () => {
    const remote = service("First.\n");
    remote.elsewhere();
    const queue = noteDocument(remote.first);
    await appendToNote(remote.first, "\nSecond.\n");
    expect(hasConflict(queue.state)).toBe(true);
    await recoverNote(queue);
    expect(hasConflict(queue.state)).toBe(false);
    expect(queue.state.error).toBe("");
    expect(remote.puts).toEqual(["1", "2"]);
    expect(remote.server().body).toBe("First.\n\nSecond.\n");
  });

  it("keeps what someone else added when a block is added to the older text", async () => {
    const remote = service("First.\n");
    remote.elsewhere("First.\n\nTheirs.\n");
    const queue = noteDocument(remote.first);
    await appendToNote(remote.first, "\nMine.\n");
    await recoverNote(queue);
    expect(queue.state.error).toBe("");
    expect(remote.server().body).toBe("First.\n\nTheirs.\n\nMine.\n");
  });

  it("leaves the conflict to a person when both sides changed the same words", async () => {
    const remote = service("First.");
    remote.elsewhere("Rewritten elsewhere.");
    const queue = noteDocument(remote.first);
    queue.update({ body: "Rewritten here." });
    await queue.save();
    await recoverNote(queue);
    expect(hasConflict(queue.state)).toBe(true);
    expect(remote.server().body).toBe("Rewritten elsewhere.");
    expect(queue.state.body).toBe("Rewritten here.");
  });
});

describe("adding a block to the note", () => {
  it("puts it after a blank line and resolves once it is saved", async () => {
    const remote = service("First.");
    const queue = noteDocument(remote.first);
    expect(await addToNote(queue, "> Kept.")).toBe("saved");
    expect(remote.server().body).toBe("First.\n\n> Kept.\n");
    expect(queue.state.body).toBe("First.\n\n> Kept.\n");
  });

  it("does not add to a queue that has stopped, and leaves its draft as it was", async () => {
    const remote = service("First.");
    const queue = noteDocument(remote.first);
    remote.refuse(503);
    queue.update({ body: "First. Typed." });
    await queue.save();
    expect(queue.state.error).not.toBe("");
    const puts = remote.puts.length;

    expect(await addToNote(queue, "> Kept.")).toBe("refused");
    expect(queue.state.body).toBe("First. Typed.");
    expect(remote.puts).toHaveLength(puts);
  });

  it("does not add when a conflict cannot be put together", async () => {
    const remote = service("First.");
    remote.elsewhere("Rewritten elsewhere.");
    const queue = noteDocument(remote.first);
    queue.update({ body: "Rewritten here." });
    await queue.save();
    expect(hasConflict(queue.state)).toBe(true);

    expect(await addToNote(queue, "> Kept.")).toBe("refused");
    expect(queue.state.body).toBe("Rewritten here.");
    expect(remote.server().body).toBe("Rewritten elsewhere.");
  });

  it("waits for its own save, not one that was already on its way", async () => {
    const remote = service("First.");
    const queue = noteDocument(remote.first);
    const release = remote.hold();
    queue.update({ body: "First, edited." });
    const earlier = queue.save();
    expect(remote.puts).toHaveLength(1);

    let settled = false;
    const added = addToNote(queue, "> Kept.").then((result) => {
      settled = true;
      return result;
    });
    // The earlier save is still held: nothing is told yet, and the block has not been sent.
    for (let tick = 0; tick < 20; tick++) await Promise.resolve();
    expect(settled).toBe(false);
    expect(remote.puts).toHaveLength(1);
    release();
    await earlier;
    expect(await added).toBe("saved");
    // Told only once the block itself is on the service.
    expect(remote.puts).toHaveLength(2);
    expect(remote.server().body).toBe("First, edited.\n\n> Kept.\n");
  });

  it("says when the block is in the draft but its save failed", async () => {
    const remote = service("First.");
    const queue = noteDocument(remote.first);
    const release = remote.hold();
    queue.update({ body: "First, edited." });
    void queue.save();
    const added = addToNote(queue, "> Kept.");
    // The service goes down while the block waits its turn.
    remote.refuse(503);
    release();
    expect(await added).toBe("unsaved");
    expect(queue.state.body).toBe("First, edited.\n\n> Kept.\n");
    expect(queue.state.error).not.toBe("");
  });

  it("puts a conflict met on the way together, and saves the block after the other side's text", async () => {
    const remote = service("First.\n");
    const queue = noteDocument(remote.first);
    remote.elsewhere("First.\n\nTheirs.\n");
    expect(await addToNote(queue, "Mine.")).toBe("saved");
    expect(remote.server().body).toBe("First.\n\nTheirs.\n\nMine.\n");
  });
});
