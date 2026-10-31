const STORY_AUTH_TOKEN_KEY = "StoryRewriteAuthToken";
const STORY_COOKIE_SESSION_MARKER_KEY = "StoryRewriteCookieSessionActiveV1";
const STORY_SAVED_ACCOUNT_NAMES_KEY = "StoryRewriteSavedAccountNamesV1";
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
const STORY_SOCIAL_HEARTBEAT_INTERVAL = 60000;
const STORY_SWITCH_FROM_USERNAME_KEY = "StoryRewriteSwitchFromUsernameV1";
const STORY_SESSION_CHANNEL_NAME = "StoryRewriteSessionChannelV1";
const STORY_SOCIAL_NOTIFICATION_STATE_PREFIX = "StoryRewriteSocialUnreadStateV2:";
const STORY_SOCIAL_NOTIFICATION_COUNT_PREFIX = "StoryRewriteSocialUnreadCountV2:";
const STORY_SOCIAL_NOTIFICATION_MUTE_PREFIX = "StoryRewriteSocialNotificationMutesV1:";
const STORY_SOCIAL_NOTIFICATION_LEGACY_RESET_KEY = "StoryRewriteSocialNotificationLegacyResetV2";
const STORY_SOCIAL_NOTIFICATION_BASELINE_PREFIX = "StoryRewriteSocialNotificationBaselineV2:";
const STORY_SOCIAL_NOTIFICATION_REFRESH_INTERVAL = 30000;
let StorySocialNotificationRefreshTimer = null;

function StoryClearLegacySocialNotificationStorage() {
    try {
        if (localStorage.getItem(STORY_SOCIAL_NOTIFICATION_LEGACY_RESET_KEY) === "1") return;
        const LegacyKeys = [];
        for (let Index = 0; Index < localStorage.length; Index += 1) {
            const Key = localStorage.key(Index) || "";
            if (Key.startsWith("StoryRewriteSocialUnreadStateV1:") ||
                Key.startsWith("StoryRewriteSocialUnreadCountV1:")) {
                LegacyKeys.push(Key);
            }
        }
        LegacyKeys.forEach(Key => localStorage.removeItem(Key));
        localStorage.setItem(STORY_SOCIAL_NOTIFICATION_LEGACY_RESET_KEY, "1");
    } catch {}
}

StoryClearLegacySocialNotificationStorage();
let StorySocialNotificationRefreshInFlight = false;
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
    "account.html",
    "settings.html",
    "social.html"
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
    if (Result?.profile) {
        WriteStoryLocalJson(STORY_LAST_PROFILE_KEY, Result);
        ApplyStoryIdentityTitle(Result.profile);
    }
    return Result;
}

function StorySocialNotificationAccountName(Profile = null) {
    const Source = Profile || GetLastKnownProfileResult()?.profile || null;
    return String(Source?.username || "").trim();
}

function StorySocialNotificationStateKey(Username = StorySocialNotificationAccountName()) {
    const Name = String(Username || "").trim().toLowerCase();
    return Name ? STORY_SOCIAL_NOTIFICATION_STATE_PREFIX + Name : "";
}

function StorySocialNotificationCountKey(Username = StorySocialNotificationAccountName()) {
    const Name = String(Username || "").trim().toLowerCase();
    return Name ? STORY_SOCIAL_NOTIFICATION_COUNT_PREFIX + Name : "";
}

function StoryGetStoredSocialNotificationCount(Username = StorySocialNotificationAccountName()) {
    const Key = StorySocialNotificationCountKey(Username);
    if (!Key) return 0;
    try { return Math.max(0, Number.parseInt(localStorage.getItem(Key) || "0", 10) || 0); } catch { return 0; }
}

function StoryReadSocialNotificationState(Username = StorySocialNotificationAccountName()) {
    const Key = StorySocialNotificationStateKey(Username);
    if (!Key) return {};
    try {
        const Value = JSON.parse(localStorage.getItem(Key) || "{}");
        return Value && typeof Value === "object" && !Array.isArray(Value) ? Value : {};
    } catch { return {}; }
}

function StoryWriteSocialNotificationState(State, Username = StorySocialNotificationAccountName()) {
    const Key = StorySocialNotificationStateKey(Username);
    if (!Key) return;
    try { localStorage.setItem(Key, JSON.stringify(State || {})); } catch {}
}

