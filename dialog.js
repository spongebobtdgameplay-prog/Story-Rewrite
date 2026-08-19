let Data;
let Save;
let Stage;
let World;
let RemovedSentences = new Set();
let LastCheckFailed = false;
let TransitionBusy = false;

document.addEventListener("DOMContentLoaded", async () => {
    try {
        Data = await LoadStoryData();
        Save = LoadSave(Data);

        const Params = new URLSearchParams(window.location.search);
        const StageId = Params.get("stage") || Save.currentStage;

        Stage = Data.stages[StageId];
        if (!Stage || !IsStageUnlocked(Save, StageId)) {
            window.location.href = "levels.html";
            return;
        }

        World = GetWorld(Data, Stage.worldId);
        Save.currentStage = Stage.id;
        SaveProgress(Data, Save);

        RenderStage();
        BindActions();
    } catch (Error) {
        document.getElementById("GameRoot").innerHTML = `<div class="Panel" style="padding:28px">${EscapeText(Error.message)}</div>`;
    }
});

function BindActions() {
    document.getElementById("CheckButton").addEventListener("click", CheckStage);
    document.getElementById("RestoreButton").addEventListener("click", RestoreStage);
    document.getElementById("BackButton").addEventListener("click", () => window.location.href = "levels.html");
    document.getElementById("NextButton").addEventListener("click", NextStage);
    document.getElementById("ReplayButton").addEventListener("click", ReplayStage);
    document.getElementById("CompleteSelectButton").addEventListener("click", ReturnToSelectWithTrail);
    document.getElementById("TbcSelectButton").addEventListener("click", () => window.location.href = "levels.html");
}

function RenderStage() {
    document.title = `${Stage.name} — Story Rewrite`;
    document.getElementById("ChapterLabel").textContent = `World ${World.number} · Level ${Stage.levelNumber}`;
    document.getElementById("BookDifficulty").textContent = Stage.difficulty;
    document.getElementById("LevelTitle").textContent = Stage.name;
    document.getElementById("SidebarTitle").textContent = `Level ${Stage.levelNumber} — ${Stage.name}`;
    document.getElementById("WorldName").textContent = World.name;
    document.getElementById("GameDifficulty").textContent = Stage.difficulty;
    document.getElementById("ObjectiveText").textContent = Stage.objective;
    document.getElementById("ThreatText").textContent = Stage.threat;
    document.getElementById("SurvivalText").textContent = Stage.survivalRule;
    document.getElementById("HintText").textContent = Stage.hint;
    document.getElementById("ParCount").textContent = Stage.par;
    document.getElementById("CrossedCount").textContent = RemovedSentences.size;

    const SentenceList = document.getElementById("SentenceList");
    SentenceList.innerHTML = "";

    Stage.sentences.forEach((Text, Index) => {
        const Button = document.createElement("button");
        Button.className = `Sentence ${RemovedSentences.has(Index) ? "Crossed" : ""}`;
        Button.textContent = Text;
        Button.addEventListener("click", () => ToggleSentence(Index, Button));
        SentenceList.appendChild(Button);
    });

    RenderIllustration();
    RenderRemainingStory();
}

function ToggleSentence(Index, Button) {
    if (RemovedSentences.has(Index)) {
        RemovedSentences.delete(Index);
        Button.classList.remove("Crossed");
    } else {
        RemovedSentences.add(Index);
        Button.classList.add("Crossed");
    }

    LastCheckFailed = false;
    document.getElementById("CrossedCount").textContent = RemovedSentences.size;
    document.getElementById("Aftermath").classList.add("Hidden");
    document.getElementById("StatusText").className = "StatusText";
    document.getElementById("StatusText").textContent = "The story changed. Check survival when you think the route is safe.";

    RenderIllustration();
    RenderRemainingStory();
}

function RenderRemainingStory() {
    const Caption = document.getElementById("SceneCaption");
    const Remaining = Stage.sentences
        .map((Text, Index) => ({ Text, Index }))
        .filter(Line => !RemovedSentences.has(Line.Index));

    Caption.innerHTML = Remaining.length
        ? Remaining.map(Line => `<div class="RemainingLine">${EscapeText(Line.Text)}</div>`).join("")
        : `<div class="RemainingLine">Nothing remains on the page.</div>`;
}

