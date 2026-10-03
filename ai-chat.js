const STORY_BOT_NAME = "StoryBot";
const STORY_BOT_COMMAND = "@StoryBot";
const STORY_BOT_COMMANDS = [{
    name: "StoryBot",
    command: "@StoryBot",
    description: "Ask the AI about the current story"
}];
const BoundBotSockets = new WeakSet();
const StoryBotRenderedMessageIds = new Set();
const STORY_BOT_MAX_QUESTION_LENGTH = 1200;

function GetStoryBotChatContainer() {
    return document.getElementById("GameChatMessages") || document.getElementById("ChatMessages");
}

function GetChatContainers() {
    return [
        document.getElementById("ChatMessages"),
        document.getElementById("GameChatMessages")
    ].filter(Boolean);
}

function RefreshQuietChatState(Container = null) {
    const Containers = Container ? [Container] : GetChatContainers();

    for (const ChatContainer of Containers) {
        const RealMessages = [...ChatContainer.children].filter(Element => {
            return !Element.classList.contains("ChatQuietState") &&
                !Element.classList.contains("StoryBotTyping");
        });

        let QuietState = ChatContainer.querySelector(".ChatQuietState");

        if (RealMessages.length > 0) {
            QuietState?.remove();
            continue;
        }

        if (!QuietState) {
            QuietState = document.createElement("div");
            QuietState.className = "ChatQuietState";
            QuietState.textContent = "It’s quiet here. Send the first message.";
            ChatContainer.prepend(QuietState);
        }
    }
}

function RemoveQuietChatState(Container) {
    Container?.querySelector(".ChatQuietState")?.remove();
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
    while (Container.childElementCount > 30) Container.firstElementChild?.remove();
    Container.scrollTop = Container.scrollHeight;
}
function MarkLastChatMessage(ContainerId, Message) {
    const Container = document.getElementById(ContainerId);
    const Last = Container?.lastElementChild;
    if (!Last) return;

    if (Message?.bot || Message?.username === STORY_BOT_NAME) {
        Last.classList.add("StoryBotMessage");
    }

    if (Message?.system || Message?.vote) {
        Last.classList.add("VoteActivityMessage");
    }
}

function RememberStoryBotRenderedMessage(Message) {
    const Id = String(Message?.id || "").trim();
    if (!Message?.bot || Message?.botDialog || !Id) return false;
    if (StoryBotRenderedMessageIds.has(Id)) return true;

    StoryBotRenderedMessageIds.add(Id);
    while (StoryBotRenderedMessageIds.size > 100) {
        const Oldest = StoryBotRenderedMessageIds.values().next().value;
        if (Oldest === undefined) break;
        StoryBotRenderedMessageIds.delete(Oldest);
    }
    return false;
}

function RenderStoryBotReplyMessage(Message, ContainerId) {
    if (!Message || !Message.bot || Message.botDialog) return;

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
        if (typeof CurrentProfile !== "undefined" && CurrentProfile?.username) return String(CurrentProfile.username);
    } catch {}
    try {
        if (typeof Profile !== "undefined" && Profile?.username) return String(Profile.username);
    } catch {}
    return "";
}

function GetConnectedStoryBotSocket() {
    try {
        if (typeof MultiplayerSocket !== "undefined" && MultiplayerSocket?.connected) return MultiplayerSocket;
    } catch {}
    return null;
}

function NormalizeStoryBotMentionText(Value) {
    return String(Value || "").replace(/@story\s*bot\b/gi, STORY_BOT_COMMAND);
}

function NormalizeStoryBotQuestionText(Value) {
    return String(Value || "")
        .replace(/[\u0000-\u001F\u007F]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, STORY_BOT_MAX_QUESTION_LENGTH);
}

function StoryBotRobotIconMarkup() {
    return `<svg class="StoryBotRobotIcon" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="5" y="7" width="14" height="11" rx="3"></rect>
        <path d="M12 4v3M8.5 11h.01M15.5 11h.01M8.5 14.5h7M3 12h2M19 12h2"></path>
    </svg>`;
}

function SetStoryBotConnectionState(State) {
    if (typeof SetMultiplayerConnectionBadge === "function") {
        SetMultiplayerConnectionBadge(State);
    }
}

function GetStoryBotContainerForInput(Input) {
    const Form = Input?.closest(".ChatForm");
    if (!Form) return null;

    return Form.parentElement?.querySelector(".ChatMessages")
        || Form.closest(".ChatPanelBody")?.querySelector(".ChatMessages")
        || null;
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
        Matches.forEach((Command, Index) => {
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
                const Selection = Number.isInteger(Input.selectionStart) ? Input.selectionStart : Value.length;
                const Before = Value.slice(0, Selection);
                const After = Value.slice(Selection);
                const Match = Before.match(/(^|\s)(@[A-Za-z0-9_]*)$/);
                const Start = Match ? Selection - Match[2].length : Selection;

                Input.value = Value.slice(0, Start) + Command.command + " " + After;
                Input.focus();
                const Caret = Start + Command.command.length + 1;
                Input.setSelectionRange(Caret, Caret);
                ClosePopup();
            });

            Popup.appendChild(Button);
        });

        Popup.hidden = false;
    };

    const HandleMentionTrigger = () => {
        return false;
    };

    Input.addEventListener("input", () => {
        UpdateStoryBotComposerLength(Input);
        if (HandleMentionTrigger()) return;
        RenderPopup();
    });

    Input.addEventListener("paste", () => {
        setTimeout(() => {
            UpdateStoryBotComposerLength(Input);
            if (!HandleMentionTrigger()) RenderPopup();
        }, 0);
    });
    Input.addEventListener("focus", RenderPopup);
    Input.addEventListener("blur", () => setTimeout(ClosePopup, 120));
    Input.addEventListener("keydown", Event => {
        if (Event.key === "Enter" && !Event.shiftKey) {
            const NormalizedValue = NormalizeStoryBotMentionText(Input.value).trim();
            if (/^@story\s*bot$/i.test(NormalizedValue)) {
                Event.preventDefault();
                ShowStoryBotMentionPrompt(Input);
                ClosePopup();
                return;
            }
            Input.value = NormalizeStoryBotMentionText(Input.value);
            ClosePopup();
        }
        if (Event.key === "Escape") ClosePopup();
    });
}

