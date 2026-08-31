const AccountSnapshotKey = "StoryRewriteAccountSnapshotV1";
const KeepMusicPlayingKey = "StoryRewriteKeepMusicPlayingV1";
let AccountProfileResult = null;
let AccountData = null;
let AccountSave = null;
let AccountInitialized = false;
let AccountStatus = null;
let AccountMusicSlider = null;
let AccountSoundSlider = null;
let AccountMusicValue = null;
let AccountSoundValue = null;
let AccountKeepMusicButton = null;
let AccountKeepMusicState = null;

function ReadKeepMusicPlaying() {
    return localStorage.getItem(KeepMusicPlayingKey) === "1";
}

function RenderKeepMusicPlaying() {
    if (!AccountKeepMusicButton || !AccountKeepMusicState) return;
    const Enabled = ReadKeepMusicPlaying();
    AccountKeepMusicButton.setAttribute("aria-checked", Enabled ? "true" : "false");
    AccountKeepMusicState.textContent = Enabled ? "On" : "Off";
}

function ApplyKeepMusicPlaying(Enabled) {
    try {
        if (window.parent !== window && window.parent.StoryShell?.IsPersistentShell) {
            window.parent.StoryShell.SetKeepMusicPlaying(Enabled);
            return;
        }
    } catch {}

    if (typeof StoryAudio !== "undefined" && typeof StoryAudio.SetKeepMusicPlaying === "function") {
        StoryAudio.SetKeepMusicPlaying(Enabled);
    }
}

function ToggleKeepMusicPlaying() {
    const Enabled = !ReadKeepMusicPlaying();
    localStorage.setItem(KeepMusicPlayingKey, Enabled ? "1" : "0");
    ApplyKeepMusicPlaying(Enabled);
    RenderKeepMusicPlaying();
}

function ApplyAccountAudioSettings(Settings) {
    StoryAudio.Configure(Settings);

    try {
        if (window.parent !== window && window.parent.StoryShell?.IsPersistentShell) {
            window.parent.StoryShell.ConfigureAudio(Settings);
        }
    } catch {}
}

function SetVolumeControl(Slider, ValueElement, Percent) {
    const NormalizedPercent = Math.max(0, Math.min(100, Math.round(Number(Percent) || 0)));
    const PercentText = `${NormalizedPercent}%`;

    if (Slider) {
        Slider.value = NormalizedPercent;
        Slider.style.setProperty("--VolumePercent", PercentText);
        Slider.setAttribute("aria-valuetext", PercentText);
    }

    if (ValueElement) {
        ValueElement.value = PercentText;
        ValueElement.textContent = PercentText;
    }
}

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

    SetVolumeControl(MusicSlider, MusicValue, MusicPercent);
    SetVolumeControl(SoundSlider, SoundValue, SoundPercent);
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
        worldName: "Always available"
    }, ...WorldCosmetics];
}

function GetCosmeticVector(CosmeticId) {
    const Vectors = {
        classic: `<svg viewBox="0 0 24 24" role="presentation"><path d="M5 4.5h10.5A3.5 3.5 0 0 1 19 8v11.5H8.5A3.5 3.5 0 0 0 5 23Z"></path><path d="M8.5 4.5v15A3.5 3.5 0 0 0 5 23"></path><path d="M11 8h5M11 11h5"></path></svg>`,
        "fromville-bookmark": `<svg viewBox="0 0 24 24" role="presentation"><path d="M12 2.5v4"></path><path d="M8 6.5h8l2.5 5.5L12 21l-6.5-9Z"></path><path d="m9 12 3 3 3-3M12 15v3"></path></svg>`,
        "neon-bookmark": `<svg viewBox="0 0 24 24" role="presentation"><path d="M7 3h10v18l-5-3-5 3Z"></path><path d="m13 6-3 6h4l-3 6"></path></svg>`,
        "blackthorn-bookmark": `<svg viewBox="0 0 24 24" role="presentation"><path d="M19 4.5C12.5 3.5 7 7.5 6 14.5c-.4 2.7.7 4.8 2 6.5 1.5-4.8 4.4-8.9 9.5-12.5"></path><path d="M8 17c2.8-.2 5.1-1.5 7-3.8M11 12.5l-2.5-1M14.5 9.5 13 7.5"></path></svg>`,
        "spirit-bookmark": `<svg viewBox="0 0 24 24" role="presentation"><path d="M12.5 2.5c1.2 4-2.3 5.3-.8 8.2 1-1.5 2.3-2.1 3.7-3.2 2.8 3 3.7 6.2 2.1 9.2-1.3 2.5-3.5 4-6.2 4-3.7 0-6.5-2.8-6.5-6.4 0-3.2 2-5.4 4.8-7.4-.2 2.3.3 3.8 1.3 4.7"></path><path d="M12 19c-1.8-.8-2.6-2.2-2.1-3.8.4-1.2 1.3-2.1 2.6-3 .2 1.5 1.8 2.2 1.8 3.8 0 1.2-.8 2.4-2.3 3Z"></path></svg>`,
        "city-bookmark": `<svg viewBox="0 0 24 24" role="presentation"><rect x="3.5" y="5" width="17" height="14" rx="2"></rect><path d="M7 9h4M7 12h7M7 15h5M17 9v6"></path></svg>`
    };

    return Vectors[CosmeticId] || Vectors.classic;
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
            <span class="CosmeticEmblem" aria-hidden="true">${GetCosmeticVector(Cosmetic.id)}</span>
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

    SetVolumeControl(AccountMusicSlider, AccountMusicValue, MusicPercent);
    SetVolumeControl(AccountSoundSlider, AccountSoundValue, SoundPercent);

    ApplyStoryCosmetic(AccountSave);
    RenderCosmetics();
    WriteAccountSnapshot();
}

