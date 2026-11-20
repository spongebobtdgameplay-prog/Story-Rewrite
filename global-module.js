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
            position: String(Definition.position || "center center")
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
            radial-gradient(760px 460px at 100% 10%, rgba(120, 71, 36, .13), transparent 64%),
            #17110d
        `
    });

    function DetectTheme() {
        const Body = document.body;
        if (!Body) return "parchment";
        const Explicit = String(Body.dataset.storyGradientTheme || "").trim().toLowerCase();
        if (Explicit) return Explicit;
        if (Body.classList.contains("ThinkPage")) return "think";
        if (Body.classList.contains("LevelSelectPage")) return "levels";
        if (Body.classList.contains("MultiplayerPage")) return "multiplayer";
        if (Body.classList.contains("AccountPage")) return "account";
        if (Body.classList.contains("paper-body")) return "paper";
        return "parchment";
    }

    function SetTheme(Name) {
        const Key = String(Name || "").trim().toLowerCase();
        const Definition = Registry.get(Key);
        if (!Definition) return false;
        Root.dataset.storyGradient = Key;
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
