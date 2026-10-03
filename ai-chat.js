const STORY_BOT_NAME = "StoryBot";
const STORY_BOT_COMMAND = "@StoryBot";
const STORY_BOT_MAX_QUESTION_LENGTH = 1200;
const STORY_BOT_REQUEST_TIMEOUT = 150000;

const STORY_BOT_COMMANDS = [{
    name: "StoryBot",
    command: STORY_BOT_COMMAND,
    description: "Ask the AI about the current story"
}];

const BoundBotSockets = new WeakSet();
const StoryBotRenderedMessageIds = new Set();

function GetChatContainers() {
    return [
        document.getElementById("ChatMessages"),
        document.getElementById("GameChatMessages")
    ].filter(Boolean);
}

function GetStoryBotChatContainer() {
    return document.getElementById("GameChatMessages")
        || document.getElementById("ChatMessages")
        || null;
}

function RemoveQuietChatState(Container) {
    Container?.querySelector(".ChatQuietState")?.remove();
}

function RefreshQuietChatState(Container = null) {
    const Containers = Container ? [Container] : GetChatContainers();

    for (const ChatContainer of Containers) {
        const HasRealMessage = [...ChatContainer.children].some(Element =>
            !Element.classList.contains("StoryBotTyping") &&
            !Element.classList.contains("StoryBotRequestError") &&
            !Element.classList.contains("ChatQuietState")
        );

        const ExistingQuietState = ChatContainer.querySelector(".ChatQuietState");

        if (HasRealMessage || ChatContainer.querySelector(".StoryBotTyping")) {
            ExistingQuietState?.remove();
            continue;
        }

        if (!ExistingQuietState && ChatContainer.childElementCount === 0) {
            const QuietState = document.createElement("div");
            QuietState.className = "ChatQuietState";
            QuietState.textContent = "It’s quiet here. Send the first message.";
            ChatContainer.appendChild(QuietState);
        }
    }
}

function SetStoryBotTyping(Typing) {
    const Container = GetStoryBotChatContainer();
    if (!Container) return;

    let TypingRow = Container.querySelector(".StoryBotTyping");

    if (!Typing) {
        TypingRow?.remove();
        RefreshQuietChatState(Container);
        return;
    }

    RemoveQuietChatState(Container);

    if (!TypingRow) {
        TypingRow = document.createElement("div");
        TypingRow.className = "StoryBotTyping";
        TypingRow.innerHTML = `
            <span class="StoryBotMark" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M12 3.5 14.2 8l4.8.7-3.5 3.4.8 4.8-4.3-2.2-4.3 2.2.8-4.8L5 8.7 9.8 8 12 3.5Z"></path></svg>
            </span>
            <span>StoryBot is thinking</span>
            <span class="StoryBotDots" aria-hidden="true"><i></i><i></i><i></i></span>
        `;
        Container.appendChild(TypingRow);
    }

    Container.scrollTop = Container.scrollHeight;
}

function ShowStoryBotError(Message) {
    const ErrorText = String(Message || "").trim();
    if (!ErrorText) return;

    const Container = GetStoryBotChatContainer();
    if (!Container) return;

    RemoveQuietChatState(Container);

    const ErrorElement = document.createElement("div");
    ErrorElement.className = "StoryBotRequestError";
    ErrorElement.textContent = ErrorText;
    Container.appendChild(ErrorElement);

    while (Container.childElementCount > 40) {
        Container.firstElementChild?.remove();
    }

    Container.scrollTop = Container.scrollHeight;
}

function GetStoryBotComposerNotice(Form) {
    if (!Form) return null;

    let Notice = Form.querySelector(".StoryBotComposerNotice");
    if (!Notice) {
        Notice = document.createElement("div");
        Notice.className = "StoryBotComposerNotice";
        Notice.hidden = true;
        Notice.setAttribute("role", "status");
        Notice.setAttribute("aria-live", "polite");
        Form.prepend(Notice);
    }

    return Notice;
}

function ShowStoryBotComposerNotice(Form, Message) {
    const Notice = GetStoryBotComposerNotice(Form);
    if (!Notice) return;

    Notice.textContent = String(Message || "").trim();
    Notice.hidden = false;
}

function ClearStoryBotComposerNotice(Form) {
    const Notice = Form?.querySelector(".StoryBotComposerNotice");
    if (!Notice) return;
    Notice.hidden = true;
    Notice.textContent = "";
}

