const { Server: SocketServer } = require("socket.io");

const ActiveDeviceSessions = new Map();
const ActiveAccountSessions = new Map();
const OriginalServerOn = SocketServer.prototype.on;

function NormalizeSessionValue(Value, MaximumLength = 160) {
    return String(Value || "").trim().slice(0, MaximumLength);
}

function GetConnectedSession(MapValue) {
    if (!MapValue?.socket?.connected) return null;
    return MapValue;
}

function RemoveSessionEntry(Session) {
    if (!Session) return;

    const DeviceSession = ActiveDeviceSessions.get(Session.deviceSignature);
    if (DeviceSession?.socket?.id === Session.socket.id) {
        ActiveDeviceSessions.delete(Session.deviceSignature);
    }

    const AccountSession = ActiveAccountSessions.get(Session.accountKey);
    if (AccountSession?.socket?.id === Session.socket.id) {
        ActiveAccountSessions.delete(Session.accountKey);
    }
}

function InstallSingleSessionGuard(Socket) {
    const Username = NormalizeSessionValue(Socket.data?.username, 32);
    const AccountKey = Username.toLowerCase();
    const DeviceSignature = NormalizeSessionValue(Socket.handshake.auth?.deviceSignature, 128);
    const TabId = NormalizeSessionValue(Socket.handshake.auth?.tabId, 128);

    if (!Username) return;

    const ExistingAccountSession = GetConnectedSession(ActiveAccountSessions.get(AccountKey));
    const ExistingDeviceSession = DeviceSignature
        ? GetConnectedSession(ActiveDeviceSessions.get(DeviceSignature))
        : null;

    const ConflictSession = ExistingAccountSession || ExistingDeviceSession;
    if (ConflictSession && ConflictSession.socket.id !== Socket.id) {
        Socket.emit("session:conflict", {
            code: "OTHER_SESSION_FOUND",
            message: "Other Session found",
            username: ConflictSession.username,
            sameAccount: ConflictSession.accountKey === AccountKey,
            sameDevice: Boolean(DeviceSignature && ConflictSession.deviceSignature === DeviceSignature)
        });
        Socket.disconnect(true);
        return;
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
}

SocketServer.prototype.on = function(EventName, Listener) {
    if (EventName === "connection" && !this.__StorySingleSessionGuardInstalled) {
        this.__StorySingleSessionGuardInstalled = true;
        OriginalServerOn.call(this, "connection", InstallSingleSessionGuard);
    }

    return OriginalServerOn.call(this, EventName, Listener);
};

require("./server-v11.js");