function StorySocialNotificationTime(Value) {
    if (typeof Value === "number" && Number.isFinite(Value)) {
        return Value > 0 && Value < 100000000000 ? Value * 1000 : Value;
    }
    const Text = String(Value || "").trim();
    if (!Text) return 0;
    if (/^\d{10,13}$/.test(Text)) {
        const Numeric = Number(Text);
        return Numeric < 100000000000 ? Numeric * 1000 : Numeric;
    }
    const Parsed = Date.parse(Text);
    return Number.isFinite(Parsed) ? Parsed : 0;
}

function StoryIsSocialPlayerNotificationMuted(Username, AccountName = StorySocialNotificationAccountName()) {
    const Account = String(AccountName || "").trim().toLowerCase();
    const Target = String(Username || "").trim().toLowerCase();
    if (!Account || !Target) return false;
    try {
        const Parsed = JSON.parse(localStorage.getItem(STORY_SOCIAL_NOTIFICATION_MUTE_PREFIX + Account) || "[]");
        return Array.isArray(Parsed) && Parsed.some(Name => String(Name || "").trim().toLowerCase() === Target);
    } catch { return false; }
}

function StoryGetSocialUnreadCountForUser(Username) {
    const Entry = StoryReadSocialNotificationState()[String(Username || "").trim().toLowerCase()];
    return Math.max(0, Number(Entry?.unreadCount || 0));
}

function StoryGetSocialUnreadEntries(State = StoryReadSocialNotificationState()) {
    return Object.entries(State).map(([Key, Entry]) => ({
        key: Key,
        username: String(Entry?.username || Key),
        unreadCount: Math.max(0, Number(Entry?.unreadCount || 0))
    })).filter(Entry => Entry.unreadCount > 0);
}

function StorySyncSocialDocumentTitle(Title) {
    const SafeTitle = String(Title || "Story Rewrite").slice(0, 180);
    try { document.title = SafeTitle; } catch {}
    if (window.parent === window) return;
    try {
        if (typeof window.parent.StoryShellSyncTitle === "function") {
            // The outer shell ignores titles from hidden/prefetched frames.
            window.parent.StoryShellSyncTitle(SafeTitle, window);
            return;
        }
        if (window.parent.document) window.parent.document.title = SafeTitle;
    } catch {}
}

function StoryRenderSocialNotificationState(State = StoryReadSocialNotificationState(), Username = StorySocialNotificationAccountName()) {
    const Entries = StoryGetSocialUnreadEntries(State);
    const Count = Entries.reduce((Total, Entry) => Total + Entry.unreadCount, 0);
    const CountKey = StorySocialNotificationCountKey(Username);
    if (CountKey) {
        try { localStorage.setItem(CountKey, String(Count)); } catch {}
    }

    const ProfileResult = GetLastKnownProfileResult();
    const Profile = ProfileResult?.profile || null;
    if (Profile?.username?.toLowerCase() === String(Username || "").toLowerCase() && Profile?.userId) {
        ApplyStoryIdentityTitle(Profile);
    } else {
        const Prefix = Count > 0 ? `(${Count > 99 ? "99+" : Count}) ` : "";
        const BaseTitle = (document.title.replace(/^\(\d+\+?\)\s*/, "") || "Story Rewrite");
        StorySyncSocialDocumentTitle(Prefix + BaseTitle);
    }

    document.querySelectorAll("[data-social-notification-badge]").forEach(Badge => {
        Badge.textContent = Count > 99 ? "99+" : String(Count);
        Badge.hidden = Count <= 0;
        Badge.setAttribute("aria-label", Count + (Count === 1 ? " new message" : " new messages"));
    });

    try {
        window.dispatchEvent(new CustomEvent("StorySocialNotificationsChanged", { detail: { count: Count, entries: Entries } }));
    } catch {}
    return Count;
}

