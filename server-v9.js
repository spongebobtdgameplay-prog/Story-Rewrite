const fs = require("fs");
const path = require("path");
const Module = require("module");

const SourcePath = path.join(__dirname, "server-v8.js");
let Source = fs.readFileSync(SourcePath, "utf8");

function ReplaceRequired(Search, Replacement, Label) {
    if (!Source.includes(Search)) {
        throw new Error(`server-v9 patch failed: ${Label}`);
    }
    Source = Source.replace(Search, Replacement);
}

ReplaceRequired(
    "const BackendVersion = 8;",
    "const BackendVersion = 9;",
    "backend version"
);

ReplaceRequired(
    "const ChatRateLimitWindow = 10000;",
    `const ChatRateLimitWindow = 10000;
const JoinRequestLifetime = 45000;
const ProfanityWords = [
    "fuck", "fucking", "fucker", "shit", "bitch", "asshole", "dick", "cunt", "nigger", "nigga", "faggot", "retard"
];

const LoginIpWindowMs = Math.max(60000, Number(process.env.LOGIN_IP_WINDOW_MS || 10 * 60 * 1000));
const LoginAccountWindowMs = Math.max(60000, Number(process.env.LOGIN_ACCOUNT_WINDOW_MS || 15 * 60 * 1000));
const LoginIpMaxFailures = Math.max(3, Math.min(100, Number(process.env.LOGIN_IP_MAX_FAILURES || 10)));
const LoginAccountMaxFailures = Math.max(3, Math.min(100, Number(process.env.LOGIN_ACCOUNT_MAX_FAILURES || 8)));
const LoginLockoutMs = Math.max(30000, Number(process.env.LOGIN_LOCKOUT_MS || 15 * 60 * 1000));
const LoginDelayBaseMs = Math.max(100, Number(process.env.LOGIN_DELAY_BASE_MS || 500));
const LoginDelayMaxMs = Math.max(LoginDelayBaseMs, Number(process.env.LOGIN_DELAY_MAX_MS || 10000));
const LoginRateCleanupMs = Math.max(60000, Number(process.env.LOGIN_RATE_CLEANUP_MS || 5 * 60 * 1000));
const LoginGenericError = "Wrong username or password.";

const LoginIpFailures = new Map();
const LoginAccountFailures = new Map();

const DummyPasswordSalt = crypto.randomBytes(16);
const DummyPasswordHash = `scrypt$${DummyPasswordSalt.toString("hex")}$${crypto.scryptSync("StoryRewrite-Invalid-Password", DummyPasswordSalt, 64).toString("hex")}`;`,
    "moderation constants"
);

ReplaceRequired(
    "        lastOutcome: null,\n        cleanupTimer: null",
    `        lastOutcome: null,
        cleanupTimer: null,
        pendingJoinRequests: new Map(),
        chatBannedNames: new Set(),
        moderationRevision: 0`,
    "room moderation state"
);

ReplaceRequired(
    "        players: [...Room.players.values()].map(Player => ({ username: Player.username, ready: Player.ready })),",
    `        players: [...Room.players.values()].map(Player => ({
            username: Player.username,
            ready: Player.ready,
            chatBanned: Room.chatBannedNames.has(Player.username)
        })),`,
    "public player moderation state"
);

