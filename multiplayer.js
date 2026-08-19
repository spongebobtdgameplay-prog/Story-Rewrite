let MultiplayerSocket = null;
let MultiplayerState = null;
let CurrentProfile = null;
let LocalReady = false;
let MultiplayerReadyPromise = null;
let SocketClientPromise = null;

const SOCKET_CLIENT_URL = "https://cdn.socket.io/4.8.3/socket.io.min.js";

window.addEventListener("DOMContentLoaded", () => {
    BindUi();
    EnsureMultiplayerReady().catch(Error => {
        ShowLobbyStatus(FriendlyConnectionError(Error), false);
    });
});

function BindUi() {
    document.getElementById("CreateRoomButton").addEventListener("click", CreateRoom);
    document.getElementById("JoinRoomButton").addEventListener("click", JoinRoom);
    document.getElementById("JoinCodeInput").addEventListener("input", Event => {
        Event.target.value = Event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    });
    document.getElementById("CopyCodeButton").addEventListener("click", CopyCode);
    document.getElementById("ReadyButton").addEventListener("click", ToggleReady);
    document.getElementById("StartButton").addEventListener("click", StartRoom);
    document.getElementById("LeaveButton").addEventListener("click", LeaveRoom);
    document.getElementById("ChatForm").addEventListener("submit", SendChat);
}

async function EnsureMultiplayerReady() {
    if (MultiplayerSocket?.connected && CurrentProfile) return MultiplayerSocket;

    if (!MultiplayerReadyPromise) {
        MultiplayerReadyPromise = InitializeMultiplayer();
    }

    try {
        return await MultiplayerReadyPromise;
    } catch (Error) {
        MultiplayerReadyPromise = null;
        throw Error;
    }
}

async function InitializeMultiplayer() {
    ShowLobbyStatus("Connecting to the game server...", null);

    const ProfileResult = await RequireAccount();
    CurrentProfile = ProfileResult.profile;

    const Save = await FetchServerSave();
    StoryAudio.Configure(Save.settings);
    StoryAudio.PlayMusic("lobby");

    await LoadSocketClient();

    if (MultiplayerSocket) {
        MultiplayerSocket.removeAllListeners();
        MultiplayerSocket.disconnect();
    }

    MultiplayerSocket = ConnectStorySocket();
    BindSocket(MultiplayerSocket);
    await WaitForSocketConnection(MultiplayerSocket, 20000);
    HideLobbyStatus();
    return MultiplayerSocket;
}

function LoadSocketClient() {
    if (typeof io === "function") return Promise.resolve();
    if (SocketClientPromise) return SocketClientPromise;

    SocketClientPromise = new Promise((Resolve, Reject) => {
        const Existing = document.querySelector('script[data-story-socket-client="1"]');
        if (Existing) Existing.remove();

        const Script = document.createElement("script");
        Script.src = SOCKET_CLIENT_URL;
        Script.async = true;
        Script.crossOrigin = "anonymous";
        Script.dataset.storySocketClient = "1";

        Script.addEventListener("load", () => {
            if (typeof io === "function") Resolve();
            else Reject(new Error("Socket.IO client did not initialize."));
        }, { once: true });

        Script.addEventListener("error", () => {
            SocketClientPromise = null;
            Reject(new Error("Could not load the multiplayer client."));
        }, { once: true });

        document.head.appendChild(Script);
    });

    return SocketClientPromise;
}

function WaitForSocketConnection(Socket, TimeoutMilliseconds) {
    if (Socket.connected) return Promise.resolve();

    return new Promise((Resolve, Reject) => {
        let Settled = false;

        const Cleanup = () => {
            clearTimeout(Timeout);
            Socket.off("connect", OnConnect);
            Socket.off("connect_error", OnError);
        };

        const Finish = Callback => Value => {
            if (Settled) return;
            Settled = true;
            Cleanup();
            Callback(Value);
        };

        const OnConnect = Finish(() => Resolve());
        const OnError = Error => {
            const Message = Error?.message || "Connection failed.";
            ShowLobbyStatus(FriendlyConnectionError(Error), false);

            if (Message === "AUTH_REQUIRED" || Message === "DATABASE_UNAVAILABLE") {
                Finish(Reject)(Error);
            }
        };

        const Timeout = setTimeout(() => {
            Finish(Reject)(new Error("The multiplayer server did not connect in time."));
        }, TimeoutMilliseconds);

        Socket.on("connect", OnConnect);
        Socket.on("connect_error", OnError);
    });
}

