let StoryRealSoundVolume = 0.75;
let StoryRealMusicVolume = 0.45;
let StoryRealAudioUnlocked = false;
let StoryRealMusicElement = null;
let StoryRealMusicName = "";
let StoryPendingMusicName = "";
let StoryRealMusicObjectUrl = "";
let StoryMusicInstallPrompt = null;
let StoryMusicInstallInput = null;

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

const StoryMusicTrackAliases = {
    menu: "menu",
    lobby: "lobby",
    fromville: "fromville",
    anime: "neon-exorcists",
    "neon-exorcists": "neon-exorcists",
    manor: "blackthorn",
    blackthorn: "blackthorn",
    spirit: "spirit-grove",
    "spirit-grove": "spirit-grove",
    city: "false-city",
    "false-city": "false-city",
    danger: "danger"
};

const StoryMusicOriginalNames = {
    "the_watchful_timber": "menu",
    "hollow_timber": "lobby",
    "twelve_tolls_at_midnight": "fromville",
    "under_the_floorboards": "neon-exorcists",
    "the_unopened_chapter": "blackthorn",
    "the_ticking_corridor": "spirit-grove",
    "beneath_the_iron_gate": "false-city",
    "beneath_the_floorboards": "danger"
};

const StoryMusicTrackOrder = [
    "menu",
    "lobby",
    "fromville",
    "neon-exorcists",
    "blackthorn",
    "spirit-grove",
    "false-city",
    "danger"
];

const StoryRealSoundCache = new Map();
const StoryMusicFadeOutSeconds = 3;
const StoryMusicFadeInSeconds = 1.25;
const StoryMusicDatabaseName = "StoryRewriteLocalAudio";
const StoryMusicDatabaseVersion = 1;
const StoryMusicStoreName = "tracks";

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

function OpenStoryMusicDatabase() {
    return new Promise((Resolve, Reject) => {
        if (!("indexedDB" in window)) {
            Reject(new Error("IndexedDB is unavailable."));
            return;
        }

        const Request = indexedDB.open(StoryMusicDatabaseName, StoryMusicDatabaseVersion);
        Request.onupgradeneeded = () => {
            const Database = Request.result;
            if (!Database.objectStoreNames.contains(StoryMusicStoreName)) {
                Database.createObjectStore(StoryMusicStoreName);
            }
        };
        Request.onsuccess = () => Resolve(Request.result);
        Request.onerror = () => Reject(Request.error || new Error("Could not open local soundtrack storage."));
    });
}

async function ReadStoryMusicBlob(TrackName) {
    const Database = await OpenStoryMusicDatabase();
    return new Promise((Resolve, Reject) => {
        const Transaction = Database.transaction(StoryMusicStoreName, "readonly");
        const Request = Transaction.objectStore(StoryMusicStoreName).get(TrackName);
        Request.onsuccess = () => Resolve(Request.result instanceof Blob ? Request.result : null);
        Request.onerror = () => Reject(Request.error || new Error("Could not read local soundtrack."));
        Transaction.oncomplete = () => Database.close();
        Transaction.onerror = () => Database.close();
    });
}

async function WriteStoryMusicBlobs(TrackMap) {
    const Database = await OpenStoryMusicDatabase();
    await new Promise((Resolve, Reject) => {
        const Transaction = Database.transaction(StoryMusicStoreName, "readwrite");
        const Store = Transaction.objectStore(StoryMusicStoreName);
        for (const [TrackName, BlobValue] of Object.entries(TrackMap)) Store.put(BlobValue, TrackName);
        Transaction.oncomplete = Resolve;
        Transaction.onerror = () => Reject(Transaction.error || new Error("Could not save local soundtrack."));
        Transaction.onabort = () => Reject(Transaction.error || new Error("Local soundtrack save was cancelled."));
    });
    Database.close();
}

async function HasCompleteLocalSoundtrack() {
    for (const TrackName of StoryMusicTrackOrder) {
        if (!(await ReadStoryMusicBlob(TrackName))) return false;
    }
    return true;
}

