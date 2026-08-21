(() => {
    function GetPersistentShellHost() {
        try {
            if (window.parent !== window && window.parent.StoryShell?.IsPersistentShell) return window.parent;
        } catch {}
        return null;
    }

    const ShellHost = GetPersistentShellHost();
    if (!ShellHost || typeof StoryAudio === "undefined") return;

    StoryAudio.Configure = function(Settings = {}) {
        ShellHost.StoryShell.ConfigureAudio(Settings);
    };

    StoryAudio.PlayMusic = function(Name) {
        ShellHost.StoryShell.PlayMusic(Name);
    };

    StoryAudio.StopMusic = function() {
        ShellHost.StoryShell.StopMusic();
    };

    StoryAudio.PlaySound = function(Name) {
        ShellHost.StoryShell.PlaySound(Name);
    };
    StoryAudio.PlaySound.V11Wrapped = true;

    StoryAudio.UnlockAudio = function() {
        ShellHost.StoryShell.NotifyInteraction();
    };

    const NotifyInteraction = () => ShellHost.StoryShell.NotifyInteraction();
    document.addEventListener("pointerdown", NotifyInteraction, { capture: true, passive: true });
    document.addEventListener("touchstart", NotifyInteraction, { capture: true, passive: true });
    document.addEventListener("keydown", NotifyInteraction, { capture: true });
})();
