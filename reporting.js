function GetChatReporterUsername() {
    if (typeof CurrentProfile !== "undefined" && CurrentProfile?.username) return CurrentProfile.username;
    if (typeof Profile !== "undefined" && Profile?.username) return Profile.username;
    return "";
}

function GetChatModerationSocket() {
    if (typeof MultiplayerSocket !== "undefined") return MultiplayerSocket;
    return null;
}

function ShowChatModerationNotice(Text, Good = false) {
    if (typeof ShowRoomStatus === "function") {
        ShowRoomStatus(Text, Good);
        return;
    }

    const Status = document.getElementById("StatusText");
    if (Status) {
        Status.className = "StatusText " + (Good ? "Good" : "Bad");
        Status.textContent = Text;
    }
}

function SubmitChatReport(Message, Button) {
    const Socket = GetChatModerationSocket();
    if (!Socket?.connected || !Message?.id || Button.disabled) {
        ShowChatModerationNotice("The report could not be sent while multiplayer is reconnecting.");
        return;
    }

    Button.disabled = true;
    Button.textContent = "Queuing";

    Socket.timeout(12000).emit("room:report", { messageId: Message.id }, (Error, Result) => {
        if (Error || !Result?.ok) {
            Button.disabled = false;
            Button.textContent = "Report";
            ShowChatModerationNotice(Result?.error || "The report could not be queued.");
            return;
        }

        Button.dataset.reportId = Result.reportId || "";
        Button.textContent = "Reported";
        ShowChatModerationNotice("Report received. The conversation evidence will be reviewed.", true);
    });
}

function AttachChatReportControl(Element, Message) {
    if (!Element || !Message?.id) return;

    Element.dataset.messageId = Message.id;
    const ReporterUsername = GetChatReporterUsername();
    if (
        !ReporterUsername
        || Message.username === ReporterUsername
        || Message.bot
        || Message.system
        || Message.vote
        || Message.username === "StoryBot"
        || Element.querySelector(".ChatReportButton")
    ) {
        return;
    }

    const Button = document.createElement("button");
    Button.className = "ChatReportButton";
    Button.type = "button";
    Button.setAttribute("aria-label", "Report this message");
    Button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 21V4m1 1h10l-2 4 2 4H7"></path></svg><span>Report</span>';
    Button.addEventListener("click", () => SubmitChatReport(Message, Button));
    Element.appendChild(Button);
}

function WrapChatReportRenderers() {
    if (typeof AppendChat === "function" && !AppendChat.ReportWrapped) {
        const BaseAppendChat = AppendChat;
        const WrappedAppendChat = function(Message, ...Rest) {
            const Result = BaseAppendChat(Message, ...Rest);
            AttachChatReportControl(document.getElementById("ChatMessages")?.lastElementChild, Message);
            return Result;
        };
        WrappedAppendChat.ReportWrapped = true;
        AppendChat = WrappedAppendChat;
    }

    if (typeof AppendGameChat === "function" && !AppendGameChat.ReportWrapped) {
        const BaseAppendGameChat = AppendGameChat;
        const WrappedAppendGameChat = function(Message, ...Rest) {
            const Result = BaseAppendGameChat(Message, ...Rest);
            AttachChatReportControl(document.getElementById("GameChatMessages")?.lastElementChild, Message);
            return Result;
        };
        WrappedAppendGameChat.ReportWrapped = true;
        AppendGameChat = WrappedAppendGameChat;
    }
}

function RemoveModeratedChatMessage(MessageId) {
    if (!MessageId) return;
    for (const Element of document.querySelectorAll("[data-message-id]")) {
        if (Element.dataset.messageId === MessageId) Element.remove();
    }
}

function BindChatModerationSocket(Socket) {
    if (!Socket || Socket.ChatModerationBound) return;
    Socket.ChatModerationBound = true;

    Socket.on("room:chatRemoved", Payload => {
        RemoveModeratedChatMessage(String(Payload?.messageId || ""));
    });

    Socket.on("room:reportResult", Payload => {
        const ReportId = String(Payload?.reportId || "");
        const Button = ReportId
            ? document.querySelector('.ChatReportButton[data-report-id="' + CSS.escape(ReportId) + '"]')
            : null;

        if (Button) {
            Button.textContent = Payload?.actionTaken ? "Removed" : "Reviewed";
        }

        ShowChatModerationNotice(
            Payload?.actionTaken
                ? "The reported message was removed and the player was warned."
                : "The review did not find enough evidence to take action.",
            Boolean(Payload?.actionTaken)
        );
    });

    Socket.on("room:moderationResult", Payload => {
        ShowChatModerationNotice(
            Payload?.muted
                ? "Chat was disabled after repeated abusive messages."
                : "An abusive message was removed. Continued abuse will disable chat."
        );
    });
}

WrapChatReportRenderers();