function NormalizeStoryMusicFileName(FileName) {
    return String(FileName || "")
        .replace(/\.[^.]+$/, "")
        .replace(/\(\d+\)$/g, "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
}

function MapStoryMusicFiles(FileList) {
    const Files = Array.from(FileList || []);
    const TrackMap = {};

    for (const File of Files) {
        const NormalizedName = NormalizeStoryMusicFileName(File.name);
        const TrackName = StoryMusicOriginalNames[NormalizedName] || StoryMusicTrackOrder.find(Name => NormalizedName === Name.replaceAll("-", "_"));
        if (TrackName) TrackMap[TrackName] = File;
    }

    if (Object.keys(TrackMap).length !== StoryMusicTrackOrder.length && Files.length === StoryMusicTrackOrder.length) {
        StoryMusicTrackOrder.forEach((TrackName, Index) => {
            if (!TrackMap[TrackName]) TrackMap[TrackName] = Files[Index];
        });
    }

    return TrackMap;
}

function RemoveStoryMusicInstallPrompt() {
    if (StoryMusicInstallPrompt) StoryMusicInstallPrompt.remove();
    if (StoryMusicInstallInput) StoryMusicInstallInput.remove();
    StoryMusicInstallPrompt = null;
    StoryMusicInstallInput = null;
}

function ShowStoryMusicInstallPrompt() {
    if (StoryMusicInstallPrompt || !document.body) return;

    const Panel = document.createElement("div");
    Panel.setAttribute("role", "dialog");
    Panel.setAttribute("aria-label", "Install soundtrack");
    Panel.style.cssText = "position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:100000;max-width:min(92vw,520px);padding:14px 16px;border:1px solid rgba(255,255,255,.18);border-radius:14px;background:rgba(10,14,20,.96);box-shadow:0 18px 55px rgba(0,0,0,.45);color:#fff;font:600 14px/1.4 system-ui,sans-serif;display:flex;gap:12px;align-items:center;flex-wrap:wrap";

    const Text = document.createElement("span");
    Text.textContent = "Install the 8 soundtrack MP3s once. They stay on this device and play locally.";
    Text.style.cssText = "flex:1 1 260px";

    const Button = document.createElement("button");
    Button.type = "button";
    Button.textContent = "Choose 8 MP3s";
    Button.style.cssText = "border:0;border-radius:10px;padding:10px 13px;font:700 14px system-ui,sans-serif;cursor:pointer";

    const Input = document.createElement("input");
    Input.type = "file";
    Input.accept = "audio/mpeg,.mp3,audio/*";
    Input.multiple = true;
    Input.hidden = true;

    Button.addEventListener("click", () => Input.click());
    Input.addEventListener("change", async () => {
        const TrackMap = MapStoryMusicFiles(Input.files);
        const Missing = StoryMusicTrackOrder.filter(Name => !(TrackMap[Name] instanceof Blob));
        if (Missing.length) {
            Text.textContent = `Choose all 8 soundtrack files. Missing: ${Missing.join(", ")}.`;
            return;
        }

        Button.disabled = true;
        Text.textContent = "Saving soundtrack on this device...";
        try {
            await WriteStoryMusicBlobs(TrackMap);
            RemoveStoryMusicInstallPrompt();
            if (StoryPendingMusicName) StartStoryRealMusic(StoryPendingMusicName);
        } catch (Error) {
            console.error(Error);
            Button.disabled = false;
            Text.textContent = "Could not save the soundtrack locally. Try choosing the files again.";
        }
    });

    Panel.append(Text, Button, Input);
    document.body.appendChild(Panel);
    StoryMusicInstallPrompt = Panel;
    StoryMusicInstallInput = Input;
}

async function GetStoryMusicBlobUrl(Name) {
    const TrackName = StoryMusicTrackAliases[Name];
    if (!TrackName) return "";

    const BlobValue = await ReadStoryMusicBlob(TrackName);
    if (!BlobValue) {
        ShowStoryMusicInstallPrompt();
        return "";
    }

    return URL.createObjectURL(BlobValue);
}

function ApplyStoryMusicFade(AudioElement) {
    if (!AudioElement || !Number.isFinite(AudioElement.duration) || AudioElement.duration <= 0) return;
    const Time = AudioElement.currentTime;
    const Remaining = AudioElement.duration - Time;
    let Fade = 1;
    if (Time < StoryMusicFadeInSeconds) Fade = Math.min(Fade, Time / StoryMusicFadeInSeconds);
    if (Remaining < StoryMusicFadeOutSeconds) Fade = Math.min(Fade, Math.max(0, Remaining / StoryMusicFadeOutSeconds));
    AudioElement.volume = StoryRealMusicVolume * Math.max(0, Math.min(1, Fade));
}

function ReleaseStoryMusicObjectUrl() {
    if (!StoryRealMusicObjectUrl) return;
    URL.revokeObjectURL(StoryRealMusicObjectUrl);
    StoryRealMusicObjectUrl = "";
}

function StopStoryRealMusic() {
    if (StoryRealMusicElement) {
        StoryRealMusicElement.pause();
        StoryRealMusicElement.removeAttribute("src");
        StoryRealMusicElement.load();
    }
    StoryRealMusicElement = null;
    StoryRealMusicName = "";
    ReleaseStoryMusicObjectUrl();
}

async function StartStoryRealMusic(Name) {
    if (!StoryMusicTrackAliases[Name] || !StoryRealAudioUnlocked || StoryRealMusicVolume <= 0) return false;

    if (StoryRealMusicElement && StoryRealMusicName === Name) {
        ApplyStoryMusicFade(StoryRealMusicElement);
        if (!StoryRealMusicElement.paused) return true;
        try { await StoryRealMusicElement.play(); return true; } catch { return false; }
    }

    StopStoryRealMusic();
    const PlaybackUrl = await GetStoryMusicBlobUrl(Name);
    if (!PlaybackUrl) return false;

    if (StoryPendingMusicName !== Name) {
        URL.revokeObjectURL(PlaybackUrl);
        return false;
    }

    const AudioElement = new Audio(PlaybackUrl);
    AudioElement.preload = "auto";
    AudioElement.loop = false;
    AudioElement.volume = 0;
    StoryRealMusicObjectUrl = PlaybackUrl;

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
    try { await AudioElement.play(); return true; }
    catch { if (StoryRealMusicElement === AudioElement) StopStoryRealMusic(); return false; }
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
    try { AudioElement.currentTime = 0; await AudioElement.play(); return true; }
    catch { return false; }
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

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
        HasCompleteLocalSoundtrack().then(Ready => { if (!Ready) ShowStoryMusicInstallPrompt(); });
    }, { once: true });
} else {
    HasCompleteLocalSoundtrack().then(Ready => { if (!Ready) ShowStoryMusicInstallPrompt(); });
}

