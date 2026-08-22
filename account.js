const AccountSnapshotKey = "StoryRewriteAccountSnapshotV1";
let AccountProfileResult = null;
let AccountData = null;
let AccountSave = null;
let AccountInitialized = false;
let AccountStatus = null;
let AccountMusicSlider = null;
let AccountSoundSlider = null;
let AccountMusicValue = null;
let AccountSoundValue = null;

function GetAccountAuthMarker() {
    const Token = typeof GetAuthToken === "function" ? String(GetAuthToken() || "") : "";
    if (!Token) return "";
    return `${Token.length}:${Token.slice(-8)}`;
}

function CloneAccountSave(Save) {
    try {
        return JSON.parse(JSON.stringify(Save));
    } catch {
        return Save;
    }
}

function ReadAccountSnapshot() {
    try {
        const Snapshot = JSON.parse(localStorage.getItem(AccountSnapshotKey) || "null");
        if (!Snapshot || Snapshot.authMarker !== GetAccountAuthMarker()) return null;
        return Snapshot;
    } catch {
        return null;
    }
}

function WriteAccountSnapshot() {
    if (!AccountProfileResult || !AccountData || !AccountSave) return;

    const Snapshot = {
        authMarker: GetAccountAuthMarker(),
        username: String(AccountProfileResult?.profile?.username || ""),
        lives: Number(AccountSave.lives || 0),
        maxLives: Number(AccountSave.maxLives || 0),
        stars: TotalStars(AccountSave),
        cleared: ClearedStages(AccountSave),
        totalStages: Object.keys(AccountData.stages || {}).length,
        deaths: Number(AccountSave.deaths || 0),
        musicVolume: Number(AccountSave.settings?.musicVolume ?? 0.45),
        soundVolume: Number(AccountSave.settings?.soundVolume ?? 0.75)
    };

    try { localStorage.setItem(AccountSnapshotKey, JSON.stringify(Snapshot)); } catch {}
}

function RenderAccountSnapshot() {
    const Snapshot = ReadAccountSnapshot();
    if (!Snapshot) return;

    document.getElementById("AccountUsername").textContent = Snapshot.username || "Account";
    document.getElementById("AccountLives").textContent = `${Snapshot.lives}/${Snapshot.maxLives}`;
    document.getElementById("AccountStars").textContent = Snapshot.stars;
    document.getElementById("AccountCleared").textContent = `${Snapshot.cleared}/${Snapshot.totalStages}`;
    document.getElementById("AccountDeaths").textContent = Snapshot.deaths;

    const MusicPercent = Math.round(Snapshot.musicVolume * 100);
    const SoundPercent = Math.round(Snapshot.soundVolume * 100);
    const MusicSlider = document.getElementById("MusicVolumeSlider");
    const SoundSlider = document.getElementById("SoundVolumeSlider");
    const MusicValue = document.getElementById("MusicVolumeValue");
    const SoundValue = document.getElementById("SoundVolumeValue");

    if (MusicSlider) MusicSlider.value = MusicPercent;
    if (SoundSlider) SoundSlider.value = SoundPercent;
    if (MusicValue) MusicValue.textContent = `${MusicPercent}%`;
    if (SoundValue) SoundValue.textContent = `${SoundPercent}%`;
}

function GetCosmeticCatalog() {
    const WorldCosmetics = (AccountData?.worlds || [])
        .filter(World => World?.cosmetic?.id)
        .map(World => ({
            ...World.cosmetic,
            worldName: World.name || "World"
        }));

    return [{
        id: "classic",
        name: "Classic Cover",
        description: "The original Story Rewrite book cover.",
        emblem: "◌",
        worldName: "Always available"
    }, ...WorldCosmetics];
}

