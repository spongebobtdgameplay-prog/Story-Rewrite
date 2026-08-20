(() => {
    function GetPersistentShellHost() {
        try {
            if (window.parent !== window && window.parent.StoryShell?.IsPersistentShell) return window.parent;
        } catch {}
        return null;
    }

    const ShellHost = GetPersistentShellHost();

    if (ShellHost && typeof StoryAudio !== "undefined") {
        StoryAudio.Configure = function(Settings = {}) {
            ShellHost.StoryAudio?.Configure?.(Settings);
        };

        StoryAudio.PlayMusic = function(Name) {
            ShellHost.StoryShell.PlayMusic(Name);
        };

        StoryAudio.StopMusic = function() {
            ShellHost.StoryShell.StopMusic();
        };

        StoryAudio.PlaySound = function(Name) {
            ShellHost.StoryAudio?.PlaySound?.(Name);
        };
        StoryAudio.PlaySound.V11Wrapped = true;

        const NotifyInteraction = () => ShellHost.StoryShell.NotifyInteraction();
        const PlayGenericButtonClick = Event => {
            const Button = Event.target?.closest?.("button,[role='button']");
            if (!Button || Button.disabled || Button.getAttribute("aria-disabled") === "true") return;
            ShellHost.StoryAudio?.PlaySound?.("click");
        };

        document.addEventListener("pointerdown", NotifyInteraction, { capture: true, passive: true });
        document.addEventListener("touchstart", NotifyInteraction, { capture: true, passive: true });
        document.addEventListener("keydown", NotifyInteraction, { capture: true });
        document.addEventListener("click", PlayGenericButtonClick, { capture: true });
        return;
    }

    if (typeof StoryAudio === "undefined") return;

    let MusicVolume = 0.45;
    let SoundVolume = 0.75;
    let MusicElement = null;
    let MusicName = "";
    let PendingMusicName = "";
    let MusicObjectUrl = "";
    let AudioContextInstance = null;
    let LastSoundName = "";
    let LastSoundAt = 0;

    const MusicFiles = {
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

    const MusicCacheName = "story-rewrite-music-v1";
    const MusicPositionKey = "StoryRewriteMusicPositionsV1";
    const FadeInSeconds = 0.85;
    const FadeOutSeconds = 3;

    function Clamp(Value, Fallback) {
        const NumberValue = Number(Value);
        return Number.isFinite(NumberValue) ? Math.max(0, Math.min(1, NumberValue)) : Fallback;
    }

    function ReadPositions() {
        try {
            const Parsed = JSON.parse(sessionStorage.getItem(MusicPositionKey) || "{}");
            return Parsed && typeof Parsed === "object" ? Parsed : {};
        } catch {
            return {};
        }
    }

    function SavePosition(Name = MusicName, Element = MusicElement) {
        if (!Name || !Element || !Number.isFinite(Element.currentTime)) return;
        const Positions = ReadPositions();
        Positions[Name] = Math.max(0, Element.currentTime);
        try { sessionStorage.setItem(MusicPositionKey, JSON.stringify(Positions)); } catch {}
    }

    function SavedPosition(Name) {
        const Value = Number(ReadPositions()[Name]);
        return Number.isFinite(Value) && Value >= 0 ? Value : 0;
    }

    async function GetMusicBlobUrl(RelativeUrl) {
        const AbsoluteUrl = new URL(RelativeUrl, window.location.href).href;
        if (!("caches" in window)) return AbsoluteUrl;

        const Cache = await caches.open(MusicCacheName);
        let Response = await Cache.match(AbsoluteUrl);
        if (!Response) {
            Response = await fetch(AbsoluteUrl);
            if (!Response.ok) throw new Error(`Music asset failed with ${Response.status}: ${RelativeUrl}`);
            await Cache.put(AbsoluteUrl, Response.clone());
        }
        return URL.createObjectURL(await Response.blob());
    }

    function ApplyMusicFade(Element) {
        if (!Element || !Number.isFinite(Element.duration) || Element.duration <= 0) return;
        const Remaining = Element.duration - Element.currentTime;
        let Fade = 1;
        if (Element.currentTime < FadeInSeconds) Fade = Math.min(Fade, Element.currentTime / FadeInSeconds);
        if (Remaining < FadeOutSeconds) Fade = Math.min(Fade, Math.max(0, Remaining / FadeOutSeconds));
        Element.volume = MusicVolume * Math.max(0, Math.min(1, Fade));
    }

    function ReleaseMusicObjectUrl() {
        if (!MusicObjectUrl) return;
        URL.revokeObjectURL(MusicObjectUrl);
        MusicObjectUrl = "";
    }

    function StopMusicInternal(Save = true) {
        if (MusicElement) {
            if (Save) SavePosition();
            MusicElement.pause();
            MusicElement.removeAttribute("src");
            MusicElement.load();
        }
        MusicElement = null;
        MusicName = "";
        ReleaseMusicObjectUrl();
    }

    async function StartMusic(Name) {
        const RelativeUrl = MusicFiles[Name];
        if (!RelativeUrl || MusicVolume <= 0) return false;

        if (MusicElement && MusicName === Name) {
            ApplyMusicFade(MusicElement);
            if (!MusicElement.paused) return true;
            try {
                await MusicElement.play();
                return true;
            } catch {
                return false;
            }
        }

        StopMusicInternal(true);

        let PlaybackUrl;
        try {
            PlaybackUrl = await GetMusicBlobUrl(RelativeUrl);
        } catch (Error) {
            console.error(Error);
            return false;
        }

        if (PendingMusicName !== Name) {
            if (PlaybackUrl.startsWith("blob:")) URL.revokeObjectURL(PlaybackUrl);
            return false;
        }

        const Element = new Audio(PlaybackUrl);
        Element.preload = "auto";
        Element.loop = false;
        Element.volume = 0;
        if (PlaybackUrl.startsWith("blob:")) MusicObjectUrl = PlaybackUrl;

        Element.addEventListener("loadedmetadata", () => {
            if (!Number.isFinite(Element.duration) || Element.duration <= 0) return;
            const Position = SavedPosition(Name);
            const SafePosition = Position >= Element.duration - FadeOutSeconds
                ? 0
                : Math.min(Position, Math.max(0, Element.duration - 0.25));
            if (SafePosition > 0.05) Element.currentTime = SafePosition;
            ApplyMusicFade(Element);
        }, { once: true });

        Element.addEventListener("timeupdate", () => {
            ApplyMusicFade(Element);
            SavePosition(Name, Element);
        });

        Element.addEventListener("ended", () => {
            if (MusicElement !== Element || PendingMusicName !== Name) return;
            const Positions = ReadPositions();
            Positions[Name] = 0;
            try { sessionStorage.setItem(MusicPositionKey, JSON.stringify(Positions)); } catch {}
            Element.currentTime = 0;
            Element.volume = 0;
            Element.play().catch(() => {});
        });

        MusicElement = Element;
        MusicName = Name;

        try {
            await Element.play();
            return true;
        } catch {
            return false;
        }
    }

    function GetContext() {
        if (!AudioContextInstance) {
            const ContextClass = window.AudioContext || window.webkitAudioContext;
            if (!ContextClass) return null;
            AudioContextInstance = new ContextClass();
        }
        return AudioContextInstance;
    }

    async function EnsureContextRunning() {
        const Context = GetContext();
        if (!Context) return null;
        if (Context.state === "suspended") {
            try { await Context.resume(); } catch {}
        }
        return Context.state === "running" ? Context : null;
    }

    function Tone(Frequency, Duration, GainAmount = 0.025, Type = "sine", Delay = 0, EndFrequency = null) {
        const Context = AudioContextInstance;
        if (!Context || Context.state !== "running" || SoundVolume <= 0) return;
        const Start = Context.currentTime + Math.max(0, Delay);
        const End = Start + Math.max(0.025, Duration);
        const Oscillator = Context.createOscillator();
        const Filter = Context.createBiquadFilter();
        const Gain = Context.createGain();

        Oscillator.type = Type;
        Oscillator.frequency.setValueAtTime(Math.max(20, Frequency), Start);
        if (Number.isFinite(EndFrequency)) Oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, EndFrequency), End);

        Filter.type = "lowpass";
        Filter.frequency.setValueAtTime(2800, Start);
        Filter.Q.value = 0.3;

        const Peak = Math.max(0.0001, GainAmount * SoundVolume);
        Gain.gain.setValueAtTime(0.0001, Start);
        Gain.gain.exponentialRampToValueAtTime(Peak, Start + Math.min(0.014, Duration * 0.3));
        Gain.gain.exponentialRampToValueAtTime(0.0001, End);

        Oscillator.connect(Filter);
        Filter.connect(Gain);
        Gain.connect(Context.destination);
        Oscillator.start(Start);
        Oscillator.stop(End + 0.02);
    }

    function Noise(Duration = 0.08, GainAmount = 0.02, FilterFrequency = 1500, Delay = 0) {
        const Context = AudioContextInstance;
        if (!Context || Context.state !== "running" || SoundVolume <= 0) return;
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
        Filter.Q.value = 0.4;
        Gain.gain.setValueAtTime(Math.max(0.0001, GainAmount * SoundVolume), Start);
        Gain.gain.exponentialRampToValueAtTime(0.0001, Start + Duration);
        Source.connect(Filter);
        Filter.connect(Gain);
        Gain.connect(Context.destination);
        Source.start(Start);
        Source.stop(Start + Duration + 0.02);
    }

    async function PlayProceduralSound(Name) {
        if (SoundVolume <= 0) return;
        const Now = performance.now();
        if (Name === LastSoundName && Now - LastSoundAt < 45) return;
        LastSoundName = Name;
        LastSoundAt = Now;
        if (!(await EnsureContextRunning())) return;

        switch (Name) {
            case "click":
                Tone(575, 0.06, 0.024, "sine", 0, 500);
                Tone(790, 0.045, 0.009, "triangle", 0.008, 680);
                break;
            case "cross":
                Noise(0.09, 0.022, 1200);
                Tone(320, 0.12, 0.023, "triangle", 0, 185);
                break;
            case "restore":
                Tone(330, 0.09, 0.024, "sine", 0, 430);
                Tone(510, 0.12, 0.02, "triangle", 0.055, 650);
                break;
            case "join":
                Tone(392, 0.11, 0.022, "sine");
                Tone(523.25, 0.13, 0.024, "sine", 0.075);
                Tone(659.25, 0.16, 0.021, "triangle", 0.15);
                break;
            case "message":
                Tone(740, 0.065, 0.02, "sine");
                Tone(980, 0.08, 0.014, "sine", 0.045);
                break;
            case "ready":
                Tone(350, 0.08, 0.022, "triangle");
                Tone(470, 0.1, 0.023, "triangle", 0.065);
                Tone(700, 0.15, 0.02, "sine", 0.13);
                break;
            case "vote":
                Tone(480, 0.055, 0.021, "sine");
                Tone(640, 0.07, 0.015, "triangle", 0.04);
                break;
            case "fail":
                Noise(0.2, 0.026, 620);
                Tone(150, 0.38, 0.036, "triangle", 0, 68);
                break;
            case "life":
                Tone(115, 0.44, 0.038, "sine", 0, 55);
                Noise(0.12, 0.018, 480, 0.03);
                break;
            case "success":
                Tone(523.25, 0.15, 0.023, "triangle");
                Tone(659.25, 0.18, 0.023, "triangle", 0.09);
                Tone(783.99, 0.24, 0.023, "sine", 0.18);
                break;
            case "revive":
                Tone(220, 0.16, 0.023, "sine", 0, 330);
                Tone(440, 0.2, 0.026, "triangle", 0.11, 660);
                Tone(880, 0.28, 0.02, "sine", 0.23, 1040);
                break;
            case "reviveEarned":
                Tone(440, 0.12, 0.02, "sine");
                Tone(660, 0.16, 0.022, "triangle", 0.09);
                Tone(880, 0.24, 0.023, "sine", 0.18);
                break;
            case "heartRefill":
                Tone(392, 0.12, 0.021, "sine");
                Tone(523.25, 0.15, 0.022, "triangle", 0.08);
                Tone(783.99, 0.22, 0.022, "sine", 0.16);
                break;
            default:
                Tone(540, 0.055, 0.018, "sine", 0, 490);
                break;
        }
    }

    function ResumeMusicFromInteraction() {
        if (PendingMusicName) StartMusic(PendingMusicName);
    }

    document.addEventListener("pointerdown", ResumeMusicFromInteraction, { capture: true, passive: true });
    document.addEventListener("touchstart", ResumeMusicFromInteraction, { capture: true, passive: true });
    document.addEventListener("keydown", ResumeMusicFromInteraction, { capture: true });
    window.addEventListener("pagehide", () => SavePosition());
    window.addEventListener("beforeunload", () => SavePosition());

    StoryAudio.Configure = function(Settings = {}) {
        SoundVolume = Clamp(Settings.soundVolume, SoundVolume);
        MusicVolume = Clamp(Settings.musicVolume, MusicVolume);
        if (MusicElement) ApplyMusicFade(MusicElement);
        if (MusicVolume <= 0) StopMusicInternal(true);
    };

    StoryAudio.PlayMusic = function(Name) {
        PendingMusicName = Name;
        if (!MusicFiles[Name]) return;
        StartMusic(Name);
    };

    StoryAudio.StopMusic = function() {
        PendingMusicName = "";
        StopMusicInternal(true);
    };

    StoryAudio.PlaySound = function(Name) {
        PlayProceduralSound(Name);
    };
    StoryAudio.PlaySound.V11Wrapped = true;
})();