function StoryMarkSocialConversationRead(Username, SeenThroughAt = 0) {
    const TargetName = String(Username || "").trim();
    const Target = TargetName.toLowerCase();
    const AccountName = StorySocialNotificationAccountName();
    if (!Target || !AccountName) return;
    const State = StoryReadSocialNotificationState(AccountName);
    const Entry = State[Target] || { username: TargetName, lastSeenAt: 0, lastNotifiedAt: 0, unreadCount: 0 };
    const SeenThrough = Math.max(Date.now(), StorySocialNotificationTime(SeenThroughAt));
    Entry.username = TargetName || Entry.username || Target;
    Entry.lastSeenAt = Math.max(Number(Entry.lastSeenAt || 0), SeenThrough);
    Entry.lastNotifiedAt = Math.max(Number(Entry.lastNotifiedAt || 0), SeenThrough);
    Entry.unreadCount = 0;
    State[Target] = Entry;
    StoryWriteSocialNotificationState(State, AccountName);
    StoryRenderSocialNotificationState(State, AccountName);
}

function StoryRecordIncomingSocialMessage(Username, SentAt) {
    const TargetName = String(Username || "").trim();
    const Target = TargetName.toLowerCase();
    const AccountName = StorySocialNotificationAccountName();
    if (!Target || !AccountName || Target === AccountName.toLowerCase()) return;

    if (document.visibilityState === "visible" &&
        /(?:^|\/)social\.html$/i.test(window.location.pathname || "") &&
        !document.getElementById("SocialChatView")?.hidden &&
        String(document.getElementById("SocialChatUsername")?.textContent || "").trim().toLowerCase() === Target) {
        StoryMarkSocialConversationRead(TargetName, SentAt);
        return;
    }

    const At = StorySocialNotificationTime(SentAt) || Date.now();
    const State = StoryReadSocialNotificationState(AccountName);
    const Entry = State[Target] || { username: TargetName, lastSeenAt: 0, lastNotifiedAt: 0, unreadCount: 0 };
    if (At <= Number(Entry.lastSeenAt || 0) || At <= Number(Entry.lastNotifiedAt || 0)) return;

    Entry.username = TargetName;
    Entry.lastNotifiedAt = At;
    if (!StoryIsSocialPlayerNotificationMuted(TargetName, AccountName)) {
        Entry.unreadCount = Math.max(0, Number(Entry.unreadCount || 0)) + 1;
    }
    State[Target] = Entry;
    StoryWriteSocialNotificationState(State, AccountName);
    StoryRenderSocialNotificationState(State, AccountName);
}

async function StoryRefreshSocialNotifications() {
    if (StorySocialNotificationRefreshInFlight || !GetAuthToken() || typeof ApiRequest !== "function") return;
    StorySocialNotificationRefreshInFlight = true;
    try {
        let Profile = GetLastKnownProfileResult()?.profile || null;
        if (!Profile?.username) {
            try { Profile = (await GetAccountProfile())?.profile || null; } catch {}
        }
        const AccountName = String(Profile?.username || "").trim();
        if (!AccountName) return;

        const NotificationScanStartedAt = Date.now();
        const Result = await ApiRequest("/api/social/inbox?limit=20");
        const Items = Array.isArray(Result?.messages) ? Result.messages : [];
        const State = StoryReadSocialNotificationState(AccountName);
        const BaselineKey = STORY_SOCIAL_NOTIFICATION_BASELINE_PREFIX + AccountName.toLowerCase();
        let NeedsInitialBaseline = false;
        try { NeedsInitialBaseline = localStorage.getItem(BaselineKey) !== "1"; } catch { NeedsInitialBaseline = true; }

        // The old unread state had no reliable read/message connection. Establish a
        // clean baseline from existing conversations once, while preserving messages
        // received after this inbox scan began.
        if (NeedsInitialBaseline) {
            for (const Item of Items) {
                const TargetName = String(Item?.user?.username || "").trim();
                const Target = TargetName.toLowerCase();
                if (!Target) continue;

                const At = StorySocialNotificationTime(Item?.lastMessageAt);
                const Entry = State[Target] || { username: TargetName, lastSeenAt: 0, lastNotifiedAt: 0, unreadCount: 0 };
                Entry.username = TargetName;
                Entry.lastSeenAt = Math.max(Number(Entry.lastSeenAt || 0), NotificationScanStartedAt);

                // Only clear stale history. A socket notification received after
                // startup has a newer lastNotifiedAt and must remain unread.
                if (Number(Entry.lastNotifiedAt || 0) <= NotificationScanStartedAt &&
                    (!At || At <= NotificationScanStartedAt)) {
                    Entry.lastNotifiedAt = Math.max(Number(Entry.lastNotifiedAt || 0), At || 0, NotificationScanStartedAt);
                    Entry.unreadCount = 0;
                }
                State[Target] = Entry;
            }
            try { localStorage.setItem(BaselineKey, "1"); } catch {}
        }

        for (const Item of Items) {
            const TargetName = String(Item?.user?.username || "").trim();
            const Target = TargetName.toLowerCase();
            if (!Target || Item?.lastMessageFromMe) continue;
            const At = StorySocialNotificationTime(Item?.lastMessageAt);
            if (!At) continue;
            const Entry = State[Target] || { username: TargetName, lastSeenAt: 0, lastNotifiedAt: 0, unreadCount: 0 };
            if (At > Number(Entry.lastSeenAt || 0) && At > Number(Entry.lastNotifiedAt || 0)) {
                Entry.username = TargetName;
                Entry.lastNotifiedAt = At;
                if (!StoryIsSocialPlayerNotificationMuted(TargetName, AccountName)) {
                    Entry.unreadCount = Math.max(0, Number(Entry.unreadCount || 0)) + 1;
                }
                State[Target] = Entry;
            }
        }

        StoryWriteSocialNotificationState(State, AccountName);
        StoryRenderSocialNotificationState(State, AccountName);
    } catch {
        // Notifications are optional; a failed inbox check must not affect gameplay.
    } finally {
        StorySocialNotificationRefreshInFlight = false;
    }
}

