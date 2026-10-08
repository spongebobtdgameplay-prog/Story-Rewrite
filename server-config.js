window.STORY_REWRITE_SERVER_URL = "https://story-rewrite-backend.onrender.com";
window.STORY_REWRITE_CANONICAL_URL = "https://story-rewrite-iota.vercel.app";

(() => {
    if (window.top !== window.self) return;

    const ManagedPages = new Set([
        "main.html",
        "levels.html",
        "dialog.html",
        "multiplayer.html",
        "tutorial.html",
        "rules.html",
        "account.html",
        "social.html"
    ]);

    const PageName = (window.location.pathname.split("/").pop() || "").trim();
    if (!ManagedPages.has(PageName)) return;

    const Route = `${PageName}${window.location.search}${window.location.hash}`;
    const ShellUrl = new URL("index.html", window.location.href);
    ShellUrl.hash = encodeURIComponent(Route);
    window.location.replace(ShellUrl.href);
})();
