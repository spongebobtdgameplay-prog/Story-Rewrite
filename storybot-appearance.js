"use strict";

const STORY_BOT_APPEARANCE_KEY = "StoryRewriteStoryBotAppearanceV1";
const STORY_BOT_APPEARANCE_DEFAULTS = Object.freeze({ font: "system", size: 14, theme: "classic" });
const STORY_BOT_FONT_STACKS = Object.freeze({
    system: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    serif: 'Georgia, "Times New Roman", serif',
    rounded: '"Trebuchet MS", "Segoe UI", sans-serif',
    mono: 'ui-monospace, SFMono-Regular, Consolas, monospace'
});
const STORY_BOT_THEMES = new Set(["classic", "midnight", "violet", "paper"]);

function ReadStoryBotAppearance() {
    try {
        const Saved = JSON.parse(localStorage.getItem(STORY_BOT_APPEARANCE_KEY) || "{}");
        const Font = Object.prototype.hasOwnProperty.call(STORY_BOT_FONT_STACKS, Saved.font)
            ? Saved.font
            : STORY_BOT_APPEARANCE_DEFAULTS.font;
        const RawSize = Number(Saved.size);
        const Size = Number.isFinite(RawSize)
            ? Math.max(12, Math.min(18, Math.round(RawSize)))
            : STORY_BOT_APPEARANCE_DEFAULTS.size;
        const Theme = STORY_BOT_THEMES.has(Saved.theme) ? Saved.theme : STORY_BOT_APPEARANCE_DEFAULTS.theme;
        return { font: Font, size: Size, theme: Theme };
    } catch {
        return { ...STORY_BOT_APPEARANCE_DEFAULTS };
    }
}

function ApplyStoryBotAppearance(Preferences = ReadStoryBotAppearance()) {
    const Root = document.documentElement;
    if (!Root) return Preferences;
    const Safe = {
        font: Object.prototype.hasOwnProperty.call(STORY_BOT_FONT_STACKS, Preferences?.font)
            ? Preferences.font
            : STORY_BOT_APPEARANCE_DEFAULTS.font,
        size: Math.max(12, Math.min(18, Math.round(Number(Preferences?.size) || STORY_BOT_APPEARANCE_DEFAULTS.size))),
        theme: STORY_BOT_THEMES.has(Preferences?.theme) ? Preferences.theme : STORY_BOT_APPEARANCE_DEFAULTS.theme
    };
    Root.dataset.storybotTheme = Safe.theme;
    Root.style.setProperty("--storybot-font-family", STORY_BOT_FONT_STACKS[Safe.font]);
    Root.style.setProperty("--storybot-font-size", Safe.size + "px");
    return Safe;
}

function ReadStoryBotAppearanceControls() {
    const Font = document.getElementById("StoryBotFontFamily");
    const Size = document.getElementById("StoryBotFontSize");
    const Theme = document.getElementById("StoryBotTheme");
    if (!Font || !Size || !Theme) return null;
    return {
        font: Font.value,
        size: Number(Size.value),
        theme: Theme.value
    };
}

function SaveStoryBotAppearanceFromControls() {
    const Preferences = ReadStoryBotAppearanceControls();
    if (!Preferences) return;
    const Status = document.getElementById("StoryBotAppearanceStatus");
    const Safe = ApplyStoryBotAppearance(Preferences);
    try {
        localStorage.setItem(STORY_BOT_APPEARANCE_KEY, JSON.stringify(Safe));
        if (Status) {
            Status.textContent = "Appearance saved on this device. Your StoryBot chats will use it.";
            Status.className = "StoryBotAppearanceStatus Good";
        }
    } catch {
        if (Status) {
            Status.textContent = "This browser could not save the appearance settings.";
            Status.className = "StoryBotAppearanceStatus Bad";
        }
    }
}

function InitializeStoryBotAppearance() {
    const Preferences = ReadStoryBotAppearance();
    ApplyStoryBotAppearance(Preferences);

    const Font = document.getElementById("StoryBotFontFamily");
    const Size = document.getElementById("StoryBotFontSize");
    const SizeValue = document.getElementById("StoryBotFontSizeValue");
    const Theme = document.getElementById("StoryBotTheme");
    if (!Font || !Size || !Theme) return;

    Font.value = Preferences.font;
    Size.value = String(Preferences.size);
    Theme.value = Preferences.theme;
    if (SizeValue) SizeValue.textContent = Preferences.size + " px";

    Font.addEventListener("change", SaveStoryBotAppearanceFromControls);
    Theme.addEventListener("change", SaveStoryBotAppearanceFromControls);
    Size.addEventListener("input", () => {
        if (SizeValue) SizeValue.textContent = String(Size.value) + " px";
        SaveStoryBotAppearanceFromControls();
    });
}

window.StoryBotAppearance = Object.freeze({
    read: ReadStoryBotAppearance,
    apply: ApplyStoryBotAppearance,
    key: STORY_BOT_APPEARANCE_KEY
});

window.addEventListener("storage", Event => {
    if (Event.key === STORY_BOT_APPEARANCE_KEY) ApplyStoryBotAppearance();
});

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", InitializeStoryBotAppearance, { once: true });
} else {
    InitializeStoryBotAppearance();
}
