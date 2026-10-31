(() => {
    "use strict";

    const DEVELOPER_USERNAME = "darius56";
    let Socket = null;
    let Root = null;
    let OpenButton = null;
    let Authorized = false;
    let IsOpen = false;
    let SelectedCode = "";
    let ObservationRequestSequence = 0;
    let Snapshot = null;
    let PollTimer = null;
    let Rooms = [];
    let Status = "Connecting to developer monitor…";

    function El(Id) { return Root ? Root.querySelector("#" + Id) : null; }
    function Txt(Value, Fallback = "") {
        const Text = String(Value === undefined || Value === null ? "" : Value).trim();
        return Text || Fallback;
    }
    function MsgKey(Message) {
        return [Txt(Message && Message.username), String(Message && Message.sentAt || 0), Txt(Message && Message.text)].join("|");
    }
    function StopPolling() {
        if (PollTimer) clearInterval(PollTimer);
        PollTimer = null;
    }
    function SetStatus(Value) {
        Status = Txt(Value, "Connected");
        if (El("StoryDevStatusText")) El("StoryDevStatusText").textContent = Status;
    }
    function AddSvgButton(ClassName, Id, Label, Path) {
        return '<button class="' + ClassName + '" id="' + Id + '" type="button" aria-label="' + Label + '" title="' + Label + '"><svg viewBox="0 0 24 24" aria-hidden="true">' + Path + '</svg></button>';
    }

    function Mount() {
        if (Root) return;
        Root = document.createElement("div");
        Root.id = "StoryDevGuiRoot";
        Root.innerHTML = [
            '<div class="StoryDevOverlay" id="StoryDevOverlay" hidden>',
            '<section class="StoryDevPanel" role="dialog" aria-modal="true" aria-labelledby="StoryDevTitle">',
            '<header class="StoryDevHeader">',
            '<div class="StoryDevBrand"><div class="StoryDevMark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3.5 19 6v5.1c0 4.5-2.8 7.8-7 9.4-4.2-1.6-7-4.9-7-9.4V6l7-2.5Z"></path><path d="m9 12 2 2 4-4"></path></svg></div>',
            '<div><div class="StoryDevEyebrow">SILICON VALLEY THINK / OPERATIONS</div><h2 id="StoryDevTitle">Silicon Valley Think — Developer Console</h2><p>Multiplayer server monitor</p></div></div>',
            '<div class="StoryDevHeaderActions"><span class="StoryDevLive"><i></i> SERVER VIEW</span>',
            AddSvgButton("StoryDevIconButton", "StoryDevRefresh", "Refresh room list", '<path d="M20 7v5h-5M4 17v-5h5"></path><path d="M5.7 9a7 7 0 0 1 11.6-2L20 12M4 12l2.7 5a7 7 0 0 0 11.6-2"></path>'),
            AddSvgButton("StoryDevIconButton", "StoryDevClose", "Close console", '<path d="m6 6 12 12M18 6 6 18"></path>'),
            '</div></header>',
            '<div class="StoryDevSummaryBar"><span id="StoryDevStatusText">Connecting…</span><span class="StoryDevDot"></span><span id="StoryDevRoomCount">0 active rooms</span><span class="StoryDevSpacer"></span><span class="StoryDevReadOnly"><svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="11" rx="2"></rect><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"></path></svg> Observer mode · no player slot</span></div>',
            '<div class="StoryDevMain"><aside class="StoryDevRoomsPane"><div class="StoryDevPaneHeading"><div><span class="StoryDevEyebrow">MULTIPLAYER</span><h3>Active rooms</h3></div><span class="StoryDevCount" id="StoryDevRoomCountBadge">0</span></div>',
            '<div class="StoryDevRoomList" id="StoryDevRoomList"></div><div class="StoryDevPaneFooter">Live room state is read directly from the game server.</div></aside>',
            '<section class="StoryDevDetailPane"><div class="StoryDevEmpty" id="StoryDevEmpty"><div class="StoryDevEmptyIcon"><svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"></circle><path d="m16 16 4 4M8 10.5h5M10.5 8v5"></path></svg></div><h3>Select a room to inspect</h3><p>Inspect connected players, current stage, team lives, and live group-chat activity without joining the game.</p></div>',
            '<div id="StoryDevRoomView" hidden><div class="StoryDevRoomTop"><div><div class="StoryDevEyebrow">OBSERVING ROOM</div><div class="StoryDevRoomCode" id="StoryDevSelectedCode">------</div><div class="StoryDevRoomSubline" id="StoryDevSelectedMeta"></div></div>',
            '<div class="StoryDevRoomTopRight"><span id="StoryDevSelectedStatus" class="StoryDevStatus">LOBBY</span><button id="StoryDevStopButton" class="StoryDevStopButton" type="button">Stop observing</button></div></div>',
            '<div class="StoryDevMetrics"><div class="StoryDevMetric"><span>HOST</span><strong id="StoryDevHost">—</strong></div><div class="StoryDevMetric"><span>PLAYERS</span><strong id="StoryDevPlayersMetric">0 / 5</strong></div><div class="StoryDevMetric"><span>TEAM LIVES</span><strong id="StoryDevLives">—</strong></div><div class="StoryDevMetric"><span>CURRENT STAGE</span><strong id="StoryDevStage">—</strong></div></div>',
            '<div class="StoryDevContentGrid"><section class="StoryDevCard"><div class="StoryDevCardHeading"><h3>Connected players</h3><span id="StoryDevPlayerCount">0</span></div><div class="StoryDevPlayersList" id="StoryDevPlayersList"></div></section>',
            '<section class="StoryDevCard StoryDevChatCard"><div class="StoryDevCardHeading"><h3>Group chat</h3><span>LIVE LOG</span></div><div class="StoryDevMessages" id="StoryDevMessages" aria-live="polite"></div></section></div></div></section></div>',
            '<footer class="StoryDevFooter"><span>Authorized developer: <strong>darius56</strong></span><span>Read-only observer · room occupancy unchanged</span></footer>',
            '</section></div>'
        ].join("");
        document.body.appendChild(Root);

        OpenButton = document.createElement("button");
        OpenButton.type = "button";
        OpenButton.className = "StoryDevOpenButton";
        OpenButton.setAttribute("aria-label", "Open developer console");
        OpenButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5 19 6v5.1c0 4.5-2.8 7.8-7 9.4-4.2-1.6-7-4.9-7-9.4V6l7-2.5Z"></path><path d="m9 12 2 2 4-4"></path></svg><span>Dev Console</span>';
        const Navigation = document.querySelector(".MultiplayerHeroNavigation");
        if (Navigation) Navigation.prepend(OpenButton);

        OpenButton.addEventListener("click", OpenConsole);
        El("StoryDevClose").addEventListener("click", CloseConsole);
        El("StoryDevRefresh").addEventListener("click", () => RefreshRooms(false));
        El("StoryDevStopButton").addEventListener("click", StopObserving);
        El("StoryDevOverlay").addEventListener("click", Event => {
            if (Event.target === El("StoryDevOverlay")) CloseConsole();
        });
        document.addEventListener("keydown", Event => {
            if (Event.key === "Escape" && IsOpen) CloseConsole();
        });
        SetStatus(Status);
        RenderRooms();
    }

    function OpenConsole() {
        if (!Authorized || !Root) return;
        IsOpen = true;
        El("StoryDevOverlay").hidden = false;
        OpenButton.setAttribute("aria-expanded", "true");
        RefreshRooms(false);
        StopPolling();
        PollTimer = setInterval(() => RefreshRooms(false), 5000);
    }
    function CloseConsole() {
        if (!Root) return;
        IsOpen = false;
        El("StoryDevOverlay").hidden = true;
        OpenButton.setAttribute("aria-expanded", "false");
        StopPolling();
        StopObserving();
    }
    function RefreshRooms(Reconnected) {
        if (!Socket || !Socket.connected) {
            SetStatus("Reconnecting to multiplayer server…");
            return;
        }
        Socket.timeout(8000).emit("dev:rooms:list", {}, (Error, Result) => {
            if (Error || !Result || !Result.ok || !Result.developer) {
                SetStatus((Result && Result.error) || "Room list could not be loaded.");
                return;
            }
            Authorized = true;
            Mount();
            Rooms = Array.isArray(Result.rooms) ? Result.rooms : [];
            RenderRooms();
            const Count = Rooms.length;
            El("StoryDevRoomCount").textContent = Count + " active room" + (Count === 1 ? "" : "s");
            SetStatus("Connected · live server data");
            if (SelectedCode && !Rooms.some(Room => Room.code === SelectedCode)) {
                StopObserving();
                SetStatus("The selected room has closed.");
            } else if (Reconnected && SelectedCode) {
                ObserveRoom(SelectedCode);
            }
        });
    }
    function RenderRooms() {
        const List = El("StoryDevRoomList");
        if (!List) return;
        List.replaceChildren();
        if (El("StoryDevRoomCountBadge")) El("StoryDevRoomCountBadge").textContent = String(Rooms.length);
        if (!Rooms.length) {
            const Empty = document.createElement("div");
            Empty.className = "StoryDevRoomListEmpty";
            Empty.textContent = "No active multiplayer rooms.";
            List.appendChild(Empty);
            return;
        }
        for (const Room of Rooms) {
            const Button = document.createElement("button");
            Button.type = "button";
            Button.className = "StoryDevRoomItem" + (Room.code === SelectedCode ? " is-selected" : "");
            Button.addEventListener("click", () => ToggleRoomObservation(Room.code));
            const Top = document.createElement("div");
            Top.className = "StoryDevRoomItemTop";
            const Code = document.createElement("strong");
            Code.textContent = Txt(Room.code, "------");
            const StatusBadge = document.createElement("span");
            StatusBadge.className = "StoryDevStatus StoryDevStatus--" + Txt(Room.status, "unknown").toLowerCase().replace(/[^a-z]/g, "");
            StatusBadge.textContent = Txt(Room.status, "unknown").replace(/_/g, " ").toUpperCase();
            Top.append(Code, StatusBadge);
            const Host = document.createElement("div");
            Host.className = "StoryDevRoomItemHost";
            Host.textContent = "Host · " + Txt(Room.hostUsername, "Unknown");
            const Bottom = document.createElement("div");
            Bottom.className = "StoryDevRoomItemBottom";
            const Players = document.createElement("span");
            Players.textContent = Number(Room.playerCount || 0) + " / " + Number(Room.maxPlayers || 5) + " players";
            const Stage = document.createElement("span");
            Stage.textContent = Txt(Room.stageName, Txt(Room.stageId, "Unknown stage"));
            Bottom.append(Players, Stage);
            Button.append(Top, Host, Bottom);
            List.appendChild(Button);
        }
    }
    function ToggleRoomObservation(Code) {
        const Normalized = Txt(Code).toUpperCase();
        if (!Normalized) return;
        if (SelectedCode === Normalized) {
            StopObserving();
            return;
        }
        ObserveRoom(Normalized);
    }
    function ObserveRoom(Code) {
        const Normalized = Txt(Code).toUpperCase();
        if (!Socket || !Socket.connected || !Normalized) return;

        const RequestSequence = ++ObservationRequestSequence;
        SelectedCode = Normalized;
        Snapshot = null;
        RenderRooms();
        RenderDetails(null);
        SetStatus("Opening read-only observer…");
        Socket.timeout(8000).emit("dev:observe", { code: Normalized }, (Error, Result) => {
            // Ignore late acknowledgements after the user has closed or switched rooms.
            if (RequestSequence !== ObservationRequestSequence || SelectedCode !== Normalized) return;
            if (Error || !Result || !Result.ok || !Result.room) {
                SelectedCode = "";
                Snapshot = null;
                RenderRooms();
                RenderDetails(null);
                SetStatus((Result && Result.error) || "Could not observe that room.");
                return;
            }
            Snapshot = Result.room;
            RenderDetails(Snapshot);
            RenderRooms();
            SetStatus("Observing " + Snapshot.code + " · read-only");
        });
    }
    function StopObserving() {
        const PreviousCode = SelectedCode;
        // Invalidate any in-flight observe acknowledgement before clearing the view.
        ObservationRequestSequence += 1;
        if (Socket && Socket.connected && PreviousCode) {
            Socket.timeout(3000).emit("dev:stopObserving", {}, () => {});
        }
        SelectedCode = "";
        Snapshot = null;
        RenderRooms();
        RenderDetails(null);
        SetStatus("No room selected · server view remains open");
    }
    function RenderDetails(Data) {
        const Empty = El("StoryDevEmpty");
        const View = El("StoryDevRoomView");
        if (!Empty || !View) return;
        const HasRoom = Boolean(Data && Data.code && Data.code === SelectedCode);
        Empty.hidden = HasRoom;
        View.hidden = !HasRoom;
        if (!HasRoom) return;
        El("StoryDevSelectedCode").textContent = Data.code;
        El("StoryDevSelectedMeta").textContent = Number(Data.playerCount || 0) + " connected · Stage " + Txt(Data.stageId, "—");
        const StatusBadge = El("StoryDevSelectedStatus");
        StatusBadge.textContent = Txt(Data.status, "unknown").replace(/_/g, " ").toUpperCase();
        StatusBadge.className = "StoryDevStatus StoryDevStatus--" + Txt(Data.status, "unknown").toLowerCase().replace(/[^a-z]/g, "");
        El("StoryDevHost").textContent = Txt(Data.hostUsername, "—");
        El("StoryDevPlayersMetric").textContent = Number(Data.playerCount || 0) + " / " + Number(Data.maxPlayers || 5);
        El("StoryDevLives").textContent = Number(Data.lives || 0) + " / " + Number(Data.maxLives || 3);
        El("StoryDevStage").textContent = Txt(Data.stageName, Txt(Data.stageId, "—"));
        El("StoryDevPlayerCount").textContent = String((Data.players || []).length);
        const PlayerList = El("StoryDevPlayersList");
        PlayerList.replaceChildren();
        if (!Data.players || !Data.players.length) {
            const EmptyPlayers = document.createElement("div");
            EmptyPlayers.className = "StoryDevInlineEmpty";
            EmptyPlayers.textContent = "No players are connected.";
            PlayerList.appendChild(EmptyPlayers);
        } else {
            for (const Player of Data.players) {
                const Row = document.createElement("div");
                Row.className = "StoryDevPlayerRow";
                const Avatar = document.createElement("span");
                Avatar.className = "StoryDevPlayerAvatar";
                Avatar.textContent = Txt(Player.username, "P").slice(0, 1).toUpperCase();
                const NameBlock = document.createElement("div");
                NameBlock.className = "StoryDevPlayerName";
                const Name = document.createElement("strong");
                Name.textContent = Txt(Player.username, "Unknown");
                const Detail = document.createElement("span");
                Detail.textContent = Player.chatBanned ? "Chat restricted" : (Player.ready ? "Ready" : "Connected");
                NameBlock.append(Name, Detail);
                const Dot = document.createElement("i");
                Dot.className = "StoryDevPlayerLive";
                Row.append(Avatar, NameBlock, Dot);
                PlayerList.appendChild(Row);
            }
        }
        RenderMessages(Data.messages || []);
    }
    function RenderMessages(Messages) {
        const Container = El("StoryDevMessages");
        if (!Container) return;
        Container.replaceChildren();
        if (!Messages.length) {
            const Empty = document.createElement("div");
            Empty.className = "StoryDevInlineEmpty";
            Empty.textContent = "No messages in this room yet.";
            Container.appendChild(Empty);
            return;
        }
        for (const Message of Messages.slice(-100)) {
            const Row = document.createElement("article");
            Row.className = "StoryDevMessage" + (Message.bot ? " is-bot" : "");
            const Meta = document.createElement("div");
            Meta.className = "StoryDevMessageMeta";
            const Name = document.createElement("strong");
            Name.textContent = Txt(Message.username, "Unknown");
            const Time = document.createElement("time");
            const SentAt = Number(Message.sentAt || 0);
            const DateValue = new Date(SentAt);
            Time.textContent = Number.isFinite(DateValue.getTime()) && SentAt > 0
                ? DateValue.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}) : "";
            Meta.append(Name, Time);
            const Body = document.createElement("p");
            Body.textContent = Txt(Message.text);
            Row.append(Meta, Body);
            Container.appendChild(Row);
        }
        Container.scrollTop = Container.scrollHeight;
    }
    function MergeRoomState(State) {
        if (!State || State.code !== SelectedCode) return;
        const PreviousMessages = Snapshot && Snapshot.code === State.code ? (Snapshot.messages || []) : [];
        Snapshot = {
            code: Txt(State.code, SelectedCode),
            hostUsername: Txt(State.hostUsername, "Unknown"),
            status: Txt(State.status, "unknown"),
            stageId: Txt(State.stageId),
            stageName: Txt(State.stageName, Txt(State.stageId, "Unknown stage")),
            lives: Number(State.lives || 0),
            maxLives: Number(State.maxLives || 3),
            playerCount: Array.isArray(State.players) ? State.players.length : 0,
            maxPlayers: Number(State.maxPlayers || 5),
            players: Array.isArray(State.players) ? State.players : [],
            messages: Array.isArray(State.messages) && State.messages.length ? State.messages : PreviousMessages
        };
        RenderDetails(Snapshot);
        RenderRooms();
    }
    async function Initialize() {
        let ProfileResult;
        try { ProfileResult = await GetAccountProfile(); } catch { return; }
        const Username = String(ProfileResult && ProfileResult.profile && ProfileResult.profile.username || "").trim().toLowerCase();
        if (Username !== DEVELOPER_USERNAME) return;
        try { await EnsureMultiplayerReady(); } catch { return; }
        if (typeof io !== "function" || typeof GetStorySocketServerUrl !== "function" || typeof GetStorySocketAuth !== "function") return;
        const ServerUrl = GetStorySocketServerUrl();
        const Authenticated = typeof GetAuthToken === "function" && Boolean(GetAuthToken());
        if (!ServerUrl || !Authenticated) return;

        Socket = io(ServerUrl, {
            autoConnect: false,
            withCredentials: false,
            auth: GetStorySocketAuth,
            transports: ["websocket", "polling"]
        });
        Socket.on("connect", () => RefreshRooms(Boolean(SelectedCode)));
        Socket.on("disconnect", () => SetStatus("Disconnected · reconnecting…"));
        Socket.on("connect_error", () => SetStatus("Unable to connect to developer monitor."));
        Socket.on("dev:roomState", MergeRoomState);
        Socket.on("dev:roomChat", Payload => {
            if (!Payload || Payload.code !== SelectedCode || !Snapshot || !Payload.message) return;
            const Messages = Array.isArray(Snapshot.messages) ? Snapshot.messages : [];
            const Key = MsgKey(Payload.message);
            if (!Messages.some(Existing => MsgKey(Existing) === Key)) {
                Messages.push(Payload.message);
                Snapshot.messages = Messages.slice(-100);
                RenderMessages(Snapshot.messages);
            }
        });
        Socket.on("dev:observationEnded", Payload => {
            if (!Payload || Payload.code !== SelectedCode) return;
            SelectedCode = "";
            Snapshot = null;
            RenderRooms();
            RenderDetails(null);
            SetStatus(Payload.reason || "Observation ended.");
        });
        Socket.connect();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => Initialize().catch(() => {}), { once:true });
    } else {
        Initialize().catch(() => {});
    }
})();