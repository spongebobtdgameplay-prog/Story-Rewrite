self.addEventListener("install", Event => {
    Event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", Event => {
    Event.waitUntil((async () => {
        const Keys = await caches.keys();
        await Promise.all(Keys
            .filter(Key => Key.startsWith("story-rewrite-"))
            .map(Key => caches.delete(Key)));
        await self.clients.claim();
    })());
});
