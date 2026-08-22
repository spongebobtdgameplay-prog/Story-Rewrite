const fs = require("fs");
const path = require("path");
const Module = require("module");

const WrapperPath = path.join(__dirname, "server-v11.js");
let WrapperSource = fs.readFileSync(WrapperPath, "utf8");

const V20PatchCode = `ReplaceRequired(
    'const BackendVersion = 19;',
    'const BackendVersion = 20;',
    "backend version 20"
);

ReplaceRequired(
    'function EmitRoom(Room) {',
    \`const HostModerationRestrictions = new Map();
const AutomaticChatTimeoutMilliseconds = 10 * 60 * 1000;
const MaximumModerationDuration = 30 * 24 * 60 * 60 * 1000;

function ModerationKey(HostUsername, TargetUsername) {
    return String(HostUsername || "").toLowerCase() + "::" + String(TargetUsername || "").toLowerCase();
}

function GetHostRestriction(HostUsername, TargetUsername) {
    const Key = ModerationKey(HostUsername, TargetUsername);
    const Restriction = HostModerationRestrictions.get(Key);
    if (!Restriction) return null;
    const Now = Date.now();
    if (Restriction.gameUntil !== Infinity && Number(Restriction.gameUntil || 0) > 0 && Restriction.gameUntil <= Now) Restriction.gameUntil = 0;
    if (Restriction.chatUntil !== Infinity && Number(Restriction.chatUntil || 0) > 0 && Restriction.chatUntil <= Now) Restriction.chatUntil = 0;
    if (!Restriction.gameUntil && !Restriction.chatUntil && !Restriction.gameBanned) {
        HostModerationRestrictions.delete(Key);
        return null;
    }
    return Restriction;
}

function EnsureHostRestriction(HostUsername, TargetUsername) {
    const Key = ModerationKey(HostUsername, TargetUsername);
    let Restriction = HostModerationRestrictions.get(Key);
    if (!Restriction) {
        Restriction = { chatUntil: 0, gameUntil: 0, gameBanned: false, chatReason: "", gameReason: "", chatIssuedBy: "", gameIssuedBy: "" };
        HostModerationRestrictions.set(Key, Restriction);
    }
    return Restriction;
}

function ReadModerationDuration(Payload) {
    const Duration = Number(Payload?.durationMs || 0);
    if (!Number.isFinite(Duration) || Duration <= 0) return 0;
    return Math.min(MaximumModerationDuration, Math.floor(Duration));
}

function IsChatTimedOut(Room, Username) {
    const Restriction = GetHostRestriction(Room?.hostUsername, Username);
    if (!Restriction) return false;
    return Restriction.chatUntil === Infinity || Number(Restriction.chatUntil || 0) > Date.now();
}

function IsGameRestricted(Room, Username) {
    const Restriction = GetHostRestriction(Room?.hostUsername, Username);
    if (!Restriction) return null;
    if (Restriction.gameBanned) return { active: true, banned: true, until: Infinity, reason: Restriction.gameReason || "The host banned you from their games." };
    if (Restriction.gameUntil === Infinity || Number(Restriction.gameUntil || 0) > Date.now()) return { active: true, banned: false, until: Restriction.gameUntil, reason: Restriction.gameReason || "The host temporarily blocked you from joining their games." };
    return null;
}

function ApplyChatTimeout(Room, Username, DurationMilliseconds, Reason, IssuedBy) {
    const Restriction = EnsureHostRestriction(Room.hostUsername, Username);
    Restriction.chatUntil = Date.now() + Math.max(1000, DurationMilliseconds);
    Restriction.chatReason = String(Reason || "Chat timeout").slice(0, 180);
    Restriction.chatIssuedBy = String(IssuedBy || "host");
    Room.chatBannedNames.add(Username);
    Room.moderationRevision += 1;
    const TargetSocket = FindRoomPlayerSocket(Room, Username);
    TargetSocket?.emit("room:chatTimeoutState", { active: true, until: Restriction.chatUntil, reason: Restriction.chatReason, issuedBy: Restriction.chatIssuedBy });
    EmitRoom(Room);
}

function ClearChatTimeout(Room, Username, Reason = "The host removed your chat timeout.") {
    const Restriction = EnsureHostRestriction(Room.hostUsername, Username);
    Restriction.chatUntil = 0;
    Restriction.chatReason = "";
    Restriction.chatIssuedBy = "";
    Room.chatBannedNames.delete(Username);
    Room.moderationRevision += 1;
    FindRoomPlayerSocket(Room, Username)?.emit("room:chatTimeoutState", { active: false, until: 0, reason, issuedBy: "host" });
    EmitRoom(Room);
}

function KickForRepeatedAbuse(Room, Username, Reason) {
    const TargetSocket = FindRoomPlayerSocket(Room, Username);
    if (!TargetSocket) return;
    const StrikeCount = Number(Room.abuseStrikes?.get(Username) || 0);
    TargetSocket.emit("room:kicked", {
        code: Room.code,
        reason: String(Reason || "Repeated abusive behavior after previous warnings and a timeout."),
        moderation: true,
        title: "Removed from game",
        strikes: StrikeCount,
        details: ["Repeated abusive behavior", "Previous warnings were ignored", "A chat timeout had already been issued"]
    });
    LeaveRoom(TargetSocket, true);
    Room.chatBannedNames.delete(Username);
    Room.moderationRevision += 1;
    EmitRoom(Room);
}

function GetPlayerModerationState(Room, Username) {
    const Restriction = GetHostRestriction(Room.hostUsername, Username);
    return {
        chatTimedOut: IsChatTimedOut(Room, Username),
        chatTimeoutUntil: Restriction?.chatUntil || 0,
        chatTimeoutReason: Restriction?.chatReason || "",
        chatTimeoutIssuedBy: Restriction?.chatIssuedBy || "",
        gameTimedOut: Boolean(Restriction && !Restriction.gameBanned && (Restriction.gameUntil === Infinity || Number(Restriction.gameUntil || 0) > Date.now())),
        gameTimeoutUntil: Restriction?.gameUntil || 0,
        gameBanned: Boolean(Restriction?.gameBanned),
        gameReason: Restriction?.gameReason || "",
        gameIssuedBy: Restriction?.gameIssuedBy || ""
    };
}

function EmitRoom(Room) {\`,
    "timed moderation helpers"
);

ReplaceRequired(
    '            chatBanned: Room.chatBannedNames.has(Player.username)',
    '            chatBanned: Room.chatBannedNames.has(Player.username) || IsChatTimedOut(Room, Player.username),\\n            moderation: GetPlayerModerationState(Room, Player.username)',
    "public timed moderation state"
);

ReplaceRequired(
    '            const ReturningMember = Room.memberNames.has(Username);',
    '            const ReturningMember = Room.memberNames.has(Username);\\n            const JoinRestriction = IsGameRestricted(Room, Username);\\n            if (!ReturningMember && JoinRestriction?.active) {\\n                return Reply({ ok: false, error: JoinRestriction.banned ? "The host banned you from games they host." : "The host temporarily blocked you from joining games they host.", moderation: JoinRestriction });\\n            }',
    "host game restriction join gate"
);

ReplaceRequired(
    '        if (Room.chatBannedNames.has(Socket.data.username)) {\\n            Socket.emit("room:chatError", { error: "The host has disabled your room chat." });\\n            return;\\n        }',
    '        if (IsChatTimedOut(Room, Socket.data.username)) {\\n            const Restriction = GetHostRestriction(Room.hostUsername, Socket.data.username);\\n            Room.chatBannedNames.add(Socket.data.username);\\n            Socket.emit("room:chatError", { error: Restriction?.chatReason || "You are temporarily timed out from chat.", until: Restriction?.chatUntil || 0 });\\n            return;\\n        }\\n        if (Room.chatBannedNames.has(Socket.data.username)) {\\n            Socket.emit("room:chatError", { error: "The host has disabled your room chat." });\\n            return;\\n        }',
    "chat timeout gate"
);

ReplaceRequired(
    '    Socket.on("room:leave", () => LeaveRoom(Socket, true));',
    \`    Socket.on("room:leave", () => LeaveRoom(Socket, true));

    Socket.on("host:chatTimeout", (Payload, Reply = () => {}) => {
        try {
            const Room = GetRoomForSocket(Socket);
            if (!IsHostSocket(Room, Socket)) return Reply({ ok: false, error: "Only the host can time out chat." });
            const Username = ReadModerationUsername(Payload);
            const Duration = ReadModerationDuration(Payload);
            if (!Username || Username === Room.hostUsername || !Room.memberNames.has(Username)) return Reply({ ok: false, error: "That player cannot be timed out." });
            if (!Duration) return Reply({ ok: false, error: "Choose a valid timeout duration." });
            const Reason = String(Payload?.reason || "Host chat timeout").trim().slice(0, 180) || "Host chat timeout";
            ApplyChatTimeout(Room, Username, Duration, Reason, "host");
            Reply({ ok: true, until: Date.now() + Duration });
        } catch (Error) {
            console.error("Chat timeout failed", Error);
            Reply({ ok: false, error: "Could not time out that player." });
        }
    });

    Socket.on("host:chatUntimeout", (Payload, Reply = () => {}) => {
        try {
            const Room = GetRoomForSocket(Socket);
            if (!IsHostSocket(Room, Socket)) return Reply({ ok: false, error: "Only the host can remove timeouts." });
            const Username = ReadModerationUsername(Payload);
            if (!Username || Username === Room.hostUsername) return Reply({ ok: false, error: "That player cannot be changed." });
            ClearChatTimeout(Room, Username);
            Reply({ ok: true });
        } catch (Error) {
            Reply({ ok: false, error: "Could not remove that timeout." });
        }
    });

    Socket.on("host:gameTimeout", (Payload, Reply = () => {}) => {
        try {
            const Room = GetRoomForSocket(Socket);
            if (!IsHostSocket(Room, Socket)) return Reply({ ok: false, error: "Only the host can manage game timeouts." });
            const Username = ReadModerationUsername(Payload);
            const Duration = ReadModerationDuration(Payload);
            if (!Username || Username === Room.hostUsername) return Reply({ ok: false, error: "That player cannot be changed." });
            if (!Duration) return Reply({ ok: false, error: "Choose a valid timeout duration." });
            const Restriction = EnsureHostRestriction(Room.hostUsername, Username);
            Restriction.gameUntil = Date.now() + Duration;
            Restriction.gameBanned = false;
            Restriction.gameReason = String(Payload?.reason || "Temporarily blocked from games hosted by this host.").trim().slice(0, 180);
            Restriction.gameIssuedBy = "host";
            FindRoomPlayerSocket(Room, Username)?.emit("room:gameRestrictionState", { active: true, banned: false, until: Restriction.gameUntil, reason: Restriction.gameReason });
            EmitRoom(Room);
            Reply({ ok: true, until: Restriction.gameUntil });
        } catch (Error) {
            Reply({ ok: false, error: "Could not apply that game timeout." });
        }
    });

    Socket.on("host:gameUntimeout", (Payload, Reply = () => {}) => {
        try {
            const Room = GetRoomForSocket(Socket);
            if (!IsHostSocket(Room, Socket)) return Reply({ ok: false, error: "Only the host can remove game timeouts." });
            const Username = ReadModerationUsername(Payload);
            if (!Username || Username === Room.hostUsername) return Reply({ ok: false, error: "That player cannot be changed." });
            const Restriction = EnsureHostRestriction(Room.hostUsername, Username);
            Restriction.gameUntil = 0;
            Restriction.gameBanned = false;
            Restriction.gameReason = "";
            Restriction.gameIssuedBy = "";
            FindRoomPlayerSocket(Room, Username)?.emit("room:gameRestrictionState", { active: false, banned: false, until: 0, reason: "The host removed your game timeout." });
            EmitRoom(Room);
            Reply({ ok: true });
        } catch (Error) {
            Reply({ ok: false, error: "Could not remove that game timeout." });
        }
    });

    Socket.on("host:gameBan", (Payload, Reply = () => {}) => {
        try {
            const Room = GetRoomForSocket(Socket);
            if (!IsHostSocket(Room, Socket)) return Reply({ ok: false, error: "Only the host can ban players from hosted games." });
            const Username = ReadModerationUsername(Payload);
            if (!Username || Username === Room.hostUsername) return Reply({ ok: false, error: "That player cannot be banned." });
            const Restriction = EnsureHostRestriction(Room.hostUsername, Username);
            Restriction.gameBanned = true;
            Restriction.gameUntil = Infinity;
            Restriction.gameReason = String(Payload?.reason || "Banned from games hosted by this host.").trim().slice(0, 180);
            Restriction.gameIssuedBy = "host";
            const TargetSocket = FindRoomPlayerSocket(Room, Username);
            if (TargetSocket) {
                TargetSocket.emit("room:kicked", { code: Room.code, reason: Restriction.gameReason, moderation: true, title: "Banned from host games", details: ["The host banned you from games they host"] });
                LeaveRoom(TargetSocket, true);
            }
            EmitRoom(Room);
            Reply({ ok: true });
        } catch (Error) {
            Reply({ ok: false, error: "Could not ban that player." });
        }
    });

    Socket.on("host:gameUnban", (Payload, Reply = () => {}) => {
        try {
            const Room = GetRoomForSocket(Socket);
            if (!IsHostSocket(Room, Socket)) return Reply({ ok: false, error: "Only the host can unban players." });
            const Username = ReadModerationUsername(Payload);
            if (!Username || Username === Room.hostUsername) return Reply({ ok: false, error: "That player cannot be changed." });
            const Restriction = EnsureHostRestriction(Room.hostUsername, Username);
            Restriction.gameBanned = false;
            Restriction.gameUntil = 0;
            Restriction.gameReason = "";
            Restriction.gameIssuedBy = "";
            EmitRoom(Room);
            Reply({ ok: true });
        } catch (Error) {
            Reply({ ok: false, error: "Could not unban that player." });
        }
    });\`,
    "timed host moderation events"
);

ReplaceRequired(
    '    const Muted = StrikeCount >= 2;\\n    if (Muted) Room.chatBannedNames.add(Message.username);',
    '    const Muted = StrikeCount >= 3;\\n    if (StrikeCount === 3) {\\n        ApplyChatTimeout(Room, Message.username, AutomaticChatTimeoutMilliseconds, "Automatic timeout after 3 confirmed abuse warnings.", "bot");\\n    } else if (StrikeCount >= 4) {\\n        KickForRepeatedAbuse(Room, Message.username, "You continued abusive behavior after three warnings and an automatic chat timeout.");\\n    }',
    "three warning automatic moderation escalation"
);

ReplaceRequired(
    '        muted: Muted,\\n        strikes: StrikeCount',
    '        muted: Muted,\\n        timedOut: StrikeCount === 3,\\n        kicked: StrikeCount >= 4,\\n        timeoutUntil: StrikeCount === 3 ? Date.now() + AutomaticChatTimeoutMilliseconds : 0,\\n        reason: StrikeCount === 3 ? "Automatic timeout after 3 confirmed abuse warnings." : (StrikeCount >= 4 ? "Repeated abuse after previous warnings and timeout." : "Confirmed abusive behavior."),\\n        strikes: StrikeCount',
    "moderation result details"
);`;

const InjectionNeedle = '+ ${JSON.stringify(V19PatchCode)} + "\\n\\nconst RuntimeModule = new Module(SourcePath, module);",`;
if (!WrapperSource.includes(InjectionNeedle)) {
    throw new Error("server-v20 patch failed: v19 injection point");
}

const InjectionReplacement = '+ ${JSON.stringify(V19PatchCode)} + "\\n\\n" + ' + JSON.stringify(V20PatchCode) + ' + "\\n\\nconst RuntimeModule = new Module(SourcePath, module);",`;
WrapperSource = WrapperSource.replace(InjectionNeedle, InjectionReplacement);

const RuntimeModule = new Module(WrapperPath, module);
RuntimeModule.filename = WrapperPath;
RuntimeModule.paths = Module._nodeModulePaths(__dirname);
RuntimeModule._compile(WrapperSource, WrapperPath);
