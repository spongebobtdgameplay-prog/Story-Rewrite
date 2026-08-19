const FAVICON_VERSION = "1000001";

const HeadLinks = [
    {
        rel: "icon",
        type: "image/x-icon",
        href: `favicon_io/favicon.ico?v=${FAVICON_VERSION}`
    },
    {
        rel: "icon",
        type: "image/png",
        sizes: "32x32",
        href: `favicon_io/favicon-32x32.png?v=${FAVICON_VERSION}`
    },
    {
        rel: "icon",
        type: "image/png",
        sizes: "16x16",
        href: `favicon_io/favicon-16x16.png?v=${FAVICON_VERSION}`
    },
    {
        rel: "apple-touch-icon",
        sizes: "180x180",
        href: `favicon_io/apple-touch-icon.png?v=${FAVICON_VERSION}`
    },
    {
        rel: "manifest",
        href: `favicon_io/site.webmanifest?v=${FAVICON_VERSION}`
    }
];

document.head.querySelectorAll('link[data-story-rewrite-icon="1"]').forEach(Link => Link.remove());

for (const LinkData of HeadLinks) {
    const Link = document.createElement("link");
    Link.setAttribute("data-story-rewrite-icon", "1");

    for (const [Property, Value] of Object.entries(LinkData)) {
        Link.setAttribute(Property, Value);
    }

    document.head.appendChild(Link);
}

const STORY_DATA_URL = "stages.json";

async function LoadStoryData() {
    const Response = await fetch(STORY_DATA_URL, { cache: "no-store" });

    if (!Response.ok) {
        throw new Error(`Could not load ${STORY_DATA_URL}: ${Response.status}`);
    }

    return Response.json();
}

function DefaultSave(Data) {
    const FirstWorld = Data.worlds[0];
    const FirstStage = FirstWorld.entryStage;

    return {
        version: 5,
        unlockedWorlds: [FirstWorld.id],
        unlockedStages: [FirstStage],
        stars: {},
        currentStage: FirstStage,
        lives: 3,
        maxLives: 3,
        deaths: 0,
        settings: {
            musicVolume: 0.45,
            soundVolume: 0.75
        }
    };
}

function NormalizeSave(Data, Save) {
    const Base = DefaultSave(Data);
    const Result = Save && typeof Save === "object" ? Save : Base;

    if (!Array.isArray(Result.unlockedWorlds)) Result.unlockedWorlds = [...Base.unlockedWorlds];
    if (!Array.isArray(Result.unlockedStages)) Result.unlockedStages = [...Base.unlockedStages];
    if (!Result.stars || typeof Result.stars !== "object") Result.stars = {};
    if (!Data.stages[Result.currentStage]) Result.currentStage = Base.currentStage;
    if (!Number.isInteger(Result.lives)) Result.lives = Base.lives;
    if (!Number.isInteger(Result.maxLives)) Result.maxLives = Base.maxLives;
    if (!Number.isInteger(Result.deaths)) Result.deaths = 0;
    if (!Result.settings || typeof Result.settings !== "object") Result.settings = { ...Base.settings };

    if (!Result.unlockedWorlds.includes(Data.worlds[0].id)) Result.unlockedWorlds.push(Data.worlds[0].id);
    if (!Result.unlockedStages.includes(Data.worlds[0].entryStage)) Result.unlockedStages.push(Data.worlds[0].entryStage);

    Result.version = 5;
    return Result;
}

async function LoadSave(Data) {
    const Save = await FetchServerSave();
    return NormalizeSave(Data, Save);
}

function SaveProgress(Data, Save) {
    return NormalizeSave(Data, Save);
}

function GetWorld(Data, WorldId) {
    return Data.worlds.find(World => World.id === WorldId);
}

function GetWorldStages(Data, WorldId) {
    return Object.values(Data.stages)
        .filter(Stage => Stage.worldId === WorldId)
        .sort((A, B) => {
            const LevelA = Number(A.levelNumber || 0);
            const LevelB = Number(B.levelNumber || 0);

            if (LevelA !== LevelB) return LevelA - LevelB;
            return String(A.id).localeCompare(String(B.id));
        });
}

function IsWorldUnlocked(Save, WorldId) {
    return Save.unlockedWorlds.includes(WorldId);
}

function IsStageUnlocked(Save, StageId) {
    return Save.unlockedStages.includes(StageId);
}

function GetStageStars(Save, StageId) {
    return Number(Save.stars[StageId] || 0);
}

function UnlockStage(Data, Save, StageId) {
    if (!StageId || !Data.stages[StageId]) return;

    if (!Save.unlockedStages.includes(StageId)) Save.unlockedStages.push(StageId);

    const WorldId = Data.stages[StageId].worldId;
    if (!Save.unlockedWorlds.includes(WorldId)) Save.unlockedWorlds.push(WorldId);
}

function TotalStars(Save) {
    return Object.values(Save.stars).reduce(
        (Total, Stars) => Total + Number(Stars || 0),
        0
    );
}

function ClearedStages(Save) {
    return Object.values(Save.stars).filter(Stars => Number(Stars) > 0).length;
}

function Roman(NumberValue) {
    const Values = [
        [10, "X"],
        [9, "IX"],
        [5, "V"],
        [4, "IV"],
        [1, "I"]
    ];

    let Remaining = Number(NumberValue || 0);
    let Result = "";

    for (const [Value, Symbol] of Values) {
        while (Remaining >= Value) {
            Result += Symbol;
            Remaining -= Value;
        }
    }

    return Result || "I";
}

function Go(Page) {
    window.location.href = Page;
}

function GoStage(StageId, RoomCode = "") {
    const RoomPart = RoomCode ? `&room=${encodeURIComponent(RoomCode)}` : "";
    window.location.href = `dialog.html?stage=${encodeURIComponent(StageId)}${RoomPart}`;
}

function Delay(Milliseconds) {
    return new Promise(Resolve => setTimeout(Resolve, Milliseconds));
}

async function ResetSave() {
    return ResetServerSave();
}

function EscapeText(Value) {
    return String(Value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}
