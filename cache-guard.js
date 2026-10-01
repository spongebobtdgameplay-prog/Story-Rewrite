(() => {
const CleanupVersion = "20261001-1";

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

    return Changed;
}

function ScheduleLegacyCacheCleanup() {
    const Run = () => ClearLegacyCaches().catch(() => {});
    if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(Run, { timeout: 4000 });
    } else {
        window.setTimeout(Run, 2000);
    }
}

ScheduleLegacyCacheCleanup();
})();
