const STORY_FRONTEND_VERSION = "v2.68";
const STORY_BACK_ICON = `
<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M14.5 5 7.5 12l7 7" />
</svg>`;

const STORY_ACCOUNT_ICON = `
<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5.5 20c.7-4 3-6 6.5-6s5.8 2 6.5 6" />
</svg>`;

const STORY_EYE_OPEN_ICON = `
<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M2.5 12s3.7-5.5 9.5-5.5S21.5 12 21.5 12 17.8 17.5 12 17.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="2.7" />
</svg>`;

const STORY_EYE_CLOSED_ICON = `
<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M3 4 21 20" />
    <path d="M6.2 7.1C4 8.5 2.5 12 2.5 12S6.2 17.5 12 17.5c1.6 0 3-.4 4.2-1" />
    <path d="M9.7 6.8c.7-.2 1.5-.3 2.3-.3 5.8 0 9.5 5.5 9.5 5.5s-.8 1.2-2.2 2.5" />
</svg>`;

const STORY_WARNING_ICON = `
<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M12 3.5 21 19H3L12 3.5Z" />
    <path d="M12 8.5v5.2" />
    <path d="M12 17.1h.01" />
</svg>`;

let StoryConfirmCloser = null;
let StoryLinkObserver = null;
let StoryNavigationPending = false;
let StoryNavigationUnlockTimer = 0;
let StoryNavigationActivationTarget = null;
const StoryNavigationLocks = new Map();

function EnsureStoryNavigationStyles() {
    if (document.getElementById("StoryNavigationLoadingStyles")) return;
    const Style = document.createElement("style");
    Style.id = "StoryNavigationLoadingStyles";
    Style.textContent = `
        .StoryNavigationLoading {
            cursor: progress !important;
            opacity: .78 !important;
            pointer-events: none !important;
        }
        .StoryNavigationSpinner {
            display: inline-block;
            width: .78em;
            height: .78em;
            box-sizing: border-box;
            margin-inline-start: .55em;
            border: 2px solid currentColor;
            border-right-color: transparent;
            border-radius: 50%;
            vertical-align: -.12em;
            flex: 0 0 auto;
            animation: StoryNavigationSpin .68s linear infinite;
        }
        @keyframes StoryNavigationSpin {
            to { transform: rotate(360deg); }
        }
        @media (prefers-reduced-motion: reduce) {
            .StoryNavigationSpinner { animation-duration: 1.8s; }
        }
    `;
    document.head.appendChild(Style);
}

function ResolveStoryNavigationTrigger(Trigger = null) {
    if (Trigger && Trigger.nodeType === 1) return Trigger;
    if (StoryNavigationActivationTarget?.isConnected) return StoryNavigationActivationTarget;
    const Active = document.activeElement;
    if (
        Active instanceof HTMLButtonElement ||
        Active instanceof HTMLAnchorElement ||
        (Active instanceof HTMLElement && Active.getAttribute("role") === "button")
    ) return Active;
    return null;
}

function StoryLockNavigationButton(Trigger = null) {
    Trigger = ResolveStoryNavigationTrigger(Trigger);
    if (!Trigger) return !StoryNavigationPending;
    if (StoryNavigationLocks.has(Trigger)) return true;
    if (StoryNavigationPending) return false;
    if (Trigger instanceof HTMLButtonElement && Trigger.disabled) return false;

    const State = {
        disabled: Trigger instanceof HTMLButtonElement ? Trigger.disabled : null,
        ariaBusy: Trigger.getAttribute("aria-busy"),
        ariaDisabled: Trigger.getAttribute("aria-disabled")
    };
    StoryNavigationLocks.set(Trigger, State);
    Trigger.classList.add("StoryNavigationLoading");
    Trigger.setAttribute("aria-busy", "true");
    Trigger.setAttribute("aria-disabled", "true");
    if (Trigger instanceof HTMLButtonElement) Trigger.disabled = true;

    if (!Trigger.querySelector(":scope > .StoryNavigationSpinner")) {
        const Spinner = document.createElement("span");
        Spinner.className = "StoryNavigationSpinner";
        Spinner.setAttribute("aria-hidden", "true");
        Trigger.appendChild(Spinner);
    }
    return true;
}

