const LevelPageState = {
    Data: null,
    Save: null,
    SelectedWorldId: null,
    SelectedStageId: null,
    AutoStartStageId: null
};

window.addEventListener("DOMContentLoaded", InitLevelsPage);

async function InitLevelsPage() {
    const ErrorBox = document.getElementById("PageError");

    try {
        await RequireAccount();
        LevelPageState.Data = await LoadStoryData();
        LevelPageState.Save = await LoadSave(LevelPageState.Data);
        StoryAudio.Configure(LevelPageState.Save.settings);
        StoryAudio.PlayMusic("menu");

        const Params = new URLSearchParams(window.location.search);
        const RequestedWorldId = Params.get("unlock") || Params.get("world");
        const AutoStartStageId = Params.get("autostart");
        const CurrentStage = LevelPageState.Data.stages[LevelPageState.Save.currentStage];

        if (RequestedWorldId && IsWorldUnlocked(LevelPageState.Save, RequestedWorldId)) {
            LevelPageState.SelectedWorldId = RequestedWorldId;
        } else if (CurrentStage && IsWorldUnlocked(LevelPageState.Save, CurrentStage.worldId)) {
            LevelPageState.SelectedWorldId = CurrentStage.worldId;
        } else {
            LevelPageState.SelectedWorldId = LevelPageState.Data.worlds[0].id;
        }

        if (AutoStartStageId && IsStageUnlocked(LevelPageState.Save, AutoStartStageId)) {
            const AutoStage = LevelPageState.Data.stages[AutoStartStageId];
            LevelPageState.SelectedWorldId = AutoStage.worldId;
            LevelPageState.SelectedStageId = AutoStartStageId;
            LevelPageState.AutoStartStageId = AutoStartStageId;
        } else {
            LevelPageState.SelectedStageId = GetDefaultStageId(LevelPageState.SelectedWorldId);
        }

        RenderLevelsPage();

        if (LevelPageState.AutoStartStageId) {
            const Node = document.querySelector(`[data-stage-node="${CSS.escape(LevelPageState.AutoStartStageId)}"]`);
            if (Node) Node.classList.add("Unlocking");
            await Delay(1450);
            await EnterServerStage(LevelPageState.AutoStartStageId);
            GoStage(LevelPageState.AutoStartStageId);
        }
    } catch (Error) {
        ErrorBox.hidden = false;
        ErrorBox.textContent = Error.message;
    }
}

function GetDefaultStageId(WorldId) {
    const Stages = GetWorldStages(LevelPageState.Data, WorldId);
    const CurrentStage = LevelPageState.Data.stages[LevelPageState.Save.currentStage];

    if (CurrentStage && CurrentStage.worldId === WorldId && IsStageUnlocked(LevelPageState.Save, CurrentStage.id)) {
        return CurrentStage.id;
    }

    const FirstIncomplete = Stages.find(Stage => IsStageUnlocked(LevelPageState.Save, Stage.id) && GetStageStars(LevelPageState.Save, Stage.id) === 0);
    if (FirstIncomplete) return FirstIncomplete.id;

    const LastUnlocked = [...Stages].reverse().find(Stage => IsStageUnlocked(LevelPageState.Save, Stage.id));
    return LastUnlocked?.id || Stages[0]?.id || null;
}

function RenderLevelsPage() {
    RenderOverviewStats();
    RenderWorldRail();
    RenderSelectedWorld();
}

function RenderOverviewStats() {
    const Container = document.getElementById("OverviewStats");
    const TotalStages = Object.keys(LevelPageState.Data.stages).length;
    const Cleared = ClearedStages(LevelPageState.Save);
    const Stars = TotalStars(LevelPageState.Save);
    const UnlockedWorlds = LevelPageState.Save.unlockedWorlds.length;

    Container.innerHTML = `
        <div class="GameStat"><span class="GameStatLabel">Worlds Unlocked</span><strong class="GameStatValue">${UnlockedWorlds} / ${LevelPageState.Data.worlds.length}</strong></div>
        <div class="GameStat"><span class="GameStatLabel">Levels Cleared</span><strong class="GameStatValue">${Cleared} / ${TotalStages}</strong></div>
        <div class="GameStat"><span class="GameStatLabel">Stars Recovered</span><strong class="GameStatValue">${Stars} / ${TotalStages * 3}</strong></div>
        <div class="GameStat"><span class="GameStatLabel">Lives</span><strong class="GameStatValue">${LevelPageState.Save.lives} / ${LevelPageState.Save.maxLives}</strong></div>
    `;
}

function RenderWorldRail() {
    const Rail = document.getElementById("WorldRail");

    Rail.innerHTML = LevelPageState.Data.worlds.map(World => {
        const Unlocked = IsWorldUnlocked(LevelPageState.Save, World.id);
        const Active = World.id === LevelPageState.SelectedWorldId;
        const Stages = GetWorldStages(LevelPageState.Data, World.id);
        const Cleared = Stages.filter(Stage => GetStageStars(LevelPageState.Save, Stage.id) > 0).length;

        return `
            <button class="WorldTab ${Active ? "Active" : ""} ${Unlocked ? "" : "Locked"}" type="button" data-world-id="${EscapeText(World.id)}" ${Unlocked ? "" : "disabled"}>
                <span class="WorldTabNumber">World ${World.number}</span>
                <span class="WorldTabName">${EscapeText(World.shortName || World.name)}</span>
                <span class="WorldTabProgress">${Unlocked ? `${Cleared}/${Stages.length} cleared` : "Locked"}</span>
            </button>
        `;
    }).join("");

    Rail.querySelectorAll(".WorldTab:not(.Locked)").forEach(Button => {
        Button.addEventListener("click", () => {
            StoryAudio.PlaySound("click");
            LevelPageState.SelectedWorldId = Button.dataset.worldId;
            LevelPageState.SelectedStageId = GetDefaultStageId(LevelPageState.SelectedWorldId);
            RenderLevelsPage();
        });
    });
}

