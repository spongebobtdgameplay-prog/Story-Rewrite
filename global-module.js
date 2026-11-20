(() => {
    "use strict";
    const Root = document.documentElement;
    const Registry = new Map();
    const SurfaceRegistry = new Map();
    const SurfaceCache = new Map();
    const ObservedSurfaces = new WeakSet();
    let SurfaceResizeObserver = null;

    function RegisterSurface(Name, Definition) {
        const Key = String(Name || "").trim().toLowerCase();
        if (!/^[a-z][a-z0-9-]{0,31}$/.test(Key) || !Definition || typeof Definition !== "object") return false;
        if (!Definition.top || !Definition.bottom) return false;
        SurfaceRegistry.set(Key, Object.freeze({
            top: String(Definition.top),
            bottom: String(Definition.bottom),
            highlight: String(Definition.highlight || "rgba(0,0,0,0)"),
            highlightX: Math.max(0, Math.min(1, Number(Definition.highlightX ?? 0.5))),
            highlightY: Math.max(0, Math.min(1, Number(Definition.highlightY ?? 0.5))),
            highlightRadius: Math.max(0.01, Math.min(1, Number(Definition.highlightRadius ?? 0.24)))
        }));
        return true;
    }

    function RenderSurface(Definition, Width, Height) {
        const Canvas = document.createElement("canvas");
        Canvas.width = Width;
        Canvas.height = Height;
        const Context = Canvas.getContext("2d", { alpha: false });
        if (!Context) return "";
        const Base = Context.createLinearGradient(0, 0, 0, Height);
        Base.addColorStop(0, Definition.top);
        Base.addColorStop(1, Definition.bottom);
        Context.fillStyle = Base;
        Context.fillRect(0, 0, Width, Height);

        if (Definition.highlight !== "rgba(0,0,0,0)") {
            const X = Width * Definition.highlightX;
            const Y = Height * Definition.highlightY;
            const FarthestCorner = Math.max(
                Math.hypot(X, Y),
                Math.hypot(Width - X, Y),
                Math.hypot(X, Height - Y),
                Math.hypot(Width - X, Height - Y)
            );
            const Radius = FarthestCorner * Definition.highlightRadius;
            const Glow = Context.createRadialGradient(X, Y, 0, X, Y, Math.max(1, Radius));
            Glow.addColorStop(0, Definition.highlight);
            Glow.addColorStop(1, "rgba(0,0,0,0)");
            Context.fillStyle = Glow;
            Context.fillRect(0, 0, Width, Height);
        }
        return Canvas.toDataURL("image/png");
    }

    function PaintSurface(Element) {
        const Name = String(Element.dataset.storyGradientSurface || "").trim().toLowerCase();
        const Definition = SurfaceRegistry.get(Name);
        if (!Definition) return false;
        const Rect = Element.getBoundingClientRect();
        const Width = Math.max(320, Math.min(1920, Math.round(Element.clientWidth || Rect.width || 1280)));
        const Height = Math.max(320, Math.min(1600, Math.round(Element.clientHeight || Rect.height || 900)));
        const CacheKey = Name + ":" + Width + "x" + Height;
        let Image = SurfaceCache.get(CacheKey);
        if (!Image) {
            Image = RenderSurface(Definition, Width, Height);
            if (!Image) return false;
            SurfaceCache.set(CacheKey, Image);
        }
        Element.style.setProperty("background-color", Definition.bottom, "important");
        Element.style.setProperty("background-image", 'url("' + Image + '")', "important");
        Element.style.setProperty("background-repeat", "no-repeat", "important");
        Element.style.setProperty("background-position", "center center", "important");
        Element.style.setProperty("background-size", "100% 100%", "important");
        Element.style.setProperty("background-attachment", "scroll", "important");
        Element.dataset.storyGradientSurfaceReady = "true";
        Element.dataset.storyGradientSurfaceSize = CacheKey;
        if (SurfaceResizeObserver && !ObservedSurfaces.has(Element)) {
            SurfaceResizeObserver.observe(Element);
            ObservedSurfaces.add(Element);
        }
        return true;
    }

    function ApplySurfaces() {
        const Targets = document.querySelectorAll(
            "[data-story-gradient-surface], .StorySocialChat, .StorySocialChatView"
        );
        Targets.forEach(Element => {
            if (!Element.dataset.storyGradientSurface) {
                Element.dataset.storyGradientSurface = "social-chat";
            }
            const Rect = Element.getBoundingClientRect();
            const Width = Math.max(320, Math.min(1920, Math.round(Element.clientWidth || Rect.width || 1280)));
            const Height = Math.max(320, Math.min(1600, Math.round(Element.clientHeight || Rect.height || 900)));
            const Key = Element.dataset.storyGradientSurface + ":" + Width + "x" + Height;
            if (Element.dataset.storyGradientSurfaceSize !== Key) PaintSurface(Element);
            if (SurfaceResizeObserver && !ObservedSurfaces.has(Element)) {
                SurfaceResizeObserver.observe(Element);
                ObservedSurfaces.add(Element);
            }
        });
    }

    RegisterSurface("social-chat", {
        top: "#352a23",
        bottom: "#28201b",
        highlight: "rgba(216,177,117,.13)",
        highlightX: 0.88,
        highlightY: 0.08,
        highlightRadius: 0.24
    });

    if (typeof ResizeObserver === "function") {
        SurfaceResizeObserver = new ResizeObserver(Entries => {
            for (const Entry of Entries) {
                const Element = Entry.target;
                const Rect = Element.getBoundingClientRect();
                const Width = Math.max(320, Math.min(1920, Math.round(Element.clientWidth || Rect.width || 1280)));
                const Height = Math.max(320, Math.min(1600, Math.round(Element.clientHeight || Rect.height || 900)));
                const Key = Element.dataset.storyGradientSurface + ":" + Width + "x" + Height;
                if (Element.dataset.storyGradientSurfaceSize !== Key) PaintSurface(Element);
            }
        });
    }


    function RegisterTheme(Name, Definition) {
        const Key = String(Name || "").trim().toLowerCase();
        if (!/^[a-z][a-z0-9-]{0,31}$/.test(Key) || !Definition || typeof Definition !== "object") return false;
        const Image = String(Definition.image || "").trim();
        if (!Image || /url\s*\(/i.test(Image)) return false;
        Registry.set(Key, Object.freeze({
            image: Image,
            repeat: String(Definition.repeat || "no-repeat"),
            size: String(Definition.size || "cover"),
            position: String(Definition.position || "center center"),
            color: String(Definition.color || "#4d301f")
        }));
        return true;
    }

    RegisterTheme("parchment", {
        image: `
            radial-gradient(circle at 24px 20px, rgba(57, 31, 15, .22) 0 1px, transparent 1.6px),
            radial-gradient(circle at 89px 62px, rgba(255, 245, 219, .16) 0 1px, transparent 1.6px),
            radial-gradient(circle at 15% 7%, rgba(255, 240, 207, .24), transparent 24%),
            radial-gradient(circle at 84% 16%, rgba(60, 30, 14, .19), transparent 28%),
            linear-gradient(155deg, #b38b61 0%, #8b6848 42%, #6e4c33 72%, #4d301f 100%)
        `,
        repeat: "repeat, repeat, no-repeat, no-repeat, no-repeat",
        size: "120px 96px, 120px 96px, 100% 100%, 100% 100%, 100% 100%",
        position: "0 0, 0 0, center center, center center, center center"
    });
    RegisterTheme("paper", {
        image: `
            radial-gradient(circle at 50% -20%, rgba(255,249,230,.65), transparent 38%),
            linear-gradient(155deg, #b58e66 0%, #8e6748 50%, #573824 100%)
        `
    });
    RegisterTheme("social", {
        image: `
            radial-gradient(circle at 15% 7%, rgba(255,240,207,.24), transparent 24%),
            radial-gradient(circle at 84% 16%, rgba(60,30,14,.19), transparent 28%),
            linear-gradient(155deg,#b38b61 0%,#8b6848 42%,#6e4c33 72%,#4d301f 100%)
        `
    });
    RegisterTheme("account-settings", { image: "none", color: "#8d6849" });
    RegisterTheme("account", {
        image: `
            radial-gradient(circle at 18% 8%, rgba(213, 165, 95, .16), transparent 30%),
            linear-gradient(145deg, #432718 0%, #21130d 48%, #100906 100%)
        `
    });
    RegisterTheme("multiplayer", {
        image: `
            radial-gradient(circle at 18% 8%, rgba(213, 165, 95, .16), transparent 30%),
            linear-gradient(145deg, #432718 0%, #21130d 48%, #100906 100%)
        `
    });
    RegisterTheme("levels", {
        image: `
            radial-gradient(circle at 18% -10%, rgba(211, 160, 94, .18), transparent 31%),
            radial-gradient(circle at 92% 12%, rgba(107, 59, 33, .22), transparent 30%),
            linear-gradient(145deg, #4b2c1d 0%, #23140e 46%, #110a07 100%)
        `
    });
    RegisterTheme("think", {
        image: `
            radial-gradient(900px 520px at 12% -10%, rgba(177, 111, 57, .16), transparent 65%),
            radial-gradient(760px 460px at 100% 10%, rgba(120, 71, 36, .13), transparent 64%)
        `,
        color: "#17110d"
    });

    function DetectTheme() {
        const Body = document.body;
        if (!Body) return "parchment";
        const Explicit = String(Body.dataset.storyGradientTheme || "").trim().toLowerCase();
        if (Explicit) return Explicit;
        if (Body.classList.contains("StorySocialPage")) return "social";
        if (Body.classList.contains("ThinkPage")) return "think";
        if (Body.classList.contains("LevelSelectPage")) return "levels";
        if (Body.classList.contains("MultiplayerPage")) return "multiplayer";
        if (Body.classList.contains("AccountSettingsPage")) return "account-settings";
        if (Body.classList.contains("AccountPage")) return "account";
        if (Body.classList.contains("paper-body")) return "paper";
        return "parchment";
    }

    function SetTheme(Name) {
        const Key = String(Name || "").trim().toLowerCase();
        const Definition = Registry.get(Key);
        if (!Definition) return false;
        Root.dataset.storyGradient = Key;
        Root.style.setProperty("--story-gradient-base", Definition.color);
        Root.style.setProperty("--story-global-gradient-image", Definition.image);
        Root.style.setProperty("--story-global-gradient-repeat", Definition.repeat);
        Root.style.setProperty("--story-global-gradient-size", Definition.size);
        Root.style.setProperty("--story-global-gradient-position", Definition.position);
        return true;
    }

    function ApplyTheme() {
        return SetTheme(DetectTheme());
    }

    window.GlobalModule = Object.freeze({
        version: "1.0.0",
        gradients: Object.freeze({
            registerTheme: RegisterTheme,
            setTheme: SetTheme,
            apply: ApplyTheme,
            detectTheme: DetectTheme,
            getTheme: () => Root.dataset.storyGradient || "",
            themes: () => Array.from(Registry.keys()),
            registerSurface: RegisterSurface,
            applySurfaces: ApplySurfaces,
            surfaceThemes: () => Array.from(SurfaceRegistry.keys())
        })
    });

    ApplyTheme();
    ApplySurfaces();
    if (typeof MutationObserver === "function" && document.body) {
        const SurfaceObserver = new MutationObserver(ApplySurfaces);
        SurfaceObserver.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["data-story-gradient-surface"]
        });
    }
    window.addEventListener("resize", ApplySurfaces, { passive: true });
    if (document.body && typeof MutationObserver === "function") {
        const Observer = new MutationObserver(ApplyTheme);
        Observer.observe(document.body, {
            attributes: true,
            attributeFilter: ["class", "data-story-gradient-theme"]
        });
    }
})();
