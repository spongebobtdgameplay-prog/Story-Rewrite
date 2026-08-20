let StoryRealMusicVolume = 0.45;
let StoryProceduralSoundVolume = 0.75;
let StoryRealMusicElement = null;
let StoryRealMusicName = "";
let StoryPendingMusicName = "";
let StoryRealMusicObjectUrl = "";
let StoryProceduralContext = null;

const StoryRealMusicFiles = {
    menu: "Music/menu.mp3",
    lobby: "Music/lobby.mp3",
    fromville: "Music/fromville.mp3",
    anime: "Music/neon-exorcists.mp3",
    "neon-exorcists": "Music/neon-exorcists.mp3",
    manor: "Music/blackthorn.mp3",
    blackthorn: "Music/blackthorn.mp3",
    forest: "Music/spirit-grove.mp3",
    spirit: "Music/spirit-grove.mp3",
    "spirit-grove": "Music/spirit-grove.mp3",
    city: "Music/false-city.mp3",
    "false-city": "Music/false-city.mp3",
    danger: "Music/danger.mp3"
};

const StoryMusicFadeOutSeconds = 3;
const StoryMusicFadeInSeconds = 0.85;
const StoryMusicCacheName = "story-rewrite-music-v1";

function ClampStoryAudioVolume(Value, Fallback) {
    const NumberValue = Number(Value);
    return Number.isFinite(NumberValue) ? Math.max(0, Math.min(1, NumberValue)) : Fallback;
}

async function GetBundledMusicBlobUrl(RelativeUrl) {
    const AbsoluteUrl = new URL(RelativeUrl, window.location.href).href;
    if (!("caches" in window)) return AbsoluteUrl;

    const Cache = await caches.open(StoryMusicCacheName);
    let Response = await Cache.match(AbsoluteUrl);

    if (!Response) {
        Response = await fetch(AbsoluteUrl);
        if (!Response.ok) throw new Error(`Music asset failed with ${Response.status}: ${RelativeUrl}`);
        await Cache.put(AbsoluteUrl, Response.clone());
    }

    const BlobValue = await Response.blob();
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
    const RelativeUrl = StoryRealMusicFiles[Name];
    if (!RelativeUrl || StoryRealMusicVolume <= 0) return false;

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

    let PlaybackUrl;
    try {
        PlaybackUrl = await GetBundledMusicBlobUrl(RelativeUrl);
    } catch (Error) {
        console.error(Error);
        return false;
    }

    if (StoryPendingMusicName !== Name) {
        if (PlaybackUrl.startsWith("blob:")) URL.revokeObjectURL(PlaybackUrl);
        return false;
    }

    const AudioElement = new Audio(PlaybackUrl);
    AudioElement.preload = "auto";
    AudioElement.loop = false;
    AudioElement.volume = 0;

    if (PlaybackUrl.startsWith("blob:")) StoryRealMusicObjectUrl = PlaybackUrl;

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
        // Browsers may block audible autoplay. Keep the loaded element alive so
        // the first normal pointer/key interaction can resume it immediately.
        return false;
    }
}

function GetStoryProceduralContext() {
    if (!StoryProceduralContext) {
        const ContextClass = window.AudioContext || window.webkitAudioContext;
        if (!ContextClass) return null;
        StoryProceduralContext = new ContextClass();
    }
    return StoryProceduralContext;
}

function ResumeStoryAudio() {
    const Context = GetStoryProceduralContext();
    if (Context?.state === "suspended") Context.resume().catch(() => {});

    if (StoryPendingMusicName && StoryRealMusicElement?.paused) {
        StoryRealMusicElement.play().catch(() => {});
    } else if (StoryPendingMusicName && !StoryRealMusicElement) {
        StartStoryRealMusic(StoryPendingMusicName);
    }
}

function PlaySmoothTone(Frequency, Duration, GainAmount = 0.035, Type = "sine", Delay = 0, EndFrequency = null) {
    const Context = GetStoryProceduralContext();
    if (!Context || Context.state !== "running" || StoryProceduralSoundVolume <= 0) return;

    const Start = Context.currentTime + Math.max(0, Delay);
    const End = Start + Math.max(0.025, Duration);
    const Oscillator = Context.createOscillator();
    const Gain = Context.createGain();
    const Filter = Context.createBiquadFilter();

    Oscillator.type = Type;
    Oscillator.frequency.setValueAtTime(Math.max(20, Frequency), Start);
    if (Number.isFinite(EndFrequency)) {
        Oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, EndFrequency), End);
    }

    Filter.type = "lowpass";
    Filter.frequency.setValueAtTime(3200, Start);
    Filter.Q.value = 0.35;

    const Peak = Math.max(0.0001, GainAmount * StoryProceduralSoundVolume);
    Gain.gain.setValueAtTime(0.0001, Start);
    Gain.gain.exponentialRampToValueAtTime(Peak, Start + Math.min(0.012, Duration * 0.25));
    Gain.gain.exponentialRampToValueAtTime(0.0001, End);

    Oscillator.connect(Filter);
    Filter.connect(Gain);
    Gain.connect(Context.destination);
    Oscillator.start(Start);
    Oscillator.stop(End + 0.02);
}

