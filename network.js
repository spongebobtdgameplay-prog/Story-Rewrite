const STORY_AUTH_TOKEN_KEY = "StoryRewriteSessionToken";
const STORY_SERVER_OVERRIDE_KEY = "StoryRewriteServerOverride";

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
    return sessionStorage.getItem(STORY_AUTH_TOKEN_KEY) || "";
}

function SetAuthToken(Token) {
    if (Token) sessionStorage.setItem(STORY_AUTH_TOKEN_KEY, Token);
    else sessionStorage.removeItem(STORY_AUTH_TOKEN_KEY);
}

function LogoutAccount() {
    SetAuthToken("");
    window.location.href = "auth.html";
}

async function ApiRequest(Path, Options = {}) {
    const ServerUrl = GetServerUrl();
    if (!ServerUrl) {
        throw new Error("Multiplayer server is not configured yet. Run server.js locally or set the deployed server URL in server-config.js.");
    }

    const Headers = new Headers(Options.headers || {});
    if (!Headers.has("Content-Type") && Options.body !== undefined) Headers.set("Content-Type", "application/json");

    const Token = GetAuthToken();
    if (Token) Headers.set("Authorization", `Bearer ${Token}`);

    const Response = await fetch(`${ServerUrl}${Path}`, {
        ...Options,
        headers: Headers,
        cache: "no-store"
    });

    let Data = {};
    try {
        Data = await Response.json();
    } catch {}

    if (!Response.ok) {
        if (Response.status === 401) SetAuthToken("");
        throw new Error(Data.error || `Server request failed: ${Response.status}`);
    }

    return Data;
}

async function RegisterAccount(Username, Password) {
    const Result = await ApiRequest("/api/register", {
        method: "POST",
        body: JSON.stringify({ username: Username, password: Password })
    });
    SetAuthToken(Result.token);
    return Result;
}

async function LoginAccount(Username, Password) {
    const Result = await ApiRequest("/api/login", {
        method: "POST",
        body: JSON.stringify({ username: Username, password: Password })
    });
    SetAuthToken(Result.token);
    return Result;
}

async function GetAccountProfile() {
    return ApiRequest("/api/me");
}

async function RequireAccount() {
    if (!GetAuthToken()) {
        window.location.replace("auth.html");
        throw new Error("Sign in required.");
    }

    try {
        return await GetAccountProfile();
    } catch (Error) {
        window.location.replace("auth.html");
        throw Error;
    }
}

async function FetchServerSave() {
    const Result = await ApiRequest("/api/save");
    return Result.save;
}

async function EnterServerStage(StageId) {
    const Result = await ApiRequest("/api/stage/enter", {
        method: "POST",
        body: JSON.stringify({ stageId: StageId })
    });
    return Result.save;
}

async function CheckServerStage(StageId, RemovedIndexes) {
    return ApiRequest("/api/stage/check", {
        method: "POST",
        body: JSON.stringify({ stageId: StageId, removedIndexes: RemovedIndexes })
    });
}

async function RestartServerChapter(WorldId) {
    const Result = await ApiRequest("/api/chapter/restart", {
        method: "POST",
        body: JSON.stringify({ worldId: WorldId })
    });
    return Result.save;
}

async function ResetServerSave() {
    const Result = await ApiRequest("/api/account/reset", { method: "POST" });
    return Result.save;
}

async function SaveAudioSettings(MusicVolume, SoundVolume) {
    return ApiRequest("/api/settings", {
        method: "POST",
        body: JSON.stringify({ musicVolume: MusicVolume, soundVolume: SoundVolume })
    });
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