function BindSocket(Socket) {
    Socket.on("connect", () => {
        if (!MultiplayerState) HideLobbyStatus();
    });

    Socket.on("disconnect", () => {
        if (MultiplayerState) {
            ShowRoomStatus("Connection lost. Reconnecting...", false);
        } else {
            ShowLobbyStatus("Connection lost. Reconnecting...", false);
        }
    });

    Socket.on("connect_error", Error => {
        const Message = FriendlyConnectionError(Error);
        if (MultiplayerState) ShowRoomStatus(Message, false);
        else ShowLobbyStatus(Message, false);
    });

    Socket.on("room:state", State => {
        const PreviousCount = MultiplayerState?.players?.length || 0;
        MultiplayerState = State;
        if (State.players.length > PreviousCount && PreviousCount > 0) StoryAudio.PlaySound("join");
        RenderRoom();
    });

    Socket.on("room:chat", Message => {
        StoryAudio.PlaySound("message");
        AppendChat(Message);
    });

    Socket.on("game:started", Payload => {
        StoryAudio.PlaySound("ready");
        GoStage(Payload.stageId, Payload.code);
    });
}

function FriendlyConnectionError(Error) {
    const Message = String(Error?.message || Error || "");

    if (Message === "AUTH_REQUIRED") return "Your sign-in expired. Sign in again.";
    if (Message === "DATABASE_UNAVAILABLE") return "The account database is temporarily unavailable.";
    if (Message.includes("timeout") || Message.includes("did not connect")) return "The multiplayer server is taking too long to respond. Try again.";
    if (Message.includes("load the multiplayer client")) return "The multiplayer client could not load. Refresh and try again.";
    return Message || "Could not connect to multiplayer.";
}

function EmitWithAck(EventName, Payload, TimeoutMilliseconds = 12000) {
    return new Promise((Resolve, Reject) => {
        if (!MultiplayerSocket?.connected) {
            Reject(new Error("Multiplayer is not connected."));
            return;
        }

        MultiplayerSocket.timeout(TimeoutMilliseconds).emit(EventName, Payload, (Error, Result) => {
            if (Error) {
                Reject(new Error("The multiplayer server did not answer in time."));
                return;
            }

            Resolve(Result);
        });
    });
}

async function CreateRoom() {
    const Button = document.getElementById("CreateRoomButton");
    Button.disabled = true;
    Button.textContent = "Creating...";
    StoryAudio.PlaySound("click");
    ShowLobbyStatus("Connecting to the game server...", null);

    try {
        await EnsureMultiplayerReady();
        const Result = await EmitWithAck("room:create", {});

        if (!Result?.ok) {
            throw new Error(Result?.error || "Could not create the game.");
        }

        MultiplayerState = Result.state;
        LocalReady = false;
        HideLobbyStatus();
        RenderRoom();
    } catch (Error) {
        ShowLobbyStatus(FriendlyConnectionError(Error), false);
    } finally {
        Button.disabled = false;
        Button.textContent = "Create Game";
    }
}

async function JoinRoom() {
    const Code = document.getElementById("JoinCodeInput").value.trim().toUpperCase();
    if (Code.length !== 6) {
        ShowLobbyStatus("Enter the full six-character game code.", false);
        return;
    }

    const Button = document.getElementById("JoinRoomButton");
    Button.disabled = true;
    Button.textContent = "Joining...";
    ShowLobbyStatus("Connecting to the game server...", null);

    try {
        await EnsureMultiplayerReady();
        const Result = await EmitWithAck("room:join", { code: Code });

        if (!Result?.ok) {
            throw new Error(Result?.error || "Could not join the game.");
        }

        StoryAudio.PlaySound("join");
        MultiplayerState = Result.state;
        LocalReady = false;
        HideLobbyStatus();
        RenderRoom();
    } catch (Error) {
        ShowLobbyStatus(FriendlyConnectionError(Error), false);
    } finally {
        Button.disabled = false;
        Button.textContent = "Join";
    }
}

function LeaveRoom() {
    StoryAudio.PlaySound("click");
    if (MultiplayerSocket?.connected) MultiplayerSocket.emit("room:leave");
    MultiplayerState = null;
    LocalReady = false;
    document.getElementById("ActiveRoom").classList.add("Hidden");
    document.getElementById("RoomActions").classList.remove("Hidden");
    HideRoomStatus();
}