function RenderSelectedWorld() {
    const Mount = document.getElementById("SelectedWorld");
    const World = GetWorld(LevelPageState.Data, LevelPageState.SelectedWorldId);
    const Stages = GetWorldStages(LevelPageState.Data, World.id);
    const Cleared = Stages.filter(Stage => GetStageStars(LevelPageState.Save, Stage.id) > 0).length;
    const SelectedStage = LevelPageState.Data.stages[LevelPageState.SelectedStageId] || Stages[0];

    if (!SelectedStage) {
        Mount.innerHTML = "";
        return;
    }

    Mount.innerHTML = `
        <section class="ChapterGamePanel">
            <header class="ChapterGameHeader Theme-${EscapeText(World.theme)}" data-world-number="${World.number}">
                <div>
                    <div class="ChapterGameKicker">World ${World.number}</div>
                    <h2 class="ChapterGameTitle">${EscapeText(World.name)}</h2>
                    <p class="ChapterGameDescription">${EscapeText(World.description)}</p>
                </div>
                <div class="ChapterProgressPill">${Cleared} / ${Stages.length} levels cleared</div>
            </header>

            <div class="ChapterMapLayout">
                <section class="StageMapArea Theme-${EscapeText(World.theme)}">
                    <div class="StageMapTitle">Chapter Route</div>
                    <div class="StageRoute">
                        <div class="RouteTurn"></div>
                        ${Stages.map((Stage, Index) => BuildStageNode(Stage, Index + 1)).join("")}
                    </div>
                </section>
                <aside class="StageBriefing" id="StageBriefing">${BuildStageBriefing(SelectedStage)}</aside>
            </div>
        </section>
    `;

    Mount.querySelectorAll(".StageNode:not(.Locked)").forEach(Button => {
        Button.addEventListener("click", () => {
            StoryAudio.PlaySound("click");
            LevelPageState.SelectedStageId = Button.dataset.stageNode;
            RenderSelectedWorld();
        });
    });

    const PlayButton = Mount.querySelector(".BriefingPlay[data-stage-id]");
    if (PlayButton) {
        PlayButton.addEventListener("click", async () => {
            StoryAudio.PlaySound("click");
            await EnterServerStage(PlayButton.dataset.stageId);
            GoStage(PlayButton.dataset.stageId);
        });
    }
}

function BuildStageNode(Stage, Position) {
    const Unlocked = IsStageUnlocked(LevelPageState.Save, Stage.id);
    const Stars = GetStageStars(LevelPageState.Save, Stage.id);
    const Completed = Stars > 0;
    const Current = LevelPageState.Save.currentStage === Stage.id;
    const Selected = LevelPageState.SelectedStageId === Stage.id;
    const Classes = ["StageNode", Unlocked ? "" : "Locked", Completed ? "Completed" : "", Current ? "Current" : "", Selected ? "Selected" : ""].filter(Boolean).join(" ");

    return `
        <div class="StageNodeWrap ${Selected ? "Selected" : ""}" data-position="${Position}">
            <div class="StageNodeDifficulty">${EscapeText(String(Stage.difficulty || "Normal").toUpperCase())}</div>
            <button class="${Classes}" type="button" data-stage-node="${EscapeText(Stage.id)}" ${Unlocked ? "" : "disabled"} aria-label="Level ${Stage.levelNumber}: ${EscapeText(Stage.name)}">${Unlocked ? Stage.levelNumber : "×"}</button>
            <div class="StageNodeLabel">${EscapeText(Stage.name)}</div>
        </div>
    `;
}

function BuildStageBriefing(Stage) {
    const Unlocked = IsStageUnlocked(LevelPageState.Save, Stage.id);
    const Stars = GetStageStars(LevelPageState.Save, Stage.id);
    const Status = !Unlocked ? "Locked" : Stars > 0 ? "Cleared" : LevelPageState.Save.currentStage === Stage.id ? "Current" : "Open";

    return `
        <div class="BriefingTop">
            <div class="BriefingLevel">Level ${Stage.levelNumber}</div>
            <h3 class="BriefingTitle">${EscapeText(Stage.name)}</h3>
            <div class="BriefingBadges">
                <span class="BriefingBadge Gold">${EscapeText(Stage.difficulty)}</span>
                <span class="BriefingBadge">${Status}</span>
                <span class="BriefingBadge">3★ Per ${Stage.par}</span>
            </div>
        </div>
        <div class="BriefingSection"><span class="BriefingLabel">Objective</span><p>${EscapeText(Stage.objective)}</p></div>
        <div class="BriefingSection"><span class="BriefingLabel">Threat</span><p>${EscapeText(Stage.threat)}</p></div>
        <div class="BriefingSection"><span class="BriefingLabel">Must Survive</span><p>${EscapeText(Stage.survivalRule)}</p></div>
        <div class="BriefingStars">${BuildStars(Stars)}</div>
        <button class="BriefingPlay" type="button" ${Unlocked ? `data-stage-id="${EscapeText(Stage.id)}"` : "disabled"}>${Unlocked ? "Open This Page" : "Level Locked"}</button>
    `;
}

function BuildStars(Count) {
    const Stars = Number(Count || 0);
    let Html = "";
    for (let Index = 0; Index < 3; Index += 1) Html += `<span class="${Index < Stars ? "Filled" : ""}">★</span>`;
    return Html;
}