ReplaceRequired(
    "function EmitRoom(Room) {",
    `function GetLoginClientKey(Request) {
    const ForwardedFor = String(Request.headers["x-forwarded-for"] || "")
        .split(",")[0]
        .trim();
    const RealIp = String(Request.headers["x-real-ip"] || "").trim();
    const RemoteAddress = String(Request.socket?.remoteAddress || "unknown").trim();
    const Address = ForwardedFor || RealIp || RemoteAddress || "unknown";
    return crypto.createHash("sha256").update(Address).digest("hex").slice(0, 32);
}

function ReadLoginFailureState(Store, Key, WindowMs, Now) {
    if (!Key) return null;
    const State = Store.get(Key);
    if (!State) return null;

    if (State.lockedUntil <= Now && Now - State.windowStartedAt >= WindowMs) {
        Store.delete(Key);
        return null;
    }

    return State;
}

function GetLoginThrottleInfo(IpKey, AccountKey, Now) {
    const IpState = ReadLoginFailureState(LoginIpFailures, IpKey, LoginIpWindowMs, Now);
    const AccountState = ReadLoginFailureState(LoginAccountFailures, AccountKey, LoginAccountWindowMs, Now);

    const LockedUntil = Math.max(
        Number(IpState?.lockedUntil || 0),
        Number(AccountState?.lockedUntil || 0)
    );

    if (LockedUntil > Now) {
        return { locked: true, delayMs: 0 };
    }

    const FailureCount = Math.max(
        Number(IpState?.failed || 0),
        Number(AccountState?.failed || 0)
    );

    if (FailureCount < 2) {
        return { locked: false, delayMs: 0 };
    }

    const DelayExponent = Math.max(0, FailureCount - 2);
    const DelayMs = Math.min(LoginDelayMaxMs, LoginDelayBaseMs * (2 ** DelayExponent));
    return { locked: false, delayMs: DelayMs };
}

function RecordLoginFailure(Store, Key, WindowMs, MaxFailures, Now) {
    if (!Key) return;

    let State = ReadLoginFailureState(Store, Key, WindowMs, Now);
    if (!State) {
        State = {
            failed: 0,
            windowStartedAt: Now,
            lockedUntil: 0,
            lastSeenAt: Now
        };
        Store.set(Key, State);
    }

    State.failed += 1;
    State.lastSeenAt = Now;

    if (State.failed >= MaxFailures) {
        State.lockedUntil = Math.max(State.lockedUntil, Now + LoginLockoutMs);
    }
}

function ClearLoginFailure(Store, Key) {
    if (Key) Store.delete(Key);
}

function CleanupLoginRateLimitStore(Store, MaxAgeMs, Now) {
    for (const [Key, State] of Store.entries()) {
        const LastSeenAt = Number(State.lastSeenAt || State.windowStartedAt || 0);
        const LockedUntil = Number(State.lockedUntil || 0);
        if (LockedUntil <= Now && Now - LastSeenAt > MaxAgeMs) {
            Store.delete(Key);
        }
    }
}

function CleanupLoginRateLimits() {
    const Now = Date.now();
    CleanupLoginRateLimitStore(
        LoginIpFailures,
        Math.max(LoginIpWindowMs, LoginLockoutMs) + 60000,
        Now
    );
    CleanupLoginRateLimitStore(
        LoginAccountFailures,
        Math.max(LoginAccountWindowMs, LoginLockoutMs) + 60000,
        Now
    );
}

const LoginRateCleanupTimer = setInterval(CleanupLoginRateLimits, LoginRateCleanupMs);
LoginRateCleanupTimer.unref?.();

function EmitRoom(Room) {`,
    "login security helpers"
);

