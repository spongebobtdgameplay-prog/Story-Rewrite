const LevelPageState = {
    Data: null,
    Save: null,
    SelectedWorldId: null
};

window.addEventListener("DOMContentLoaded", InitLevelsPage);

async function InitLevelsPage() {
    const ErrorBox = document.getElementById("PageError");

    try {
        LevelPageState.Data = await LoadStoryData();
        LevelPageState.Save = LoadSave(LevelPageState.Data);

        if (!IsStageUnlocked(LevelPageState.Save, LevelPageState.Save.currentStage)) {
            UnlockStage(LevelPageState.Data, LevelPageState.Save, LevelPageState.Save.currentStage);
            SaveProgress(LevelPageState.Data, LevelPageState.Save);
        }

        LevelPageState.SelectedWorldId = GetInitialWorldId();
        RenderLevelsPage();
    } catch (Error) {
        ErrorBox.hidden = false;
        ErrorBox.textContent = Error.message;
    }
}

function GetInitialWorldId() {
    const Params = new URLSearchParams(window.location.search);
    const RequestedWorldId = Params.get("world");

    if (RequestedWorldId && IsWorldUnlocked(LevelPageState.Save, RequestedWorldId)) {
        return RequestedWorldId;
    }

    const CurrentStage = LevelPageState.Data.stages[LevelPageState.Save.currentStage];

    if (CurrentStage && IsWorldUnlocked(LevelPageState.Save, CurrentStage.worldId)) {
        return CurrentStage.worldId;
    }

    return LevelPageState.Save.unlockedWorlds[0] || LevelPageState.Data.worlds[0].id;
}

function RenderLevelsPage() {
    RenderOverviewStats();
    RenderWorldRail();
    RenderSelectedWorld();
}

function RenderOverviewStats() {
    const Container = document.getElementById("OverviewStats");
    const TotalStageCount = Object.keys(LevelPageState.Data.stages).length;
    const ClearedStageCount = ClearedStages(LevelPageState.Save);
    const CurrentWorld = GetWorld(LevelPageState.Data, LevelPageState.SelectedWorldId);
    const TotalStarCount = TotalStars(LevelPageState.Save);
    const MaxStarCount = TotalStageCount * 3;

    Container.innerHTML = `
        <div class="hero-stat-box">
            <div class="hero-stat-label">Cleared</div>
            <div class="hero-stat-value">${ClearedStageCount}<span> / ${TotalStageCount}</span></div>
        </div>
        <div class="hero-stat-box">
            <div class="hero-stat-label">Stars</div>
            <div class="hero-stat-value">${TotalStarCount}<span> / ${MaxStarCount}</span></div>
        </div>
        <div class="hero-stat-box">
            <div class="hero-stat-label">Current Chapter</div>
            <div class="hero-stat-value small">${EscapeText(CurrentWorld?.name || "Unknown")}</div>
        </div>
    `;
}

function RenderWorldRail() {
    const Rail = document.getElementById("WorldRail");

    Rail.innerHTML = LevelPageState.Data.worlds.map((World, Index) => {
        const Unlocked = IsWorldUnlocked(LevelPageState.Save, World.id);
        const Active = World.id === LevelPageState.SelectedWorldId;
        const WorldStages = GetWorldStages(LevelPageState.Data, World.id);
        const ClearedCount = WorldStages.filter(Stage => GetStageStars(LevelPageState.Save, Stage.id) > 0).length;

        return `
            <button
                class="world-chip ${Unlocked ? "unlocked" : "locked"} ${Active ? "active" : ""}"
                type="button"
                data-world-id="${EscapeText(World.id)}"
                ${Unlocked ? "" : "disabled"}
            >
                <span class="world-chip-index">World ${Index + 1}</span>
                <span class="world-chip-name">${EscapeText(World.name)}</span>
                <span class="world-chip-meta">${Unlocked ? `${ClearedCount}/${WorldStages.length} cleared` : "Locked"}</span>
            </button>
        `;
    }).join("");

    Rail.querySelectorAll(".world-chip.unlocked").forEach(Button => {
        Button.addEventListener("click", () => {
            LevelPageState.SelectedWorldId = Button.dataset.worldId;
            RenderLevelsPage();
        });
    });
}

