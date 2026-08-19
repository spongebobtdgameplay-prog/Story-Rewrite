let GameReconnectAttempts = 0;
let GameReconnectTimer = null;

function SetGameConnectionStatus(Text, Tone = "neutral") {
    const Status = document.getElementById("StatusText");
    if (!Status) return;

    Status.className = Tone === "bad"
        ? "StatusText Bad"
        : Tone === "good"
            ? "StatusText Good"
            : "StatusText";
    Status.textContent = Text;
}

function GameConnectionIsFatal(Error) {
    return String(Error?.message || Error || "") === "AUTH_REQUIRED";
}

StartMultiplayer = function() {
    document.getElementById("MultiplayerDock")?.classList.remove("Hidden");
    const RoomLabel = document.getElementById("MultiplayerRoomLabel");
    if (RoomLabel) RoomLabel.textContent = `Room ${RoomCode}`;

    MultiplayerSocket = ConnectStorySocket();

    const JoinCurrentRoom = () => {
        if (!MultiplayerSocket?.connected) return;

        SetGameConnectionStatus("Rejoining the multiplayer room...");
        MultiplayerSocket.timeout(12000).emit("room:join", { code: RoomCode }, (Error, Result) => {
            if (Error) {
                SetGameConnectionStatus("Reconnecting to multiplayer...");
                return;
            }

            if (!Result?.ok) {
                SetGameConnectionStatus(Result?.error || "Could not rejoin the multiplayer room.", "bad");
                return;
            }

            GameReconnectAttempts = 0;
            MultiplayerState = Result.state;
            ApplyRoomState(Result.state);
            SetGameConnectionStatus("Connected to the room.", "good");
            setTimeout(() => {
                if (document.getElementById("StatusText")?.textContent === "Connected to the room.") {
                    SetGameConnectionStatus("Vote on the story, then let the host check survival.");
                }
            }, 1200);
        });
    };

    MultiplayerSocket.on("connect", () => {
        GameReconnectAttempts = 0;
        if (GameReconnectTimer) {
            clearTimeout(GameReconnectTimer);
            GameReconnectTimer = null;
        }
        JoinCurrentRoom();
    });

    MultiplayerSocket.on("disconnect", Reason => {
        if (Reason === "io client disconnect") return;
        SetGameConnectionStatus("Reconnecting to multiplayer...");

        if (GameReconnectTimer) clearTimeout(GameReconnectTimer);
        GameReconnectTimer = setTimeout(() => {
            if (!MultiplayerSocket.connected && !MultiplayerSocket.active) MultiplayerSocket.connect();
        }, 900);
    });

    MultiplayerSocket.on("connect_error", Error => {
        if (GameConnectionIsFatal(Error)) {
            SetGameConnectionStatus("Your sign-in expired. Sign in again.", "bad");
            return;
        }

        GameReconnectAttempts += 1;
        SetGameConnectionStatus(
            GameReconnectAttempts < 4
                ? "Reconnecting to multiplayer..."
                : "Still reconnecting — your room is being kept open..."
        );

        if (!MultiplayerSocket.active) {
            if (GameReconnectTimer) clearTimeout(GameReconnectTimer);
            GameReconnectTimer = setTimeout(
                () => MultiplayerSocket.connect(),
                Math.min(1000 + GameReconnectAttempts * 500, 5000)
            );
        }
    });

    MultiplayerSocket.on("room:state", State => {
        MultiplayerState = State;
        ApplyRoomState(State);
    });

    MultiplayerSocket.on("room:chat", Message => AppendGameChat(Message));
    MultiplayerSocket.on("room:chatError", Payload => {
        SetGameConnectionStatus(Payload?.error || "Chat message was blocked.", "bad");
    });
    MultiplayerSocket.on("game:outcome", HandleMultiplayerOutcome);
    MultiplayerSocket.on("game:retry", () => {
        RemovedSentences.clear();
        LastCheckFailed = false;
        document.getElementById("Aftermath")?.classList.add("Hidden");
        document.getElementById("CompleteOverlay")?.classList.remove("Show");
        StoryAudio.PlayMusic(World.theme || "menu");
        RenderStage();
    });
    MultiplayerSocket.on("game:stage", Payload => {
        window.location.href = `dialog.html?stage=${encodeURIComponent(Payload.stageId)}&room=${encodeURIComponent(RoomCode)}`;
    });
    MultiplayerSocket.on("game:finished", () => document.getElementById("TbcOverlay")?.classList.add("Show"));
};

ConnectStorySocket = function() {
    if (typeof io !== "function") throw new Error("Socket.IO client did not load.");

    const ServerUrl = GetServerUrl();
    if (!ServerUrl) throw new Error("Multiplayer server is not configured.");

    return io(ServerUrl, {
        auth: { token: GetAuthToken() },
        transports: ["polling", "websocket"],
        upgrade: true,
        rememberUpgrade: true,
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 700,
        reconnectionDelayMax: 5000,
        randomizationFactor: 0.45,
        timeout: 20000,
        forceNew: true
    });
};
