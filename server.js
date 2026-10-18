const { Server: SocketServer } = require("socket.io");

const ActiveDeviceSessions = new Map();
const ActiveAccountSessions = new Map();
const DeveloperUsernames = new Set([
    "darius56",
    ...String(process.env.STORY_REWRITE_DEVELOPER_USERNAMES || "").split(",")
].map(Username => String(Username || "").trim().toLowerCase()).filter(Boolean));
const DeveloperObserverBlockedEvents = new Set([
    "room:ready",
    "room:start",
    "game:vote",
    "game:check",
    "game:retry",
    "game:next",
    "game:restartChapter",
    "game:revive",
    "host:kick",
    "host:chatBan",
    "host:approveJoin",
    "host:declineJoin"
]);
const OriginalServerOn = SocketServer.prototype.on;

function NormalizeSessionValue(Value, MaximumLength = 160) {
    return String(Value || "").trim().slice(0, MaximumLength);
}

function IsDeveloperUsername(Value) {
    return DeveloperUsernames.has(NormalizeSessionValue(Value, 32).toLowerCase());
}

function GetConnectedSession(MapValue) {
    return MapValue?.socket?.connected ? MapValue : null;
}

function ReleaseSession(Session) {
    if (!Session) return;

    if (Session.deviceSignature) {
        const DeviceSession = ActiveDeviceSessions.get(Session.deviceSignature);
        if (DeviceSession?.socket?.id === Session.socket.id) {
            ActiveDeviceSessions.delete(Session.deviceSignature);
        }
    }

    const AccountSession = ActiveAccountSessions.get(Session.accountKey);
    if (AccountSession?.socket?.id === Session.socket.id) {
        ActiveAccountSessions.delete(Session.accountKey);
    }
}

function BuildSession(Socket) {
    const Username = NormalizeSessionValue(Socket.data?.username, 32);
    return {
        socket: Socket,
        username: Username,
        accountKey: Username.toLowerCase(),
        deviceSignature: NormalizeSessionValue(Socket.handshake.auth?.deviceSignature, 128),
        tabId: NormalizeSessionValue(Socket.handshake.auth?.tabId, 128),
        joinedAt: Date.now()
    };
}

function FindSessionConflict(Session) {
    const AccountSession = GetConnectedSession(ActiveAccountSessions.get(Session.accountKey));
    const DeviceSession = Session.deviceSignature
        ? GetConnectedSession(ActiveDeviceSessions.get(Session.deviceSignature))
        : null;

    for (const ExistingSession of [AccountSession, DeviceSession]) {
        if (!ExistingSession || ExistingSession.socket.id === Session.socket.id) continue;

        // A navigation can briefly leave the previous socket connected while the
        // same browser tab opens the next page. Reuse that tab session instead
        // of blocking the new connection as a second active session.
        if (
            ExistingSession.tabId
            && Session.tabId
            && ExistingSession.tabId === Session.tabId
        ) {
            continue;
        }

        return ExistingSession;
    }

    return null;
}

function RegisterSession(Session) {
    ActiveAccountSessions.set(Session.accountKey, Session);
    if (Session.deviceSignature) ActiveDeviceSessions.set(Session.deviceSignature, Session);
}

function BuildConflictResult(Session, ExistingSession) {
    return {
        ok: false,
        error: "Other Session found",
        code: "OTHER_SESSION_FOUND",
        data: {
            code: "OTHER_SESSION_FOUND",
            username: ExistingSession.username,
            sameAccount: ExistingSession.accountKey === Session.accountKey,
            sameDevice: Boolean(
                Session.deviceSignature
                && ExistingSession.deviceSignature === Session.deviceSignature
            )
        }
    };
}

function InstallRoomSessionGuard(Socket) {
    const OriginalSocketOn = Socket.on.bind(Socket);
    let CurrentSession = null;

    const ClearCurrentSession = () => {
        ReleaseSession(CurrentSession);
        CurrentSession = null;
    };

    OriginalSocketOn("disconnect", ClearCurrentSession);

    Socket.on = function(EventName, Listener) {
        if (EventName === "dev:observe") {
            return OriginalSocketOn(EventName, (Payload, Reply = () => {}) => {
                if (!IsDeveloperUsername(Socket.data?.username)) {
                    return Reply({ ok: false, error: "Developer access required." });
                }

                const Session = BuildSession(Socket);
                const Conflict = FindSessionConflict(Session);
                if (Conflict) {
                    Reply(BuildConflictResult(Session, Conflict));
                    return;
                }

                const GuardedReply = Result => {
                    if (Result?.ok) {
                        ClearCurrentSession();
                        CurrentSession = Session;
                        RegisterSession(Session);
                        Socket.data.devObserver = Boolean(Result.observer);
                        Socket.data.devObservedRoomCode = String(Result.code || "");
                    }
                    Reply(Result);
                };

                return Listener(Payload, GuardedReply);
            });
        }

        if (EventName === "room:join") {
            return OriginalSocketOn(EventName, (Payload, Reply = () => {}) => {
                const Session = BuildSession(Socket);
                const Conflict = FindSessionConflict(Session);

                if (Conflict) {
                    Reply(BuildConflictResult(Session, Conflict));
                    return;
                }

                const GuardedReply = Result => {
                    if (Result?.ok) {
                        ClearCurrentSession();
                        CurrentSession = Session;
                        RegisterSession(Session);
                        Socket.data.devObserver = false;
                        Socket.data.devObservedRoomCode = "";
                    }
                    Reply(Result);
                };

                return Listener(Payload, GuardedReply);
            });
        }

        if (EventName === "room:leave") {
            return OriginalSocketOn(EventName, (Payload, Reply = () => {}) => {
                const ClearDeveloperObserver = () => {
                    Socket.data.devObserver = false;
                    Socket.data.devObservedRoomCode = "";
                    ClearCurrentSession();
                };
                const GuardedReply = Result => {
                    ClearDeveloperObserver();
                    Reply(Result);
                };

                const Result = Listener(Payload, GuardedReply);
                if (Listener.length < 2) ClearDeveloperObserver();
                return Result;
            });
        }

        if (DeveloperObserverBlockedEvents.has(EventName)) {
            return OriginalSocketOn(EventName, (...Args) => {
                if (!Socket.data?.devObserver) return Listener(...Args);

                const Result = {
                    ok: false,
                    error: "Developer observer mode is read-only for gameplay controls."
                };
                let Reply = null;
                for (const Argument of Args) {
                    if (typeof Argument === "function") Reply = Argument;
                }
                if (Reply) Reply(Result);
                Socket.emit("dev:actionDenied", { event: EventName, error: Result.error });
            });
        }

        if (EventName === "room:chat") {
            return OriginalSocketOn(EventName, Payload => {
                if (Socket.data?.devObserver && /^\s*\d+\s*$/.test(String(Payload?.text || ""))) {
                    Socket.emit("room:chatError", { error: "Developer observers can chat, but cannot cast gameplay votes." });
                    return;
                }
                return Listener(Payload);
            });
        }

        return OriginalSocketOn(EventName, Listener);
    };
}

SocketServer.prototype.on = function(EventName, Listener) {
    if (EventName === "connection") {
        return OriginalServerOn.call(this, EventName, Socket => {
            InstallRoomSessionGuard(Socket);
            return Listener(Socket);
        });
    }

    return OriginalServerOn.call(this, EventName, Listener);
};

require("./server-v11.js");
