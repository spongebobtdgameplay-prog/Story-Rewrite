let StoryRealSoundVolume = 0.75;
let StoryRealMusicVolume = 0.45;
let StoryRealAudioUnlocked = false;
let StoryRealMusicName = "";
let StoryRealMusicElement = null;
let StoryRealMusicPlayGeneration = 0;

const StoryAudioAssetVersion = "20260819-21";

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
    menu: "menu",
    lobby: "lobby",
    fromville: "fromville",
    anime: "neon-exorcists",
    "neon-exorcists": "neon-exorcists",
    manor: "blackthorn",
    blackthorn: "blackthorn",
    forest: "spirit-grove",
    "spirit-grove": "spirit-grove",
    city: "false-city",
    "false-city": "false-city",
    danger: "danger"
};

const StoryRealSoundCache = new Map();

function ClampStoryAudioVolume(Value, Fallback) {
    const NumberValue = Number(Value);
    return Number.isFinite(NumberValue)
        ? Math.max(0, Math.min(1, NumberValue))
        : Fallback;
}

function GetStoryRealSoundUrls(Name) {
    const File = StoryRealSoundFiles[Name];
    if (!File) return [];
    return StoryRealSoundBases.map(Base => `${Base}${File}`);
}

function BuildStoryRealSound(Name, SourceIndex = 0) {
    const Urls = GetStoryRealSoundUrls(Name);
    const Url = Urls[SourceIndex];
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
        const AudioElement = BuildStoryRealSound(Name, 0);
        if (!AudioElement) continue;
        StoryRealSoundCache.set(Name, AudioElement);
        try {
            AudioElement.load();
        } catch {}
    }
}

function ResolveStoryRealMusicName(Name) {
    const Key = String(Name || "menu").trim().toLowerCase();
    return StoryRealMusicFiles[Key] || "menu";
}

function BuildStoryRealMusic(Name) {
    const File = ResolveStoryRealMusicName(Name);
    const AudioElement = new Audio();
    AudioElement.preload = "auto";
    AudioElement.loop = true;
    AudioElement.volume = StoryRealMusicVolume;
    AudioElement.playsInline = true;
    AudioElement.dataset.storyMusic = File;
    AudioElement.src = `music/${File}.ogg?v=${StoryAudioAssetVersion}`;
    return AudioElement;
}

function DestroyStoryRealMusicElement() {
    StoryRealMusicPlayGeneration += 1;

    if (!StoryRealMusicElement) return;

    try {
        StoryRealMusicElement.pause();
        StoryRealMusicElement.currentTime = 0;
        StoryRealMusicElement.removeAttribute("src");
        StoryRealMusicElement.load();
    } catch {}

    StoryRealMusicElement = null;
}

function PrepareStoryRealMusic(Name) {
    const File = ResolveStoryRealMusicName(Name);
    StoryRealMusicName = File;

    if (StoryRealMusicElement?.dataset.storyMusic === File) {
        StoryRealMusicElement.volume = StoryRealMusicVolume;
        return StoryRealMusicElement;
    }

    DestroyStoryRealMusicElement();
    StoryRealMusicElement = BuildStoryRealMusic(File);

    try {
        StoryRealMusicElement.load();
    } catch {}

    return StoryRealMusicElement;
}

async function StartPreparedStoryRealMusic() {
    if (!StoryRealAudioUnlocked || StoryRealMusicVolume <= 0 || !StoryRealMusicName) return false;

    const AudioElement = PrepareStoryRealMusic(StoryRealMusicName);
    if (!AudioElement) return false;

    const Generation = ++StoryRealMusicPlayGeneration;
    AudioElement.volume = StoryRealMusicVolume;

    try {
        await AudioElement.play();
        if (Generation !== StoryRealMusicPlayGeneration) {
            AudioElement.pause();
            return false;
        }
        return true;
    } catch {
        return false;
    }
}

function UnlockStoryRealAudio() {
    const WasLocked = !StoryRealAudioUnlocked;
    StoryRealAudioUnlocked = true;

    if (WasLocked) PreloadStoryRealSounds();
    if (StoryRealMusicName && StoryRealMusicVolume > 0) void StartPreparedStoryRealMusic();
}

async function TryPlayStoryRealSound(Name, SourceIndex) {
    const Urls = GetStoryRealSoundUrls(Name);
    if (!Urls[SourceIndex] || StoryRealSoundVolume <= 0) return false;

    let AudioElement;
    if (SourceIndex === 0 && StoryRealSoundCache.has(Name)) {
        AudioElement = StoryRealSoundCache.get(Name).cloneNode(true);
    } else {
        AudioElement = BuildStoryRealSound(Name, SourceIndex);
    }

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

        if (StoryRealMusicElement) {
            StoryRealMusicElement.volume = StoryRealMusicVolume;
            if (StoryRealMusicVolume <= 0) {
                StoryRealMusicElement.pause();
            } else if (StoryRealAudioUnlocked && StoryRealMusicName && StoryRealMusicElement.paused) {
                void StartPreparedStoryRealMusic();
            }
        }

        BaseConfigure(Settings);
    };

    StoryAudio.PlayMusic = function(Name) {
        BaseStopMusic();
        PrepareStoryRealMusic(Name);

        if (StoryRealAudioUnlocked && StoryRealMusicVolume > 0) {
            void StartPreparedStoryRealMusic();
        }
    };

    StoryAudio.StopMusic = function() {
        StoryRealMusicName = "";
        DestroyStoryRealMusicElement();
        BaseStopMusic();
    };

    StoryAudio.PlaySound = function(Name) {
        if (!StoryRealSoundFiles[Name] || !StoryRealAudioUnlocked) {
            return BasePlaySound(Name);
        }

        PlayStoryRealSound(Name).then(Played => {
            if (!Played) BasePlaySound(Name);
        });
    };
}
