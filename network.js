const STORY_AUTH_TOKEN_KEY = "StoryRewriteAuthToken";
const STORY_LEGACY_AUTH_TOKEN_KEY = "StoryRewriteSessionToken";
const STORY_SERVER_OVERRIDE_KEY = "StoryRewriteServerOverride";
const STORY_AUTH_VALIDATED_AT_KEY = "StoryRewriteAuthValidatedAt";
const STORY_AUTH_VALIDATION_WINDOW = 1000 * 60 * 10;
const STORY_LAST_PROFILE_KEY = "StoryRewriteLastProfileV1";
const STORY_LAST_SAVE_KEY = "StoryRewriteLastSaveV1";
const STORY_SAVE_GENERATION_KEY = "StoryRewriteSaveGenerationV1";
const STORY_CLIENT_SNAPSHOT_KEYS = [
    STORY_LAST_PROFILE_KEY,
    STORY_LAST_SAVE_KEY,
    "StoryRewriteMainPlayerSnapshotV2",
    "StoryRewriteAccountSnapshotV1"
];
const STORY_PROTECTED_PAGES = new Set([
    "main.html",
    "levels.html",
    "dialog.html",
    "multiplayer.html",
    "tutorial.html",
    "rules.html",
    "account.html"
]);

let AccountProfileRequestPromise = null;
let ServerSaveRequestPromise = null;

function ReadStoryLocalJson(Key) {
    try {
        const Value = JSON.parse(localStorage.getItem(Key) || "null");
        return Value && typeof Value === "object" ? Value : null;
    } catch {
        return null;
    }
}

function WriteStoryLocalJson(Key, Value) {
    try {
        if (Value === null || Value === undefined) localStorage.removeItem(Key);
        else localStorage.setItem(Key, JSON.stringify(Value));
    } catch {}
}

function GetLastKnownProfileResult() {
    return ReadStoryLocalJson(STORY_LAST_PROFILE_KEY);
}

function GetLastKnownServerSave() {
    return ReadStoryLocalJson(STORY_LAST_SAVE_KEY);
}

function StoreLastKnownProfileResult(Result) {
    if (Result?.profile) WriteStoryLocalJson(STORY_LAST_PROFILE_KEY, Result);
    return Result;
}

function ReadSaveGeneration() {
    return localStorage.getItem(STORY_SAVE_GENERATION_KEY) || "0";
}

function BeginSaveMutation() {
    const Generation = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(STORY_SAVE_GENERATION_KEY, Generation);
    return Generation;
}

function StoreLastKnownServerSave(Save, ExpectedGeneration = null) {
    if (ExpectedGeneration !== null && ReadSaveGeneration() !== ExpectedGeneration) return Save;
    if (Save && typeof Save === "object") WriteStoryLocalJson(STORY_LAST_SAVE_KEY, Save);
    return Save;
}

function ClearLastKnownStoryState() {
    for (const Key of STORY_CLIENT_SNAPSHOT_KEYS) localStorage.removeItem(Key);
}

function BuildStoryUrl(Page = "") {
    const CleanPage = String(Page || "").replace(/^\/+/, "");
    const BaseUrl = new URL(".", window.location.href);
    return new URL(CleanPage, BaseUrl).href;
}

function GetServerUrl() {
    const Configured = String(window.STORY_REWRITE_SERVER_URL || "").trim().replace(/\/$/, "");
    const Override = String(sessionStorage.getItem(STORY_SERVER_OVERRIDE_KEY) || "").trim().replace(/\/$/, "");

    if (Override) return Override;
    if (Configured) return Configured;

    if (location.protocol === "http:" || location.protocol === "https:") {
        if (!location.hostname.endsWith("github.io")) return location.origin;
    }

    return "";
}

function SetServerOverride(Value) {
    const Normalized = String(Value || "").trim().replace(/\/$/, "");
    if (Normalized) sessionStorage.setItem(STORY_SERVER_OVERRIDE_KEY, Normalized);
    else sessionStorage.removeItem(STORY_SERVER_OVERRIDE_KEY);
}

