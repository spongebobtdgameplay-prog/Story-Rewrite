function RenderCachedMainPlayerState() {
    const ProfileResult = typeof GetCachedProfileResult === "function" ? GetCachedProfileResult() : null;
    const Save = typeof GetCachedServerSave === "function" ? GetCachedServerSave() : null;

    if (ProfileResult?.profile?.username) {
        document.getElementById("AccountButtonLabel").textContent = ProfileResult.profile.username;
    }

    if (!Save) return;

    const Stars = Object.values(Save.stars || {}).reduce(
        (Total, Count) => Total + Number(Count || 0),
        0
    );

    document.getElementById("StarCount").textContent = Stars;
    document.getElementById("LivesCount").textContent = `${Save.lives}/${Save.maxLives}`;

    if (Save.settings) StoryAudio.Configure(Save.settings);
}

RenderCachedMainPlayerState();

document.addEventListener("DOMContentLoaded", async () => {
    try {
        const ProfileResult = await RequireAccount();
        const Data = await LoadStoryData();
        const Save = await LoadSave(Data);

        document.getElementById("AccountButtonLabel").textContent = ProfileResult.profile.username;
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
    } catch (Error) {
        const ErrorBox = document.getElementById("LoadError");
        if (ErrorBox) {
            ErrorBox.classList.remove("Hidden");
            ErrorBox.textContent = Error.message;
        }
    }
});
