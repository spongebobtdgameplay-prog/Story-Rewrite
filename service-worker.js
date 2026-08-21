self.addEventListener("install", Event => {
    Event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", Event => {
    Event.waitUntil((async () => {
        const CacheNames = await caches.keys();
        await Promise.all(CacheNames.map(CacheName => caches.delete(CacheName)));
        await self.clients.claim();
    })());
});
