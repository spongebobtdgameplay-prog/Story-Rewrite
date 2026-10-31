(() => {
    const FrontendVersion = "20261031.5";
    const Root = document.getElementById("StoryShellRoot");
    const InitialFrame = document.getElementById("StoryShellFrame");
    if (!Root || !InitialFrame) return;

    const ManagedPages = new Set([
        "main.html",
        "levels.html",
        "dialog.html",
        "multiplayer.html",
        "tutorial.html",
        "rules.html",
        "terms.html",
        "account.html",
        "settings.html",
        "social.html"
    ]);

    const PersistentPages = new Set([
        "main.html",
        "levels.html",
        "multiplayer.html",
        "tutorial.html",
        "rules.html",
        "terms.html",
        "account.html",
        "settings.html",
        "social.html"
    ]);

    const PersistentFrames = new Map();
    let TransientFrame = null;
    let ActiveFrame = InitialFrame;
    let PendingFrame = null;
    let CurrentRoute = "main.html";
    let CurrentMusicName = "";
    const LastShellStateKey = "StoryRewriteLastShellStateV1";
    let CurrentAudioSettings = {};
    let CurrentHistoryDepth = 0;
    let GameplayAudioPaused = false;
    let ShellPauseState = false;
    const GameplayPauseButton = document.getElementById("StoryShellPauseButton");

    function GetBaseUrl() {
        return new URL(".", window.location.href);
    }

    function NormalizeRoute(Value) {
        try {
            const Url = new URL(String(Value || "main.html"), GetBaseUrl());
            const Base = GetBaseUrl();
            if (Url.origin !== Base.origin || !Url.pathname.startsWith(Base.pathname)) return "";

            const PageName = Url.pathname.slice(Base.pathname.length) || "main.html";
            if (!ManagedPages.has(PageName)) return "";

            Url.searchParams.delete("__fresh");
            Url.searchParams.delete("__build");
            const Search = Url.searchParams.toString();
            return `${PageName}${Search ? `?${Search}` : ""}${Url.hash}`;
        } catch {
            return "";
        }
    }

    function RouteUrl(Route) {
        const Url = new URL(Route, GetBaseUrl());
        Url.searchParams.set("__build", FrontendVersion);
        return Url.href;
    }

    function RouteHash(Route) {
        return `#${encodeURIComponent(Route)}`;
    }

    function GetShellAuthMarker() {
        try {
            return localStorage.getItem("StoryRewriteCookieSessionActiveV1") === "1" ? "cookie-session" : "";
        } catch {
            return "";
        }
    }

    function ReadLastShellState() {
        try {
            const State = JSON.parse(localStorage.getItem(LastShellStateKey) || "null");
            const Route = NormalizeRoute(State?.route || "");
            const BackRoute = NormalizeRoute(State?.backRoute || "");
            const AuthMarker = GetShellAuthMarker();
            if (!Route || !AuthMarker || State?.authMarker !== AuthMarker) return null;
            return { route: Route, backRoute: BackRoute || "main.html" };
        } catch {
            return null;
        }
    }

    function WriteLastShellState(Route, BackRoute = "main.html") {
        const NormalizedRoute = NormalizeRoute(Route);
        if (!NormalizedRoute) return;

        const NormalizedBackRoute = NormalizeRoute(BackRoute) || "main.html";

        try {
            localStorage.setItem(LastShellStateKey, JSON.stringify({
                route: NormalizedRoute,
                backRoute: NormalizedBackRoute,
                authMarker: GetShellAuthMarker(),
                savedAt: Date.now()
            }));
        } catch {}
    }

    function RouteFromLocation() {
        const Raw = window.location.hash.slice(1);
        if (!Raw) {
            return ReadLastShellState()?.route || "main.html";
        }
        try {
            return NormalizeRoute(decodeURIComponent(Raw)) || "main.html";
        } catch {
            return NormalizeRoute(Raw) || "main.html";
        }
    }

    function PageForRoute(Route) {
        try {
            return new URL(Route, GetBaseUrl()).pathname.split("/").pop() || "main.html";
        } catch {
            return "main.html";
        }
    }

    function IsPersistentRoute(Route) {
        return PersistentPages.has(PageForRoute(Route));
    }

    function HasAuthenticatedSession() {
        try {
            return localStorage.getItem("StoryRewriteCookieSessionActiveV1") === "1";
        } catch {
            return false;
        }
    }

    function MusicForRoute(Route) {
        try {
            const Url = new URL(Route, GetBaseUrl());
            const PageName = Url.pathname.split("/").pop() || "main.html";

            if (PageName === "multiplayer.html") return "menu";

            if (PageName === "dialog.html") {
                const StageId = String(Url.searchParams.get("stage") || "").toLowerCase();
                if (StageId.startsWith("fromville-")) return "fromville";
                if (StageId.startsWith("neon-exorcists-")) return "neon-exorcists";
                if (StageId.startsWith("blackthorn-manor-")) return "blackthorn";
                if (StageId.startsWith("spirit-trail-")) return "spirit-grove";
                if (StageId.startsWith("false-city-")) return "false-city";
            }

            return "menu";
        } catch {
            return "menu";
        }
    }

    function SetTopHistory(Route, Replace = false, PreviousRouteOverride = "") {
        const Url = new URL(window.location.href);
        Url.hash = RouteHash(Route);

        const PreviousRoute = NormalizeRoute(PreviousRouteOverride)
            || (CurrentRoute && CurrentRoute !== Route ? CurrentRoute : "")
            || (ReadLastShellState()?.backRoute || "main.html");

        if (Replace) {
            const State = {
                StoryRewriteRoute: Route,
                StoryRewriteDepth: CurrentHistoryDepth,
                StoryRewriteBackRoute: PreviousRoute
            };
            window.history.replaceState(State, "", Url);
            WriteLastShellState(Route, PreviousRoute);
            return;
        }

        CurrentHistoryDepth += 1;
        const State = {
            StoryRewriteRoute: Route,
            StoryRewriteDepth: CurrentHistoryDepth,
            StoryRewriteBackRoute: PreviousRoute
        };
        window.history.pushState(State, "", Url);
        WriteLastShellState(Route, PreviousRoute);
    }

    function GetAudioHost() {
        try {
            return InitialFrame.contentWindow?.StoryAudioBridge || null;
        } catch {
            return null;
        }
    }

    function GetAudioState() {
        const Host = GetAudioHost();
        if (!Host || typeof Host.GetPlaybackState !== "function") {
            return {
                contextState: "closed",
                musicPlaying: false,
                musicVolume: Number(CurrentAudioSettings.musicVolume || 0),
                soundVolume: Number(CurrentAudioSettings.soundVolume || 0)
            };
        }

        return Host.GetPlaybackState();
    }

    function FlushAudioHost() {
        const Host = GetAudioHost();
        if (!Host) return false;

        if (typeof Host.Configure === "function") Host.Configure(CurrentAudioSettings);

        if (!HasAuthenticatedSession()) {
            CurrentMusicName = "";
            if (typeof Host.StopMusic === "function") Host.StopMusic();
            return true;
        }

        if (CurrentMusicName && typeof Host.PlayMusic === "function") {
            Host.PlayMusic(CurrentMusicName);
        }

        return true;
    }

    function ConfigureAudio(Settings = {}) {
        CurrentAudioSettings = { ...CurrentAudioSettings, ...Settings };
        const Host = GetAudioHost();
        if (Host && typeof Host.Configure === "function") Host.Configure(CurrentAudioSettings);
    }

    function SetKeepMusicPlaying(Enabled) {
        const Host = GetAudioHost();
        if (Host && typeof Host.SetKeepMusicPlaying === "function") {
            return Host.SetKeepMusicPlaying(Enabled);
        }
        return false;
    }

    function PlaySound(Name) {
        const Host = GetAudioHost();
        if (Host && typeof Host.PlaySound === "function") return Host.PlaySound(Name);
        return Promise.resolve(false);
    }

    function PlayMusic(Name) {
        const NextMusicName = String(Name || "");
        if (!NextMusicName) return;

        if (!HasAuthenticatedSession()) {
            StopMusic();
            return;
        }

        const ActiveRoute = CurrentRoute || RouteFromLocation();
        const RouteMusicName = MusicForRoute(ActiveRoute);
        const ActivePageName = PageForRoute(ActiveRoute);
        const IsAllowedDialogOverride = ActivePageName === "dialog.html" && NextMusicName === "danger";

        if (NextMusicName !== RouteMusicName && !IsAllowedDialogOverride) return;

        const Host = GetAudioHost();
        if (CurrentMusicName === NextMusicName) {
            const State = GetAudioState();
            if (
                State?.musicName === NextMusicName ||
                State?.pendingMusicName === NextMusicName ||
                (!Host && CurrentMusicName === NextMusicName)
            ) {
                return;
            }
        }

        CurrentMusicName = NextMusicName;
        if (Host && typeof Host.PlayMusic === "function") Host.PlayMusic(CurrentMusicName);
    }

    function ApplyRouteMusic(Route) {
        if (!HasAuthenticatedSession()) {
            StopMusic();
            return;
        }

        const DesiredMusic = MusicForRoute(Route);
        if (!DesiredMusic) return;
        PlayMusic(DesiredMusic);
    }

    function StopMusic() {
        CurrentMusicName = "";
        const Host = GetAudioHost();
        if (Host && typeof Host.StopMusic === "function") Host.StopMusic();
    }

    function NotifyInteraction(FromTrustedGesture = false) {
        if (!FromTrustedGesture) return Promise.resolve(null);
        if (!HasAuthenticatedSession()) {
            StopMusic();
            return Promise.resolve(null);
        }

        const Host = GetAudioHost();
        if (!Host) return Promise.resolve(null);

        if (typeof Host.UnlockAudio === "function") return Host.UnlockAudio(true);
        if (CurrentMusicName && typeof Host.PlayMusic === "function") {
            return Host.PlayMusic(CurrentMusicName);
        }

        return Promise.resolve(null);
    }

    function WireFrameInteractionBridge(Frame) {
        let ChildDocument;
        try {
            ChildDocument = Frame.contentDocument;
        } catch {
            ChildDocument = null;
        }

        if (!ChildDocument || ChildDocument.documentElement?.dataset.storyShellBridge === "1") return;
        if (ChildDocument.documentElement) ChildDocument.documentElement.dataset.storyShellBridge = "1";

        const ResumePersistentMusic = Event => {
            if (!Event.isTrusted) return;
            try { NotifyInteraction(true); } catch {}
        };
        const PlayEngineClick = Event => {
            if (!Event.isTrusted) return;
            const Control = Event.target?.closest?.(
                "button,[role='button'],a[href],input[type='button'],input[type='submit'],summary"
            );
            if (!Control || Control.disabled || Control.getAttribute("aria-disabled") === "true") return;
            if (Control.closest("#ChatForm, #GameChatForm")) return;
            try { PlaySound("click"); } catch {}
        };

        ChildDocument.addEventListener("pointerdown", ResumePersistentMusic, { capture: true, passive: true });
        ChildDocument.addEventListener("touchstart", ResumePersistentMusic, { capture: true, passive: true });
        ChildDocument.addEventListener("keydown", ResumePersistentMusic, { capture: true });
        ChildDocument.addEventListener("click", PlayEngineClick, { capture: true });
    }

    function RouteFromFrame(Frame) {
        try {
            return NormalizeRoute(Frame.contentWindow.location.href);
        } catch {
            return "";
        }
    }

    const FrameTitleObservers = new WeakMap();

    function SyncActiveFrameTitle(Frame, Title) {
        if (!Frame || Frame !== ActiveFrame) return false;
        const SafeTitle = String(Title || "Story Rewrite").slice(0, 180);
        if (document.title !== SafeTitle) document.title = SafeTitle;
        return true;
    }

    // The child page can request a title update, but only the active iframe is
    // allowed to write the browser tab title.
    window.StoryShellSyncTitle = function(Title, SourceWindow) {
        try {
            const Frame = ActiveFrame;
            if (!Frame || !SourceWindow || Frame.contentWindow !== SourceWindow) return false;
            return SyncActiveFrameTitle(Frame, Title);
        } catch {
            return false;
        }
    };

    function WatchFrameTitle(Frame) {
        try {
            const ChildDocument = Frame.contentDocument;
            const Head = ChildDocument?.head;
            if (!Head) return;
            const Existing = FrameTitleObservers.get(Frame);
            if (Existing?.document === ChildDocument) return;
            Existing?.observer?.disconnect();

            const Observer = new MutationObserver(() => {
                if (Frame !== ActiveFrame) return;
                try {
                    SyncActiveFrameTitle(Frame, ChildDocument.title || "Story Rewrite");
                } catch {}
            });
            Observer.observe(Head, { childList: true, characterData: true, subtree: true });
            FrameTitleObservers.set(Frame, { document: ChildDocument, observer: Observer });
        } catch {}
    }

    function UpdateTitle(Frame) {
        try {
            const ChildDocument = Frame.contentDocument;
            const ChildTitle = ChildDocument?.title || "Story Rewrite";
            SyncActiveFrameTitle(Frame, ChildTitle);
            WatchFrameTitle(Frame);
        } catch {
            if (Frame === ActiveFrame) document.title = "Story Rewrite";
        }
    }

    function DispatchFrameEvent(Frame, EventName, Route) {
        if (!Frame || Frame.dataset.storyLoaded !== "1") return;
        try {
            const ChildWindow = Frame.contentWindow;
            ChildWindow.dispatchEvent(new ChildWindow.CustomEvent(EventName, {
                detail: { route: Route }
            }));
        } catch {}
    }

    function ConsumeContinueResumeRequest(Route) {
        if (!IsSinglePlayerGameRoute(Route)) return false;

        try {
            if (sessionStorage.getItem("StoryRewriteResumeContinueV1") !== "1") return false;
            sessionStorage.removeItem("StoryRewriteResumeContinueV1");
            return true;
        } catch {
            return false;
        }
    }

    function IsSinglePlayerGameRoute(Route = CurrentRoute) {
        try {
            const Url = new URL(Route, GetBaseUrl());
            const PageName = Url.pathname.split("/").pop() || "main.html";
            return PageName === "dialog.html"
                && Boolean(Url.searchParams.get("stage"))
                && !Url.searchParams.get("room");
        } catch {
            return false;
        }
    }

    function SetGameplayPauseButtonIcon(Paused) {
        if (!GameplayPauseButton) return;

        GameplayPauseButton.innerHTML = Paused
            ? '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 5.2 19 12 8 18.8V5.2Z"></path></svg>'
            : '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="7" y="5.5" width="3.5" height="13" rx="1"></rect><rect x="13.5" y="5.5" width="3.5" height="13" rx="1"></rect></svg>';
    }

    function SyncGameplayPauseButton(Options = {}) {
        if (!GameplayPauseButton) return;

        let Ready = false;
        if (IsSinglePlayerGameRoute() && ActiveFrame?.dataset.storyLoaded === "1") {
            const ActiveRoute = ActiveFrame.dataset.storyRoute || RouteFromFrame(ActiveFrame);
            Ready = ActiveRoute === CurrentRoute
                && ActiveRoute === RouteFromFrame(ActiveFrame);
        }

        GameplayPauseButton.hidden = !Ready;

        if (!Ready) {
            GameplayPauseButton.classList.remove("IsPaused");
            GameplayPauseButton.setAttribute("aria-pressed", "false");
            GameplayPauseButton.setAttribute("aria-label", "Pause game");
            GameplayPauseButton.title = "Pause game";
            SetGameplayPauseButtonIcon(false);
            return;
        }

        const Paused = Object.prototype.hasOwnProperty.call(Options, "paused")
            ? Boolean(Options.paused)
            : ShellPauseState;
        ShellPauseState = Paused;
        GameplayPauseButton.classList.toggle("IsPaused", Paused);
        GameplayPauseButton.setAttribute("aria-pressed", Paused ? "true" : "false");
        GameplayPauseButton.setAttribute("aria-label", Paused ? "Resume game" : "Pause game");
        GameplayPauseButton.title = Paused ? "Resume game" : "Pause game";
        SetGameplayPauseButtonIcon(Paused);
    }

    function ToggleGameplayPause() {
        if (!GameplayPauseButton || GameplayPauseButton.hidden) return;
        if (!IsSinglePlayerGameRoute() || ActiveFrame?.dataset.storyLoaded !== "1") return;

        const ActiveRoute = RouteFromFrame(ActiveFrame);
        if (!ActiveRoute || ActiveRoute !== CurrentRoute) return;

        const NextPaused = !ShellPauseState;
        SyncGameplayPauseButton({ paused: NextPaused });

        try {
            ActiveFrame.contentWindow.dispatchEvent(
                new ActiveFrame.contentWindow.CustomEvent("StoryShellPauseToggle")
            );
        } catch {
            SyncGameplayPauseButton({ paused: ShellPauseState });
        }
    }

    if (GameplayPauseButton) {
        GameplayPauseButton.addEventListener("click", ToggleGameplayPause);
    }

    window.addEventListener("StoryShellPauseState", Event => {
        SyncGameplayPauseButton({ paused: Boolean(Event?.detail?.paused) });
    });

    function HideFrame(Frame) {
        Frame.style.display = "none";
        Frame.style.visibility = "hidden";
        Frame.style.pointerEvents = "none";
        Frame.setAttribute("aria-hidden", "true");
    }

    function ActivateFrame(Frame, Route) {
        if (!Frame || Frame.dataset.storyLoaded !== "1") return false;

        if (ActiveFrame && ActiveFrame !== Frame) {
            DispatchFrameEvent(ActiveFrame, "StoryShellDeactivate", ActiveFrame.dataset.storyRoute || "");
        }

        for (const Child of Root.querySelectorAll("iframe.StoryShellFrame")) HideFrame(Child);

        Frame.style.display = "block";
        Frame.style.visibility = "visible";
        Frame.style.pointerEvents = "auto";
        Frame.removeAttribute("aria-hidden");
        ActiveFrame = Frame;
        if (PendingFrame === Frame) PendingFrame = null;

        SyncGameplayPauseButton();
        GameplayPauseButton?.removeAttribute("aria-busy");
        UpdateTitle(Frame);

        const ResumeContinue = ConsumeContinueResumeRequest(Route);
        if (ResumeContinue) {
            ShellPauseState = false;
        }

        DispatchFrameEvent(Frame, "StoryShellActivate", Route);

        if (ResumeContinue) {
            DispatchFrameEvent(Frame, "StoryShellResumeGameplay", Route);
        }

        return true;
    }

    function InstallResponsiveUiEngine(Frame) {
        let ChildDocument;
        try { ChildDocument = Frame.contentDocument; } catch { return; }
        const Head = ChildDocument && ChildDocument.head;
        const Body = ChildDocument && ChildDocument.body;
        const Html = ChildDocument && ChildDocument.documentElement;
        if (!Head || !Body || !Html || Html.dataset.storyResponsiveEngineInstalled === "1") return;
        Html.dataset.storyResponsiveEngineInstalled = "1";
        // Keep page margins inside their own document so they cannot expose the outer shell.
        Body.style.setProperty("display", "flow-root", "important");
        const Styles = ChildDocument.createElement("style");
        Styles.id = "StoryResponsiveUiEngineStyles";
        Styles.textContent = ":root {\n    --story-ui-scale: 1;\n    --story-mobile-dock-height: clamp(64px, calc(68px * var(--story-ui-scale)), 76px);\n    font-size: clamp(14px, calc(16px * var(--story-ui-scale)), 18px);\n}\nhtml {\n    -webkit-text-size-adjust: 100%;\n    scroll-padding-block-end: calc(var(--story-mobile-dock-height) + env(safe-area-inset-bottom));\n}\n.StoryMobileDock { display: none; }\nbody.StoryResponsiveTouch {\n    max-width: 100%;\n    overflow-x: hidden;\n    -webkit-tap-highlight-color: transparent;\n}\nbody.StoryResponsiveTouch :is(button, [role=\"button\"], input, select, textarea) { touch-action: manipulation; }\nbody.StoryResponsiveTouch :is(button, [role=\"button\"]) { scroll-margin-block: 8px; }\nbody.StoryResponsiveTouch :is(input, select, textarea) {\n    max-width: 100%;\n    font-size: max(16px, 1em);\n}\nbody.StoryResponsiveTouch:not(.GamePage):not(.AccountPage) {\n    padding-block-end: calc(var(--story-mobile-dock-height) + env(safe-area-inset-bottom) + 10px) !important;\n}\nbody.StoryResponsiveTouch .StoryMobileDock {\n    position: fixed;\n    inset-inline-start: max(8px, env(safe-area-inset-left));\n    inset-inline-end: max(8px, env(safe-area-inset-right));\n    inset-block-end: max(7px, env(safe-area-inset-bottom));\n    z-index: 1200;\n    display: grid;\n    grid-template-columns: repeat(6, minmax(0, 1fr));\n    gap: clamp(3px, calc(6px * var(--story-ui-scale)), 8px);\n    width: auto;\n    max-width: 980px;\n    margin-inline: auto;\n    padding: clamp(5px, calc(7px * var(--story-ui-scale)), 9px);\n    border: 1px solid rgba(226, 181, 111, .38);\n    border-radius: 17px;\n    background: rgba(30, 18, 12, .94);\n    box-shadow: 0 14px 34px rgba(0, 0, 0, .4), inset 0 1px rgba(255, 242, 213, .07);\n    backdrop-filter: blur(14px);\n    -webkit-backdrop-filter: blur(14px);\n    transition: opacity .16s ease, transform .16s ease;\n}\nbody.StoryResponsiveTouch .StoryMobileDockButton {\n    min-width: 0;\n    min-height: clamp(49px, calc(54px * var(--story-ui-scale)), 60px);\n    padding: 3px 1px;\n    display: flex;\n    flex-direction: column;\n    align-items: center;\n    justify-content: center;\n    gap: 3px;\n    overflow: hidden;\n    color: #e8c99b;\n    border: 1px solid rgba(211, 159, 91, .18);\n    border-radius: 11px;\n    background: linear-gradient(180deg, rgba(85, 51, 31, .82), rgba(45, 27, 18, .94));\n    font: 800 clamp(8px, calc(9px * var(--story-ui-scale)), 10px)/1 system-ui, sans-serif;\n    letter-spacing: .015em;\n    text-transform: uppercase;\n    white-space: nowrap;\n    -webkit-tap-highlight-color: transparent;\n}\nbody.StoryResponsiveTouch .StoryMobileDockButton:active { transform: scale(.96); }\nbody.StoryResponsiveTouch .StoryMobileDockButton[aria-current=\"page\"] {\n    color: #2a170d;\n    border-color: rgba(255, 220, 161, .7);\n    background: linear-gradient(180deg, #efc982, #c8873f);\n    box-shadow: inset 0 1px rgba(255, 255, 255, .3), 0 4px 14px rgba(190, 120, 48, .2);\n}\nbody.StoryResponsiveTouch .StoryMobileDockIcon {\n    display: grid;\n    place-items: center;\n    width: clamp(18px, calc(21px * var(--story-ui-scale)), 24px);\n    height: clamp(18px, calc(21px * var(--story-ui-scale)), 24px);\n    flex: 0 0 auto;\n}\nbody.StoryResponsiveTouch .StoryMobileDockIcon svg {\n    width: 100%; height: 100%; fill: none; stroke: currentColor;\n    stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; pointer-events: none;\n}\nbody.StoryResponsiveTouch .StoryMobileDockLabel { max-width: 100%; overflow: hidden; text-overflow: ellipsis; }\nbody.StoryResponsiveTouch .StoryMobileDockButton:focus-visible { outline: 2px solid #ffe0a2; outline-offset: 2px; }\nbody.GamePage .StoryMobileDock, body.AccountPage .StoryMobileDock { display: none !important; }\nbody.StoryResponsiveTyping .StoryMobileDock { opacity: 0; pointer-events: none; transform: translateY(140%); }\n@media (max-width: 900px), (pointer: coarse) and (max-width: 1200px) {\n    body.StoryResponsiveTouch :is(button, [role=\"button\"], select) {\n        min-height: max(40px, calc(44px * var(--story-ui-scale)));\n    }\n    body.StoryResponsiveTouch .TopActions { gap: clamp(5px, calc(7px * var(--story-ui-scale)), 10px); }\n    body.StoryResponsiveTouch .GameHeaderActions { justify-content: flex-start; }\n    body.StoryResponsiveTouch .StorySocialShell,\n    body.StoryResponsiveTouch .StorySettingsShell,\n    body.StoryResponsiveTouch .LevelSelectShell,\n    body.StoryResponsiveTouch .MultiplayerShell { max-width: 100%; }\n}\n@media (prefers-reduced-motion: reduce) {\n    body.StoryResponsiveTouch .StoryMobileDock,\n    body.StoryResponsiveTouch .StoryMobileDockButton { transition: none; }\n}";
        Head.appendChild(Styles);
        const Runtime = ChildDocument.createElement("script");
        Runtime.id = "StoryResponsiveUiEngineScript";
        Runtime.textContent = "(() => {\n    \"use strict\";\n    const Root = document.documentElement;\n    const Body = document.body;\n    if (!Root || !Body || Root.dataset.storyResponsiveEngine === \"20261025-1\") return;\n    Root.dataset.storyResponsiveEngine = \"20261025-1\";\n    const Items = [\n        { route: \"main.html\", label: \"Home\", icon: '<path d=\"m3 10 9-7 9 7\"></path><path d=\"M5.5 9v11h13V9M9.5 20v-6h5v6\"></path>' },\n        { route: \"levels.html\", label: \"Worlds\", icon: '<path d=\"M4 4.5h6v6H4zM14 4.5h6v6h-6zM4 14.5h6v6H4zM14 14.5h6v6h-6z\"></path>' },\n        { route: \"multiplayer.html\", label: \"Play\", icon: '<path d=\"m8 5 11 7-11 7V5Z\"></path>' },\n        { route: \"social.html\", label: \"Social\", icon: '<path d=\"M4 5.5h16v11H10l-6 3v-3H4z\"></path><path d=\"M8 9h8M8 12h5\"></path>' },\n        { route: \"settings.html\", label: \"Settings\", icon: '<path d=\"M9.4 3.6 10.2 2.6h3.6l.8 1 1.4.6 1.3-.2 2.5 2.5-.2 1.3.6 1.4 1 .8v3.6l-1 .8-.6 1.4.2 1.3-2.5 2.5-1.3-.2-1.4.6-.8 1h-3.6l-.8-1-1.4-.6-1.3.2-2.5-2.5.2-1.3-.6-1.4-1-.8v-3.6l1-.8.6-1.4-.2-1.3 2.5-2.5 1.3.2 1.4-.6Z\"></path><circle cx=\"12\" cy=\"12\" r=\"3\"></circle>' },\n        { route: \"account.html\", label: \"Profile\", icon: '<circle cx=\"12\" cy=\"8\" r=\"3.5\"></circle><path d=\"M5.5 20c.7-4 3-6 6.5-6s5.8 2 6.5 6\"></path>' }\n    ];\n    function UpdateScale() {\n        const V = window.visualViewport;\n        const W = Math.max(1, Number(V && V.width) || window.innerWidth || 1);\n        const H = Math.max(1, Number(V && V.height) || window.innerHeight || 1);\n        const Coarse = Boolean(window.matchMedia && window.matchMedia(\"(pointer: coarse)\").matches);\n        const Compact = W <= 900 || (Coarse && W <= 1200);\n        const Landscape = W >= H;\n        const RefW = Landscape ? 844 : 390;\n        const RefH = Landscape ? 390 : 844;\n        const Ratio = Math.min(W / RefW, H / RefH);\n        const Scale = Compact ? Math.max(0.82, Math.min(1.12, Ratio)) : 1;\n        Root.style.setProperty(\"--story-ui-scale\", Scale.toFixed(3));\n        Root.style.setProperty(\"--story-viewport-width\", W + \"px\");\n        Root.style.setProperty(\"--story-viewport-height\", H + \"px\");\n        Root.dataset.storyViewport = Landscape ? \"landscape\" : \"portrait\";\n        Body.classList.toggle(\"StoryResponsiveTouch\", Compact);\n    }\n    function GetCurrentRoute() {\n        if (Body.classList.contains(\"LevelSelectPage\")) return \"levels.html\";\n        if (Body.classList.contains(\"MultiplayerPage\")) return \"multiplayer.html\";\n        if (Body.classList.contains(\"StorySocialPage\")) return \"social.html\";\n        if (Body.classList.contains(\"StorySettingsPage\")) return \"settings.html\";\n        if (Body.classList.contains(\"ProfilePage\")) return \"account.html\";\n        try {\n            const Parts = new URL(window.location.href).pathname.split(\"/\");\n            return Parts[Parts.length - 1] || \"main.html\";\n        } catch { return \"main.html\"; }\n    }\n    function AddDock() {\n        if (document.getElementById(\"StoryMobileDock\") || Body.classList.contains(\"GamePage\") || Body.classList.contains(\"AccountPage\")) return;\n        const Dock = document.createElement(\"nav\");\n        Dock.id = \"StoryMobileDock\";\n        Dock.className = \"StoryMobileDock\";\n        Dock.setAttribute(\"aria-label\", \"Quick navigation\");\n        const ActiveRoute = GetCurrentRoute();\n        for (const Item of Items) {\n            const Button = document.createElement(\"button\");\n            Button.type = \"button\";\n            Button.className = \"StoryMobileDockButton\";\n            Button.dataset.storyMobileRoute = Item.route;\n            Button.setAttribute(\"aria-label\", Item.label);\n            Button.title = Item.label;\n            if (Item.route === ActiveRoute) Button.setAttribute(\"aria-current\", \"page\");\n            const Icon = document.createElement(\"span\");\n            Icon.className = \"StoryMobileDockIcon\";\n            Icon.setAttribute(\"aria-hidden\", \"true\");\n            Icon.innerHTML = '<svg viewBox=\"0 0 24 24\" focusable=\"false\">' + Item.icon + \"</svg>\";\n            const Label = document.createElement(\"span\");\n            Label.className = \"StoryMobileDockLabel\";\n            Label.textContent = Item.label;\n            Button.append(Icon, Label);\n            Button.addEventListener(\"click\", () => {\n                if (Item.route === ActiveRoute) return;\n                if (typeof window.StoryNavigate === \"function\") window.StoryNavigate(Item.route, Button);\n                else window.location.href = new URL(Item.route, window.location.href).href;\n            });\n            Dock.appendChild(Button);\n        }\n        Body.appendChild(Dock);\n    }\n    function WatchKeyboard() {\n        const IsInput = E => E instanceof HTMLElement && (E instanceof HTMLInputElement || E instanceof HTMLTextAreaElement || E.isContentEditable);\n        document.addEventListener(\"focusin\", E => { if (IsInput(E.target)) Body.classList.add(\"StoryResponsiveTyping\"); });\n        document.addEventListener(\"focusout\", E => {\n            if (!IsInput(E.target)) return;\n            window.setTimeout(() => { if (!IsInput(document.activeElement)) Body.classList.remove(\"StoryResponsiveTyping\"); }, 80);\n        });\n    }\n    UpdateScale();\n    AddDock();\n    WatchKeyboard();\n    window.addEventListener(\"resize\", UpdateScale, { passive: true });\n    window.addEventListener(\"orientationchange\", UpdateScale, { passive: true });\n    if (window.visualViewport) window.visualViewport.addEventListener(\"resize\", UpdateScale, { passive: true });\n    window.StoryResponsiveUi = { version: \"20261025-1\", sync: UpdateScale };\n})();";
        Head.appendChild(Runtime);
    }

    function HandleFrameLoad(Frame) {
        const ActualRoute = RouteFromFrame(Frame);
        if (!ActualRoute) {
            Frame.dataset.storyLoaded = "0";
            try {
                const PageName = Frame.contentWindow.location.pathname.split("/").pop();
                if (PageName === "auth.html" && (Frame === ActiveFrame || Frame === PendingFrame)) {
                    Exit("auth.html", true);
                }
            } catch {}
            return;
        }

        const PreviousRoute = Frame.dataset.storyRoute || "";
        const FrameNavigatedItself = Boolean(PreviousRoute && ActualRoute !== PreviousRoute);

        if (FrameNavigatedItself && (Frame === ActiveFrame || Frame === PendingFrame)) {
            Frame.dataset.storyLoaded = "0";
            if (PendingFrame === Frame) PendingFrame = null;
            LoadRoute(ActualRoute, { replace: true });
            return;
        }

        Frame.dataset.storyLoaded = "1";
        InstallResponsiveUiEngine(Frame);
        // The initial frame is deliberately hidden while it loads to prevent FOUC.
        // Reveal it as soon as its load event confirms the document is ready.
        if (Frame === ActiveFrame) Frame.style.visibility = "visible";
        WireFrameInteractionBridge(Frame);
        if (Frame === InitialFrame) FlushAudioHost();

        if (ActualRoute !== PreviousRoute) {
            if (PreviousRoute && PersistentFrames.get(PreviousRoute) === Frame) {
                PersistentFrames.delete(PreviousRoute);
            }

            Frame.dataset.storyRoute = ActualRoute;
            if (Frame !== TransientFrame && IsPersistentRoute(ActualRoute)) {
                PersistentFrames.set(ActualRoute, Frame);
            }
        }

        if (Frame === PendingFrame && ActualRoute === CurrentRoute) {
            ActivateFrame(Frame, CurrentRoute);
            return;
        }

        if (Frame === ActiveFrame && ActualRoute === CurrentRoute) {
            UpdateTitle(Frame);
            DispatchFrameEvent(Frame, "StoryShellActivate", CurrentRoute);
        }
    }

    function PrepareFrame(Frame, Route, KeepVisible = false) {
        Frame.classList.add("StoryShellFrame");
        Frame.dataset.storyRoute = Route;
        Frame.dataset.storyLoaded = "0";
        Frame.title = "Story Rewrite";

        if (!KeepVisible) {
            Frame.style.display = "none";
            Frame.style.visibility = "hidden";
            Frame.style.pointerEvents = "none";
            Frame.setAttribute("aria-hidden", "true");
        } else {
            Frame.style.display = "block";
            Frame.style.visibility = "hidden";
            Frame.style.pointerEvents = "auto";
            Frame.removeAttribute("aria-hidden");
        }

        Frame.addEventListener("load", () => HandleFrameLoad(Frame));
    }

    function CreateFrame(Route) {
        const Frame = document.createElement("iframe");
        PrepareFrame(Frame, Route);
        Root.appendChild(Frame);
        // Attach the load handler and connect the frame before starting navigation.
        // A fast cached response can otherwise load before the listener exists.
        Frame.src = RouteUrl(Route);
        return Frame;
    }

    function GetPersistentFrame(Route) {
        const Existing = PersistentFrames.get(Route);
        if (Existing) return Existing;

        const Frame = CreateFrame(Route);
        PersistentFrames.set(Route, Frame);
        return Frame;
    }

    function GetTransientFrame(Route) {
        if (!TransientFrame) {
            TransientFrame = CreateFrame(Route);
            return TransientFrame;
        }

        const ExistingRoute = TransientFrame.dataset.storyRoute || "";
        if (ExistingRoute !== Route) {
            TransientFrame.dataset.storyLoaded = "0";
            TransientFrame.dataset.storyRoute = Route;
            TransientFrame.src = RouteUrl(Route);
        }

        return TransientFrame;
    }

    function GetFrameForRoute(Route) {
        return IsPersistentRoute(Route)
            ? GetPersistentFrame(Route)
            : GetTransientFrame(Route);
    }

    function LoadRoute(Route, Options = {}) {
        const Normalized = NormalizeRoute(Route);
        if (!Normalized) return false;

        const Replace = Boolean(Options.replace);
        const SkipHistory = Boolean(Options.skipHistory);
        const Frame = GetFrameForRoute(Normalized);
        const PreviousRoute = CurrentRoute;

        if (IsSinglePlayerGameRoute(Normalized) && PreviousRoute !== Normalized) {
            ShellPauseState = false;
        }

        CurrentRoute = Normalized;
        GameplayPauseButton?.setAttribute("aria-busy", "true");
        ApplyRouteMusic(Normalized);

        const BackRouteOverride = Object.prototype.hasOwnProperty.call(Options, "backRoute")
            ? Options.backRoute
            : PreviousRoute;
        if (!SkipHistory) SetTopHistory(Normalized, Replace, BackRouteOverride);

        if (Frame.dataset.storyLoaded === "1") {
            PendingFrame = null;
            ActivateFrame(Frame, Normalized);
            GameplayPauseButton?.removeAttribute("aria-busy");
        } else {
            PendingFrame = Frame;
        }

        return true;
    }

    function Navigate(Value, Options = {}) {
        const Normalized = NormalizeRoute(Value);
        if (!Normalized) return false;

        if (Normalized === CurrentRoute && ActiveFrame?.dataset.storyRoute === Normalized) {
            DispatchFrameEvent(ActiveFrame, "StoryShellActivate", Normalized);
            return true;
        }

        return LoadRoute(Normalized, Options);
    }

    function PauseMusicForGameplay() {
        GameplayAudioPaused = true;
        const Host = GetAudioHost();
        if (Host && typeof Host.PauseMusicForGameplay === "function") {
            return Host.PauseMusicForGameplay();
        }
        return false;
    }

    function ResumeMusicForGameplay() {
        GameplayAudioPaused = false;
        const Host = GetAudioHost();
        if (Host && typeof Host.ResumeMusicForGameplay === "function") {
            return Host.ResumeMusicForGameplay();
        }
        return false;
    }

    function IsGameplayAudioPaused() {
        return GameplayAudioPaused;
    }

    function Exit(Value, Replace = false) {
        const Url = new URL(String(Value || "auth.html"), GetBaseUrl());
        if (Url.pathname.endsWith("/auth.html")) StopMusic();

        if (Replace) window.location.replace(Url.href);
        else window.location.href = Url.href;
    }

    function Back(Fallback = "main.html") {
        const NormalizedFallback = NormalizeRoute(Fallback) || "main.html";
        const HistoryState = window.history.state || {};
        const StateBackRoute = NormalizeRoute(
            HistoryState.StoryRewriteBackRoute || ReadLastShellState()?.backRoute || ""
        );

        if (IsSinglePlayerGameRoute()) {
            // Continue Story returns to Home; a stage opened from Worlds returns
            // to the existing Chapter Map entry.
            const IntendedBackRoute = StateBackRoute && !IsSinglePlayerGameRoute(StateBackRoute)
                ? StateBackRoute
                : NormalizedFallback;

            if (CurrentHistoryDepth > 0 && StateBackRoute === IntendedBackRoute) {
                window.history.back();
                return;
            }

            const SafeBackRoute = IntendedBackRoute === "levels.html"
                ? "main.html"
                : (StateBackRoute && StateBackRoute !== IntendedBackRoute ? StateBackRoute : "main.html");
            LoadRoute(IntendedBackRoute, { replace: true, backRoute: SafeBackRoute });
            return;
        }

        if (CurrentHistoryDepth > 0) {
            window.history.back();
            return;
        }

        const SavedBackRoute = NormalizeRoute(ReadLastShellState()?.backRoute || "") || NormalizedFallback;
        LoadRoute(SavedBackRoute, { replace: true, backRoute: "main.html" });
    }

    window.addEventListener("storage", Event => {
        if (Event.key !== "StoryRewriteCookieSessionActiveV1") return;
        if (!HasAuthenticatedSession()) StopMusic();
    });

    window.addEventListener("popstate", Event => {
        CurrentHistoryDepth = Math.max(0, Number(Event.state?.StoryRewriteDepth || 0));
        const Route = NormalizeRoute(Event.state?.StoryRewriteRoute) || RouteFromLocation();

        const BackRoute = NormalizeRoute(Event.state?.StoryRewriteBackRoute || "") || "main.html";
        WriteLastShellState(Route, BackRoute);
        LoadRoute(Route, { skipHistory: true });
    });

    window.StoryShell = Object.freeze({
        IsPersistentShell: true,
        FrontendVersion,
        Navigate,
        CanHandle: Value => Boolean(NormalizeRoute(Value)),
        Exit,
        Back,
        ConfigureAudio,
        PauseMusicForGameplay,
        ResumeMusicForGameplay,
        IsGameplayAudioPaused,
        ToggleGameplayPause,
        SetKeepMusicPlaying,
        PlaySound,
        PlayMusic,
        StopMusic,
        NotifyInteraction,
        GetAudioState,
        GetCurrentRoute: () => CurrentRoute,
        GetCurrentMusic: () => CurrentMusicName
    });

    const InitialFrameHadSource = Boolean(InitialFrame.getAttribute("src"));
    InitialFrame.style.visibility = "hidden";
    PrepareFrame(InitialFrame, "main.html", true);
    PersistentFrames.set("main.html", InitialFrame);
    ActiveFrame = InitialFrame;

    if (InitialFrameHadSource) {
        try {
            const ReadyState = InitialFrame.contentDocument?.readyState;
            if (ReadyState === "interactive" || ReadyState === "complete") {
                setTimeout(() => HandleFrameLoad(InitialFrame), 0);
            }
        } catch {}
    } else {
        InitialFrame.src = RouteUrl("main.html");
    }

    const SavedShellState = ReadLastShellState();
    const InitialRoute = RouteFromLocation();
    CurrentRoute = InitialRoute;
    CurrentHistoryDepth = 0;
    SyncGameplayPauseButton();

    if (!window.location.hash && SavedShellState?.route === InitialRoute) {
        const InitialBackRoute = SavedShellState.backRoute || "main.html";
        const Url = new URL(window.location.href);
        Url.hash = RouteHash(InitialRoute);
        window.history.replaceState({
            StoryRewriteRoute: InitialRoute,
            StoryRewriteDepth: 0,
            StoryRewriteBackRoute: InitialBackRoute
        }, "", Url);
        WriteLastShellState(InitialRoute, InitialBackRoute);
    } else {
        SetTopHistory(InitialRoute, true);
    }
    ApplyRouteMusic(InitialRoute);

    if (InitialRoute === "main.html") {
        if (InitialFrame.dataset.storyLoaded === "1") ActivateFrame(InitialFrame, InitialRoute);
    } else {
        const TargetFrame = GetFrameForRoute(InitialRoute);
        if (TargetFrame.dataset.storyLoaded === "1") {
            ActivateFrame(TargetFrame, InitialRoute);
        } else {
            PendingFrame = TargetFrame;
        }
    }
})();