function RenderSelectedWorld() {
    const Mount = document.getElementById("SelectedWorld");
    const World = GetWorld(LevelPageState.Data, LevelPageState.SelectedWorldId);
    const Stages = GetWorldStages(LevelPageState.Data, World.id);
    const ClearedCount = Stages.filter(Stage => GetStageStars(LevelPageState.Save, Stage.id) > 0).length;
    const TotalStarsInWorld = Stages.reduce((Total, Stage) => Total + GetStageStars(LevelPageState.Save, Stage.id), 0);
    const MaxStarsInWorld = Stages.length * 3;

    Mount.innerHTML = `
        <section class="chapter-panel">
            <div class="chapter-panel-header">
                <div class="chapter-panel-copy">
                    <div class="eyebrow">World ${LevelPageState.Data.worlds.findIndex(Item => Item.id === World.id) + 1} • ${EscapeText(World.id).toUpperCase()}</div>
                    <h2>${EscapeText(World.name)}</h2>
                    <p>${EscapeText(World.description || World.tagline || "Rewrite the story and survive the fallout.")}</p>
                </div>

                <div class="chapter-panel-stats">
                    <div class="chapter-stat-card">
                        <span class="chapter-stat-label">Levels</span>
                        <span class="chapter-stat-value">${Stages.length}</span>
                    </div>
                    <div class="chapter-stat-card">
                        <span class="chapter-stat-label">Cleared</span>
                        <span class="chapter-stat-value">${ClearedCount}</span>
                    </div>
                    <div class="chapter-stat-card">
                        <span class="chapter-stat-label">Stars</span>
                        <span class="chapter-stat-value">${TotalStarsInWorld} / ${MaxStarsInWorld}</span>
                    </div>
                </div>
            </div>

            <div class="level-grid">
                ${Stages.map(Stage => BuildLevelCard(World, Stage)).join("")}
            </div>
        </section>
    `;

    Mount.querySelectorAll(".level-card.unlocked").forEach(Card => {
        Card.addEventListener("click", Event => {
            if (Event.target.closest(".enter-level-button")) {
                Event.preventDefault();
            }

            GoStage(Card.dataset.stageId);
        });
    });

    Mount.querySelectorAll(".enter-level-button[data-stage-id]").forEach(Button => {
        Button.addEventListener("click", Event => {
            Event.stopPropagation();
            GoStage(Button.dataset.stageId);
        });
    });
}

function BuildLevelCard(World, Stage) {
    const Unlocked = IsStageUnlocked(LevelPageState.Save, Stage.id);
    const Stars = GetStageStars(LevelPageState.Save, Stage.id);
    const Cleared = Stars > 0;
    const Current = LevelPageState.Save.currentStage === Stage.id;
    const StatusLabel = !Unlocked ? "Locked" : Cleared ? "Cleared" : Current ? "Current" : "Open";
    const CardState = !Unlocked ? "locked" : Cleared ? "cleared" : Current ? "current" : "unlocked";
    const Thumb = MakeStageThumb(World, Stage);
    const Difficulty = String(Stage.difficulty || "Normal").toUpperCase();
    const Objective = EscapeText(Stage.objective || "Rewrite the plate correctly.");
    const Threat = EscapeText(Stage.threat || Stage.survivalRule || "The story fights back if you choose badly.");
    const ButtonLabel = Unlocked ? "Enter" : "Locked";

    return `
        <article class="level-card ${CardState} ${Unlocked ? "unlocked" : ""}" data-stage-id="${EscapeText(Stage.id)}">
            <div class="level-card-top">
                <span class="difficulty-pill">${Difficulty}</span>
                <span class="status-pill">${StatusLabel}</span>
            </div>

            <div class="level-title-block">
                <div class="level-index">Level ${EscapeText(Stage.levelNumber || "")}</div>
                <h3>${EscapeText(Stage.name)}</h3>
            </div>

            <div class="level-thumb-frame">
                <img class="level-thumb" src="${Thumb}" alt="${EscapeText(Stage.name)} preview">
            </div>

            <div class="level-info-block">
                <div class="level-info-line">
                    <span>Objective</span>
                    <p>${Objective}</p>
                </div>

                <div class="level-info-line">
                    <span>Threat</span>
                    <p>${Threat}</p>
                </div>
            </div>

            <div class="level-footer">
                <div class="star-strip">${BuildStars(Stars)}</div>
                <button class="enter-level-button" type="button" ${Unlocked ? `data-stage-id="${EscapeText(Stage.id)}"` : "disabled"}>${ButtonLabel}</button>
            </div>
        </article>
    `;
}

