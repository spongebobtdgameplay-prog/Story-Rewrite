const StoryAudio = (() => {
    let AudioContextInstance = null;
    let MusicElement = null;
    let MusicVolume = 0.45;
    let SoundVolume = 0.75;
    let CurrentTrack = "";
    let AmbientName = "";
    let AmbientMaster = null;
    let AmbientFilter = null;
    let AmbientOscillators = [];
    let AmbientLfo = null;
    let AmbientLfoGain = null;
    let AmbientPulseTimer = null;

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

    const AmbientPresets = {
        menu: {
            base: 82.41,
            voices: [1, 1.5, 2],
            detune: [-6, 3, 8],
            filter: 520,
            lfo: 0.055,
            pulse: [164.81, 207.65, 246.94],
            pulseEvery: 6200,
            type: "sine"
        },
        lobby: {
            base: 98,
            voices: [1, 1.25, 1.5],
            detune: [-5, 4, 9],
            filter: 680,
            lfo: 0.07,
            pulse: [196, 246.94, 293.66],
            pulseEvery: 5200,
            type: "triangle"
        },
        fromville: {
            base: 55,
            voices: [1, 1.01, 1.5],
            detune: [-11, 7, -4],
            filter: 330,
            lfo: 0.038,
            pulse: [73.42, 82.41, 110],
            pulseEvery: 7600,
            type: "sine"
        },
        anime: {
            base: 110,
            voices: [1, 1.5, 2],
            detune: [-3, 5, 7],
            filter: 900,
            lfo: 0.09,
            pulse: [220, 261.63, 329.63],
            pulseEvery: 4300,
            type: "triangle"
        },
        manor: {
            base: 46.25,
            voices: [1, 1.5, 2.01],
            detune: [-8, 4, -5],
            filter: 300,
            lfo: 0.032,
            pulse: [69.3, 92.5, 138.59],
            pulseEvery: 8500,
            type: "sine"
        },
        forest: {
            base: 123.47,
            voices: [0.5, 1, 1.5],
            detune: [-4, 5, 2],
            filter: 1000,
            lfo: 0.082,
            pulse: [246.94, 293.66, 369.99],
            pulseEvery: 4800,
            type: "sine"
        },
        city: {
            base: 65.41,
            voices: [1, 1.25, 2],
            detune: [-7, 6, 11],
            filter: 470,
            lfo: 0.061,
            pulse: [130.81, 155.56, 196],
            pulseEvery: 5800,
            type: "square"
        },
        danger: {
            base: 41.2,
            voices: [1, 1.01, 1.5],
            detune: [-14, 12, -7],
            filter: 240,
            lfo: 0.18,
            pulse: [55, 58.27, 82.41],
            pulseEvery: 3000,
            type: "sawtooth"
        }
    };

    function Configure(Settings = {}) {
        MusicVolume = Clamp(Settings.musicVolume, 0, 1, MusicVolume);
        SoundVolume = Clamp(Settings.soundVolume, 0, 1, SoundVolume);
        if (MusicElement) MusicElement.volume = MusicVolume;
        UpdateAmbientVolume();
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

        if (AudioContextInstance?.state === "suspended") {
            AudioContextInstance.resume().catch(() => {});
        }

        return AudioContextInstance;
    }

    function PlayTone(Frequency, Duration, GainAmount = 0.08, Type = "sine", StartDelay = 0) {
        const Context = EnsureContext();
        if (!Context || SoundVolume <= 0) return;

        const StartTime = Context.currentTime + StartDelay;
        const Oscillator = Context.createOscillator();
        const Gain = Context.createGain();

        Oscillator.type = Type;
        Oscillator.frequency.value = Frequency;
        Gain.gain.setValueAtTime(0.0001, StartTime);
        Gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, GainAmount * SoundVolume), StartTime + 0.025);
        Gain.gain.exponentialRampToValueAtTime(0.0001, StartTime + Duration);

        Oscillator.connect(Gain);
        Gain.connect(Context.destination);
        Oscillator.start(StartTime);
        Oscillator.stop(StartTime + Duration + 0.03);
    }

    function StopAmbientFallback() {
        if (AmbientPulseTimer) {
            clearInterval(AmbientPulseTimer);
            AmbientPulseTimer = null;
        }

        for (const Oscillator of AmbientOscillators) {
            try {
                Oscillator.stop();
            } catch {}
        }

        try {
            AmbientLfo?.stop();
        } catch {}

        AmbientOscillators = [];
        AmbientLfo = null;
        AmbientLfoGain = null;
        AmbientFilter = null;
        AmbientMaster = null;
        AmbientName = "";
    }

    function UpdateAmbientVolume() {
        if (!AmbientMaster || !AudioContextInstance) return;
        const Target = Math.max(0.0001, MusicVolume * 0.075);
        AmbientMaster.gain.cancelScheduledValues(AudioContextInstance.currentTime);
        AmbientMaster.gain.setTargetAtTime(Target, AudioContextInstance.currentTime, 0.12);
    }

    function StartAmbientFallback(Name) {
        if (AmbientName === Name && AmbientMaster) {
            UpdateAmbientVolume();
            return;
        }

        StopAmbientFallback();
        const Context = EnsureContext();
        if (!Context || MusicVolume <= 0) return;

        const Preset = AmbientPresets[Name] || AmbientPresets.menu;
        AmbientName = Name;
        AmbientMaster = Context.createGain();
        AmbientFilter = Context.createBiquadFilter();
        AmbientFilter.type = "lowpass";
        AmbientFilter.frequency.value = Preset.filter;
        AmbientFilter.Q.value = 0.7;

        AmbientMaster.gain.value = Math.max(0.0001, MusicVolume * 0.075);
        AmbientFilter.connect(AmbientMaster);
        AmbientMaster.connect(Context.destination);

        Preset.voices.forEach((Multiplier, Index) => {
            const Oscillator = Context.createOscillator();
            const VoiceGain = Context.createGain();
            Oscillator.type = Index === 0 ? Preset.type : "sine";
            Oscillator.frequency.value = Preset.base * Multiplier;
            Oscillator.detune.value = Preset.detune[Index] || 0;
            VoiceGain.gain.value = Index === 0 ? 0.34 : Index === 1 ? 0.17 : 0.09;
            Oscillator.connect(VoiceGain);
            VoiceGain.connect(AmbientFilter);
            Oscillator.start();
            AmbientOscillators.push(Oscillator);
        });

        AmbientLfo = Context.createOscillator();
        AmbientLfoGain = Context.createGain();
        AmbientLfo.type = "sine";
        AmbientLfo.frequency.value = Preset.lfo;
        AmbientLfoGain.gain.value = MusicVolume * 0.018;
        AmbientLfo.connect(AmbientLfoGain);
        AmbientLfoGain.connect(AmbientMaster.gain);
        AmbientLfo.start();

        ScheduleAmbientPulse(Preset);
        AmbientPulseTimer = setInterval(() => ScheduleAmbientPulse(Preset), Preset.pulseEvery);
    }

    function ScheduleAmbientPulse(Preset) {
        const Context = EnsureContext();
        if (!Context || !AmbientMaster || MusicVolume <= 0) return;

        const Root = Preset.pulse[Math.floor(Math.random() * Preset.pulse.length)];
        const Notes = [Root, Root * 1.25, Root * 1.5];

        Notes.forEach((Frequency, Index) => {
            const Oscillator = Context.createOscillator();
            const Gain = Context.createGain();
            const StartTime = Context.currentTime + Index * 0.18;
            const Duration = 1.7 + Index * 0.28;

            Oscillator.type = Index === 0 ? "sine" : "triangle";
            Oscillator.frequency.value = Frequency;
            Oscillator.detune.value = (Math.random() - 0.5) * 7;
            Gain.gain.setValueAtTime(0.0001, StartTime);
            Gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, MusicVolume * 0.018), StartTime + 0.14);
            Gain.gain.exponentialRampToValueAtTime(0.0001, StartTime + Duration);

            Oscillator.connect(Gain);
            Gain.connect(AmbientFilter);
            Oscillator.start(StartTime);
            Oscillator.stop(StartTime + Duration + 0.04);
        });
    }

    async function PlayMusic(Name) {
        const Source = TrackFiles[Name] || TrackFiles.menu;

        if (CurrentTrack === Source && (MusicElement || AmbientName === Name)) {
            UpdateAmbientVolume();
            return;
        }

        CurrentTrack = Source;
        StopAmbientFallback();

        if (MusicElement) {
            MusicElement.pause();
            MusicElement.removeAttribute("src");
            MusicElement.load();
            MusicElement = null;
        }

        MusicElement = new Audio(Source);
        MusicElement.loop = true;
        MusicElement.volume = MusicVolume;
        MusicElement.preload = "auto";

        let Failed = false;
        const UseFallback = () => {
            if (Failed) return;
            Failed = true;
            if (MusicElement) {
                MusicElement.pause();
                MusicElement = null;
            }
            StartAmbientFallback(Name);
        };

        MusicElement.addEventListener("error", UseFallback, { once: true });

        try {
            await MusicElement.play();
        } catch (Error) {
            if (MusicElement?.error) {
                UseFallback();
                return;
            }

            const StartAfterGesture = async () => {
                document.removeEventListener("pointerdown", StartAfterGesture);
                document.removeEventListener("keydown", StartAfterGesture);

                try {
                    if (!MusicElement) {
                        StartAmbientFallback(Name);
                        return;
                    }
                    await MusicElement.play();
                } catch {
                    UseFallback();
                }
            };

            document.addEventListener("pointerdown", StartAfterGesture, { once: true });
            document.addEventListener("keydown", StartAfterGesture, { once: true });
        }

        setTimeout(() => {
            if (CurrentTrack !== Source || Failed) return;
            if (!MusicElement || MusicElement.readyState === 0 || MusicElement.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) {
                UseFallback();
            }
        }, 1800);
    }

    function PlaySound(Name) {
        const Source = SoundFiles[Name];
        if (!Source) return;

        const Sound = new Audio(Source);
        Sound.volume = SoundVolume;
        Sound.preload = "auto";

        Sound.play().catch(() => PlayFallbackSound(Name));
        Sound.addEventListener("error", () => PlayFallbackSound(Name), { once: true });
    }

    function PlayFallbackSound(Name) {
        const Fallbacks = {
            click: [[520, 0, .06, "square"]],
            cross: [[230, 0, .12, "sawtooth"], [170, .05, .1, "triangle"]],
            restore: [[330, 0, .1, "triangle"], [440, .07, .12, "sine"]],
            join: [[520, 0, .12, "sine"], [660, .09, .16, "sine"]],
            message: [[760, 0, .08, "sine"]],
            ready: [[400, 0, .1, "triangle"], [600, .08, .14, "triangle"]],
            fail: [[110, 0, .36, "sawtooth"], [73, .11, .5, "square"]],
            life: [[92, 0, .5, "square"], [61, .15, .72, "sawtooth"]],
            success: [[523.25, 0, .18, "triangle"], [659.25, .12, .22, "triangle"], [783.99, .24, .34, "sine"]]
        };

        const Pattern = Fallbacks[Name] || [[440, 0, .08, "sine"]];
        Pattern.forEach(([Frequency, DelayAmount, Duration, Type]) => {
            PlayTone(Frequency, Duration, 0.08, Type, DelayAmount);
        });
    }

    function StopMusic() {
        if (MusicElement) {
            MusicElement.pause();
            MusicElement.removeAttribute("src");
            MusicElement.load();
            MusicElement = null;
        }
        StopAmbientFallback();
        CurrentTrack = "";
    }

    return {
        Configure,
        PlayMusic,
        PlaySound,
        StopMusic
    };
})();