function StartStorySocialNotificationTracking() {
    if (StorySocialNotificationRefreshTimer || !GetAuthToken()) return;
    StoryRefreshSocialNotifications();
    StorySocialNotificationRefreshTimer = window.setInterval(() => {
        if (!GetAuthToken()) {
            clearInterval(StorySocialNotificationRefreshTimer);
            StorySocialNotificationRefreshTimer = null;
            return;
        }
        StoryRefreshSocialNotifications();
    }, STORY_SOCIAL_NOTIFICATION_REFRESH_INTERVAL);
}

window.addEventListener("focus", StoryRefreshSocialNotifications);
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") StoryRefreshSocialNotifications();
});
window.addEventListener("storage", Event => {
    const Username = StorySocialNotificationAccountName();
    if (Event.key === StorySocialNotificationStateKey(Username)) {
        StoryRenderSocialNotificationState(StoryReadSocialNotificationState(Username), Username);
    }
});
document.addEventListener("DOMContentLoaded", StartStorySocialNotificationTracking, { once: true });

function ApplyStoryIdentityTitle(Profile = null) {
    const Username = String(Profile?.username || "").trim();
    const UserId = String(Profile?.userId || "").trim();
    if (!Username || !UserId) return;

    const UnreadCount = StoryGetStoredSocialNotificationCount(Username);
    const Prefix = UnreadCount > 0 ? `(${UnreadCount > 99 ? "99+" : UnreadCount}) ` : "";
    const Title = `${Prefix}Story Rewrite — ${UserId}`;
    StorySyncSocialDocumentTitle(Title);
}

let StorySocialHeartbeatTimer = null;
let StorySocialHeartbeatInFlight = false;

async function TouchStorySocialHeartbeat() {
    if (StorySocialHeartbeatInFlight || !GetAuthToken()) return;
    StorySocialHeartbeatInFlight = true;
    try {
        await ApiRequest("/api/social/heartbeat", { method: "POST" });
    } catch {} finally {
        StorySocialHeartbeatInFlight = false;
    }
}

function StartStorySocialHeartbeat() {
    if (StorySocialHeartbeatTimer) return;
    if (!GetAuthToken()) return;

    TouchStorySocialHeartbeat();
    StorySocialHeartbeatTimer = setInterval(() => {
        if (!GetAuthToken()) {
            clearInterval(StorySocialHeartbeatTimer);
            StorySocialHeartbeatTimer = null;
            return;
        }
        TouchStorySocialHeartbeat();
    }, STORY_SOCIAL_HEARTBEAT_INTERVAL);
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

    // Production Vercel sessions must stay on the first-party proxy origin so
    // browsers never need to send the HttpOnly cookie as a third-party cookie.
    if (window.STORY_REWRITE_SAME_ORIGIN_API === true) return window.location.origin;
    if (Override) return Override;
    if (Configured) return Configured;

    if (location.protocol === "http:" || location.protocol === "https:") {
        if (!location.hostname.endsWith("github.io")) return location.origin;
    }

    return "";
}

