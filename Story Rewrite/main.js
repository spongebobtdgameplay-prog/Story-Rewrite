document.addEventListener("DOMContentLoaded", async () => {
    try {
        const Data = await LoadStoryData();
        const Save = LoadSave(Data);

        document.getElementById("WorldCount").textContent = Data.worlds.length;
        document.getElementById("LevelCount").textContent = Object.keys(Data.stages).length;
        document.getElementById("StarCount").textContent = TotalStars(Save);

        document.getElementById("ContinueButton").addEventListener("click", () => {
            const StageId = IsStageUnlocked(Save, Save.currentStage)
                ? Save.currentStage
                : Data.worlds[0].entryStage;
            GoStage(StageId);
        });

        document.getElementById("ResetButton").addEventListener("click", () => {
            if (!confirm("Reset all Story Rewrite progress?")) return;
            ResetSave(Data);
            window.location.reload();
        });
    } catch (Error) {
        document.getElementById("LoadError").classList.remove("Hidden");
        document.getElementById("LoadError").textContent = `${Error.message}. Open the project through GitHub Pages or run node server.js locally.`;
    }
});
