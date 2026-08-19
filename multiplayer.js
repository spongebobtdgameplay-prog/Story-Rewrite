let MultiplayerSocket = null;
let MultiplayerState = null;
let CurrentProfile = null;
let LocalReady = false;

window.addEventListener("DOMContentLoaded", async () => {
    try {
        const ProfileResult = await RequireAccount();
        CurrentProfile = ProfileResult.profile;
        MultiplayerSocket = ConnectStorySocket();
        BindSocket();
        BindUi();
    } catch (Error) {
        ShowRoomStatus(Error.message, false);
    }
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
    document.getElementById("LogoutButton").addEventListener("click", LogoutAccount);
    document.getElementById("ChatForm").addEventListener("submit", SendChat);
}

function BindSocket() {
    MultiplayerSocket.on("connect_error", Error => ShowRoomStatus(Error.message === "AUTH_REQUIRED" ? "Your sign-in expired. Sign in again." : Error.message, false));
    MultiplayerSocket.on("room:state", State => {
        MultiplayerState = State;
        RenderRoom();
    });
    MultiplayerSocket.on("room:chat", Message => AppendChat(Message));
    MultiplayerSocket.on("game:started", Payload => {
        window.location.href = `dialog.html?stage=${encodeURIComponent(Payload.stageId)}&room=${encodeURIComponent(Payload.code)}`;
    });
}

function CreateRoom() {
    MultiplayerSocket.emit("room:create", {}, Result => {
        if (!Result?.ok) {
            ShowRoomStatus(Result?.error || "Could not create the game.", false);
            return;
        }
        MultiplayerState = Result.state;
        LocalReady = false;
        RenderRoom();
    });
}

function JoinRoom() {
    const Code = document.getElementById("JoinCodeInput").value.trim().toUpperCase();
    if (Code.length !== 6) {
        ShowRoomStatus("Enter the full six-character game code.", false);
        return;
    }

    MultiplayerSocket.emit("room:join", { code: Code }, Result => {
        if (!Result?.ok) {
            ShowRoomStatus(Result?.error || "Could not join the game.", false);
            return;
        }
        MultiplayerState = Result.state;
        LocalReady = false;
        RenderRoom();
    });
}

function LeaveRoom() {
    MultiplayerSocket.emit("room:leave");
    MultiplayerState = null;
    LocalReady = false;
    document.getElementById("ActiveRoom").classList.add("Hidden");
    document.getElementById("RoomActions").classList.remove("Hidden");
}

function ToggleReady() {
    LocalReady = !LocalReady;
    MultiplayerSocket.emit("room:ready", { ready: LocalReady });
    document.getElementById("ReadyButton").textContent = LocalReady ? "Not Ready" : "Ready";
}

function StartRoom() {
    MultiplayerSocket.emit("room:start", {}, Result => {
        if (!Result?.ok) ShowRoomStatus(Result?.error || "Could not start the game.", false);
    });
}

async function CopyCode() {
    if (!MultiplayerState?.code) return;
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
    if (!Text) return;
    MultiplayerSocket.emit("room:chat", { text: Text });
    Input.value = "";
}

function RenderRoom() {
    if (!MultiplayerState) return;

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

function ShowRoomStatus(Text, Good) {
    const Status = document.getElementById("RoomStatus");
    if (!Status) return;
    Status.className = `StatusText ${Good ? "Good" : "Bad"}`;
    Status.textContent = Text;
}
