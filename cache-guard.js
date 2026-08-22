(() => {
    const CleanupVersion = "20260822-70";
    const ReloadedKey = `StoryRewriteCacheCleanup-${CleanupVersion}-reloaded`;

    async function ClearLegacyCaches() {
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
            const ReloadUrl = new URL(window.location.href);
            ReloadUrl.searchParams.set("fresh", Date.now().toString(36));
            window.location.replace(ReloadUrl.href);
        }
    }

    ClearLegacyCaches();
})();
