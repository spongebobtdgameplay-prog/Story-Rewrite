const KeepMusicPlayingKey = "StoryRewriteKeepMusicPlayingV1";
let SettingsSave = null;
let SettingsInitialized = false;
let MusicSlider = null;
let SoundSlider = null;
let MusicValue = null;
let SoundValue = null;
let KeepMusicButton = null;
let KeepMusicState = null;
let Status = null;

function CloneSettingsSave(Save) {
    try { return JSON.parse(JSON.stringify(Save)); } catch { return Save; }
}

function ReadKeepMusicPlaying() {
    try { return localStorage.getItem(KeepMusicPlayingKey) === "1"; } catch { return false; }
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

function RenderKeepMusicPlaying() {
    if (!KeepMusicButton || !KeepMusicState) return;
    const Enabled = ReadKeepMusicPlaying();
    KeepMusicButton.setAttribute("aria-checked", Enabled ? "true" : "false");
    KeepMusicState.textContent = Enabled ? "On" : "Off";
}

function SetVolumeControl(Slider, Output, Value) {
    const Percent = Math.max(0, Math.min(100, Math.round((Number(Value) || 0) * 100)));
    Slider.value = Percent;
    Output.textContent = `${Percent}%`;
    Slider.setAttribute("aria-valuetext", `${Percent}%`);
}

function ApplyAudio(Settings) {
    const Next = {
        musicVolume: Math.max(0, Math.min(1, Number(Settings?.musicVolume ?? 0.45))),
        soundVolume: Math.max(0, Math.min(1, Number(Settings?.soundVolume ?? 0.75)))
    };
    if (typeof StoryAudio !== "undefined") StoryAudio.Configure(Next);
    try {
        if (window.parent !== window && window.parent.StoryShell?.IsPersistentShell) {
            window.parent.StoryShell.ConfigureAudio(Next);
        }
    } catch {}
    return Next;
}

function RenderSettings() {
    if (!SettingsSave) return;
    const Audio = SettingsSave.settings || {};
    SetVolumeControl(MusicSlider, MusicValue, Audio.musicVolume ?? 0.45);
    SetVolumeControl(SoundSlider, SoundValue, Audio.soundVolume ?? 0.75);
    ApplyAudio(Audio);
    RenderKeepMusicPlaying();
}

async function SaveVolumes() {
    const Music = Number(MusicSlider.value) / 100;
    const Sound = Number(SoundSlider.value) / 100;
    ApplyAudio({ musicVolume: Music, soundVolume: Sound });
    Status.textContent = "Saving settings...";
    Status.className = "StorySettingsStatus";
    try {
        const Result = await SaveAudioSettings(Music, Sound);
        SettingsSave = NormalizeSave(await LoadStoryData(), CloneSettingsSave(Result?.save || {
            ...SettingsSave,
            settings: { ...(SettingsSave.settings || {}), musicVolume: Music, soundVolume: Sound }
        }));
        RenderSettings();
        Status.textContent = "Settings saved.";
        Status.className = "StorySettingsStatus Good";
    } catch (Error) {
        Status.textContent = Error.message;
        Status.className = "StorySettingsStatus Bad";
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    MusicSlider = document.getElementById("MusicVolumeSlider");
    SoundSlider = document.getElementById("SoundVolumeSlider");
    MusicValue = document.getElementById("MusicVolumeValue");
    SoundValue = document.getElementById("SoundVolumeValue");
    KeepMusicButton = document.getElementById("KeepMusicPlayingButton");
    KeepMusicState = document.getElementById("KeepMusicPlayingState");
    Status = document.getElementById("SettingsStatus");

    document.getElementById("SettingsBuild").textContent =
        typeof STORY_BUILD_VERSION !== "undefined" ? `Build ${STORY_BUILD_VERSION}` : "Settings";

    RenderKeepMusicPlaying();
    ApplyKeepMusicPlaying(ReadKeepMusicPlaying());

    KeepMusicButton.addEventListener("click", () => {
        const Enabled = !ReadKeepMusicPlaying();
        localStorage.setItem(KeepMusicPlayingKey, Enabled ? "1" : "0");
        ApplyKeepMusicPlaying(Enabled);
        RenderKeepMusicPlaying();
    });

    try {
        const [Profile] = await Promise.all([
            RequireAccount(),
            LoadStoryData()
        ]);
        const Data = await LoadStoryData();
        const CachedSave = typeof GetLastKnownServerSave === "function" ? GetLastKnownServerSave() : null;
        const Save = CachedSave || await FetchServerSave();
        SettingsSave = NormalizeSave(Data, CloneSettingsSave(Save));
        SettingsInitialized = true;
        RenderSettings();

        MusicSlider.addEventListener("input", () => SetVolumeControl(MusicSlider, MusicValue, Number(MusicSlider.value) / 100));
        SoundSlider.addEventListener("input", () => SetVolumeControl(SoundSlider, SoundValue, Number(SoundSlider.value) / 100));
        MusicSlider.addEventListener("change", SaveVolumes);
        SoundSlider.addEventListener("change", SaveVolumes);
    } catch (Error) {
        Status.textContent = Error.message;
        Status.className = "StorySettingsStatus Bad";
    }
});
