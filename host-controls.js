let HostPendingRequests = new Map();
let HostControlsSocket = null;
let PendingLateJoinCode = "";

const HOST_SHIELD_ICON = `
<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 3.5 19 6v5.3c0 4.4-2.6 7.6-7 9.2-4.4-1.6-7-4.8-7-9.2V6l7-2.5Z"></path>
    <path d="M9 12h6M12 9v6"></path>
</svg>`;

function HostEscape(Value) {
    if (typeof EscapeText === "function") return EscapeText(Value);
    return String(Value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function GetHostProfileName() {
    if (typeof CurrentProfile !== "undefined" && CurrentProfile?.username) return CurrentProfile.username;
    if (typeof Profile !== "undefined" && Profile?.username) return Profile.username;
    return "";
}

function GetHostRoomState() {
    if (typeof MultiplayerState !== "undefined") return MultiplayerState;
    return null;
}

function IsLocalHost() {
    const State = GetHostRoomState();
    const Username = GetHostProfileName();
    return Boolean(State && Username && State.hostUsername === Username);
}

function HostEmit(EventName, Payload, Timeout = 10000) {
    return new Promise(Resolve => {
        if (!HostControlsSocket?.connected) {
            Resolve({ ok: false, error: "Multiplayer is reconnecting." });
            return;
        }

        HostControlsSocket.timeout(Timeout).emit(EventName, Payload, (Error, Result) => {
            if (Error) Resolve({ ok: false, error: "The server did not answer in time." });
            else Resolve(Result || { ok: false, error: "No response from the server." });
        });
    });
}

function RemoveStrayLobbyHostArtifacts() {
    if (!document.body.classList.contains("MultiplayerPage")) return;
    document.getElementById("GameHostToggle")?.remove();
    document.getElementById("GameHostControls")?.remove();
}

function EnsureLobbyHostPanel() {
    if (!document.body.classList.contains("MultiplayerPage")) return null;
    RemoveStrayLobbyHostArtifacts();

    const ExistingPanel = document.getElementById("HostControlPanel");
    if (ExistingPanel) return ExistingPanel;

    const Toggle = document.getElementById("LobbyHostToggle");
    if (!Toggle) return null;

    const Panel = document.createElement("section");
    Panel.id = "HostControlPanel";
    Panel.className = "HostControlPanel Hidden IsCollapsed";
    Panel.innerHTML = `
        <div class="HostPanelHeader">
            <div>
                <div class="Kicker">Host only</div>
                <h3>Room Controls</h3>
            </div>
            <button class="HostCloseButton" id="LobbyHostClose" type="button" aria-label="Close host controls">×</button>
        </div>
        <div class="HostJoinRequests Hidden" id="HostJoinRequests">
            <div class="HostSectionTitle">Join requests <span id="HostRequestCount">0</span></div>
            <div id="HostRequestList"></div>
        </div>
        <div class="HostSectionTitle">Players</div>
        <div id="HostPlayerControls"></div>
    `;

    document.body.appendChild(Panel);
    Toggle.addEventListener("click", () => Panel.classList.toggle("IsCollapsed"));
    document.getElementById("LobbyHostClose")?.addEventListener("click", () => Panel.classList.add("IsCollapsed"));
    return Panel;
}

function EnsureGameHostPanel() {
    if (!document.body.classList.contains("GamePage")) return null;
    if (document.getElementById("GameHostControls")) return document.getElementById("GameHostControls");

    const Toggle = document.createElement("button");
    Toggle.id = "GameHostToggle";
    Toggle.className = "GameHostToggle Hidden";
    Toggle.type = "button";
    Toggle.setAttribute("aria-label", "Host controls");
    Toggle.innerHTML = `${HOST_SHIELD_ICON}<span id="GameHostRequestBadge">0</span>`;

    const Panel = document.createElement("section");
    Panel.id = "GameHostControls";
    Panel.className = "GameHostControls Hidden IsCollapsed";
    Panel.innerHTML = `
        <div class="HostPanelHeader">
            <div><div class="Kicker">Host only</div><h3>Room Controls</h3></div>
            <button class="HostCloseButton" id="GameHostClose" type="button" aria-label="Close host controls">×</button>
        </div>
        <div class="HostJoinRequests Hidden" id="GameHostJoinRequests">
            <div class="HostSectionTitle">Join requests <span id="GameHostRequestCount">0</span></div>
            <div id="GameHostRequestList"></div>
        </div>
        <div class="HostSectionTitle">Players</div>
        <div id="GameHostPlayerControls"></div>
    `;

    document.body.append(Toggle, Panel);
    Toggle.addEventListener("click", () => Panel.classList.toggle("IsCollapsed"));
    document.getElementById("GameHostClose")?.addEventListener("click", () => Panel.classList.add("IsCollapsed"));
    return Panel;
}

function RenderJoinRequestList(ListId, SectionId, CountId) {
    const List = document.getElementById(ListId);
    const Section = document.getElementById(SectionId);
    const Count = document.getElementById(CountId);
    if (!List || !Section || !Count) return;

    const Requests = [...HostPendingRequests.values()];
    Count.textContent = String(Requests.length);
    Section.classList.toggle("Hidden", Requests.length === 0);
    List.innerHTML = Requests.map(Request => `
        <div class="HostRequestRow" data-host-request="${HostEscape(Request.username)}">
            <div><strong>${HostEscape(Request.username)}</strong><span> wants to join the running game</span></div>
            <div class="HostMiniActions">
                <button class="HostAllowButton" type="button" data-host-approve="${HostEscape(Request.username)}">Allow</button>
                <button class="HostDenyButton" type="button" data-host-deny="${HostEscape(Request.username)}">Deny</button>
            </div>
        </div>
    `).join("");

    for (const Button of List.querySelectorAll("[data-host-approve]")) {
        Button.addEventListener("click", () => DecideJoinRequest(Button.dataset.hostApprove, true));
    }
    for (const Button of List.querySelectorAll("[data-host-deny]")) {
        Button.addEventListener("click", () => DecideJoinRequest(Button.dataset.hostDeny, false));
    }
}

function RenderHostPlayers(ListId) {
    const List = document.getElementById(ListId);
    if (!List) return;

    const State = GetHostRoomState();
    const LocalName = GetHostProfileName();
    const Players = Array.isArray(State?.players) ? State.players.filter(Player => Player.username !== LocalName) : [];

    List.innerHTML = Players.length ? Players.map(Player => `
        <div class="HostPlayerRow">
            <div class="HostPlayerIdentity">
                <strong>${HostEscape(Player.username)}</strong>
                <span>${Player.chatBanned ? "Chat muted" : Player.ready ? "Ready" : "Connected"}</span>
            </div>
            <div class="HostMiniActions">
                <button class="HostMuteButton" type="button" data-host-mute="${HostEscape(Player.username)}" data-host-muted="${Player.chatBanned ? "1" : "0"}">${Player.chatBanned ? "Unmute" : "Mute"}</button>
                <button class="HostKickButton" type="button" data-host-kick="${HostEscape(Player.username)}">Kick</button>
            </div>
        </div>
    `).join("") : `<div class="HostEmptyState">No other players connected.</div>`;

    for (const Button of List.querySelectorAll("[data-host-mute]")) {
        Button.addEventListener("click", () => ToggleHostMute(Button.dataset.hostMute, Button.dataset.hostMuted !== "1"));
    }
    for (const Button of List.querySelectorAll("[data-host-kick]")) {
        Button.addEventListener("click", () => KickHostPlayer(Button.dataset.hostKick));
    }
}

function RenderHostControls() {
    RemoveStrayLobbyHostArtifacts();
    const Host = IsLocalHost();

    const LobbyPanel = EnsureLobbyHostPanel();
    const LobbyToggle = document.getElementById("LobbyHostToggle");
    LobbyPanel?.classList.toggle("Hidden", !Host);
    LobbyToggle?.classList.toggle("Hidden", !Host);

    const GamePanel = EnsureGameHostPanel();
    const GameToggle = document.getElementById("GameHostToggle");
    GamePanel?.classList.toggle("Hidden", !Host);
    GameToggle?.classList.toggle("Hidden", !Host);

    if (!Host) {
        LobbyPanel?.classList.add("IsCollapsed");
        GamePanel?.classList.add("IsCollapsed");
        return;
    }

    RenderJoinRequestList("HostRequestList", "HostJoinRequests", "HostRequestCount");
    RenderJoinRequestList("GameHostRequestList", "GameHostJoinRequests", "GameHostRequestCount");
    RenderHostPlayers("HostPlayerControls");
    RenderHostPlayers("GameHostPlayerControls");

    for (const BadgeId of ["LobbyHostRequestBadge", "GameHostRequestBadge"]) {
        const Badge = document.getElementById(BadgeId);
        if (!Badge) continue;
        Badge.textContent = String(HostPendingRequests.size);
        Badge.classList.toggle("HasRequests", HostPendingRequests.size > 0);
    }
}

async function DecideJoinRequest(Username, Approved) {
    if (!Username) return;
    const Result = await HostEmit("host:joinDecision", { username: Username, approved: Approved });
    if (Result?.ok) HostPendingRequests.delete(Username);
    RenderHostControls();
}

async function ToggleHostMute(Username, Banned) {
    if (!Username) return;
    await HostEmit("host:chatBan", { username: Username, banned: Banned });
}

async function KickHostPlayer(Username) {
    if (!Username) return;

    let Confirmed = true;
    if (typeof window.StoryConfirm === "function") {
        Confirmed = await window.StoryConfirm({
            title: `Kick ${Username}?`,
            message: "They will be removed from this room. They can request to join again later.",
            confirmText: "Kick Player",
            cancelText: "Cancel",
            danger: true
        });
    }

    if (!Confirmed) return;
    await HostEmit("host:kick", { username: Username });
}

function ApplyLocalChatBan(State) {
    const Username = GetHostProfileName();
    const Player = State?.players?.find?.(Entry => Entry.username === Username);
    const Banned = Boolean(Player?.chatBanned);
    const IssuedBy = String(Player?.moderation?.chatTimeoutIssuedBy || "");
    const Automatic = IssuedBy.toLowerCase() === "automatic moderation";
    const DisabledText = Automatic ? "Chat banned by game" : "Chat banned by host";

    for (const InputId of ["ChatInput", "GameChatInput"]) {
        const Input = document.getElementById(InputId);
        if (!Input) continue;
        Input.disabled = Banned;
        Input.placeholder = Banned ? DisabledText : (InputId === "ChatInput" ? "Type to your group..." : "Talk to your group...");
    }
}

async function FinishApprovedLateJoin(Code) {
    try {
        const Result = await EmitWithAck("room:join", { code: Code }, 15000);
        if (!Result?.ok) throw new Error(Result?.error || "Could not enter the room after approval.");

        PendingLateJoinCode = "";
        MultiplayerState = Result.state;
        LocalReady = Boolean(Result.state?.players?.find(Player => Player.username === CurrentProfile?.username)?.ready);

        if (Result.state?.status && Result.state.status !== "lobby") {
            GoStage(Result.state.stageId, Code);
            return;
        }

        HideLobbyStatus();
        RenderRoom();
    } catch (Error) {
        ShowLobbyStatus(FriendlyConnectionError(Error), false);
    }
}

function BindHostSocket(Socket) {
    if (!Socket || Socket === HostControlsSocket) return;
    HostControlsSocket = Socket;

    Socket.on("room:joinRequests", Payload => {
        HostPendingRequests.clear();
        for (const Request of Payload?.requests || []) {
            if (Request?.username) HostPendingRequests.set(Request.username, Request);
        }
        RenderHostControls();
    });

    Socket.on("room:joinApproved", Payload => {
        const Code = String(Payload?.code || PendingLateJoinCode || "").trim().toUpperCase();
        if (!Code || !document.body.classList.contains("MultiplayerPage")) return;
        ShowLobbyStatus("Host approved your request. Joining...", true);
        FinishApprovedLateJoin(Code);
    });

    Socket.on("room:joinDenied", Payload => {
        PendingLateJoinCode = "";
        if (document.body.classList.contains("MultiplayerPage")) {
            ShowLobbyStatus(Payload?.reason || "The host declined your join request.", false);
        }
    });

    Socket.on("room:kicked", Payload => {
        HostPendingRequests.clear();
        if (document.body.classList.contains("GamePage")) {
            window.location.replace(typeof BuildStoryUrl === "function" ? BuildStoryUrl("multiplayer.html") : "multiplayer.html");
            return;
        }

        MultiplayerState = null;
        document.getElementById("ActiveRoom")?.classList.add("Hidden");
        document.getElementById("RoomActions")?.classList.remove("Hidden");
        ShowLobbyStatus(Payload?.reason || "The host removed you from the room.", false);
    });

    Socket.on("room:chatBanState", Payload => {
        const Banned = Boolean(Payload?.banned);
        for (const InputId of ["ChatInput", "GameChatInput"]) {
            const Input = document.getElementById(InputId);
            if (!Input) continue;
            Input.disabled = Banned;
            if (Banned) Input.placeholder = "Chat banned by host";
        }
        const Status = document.getElementById("RoomStatus") || document.getElementById("StatusText") || document.getElementById("LobbyStatus");
        if (Status && Payload?.reason) Status.textContent = Payload.reason;
    });

    Socket.on("room:state", State => {
        ApplyLocalChatBan(State);
        requestAnimationFrame(RenderHostControls);
    });

    RenderHostControls();
}

if (typeof BindSocket === "function") {
    const BaseBindSocket = BindSocket;
    BindSocket = function(Socket) {
        BaseBindSocket(Socket);
        BindHostSocket(Socket);
    };
}

if (typeof JoinRoom === "function") {
    JoinRoom = async function() {
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

            if (Result?.pending) {
                PendingLateJoinCode = Code;
                Button.textContent = "Waiting...";
                ShowLobbyStatus("Game already started. Waiting for the host to approve you...", null);
                return;
            }

            if (!Result?.ok) throw new Error(Result?.error || "Could not join the game.");

            StoryAudio?.PlaySound?.("join");
            MultiplayerState = Result.state;
            LocalReady = false;
            HideLobbyStatus();

            if (Result.state?.status && Result.state.status !== "lobby") {
                GoStage(Result.state.stageId, Code);
                return;
            }

            RenderRoom();
        } catch (Error) {
            ShowLobbyStatus(FriendlyConnectionError(Error), false);
        } finally {
            if (!PendingLateJoinCode) {
                Button.disabled = false;
                Button.textContent = "Join";
            }
        }
    };
}

if (typeof StartMultiplayer === "function" && document.body.classList.contains("GamePage")) {
    const BaseStartMultiplayer = StartMultiplayer;
    StartMultiplayer = function() {
        BaseStartMultiplayer();
        setTimeout(() => BindHostSocket(MultiplayerSocket), 0);
    };
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
        EnsureLobbyHostPanel();
        EnsureGameHostPanel();
        RenderHostControls();
    }, { once: true });
} else {
    EnsureLobbyHostPanel();
    EnsureGameHostPanel();
    RenderHostControls();
}