function ClearStoryNavigationLock() {
    StoryNavigationPending = false;
    if (StoryNavigationUnlockTimer) {
        clearTimeout(StoryNavigationUnlockTimer);
        StoryNavigationUnlockTimer = 0;
    }
    for (const [Trigger, State] of StoryNavigationLocks) {
        Trigger.querySelector(":scope > .StoryNavigationSpinner")?.remove();
        Trigger.classList.remove("StoryNavigationLoading");
        if (State.ariaBusy === null) Trigger.removeAttribute("aria-busy");
        else Trigger.setAttribute("aria-busy", State.ariaBusy);
        if (State.ariaDisabled === null) Trigger.removeAttribute("aria-disabled");
        else Trigger.setAttribute("aria-disabled", State.ariaDisabled);
        if (Trigger instanceof HTMLButtonElement && State.disabled !== null) {
            Trigger.disabled = State.disabled;
        }
        StoryNavigationLocks.delete(Trigger);
    }
}

function StoryBeginNavigation(Trigger = null) {
    Trigger = ResolveStoryNavigationTrigger(Trigger);
    if (StoryNavigationPending) return false;
    if (Trigger && !StoryLockNavigationButton(Trigger)) return false;
    StoryNavigationPending = true;
    StoryNavigationUnlockTimer = window.setTimeout(ClearStoryNavigationLock, 15000);
    return true;
}

// Remember the control that initiated this click for handlers that call
// StoryNavigate() without explicitly passing their button (notably Firefox,
// where a pointer click does not always focus the button).
document.addEventListener("click", Event => {
    const Target = Event.target?.closest?.(
        "button,a[href],[role='button'],input[type='button'],input[type='submit'],summary,[data-story-go],[data-story-back]"
    );
    if (!Target) return;
    StoryNavigationActivationTarget = Target;
    Promise.resolve().then(() => {
        if (StoryNavigationActivationTarget === Target) StoryNavigationActivationTarget = null;
    });
}, true);

window.StoryLockNavigationButton = StoryLockNavigationButton;
window.StoryBeginNavigation = StoryBeginNavigation;
window.StoryClearNavigationLock = ClearStoryNavigationLock;
window.addEventListener("StoryShellDeactivate", ClearStoryNavigationLock);
window.addEventListener("StoryShellActivate", ClearStoryNavigationLock);

function StoryNavigate(Page, Trigger = null) {
    const Requested = String(Page || "").trim();
    if (!Requested) return false;

    try {
        const Target = new URL(Requested, window.location.href);
        const Current = new URL(window.location.href);
        if (
            Target.origin === Current.origin &&
            Target.pathname === Current.pathname &&
            Target.search === Current.search &&
            Target.hash === Current.hash
        ) return false;
    } catch {}

    if (!StoryBeginNavigation(Trigger)) return false;

    try {
        const Shell = window.parent !== window && window.parent.StoryShell?.IsPersistentShell
            ? window.parent.StoryShell
            : null;
        if (
            Shell &&
            typeof Shell.Navigate === "function" &&
            typeof Shell.CanHandle === "function" &&
            Shell.CanHandle(Requested) &&
            Shell.Navigate(Requested)
        ) return true;
    } catch {}

    window.location.href = typeof BuildStoryUrl === "function"
        ? BuildStoryUrl(Requested)
        : Requested.replace(/^\/+/, "");
    return true;
}

function StoryGoBack(FallbackPage = "main.html", Trigger = null) {
    try {
        if (window.parent !== window && window.parent.StoryShell?.IsPersistentShell) {
            if (!StoryBeginNavigation(Trigger)) return;
            window.parent.StoryShell.Back(FallbackPage);
            return;
        }
    } catch {}

    let CanUseHistory = false;

    try {
        const Referrer = document.referrer ? new URL(document.referrer) : null;
        CanUseHistory = Boolean(
            Referrer &&
            Referrer.origin === window.location.origin &&
            window.history.length > 1
        );
    } catch {}

    if (CanUseHistory) {
        if (!StoryBeginNavigation(Trigger)) return;
        window.history.back();
        return;
    }

    StoryNavigate(FallbackPage, Trigger);
}

function MakeStoryAnchorLinkless(Link) {
    if (!(Link instanceof HTMLAnchorElement) || Link.dataset.storyLinkless === "1") return;
    const RawHref = Link.getAttribute("href");
    if (!RawHref || RawHref.startsWith("#") || RawHref.startsWith("javascript:")) return;

    let TargetUrl;
    try {
        TargetUrl = new URL(RawHref, window.location.href);
    } catch {
        return;
    }

    Link.dataset.storyLinkless = "1";
    Link.dataset.storyLinkTarget = TargetUrl.href;
    Link.removeAttribute("href");
    Link.removeAttribute("target");
    Link.setAttribute("role", "button");
    if (!Link.hasAttribute("tabindex")) Link.tabIndex = 0;
    Link.draggable = false;
    Link.style.webkitTouchCallout = "none";

    const Activate = Event => {
        Event.preventDefault();
        const Target = Link.dataset.storyLinkTarget;
        if (!Target) return;
        StoryNavigate(Target, Link);
    };

    Link.addEventListener("click", Activate);
    Link.addEventListener("keydown", Event => {
        if (Event.key !== "Enter" && Event.key !== " ") return;
        Activate(Event);
    });
    Link.addEventListener("contextmenu", Event => Event.preventDefault());
    Link.addEventListener("dragstart", Event => Event.preventDefault());
}

