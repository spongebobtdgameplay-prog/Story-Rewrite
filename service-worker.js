const STORY_CACHE = "story-rewrite-frontend-v27";
const STORY_AUDIO_CACHE = "story-rewrite-music-v1";

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
    "./scene-fix.css",
    "./multiplayer.css",
    "./shell-ui.css",
    "./mobile-controls.css",
    "./host-controls.css",
    "./chat-ai.css",
    "./tutorial.css",
    "./game-enhancements.css",
    "./server-config.js",
    "./network.js",
    "./app.js",
    "./audio.js",
    "./audio-enhancements.js",
    "./real-audio.js",
    "./shell.js",
    "./auth.js",
    "./main.js",
    "./levels.js",
    "./dialog.js",
    "./dialog-connection.js",
    "./game-enhancements.js",
    "./mobile-controls.js",
    "./multiplayer.js",
    "./multiplayer-connection.js",
    "./moderation-version.js",
    "./host-controls.js",
    "./ai-chat.js",
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

function IsCriticalCodeRequest(FetchRequest, Url) {
    if (FetchRequest.mode === "navigate") return true;
    if (FetchRequest.destination === "script" || FetchRequest.destination === "style") return true;
    return Url.pathname.endsWith(".json");
}

function IsBundledMusicRequest(Url) {
    return /\/Music\/[^/]+\.mp3$/i.test(Url.pathname);
}

function NormalizeNavigationKey(FetchRequest) {
    if (FetchRequest.mode !== "navigate") return FetchRequest;
    const Url = new URL(FetchRequest.url);
    return new Request(`${Url.origin}${Url.pathname}`);
}

async function PutSuccessfulResponse(Key, Response, CacheName = STORY_CACHE) {
    if (!Response || !Response.ok) return;
    const Cache = await caches.open(CacheName);
    await Cache.put(Key, Response.clone());
}

async function NetworkFirst(FetchRequest, CacheKey) {
    try {
        const Response = await fetch(FetchRequest, { cache: "no-store" });
        await PutSuccessfulResponse(CacheKey, Response);
        return Response;
    } catch (Error) {
        const Cached = await caches.match(CacheKey);
        if (Cached) return Cached;
        throw Error;
    }
}

async function CacheFirst(FetchRequest, CacheName = STORY_CACHE) {
    const Cache = await caches.open(CacheName);
    const Cached = await Cache.match(FetchRequest);
    if (Cached) return Cached;

    const Response = await fetch(FetchRequest);
    if (Response && Response.ok) await Cache.put(FetchRequest, Response.clone());
    return Response;
}

async function PrepareMusicResponse(FetchRequest) {
    const Cache = await caches.open(STORY_AUDIO_CACHE);
    const CacheKey = new Request(FetchRequest.url, { method: "GET" });
    const Cached = await Cache.match(CacheKey);

    if (Cached) {
        return {
            response: Cached,
            cacheTask: Promise.resolve()
        };
    }

    const Response = await fetch(FetchRequest);
    let CacheTask = Promise.resolve();

    if (Response && Response.ok && Response.status === 200) {
        CacheTask = Cache.put(CacheKey, Response.clone());
    } else if (Response && Response.status === 206) {
        const FullRequest = new Request(FetchRequest.url, {
            method: "GET",
            credentials: FetchRequest.credentials,
            mode: "same-origin",
            cache: "reload"
        });

        CacheTask = fetch(FullRequest)
            .then(FullResponse => {
                if (!FullResponse || !FullResponse.ok || FullResponse.status !== 200) return;
                return Cache.put(CacheKey, FullResponse.clone());
            });
    }

    return { response: Response, cacheTask: CacheTask };
}

self.addEventListener("fetch", Event => {
    const FetchRequest = Event.request;
    if (FetchRequest.method !== "GET") return;

    const Url = new URL(FetchRequest.url);
    if (Url.origin !== self.location.origin) return;

    if (IsBundledMusicRequest(Url)) {
        const Prepared = PrepareMusicResponse(FetchRequest);
        Event.respondWith(Prepared.then(Result => Result.response));
        Event.waitUntil(Prepared.then(Result => Result.cacheTask).catch(() => {}));
        return;
    }

    if (IsCriticalCodeRequest(FetchRequest, Url)) {
        const CacheKey = NormalizeNavigationKey(FetchRequest);
        Event.respondWith(NetworkFirst(FetchRequest, CacheKey));
        return;
    }

    Event.respondWith(CacheFirst(FetchRequest));
});
