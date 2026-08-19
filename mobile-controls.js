const MOBILE_MAP_ICON = `
<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 5.5 9 3l6 2 5-2v15.5L15 21l-6-2-5 2V5.5Z"></path>
    <path d="M9 3v16M15 5v16"></path>
</svg>`;

const MOBILE_RESTORE_ICON = `
<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5.3 8.2A8 8 0 1 1 4.7 15"></path>
    <path d="M5.3 4.5v3.7H9"></path>
</svg>`;

const MOBILE_CHECK_ICON = `
<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 3.5 19 6v5.2c0 4.5-2.6 7.7-7 9.3-4.4-1.6-7-4.8-7-9.3V6l7-2.5Z"></path>
    <path d="m8.7 12 2.1 2.1 4.7-4.8"></path>
</svg>`;

const MOBILE_CHAT_ICON = `
<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4.5 5.5h15v11h-9l-5.5 3v-3h-.5v-11Z"></path>
    <path d="M8 9h8M8 12h5"></path>
</svg>`;

function MobileHaptic(Duration = 10) {
    try {
        if (navigator.vibrate) navigator.vibrate(Duration);
    } catch {}
}

function MobilePressDesktopButton(Id) {
    const Button = document.getElementById(Id);
    if (!Button || Button.disabled) return;
    MobileHaptic();
    Button.click();
}

function BuildMobileControlButton({ Id, Label, Icon, Primary = false, Badge = false }) {
    const Button = document.createElement("button");
    Button.id = Id;
    Button.type = "button";
    Button.className = `MobileControlButton${Primary ? " Primary" : ""}`;
    Button.setAttribute("aria-label", Label);
    Button.innerHTML = `
        <span class="MobileControlIcon">
            ${Icon}
            ${Badge ? '<span class="MobileControlBadge" id="MobileChatUnread">0</span>' : ""}
        </span>
        <span class="MobileControlLabel">${Label}</span>
    `;
    return Button;
}

function EnsureMobileControls() {
    if (document.getElementById("MobileGameControls")) return;

    const Controls = document.createElement("nav");
    Controls.id = "MobileGameControls";
    Controls.className = "MobileGameControls";
    Controls.setAttribute("aria-label", "Mobile game controls");

    const MapButton = BuildMobileControlButton({
        Id: "MobileMapButton",
        Label: "Map",
        Icon: MOBILE_MAP_ICON
    });

    const RestoreButton = BuildMobileControlButton({
        Id: "MobileRestoreButton",
        Label: "Restore",
        Icon: MOBILE_RESTORE_ICON
    });

    const CheckButton = BuildMobileControlButton({
        Id: "MobileCheckButton",
        Label: "Check",
        Icon: MOBILE_CHECK_ICON,
        Primary: true
    });

    const ChatButton = BuildMobileControlButton({
        Id: "MobileChatButton",
        Label: "Chat",
        Icon: MOBILE_CHAT_ICON,
        Badge: true
    });

    Controls.append(MapButton, RestoreButton, CheckButton, ChatButton);
    document.body.appendChild(Controls);

    MapButton.addEventListener("click", () => MobilePressDesktopButton("BackButton"));
    RestoreButton.addEventListener("click", () => MobilePressDesktopButton("RestoreButton"));
    CheckButton.addEventListener("click", () => MobilePressDesktopButton("CheckButton"));
    ChatButton.addEventListener("click", () => {
        MobileHaptic();
        document.getElementById("ToggleGameChatButton")?.click();
        requestAnimationFrame(SyncMobileControls);
    });
}

function SyncMobileControls() {
    const Controls = document.getElementById("MobileGameControls");
    if (!Controls) return;

    const CheckSource = document.getElementById("CheckButton");
    const RestoreSource = document.getElementById("RestoreButton");
    const MapSource = document.getElementById("BackButton");
    const CheckButton = document.getElementById("MobileCheckButton");
    const RestoreButton = document.getElementById("MobileRestoreButton");
    const MapButton = document.getElementById("MobileMapButton");
    const ChatButton = document.getElementById("MobileChatButton");
    const Dock = document.getElementById("MultiplayerDock");
    const RoomParam = new URLSearchParams(window.location.search).get("room");
    const HasChat = Boolean(RoomParam) && Dock && !Dock.classList.contains("Hidden");

    if (CheckButton) CheckButton.disabled = Boolean(CheckSource?.disabled);
    if (RestoreButton) RestoreButton.disabled = Boolean(RestoreSource?.disabled);
    if (MapButton) MapButton.disabled = Boolean(MapSource?.disabled);

    Controls.classList.toggle("HasChat", HasChat);
    ChatButton?.classList.toggle("IsHidden", !HasChat);

    if (ChatButton && Dock) {
        const Expanded = !Dock.classList.contains("IsCollapsed");
        ChatButton.setAttribute("aria-pressed", String(Expanded));
        ChatButton.setAttribute("aria-label", Expanded ? "Hide chat" : "Show chat");
    }

    const SourceUnread = document.getElementById("GameChatUnread");
    const MobileUnread = document.getElementById("MobileChatUnread");

    if (MobileUnread) {
        const Count = Number(SourceUnread?.textContent || 0);
        MobileUnread.textContent = Count > 99 ? "99+" : String(Count);
        MobileUnread.classList.toggle("HasUnread", Count > 0 || Boolean(SourceUnread?.classList.contains("HasUnread")));
    }
}

function WireMobileTypingState() {
    document.addEventListener("focusin", Event => {
        if (Event.target instanceof HTMLInputElement || Event.target instanceof HTMLTextAreaElement) {
            document.body.classList.add("MobileTyping");
        }
    });

    document.addEventListener("focusout", Event => {
        if (!(Event.target instanceof HTMLInputElement || Event.target instanceof HTMLTextAreaElement)) return;
        setTimeout(() => {
            const Active = document.activeElement;
            if (!(Active instanceof HTMLInputElement || Active instanceof HTMLTextAreaElement)) {
                document.body.classList.remove("MobileTyping");
            }
        }, 60);
    });
}

function WatchMobileControlState() {
    const Observer = new MutationObserver(SyncMobileControls);

    for (const Id of ["CheckButton", "RestoreButton", "BackButton", "MultiplayerDock", "GameChatUnread"]) {
        const Element = document.getElementById(Id);
        if (!Element) continue;
        Observer.observe(Element, {
            attributes: true,
            childList: true,
            characterData: true,
            subtree: true,
            attributeFilter: ["class", "disabled"]
        });
    }

    window.addEventListener("resize", SyncMobileControls, { passive: true });
    window.addEventListener("orientationchange", SyncMobileControls, { passive: true });
}

function InitializeMobileControls() {
    EnsureMobileControls();
    WireMobileTypingState();
    WatchMobileControlState();
    SyncMobileControls();

    setTimeout(SyncMobileControls, 500);
    setTimeout(SyncMobileControls, 1500);
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", InitializeMobileControls, { once: true });
} else {
    InitializeMobileControls();
}