function GetStorySocketServerUrl() {
    const Configured = String(window.STORY_REWRITE_SOCKET_URL || "").trim().replace(/\/$/, "");
    return Configured || GetServerUrl();
}

function GetStorySocketAuth(Callback) {
    let Completed = false;
    const Finish = Payload => {
        if (Completed) return;
        Completed = true;
        try { Callback(Payload); } catch {}
    };
    const DeviceSignature = GetStoryDeviceSignature();
    const TabId = GetStoryTabId();

    ApiRequest("/api/socket-ticket", {
        method: "POST",
        body: "{}",
        timeoutMs: 15000
    }).then(Result => {
        const Ticket = String(Result?.ticket || "");
        if (!Ticket) throw new Error("SOCKET_TICKET_UNAVAILABLE");
        Finish({ ticket: Ticket, deviceSignature: DeviceSignature, tabId: TabId });
    }).catch(Error => {
        const AuthError = Error?.status === 401 ? "AUTH_REQUIRED" : "SOCKET_TICKET_UNAVAILABLE";
        Finish({ ticket: "", socketAuthError: AuthError, deviceSignature: DeviceSignature, tabId: TabId });
    });
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
    const Current = ReadStoryLocalJson(STORY_SAVED_ACCOUNT_NAMES_KEY);
    const Legacy = ReadStoryLocalJson(STORY_SAVED_ACCOUNTS_KEY);
    const Combined = [
        ...(Array.isArray(Current?.accounts) ? Current.accounts : []),
        ...(Array.isArray(Legacy?.accounts) ? Legacy.accounts : [])
    ];
    const Seen = new Set();
    const Accounts = Combined.filter(Account => {
        const Username = String(Account?.username || "").trim();
        const Key = Username.toLowerCase();
        if (!Username || Seen.has(Key)) return false;
        Seen.add(Key);
        return true;
    }).map(Account => ({
        username: String(Account.username).trim(),
        lastUsedAt: Number(Account.lastUsedAt || 0)
    })).sort((First, Second) => Number(Second.lastUsedAt || 0) - Number(First.lastUsedAt || 0));
    SaveSavedAccountSessions(Accounts);
    try { localStorage.removeItem(STORY_SAVED_ACCOUNTS_KEY); } catch {}
    return Accounts;
}

function SaveSavedAccountSessions(Accounts) {
    const SafeAccounts = (Array.isArray(Accounts) ? Accounts : [])
        .filter(Account => Account && typeof Account.username === "string" && Account.username.trim())
        .map(Account => ({ username: Account.username.trim(), lastUsedAt: Number(Account.lastUsedAt || Date.now()) }))
        .slice(0, 8);
    WriteStoryLocalJson(STORY_SAVED_ACCOUNT_NAMES_KEY, { accounts: SafeAccounts });
}

function RememberAccountSession(Result) {
    const Username = String(Result?.profile?.username || "").trim();
    if (!Username) return;
    const Accounts = GetSavedAccountSessions().filter(Account => Account.username.toLowerCase() !== Username.toLowerCase());
    Accounts.unshift({ username: Username, lastUsedAt: Date.now() });
    SaveSavedAccountSessions(Accounts);
}

function ForgetSavedAccount(Username) {
    const Key = String(Username || "").trim().toLowerCase();
    if (!Key) return;
    SaveSavedAccountSessions(GetSavedAccountSessions().filter(Account => Account.username.toLowerCase() !== Key));
    try { localStorage.removeItem(STORY_SAVED_ACCOUNTS_KEY); } catch {}
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
    const Authenticated = Boolean(GetAuthToken());
    const NormalizedUsername = String(Username || GetLastKnownProfileResult()?.profile?.username || "").trim();
    StoryTabAuthToken = Authenticated ? "1:" + NormalizedUsername.toLowerCase() : "0";
    const Message = {
        type: "auth-change",
        sourceTabId: GetStoryTabId(),
        authenticated: Authenticated,
        username: NormalizedUsername,
        sentAt: Date.now()
    };
    try { StorySessionChannel?.postMessage(Message); } catch {}
    try { localStorage.setItem(STORY_SESSION_EVENT_KEY, JSON.stringify(Message)); } catch {}
}

