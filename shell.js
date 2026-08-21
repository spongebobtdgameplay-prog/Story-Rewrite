(() => {
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
    let ActiveFrame = null;
    let CurrentRoute = "";
    let CurrentMusicName = "";

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
            const Search = Url.searchParams.toString();
            return `${PageName}${Search ? `?${Search}` : ""}${Url.hash}`;
        } catch {
            return "";
        }
    }

    function RouteUrl(Route) {
        return new URL(Route, GetBaseUrl()).href;
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
        const State = { StoryRewriteRoute: Route };
        if (Replace) window.history.replaceState(State, "", Url);
        else window.history.pushState(State, "", Url);
    }

    function ConfigureAudio(Settings = {}) {
        if (typeof StoryAudio !== "undefined") StoryAudio.Configure(Settings);
    }

    function PlaySound(Name) {
        if (typeof StoryAudio !== "undefined") StoryAudio.PlaySound(Name);
    }

    function PlayMusic(Name) {
        const NextMusicName = String(Name || "");
        if (!NextMusicName || NextMusicName === CurrentMusicName) return;

        const ActiveRoute = CurrentRoute || RouteFromLocation();
        const RouteMusicName = MusicForRoute(ActiveRoute);
        const ActivePageName = PageForRoute(ActiveRoute);
        const IsAllowedDialogOverride = ActivePageName === "dialog.html" && NextMusicName === "danger";

        if (NextMusicName !== RouteMusicName && !IsAllowedDialogOverride) return;

        CurrentMusicName = NextMusicName;
        if (typeof StoryAudio !== "undefined") StoryAudio.PlayMusic(CurrentMusicName);
    }

    function ApplyRouteMusic(Route) {
        const DesiredMusic = MusicForRoute(Route);
        if (!DesiredMusic || DesiredMusic === CurrentMusicName) return;
        PlayMusic(DesiredMusic);
    }

    function StopMusic() {
        CurrentMusicName = "";
        if (typeof StoryAudio !== "undefined") StoryAudio.StopMusic();
    }

    function NotifyInteraction() {
        if (typeof StoryAudio === "undefined") return;

        if (typeof StoryAudio.UnlockAudio === "function") {
            StoryAudio.UnlockAudio();
            return;
        }

        if (CurrentMusicName) StoryAudio.PlayMusic(CurrentMusicName);
    }

    function IsClickableButton(Target) {
        const Button = Target?.closest?.("button,[role='button']");
        if (!Button || Button.disabled || Button.getAttribute("aria-disabled") === "true") return null;
        return Button;
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

        ChildDocument.addEventListener("pointerdown", Event => {
            NotifyInteraction();
            if (IsClickableButton(Event.target)) PlaySound("click");
        }, { capture: true, passive: true });

        ChildDocument.addEventListener("touchstart", Event => {
            NotifyInteraction();
            if (IsClickableButton(Event.target)) PlaySound("click");
        }, { capture: true, passive: true });

        ChildDocument.addEventListener("keydown", Event => {
            NotifyInteraction();
            if ((Event.key === "Enter" || Event.key === " ") && IsClickableButton(Event.target)) {
                PlaySound("click");
            }
        }, { capture: true });
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

    function DispatchActivation(Frame, Route) {
        if (Frame.dataset.storyLoaded !== "1") return;
        try {
            const ChildWindow = Frame.contentWindow;
            ChildWindow.dispatchEvent(new ChildWindow.CustomEvent("StoryShellActivate", {
                detail: { route: Route }
            }));
        } catch {}
    }

    function HideFrame(Frame) {
        Frame.style.display = "none";
        Frame.style.pointerEvents = "none";
        Frame.setAttribute("aria-hidden", "true");
    }

    function ShowFrame(Frame) {
        for (const Child of Root.querySelectorAll("iframe.StoryShellFrame")) HideFrame(Child);
        Frame.style.display = "block";
        Frame.style.pointerEvents = "auto";
        Frame.removeAttribute("aria-hidden");
        ActiveFrame = Frame;
    }

    function HandleFrameLoad(Frame) {
        Frame.dataset.storyLoaded = "1";
        WireFrameInteractionBridge(Frame);

        const ActualRoute = RouteFromFrame(Frame);
        if (!ActualRoute) {
            try {
                const PageName = Frame.contentWindow.location.pathname.split("/").pop();
                if (PageName === "auth.html" && Frame === ActiveFrame) Exit("auth.html", true);
            } catch {}
            return;
        }

        const PreviousRoute = Frame.dataset.storyRoute || "";
        if (ActualRoute !== PreviousRoute) {
            if (PreviousRoute && PersistentFrames.get(PreviousRoute) === Frame) PersistentFrames.delete(PreviousRoute);
            Frame.dataset.storyRoute = ActualRoute;
            if (IsPersistentRoute(ActualRoute) && !PersistentFrames.has(ActualRoute)) PersistentFrames.set(ActualRoute, Frame);
        }

        if (Frame !== ActiveFrame) return;

        if (ActualRoute !== CurrentRoute) {
            CurrentRoute = ActualRoute;
            SetTopHistory(ActualRoute, true);
            ApplyRouteMusic(ActualRoute);
        }

        UpdateTitle(Frame);
        DispatchActivation(Frame, CurrentRoute);
    }

    function PrepareFrame(Frame, Route) {
        Frame.classList.add("StoryShellFrame");
        Frame.dataset.storyRoute = Route;
        Frame.title = "Story Rewrite";
        Frame.style.display = "none";
        Frame.style.pointerEvents = "none";
        Frame.addEventListener("load", () => HandleFrameLoad(Frame));
    }

    function CreateFrame(Route) {
        const Frame = document.createElement("iframe");
        PrepareFrame(Frame, Route);
        Root.appendChild(Frame);
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

        CurrentRoute = Normalized;
        ApplyRouteMusic(Normalized);
        ShowFrame(Frame);

        if (!SkipHistory) SetTopHistory(Normalized, Replace);
        UpdateTitle(Frame);
        DispatchActivation(Frame, Normalized);
        return true;
    }

    function Navigate(Value, Options = {}) {
        const Normalized = NormalizeRoute(Value);
        if (!Normalized) return false;

        if (Normalized === CurrentRoute && ActiveFrame) {
            DispatchActivation(ActiveFrame, Normalized);
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
        if (window.history.length > 1) {
            window.history.back();
            return;
        }
        Navigate(Fallback, { replace: true });
    }

    window.addEventListener("popstate", Event => {
        const Route = NormalizeRoute(Event.state?.StoryRewriteRoute) || RouteFromLocation();
        LoadRoute(Route, { skipHistory: true });
    });

    window.StoryShell = Object.freeze({
        IsPersistentShell: true,
        Navigate,
        CanHandle: Value => Boolean(NormalizeRoute(Value)),
        Exit,
        Back,
        ConfigureAudio,
        PlaySound,
        PlayMusic,
        StopMusic,
        NotifyInteraction,
        GetCurrentRoute: () => CurrentRoute,
        GetCurrentMusic: () => CurrentMusicName
    });

    PrepareFrame(InitialFrame, "main.html");
    PersistentFrames.set("main.html", InitialFrame);

    try {
        const ReadyState = InitialFrame.contentDocument?.readyState;
        if (ReadyState === "interactive" || ReadyState === "complete") {
            setTimeout(() => HandleFrameLoad(InitialFrame), 0);
        }
    } catch {}

    const InitialRoute = RouteFromLocation();
    CurrentRoute = InitialRoute;
    SetTopHistory(InitialRoute, true);
    ApplyRouteMusic(InitialRoute);
    ShowFrame(GetFrameForRoute(InitialRoute));
})();