function BindStoryBotCommandPopups() {
    document.querySelectorAll(".ChatInput").forEach(BuildStoryBotCommandPopup);
}

async function SubmitStoryBotFromChat(Form) {
    const Input = Form?.querySelector(".ChatInput");
    const Container = GetStoryBotContainerForInput(Input);
    const ContainerId = Container?.id || "ChatMessages";
    const Normalized = NormalizeStoryBotMentionText(Input?.value).trim();
    const MentionMatch = Normalized.match(/@story\s*bot\b/i);
    if (!MentionMatch) return false;

    const Question = NormalizeStoryBotQuestionText(
        Normalized.slice(MentionMatch.index + MentionMatch[0].length)
    );

    if (!Question) {
        ShowStoryBotMentionPrompt(Input);
        return true;
    }

    const Socket = GetConnectedStoryBotSocket();
    if (!Socket?.connected) {
        ShowStoryBotError("Multiplayer is offline. Reconnect to the room before asking StoryBot.");
        SetStoryBotConnectionState("offline");
        return true;
    }

    Input.disabled = true;
    Input.value = "";
    Input.maxLength = 180;
    SetStoryBotTyping(true);

    const Result = await new Promise(resolve => {
        Socket.timeout(75000).emit(
            "storybot:ask",
            { question: Question },
            (Error, Reply) => resolve(
                Error
                    ? { ok: false, error: "StoryBot did not answer in time." }
                    : (Reply || { ok: false, error: "StoryBot could not answer right now." })
            )
        );
    });

    SetStoryBotTyping(false);

    if (!Result?.ok) {
        ShowStoryBotError(Result?.error || "StoryBot could not answer right now.");
    } else if (Result.message) {
        RenderStoryBotReplyMessage(Result.message, ContainerId);
    }

    Input.disabled = false;
    Input.value = "";
    Input.maxLength = 180;
    Input.focus();
    return true;
}
function BindStoryBotMentionNormalization() {
    document.querySelectorAll(".ChatForm").forEach(Form => {
        if (!Form || Form.dataset.storyBotMentionNormalizationBound === "1") return;
        Form.dataset.storyBotMentionNormalizationBound = "1";

        Form.addEventListener("submit", async Event => {
            const Input = Form.querySelector(".ChatInput");
            if (!Input) return;

            const Normalized = NormalizeStoryBotMentionText(Input.value);
            if (!/^@story\s*bot\b/i.test(Normalized.trim())) {
                Input.value = Normalized;
                return;
            }

            Event.preventDefault();
            Event.stopImmediatePropagation();
            await SubmitStoryBotFromChat(Form);
        }, true);
    });
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

function BindStoryBotSocket(Socket) {
    if (!Socket || BoundBotSockets.has(Socket)) return;
    BoundBotSockets.add(Socket);

    Socket.on("connect", () => SetStoryBotConnectionState("online"));
    Socket.on("disconnect", () => SetStoryBotConnectionState("reconnecting"));
    Socket.on("connect_error", () => SetStoryBotConnectionState("reconnecting"));

    Socket.on("room:botTyping", Payload => {
        SetStoryBotTyping(Boolean(Payload?.typing));
    });

    Socket.on("room:botError", Payload => {
        SetStoryBotTyping(false);
        ShowStoryBotError(Payload?.error);
    });

    Socket.on("disconnect", () => SetStoryBotTyping(false));
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
            return Result;
        };
        WrappedStartMultiplayer.StoryBotWrapped = true;
        StartMultiplayer = WrappedStartMultiplayer;
    }

    if (typeof MultiplayerSocket !== "undefined" && MultiplayerSocket) BindStoryBotSocket(MultiplayerSocket);
}

function ConfigureStoryBotInputs() {
    const LobbyInput = document.getElementById("ChatInput");
    const GameInput = document.getElementById("GameChatInput");
    const JoinInput = document.getElementById("JoinCodeInput");

    if (LobbyInput) {
        LobbyInput.placeholder = "Message, type a vote number, or ask @StoryBot...";
        LobbyInput.autocapitalize = "sentences";
        LobbyInput.enterKeyHint = "send";
    }

    if (GameInput) {
        GameInput.placeholder = "Message, type #3 to vote, or ask @StoryBot...";
        GameInput.autocapitalize = "sentences";
        GameInput.enterKeyHint = "send";
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
    BindStoryBotMentionNormalization();
    SetStoryBotConnectionState("offline");
    RefreshQuietChatState();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", InitializeStoryBotUi, { once: true });
} else {
    InitializeStoryBotUi();
}