function HandleStorySessionMessage(Message) {
    if (!Message || Message.type !== "auth-change") return;
    if (Message.sourceTabId === GetStoryTabId()) return;
    const IncomingMarker = Message.authenticated
        ? "1:" + String(Message.username || "").trim().toLowerCase()
        : "0";
    if (IncomingMarker === StoryTabAuthToken) return;
    StoryTabAuthToken = IncomingMarker;
    ShowOtherSessionFound(Message.username || "");
}

function InitializeStorySessionSync() {
    StoryTabAuthToken = GetAuthToken()
        ? "1:" + String(GetLastKnownProfileResult()?.profile?.username || "").trim().toLowerCase()
        : "0";

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
    try {
        return localStorage.getItem(STORY_COOKIE_SESSION_MARKER_KEY) === "1" ? "cookie-session" : "";
    } catch {
        return "";
    }
}

function GetAccountSwitchSourceUsername() {
    return String(sessionStorage.getItem(STORY_SWITCH_FROM_USERNAME_KEY) || "").trim();
}

function ClearAccountSwitchSource() {
    sessionStorage.removeItem(STORY_SWITCH_FROM_USERNAME_KEY);
}

async function BeginAccountSwitch(Username) {
    const SwitchFromUsername = String(Username || "").trim();
    if (SwitchFromUsername) sessionStorage.setItem(STORY_SWITCH_FROM_USERNAME_KEY, SwitchFromUsername);
    else ClearAccountSwitchSource();
    StopStoryMusicForSignedOutState();
    try {
        if (GetAuthToken()) await ApiRequest("/api/session", { method: "DELETE", timeoutMs: 4000 });
    } catch {}
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
    const WasAuthenticated = Boolean(GetAuthToken());
    try {
        localStorage.removeItem(STORY_AUTH_TOKEN_KEY);
        localStorage.removeItem(STORY_LEGACY_AUTH_TOKEN_KEY);
        sessionStorage.removeItem(STORY_LEGACY_AUTH_TOKEN_KEY);
        localStorage.removeItem(STORY_SAVED_ACCOUNTS_KEY);
    } catch {}
    if (Token) {
        if (!WasAuthenticated) ClearLastKnownStoryState();
        try { localStorage.setItem(STORY_COOKIE_SESSION_MARKER_KEY, "1"); } catch {}
        ClearAccountSwitchSource();
        StoryTabAuthToken = "1:" + String(GetLastKnownProfileResult()?.profile?.username || "").toLowerCase();
        DispatchStoryAuthState(true);
        return;
    }
    StopStoryMusicForSignedOutState();
    ClearLastKnownStoryState();
    try {
        localStorage.removeItem(STORY_COOKIE_SESSION_MARKER_KEY);
        localStorage.removeItem(STORY_AUTH_VALIDATED_AT_KEY);
    } catch {}
    StoryTabAuthToken = "0";
    DispatchStoryAuthState(false);
}

function MarkAuthValidated() {
    localStorage.setItem(STORY_AUTH_VALIDATED_AT_KEY, String(Date.now()));
}

function WasAuthRecentlyValidated() {
    const ValidatedAt = Number(localStorage.getItem(STORY_AUTH_VALIDATED_AT_KEY) || 0);
    return ValidatedAt > 0 && Date.now() - ValidatedAt < STORY_AUTH_VALIDATION_WINDOW;
}

