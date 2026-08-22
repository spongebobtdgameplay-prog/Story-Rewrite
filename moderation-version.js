const REQUIRED_MODERATION_SERVER_VERSION = 18;

if (typeof EnsureBackendVersion === "function") {
    const BaseModerationVersionCheck = EnsureBackendVersion;

    EnsureBackendVersion = async function() {
        const Health = await BaseModerationVersionCheck();
        const Version = Number(Health?.version || 0);

        if (Version < REQUIRED_MODERATION_SERVER_VERSION) {
            throw new Error("MULTIPLAYER_UPDATING");
        }

        return Health;
    };
}