function GetAuthToken() {
    const Persistent = localStorage.getItem(STORY_AUTH_TOKEN_KEY) || "";
    if (Persistent) return Persistent;

    const LegacyPersistent = localStorage.getItem(STORY_LEGACY_AUTH_TOKEN_KEY) || "";
    if (LegacyPersistent) {
        localStorage.setItem(STORY_AUTH_TOKEN_KEY, LegacyPersistent);
        localStorage.removeItem(STORY_LEGACY_AUTH_TOKEN_KEY);
        return LegacyPersistent;
    }

    const LegacySession = sessionStorage.getItem(STORY_LEGACY_AUTH_TOKEN_KEY) || "";
    if (!LegacySession) return "";

    localStorage.setItem(STORY_AUTH_TOKEN_KEY, LegacySession);
    sessionStorage.removeItem(STORY_LEGACY_AUTH_TOKEN_KEY);
    return LegacySession;
}

function SetAuthToken(Token) {
    const PreviousToken = localStorage.getItem(STORY_AUTH_TOKEN_KEY) || "";

    if (Token) {
        if (PreviousToken && PreviousToken !== Token) ClearLastKnownStoryState();
        localStorage.setItem(STORY_AUTH_TOKEN_KEY, Token);
        localStorage.removeItem(STORY_LEGACY_AUTH_TOKEN_KEY);
        sessionStorage.removeItem(STORY_LEGACY_AUTH_TOKEN_KEY);
        return;
    }

    ClearLastKnownStoryState();
    localStorage.removeItem(STORY_AUTH_TOKEN_KEY);
    localStorage.removeItem(STORY_LEGACY_AUTH_TOKEN_KEY);
    sessionStorage.removeItem(STORY_LEGACY_AUTH_TOKEN_KEY);
    localStorage.removeItem(STORY_AUTH_VALIDATED_AT_KEY);
}

function MarkAuthValidated() {
    localStorage.setItem(STORY_AUTH_VALIDATED_AT_KEY, String(Date.now()));
}

function WasAuthRecentlyValidated() {
    const ValidatedAt = Number(localStorage.getItem(STORY_AUTH_VALIDATED_AT_KEY) || 0);
    return ValidatedAt > 0 && Date.now() - ValidatedAt < STORY_AUTH_VALIDATION_WINDOW;
}

function LogoutAccount() {
    SetAuthToken("");

    try {
        if (window.parent !== window && window.parent.StoryShell?.IsPersistentShell) {
            window.parent.StoryShell.Exit("auth.html", true);
            return;
        }
    } catch {}

    window.location.replace(BuildStoryUrl("auth.html"));
}

function GetCurrentPageName() {
    const Path = window.location.pathname || "";
    const Name = Path.split("/").pop();
    return Name || "index.html";
}

async function GuardProtectedPage() {
    if (!STORY_PROTECTED_PAGES.has(GetCurrentPageName())) return;

    if (!GetAuthToken()) {
        window.location.replace(BuildStoryUrl("auth.html"));
        return;
    }

    if (WasAuthRecentlyValidated()) return;

    try {
        await GetAccountProfile();
        MarkAuthValidated();
    } catch (Error) {
        if (Error?.status === 401) {
            SetAuthToken("");
            window.location.replace(BuildStoryUrl("auth.html"));
        }
    }
}

async function ApiRequest(Path, Options = {}) {
    const ServerUrl = GetServerUrl();
    if (!ServerUrl) {
        throw new Error("Multiplayer server is not configured yet. Run server.js locally or set the deployed server URL in server-config.js.");
    }

    const RequestHeaders = new window.Headers(Options.headers || {});
    if (!RequestHeaders.has("Content-Type") && Options.body !== undefined) RequestHeaders.set("Content-Type", "application/json");

    const Token = GetAuthToken();
    if (Token) RequestHeaders.set("Authorization", `Bearer ${Token}`);

    const Response = await fetch(`${ServerUrl}${Path}`, {
        ...Options,
        headers: RequestHeaders,
        cache: "no-store"
    });

    let Data = {};
    try {
        Data = await Response.json();
    } catch {}

    if (!Response.ok) {
        if (Response.status === 401) SetAuthToken("");
        const RequestError = new Error(Data.error || `Server request failed: ${Response.status}`);
        RequestError.status = Response.status;
        RequestError.data = Data;
        throw RequestError;
    }

    return Data;
}

async function RegisterAccount(Username, Password) {
    ClearLastKnownStoryState();
    const Result = await ApiRequest("/api/register", {
        method: "POST",
        body: JSON.stringify({ username: Username, password: Password })
    });
    SetAuthToken(Result.token);
    StoreLastKnownProfileResult(Result);
    if (Result?.save) StoreLastKnownServerSave(Result.save);
    MarkAuthValidated();
    return Result;
}

