(() => {
    function GetPersistentShellHost() {
        try {
            if (window.parent !== window && window.parent.StoryShell?.IsPersistentShell) return window.parent;
        } catch {}
        return null;
    }

    if (typeof StoryAudio === "undefined") return;

    const ShellHost = GetPersistentShellHost();
    let IsShellAudioHost = false;

    try {
        IsShellAudioHost = Boolean(
            ShellHost &&
            window.frameElement &&
            window.frameElement.id === "StoryShellFrame"
        );
    } catch {}

    if (ShellHost && !IsShellAudioHost) {
        const ConfigureLocalSound = StoryAudio.Configure.bind(StoryAudio);

        StoryAudio.Configure = function(Settings = {}) {
            ConfigureLocalSound(Settings);
            ShellHost.StoryShell.ConfigureAudio(Settings);
        };

        StoryAudio.PlayMusic = function(Name) {
            ShellHost.StoryShell.PlayMusic(Name);
        };

        StoryAudio.StopMusic = function() {
            ShellHost.StoryShell.StopMusic();
        };

        StoryAudio.GetPlaybackState = function() {
            return ShellHost.StoryShell.GetAudioState();
        };

        return;
    }

    const ConfigureLocalSound = StoryAudio.Configure.bind(StoryAudio);
    const UnlockLocalSound = StoryAudio.UnlockAudio.bind(StoryAudio);
    const GetLocalSoundState = typeof StoryAudio.GetSoundState === "function"
        ? StoryAudio.GetSoundState.bind(StoryAudio)
        : () => ({ contextState: "closed", soundVolume: 0.8 });

    let MusicVolume = 0.45;
    const MusicElement = new Audio();
    let MusicName = "";
    let PendingMusicName = "";
    let AudioUnlocked = false;
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
            contextState: GetLocalSoundState().contextState,
            musicName: MusicName,
            pendingMusicName: PendingMusicName,
            musicPlaying: Boolean(MusicElement.src && !MusicElement.paused && !MusicElement.ended),
            musicVolume: MusicVolume,
            soundVolume: GetLocalSoundState().soundVolume,
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

    function UnlockAudioFromGesture() {
        AudioUnlocked = true;

        const SoundPromise = Promise.resolve(UnlockLocalSound()).catch(() => null);
        const MusicPromise = PendingMusicName
            ? TryPlayPreparedMusic()
            : Promise.resolve(MusicVolume <= 0);

        return Promise.all([SoundPromise, MusicPromise]).then(([, MusicPlaying]) => {
            DispatchPlaybackState();
            return {
                contextRunning: GetLocalSoundState().contextState === "running",
                musicPlaying: MusicPlaying,
                state: GetPlaybackState()
            };
        });
    }

    document.addEventListener("pointerdown", UnlockAudioFromGesture, { capture: true, passive: true });
    document.addEventListener("touchstart", UnlockAudioFromGesture, { capture: true, passive: true });
    document.addEventListener("keydown", UnlockAudioFromGesture, { capture: true });
    document.addEventListener("click", UnlockAudioFromGesture, { capture: true });

    window.addEventListener("pagehide", () => SavePosition());
    window.addEventListener("beforeunload", () => SavePosition());

    StoryAudio.Configure = function(Settings = {}) {
        ConfigureLocalSound(Settings);
        MusicVolume = Clamp(Settings.musicVolume, MusicVolume);
        ApplyMusicFade();

        if (MusicVolume <= 0) {
            StopMusicInternal(true, false);
        } else if (AudioUnlocked && PendingMusicName) {
            TryPlayPreparedMusic();
        }
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

    StoryAudio.UnlockAudio = UnlockAudioFromGesture;
    StoryAudio.GetPlaybackState = GetPlaybackState;
    window.StoryAudioBridge = StoryAudio;
})();
