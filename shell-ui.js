const STORY_BACK_ICON = `
<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M14.5 5 7.5 12l7 7" />
</svg>`;

const STORY_ACCOUNT_ICON = `
<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5.5 20c.7-4 3-6 6.5-6s5.8 2 6.5 6" />
</svg>`;

const STORY_EYE_OPEN_ICON = `
<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M2.5 12s3.7-5.5 9.5-5.5S21.5 12 21.5 12 17.8 17.5 12 17.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="2.7" />
</svg>`;

const STORY_EYE_CLOSED_ICON = `
<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M3 4 21 20" />
    <path d="M6.2 7.1C4 8.5 2.5 12 2.5 12S6.2 17.5 12 17.5c1.6 0 3-.4 4.2-1" />
    <path d="M9.7 6.8c.7-.2 1.5-.3 2.3-.3 5.8 0 9.5 5.5 9.5 5.5s-.8 1.2-2.2 2.5" />
</svg>`;

function StoryNavigate(Page) {
    if (typeof Go === "function") {
        Go(Page);
        return;
    }

    if (typeof BuildStoryUrl === "function") {
        window.location.href = BuildStoryUrl(Page);
        return;
    }

    window.location.href = String(Page || "").replace(/^\/+/, "");
}

function StoryGoBack(FallbackPage = "main.html") {
    let CanUseHistory = false;

    try {
        const Referrer = document.referrer ? new URL(document.referrer) : null;
        CanUseHistory = Boolean(
            Referrer &&
            Referrer.origin === window.location.origin &&
            window.history.length > 1
        );
    } catch {}

    if (CanUseHistory) {
        window.history.back();
        return;
    }

    StoryNavigate(FallbackPage);
}

function WireStoryShell() {
    for (const Button of document.querySelectorAll("[data-story-back]")) {
        Button.innerHTML = STORY_BACK_ICON;
        Button.addEventListener("click", () => StoryGoBack(Button.dataset.storyBack || "main.html"));
    }

    for (const Button of document.querySelectorAll("[data-story-go]")) {
        Button.addEventListener("click", () => StoryNavigate(Button.dataset.storyGo));
    }

    for (const Button of document.querySelectorAll("[data-account-icon]")) {
        const Label = Button.querySelector("span")?.outerHTML || "";
        Button.innerHTML = `${STORY_ACCOUNT_ICON}${Label}`;
    }

    for (const Toggle of document.querySelectorAll("[data-password-toggle]")) {
        const Input = document.getElementById(Toggle.dataset.passwordToggle);
        if (!Input) continue;

        Toggle.innerHTML = STORY_EYE_OPEN_ICON;
        Toggle.setAttribute("aria-label", "Show password");

        Toggle.addEventListener("click", () => {
            const Reveal = Input.type === "password";
            Input.type = Reveal ? "text" : "password";
            Toggle.innerHTML = Reveal ? STORY_EYE_CLOSED_ICON : STORY_EYE_OPEN_ICON;
            Toggle.setAttribute("aria-label", Reveal ? "Hide password" : "Show password");
        });
    }
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", WireStoryShell, { once: true });
} else {
    WireStoryShell();
}
