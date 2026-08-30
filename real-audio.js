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

        if (/(?:Firefox|FxiOS)\//i.test(navigator.userAgent)) {
            document.addEventListener("click", () => {
                ShellHost.StoryShell.NotifyInteraction(true);
            }, { capture: true });
        }

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
    let MusicSettingsReady = false;
    let MusicReady = false;
    let MusicWaitingForGesture = false;
    let LastPlaybackError = "";
    let FreshStartMusicName = "";
    let ResumeMusicWhenVisible = false;

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
    const KeepMusicPlayingKey = "StoryRewriteKeepMusicPlayingV1";
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
            musicSettingsReady: MusicSettingsReady,
            musicReady: MusicReady,
            contextState: GetLocalSoundState().contextState,
            musicName: MusicName,
            pendingMusicName: PendingMusicName,
            musicPlaying: Boolean(MusicElement.src && !MusicElement.paused && !MusicElement.ended),
            musicWaitingForGesture: MusicWaitingForGesture,
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

        if (FreshStartMusicName === MusicName) {
            try { MusicElement.currentTime = 0; } catch {}
            ApplyMusicFade();
            return;
        }

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
        FreshStartMusicName = "";
        MusicWaitingForGesture = false;
        LastPlaybackError = "";
        DispatchPlaybackState();
    });

    MusicElement.addEventListener("pause", () => {
        MusicWaitingForGesture = Boolean(PendingMusicName && MusicVolume > 0);
        DispatchPlaybackState();
    });

    MusicElement.addEventListener("canplay", () => {
        MusicReady = true;
        ApplyMusicFade();
        DispatchPlaybackState();

        if (AudioUnlocked && MusicWaitingForGesture && PendingMusicName) {
            TryPlayPreparedMusic();
        }
    });

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
        MusicWaitingForGesture = true;
        TryPlayPreparedMusic();
    });

    MusicElement.addEventListener("error", () => {
        MusicReady = false;
        if (!MusicName) return;
        MusicWaitingForGesture = Boolean(PendingMusicName && MusicVolume > 0);
        LastPlaybackError = `Music failed to load: ${MusicFiles[MusicName] || MusicName}`;
        console.warn(LastPlaybackError);
        DispatchPlaybackState();
    });

    function StopMusicInternal(Save = true, ClearSource = true) {
        if (Save && MusicName) SavePosition();
        MusicElement.pause();

        if (ClearSource) {
            MusicElement.removeAttribute("src");
            MusicReady = false;
            try { MusicElement.load(); } catch {}
        }

        MusicName = "";
        MusicWaitingForGesture = Boolean(PendingMusicName && MusicVolume > 0);
    }

    function PrepareMusic(Name) {
        const RelativeUrl = MusicFiles[Name];
        if (!MusicSettingsReady || !RelativeUrl || MusicVolume <= 0) return null;

        if (MusicName === Name && MusicElement.src) {
            MusicReady = MusicElement.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA;
            ApplyMusicFade();
            return MusicElement;
        }

        if (MusicName) SavePosition();
        MusicElement.pause();

        MusicName = Name;
        MusicReady = false;
        MusicElement.volume = 0;
        MusicElement.src = new URL(RelativeUrl, window.location.href).href;
        try { MusicElement.load(); } catch {}
        return MusicElement;
    }

    function TryPlayPreparedMusic(FromGesture = false) {
        if (FromGesture) AudioUnlocked = true;

        if (!MusicSettingsReady) {
            MusicWaitingForGesture = Boolean(PendingMusicName);
            DispatchPlaybackState();
            return Promise.resolve(false);
        }

        if (!PendingMusicName || MusicVolume <= 0) {
            MusicWaitingForGesture = false;
            DispatchPlaybackState();
            return Promise.resolve(false);
        }

        if (!AudioUnlocked) {
            MusicWaitingForGesture = true;
            DispatchPlaybackState();
            return Promise.resolve(false);
        }

        const RequestedMusicName = PendingMusicName;
        const Element = PrepareMusic(RequestedMusicName);

        if (!Element) {
            MusicWaitingForGesture = true;
            DispatchPlaybackState();
            return Promise.resolve(false);
        }

        MusicReady = Element.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA;
        if (!MusicReady) {
            MusicWaitingForGesture = true;
            DispatchPlaybackState();
            return Promise.resolve(false);
        }

        if (FreshStartMusicName === RequestedMusicName) {
            try {
                Element.pause();
                Element.currentTime = 0;
            } catch {}
        }

        if (!Element.paused && !Element.ended) {
            MusicWaitingForGesture = false;
            LastPlaybackError = "";
            DispatchPlaybackState();
            return Promise.resolve(true);
        }

        ApplyMusicFade();
        MusicWaitingForGesture = true;

        try {
            const PlayPromise = Element.play();

            if (!PlayPromise?.then) {
                const IsPlaying = !Element.paused;
                MusicWaitingForGesture = !IsPlaying;
                DispatchPlaybackState();
                return Promise.resolve(IsPlaying);
            }

            return PlayPromise
                .then(() => {
                    const IsCurrentRequest = PendingMusicName === RequestedMusicName;
                    const IsPlaying = IsCurrentRequest && !Element.paused;
                    MusicWaitingForGesture = Boolean(PendingMusicName && !IsPlaying);
                    if (IsPlaying) LastPlaybackError = "";
                    DispatchPlaybackState();
                    return IsPlaying;
                })
                .catch(Error => {
                    if (PendingMusicName === RequestedMusicName) {
                        MusicWaitingForGesture = true;
                        LastPlaybackError = String(Error?.message || Error || "Playback blocked");
                    }
                    DispatchPlaybackState();
                    return false;
                });
        } catch (Error) {
            MusicWaitingForGesture = true;
            LastPlaybackError = String(Error?.message || Error || "Playback blocked");
            DispatchPlaybackState();
            return Promise.resolve(false);
        }
    }

    function UnlockAudioFromGesture(EventOrTrusted = false) {
        const TrustedGesture = EventOrTrusted === true || EventOrTrusted?.isTrusted === true;
        if (!TrustedGesture) {
            return Promise.resolve({
                contextRunning: GetLocalSoundState().contextState === "running",
                musicPlaying: false,
                state: GetPlaybackState()
            });
        }

        const FirstUnlock = !AudioUnlocked;
        AudioUnlocked = true;
        if (FirstUnlock && PendingMusicName) FreshStartMusicName = PendingMusicName;

        const MusicPromise = PendingMusicName
            ? TryPlayPreparedMusic(true)
            : Promise.resolve(MusicVolume <= 0);
        const SoundPromise = Promise.resolve(UnlockLocalSound()).catch(() => null);

        return Promise.all([MusicPromise, SoundPromise]).then(([MusicPlaying]) => {
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

    function ReadKeepMusicPlaying() {
        try {
            return localStorage.getItem(KeepMusicPlayingKey) === "1";
        } catch {
            return false;
        }
    }

    let KeepMusicPlaying = ReadKeepMusicPlaying();

    function SetKeepMusicPlaying(Enabled) {
        KeepMusicPlaying = Boolean(Enabled);

        try {
            localStorage.setItem(KeepMusicPlayingKey, KeepMusicPlaying ? "1" : "0");
        } catch {}

        if (!KeepMusicPlaying && document.hidden && MusicElement.src && !MusicElement.paused && !MusicElement.ended) {
            ResumeMusicWhenVisible = true;
            SavePosition();
            MusicElement.pause();
        }

        return KeepMusicPlaying;
    }

    window.addEventListener("storage", Event => {
        if (Event.key === KeepMusicPlayingKey) {
            KeepMusicPlaying = Event.newValue === "1";
        }
    });

    document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
            if (KeepMusicPlaying) {
                ResumeMusicWhenVisible = false;
                return;
            }

            ResumeMusicWhenVisible = Boolean(MusicElement.src && !MusicElement.paused && !MusicElement.ended);
            if (ResumeMusicWhenVisible) {
                SavePosition();
                MusicElement.pause();
            }
            return;
        }

        const ShouldResume = ResumeMusicWhenVisible;
        ResumeMusicWhenVisible = false;
        if (ShouldResume && AudioUnlocked && PendingMusicName && MusicVolume > 0) {
            TryPlayPreparedMusic();
        }
    });

    window.addEventListener("pagehide", () => SavePosition());
    window.addEventListener("beforeunload", () => SavePosition());

    StoryAudio.Configure = function(Settings = {}) {
        ConfigureLocalSound(Settings);

        const NextMusicVolume = Number(Settings.musicVolume);
        if (!Number.isFinite(NextMusicVolume)) {
            DispatchPlaybackState();
            return;
        }

        MusicVolume = Clamp(NextMusicVolume, MusicVolume);
        MusicSettingsReady = true;
        ApplyMusicFade();

        if (MusicVolume <= 0) {
            StopMusicInternal(true, false);
            DispatchPlaybackState();
            return;
        }

        if (PendingMusicName) PrepareMusic(PendingMusicName);
        if (AudioUnlocked && PendingMusicName) TryPlayPreparedMusic();
        else DispatchPlaybackState();
    };

    StoryAudio.PlayMusic = function(Name) {
        const RequestedMusicName = String(Name || "");
        if (!MusicFiles[RequestedMusicName]) return Promise.resolve(false);

        PendingMusicName = RequestedMusicName;
        MusicWaitingForGesture = MusicVolume > 0;

        if (!MusicSettingsReady) {
            FreshStartMusicName = PendingMusicName;
            DispatchPlaybackState();
            return Promise.resolve(false);
        }

        PrepareMusic(RequestedMusicName);

        if (!AudioUnlocked) {
            FreshStartMusicName = PendingMusicName;
            DispatchPlaybackState();
            return Promise.resolve(false);
        }

        return TryPlayPreparedMusic();
    };

    StoryAudio.StopMusic = function() {
        PendingMusicName = "";
        FreshStartMusicName = "";
        ResumeMusicWhenVisible = false;
        MusicWaitingForGesture = false;
        StopMusicInternal(true, false);
    };

    StoryAudio.UnlockAudio = UnlockAudioFromGesture;
    StoryAudio.GetPlaybackState = GetPlaybackState;
    StoryAudio.SetKeepMusicPlaying = SetKeepMusicPlaying;
    window.StoryAudioBridge = StoryAudio;
})();
