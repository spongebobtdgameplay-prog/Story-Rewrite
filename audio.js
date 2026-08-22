const StoryAudio = (() => {
    let AudioContextInstance = null;
    let AudioUnlocked = false;
    let MusicVolume = 0.45;
    let SoundVolume = 0.75;
    let CurrentTrack = "";
    let PendingMusicName = "";
    let AmbientName = "";
    let AmbientMaster = null;
    let AmbientFilter = null;
    let AmbientOscillators = [];
    let AmbientLfo = null;
    let AmbientLfoGain = null;
    let AmbientPulseTimer = null;

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

    function Clamp(Value, Minimum, Maximum, Fallback) {
        const NumberValue = Number(Value);
        return Number.isFinite(NumberValue)
            ? Math.max(Minimum, Math.min(Maximum, NumberValue))
            : Fallback;
    }

    function Configure(Settings = {}) {
        MusicVolume = Clamp(Settings.musicVolume, 0, 1, MusicVolume);
        SoundVolume = Clamp(Settings.soundVolume, 0, 1, SoundVolume);
        UpdateAmbientVolume();

        if (MusicVolume <= 0) {
            StopAmbient();
            return;
        }

        if (AudioUnlocked && PendingMusicName && !AmbientMaster) {
            StartAmbient(PendingMusicName);
        }
    }

    function CreateContext() {
        if (!AudioUnlocked) return null;

        if (!AudioContextInstance) {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (!AudioContextClass) return null;
            AudioContextInstance = new AudioContextClass();
        }

        return AudioContextInstance;
    }

    function ResumeContextFromGesture() {
        const Context = CreateContext();
        if (!Context) return Promise.resolve(null);
        if (Context.state === "running") return Promise.resolve(Context);

        return Context.resume()
            .then(() => Context.state === "running" ? Context : null)
            .catch(() => null);
    }

    function UnlockAudioFromGesture() {
        if (window.StoryRealAudioActive) return Promise.resolve(null);
        if (!AudioUnlocked) AudioUnlocked = true;

        return ResumeContextFromGesture().then(Context => {
            if (Context && PendingMusicName && MusicVolume > 0) {
                StartAmbient(PendingMusicName);
            }

            return Context;
        });
    }

    document.addEventListener("pointerdown", UnlockAudioFromGesture, { capture: true, passive: true });
    document.addEventListener("keydown", UnlockAudioFromGesture, { capture: true });
    document.addEventListener("touchstart", UnlockAudioFromGesture, { capture: true, passive: true });

    function PlayTone(Frequency, Duration, GainAmount = 0.08, Type = "sine", StartDelay = 0, EndFrequency = null) {
        const Context = CreateContext();
        if (!Context || Context.state !== "running" || SoundVolume <= 0) return;

        const StartTime = Context.currentTime + Math.max(0, StartDelay);
        const EndTime = StartTime + Math.max(0.03, Duration);
        const Oscillator = Context.createOscillator();
        const Gain = Context.createGain();

        Oscillator.type = Type;
        Oscillator.frequency.setValueAtTime(Math.max(20, Frequency), StartTime);

        if (Number.isFinite(EndFrequency)) {
            Oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, EndFrequency), EndTime);
        }

        Gain.gain.setValueAtTime(0.0001, StartTime);
        Gain.gain.exponentialRampToValueAtTime(
            Math.max(0.0001, GainAmount * SoundVolume),
            StartTime + Math.min(0.025, Duration * 0.25)
        );
        Gain.gain.exponentialRampToValueAtTime(0.0001, EndTime);

        Oscillator.connect(Gain);
        Gain.connect(Context.destination);
        Oscillator.start(StartTime);
        Oscillator.stop(EndTime + 0.04);
    }

    function PlayNoise(Duration = 0.12, GainAmount = 0.06, StartDelay = 0, FilterFrequency = 1800) {
        const Context = CreateContext();
        if (!Context || Context.state !== "running" || SoundVolume <= 0) return;

        const SampleCount = Math.max(1, Math.floor(Context.sampleRate * Duration));
        const Buffer = Context.createBuffer(1, SampleCount, Context.sampleRate);
        const Data = Buffer.getChannelData(0);

        for (let Index = 0; Index < SampleCount; Index += 1) {
            const Fade = 1 - Index / SampleCount;
            Data[Index] = (Math.random() * 2 - 1) * Fade;
        }

        const Source = Context.createBufferSource();
        const Filter = Context.createBiquadFilter();
        const Gain = Context.createGain();
        const StartTime = Context.currentTime + Math.max(0, StartDelay);

        Source.buffer = Buffer;
        Filter.type = "lowpass";
        Filter.frequency.value = FilterFrequency;
        Filter.Q.value = 0.7;
        Gain.gain.setValueAtTime(Math.max(0.0001, GainAmount * SoundVolume), StartTime);
        Gain.gain.exponentialRampToValueAtTime(0.0001, StartTime + Duration);

        Source.connect(Filter);
        Filter.connect(Gain);
        Gain.connect(Context.destination);
        Source.start(StartTime);
        Source.stop(StartTime + Duration + 0.02);
    }

    function StopAmbient() {
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

    function StartAmbient(Name) {
        if (!AudioUnlocked || MusicVolume <= 0) return;

        const Context = CreateContext();
        if (!Context || Context.state !== "running") return;

        if (AmbientName === Name && AmbientMaster) {
            UpdateAmbientVolume();
            return;
        }

        StopAmbient();

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
        const Context = AudioContextInstance;
        if (!Context || Context.state !== "running" || !AmbientMaster || !AmbientFilter || MusicVolume <= 0) return;

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
            Gain.gain.exponentialRampToValueAtTime(
                Math.max(0.0001, MusicVolume * 0.018),
                StartTime + 0.14
            );
            Gain.gain.exponentialRampToValueAtTime(0.0001, StartTime + Duration);

            Oscillator.connect(Gain);
            Gain.connect(AmbientFilter);
            Oscillator.start(StartTime);
            Oscillator.stop(StartTime + Duration + 0.04);
        });
    }

    function PlayMusic(Name) {
        const SelectedName = AmbientPresets[Name] ? Name : "menu";
        PendingMusicName = SelectedName;
        CurrentTrack = SelectedName;

        if (!AudioUnlocked) return;
        StartAmbient(SelectedName);
    }

    function PlaySoundNow(Name) {
        switch (Name) {
            case "click":
                PlayTone(560, 0.055, 0.045, "square", 0, 440);
                break;

            case "cross":
                PlayNoise(0.1, 0.055, 0, 1200);
                PlayTone(260, 0.14, 0.05, "sawtooth", 0, 145);
                break;

            case "restore":
                PlayTone(280, 0.1, 0.05, "triangle", 0, 390);
                PlayTone(440, 0.14, 0.045, "sine", 0.075, 560);
                break;

            case "join":
                PlayTone(392, 0.11, 0.045, "sine", 0);
                PlayTone(523.25, 0.13, 0.05, "sine", 0.08);
                PlayTone(659.25, 0.16, 0.055, "triangle", 0.16);
                break;

            case "message":
                PlayTone(880, 0.07, 0.04, "sine", 0);
                PlayTone(1174.66, 0.09, 0.028, "sine", 0.055);
                break;

            case "ready":
                PlayTone(330, 0.09, 0.045, "triangle", 0);
                PlayTone(440, 0.1, 0.05, "triangle", 0.07);
                PlayTone(660, 0.15, 0.055, "sine", 0.14);
                break;

            case "fail":
                PlayNoise(0.28, 0.06, 0, 700);
                PlayTone(130, 0.42, 0.075, "sawtooth", 0, 62);
                PlayTone(78, 0.54, 0.05, "square", 0.09, 45);
                break;

            case "life":
                PlayNoise(0.18, 0.08, 0, 480);
                PlayTone(92, 0.55, 0.08, "square", 0, 43);
                PlayTone(61, 0.72, 0.055, "sawtooth", 0.12, 32);
                break;

            case "success":
                PlayTone(523.25, 0.18, 0.052, "triangle", 0);
                PlayTone(659.25, 0.22, 0.052, "triangle", 0.11);
                PlayTone(783.99, 0.3, 0.058, "sine", 0.22);
                PlayTone(1046.5, 0.42, 0.038, "sine", 0.32);
                break;

            case "vote":
                PlayTone(480, 0.055, 0.038, "sine", 0, 610);
                PlayTone(680, 0.08, 0.025, "triangle", 0.04, 780);
                break;

            case "revive":
                PlayTone(220, 0.16, 0.05, "sine", 0, 330);
                PlayTone(440, 0.2, 0.052, "triangle", 0.11, 660);
                PlayTone(880, 0.28, 0.042, "sine", 0.23, 1040);
                break;

            case "reviveEarned":
            case "heartRefill":
                PlayTone(392, 0.12, 0.045, "sine");
                PlayTone(523.25, 0.15, 0.048, "triangle", 0.08);
                PlayTone(783.99, 0.22, 0.048, "sine", 0.16);
                break;

            default:
                PlayTone(440, 0.08, 0.04, "sine");
                break;
        }
    }

    function PlaySound(Name) {
        if (!AudioUnlocked || SoundVolume <= 0) return;

        const Context = CreateContext();
        if (!Context) return;

        if (Context.state !== "running") {
            Context.resume()
                .then(() => {
                    if (Context.state === "running") PlaySoundNow(Name);
                })
                .catch(() => {});
            return;
        }

        PlaySoundNow(Name);
    }

    function StopMusic() {
        PendingMusicName = "";
        CurrentTrack = "";
        StopAmbient();
    }

    function ShutdownLegacyAudio() {
        AudioUnlocked = false;
        PendingMusicName = "";
        CurrentTrack = "";
        StopAmbient();

        if (AudioContextInstance?.state === "running") {
            const SuspendPromise = AudioContextInstance.suspend();
            if (SuspendPromise?.catch) SuspendPromise.catch(() => {});
        }
    }

    PlaySound.V11Wrapped = true;

    return {
        Configure,
        PlayMusic,
        PlaySound,
        StopMusic,
        UnlockAudio: UnlockAudioFromGesture,
        ShutdownLegacyAudio
    };
})();
