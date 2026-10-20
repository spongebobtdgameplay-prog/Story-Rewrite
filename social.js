const SOCIAL_SOCKET_CLIENT_URL = "https://cdn.socket.io/4.8.3/socket.io.min.js";
const SOCIAL_MAX_MESSAGE_LENGTH = 300;
let SocialSocket = null;
let SocialSocketPromise = null;
let SocialCurrentUser = null;
let SocialSelectedUser = null;
let SocialActiveUsername = "";
let SocialSearchTimer = null;
let SocialSearchRequestId = 0;
let SocialInboxRequestId = 0;
let SocialHoveredMessageId = "";
let SocialActiveMessageMenu = null;
let SocialMessageMenuCloseTimer = null;
const SocialMessageIds = new Set();

function SocialById(Id) {
    return document.getElementById(Id);
}

function SocialInitial(Name) {
    const Text = String(Name || "?").trim();
    return Text.slice(0, 1).toUpperCase() || "?";
}

function SocialUpdateActiveUserButtons() {
    const Selected = String(SocialActiveUsername || "").toLowerCase();
    document.querySelectorAll("[data-social-username]").forEach(Button => {
        const Active = String(Button.dataset.socialUsername || "").toLowerCase() === Selected;
        Button.classList.toggle("Active", Active);
        Button.setAttribute("aria-pressed", Active ? "true" : "false");
    });
}

function SocialInterpolateFrameIntoView(Element) {
    if (!Element) return;
    const ReducedMotion = Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
    try {
        Element.scrollIntoView({
            behavior: ReducedMotion ? "auto" : "smooth",
            block: "nearest",
            inline: "nearest"
        });
    } catch {}
}

function SocialFocusAndRevealSmooth(Element) {
    if (!Element) return;
    try { Element.focus({ preventScroll: true }); } catch { Element.focus(); }
}

function SocialPresenceLabel(Presence) {
    if (Presence === "online") return "Online";
    if (Presence === "idle") return "Idle";
    return "Offline";
}

function SocialPresenceTooltip(User) {
    const Status = String(User?.presenceMode || User?.presence || "offline").toLowerCase();
    const Label = Status === "ghost" ? "Ghost (shown offline)" : SocialPresenceLabel(Status);
    const ExpiresAt = Number(User?.presenceExpiresAt || 0);
    const Duration = Number(User?.presenceDurationMinutes || 0);
    if (ExpiresAt > Date.now()) {
        return Label + " status · " + (Duration ? Duration + " minute duration" : "temporary status") +
            " · expires in about " + Math.ceil((ExpiresAt - Date.now()) / 60000) + " minutes";
    }
    return Label + " status · " + (Duration ? Duration + " minute duration" : "no expiry");
}

