const StoryAudio = (() => {
    let AudioContextInstance = null;
    let AudioUnlocked = false;
    let SoundVolume = 0.8;
    let LastClickAt = 0;

    function Clamp(Value, Fallback) {
        const NumberValue = Number(Value);
        return Number.isFinite(NumberValue)
            ? Math.max(0, Math.min(1, NumberValue))
            : Fallback;
    }

    function GetContext() {
        if (!AudioUnlocked) return null;
        if (AudioContextInstance) return AudioContextInstance;

        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return null;

        try {
            AudioContextInstance = new AudioContextClass();
        } catch {
            AudioContextInstance = null;
        }

        return AudioContextInstance;
    }

    function ResumeAudio() {
        const Context = GetContext();
        if (!Context) return Promise.resolve(null);
        if (Context.state === "running") return Promise.resolve(Context);

        try {
            return Promise.resolve(Context.resume())
                .then(() => Context.state === "running" ? Context : null)
                .catch(() => null);
        } catch {
            return Promise.resolve(null);
        }
    }

    function DrawClick(Context) {
        if (!Context || Context.state !== "running" || SoundVolume <= 0) return false;

        const StartTime = Context.currentTime;
        const EndTime = StartTime + 0.08;
        const PrimaryTone = Context.createOscillator();
        const AccentTone = Context.createOscillator();
        const MasterGain = Context.createGain();

        PrimaryTone.type = "triangle";
        PrimaryTone.frequency.setValueAtTime(760, StartTime);
        PrimaryTone.frequency.exponentialRampToValueAtTime(420, EndTime);

        AccentTone.type = "sine";
        AccentTone.frequency.setValueAtTime(1180, StartTime);
        AccentTone.frequency.exponentialRampToValueAtTime(720, StartTime + 0.038);

        const Peak = Math.max(0.0001, 0.48 * SoundVolume);
        MasterGain.gain.setValueAtTime(0.0001, StartTime);
        MasterGain.gain.exponentialRampToValueAtTime(Peak, StartTime + 0.002);
        MasterGain.gain.exponentialRampToValueAtTime(Math.max(0.0001, Peak * 0.34), StartTime + 0.022);
        MasterGain.gain.exponentialRampToValueAtTime(0.0001, EndTime);

        PrimaryTone.connect(MasterGain);
        AccentTone.connect(MasterGain);
        MasterGain.connect(Context.destination);

        PrimaryTone.start(StartTime);
        AccentTone.start(StartTime);
        AccentTone.stop(StartTime + 0.042);
        PrimaryTone.stop(EndTime);
        return true;
    }

    function PlayClick() {
        if (SoundVolume <= 0) return Promise.resolve(false);

        const CurrentTime = Date.now();
        if (CurrentTime - LastClickAt < 120) return Promise.resolve(false);
        LastClickAt = CurrentTime;

        return ResumeAudio().then(Context => DrawClick(Context));
    }

    function ClickableTarget(Target) {
        const Clickable = Target?.closest?.(
            "button,[role='button'],a[href],input[type='button'],input[type='submit'],summary,[data-story-go],[data-story-back]"
        );

        if (!Clickable || Clickable.disabled || Clickable.getAttribute("aria-disabled") === "true") {
            return null;
        }

        if (Clickable.closest("#ChatForm, #GameChatForm")) return null;

        return Clickable;
    }

    function PlayClickFromCompletedClick(Event) {
        if (!ClickableTarget(Event.target)) return;
        AudioUnlocked = true;
        PlayClick();
    }

    document.addEventListener("click", PlayClickFromCompletedClick, { capture: true });

    function Configure(Settings = {}) {
        SoundVolume = Clamp(Settings.soundVolume, SoundVolume);
    }

    function UnlockAudio() {
        AudioUnlocked = true;
        return ResumeAudio();
    }

    function PlaySound() {
        return PlayClick();
    }

    function ShutdownLegacyAudio() {
        AudioUnlocked = false;

        if (AudioContextInstance?.state === "running") {
            try {
                const SuspendPromise = AudioContextInstance.suspend();
                if (SuspendPromise?.catch) SuspendPromise.catch(() => {});
            } catch {}
        }
    }

    function GetSoundState() {
        return {
            audioUnlocked: AudioUnlocked,
            contextState: AudioContextInstance?.state || "closed",
            soundVolume: SoundVolume
        };
    }

    PlaySound.V11Wrapped = true;

    return {
        Configure,
        PlayMusic() {},
        PlaySound,
        StopMusic() {},
        UnlockAudio,
        ShutdownLegacyAudio,
        GetSoundState
    };
})();
