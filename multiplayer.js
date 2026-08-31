let MultiplayerSocket = null;
let MultiplayerState = null;
let CurrentProfile = null;
let LocalReady = false;
let MultiplayerReadyPromise = null;
let SocketClientPromise = null;
let StartingRoom = false;
let RoomNoticeFadeTimer = 0;
let RoomNoticeHideTimer = 0;

const SOCKET_CLIENT_URL = "https://story-rewrite-backend.onrender.com/socket.io/socket.io.js";
const REQUIRED_MULTIPLAYER_SERVER_VERSION = 8;
const CHAT_MAX_LENGTH = 180;
const CHAT_HISTORY_LIMIT = 30;

window.addEventListener("DOMContentLoaded", () => {
    EnsureLobbyEnhancements();
    BindUi();

    EnsureMultiplayerReady().catch(Error => {
        ShowLobbyStatus(FriendlyConnectionError(Error), false);
    });
});

function ById(Id) {
    return document.getElementById(Id);
}

function On(Id, EventName, Handler) {
    const Element = ById(Id);
    if (!Element) return false;
    Element.addEventListener(EventName, Handler);
    return true;
}

function SetText(Id, Text) {
    const Element = ById(Id);
    if (Element) Element.textContent = Text;
}

function EnsureLobbyEnhancements() {
    const PlayerList = ById("PlayerList");

    if (PlayerList && !ById("PlayerCount")) {
        const Header = document.createElement("div");
        Header.className = "LobbyPlayersHeader";
        Header.innerHTML = '<h2>Players</h2><span id="PlayerCount">0 / 5</span>';
        PlayerList.before(Header);
    }

    let ChatPanel = ById("LobbyChatPanel");
    if (!ChatPanel) {
        ChatPanel = document.querySelector(".ChatPanel");
        if (ChatPanel) ChatPanel.id = "LobbyChatPanel";
    }

    if (ChatPanel && !ById("ToggleLobbyChatButton")) {
        const ExistingHeading = ChatPanel.querySelector("h2");
        const Header = document.createElement("div");
        Header.className = "ChatPanelHeader";

        if (ExistingHeading) Header.appendChild(ExistingHeading);
        else {
            const Heading = document.createElement("h2");
            Heading.textContent = "Group Chat";
            Header.appendChild(Heading);
        }

        const Toggle = document.createElement("button");
        Toggle.className = "ChatToggleButton";
        Toggle.id = "ToggleLobbyChatButton";
        Toggle.type = "button";
        Toggle.setAttribute("aria-label", "Hide chat");
        Toggle.setAttribute("aria-expanded", "true");
        Toggle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5.5h14v10H9l-4 3v-13Z"></path><path d="M8 9h8M8 12h5"></path></svg>';
        Header.appendChild(Toggle);
        ChatPanel.prepend(Header);

        const ExistingMessages = ById("ChatMessages");
        const ExistingForm = ById("ChatForm");
        if (ExistingMessages && ExistingForm && !ChatPanel.querySelector(".ChatPanelBody")) {
            const Body = document.createElement("div");
            Body.className = "ChatPanelBody";
            ExistingMessages.before(Body);
            Body.appendChild(ExistingMessages);
            Body.appendChild(ExistingForm);
        }
    }

    const ChatInput = ById("ChatInput");
    if (ChatInput) ChatInput.maxLength = CHAT_MAX_LENGTH;
}

function SetMultiplayerSetupBackVisible(Visible) {
    ById("MultiplayerSetupBackButton")?.classList.toggle("Hidden", !Visible);
}

function BindUi() {
    On("CreateRoomButton", "click", CreateRoom);
    On("JoinRoomButton", "click", JoinRoom);
    On("CopyCodeButton", "click", CopyCode);
    On("ReadyButton", "click", ToggleReady);
    On("StartButton", "click", StartRoom);
    On("LeaveButton", "click", LeaveRoom);
    On("ChatForm", "submit", SendChat);
    On("ToggleLobbyChatButton", "click", ToggleLobbyChat);

    On("JoinCodeInput", "input", Event => {
        Event.target.value = Event.target.value
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, "")
            .slice(0, 6);
    });
}