function BuildStars(Count) {
    const StarCount = Number(Count || 0);
    let Result = "";

    for (let Index = 0; Index < 3; Index += 1) {
        Result += `<span class="star ${Index < StarCount ? "filled" : ""}">★</span>`;
    }

    return Result;
}

function MakeStageThumb(World, Stage) {
    const Theme = ResolveTheme(World);
    const Palette = GetThemePalette(Theme);
    const Shapes = GetSceneShapes(Theme, Number(Stage.levelNumber || 1));

    const Svg = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 420">
            <defs>
                <linearGradient id="Sky" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="${Palette.skyTop}" />
                    <stop offset="100%" stop-color="${Palette.skyBottom}" />
                </linearGradient>
            </defs>

            <rect width="640" height="420" rx="26" fill="${Palette.paper}" />
            <rect x="18" y="18" width="604" height="384" rx="22" fill="url(#Sky)" stroke="${Palette.frame}" stroke-width="4" />
            <rect x="18" y="300" width="604" height="102" rx="0" fill="${Palette.ground}" />
            <path d="${Shapes.landPath}" fill="${Palette.path}" opacity="0.92" />
            ${Shapes.backdrop}
            ${Shapes.main}
        </svg>
    `;

    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(Svg)}`;
}

function ResolveTheme(World) {
    const Text = `${World.id} ${World.name} ${World.description || ""}`.toLowerCase();

    if (Text.includes("from") || Text.includes("ville")) {
        return "fromville";
    }

    if (Text.includes("anime") || Text.includes("school") || Text.includes("spirit") || Text.includes("tokyo")) {
        return "anime";
    }

    if (Text.includes("lab") || Text.includes("signal") || Text.includes("facility") || Text.includes("machine") || Text.includes("future")) {
        return "facility";
    }

    if (Text.includes("castle") || Text.includes("vamp") || Text.includes("midnight") || Text.includes("gothic")) {
        return "gothic";
    }

    if (Text.includes("forest") || Text.includes("temple") || Text.includes("jungle") || Text.includes("ruin")) {
        return "adventure";
    }

    return "storybook";
}

