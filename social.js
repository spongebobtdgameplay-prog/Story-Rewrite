const SOCIAL_SOCKET_CLIENT_URL = "https://cdn.socket.io/4.8.3/socket.io.min.js";
const SOCIAL_MAX_MESSAGE_LENGTH = 300;
let SocialSocket = null;
let SocialSocketPromise = null;
let SocialCurrentUser = null;
let SocialSelectedUser = null;
let SocialSearchTimer = null;
const SocialMessageIds = new Set();

function SocialById(Id) {
    return document.getElementById(Id);
}

function SocialInitial(Name) {
    const Text = String(Name || "?").trim();
    return Text.slice(0, 1).toUpperCase() || "?";
}

function SocialPresenceLabel(Presence) {
    if (Presence === "online") return "Online";
    if (Presence === "idle") return "Idle";
    return "Offline";
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

function SocialRenderUsers(Users) {
    const List = SocialById("SocialUserList");
    if (!List) return;

    if (!Users.length) {
        List.innerHTML = '<div class="StorySocialEmpty">No matching Story Rewrite users were found.</div>';
        return;
    }

    List.innerHTML = Users.map(function(User) {
        const Active = SocialSelectedUser && String(SocialSelectedUser.username).toLowerCase() === String(User.username).toLowerCase();
        return '<button class="StorySocialUserButton' + (Active ? ' Active' : '') +
            '" type="button" data-social-username="' + String(User.username).replace(/"/g, '&quot;') + '">' +
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

async function SocialSearchUsers(Query) {
    const Status = SocialById("SocialSearchStatus");
    if (!Query) {
        SocialRenderUsers([]);
        if (Status) Status.textContent = "";
        return;
    }

    if (Status) Status.textContent = "Searching...";
    try {
        const Result = await ApiRequest("/api/social/search?q=" + encodeURIComponent(Query));
        const Users = Array.isArray(Result.users) ? Result.users : [];
        SocialRenderUsers(Users);
        if (Status) Status.textContent = Users.length + " result" + (Users.length === 1 ? "" : "s");
    } catch (Error) {
        if (Status) Status.textContent = Error.message || "Search failed.";
        SocialRenderUsers([]);
    }
}

function SocialAddMessage(Message) {
    if (!Message || !Message.id || SocialMessageIds.has(String(Message.id))) return;
    SocialMessageIds.add(String(Message.id));

    const Container = SocialById("SocialMessages");
    if (!Container) return;

    const Mine = String(Message.senderUsername || "").toLowerCase() === String(SocialCurrentUser?.username || "").toLowerCase();
    const Element = document.createElement("article");
    Element.className = "StorySocialMessage" + (Mine ? " Sent" : "");

    const Text = document.createElement("div");
    Text.className = "StorySocialMessageText";
    Text.textContent = String(Message.text || "");
    Element.appendChild(Text);

    const Time = document.createElement("div");
    Time.className = "StorySocialMessageTime";
    Time.textContent = SocialFormatTime(Message.sentAt);
    Element.appendChild(Time);

    Container.appendChild(Element);
    Container.scrollTop = Container.scrollHeight;
}

async function SocialLoadConversation() {
    if (!SocialSelectedUser) return;
    const Container = SocialById("SocialMessages");
    if (!Container) return;

    SocialMessageIds.clear();
    Container.innerHTML = '<div class="StorySocialEmpty">Loading messages...</div>';

    try {
        const Result = await ApiRequest(
            "/api/social/messages?username=" + encodeURIComponent(SocialSelectedUser.username) + "&limit=100"
        );
        Container.innerHTML = "";
        const Messages = Array.isArray(Result.messages) ? Result.messages : [];
        Messages.forEach(SocialAddMessage);
        if (!Messages.length) {
            Container.innerHTML = '<div class="StorySocialEmpty">No messages yet. Say hello.</div>';
        }
    } catch (Error) {
        Container.innerHTML = '<div class="StorySocialEmpty">' + String(Error.message || "Could not load chat.") + '</div>';
    }
}

async function SelectSocialUser(Username) {
    if (!Username) return;

    try {
        const Result = await ApiRequest("/api/social/profile?username=" + encodeURIComponent(Username));
        SocialSelectedUser = Result.user;
    } catch (Error) {
        SocialSetStatus(SocialById("SocialChatStatus"), Error.message || "Could not load that user.", "Bad");
        return;
    }

    SocialById("SocialChatEmpty").hidden = true;
    SocialById("SocialChatView").hidden = false;
    SocialById("SocialChatAvatar").textContent = SocialInitial(SocialSelectedUser.username);
    SocialById("SocialChatUsername").textContent = SocialSelectedUser.username;
    SocialById("SocialChatPresence").textContent = SocialPresenceLabel(SocialSelectedUser.presence);
    SocialById("SocialChatUserId").textContent = SocialSelectedUser.userId;
    SocialRenderStats(SocialSelectedUser);
    SocialSetStatus(SocialById("SocialChatStatus"), "");
    await SocialLoadConversation();
    SocialById("SocialMessageInput")?.focus();
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
        } else {
            const Result = await ApiRequest("/api/social/messages", {
                method: "POST",
                body: JSON.stringify({ username: SocialSelectedUser.username, message: Text })
            });
            if (!Result?.ok) throw new Error(Result?.error || "Could not send message.");
        }

        Input.value = "";
        SocialUpdateMessageCount();
        SocialSetStatus(SocialById("SocialChatStatus"), "");
    } catch (Error) {
        SocialSetStatus(SocialById("SocialChatStatus"), Error.message || "Could not send message.", "Bad");
    } finally {
        if (Button) Button.disabled = false;
    }
}

function SocialUpdateMessageCount() {
    const Input = SocialById("SocialMessageInput");
    const Count = SocialById("SocialMessageCount");
    if (!Input || !Count) return;
    Count.textContent = String(Input.value.length) + " / " + SOCIAL_MAX_MESSAGE_LENGTH;
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
        if (!Selected || !((Sender === Selected && Recipient === Me) || (Sender === Me && Recipient === Selected))) return;
        SocialAddMessage(Message);
    });

    SocialSocket.on("social:presence", function(Payload) {
        const Username = String(Payload?.username || "").toLowerCase();
        if (!Username) return;
        if (SocialSelectedUser && Username === String(SocialSelectedUser.username || "").toLowerCase()) {
            SocialSelectedUser.presence = Payload.presence || "offline";
            SocialById("SocialChatPresence").textContent = SocialPresenceLabel(SocialSelectedUser.presence);
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

    SocialById("SocialSettingsButton")?.addEventListener("click", SocialOpenSettings);
    Input?.addEventListener("input", function() {
        clearTimeout(SocialSearchTimer);
        SocialSearchTimer = setTimeout(function() {
            SocialSearchUsers(Input.value.trim());
        }, 220);
    });
    MessageInput?.addEventListener("input", SocialUpdateMessageCount);
    Form?.addEventListener("submit", SocialSendMessage);

    try {
        await Promise.all([RequireAccount(), SocialLoadCurrentUser(), SocialEnsureSocket()]);
    } catch (Error) {
        SocialSetStatus(SocialById("SocialChatStatus"), Error.message || "Could not connect to Social.", "Bad");
    }
});