function GetSceneMessage(Mode) {
    if (Mode === "failure") {
        return Stage.aftermath;
    }

    if (Mode === "chapter") {
        return World.chapterEnding;
    }

    const RemovedCount = RemovedSentences.size;
    if (RemovedCount === 0) {
        return "The original account is still intact. The danger has not been rewritten yet.";
    }

    if (RemovedCount === 1) {
        return "One event has been removed. The route is changing, but survival has not been checked.";
    }

    return `${RemovedCount} events have been removed. The rewritten route is waiting for a survival check.`;
}

function GetSceneStateLabel(Mode) {
    if (Mode === "failure") return "BAD OUTCOME";
    if (Mode === "chapter") return "CHAPTER CLEARED";
    return "STORY IN PLAY";
}

function BuildSceneEyes() {
    if (World.theme !== "fromville") return "";

    return `
        <div class="SceneEyes">
            <i></i>
            <i></i>
            <i></i>
        </div>
    `;
}

function BuildSceneVisual(Mode = "active") {
    const Theme = EscapeText(World.theme || Stage.theme || "fromville");
    const StateClass = Mode === "failure" ? "SceneMode-failure" : Mode === "chapter" ? "SceneMode-chapter" : "SceneMode-active";
    const Kicker = Mode === "chapter" ? `WORLD ${World.number} COMPLETE` : `WORLD ${World.number} · LEVEL ${Stage.levelNumber}`;
    const Title = Mode === "chapter" ? World.name : Stage.name;
    const FooterLeft = EscapeText(World.shortName || World.name);
    const FooterRight = Mode === "failure" ? "SURVIVAL FAILED" : Mode === "chapter" ? "ROUTE OPEN" : `${RemovedSentences.size} CROSSED OUT`;

    return `
        <div class="GameScene SceneTheme-${Theme} ${StateClass}">
            <div class="SceneAtmosphere"></div>
            <div class="SceneGeometry"></div>
            ${BuildSceneEyes()}

            <div class="SceneHudTop">
                <span>${EscapeText(Kicker)}</span>
                <span class="SceneStateBadge">${GetSceneStateLabel(Mode)}</span>
            </div>

            <div class="SceneFocus">
                <div class="SceneChapter">${EscapeText(World.shortName || World.name)}</div>
                <h3>${EscapeText(Title)}</h3>
                <p>${EscapeText(GetSceneMessage(Mode))}</p>
            </div>

            <div class="SceneHudBottom">
                <span>${FooterLeft}</span>
                <span>${EscapeText(FooterRight)}</span>
            </div>
        </div>
    `;
}

function RenderIllustration() {
    const Illustration = document.getElementById("Illustration");
    Illustration.innerHTML = BuildSceneVisual(LastCheckFailed ? "failure" : "active");
}

function CheckStage() {
    const HasAllRequired = Stage.requiredRemoved.every(Index => RemovedSentences.has(Index));
    const RemovedForbidden = Stage.forbiddenRemoved.some(Index => RemovedSentences.has(Index));
    const Status = document.getElementById("StatusText");

    if (!HasAllRequired || RemovedForbidden) {
        LastCheckFailed = true;
        Status.className = "StatusText Bad";
        Status.textContent = RemovedForbidden
            ? "You erased something the successful ending still needs. The bad aftermath happens anyway."
            : "At least one cause of failure is still active. The bad aftermath happens.";

        const Aftermath = document.getElementById("Aftermath");
        Aftermath.classList.remove("Hidden");
        Aftermath.innerHTML = `<strong>Bad aftermath</strong>${EscapeText(Stage.aftermath)}`;

        RenderIllustration();
        ShakeBook();
        return;
    }

    const ExtraRemoved = [...RemovedSentences].filter(Index => !Stage.requiredRemoved.includes(Index)).length;
    const RemovedCount = RemovedSentences.size;
    let Stars = 1;

    if (ExtraRemoved === 0 && RemovedCount <= Stage.par) {
        Stars = 3;
    } else if (ExtraRemoved <= 1 && RemovedCount <= Stage.par + 1) {
        Stars = 2;
    }

    LastCheckFailed = false;
    Status.className = "StatusText Good";
    Status.textContent = "The rewritten account satisfies the objective and survival rule.";

    CompleteStage(Data, Save, Stage.id, Stars);
    ShowComplete(Stars);
}