ReplaceRequired(
    "function EmitRoom(Room) {",
    `function CensorChatText(Value) {
    let Text = String(Value || "")
        .replace(/[\\u0000-\\u001F\\u007F]/g, " ")
        .replace(/\\s+/g, " ")
        .trim()
        .slice(0, ChatMaxLength);

    for (const Word of ProfanityWords) {
        const Pattern = new RegExp("\\\\b" + Word + "\\\\b", "gi");
        Text = Text.replace(Pattern, Match => "*".repeat(Math.min(Match.length, 12)));
    }

    return Text;
}

function CleanExpiredJoinRequests(Room) {
    const Now = Date.now();
    for (const [Username, RequestData] of Room.pendingJoinRequests.entries()) {
        if (Now - Number(RequestData.requestedAt || 0) <= JoinRequestLifetime) continue;
        const RequestSocket = Io.sockets.sockets.get(RequestData.socketId);
        RequestSocket?.emit("room:joinDenied", { code: Room.code, reason: "The join request expired." });
        Room.pendingJoinRequests.delete(Username);
    }
}

function EmitPendingJoinRequests(Room) {
    CleanExpiredJoinRequests(Room);
    if (!Room.hostSocketId) return;
    const HostSocket = Io.sockets.sockets.get(Room.hostSocketId);
    if (!HostSocket) return;

    HostSocket.emit("room:joinRequests", {
        code: Room.code,
        requests: [...Room.pendingJoinRequests.entries()].map(([Username, RequestData]) => ({
            username: Username,
            requestedAt: RequestData.requestedAt
        }))
    });
}

function FindRoomPlayerSocket(Room, Username) {
    for (const [SocketId, Player] of Room.players.entries()) {
        if (Player.username === Username) return Io.sockets.sockets.get(SocketId) || null;
    }
    return null;
}

function IsHostSocket(Room, Socket) {
    return Boolean(Room && Socket && Room.hostSocketId === Socket.id && Room.hostUsername === Socket.data.username);
}

function ReadModerationUsername(Payload) {
    if (!Payload || typeof Payload !== "object" || Array.isArray(Payload)) return "";
    const Username = NormalizeUsername(Payload.username);
    return ValidateUsername(Username) ? Username : "";
}

function EmitRoom(Room) {`,
    "moderation helpers"
);

ReplaceRequired(
    "    if (RequestPath === \"/api/login\" && Request.method === \"POST\") {\n        try {\n            const Body = await ReadJson(Request);\n            const Account = await GetAccountByUsername(Body.username);\n            if (!Account || !ValidatePassword(Body.password) || !PasswordMatches(Body.password, Account.passwordHash)) {\n                return SendJson(Response, 401, { error: \"Wrong username or password.\" }, Origin);\n            }\n            Account.save = NormalizeSave(Account.save);\n            await SaveAccount(Account);\n            return SendJson(Response, 200, { token: CreateToken(Account.username), profile: PublicProfile(Account), save: Account.save }, Origin);\n        } catch (Error) {\n            console.error(\"Login failed\", Error);\n            return SendJson(Response, 500, { error: \"Could not sign in.\" }, Origin);\n        }\n    }",
    "    if (RequestPath === \"/api/login\" && Request.method === \"POST\") {\n        try {\n            const Body = await ReadJson(Request);\n            const RawUsername = Body && typeof Body === \"object\" ? String(Body.username || \"\").trim() : \"\";\n            const Username = RawUsername.slice(0, 64);\n            const UsernameIsValid = ValidateUsername(RawUsername);\n            const AccountKey = UsernameIsValid ? UsernameKey(Username) : \"\";\n            const IpKey = GetLoginClientKey(Request);\n            const Now = Date.now();\n\n            const Throttle = GetLoginThrottleInfo(IpKey, AccountKey, Now);\n            if (Throttle.locked) {\n                return SendJson(Response, 401, { error: LoginGenericError }, Origin);\n            }\n\n            if (Throttle.delayMs > 0) {\n                await new Promise(Resolve => setTimeout(Resolve, Throttle.delayMs));\n            }\n\n            const Account = await GetAccountByUsername(Username);\n            const RawPassword = Body && typeof Body === \"object\" ? Body.password : \"\";\n            const PasswordIsString = typeof RawPassword === \"string\";\n            const PasswordInput = PasswordIsString ? RawPassword.slice(0, 128) : \"\";\n            const PasswordIsValid = ValidatePassword(RawPassword);\n            const PasswordHash = Account?.passwordHash || DummyPasswordHash;\n            const PasswordMatchesResult = PasswordMatches(PasswordInput, PasswordHash);\n\n            if (!Account || !UsernameIsValid || !PasswordIsValid || !PasswordMatchesResult) {\n                RecordLoginFailure(\n                    LoginIpFailures,\n                    IpKey,\n                    LoginIpWindowMs,\n                    LoginIpMaxFailures,\n                    Now\n                );\n\n                if (AccountKey) {\n                    RecordLoginFailure(\n                        LoginAccountFailures,\n                        AccountKey,\n                        LoginAccountWindowMs,\n                        LoginAccountMaxFailures,\n                        Now\n                    );\n                }\n\n                return SendJson(Response, 401, { error: LoginGenericError }, Origin);\n            }\n\n            ClearLoginFailure(LoginAccountFailures, AccountKey);\n            ClearLoginFailure(LoginIpFailures, IpKey);\n\n            Account.save = NormalizeSave(Account.save);\n            await SaveAccount(Account);\n            return SendJson(Response, 200, {\n                token: CreateToken(Account.username),\n                profile: PublicProfile(Account),\n                save: Account.save\n            }, Origin);\n        } catch (Error) {\n            console.error(\"Login failed\", Error);\n            return SendJson(Response, 500, { error: \"Could not sign in.\" }, Origin);\n        }\n    }",
    "server-side login throttling"
);

