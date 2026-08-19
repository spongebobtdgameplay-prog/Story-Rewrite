let StoryRealSoundVolume = 0.75;
let StoryRealAudioUnlocked = false;

const StoryRealSoundBase = "https://raw.githubusercontent.com/Calinou/kenney-interface-sounds/master/addons/kenney_interface_sounds/";

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

function GetStoryRealSoundUrl(Name) {
    const File = StoryRealSoundFiles[Name];
    return File ? `${StoryRealSoundBase}${File}` : "";
}

function PreloadStoryRealSounds() {
    if (StoryRealAudioUnlocked) return;
    StoryRealAudioUnlocked = true;

    for (const Name of Object.keys(StoryRealSoundFiles)) {
        const AudioElement = new Audio();
        AudioElement.preload = "auto";
        AudioElement.src = GetStoryRealSoundUrl(Name);
        AudioElement.volume = Math.max(0, Math.min(1, StoryRealSoundVolume));
        StoryRealSoundCache.set(Name, AudioElement);
        AudioElement.load();
    }
}

function PlayStoryRealSound(Name) {
    const Template = StoryRealSoundCache.get(Name);
    const Url = GetStoryRealSoundUrl(Name);
    if (!Url || StoryRealSoundVolume <= 0) return false;

    const AudioElement = Template ? Template.cloneNode(true) : new Audio(Url);
    AudioElement.volume = Math.max(0, Math.min(1, StoryRealSoundVolume));
    AudioElement.currentTime = 0;

    const PlayPromise = AudioElement.play();
    if (PlayPromise && typeof PlayPromise.catch === "function") PlayPromise.catch(() => {});
    return true;
}

if (typeof StoryAudio !== "undefined") {
    const BaseConfigure = StoryAudio.Configure.bind(StoryAudio);
    const BasePlaySound = StoryAudio.PlaySound.bind(StoryAudio);

    StoryAudio.Configure = function(Settings = {}) {
        const NextVolume = Number(Settings.soundVolume);
        if (Number.isFinite(NextVolume)) StoryRealSoundVolume = Math.max(0, Math.min(1, NextVolume));

        for (const AudioElement of StoryRealSoundCache.values()) {
            AudioElement.volume = StoryRealSoundVolume;
        }

        return BaseConfigure(Settings);
    };

    StoryAudio.PlaySound = function(Name) {
        if (!StoryRealAudioUnlocked || !StoryRealSoundFiles[Name]) {
            return BasePlaySound(Name);
        }

        if (!PlayStoryRealSound(Name)) return BasePlaySound(Name);
    };
}

document.addEventListener("pointerdown", PreloadStoryRealSounds, { capture: true, passive: true, once: true });
document.addEventListener("keydown", PreloadStoryRealSounds, { capture: true, once: true });
document.addEventListener("touchstart", PreloadStoryRealSounds, { capture: true, passive: true, once: true });