function RememberStoryBotRenderedMessage(Message) {
    const Id = String(Message?.id || "").trim();
    if (!Message?.bot || !Id) return false;
    if (StoryBotRenderedMessageIds.has(Id)) return true;

    StoryBotRenderedMessageIds.add(Id);

    while (StoryBotRenderedMessageIds.size > 100) {
        const Oldest = StoryBotRenderedMessageIds.values().next().value;
        if (Oldest === undefined) break;
        StoryBotRenderedMessageIds.delete(Oldest);
    }

    return false;
}

function MarkLastChatMessage(ContainerId, Message) {
    const Container = document.getElementById(ContainerId);
    const Last = Container?.lastElementChild;
    if (!Last) return;

    if (Message?.bot || Message?.username === STORY_BOT_NAME) {
        Last.classList.add("StoryBotMessage");
    }
}

function RenderStoryBotReplyMessage(Message, ContainerId) {
    if (!Message?.bot || Message.botDialog) return;

    const Id = String(Message.id || "").trim();
    if (Id && StoryBotRenderedMessageIds.has(Id)) return;

    if (ContainerId === "ChatMessages" && typeof AppendChat === "function") {
        AppendChat(Message);
        return;
    }

    if (ContainerId === "GameChatMessages" && typeof AppendGameChat === "function") {
        AppendGameChat(Message);
    }
}

function GetStoryBotCurrentUsername() {
    try {
        if (typeof CurrentProfile !== "undefined" && CurrentProfile?.username) {
            return String(CurrentProfile.username);
        }
    } catch {}

    try {
        if (typeof Profile !== "undefined" && Profile?.username) {
            return String(Profile.username);
        }
    } catch {}

    return "";
}

function GetConnectedStoryBotSocket() {
    try {
        if (typeof MultiplayerSocket !== "undefined" && MultiplayerSocket?.connected) {
            return MultiplayerSocket;
        }
    } catch {}

    return null;
}

async function WaitForStoryBotSocket() {
    const Existing = GetConnectedStoryBotSocket();
    if (Existing) return Existing;

    let Socket = null;

    try {
        if (typeof MultiplayerSocket !== "undefined" && MultiplayerSocket) {
            Socket = MultiplayerSocket;
        }
    } catch {}

    if (!Socket) return null;

    if (!Socket.connected) {
        try {
            Socket.connect();
        } catch {
            return null;
        }
    }

    if (Socket.connected) return Socket;

    return new Promise(Resolve => {
        let Settled = false;

        const Finish = Value => {
            if (Settled) return;
            Settled = true;
            clearTimeout(Timer);
            Socket.off("connect", OnConnect);
            Socket.off("connect_error", OnError);
            Resolve(Value);
        };

        const OnConnect = () => Finish(Socket);
        const OnError = () => Finish(null);
        const Timer = setTimeout(() => Finish(null), 12000);

        Socket.once("connect", OnConnect);
        Socket.once("connect_error", OnError);
    });
}

function NormalizeStoryBotMentionText(Value) {
    return String(Value || "").replace(/@story\\s*bot\\b/gi, STORY_BOT_COMMAND);
}

function NormalizeStoryBotQuestionText(Value) {
    return String(Value || "")
        .replace(/[\\u0000-\\u001F\\u007F]/g, " ")
        .replace(/\\s+/g, " ")
        .trim()
        .slice(0, STORY_BOT_MAX_QUESTION_LENGTH);
}

function ExtractStoryBotQuestion(Value) {
    const Normalized = NormalizeStoryBotMentionText(Value).trim();
    const Match = Normalized.match(/(?:^|\\s)@storybot\\b([\\s\\S]*)$/i);

    if (!Match) return null;
    return NormalizeStoryBotQuestionText(Match[1] || "");
}

function GetStoryBotActiveChatInput() {
    return document.getElementById("GameChatInput")
        || document.getElementById("ChatInput")
        || null;
}

function GetActiveMentionText(Input) {
    const Value = String(Input?.value || "");
    const Selection = Number.isInteger(Input?.selectionStart)
        ? Input.selectionStart
        : Value.length;
    const BeforeCursor = Value.slice(0, Selection);
    const Match = BeforeCursor.match(/(^|\\s)(@[A-Za-z0-9_]*)$/);
    return Match ? Match[2] : "";
}

