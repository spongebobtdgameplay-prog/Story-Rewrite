let StoryRealSoundVolume = 0.75;
let StoryRealMusicVolume = 0.45;
let StoryRealAudioUnlocked = false;
let StoryRealMusicElement = null;
let StoryRealMusicName = "";
let StoryPendingMusicName = "";

const StoryRealSoundBases = [
    "https://cdn.jsdelivr.net/gh/Calinou/kenney-interface-sounds@master/addons/kenney_interface_sounds/",
    "https://raw.githubusercontent.com/Calinou/kenney-interface-sounds/master/addons/kenney_interface_sounds/"
];

const StoryRealSoundFiles = {
    click: "click_001.wav",
    cross: "scratch_003.wav",
    restore: "maximize_007.wav",
    join: "open_001.wav",
    message: "select_007.wav",
    ready: "confirmation_001.wav",
    fail: "error_008.wav",
    life: "error_001.wav",
    success: "confirmation_002.wav",
    vote: "tick_001.wav",
    revive: "maximize_001.wav",
    reviveEarned: "confirmation_003.wav",
    heartRefill: "confirmation_004.wav"
};

const StoryRealMusicFiles = {
    menu: "music/menu.mp3",
    lobby: "music/lobby.mp3",
    fromville: "music/fromville.mp3",
    anime: "music/neon-exorcists.mp3",
    "neon-exorcists": "music/neon-exorcists.mp3",
    manor: "music/blackthorn.mp3",
    blackthorn: "music/blackthorn.mp3",
    spirit: "music/spirit-grove.mp3",
    "spirit-grove": "music/spirit-grove.mp3",
    city: "music/false-city.mp3",
    "false-city": "music/false-city.mp3",
    danger: "music/danger.mp3"
};

const StoryRealSoundCache = new Map();
const StoryMusicFadeOutSeconds = 3;
const StoryMusicFadeInSeconds = 1.25;

function ClampStoryAudioVolume(Value, Fallback) {
    const NumberValue = Number(Value);
    return Number.isFinite(NumberValue) ? Math.max(0, Math.min(1, NumberValue)) : Fallback;
}

function GetStoryRealSoundUrls(Name) {
    const File = StoryRealSoundFiles[Name];
    if (!File) return [];
    return StoryRealSoundBases.map(Base => `${Base}${File}`);
}

function BuildStoryRealSound(Name, SourceIndex = 0) {
    const Url = GetStoryRealSoundUrls(Name)[SourceIndex];
    if (!Url) return null;
    const AudioElement = new Audio();
    AudioElement.preload = "auto";
    AudioElement.src = Url;
    AudioElement.volume = StoryRealSoundVolume;
    return AudioElement;
}

function PreloadStoryRealSounds() {
    for (const Name of Object.keys(StoryRealSoundFiles)) {
        if (StoryRealSoundCache.has(Name)) continue;
        const AudioElement = BuildStoryRealSound(Name);
        if (!AudioElement) continue;
        StoryRealSoundCache.set(Name, AudioElement);
        try { AudioElement.load(); } catch {}
    }
}

function ApplyStoryMusicFade(AudioElement) {
    if (!AudioElement || !Number.isFinite(AudioElement.duration) || AudioElement.duration <= 0) return;

    const Time = AudioElement.currentTime;
    const Remaining = AudioElement.duration - Time;
    let Fade = 1;

    if (Time < StoryMusicFadeInSeconds) {
        Fade = Math.min(Fade, Time / StoryMusicFadeInSeconds);
    }

    if (Remaining < StoryMusicFadeOutSeconds) {
        Fade = Math.min(Fade, Math.max(0, Remaining / StoryMusicFadeOutSeconds));
    }

    AudioElement.volume = StoryRealMusicVolume * Math.max(0, Math.min(1, Fade));
}

function StopStoryRealMusic() {
    if (!StoryRealMusicElement) return;
    StoryRealMusicElement.pause();
    StoryRealMusicElement.removeAttribute("src");
    StoryRealMusicElement.load();
    StoryRealMusicElement = null;
    StoryRealMusicName = "";
}

