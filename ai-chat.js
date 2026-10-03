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
const STORY_BOT_REQUEST_TIMEOUT = 150000;

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
    const Last = Container
        ? [...Container.children].reverse().find(Element =>
            !Element.classList.contains("StoryBotComposer") &&
            !Element.classList.contains("StoryBotTyping") &&
            !Element.classList.contains("StoryBotRequestError")
        )
        : null;
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

function UpdateStoryBotComposerLength(Input) {
    if (!Input) return;

    const Normalized = NormalizeStoryBotMentionText(Input.value);
    if (Input.value !== Normalized) Input.value = Normalized;

    if (Input.maxLength !== 180) Input.maxLength = 180;

    if (Input.value.length > 180) {
        Input.value = Input.value.slice(0, 180);
    }
}

function PrepareStoryBotComposer(Input) {
    if (!Input) return;
    MoveMentionToStoryBotComposer(Input);
}

function GetActiveMentionText(Input) {
    if (!Input) return "";

    const Value = String(Input.value || "");
    const Selection = Number.isInteger(Input.selectionStart)
        ? Input.selectionStart
        : Value.length;
    const Before = Value.slice(0, Selection);
    const Match = Before.match(/(^|\s)(@[A-Za-z0-9_]*)$/);

    return Match ? Match[2] : "";
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
        const Value = NormalizeStoryBotMentionText(Input.value || "");
        if (!/^@story\s*bot\b/i.test(Value.trim())) return false;
        return MoveMentionToStoryBotComposer(Input);
    };

    Input.addEventListener("input", () => {
        if (HandleMentionTrigger()) return;
        UpdateStoryBotComposerLength(Input);
        RenderPopup();
    });

    Input.addEventListener("paste", () => {
        setTimeout(() => {
            if (HandleMentionTrigger()) return;
            UpdateStoryBotComposerLength(Input);
            RenderPopup();
        }, 0);
    });
    Input.addEventListener("focus", RenderPopup);
    Input.addEventListener("blur", () => setTimeout(ClosePopup, 120));
    Input.addEventListener("keydown", Event => {
        if (Event.key === "Enter" && !Event.shiftKey) {
            const NormalizedValue = NormalizeStoryBotMentionText(Input.value).trim();
            if (/^@story\s*bot(?:\s|$)/i.test(NormalizedValue)) {
                Event.preventDefault();
                Event.stopImmediatePropagation();
                MoveMentionToStoryBotComposer(Input);
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


function GetStoryBotComposerForInput(Input) {
    if (!Input) return null;
    const Root = Input.closest(".ChatPanelBody, .GameChatBody") || document;
    return Root.querySelector(".StoryBotComposer");
}

function CreateStoryBotComposer(Input) {
    if (!Input) return null;

    const Container = GetStoryBotContainerForInput(Input);
    if (!Container) return null;

    const Existing = GetStoryBotComposerForInput(Input);
    if (Existing) return Existing;

    RemoveQuietChatState(Container);

    const Composer = document.createElement("div");
    Composer.className = "ChatMessage StoryBotMessage StoryBotComposer";
    Composer.setAttribute("role", "group");
    Composer.setAttribute("aria-label", "StoryBot question");

    Composer.innerHTML = `
        <div class="StoryBotComposerHeader">
            <div class="StoryBotComposerTitle">
                <span class="StoryBotComposerIcon" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                        <rect x="5" y="7" width="14" height="11" rx="3"></rect>
                        <path d="M9 7V5h6v2M8 12h.01M16 12h.01M9 15h6"></path>
                    </svg>
                </span>
                <span>Ask StoryBot</span>
            </div>
            <span class="StoryBotComposerCount">0/1200</span>
        </div>
        <div class="StoryBotComposerPrompt">What would you like to ask me?</div>
        <div class="StoryBotComposerRow">
            <textarea class="StoryBotQuestionInput" maxlength="1200" rows="1"
                placeholder="Type your question to StoryBot..." autocomplete="off" spellcheck="true"
                aria-label="Type your question to StoryBot"></textarea>
            <button class="StoryBotSendButton" type="button">Send</button>
        </div>
        <div class="StoryBotComposerStatus" aria-live="polite">Your message goes directly to StoryBot.</div>
    `;

    Container.appendChild(Composer);

    const QuestionInput = Composer.querySelector(".StoryBotQuestionInput");
    const Send = Composer.querySelector(".StoryBotSendButton");

    if (!QuestionInput || !Send) {
        Composer.remove();
        return null;
    }

    Input.dataset.storyBotComposerActive = "1";

    QuestionInput.addEventListener("input", () => {
        UpdateStoryBotDedicatedComposer(Composer);
        if (QuestionInput.value.trim()) {
            SetStoryBotComposerStatus(Composer, "Ready to send to StoryBot.");
        } else {
            SetStoryBotComposerStatus(Composer, "Your message goes directly to StoryBot.");
        }
    });

    QuestionInput.addEventListener("keydown", Event => {
        if (Event.key === "Enter" && !Event.shiftKey) {
            Event.preventDefault();
            void SubmitStoryBotDedicated(Composer);
        }

        if (Event.key === "Escape") {
            Event.preventDefault();
            Composer.remove();
            Input.dataset.storyBotComposerActive = "0";
            Input.focus();
        }
    });

    Send.addEventListener("click", () => {
        void SubmitStoryBotDedicated(Composer);
    });

    UpdateStoryBotDedicatedComposer(Composer);
    return Composer;
}

function DetachStoryBotComposer(Container) {
    const Composer = Container?.querySelector(".StoryBotComposer");
    Composer?.remove();
    return Composer || null;
}

function RestoreStoryBotComposer(Container, Composer) {
    if (!Container || !Composer || Container.contains(Composer)) return;
    Container.appendChild(Composer);
}

function SetStoryBotComposerStatus(Composer, Message, State = "") {
    const Status = Composer?.querySelector(".StoryBotComposerStatus");
    if (!Status) return;
    Status.textContent = Message || "";
    if (State) Status.dataset.state = State;
    else delete Status.dataset.state;
}

function UpdateStoryBotDedicatedComposer(Composer) {
    const Input = Composer?.querySelector(".StoryBotQuestionInput");
    const Count = Composer?.querySelector(".StoryBotComposerCount");
    if (!Input) return;
    if (Count) Count.textContent = String(Input.value.length) + "/1200";
    Input.style.height = "auto";
    Input.style.height = Math.min(120, Math.max(38, Input.scrollHeight)) + "px";
}

function FocusStoryBotDedicatedComposer(Input, Question = "") {
    const Composer = CreateStoryBotComposer(Input);
    const QuestionInput = Composer?.querySelector(".StoryBotQuestionInput");
    if (!Composer || !QuestionInput) return false;

    QuestionInput.value = NormalizeStoryBotQuestionText(Question);
    UpdateStoryBotDedicatedComposer(Composer);
    SetStoryBotComposerStatus(Composer, "Your message goes directly to StoryBot.");
    QuestionInput.focus();
    const End = QuestionInput.value.length;
    try { QuestionInput.setSelectionRange(End, End); } catch {}
    return true;
}

function MoveMentionToStoryBotComposer(Input) {
    const Value = NormalizeStoryBotMentionText(Input?.value || "");
    const Match = Value.match(/@story\s*bot\b/i);
    if (!Match) return false;

    const Question = NormalizeStoryBotQuestionText(
        Value.slice(Match.index + Match[0].length)
    );

    Input.value = "";
    Input.maxLength = 180;
    if (Input.dataset.storyBotNormalPlaceholder) {
        Input.placeholder = Input.dataset.storyBotNormalPlaceholder;
    }

    return FocusStoryBotDedicatedComposer(Input, Question);
}

async function SubmitStoryBotDedicated(Composer) {
    const Input = Composer?.querySelector(".StoryBotQuestionInput");
    const Send = Composer?.querySelector(".StoryBotSendButton");
    if (!Input || !Send) return;

    const Question = NormalizeStoryBotQuestionText(Input.value);
    if (!Question) {
        SetStoryBotComposerStatus(Composer, "Please enter at least one character.", "error");
        Input.focus();
        return;
    }

    const Socket = GetConnectedStoryBotSocket();
    if (!Socket?.connected) {
        SetStoryBotComposerStatus(Composer, "Multiplayer is offline. Reconnect to the room first.", "error");
        SetStoryBotConnectionState("offline");
        return;
    }

    const Container = GetStoryBotContainerForInput(
        Composer.closest(".ChatPanelBody, .GameChatBody")?.querySelector(".ChatInput")
    );
    const ContainerId = Container?.id || "ChatMessages";

    Send.disabled = true;
    Input.disabled = true;
    SetStoryBotTyping(true);
    SetStoryBotComposerStatus(Composer, "StoryBot is thinking...", "thinking");

    const Result = await new Promise(resolve => {
        let Finished = false;
        const Complete = Value => {
            if (Finished) return;
            Finished = true;
            resolve(Value || { ok: false, error: "StoryBot could not answer right now." });
        };

        try {
            Socket.timeout(STORY_BOT_REQUEST_TIMEOUT).emit(
                "storybot:ask",
                { question: Question },
                (Error, Reply) => Complete(
                    Error
                        ? { ok: false, error: "StoryBot did not answer in time." }
                        : Reply
                )
            );
        } catch (Error) {
            Complete({ ok: false, error: String(Error?.message || "StoryBot request failed.") });
        }
    });

    SetStoryBotTyping(false);
    Send.disabled = false;
    Input.disabled = false;

    if (!Result?.ok) {
        SetStoryBotComposerStatus(Composer, Result?.error || "StoryBot could not answer right now.", "error");
        Input.focus();
        return;
    }

    Input.value = "";
    UpdateStoryBotDedicatedComposer(Composer);
    SetStoryBotComposerStatus(Composer, "Message sent. Ask another question anytime.");

    const NormalChatInput = Composer.closest(".ChatPanelBody, .GameChatBody")?.querySelector(".ChatInput");
    Composer.remove();
    if (NormalChatInput) NormalChatInput.dataset.storyBotComposerActive = "0";

    if (Result.message) {
        RenderStoryBotReplyMessage(Result.message, ContainerId);
    }

    NormalChatInput?.focus();
}

async function SubmitStoryBotFromChat(Form) {
    const Input = Form?.querySelector(".ChatInput");
    const Normalized = NormalizeStoryBotMentionText(Input?.value || "").trim();
    const MentionMatch = Normalized.match(/@story\s*bot\b/i);
    if (!MentionMatch) return false;

    const Question = NormalizeStoryBotQuestionText(
        Normalized.slice(MentionMatch.index + MentionMatch[0].length)
    );

    Input.value = "";
    FocusStoryBotDedicatedComposer(Input, Question);
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
            if (!/@story\s*bot\b/i.test(Normalized.trim())) {
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
            const Composer = DetachStoryBotComposer(Container);
            RemoveQuietChatState(Container);

            if (!RememberStoryBotRenderedMessage(Message)) {
                BaseAppendChat(Message, ...Rest);
                MarkLastChatMessage("ChatMessages", Message);
            }

            RestoreStoryBotComposer(Container, Composer);
            RefreshQuietChatState(Container);
        };
        WrappedAppendChat.StoryBotWrapped = true;
        AppendChat = WrappedAppendChat;
    }

    if (typeof AppendGameChat === "function" && !AppendGameChat.StoryBotWrapped) {
        const BaseAppendGameChat = AppendGameChat;
        const WrappedAppendGameChat = function(Message, ...Rest) {
            const Container = document.getElementById("GameChatMessages");
            const Composer = DetachStoryBotComposer(Container);
            RemoveQuietChatState(Container);

            if (!RememberStoryBotRenderedMessage(Message)) {
                BaseAppendGameChat(Message, ...Rest);
                MarkLastChatMessage("GameChatMessages", Message);
            }

            RestoreStoryBotComposer(Container, Composer);
            RefreshQuietChatState(Container);
        };
        WrappedAppendGameChat.StoryBotWrapped = true;
        AppendGameChat = WrappedAppendGameChat;
    }

    if (typeof RenderRoom === "function" && !RenderRoom.StoryBotWrapped) {
        const BaseRenderRoom = RenderRoom;
        const WrappedRenderRoom = function(...Arguments) {
            const Container = document.getElementById("ChatMessages");
            const Composer = DetachStoryBotComposer(Container);
            const Result = BaseRenderRoom(...Arguments);
            RestoreStoryBotComposer(Container, Composer);
            queueMicrotask(() => RefreshQuietChatState(Container));
            return Result;
        };
        WrappedRenderRoom.StoryBotWrapped = true;
        RenderRoom = WrappedRenderRoom;
    }

    if (typeof ApplyRoomState === "function" && !ApplyRoomState.StoryBotChatWrapped) {
        const BaseApplyRoomState = ApplyRoomState;
        const WrappedApplyRoomState = function(...Arguments) {
            const Container = document.getElementById("GameChatMessages");
            const Composer = DetachStoryBotComposer(Container);
            const Result = BaseApplyRoomState(...Arguments);
            RestoreStoryBotComposer(Container, Composer);
            queueMicrotask(() => RefreshQuietChatState(Container));
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
        LobbyInput.placeholder = "Message, type a vote number, or use @StoryBot...";
        LobbyInput.dataset.storyBotNormalPlaceholder = LobbyInput.placeholder;
        LobbyInput.autocapitalize = "sentences";
        LobbyInput.enterKeyHint = "send";
    }

    if (GameInput) {
        GameInput.placeholder = "Message, type #3 to vote, or use @StoryBot...";
        GameInput.dataset.storyBotNormalPlaceholder = GameInput.placeholder;
        GameInput.autocapitalize = "sentences";
        GameInput.enterKeyHint = "send";
    }

    document.querySelectorAll(".StoryBotComposer").forEach(Composer => {
        const Input = Composer.querySelector(".StoryBotQuestionInput");
        const Send = Composer.querySelector(".StoryBotSendButton");
        if (!Input || !Send || Composer.dataset.storyBotBound === "1") return;

        Composer.dataset.storyBotBound = "1";
        Input.addEventListener("input", () => {
            UpdateStoryBotDedicatedComposer(Composer);
            if (Input.value.trim()) {
                SetStoryBotComposerStatus(Composer, "Ready to send to StoryBot.");
            } else {
                SetStoryBotComposerStatus(Composer, "Your message goes directly to StoryBot.");
            }
        });
        Input.addEventListener("keydown", Event => {
            if (Event.key === "Enter" && !Event.shiftKey) {
                Event.preventDefault();
                SubmitStoryBotDedicated(Composer);
            }
        });
        Send.addEventListener("click", () => SubmitStoryBotDedicated(Composer));
        UpdateStoryBotDedicatedComposer(Composer);
    });

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