function WireLinklessAnchors(Root = document) {
    if (Root instanceof HTMLAnchorElement) MakeStoryAnchorLinkless(Root);
    Root.querySelectorAll?.("a[href]").forEach(MakeStoryAnchorLinkless);
}

function WatchForStoryLinks() {
    WireLinklessAnchors(document);
    if (StoryLinkObserver || !("MutationObserver" in window)) return;

    StoryLinkObserver = new MutationObserver(Mutations => {
        for (const Mutation of Mutations) {
            for (const Node of Mutation.addedNodes) {
                if (Node.nodeType === Node.ELEMENT_NODE) WireLinklessAnchors(Node);
            }
        }
    });

    StoryLinkObserver.observe(document.documentElement, { childList: true, subtree: true });
}

function StoryConfirm(Options = {}) {
    if (StoryConfirmCloser) StoryConfirmCloser(false);

    const Title = String(Options.title || "Are you sure?");
    const Message = String(Options.message || "This action may change your game.");
    const ConfirmText = String(Options.confirmText || "Continue");
    const CancelText = String(Options.cancelText || "Cancel");
    const Danger = Boolean(Options.danger);
    const RememberKey = String(Options.rememberKey || "");
    const RememberLabel = String(Options.rememberLabel || "");

    if (RememberKey) {
        try {
            if (localStorage.getItem(RememberKey) === "1") return Promise.resolve(true);
        } catch {}
    }

    const PreviousFocus = document.activeElement;

    return new Promise(Resolve => {
        const Overlay = document.createElement("div");
        Overlay.className = "StoryWarningOverlay";
        Overlay.setAttribute("role", "presentation");

        const Dialog = document.createElement("div");
        Dialog.className = `StoryWarningDialog${Danger ? " IsDanger" : ""}`;
        Dialog.setAttribute("role", "alertdialog");
        Dialog.setAttribute("aria-modal", "true");
        Dialog.setAttribute("aria-labelledby", "StoryWarningTitle");
        Dialog.setAttribute("aria-describedby", "StoryWarningMessage");

        const Icon = document.createElement("div");
        Icon.className = "StoryWarningIcon";
        Icon.innerHTML = STORY_WARNING_ICON;

        const Copy = document.createElement("div");
        Copy.className = "StoryWarningCopy";

        const Kicker = document.createElement("div");
        Kicker.className = "StoryWarningKicker";
        Kicker.textContent = Danger ? "Permanent action" : "Confirmation";

        const Heading = document.createElement("h2");
        Heading.id = "StoryWarningTitle";
        Heading.textContent = Title;

        const Description = document.createElement("p");
        Description.id = "StoryWarningMessage";
        Description.textContent = Message;

        let RememberInput = null;
        let RememberRow = null;

        if (RememberKey && RememberLabel) {
            RememberRow = document.createElement("label");
            RememberRow.className = "StoryWarningRemember";

            RememberInput = document.createElement("input");
            RememberInput.type = "checkbox";

            const RememberText = document.createElement("span");
            RememberText.textContent = RememberLabel;

            RememberRow.append(RememberInput, RememberText);
        }

        const Actions = document.createElement("div");
        Actions.className = "StoryWarningActions";

        const CancelButton = document.createElement("button");
        CancelButton.className = "StoryWarningCancel";
        CancelButton.type = "button";
        CancelButton.textContent = CancelText;

        const ConfirmButton = document.createElement("button");
        ConfirmButton.className = Danger ? "StoryWarningConfirm Danger" : "StoryWarningConfirm";
        ConfirmButton.type = "button";
        ConfirmButton.textContent = ConfirmText;

        Copy.append(Kicker, Heading, Description);
        if (RememberRow) Copy.appendChild(RememberRow);
        Actions.append(CancelButton, ConfirmButton);
        Dialog.append(Icon, Copy, Actions);
        Overlay.appendChild(Dialog);
        document.body.appendChild(Overlay);
        document.body.classList.add("StoryWarningOpen");

        let Settled = false;

        const Finish = Result => {
            if (Settled) return;
            Settled = true;

            if (Result && RememberInput?.checked && RememberKey) {
                try { localStorage.setItem(RememberKey, "1"); } catch {}
            }

            StoryConfirmCloser = null;
            document.removeEventListener("keydown", OnKeyDown, true);
            Overlay.classList.add("IsClosing");
            document.body.classList.remove("StoryWarningOpen");
            setTimeout(() => Overlay.remove(), 130);

            if (PreviousFocus && typeof PreviousFocus.focus === "function") {
                setTimeout(() => PreviousFocus.focus(), 140);
            }

            Resolve(Result);
        };

        const OnKeyDown = Event => {
            if (Event.key === "Escape") {
                Event.preventDefault();
                Finish(false);
                return;
            }

            if (Event.key === "Enter" && document.activeElement !== CancelButton) {
                Event.preventDefault();
                Finish(true);
            }
        };

        StoryConfirmCloser = Finish;
        document.addEventListener("keydown", OnKeyDown, true);
        CancelButton.addEventListener("click", () => Finish(false));
        ConfirmButton.addEventListener("click", () => Finish(true));
        Overlay.addEventListener("click", Event => {
            if (Event.target === Overlay) Finish(false);
        });

        requestAnimationFrame(() => Overlay.classList.add("IsOpen"));
        setTimeout(() => CancelButton.focus(), 40);
    });
}

