import { api, type Item, type Paper, type SourceFile } from "../api";

export type OfflinePaper = {
  key: string;
  owner: string;
  paper: Paper;
  file: SourceFile;
  pdf: Blob;
  savedAt: string;
};
export type OfflineNote = {
  key: string;
  owner: string;
  item: Item;
  pending: boolean;
  operation: string;
  conflict?: string;
};
const DB = "zhijian-offline-v1";
const ownerKey = "zhijian-offline-owner";
export function offlineOwner() {
  try {
    return localStorage.getItem(ownerKey) || "";
  } catch {
    return "";
  }
}
export function setOfflineOwner(owner: string) {
  try {
    if (owner) localStorage.setItem(ownerKey, owner);
    else localStorage.removeItem(ownerKey);
  } catch {
    /* Normal online access does not depend on local storage. */
  }
}
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      for (const name of ["papers", "notes"])
        request.result.createObjectStore(name, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new Error("无法打开本机存储，请检查浏览器存储设置"));
  });
}
async function transaction<T>(
  store: string,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = work(tx.objectStore(store));
    tx.oncomplete = () => {
      db.close();
      resolve(request.result);
    };
    tx.onabort = tx.onerror = () => {
      db.close();
      reject(new Error("本机保存失败，可能存储空间不足。请导出笔记后重试"));
    };
  });
}
export const offlinePapers = async (owner = offlineOwner()) =>
  (
    await transaction<OfflinePaper[]>("papers", "readonly", (s) => s.getAll())
  ).filter((p) => p.owner === owner);
export const offlineNotes = async (owner = offlineOwner()) =>
  (
    await transaction<OfflineNote[]>("notes", "readonly", (s) => s.getAll())
  ).filter((n) => n.owner === owner);
export const putOfflineNote = (note: OfflineNote) =>
  transaction("notes", "readwrite", (s) => s.put(note));
