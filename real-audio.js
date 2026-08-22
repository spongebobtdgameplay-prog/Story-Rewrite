(() => {
    function GetPersistentShellHost() {
        try {
            if (window.parent !== window && window.parent.StoryShell?.IsPersistentShell) return window.parent;
        } catch {}
        return null;
    }

    const ShellHost = GetPersistentShellHost();

    if (typeof StoryAudio !== "undefined" && typeof StoryAudio.ShutdownLegacyAudio === "function") {
        StoryAudio.ShutdownLegacyAudio();
    }
    window.StoryRealAudioActive = true;

    if (ShellHost && typeof StoryAudio !== "undefined") {
        StoryAudio.Configure = function(Settings = {}) {
            ShellHost.StoryShell.ConfigureAudio(Settings);
        };

        StoryAudio.PlayMusic = function(Name) {
            ShellHost.StoryShell.PlayMusic(Name);
        };

        StoryAudio.StopMusic = function() {
            ShellHost.StoryShell.StopMusic();
        };

        StoryAudio.PlaySound = function(Name) {
            ShellHost.StoryShell.PlaySound(Name);
        };
        StoryAudio.PlaySound.V11Wrapped = true;

        const NotifyInteraction = () => ShellHost.StoryShell.NotifyInteraction();
        StoryAudio.UnlockAudio = NotifyInteraction;
        StoryAudio.GetPlaybackState = () => ShellHost.StoryShell.GetAudioState();
        document.addEventListener("pointerdown", NotifyInteraction, { capture: true, passive: true });
        document.addEventListener("touchstart", NotifyInteraction, { capture: true, passive: true });
        document.addEventListener("keydown", NotifyInteraction, { capture: true });
        document.addEventListener("click", NotifyInteraction, { capture: true });
        return;
    }

    if (typeof StoryAudio === "undefined") return;

    let MusicVolume = 0.45;
    let SoundVolume = 0.75;
    const MusicElement = new Audio();
    let MusicName = "";
    let PendingMusicName = "";
    let AudioContextInstance = null;
    let AudioUnlocked = false;
    let LastSoundName = "";
    let LastSoundAt = 0;
    let LastPlaybackError = "";

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

    const MusicPositionKey = "StoryRewriteMusicPositionsV2";
    const FadeInSeconds = 0.85;
    const FadeOutSeconds = 3;

    MusicElement.preload = "auto";
    MusicElement.loop = false;
    MusicElement.volume = 0;

    function Clamp(Value, Fallback) {
        const NumberValue = Number(Value);
        return Number.isFinite(NumberValue) ? Math.max(0, Math.min(1, NumberValue)) : Fallback;
    }

    function GetPlaybackState() {
        return {
            audioUnlocked: AudioUnlocked,
            contextState: AudioContextInstance?.state || "closed",
            musicName: MusicName,
            pendingMusicName: PendingMusicName,
            musicPlaying: Boolean(MusicElement.src && !MusicElement.paused && !MusicElement.ended),
            musicVolume: MusicVolume,
            soundVolume: SoundVolume,
            lastError: LastPlaybackError
        };
    }

    function DispatchPlaybackState() {
        window.dispatchEvent(new CustomEvent("StoryAudioStateChange", {
            detail: GetPlaybackState()
        }));
    }

    function ReadPositions() {
        try {
            const Parsed = JSON.parse(sessionStorage.getItem(MusicPositionKey) || "{}");
            return Parsed && typeof Parsed === "object" ? Parsed : {};
        } catch {
            return {};
        }
    }

    function WritePositions(Positions) {
        try { sessionStorage.setItem(MusicPositionKey, JSON.stringify(Positions)); } catch {}
    }

    function SavePosition(Name = MusicName) {
        if (!Name || !Number.isFinite(MusicElement.currentTime)) return;
        const Positions = ReadPositions();
        Positions[Name] = Math.max(0, MusicElement.currentTime);
        WritePositions(Positions);
    }

    function SavedPosition(Name) {
        const Value = Number(ReadPositions()[Name]);
        return Number.isFinite(Value) && Value >= 0 ? Value : 0;
    }

    function ApplyMusicFade() {
        if (!Number.isFinite(MusicElement.duration) || MusicElement.duration <= 0) {
            MusicElement.volume = MusicVolume;
            return;
        }

        const Remaining = MusicElement.duration - MusicElement.currentTime;
        let Fade = 1;

        if (MusicElement.currentTime < FadeInSeconds) {
            Fade = Math.min(Fade, Math.max(0, MusicElement.currentTime / FadeInSeconds));
        }

        if (Remaining < FadeOutSeconds) {
            Fade = Math.min(Fade, Math.max(0, Remaining / FadeOutSeconds));
        }

        MusicElement.volume = MusicVolume * Math.max(0, Math.min(1, Fade));
    }

    function RestoreCurrentTrackPosition() {
        if (!MusicName || !Number.isFinite(MusicElement.duration) || MusicElement.duration <= 0) return;

        const Position = SavedPosition(MusicName);
        const SafePosition = Position >= MusicElement.duration - FadeOutSeconds
            ? 0
            : Math.min(Position, Math.max(0, MusicElement.duration - 0.25));

        if (SafePosition > 0.05) {
            try { MusicElement.currentTime = SafePosition; } catch {}
        }

        ApplyMusicFade();
    }

    MusicElement.addEventListener("loadedmetadata", RestoreCurrentTrackPosition);
    MusicElement.addEventListener("play", () => {
        LastPlaybackError = "";
        DispatchPlaybackState();
    });
    MusicElement.addEventListener("pause", DispatchPlaybackState);
    MusicElement.addEventListener("timeupdate", () => {
        ApplyMusicFade();
        SavePosition();
    });

    MusicElement.addEventListener("ended", () => {
        if (!MusicName || PendingMusicName !== MusicName) return;

        const Positions = ReadPositions();
        Positions[MusicName] = 0;
        WritePositions(Positions);

        MusicElement.currentTime = 0;
        MusicElement.volume = 0;
        MusicElement.play().catch(() => {});
    });

    MusicElement.addEventListener("error", () => {
        if (!MusicName) return;
        LastPlaybackError = `Music failed to load: ${MusicFiles[MusicName] || MusicName}`;
        console.warn(LastPlaybackError);
        DispatchPlaybackState();
    });

    function StopMusicInternal(Save = true, ClearSource = true) {
        if (Save && MusicName) SavePosition();
        MusicElement.pause();

        if (ClearSource) {
            MusicElement.removeAttribute("src");
            try { MusicElement.load(); } catch {}
        }

        MusicName = "";
    }

    function PrepareMusic(Name) {
        const RelativeUrl = MusicFiles[Name];
        if (!RelativeUrl || MusicVolume <= 0) return null;

        if (MusicName === Name && MusicElement.src) {
            ApplyMusicFade();
            return MusicElement;
        }

        if (MusicName) SavePosition();
        MusicElement.pause();

        MusicName = Name;
        MusicElement.volume = 0;
        MusicElement.src = new URL(RelativeUrl, window.location.href).href;
        try { MusicElement.load(); } catch {}
        return MusicElement;
    }

    function TryPlayPreparedMusic() {
        if (!AudioUnlocked || !PendingMusicName || MusicVolume <= 0) return Promise.resolve(false);

        const Element = PrepareMusic(PendingMusicName);
        if (!Element) return Promise.resolve(false);

        ApplyMusicFade();

        try {
            const PlayPromise = Element.play();
            if (!PlayPromise?.then) {
                DispatchPlaybackState();
                return Promise.resolve(!Element.paused);
            }

            return PlayPromise
                .then(() => {
                    LastPlaybackError = "";
                    DispatchPlaybackState();
                    return true;
                })
                .catch(Error => {
                    LastPlaybackError = String(Error?.message || Error || "Playback blocked");
                    DispatchPlaybackState();
                    return false;
                });
        } catch (Error) {
            LastPlaybackError = String(Error?.message || Error || "Playback blocked");
            DispatchPlaybackState();
            return Promise.resolve(false);
        }
    }

    function GetContext() {
        if (!AudioContextInstance) {
            const ContextClass = window.AudioContext || window.webkitAudioContext;
            if (!ContextClass) return null;
            AudioContextInstance = new ContextClass();
            AudioContextInstance.addEventListener("statechange", DispatchPlaybackState);
        }
        return AudioContextInstance;
    }

    function UnlockAudioFromGesture() {
        AudioUnlocked = true;

        const Context = GetContext();
        let ContextPromise = Promise.resolve(Context?.state === "running");

        if (Context?.state === "suspended") {
            try {
                const ResumePromise = Context.resume();
                ContextPromise = Promise.resolve(ResumePromise)
                    .then(() => Context.state === "running")
                    .catch(Error => {
                        LastPlaybackError = String(Error?.message || Error || "Audio context blocked");
                        return false;
                    });
            } catch (Error) {
                LastPlaybackError = String(Error?.message || Error || "Audio context blocked");
                ContextPromise = Promise.resolve(false);
            }
        }

        const MusicPromise = PendingMusicName
            ? TryPlayPreparedMusic()
            : Promise.resolve(MusicVolume <= 0);

        return Promise.all([ContextPromise, MusicPromise]).then(([ContextRunning, MusicPlaying]) => {
            DispatchPlaybackState();
            return {
                contextRunning: ContextRunning,
                musicPlaying: MusicPlaying,
                state: GetPlaybackState()
            };
        });
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
        if (Number.isFinite(EndFrequency)) {
            Oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, EndFrequency), End);
        }

        Filter.type = "lowpass";
        Filter.frequency.setValueAtTime(3000, Start);
        Filter.Q.value = 0.25;

        const Peak = Math.max(0.0001, GainAmount * SoundVolume);
        Gain.gain.setValueAtTime(0.0001, Start);
        Gain.gain.exponentialRampToValueAtTime(Peak, Start + Math.min(0.012, Duration * 0.28));
        Gain.gain.exponentialRampToValueAtTime(0.0001, End);

        Oscillator.connect(Filter);
        Filter.connect(Gain);
        Gain.connect(Context.destination);
        Oscillator.start(Start);
        Oscillator.stop(End + 0.025);
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
        Filter.Q.value = 0.35;
        Gain.gain.setValueAtTime(Math.max(0.0001, GainAmount * SoundVolume), Start);
        Gain.gain.exponentialRampToValueAtTime(0.0001, Start + Duration);

        Source.connect(Filter);
        Filter.connect(Gain);
        Gain.connect(Context.destination);
        Source.start(Start);
        Source.stop(Start + Duration + 0.025);
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
                Tone(560, 0.065, 0.028, "sine", 0, 500);
                Tone(760, 0.046, 0.011, "triangle", 0.008, 650);
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

    function GenericButtonClick(Event) {
        const Button = Event.target?.closest?.("button,[role='button']");
        if (!Button || Button.disabled || Button.getAttribute("aria-disabled") === "true") return;
        PlayProceduralSound("click");
    }

    document.addEventListener("pointerdown", UnlockAudioFromGesture, { capture: true, passive: true });
    document.addEventListener("touchstart", UnlockAudioFromGesture, { capture: true, passive: true });
    document.addEventListener("keydown", UnlockAudioFromGesture, { capture: true });
    document.addEventListener("click", UnlockAudioFromGesture, { capture: true });
    document.addEventListener("click", GenericButtonClick, { capture: true });
    window.addEventListener("pagehide", () => SavePosition());
    window.addEventListener("beforeunload", () => SavePosition());

    StoryAudio.Configure = function(Settings = {}) {
        SoundVolume = Clamp(Settings.soundVolume, SoundVolume);
        MusicVolume = Clamp(Settings.musicVolume, MusicVolume);
        ApplyMusicFade();
        if (MusicVolume <= 0) StopMusicInternal(true, false);
    };

    StoryAudio.PlayMusic = function(Name) {
        PendingMusicName = String(Name || "");
        if (!MusicFiles[PendingMusicName]) return;

        PrepareMusic(PendingMusicName);
        TryPlayPreparedMusic();
    };

    StoryAudio.StopMusic = function() {
        PendingMusicName = "";
        StopMusicInternal(true, false);
    };

    StoryAudio.PlaySound = function(Name) {
        PlayProceduralSound(Name);
    };
    StoryAudio.PlaySound.V11Wrapped = true;

    StoryAudio.UnlockAudio = UnlockAudioFromGesture;
    StoryAudio.GetPlaybackState = GetPlaybackState;
})();
