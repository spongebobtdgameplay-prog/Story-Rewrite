(() => {
    const FrontendVersion = "20260822.7";
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
        "account.html"
    ]);

    const PersistentPages = new Set([
        "main.html",
        "levels.html",
        "multiplayer.html",
        "tutorial.html",
        "rules.html",
        "account.html"
    ]);

    const PersistentFrames = new Map();
    let TransientFrame = null;
    let ActiveFrame = InitialFrame;
    let PendingFrame = null;
    let CurrentRoute = "main.html";
    let CurrentMusicName = "";
    let CurrentAudioSettings = {};
    let CurrentHistoryDepth = 0;

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

    function RouteFromLocation() {
        const Raw = window.location.hash.slice(1);
        if (!Raw) return "main.html";
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

    function SetTopHistory(Route, Replace = false) {
        const Url = new URL(window.location.href);
        Url.hash = RouteHash(Route);

        if (Replace) {
            const State = {
                StoryRewriteRoute: Route,
                StoryRewriteDepth: CurrentHistoryDepth
            };
            window.history.replaceState(State, "", Url);
            return;
        }

        CurrentHistoryDepth += 1;
        const State = {
            StoryRewriteRoute: Route,
            StoryRewriteDepth: CurrentHistoryDepth
        };
        window.history.pushState(State, "", Url);
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

        const ActiveRoute = CurrentRoute || RouteFromLocation();
        const RouteMusicName = MusicForRoute(ActiveRoute);
        const ActivePageName = PageForRoute(ActiveRoute);
        const IsAllowedDialogOverride = ActivePageName === "dialog.html" && NextMusicName === "danger";

        if (NextMusicName !== RouteMusicName && !IsAllowedDialogOverride) return;

        CurrentMusicName = NextMusicName;
        const Host = GetAudioHost();
        if (Host && typeof Host.PlayMusic === "function") Host.PlayMusic(CurrentMusicName);
    }

    function ApplyRouteMusic(Route) {
        if (PageForRoute(Route) === "account.html" && CurrentMusicName) return;

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

    function HideFrame(Frame) {
        Frame.style.display = "none";
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
        Frame.style.pointerEvents = "auto";
        Frame.removeAttribute("aria-hidden");
        ActiveFrame = Frame;
        if (PendingFrame === Frame) PendingFrame = null;

        UpdateTitle(Frame);
        DispatchFrameEvent(Frame, "StoryShellActivate", Route);
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
            Frame.style.pointerEvents = "none";
            Frame.setAttribute("aria-hidden", "true");
        } else {
            Frame.style.display = "block";
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

        CurrentRoute = Normalized;
        ApplyRouteMusic(Normalized);

        if (!SkipHistory) SetTopHistory(Normalized, Replace);

        if (Frame.dataset.storyLoaded === "1") {
            PendingFrame = null;
            ActivateFrame(Frame, Normalized);
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

    function Exit(Value, Replace = false) {
        const Url = new URL(String(Value || "auth.html"), GetBaseUrl()).href;
        if (Replace) window.location.replace(Url);
        else window.location.href = Url;
    }

    function Back(Fallback = "main.html") {
        if (CurrentHistoryDepth > 0) {
            window.history.back();
            return;
        }

        const NormalizedFallback = NormalizeRoute(Fallback) || "main.html";
        LoadRoute(NormalizedFallback, { replace: true });
    }

    window.addEventListener("popstate", Event => {
        CurrentHistoryDepth = Math.max(0, Number(Event.state?.StoryRewriteDepth || 0));
        const Route = NormalizeRoute(Event.state?.StoryRewriteRoute) || RouteFromLocation();
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

    const InitialRoute = RouteFromLocation();
    CurrentRoute = InitialRoute;
    CurrentHistoryDepth = 0;
    SetTopHistory(InitialRoute, true);
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