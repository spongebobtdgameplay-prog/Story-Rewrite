(() => {
    const Frame = document.getElementById("StoryShellFrame");
    if (!Frame) return;

    const ManagedPages = new Set([
        "main.html",
        "levels.html",
        "dialog.html",
        "multiplayer.html",
        "tutorial.html",
        "rules.html",
        "account.html"
    ]);

    let CurrentRoute = "";
    let CurrentMusicName = "";
    let LoadingFromShell = false;

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
            return `${PageName}${Url.search}${Url.hash}`;
        } catch {
            return "";
        }
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

    function MusicForRoute(Route) {
        try {
            const Url = new URL(Route, GetBaseUrl());
            const PageName = Url.pathname.split("/").pop() || "main.html";

            if (PageName === "multiplayer.html") return "lobby";

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
        CurrentMusicName = String(Name || "");
        if (CurrentMusicName && typeof StoryAudio !== "undefined") StoryAudio.PlayMusic(CurrentMusicName);
    }

    function ApplyRouteMusic(Route) {
        const DesiredMusic = MusicForRoute(Route);
        if (!DesiredMusic || DesiredMusic === CurrentMusicName) return;
        PlayMusic(DesiredMusic);
    }

    function LoadRoute(Route, Options = {}) {
        const Normalized = NormalizeRoute(Route);
        if (!Normalized) return false;

        const Replace = Boolean(Options.replace);
        const SkipHistory = Boolean(Options.skipHistory);
        CurrentRoute = Normalized;
        LoadingFromShell = true;

        ApplyRouteMusic(Normalized);
        if (!SkipHistory) SetTopHistory(Normalized, Replace);
        Frame.src = Normalized;
        return true;
    }

    function Navigate(Value, Options = {}) {
        const Normalized = NormalizeRoute(Value);
        if (!Normalized) return false;
        if (Normalized === CurrentRoute && Frame.contentWindow) return true;
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

    function WireFrameInteractionBridge() {
        let ChildDocument;
        try {
            ChildDocument = Frame.contentDocument;
        } catch {
            ChildDocument = null;
        }

        if (!ChildDocument) return;

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

    function RouteFromFrame() {
        try {
            return NormalizeRoute(Frame.contentWindow.location.href);
        } catch {
            return "";
        }
    }

    Frame.addEventListener("load", () => {
        const Route = RouteFromFrame();
        if (!Route) {
            try {
                const PageName = Frame.contentWindow.location.pathname.split("/").pop();
                if (PageName === "auth.html") Exit("auth.html", true);
            } catch {}
            return;
        }

        if (LoadingFromShell) {
            LoadingFromShell = false;
        } else if (Route !== CurrentRoute) {
            CurrentRoute = Route;
            SetTopHistory(Route, true);
        }

        try {
            const ChildTitle = Frame.contentDocument?.title;
            document.title = ChildTitle || "Story Rewrite";
        } catch {
            document.title = "Story Rewrite";
        }

        ApplyRouteMusic(Route);
        WireFrameInteractionBridge();
    });

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

    const InitialRoute = RouteFromLocation();
    CurrentRoute = InitialRoute;
    SetTopHistory(InitialRoute, true);
    ApplyRouteMusic(InitialRoute);
    LoadingFromShell = true;
    Frame.src = InitialRoute;
})();