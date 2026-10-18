(() => {
    "use strict";

    const ById = Id => document.getElementById(Id);
    const Ui = {
        button: ById("StoryDevGuiToggleButton"),
        panel: ById("StoryDevGui"),
        close: ById("StoryDevGuiClose"),
        refresh: ById("StoryDevGuiRefresh"),
        stop: ById("StoryDevGuiStopObserving"),
        rooms: ById("StoryDevGuiRoomList"),
        status: ById("StoryDevGuiStatus"),
        title: ById("StoryDevGuiRoomTitle"),
        meta: ById("StoryDevGuiRoomMeta"),
        messages: ById("StoryDevGuiMessages"),
        form: ById("StoryDevGuiChatForm"),
        input: ById("StoryDevGuiChatInput")
    };

    let Socket = null;
    let Authorized = false;
    let ActiveCode = "";
    let RefreshTimer = null;
    let RefreshInFlight = false;
    let SeenMessages = new Set();

    if (!Ui.button || !Ui.panel || !Ui.rooms) return;

    function SetStatus(Text, Tone = "neutral") {
        if (!Ui.status) return;
        Ui.status.textContent = String(Text || "");
        Ui.status.dataset.tone = Tone;
    }

    function HumanStatus(Value) {
        const Status = String(Value || "unknown").toLowerCase();
        if (Status === "lobby") return "LOBBY";
        if (Status === "playing") return "IN GAME";
        if (Status === "gameover") return "GAME OVER";
        return Status.replace(/[^a-z0-9 _-]/g, "").toUpperCase() || "UNKNOWN";
    }

    function SocketRequest(EventName, Payload = {}, TimeoutMs = 9000) {
        return new Promise(Resolve => {
            if (!Socket?.connected) {
                Resolve({ ok: false, error: "Multiplayer is not connected." });
                return;
            }

            let Settled = false;
            const Timeout = setTimeout(() => {
                if (Settled) return;
                Settled = true;
                Resolve({ ok: false, error: "The server did not respond in time." });
            }, TimeoutMs);

            Socket.emit(EventName, Payload, Result => {
                if (Settled) return;
                Settled = true;
                clearTimeout(Timeout);
                Resolve(Result || { ok: false, error: "The server returned an empty response." });
            });
        });
    }

    function OpenPanel() {
        Ui.panel.classList.remove("Hidden");
        Ui.panel.setAttribute("aria-hidden", "false");
        Ui.button.setAttribute("aria-expanded", "true");
        RefreshRooms();
        if (RefreshTimer) clearInterval(RefreshTimer);
        RefreshTimer = setInterval(RefreshRooms, 5000);
    }

    function ClosePanel() {
        Ui.panel.classList.add("Hidden");
        Ui.panel.setAttribute("aria-hidden", "true");
        Ui.button.setAttribute("aria-expanded", "false");
        if (RefreshTimer) clearInterval(RefreshTimer);
        RefreshTimer = null;
    }

    function MakeElement(Tag, ClassName, Text) {
        const Element = document.createElement(Tag);
        if (ClassName) Element.className = ClassName;
        if (Text !== undefined) Element.textContent = String(Text);
        return Element;
    }

    function RenderRooms(Rooms) {
        Ui.rooms.replaceChildren();
        if (!Rooms.length) {
            Ui.rooms.appendChild(MakeElement("div", "StoryDevGuiEmpty", "No online rooms right now."));
            return;
        }

        for (const Room of Rooms) {
            const Code = String(Room.code || "");
            const Card = MakeElement("button", "StoryDevGuiRoomCard" + (Code === ActiveCode ? " IsSelected" : ""));
            Card.type = "button";
            Card.dataset.roomCode = Code;

            const Top = MakeElement("span", "StoryDevGuiRoomTop");
            Top.appendChild(MakeElement("strong", "StoryDevGuiCode", Code));
            Top.appendChild(MakeElement("span", "StoryDevGuiRoomStatus " + String(Room.status || "unknown").toLowerCase(), HumanStatus(Room.status)));
            Card.appendChild(Top);

            const Host = MakeElement("span", "StoryDevGuiRoomHost", "Host · " + (Room.hostUsername || "Unknown"));
            Card.appendChild(Host);

            const Footer = MakeElement("span", "StoryDevGuiRoomFooter");
            Footer.appendChild(MakeElement("span", "", (Room.playerCount || 0) + " / " + (Room.maxPlayers || 5) + " players"));
            if (Room.stageName) Footer.appendChild(MakeElement("span", "", Room.stageName));
            Card.appendChild(Footer);

            const Names = Array.isArray(Room.players) ? Room.players.map(Player => Player.username).filter(Boolean) : [];
            if (Names.length) Card.appendChild(MakeElement("span", "StoryDevGuiPlayerNames", Names.join(" · ")));

            Card.addEventListener("click", () => ObserveRoom(Code));
            Ui.rooms.appendChild(Card);
        }
    }

    function MessageKey(Message) {
        return String(Message?.id || [
            Message?.username || "",
            Message?.sentAt || "",
            Message?.text || ""
        ].join("|"));
    }

    function AppendMessage(Message) {
        if (!Ui.messages || !Message) return;
        const Key = MessageKey(Message);
        if (SeenMessages.has(Key)) return;
        SeenMessages.add(Key);
        if (SeenMessages.size > 400) SeenMessages = new Set([...SeenMessages].slice(-250));

        const Item = MakeElement("article", "StoryDevGuiMessage" + (Message.bot ? " IsBot" : ""));
        const Header = MakeElement("div", "StoryDevGuiMessageHeader");
        Header.appendChild(MakeElement("strong", "", Message.username || "Player"));
        if (Message.bot) Header.appendChild(MakeElement("span", "StoryDevGuiBotBadge", "BOT"));
        if (Message.sentAt) {
            const When = new Date(Number(Message.sentAt));
            if (Number.isFinite(When.getTime())) {
                Header.appendChild(MakeElement("time", "", When.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })));
            }
        }
        Item.appendChild(Header);
        Item.appendChild(MakeElement("p", "", Message.text || ""));
        Ui.messages.appendChild(Item);
        while (Ui.messages.children.length > 160) Ui.messages.firstElementChild?.remove();
        Ui.messages.scrollTop = Ui.messages.scrollHeight;
    }

    function RenderHistory(Messages) {
        Ui.messages.replaceChildren();
        SeenMessages.clear();
        for (const Message of Array.isArray(Messages) ? Messages : []) AppendMessage(Message);
        if (!Ui.messages.children.length) {
            Ui.messages.appendChild(MakeElement("div", "StoryDevGuiEmpty", "This room has no messages yet."));
        }
    }

    function UpdateRoomState(State) {
        if (!State || String(State.code || "") !== ActiveCode) return;
        if (Ui.title) Ui.title.textContent = "ROOM " + ActiveCode;
        const PlayerNames = Array.isArray(State.players) ? State.players.map(Player => Player.username).filter(Boolean).join(", ") : "";
        const Stage = State.stageId ? " · Stage " + State.stageId : "";
        if (Ui.meta) Ui.meta.textContent =
            HumanStatus(State.status) + " · " + (State.players?.length || 0) + " players" + Stage +
            (PlayerNames ? " · " + PlayerNames : "");
        RefreshRooms(false);
    }

    async function RefreshRooms(ShowStatus = true) {
        if (!Socket?.connected || RefreshInFlight) return;
        RefreshInFlight = true;
        try {
            const Result = await SocketRequest("dev:rooms:list");
            if (!Result?.ok) {
                if (Result?.error === "Developer access required.") {
                    Authorized = false;
                    Ui.button.classList.add("Hidden");
                    ClosePanel();
                    return;
                }
                if (ShowStatus) SetStatus(Result?.error || "Could not load live rooms.", "error");
                return;
            }

            Authorized = true;
            Ui.button.classList.remove("Hidden");
            const Rooms = Array.isArray(Result.rooms) ? Result.rooms : [];
            RenderRooms(Rooms);

            if (ActiveCode && !Rooms.some(Room => String(Room.code) === ActiveCode)) {
                ActiveCode = "";
                if (Ui.title) Ui.title.textContent = "Select a live room";
                if (Ui.meta) Ui.meta.textContent = "Rooms are listed while at least one player is online.";
                RenderHistory([]);
                SetStatus("The selected room is no longer online.", "error");
            } else if (ShowStatus) {
                SetStatus(Rooms.length ? "Live room list updated." : "No online rooms right now.", "neutral");
            }
        } finally {
            RefreshInFlight = false;
        }
    }

    async function ObserveRoom(Code) {
        if (!Authorized || !Code) return;
        SetStatus("Opening " + Code + "…", "neutral");
        const Result = await SocketRequest("dev:observe", { code: Code });
        if (!Result?.ok) {
            SetStatus(Result?.error || "Could not open that room.", "error");
            RefreshRooms(false);
            return;
        }

        ActiveCode = String(Result.code || Code);
        const State = Result.state || {};
        if (Ui.title) Ui.title.textContent = "ROOM " + ActiveCode;
        if (Ui.meta) {
            const PlayerNames = Array.isArray(State.players) ? State.players.map(Player => Player.username).filter(Boolean).join(", ") : "";
            Ui.meta.textContent = (Result.observer ? "DEV OBSERVER" : "CURRENT ROOM") + " · " +
                HumanStatus(State.status) + " · " + (State.players?.length || 0) + " players" +
                (PlayerNames ? " · " + PlayerNames : "");
        }
        RenderHistory(State.messages);
        RenderRoomsCacheSelection();
        SetStatus(Result.observer ? "Connected as a developer observer. You do not occupy a player slot." : "You are already a player in this room.", "success");
        RefreshRooms(false);
    }

    function RenderRoomsCacheSelection() {
        for (const Card of Ui.rooms.querySelectorAll("[data-room-code]")) {
            Card.classList.toggle("IsSelected", Card.dataset.roomCode === ActiveCode);
        }
    }

    async function StopObserving() {
        if (Socket?.connected) Socket.emit("room:leave", {});
        ActiveCode = "";
        if (Ui.title) Ui.title.textContent = "Select a live room";
        if (Ui.meta) Ui.meta.textContent = "Choose any online group chat from the list.";
        RenderHistory([]);
        RenderRoomsCacheSelection();
        SetStatus("Left the selected room.", "neutral");
        RefreshRooms(false);
    }

    function BindSocket(NewSocket) {
        if (!NewSocket || Socket === NewSocket) return;
        if (Socket) {
            Socket.off("room:chat", OnRoomChat);
            Socket.off("room:state", OnRoomState);
            Socket.off("connect", OnConnect);
            Socket.off("disconnect", OnDisconnect);
        }
        Socket = NewSocket;
        Socket.on("room:chat", OnRoomChat);
        Socket.on("room:state", OnRoomState);
        Socket.on("connect", OnConnect);
        Socket.on("disconnect", OnDisconnect);
        if (Socket.connected) OnConnect();
    }

    function OnRoomChat(Message) {
        if (ActiveCode) AppendMessage(Message);
    }

    function OnRoomState(State) {
        UpdateRoomState(State);
    }

    function OnConnect() {
        RefreshRooms();
    }

    function OnDisconnect() {
        SetStatus("Multiplayer disconnected. Reconnecting…", "error");
    }

    Ui.button.addEventListener("click", () => {
        if (Ui.panel.classList.contains("Hidden")) OpenPanel();
        else ClosePanel();
    });
    Ui.close?.addEventListener("click", ClosePanel);
    Ui.refresh?.addEventListener("click", () => RefreshRooms());
    Ui.stop?.addEventListener("click", StopObserving);
    Ui.panel.querySelector("[data-devgui-close]")?.addEventListener("click", ClosePanel);

    Ui.form?.addEventListener("submit", Event => {
        Event.preventDefault();
        const Text = String(Ui.input?.value || "").trim().slice(0, 180);
        if (!Text || !Socket?.connected || !ActiveCode) return;
        Socket.emit("room:chat", { text: Text });
        Ui.input.value = "";
        Ui.input.focus();
    });

    function WaitForMultiplayerSocket() {
        const Current = typeof MultiplayerSocket !== "undefined" ? MultiplayerSocket : null;
        if (Current) {
            BindSocket(Current);
            if (Current.connected) RefreshRooms();
            return;
        }
        setTimeout(WaitForMultiplayerSocket, 250);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", WaitForMultiplayerSocket, { once: true });
    } else {
        WaitForMultiplayerSocket();
    }
})();
