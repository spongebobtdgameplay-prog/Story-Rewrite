const MainPlayerSnapshotKey = "StoryRewriteMainPlayerSnapshotV1";
let MainProfileResult = null;
let MainData = null;
let MainSave = null;
let MainRefreshPromise = null;
let MainInitialized = false;

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

function RenderMainPlayerState() {
    if (!MainProfileResult || !MainData || !MainSave) return;

    document.getElementById("AccountButtonLabel").textContent = MainProfileResult.profile.username;
    document.getElementById("WorldCount").textContent = MainData.worlds.length;
    document.getElementById("LevelCount").textContent = Object.keys(MainData.stages).length;
    document.getElementById("StarCount").textContent = TotalStars(MainSave);
    document.getElementById("LivesCount").textContent = `${MainSave.lives}/${MainSave.maxLives}`;
    WriteMainPlayerSnapshot(MainProfileResult, MainData, MainSave);
}

async function RefreshMainPlayerState() {
    if (MainRefreshPromise) return MainRefreshPromise;

    MainRefreshPromise = (async () => {
        const ProfileResult = await RequireAccount();
        const Data = MainData || await LoadStoryData();
        const Save = await LoadSave(Data);

        MainProfileResult = ProfileResult;
        MainData = Data;
        MainSave = Save;
        RenderMainPlayerState();
        StoryAudio.Configure(Save.settings);
    })();

    try {
        await MainRefreshPromise;
    } finally {
        MainRefreshPromise = null;
    }
}

RenderMainPlayerSnapshot();

window.addEventListener("StoryShellActivate", () => {
    if (!MainInitialized) return;
    RefreshMainPlayerState().catch(() => {});
});

document.addEventListener("DOMContentLoaded", async () => {
    try {
        await RefreshMainPlayerState();
        MainInitialized = true;
        StoryAudio.PlayMusic("menu");

        document.getElementById("ContinueButton").addEventListener("click", async () => {
            if (!MainSave || !MainData) return;

            const StageId = IsStageUnlocked(MainSave, MainSave.currentStage)
                ? MainSave.currentStage
                : MainData.worlds[0].entryStage;

            MainSave = await EnterServerStage(StageId);
            RenderMainPlayerState();
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