function GetThemePalette(Theme) {
    const Palettes = {
        fromville: {
            paper: "#efe1c4",
            frame: "#b69a72",
            skyTop: "#e9d7b3",
            skyBottom: "#d6c09f",
            ground: "#b99368",
            path: "#a58663",
            accent: "#6d4b34",
            shadow: "#5d4635",
            figure: "#7a6249",
            creature: "#7b8286",
            window: "#3d2b1d"
        },
        anime: {
            paper: "#f3e8df",
            frame: "#c59f98",
            skyTop: "#f5c6d2",
            skyBottom: "#ead6ef",
            ground: "#ba8f8a",
            path: "#d6b4a3",
            accent: "#7a4451",
            shadow: "#5b3642",
            figure: "#51344a",
            creature: "#90566c",
            window: "#331b28"
        },
        facility: {
            paper: "#dfe5e7",
            frame: "#8da1ac",
            skyTop: "#d3dde2",
            skyBottom: "#c1ccd2",
            ground: "#8a96a1",
            path: "#6d7d89",
            accent: "#3d5061",
            shadow: "#2b3947",
            figure: "#425261",
            creature: "#6c838f",
            window: "#10212f"
        },
        gothic: {
            paper: "#e7ddd7",
            frame: "#8a675d",
            skyTop: "#7d768c",
            skyBottom: "#c8b0a5",
            ground: "#8e7569",
            path: "#6c5b55",
            accent: "#4b2f37",
            shadow: "#2f1f25",
            figure: "#513841",
            creature: "#76707c",
            window: "#1b1115"
        },
        adventure: {
            paper: "#eee3c0",
            frame: "#b08d58",
            skyTop: "#e7d28c",
            skyBottom: "#efe4b1",
            ground: "#9f8b52",
            path: "#b49a5d",
            accent: "#5d4d28",
            shadow: "#4d3e1e",
            figure: "#685126",
            creature: "#8a7440",
            window: "#36270d"
        },
        storybook: {
            paper: "#efe5cf",
            frame: "#b59161",
            skyTop: "#e8d6b2",
            skyBottom: "#eadfca",
            ground: "#a88a60",
            path: "#c0a177",
            accent: "#6e5338",
            shadow: "#55432f",
            figure: "#755a3e",
            creature: "#84725d",
            window: "#322316"
        }
    };

    return Palettes[Theme] || Palettes.storybook;
}

function GetSceneShapes(Theme, LevelNumber) {
    const Variant = ((LevelNumber - 1) % 3) + 1;

    if (Theme === "fromville") {
        return BuildFromvilleScene(Variant);
    }

    if (Theme === "anime") {
        return BuildAnimeScene(Variant);
    }

    if (Theme === "facility") {
        return BuildFacilityScene(Variant);
    }

    if (Theme === "gothic") {
        return BuildGothicScene(Variant);
    }

    if (Theme === "adventure") {
        return BuildAdventureScene(Variant);
    }

    return BuildStorybookScene(Variant);
}