function SocialFormatTime(Value) {
    const Time = new Date(Value || Date.now());
    if (!Number.isFinite(Time.getTime())) return "";
    return Time.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function SocialSetStatus(Target, Text, Kind) {
    if (!Target) return;
    Target.textContent = Text || "";
    Target.className = "StorySocialChatStatus" + (Kind ? " " + Kind : "");
}

function SocialSafeError(Error, Fallback) {
    const Message = String(Error?.message || "");
    const Internal = /api route|neon|render|server error|http\s*\d{3}|status\s*\d{3}|database|sql/i.test(Message);
    if (Internal || !Message) return Fallback;
    return Message;
}

function SocialShowEmptyState() {
    const Empty = SocialById("SocialChatEmpty");
    const View = SocialById("SocialChatView");
    const Title = SocialById("SocialChatEmptyTitle");
    const Text = SocialById("SocialChatEmptyText");

    if (Empty) Empty.hidden = false;
    if (View) View.hidden = true;
    if (Title) Title.textContent = "Choose a player";
    if (Text) Text.textContent = "Search the player index on the left. Their profile, progress, presence, and conversation will appear here.";
}

function SocialShowLoadingState() {
    const Empty = SocialById("SocialChatEmpty");
    const View = SocialById("SocialChatView");
    const Title = SocialById("SocialChatEmptyTitle");
    const Text = SocialById("SocialChatEmptyText");

    if (Empty) Empty.hidden = false;
    if (View) View.hidden = true;
    if (Title) Title.textContent = "Loading...";
    if (Text) Text.textContent = "Opening that player's profile and conversation.";
}

function SocialRenderStats(User) {
    const Card = SocialById("SocialProfileCard");
    if (!Card || !User) return;

    Card.innerHTML = [
        ["Stars", User.stars ?? 0],
        ["Cleared", User.clearedStages ?? 0],
        ["Deaths", User.deaths ?? 0],
        ["Lives", String(User.lives ?? 0) + "/" + String(User.maxLives ?? 0)]
    ].map(function(Item) {
        return '<div class="StorySocialProfileStat">' +
            '<span>' + String(Item[0]) + '</span>' +
            '<strong>' + String(Item[1]) + '</strong>' +
        '</div>';
    }).join("");
}

function SocialRenderUsers(Users, EmptyMessage = "No matching Story Rewrite users were found.") {
    const List = SocialById("SocialUserList");
    if (!List) return;

    if (!Users.length) {
        const Message = EmptyMessage === "Search for players"
            ? "Search for players"
            : "No matching Story Rewrite users were found.";
        List.innerHTML = '<div class="StorySocialEmpty StorySocialEmptyPlain"><strong>' + Message + '</strong></div>';
        return;
    }

    List.innerHTML = Users.map(function(User) {
        const Active = String(SocialActiveUsername || "").toLowerCase() === String(User.username).toLowerCase();
        return '<button class="StorySocialUserButton' + (Active ? ' Active' : '') +
            '" type="button" aria-pressed="' + (Active ? 'true' : 'false') +
            '" data-social-username="' + String(User.username).replace(/"/g, '&quot;') + '">' +
            '<span class="StorySocialAvatar" aria-hidden="true">' + SocialInitial(User.username) + '</span>' +
            '<span class="StorySocialUserCopy">' +
                '<span class="StorySocialUserName">' + String(User.username) + '</span>' +
                '<span class="StorySocialUserMeta">' + String(User.userId) + ' · ' + SocialPresenceLabel(User.presence) + '</span>' +
            '</span>' +
            '<span class="StorySocialPresenceDot ' + String(User.presence) + '" aria-label="' + SocialPresenceLabel(User.presence) + '"></span>' +
        '</button>';
    }).join("");

    List.querySelectorAll("[data-social-username]").forEach(function(Button) {
        Button.addEventListener("click", function() {
            SelectSocialUser(Button.dataset.socialUsername);
        });
    });
}

function SocialRenderInbox(Items) {
    const List = SocialById("SocialInboxList");
    const Status = SocialById("SocialInboxStatus");
    if (!List) return;

    if (!Items.length) {
        List.innerHTML = '<div class="StorySocialInboxEmpty">No one has messaged you yet.</div>';
        if (Status) Status.textContent = "No new conversations";
        return;
    }

    if (Status) Status.textContent = Items.length + (Items.length === 1 ? " conversation" : " conversations");
    List.replaceChildren();

    Items.forEach(Item => {
        const User = Item?.user;
        if (!User?.username) return;
        const Button = document.createElement("button");
        Button.type = "button";
        Button.className = "StorySocialInboxButton";
        Button.dataset.socialUsername = String(User.username);
        Button.setAttribute("aria-pressed",
            String(SocialActiveUsername || "").toLowerCase() === String(User.username).toLowerCase() ? "true" : "false");
        Button.title = "Open conversation with " + User.username + ". Last message: " + String(Item.lastMessage || "Message").slice(0, 120);

        const Avatar = document.createElement("span");
        Avatar.className = "StorySocialInboxAvatar";
        Avatar.textContent = SocialInitial(User.username);
        Avatar.setAttribute("aria-hidden", "true");

        const Copy = document.createElement("span");
        Copy.className = "StorySocialInboxCopy";
        const Name = document.createElement("strong");
        Name.textContent = User.username;
        const Preview = document.createElement("span");
        Preview.className = "StorySocialInboxPreview";
        Preview.textContent = (Item.lastMessageFromMe ? "You: " : "") + String(Item.lastMessage || "");
        Copy.append(Name, Preview);

        const Time = document.createElement("span");
        Time.className = "StorySocialInboxTime";
        Time.textContent = SocialFormatTime(Item.lastMessageAt);
        Button.append(Avatar, Copy, Time);
        Button.addEventListener("click", () => SelectSocialUser(User.username));
        List.appendChild(Button);
    });
    SocialUpdateActiveUserButtons();
}

async function SocialLoadInbox() {
    const RequestId = ++SocialInboxRequestId;
    const List = SocialById("SocialInboxList");
    const Status = SocialById("SocialInboxStatus");
    if (List && !List.childElementCount) List.innerHTML = '<div class="StorySocialInboxEmpty">Loading your inbox...</div>';
    if (Status && !List?.querySelector(".StorySocialInboxButton")) Status.textContent = "Loading...";

    try {
        const Result = await ApiRequest("/api/social/inbox?limit=20");
        if (RequestId !== SocialInboxRequestId) return;
        const Items = Array.isArray(Result.messages) ? Result.messages : [];
        SocialRenderInbox(Items);
    } catch (Error) {
        if (RequestId !== SocialInboxRequestId) return;
        console.error("Story Social inbox failed", Error);
        if (List) List.innerHTML = '<div class="StorySocialInboxEmpty StorySocialInboxEmptyBad">Inbox is temporarily unavailable.</div>';
        if (Status) Status.textContent = "Unavailable";
    }
}

async function SocialSearchUsers(Query) {
    const Status = SocialById("SocialSearchStatus");
    const Search = String(Query || "").trim();
    const RequestId = ++SocialSearchRequestId;

    if (!Search) {
        SocialRenderUsers([], "Search for players");
        if (Status) Status.textContent = "";
        return;
    }

    if (Status) Status.textContent = "Searching...";

    try {
        const Result = await ApiRequest("/api/social/search?q=" + encodeURIComponent(Search));

        if (RequestId !== SocialSearchRequestId) return;

        const Users = Array.isArray(Result.users) ? Result.users : [];
        SocialRenderUsers(Users);
        if (Status) {
            Status.textContent = Users.length + " result" + (Users.length === 1 ? "" : "s");
        }
    } catch (Error) {
        if (RequestId !== SocialSearchRequestId) return;

        console.error("Story Social search failed", Error);
        if (Status) Status.textContent = SocialSafeError(Error, "Search is temporarily unavailable.");
        SocialRenderUsers([]);
    }
}

function SocialBuildMessageAction(Label, ClassName, OnClick) {
    const Button = document.createElement("button");
    Button.type = "button";
    Button.className = "StorySocialMessageAction" + (ClassName ? " " + ClassName : "");
    Button.textContent = Label;
    Button.addEventListener("click", Event => {
        Event.preventDefault();
        Event.stopPropagation();
        OnClick(Button);
    });
    return Button;
}


function SocialClearMessageMenuCloseTimer() {
    if (SocialMessageMenuCloseTimer !== null) {
        window.clearTimeout(SocialMessageMenuCloseTimer);
        SocialMessageMenuCloseTimer = null;
    }
}

function SocialCloseMessageMenu(Menu) {
    if (!Menu) return;
    SocialClearMessageMenuCloseTimer();
    const Trigger = Menu._storySocialTrigger || null;
    const Home = Menu._storySocialHome || null;
    Menu.hidden = true;
    Menu.dataset.openedByHover = "";
    Menu.dataset.openedByClick = "";
    Menu.style.left = "";
    Menu.style.top = "";
    Menu.style.visibility = "";
    Menu.style.position = "";
    if (Home && Trigger && Menu.parentElement === document.body && Trigger.parentElement === Home) {
        Home.insertBefore(Menu, Trigger.nextSibling);
    }
    Trigger?.setAttribute("aria-expanded", "false");
    if (SocialActiveMessageMenu === Menu) SocialActiveMessageMenu = null;
}

function SocialCloseAllMessageMenus(Except = null) {
    SocialClearMessageMenuCloseTimer();
    document.querySelectorAll(".StorySocialMessageMenu").forEach(Menu => {
        if (Menu !== Except && !Menu.hidden) SocialCloseMessageMenu(Menu);
    });
}

function SocialPositionMessageMenu() {
    const Menu = SocialActiveMessageMenu;
    if (!Menu || Menu.hidden) return;
    const Trigger = Menu._storySocialTrigger;
    if (!Trigger?.isConnected) {
        SocialCloseMessageMenu(Menu);
        return;
    }

    const ViewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const ViewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const Margin = 10;
    Menu.style.position = "fixed";
    Menu.style.zIndex = "2147483647";
    Menu.style.left = "0px";
    Menu.style.top = "0px";
    Menu.style.visibility = "hidden";

    const TriggerRect = Trigger.getBoundingClientRect();
    const MenuRect = Menu.getBoundingClientRect();
    const MenuWidth = Math.min(MenuRect.width || 170, ViewportWidth - Margin * 2);
    const MenuHeight = Math.min(MenuRect.height || 120, ViewportHeight - Margin * 2);
    const MessageBubble = Trigger.closest(".StorySocialMessage");
    const BubbleRect = MessageBubble?.getBoundingClientRect() || TriggerRect;
    const IsRightSideBubble = Boolean(MessageBubble?.classList.contains("Sent"));
    const Gap = 14;
    let Left;

    // Place the menu outside the entire bubble, not over the message text.
    if (IsRightSideBubble) {
        Left = BubbleRect.left - MenuWidth - Gap;
        if (Left < Margin) Left = TriggerRect.left - MenuWidth - Gap * 2;
    } else {
        Left = BubbleRect.right + Gap;
        if (Left + MenuWidth > ViewportWidth - Margin) Left = TriggerRect.right + Gap;
    }
    Left = Math.max(Margin, Math.min(Left, ViewportWidth - MenuWidth - Margin));

    // Align with the top of the bubble so it opens beside the content.
    let Top = BubbleRect.top;
    if (Top + MenuHeight > ViewportHeight - Margin) Top = BubbleRect.bottom - MenuHeight;
    if (Top < Margin) Top = TriggerRect.bottom + 5;
    Top = Math.max(Margin, Math.min(Top, ViewportHeight - MenuHeight - Margin));

    Menu.style.left = Math.round(Left) + "px";
    Menu.style.top = Math.round(Top) + "px";
    Menu.style.visibility = "visible";
}

function SocialOpenMessageMenu(Menu, Trigger, OpenedByHover = false) {
    if (!Menu || !Trigger) return;
    SocialClearMessageMenuCloseTimer();
    if (SocialActiveMessageMenu && SocialActiveMessageMenu !== Menu) {
        SocialCloseMessageMenu(SocialActiveMessageMenu);
    }
    Menu._storySocialTrigger = Trigger;
    Menu._storySocialHome = Trigger.closest(".StorySocialMessage");
    if (Menu.parentElement !== document.body) document.body.appendChild(Menu);
    Menu.hidden = false;
    Menu.dataset.openedByHover = OpenedByHover ? "true" : "";
    Menu.dataset.openedByClick = "";
    SocialActiveMessageMenu = Menu;
    Trigger.setAttribute("aria-expanded", "true");
    SocialPositionMessageMenu();
}

function SocialQueueMessageMenuClose(Menu) {
    SocialClearMessageMenuCloseTimer();
    SocialMessageMenuCloseTimer = window.setTimeout(() => {
        SocialMessageMenuCloseTimer = null;
        const Trigger = Menu?._storySocialTrigger;
        const PointerStillInside = Boolean(Menu?.matches(":hover") || Trigger?.matches(":hover"));
        const FocusStillInside = Boolean(Menu?.contains(document.activeElement) ||
            (document.activeElement === Trigger && Trigger?.matches(":focus-visible")));
        if (!PointerStillInside && !FocusStillInside) SocialCloseMessageMenu(Menu);
    }, 220);
}

function SocialAskReportReason() {
    return new Promise(resolve => {
        const Dialog = document.createElement("dialog");
        Dialog.className = "StorySocialReportDialog";
        Dialog.setAttribute("aria-labelledby", "StorySocialReportHeading");

        const Form = document.createElement("form");
        Form.className = "StorySocialReportForm";
        const Heading = document.createElement("h2");
        Heading.id = "StorySocialReportHeading";
        Heading.textContent = "Report this message";
        const Intro = document.createElement("p");
        Intro.textContent = "Choose the reason that best describes the problem. Add details only if they help explain the report.";

        const ReasonLabel = document.createElement("label");
        ReasonLabel.htmlFor = "StorySocialReportReason";
        ReasonLabel.textContent = "Reason";
        const ReasonSelect = document.createElement("select");
        ReasonSelect.id = "StorySocialReportReason";
        ReasonSelect.required = true;
        ReasonSelect.name = "reason";

        const Placeholder = document.createElement("option");
        Placeholder.value = "";
        Placeholder.textContent = "Select a reason…";
        Placeholder.disabled = true;
        Placeholder.selected = true;
        ReasonSelect.appendChild(Placeholder);

        [
            "Harassment or bullying",
            "Hate or hateful conduct",
            "Threats or violence",
            "Sexual content",
            "Spam or advertising",
            "Scam or fraud",
            "Sharing private or personal information",
            "Impersonation",
            "Other"
        ].forEach(Value => {
            const Option = document.createElement("option");
            Option.value = Value;
            Option.textContent = Value;
            ReasonSelect.appendChild(Option);
        });

        const DetailsLabel = document.createElement("label");
        DetailsLabel.htmlFor = "StorySocialReportDetails";
        DetailsLabel.textContent = "Additional details (optional)";
        const Details = document.createElement("textarea");
        Details.id = "StorySocialReportDetails";
        Details.name = "details";
        Details.maxLength = 150;
        Details.rows = 3;
        Details.placeholder = "Add context for the moderators…";

        const Actions = document.createElement("div");
        Actions.className = "StorySocialReportActions";
        const Cancel = document.createElement("button");
        Cancel.type = "button";
        Cancel.className = "StorySocialReportCancel";
        Cancel.textContent = "Cancel";
        const Submit = document.createElement("button");
        Submit.type = "submit";
        Submit.className = "StorySocialReportSubmit";
        Submit.textContent = "Submit report";

        Form.append(Heading, Intro, ReasonLabel, ReasonSelect, DetailsLabel, Details);
        Actions.append(Cancel, Submit);
        Form.appendChild(Actions);
        Dialog.appendChild(Form);

        let Settled = false;
        const Finish = Value => {
            if (Settled) return;
            Settled = true;
            if (Dialog.open) Dialog.close();
            Dialog.remove();
            resolve(Value);
        };
        Cancel.addEventListener("click", () => Finish(null));
        Dialog.addEventListener("cancel", Event => {
            Event.preventDefault();
            Finish(null);
        });
        Dialog.addEventListener("close", () => {
            if (!Settled) {
                Settled = true;
                Dialog.remove();
                resolve(null);
            }
        });
        Form.addEventListener("submit", Event => {
            Event.preventDefault();
            if (!ReasonSelect.value) {
                ReasonSelect.reportValidity();
                ReasonSelect.focus();
                return;
            }
            Finish({
                reason: ReasonSelect.value,
                details: String(Details.value || "").trim().slice(0, 150)
            });
        });

        document.body.appendChild(Dialog);
        if (typeof Dialog.showModal !== "function") {
            Dialog.remove();
            resolve(null);
            return;
        }
        try {
            Dialog.showModal();
            ReasonSelect.focus();
        } catch (Error) {
            Dialog.remove();
            resolve(null);
        }
    });
}

function SocialUpdateMessageReactions(Message, IncludeViewerState = false) {
    if (!Message) return;
    const MessageId = String(Message.messageId || Message.id || "");
    if (!MessageId) return;

    const Element = Array.from(document.querySelectorAll(".StorySocialMessage"))
        .find(Item => Item.dataset.messageId === MessageId);
    if (!Element) return;

    const LikeCount = Math.max(0, Number(Message.likeCount) || 0);
    const DislikeCount = Math.max(0, Number(Message.dislikeCount) || 0);
    const Reactions = Element.querySelector(".StorySocialMessageReactions");
    const Likes = Element.querySelector(".StorySocialMessageReaction.LikeCount");
    const Dislikes = Element.querySelector(".StorySocialMessageReaction.DislikeCount");

    if (Likes) {
        Likes.textContent = "👍 " + LikeCount;
        if (IncludeViewerState) Likes.title = Message.likedByMe ? "You liked this message" : "Likes";
    }
    if (Dislikes) {
        Dislikes.textContent = "👎 " + DislikeCount;
        if (IncludeViewerState) Dislikes.title = Message.dislikedByMe ? "You disliked this message" : "Dislikes";
    }
    if (Reactions) Reactions.setAttribute("aria-label", LikeCount + " likes, " + DislikeCount + " dislikes");

    if (IncludeViewerState) {
        Element.querySelector(".StorySocialMessageAction.LikeAction")
            ?.classList.toggle("IsActive", Boolean(Message.likedByMe));
        Element.querySelector(".StorySocialMessageAction.DislikeAction")
            ?.classList.toggle("IsActive", Boolean(Message.dislikedByMe));
    }
}

function SocialAddMessage(Message) {
    if (!Message || !Message.id) return;
    const Container = SocialById("SocialMessages");
    if (!Container) return;

    const Id = String(Message.id);
    const Existing = Array.from(Container.querySelectorAll(".StorySocialMessage"))
        .find(Element => Element.dataset.messageId === Id) || null;
    const IsNew = !Existing;
    if (IsNew && SocialMessageIds.has(Id)) return;
    SocialMessageIds.add(Id);

    const Mine = String(Message.senderUsername || "").toLowerCase() === String(SocialCurrentUser?.username || "").toLowerCase();
    const Deleted = Boolean(Message.deleted);
    const Element = Existing || document.createElement("article");
    Element.className = "StorySocialMessage" + (Mine ? " Sent" : "") + (Deleted ? " Deleted" : "");
    Element.dataset.messageId = Id;
    Element.dataset.mine = Mine ? "true" : "false";
    Element.dataset.deleted = Deleted ? "true" : "false";
    Element.tabIndex = 0;
    Element.setAttribute("aria-label", (Mine ? "Your message" : "Message from " + String(Message.senderUsername || "player")));

    if (SocialActiveMessageMenu?.dataset.messageId === Id) SocialCloseMessageMenu(SocialActiveMessageMenu);
    while (Element.firstChild) Element.removeChild(Element.firstChild);

    if (!Deleted) {
        const More = document.createElement("button");
        More.type = "button";
        More.className = "StorySocialMessageMore";
        More.textContent = "···";
        More.title = "Message actions";
        More.setAttribute("aria-label", "More actions for this message");

        More.setAttribute("aria-expanded", "false");

        const Menu = document.createElement("div");
        Menu.className = "StorySocialMessageMenu";
        Menu.dataset.messageId = Id;
        Menu.hidden = true;
        Menu._storySocialTrigger = More;
        Menu._storySocialHome = Element;

        More.addEventListener("pointerenter", Event => {
            if (Event.pointerType !== "touch") SocialOpenMessageMenu(Menu, More, true);
        });
        More.addEventListener("pointerleave", Event => {
            if (Event.pointerType !== "touch") SocialQueueMessageMenuClose(Menu);
        });
        More.addEventListener("focus", () => {
            if (More.dataset.suppressMenuFocusOpen === "true") {
                More.dataset.suppressMenuFocusOpen = "";
                return;
            }
            if (SocialActiveMessageMenu !== Menu || Menu.hidden) SocialOpenMessageMenu(Menu, More, false);
        });
        More.addEventListener("click", Event => {
            Event.preventDefault();
            Event.stopPropagation();
            if (SocialActiveMessageMenu === Menu && !Menu.hidden) {
                if (Menu.dataset.openedByHover === "true") {
                    Menu.dataset.openedByHover = "";
                    Menu.dataset.openedByClick = "true";
                    return;
                }
                if (Menu.dataset.openedByClick !== "true") {
                    Menu.dataset.openedByClick = "true";
                    return;
                }
                SocialCloseMessageMenu(Menu);
            } else {
                SocialOpenMessageMenu(Menu, More, false);
                Menu.dataset.openedByClick = "true";
            }
        });
        Menu.addEventListener("pointerenter", SocialClearMessageMenuCloseTimer);
        Menu.addEventListener("pointerleave", () => SocialQueueMessageMenuClose(Menu));
        Menu.addEventListener("focusin", SocialClearMessageMenuCloseTimer);
        Menu.addEventListener("focusout", () => SocialQueueMessageMenuClose(Menu));
        Menu.addEventListener("keydown", Event => {
            if (Event.key !== "Escape") return;
            Event.preventDefault();
            SocialCloseMessageMenu(Menu);
            More.dataset.suppressMenuFocusOpen = "true";
            More.focus();
        });
        Element.append(More, Menu);

        Menu.appendChild(SocialBuildMessageAction(
            "👍 Like",
            "LikeAction" + (Message.likedByMe ? " IsActive" : ""),
            async () => {
                SocialCloseMessageMenu(Menu);
                await SocialReactMessage(Id, "like");
            }
        ));
        Menu.appendChild(SocialBuildMessageAction(
            "👎 Dislike",
            "DislikeAction" + (Message.dislikedByMe ? " IsActive" : ""),
            async () => {
                SocialCloseMessageMenu(Menu);
                await SocialReactMessage(Id, "dislike");
            }
        ));

        if (!Mine) {
            Menu.appendChild(SocialBuildMessageAction("Report", "ReportAction", async () => {
                SocialCloseMessageMenu(Menu);
                await SocialReportMessage(Id);
            }));
        }
        if (Mine) {
            Menu.appendChild(SocialBuildMessageAction("Delete message", "DeleteAction", async () => {
                SocialCloseMessageMenu(Menu);
                await SocialDeleteMessage(Id);
            }));
        }
    }

    const Text = document.createElement("div");
    Text.className = "StorySocialMessageText";
    Text.textContent = Deleted ? "Message deleted" : String(Message.text || "");
    Element.appendChild(Text);

    const Reactions = document.createElement("div");
    Reactions.className = "StorySocialMessageReactions";
    Reactions.setAttribute("aria-label",
        Number(Message.likeCount || 0) + " likes, " + Number(Message.dislikeCount || 0) + " dislikes");

    const Likes = document.createElement("span");
    Likes.className = "StorySocialMessageReaction LikeCount";
    Likes.textContent = "👍 " + Number(Message.likeCount || 0);
    Likes.title = Message.likedByMe ? "You liked this message" : "Likes";

    const Dislikes = document.createElement("span");
    Dislikes.className = "StorySocialMessageReaction DislikeCount";
    Dislikes.textContent = "👎 " + Number(Message.dislikeCount || 0);
    Dislikes.title = Message.dislikedByMe ? "You disliked this message" : "Dislikes";

    Reactions.append(Likes, Dislikes);
    Element.appendChild(Reactions);

    const Time = document.createElement("div");
    Time.className = "StorySocialMessageTime";
    Time.textContent = SocialFormatTime(Message.sentAt) + (Deleted ? " · deleted" : "");
    Element.appendChild(Time);

    if (IsNew) {
        Container.querySelectorAll(".StorySocialConversationState").forEach(State => State.remove());
        Element.addEventListener("pointerenter", () => { SocialHoveredMessageId = Id; });
        Element.addEventListener("pointerleave", () => {
            if (SocialHoveredMessageId === Id) SocialHoveredMessageId = "";
        });
        Container.appendChild(Element);
        Container.scrollTop = Container.scrollHeight;
    }
}

async function SocialLoadConversation() {
    if (!SocialSelectedUser) return;
    const ConversationUsername = String(SocialSelectedUser.username || "");
    const Container = SocialById("SocialMessages");
    if (!Container) return;

    SocialMessageIds.clear();
    Container.innerHTML = '<div class="StorySocialConversationState">Loading messages...</div>';

    try {
        const Result = await ApiRequest(
            "/api/social/messages?username=" + encodeURIComponent(SocialSelectedUser.username) + "&limit=100"
        );
        Container.innerHTML = "";
        const Messages = Array.isArray(Result.messages) ? Result.messages : [];
        Messages.forEach(SocialAddMessage);
        if (!Messages.length) {
            Container.innerHTML = '<div class="StorySocialConversationState">No messages in this conversation yet.</div>';
        }
        if (String(SocialSelectedUser?.username || "").toLowerCase() === ConversationUsername.toLowerCase() &&
            typeof StoryMarkSocialConversationRead === "function") {
            StoryMarkSocialConversationRead(ConversationUsername);
        }
    } catch (Error) {
        console.error("Story Social conversation load failed", Error);
        Container.innerHTML = '<div class="StorySocialConversationState StorySocialConversationStateBad">Chat is temporarily unavailable. Try again in a moment.</div>';
    }
}

async function SocialReactMessage(MessageId, Reaction) {
    try {
        const Result = await ApiRequest("/api/social/messages/react", {
            method: "POST",
            body: JSON.stringify({ messageId: MessageId, reaction: Reaction })
        });
        if (Result?.message) SocialUpdateMessageReactions(Result.message, true);
        SocialSetStatus(SocialById("SocialChatStatus"), Reaction === "like" ? "Like updated." : "Dislike updated.", "Good");
        SocialLoadInbox();
    } catch (Error) {
        SocialSetStatus(SocialById("SocialChatStatus"), SocialSafeError(Error, "Could not update the reaction."), "Bad");
    }
}

async function SocialDeleteMessage(MessageId) {
    const Confirmed = typeof StoryConfirm === "function"
        ? await StoryConfirm({
            title: "Delete this message?",
            message: "Your message will be marked as deleted in the conversation.",
            confirmText: "Delete message",
            cancelText: "Keep message",
            danger: true
        })
        : window.confirm("Delete your message? It will be marked as deleted in the conversation.");
    if (!Confirmed) return;

    try {
        const Result = await ApiRequest("/api/social/messages/delete", {
            method: "POST",
            body: JSON.stringify({ messageId: MessageId })
        });
        if (Result?.message) SocialAddMessage(Result.message);
        SocialSetStatus(SocialById("SocialChatStatus"), "Message deleted.", "Good");
        SocialLoadInbox();
    } catch (Error) {
        SocialSetStatus(SocialById("SocialChatStatus"), SocialSafeError(Error, "Could not delete that message."), "Bad");
    }
}

async function SocialReportMessage(MessageId) {
    const Selection = await SocialAskReportReason();
    if (!Selection) return;

    const Reason = (Selection.reason + (Selection.details ? ": " + Selection.details : "")).slice(0, 200);
    try {
        const Result = await ApiRequest("/api/social/messages/report", {
            method: "POST",
            body: JSON.stringify({ messageId: MessageId, reason: Reason })
        });
        SocialSetStatus(SocialById("SocialChatStatus"),
            Result?.alreadyReported ? "You already reported this message." : "Report submitted for review.",
            "Good");
    } catch (Error) {
        SocialSetStatus(SocialById("SocialChatStatus"), SocialSafeError(Error, "Could not report that message."), "Bad");
    }
}

async function SelectSocialUser(Username) {
    if (!Username) return;

    SocialActiveUsername = String(Username).toLowerCase();
    SocialUpdateActiveUserButtons();
    SocialSelectedUser = null;
    SocialShowLoadingState();

    // Start scrolling on the click, before profile and conversation requests.
    SocialInterpolateFrameIntoView(document.querySelector(".StorySocialChat"));

    try {
        const Result = await ApiRequest("/api/social/profile?username=" + encodeURIComponent(Username));
        if (!Result?.user?.username) throw new Error("Could not load that player.");
        SocialSelectedUser = Result.user;
    } catch (Error) {
        console.error("Story Social profile load failed", Error);
        SocialSearchUsers(SocialById("SocialSearchInput")?.value.trim() || "");
        const Status = SocialById("SocialSearchStatus");
        if (Status) Status.textContent = SocialSafeError(Error, "That player could not be opened.");
        return;
    }

    SocialById("SocialChatEmpty").hidden = true;
    SocialById("SocialChatView").hidden = false;
    // Opening a conversation marks its notifications as seen immediately.
    if (typeof StoryMarkSocialConversationRead === "function") {
        StoryMarkSocialConversationRead(SocialSelectedUser.username);
    }
    SocialById("SocialChatAvatar").textContent = SocialInitial(SocialSelectedUser.username);
    SocialById("SocialChatUsername").textContent = SocialSelectedUser.username;
    SocialById("SocialChatPresence").textContent = SocialPresenceLabel(SocialSelectedUser.presence);
    SocialById("SocialChatPresence").title = SocialPresenceTooltip(SocialSelectedUser);
    const PresenceDot = SocialById("SocialChatPresenceDot");
    if (PresenceDot) {
        PresenceDot.className = "StorySocialPresenceDot " + String(SocialSelectedUser.presence || "offline");
        PresenceDot.title = SocialPresenceTooltip(SocialSelectedUser);
    }
    SocialById("SocialChatUserId").textContent = SocialSelectedUser.userId;
    SocialRenderStats(SocialSelectedUser);
    SocialSetStatus(SocialById("SocialChatStatus"), "");
    await SocialLoadConversation();
    SocialFocusAndRevealSmooth(SocialById("SocialMessageInput"));
    const SearchInput = SocialById("SocialSearchInput");
    if (SearchInput && SearchInput.value.trim()) SocialSearchUsers(SearchInput.value.trim());
}

async function SocialSendMessage(Event) {
    Event.preventDefault();
    if (!SocialSelectedUser) return;

    const Input = SocialById("SocialMessageInput");
    const Text = String(Input?.value || "").trim();
    if (!Text) {
        SocialSetStatus(SocialById("SocialChatStatus"), "Write a message first.", "Bad");
        return;
    }
    if (Text.length > SOCIAL_MAX_MESSAGE_LENGTH) {
        SocialSetStatus(SocialById("SocialChatStatus"), "Messages are limited to 300 characters.", "Bad");
        return;
    }

    const Button = SocialById("SocialSendButton");
    if (Button) Button.disabled = true;

    let SentMessage = null;
    try {
        if (SocialSocket?.connected) {
            const Result = await new Promise(function(Resolve, Reject) {
                SocialSocket.timeout(10000).emit(
                    "social:message",
                    { username: SocialSelectedUser.username, message: Text },
                    function(Error, Response) {
                        if (Error) Reject(new Error("The message server did not answer."));
                        else Resolve(Response);
                    }
                );
            });
            if (!Result?.ok) throw new Error(Result?.error || "Could not send message.");
            SentMessage = Result.message || null;
        } else {
            const Result = await ApiRequest("/api/social/messages", {
                method: "POST",
                body: JSON.stringify({ username: SocialSelectedUser.username, message: Text })
            });
            if (!Result?.ok) throw new Error(Result?.error || "Could not send message.");
            SentMessage = Result.message || null;
        }

        if (SentMessage) SocialAddMessage(SentMessage);
        Input.value = "";
        SocialUpdateMessageCount();
        SocialSetStatus(SocialById("SocialChatStatus"), "");
        SocialLoadInbox();
    } catch (Error) {
        console.error("Story Social message send failed", Error);
        SocialSetStatus(SocialById("SocialChatStatus"), SocialSafeError(Error, "Your message could not be sent right now."), "Bad");
    } finally {
        if (Button) Button.disabled = false;
    }
}

function SocialUpdateMessageCount() {
    const Input = SocialById("SocialMessageInput");
    const Count = SocialById("SocialMessageCount");
    if (!Input || !Count) return;
    const AtLimit = Input.value.length >= SOCIAL_MAX_MESSAGE_LENGTH;
    Count.textContent = String(Input.value.length) + " / " + SOCIAL_MAX_MESSAGE_LENGTH;
    Count.classList.toggle("AtLimit", AtLimit);
    Count.classList.toggle("WithinLimit", !AtLimit);
    Count.setAttribute("aria-label", AtLimit
        ? "Character limit reached: " + SOCIAL_MAX_MESSAGE_LENGTH
        : Input.value.length + " of " + SOCIAL_MAX_MESSAGE_LENGTH + " characters");
}

async function SocialEnsureSocket() {
    if (typeof io !== "function") {
        if (!SocialSocketPromise) {
            SocialSocketPromise = new Promise(function(Resolve, Reject) {
                const Existing = document.querySelector('script[data-story-social-socket="1"]');
                if (Existing) {
                    Existing.addEventListener("load", function() {
                        if (typeof io === "function") Resolve();
                        else Reject(new Error("Socket.IO did not load."));
                    }, { once: true });
                    return;
                }

                const Script = document.createElement("script");
                Script.src = SOCIAL_SOCKET_CLIENT_URL + "?v=1";
                Script.async = true;
                Script.crossOrigin = "anonymous";
                Script.dataset.storySocialSocket = "1";
                Script.addEventListener("load", function() {
                    if (typeof io === "function") Resolve();
                    else Reject(new Error("Socket.IO did not load."));
                }, { once: true });
                Script.addEventListener("error", function() {
                    SocialSocketPromise = null;
                    Reject(new Error("Could not load the chat connection."));
                }, { once: true });
                document.head.appendChild(Script);
            });
        }
        await SocialSocketPromise;
    }

    if (SocialSocket?.connected) return SocialSocket;

    SocialSocket = ConnectStorySocket();

    SocialSocket.on("social:message", function(Message) {
        const Selected = String(SocialSelectedUser?.username || "").toLowerCase();
        const Sender = String(Message?.senderUsername || "").toLowerCase();
        const Recipient = String(Message?.recipientUsername || "").toLowerCase();
        const Me = String(SocialCurrentUser?.username || "").toLowerCase();
        if (Recipient === Me && Sender && Sender !== Me && typeof StoryRecordIncomingSocialMessage === "function") {
            StoryRecordIncomingSocialMessage(
                Message?.senderUsername || Sender,
                Message?.sentAt || Message?.createdAt || Message?.timestamp
            );
        }
        SocialLoadInbox();
        if (!Selected || !((Sender === Selected && Recipient === Me) || (Sender === Me && Recipient === Selected))) return;
        SocialAddMessage(Message);
    });

    SocialSocket.on("social:reaction", function(Payload) {
        SocialUpdateMessageReactions(Payload, false);
    });

    SocialSocket.on("social:presence", function(Payload) {
        const Username = String(Payload?.username || "").toLowerCase();
        if (!Username) return;
        if (SocialSelectedUser && Username === String(SocialSelectedUser.username || "").toLowerCase()) {
            SocialSelectedUser.presence = Payload.presence || "offline";
            SocialSelectedUser.presenceMode = Payload.presenceMode || Payload.presence || "offline";
            SocialSelectedUser.presenceExpiresAt = Number(Payload.presenceExpiresAt || 0);
            SocialSelectedUser.presenceDurationMinutes = Number(Payload.presenceDurationMinutes || 0);
            const Presence = SocialById("SocialChatPresence");
            if (Presence) {
                Presence.textContent = SocialPresenceLabel(SocialSelectedUser.presence);
                Presence.title = SocialPresenceTooltip(SocialSelectedUser);
            }
            const Dot = SocialById("SocialChatPresenceDot");
            if (Dot) {
                Dot.className = "StorySocialPresenceDot " + String(SocialSelectedUser.presence || "offline");
                Dot.title = SocialPresenceTooltip(SocialSelectedUser);
            }
        }
        const Input = SocialById("SocialSearchInput");
        if (Input && Input.value.trim()) SocialSearchUsers(Input.value.trim());
    });

    return SocialSocket;
}

async function SocialLoadCurrentUser() {
    const Result = await ApiRequest("/api/social/me");
    SocialCurrentUser = Result.user;
    ApplyStoryIdentityTitle({
        username: SocialCurrentUser.username,
        userId: SocialCurrentUser.userId
    });
}

function SocialOpenSettings() {
    if (typeof StoryNavigate === "function") StoryNavigate("settings.html");
    else window.location.href = BuildStoryUrl("settings.html");
}

document.addEventListener("DOMContentLoaded", async function() {
    const Input = SocialById("SocialSearchInput");
    const MessageInput = SocialById("SocialMessageInput");
    const Form = SocialById("SocialMessageForm");

    SocialShowEmptyState();
    SocialById("SocialSettingsButton")?.addEventListener("click", SocialOpenSettings);
    Input?.addEventListener("input", function() {
        clearTimeout(SocialSearchTimer);
        SocialSearchTimer = setTimeout(function() {
            SocialSearchUsers(Input.value.trim());
        }, 220);
    });
    MessageInput?.addEventListener("input", SocialUpdateMessageCount);
    SocialUpdateMessageCount();
    Form?.addEventListener("submit", SocialSendMessage);
    document.addEventListener("click", Event => {
        if (Event.target?.closest?.(".StorySocialMessageMenu, .StorySocialMessageMore")) return;
        SocialCloseAllMessageMenus();
    });
    document.addEventListener("scroll", SocialPositionMessageMenu, true);
    window.addEventListener("resize", SocialPositionMessageMenu);
    document.addEventListener("keydown", Event => {
        if (!Event.shiftKey || !["Backspace", "Delete"].includes(Event.key)) return;
        const ActiveElement = document.activeElement;
        const ActiveMessage = ActiveElement?.closest?.(".StorySocialMessage");
        if (ActiveElement?.matches?.("input,textarea,[contenteditable='true']") && !ActiveMessage) return;
        const HoveredMessage = SocialHoveredMessageId
            ? Array.from(document.querySelectorAll(".StorySocialMessage")).find(Element => Element.dataset.messageId === SocialHoveredMessageId)
            : null;
        const Target = ActiveMessage || HoveredMessage;
        if (!Target || Target.dataset.mine !== "true" || Target.dataset.deleted === "true") return;
        Event.preventDefault();
        SocialDeleteMessage(Target.dataset.messageId);
    });

    try {
        await Promise.all([RequireAccount(), SocialLoadCurrentUser()]);
        SocialLoadInbox();
    } catch (Error) {
        console.error("Story Social startup failed", Error);
        const Status = SocialById("SocialSearchStatus");
        if (Status) Status.textContent = SocialSafeError(Error, "Social is temporarily unavailable. Try again in a moment.");
        return;
    }

    SocialEnsureSocket().catch(function(Error) {
        console.warn("Story Social realtime connection unavailable", Error);
    });
});