ReplaceRequired(
    "const Io = new SocketServer(HttpServer, {\n    cors:",
    `const Io = new SocketServer(HttpServer, {
    maxHttpBufferSize: 32768,
    perMessageDeflate: { threshold: 1024 },
    httpCompression: true,
    cors:`,
    "socket buffer limits"
);

ReplaceRequired(
    `            const ReturningMember = Room.memberNames.has(Username);
            if (Room.status !== "lobby" && !ReturningMember) return Reply({ ok: false, error: "That game already started." });
            if (!ReturningMember && Room.memberNames.size >= MaxPlayers) return Reply({ ok: false, error: "That game is full. Rooms can have up to 5 players." });`,
    `            const ReturningMember = Room.memberNames.has(Username);
            CleanExpiredJoinRequests(Room);

            if (Room.status !== "lobby" && !ReturningMember) {
                if (Room.memberNames.size >= MaxPlayers) {
                    return Reply({ ok: false, error: "That game is full. Rooms can have up to 5 players." });
                }

                Room.pendingJoinRequests.set(Username, {
                    socketId: Socket.id,
                    requestedAt: Date.now()
                });
                EmitPendingJoinRequests(Room);
                return Reply({
                    ok: false,
                    pending: true,
                    code: Room.code,
                    error: "Waiting for the host to approve your join request."
                });
            }

            if (!ReturningMember && Room.memberNames.size >= MaxPlayers) {
                return Reply({ ok: false, error: "That game is full. Rooms can have up to 5 players." });
            }`,
    "late join request gate"
);

ReplaceRequired(
    `            Reply({ ok: true, code: Room.code, state: State });
            EmitRoom(Room);`,
    `            Room.pendingJoinRequests.delete(Username);
            Reply({ ok: true, code: Room.code, state: State });
            EmitRoom(Room);
            if (Room.hostUsername === Username) EmitPendingJoinRequests(Room);`,
    "join request cleanup"
);

