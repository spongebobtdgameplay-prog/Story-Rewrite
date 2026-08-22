const { Server: SocketServer } = require("socket.io");

const ActiveDeviceSessions = new Map();
const ActiveAccountSessions = new Map();
const OriginalServerOn = SocketServer.prototype.on;

function NormalizeSessionValue(Value, MaximumLength = 160) {
    return String(Value || "").trim().slice(0, MaximumLength);
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
        if (ExistingSession && ExistingSession.socket.id !== Session.socket.id) {
            return ExistingSession;
        }
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
                    }
                    Reply(Result);
                };

                return Listener(Payload, GuardedReply);
            });
        }

        if (EventName === "room:leave") {
            return OriginalSocketOn(EventName, (Payload, Reply = () => {}) => {
                const GuardedReply = Result => {
                    ClearCurrentSession();
                    Reply(Result);
                };

                const Result = Listener(Payload, GuardedReply);
                if (Listener.length < 2) ClearCurrentSession();
                return Result;
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