function StoryBotRobotIconMarkup() {
    return `<svg class="StoryBotRobotIcon" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="5" y="7" width="14" height="11" rx="3"></rect>
        <path d="M12 4v3M8.5 11h.01M15.5 11h.01M8.5 14.5h7M3 12h2M19 12h2"></path>
    </svg>`;
}

function BuildStoryBotCommandPopup(Input) {
    if (!Input || Input.dataset.storyBotPopupBound === "1") return;

    const Form = Input.closest(".ChatForm");
    if (!Form) return;

    Input.dataset.storyBotPopupBound = "1";

    let Popup = Form.parentElement?.querySelector(".StoryBotCommandPopup");
    if (!Popup) {
        Popup = document.createElement("div");
        Popup.className = "StoryBotCommandPopup";
        Popup.setAttribute("role", "listbox");
        Popup.hidden = true;
        Form.before(Popup);
    }

    const ClosePopup = () => {
        Popup.hidden = true;
        Popup.innerHTML = "";
    };

    const RenderPopup = () => {
        const Mention = GetActiveMentionText(Input).toLowerCase();

        if (!Mention.startsWith("@")) {
            ClosePopup();
            return;
        }

        const Matches = STORY_BOT_COMMANDS.filter(Command =>
            Command.command.toLowerCase().startsWith(Mention)
        );

        if (!Matches.length) {
            ClosePopup();
            return;
        }

        Popup.innerHTML = "";

        for (const Command of Matches) {
            const Button = document.createElement("button");
            Button.className = "StoryBotCommandItem";
            Button.type = "button";
            Button.setAttribute("role", "option");

            const Icon = document.createElement("span");
            Icon.className = "StoryBotCommandIcon";
            Icon.innerHTML = StoryBotRobotIconMarkup();

            const Copy = document.createElement("span");
            Copy.className = "StoryBotCommandCopy";

            const Name = document.createElement("strong");
            Name.textContent = Command.command;

            const Description = document.createElement("small");
            Description.textContent = Command.description;

            Copy.append(Name, Description);
            Button.append(Icon, Copy);

            Button.addEventListener("mousedown", Event => Event.preventDefault());
            Button.addEventListener("click", () => {
                const Value = Input.value;
                const Selection = Number.isInteger(Input.selectionStart)
                    ? Input.selectionStart
                    : Value.length;

                const Before = Value.slice(0, Selection);
                const After = Value.slice(Selection);
                const Match = Before.match(/(^|\\s)(@[A-Za-z0-9_]*)$/);
                const Start = Match ? Selection - Match[2].length : Selection;

                Input.value = Value.slice(0, Start) + Command.command + " " + After;
                Input.focus();

                const Caret = Start + Command.command.length + 1;
                Input.setSelectionRange(Caret, Caret);
                ClearStoryBotComposerNotice(Form);
                ClosePopup();
            });

            Popup.appendChild(Button);
        }

        Popup.hidden = false;
    };

    Input.addEventListener("input", () => {
        ClearStoryBotComposerNotice(Form);
        RenderPopup();
    });

    Input.addEventListener("paste", () => {
        setTimeout(RenderPopup, 0);
    });

    Input.addEventListener("focus", RenderPopup);
    Input.addEventListener("blur", () => setTimeout(ClosePopup, 120));

    Input.addEventListener("keydown", Event => {
        if (Event.key === "Escape") {
            ClosePopup();
        }
    });
}

function BindStoryBotCommandPopups() {
    document.querySelectorAll(".ChatInput").forEach(BuildStoryBotCommandPopup);
}

function SetStoryBotComposerBusy(Form, Busy) {
    const Input = Form?.querySelector(".ChatInput");
    const Button = Form?.querySelector('button[type="submit"]');

    if (Input) Input.disabled = Busy;
    if (Button) Button.disabled = Busy;
}