function BuildFromvilleScene(Variant) {
    const LandPath = Variant === 1
        ? "M0 360 C120 280 240 260 340 286 C430 310 500 300 640 220 L640 360 Z"
        : Variant === 2
        ? "M0 340 C130 290 250 300 355 270 C450 243 550 228 640 238 L640 360 Z"
        : "M0 346 C160 250 260 260 360 308 C452 350 542 318 640 258 L640 360 Z";

    const Backdrop = `
        <path d="M0 340 C100 280 170 270 255 290 C332 308 420 311 520 266 C566 246 605 230 640 226" fill="none" stroke="#b09573" stroke-width="18" stroke-linecap="round" opacity="0.72"/>
        <path d="M78 287 L170 222 L262 287 Z" fill="#7b563c"/>
        <rect x="98" y="287" width="144" height="126" fill="#b6865d"/>
        <rect x="155" y="331" width="26" height="82" fill="#764c33"/>
        <rect x="410" y="242" width="102" height="86" fill="#c89b63" stroke="#6f4c37" stroke-width="6"/>
        <rect x="425" y="258" width="72" height="24" fill="#ead9af" opacity="0.9"/>
    `;

    const CreatureLine = Variant === 1
        ? `
            <g transform="translate(430 312)">
                <circle cx="0" cy="0" r="18" fill="#848b8f"/>
                <rect x="-15" y="16" width="30" height="56" fill="#777e82"/>
                <circle cx="-5" cy="-2" r="3" fill="#f2ead2"/>
                <circle cx="5" cy="-2" r="3" fill="#f2ead2"/>
                <path d="M-8 10 Q0 18 8 10" fill="none" stroke="#26211d" stroke-width="3" stroke-linecap="round"/>
            </g>
            <g transform="translate(520 308)">
                <circle cx="0" cy="0" r="15" fill="#8a9296"/>
                <rect x="-12" y="12" width="24" height="52" fill="#7b8387"/>
                <circle cx="-4" cy="-2" r="3" fill="#f2ead2"/>
                <circle cx="4" cy="-2" r="3" fill="#f2ead2"/>
            </g>
        `
        : Variant === 2
        ? `
            <g transform="translate(474 302)">
                <circle cx="0" cy="0" r="17" fill="#838b8f"/>
                <rect x="-14" y="14" width="28" height="60" fill="#757d81"/>
                <circle cx="-5" cy="-2" r="3" fill="#f2ead2"/>
                <circle cx="5" cy="-2" r="3" fill="#f2ead2"/>
                <path d="M-8 9 Q0 18 8 9" fill="none" stroke="#26211d" stroke-width="3" stroke-linecap="round"/>
            </g>
            <g transform="translate(554 296)">
                <circle cx="0" cy="0" r="13" fill="#90979b"/>
                <rect x="-11" y="10" width="22" height="48" fill="#828a8e"/>
                <circle cx="-4" cy="-1" r="2.8" fill="#f2ead2"/>
                <circle cx="4" cy="-1" r="2.8" fill="#f2ead2"/>
            </g>
        `
        : `
            <g transform="translate(408 306)">
                <circle cx="0" cy="0" r="15" fill="#7d8589"/>
                <rect x="-12" y="12" width="24" height="50" fill="#71797d"/>
                <circle cx="-4" cy="-2" r="3" fill="#f2ead2"/>
                <circle cx="4" cy="-2" r="3" fill="#f2ead2"/>
            </g>
            <g transform="translate(486 297)">
                <circle cx="0" cy="0" r="18" fill="#868e92"/>
                <rect x="-15" y="14" width="30" height="62" fill="#7a8286"/>
                <circle cx="-5" cy="-2" r="3" fill="#f2ead2"/>
                <circle cx="5" cy="-2" r="3" fill="#f2ead2"/>
                <path d="M-8 10 Q0 18 8 10" fill="none" stroke="#26211d" stroke-width="3" stroke-linecap="round"/>
            </g>
            <g transform="translate(560 310)">
                <circle cx="0" cy="0" r="12" fill="#8c9498"/>
                <rect x="-10" y="10" width="20" height="42" fill="#81898d"/>
                <circle cx="-3" cy="-1" r="2.8" fill="#f2ead2"/>
                <circle cx="3" cy="-1" r="2.8" fill="#f2ead2"/>
            </g>
        `;

    const Main = `
        <ellipse cx="260" cy="315" rx="14" ry="16" fill="#71543b"/>
        <path d="M240 330 L280 330 L292 392 L228 392 Z" fill="#84694d"/>
        ${CreatureLine}
    `;

    return {
        landPath: LandPath,
        backdrop: Backdrop,
        main: Main
    };
}

function BuildAnimeScene(Variant) {
    const LandPath = Variant === 1
        ? "M0 340 C120 306 220 314 326 280 C430 247 520 240 640 250 L640 360 Z"
        : Variant === 2
        ? "M0 330 C140 290 245 294 342 314 C426 330 516 302 640 236 L640 360 Z"
        : "M0 348 C100 286 210 254 320 274 C430 294 516 302 640 286 L640 360 Z";

    const Backdrop = `
        <circle cx="526" cy="104" r="48" fill="#f7e6f1" opacity="0.92"/>
        <rect x="92" y="200" width="180" height="110" fill="#d7b6bc" stroke="#744756" stroke-width="6"/>
        <rect x="118" y="160" width="128" height="52" fill="#e8d4da" stroke="#744756" stroke-width="6"/>
        <rect x="124" y="222" width="42" height="24" fill="#f5edf1"/>
        <rect x="176" y="222" width="42" height="24" fill="#f5edf1"/>
        <rect x="124" y="258" width="42" height="24" fill="#f5edf1"/>
        <rect x="176" y="258" width="42" height="24" fill="#f5edf1"/>
    `;

    const Main = Variant === 1
        ? `
            <path d="M394 312 L440 230 L486 312 Z" fill="#7f4557"/>
            <rect x="432" y="190" width="10" height="122" fill="#65384a"/>
            <path d="M286 292 Q318 260 350 292 L350 356 L286 356 Z" fill="#6f455c"/>
        `
        : Variant === 2
        ? `
            <path d="M456 312 L506 238 L556 312 Z" fill="#7f4557"/>
            <rect x="500" y="202" width="10" height="110" fill="#65384a"/>
            <path d="M252 280 Q286 246 320 280 L320 356 L252 356 Z" fill="#6a4157"/>
            <path d="M340 290 Q370 265 400 290 L400 356 L340 356 Z" fill="#86506a"/>
        `
        : `
            <path d="M398 312 L452 224 L506 312 Z" fill="#82495a"/>
            <rect x="446" y="194" width="10" height="118" fill="#65384a"/>
            <path d="M266 286 Q300 246 334 286 L334 356 L266 356 Z" fill="#6f455c"/>
        `;

    return {
        landPath: LandPath,
        backdrop: Backdrop,
        main: Main
    };
}

