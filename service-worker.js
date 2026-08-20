const STORY_CACHE = "story-rewrite-frontend-v26";
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

function BuildMusicCacheKey(FetchRequest) {
    return new Request(FetchRequest.url, { method: "GET" });
}

async function GetFullMusicResponse(FetchRequest) {
    const Cache = await caches.open(STORY_AUDIO_CACHE);
    const CacheKey = BuildMusicCacheKey(FetchRequest);
    const Cached = await Cache.match(CacheKey);
    if (Cached) return Cached;

    const NetworkRequest = new Request(FetchRequest.url, {
        method: "GET",
        credentials: FetchRequest.credentials,
        cache: "no-store"
    });

    const Response = await fetch(NetworkRequest);
    if (Response && Response.ok && Response.status === 200) {
        try { await Cache.put(CacheKey, Response.clone()); } catch {}
    }
    return Response;
}

function ParseByteRange(RangeHeader, Size) {
    const Match = /^bytes=(\d*)-(\d*)$/i.exec(String(RangeHeader || "").trim());
    if (!Match || Size <= 0) return null;

    const StartText = Match[1];
    const EndText = Match[2];
    let Start;
    let End;

    if (!StartText && !EndText) return null;

    if (!StartText) {
        const SuffixLength = Number(EndText);
        if (!Number.isFinite(SuffixLength) || SuffixLength <= 0) return null;
        Start = Math.max(0, Size - Math.floor(SuffixLength));
        End = Size - 1;
    } else {
        Start = Number(StartText);
        End = EndText ? Number(EndText) : Size - 1;
    }

    if (!Number.isFinite(Start) || !Number.isFinite(End)) return null;
    Start = Math.max(0, Math.floor(Start));
    End = Math.min(Size - 1, Math.floor(End));
    if (Start > End || Start >= Size) return null;

    return { Start, End };
}

async function MusicCacheFirst(FetchRequest) {
    const FullResponse = await GetFullMusicResponse(FetchRequest);
    if (!FullResponse) return FullResponse;

    const RangeHeader = FetchRequest.headers.get("Range");
    if (!RangeHeader || FullResponse.status !== 200) return FullResponse;

    const FullBlob = await FullResponse.clone().blob();
    const Range = ParseByteRange(RangeHeader, FullBlob.size);

    if (!Range) {
        return new Response(null, {
            status: 416,
            statusText: "Range Not Satisfiable",
            headers: {
                "Accept-Ranges": "bytes",
                "Content-Range": `bytes */${FullBlob.size}`
            }
        });
    }

    const Slice = FullBlob.slice(Range.Start, Range.End + 1, FullBlob.type || "audio/mpeg");
    const HeadersValue = new Headers(FullResponse.headers);
    HeadersValue.delete("Content-Encoding");
    HeadersValue.set("Accept-Ranges", "bytes");
    HeadersValue.set("Content-Range", `bytes ${Range.Start}-${Range.End}/${FullBlob.size}`);
    HeadersValue.set("Content-Length", String(Range.End - Range.Start + 1));
    if (!HeadersValue.get("Content-Type")) HeadersValue.set("Content-Type", "audio/mpeg");

    return new Response(Slice, {
        status: 206,
        statusText: "Partial Content",
        headers: HeadersValue
    });
}

self.addEventListener("fetch", Event => {
    const FetchRequest = Event.request;
    if (FetchRequest.method !== "GET") return;

    const Url = new URL(FetchRequest.url);
    if (Url.origin !== self.location.origin) return;

    if (IsBundledMusicRequest(Url)) {
        Event.respondWith(MusicCacheFirst(FetchRequest));
        return;
    }

    if (IsCriticalCodeRequest(FetchRequest, Url)) {
        const CacheKey = NormalizeNavigationKey(FetchRequest);
        Event.respondWith(NetworkFirst(FetchRequest, CacheKey));
        return;
    }

    Event.respondWith(CacheFirst(FetchRequest));
});
