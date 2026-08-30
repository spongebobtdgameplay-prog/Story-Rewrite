function GetChatReporterUsername() {
    if (typeof CurrentProfile !== "undefined" && CurrentProfile?.username) return CurrentProfile.username;
    if (typeof Profile !== "undefined" && Profile?.username) return Profile.username;
    return "";
}

function GetChatModerationSocket() {
    if (typeof MultiplayerSocket !== "undefined") return MultiplayerSocket;
    return null;
}

let StoryAbuseWarningTimer = null;

function EnsureAbuseWarningStyles() {
    if (document.getElementById("StoryAbuseWarningStyles")) return;

    const Style = document.createElement("style");
    Style.id = "StoryAbuseWarningStyles";
    Style.textContent = `
.StoryAbuseWarningBanner{position:fixed;left:50%;bottom:22px;z-index:120000;width:min(720px,calc(100vw - 30px));box-sizing:border-box;padding:12px 16px;display:flex;align-items:center;gap:14px;border:1px solid rgba(208,117,83,.7);border-radius:7px;background:#321b13;box-shadow:0 14px 42px rgba(0,0,0,.42);color:#f5dfbf;transform:translate(-50%,0);opacity:1;transition:opacity .18s ease,transform .18s ease;pointer-events:none}
.StoryAbuseWarningBanner.Hidden{opacity:0;transform:translate(-50%,12px);visibility:hidden}
.StoryAbuseWarningMark{flex:0 0 auto;padding:5px 8px;border-radius:5px;background:#8f3c30;color:#fff1df;font:900 10px/1 system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase}
.StoryAbuseWarningCopy{min-width:0;display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.StoryAbuseWarningCopy strong{color:#ffe3b9;font:900 14px/1.2 system-ui,sans-serif}
.StoryAbuseWarningCopy span{color:#d9bea0;font:650 13px/1.35 system-ui,sans-serif}
.StoryAbuseWarningCount{margin-left:auto;flex:0 0 auto;color:#f1c88d;font:900 12px/1 system-ui,sans-serif}
@media(max-width:620px){.StoryAbuseWarningBanner{bottom:12px;align-items:flex-start}.StoryAbuseWarningCopy{display:block}.StoryAbuseWarningCopy strong,.StoryAbuseWarningCopy span{display:block}.StoryAbuseWarningCopy span{margin-top:3px}.StoryAbuseWarningCount{margin-left:0}}
`;
    document.head.appendChild(Style);
}

function ShowAbuseContentWarning(Payload = {}) {
    EnsureAbuseWarningStyles();

    let Banner = document.getElementById("StoryAbuseWarningBanner");
    if (!Banner) {
        Banner = document.createElement("div");
        Banner.id = "StoryAbuseWarningBanner";
        Banner.className = "StoryAbuseWarningBanner Hidden";
        Banner.setAttribute("role", "status");
        Banner.setAttribute("aria-live", "assertive");
        Banner.innerHTML = `
            <div class="StoryAbuseWarningMark">Warning</div>
            <div class="StoryAbuseWarningCopy">
                <strong id="StoryAbuseWarningDetected">Detected: Abusive content</strong>
                <span id="StoryAbuseWarningMessage">Abusive content is not allowed.</span>
            </div>
            <div class="StoryAbuseWarningCount" id="StoryAbuseWarningCount"></div>
        `;
        document.body.appendChild(Banner);
    }

    const Detected = String(Payload?.detected || Payload?.category || "Abusive or harmful content").trim();
    const Strikes = Number(Payload?.strikes || 0);
    const TimedOut = Boolean(Payload?.timedOut || Payload?.muted);

    const DetectedNode = document.getElementById("StoryAbuseWarningDetected");
    const MessageNode = document.getElementById("StoryAbuseWarningMessage");
    const CountNode = document.getElementById("StoryAbuseWarningCount");

    if (DetectedNode) DetectedNode.textContent = `Detected: ${Detected}`;
    if (MessageNode) {
        MessageNode.textContent = TimedOut
            ? "Repeated abuse triggered a chat timeout."
            : "Abusive content is not allowed. Continued abuse can lead to reports, timeouts, or account action.";
    }
    if (CountNode) CountNode.textContent = Strikes > 0 ? `Warning ${Math.min(Strikes, 3)}/3` : "";

    Banner.classList.remove("Hidden");

    if (StoryAbuseWarningTimer) clearTimeout(StoryAbuseWarningTimer);
    StoryAbuseWarningTimer = setTimeout(() => {
        Banner.classList.add("Hidden");
    }, TimedOut ? 9000 : 6500);
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

function CensorModeratedChatMessage(MessageId, Text = "*") {
    if (!MessageId) return;

    const SafeText = String(Text || "*");
    for (const Element of document.querySelectorAll("[data-message-id]")) {
        if (Element.dataset.messageId !== MessageId) continue;

        let TextNode = null;
        for (const Node of Element.childNodes) {
            if (Node.nodeType === Node.TEXT_NODE) {
                TextNode = Node;
                break;
            }
        }

        if (TextNode) TextNode.nodeValue = SafeText;
        else Element.appendChild(document.createTextNode(SafeText));
    }

    try {
        if (typeof MultiplayerState !== "undefined") {
            const Message = MultiplayerState?.messages?.find?.(
                Entry => String(Entry?.id || "") === MessageId
            );
            if (Message) Message.text = SafeText;
        }
    } catch {}
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

    Socket.on("room:chatCensored", Payload => {
        CensorModeratedChatMessage(
            String(Payload?.messageId || ""),
            String(Payload?.text || "*")
        );
    });

    Socket.on("room:contentWarning", Payload => {
        ShowAbuseContentWarning(Payload || {});
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
        ShowAbuseContentWarning(Payload || {});
    });
}

WrapChatReportRenderers();

function StartChatModerationBindings() {
    const Socket = GetChatModerationSocket();
    if (Socket) BindChatModerationSocket(Socket);
}

if (typeof BindSocket === "function") {
    const BaseReportingBindSocket = BindSocket;
    BindSocket = function(Socket) {
        BaseReportingBindSocket(Socket);
        BindChatModerationSocket(Socket);
    };
}

if (typeof StartMultiplayer === "function" && document.body.classList.contains("GamePage")) {
    const BaseReportingStartMultiplayer = StartMultiplayer;
    StartMultiplayer = function() {
        BaseReportingStartMultiplayer();
        setTimeout(StartChatModerationBindings, 0);
    };
}

StartChatModerationBindings();
const ChatModerationBindTimer = setInterval(StartChatModerationBindings, 500);
setTimeout(() => clearInterval(ChatModerationBindTimer), 30000);
