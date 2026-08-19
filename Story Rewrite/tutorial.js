document.addEventListener("DOMContentLoaded", async () => {
    const Demo = document.getElementById("DemoSentence");
    Demo.addEventListener("click", () => Demo.classList.toggle("Crossed"));

    try {
        const Data = await LoadStoryData();
        const Save = LoadSave(Data);
        document.getElementById("StartButton").addEventListener("click", () => {
            Save.tutorialSeen = true;
            SaveProgress(Data, Save);
            window.location.href = "levels.html";
        });
    } catch {
        document.getElementById("StartButton").addEventListener("click", () => {
            window.location.href = "levels.html";
        });
    }
});