if (typeof StoryAudio !== "undefined") {
    const BaseConfigure = StoryAudio.Configure.bind(StoryAudio);
    const BasePlaySound = StoryAudio.PlaySound.bind(StoryAudio);
    const BaseStopMusic = StoryAudio.StopMusic.bind(StoryAudio);

    StoryAudio.Configure = function(Settings = {}) {
        StoryRealSoundVolume = ClampStoryAudioVolume(Settings.soundVolume, StoryRealSoundVolume);
        StoryRealMusicVolume = ClampStoryAudioVolume(Settings.musicVolume, StoryRealMusicVolume);
        for (const AudioElement of StoryRealSoundCache.values()) AudioElement.volume = StoryRealSoundVolume;
        if (StoryRealMusicElement) ApplyStoryMusicFade(StoryRealMusicElement);
        if (StoryRealMusicVolume <= 0) StopStoryRealMusic();
        BaseConfigure(Settings);
    };

    StoryAudio.PlayMusic = function(Name) {
        StoryPendingMusicName = Name;
        if (!StoryMusicTrackAliases[Name] || !StoryRealAudioUnlocked) return;
        StartStoryRealMusic(Name).then(Played => {
            if (!Played && StoryRealAudioUnlocked) ShowStoryMusicInstallPrompt();
        });
    };

    StoryAudio.StopMusic = function() {
        StoryPendingMusicName = "";
        StopStoryRealMusic();
        return BaseStopMusic();
    };

    StoryAudio.PlaySound = function(Name) {
        if (!StoryRealSoundFiles[Name] || !StoryRealAudioUnlocked) return BasePlaySound(Name);
        PlayStoryRealSound(Name).then(Played => { if (!Played) BasePlaySound(Name); });
    };

    StoryAudio.ImportLocalSoundtrack = function() {
        ShowStoryMusicInstallPrompt();
        if (StoryMusicInstallInput) StoryMusicInstallInput.click();
    };
}
