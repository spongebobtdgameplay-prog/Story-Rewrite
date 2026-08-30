function GetChatReporterUsername() {
    if (typeof CurrentProfile !== "undefined" && CurrentProfile?.username) return CurrentProfile.username;
    if (typeof Profile !== "undefined" && Profile?.username) return Profile.username;
    return "";
}

function GetChatModerationSocket() {
    if (typeof MultiplayerSocket !== "undefined") return MultiplayerSocket;
    return null;
}

function EnsureAbuseWarningStyles() {
    if (document.getElementById("StoryAbuseWarningStyles")) return;

    const Style = document.createElement("style");
    Style.id = "StoryAbuseWarningStyles";
    Style.textContent = `
.StoryAbuseWarningOverlay{position:fixed;inset:0;z-index:120000;display:grid;place-items:center;padding:22px;background:rgba(8,4,2,.72);backdrop-filter:blur(7px)}
.StoryAbuseWarningOverlay.Hidden{display:none}
.StoryAbuseWarningCard{width:min(520px,100%);padding:24px;border:1px solid rgba(197,92,70,.66);border-radius:17px;background:linear-gradient(180deg,#3b2118,#21120d);box-shadow:0 26px 80px rgba(0,0,0,.55);color:#f7e6cb}
.StoryAbuseWarningKicker{color:#e7a36f;font:900 11px/1.1 system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase}
.StoryAbuseWarningCard h2{margin:8px 0 10px;color:#ffe6c0;font:800 25px/1.12 Georgia,"Times New Roman",serif}
.StoryAbuseWarningCard p{margin:0;color:#e1c8a7;font:600 15px/1.55 system-ui,sans-serif}
.StoryAbuseWarningCount{margin-top:14px;padding:10px 12px;border:1px solid rgba(230,177,107,.22);border-radius:10px;background:rgba(255,235,198,.055);color:#f0cf9d;font:800 13px/1.3 system-ui,sans-serif}
.StoryAbuseWarningActions{display:flex;justify-content:flex-end;margin-top:18px}
.StoryAbuseWarningActions button{min-width:120px}
`;
    document.head.appendChild(Style);
}

function ShowAbuseContentWarning(Payload = {}) {
    EnsureAbuseWarningStyles();

    let Overlay = document.getElementById("StoryAbuseWarningOverlay");
    if (!Overlay) {
        Overlay = document.createElement("div");
        Overlay.id = "StoryAbuseWarningOverlay";
        Overlay.className = "StoryAbuseWarningOverlay";
        Overlay.innerHTML = `
            <section class="StoryAbuseWarningCard" role="alertdialog" aria-modal="true" aria-labelledby="StoryAbuseWarningTitle">
                <div class="StoryAbuseWarningKicker">Chat moderation</div>
                <h2 id="StoryAbuseWarningTitle">Warning — abusive content is not allowed</h2>
                <p>Swearing or harassment can lead to reports, chat timeouts, or account action. Repeated or severe abuse can lead to account termination.</p>
                <div class="StoryAbuseWarningCount Hidden" id="StoryAbuseWarningCount"></div>
                <div class="StoryAbuseWarningActions">
                    <button class="SecondaryButton" id="StoryAbuseWarningClose" type="button">Understood</button>
                </div>
            </section>
        `;
        document.body.appendChild(Overlay);
        document.getElementById("StoryAbuseWarningClose")?.addEventListener("click", () => Overlay.classList.add("Hidden"));
    }

    const Count = document.getElementById("StoryAbuseWarningCount");
    const Strikes = Number(Payload?.strikes || 0);
    if (Count) {
        Count.classList.toggle("Hidden", Strikes <= 0);
        Count.textContent = Strikes > 0 ? `Abuse warnings: ${Math.min(Strikes, 3)}/3` : "";
    }

    Overlay.classList.remove("Hidden");
    document.getElementById("StoryAbuseWarningClose")?.focus();
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

    for (const StateName of ["MultiplayerState"]) {
        try {
            const State = eval(StateName);
            const Message = State?.messages?.find?.(Entry => String(Entry?.id || "") === MessageId);
            if (Message) Message.text = SafeText;
        } catch {}
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
        ShowChatModerationNotice(
            Payload?.muted
                ? "Chat was disabled after repeated abusive messages."
                : "Abusive content was censored. Continued abuse can lead to chat restrictions."
        );
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
