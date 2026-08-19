const STORY_CACHE = "story-rewrite-frontend-v6";

const STORY_STATIC_FILES = [
    "./",
    "./index.html",
    "./auth.html",
    "./main.html",
    "./levels.html",
    "./dialog.html",
    "./multiplayer.html",
    "./tutorial.html",
    "./rules.html",
    "./account.html",
    "./looks.css",
    "./game-ui.css",
    "./multiplayer.css",
    "./shell-ui.css",
    "./server-config.js",
    "./network.js",
    "./app.js",
    "./audio.js",
    "./shell-ui.js",
    "./auth.js",
    "./main.js",
    "./levels.js",
    "./dialog.js",
    "./multiplayer.js",
    "./tutorial.js",
    "./account.js",
    "./stages.json",
    "./favicon_io/favicon.ico",
    "./favicon_io/favicon-32x32.png",
    "./favicon_io/favicon-16x16.png",
    "./favicon_io/apple-touch-icon.png",
    "./favicon_io/site.webmanifest"
];

self.addEventListener("install", Event => {
    Event.waitUntil(
        caches.open(STORY_CACHE)
            .then(Cache => Cache.addAll(STORY_STATIC_FILES))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", Event => {
    Event.waitUntil(
        caches.keys()
            .then(Keys => Promise.all(Keys
                .filter(Key => Key.startsWith("story-rewrite-frontend-") && Key !== STORY_CACHE)
                .map(Key => caches.delete(Key))))
            .then(() => self.clients.claim())
    );
});

function GetCacheKey(Request) {
    if (Request.mode !== "navigate") return Request;
    const Url = new URL(Request.url);
    return new Request(`${Url.origin}${Url.pathname}`);
}

self.addEventListener("fetch", Event => {
    const Request = Event.request;
    if (Request.method !== "GET") return;

    const Url = new URL(Request.url);
    if (Url.origin !== self.location.origin) return;

    const CacheKey = GetCacheKey(Request);

    Event.respondWith(
        caches.match(CacheKey).then(Cached => {
            const Refresh = fetch(Request)
                .then(Response => {
                    if (Response && Response.ok) {
                        const Copy = Response.clone();
                        caches.open(STORY_CACHE).then(Cache => Cache.put(CacheKey, Copy));
                    }
                    return Response;
                })
                .catch(() => Cached);

            return Cached || Refresh;
        })
    );
});
