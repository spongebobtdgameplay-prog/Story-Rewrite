let ModerationV20Socket = null;
let ModerationV20SelectedUser = "";
let ModerationV20SoundTimes = new Map();

const ModerationDurations = [
    ["1 minute", 60000],
    ["5 minutes", 300000],
    ["10 minutes", 600000],
    ["30 minutes", 1800000],
    ["1 hour", 3600000],
    ["6 hours", 21600000],
    ["1 day", 86400000],
    ["7 days", 604800000]
];

function ModerationV20Escape(Value) {
    return String(Value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function ModerationV20DurationLabel(Until) {
    if (Until === Infinity) return "Permanent";
    const Remaining = Math.max(0, Number(Until || 0) - Date.now());
    if (!Remaining) return "None";
    const Minutes = Math.ceil(Remaining / 60000);
    if (Minutes < 60) return `${Minutes}m remaining`;
    const Hours = Math.ceil(Minutes / 60);
    if (Hours < 24) return `${Hours}h remaining`;
    return `${Math.ceil(Hours / 24)}d remaining`;
}

function EnsureModerationV20Styles() {
    if (document.getElementById("ModerationV20Styles")) return;
    const Style = document.createElement("style");
    Style.id = "ModerationV20Styles";
    Style.textContent = `
.ModerationV20Button{border:1px solid rgba(176,139,87,.52);background:rgba(61,45,31,.75);color:#f4dfbc;border-radius:8px;padding:7px 10px;font:700 12px Georgia,serif;cursor:pointer}.ModerationV20Button:hover{background:rgba(97,67,38,.9)}
.ModerationV20Backdrop{position:fixed;inset:0;z-index:100000;background:rgba(8,6,4,.76);display:grid;place-items:center;padding:18px;backdrop-filter:blur(6px)}.ModerationV20Backdrop.Hidden{display:none}
.ModerationV20Card{width:min(620px,100%);max-height:min(760px,92vh);overflow:auto;background:linear-gradient(180deg,#271d16,#17110d);border:1px solid rgba(201,164,108,.55);box-shadow:0 24px 80px rgba(0,0,0,.55);border-radius:16px;padding:22px;color:#f4e7cf}
.ModerationV20Top{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:18px}.ModerationV20Top h2{margin:3px 0 0;font-size:26px}.ModerationV20Close{border:0;background:transparent;color:#d9c4a3;font-size:28px;cursor:pointer}
.ModerationV20Section{border-top:1px solid rgba(201,164,108,.18);padding-top:16px;margin-top:16px}.ModerationV20Section h3{margin:0 0 6px}.ModerationV20State{font-size:13px;color:#cbb99d;margin-bottom:12px;line-height:1.45}.ModerationV20Grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.ModerationV20Field{display:grid;gap:6px;margin:10px 0}.ModerationV20Field select,.ModerationV20Field input{width:100%;box-sizing:border-box;background:#120e0b;color:#f4e7cf;border:1px solid rgba(201,164,108,.35);border-radius:9px;padding:10px}.ModerationV20Actions{display:flex;flex-wrap:wrap;gap:8px}.ModerationV20Primary,.ModerationV20Danger,.ModerationV20Secondary{border-radius:9px;padding:9px 12px;font-weight:800;cursor:pointer}.ModerationV20Primary{background:#8a6038;color:#fff3df;border:1px solid #bb8753}.ModerationV20Secondary{background:#2b241e;color:#ead7bb;border:1px solid #65523e}.ModerationV20Danger{background:#6b2825;color:#ffe8e4;border:1px solid #a54a43}
.ModerationV20Notice{position:fixed;right:18px;bottom:18px;z-index:100001;width:min(440px,calc(100vw - 36px));background:#241a14;color:#f5e5cd;border:1px solid rgba(199,153,91,.55);border-radius:12px;padding:14px 16px;box-shadow:0 16px 50px rgba(0,0,0,.45);animation:ModerationV20In .18s ease-out}.ModerationV20Notice strong{display:block;margin-bottom:4px}.ModerationV20Notice.Error{border-color:#9b4740}.ModerationV20KickDetails{margin:12px 0 0;padding-left:20px;color:#d8c6aa}@keyframes ModerationV20In{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@media(max-width:600px){.ModerationV20Grid{grid-template-columns:1fr}.ModerationV20Card{padding:17px}}
`;
    document.head.appendChild(Style);
}

function EnsureModerationV20Modal() {
    EnsureModerationV20Styles();
    let Backdrop = document.getElementById("ModerationV20Backdrop");
    if (Backdrop) return Backdrop;
    Backdrop = document.createElement("div");
    Backdrop.id = "ModerationV20Backdrop";
    Backdrop.className = "ModerationV20Backdrop Hidden";
    Backdrop.innerHTML = `
        <div class="ModerationV20Card" role="dialog" aria-modal="true" aria-labelledby="ModerationV20Title">
            <div class="ModerationV20Top"><div><div class="Kicker">Host moderation</div><h2 id="ModerationV20Title">Player</h2></div><button class="ModerationV20Close" id="ModerationV20Close" type="button">×</button></div>
            <div id="ModerationV20Body"></div>
        </div>`;
    document.body.appendChild(Backdrop);
    document.getElementById("ModerationV20Close")?.addEventListener("click", CloseModerationV20);
    Backdrop.addEventListener("click", Event => {
        if (Event.target === Backdrop) CloseModerationV20();
    });
    return Backdrop;
}

function GetModerationV20Player(Username) {
    return MultiplayerState?.players?.find?.(Player => Player.username === Username) || null;
}

function OpenModerationV20(Username) {
    const Player = GetModerationV20Player(Username);
    if (!Player || !IsLocalHost?.()) return;
    ModerationV20SelectedUser = Username;
    const Backdrop = EnsureModerationV20Modal();
    const Moderation = Player.moderation || {};
    document.getElementById("ModerationV20Title").textContent = Username;
    const Body = document.getElementById("ModerationV20Body");
    Body.innerHTML = `
        <div class="ModerationV20Section" style="border-top:0;padding-top:0;margin-top:0">
            <h3>Chat timeout</h3>
            <div class="ModerationV20State">${Moderation.chatTimedOut ? `<strong>Active:</strong> ${ModerationV20Escape(ModerationV20DurationLabel(Moderation.chatTimeoutUntil))}<br><strong>Issued by:</strong> ${ModerationV20Escape(Moderation.chatTimeoutIssuedBy || "host")}<br><strong>Reason:</strong> ${ModerationV20Escape(Moderation.chatTimeoutReason || "Chat timeout")}` : "This player can currently use chat."}</div>
            <div class="ModerationV20Grid"><label class="ModerationV20Field"><span>Time</span><select id="ModerationV20ChatDuration">${ModerationDurations.map(([Label, Value]) => `<option value="${Value}"${Value === 600000 ? " selected" : ""}>${Label}</option>`).join("")}</select></label><label class="ModerationV20Field"><span>Reason</span><input id="ModerationV20ChatReason" maxlength="180" value="Repeated abusive behavior" autocomplete="off"></label></div>
            <div class="ModerationV20Actions"><button class="ModerationV20Primary" id="ModerationV20ChatTimeout" type="button">Timeout Chat</button>${Moderation.chatTimedOut ? '<button class="ModerationV20Secondary" id="ModerationV20ChatUntimeout" type="button">Remove Timeout</button>' : ""}</div>
        </div>
        <div class="ModerationV20Section">
            <h3>Joining games you host</h3>
            <div class="ModerationV20State">${Moderation.gameBanned ? `<strong>Banned from your hosted games.</strong><br>${ModerationV20Escape(Moderation.gameReason || "Host ban")}` : Moderation.gameTimedOut ? `<strong>Timed out:</strong> ${ModerationV20Escape(ModerationV20DurationLabel(Moderation.gameTimeoutUntil))}<br>${ModerationV20Escape(Moderation.gameReason || "Game timeout")}` : "This player can currently join games you host."}</div>
            <div class="ModerationV20Grid"><label class="ModerationV20Field"><span>Time</span><select id="ModerationV20GameDuration">${ModerationDurations.map(([Label, Value]) => `<option value="${Value}"${Value === 3600000 ? " selected" : ""}>${Label}</option>`).join("")}</select></label><label class="ModerationV20Field"><span>Reason</span><input id="ModerationV20GameReason" maxlength="180" value="Repeated disruptive behavior" autocomplete="off"></label></div>
            <div class="ModerationV20Actions"><button class="ModerationV20Primary" id="ModerationV20GameTimeout" type="button">Timeout From My Games</button>${Moderation.gameTimedOut ? '<button class="ModerationV20Secondary" id="ModerationV20GameUntimeout" type="button">Remove Game Timeout</button>' : ""}${Moderation.gameBanned ? '<button class="ModerationV20Secondary" id="ModerationV20GameUnban" type="button">Unban</button>' : '<button class="ModerationV20Danger" id="ModerationV20GameBan" type="button">Ban From My Games</button>'}</div>
        </div>
        <div class="ModerationV20Section"><h3>Current room</h3><div class="ModerationV20Actions"><button class="ModerationV20Danger" id="ModerationV20Kick" type="button">Kick With Reason</button></div></div>`;
    Backdrop.classList.remove("Hidden");
    document.getElementById("ModerationV20ChatTimeout")?.addEventListener("click", () => ApplyModerationV20("host:chatTimeout", Number(document.getElementById("ModerationV20ChatDuration")?.value), document.getElementById("ModerationV20ChatReason")?.value));
    document.getElementById("ModerationV20ChatUntimeout")?.addEventListener("click", () => ApplyModerationV20("host:chatUntimeout"));
    document.getElementById("ModerationV20GameTimeout")?.addEventListener("click", () => ApplyModerationV20("host:gameTimeout", Number(document.getElementById("ModerationV20GameDuration")?.value), document.getElementById("ModerationV20GameReason")?.value));
    document.getElementById("ModerationV20GameUntimeout")?.addEventListener("click", () => ApplyModerationV20("host:gameUntimeout"));
    document.getElementById("ModerationV20GameBan")?.addEventListener("click", () => ApplyModerationV20("host:gameBan", 0, document.getElementById("ModerationV20GameReason")?.value));
    document.getElementById("ModerationV20GameUnban")?.addEventListener("click", () => ApplyModerationV20("host:gameUnban"));
    document.getElementById("ModerationV20Kick")?.addEventListener("click", KickModerationV20);
}

function CloseModerationV20() {
    document.getElementById("ModerationV20Backdrop")?.classList.add("Hidden");
    ModerationV20SelectedUser = "";
}

async function ApplyModerationV20(EventName, DurationMs = 0, Reason = "") {
    if (!ModerationV20SelectedUser) return;
    const Result = await HostEmit(EventName, { username: ModerationV20SelectedUser, durationMs: DurationMs, reason: String(Reason || "").trim() });
    if (!Result?.ok) {
        ShowModerationV20Notice("Could not apply moderation", Result?.error || "The server rejected that action.", true);
        return;
    }
    ShowModerationV20Notice("Moderation updated", `${ModerationV20SelectedUser}'s moderation settings were changed.`);
    setTimeout(() => {
        if (ModerationV20SelectedUser) OpenModerationV20(ModerationV20SelectedUser);
    }, 120);
}

async function KickModerationV20() {
    const Username = ModerationV20SelectedUser;
    if (!Username) return;
    const Reason = String(document.getElementById("ModerationV20GameReason")?.value || "Repeated disruptive behavior").trim() || "Repeated disruptive behavior";
    const Result = await HostEmit("host:kick", { username: Username, reason });
    if (!Result?.ok) ShowModerationV20Notice("Could not kick player", Result?.error || "The server rejected that action.", true);
    else {
        ShowModerationV20Notice("Player removed", `${Username} was removed and shown the reason.`);
        CloseModerationV20();
    }
}

function DecorateModerationV20Rows() {
    if (typeof IsLocalHost !== "function" || !IsLocalHost()) return;
    for (const Row of document.querySelectorAll(".HostPlayerRow")) {
        if (Row.querySelector(".ModerationV20Button")) continue;
        const Existing = Row.querySelector("[data-host-kick],[data-host-mute]");
        const Username = Existing?.dataset?.hostKick || Existing?.dataset?.hostMute || "";
        if (!Username) continue;
        const Actions = Row.querySelector(".HostMiniActions") || Row;
        const Button = document.createElement("button");
        Button.className = "ModerationV20Button";
        Button.type = "button";
        Button.textContent = "Moderate";
        Button.addEventListener("click", () => OpenModerationV20(Username));
        Actions.prepend(Button);
    }
}

function ShowModerationV20Notice(Title, Message, Error = false, Details = []) {
    EnsureModerationV20Styles();
    const Notice = document.createElement("div");
    Notice.className = `ModerationV20Notice${Error ? " Error" : ""}`;
    Notice.innerHTML = `<strong>${ModerationV20Escape(Title)}</strong><div>${ModerationV20Escape(Message)}</div>${Details.length ? `<ul class="ModerationV20KickDetails">${Details.map(Item => `<li>${ModerationV20Escape(Item)}</li>`).join("")}</ul>` : ""}`;
    document.body.appendChild(Notice);
    setTimeout(() => Notice.remove(), 9000);
}

function BindModerationV20Socket(Socket) {
    if (!Socket || Socket === ModerationV20Socket) return;
    ModerationV20Socket = Socket;
    Socket.on("room:moderationResult", Payload => {
        const Strikes = Number(Payload?.strikes || 0);
        if (Payload?.kicked) return;
        if (Payload?.timedOut) {
            ShowModerationV20Notice(
                "Automatic chat timeout",
                Payload?.reason || "Three confirmed abuse warnings were reached.",
                true,
                [`Warnings: ${Strikes}/3`, "The host can remove this timeout early."]
            );
        }
    });
    Socket.on("room:chatTimeoutState", Payload => {
        const IssuedBy = String(Payload?.issuedBy || "");
        const Automatic = IssuedBy.toLowerCase() === "automatic moderation";
        const Title = Payload?.active
            ? (Automatic ? "Chat banned by game" : "Chat banned by host")
            : "Chat restored";

        ShowModerationV20Notice(
            Title,
            Payload?.reason || (Payload?.active ? "You cannot use room chat right now." : "You can use room chat again."),
            Boolean(Payload?.active)
        );
    });
    Socket.on("room:gameRestrictionState", Payload => {
        ShowModerationV20Notice(Payload?.active ? "Host game restriction" : "Game restriction removed", Payload?.reason || "Your host game restriction changed.", Boolean(Payload?.active));
    });
    Socket.on("room:kicked", Payload => {
        if (!Payload?.moderation) return;
        ShowModerationV20Notice(Payload?.title || "Removed from game", Payload?.reason || "You were removed by the host.", true, Array.isArray(Payload?.details) ? Payload.details : []);
    });
    Socket.on("room:state", () => requestAnimationFrame(DecorateModerationV20Rows));
}

function InstallModerationV20SoundGuard() {
    const Audio = window.StoryAudio;
    if (!Audio || typeof Audio.PlaySound !== "function" || Audio.PlaySound.__ModerationV20Guard) return;
    const BasePlaySound = Audio.PlaySound.bind(Audio);
    const Guarded = function(Name, ...Args) {
        const Key = String(Name || "sound");
        const Now = performance.now();
        const Last = ModerationV20SoundTimes.get(Key) || 0;
        const MinimumDelay = Key === "message" ? 160 : 120;
        if (Now - Last < MinimumDelay) return null;
        ModerationV20SoundTimes.set(Key, Now);
        return BasePlaySound(Name, ...Args);
    };
    Guarded.__ModerationV20Guard = true;
    Audio.PlaySound = Guarded;
}

const ModerationV20Observer = new MutationObserver(() => {
    DecorateModerationV20Rows();
    InstallModerationV20SoundGuard();
});

function StartModerationV20() {
    EnsureModerationV20Modal();
    InstallModerationV20SoundGuard();
    DecorateModerationV20Rows();
    ModerationV20Observer.observe(document.body, { childList: true, subtree: true });
    if (window.MultiplayerSocket) BindModerationV20Socket(window.MultiplayerSocket);
    const SocketWait = setInterval(() => {
        InstallModerationV20SoundGuard();
        if (window.MultiplayerSocket) BindModerationV20Socket(window.MultiplayerSocket);
    }, 500);
    setTimeout(() => clearInterval(SocketWait), 30000);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", StartModerationV20, { once: true });
else StartModerationV20();
