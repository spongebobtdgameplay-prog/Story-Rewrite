self.addEventListener("install", Event => {
    Event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", Event => {
    Event.waitUntil((async () => {
        const CacheNames = await caches.keys();
        await Promise.all(CacheNames
            .filter(CacheName => CacheName.startsWith("story-rewrite-"))
            .map(CacheName => caches.delete(CacheName)));
        await self.clients.claim();
        await self.registration.unregister();
    })());
});