async function SubmitStoryBotFromComposer(Form, Input, Question) {
    const CleanQuestion = NormalizeStoryBotQuestionText(Question);

    if (!CleanQuestion) {
        ShowStoryBotComposerNotice(Form, "Type a question after @StoryBot.");
        Input?.focus();
        return;
    }

    const Socket = await WaitForStoryBotSocket();

    if (!Socket?.connected) {
        ShowStoryBotComposerNotice(Form, "Multiplayer is offline. Reconnect to the room before asking StoryBot.");
        SetStoryBotConnectionState("offline");
        Input?.focus();
        return;
    }

    ClearStoryBotComposerNotice(Form);
    SetStoryBotComposerBusy(Form, true);
    SetStoryBotTyping(true);

    const PreviousValue = String(Input?.value || "");
    if (Input) Input.value = "";

    try {
        const Result = await new Promise(Resolve => {
            Socket.timeout(STORY_BOT_REQUEST_TIMEOUT).emit(
                "storybot:ask",
                { question: CleanQuestion },
                (Error, Reply) => Resolve(
                    Error
                        ? { ok: false, timeout: true, error: "StoryBot did not answer in time." }
                        : (Reply || { ok: false, error: "StoryBot could not answer right now." })
                )
            );
        });

        if (Result?.ok && Result.message) {
            RenderStoryBotReplyMessage(
                Result.message,
                Form.closest(".ChatPanelBody")?.querySelector(".ChatMessages")?.id
                    || GetStoryBotChatContainer()?.id
                    || "GameChatMessages"
            );
            return;
        }

        if (Result?.timeout) {
            ShowStoryBotError(Result.error);
            return;
        }

        // The server also emits room:botError for a rejected request, so avoid duplicating that notice.
        if (!Result?.error) {
            ShowStoryBotError("StoryBot could not answer right now.");
        }
    } catch (Error) {
        ShowStoryBotError(String(Error?.message || "StoryBot could not answer right now."));
    } finally {
        SetStoryBotTyping(false);
        SetStoryBotComposerBusy(Form, false);

        if (Input && document.contains(Input)) {
            if (!Input.value) {
                // Keep normal chat composer clear after a successful send.
                Input.value = "";
            }

            Input.focus();
        }

        if (PreviousValue && !Form.isConnected) {
            // The frame was replaced while the request was running; do not try to restore stale DOM.
            return;
        }
    }
}

function BindStoryBotComposer(Form) {
    if (!Form || Form.dataset.storyBotComposerBound === "1") return;

    const Input = Form.querySelector(".ChatInput");
    if (!Input) return;

    Form.dataset.storyBotComposerBound = "1";

    Form.addEventListener("submit", Event => {
        const RawValue = String(Input.value || "");
        const NormalizedValue = NormalizeStoryBotMentionText(RawValue);
        const Question = ExtractStoryBotQuestion(NormalizedValue);

        Input.value = NormalizedValue;

        if (Question === null) {
            return;
        }

        Event.preventDefault();
        Event.stopImmediatePropagation();

        const CleanQuestion = NormalizeStoryBotQuestionText(Question);

        if (!CleanQuestion) {
            ShowStoryBotComposerNotice(Form, "Type a question after @StoryBot.");
            Input.focus();
            return;
        }

        void SubmitStoryBotFromComposer(Form, Input, CleanQuestion);
    }, true);
}

function BindStoryBotComposerForms() {
    document.querySelectorAll(".ChatForm").forEach(BindStoryBotComposer);
}

function WrapStoryBotRenderers() {
    if (typeof AppendChat === "function" && !AppendChat.StoryBotWrapped) {
        const BaseAppendChat = AppendChat;

        const WrappedAppendChat = function(Message, ...Rest) {
            const Container = document.getElementById("ChatMessages");
            RemoveQuietChatState(Container);

            if (!RememberStoryBotRenderedMessage(Message)) {
                BaseAppendChat(Message, ...Rest);
                MarkLastChatMessage("ChatMessages", Message);
            }

            RefreshQuietChatState(Container);
        };

        WrappedAppendChat.StoryBotWrapped = true;
        AppendChat = WrappedAppendChat;
    }

    if (typeof AppendGameChat === "function" && !AppendGameChat.StoryBotWrapped) {
        const BaseAppendGameChat = AppendGameChat;

        const WrappedAppendGameChat = function(Message, ...Rest) {
            const Container = document.getElementById("GameChatMessages");
            RemoveQuietChatState(Container);

            if (!RememberStoryBotRenderedMessage(Message)) {
                BaseAppendGameChat(Message, ...Rest);
                MarkLastChatMessage("GameChatMessages", Message);
            }

            RefreshQuietChatState(Container);
        };

        WrappedAppendGameChat.StoryBotWrapped = true;
        AppendGameChat = WrappedAppendGameChat;
    }

    if (typeof RenderRoom === "function" && !RenderRoom.StoryBotWrapped) {
        const BaseRenderRoom = RenderRoom;

        const WrappedRenderRoom = function(...Arguments) {
            const Result = BaseRenderRoom(...Arguments);
            queueMicrotask(() => RefreshQuietChatState(document.getElementById("ChatMessages")));
            return Result;
        };

        WrappedRenderRoom.StoryBotWrapped = true;
        RenderRoom = WrappedRenderRoom;
    }

    if (typeof ApplyRoomState === "function" && !ApplyRoomState.StoryBotChatWrapped) {
        const BaseApplyRoomState = ApplyRoomState;

        const WrappedApplyRoomState = function(...Arguments) {
            const Result = BaseApplyRoomState(...Arguments);
            queueMicrotask(() => RefreshQuietChatState(document.getElementById("GameChatMessages")));
            return Result;
        };

        WrappedApplyRoomState.StoryBotChatWrapped = true;
        ApplyRoomState = WrappedApplyRoomState;
    }
}

