import { api, errorStatus, send, type Item } from "../api";

/**
 * The save queue of a note: one per note, for as long as the page lives, so that
 * a save in flight survives leaving the note, and so that anything that writes
 * to the note (the editor, an "add to notes" action) goes through the same
 * revision-checked queue. The old reader's editor and the new reader's notes tab
 * both use it; it draws nothing.
 */

/** What `State.status` says. The old editor shows these as they are. */
export const NOTE_STATUS = {
  saved: "已保存",
  saving: "保存中…",
  pending: "待保存",
  failed: "未保存",
} as const;

export type Draft = { title: string; body: string };
export type State = Draft & { status: string; error: string };
// A single write queue per note survives switching notes while a save is in flight.
const documents = new Map<string, NoteDocument>();
export function getNoteDraft(note: Item): Draft {
  return (
    documents.get(note.id)?.state || { title: note.title, body: note.body }
  );
}
function documentState(item: Item) {
  let base = item;
  let origin: Draft | null = { title: item.title, body: item.body };
  let state: State = {
    title: item.title,
    body: item.body,
    status: NOTE_STATUS.saved,
    error: "",
  };
  const key = `paper-note-draft:${item.id}`;
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Promise<void> | null = null;
  const dirty = () => state.body !== base.body || state.title !== base.title;
  const emit = () => listeners.forEach((fn) => fn());
  const persist = () => {
    try {
      if (dirty())
        sessionStorage.setItem(
          key,
          JSON.stringify({ ...state, revision: base.revision, origin }),
        );
      else sessionStorage.removeItem(key);
    } catch {}
  };
  try {
    const draft = JSON.parse(sessionStorage.getItem(key) || "null");
    if (
      draft &&
      typeof draft.body === "string" &&
      typeof draft.title === "string"
    ) {
      origin =
        draft.origin &&
        typeof draft.origin.body === "string" &&
        typeof draft.origin.title === "string"
          ? draft.origin
          : draft.revision === base.revision
            ? origin
            : null;
      state = {
        body: draft.body,
        title: draft.title,
        status: NOTE_STATUS.pending,
        error:
          draft.revision === base.revision
            ? ""
            : "服务器已有新版本，本地草稿已保留。",
      };
    }
  } catch {}
  const save = (): Promise<void> => {
    clearTimeout(timer);
    if (pending) return pending;
    if (!dirty() || state.error) return Promise.resolve();
    const sent = { title: state.title, body: state.body };
    state = { ...state, status: NOTE_STATUS.saving };
    emit();
    pending = send(
      `/items/${item.id}`,
      {
        kind: base.kind,
        paper_id: base.paper_id,
        ...sent,
        status: base.status,
        tags: base.tags,
        paper_ids: base.paper_ids,
        evidence_ids: base.evidence_ids,
        locator: base.locator.file_id ? base.locator : null,
      },
      "PUT",
      base.revision,
    )
      .then((updated: Item) => {
        base = updated;
        origin = { title: updated.title, body: updated.body };
        if (state.body === sent.body && state.title === sent.title)
          state = { ...state, body: updated.body, title: updated.title };
        state = {
          ...state,
          status: dirty() ? NOTE_STATUS.pending : NOTE_STATUS.saved,
        };
        persist();
        window.dispatchEvent(
          new CustomEvent("note-saved", { detail: updated }),
        );
      })
      .catch((e: Error) => {
        state = {
          ...state,
          status: NOTE_STATUS.failed,
          error: [409, 412].includes(errorStatus(e))
            ? "笔记已有新版本，本地草稿已保留。请核对后继续。"
            : `保存失败，草稿已保留：${e.message}`,
        };
        persist();
      })
      .finally(() => {
        pending = null;
        emit();
        if (dirty() && !state.error) void save();
      });
    return pending;
  };
  return {
    get state() {
      return state;
    },
    listeners,
    save,
    async flush() {
      while (dirty() || pending) {
        await save();
        if (state.error) throw new Error(state.error);
      }
      return base;
    },
    update(draft: Partial<Draft>) {
      state = { ...state, ...draft, status: NOTE_STATUS.pending };
      persist();
      emit();
      clearTimeout(timer);
      timer = setTimeout(save, 900);
    },
    accept(item: Item) {
      if (item.revision <= base.revision || pending) return;
      if (dirty()) {
        state = {
          ...state,
          error: "笔记已有新版本，本地草稿已保留。请核对后继续。",
        };
      } else {
        base = item;
        origin = { title: item.title, body: item.body };
        state = { ...state, title: item.title, body: item.body };
      }
      emit();
    },
    async reload() {
      const latest = await api<Item>(`/items/${item.id}`);
      base = latest;
      origin = { title: latest.title, body: latest.body };
      state = {
        title: latest.title,
        body: latest.body,
        status: NOTE_STATUS.saved,
        error: "",
      };
      persist();
      emit();
    },
    async compare() {
      if (pending) await pending;
      const latest = await api<Item>(`/items/${item.id}`);
      return {
        origin,
        local: { title: state.title, body: state.body },
        latest,
      };
    },
    async merge(latest: Item, draft: Draft, expected: Draft) {
      if (pending) await pending;
      if (state.body !== expected.body || state.title !== expected.title)
        throw new Error("本地草稿也有新修改，请重新读取版本后合并。");
      base = latest;
      origin = { title: latest.title, body: latest.body };
      state = { ...draft, status: NOTE_STATUS.pending, error: "" };
      if (!dirty()) state.status = NOTE_STATUS.saved;
      persist();
      emit();
      await save();
      if (state.error) throw new Error(state.error);
    },
    retry() {
      if (!state.error.includes("新版本")) {
        state = { ...state, error: "" };
        void save();
      }
    },
  };
}