function GetCachedAccountProfile() {
    const Profile = typeof GetLastKnownProfileResult === "function"
        ? GetLastKnownProfileResult()
        : null;
    return Profile?.profile ? Profile : null;
}

function GetCachedAccountSave() {
    return typeof GetLastKnownServerSave === "function"
        ? GetLastKnownServerSave()
        : null;
}

async function LoadAccountState() {
    const CachedProfile = GetCachedAccountProfile();
    const CachedSave = GetCachedAccountSave();
    const ProfilePromise = CachedProfile
        ? Promise.resolve(CachedProfile)
        : RequireAccount();

    const [Profile, Data] = await Promise.all([
        ProfilePromise,
        LoadStoryData()
    ]);

    const Save = CachedSave || await FetchServerSave();
    return {
        profile: Profile,
        data: Data,
        save: NormalizeSave(Data, CloneAccountSave(Save))
    };
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
    const AccountBackButton = document.querySelector("[data-story-back]");
    const AccountSource = new URLSearchParams(window.location.search).get("from");
    if (AccountBackButton && AccountSource === "multiplayer") {
        AccountBackButton.dataset.storyBack = "multiplayer.html";
    }

    AccountStatus = document.getElementById("AccountStatus");
    AccountMusicSlider = document.getElementById("MusicVolumeSlider");
    AccountSoundSlider = document.getElementById("SoundVolumeSlider");
    AccountMusicValue = document.getElementById("MusicVolumeValue");
    AccountSoundValue = document.getElementById("SoundVolumeValue");
    AccountKeepMusicButton = document.getElementById("KeepMusicPlayingButton");
    AccountKeepMusicState = document.getElementById("KeepMusicPlayingState");

    RenderKeepMusicPlaying();
    ApplyKeepMusicPlaying(ReadKeepMusicPlaying());
    AccountKeepMusicButton.addEventListener("click", ToggleKeepMusicPlaying);

    try {
        const LoadedState = await LoadAccountState();
        AccountProfileResult = LoadedState.profile;
        AccountData = LoadedState.data;
        AccountSave = LoadedState.save;
        AccountInitialized = true;

        RenderAccountState();
    } catch (Error) {
        AccountStatus.textContent = Error.message;
        AccountStatus.classList.add("Bad");
        return;
    }

    function UpdateVolumeLabels() {
        SetVolumeControl(AccountMusicSlider, AccountMusicValue, AccountMusicSlider.value);
        SetVolumeControl(AccountSoundSlider, AccountSoundValue, AccountSoundSlider.value);
        ApplyAccountAudioSettings({
            musicVolume: Number(AccountMusicSlider.value) / 100,
            soundVolume: Number(AccountSoundSlider.value) / 100
        });
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

    document.getElementById("SwitchAccountButton").addEventListener("click", () => {
        const Username = String(AccountProfileResult?.profile?.username || "").trim();
        localStorage.removeItem(AccountSnapshotKey);

        if (typeof BeginAccountSwitch === "function") {
            BeginAccountSwitch(Username);
            return;
        }

        LogoutAccount();
    });

    document.getElementById("SignOutButton").addEventListener("click", () => {
        localStorage.removeItem(AccountSnapshotKey);
        LogoutAccount();
    });
});