function BuildFacilityScene(Variant) {
    const LandPath = Variant === 1
        ? "M0 344 C112 322 220 276 326 270 C426 266 530 290 640 264 L640 360 Z"
        : Variant === 2
        ? "M0 334 C150 290 252 290 360 302 C440 312 542 294 640 250 L640 360 Z"
        : "M0 350 C114 298 218 252 334 252 C446 252 538 280 640 284 L640 360 Z";

    const Backdrop = `
        <rect x="96" y="184" width="164" height="120" fill="#81909a" stroke="#384b5b" stroke-width="6"/>
        <rect x="270" y="156" width="126" height="148" fill="#91a0aa" stroke="#384b5b" stroke-width="6"/>
        <rect x="116" y="206" width="34" height="34" fill="#dce8ef"/>
        <rect x="162" y="206" width="34" height="34" fill="#dce8ef"/>
        <rect x="208" y="206" width="34" height="34" fill="#dce8ef"/>
        <circle cx="476" cy="190" r="34" fill="#a8eef0" opacity="0.84"/>
        <circle cx="476" cy="190" r="18" fill="#dffefe" opacity="0.9"/>
    `;

    const Main = Variant === 1
        ? `
            <path d="M426 336 L458 268 L490 336 Z" fill="#37576b"/>
            <path d="M514 336 L544 284 L574 336 Z" fill="#4b6880"/>
        `
        : Variant === 2
        ? `
            <path d="M396 336 L430 274 L464 336 Z" fill="#37576b"/>
            <path d="M488 336 L520 250 L552 336 Z" fill="#4f6d84"/>
        `
        : `
            <path d="M438 336 L472 260 L506 336 Z" fill="#37576b"/>
            <rect x="528" y="272" width="34" height="64" fill="#536f84"/>
        `;

    return {
        landPath: LandPath,
        backdrop: Backdrop,
        main: Main
    };
}

function BuildGothicScene(Variant) {
    const LandPath = Variant === 1
        ? "M0 350 C118 326 218 266 330 262 C442 258 530 300 640 280 L640 360 Z"
        : Variant === 2
        ? "M0 336 C100 286 214 278 320 298 C418 318 532 310 640 270 L640 360 Z"
        : "M0 350 C120 300 214 244 324 252 C450 260 548 308 640 304 L640 360 Z";

    const Backdrop = `
        <circle cx="494" cy="110" r="52" fill="#ece7ef" opacity="0.86"/>
        <path d="M112 298 L166 176 L218 236 L254 182 L292 298 Z" fill="#43313a"/>
        <rect x="148" y="242" width="24" height="56" fill="#2b1b20"/>
        <path d="M72 318 Q82 276 104 240 Q90 246 72 260" fill="none" stroke="#48373f" stroke-width="7" stroke-linecap="round"/>
        <path d="M558 318 Q548 270 524 230 Q538 238 558 252" fill="none" stroke="#48373f" stroke-width="7" stroke-linecap="round"/>
    `;

    const Main = Variant === 1
        ? `
            <rect x="388" y="296" width="18" height="42" fill="#584049"/>
            <rect x="430" y="286" width="18" height="52" fill="#584049"/>
            <rect x="472" y="302" width="18" height="36" fill="#584049"/>
        `
        : Variant === 2
        ? `
            <path d="M412 336 L442 284 L472 336 Z" fill="#5b424b"/>
            <path d="M490 336 L522 266 L554 336 Z" fill="#463038"/>
        `
        : `
            <rect x="410" y="288" width="20" height="50" fill="#5b424b"/>
            <rect x="454" y="300" width="16" height="38" fill="#5b424b"/>
            <path d="M514 336 L540 286 L566 336 Z" fill="#463038"/>
        `;

    return {
        landPath: LandPath,
        backdrop: Backdrop,
        main: Main
    };
}

