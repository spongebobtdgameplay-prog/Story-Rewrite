let MultiplayerReconnectAttempts = 0;
let MultiplayerReconnectTimer = null;
let MultiplayerRoomRejoinInFlight = false;

const MULTIPLAYER_BACKEND_RETRIES = 8;
const MULTIPLAYER_SOCKET_WAIT_MS = 45000;
const MULTIPLAYER_SCRIPT_RETRIES = 4;
const MULTIPLAYER_ACK_RETRIES = 2;

function MultiplayerSleep(Milliseconds) {
    return new Promise(Resolve => setTimeout(Resolve, Milliseconds));
}

function IsFatalMultiplayerError(Error) {
    const Message = String(Error?.message || Error || "");
    return Message === "AUTH_REQUIRED" || Error?.status === 401;
}

function SetMultiplayerConnectionStatus(Text, Target = "lobby", Tone = "neutral") {
    const Status = Target === "room"
        ? (document.getElementById("RoomStatus") || document.getElementById("LobbyStatus"))
        : document.getElementById("LobbyStatus");

    if (!Status) return;

    if (!Text) {
        Status.className = "StatusText Hidden";
        Status.textContent = "";
        return;
    }

    Status.className = Tone === "bad"
        ? "StatusText Bad"
        : Tone === "good"
            ? "StatusText Good"
            : "StatusText";
    Status.textContent = Text;
}

async function RetryMultiplayerAction(Action, Attempts = 4) {
    let LastError = null;

    for (let Attempt = 0; Attempt < Attempts; Attempt += 1) {
        try {
            return await Action();
        } catch (Error) {
            LastError = Error;
            if (IsFatalMultiplayerError(Error)) throw Error;
            if (Attempt < Attempts - 1) {
                await MultiplayerSleep(Math.min(750 * (Attempt + 1), 2500));
            }
        }
    }

    throw LastError || new Error("The multiplayer server did not respond.");
}

EnsureBackendVersion = async function() {
    let LastError = null;

    for (let Attempt = 0; Attempt < MULTIPLAYER_BACKEND_RETRIES; Attempt += 1) {
        try {
            const Health = await ApiRequest("/api/health");
            const Version = Number(Health?.version || 0);

            if (!Health?.ok || !Health?.multiplayer) {
                throw new Error("MULTIPLAYER_NOT_READY");
            }

            if (Version < REQUIRED_MULTIPLAYER_SERVER_VERSION) {
                SetMultiplayerConnectionStatus("The multiplayer server is updating...", "lobby", "neutral");
                LastError = new Error("MULTIPLAYER_UPDATING");
            } else {
                return Health;
            }
        } catch (Error) {
            LastError = Error;
            if (IsFatalMultiplayerError(Error)) throw Error;
        }

        if (Attempt < MULTIPLAYER_BACKEND_RETRIES - 1) {
            const Delay = Math.min(700 + Attempt * 900, 6500);
            SetMultiplayerConnectionStatus(
                Attempt < 2 ? "Waking the multiplayer server..." : "Still connecting to multiplayer...",
                "lobby",
                "neutral"
            );
            await MultiplayerSleep(Delay);
        }
    }

    throw LastError || new Error("MULTIPLAYER_UNREACHABLE");
};

