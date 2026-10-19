/*
 * Offline reading was removed. Browsers that tried it may still hold its app
 * cache, its service worker and an IndexedDB copy of papers and notes. Clear the
 * caches and the worker, and drop the local copy, unless it holds notes written
 * offline that never reached the server: those are offered as a download first.
 */
// The names the retired offline reading used in readers' browsers (kept: they are what is cleared).
const DB = "zhijian-offline-v1";
const CACHE_PREFIX = "zhijian-offline-shell-";

type LocalNote = {
  pending?: boolean;
  conflict?: string;
  item?: { title?: string; body?: string };
};

function readNotes(): Promise<LocalNote[] | null> {
  return new Promise((resolve) => {
    let created = false;
    const request = indexedDB.open(DB);
    request.onupgradeneeded = () => {
      // There was no local copy; do not leave an empty database behind.
      created = true;
    };
    request.onerror = () => resolve(null);
    request.onsuccess = () => {
      const db = request.result;
      if (created || !db.objectStoreNames.contains("notes")) {
        db.close();
        indexedDB.deleteDatabase(DB);
        return resolve(null);
      }
      const all = db
        .transaction("notes", "readonly")
        .objectStore("notes")
        .getAll();
      all.onsuccess = () => {
        db.close();
        resolve(all.result as LocalNote[]);
      };
      all.onerror = () => {
        db.close();
        resolve(null);
      };
    };
  });
}

export function forgetOfflineCopy() {
  indexedDB.deleteDatabase(DB);
}

export function downloadUnsyncedNotes(notes: LocalNote[]) {
  const text = notes
    .map((n) => `# ${n.item?.title || "未命名笔记"}\n\n${n.item?.body || ""}\n`)
    .join("\n---\n\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(
    new Blob([text], { type: "text/markdown;charset=utf-8" }),
  );
  link.download = "Open-Paper-Reader-未同步的离线笔记.md";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 10000);
}

/** Clean up after the removed feature; returns notes that still need saving. */
export async function retireOfflineReading(): Promise<LocalNote[]> {
  try {
    localStorage.removeItem("zhijian-offline-owner");
  } catch {
    /* Nothing to clear. */
  }
  try {
    for (const registration of (await navigator.serviceWorker?.getRegistrations()) ||
      [])
      if (registration.active?.scriptURL.endsWith("/offline-worker.js"))
        await registration.unregister();
    for (const name of (await caches?.keys()) || [])
      if (name.startsWith(CACHE_PREFIX)) await caches.delete(name);
  } catch {
    /* The worker also removes itself on its next update check. */
  }
  if (typeof indexedDB === "undefined") return [];
  const notes = await readNotes();
  if (!notes) return [];
  const unsynced = notes.filter((n) => n.pending || n.conflict);
  if (!unsynced.length) forgetOfflineCopy();
  return unsynced;
}