export type NoteDocument = ReturnType<typeof documentState>;

/** The queue of a note, made on first use. */
export function noteDocument(note: Item): NoteDocument {
  let doc = documents.get(note.id);
  if (!doc) {
    doc = documentState(note);
    documents.set(note.id, doc);
  }
  return doc;
}

/** Whether the queue stopped because the service has a newer version of the note than the draft is made from. */
export const hasConflict = (state: Pick<State, "error">) =>
  state.error.includes("新版本");

export function appendToNote(note: Item, text: string) {
  const doc = noteDocument(note);
  doc.update({ body: doc.state.body + text });
  return doc.save();
}
export async function saveNote(note: Item): Promise<Item> {
  return documents.get(note.id)?.flush() || note;
}

function mergeField(
  origin: string,
  local: string,
  latest: string,
): string | null {
  if (local === origin) return latest;
  if (latest === origin || latest === local) return local;
  return null;
}

function mergeBody(origin: string, local: string, latest: string) {
  const merged = mergeField(origin, local, latest);
  if (merged !== null) return merged;
  // Both sides changed the text. What was added after a line break at the end of ours is the one change
  // that can be put after the other side's work without guessing; anything else is for a person to settle.
  if (local.startsWith(origin)) {
    const added = local.slice(origin.length);
    if (added.startsWith("\n")) {
      const block = added.replace(/^\n+/, "");
      const before = latest.replace(/\n+$/, "");
      return before ? `${before}\n\n${block}` : block;
    }
  }
  return null;
}

/**
 * The draft that keeps both sides when the service has moved on from the version
 * the draft was made from (`origin`; `null` when that is not known), or `null`
 * when the two changed the same thing and a person has to choose.
 */
export function mergeDrafts(
  origin: Draft | null,
  local: Draft,
  latest: Draft,
): Draft | null {
  if (!origin)
    return local.title === latest.title && local.body === latest.body
      ? local
      : null;
  const title = mergeField(origin.title, local.title, latest.title);
  const body = mergeBody(origin.body, local.body, latest.body);
  return title === null || body === null ? null : { title, body };
}

/** How many times a conflict is put together again before it is left to the person. */
const RECOVERIES = 2;

const recoveries = new WeakMap<NoteDocument, Promise<void>>();

/**
 * When the service's version of the note has moved on from the one a draft was
 * made from (another tab, the old reader, the assistant), asks for the latest and
 * puts the two together if they changed different things; else leaves the
 * conflict standing for a person to settle. Asked again while it runs, it is the
 * same run.
 */
export function recoverNote(doc: NoteDocument): Promise<void> {
  const running = recoveries.get(doc);
  if (running) return running;
  const run = (async () => {
    for (let round = 0; round < RECOVERIES && hasConflict(doc.state); round++) {
      try {
        const { origin, local, latest } = await doc.compare();
        const merged = mergeDrafts(origin, local, latest);
        if (!merged) return;
        await doc.merge(latest, merged, local);
      } catch {
        // The draft moved on while the latest was fetched, or the service could not be asked: go round again.
      }
    }
  })().finally(() => recoveries.delete(doc));
  recoveries.set(doc, run);
  return run;
}
