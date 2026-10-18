import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { api, type Item, type Paper } from "../../api";
import { useI18n } from "../../i18n/I18nProvider";
import {
  appendToNote,
  hasConflict,
  NOTE_STATUS,
  noteDocument,
  recoverNote,
  type NoteDocument,
  type State,
} from "../../lib/note-document";

/** Where the note's text is: kept on the service, on its way there, or stuck. */
export type NoteSave = "saved" | "saving" | "error";

export type Notes = {
  /** The paper's note; `null` while it is being looked for, and until the first thing is written. */
  note: Item | null;
  /** Looking for the note. */
  loading: boolean;
  /** Why the notes are not working, in a sentence for the person; empty while they are. */
  error: string;
  /** The notes could not be looked for at all (`retry` asks again); there is nothing to write in. */
  unavailable: boolean;
  /**
   * Adds a block of Markdown at the end of the note and saves it, making the
   * note first if the paper has none. Rejects, with a sentence for the person,
   * when it could not be kept.
   */
  append(markdown: string): Promise<void>;
  /** The note's text as the editor shows it (what was written, whether or not it has been saved). */
  body: string;
  save: NoteSave;
  /** The service has another version of the note, and the two could not be put together. */
  conflict: boolean;
  /** The editor's text changed. */
  edit(markdown: string): void;
  /** Keeps an image with the note (making the note first), for the editor to show; its address comes back. */
  attach(file: File): Promise<{ url: string; name: string }>;
  /** Writes down what is waiting now, instead of after the pause. */
  flush(): void;
  /** Tries again whatever stopped the notes: finding them, making them, saving. */
  retry(): void;
  /** After a conflict: throw the editor's text away for the service's. */
  loadLatest(): void;
  /** After a conflict: keep the editor's text over the service's. */
  keepMine(): void;
};

/** What the note looks for, for a paper: its note, or `null` if it has none. */
interface Lookup {
  paperId: string;
  note: Promise<Item | null>;
}

/**
 * The note of a paper, and the way to write to it. The note is the paper's
 * `kind: "note"` item (the most recently changed, if there are several); it is
 * made when the first thing is written, not when the paper is opened. Writes go
 * through the same queue as the old reader's editor, with the note's revision.
 */
