const STORY_BOT_NAME = "StoryBot";
const BoundBotSockets = new WeakSet();

function GetStoryBotChatContainer() {
    return document.getElementById("GameChatMessages") || document.getElementById("ChatMessages");
}

function SetStoryBotTyping(Typing) {
    const Container = GetStoryBotChatContainer();
    if (!Container) return;

    let TypingRow = Container.querySelector(".StoryBotTyping");

    if (!Typing) {
        TypingRow?.remove();
        return;
    }

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

function MarkLastStoryBotMessage(ContainerId) {
    const Container = document.getElementById(ContainerId);
    const Last = Container?.lastElementChild;
    if (!Last) return;
    Last.classList.add("StoryBotMessage");
}

function WrapStoryBotRenderers() {
    if (typeof AppendChat === "function" && !AppendChat.StoryBotWrapped) {
        const BaseAppendChat = AppendChat;
        const WrappedAppendChat = function(Message, ...Rest) {
            const Result = BaseAppendChat(Message, ...Rest);
            if (Message?.bot || Message?.username === STORY_BOT_NAME) MarkLastStoryBotMessage("ChatMessages");
            return Result;
        };
        WrappedAppendChat.StoryBotWrapped = true;
        AppendChat = WrappedAppendChat;
    }

    if (typeof AppendGameChat === "function" && !AppendGameChat.StoryBotWrapped) {
        const BaseAppendGameChat = AppendGameChat;
        const WrappedAppendGameChat = function(Message, ...Rest) {
            const Result = BaseAppendGameChat(Message, ...Rest);
            if (Message?.bot || Message?.username === STORY_BOT_NAME) MarkLastStoryBotMessage("GameChatMessages");
            return Result;
        };
        WrappedAppendGameChat.StoryBotWrapped = true;
        AppendGameChat = WrappedAppendGameChat;
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

    if (LobbyInput) LobbyInput.placeholder = "Message the group or ask @StoryBot...";
    if (GameInput) GameInput.placeholder = "Message the group or ask @StoryBot...";
}

function InitializeStoryBotUi() {
    WrapStoryBotRenderers();
    WrapStoryBotSocketHooks();
    ConfigureStoryBotInputs();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", InitializeStoryBotUi, { once: true });
} else {
    InitializeStoryBotUi();
}
