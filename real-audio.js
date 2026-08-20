let StoryRealSoundVolume = 0.75;
let StoryRealAudioUnlocked = false;

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

const StoryRealSoundCache = new Map();

function ClampStorySoundVolume(Value) {
    const NumberValue = Number(Value);
    return Number.isFinite(NumberValue)
        ? Math.max(0, Math.min(1, NumberValue))
        : StoryRealSoundVolume;
}

function GetStoryRealSoundUrls(Name) {
    const File = StoryRealSoundFiles[Name];
    if (!File) return [];
    return StoryRealSoundBases.map(Base => `${Base}${File}`);
}

function BuildStoryRealAudio(Name, SourceIndex = 0) {
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
        const AudioElement = BuildStoryRealAudio(Name, 0);
        if (!AudioElement) continue;
        StoryRealSoundCache.set(Name, AudioElement);
        try {
            AudioElement.load();
        } catch {}
    }
}

function UnlockStoryRealAudio() {
    StoryRealAudioUnlocked = true;
    PreloadStoryRealSounds();
}

async function TryPlayStoryRealSound(Name, SourceIndex) {
    const Urls = GetStoryRealSoundUrls(Name);
    if (!Urls[SourceIndex] || StoryRealSoundVolume <= 0) return false;

    let AudioElement;
    if (SourceIndex === 0 && StoryRealSoundCache.has(Name)) {
        AudioElement = StoryRealSoundCache.get(Name).cloneNode(true);
    } else {
        AudioElement = BuildStoryRealAudio(Name, SourceIndex);
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

PreloadStoryRealSounds();

document.addEventListener("pointerdown", UnlockStoryRealAudio, { capture: true, passive: true });
document.addEventListener("keydown", UnlockStoryRealAudio, { capture: true });
document.addEventListener("touchstart", UnlockStoryRealAudio, { capture: true, passive: true });

if (typeof StoryAudio !== "undefined") {
    const BaseConfigure = StoryAudio.Configure.bind(StoryAudio);
    const BasePlaySound = StoryAudio.PlaySound.bind(StoryAudio);

    StoryAudio.Configure = function(Settings = {}) {
        StoryRealSoundVolume = ClampStorySoundVolume(Settings.soundVolume);

        for (const AudioElement of StoryRealSoundCache.values()) {
            AudioElement.volume = StoryRealSoundVolume;
        }

        return BaseConfigure(Settings);
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
