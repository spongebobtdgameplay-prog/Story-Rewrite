(() => {
    "use strict";
    const Root = document.documentElement;
    const Registry = new Map();
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

    // Theme gradients are defined once in global-module.css. These references
    // select the preloaded tokens without generating or repainting gradient images.
    RegisterTheme("parchment", {
        image: "var(--story-theme-image-parchment)",
        repeat: "repeat, repeat, no-repeat, no-repeat, no-repeat",
        size: "120px 96px, 120px 96px, 100% 100%, 100% 100%, 100% 100%",
        position: "0 0, 0 0, center center, center center, center center"
    });
    RegisterTheme("paper", {
        image: "var(--story-theme-image-paper)"
    });
    RegisterTheme("social", {
        image: "var(--story-theme-image-social)"
    });
    RegisterTheme("account-settings", {
        image: "none",
        color: "#8d6849"
    });
    RegisterTheme("account", {
        image: "var(--story-theme-image-account)"
    });
    RegisterTheme("multiplayer", {
        image: "var(--story-theme-image-account)"
    });
    RegisterTheme("levels", {
        image: "var(--story-theme-image-levels)"
    });
    RegisterTheme("think", {
        image: "var(--story-theme-image-think)",
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
        version: "1.1.0",
        gradients: Object.freeze({
            registerTheme: RegisterTheme,
            setTheme: SetTheme,
            apply: ApplyTheme,
            detectTheme: DetectTheme,
            getTheme: () => Root.dataset.storyGradient || "",
            themes: () => Array.from(Registry.keys())
        })
    });

    ApplyTheme();
    if (document.body && typeof MutationObserver === "function") {
        const Observer = new MutationObserver(ApplyTheme);
        Observer.observe(document.body, {
            attributes: true,
            attributeFilter: ["class", "data-story-gradient-theme"]
        });
    }
})();
