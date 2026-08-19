const StoryAudio = (() => {
    let AudioContextInstance = null;
    let MusicElement = null;
    let MusicVolume = 0.45;
    let SoundVolume = 0.75;
    let CurrentTrack = "";

    const TrackFiles = {
        menu: "music/menu/menu.mp3",
        lobby: "music/lobby/lobby.mp3",
        fromville: "music/fromville/fromville.mp3",
        anime: "music/neon-exorcists/neon-exorcists.mp3",
        manor: "music/blackthorn/blackthorn.mp3",
        forest: "music/spirit-grove/spirit-grove.mp3",
        city: "music/false-city/false-city.mp3",
        danger: "music/danger/danger.mp3"
    };

    const SoundFiles = {
        click: "sounds/ui/click.wav",
        cross: "sounds/story/cross.wav",
        restore: "sounds/story/restore.wav",
        join: "sounds/multiplayer/join.wav",
        message: "sounds/multiplayer/message.wav",
        ready: "sounds/multiplayer/ready.wav",
        fail: "sounds/danger/fail.wav",
        life: "sounds/danger/life-lost.wav",
        success: "sounds/story/success.wav"
    };

    function Configure(Settings = {}) {
        MusicVolume = Clamp(Settings.musicVolume, 0, 1, MusicVolume);
        SoundVolume = Clamp(Settings.soundVolume, 0, 1, SoundVolume);
        if (MusicElement) MusicElement.volume = MusicVolume;
    }

    function Clamp(Value, Minimum, Maximum, Fallback) {
        const NumberValue = Number(Value);
        return Number.isFinite(NumberValue) ? Math.max(Minimum, Math.min(Maximum, NumberValue)) : Fallback;
    }

    function EnsureContext() {
        if (!AudioContextInstance) {
            const Context = window.AudioContext || window.webkitAudioContext;
            if (Context) AudioContextInstance = new Context();
        }
        if (AudioContextInstance?.state === "suspended") AudioContextInstance.resume().catch(() => {});
        return AudioContextInstance;
    }

    function PlayTone(Frequency, Duration, GainAmount = 0.08, Type = "sine") {
        const Context = EnsureContext();
        if (!Context || SoundVolume <= 0) return;
        const Oscillator = Context.createOscillator();
        const Gain = Context.createGain();
        Oscillator.type = Type;
        Oscillator.frequency.value = Frequency;
        Gain.gain.setValueAtTime(Math.max(0.0001, GainAmount * SoundVolume), Context.currentTime);
        Gain.gain.exponentialRampToValueAtTime(0.0001, Context.currentTime + Duration);
        Oscillator.connect(Gain);
        Gain.connect(Context.destination);
        Oscillator.start();
        Oscillator.stop(Context.currentTime + Duration);
    }

    async function PlayMusic(Name) {
        const Source = TrackFiles[Name] || TrackFiles.menu;
        if (CurrentTrack === Source && MusicElement) return;
        CurrentTrack = Source;

        if (MusicElement) {
            MusicElement.pause();
            MusicElement.remove();
        }

        MusicElement = new Audio(Source);
        MusicElement.loop = true;
        MusicElement.volume = MusicVolume;
        MusicElement.preload = "auto";
        MusicElement.addEventListener("error", () => StartAmbientFallback(Name), { once: true });

        try {
            await MusicElement.play();
        } catch {
            const Start = () => {
                MusicElement?.play().catch(() => StartAmbientFallback(Name));
                document.removeEventListener("pointerdown", Start);
                document.removeEventListener("keydown", Start);
            };
            document.addEventListener("pointerdown", Start, { once: true });
            document.addEventListener("keydown", Start, { once: true });
        }
    }

    function StartAmbientFallback(Name) {
        const FrequencyMap = {
            menu: 82,
            lobby: 98,
            fromville: 61,
            anime: 110,
            manor: 55,
            forest: 123,
            city: 73,
            danger: 46
        };
        PlayTone(FrequencyMap[Name] || 82, 1.8, 0.022, "sine");
    }

    function PlaySound(Name) {
        const Source = SoundFiles[Name];
        if (!Source) return;
        const Sound = new Audio(Source);
        Sound.volume = SoundVolume;
        Sound.play().catch(() => {
            const Fallbacks = {
                click: [520, .06, "square"],
                cross: [230, .12, "sawtooth"],
                restore: [410, .1, "triangle"],
                join: [620, .14, "sine"],
                message: [760, .08, "sine"],
                ready: [480, .14, "triangle"],
                fail: [95, .42, "sawtooth"],
                life: [72, .6, "square"],
                success: [680, .3, "triangle"]
            };
            const Values = Fallbacks[Name] || [440, .08, "sine"];
            PlayTone(Values[0], Values[1], 0.08, Values[2]);
        });
    }

    function StopMusic() {
        MusicElement?.pause();
        MusicElement = null;
        CurrentTrack = "";
    }

    return {
        Configure,
        PlayMusic,
        PlaySound,
        StopMusic
    };
})();