function SetStoryBotConnectionState(State) {
    if (typeof SetMultiplayerConnectionBadge === "function") {
        SetMultiplayerConnectionBadge(State);
    }
}

function BindStoryBotSocket(Socket) {
    if (!Socket || BoundBotSockets.has(Socket)) return;

    BoundBotSockets.add(Socket);

    Socket.on("connect", () => {
        SetStoryBotConnectionState("online");
    });

    Socket.on("disconnect", () => {
        SetStoryBotConnectionState("reconnecting");
        SetStoryBotTyping(false);
    });

    Socket.on("connect_error", () => {
        SetStoryBotConnectionState("reconnecting");
    });

    Socket.on("room:botTyping", Payload => {
        SetStoryBotTyping(Boolean(Payload?.typing));
    });

    Socket.on("room:botError", Payload => {
        SetStoryBotTyping(false);
        ShowStoryBotError(Payload?.error);
    });
}

function WrapStoryBotSocketHooks() {
    if (typeof BindSocket === "function" && !BindSocket.StoryBotWrapped) {
        const BaseBindSocket = BindSocket;

        const WrappedBindSocket = function(Socket) {
            const Result = BaseBindSocket(Socket);
            BindStoryBotSocket(Socket);
            return Result;
        };

        WrappedBindSocket.StoryBotWrapped = true;
        BindSocket = WrappedBindSocket;
    }

    if (typeof StartMultiplayer === "function" && !StartMultiplayer.StoryBotWrapped) {
        const BaseStartMultiplayer = StartMultiplayer;

        const WrappedStartMultiplayer = function(...Arguments) {
            const Result = BaseStartMultiplayer(...Arguments);
            BindStoryBotSocket(MultiplayerSocket);
            BindStoryBotComposerForms();
            return Result;
        };

        WrappedStartMultiplayer.StoryBotWrapped = true;
        StartMultiplayer = WrappedStartMultiplayer;
    }

    try {
        if (typeof MultiplayerSocket !== "undefined" && MultiplayerSocket) {
            BindStoryBotSocket(MultiplayerSocket);
        }
    } catch {}
}

function ConfigureStoryBotInputs() {
    const LobbyInput = document.getElementById("ChatInput");
    const GameInput = document.getElementById("GameChatInput");
    const JoinInput = document.getElementById("JoinCodeInput");

    if (LobbyInput) {
        LobbyInput.placeholder = "Message or @StoryBot a question...";
        LobbyInput.autocapitalize = "sentences";
        LobbyInput.enterKeyHint = "send";
        LobbyInput.setAttribute("aria-label", "Chat message or StoryBot question");
    }

    if (GameInput) {
        GameInput.placeholder = "Message or @StoryBot a question...";
        GameInput.autocapitalize = "sentences";
        GameInput.enterKeyHint = "send";
        GameInput.setAttribute("aria-label", "Chat message or StoryBot question");
    }

    if (JoinInput) {
        JoinInput.autocapitalize = "characters";
        JoinInput.autocomplete = "off";
        JoinInput.spellcheck = false;
        JoinInput.enterKeyHint = "go";
        JoinInput.inputMode = "text";
    }
}

function InitializeStoryBotUi() {
    WrapStoryBotRenderers();
    WrapStoryBotSocketHooks();
    ConfigureStoryBotInputs();
    BindStoryBotCommandPopups();
    BindStoryBotComposerForms();
    SetStoryBotConnectionState("offline");
    RefreshQuietChatState();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", InitializeStoryBotUi, { once: true });
} else {
    InitializeStoryBotUi();
}