ReplaceRequired(
    `    Socket.on("room:leave", () => LeaveRoom(Socket, true));`,
    `    Socket.on("room:leave", () => LeaveRoom(Socket, true));

    Socket.on("host:joinDecision", (Payload, Reply = () => {}) => {
        try {
            const Room = GetRoomForSocket(Socket);
            if (!IsHostSocket(Room, Socket)) return Reply({ ok: false, error: "Only the host can approve players." });

            const Username = ReadModerationUsername(Payload);
            const RequestData = Username ? Room.pendingJoinRequests.get(Username) : null;
            if (!RequestData) return Reply({ ok: false, error: "That join request is no longer active." });

            Room.pendingJoinRequests.delete(Username);
            const RequestSocket = Io.sockets.sockets.get(RequestData.socketId);
            const Approved = Boolean(Payload?.approved);

            if (!Approved) {
                RequestSocket?.emit("room:joinDenied", { code: Room.code, reason: "The host declined your join request." });
                EmitPendingJoinRequests(Room);
                return Reply({ ok: true });
            }

            if (Room.memberNames.size >= MaxPlayers) {
                RequestSocket?.emit("room:joinDenied", { code: Room.code, reason: "The room became full." });
                EmitPendingJoinRequests(Room);
                return Reply({ ok: false, error: "The room is full." });
            }

            Room.memberNames.add(Username);
            RequestSocket?.emit("room:joinApproved", {
                code: Room.code,
                stageId: Room.stageId,
                status: Room.status
            });
            EmitPendingJoinRequests(Room);
            Reply({ ok: true });
        } catch (Error) {
            console.error("Join decision failed", Error);
            Reply({ ok: false, error: "Could not process the join request." });
        }
    });

    Socket.on("host:kick", (Payload, Reply = () => {}) => {
        try {
            const Room = GetRoomForSocket(Socket);
            if (!IsHostSocket(Room, Socket)) return Reply({ ok: false, error: "Only the host can kick players." });

            const Username = ReadModerationUsername(Payload);
            if (!Username || Username === Room.hostUsername) return Reply({ ok: false, error: "That player cannot be kicked." });

            const TargetSocket = FindRoomPlayerSocket(Room, Username);
            if (!TargetSocket) return Reply({ ok: false, error: "That player is not connected." });

            TargetSocket.emit("room:kicked", { code: Room.code, reason: "The host removed you from the room." });
            LeaveRoom(TargetSocket, true);
            Room.chatBannedNames.delete(Username);
            Room.moderationRevision += 1;
            EmitRoom(Room);
            Reply({ ok: true });
        } catch (Error) {
            console.error("Kick failed", Error);
            Reply({ ok: false, error: "Could not kick that player." });
        }
    });

    Socket.on("host:chatBan", (Payload, Reply = () => {}) => {
        try {
            const Room = GetRoomForSocket(Socket);
            if (!IsHostSocket(Room, Socket)) return Reply({ ok: false, error: "Only the host can manage chat." });

            const Username = ReadModerationUsername(Payload);
            if (!Username || Username === Room.hostUsername || !Room.memberNames.has(Username)) {
                return Reply({ ok: false, error: "That player cannot be muted." });
            }

            const Banned = Boolean(Payload?.banned);
            if (Banned) Room.chatBannedNames.add(Username);
            else Room.chatBannedNames.delete(Username);
            Room.moderationRevision += 1;

            FindRoomPlayerSocket(Room, Username)?.emit("room:chatBanState", {
                banned: Banned,
                reason: Banned ? "The host disabled your room chat." : "The host restored your room chat."
            });
            EmitRoom(Room);
            Reply({ ok: true, banned: Banned });
        } catch (Error) {
            console.error("Chat moderation failed", Error);
            Reply({ ok: false, error: "Could not change that player's chat permission." });
        }
    });`,
    "host moderation handlers"
);

ReplaceRequired(
    `    Socket.on("room:chat", Payload => {
        const Room = GetRoomForSocket(Socket);
        if (!Room) return;

        const Text = String(Payload?.text || "").trim();
        if (!Text) return;`,
    `    Socket.on("room:chat", Payload => {
        const Room = GetRoomForSocket(Socket);
        if (!Room) return;
        if (Room.chatBannedNames.has(Socket.data.username)) {
            Socket.emit("room:chatError", { error: "The host has disabled your room chat." });
            return;
        }
        if (!Payload || typeof Payload !== "object" || Array.isArray(Payload)) return;

        const Text = CensorChatText(Payload.text);
        if (!Text) return;`,
    "chat moderation"
);

const RuntimeModule = new Module(SourcePath, module);
RuntimeModule.filename = SourcePath;
RuntimeModule.paths = Module._nodeModulePaths(__dirname);
RuntimeModule._compile(Source, SourcePath);