async function StartStoryRealMusic(Name) {
    const Url = StoryRealMusicFiles[Name];
    if (!Url || !StoryRealAudioUnlocked || StoryRealMusicVolume <= 0) return false;

    if (StoryRealMusicElement && StoryRealMusicName === Name) {
        ApplyStoryMusicFade(StoryRealMusicElement);
        if (!StoryRealMusicElement.paused) return true;
        try {
            await StoryRealMusicElement.play();
            return true;
        } catch {
            return false;
        }
    }

    StopStoryRealMusic();

    const AudioElement = new Audio(Url);
    AudioElement.preload = "auto";
    AudioElement.loop = false;
    AudioElement.volume = 0;

    AudioElement.addEventListener("timeupdate", () => ApplyStoryMusicFade(AudioElement));
    AudioElement.addEventListener("loadedmetadata", () => ApplyStoryMusicFade(AudioElement));
    AudioElement.addEventListener("ended", () => {
        if (StoryRealMusicElement !== AudioElement || StoryPendingMusicName !== Name) return;
        AudioElement.currentTime = 0;
        AudioElement.volume = 0;
        AudioElement.play().catch(() => {});
    });

    StoryRealMusicElement = AudioElement;
    StoryRealMusicName = Name;

    try {
        await AudioElement.play();
        return true;
    } catch {
        if (StoryRealMusicElement === AudioElement) StopStoryRealMusic();
        return false;
    }
}

function UnlockStoryRealAudio() {
    StoryRealAudioUnlocked = true;
    PreloadStoryRealSounds();
    if (StoryPendingMusicName) StartStoryRealMusic(StoryPendingMusicName);
}

async function TryPlayStoryRealSound(Name, SourceIndex) {
    const Urls = GetStoryRealSoundUrls(Name);
    if (!Urls[SourceIndex] || StoryRealSoundVolume <= 0) return false;

    const AudioElement = SourceIndex === 0 && StoryRealSoundCache.has(Name)
        ? StoryRealSoundCache.get(Name).cloneNode(true)
        : BuildStoryRealSound(Name, SourceIndex);

    if (!AudioElement) return false;
    AudioElement.volume = StoryRealSoundVolume;

    try {
        AudioElement.currentTime = 0;
        await AudioElement.play();
        return true;
    } catch {
        return false;
    }
}

async function PlayStoryRealSound(Name) {
    if (!StoryRealAudioUnlocked || StoryRealSoundVolume <= 0 || !StoryRealSoundFiles[Name]) return false;
    for (let SourceIndex = 0; SourceIndex < StoryRealSoundBases.length; SourceIndex += 1) {
        if (await TryPlayStoryRealSound(Name, SourceIndex)) return true;
    }
    return false;
}

PreloadStoryRealSounds();
document.addEventListener("pointerdown", UnlockStoryRealAudio, { capture: true, passive: true });
document.addEventListener("keydown", UnlockStoryRealAudio, { capture: true });
document.addEventListener("touchstart", UnlockStoryRealAudio, { capture: true, passive: true });

if (typeof StoryAudio !== "undefined") {
    const BaseConfigure = StoryAudio.Configure.bind(StoryAudio);
    const BasePlaySound = StoryAudio.PlaySound.bind(StoryAudio);
    const BaseStopMusic = StoryAudio.StopMusic.bind(StoryAudio);

    StoryAudio.Configure = function(Settings = {}) {
        StoryRealSoundVolume = ClampStoryAudioVolume(Settings.soundVolume, StoryRealSoundVolume);
        StoryRealMusicVolume = ClampStoryAudioVolume(Settings.musicVolume, StoryRealMusicVolume);

        for (const AudioElement of StoryRealSoundCache.values()) {
            AudioElement.volume = StoryRealSoundVolume;
        }

        if (StoryRealMusicElement) ApplyStoryMusicFade(StoryRealMusicElement);
        if (StoryRealMusicVolume <= 0) StopStoryRealMusic();
        BaseConfigure(Settings);
    };

    StoryAudio.PlayMusic = function(Name) {
        StoryPendingMusicName = Name;
        if (!StoryRealMusicFiles[Name] || !StoryRealAudioUnlocked) return;
        StartStoryRealMusic(Name).then(Played => {
            if (!Played) console.warn(`Real music failed to play: ${Name}`);
        });
    };

    StoryAudio.StopMusic = function() {
        StoryPendingMusicName = "";
        StopStoryRealMusic();
        return BaseStopMusic();
    };

    StoryAudio.PlaySound = function(Name) {
        if (!StoryRealSoundFiles[Name] || !StoryRealAudioUnlocked) return BasePlaySound(Name);
        PlayStoryRealSound(Name).then(Played => {
            if (!Played) BasePlaySound(Name);
        });
    };
}
