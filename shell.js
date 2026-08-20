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

    function SetTopHistory(Route, Replace = false) {
        const Url = new URL(window.location.href);
        Url.hash = RouteHash(Route);
        const State = { StoryRewriteRoute: Route };
        if (Replace) window.history.replaceState(State, "", Url);
        else window.history.pushState(State, "", Url);
    }

    function LoadRoute(Route, Options = {}) {
        const Normalized = NormalizeRoute(Route);
        if (!Normalized) return false;

        const Replace = Boolean(Options.replace);
        const SkipHistory = Boolean(Options.skipHistory);
        CurrentRoute = Normalized;
        LoadingFromShell = true;
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

    function PlayMusic(Name) {
        CurrentMusicName = String(Name || "");
        if (CurrentMusicName && window.StoryAudio?.PlayMusic) {
            window.StoryAudio.PlayMusic(CurrentMusicName);
        }
    }

    function StopMusic() {
        CurrentMusicName = "";
        window.StoryAudio?.StopMusic?.();
    }

    function NotifyInteraction() {
        if (CurrentMusicName) window.StoryAudio?.PlayMusic?.(CurrentMusicName);
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
            SetTopHistory(Route, false);
        }

        try {
            const ChildTitle = Frame.contentDocument?.title;
            document.title = ChildTitle || "Story Rewrite";
        } catch {
            document.title = "Story Rewrite";
        }
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
        PlayMusic,
        StopMusic,
        NotifyInteraction,
        GetCurrentRoute: () => CurrentRoute,
        GetCurrentMusic: () => CurrentMusicName
    });

    const InitialRoute = RouteFromLocation();
    CurrentRoute = InitialRoute;
    SetTopHistory(InitialRoute, true);
    LoadingFromShell = true;
    Frame.src = InitialRoute;
})();
