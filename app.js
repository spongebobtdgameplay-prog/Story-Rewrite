const FAVICON_VERSION = "3";

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

for (const LinkData of HeadLinks) {
    const ExistingLinks = document.head.querySelectorAll(`link[rel="${LinkData.rel}"]`);

    for (const ExistingLink of ExistingLinks) {
        ExistingLink.remove();
    }

    const Link = document.createElement("link");

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
        version: 3,
        unlockedWorlds: [FirstWorld.id],
        unlockedStages: [FirstStage],
        stars: {},
        currentStage: FirstStage,
        tutorialSeen: false
    };
}

function LoadSave(Data) {
    let Save = null;

    try {
        const Raw = localStorage.getItem(Data.saveKey);

        if (Raw) {
            Save = JSON.parse(Raw);
        }
    } catch {}

    if (!Save || typeof Save !== "object") {
        Save = DefaultSave(Data);
    }

    if (!Array.isArray(Save.unlockedWorlds)) {
        Save.unlockedWorlds = [Data.worlds[0].id];
    }

    if (!Array.isArray(Save.unlockedStages)) {
        Save.unlockedStages = [Data.worlds[0].entryStage];
    }

    if (!Save.stars || typeof Save.stars !== "object") {
        Save.stars = {};
    }

    if (!Data.stages[Save.currentStage]) {
        Save.currentStage = Data.worlds[0].entryStage;
    }

    if (!Save.unlockedWorlds.includes(Data.worlds[0].id)) {
        Save.unlockedWorlds.push(Data.worlds[0].id);
    }

    if (!Save.unlockedStages.includes(Data.worlds[0].entryStage)) {
        Save.unlockedStages.push(Data.worlds[0].entryStage);
    }

    return Save;
}

function SaveProgress(Data, Save) {
    localStorage.setItem(Data.saveKey, JSON.stringify(Save));
}

function GetWorld(Data, WorldId) {
    return Data.worlds.find(World => World.id === WorldId);
}

function IsWorldUnlocked(Save, WorldId) {
    return Save.unlockedWorlds.includes(WorldId);
}

function IsStageUnlocked(Save, StageId) {
    return Save.unlockedStages.includes(StageId);
}

function UnlockStage(Data, Save, StageId) {
    if (!StageId || !Data.stages[StageId]) {
        return;
    }

    if (!Save.unlockedStages.includes(StageId)) {
        Save.unlockedStages.push(StageId);
    }

    const WorldId = Data.stages[StageId].worldId;

    if (!Save.unlockedWorlds.includes(WorldId)) {
        Save.unlockedWorlds.push(WorldId);
    }
}

function CompleteStage(Data, Save, StageId, Stars) {
    const Stage = Data.stages[StageId];

    if (!Stage) {
        return;
    }

    Save.stars[StageId] = Math.max(
        Number(Save.stars[StageId] || 0),
        Stars
    );

    if (Stage.nextStage) {
        UnlockStage(Data, Save, Stage.nextStage);
        Save.currentStage = Stage.nextStage;
    } else {
        Save.currentStage = StageId;
    }

    SaveProgress(Data, Save);
}

function TotalStars(Save) {
    return Object.values(Save.stars).reduce(
        (Total, Stars) => Total + Number(Stars || 0),
        0
    );
}

function ClearedStages(Save) {
    return Object.values(Save.stars).filter(
        Stars => Number(Stars) > 0
    ).length;
}

function Roman(NumberValue) {
    const Values = [
        [10, "X"],
        [9, "IX"],
        [5, "V"],
        [4, "IV"],
        [1, "I"]
    ];

    let Remaining = NumberValue;
    let Result = "";

    for (const [Value, Symbol] of Values) {
        while (Remaining >= Value) {
            Result += Symbol;
            Remaining -= Value;
        }
    }

    return Result;
}

function Go(Page) {
    window.location.href = Page;
}

function GoStage(StageId) {
    window.location.href = `dialog.html?stage=${encodeURIComponent(StageId)}`;
}

function Delay(Milliseconds) {
    return new Promise(Resolve => setTimeout(Resolve, Milliseconds));
}

function ResetSave(Data) {
    localStorage.removeItem(Data.saveKey);
}

function EscapeText(Value) {
    return String(Value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}
