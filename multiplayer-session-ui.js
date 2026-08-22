function IsOtherSessionError(Error) {
    const Message = String(Error?.message || "");
    const Code = String(Error?.data?.code || "");
    return Code === "OTHER_SESSION_FOUND" || Message === "Other Session found";
}

function ShowMultiplayerSessionConflict(Error) {
    const Panel = document.getElementById("MultiplayerSessionConflict");
    if (!Panel) return;

    const Username = String(Error?.data?.username || "").trim();
    const SameAccount = Boolean(Error?.data?.sameAccount);
    const SameDevice = Boolean(Error?.data?.sameDevice);
    const Detail = document.getElementById("MultiplayerSessionConflictDetail");

    if (Detail) {
        if (SameAccount) {
            Detail.textContent = Username
                ? `${Username} is already connected to multiplayer in another tab, browser, or session.`
                : "This account is already connected to multiplayer somewhere else.";
        } else if (SameDevice) {
            Detail.textContent = Username
                ? `This device already has ${Username} connected to multiplayer. Only one multiplayer session can run on a device at a time.`
                : "This device already has an active multiplayer session. Only one multiplayer session can run on a device at a time.";
        } else {
            Detail.textContent = "Another multiplayer session is already active for this account or device.";
        }
    }

    MultiplayerReadyPromise = null;
    MultiplayerState = null;

    if (MultiplayerSocket) {
        MultiplayerSocket.io.opts.reconnection = false;
        MultiplayerSocket.disconnect();
    }

    HideLobbyStatus();
    document.getElementById("RoomActions")?.classList.add("Hidden");
    document.getElementById("ActiveRoom")?.classList.add("Hidden");
    Panel.classList.remove("Hidden");
}

function HideMultiplayerSessionConflict() {
    document.getElementById("MultiplayerSessionConflict")?.classList.add("Hidden");
}

WaitForSocketConnection = function(Socket, TimeoutMilliseconds) {
    if (Socket.connected) return Promise.resolve();

    return new Promise((Resolve, Reject) => {
        let Settled = false;

        const Finish = (Callback, Value) => {
            if (Settled) return;
            Settled = true;
            clearTimeout(Timeout);
            Socket.off("connect", OnConnect);
            Socket.off("connect_error", OnError);
            Callback(Value);
        };

        const OnConnect = () => Finish(Resolve);
        const OnError = Error => {
            if (IsOtherSessionError(Error)) {
                ShowMultiplayerSessionConflict(Error);
                Finish(Reject, Error);
                return;
            }

            ShowLobbyStatus(FriendlyConnectionError(Error), false);
            const Message = String(Error?.message || "");
            if (Message === "AUTH_REQUIRED" || Message === "DATABASE_UNAVAILABLE") {
                Finish(Reject, Error);
            }
        };

        const Timeout = setTimeout(() => {
            Finish(Reject, new Error("The multiplayer server did not connect in time."));
        }, TimeoutMilliseconds);

        Socket.on("connect", OnConnect);
        Socket.on("connect_error", OnError);
    });
};

const BaseFriendlyConnectionError = FriendlyConnectionError;
FriendlyConnectionError = function(Error) {
    if (IsOtherSessionError(Error)) return "Other Session found";
    return BaseFriendlyConnectionError(Error);
};

window.addEventListener("DOMContentLoaded", () => {
    document.getElementById("MultiplayerSessionReturnButton")?.addEventListener("click", () => {
        window.location.href = typeof BuildStoryUrl === "function" ? BuildStoryUrl("main.html") : "main.html";
    });

    document.getElementById("MultiplayerSessionRetryButton")?.addEventListener("click", async () => {
        HideMultiplayerSessionConflict();
        document.getElementById("RoomActions")?.classList.remove("Hidden");
        MultiplayerSocket = null;
        MultiplayerReadyPromise = null;

        try {
            await EnsureMultiplayerReady();
        } catch (Error) {
            if (IsOtherSessionError(Error)) ShowMultiplayerSessionConflict(Error);
            else ShowLobbyStatus(FriendlyConnectionError(Error), false);
        }
    });
});