async function LoginAccount(Username, Password) {
    ClearLastKnownStoryState();
    const Result = await ApiRequest("/api/login", {
        method: "POST",
        body: JSON.stringify({ username: Username, password: Password })
    });
    SetAuthToken(Result.token);
    StoreLastKnownProfileResult(Result);
    if (Result?.save) StoreLastKnownServerSave(Result.save);
    MarkAuthValidated();
    return Result;
}

async function GetAccountProfile() {
    if (!AccountProfileRequestPromise) {
        AccountProfileRequestPromise = ApiRequest("/api/me")
            .then(StoreLastKnownProfileResult)
            .finally(() => {
                AccountProfileRequestPromise = null;
            });
    }

    return AccountProfileRequestPromise;
}

async function RequireAccount() {
    if (!GetAuthToken()) {
        window.location.replace(BuildStoryUrl("auth.html"));
        throw new Error("Sign in required.");
    }

    try {
        const Profile = await GetAccountProfile();
        MarkAuthValidated();
        return Profile;
    } catch (Error) {
        if (Error?.status === 401) window.location.replace(BuildStoryUrl("auth.html"));
        throw Error;
    }
}

async function FetchServerSave() {
    if (!ServerSaveRequestPromise) {
        const ExpectedGeneration = ReadSaveGeneration();
        const Request = ApiRequest("/api/save")
            .then(Result => StoreLastKnownServerSave(Result.save, ExpectedGeneration))
            .finally(() => {
                if (ServerSaveRequestPromise === Request) ServerSaveRequestPromise = null;
            });

        ServerSaveRequestPromise = Request;
    }

    return ServerSaveRequestPromise;
}

async function EnterServerStage(StageId) {
    const Result = await ApiRequest("/api/stage/enter", {
        method: "POST",
        body: JSON.stringify({ stageId: StageId })
    });
    return StoreLastKnownServerSave(Result.save);
}

async function CheckServerStage(StageId, RemovedIndexes, BranchId = "") {
    const Result = await ApiRequest("/api/stage/check", {
        method: "POST",
        body: JSON.stringify({ stageId: StageId, removedIndexes: RemovedIndexes, branchId: BranchId })
    });
    if (Result?.save) StoreLastKnownServerSave(Result.save);
    return Result;
}

async function SaveEquippedCosmetic(CosmeticId) {
    const Result = await ApiRequest("/api/cosmetics", {
        method: "POST",
        body: JSON.stringify({ cosmeticId: CosmeticId })
    });
    if (Result?.save) StoreLastKnownServerSave(Result.save);
    return Result?.save;
}

async function RestartServerChapter(WorldId) {
    const Result = await ApiRequest("/api/chapter/restart", {
        method: "POST",
        body: JSON.stringify({ worldId: WorldId })
    });
    return StoreLastKnownServerSave(Result.save);
}

async function ResetServerSave() {
    const Generation = BeginSaveMutation();
    ClearLastKnownStoryState();
    ServerSaveRequestPromise = null;

    const Result = await ApiRequest("/api/account/reset", { method: "POST" });
    return StoreLastKnownServerSave(Result.save, Generation);
}

async function DeleteAccount() {
    const Result = await ApiRequest("/api/account", { method: "DELETE" });
    if (Result?.ok) SetAuthToken("");
    return Result;
}

async function SaveAudioSettings(MusicVolume, SoundVolume) {
    const Result = await ApiRequest("/api/settings", {
        method: "POST",
        body: JSON.stringify({ musicVolume: MusicVolume, soundVolume: SoundVolume })
    });

    if (Result?.save) {
        StoreLastKnownServerSave(Result.save);
    } else {
        const LastSave = GetLastKnownServerSave();
        if (LastSave) {
            LastSave.settings = {
                ...(LastSave.settings || {}),
                musicVolume: MusicVolume,
                soundVolume: SoundVolume
            };
            StoreLastKnownServerSave(LastSave);
        }
    }

    return Result;
}

function ConnectStorySocket() {
    if (typeof io !== "function") throw new Error("Socket.IO client did not load.");
    const ServerUrl = GetServerUrl();
    if (!ServerUrl) throw new Error("Multiplayer server is not configured.");

    return io(ServerUrl, {
        auth: { token: GetAuthToken() },
        transports: ["websocket", "polling"]
    });
}

GuardProtectedPage();