function ToggleReady() {
    if (!MultiplayerSocket?.connected) {
        ShowRoomStatus("Multiplayer is reconnecting.", false);
        return;
    }

    LocalReady = !LocalReady;
    StoryAudio.PlaySound("ready");
    MultiplayerSocket.emit("room:ready", { ready: LocalReady });
    document.getElementById("ReadyButton").textContent = LocalReady ? "Not Ready" : "Ready";
}

async function StartRoom() {
    StoryAudio.PlaySound("ready");

    try {
        const Result = await EmitWithAck("room:start", {});
        if (!Result?.ok) ShowRoomStatus(Result?.error || "Could not start the game.", false);
    } catch (Error) {
        ShowRoomStatus(FriendlyConnectionError(Error), false);
    }
}

async function CopyCode() {
    if (!MultiplayerState?.code) return;
    StoryAudio.PlaySound("click");

    try {
        await navigator.clipboard.writeText(MultiplayerState.code);
        ShowRoomStatus("Game code copied.", true);
    } catch {
        ShowRoomStatus(`Game code: ${MultiplayerState.code}`, true);
    }
}

function SendChat(Event) {
    Event.preventDefault();
    const Input = document.getElementById("ChatInput");
    const Text = Input.value.trim();
    if (!Text || !MultiplayerSocket?.connected) return;
    MultiplayerSocket.emit("room:chat", { text: Text });
    Input.value = "";
}

function RenderRoom() {
    if (!MultiplayerState || !CurrentProfile) return;

    document.getElementById("RoomActions").classList.add("Hidden");
    document.getElementById("ActiveRoom").classList.remove("Hidden");
    document.getElementById("RoomCodeValue").textContent = MultiplayerState.code;
    RenderLives(MultiplayerState.lives, MultiplayerState.maxLives);

    const IsHost = MultiplayerState.hostUsername === CurrentProfile.username;
    document.getElementById("StartButton").classList.toggle("Hidden", !IsHost);

    const LocalPlayer = MultiplayerState.players.find(Player => Player.username === CurrentProfile.username);
    LocalReady = Boolean(LocalPlayer?.ready);
    document.getElementById("ReadyButton").textContent = LocalReady ? "Not Ready" : "Ready";

    document.getElementById("PlayerList").innerHTML = MultiplayerState.players.map(Player => `
        <div class="PlayerRow">
            <span class="PlayerName">${EscapeText(Player.username)}${Player.username === MultiplayerState.hostUsername ? " · HOST" : ""}</span>
            <span class="PlayerStatus ${Player.ready ? "Ready" : ""}">${Player.ready ? "READY" : "NOT READY"}</span>
        </div>
    `).join("");

    const ChatMessages = document.getElementById("ChatMessages");
    ChatMessages.innerHTML = "";
    for (const Message of MultiplayerState.messages || []) AppendChat(Message, false);
    ChatMessages.scrollTop = ChatMessages.scrollHeight;
}

function AppendChat(Message, Scroll = true) {
    const Container = document.getElementById("ChatMessages");
    if (!Container) return;

    const Element = document.createElement("div");
    Element.className = "ChatMessage";
    const Name = document.createElement("strong");
    Name.textContent = `${Message.username}: `;
    Element.appendChild(Name);
    Element.appendChild(document.createTextNode(Message.text));
    Container.appendChild(Element);
    if (Scroll) Container.scrollTop = Container.scrollHeight;
}

function RenderLives(Lives, Max) {
    const Container = document.getElementById("LobbyLives");
    Container.innerHTML = "";

    for (let Index = 0; Index < Max; Index += 1) {
        const Heart = document.createElement("span");
        Heart.className = `LifeHeart ${Index < Lives ? "" : "Empty"}`;
        Heart.textContent = "♥";
        Container.appendChild(Heart);
    }
}

function ShowLobbyStatus(Text, Good) {
    const Status = document.getElementById("LobbyStatus");
    if (!Status) return;
    Status.className = Good === null ? "StatusText" : `StatusText ${Good ? "Good" : "Bad"}`;
    Status.textContent = Text;
}

function HideLobbyStatus() {
    const Status = document.getElementById("LobbyStatus");
    if (!Status) return;
    Status.className = "StatusText Hidden";
    Status.textContent = "";
}

function ShowRoomStatus(Text, Good) {
    const Status = document.getElementById("RoomStatus");
    if (!Status) return;
    Status.className = `StatusText ${Good ? "Good" : "Bad"}`;
    Status.textContent = Text;
}

function HideRoomStatus() {
    const Status = document.getElementById("RoomStatus");
    if (!Status) return;
    Status.className = "StatusText Hidden";
    Status.textContent = "";
}