function RenderCosmetics() {
    const Grid = document.getElementById("CosmeticGrid");
    if (!Grid || !AccountData || !AccountSave) return;

    const Unlocked = new Set(AccountSave.cosmetics?.unlocked || []);
    const Equipped = String(AccountSave.cosmetics?.equipped || "classic");

    Grid.innerHTML = GetCosmeticCatalog().map(Cosmetic => {
        const Available = Cosmetic.id === "classic" || Unlocked.has(Cosmetic.id);
        const Selected = Available && Cosmetic.id === Equipped;
        return `<button class="CosmeticCard ${Selected ? "Selected" : ""} ${Available ? "" : "Locked"}" type="button" data-cosmetic-id="${EscapeText(Cosmetic.id)}" ${Available ? "" : "disabled"}>
            <span class="CosmeticEmblem" aria-hidden="true">${EscapeText(Cosmetic.emblem || "◇")}</span>
            <span class="CosmeticCopy"><strong>${EscapeText(Cosmetic.name)}</strong><small>${Available ? EscapeText(Cosmetic.description) : "Earn 3 stars on " + EscapeText(Cosmetic.worldName) + "."}</small></span>
            <span class="CosmeticState">${Selected ? "Equipped" : Available ? "Equip" : "Locked"}</span>
        </button>`;
    }).join("");

    Grid.querySelectorAll("[data-cosmetic-id]").forEach(Button => {
        Button.addEventListener("click", async () => {
            const CosmeticId = Button.dataset.cosmeticId;
            if (!CosmeticId || CosmeticId === Equipped) return;

            try {
                AccountStatus.textContent = "Equipping bookmark...";
                AccountStatus.classList.remove("Bad", "Good");
                const Save = await SaveEquippedCosmetic(CosmeticId);
                AccountSave = NormalizeSave(AccountData, CloneAccountSave(Save));
                RenderAccountState();
                AccountStatus.textContent = "Bookmark equipped.";
                AccountStatus.classList.add("Good");
            } catch (Error) {
                AccountStatus.textContent = Error.message;
                AccountStatus.classList.add("Bad");
            }
        });
    });
}

function RenderAccountState() {
    if (!AccountProfileResult || !AccountData || !AccountSave) return;

    document.getElementById("AccountUsername").textContent = AccountProfileResult.profile.username;
    document.getElementById("AccountLives").textContent = `${AccountSave.lives}/${AccountSave.maxLives}`;
    document.getElementById("AccountStars").textContent = TotalStars(AccountSave);
    document.getElementById("AccountCleared").textContent = `${ClearedStages(AccountSave)}/${Object.keys(AccountData.stages).length}`;
    document.getElementById("AccountDeaths").textContent = AccountSave.deaths;

    const MusicPercent = Math.round(Number(AccountSave.settings?.musicVolume ?? 0.45) * 100);
    const SoundPercent = Math.round(Number(AccountSave.settings?.soundVolume ?? 0.75) * 100);

    if (AccountMusicSlider) AccountMusicSlider.value = MusicPercent;
    if (AccountSoundSlider) AccountSoundSlider.value = SoundPercent;
    if (AccountMusicValue) AccountMusicValue.textContent = `${MusicPercent}%`;
    if (AccountSoundValue) AccountSoundValue.textContent = `${SoundPercent}%`;

    ApplyStoryCosmetic(AccountSave);
    RenderCosmetics();
    WriteAccountSnapshot();
}

function SyncAccountFromLastKnownState() {
    if (!AccountInitialized || !AccountData) return;

    const LastProfile = typeof GetLastKnownProfileResult === "function"
        ? GetLastKnownProfileResult()
        : null;
    const LastSave = typeof GetLastKnownServerSave === "function"
        ? GetLastKnownServerSave()
        : null;

    if (LastProfile?.profile) AccountProfileResult = LastProfile;
    if (LastSave) AccountSave = NormalizeSave(AccountData, CloneAccountSave(LastSave));

    RenderAccountState();
}

RenderAccountSnapshot();
window.addEventListener("StoryShellActivate", SyncAccountFromLastKnownState);
window.addEventListener("pagehide", () => {
    if (AccountInitialized) WriteAccountSnapshot();
});