async function EnsureBackendVersion() {
    const Health = await ApiRequest("/api/health");
    const Version = Number(Health?.version || 0);

    if (!Health?.ok || !Health?.multiplayer) {
        throw new Error("The multiplayer server is not ready yet.");
    }

    if (Version < REQUIRED_MULTIPLAYER_SERVER_VERSION) {
        throw new Error("The multiplayer server is updating. Try again in a moment.");
    }

    return Health;
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
    await EnsureBackendVersion();

    const ProfileResult = await RequireAccount();
    CurrentProfile = ProfileResult.profile;

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
        document.querySelectorAll('script[data-story-socket-client="1"]').forEach(Script => Script.remove());

        const Script = document.createElement("script");
        Script.src = `${SOCKET_CLIENT_URL}?v=8`;
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
}

function BindSocket(Socket) {
    if (typeof BindChatModerationSocket === "function") BindChatModerationSocket(Socket);

    Socket.on("connect", () => {
        if (!MultiplayerState) HideLobbyStatus();
    });

    Socket.on("disconnect", () => {
        if (MultiplayerState) ShowRoomStatus("Connection lost. Reconnecting...", false);
        else ShowLobbyStatus("Connection lost. Reconnecting...", false);
    });

    Socket.on("connect_error", Error => {
        const Message = FriendlyConnectionError(Error);
        if (MultiplayerState) ShowRoomStatus(Message, false);
        else ShowLobbyStatus(Message, false);
    });

    Socket.on("room:state", State => {
        const PreviousCount = MultiplayerState?.players?.length || 0;
        MultiplayerState = State;
        if ((State?.players?.length || 0) > PreviousCount && PreviousCount > 0) {
            StoryAudio?.PlaySound?.("join");
        }
        RenderRoom();
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
}

function FriendlyConnectionError(Error) {
    const Message = String(Error?.message || Error || "");
    if (Message === "AUTH_REQUIRED") return "Your sign-in expired. Sign in again.";
    if (Message === "DATABASE_UNAVAILABLE") return "The account database is temporarily unavailable.";
    if (Message.includes("timeout") || Message.includes("did not connect")) return "The multiplayer server is taking too long to respond. Try again.";
    if (Message.includes("load the multiplayer client")) return "The multiplayer client could not load. Refresh and try again.";
    return Message || "Could not connect to multiplayer.";
}

function ResultError(Result, Fallback) {
    return Result?.error || Fallback;
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
    const Button = ById("CreateRoomButton");
    if (!Button) return;

    Button.disabled = true;
    Button.textContent = "Creating...";
    StoryAudio?.PlaySound?.("click");
    ShowLobbyStatus("Creating your room...", null);

    try {
        await EnsureMultiplayerReady();
        const CreateResult = await ApiRequest("/api/room/create", { method: "POST" });
        if (!CreateResult?.ok || !CreateResult.code) {
            throw new Error(CreateResult?.error || "Could not create the game.");
        }

        const JoinResult = await EmitWithAck("room:join", { code: CreateResult.code });
        if (!JoinResult?.ok) {
            throw new Error(ResultError(JoinResult, "The room was created but could not be opened."));
        }

        MultiplayerState = JoinResult.state;
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
    const Input = ById("JoinCodeInput");
    const Code = String(Input?.value || "").trim().toUpperCase();

    if (Code.length !== 6) {
        ShowLobbyStatus("Enter the full six-character game code.", false);
        return;
    }

    const Button = ById("JoinRoomButton");
    if (!Button) return;

    Button.disabled = true;
    Button.textContent = "Joining...";
    ShowLobbyStatus("Connecting to the room...", null);

    try {
        await EnsureMultiplayerReady();
        const Result = await EmitWithAck("room:join", { code: Code });
        if (!Result?.ok) throw new Error(ResultError(Result, "Could not join the game."));

        StoryAudio?.PlaySound?.("join");
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

let LeavingRoom = false;

async function LeaveRoom() {
    if (LeavingRoom) return;
    LeavingRoom = true;

    const Button = ById("LeaveButton");
    const DestroyingRoom = Button?.dataset.destroyRoom === "1";
    if (Button) {
        Button.disabled = true;
        Button.textContent = DestroyingRoom ? "Destroying..." : "Leaving...";
    }

    try {
        if (MultiplayerSocket?.connected && MultiplayerState?.code) {
            const Result = await EmitWithAck("room:leave", {});
            if (!Result?.ok) throw new Error(ResultError(Result, "Could not leave the room."));
        }
    } catch (Error) {
        MultiplayerSocket?.disconnect();
        MultiplayerSocket = null;
        MultiplayerReadyPromise = null;
        ShowLobbyStatus(FriendlyConnectionError(Error), false);
    } finally {
        MultiplayerState = null;
        LocalReady = false;
        StartingRoom = false;
        ById("ActiveRoom")?.classList.add("Hidden");
        ById("RoomActions")?.classList.remove("Hidden");
        SetMultiplayerSetupBackVisible(true);
        HideRoomStatus();

        if (Button) {
            Button.disabled = false;
            Button.dataset.destroyRoom = "0";
            Button.textContent = "Leave Room";
        }

        LeavingRoom = false;
    }
}

function ToggleReady() {
    if (!MultiplayerSocket?.connected) {
        ShowRoomStatus("Multiplayer is reconnecting.", false);
        return;
    }

    LocalReady = !LocalReady;
    StoryAudio?.PlaySound?.("ready");
    MultiplayerSocket.emit("room:ready", { ready: LocalReady });
    SetText("ReadyButton", LocalReady ? "Not Ready" : "Ready");
}

async function StartRoom() {
    if (StartingRoom) return;

    if ((MultiplayerState?.players?.length || 0) < 2) {
        ShowPlayerRequiredNotice();
        return;
    }

    const Button = ById("StartButton");
    if (!Button) return;

    StartingRoom = true;
    Button.disabled = true;
    Button.textContent = "Starting...";
    StoryAudio?.PlaySound?.("ready");
    ShowRoomStatus("Starting the story...", true);

    try {
        await EnsureMultiplayerReady();
        const Result = await EmitWithAck("room:start", {});
        if (!Result?.ok) throw new Error(ResultError(Result, "Could not start the game."));

        const StageId = Result.stageId || MultiplayerState?.stageId;
        const RoomCode = MultiplayerState?.code || "";
        if (!StageId) throw new Error("The server started the room without a stage.");

        GoStage(StageId, RoomCode);
    } catch (Error) {
        StartingRoom = false;
        Button.disabled = false;
        Button.textContent = "Start Story";
        ShowRoomStatus(FriendlyConnectionError(Error), false);
    }
}

async function CopyCode() {
    if (!MultiplayerState?.code) return;
    StoryAudio?.PlaySound?.("click");

    try {
        await navigator.clipboard.writeText(MultiplayerState.code);
        ShowRoomStatus("Game code copied.", true);
    } catch {
        ShowRoomStatus(`Game code: ${MultiplayerState.code}`, true);
    }
}

function SendChat(Event) {
    Event.preventDefault();

    const Input = ById("ChatInput");
    const Text = String(Input?.value || "").trim();
    if (!Text || !MultiplayerSocket?.connected) return;

    if (Text.length > CHAT_MAX_LENGTH) {
        ShowRoomStatus(`Messages are limited to ${CHAT_MAX_LENGTH} characters.`, false);
        return;
    }

    MultiplayerSocket.emit("room:chat", { text: Text });
    Input.value = "";
}

function ToggleLobbyChat() {
    const Panel = ById("LobbyChatPanel");
    const Button = ById("ToggleLobbyChatButton");
    if (!Panel || !Button) return;

    const Collapsed = Panel.classList.toggle("IsCollapsed");
    Button.setAttribute("aria-expanded", String(!Collapsed));
    Button.setAttribute("aria-label", Collapsed ? "Show chat" : "Hide chat");
}

function RenderRoom() {
    if (!MultiplayerState || !CurrentProfile) return;

    SetMultiplayerSetupBackVisible(false);
    ById("RoomActions")?.classList.add("Hidden");
    ById("ActiveRoom")?.classList.remove("Hidden");
    SetText("RoomCodeValue", MultiplayerState.code || "------");
    RenderLives(MultiplayerState.lives, MultiplayerState.maxLives);

    const Players = Array.isArray(MultiplayerState.players) ? MultiplayerState.players : [];
    const MaxPlayers = Number(MultiplayerState.maxPlayers || 5);
    SetText("PlayerCount", `${Players.length} / ${MaxPlayers}`);

    const IsHost = MultiplayerState.hostUsername === CurrentProfile.username;
    const HasEnoughPlayers = Players.length >= 2;
    const DestroyRoomOnLeave = IsHost && Players.length === 1;
    const LeaveButton = ById("LeaveButton");
    if (LeaveButton && !LeavingRoom) {
        LeaveButton.dataset.destroyRoom = DestroyRoomOnLeave ? "1" : "0";
        LeaveButton.textContent = DestroyRoomOnLeave ? "Destroy Room" : "Leave Room";
    }

    const StartButton = ById("StartButton");
    StartButton?.classList.toggle("Hidden", !IsHost);
    if (StartButton) {
        StartButton.disabled = !HasEnoughPlayers;
        StartButton.title = HasEnoughPlayers ? "" : "Invite at least one other player.";
    }

    const LocalPlayer = Players.find(Player => Player.username === CurrentProfile.username);
    LocalReady = Boolean(LocalPlayer?.ready);
    SetText("ReadyButton", LocalReady ? "Not Ready" : "Ready");

    const PlayerList = ById("PlayerList");
    if (PlayerList) {
        PlayerList.innerHTML = Players.map(Player => `
            <div class="PlayerRow">
                <span class="PlayerName">${EscapeText(Player.username)}${Player.username === MultiplayerState.hostUsername ? " · HOST" : ""}</span>
                <span class="PlayerStatus ${Player.ready ? "Ready" : ""}">${Player.ready ? "READY" : "NOT READY"}</span>
            </div>
        `).join("");
    }

    const ChatMessages = ById("ChatMessages");
    if (ChatMessages) {
        ChatMessages.innerHTML = "";
        for (const Message of MultiplayerState.messages || []) AppendChat(Message, false);
        ChatMessages.scrollTop = ChatMessages.scrollHeight;
    }
}

function AppendChat(Message, Scroll = true) {
    const Container = ById("ChatMessages");
    if (!Container) return;

    const Element = document.createElement("div");
    Element.className = "ChatMessage";

    const Name = document.createElement("strong");
    Name.textContent = `${Message?.username || "Player"}: `;
    Element.appendChild(Name);
    Element.appendChild(document.createTextNode(String(Message?.text || "")));
    Container.appendChild(Element);

    while (Container.childElementCount > CHAT_HISTORY_LIMIT) {
        Container.firstElementChild?.remove();
    }

    if (Scroll) Container.scrollTop = Container.scrollHeight;
}

function RenderLives(Lives, Max) {
    const Container = ById("LobbyLives");
    if (!Container) return;

    const SafeMax = Math.max(0, Number(Max || 3));
    const SafeLives = Math.max(0, Number(Lives || 0));
    Container.innerHTML = "";

    for (let Index = 0; Index < SafeMax; Index += 1) {
        const Heart = document.createElement("span");
        Heart.className = `LifeHeart ${Index < SafeLives ? "" : "Empty"}`;
        Heart.textContent = "♥";
        Container.appendChild(Heart);
    }
}

function ShowLobbyStatus(Text, Good) {
    const Status = ById("LobbyStatus");
    if (!Status) return;
    Status.className = Good === null ? "StatusText" : `StatusText ${Good ? "Good" : "Bad"}`;
    Status.textContent = Text;
}

function HideLobbyStatus() {
    const Status = ById("LobbyStatus");
    if (!Status) return;
    Status.className = "StatusText Hidden";
    Status.textContent = "";
}

function ClearRoomNoticeTimers() {
    clearTimeout(RoomNoticeFadeTimer);
    clearTimeout(RoomNoticeHideTimer);
    RoomNoticeFadeTimer = 0;
    RoomNoticeHideTimer = 0;
}

function ShowPlayerRequiredNotice() {
    const Status = ById("RoomStatus") || ById("LobbyStatus");
    if (!Status) return;

    ClearRoomNoticeTimers();
    Status.className = "StatusText PlayerRequiredNotice";
    Status.innerHTML = `<span class="PlayerRequiredIcon" aria-hidden="true">
        <svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"></circle><path d="M3.8 19c.5-4 2.2-6 5.2-6s4.7 2 5.2 6"></path><circle cx="17.2" cy="9" r="2.2"></circle><path d="M15.2 14.2c.7-.5 1.5-.7 2.3-.7 2.1 0 3.3 1.5 3.7 4.5"></path></svg>
    </span><span><strong>Another player is required</strong><small>Share the room code and wait for one teammate before starting.</small></span>`;

    RoomNoticeFadeTimer = setTimeout(() => {
        Status.classList.add("IsFading");
        RoomNoticeHideTimer = setTimeout(() => HideRoomStatus(), 280);
    }, 3200);
}

function ShowRoomStatus(Text, Good) {
    const Status = ById("RoomStatus") || ById("LobbyStatus");
    if (!Status) return;
    ClearRoomNoticeTimers();
    Status.className = `StatusText ${Good ? "Good" : "Bad"}`;
    Status.textContent = Text;
}

function HideRoomStatus() {
    const Status = ById("RoomStatus");
    if (!Status) return;
    ClearRoomNoticeTimers();
    Status.className = "StatusText Hidden";
    Status.textContent = "";
}