async function LogoutAccount() {
    StopStoryMusicForSignedOutState();
    try {
        if (GetAuthToken()) await ApiRequest("/api/session", { method: "DELETE", timeoutMs: 2500 });
    } catch {}
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
    if (!ServerUrl) throw new Error("Multiplayer server is not configured yet. Run server.js locally or set the deployed server URL in server-config.js.");
    const RequestOptions = { ...Options };
    const TimeoutMs = Math.max(1000, Math.min(90000, Number(RequestOptions.timeoutMs || 20000)));
    delete RequestOptions.timeoutMs;
    delete RequestOptions.authToken;
    delete RequestOptions.preserveAuthOn401;
    const RequestHeaders = new window.Headers(RequestOptions.headers || {});
    if (!RequestHeaders.has("Content-Type") && RequestOptions.body !== undefined) RequestHeaders.set("Content-Type", "application/json");
    const Method = String(RequestOptions.method || "GET").toUpperCase();
    const MaxAttempts = Method === "GET" ? 2 : 1;
    for (let Attempt = 0; Attempt < MaxAttempts; Attempt += 1) {
        const Controller = new AbortController();
        const Timeout = window.setTimeout(() => Controller.abort(), TimeoutMs);
        let Response;
        try {
            Response = await fetch(`${ServerUrl}${Path}`, {
                ...RequestOptions, credentials: "include", headers: RequestHeaders, cache: "no-store", signal: Controller.signal
            });
        } catch (Error) {
            if (Attempt < MaxAttempts - 1) {
                await new Promise(Resolve => window.setTimeout(Resolve, 250));
                continue;
            }
            if (Controller.signal.aborted) {
                const TimeoutError = new Error("The server request timed out. Please retry.");
                TimeoutError.name = "TimeoutError";
                throw TimeoutError;
            }
            throw Error;
        } finally {
            window.clearTimeout(Timeout);
        }
        if (Method === "GET" && Attempt < MaxAttempts - 1 && [502, 503, 504].includes(Response.status)) {
            try { await Response.body?.cancel(); } catch {}
            await new Promise(Resolve => window.setTimeout(Resolve, 250));
            continue;
        }
        let Data = {};
        try { Data = await Response.json(); } catch {}
        if (!Response.ok) {
            if (Response.status === 401) SetAuthToken("");
            const RequestError = new Error(Data.error || `Server request failed: ${Response.status}`);
            RequestError.status = Response.status;
            RequestError.data = Data;
            throw RequestError;
        }
        return Data;
    }
    throw new Error("The server request could not be completed.");
}
async function CompleteCookieAccountSignIn(Result, Username) {
    // Do not navigate to the app just because /login or /register returned 200.
    // Verify that the browser actually received and can use the HttpOnly session.
    const Session = await ApiRequest("/api/me", { timeoutMs: 12000 });
    if (!Session?.profile?.username) {
        throw new Error("The server accepted the sign-in but did not establish a secure browser session. Please try again.");
    }

    const VerifiedResult = { ...Result, profile: Session.profile };
    SetAuthToken("cookie-session");
    StoreLastKnownProfileResult(VerifiedResult);
    if (Result?.save) StoreLastKnownServerSave(Result.save);
    MarkAuthValidated();
    RememberAccountSession(VerifiedResult);
    BroadcastStorySession(Session.profile.username || Username);
    return VerifiedResult;
}

async function RegisterAccount(Username, Password) {
    ClearLastKnownStoryState();
    const Result = await ApiRequest("/api/register", {
        method: "POST",
        body: JSON.stringify({ username: Username, password: Password })
    });
    return CompleteCookieAccountSignIn(Result, Username);
}

async function LoginAccount(Username, Password) {
    ClearLastKnownStoryState();
    const Result = await ApiRequest("/api/login", {
        method: "POST",
        body: JSON.stringify({ username: Username, password: Password })
    });
    return CompleteCookieAccountSignIn(Result, Username);
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
    const ServerUrl = GetStorySocketServerUrl();
    if (!ServerUrl) throw new Error("Multiplayer server is not configured.");

    const Socket = io(ServerUrl, {
        withCredentials: false,
        auth: GetStorySocketAuth,
        transports: ["websocket", "polling"],
        tryAllTransports: true,
        rememberUpgrade: true,
        timeout: 10000,
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 400,
        reconnectionDelayMax: 3000,
        randomizationFactor: 0.25
    });

    Socket.on("session:conflict", Payload => {
        ShowOtherSessionFound(Payload?.username || "");
    });

    return Socket;
}

const CachedStoryProfile = GetLastKnownProfileResult()?.profile || null;
ApplyStoryIdentityTitle(CachedStoryProfile);

InitializeStorySessionSync();
GuardProtectedPage();

window.addEventListener("StoryShellActivate", StartStorySocialHeartbeat);
window.addEventListener("StoryShellDeactivate", () => {
    if (StorySocialHeartbeatTimer) {
        clearInterval(StorySocialHeartbeatTimer);
        StorySocialHeartbeatTimer = null;
    }
});
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") StartStorySocialHeartbeat();
    else if (StorySocialHeartbeatTimer) {
        clearInterval(StorySocialHeartbeatTimer);
        StorySocialHeartbeatTimer = null;
    }
});