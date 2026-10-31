(() => {
    "use strict";

    const AuthKey = "StoryRewriteAuthToken";
    const LegacyKey = "StoryRewriteSessionToken";
    const LegacyAccountsKey = "StoryRewriteSavedAccountsV1";
    const SavedNamesKey = "StoryRewriteSavedAccountNamesV1";
    const SessionMarkerKey = "StoryRewriteCookieSessionActiveV1";
    const ProfileKey = "StoryRewriteLastProfileV1";
    const ValidatedAtKey = "StoryRewriteAuthValidatedAt";

    function ReadJson(Key) {
        try {
            const Value = JSON.parse(localStorage.getItem(Key) || "null");
            return Value && typeof Value === "object" ? Value : null;
        } catch {
            return null;
        }
    }

    // Keep a very recent, previously validated browser session available when
    // the Render cold start/network temporarily fails. A real 401 still signs
    // the browser out; only transport/server unavailability can use this grace.
    const PreviousSessionMarker = (() => {
        try { return localStorage.getItem(SessionMarkerKey) === "1"; } catch { return false; }
    })();
    const PreviousValidatedAt = (() => {
        try { return Number(localStorage.getItem(ValidatedAtKey) || 0); } catch { return 0; }
    })();
    const PreviousProfile = ReadJson(ProfileKey)?.profile || null;

    function SaveSafeAccountNames() {
        const Existing = ReadJson(SavedNamesKey);
        const Legacy = ReadJson(LegacyAccountsKey);
        const Values = [
            ...(Array.isArray(Existing?.accounts) ? Existing.accounts : []),
            ...(Array.isArray(Legacy?.accounts) ? Legacy.accounts : [])
        ];
        const Seen = new Set();
        const Accounts = [];
        for (const Entry of Values) {
            const Username = String(Entry?.username || "").trim();
            const Key = Username.toLowerCase();
            if (!Username || Seen.has(Key)) continue;
            Seen.add(Key);
            Accounts.push({ username: Username, lastUsedAt: Number(Entry?.lastUsedAt || 0) });
            if (Accounts.length >= 8) break;
        }
        try {
            localStorage.setItem(SavedNamesKey, JSON.stringify({ accounts: Accounts }));
        } catch {}
    }

    let LegacyToken = "";
    try {
        LegacyToken = localStorage.getItem(AuthKey)
            || localStorage.getItem(LegacyKey)
            || sessionStorage.getItem(LegacyKey)
            || "";
    } catch {}

    // Keep account names only. Delete all old JS-readable bearer-token storage before
    // any network request or app code can run.
    SaveSafeAccountNames();
    try {
        localStorage.removeItem(AuthKey);
        localStorage.removeItem(LegacyKey);
        sessionStorage.removeItem(LegacyKey);
        localStorage.removeItem(LegacyAccountsKey);
        localStorage.removeItem(SessionMarkerKey);
    } catch {}

    async function ReadResponse(Response) {
        let Data = {};
        try { Data = await Response.json(); } catch {}
        return { Response, Data };
    }

    async function FetchResponseWithTimeout(Url, Options) {
        const Controller = new AbortController();
        const Timeout = window.setTimeout(() => Controller.abort(), 20000);
        try {
            const Response = await fetch(Url, { ...Options, signal: Controller.signal });
            return await ReadResponse(Response);
        } finally {
            window.clearTimeout(Timeout);
        }
    }

    async function FetchSession() {
        const Server = String(window.STORY_REWRITE_SERVER_URL || "").trim().replace(/\/+$/, "");
        if (!Server) return { authenticated: false, unavailable: true };

        try {
            const ExistingResult = await FetchResponseWithTimeout(Server + "/api/me", {
                method: "GET",
                credentials: "include",
                cache: "no-store"
            });
            if (ExistingResult.Response.ok) {
                return CompleteSession(ExistingResult.Data);
            }
            if (ExistingResult.Response.status !== 401) {
                return { authenticated: false, unavailable: true, status: ExistingResult.Response.status };
            }

            if (!LegacyToken) {
                return { authenticated: false };
            }

            const MigratedResult = await FetchResponseWithTimeout(Server + "/api/session/migrate", {
                method: "POST",
                credentials: "include",
                cache: "no-store",
                headers: {
                    "Authorization": "Bearer " + LegacyToken,
                    "Content-Type": "application/json"
                },
                body: "{}"
            });
            if (!MigratedResult.Response.ok) {
                return {
                    authenticated: false,
                    unavailable: MigratedResult.Response.status >= 500,
                    status: MigratedResult.Response.status
                };
            }
            return CompleteSession(MigratedResult.Data);
        } catch {
            return { authenticated: false, unavailable: true };
        }
    }

    async function FetchSessionWithRetry() {
        let Result = await FetchSession();
        if (Result.authenticated || !Result.unavailable) return Result;

        // GitHub Pages reaches the backend cross-origin, so its first request
        // can hit a sleeping Render instance. Retry once before deciding.
        await new Promise(Resolve => window.setTimeout(Resolve, 1200));
        Result = await FetchSession();
        if (Result.authenticated || !Result.unavailable) return Result;

        const PreviousSessionIsFresh = PreviousSessionMarker
            && PreviousProfile?.username
            && PreviousValidatedAt > 0
            && Date.now() - PreviousValidatedAt < 10 * 60 * 1000;
        if (PreviousSessionIsFresh) {
            try { localStorage.setItem(SessionMarkerKey, "1"); } catch {}
            return { authenticated: true, profile: PreviousProfile, stale: true };
        }

        return Result;
    }

    function CompleteSession(Data) {
        const Profile = Data?.profile || null;
        if (!Profile?.username) return { authenticated: false, unavailable: true };
        try {
            localStorage.setItem(SessionMarkerKey, "1");
            localStorage.setItem(ValidatedAtKey, String(Date.now()));
            localStorage.setItem(ProfileKey, JSON.stringify({ profile: Profile }));
        } catch {}
        return { authenticated: true, profile: Profile };
    }

    window.StoryCookieSessionReady = FetchSessionWithRetry();
})();