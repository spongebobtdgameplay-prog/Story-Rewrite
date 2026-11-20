const MainPlayerSnapshotKey = "StoryRewriteMainPlayerSnapshotV2";
let MainProfileResult = null;
let MainData = null;
let MainSave = null;
let MainInitialized = false;

function GetMainAuthMarker() {
    const Token = typeof GetAuthToken === "function" ? String(GetAuthToken() || "") : "";
    if (!Token) return "";
    return `${Token.length}:${Token.slice(-8)}`;
}

function ReadMainPlayerSnapshot() {
    try {
        const Snapshot = JSON.parse(localStorage.getItem(MainPlayerSnapshotKey) || "null");
        if (!Snapshot || Snapshot.authMarker !== GetMainAuthMarker()) return null;
        return Snapshot;
    } catch {
        return null;
    }
}

function WriteMainPlayerSnapshot(ProfileResult, Data, Save) {
    if (!ProfileResult || !Data || !Save) return;

    const Snapshot = {
        authMarker: GetMainAuthMarker(),
        username: String(ProfileResult?.profile?.username || ""),
        worldCount: Number(Data?.worlds?.length || 0),
        levelCount: Number(Object.keys(Data?.stages || {}).length),
        starCount: TotalStars(Save),
        lives: Number(Save?.lives || 0),
        maxLives: Number(Save?.maxLives || 0)
    };

    try { localStorage.setItem(MainPlayerSnapshotKey, JSON.stringify(Snapshot)); } catch {}
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

function CloneMainSave(Save) {
    try {
        return JSON.parse(JSON.stringify(Save));
    } catch {
        return Save;
    }
}

function RenderMainPlayerState() {
    if (!MainProfileResult || !MainData || !MainSave) return;

    document.getElementById("AccountButtonLabel").textContent = MainProfileResult.profile.username;
    document.getElementById("WorldCount").textContent = MainData.worlds.length;
    document.getElementById("LevelCount").textContent = Object.keys(MainData.stages).length;
    document.getElementById("StarCount").textContent = TotalStars(MainSave);
    document.getElementById("LivesCount").textContent = `${MainSave.lives}/${MainSave.maxLives}`;
    ApplyStoryCosmetic(MainSave);
    WriteMainPlayerSnapshot(MainProfileResult, MainData, MainSave);
}

function SyncMainFromLastKnownState() {
    if (!MainInitialized || !MainData) return;

    const LastProfile = typeof GetLastKnownProfileResult === "function"
        ? GetLastKnownProfileResult()
        : null;
    const LastSave = typeof GetLastKnownServerSave === "function"
        ? GetLastKnownServerSave()
        : null;

    if (LastProfile?.profile) MainProfileResult = LastProfile;
    if (LastSave) MainSave = NormalizeSave(MainData, CloneMainSave(LastSave));

    RenderMainPlayerState();
}

async function LoadMainPlayerState() {
    const ProfileResult = await RequireAccount();
    const Data = await LoadStoryData();
    const Save = await LoadSave(Data);

    MainProfileResult = ProfileResult;
    MainData = Data;
    MainSave = Save;
    RenderMainPlayerState();
    StoryAudio.Configure(Save.settings);
}

function BlockMainPageOverscroll(Event) {
    if (Event.defaultPrevented || Event.ctrlKey || !Number.isFinite(Event.deltaY) || Event.deltaY === 0) return;

    const Direction = Event.deltaY < 0 ? -1 : 1;
    const Path = typeof Event.composedPath === "function" ? Event.composedPath() : [Event.target];

    // A scrollable panel gets first use of the mouse wheel. Only contain the
    // gesture when that specific panel has reached its own edge.
    for (const Candidate of Path) {
        if (!(Candidate instanceof Element) || Candidate === document.body || Candidate === document.documentElement) continue;

        const Style = getComputedStyle(Candidate);
        if (!/(auto|scroll|overlay)/.test(Style.overflowY)) continue;
        if (Candidate.scrollHeight <= Candidate.clientHeight + 1) continue;

        const Maximum = Math.max(0, Candidate.scrollHeight - Candidate.clientHeight);
        const Position = Candidate.scrollTop;
        const CanScroll = Direction < 0 ? Position > 0.5 : Position < Maximum - 0.5;

        if (!CanScroll) Event.preventDefault();
        return;
    }

    const Scroller = document.scrollingElement || document.documentElement;
    const MaxScrollTop = Math.max(0, Scroller.scrollHeight - Scroller.clientHeight);
    const CanScroll = Direction < 0 ? Scroller.scrollTop > 0.5 : Scroller.scrollTop < MaxScrollTop - 0.5;

    if (!CanScroll) Event.preventDefault();
}

window.addEventListener("wheel", BlockMainPageOverscroll, { passive: false });

RenderMainPlayerSnapshot();

window.addEventListener("StoryShellActivate", SyncMainFromLastKnownState);
window.addEventListener("pagehide", () => {
    if (MainInitialized) RenderMainPlayerState();
});

document.addEventListener("DOMContentLoaded", async () => {
    try {
        await LoadMainPlayerState();
        MainInitialized = true;
        StoryAudio.PlayMusic("menu");

        document.getElementById("ContinueButton").addEventListener("click", async Event => {
            const Button = Event.currentTarget;
            if (!MainSave || !MainData) return;
            if (typeof StoryLockNavigationButton === "function" && !StoryLockNavigationButton(Button)) return;

            const StageId = IsStageUnlocked(MainSave, MainSave.currentStage)
                ? MainSave.currentStage
                : MainData.worlds[0].entryStage;

            try {
                MainSave = await EnterServerStage(StageId);
            } catch (Error) {
                window.StoryClearNavigationLock?.();
                const ErrorBox = document.getElementById("LoadError");
                if (ErrorBox) {
                    ErrorBox.classList.remove("Hidden");
                    ErrorBox.textContent = Error?.message || "Could not open this level. Please try again.";
                }
                return;
            }
            RenderMainPlayerState();
            try { sessionStorage.setItem("StoryRewriteResumeContinueV1", "1"); } catch {}
            StoryNavigate(`dialog.html?stage=${encodeURIComponent(StageId)}`, Button);
        });
    } catch (Error) {
        const ErrorBox = document.getElementById("LoadError");
        if (ErrorBox) {
            ErrorBox.classList.remove("Hidden");
            ErrorBox.textContent = Error.message;
        }
    }
});