LoadSocketClient = function() {
    if (typeof io === "function") return Promise.resolve();
    if (SocketClientPromise) return SocketClientPromise;

    SocketClientPromise = (async () => {
        let LastError = null;

        for (let Attempt = 0; Attempt < MULTIPLAYER_SCRIPT_RETRIES; Attempt += 1) {
            try {
                await new Promise((Resolve, Reject) => {
                    document.querySelectorAll('script[data-story-socket-client="1"]').forEach(Script => Script.remove());

                    const Script = document.createElement("script");
                    Script.src = `${SOCKET_CLIENT_URL}?v=8&r=${Date.now()}`;
                    Script.async = true;
                    Script.crossOrigin = "anonymous";
                    Script.dataset.storySocketClient = "1";

                    const Timeout = setTimeout(() => {
                        Script.remove();
                        Reject(new Error("SOCKET_CLIENT_TIMEOUT"));
                    }, 15000);

                    Script.addEventListener("load", () => {
                        clearTimeout(Timeout);
                        if (typeof io === "function") Resolve();
                        else Reject(new Error("SOCKET_CLIENT_INVALID"));
                    }, { once: true });

                    Script.addEventListener("error", () => {
                        clearTimeout(Timeout);
                        Script.remove();
                        Reject(new Error("SOCKET_CLIENT_LOAD_FAILED"));
                    }, { once: true });

                    document.head.appendChild(Script);
                });

                return;
            } catch (Error) {
                LastError = Error;
                if (Attempt < MULTIPLAYER_SCRIPT_RETRIES - 1) {
                    SetMultiplayerConnectionStatus("Preparing multiplayer...", "lobby", "neutral");
                    await MultiplayerSleep(800 * (Attempt + 1));
                }
            }
        }

        throw LastError || new Error("SOCKET_CLIENT_LOAD_FAILED");
    })();

    SocketClientPromise.catch(() => {
        SocketClientPromise = null;
    });

    return SocketClientPromise;
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

InitializeMultiplayer = async function() {
    SetMultiplayerConnectionStatus("Connecting to multiplayer...", "lobby", "neutral");

    await EnsureBackendVersion();

    const ProfileResult = await RetryMultiplayerAction(() => RequireAccount(), 4);
    CurrentProfile = ProfileResult.profile;

    const Save = await RetryMultiplayerAction(() => FetchServerSave(), 4);
    if (window.StoryAudio) {
        StoryAudio.Configure(Save.settings);
        StoryAudio.PlayMusic("lobby");
    }

    await LoadSocketClient();

    if (MultiplayerSocket) {
        MultiplayerSocket.removeAllListeners();
        MultiplayerSocket.disconnect();
    }

    MultiplayerSocket = ConnectStorySocket();
    BindSocket(MultiplayerSocket);
    await WaitForSocketConnection(MultiplayerSocket, MULTIPLAYER_SOCKET_WAIT_MS);
    SetMultiplayerConnectionStatus("", "lobby");
    return MultiplayerSocket;
};

WaitForSocketConnection = function(Socket, TimeoutMilliseconds = MULTIPLAYER_SOCKET_WAIT_MS) {
    if (Socket.connected) return Promise.resolve();

    return new Promise((Resolve, Reject) => {
        let Settled = false;

        const Cleanup = () => {
            clearTimeout(Timeout);
            clearInterval(NudgeTimer);
            Socket.off("connect", OnConnect);
            Socket.off("connect_error", OnError);
        };

        const Finish = (Callback, Value) => {
            if (Settled) return;
            Settled = true;
            Cleanup();
            Callback(Value);
        };

        const OnConnect = () => Finish(Resolve);

        const OnError = Error => {
            if (IsFatalMultiplayerError(Error)) {
                Finish(Reject, Error);
                return;
            }

            MultiplayerReconnectAttempts += 1;
            SetMultiplayerConnectionStatus(
                MultiplayerReconnectAttempts <= 2
                    ? "Connecting to multiplayer..."
                    : "Multiplayer is reconnecting...",
                "lobby",
                "neutral"
            );
        };

        const NudgeTimer = setInterval(() => {
            if (!Socket.connected && !Socket.active) Socket.connect();
        }, 3000);

        const Timeout = setTimeout(() => {
            Finish(Reject, new Error("MULTIPLAYER_CONNECT_TIMEOUT"));
        }, TimeoutMilliseconds);

        Socket.on("connect", OnConnect);
        Socket.on("connect_error", OnError);

        if (!Socket.active) Socket.connect();
    });
};

async function RejoinMultiplayerRoom(Socket) {
    if (MultiplayerRoomRejoinInFlight) return;

    const Code = String(MultiplayerState?.code || "").trim().toUpperCase();
    if (!Code || !Socket.connected) return;

    MultiplayerRoomRejoinInFlight = true;
    SetMultiplayerConnectionStatus("Rejoining your room...", "room", "neutral");

    try {
        const Result = await new Promise(Resolve => {
            Socket.timeout(10000).emit("room:join", { code: Code }, (Error, Reply) => {
                if (Error) Resolve({ ok: false, retryable: true });
                else Resolve(Reply || { ok: false, retryable: true });
            });
        });

        if (Result?.ok) {
            MultiplayerState = Result.state;
            RenderRoom();
            SetMultiplayerConnectionStatus("", "room");
            return;
        }

        if (Result?.error === "Game code not found.") {
            SetMultiplayerConnectionStatus("This room has expired.", "room", "bad");
        } else {
            SetMultiplayerConnectionStatus("Reconnecting to your room...", "room", "neutral");
        }
    } finally {
        MultiplayerRoomRejoinInFlight = false;
    }
}

BindSocket = function(Socket) {
    if (typeof BindChatModerationSocket === "function") BindChatModerationSocket(Socket);

    Socket.on("connect", () => {
        MultiplayerReconnectAttempts = 0;
        if (MultiplayerReconnectTimer) {
            clearTimeout(MultiplayerReconnectTimer);
            MultiplayerReconnectTimer = null;
        }

        if (MultiplayerState?.code) {
            RejoinMultiplayerRoom(Socket);
        } else {
            SetMultiplayerConnectionStatus("", "lobby");
        }
    });

    Socket.on("disconnect", Reason => {
        if (Reason === "io client disconnect") return;

        const Target = MultiplayerState ? "room" : "lobby";
        SetMultiplayerConnectionStatus("Reconnecting to multiplayer...", Target, "neutral");

        if (MultiplayerReconnectTimer) clearTimeout(MultiplayerReconnectTimer);
        MultiplayerReconnectTimer = setTimeout(() => {
            if (!Socket.connected && !Socket.active) Socket.connect();
        }, 900);
    });

    Socket.on("connect_error", Error => {
        if (IsFatalMultiplayerError(Error)) {
            const Target = MultiplayerState ? "room" : "lobby";
            SetMultiplayerConnectionStatus("Your sign-in expired. Sign in again.", Target, "bad");
            return;
        }

        MultiplayerReconnectAttempts += 1;
        const Target = MultiplayerState ? "room" : "lobby";
        SetMultiplayerConnectionStatus(
            MultiplayerReconnectAttempts < 4
                ? "Reconnecting to multiplayer..."
                : "Still reconnecting — keeping your room state...",
            Target,
            "neutral"
        );

        if (!Socket.active) {
            if (MultiplayerReconnectTimer) clearTimeout(MultiplayerReconnectTimer);
            MultiplayerReconnectTimer = setTimeout(() => Socket.connect(), Math.min(1000 + MultiplayerReconnectAttempts * 500, 5000));
        }
    });

    Socket.io.on("reconnect_attempt", Attempt => {
        MultiplayerReconnectAttempts = Attempt;
        const Target = MultiplayerState ? "room" : "lobby";
        SetMultiplayerConnectionStatus("Reconnecting to multiplayer...", Target, "neutral");
    });

    Socket.io.on("reconnect", () => {
        MultiplayerReconnectAttempts = 0;
        if (MultiplayerState?.code) RejoinMultiplayerRoom(Socket);
        else SetMultiplayerConnectionStatus("", "lobby");
    });

    Socket.on("room:state", State => {
        const PreviousCount = MultiplayerState?.players?.length || 0;
        MultiplayerState = State;
        if ((State?.players?.length || 0) > PreviousCount && PreviousCount > 0) {
            StoryAudio?.PlaySound?.("join");
        }
        RenderRoom();
        SetMultiplayerConnectionStatus("", "room");
    });

    Socket.on("room:chat", Message => {
        StoryAudio?.PlaySound?.("message");
        AppendChat(Message);
    });

    Socket.on("room:chatError", Payload => {
        ShowRoomStatus(Payload?.error || "Chat message was blocked.", false);
    });

    Socket.on("game:started", Payload => {
        if (StartingRoom) return;
        StoryAudio?.PlaySound?.("ready");
        GoStage(Payload.stageId, Payload.code);
    });
};

FriendlyConnectionError = function(Error) {
    const Message = String(Error?.message || Error || "");

    if (Message === "AUTH_REQUIRED" || Error?.status === 401) return "Your sign-in expired. Sign in again.";
    if (Message === "MULTIPLAYER_UPDATING") return "The multiplayer server is updating. Try again shortly.";
    if (Message === "MULTIPLAYER_CONNECT_TIMEOUT" || Message === "MULTIPLAYER_UNREACHABLE") {
        return "The multiplayer server could not be reached after several retries.";
    }
    if (Message === "SOCKET_CLIENT_LOAD_FAILED" || Message === "SOCKET_CLIENT_TIMEOUT" || Message === "SOCKET_CLIENT_INVALID") {
        return "The multiplayer client could not load after several retries.";
    }
    if (Message === "DATABASE_UNAVAILABLE") return "The account database is waking up. Try again in a moment.";
    if (/transport|websocket|poll|connection|xhr|timeout/i.test(Message)) {
        return "The multiplayer server is temporarily unreachable. Try again in a moment.";
    }

    return Message || "The multiplayer server is temporarily unavailable.";
};

EmitWithAck = async function(EventName, Payload, TimeoutMilliseconds = 12000) {
    let LastError = null;

    for (let Attempt = 0; Attempt <= MULTIPLAYER_ACK_RETRIES; Attempt += 1) {
        try {
            if (!MultiplayerSocket?.connected) await EnsureMultiplayerReady();

            return await new Promise((Resolve, Reject) => {
                MultiplayerSocket.timeout(TimeoutMilliseconds).emit(EventName, Payload, (Error, Result) => {
                    if (Error) Reject(new Error("MULTIPLAYER_ACK_TIMEOUT"));
                    else Resolve(Result);
                });
            });
        } catch (Error) {
            LastError = Error;
            if (IsFatalMultiplayerError(Error) || Attempt >= MULTIPLAYER_ACK_RETRIES) break;
            SetMultiplayerConnectionStatus("Reconnecting before retrying...", MultiplayerState ? "room" : "lobby", "neutral");
            MultiplayerReadyPromise = null;
            await MultiplayerSleep(900 * (Attempt + 1));
        }
    }

    if (LastError?.message === "MULTIPLAYER_ACK_TIMEOUT") {
        throw new Error("The multiplayer server did not answer after several retries.");
    }

    throw LastError || new Error("The multiplayer server did not answer.");
};
