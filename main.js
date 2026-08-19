document.addEventListener("DOMContentLoaded", async () => {
    try {
        const ProfileResult = await RequireAccount();
        const Data = await LoadStoryData();
        const Save = await LoadSave(Data);

        document.getElementById("AccountBadge").textContent = ProfileResult.profile.username;
        document.getElementById("WorldCount").textContent = Data.worlds.length;
        document.getElementById("LevelCount").textContent = Object.keys(Data.stages).length;
        document.getElementById("StarCount").textContent = TotalStars(Save);
        document.getElementById("LivesCount").textContent = `${Save.lives}/${Save.maxLives}`;

        StoryAudio.Configure(Save.settings);
        StoryAudio.PlayMusic("menu");

        document.getElementById("ContinueButton").addEventListener("click", async () => {
            const StageId = IsStageUnlocked(Save, Save.currentStage)
                ? Save.currentStage
                : Data.worlds[0].entryStage;
            await EnterServerStage(StageId);
            StoryAudio.PlaySound("click");
            GoStage(StageId);
        });

        document.getElementById("ResetButton").addEventListener("click", async () => {
            if (!confirm("Reset all Story Rewrite server progress?")) return;
            await ResetSave();
            window.location.reload();
        });

        document.getElementById("LogoutButton").addEventListener("click", LogoutAccount);
    } catch (Error) {
        const ErrorBox = document.getElementById("LoadError");
        if (ErrorBox) {
            ErrorBox.classList.remove("Hidden");
            ErrorBox.textContent = Error.message;
        }
    }
});