function ShakeBook() {
    const Book = document.getElementById("Book");
    Book.animate([
        { transform: "translateX(0)" },
        { transform: "translateX(-7px)" },
        { transform: "translateX(7px)" },
        { transform: "translateX(-4px)" },
        { transform: "translateX(0)" }
    ], { duration: 330, easing: "ease" });
}

function RestoreStage() {
    RemovedSentences.clear();
    LastCheckFailed = false;
    document.getElementById("Aftermath").classList.add("Hidden");
    document.getElementById("StatusText").className = "StatusText";
    document.getElementById("StatusText").textContent = "The whole page has been restored.";
    RenderStage();
}

function ShowComplete(Stars) {
    document.getElementById("CompleteDifficulty").textContent = Stage.difficulty;
    document.getElementById("CompleteText").textContent = `${World.name} · ${Stage.name}`;
    document.getElementById("StarRow").textContent = `${"★".repeat(Stars)}${"☆".repeat(3 - Stars)}`;
    document.getElementById("NextButton").textContent = Stage.isChapterEnd
        ? (Stage.nextStage ? "Finish Chapter" : "Finish Final Chapter")
        : "Next Level";
    document.getElementById("CompleteOverlay").classList.add("Show");
}

async function ShowTrail(TargetStageId, SelectOnly = false) {
    if (TransitionBusy) return false;
    TransitionBusy = true;

    const Overlay = document.getElementById("TravelOverlay");
    const Target = TargetStageId ? Data.stages[TargetStageId] : null;

    document.getElementById("TravelTitle").textContent = SelectOnly
        ? "Returning to the chapter map..."
        : Target
            ? `Opening Level ${Target.levelNumber}...`
            : "Following the final route...";

    document.getElementById("TravelCaption").textContent = SelectOnly
        ? "The current page closes."
        : Target
            ? Target.name
            : "There are no recovered pages beyond this point.";

    document.getElementById("TravelTarget").textContent = SelectOnly
        ? "☰"
        : Target
            ? Target.levelNumber
            : "?";

    Overlay.querySelectorAll(".TrailDot").forEach(Dot => {
        Dot.style.animation = "none";
        void Dot.offsetWidth;
        Dot.style.animation = "";
    });

    Overlay.classList.add("Show");
    await Delay(1500);
    Overlay.classList.remove("Show");
    TransitionBusy = false;
    return true;
}

async function ShowChapterComplete() {
    const Overlay = document.getElementById("ChapterOverlay");
    document.getElementById("ChapterTitle").textContent = World.name;
    document.getElementById("ChapterText").textContent = World.chapterEnding;
    document.getElementById("ChapterArt").innerHTML = BuildSceneVisual("chapter");

    Overlay.classList.add("Show");
    await Delay(2500);
    Overlay.classList.remove("Show");
}

async function NextStage() {
    if (TransitionBusy) return;
    document.getElementById("CompleteOverlay").classList.remove("Show");

    if (Stage.isChapterEnd) {
        await ShowChapterComplete();

        if (!Stage.nextStage) {
            document.getElementById("TbcOverlay").classList.add("Show");
            return;
        }

        const Next = Data.stages[Stage.nextStage];
        await ShowTrail(Stage.nextStage, false);
        window.location.href = `levels.html?unlock=${encodeURIComponent(Next.worldId)}&autostart=${encodeURIComponent(Stage.nextStage)}`;
        return;
    }

    if (!Stage.nextStage) {
        document.getElementById("TbcOverlay").classList.add("Show");
        return;
    }

    const Traveled = await ShowTrail(Stage.nextStage, false);
    if (Traveled) GoStage(Stage.nextStage);
}

async function ReturnToSelectWithTrail() {
    if (TransitionBusy) return;
    document.getElementById("CompleteOverlay").classList.remove("Show");
    const Traveled = await ShowTrail(null, true);
    if (Traveled) window.location.href = "levels.html";
}

function ReplayStage() {
    document.getElementById("CompleteOverlay").classList.remove("Show");
    RemovedSentences.clear();
    LastCheckFailed = false;
    document.getElementById("Aftermath").classList.add("Hidden");
    document.getElementById("StatusText").className = "StatusText";
    document.getElementById("StatusText").textContent = "The page has been reset.";
    RenderStage();
}
