const STORY_AUTH_TOKEN_KEY = "StoryRewriteAuthToken";
const STORY_LEGACY_AUTH_TOKEN_KEY = "StoryRewriteSessionToken";
const STORY_SERVER_OVERRIDE_KEY = "StoryRewriteServerOverride";
const STORY_AUTH_VALIDATED_AT_KEY = "StoryRewriteAuthValidatedAt";
const STORY_AUTH_VALIDATION_WINDOW = 1000 * 60 * 10;
const STORY_LAST_PROFILE_KEY = "StoryRewriteLastProfileV1";
const STORY_LAST_SAVE_KEY = "StoryRewriteLastSaveV1";
const STORY_SAVE_GENERATION_KEY = "StoryRewriteSaveGenerationV1";
const STORY_SAVED_ACCOUNTS_KEY = "StoryRewriteSavedAccountsV1";
const STORY_SESSION_EVENT_KEY = "StoryRewriteSessionEventV1";
const STORY_TAB_ID_KEY = "StoryRewriteTabIdV1";
const STORY_SWITCH_FROM_USERNAME_KEY = "StoryRewriteSwitchFromUsernameV1";
const STORY_SESSION_CHANNEL_NAME = "StoryRewriteSessionChannelV1";
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
let StorySessionChannel = null;
let StoryTabAuthToken = "";
let StorySessionRedirecting = false;

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

function GetStoryTabId() {
    let TabId = sessionStorage.getItem(STORY_TAB_ID_KEY) || "";
    if (!TabId) {
        TabId = typeof crypto?.randomUUID === "function"
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
        sessionStorage.setItem(STORY_TAB_ID_KEY, TabId);
    }
    return TabId;
}

function HashStorySessionValue(Value) {
    let Hash = 2166136261;
    const Text = String(Value || "");
    for (let Index = 0; Index < Text.length; Index += 1) {
        Hash ^= Text.charCodeAt(Index);
        Hash = Math.imul(Hash, 16777619);
    }
    return (Hash >>> 0).toString(36);
}

function GetStoryDeviceSignature() {
    const ScreenWidth = Number(window.screen?.width || 0);
    const ScreenHeight = Number(window.screen?.height || 0);
    const ScreenSize = [Math.min(ScreenWidth, ScreenHeight), Math.max(ScreenWidth, ScreenHeight)].join("x");
    const Parts = [
        String(navigator.platform || "unknown").toLowerCase(),
        String(navigator.language || "").toLowerCase(),
        String(Intl.DateTimeFormat().resolvedOptions().timeZone || ""),
        ScreenSize,
        String(window.screen?.colorDepth || 0),
        String(navigator.hardwareConcurrency || 0),
        String(navigator.maxTouchPoints || 0)
    ];
    return `device-${HashStorySessionValue(Parts.join("|"))}`;
}

function GetSavedAccountSessions() {
    const Value = ReadStoryLocalJson(STORY_SAVED_ACCOUNTS_KEY);
    const Accounts = Array.isArray(Value?.accounts) ? Value.accounts : [];
    return Accounts
        .filter(Account => Account && typeof Account.username === "string" && typeof Account.token === "string" && Account.token)
        .sort((First, Second) => Number(Second.lastUsedAt || 0) - Number(First.lastUsedAt || 0));
}

function SaveSavedAccountSessions(Accounts) {
    WriteStoryLocalJson(STORY_SAVED_ACCOUNTS_KEY, {
        accounts: Accounts.slice(0, 8)
    });
}

function RememberAccountSession(Result) {
    const Username = String(Result?.profile?.username || "").trim();
    const Token = String(Result?.token || GetAuthToken() || "");
    if (!Username || !Token) return;

    const Accounts = GetSavedAccountSessions().filter(Account => Account.username.toLowerCase() !== Username.toLowerCase());
    Accounts.unshift({
        username: Username,
        token: Token,
        lastUsedAt: Date.now()
    });
    SaveSavedAccountSessions(Accounts);
}

function ForgetSavedAccount(Username) {
    const Key = String(Username || "").trim().toLowerCase();
    if (!Key) return;
    SaveSavedAccountSessions(GetSavedAccountSessions().filter(Account => Account.username.toLowerCase() !== Key));
}