export async function saveOfflineBody(key: string, body: string) {
  const db = await database();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("notes", "readwrite");
    const s = tx.objectStore("notes");
    const get = s.get(key);
    get.onsuccess = () => {
      const note = get.result as OfflineNote;
      if (!note) {
        tx.abort();
        return;
      }
      s.put({
        ...note,
        item: { ...note.item, body },
        pending: true,
        operation: crypto.randomUUID(),
        conflict: undefined,
      });
    };
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onabort = tx.onerror = () => {
      db.close();
      reject(new Error("笔记未能保存到本机，请导出内容并检查存储空间"));
    };
  });
}
function notePayload(item: Item) {
  return {
    kind: "note",
    paper_id: item.paper_id,
    title: item.title,
    body: item.body,
    status: item.status,
    tags: item.tags,
    paper_ids: item.paper_ids,
    evidence_ids: item.evidence_ids,
    locator: Object.keys(item.locator || {}).length ? item.locator : null,
  };
}
async function acknowledge(note: OfflineNote, saved: Item) {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("notes", "readwrite");
    const s = tx.objectStore("notes");
    const get = s.get(note.key);
    get.onsuccess = () => {
      const current = get.result as OfflineNote;
      if (!current) return;
      s.put(
        current.operation === note.operation
          ? { ...current, item: saved, pending: false, conflict: undefined }
          : {
              ...current,
              item: { ...current.item, id: saved.id, revision: saved.revision },
              pending: true,
            },
      );
    };
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onabort = tx.onerror = () => {
      db.close();
      reject(new Error("服务器已保存，但本机确认失败，请重试同步"));
    };
  });
}
let syncing = false;
export async function syncOfflineNotes() {
  if (syncing || !navigator.onLine) return;
  syncing = true;
  try {
    const owner = offlineOwner();
    const me = await api("/auth/me");
    if (!owner || me.user.id !== owner)
      throw new Error("请登录下载这些论文的原账号，再同步本机笔记");
    for (const note of await offlineNotes(owner)) {
      if (!note.pending || note.conflict) continue;
      try {
        const saved = await api<Item>("/items/" + note.item.id, {
          method: "PUT",
          headers: {
            "If-Match": String(note.item.revision),
            "Idempotency-Key": note.operation,
          },
          body: JSON.stringify(notePayload(note.item)),
        });
        await acknowledge(note, saved);
      } catch (e) {
        if (
          e &&
          typeof e === "object" &&
          "status" in e &&
          [404, 409].includes(Number(e.status))
        ) {
          await transaction("notes", "readwrite", (store) => {
            const request = store.get(note.key);
            request.onsuccess = () => {
              if (request.result)
                store.put({
                  ...request.result,
                  conflict:
                    "云端内容已更新或删除。本机笔记已保留，可另存为新笔记。",
                });
            };
            return request;
          });
        } else throw e;
      }
    }
  } finally {
    syncing = false;
  }
}
export async function saveConflictCopy(note: OfflineNote) {
  const me = await api("/auth/me");
  if (me.user.id !== note.owner) throw new Error("请登录原账号");
  const saved = await api<Item>("/items", {
    method: "POST",
    headers: { "Idempotency-Key": note.operation + ":copy" },
    body: JSON.stringify({
      ...notePayload(note.item),
      title: note.item.title + " · 离线副本",
    }),
  });
  // Keep the original local key; future edits target the new server-side note.
  await acknowledge(note, saved);
}
export async function removeOfflinePaper(paper: OfflinePaper) {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["papers", "notes"], "readwrite");
    let pending = false;
    const store = tx.objectStore("notes");
    const get = store.getAll();
    get.onsuccess = () => {
      const notes = (get.result as OfflineNote[]).filter(
        (n) => n.owner === paper.owner && n.item.paper_id === paper.paper.id,
      );
      if (notes.some((n) => n.pending)) {
        pending = true;
        tx.abort();
        return;
      }
      tx.objectStore("papers").delete(paper.key);
      for (const note of notes) store.delete(note.key);
    };
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onabort = tx.onerror = () => {
      db.close();
      reject(
        new Error(
          pending
            ? "此论文有尚未同步的笔记，请先同步或导出备份"
            : "移除本机下载失败，请重试",
        ),
      );
    };
  });
}
export async function prepareOfflineShell(progress: (message: string) => void) {
  if (!navigator.serviceWorker)
    throw new Error("当前浏览器不支持离线，请使用 HTTPS 和新版 Safari");
  await navigator.serviceWorker.register("/offline-worker.js", {
    scope: "/",
    updateViaCache: "none",
  });
  const registration = await navigator.serviceWorker.ready;
  await new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(
      () => reject(new Error("离线程序下载超时，请联网重试")),
      180000,
    );
    channel.port1.onmessage = (event) => {
      if (event.data.error) {
        clearTimeout(timer);
        reject(new Error(event.data.error));
      } else if (event.data.done) {
        clearTimeout(timer);
        resolve();
      } else
        progress(`准备离线阅读 ${event.data.completed}/${event.data.total}`);
    };
    registration.active!.postMessage({ type: "PREPARE" }, [channel.port2]);
  });
}
export async function downloadOfflinePaper(
  paper: Paper,
  file: SourceFile,
  progress: (message: string) => void,
) {
  const me = await api("/auth/me");
  setOfflineOwner(me.user.id);
  const existing = (await offlineNotes(me.user.id)).filter(
    (n) => n.item.paper_id === paper.id,
  );
  if (existing.some((n) => n.pending))
    throw new Error("请先同步此论文的本机笔记，再更新离线下载");
  await prepareOfflineShell(progress);
  const notes = await api<Item[]>("/items?paper_id=" + paper.id + "&kind=note");
  progress("下载 PDF…");
  const response = await fetch("/api/v1/files/" + file.id + "/content", {
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error("PDF 下载失败，请重新登录后重试");
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      progress(
        `下载 PDF ${Math.min(100, Math.round((loaded / Math.max(file.size, loaded)) * 100))}%`,
      );
    }
  }
  const pdf = reader
    ? new Blob(chunks as BlobPart[], { type: "application/pdf" })
    : await response.blob();
  if (file.sha256 && crypto.subtle) {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      await pdf.arrayBuffer(),
    );
    const hex = Array.from(new Uint8Array(digest), (n) =>
      n.toString(16).padStart(2, "0"),
    ).join("");
    if (hex !== file.sha256) throw new Error("论文下载不完整，请重试");
  }
  // Commit PDF and note snapshot atomically; an incomplete download never appears ready.
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["papers", "notes"], "readwrite");
    const check = tx.objectStore("notes").getAll();
    check.onsuccess = () => {
      if (
        (check.result as OfflineNote[]).some(
          (note) =>
            note.owner === me.user.id &&
            note.item.paper_id === paper.id &&
            note.pending,
        )
      ) {
        tx.abort();
        return;
      }
      tx.objectStore("papers").put({
        key: me.user.id + ":" + paper.id,
        owner: me.user.id,
        paper,
        file,
        pdf,
        savedAt: new Date().toISOString(),
      });
      for (const previous of check.result as OfflineNote[])
        if (
          previous.owner === me.user.id &&
          previous.item.paper_id === paper.id
        )
          tx.objectStore("notes").delete(previous.key);
      for (const note of notes)
        tx.objectStore("notes").put({
          key: me.user.id + ":" + note.id,
          owner: me.user.id,
          item: note,
          pending: false,
          operation: "",
        });
    };
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onabort = tx.onerror = () => {
      db.close();
      reject(new Error("离线下载未保存，存储空间可能不足"));
    };
  });
  if (navigator.storage?.persist)
    await navigator.storage.persist().catch(() => false);
  progress("已保存，可离线阅读");
}
