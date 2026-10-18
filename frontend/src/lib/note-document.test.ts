import { afterEach, describe, expect, it, vi } from "vitest";
import type { Item } from "../api";
import {
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
