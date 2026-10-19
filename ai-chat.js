const STORY_BOT_NAME = "StoryBot";
const STORY_BOT_COMMAND = "@StoryBot";
const STORY_BOT_COMMANDS = [{
    name: "StoryBot",
    command: "@StoryBot",
    description: "Ask the AI about the current story"
}];
const BoundBotSockets = new WeakSet();
const StoryBotRenderedMessageIds = new Set();
const StoryBotConsoleLoggedMessageIds = new Set();
const STORY_BOT_MAX_QUESTION_LENGTH = 1200;
const STORY_BOT_REQUEST_TIMEOUT = 150000;
const STORY_BOT_ACK_TIMEOUT = 10000;
let StoryBotActiveQuestion = "";
let StoryBotRoomBusy = false;
let StoryBotLocalRequestBusy = false;
function IsStoryBotBusy(){return StoryBotRoomBusy||StoryBotLocalRequestBusy}
function RefreshStoryBotComposerLock(){
 const Busy=IsStoryBotBusy();
 document.querySelectorAll(".StoryBotComposer").forEach(Composer=>{
  const Input=Composer.querySelector(".StoryBotQuestionInput");
  const Send=Composer.querySelector(".StoryBotSendButton");
  if(Input)Input.disabled=Busy;
  if(Send)Send.disabled=Busy;
  Composer.classList.toggle("IsBusy",Busy);
 });
}

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


function GetStoryBotTaskStatus(Question = "") {
    const Text = String(Question || StoryBotActiveQuestion || "").trim();
    if (!Text) return "StoryBot is checking the relevant game context…";

    if (/^(?:hi|hello|hey|hiya|yo|sup|good morning|good afternoon|good evening)[.!?]*$/i.test(Text)) {
        return "StoryBot is preparing a quick reply…";
    }
    if (/\b(?:what did i say|what did we say|earlier|previous message|last message|remember|mentioned before|conversation history|chat history)\b/i.test(Text)) {
        return "StoryBot is reviewing the recent chat context…";
    }
    if (/\b(?:vote|votes|voting|choice|choices|option|options|sentence|rewrite|pick|choose|selection|select)\b/i.test(Text)) {
        return "StoryBot is comparing the available story choices and votes…";
    }
    if (/\b(?:stage|level|story|survive|survival|threat|objective|life|lives|heart|rule|rules|ending|outcome)\b/i.test(Text)) {
        return "StoryBot is checking the current stage and survival rules…";
    }
    if (/\b(?:player|players|ready|lobby|room|game code|host|joining|invite|multiplayer)\b/i.test(Text)) {
        return "StoryBot is checking the current lobby and player status…";
    }
    if (/^(?:why|how)\b|\b(?:explain|meaning|means|reason|because)\b/i.test(Text)) {
        return "StoryBot is putting together a clear explanation…";
    }
    return "StoryBot is reviewing the question and relevant game context…";
}

