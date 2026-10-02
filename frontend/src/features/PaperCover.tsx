import { useEffect, useRef, useState } from "react";
import { api, type SourceFile } from "@/api";
import "./paper-cover.css";

const tints = ["blue", "yellow", "green", "pink", "orange", "purple"] as const;
const cache = new Map<string, string>();
const pending = new Map<string, Promise<string>>();
let queue: Promise<unknown> = Promise.resolve();
let cacheGeneration = 0;

function tintFor(id: string) {
  let n = 0;
  for (const c of id) n = (n * 31 + c.charCodeAt(0)) >>> 0;
  return tints[n % tints.length];
}

// Covers are kept in IndexedDB so a returning visit shows them instantly instead
// of downloading and rendering every PDF again. Everything here is best-effort:
// private windows and blocked storage simply fall back to rendering.
const DB_NAME = "paper-covers";
const STORE = "covers";
const KEEP = 240;
let dbPromise: Promise<IDBDatabase | null> | null = null;
function openDb(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        request.result
          .createObjectStore(STORE, { keyPath: "key" })
          .createIndex("at", "at");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}
async function readCover(key: string): Promise<string> {
  const db = await openDb();
  if (!db) return "";
  return new Promise((resolve) => {
    try {
      const request = db.transaction(STORE).objectStore(STORE).get(key);
      request.onsuccess = () => resolve(request.result?.url || "");
      request.onerror = () => resolve("");
    } catch {
      resolve("");
    }
  });
}
async function writeCover(key: string, url: string, generation: number) {
  const db = await openDb();
  if (!db) return;
  if (generation !== cacheGeneration) {
    db.close();
    return;
  }
  try {
    const store = db.transaction(STORE, "readwrite").objectStore(STORE);
    store.put({ key, url, at: Date.now() });
    const total = store.count();
    total.onsuccess = () => {
      let extra = total.result - KEEP;
      if (extra <= 0) return;
      const cursor = store.index("at").openCursor();
      cursor.onsuccess = () => {
        const row = cursor.result;
        if (row && extra-- > 0) {
          row.delete();
          row.continue();
        }
      };
    };
  } catch {
    /* storage unavailable */
  }
}
/** Forget every stored cover, e.g. on sign-out so the next person sees none. */
export async function clearPaperCovers() {
  ++cacheGeneration;
  cache.clear();
  pending.clear();
  queue = Promise.resolve();
  const db = await openDb();
  if (!db) return;
  try {
    db.transaction(STORE, "readwrite").objectStore(STORE).clear();
  } catch {
    /* storage unavailable */
  }
}

// Render one first page at a time so a long library never floods the worker.
async function generate(
  paperId: string,
  versionId: string,
  key: string,
  generation: number,
) {
  if (generation !== cacheGeneration) throw new Error("obsolete cover");
  const files = await api<SourceFile[]>("/papers/" + paperId + "/files");
  const file =
    files.find(
      (f) => f.version_id === versionId && f.mime === "application/pdf",
    ) || files.find((f) => f.mime === "application/pdf");
  if (!file) throw new Error("no pdf");
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  const task = pdfjs.getDocument({
    url: "/api/v1/files/" + file.id + "/content",
    withCredentials: true,
    isEvalSupported: false,
    disableAutoFetch: true,
    disableStream: true,
    rangeChunkSize: 256 * 1024,
    cMapUrl: "/assets/pdfjs/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/assets/pdfjs/standard_fonts/",
    wasmUrl: "/assets/pdfjs/wasm/",
  });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 640 / base.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, viewport }).promise;
    const url = canvas.toDataURL("image/jpeg", 0.82);
    if (generation !== cacheGeneration) throw new Error("obsolete cover");
    cache.set(key, url);
    void writeCover(key, url, generation);
    return url;
  } finally {
    void task.destroy();
  }
}
function render(paperId: string, versionId: string): Promise<string> {
  const key = paperId + ":" + versionId;
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  const running = pending.get(key);
  if (running) return running;
  const generation = cacheGeneration;
  const job = readCover(key).then((stored) => {
    if (generation !== cacheGeneration) throw new Error("obsolete cover");
    if (stored) {
      cache.set(key, stored);
      return stored;
    }
    const work = queue.then(() =>
      generate(paperId, versionId, key, generation),
    );
    queue = work.catch(() => undefined);
    return work;
  });
  pending.set(key, job);
  job
    .finally(() => {
      if (pending.get(key) === job) pending.delete(key);
    })
    .catch(() => undefined);
  return job;
}

export function PaperCover({
  paperId,
  versionId,
  title,
  className = "",
}: {
  paperId: string;
  versionId: string;
  title: string;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const key = paperId + ":" + versionId;
  const [src, setSrc] = useState(() => cache.get(key) || "");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (src || failed || !versionId) return;
    const el = box.current;
    if (!el) return;
    let live = true;
    const start = () =>
      render(paperId, versionId)
        .then((url) => live && setSrc(url))
        .catch(() => live && setFailed(true));
    if (typeof IntersectionObserver === "undefined") {
      void start();
      return () => {
        live = false;
      };
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          void start();
        }
      },
      { rootMargin: "240px" },
    );
    io.observe(el);
    return () => {
      live = false;
      io.disconnect();
    };
  }, [paperId, versionId, src, failed]);
  return (
    <div
      ref={box}
      className={`paper-cover ${className}`}
      data-tint={tintFor(paperId)}
      data-ready={src ? "true" : "false"}
      aria-hidden="true"
    >
      {src ? (
        <img src={src} alt="" loading="lazy" draggable={false} />
      ) : (
        <span className="paper-cover-mark">
          {(title.trim()[0] || "纸").toUpperCase()}
        </span>
      )}
    </div>
  );
}
