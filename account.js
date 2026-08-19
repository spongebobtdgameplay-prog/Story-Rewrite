document.addEventListener("DOMContentLoaded", async () => {
    const Status = document.getElementById("AccountStatus");
    const MusicSlider = document.getElementById("MusicVolumeSlider");
    const SoundSlider = document.getElementById("SoundVolumeSlider");
    const MusicValue = document.getElementById("MusicVolumeValue");
    const SoundValue = document.getElementById("SoundVolumeValue");

    try {
        const ProfileResult = await RequireAccount();
        const Data = await LoadStoryData();
        const Save = await LoadSave(Data);
        const Profile = ProfileResult.profile;

        document.getElementById("AccountUsername").textContent = Profile.username;
        document.getElementById("AccountLives").textContent = `${Save.lives}/${Save.maxLives}`;
        document.getElementById("AccountStars").textContent = TotalStars(Save);
        document.getElementById("AccountCleared").textContent = `${ClearedStages(Save)}/${Object.keys(Data.stages).length}`;
        document.getElementById("AccountDeaths").textContent = Save.deaths;

        const MusicPercent = Math.round(Number(Save.settings?.musicVolume ?? 0.45) * 100);
        const SoundPercent = Math.round(Number(Save.settings?.soundVolume ?? 0.75) * 100);
        MusicSlider.value = MusicPercent;
        SoundSlider.value = SoundPercent;
        MusicValue.textContent = `${MusicPercent}%`;
        SoundValue.textContent = `${SoundPercent}%`;

        StoryAudio.Configure(Save.settings);
        StoryAudio.PlayMusic("menu");
    } catch (Error) {
        Status.textContent = Error.message;
        Status.classList.add("Bad");
        return;
    }

    function UpdateVolumeLabels() {
        MusicValue.textContent = `${MusicSlider.value}%`;
        SoundValue.textContent = `${SoundSlider.value}%`;
    }

    async function SaveVolumes() {
        UpdateVolumeLabels();
        Status.textContent = "Saving settings...";
        Status.classList.remove("Bad", "Good");

        try {
            const Music = Number(MusicSlider.value) / 100;
            const Sound = Number(SoundSlider.value) / 100;
            await SaveAudioSettings(Music, Sound);
            StoryAudio.Configure({ musicVolume: Music, soundVolume: Sound });
            Status.textContent = "Settings saved.";
            Status.classList.add("Good");
        } catch (Error) {
            Status.textContent = Error.message;
            Status.classList.add("Bad");
        }
    }

    MusicSlider.addEventListener("input", UpdateVolumeLabels);
    SoundSlider.addEventListener("input", UpdateVolumeLabels);
    MusicSlider.addEventListener("change", SaveVolumes);
    SoundSlider.addEventListener("change", SaveVolumes);

    document.getElementById("ResetProgressButton").addEventListener("click", async () => {
        if (!confirm("Reset all Story Rewrite progress for this account?")) return;

        try {
            Status.textContent = "Resetting progress...";
            await ResetServerSave();
            window.location.reload();
        } catch (Error) {
            Status.textContent = Error.message;
            Status.classList.add("Bad");
        }
    });

    document.getElementById("SignOutButton").addEventListener("click", LogoutAccount);
});
