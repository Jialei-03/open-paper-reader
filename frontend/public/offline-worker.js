/*
 * Offline reading was removed. Browsers that installed its worker still ask for
 * this file now and then; this version deletes the app cache it made and
 * unregisters itself, so pages load straight from the network again.
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys())
        if (name.startsWith("zhijian-offline-shell-"))
          await caches.delete(name);
      await self.registration.unregister();
    })(),
  ),
);
