const { Server: SocketServer } = require("socket.io");

const ActiveDeviceSessions = new Map();
const ActiveAccountSessions = new Map();
const OriginalServerUse = SocketServer.prototype.use;

function NormalizeSessionValue(Value, MaximumLength = 160) {
    return String(Value || "").trim().slice(0, MaximumLength);
}

function GetConnectedSession(MapValue) {
    if (!MapValue?.socket?.connected) return null;
    return MapValue;
}

function RemoveSessionEntry(Session) {
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

function EnforceSingleSession(Socket, Next) {
    const Username = NormalizeSessionValue(Socket.data?.username, 32);
    if (!Username) return Next();

    const AccountKey = Username.toLowerCase();
    const DeviceSignature = NormalizeSessionValue(Socket.handshake.auth?.deviceSignature, 128);
    const TabId = NormalizeSessionValue(Socket.handshake.auth?.tabId, 128);
    const ExistingAccountSession = GetConnectedSession(ActiveAccountSessions.get(AccountKey));
    const ExistingDeviceSession = DeviceSignature
        ? GetConnectedSession(ActiveDeviceSessions.get(DeviceSignature))
        : null;
    const ConflictSession = ExistingAccountSession || ExistingDeviceSession;

    if (ConflictSession && ConflictSession.socket.id !== Socket.id) {
        const Error = new Error("Other Session found");
        Error.data = {
            code: "OTHER_SESSION_FOUND",
            username: ConflictSession.username,
            sameAccount: ConflictSession.accountKey === AccountKey,
            sameDevice: Boolean(DeviceSignature && ConflictSession.deviceSignature === DeviceSignature)
        };
        return Next(Error);
    }

    const Session = {
        socket: Socket,
        username: Username,
        accountKey: AccountKey,
        deviceSignature: DeviceSignature,
        tabId: TabId,
        connectedAt: Date.now()
    };

    ActiveAccountSessions.set(AccountKey, Session);
    if (DeviceSignature) ActiveDeviceSessions.set(DeviceSignature, Session);
    Socket.once("disconnect", () => RemoveSessionEntry(Session));
    Next();
}

SocketServer.prototype.use = function(Middleware) {
    const WrappedMiddleware = (Socket, Next) => {
        let Finished = false;

        const FinishOriginalMiddleware = Error => {
            if (Finished) return;
            Finished = true;
            if (Error) return Next(Error);

            try {
                EnforceSingleSession(Socket, Next);
            } catch (SessionError) {
                console.error("Multiplayer session guard failed", SessionError);
                Next(new Error("Could not verify multiplayer session."));
            }
        };

        try {
            const Result = Middleware(Socket, FinishOriginalMiddleware);
            if (Result && typeof Result.then === "function") {
                Result.catch(FinishOriginalMiddleware);
            }
        } catch (Error) {
            FinishOriginalMiddleware(Error);
        }
    };

    return OriginalServerUse.call(this, WrappedMiddleware);
};

require("./server-v11.js");
