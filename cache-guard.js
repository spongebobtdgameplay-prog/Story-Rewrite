(() => {
    const CleanupVersion = "20260821-60";
    const CompletedKey = `StoryRewriteCacheCleanup-${CleanupVersion}`;
    const ReloadedKey = `${CompletedKey}-reloaded`;

    async function ClearLegacyCaches() {
        if (sessionStorage.getItem(CompletedKey) === "1") return;
        sessionStorage.setItem(CompletedKey, "1");

        let Changed = false;

        try {
            const Registrations = await navigator.serviceWorker?.getRegistrations?.() || [];
            const Results = await Promise.all(Registrations.map(Registration => Registration.unregister()));
            Changed = Results.some(Boolean) || Changed;
        } catch {}

        try {
            const Names = await caches?.keys?.() || [];
            if (Names.length > 0) {
                await Promise.all(Names.map(Name => caches.delete(Name)));
                Changed = true;
            }
        } catch {}

        if (Changed && window.top === window && sessionStorage.getItem(ReloadedKey) !== "1") {
            sessionStorage.setItem(ReloadedKey, "1");
            window.location.replace(window.location.href);
        }
    }

    ClearLegacyCaches();
})();