function SetStoryBotTyping(Typing, Question = "") {
    if (Typing && Question) StoryBotActiveQuestion = String(Question).trim().slice(0, 240);
    const StatusText = Typing ? GetStoryBotTaskStatus(Question || StoryBotActiveQuestion) : "";
    if (!Typing) StoryBotActiveQuestion = "";
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
            <span class="StoryBotTypingText">StoryBot is checking the relevant game context…</span>
            <span class="StoryBotDots" aria-hidden="true"><i></i><i></i><i></i></span>
        `;
        Container.appendChild(TypingRow);
    }

    const ThinkingLabel = TypingRow.querySelector(".StoryBotTypingText");
    if (ThinkingLabel) ThinkingLabel.textContent = StatusText;
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
    while (Container.childElementCount > 100) Container.firstElementChild?.remove();
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

function FindStoryBotRenderedElement(Container, MessageId) {
    const Id = String(MessageId || "").trim();
    if (!Container || !Id) return null;
    return [...Container.children].find(Element => Element.dataset.storyBotMessageId === Id) || null;
}

function CleanStoryBotDisplayText(Value) {
    const Fence = String.fromCharCode(96).repeat(3);
    let Text = String(Value || "").replace(/\r\n?/g, "\n");

    // Gemini sometimes returns its private tool-event labels as if they were answer text.
    // Remove only those labelled execution frames; keep ordinary code fences intact.
    let SearchFrom = 0;
    while (true) {
        const Start = Text.indexOf(Fence, SearchFrom);
        if (Start < 0) break;
        const InfoEnd = Text.indexOf("\n", Start + Fence.length);
        const InlineEnd = Text.indexOf(Fence, Start + Fence.length);
        const Info = Text.slice(Start + Fence.length, InfoEnd >= 0 ? InfoEnd : (InlineEnd >= 0 ? InlineEnd : Text.length));
        if (!/\?code_(?:reference|stdout)\b/i.test(Info)) {
            SearchFrom = Start + Fence.length;
            continue;
        }
        const End = InlineEnd >= 0 && (InfoEnd < 0 || InlineEnd < InfoEnd)
            ? InlineEnd
            : Text.indexOf(Fence, InfoEnd + 1);
        if (End < 0) {
            Text = Text.slice(0, Start) + Text.slice((InfoEnd >= 0 ? InfoEnd + 1 : Text.length));
            SearchFrom = Start;
        } else {
            Text = Text.slice(0, Start) + Text.slice(End + Fence.length);
            SearchFrom = Start;
        }
    }

    Text = Text.replace(/^[ \t]*(?:python|text)\?code_(?:reference|stdout)\b[^\n]*$/gim, "");
    Text = Text.replace(/(?:^|\n)[ \t]*(?:need help with anything else|let me know if you need anything else|is there anything else i can help with)\b[\s\S]*$/i, "");
    return Text.replace(/\n[ \t]+\n/g, "\n\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 4000);
}

function AppendStoryBotInlineMarkdown(Target, Value) {
    const Text = String(Value || "");
    const Tick = String.fromCharCode(96);
    const Pattern = new RegExp("(\\*\\*.+?\\*\\*|__.+?__|" + Tick + "[^" + Tick + "\\n]+" + Tick + "|\\*[^*\\n]+\\*|_[^_\\n]+_)", "g");
    let Position = 0;
    let Match;

    while ((Match = Pattern.exec(Text))) {
        if (Match.index > Position) {
            Target.appendChild(document.createTextNode(Text.slice(Position, Match.index)));
        }

        const Token = Match[0];
        let Node;
        if ((Token.startsWith("**") && Token.endsWith("**")) ||
            (Token.startsWith("__") && Token.endsWith("__"))) {
            Node = document.createElement("strong");
            Node.textContent = Token.slice(2, -2);
        } else if (Token.startsWith(Tick) && Token.endsWith(Tick)) {
            Node = document.createElement("code");
            Node.className = "StoryBotInlineCode";
            Node.textContent = Token.slice(1, -1);
        } else {
            Node = document.createElement("em");
            Node.textContent = Token.slice(1, -1);
        }
        Target.appendChild(Node);
        Position = Pattern.lastIndex;
    }

    if (Position < Text.length) {
        Target.appendChild(document.createTextNode(Text.slice(Position)));
    }
}

function RenderStoryBotMarkdown(Body, Value) {
    const Text = String(Value || "").trim();
    if (!Body || !Text) return;

    const Fence = String.fromCharCode(96).repeat(3);
    const Lines = Text.split(/\r?\n/);
    let Index = 0;
    let ListElement = null;
    let ListType = "";

    const FlushList = () => {
        ListElement = null;
        ListType = "";
    };
    const IsBlockStart = Line => {
        const Trimmed = Line.trim();
        return Trimmed.startsWith(Fence) ||
            /^#{1,3}\s+/.test(Trimmed) ||
            /^(?:[-*+])\s+/.test(Trimmed) ||
            /^\d+[.)]\s+/.test(Trimmed) ||
            /^>\s?/.test(Trimmed);
    };

    while (Index < Lines.length) {
        const Line = Lines[Index];
        const Trimmed = Line.trim();

        if (!Trimmed) {
            FlushList();
            Index += 1;
            continue;
        }

        if (Trimmed.startsWith(Fence)) {
            FlushList();
            const Language = (Trimmed.slice(Fence.length).trim().split(/\s+/)[0] || "code")
                .replace(/[^a-z0-9_+-]/gi, "").slice(0, 24) || "code";
            Index += 1;
            const CodeLines = [];
            while (Index < Lines.length && !Lines[Index].trim().startsWith(Fence)) {
                CodeLines.push(Lines[Index]);
                Index += 1;
            }
            if (Index < Lines.length) Index += 1;

            const CodeText = CodeLines.join("\n");
            const Frame = document.createElement("div");
            Frame.className = "StoryBotCodeFrame";
            const Toolbar = document.createElement("div");
            Toolbar.className = "StoryBotCodeToolbar";
            const Label = document.createElement("span");
            Label.textContent = Language;
            const Copy = document.createElement("button");
            Copy.type = "button";
            Copy.className = "StoryBotCodeCopy";
            Copy.textContent = "Copy";
            Copy.setAttribute("aria-label", "Copy " + Language + " code");
            Copy.addEventListener("click", async () => {
                try {
                    await navigator.clipboard.writeText(CodeText);
                    Copy.textContent = "Copied";
                } catch {
                    Copy.textContent = "Copy unavailable";
                }
            });
            Toolbar.append(Label, Copy);
            const Pre = document.createElement("pre");
            const Code = document.createElement("code");
            Code.className = "language-" + Language;
            Code.textContent = CodeText;
            Pre.appendChild(Code);
            Frame.append(Toolbar, Pre);
            Body.appendChild(Frame);
            continue;
        }

        const Heading = Trimmed.match(/^(#{1,3})\s+(.+)$/);
        if (Heading) {
            FlushList();
            const Node = document.createElement(Heading[1].length === 1 ? "h3" : "h4");
            AppendStoryBotInlineMarkdown(Node, Heading[2]);
            Body.appendChild(Node);
            Index += 1;
            continue;
        }

        const Bullet = Trimmed.match(/^([-*+])\s+(.+)$/);
        const Numbered = Trimmed.match(/^(\d+)[.)]\s+(.+)$/);
        if (Bullet || Numbered) {
            const Type = Numbered ? "ol" : "ul";
            if (!ListElement || ListType !== Type) {
                FlushList();
                ListElement = document.createElement(Type);
                ListElement.className = "StoryBotMarkdownList";
                Body.appendChild(ListElement);
                ListType = Type;
            }
            const Item = document.createElement("li");
            AppendStoryBotInlineMarkdown(Item, (Numbered || Bullet)[2]);
            ListElement.appendChild(Item);
            Index += 1;
            continue;
        }

        if (Trimmed.startsWith(">")) {
            FlushList();
            const Quote = document.createElement("blockquote");
            AppendStoryBotInlineMarkdown(Quote, Trimmed.replace(/^>\s?/, ""));
            Body.appendChild(Quote);
            Index += 1;
            continue;
        }

        FlushList();
        const Paragraph = document.createElement("p");
        while (Index < Lines.length && Lines[Index].trim() && !IsBlockStart(Lines[Index])) {
            if (Paragraph.childNodes.length) Paragraph.appendChild(document.createElement("br"));
            AppendStoryBotInlineMarkdown(Paragraph, Lines[Index].trim());
            Index += 1;
        }
        if (Paragraph.childNodes.length) Body.appendChild(Paragraph);
        else Index += 1;
    }
}


let StoryBotSpeakingUtterance = null;
let StoryBotSpeakingButton = null;

function GetStoryBotSpeechText(Value) {
    const Fence = String.fromCharCode(96).repeat(3);
    return String(Value || "")
        .replace(new RegExp(Fence + "[^\\n]*\\n[\\s\\S]*?" + Fence, "g"), " Code example omitted. ")
        .replace(/https?:\\/\\/\\S+/g, " link ")
        .replace(/#{1,6}\\s*/g, "")
        .replace(/[*_~]/g, "")
        .replace(new RegExp(String.fromCharCode(96), "g"), "")
        .replace(/^\\s*[-+>]\\s*/gm, "")
        .replace(/^\\s*\\d+[.)]\\s*/gm, "")
        .replace(/\\s+/g, " ")
        .trim();
}

function StopStoryBotSpeech() {
    if (typeof window.speechSynthesis !== "undefined") window.speechSynthesis.cancel();
    if (StoryBotSpeakingButton) {
        StoryBotSpeakingButton.textContent = "Listen";
        StoryBotSpeakingButton.setAttribute("aria-label", "Listen to the StoryBot reply");
        StoryBotSpeakingButton.setAttribute("aria-pressed", "false");
    }
    StoryBotSpeakingUtterance = null;
    StoryBotSpeakingButton = null;
}

function AddStoryBotListenButton(Element, Text) {
    if (!Element || typeof window.speechSynthesis === "undefined" || !Text) return;
    const Controls = document.createElement("div");
    Controls.className = "StoryBotSpeechControls";
    const Listen = document.createElement("button");
    Listen.type = "button";
    Listen.className = "StoryBotListenButton";
    Listen.textContent = "Listen";
    Listen.setAttribute("aria-label", "Listen to the StoryBot reply");
    Listen.setAttribute("aria-pressed", "false");
    Listen.addEventListener("click", () => {
        if (StoryBotSpeakingButton === Listen) {
            StopStoryBotSpeech();
            return;
        }
        StopStoryBotSpeech();
        const SpeechText = GetStoryBotSpeechText(Text);
        if (!SpeechText) return;
        const Utterance = new SpeechSynthesisUtterance(SpeechText);
        Utterance.rate = 1;
        Utterance.onend = () => {
            if (StoryBotSpeakingUtterance === Utterance) StopStoryBotSpeech();
        };
        Utterance.onerror = () => {
            if (StoryBotSpeakingUtterance === Utterance) StopStoryBotSpeech();
        };
        StoryBotSpeakingUtterance = Utterance;
        StoryBotSpeakingButton = Listen;
        Listen.textContent = "Stop listening";
        Listen.setAttribute("aria-label", "Stop reading the StoryBot reply aloud");
        Listen.setAttribute("aria-pressed", "true");
        window.speechSynthesis.speak(Utterance);
    });
    Controls.appendChild(Listen);
    Element.appendChild(Controls);
}

function RenderStoryBotStructuredMessage(Element, Message) {
    if (!Element || !Message?.bot) return;
    const RawText = CleanStoryBotDisplayText(Message.text);
    if (!RawText) {
        Element.remove();
        return;
    }

    const Name = document.createElement("strong");
    Name.textContent = String(Message.username || STORY_BOT_NAME) + ": ";

    const Body = document.createElement("div");
    Body.className = "StoryBotMessageBody";
    RenderStoryBotMarkdown(Body, RawText);
    Element.replaceChildren(Name, Body);
    Element.classList.add("StoryBotMessage");
    AddStoryBotListenButton(Element, RawText);
}
function RenderStoryBotQuestionImmediately(Message, ContainerId) {
    if (!Message?.id || !ContainerId) return;
    if (ContainerId === "ChatMessages" && typeof AppendChat === "function") {
        AppendChat(Message);
    } else if (ContainerId === "GameChatMessages" && typeof AppendGameChat === "function") {
        AppendGameChat(Message);
    }

    const Container = document.getElementById(ContainerId);
    const Element = FindStoryBotRenderedElement(Container, Message.id);
    if (Element) Element.classList.add("StoryBotPendingQuestion");
}

function RemoveStoryBotOptimisticQuestion(ContainerId, MessageId) {
    const Container = document.getElementById(ContainerId);
    const Element = FindStoryBotRenderedElement(Container, MessageId);
    if (Element?.classList.contains("StoryBotPendingQuestion")) Element.remove();
    RefreshQuietChatState(Container);
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
    const Container = document.getElementById(ContainerId);
    if (Id && FindStoryBotRenderedElement(Container, Id)) return;

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
                Input.focus({ preventScroll: true });
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

function EnsureStoryBotInputSlot(Form, Input) {
    if (!Form || !Input) return null;
    let Slot = Input.closest(".StoryBotInputSlot");
    if (!Slot || !Form.contains(Slot)) {
        Slot = document.createElement("div");
        Slot.className = "StoryBotInputSlot";
        Input.parentNode?.insertBefore(Slot, Input);
        Slot.appendChild(Input);
    }
    return Slot;
}
function CreateStoryBotComposer(Input) {
    if (!Input) return null;

    const Container = GetStoryBotContainerForInput(Input);
    const Form = Input.closest(".ChatForm");
    const Slot = EnsureStoryBotInputSlot(Form, Input);
    if (!Container || !Form || !Slot) return null;

    const Existing = GetStoryBotComposerForInput(Input);
    if (Existing) return Existing;

    RemoveQuietChatState(Container);

    const Composer = document.createElement("div");
    Composer.className = "StoryBotComposer";
    Composer.setAttribute("role", "group");
    Composer.setAttribute("aria-label", "StoryBot question");

    Composer.innerHTML = `
        <div class="StoryBotInlineIcon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
                <rect x="5" y="7" width="14" height="11" rx="3"></rect>
                <path d="M9 7V5h6v2M8 12h.01M16 12h.01M9 15h6"></path>
            </svg>
        </div>
        <input class="StoryBotQuestionInput" maxlength="1200" type="text"
            placeholder="Ask StoryBot..." autocomplete="off" spellcheck="true"
            aria-label="Ask StoryBot a question">
        <button class="StoryBotSendButton" type="button">Ask</button>
        <button class="StoryBotCloseButton" type="button" aria-label="Close StoryBot question">×</button>
    `;

    Slot.appendChild(Composer);

    const QuestionInput = Composer.querySelector(".StoryBotQuestionInput");
    const Send = Composer.querySelector(".StoryBotSendButton");
    const Close = Composer.querySelector(".StoryBotCloseButton");

    if (!QuestionInput || !Send || !Close) {
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
            Input.focus({ preventScroll: true });
        }
    });

    Send.addEventListener("click", () => {
        void SubmitStoryBotDedicated(Composer);
    });

    Close.addEventListener("click", () => {
        Composer.remove();
        Input.dataset.storyBotComposerActive = "0";
        Input.hidden = false;
        Input.focus({ preventScroll: true });
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
    if (!Container || !Composer || Composer.dataset.storyBotDismissed === "1" || Container.contains(Composer)) return;
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
    Input.style.height = "28px";
}

function FocusStoryBotDedicatedComposer(Input, Question = "") {
    const Composer = CreateStoryBotComposer(Input);
    const QuestionInput = Composer?.querySelector(".StoryBotQuestionInput");
    if (!Composer || !QuestionInput) return false;

    QuestionInput.value = NormalizeStoryBotQuestionText(Question);
    UpdateStoryBotDedicatedComposer(Composer);
    SetStoryBotComposerStatus(Composer, "Your message goes directly to StoryBot.");
    QuestionInput.focus({ preventScroll: true });
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

function DismissStoryBotComposer(Composer, NormalChatInput) {
    if (!Composer) return;
    // Once submitted, this temporary input must not be restored by chat render wrappers.
    Composer.dataset.storyBotDismissed = "1";
    Composer.classList.add("IsSending");
    Composer.setAttribute("aria-hidden", "true");
    if (NormalChatInput) {
        NormalChatInput.dataset.storyBotComposerActive = "0";
        try { NormalChatInput.focus({ preventScroll: true }); } catch { NormalChatInput.focus({ preventScroll: true }); }
    }
    Composer.remove();
}

async function SubmitStoryBotDedicated(Composer) {
    const Input = Composer?.querySelector(".StoryBotQuestionInput");
    const Send = Composer?.querySelector(".StoryBotSendButton");
    if (!Input || !Send || Composer.dataset.storyBotSubmitting === "1") return;

    const Question = NormalizeStoryBotQuestionText(Input.value);
    if (!Question) {
        SetStoryBotComposerStatus(Composer, "Please enter at least one character.", "error");
        ShowStoryBotError("Type a question for StoryBot before sending.");
        try { Input.focus({ preventScroll: true }); } catch { Input.focus({ preventScroll: true }); }
        return;
    }

    const Socket = GetConnectedStoryBotSocket();
    if (!Socket?.connected) {
        const ErrorText = "Multiplayer is offline. Reconnect to the room first.";
        SetStoryBotComposerStatus(Composer, ErrorText, "error");
        ShowStoryBotError(ErrorText);
        SetStoryBotConnectionState(GetConnectedStoryBotSocket()?.connected ? "online" : "offline");
        return;
    }

    const NormalChatInput = Composer.closest(".ChatPanelBody, .GameChatBody")?.querySelector(".ChatInput");
    const Container = GetStoryBotContainerForInput(NormalChatInput);
    const ContainerId = Container?.id || "ChatMessages";

    if (IsStoryBotBusy()) {
        const ErrorText = "StoryBot is already answering. Please wait for it to finish.";
        SetStoryBotComposerStatus(Composer, ErrorText, "thinking");
        ShowStoryBotError(ErrorText);
        return;
    }

    Composer.dataset.storyBotSubmitting = "1";
    StoryBotLocalRequestBusy = true;
    RefreshStoryBotComposerLock();

    const ClientMessageId = "storybot-question-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
    const OptimisticQuestion = {
        id: ClientMessageId,
        username: GetStoryBotCurrentUsername() || "Player",
        text: "@StoryBot " + Question,
        sentAt: Date.now()
    };
    RenderStoryBotQuestionImmediately(OptimisticQuestion, ContainerId);
    SetStoryBotTyping(true, Question);

    const ResultPromise = new Promise(resolve => {
        let Finished = false;
        const Complete = Value => {
            if (Finished) return;
            Finished = true;
            resolve(Value || { ok: false, error: "StoryBot could not answer right now." });
        };

        try {
            Socket.timeout(STORY_BOT_ACK_TIMEOUT).emit(
                "storybot:ask",
                { question: Question, clientMessageId: ClientMessageId },
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

    // The server broadcasts the user's question before it starts the typing indicator.
    // Remove the temporary prompt frame; the question remains as a normal chat message.
    DismissStoryBotComposer(Composer, NormalChatInput);

    const Result = await ResultPromise;

    if (!Result?.ok) {
        RemoveStoryBotOptimisticQuestion(ContainerId, ClientMessageId);
        StoryBotLocalRequestBusy = false;
        RefreshStoryBotComposerLock();
        SetStoryBotTyping(StoryBotRoomBusy, StoryBotActiveQuestion);
        const ErrorText = Result?.error || "StoryBot could not answer right now.";
        ShowStoryBotError(ErrorText);
        return;
    }

    // The temporary composer stays dismissed. The normal chat input can open a fresh one later.
    if (Result.message?.bot) RenderStoryBotReplyMessage(Result.message, ContainerId);
}

async function SubmitStoryBotFromChat(Form) {
    const Input = Form?.querySelector(".ChatInput");
    const Normalized = NormalizeStoryBotMentionText(Input?.value || "").trim();
    const MentionMatch = Normalized.match(/@story\s*bot\b/i);
    if (!MentionMatch) return false;

    if(IsStoryBotBusy()){
        Input.value="";
        ShowStoryBotError("StoryBot is already answering. Please wait for it to finish.");
        return true;
    }
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

            const MessageId = String(Message?.id || "").trim();
            const Existing = FindStoryBotRenderedElement(Container, MessageId);
            if (Existing) {
                Existing.classList.remove("StoryBotPendingQuestion");
                const Name = Existing.querySelector("strong");
                if (Name) Name.textContent = String(Message?.username || "Player") + ": ";
            } else {
                RememberStoryBotRenderedMessage(Message);
                BaseAppendChat(Message, ...Rest);
                const Last = Container?.lastElementChild || null;
                if (Last && MessageId) Last.dataset.storyBotMessageId = MessageId;
                RenderStoryBotStructuredMessage(Last, Message);
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

            const MessageId = String(Message?.id || "").trim();
            const Existing = FindStoryBotRenderedElement(Container, MessageId);
            if (Existing) {
                Existing.classList.remove("StoryBotPendingQuestion");
                const Name = Existing.querySelector("strong");
                if (Name) Name.textContent = String(Message?.username || "Player") + ": ";
            } else {
                RememberStoryBotRenderedMessage(Message);
                BaseAppendGameChat(Message, ...Rest);
                const Last = Container?.lastElementChild || null;
                if (Last && MessageId) Last.dataset.storyBotMessageId = MessageId;
                RenderStoryBotStructuredMessage(Last, Message);
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


function LogStoryBotConsoleReply(Message) {
    if (!Message?.bot || Message.username !== STORY_BOT_NAME) return;
    const Answer = CleanStoryBotDisplayText(Message.text);
    if (!Answer) return;

    const Id = String(Message.id || "");
    if (Id && StoryBotConsoleLoggedMessageIds.has(Id)) return;
    if (Id) {
        StoryBotConsoleLoggedMessageIds.add(Id);
        while (StoryBotConsoleLoggedMessageIds.size > 100) {
            const Oldest = StoryBotConsoleLoggedMessageIds.values().next().value;
            if (Oldest === undefined) break;
            StoryBotConsoleLoggedMessageIds.delete(Oldest);
        }
    }

    console.log(
        "%c🤖 STORYBOT RESPONSE\n\n" + Answer,
        "background:#22e65b;color:#000;border:4px solid #000;border-radius:8px;padding:16px 20px;font-size:18px;font-weight:800;line-height:1.6;white-space:pre-wrap;"
    );
}

async function AskAI(PromptText) {
    const Question = NormalizeStoryBotQuestionText(PromptText);
    if (!Question) throw new TypeError("AskAI needs a non-empty question.");

    const Socket = GetConnectedStoryBotSocket();
    if (!Socket?.connected) {
        throw new Error("AskAI requires an active Story Rewrite multiplayer room.");
    }

    return new Promise((Resolve, Reject) => {
        let Accepted = false;
        let Finished = false;
        let Timer = null;

        const Cleanup = () => {
            if (Timer !== null) window.clearTimeout(Timer);
            Socket.off("room:chat", OnChat);
            Socket.off("room:botError", OnBotError);
        };

        const Finish = (ErrorValue, Answer) => {
            if (Finished) return;
            Finished = true;
            Cleanup();
            if (ErrorValue) Reject(ErrorValue);
            else Resolve(Answer);
        };

        const OnChat = Message => {
            if (!Accepted || !Message?.bot || Message.username !== STORY_BOT_NAME) return;
            const Answer = CleanStoryBotDisplayText(Message.text);
            if (Answer) Finish(null, Answer);
        };

        const OnBotError = Payload => {
            if (!Accepted) return;
            Finish(new Error(String(Payload?.error || "StoryBot could not answer right now.")));
        };

        Socket.on("room:chat", OnChat);
        Socket.on("room:botError", OnBotError);
        Timer = window.setTimeout(
            () => Finish(new Error("AskAI timed out while waiting for StoryBot.")),
            STORY_BOT_REQUEST_TIMEOUT
        );

        try {
            Socket.timeout(10000).emit("storybot:ask", { question: Question }, (ErrorValue, Reply) => {
                if (ErrorValue) {
                    Finish(new Error("StoryBot did not acknowledge the request in time."));
                    return;
                }
                if (!Reply?.ok) {
                    Finish(new Error(String(Reply?.error || "StoryBot rejected the question.")));
                    return;
                }
                if (Reply.message?.bot) {
                    Finish(null, CleanStoryBotDisplayText(Reply.message.text));
                    return;
                }
                Accepted = Boolean(Reply.accepted);
                if (!Accepted) {
                    Finish(new Error("StoryBot accepted no response for this request."));
                }
            });
        } catch (ErrorValue) {
            Finish(ErrorValue instanceof Error ? ErrorValue : new Error(String(ErrorValue)));
        }
    });
}


function BindStoryBotSocket(Socket) {
    if (!Socket || BoundBotSockets.has(Socket)) return;
    BoundBotSockets.add(Socket);

    Socket.on("connect", () => SetStoryBotConnectionState("online"));
    Socket.on("disconnect", () => SetStoryBotConnectionState("reconnecting"));
    Socket.on("connect_error", () => SetStoryBotConnectionState("reconnecting"));
    Socket.on("room:chat", LogStoryBotConsoleReply);

    Socket.on("room:botTyping", Payload => {
        StoryBotRoomBusy=Boolean(Payload?.typing);
        if (!StoryBotRoomBusy) StoryBotLocalRequestBusy=false;
        RefreshStoryBotComposerLock();
        SetStoryBotTyping(StoryBotRoomBusy, Payload?.question || "");
    });

    Socket.on("room:botError", Payload => {
        SetStoryBotTyping(false);
        ShowStoryBotError(Payload?.error);
    });

    Socket.on("disconnect", () => {
        StoryBotRoomBusy=false;
        StoryBotLocalRequestBusy=false;
        RefreshStoryBotComposerLock();
        SetStoryBotTyping(false);
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
    BindStoryBotMentionNormalization();
    BindStoryBotCommandPopups();
    SetStoryBotConnectionState("offline");
    RefreshStoryBotComposerLock();
    RefreshQuietChatState();
}

window.AskAI = AskAI;

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", InitializeStoryBotUi, { once: true });
} else {
    InitializeStoryBotUi();
}
