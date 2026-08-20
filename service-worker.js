const STORY_CACHE = "story-rewrite-frontend-v22";
const STORY_AUDIO_CACHE = "story-rewrite-audio-v1";

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
    "./shell-ui.js",
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

function IsStoryMusicRequest(Url) {
    return /\/music\/[^/]+\.(?:mp3|ogg|wav|m4a)$/i.test(Url.pathname);
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

async function CacheFirst(FetchRequest) {
    const Cached = await caches.match(FetchRequest);
    if (Cached) return Cached;

    const Response = await fetch(FetchRequest);
    await PutSuccessfulResponse(FetchRequest, Response);
    return Response;
}

function BuildFullAudioRequest(AudioRequest) {
    const AudioHeaders = new Headers(AudioRequest.headers);
    AudioHeaders.delete("range");
    return new Request(AudioRequest.url, {
        method: "GET",
        headers: AudioHeaders,
        mode: AudioRequest.mode,
        credentials: AudioRequest.credentials,
        cache: "no-store",
        redirect: AudioRequest.redirect,
        referrer: AudioRequest.referrer,
        referrerPolicy: AudioRequest.referrerPolicy,
        integrity: AudioRequest.integrity
    });
}

function ParseSingleByteRange(RangeHeader, TotalSize) {
    const Match = /^bytes=(\d*)-(\d*)$/i.exec(String(RangeHeader || "").trim());
    if (!Match || !TotalSize) return null;

    let Start;
    let End;

    if (Match[1] === "" && Match[2] !== "") {
        const SuffixLength = Number(Match[2]);
        if (!Number.isFinite(SuffixLength) || SuffixLength <= 0) return null;
        Start = Math.max(0, TotalSize - SuffixLength);
        End = TotalSize - 1;
    } else {
        Start = Number(Match[1]);
        End = Match[2] === "" ? TotalSize - 1 : Number(Match[2]);
    }

    if (!Number.isFinite(Start) || !Number.isFinite(End)) return null;
    Start = Math.max(0, Math.floor(Start));
    End = Math.min(TotalSize - 1, Math.floor(End));
    if (Start > End || Start >= TotalSize) return null;

    return { Start, End };
}

async function BuildRangeResponse(Response, RangeHeader) {
    const Buffer = await Response.arrayBuffer();
    const Range = ParseSingleByteRange(RangeHeader, Buffer.byteLength);
    if (!Range) {
        return new Response(null, {
            status: 416,
            headers: { "Content-Range": `bytes */${Buffer.byteLength}` }
        });
    }

    const RangeHeaders = new Headers(Response.headers);
    RangeHeaders.set("Accept-Ranges", "bytes");
    RangeHeaders.set("Content-Range", `bytes ${Range.Start}-${Range.End}/${Buffer.byteLength}`);
    RangeHeaders.set("Content-Length", String(Range.End - Range.Start + 1));

    return new Response(Buffer.slice(Range.Start, Range.End + 1), {
        status: 206,
        statusText: "Partial Content",
        headers: RangeHeaders
    });
}

async function GetCachedStoryMusic(AudioRequest) {
    const Cache = await caches.open(STORY_AUDIO_CACHE);
    const CacheKey = new Request(AudioRequest.url, { method: "GET" });
    let FullResponse = await Cache.match(CacheKey);

    if (!FullResponse) {
        const NetworkRequest = BuildFullAudioRequest(AudioRequest);
        const NetworkResponse = await fetch(NetworkRequest);
        if (!NetworkResponse.ok) return NetworkResponse;
        await Cache.put(CacheKey, NetworkResponse.clone());
        FullResponse = NetworkResponse;
    }

    const RangeHeader = AudioRequest.headers.get("range");
    if (RangeHeader) return BuildRangeResponse(FullResponse.clone(), RangeHeader);
    return FullResponse;
}

self.addEventListener("fetch", Event => {
    const FetchRequest = Event.request;
    if (FetchRequest.method !== "GET") return;

    const Url = new URL(FetchRequest.url);
    if (Url.origin !== self.location.origin) return;

    if (IsStoryMusicRequest(Url)) {
        Event.respondWith(GetCachedStoryMusic(FetchRequest));
        return;
    }

    if (IsCriticalCodeRequest(FetchRequest, Url)) {
        const CacheKey = NormalizeNavigationKey(FetchRequest);
        Event.respondWith(NetworkFirst(FetchRequest, CacheKey));
        return;
    }

    Event.respondWith(CacheFirst(FetchRequest));
});
