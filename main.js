const MainPlayerSnapshotKey = "StoryRewriteMainPlayerSnapshotV1";

function GetMainAuthMarker() {
    const Token = typeof GetAuthToken === "function" ? String(GetAuthToken() || "") : "";
    if (!Token) return "";
    return `${Token.length}:${Token.slice(-8)}`;
}

function ReadMainPlayerSnapshot() {
    try {
        const Snapshot = JSON.parse(sessionStorage.getItem(MainPlayerSnapshotKey) || "null");
        if (!Snapshot || Snapshot.authMarker !== GetMainAuthMarker()) return null;
        return Snapshot;
    } catch {
        return null;
    }
}

function WriteMainPlayerSnapshot(ProfileResult, Data, Save) {
    const Snapshot = {
        authMarker: GetMainAuthMarker(),
        username: String(ProfileResult?.profile?.username || ""),
        worldCount: Number(Data?.worlds?.length || 0),
        levelCount: Number(Object.keys(Data?.stages || {}).length),
        starCount: TotalStars(Save),
        lives: Number(Save?.lives || 0),
        maxLives: Number(Save?.maxLives || 0)
    };

    try { sessionStorage.setItem(MainPlayerSnapshotKey, JSON.stringify(Snapshot)); } catch {}
}

function RenderMainPlayerSnapshot() {
    const Snapshot = ReadMainPlayerSnapshot();
    if (!Snapshot) return;

    if (Snapshot.username) document.getElementById("AccountButtonLabel").textContent = Snapshot.username;
    document.getElementById("WorldCount").textContent = Snapshot.worldCount;
    document.getElementById("LevelCount").textContent = Snapshot.levelCount;
    document.getElementById("StarCount").textContent = Snapshot.starCount;
    document.getElementById("LivesCount").textContent = `${Snapshot.lives}/${Snapshot.maxLives}`;
}

RenderMainPlayerSnapshot();

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

        WriteMainPlayerSnapshot(ProfileResult, Data, Save);

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