export function useNotes(paper: Paper | null): Notes {
  const { t } = useI18n();
  const paperId = paper?.id ?? null;
  const title = paper
    ? t("reader.notes.title", { title: paper.title.slice(0, 450) })
    : "";
  const titleNow = useRef(title);
  titleNow.current = title;
  const tNow = useRef(t);
  tNow.current = t;

  const [attempt, setAttempt] = useState(0);
  const [found, setFound] = useState<{
    paperId: string;
    note: Item | null;
    failed: boolean;
  } | null>(null);
  const [createFailed, setCreateFailed] = useState(false);
  // What was written before the note could be made.
  const [unsaved, setUnsaved] = useState("");
  const lookup = useRef<Lookup | null>(null);
  const creation = useRef<Promise<Item> | null>(null);
  const waiting = useRef<string | null>(null);

  useEffect(() => {
    setFound(null);
    setCreateFailed(false);
    setUnsaved("");
    creation.current = null;
    waiting.current = null;
    if (!paperId) {
      lookup.current = null;
      return;
    }
    const controller = new AbortController();
    const { signal } = controller;
    const query = `/items?kind=note&paper_id=${encodeURIComponent(paperId)}`;
    const note = api<Item[]>(query, { signal }).then(
      (items) => items[0] ?? null,
    );
    lookup.current = { paperId, note };
    note.then(
      (item) => {
        if (!signal.aborted) setFound({ paperId, note: item, failed: false });
      },
      () => {
        if (!signal.aborted) setFound({ paperId, note: null, failed: true });
      },
    );
    return () => controller.abort();
  }, [paperId, attempt]);

  const here = found?.paperId === paperId ? found : null;
  const note = here?.note ?? null;
  const doc = useMemo(
    () => (note ? noteDocument(note) : null),
    // The queue is the note's for good; a newer copy of the same note is not another note.
    [note?.id],
  );
  const docNow = useRef<NoteDocument | null>(null);
  docNow.current = doc;
  // The queue may be from an earlier visit (or the old reader's): a newer version on the service is taken in,
  // or, if a draft is waiting on the older one, met as a conflict. The same version, or an older one, changes nothing.
  useEffect(() => {
    if (doc && note) doc.accept(note);
  }, [doc, note]);

  // The note saved (here, or by the old reader's editor): `note` follows its revision.
  useEffect(() => {
    const saved = (event: Event) => {
      const item = (event as CustomEvent<Item>).detail;
      setFound((old) =>
        old && old.note?.id === item.id ? { ...old, note: item } : old,
      );
    };
    window.addEventListener("note-saved", saved);
    return () => window.removeEventListener("note-saved", saved);
  }, []);

  /** The note, made now if the paper has none. Never makes a second, and never makes one when looking failed. */
  const ensure = useCallback(async (): Promise<Item> => {
    const looking = lookup.current;
    if (!looking) throw new Error("no paper");
    const existing = await looking.note;
    if (existing) return existing;
    if (!creation.current) {
      const made = api<Item>("/items", {
        method: "POST",
        body: JSON.stringify({
          kind: "note",
          paper_id: looking.paperId,
          title: titleNow.current,
          body: "",
        }),
      }).then(
        (item) => {
          if (lookup.current === looking) {
            lookup.current = {
              paperId: looking.paperId,
              note: Promise.resolve(item),
            };
            setFound({ paperId: looking.paperId, note: item, failed: false });
          }
          return item;
        },
        (reason: unknown) => {
          creation.current = null;
          throw reason;
        },
      );
      creation.current = made;
    }
    return creation.current;
  }, []);

  // The queue of the note: a draft left from an earlier visit is saved, a page that closes with
  // something unsaved asks first, and leaving writes down what is waiting.
  const subscribe = useCallback(
    (notify: () => void) => {
      if (!doc) return () => {};
      doc.listeners.add(notify);
      return () => {
        doc.listeners.delete(notify);
      };
    },
    [doc],
  );
  const view: State | null = useSyncExternalStore(
    subscribe,
    () => doc?.state ?? null,
  );
  useEffect(() => {
    if (!doc) return;
    void doc.save();
    const leave = (event: BeforeUnloadEvent) => {
      if (doc.state.status !== NOTE_STATUS.saved) {
        event.preventDefault();
        void doc.save();
      }
    };
    window.addEventListener("beforeunload", leave);
    return () => {
      window.removeEventListener("beforeunload", leave);
      void doc.save();
    };
  }, [doc]);

  // A conflict is put together before it is shown: once, when the queue meets it.
  const [recovering, setRecovering] = useState(false);
  const conflicted = useRef(false);
  const meetsConflict = view !== null && hasConflict(view);
  useEffect(() => {
    const met = meetsConflict && !conflicted.current;
    conflicted.current = meetsConflict;
    if (!met || !doc) return;
    setRecovering(true);
    void recoverNote(doc).finally(() => setRecovering(false));
  }, [doc, meetsConflict]);

  const edit = useCallback(
    (markdown: string) => {
      const current = docNow.current;
      if (current) {
        current.update({ body: markdown });
        return;
      }
      // Written before the note exists: make it, then hand it what is waiting by then.
      setUnsaved(markdown);
      waiting.current = markdown;
      const looking = lookup.current;
      ensure().then(
        (item) => {
          const text = waiting.current;
          waiting.current = null;
          const queue = noteDocument(item);
          if (text !== null && queue.state.body !== text)
            queue.update({ body: text });
        },
        () => {
          if (lookup.current === looking) setCreateFailed(true);
        },
      );
    },
    [ensure],
  );

  const append = useCallback(
    async (markdown: string) => {
      const block = markdown.trim();
      if (!block) return;
      const failure = () =>
        new Error(tNow.current("reader.notes.appendFailed"));
      let item: Item;
      try {
        item = await ensure();
      } catch {
        throw failure();
      }
      const queue = noteDocument(item);
      const body = queue.state.body;
      const gap = !body.trim()
        ? ""
        : body.endsWith("\n\n")
          ? ""
          : body.endsWith("\n")
            ? "\n"
            : "\n\n";
      await appendToNote(item, `${gap}${block}\n`);
      if (hasConflict(queue.state)) await recoverNote(queue);
      if (queue.state.error) throw failure();
    },
    [ensure],
  );

  const attach = useCallback(
    async (file: File) => {
      const item = await ensure();
      const form = new FormData();
      form.append("file", file);
      return api<{ url: string; name: string }>(`/items/${item.id}/images`, {
        method: "POST",
        body: form,
      });
    },
    [ensure],
  );

  const flush = useCallback(() => {
    void docNow.current?.save();
  }, []);

  const retry = useCallback(() => {
    if (here?.failed) {
      setAttempt((count) => count + 1);
      return;
    }
    if (createFailed) {
      setCreateFailed(false);
      edit(waiting.current ?? unsaved);
      return;
    }
    docNow.current?.retry();
  }, [here?.failed, createFailed, edit, unsaved]);

  const loadLatest = useCallback(() => {
    void docNow.current?.reload().catch(() => {});
  }, []);

  const keepMine = useCallback(() => {
    const queue = docNow.current;
    if (!queue) return;
    void (async () => {
      const { local, latest } = await queue.compare();
      await queue.merge(latest, local, local);
    })().catch(() => {});
  }, []);

  const conflict = view !== null && hasConflict(view) && !recovering;
  const failedToSave = view !== null && view.error !== "" && !conflict;
  const save: NoteSave =
    conflict || failedToSave || createFailed || here?.failed
      ? "error"
      : recovering ||
          (view ? view.status !== NOTE_STATUS.saved : unsaved !== "")
        ? "saving"
        : "saved";
  const error = here?.failed
    ? t("reader.notes.loadFailed")
    : createFailed
      ? t("reader.notes.createFailed")
      : conflict
        ? t("reader.notes.conflict")
        : failedToSave
          ? t("reader.notes.saveFailed")
          : "";

  return {
    note,
    loading: paperId !== null && here === null,
    error,
    unavailable: here?.failed === true,
    append,
    body: view?.body ?? unsaved,
    save,
    conflict,
    edit,
    attach,
    flush,
    retry,
    loadLatest,
    keepMine,
  };
}
