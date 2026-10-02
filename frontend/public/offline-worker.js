/* Only app resources are cached here. Private papers and notes live in IndexedDB. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
const prefix = "zhijian-offline-shell-";
let preparing;
async function prepare(port) {
  const response = await fetch("/assets/offline-manifest.json", {
    cache: "no-store",
  });
  if (!response.ok) throw new Error("离线资源清单获取失败");
  const manifest = await response.json();
  const cache = await caches.open(prefix + manifest.version);
  const urls = ["/", ...manifest.files];
  let completed = 0;
  let cursor = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (cursor < urls.length) {
        const url = urls[cursor++];
        if (!(await cache.match(url))) {
          const resource = await fetch(url, { cache: "reload" });
          if (!resource.ok) throw new Error("离线资源下载失败，请联网重试");
          await cache.put(url, resource);
        }
        port.postMessage({ completed: ++completed, total: urls.length });
      }
    }),
  );
  await cache.put("/__offline_ready__", new Response("ready"));
  // Retain one previous shell for an open tab; private data is not in these caches.
  const names = (await caches.keys()).filter(
    (name) => name.startsWith(prefix) && name !== prefix + manifest.version,
  );
  for (const name of names.slice(0, Math.max(0, names.length - 1)))
    await caches.delete(name);
}
self.addEventListener("message", (event) => {
  if (event.data?.type !== "PREPARE" || !event.ports[0]) return;
  const port = event.ports[0];
  event.waitUntil(
    (async () => {
      try {
        if (preparing) await preparing;
        preparing = prepare(port);
        await preparing;
        port.postMessage({ done: true });
      } catch (error) {
        port.postMessage({ error: String(error.message || error) });
      } finally {
        preparing = undefined;
      }
    })(),
  );
});
async function readyMatch(url) {
  for (const name of (await caches.keys())
    .filter((name) => name.startsWith(prefix))
    .reverse()) {
    const cache = await caches.open(name);
    if (await cache.match("/__offline_ready__")) {
      const result = await cache.match(url);
      if (result) return result;
    }
  }
}
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/")
  )
    return;
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(
        async () => (await readyMatch("/")) || Response.error(),
      ),
    );
  } else if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      (async () =>
        (await readyMatch(event.request.url)) || fetch(event.request))(),
    );
  }
});