function BuildAdventureScene(Variant) {
    const LandPath = Variant === 1
        ? "M0 344 C102 280 214 254 334 270 C444 286 544 310 640 290 L640 360 Z"
        : Variant === 2
        ? "M0 330 C146 296 248 314 346 290 C446 266 552 240 640 246 L640 360 Z"
        : "M0 350 C112 298 210 250 332 254 C434 258 532 286 640 300 L640 360 Z";

    const Backdrop = `
        <path d="M106 300 L172 174 L236 300 Z" fill="#8c783e"/>
        <path d="M190 300 L256 150 L322 300 Z" fill="#6f6031"/>
        <rect x="420" y="212" width="96" height="96" fill="#b4955e" stroke="#614d25" stroke-width="6"/>
        <rect x="452" y="244" width="32" height="32" fill="#e7d9a4"/>
    `;

    const Main = Variant === 1
        ? `
            <path d="M298 286 Q330 250 362 286 L362 356 L298 356 Z" fill="#675128"/>
            <path d="M74 320 Q92 280 114 246" fill="none" stroke="#5b4a21" stroke-width="6" stroke-linecap="round"/>
            <path d="M114 246 Q132 274 144 306" fill="none" stroke="#5b4a21" stroke-width="6" stroke-linecap="round"/>
        `
        : Variant === 2
        ? `
            <path d="M270 288 Q302 246 334 288 L334 356 L270 356 Z" fill="#675128"/>
            <path d="M350 298 Q382 260 414 298 L414 356 L350 356 Z" fill="#806532"/>
        `
        : `
            <path d="M308 286 Q340 248 372 286 L372 356 L308 356 Z" fill="#675128"/>
            <path d="M542 324 Q554 292 568 264" fill="none" stroke="#5b4a21" stroke-width="6" stroke-linecap="round"/>
            <path d="M568 264 Q586 288 600 316" fill="none" stroke="#5b4a21" stroke-width="6" stroke-linecap="round"/>
        `;

    return {
        landPath: LandPath,
        backdrop: Backdrop,
        main: Main
    };
}

function BuildStorybookScene(Variant) {
    const LandPath = Variant === 1
        ? "M0 348 C118 304 228 278 340 282 C452 286 542 306 640 286 L640 360 Z"
        : Variant === 2
        ? "M0 338 C112 286 242 286 336 316 C430 346 534 316 640 258 L640 360 Z"
        : "M0 348 C134 272 242 256 356 282 C470 308 560 310 640 292 L640 360 Z";

    const Backdrop = `
        <path d="M96 302 L168 202 L238 302 Z" fill="#82603d"/>
        <path d="M150 302 L214 150 L278 302 Z" fill="#6a4d33"/>
        <path d="M392 302 L458 214 L526 302 Z" fill="#977347"/>
        <rect x="420" y="302" width="78" height="34" fill="#735535"/>
    `;

    const Main = Variant === 1
        ? `<circle cx="312" cy="304" r="20" fill="#72573a"/><rect x="294" y="322" width="36" height="48" fill="#8a6a49"/>`
        : Variant === 2
        ? `<circle cx="286" cy="298" r="20" fill="#72573a"/><rect x="268" y="316" width="36" height="54" fill="#8a6a49"/>`
        : `<circle cx="338" cy="300" r="20" fill="#72573a"/><rect x="320" y="318" width="36" height="52" fill="#8a6a49"/>`;

    return {
        landPath: LandPath,
        backdrop: Backdrop,
        main: Main
    };
}
