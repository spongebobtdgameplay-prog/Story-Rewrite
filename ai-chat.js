const STORY_BOT_NAME = "StoryBot";
const BoundBotSockets = new WeakSet();

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
    const Text = String(Message || "StoryBot could not answer right now.");

    if (typeof ShowRoomStatus === "function") {
        ShowRoomStatus(Text, false);
        return;
    }

    const Status = document.getElementById("StatusText");
    if (Status) {
        Status.className = "StatusText Bad";
        Status.textContent = Text;
    }
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

function WrapStoryBotRenderers() {
    if (typeof AppendChat === "function" && !AppendChat.StoryBotWrapped) {
        const BaseAppendChat = AppendChat;
        const WrappedAppendChat = function(Message, ...Rest) {
            const Container = document.getElementById("ChatMessages");
            RemoveQuietChatState(Container);
            const Result = BaseAppendChat(Message, ...Rest);
            MarkLastChatMessage("ChatMessages", Message);
            RefreshQuietChatState(Container);
            return Result;
        };
        WrappedAppendChat.StoryBotWrapped = true;
        AppendChat = WrappedAppendChat;
    }

    if (typeof AppendGameChat === "function" && !AppendGameChat.StoryBotWrapped) {
        const BaseAppendGameChat = AppendGameChat;
        const WrappedAppendGameChat = function(Message, ...Rest) {
            const Container = document.getElementById("GameChatMessages");
            RemoveQuietChatState(Container);
            const Result = BaseAppendGameChat(Message, ...Rest);
            MarkLastChatMessage("GameChatMessages", Message);
            RefreshQuietChatState(Container);
            return Result;
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
    RefreshQuietChatState();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", InitializeStoryBotUi, { once: true });
} else {
    InitializeStoryBotUi();
}
