(() => {
    const FrontendVersion = "20261008.1";
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
            const Token = localStorage.getItem("StoryRewriteAuthToken")
                || localStorage.getItem("StoryRewriteSessionToken")
                || "";
            if (!Token) return "";
            return `${Token.length}:${Token.slice(-8)}`;
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
            return Boolean(
                localStorage.getItem("StoryRewriteAuthToken") ||
                localStorage.getItem("StoryRewriteSessionToken")
            );
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
        if (Host && typeof Host.PlaySound === "function") Host.PlaySound(Name);
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
            NotifyInteraction(true);
        };
        ChildDocument.addEventListener("pointerdown", ResumePersistentMusic, { capture: true, passive: true });
        ChildDocument.addEventListener("touchstart", ResumePersistentMusic, { capture: true, passive: true });
        ChildDocument.addEventListener("keydown", ResumePersistentMusic, { capture: true });
        ChildDocument.addEventListener("click", ResumePersistentMusic, { capture: true });
    }

    function RouteFromFrame(Frame) {
        try {
            return NormalizeRoute(Frame.contentWindow.location.href);
        } catch {
            return "";
        }
    }

    function UpdateTitle(Frame) {
        try {
            const ChildTitle = Frame.contentDocument?.title;
            document.title = ChildTitle || "Story Rewrite";
        } catch {
            document.title = "Story Rewrite";
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
        // The initial frame is deliberately hidden while it loads to prevent FOUC.
        // Reveal it as soon as its load event confirms the document is ready.
        if (Frame === ActiveFrame) Frame.style.visibility = "visible";
        WireFrameInteractionBridge(Frame);
        if (Frame !== ActiveFrame) SyncGameplayPauseButton({ paused: false });
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
        Frame.src = RouteUrl(Route);
        PrepareFrame(Frame, Route);
        Root.appendChild(Frame);
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
        SyncGameplayPauseButton();
        ApplyRouteMusic(Normalized);

        if (!SkipHistory) SetTopHistory(Normalized, Replace, PreviousRoute);

        if (Frame.dataset.storyLoaded === "1") {
            PendingFrame = null;
            ActivateFrame(Frame, Normalized);
            GameplayPauseButton?.removeAttribute("aria-busy");
        } else {
            PendingFrame = Frame;
        }

        if (Frame.dataset.storyLoaded !== "1") SyncGameplayPauseButton();
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
        if (CurrentHistoryDepth > 0) {
            window.history.back();
            return;
        }

        const SavedBackRoute = ReadLastShellState()?.backRoute;
        const NormalizedFallback = NormalizeRoute(SavedBackRoute || Fallback) || "main.html";
        LoadRoute(NormalizedFallback, { replace: true });
    }

    window.addEventListener("storage", Event => {
        if (Event.key !== "StoryRewriteAuthToken" && Event.key !== "StoryRewriteSessionToken") return;
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