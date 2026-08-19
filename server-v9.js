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
];`,
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
    `function NormalizeChatForFilter(Value) {
    return String(Value || "")
        .toLowerCase()
        .replace(/[013457@$!]/g, Character => ({
            "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i"
        }[Character] || Character));
}

function CensorChatText(Value) {
    let Text = String(Value || "")
        .replace(/[\\u0000-\\u001F\\u007F]/g, " ")
        .replace(/\\s+/g, " ")
        .trim()
        .slice(0, ChatMaxLength);

    for (const Word of ProfanityWords) {
        const Pattern = new RegExp(`\\\\b${Word.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\\\b`, "gi");
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