function WireLeaveRoomWarning() {
}

function AddStoryVersionBadge() {
    if (document.querySelector(".StoryBuildVersion")) return;

    const Badge = document.createElement("span");
    Badge.className = "StoryBuildVersion";
    Badge.textContent = `Build ${STORY_FRONTEND_VERSION}`;
    Badge.title = "Loaded frontend version";

    const AccountTitle = document.querySelector("body.ProfilePage .AccountSettingsHeader h1");
    if (AccountTitle) {
        AccountTitle.appendChild(Badge);
        return;
    }

    const BrandTitle = document.querySelector(".TopBar .BrandTitle");
    if (BrandTitle) BrandTitle.appendChild(Badge);
}

function WireStoryShell() {
    EnsureStoryNavigationStyles();
    AddStoryVersionBadge();

    for (const Button of document.querySelectorAll("[data-story-back]")) {
        const IsMultiplayerStory = document.body.classList.contains("GamePage")
            && new URLSearchParams(window.location.search).has("room");

        if (IsMultiplayerStory) {
            Button.id = "MultiplayerStoryLeaveButton";
            Button.className = "SecondaryButton MultiplayerLeaveTopButton";
            Button.removeAttribute("data-story-back");
            Button.setAttribute("aria-label", "Leave to multiplayer lobby");
            Button.textContent = "Leave to Lobby";
            Button.addEventListener("click", () => {
                if (typeof LeaveMultiplayerStoryToLobby === "function") LeaveMultiplayerStoryToLobby();
            });
        } else {
            Button.innerHTML = STORY_BACK_ICON;
            Button.addEventListener("click", () => {
                const BackTarget = Button.dataset.storyBack || "main.html";

                if (document.body.classList.contains("GamePage") && typeof RequestLeaveCurrentLevel === "function") {
                    RequestLeaveCurrentLevel(BackTarget, Button);
                    return;
                }

                StoryGoBack(BackTarget, Button);
            });
        }

        Button.addEventListener("contextmenu", Event => Event.preventDefault());
    }

    for (const Button of document.querySelectorAll("[data-story-go]")) {
        Button.addEventListener("click", () => StoryNavigate(Button.dataset.storyGo, Button));
        Button.addEventListener("contextmenu", Event => Event.preventDefault());
    }

    for (const Button of document.querySelectorAll("[data-account-icon]")) {
        const Label = Button.querySelector("span")?.outerHTML || "";
        Button.innerHTML = `${STORY_ACCOUNT_ICON}${Label}`;
    }

    for (const Toggle of document.querySelectorAll("[data-password-toggle]")) {
        const Input = document.getElementById(Toggle.dataset.passwordToggle);
        if (!Input) continue;

        Toggle.innerHTML = STORY_EYE_OPEN_ICON;
        Toggle.setAttribute("aria-label", "Show password");

        Toggle.addEventListener("click", () => {
            const Reveal = Input.type === "password";
            Input.type = Reveal ? "text" : "password";
            Toggle.innerHTML = Reveal ? STORY_EYE_CLOSED_ICON : STORY_EYE_OPEN_ICON;
            Toggle.setAttribute("aria-label", Reveal ? "Hide password" : "Show password");
        });
    }

    WatchForStoryLinks();
    WireLeaveRoomWarning();
}

window.StoryConfirm = StoryConfirm;

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", WireStoryShell, { once: true });
} else {
    WireStoryShell();
}