document.addEventListener("DOMContentLoaded", async () => {
    AccountStatus = document.getElementById("AccountStatus");
    AccountMusicSlider = document.getElementById("MusicVolumeSlider");
    AccountSoundSlider = document.getElementById("SoundVolumeSlider");
    AccountMusicValue = document.getElementById("MusicVolumeValue");
    AccountSoundValue = document.getElementById("SoundVolumeValue");

    try {
        AccountProfileResult = await RequireAccount();
        AccountData = await LoadStoryData();
        AccountSave = await LoadSave(AccountData);
        AccountInitialized = true;

        RenderAccountState();
        StoryAudio.Configure(AccountSave.settings);
    } catch (Error) {
        AccountStatus.textContent = Error.message;
        AccountStatus.classList.add("Bad");
        return;
    }

    function UpdateVolumeLabels() {
        AccountMusicValue.textContent = `${AccountMusicSlider.value}%`;
        AccountSoundValue.textContent = `${AccountSoundSlider.value}%`;
    }

    async function SaveVolumes() {
        UpdateVolumeLabels();
        AccountStatus.textContent = "Saving settings...";
        AccountStatus.classList.remove("Bad", "Good");

        try {
            const Music = Number(AccountMusicSlider.value) / 100;
            const Sound = Number(AccountSoundSlider.value) / 100;
            await SaveAudioSettings(Music, Sound);

            AccountSave.settings = {
                ...(AccountSave.settings || {}),
                musicVolume: Music,
                soundVolume: Sound
            };

            RenderAccountState();
            StoryAudio.Configure({ musicVolume: Music, soundVolume: Sound });
            AccountStatus.textContent = "Settings saved.";
            AccountStatus.classList.add("Good");
        } catch (Error) {
            AccountStatus.textContent = Error.message;
            AccountStatus.classList.add("Bad");
        }
    }

    AccountMusicSlider.addEventListener("input", UpdateVolumeLabels);
    AccountSoundSlider.addEventListener("input", UpdateVolumeLabels);
    AccountMusicSlider.addEventListener("change", SaveVolumes);
    AccountSoundSlider.addEventListener("change", SaveVolumes);

    document.getElementById("ResetProgressButton").addEventListener("click", async () => {
        const Confirmed = await StoryConfirm({
            title: "Reset all progress?",
            message: "Your stars, unlocked stages, lives, and current story position will be reset. Your account will stay signed in.",
            confirmText: "Reset Progress",
            cancelText: "Keep Progress",
            danger: true
        });

        if (!Confirmed) return;

        try {
            AccountStatus.textContent = "Resetting progress...";
            AccountStatus.classList.remove("Bad", "Good");
            AccountSave = await ResetServerSave();
            AccountSave = NormalizeSave(AccountData, CloneAccountSave(AccountSave));
            RenderAccountState();
            StoryAudio.Configure(AccountSave.settings);
            AccountStatus.textContent = "Progress reset.";
            AccountStatus.classList.add("Good");
        } catch (Error) {
            AccountStatus.textContent = Error.message;
            AccountStatus.classList.add("Bad");
        }
    });

    document.getElementById("DeleteAccountButton").addEventListener("click", async () => {
        const Username = AccountProfileResult?.profile?.username || "this account";
        const Confirmed = await StoryConfirm({
            title: `Delete ${Username}?`,
            message: "This permanently deletes the account and all Story Rewrite progress. This cannot be undone.",
            confirmText: "Delete Account",
            cancelText: "Cancel",
            danger: true
        });

        if (!Confirmed) return;

        const Button = document.getElementById("DeleteAccountButton");
        Button.disabled = true;
        Button.textContent = "Deleting...";
        AccountStatus.textContent = "Deleting account...";
        AccountStatus.classList.remove("Bad", "Good");

        try {
            await DeleteAccount();
            localStorage.removeItem(AccountSnapshotKey);

            try {
                if (window.parent !== window && window.parent.StoryShell?.IsPersistentShell) {
                    window.parent.StoryShell.Exit("auth.html", true);
                    return;
                }
            } catch {}

            window.location.replace(BuildStoryUrl("auth.html"));
        } catch (Error) {
            Button.disabled = false;
            Button.textContent = "Delete Account";
            AccountStatus.textContent = Error.message;
            AccountStatus.classList.add("Bad");
        }
    });

    document.getElementById("SignOutButton").addEventListener("click", () => {
        localStorage.removeItem(AccountSnapshotKey);
        LogoutAccount();
    });
});