function ShowOtherSessionFound(Username = "") {
    if (StorySessionRedirecting) return;
    StorySessionRedirecting = true;

    const Overlay = document.createElement("div");
    Overlay.setAttribute("role", "status");
    Overlay.style.position = "fixed";
    Overlay.style.inset = "0";
    Overlay.style.zIndex = "2147483647";
    Overlay.style.display = "grid";
    Overlay.style.placeItems = "center";
    Overlay.style.background = "rgba(5, 8, 14, 0.88)";
    Overlay.style.backdropFilter = "blur(8px)";
    Overlay.innerHTML = `<div style="max-width:420px;margin:24px;padding:24px 26px;border-radius:18px;background:#111827;color:#fff;font:600 16px/1.45 system-ui,sans-serif;box-shadow:0 24px 80px rgba(0,0,0,.45);text-align:center"><div style="font-size:21px;margin-bottom:7px">Other Session found</div><div style="font-weight:400;opacity:.82">${Username ? `This tab is switching to ${String(Username).replace(/[<>&"']/g, "")}.` : "Your account session changed in another tab."}</div></div>`;
    document.documentElement.appendChild(Overlay);

    setTimeout(() => {
        const Token = GetAuthToken();
        if (!Token) {
            window.location.replace(BuildStoryUrl("auth.html"));
            return;
        }

        const Page = GetCurrentPageName();
        if (Page === "multiplayer.html" || Page === "dialog.html") {
            window.location.replace(BuildStoryUrl("main.html"));
            return;
        }

        if (Page === "auth.html" || Page === "index.html") {
            window.location.replace(BuildStoryUrl("index.html"));
            return;
        }

        window.location.reload();
    }, 850);
}

function BroadcastStorySession(Username = "") {
    const Message = {
        type: "auth-change",
        sourceTabId: GetStoryTabId(),
        token: GetAuthToken(),
        username: String(Username || ""),
        sentAt: Date.now()
    };

    try { StorySessionChannel?.postMessage(Message); } catch {}
    try { localStorage.setItem(STORY_SESSION_EVENT_KEY, JSON.stringify(Message)); } catch {}
}

function HandleStorySessionMessage(Message) {
    if (!Message || Message.type !== "auth-change") return;
    if (Message.sourceTabId === GetStoryTabId()) return;

    const IncomingToken = String(Message.token || "");
    if (IncomingToken === StoryTabAuthToken) return;

    StoryTabAuthToken = IncomingToken;
    ShowOtherSessionFound(Message.username || "");
}

function InitializeStorySessionSync() {
    StoryTabAuthToken = GetAuthToken();

    if (typeof BroadcastChannel === "function") {
        try {
            StorySessionChannel = new BroadcastChannel(STORY_SESSION_CHANNEL_NAME);
            StorySessionChannel.addEventListener("message", Event => HandleStorySessionMessage(Event.data));
        } catch {
            StorySessionChannel = null;
        }
    }

    window.addEventListener("storage", Event => {
        if (Event.key !== STORY_SESSION_EVENT_KEY || !Event.newValue) return;
        try {
            HandleStorySessionMessage(JSON.parse(Event.newValue));
        } catch {}
    });
}

function StopStoryMusicForSignedOutState() {
    try {
        if (typeof StoryAudio !== "undefined" && typeof StoryAudio.StopMusic === "function") {
            StoryAudio.StopMusic();
        }
    } catch {}

    try {
        if (window.parent !== window && window.parent.StoryShell?.IsPersistentShell) {
            window.parent.StoryShell.StopMusic();
        }
    } catch {}
}

function DispatchStoryAuthState(Authenticated) {
    try {
        window.dispatchEvent(new CustomEvent("StoryAuthStateChange", {
            detail: { authenticated: Boolean(Authenticated) }
        }));
    } catch {}
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

function GetAccountSwitchSourceUsername() {
    return String(sessionStorage.getItem(STORY_SWITCH_FROM_USERNAME_KEY) || "").trim();
}

function ClearAccountSwitchSource() {
    sessionStorage.removeItem(STORY_SWITCH_FROM_USERNAME_KEY);
}

function BeginAccountSwitch(Username) {
    const SwitchFromUsername = String(Username || "").trim();
    if (SwitchFromUsername) {
        sessionStorage.setItem(STORY_SWITCH_FROM_USERNAME_KEY, SwitchFromUsername);
    } else {
        ClearAccountSwitchSource();
    }

    StopStoryMusicForSignedOutState();
    SetAuthToken("");
    BroadcastStorySession("");

    try {
        if (window.parent !== window && window.parent.StoryShell?.IsPersistentShell) {
            window.parent.StoryShell.Exit("auth.html", true);
            return;
        }
    } catch {}

    window.location.replace(BuildStoryUrl("auth.html"));
}

function SetAuthToken(Token) {
    const PreviousToken = localStorage.getItem(STORY_AUTH_TOKEN_KEY) || "";

    if (Token) {
        if (PreviousToken && PreviousToken !== Token) ClearLastKnownStoryState();
        localStorage.setItem(STORY_AUTH_TOKEN_KEY, Token);
        localStorage.removeItem(STORY_LEGACY_AUTH_TOKEN_KEY);
        sessionStorage.removeItem(STORY_LEGACY_AUTH_TOKEN_KEY);
        ClearAccountSwitchSource();
        StoryTabAuthToken = String(Token);
        DispatchStoryAuthState(true);
        return;
    }

    StopStoryMusicForSignedOutState();
    ClearLastKnownStoryState();
    localStorage.removeItem(STORY_AUTH_TOKEN_KEY);
    localStorage.removeItem(STORY_LEGACY_AUTH_TOKEN_KEY);
    sessionStorage.removeItem(STORY_LEGACY_AUTH_TOKEN_KEY);
    localStorage.removeItem(STORY_AUTH_VALIDATED_AT_KEY);
    StoryTabAuthToken = "";
    DispatchStoryAuthState(false);
}

function MarkAuthValidated() {
    localStorage.setItem(STORY_AUTH_VALIDATED_AT_KEY, String(Date.now()));
}

function WasAuthRecentlyValidated() {
    const ValidatedAt = Number(localStorage.getItem(STORY_AUTH_VALIDATED_AT_KEY) || 0);
    return ValidatedAt > 0 && Date.now() - ValidatedAt < STORY_AUTH_VALIDATION_WINDOW;
}

async function SwitchSavedAccount(Username) {
    const Key = String(Username || "").trim().toLowerCase();
    const SavedAccount = GetSavedAccountSessions().find(Account => Account.username.toLowerCase() === Key);
    if (!SavedAccount) throw new Error("That saved account is no longer available on this browser.");

    try {
        const Result = await ApiRequest("/api/me", {
            authToken: SavedAccount.token,
            preserveAuthOn401: true
        });

        if (!Result?.profile?.username) {
            throw new Error("The server did not verify that saved account.");
        }

        SetAuthToken(SavedAccount.token);
        ClearLastKnownStoryState();
        AccountProfileRequestPromise = null;
        ServerSaveRequestPromise = null;
        StoreLastKnownProfileResult(Result);
        MarkAuthValidated();
        RememberAccountSession({ profile: Result.profile, token: SavedAccount.token });
        BroadcastStorySession(Result.profile.username);
        return Result;
    } catch (Error) {
        if (Error?.status === 401) ForgetSavedAccount(SavedAccount.username);
        throw Error;
    }
}

function LogoutAccount() {
    StopStoryMusicForSignedOutState();
    SetAuthToken("");
    BroadcastStorySession("");

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
            BroadcastStorySession("");
            window.location.replace(BuildStoryUrl("auth.html"));
        }
    }
}

async function ApiRequest(Path, Options = {}) {
    const ServerUrl = GetServerUrl();
    if (!ServerUrl) {
        throw new Error("Multiplayer server is not configured yet. Run server.js locally or set the deployed server URL in server-config.js.");
    }

    const RequestOptions = { ...Options };
    const HasAuthOverride = Object.prototype.hasOwnProperty.call(RequestOptions, "authToken");
    const AuthTokenOverride = HasAuthOverride ? String(RequestOptions.authToken || "") : "";
    const PreserveAuthOn401 = Boolean(RequestOptions.preserveAuthOn401);
    delete RequestOptions.authToken;
    delete RequestOptions.preserveAuthOn401;

    const RequestHeaders = new window.Headers(RequestOptions.headers || {});
    if (!RequestHeaders.has("Content-Type") && RequestOptions.body !== undefined) RequestHeaders.set("Content-Type", "application/json");

    const Token = HasAuthOverride ? AuthTokenOverride : GetAuthToken();
    if (Token && !RequestHeaders.has("Authorization")) RequestHeaders.set("Authorization", `Bearer ${Token}`);

    const Response = await fetch(`${ServerUrl}${Path}`, {
        ...RequestOptions,
        headers: RequestHeaders,
        cache: "no-store"
    });

    let Data = {};
    try {
        Data = await Response.json();
    } catch {}

    if (!Response.ok) {
        if (Response.status === 401 && !PreserveAuthOn401) SetAuthToken("");
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
    RememberAccountSession(Result);
    BroadcastStorySession(Result?.profile?.username || Username);
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
    RememberAccountSession(Result);
    BroadcastStorySession(Result?.profile?.username || Username);
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
    if (Result?.ok) {
        const Username = GetLastKnownProfileResult()?.profile?.username || "";
        ForgetSavedAccount(Username);
        SetAuthToken("");
        BroadcastStorySession("");
    }
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

    const Socket = io(ServerUrl, {
        auth: {
            token: GetAuthToken(),
            deviceSignature: GetStoryDeviceSignature(),
            tabId: GetStoryTabId()
        },
        transports: ["websocket", "polling"]
    });

    Socket.on("session:conflict", Payload => {
        ShowOtherSessionFound(Payload?.username || "");
    });

    return Socket;
}

InitializeStorySessionSync();
GuardProtectedPage();