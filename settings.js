function CloneSettingsSave(Save) {
    try {
        return Save == null ? Save : JSON.parse(JSON.stringify(Save));
    } catch {
        return Save;
    }
}

const KeepMusicPlayingKey = "StoryRewriteKeepMusicPlayingV1";
function ReadKeepMusicPlaying() {
    try { return localStorage.getItem(KeepMusicPlayingKey) === "1"; } catch { return false; }
}

function ApplyKeepMusicPlaying(Enabled) {
    try {
        if (window.parent !== window && window.parent.StoryShell?.IsPersistentShell) {
            window.parent.StoryShell.SetKeepMusicPlaying(Enabled);
            return;
        }
    } catch {}

    if (typeof StoryAudio !== "undefined" && typeof StoryAudio.SetKeepMusicPlaying === "function") {
        StoryAudio.SetKeepMusicPlaying(Enabled);
    }
}

function RenderKeepMusicPlaying() {
    if (!KeepMusicButton || !KeepMusicState) return;
    const Enabled = ReadKeepMusicPlaying();
    KeepMusicButton.setAttribute("aria-checked", Enabled ? "true" : "false");
    KeepMusicState.textContent = Enabled ? "On" : "Off";
}

function SetVolumeControl(Slider, Output, Value) {
    const Percent = Math.max(0, Math.min(100, Math.round((Number(Value) || 0) * 100)));
    Slider.value = Percent;
    Output.textContent = `${Percent}%`;
    Slider.setAttribute("aria-valuetext", `${Percent}%`);
}

function ApplyAudio(Settings) {
    const Next = {
        musicVolume: Math.max(0, Math.min(1, Number(Settings?.musicVolume ?? 0.45))),
        soundVolume: Math.max(0, Math.min(1, Number(Settings?.soundVolume ?? 0.75)))
    };

    if (typeof StoryAudio !== "undefined") {
        StoryAudio.Configure(Next);
    }

    try {
        const Shell = window.parent !== window && window.parent.StoryShell?.IsPersistentShell
            ? window.parent.StoryShell
            : null;

        if (Shell && typeof Shell.ConfigureAudio === "function") {
            Shell.ConfigureAudio(Next);
        }
    } catch {}

    return Next;
}

function RenderSettings() {
    if (!SettingsSave) return;
    const Audio = SettingsSave.settings || {};
    SetVolumeControl(MusicSlider, MusicValue, Audio.musicVolume ?? 0.45);
    SetVolumeControl(SoundSlider, SoundValue, Audio.soundVolume ?? 0.75);
    ApplyAudio(Audio);
    RenderKeepMusicPlaying();
}

let PresenceExpiresAt = 0;
let PresenceStatus = "online";
let PresenceSaveInFlight = false;
let PresenceSaveQueued = false;
let PresenceSettingsTouched = false;

function RenderPresenceSelection(Status) {
    for (const Button of PresenceButtons) {
        const Selected = Button.dataset.presenceStatus === Status;
        Button.setAttribute("aria-checked", Selected ? "true" : "false");
    }
}