function PlaySmoothNoise(Duration = 0.08, GainAmount = 0.02, FilterFrequency = 1500, Delay = 0) {
    const Context = GetStoryProceduralContext();
    if (!Context || Context.state !== "running" || StoryProceduralSoundVolume <= 0) return;

    const Length = Math.max(1, Math.floor(Context.sampleRate * Duration));
    const Buffer = Context.createBuffer(1, Length, Context.sampleRate);
    const Data = Buffer.getChannelData(0);
    for (let Index = 0; Index < Length; Index += 1) {
        const Fade = 1 - Index / Length;
        Data[Index] = (Math.random() * 2 - 1) * Fade * Fade;
    }

    const Source = Context.createBufferSource();
    const Filter = Context.createBiquadFilter();
    const Gain = Context.createGain();
    const Start = Context.currentTime + Math.max(0, Delay);

    Source.buffer = Buffer;
    Filter.type = "lowpass";
    Filter.frequency.value = FilterFrequency;
    Filter.Q.value = 0.45;
    Gain.gain.setValueAtTime(Math.max(0.0001, GainAmount * StoryProceduralSoundVolume), Start);
    Gain.gain.exponentialRampToValueAtTime(0.0001, Start + Duration);

    Source.connect(Filter);
    Filter.connect(Gain);
    Gain.connect(Context.destination);
    Source.start(Start);
    Source.stop(Start + Duration + 0.02);
}

function PlayStoryProceduralSound(Name) {
    if (StoryProceduralSoundVolume <= 0) return;

    switch (Name) {
        case "click":
            PlaySmoothTone(620, 0.052, 0.026, "sine", 0, 520);
            PlaySmoothTone(930, 0.036, 0.012, "triangle", 0.006, 760);
            break;
        case "cross":
            PlaySmoothNoise(0.095, 0.025, 1250);
            PlaySmoothTone(330, 0.12, 0.025, "triangle", 0, 180);
            break;
        case "restore":
            PlaySmoothTone(330, 0.09, 0.026, "sine", 0, 430);
            PlaySmoothTone(510, 0.12, 0.022, "triangle", 0.055, 650);
            break;
        case "join":
            PlaySmoothTone(392, 0.11, 0.024, "sine");
            PlaySmoothTone(523.25, 0.13, 0.026, "sine", 0.075);
            PlaySmoothTone(659.25, 0.16, 0.023, "triangle", 0.15);
            break;
        case "message":
            PlaySmoothTone(740, 0.065, 0.022, "sine");
            PlaySmoothTone(980, 0.08, 0.015, "sine", 0.045);
            break;
        case "ready":
            PlaySmoothTone(350, 0.08, 0.024, "triangle");
            PlaySmoothTone(470, 0.1, 0.025, "triangle", 0.065);
            PlaySmoothTone(700, 0.15, 0.022, "sine", 0.13);
            break;
        case "vote":
            PlaySmoothTone(480, 0.055, 0.023, "sine");
            PlaySmoothTone(640, 0.07, 0.016, "triangle", 0.04);
            break;
        case "fail":
            PlaySmoothNoise(0.2, 0.028, 620);
            PlaySmoothTone(150, 0.38, 0.04, "triangle", 0, 68);
            break;
        case "life":
            PlaySmoothTone(115, 0.44, 0.043, "sine", 0, 55);
            PlaySmoothNoise(0.12, 0.02, 480, 0.03);
            break;
        case "success":
            PlaySmoothTone(523.25, 0.15, 0.025, "triangle");
            PlaySmoothTone(659.25, 0.18, 0.025, "triangle", 0.09);
            PlaySmoothTone(783.99, 0.24, 0.025, "sine", 0.18);
            break;
        case "revive":
            PlaySmoothTone(220, 0.16, 0.025, "sine", 0, 330);
            PlaySmoothTone(440, 0.2, 0.028, "triangle", 0.11, 660);
            PlaySmoothTone(880, 0.28, 0.022, "sine", 0.23, 1040);
            break;
        case "reviveEarned":
            PlaySmoothTone(440, 0.12, 0.022, "sine");
            PlaySmoothTone(660, 0.16, 0.024, "triangle", 0.09);
            PlaySmoothTone(880, 0.24, 0.025, "sine", 0.18);
            break;
        case "heartRefill":
            PlaySmoothTone(392, 0.12, 0.023, "sine");
            PlaySmoothTone(523.25, 0.15, 0.024, "triangle", 0.08);
            PlaySmoothTone(783.99, 0.22, 0.024, "sine", 0.16);
            break;
        default:
            PlaySmoothTone(560, 0.05, 0.02, "sine", 0, 500);
            break;
    }
}

document.addEventListener("pointerdown", ResumeStoryAudio, { capture: true, passive: true });
document.addEventListener("keydown", ResumeStoryAudio, { capture: true });
document.addEventListener("touchstart", ResumeStoryAudio, { capture: true, passive: true });

if (typeof StoryAudio !== "undefined") {
    const BaseConfigure = StoryAudio.Configure.bind(StoryAudio);
    const BaseStopMusic = StoryAudio.StopMusic.bind(StoryAudio);

    StoryAudio.Configure = function(Settings = {}) {
        StoryProceduralSoundVolume = ClampStoryAudioVolume(Settings.soundVolume, StoryProceduralSoundVolume);
        StoryRealMusicVolume = ClampStoryAudioVolume(Settings.musicVolume, StoryRealMusicVolume);
        if (StoryRealMusicElement) ApplyStoryMusicFade(StoryRealMusicElement);
        if (StoryRealMusicVolume <= 0) StopStoryRealMusic();
        BaseConfigure(Settings);
    };

    StoryAudio.PlayMusic = function(Name) {
        StoryPendingMusicName = Name;
        if (!StoryRealMusicFiles[Name]) return;
        StartStoryRealMusic(Name).then(Played => {
            if (!Played && StoryRealMusicElement) {
                // Audible autoplay was blocked; first ordinary interaction retries it.
            }
        });
    };

    StoryAudio.StopMusic = function() {
        StoryPendingMusicName = "";
        StopStoryRealMusic();
        return BaseStopMusic();
    };

    StoryAudio.PlaySound = function(Name) {
        PlayStoryProceduralSound(Name);
    };
}