function UpdatePresenceButtonTitles() {
    const Duration = Number(PresenceDurationSelect?.value || 0);
    const ExpiresAtLabel = PresenceExpiresAt > Date.now()
        ? " · expires at " + new Date(PresenceExpiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
        : "";
    const DurationText = Duration > 0
        ? `Set for ${Duration} minutes` + ExpiresAtLabel
        : "No expiry (infinite)";

    for (const Button of PresenceButtons) {
        const Status = String(Button.dataset.presenceStatus || "online");
        const Label = Status === "ghost" ? "Offline (hidden)" : Status.charAt(0).toUpperCase() + Status.slice(1);
        Button.title = Label + " status. " + DurationText + ".";
    }
}

function RenderPresenceControls(Payload) {
    const PrivatePresence = Payload?.privatePresence || {};
    PresenceStatus = ["online", "idle", "ghost"].includes(PrivatePresence.status)
        ? PrivatePresence.status
        : "online";
    PresenceExpiresAt = Math.max(0, Number(PrivatePresence.expiresAt || 0));

    RenderPresenceSelection(PresenceStatus);

    if (PresenceDurationSelect) {
        const Remaining = Math.max(0, PresenceExpiresAt - Date.now());
        const SavedDuration = Number(PrivatePresence.durationMinutes || 0);
        let Duration = Remaining > 0 && [15, 30, 60].includes(SavedDuration)
            ? SavedDuration
            : 0;

        // Compatibility with a backend that has not yet stored the duration field.
        // Use the nearest remaining-time bucket instead of requiring a 5-second match.
        if (Remaining > 0 && Duration === 0) {
            const Options = [15, 30, 60];
            const Nearest = Options.reduce((Best, Minutes) =>
                Math.abs((Minutes * 60000) - Remaining) < Math.abs((Best * 60000) - Remaining)
                    ? Minutes
                    : Best, Options[0]);
            if (Math.abs((Nearest * 60000) - Remaining) <= 60000) Duration = Nearest;
        }

        PresenceDurationSelect.value = String(Duration);
    }
    UpdatePresenceButtonTitles();
}

function SetPresenceStatusLine(Text, Kind = "") {
    if (!PresenceStatusLine) return;
    PresenceStatusLine.textContent = Text || "";
    PresenceStatusLine.className = "StoryPresenceStatusLine" + (Kind ? " " + Kind : "");
}

async function LoadPresenceSettings() {
    try {
        const Result = await ApiRequest("/api/social/me");
        // Do not overwrite a choice made while the initial request was in flight.
        if (PresenceSettingsTouched) return;
        RenderPresenceControls(Result);
        SetPresenceStatusLine("Presence is saved to your account.");
    } catch (Error) {
        if (!PresenceSettingsTouched) SetPresenceStatusLine(Error.message || "Could not load presence.", "Bad");
    }
}

async function SavePresenceSettings() {
    if (PresenceSaveInFlight) {
        PresenceSaveQueued = true;
        return;
    }
    PresenceSaveInFlight = true;
    PresenceSaveQueued = false;

    const RequestedStatus = PresenceStatus;
    const RequestedDuration = Number(PresenceDurationSelect?.value || 0);
    UpdatePresenceButtonTitles();
    SetPresenceStatusLine("Saving presence...");

    try {
        const Result = await ApiRequest("/api/social/status", {
            method: "POST",
            body: JSON.stringify({
                status: RequestedStatus,
                durationMinutes: RequestedDuration
            })
        });

        const ChangedWhileSaving = PresenceStatus !== RequestedStatus ||
            Number(PresenceDurationSelect?.value || 0) !== RequestedDuration;
        if (ChangedWhileSaving) {
            PresenceSaveQueued = true;
        } else {
            RenderPresenceControls(Result);
            SetPresenceStatusLine(
                RequestedStatus === "ghost"
                    ? "Offline mode is active. Other players will see you as offline."
                    : RequestedStatus === "idle"
                        ? "Idle status is active."
                        : "Online status is active.",
                "Good"
            );
        }
    } catch (Error) {
        SetPresenceStatusLine(Error.message || "Could not save presence.", "Bad");
    } finally {
        PresenceSaveInFlight = false;
        if (PresenceSaveQueued) {
            PresenceSaveQueued = false;
            SavePresenceSettings();
        }
    }
}

async function SaveVolumes() {
    const Music = Number(MusicSlider.value) / 100;
    const Sound = Number(SoundSlider.value) / 100;

    SettingsSave = NormalizeSave(SettingsData, {
        ...CloneSettingsSave(SettingsSave),
        settings: {
            ...(SettingsSave?.settings || {}),
            musicVolume: Music,
            soundVolume: Sound
        }
    });

    ApplyAudio(SettingsSave.settings);
    Status.textContent = "Saving settings...";
    Status.className = "StorySettingsStatus";

    try {
        const Result = await SaveAudioSettings(Music, Sound);

        if (Result?.save) {
            SettingsSave = NormalizeSave(SettingsData, CloneSettingsSave(Result.save));
        }

        // Re-apply the values the user actually selected so a delayed/stale
        // response cannot put the playing audio back at the old level.
        ApplyAudio({
            musicVolume: Music,
            soundVolume: Sound
        });

        Status.textContent = "Settings saved.";
        Status.className = "StorySettingsStatus Good";
    } catch (Error) {
        Status.textContent = Error.message;
        Status.className = "StorySettingsStatus Bad";
    }
}


async function LoadYouTubeConnection() {
    const StatusLine = document.getElementById("YouTubeConnectionStatus");
    const ChannelLine = document.getElementById("YouTubeConnectedChannel");
    const ConnectButton = document.getElementById("YouTubeConnectButton");
    const DisconnectButton = document.getElementById("YouTubeDisconnectButton");
    if (!StatusLine || !ConnectButton) return;
    StatusLine.textContent = "Checking YouTube connection…";
    try {
        const Result = await ApiRequest("/api/youtube/status");
        if (Result.connected && Result.channel) {
            StatusLine.textContent = "Your YouTube account is connected.";
            ChannelLine.textContent = Result.channel.title || "Connected channel";
            ChannelLine.hidden = false;
            ConnectButton.textContent = "Reconnect YouTube";
            DisconnectButton.hidden = false;
        } else {
            StatusLine.textContent = "No YouTube account is connected.";
            ChannelLine.hidden = true;
            ConnectButton.textContent = "Connect YouTube";
            DisconnectButton.hidden = true;
        }
    } catch (Error) {
        StatusLine.textContent = Error.message || "Could not check YouTube connection.";
    }
}

async function ConnectYouTubeAccount() {
    const Button = document.getElementById("YouTubeConnectButton");
    const StatusLine = document.getElementById("YouTubeConnectionStatus");
    if (Button) Button.disabled = true;
    if (StatusLine) StatusLine.textContent = "Opening Google sign-in…";
    try {
        const Result = await ApiRequest("/api/youtube/connect", { method: "POST", body: "{}" });
        if (!Result.url) throw new Error("Google did not return a sign-in link.");
        window.location.assign(Result.url);
    } catch (Error) {
        if (StatusLine) StatusLine.textContent = Error.message || "Could not start YouTube connection.";
        if (Button) Button.disabled = false;
    }
}

async function DisconnectYouTubeAccount() {
    const StatusLine = document.getElementById("YouTubeConnectionStatus");
    const Button = document.getElementById("YouTubeDisconnectButton");
    if (Button) Button.disabled = true;
    try {
        await ApiRequest("/api/youtube/disconnect", { method: "POST", body: "{}" });
        await LoadYouTubeConnection();
        if (StatusLine) StatusLine.textContent = "YouTube account disconnected.";
    } catch (Error) {
        if (StatusLine) StatusLine.textContent = Error.message || "Could not disconnect YouTube.";
    } finally {
        if (Button) Button.disabled = false;
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    MusicSlider = document.getElementById("MusicVolumeSlider");
    SoundSlider = document.getElementById("SoundVolumeSlider");
    MusicValue = document.getElementById("MusicVolumeValue");
    SoundValue = document.getElementById("SoundVolumeValue");
    KeepMusicButton = document.getElementById("KeepMusicPlayingButton");
    KeepMusicState = document.getElementById("KeepMusicPlayingState");
    Status = document.getElementById("SettingsStatus");
    PresenceButtons = Array.from(document.querySelectorAll("[data-presence-status]"));
    PresenceDurationSelect = document.getElementById("PresenceDurationSelect");
    PresenceStatusLine = document.getElementById("PresenceStatusLine");

    RenderKeepMusicPlaying();
    ApplyKeepMusicPlaying(ReadKeepMusicPlaying());


    PresenceButtons.forEach(Button => {
        Button.addEventListener("click", () => {
            PresenceSettingsTouched = true;
            PresenceStatus = Button.dataset.presenceStatus || "online";
            PresenceExpiresAt = 0;
            // Update the selected state immediately, before waiting on the server.
            RenderPresenceSelection(PresenceStatus);
            UpdatePresenceButtonTitles();
            SetPresenceStatusLine("Applying " + (PresenceStatus === "ghost" ? "offline" : PresenceStatus) + " status…");
            SavePresenceSettings();
        });
    });

    PresenceDurationSelect?.addEventListener("change", () => {
        PresenceSettingsTouched = true;
        PresenceExpiresAt = 0;
        UpdatePresenceButtonTitles();
        SavePresenceSettings();
    });
    document.getElementById("OpenSocialButton")?.addEventListener("click", () => {
        if (typeof StoryNavigate === "function") StoryNavigate("social.html");
        else window.location.href = BuildStoryUrl("social.html");
    });

    LoadPresenceSettings();

    KeepMusicButton.addEventListener("click", () => {
        const Enabled = !ReadKeepMusicPlaying();
        localStorage.setItem(KeepMusicPlayingKey, Enabled ? "1" : "0");
        ApplyKeepMusicPlaying(Enabled);
        RenderKeepMusicPlaying();
    });

    try {
        const [, Data] = await Promise.all([
            RequireAccount(),
            LoadStoryData()
        ]);
        const CachedSave = typeof GetLastKnownServerSave === "function" ? GetLastKnownServerSave() : null;
        const Save = CachedSave || await FetchServerSave();
        SettingsData = Data;
        SettingsSave = NormalizeSave(SettingsData, CloneSettingsSave(Save));
        document.getElementById("YouTubeConnectButton")?.addEventListener("click", ConnectYouTubeAccount);
        document.getElementById("YouTubeDisconnectButton")?.addEventListener("click", DisconnectYouTubeAccount);
        const YouTubeResult = new URLSearchParams(window.location.search).get("youtube");
        if (YouTubeResult === "connected") {
            const Line = document.getElementById("YouTubeConnectionStatus");
            if (Line) Line.textContent = "YouTube connected successfully.";
            window.history.replaceState({}, "", window.location.pathname);
        } else if (YouTubeResult === "error") {
            const Line = document.getElementById("YouTubeConnectionStatus");
            if (Line) Line.textContent = "YouTube connection failed: " + (new URLSearchParams(window.location.search).get("reason") || "Please try again.");
            window.history.replaceState({}, "", window.location.pathname);
        }
        await LoadYouTubeConnection();
        RenderSettings();

        MusicSlider.addEventListener("input", () => {
            const Music = Number(MusicSlider.value) / 100;
            const Sound = Number(SoundSlider.value) / 100;
            SetVolumeControl(MusicSlider, MusicValue, Music);
            ApplyAudio({ musicVolume: Music, soundVolume: Sound });
        });
        SoundSlider.addEventListener("input", () => {
            const Music = Number(MusicSlider.value) / 100;
            const Sound = Number(SoundSlider.value) / 100;
            SetVolumeControl(SoundSlider, SoundValue, Sound);
            ApplyAudio({ musicVolume: Music, soundVolume: Sound });
        });
        MusicSlider.addEventListener("change", SaveVolumes);
        SoundSlider.addEventListener("change", SaveVolumes);
    } catch (Error) {
        Status.textContent = Error.message;
        Status.className = "StorySettingsStatus Bad";
    }
});
