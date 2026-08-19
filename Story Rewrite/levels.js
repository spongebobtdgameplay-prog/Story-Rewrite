let Data;
let Save;

document.addEventListener("DOMContentLoaded", async () => {
    try {
        Data = await LoadStoryData();
        Save = LoadSave(Data);

        RenderStats();
        RenderWorldRoute();
        RenderWorldCards();

        const Params = new URLSearchParams(window.location.search);
        const UnlockWorld = Params.get("unlock");
        const AutoStart = Params.get("autostart");

        if (UnlockWorld && GetWorld(Data, UnlockWorld)) {
            await AnimateWorldUnlock(UnlockWorld);
        }

        if (AutoStart && Data.stages[AutoStart] && IsStageUnlocked(Save, AutoStart)) {
            await Delay(550);
            GoStage(AutoStart);
        }

        document.getElementById("ResetButton").addEventListener("click", () => {
            if (!confirm("Reset all Story Rewrite progress?")) return;
            ResetSave(Data);
            window.location.href = "main.html";
        });
    } catch (Error) {
        document.getElementById("WorldList").innerHTML = `<div class="Panel" style="padding:24px">${EscapeText(Error.message)}. Use GitHub Pages or node server.js.</div>`;
    }
});

function RenderStats() {
    const Total = Object.keys(Data.stages).length;
    const Cleared = ClearedStages(Save);
    document.getElementById("ProgressText").textContent = `${Cleared} / ${Total}`;
    document.getElementById("ProgressFill").style.width = `${(Cleared / Total) * 100}%`;
}

function WorldArt(Theme) {
    if (Theme === "fromville") {
        return `<svg viewBox="0 0 120 120"><rect width="120" height="120" fill="#d9c19b"/><path d="M0 92 Q30 75 60 82 T120 70 L120 120 L0 120Z" fill="#9e805c"/><rect x="10" y="38" width="38" height="34" fill="#b48258" stroke="#4c3425" stroke-width="2"/><path d="M6 41 L29 22 L52 41" fill="#735036" stroke="#4c3425" stroke-width="2"/><rect x="70" y="34" width="38" height="29" fill="#c39765" stroke="#4c3425" stroke-width="2"/><text x="89" y="52" font-size="8" text-anchor="middle">DINER</text><g transform="translate(89 83)"><ellipse cx="0" cy="0" rx="11" ry="14" fill="#8c9294"/><circle cx="-4" cy="-2" r="3" fill="#efe4ce"/><circle cx="4" cy="-2" r="3" fill="#efe4ce"/><path d="M-6 5 Q0 13 6 5" fill="none" stroke="#2b2421" stroke-width="2"/></g></svg>`;
    }
    if (Theme === "anime") {
        return `<svg viewBox="0 0 120 120"><rect width="120" height="120" fill="#d6c0b8"/><path d="M0 100 Q30 54 57 43 Q89 29 120 52 L120 120 L0 120Z" fill="#8a6f79"/><path d="M18 84 Q37 25 58 84" fill="none" stroke="#5d3a47" stroke-width="8"/><rect x="68" y="23" width="14" height="46" fill="#d5aa62" stroke="#5a3c37" stroke-width="2"/><path d="M86 36 q20 -8 24 8 q-12 15 -27 15" fill="#c4b9ab" stroke="#5a3c37" stroke-width="2"/></svg>`;
    }
    if (Theme === "manor") {
        return `<svg viewBox="0 0 120 120"><rect width="120" height="120" fill="#c8c4bd"/><rect x="16" y="32" width="88" height="58" fill="#797986" stroke="#3d3540" stroke-width="2"/><path d="M8 38 L60 12 L112 38" fill="#51505b" stroke="#3d3540" stroke-width="2"/><rect x="29" y="50" width="21" height="18" fill="#dfc995"/><rect x="70" y="50" width="21" height="18" fill="#dfc995"/><circle cx="91" cy="91" r="10" fill="#58535a"/></svg>`;
    }
    if (Theme === "forest") {
        return `<svg viewBox="0 0 120 120"><rect width="120" height="120" fill="#cad3b5"/><path d="M0 104 Q28 62 54 55 T120 44 L120 120 L0 120Z" fill="#8ca07a"/><path d="M60 16 V86" stroke="#594b32" stroke-width="10"/><path d="M60 32 Q35 20 18 10 M61 45 Q89 27 104 16" fill="none" stroke="#594b32" stroke-width="6"/><rect x="24" y="18" width="10" height="18" rx="2" fill="#98aeb3" stroke="#4c4130"/></svg>`;
    }
    return `<svg viewBox="0 0 120 120"><rect width="120" height="120" fill="#c4cad0"/><rect x="12" y="25" width="36" height="60" fill="#6e7380" stroke="#39414a" stroke-width="2"/><rect x="72" y="25" width="36" height="60" fill="#5f6673" stroke="#39414a" stroke-width="2"/><path d="M48 91 Q60 70 72 91" fill="none" stroke="#516474" stroke-width="5" stroke-dasharray="7 5"/><circle cx="60" cy="84" r="7" fill="#d6a35e"/></svg>`;
}

function RenderWorldRoute() {
    const Track = document.getElementById("WorldTrack");
    Track.innerHTML = "";

    const UnlockedIndices = Data.worlds
        .map((World, Index) => IsWorldUnlocked(Save, World.id) ? Index : -1)
        .filter(Index => Index >= 0);

    const HighestUnlocked = Math.max(...UnlockedIndices, 0);

    Data.worlds.forEach((World, WorldIndex) => {
        const Node = document.createElement("div");
        const Unlocked = IsWorldUnlocked(Save, World.id);
        Node.className = `WorldNode ${Unlocked ? "Unlocked" : "Locked"} ${WorldIndex === HighestUnlocked ? "Current" : ""}`;
        Node.innerHTML = `<div class="WorldNodeName">${EscapeText(World.name)}</div><div class="WorldNodeArt">${WorldArt(World.theme)}</div><div class="WorldNodeNumber">World ${World.number}</div>`;
        if (Unlocked) {
            Node.style.cursor = "pointer";
            Node.addEventListener("click", () => {
                document.getElementById(`world-${World.id}`).scrollIntoView({ behavior: "smooth", block: "start" });
            });
        }
        Track.appendChild(Node);

        if (WorldIndex < Data.worlds.length - 1) {
            const Connector = document.createElement("div");
            Connector.id = `connector-${World.id}-${Data.worlds[WorldIndex + 1].id}`;
            Connector.className = `WorldConnector ${WorldIndex < HighestUnlocked ? "Active" : ""}`;
            Connector.innerHTML = "<span></span><span></span><span></span><span></span><span></span>";
            Track.appendChild(Connector);
        }
    });
}

function PreviewArt(Theme, LevelNumber) {
    const Label = String(LevelNumber).padStart(2, "0");
    return `<svg viewBox="0 0 160 90">${WorldArt(Theme).replace('viewBox="0 0 120 120"', 'x="0" y="-34" width="160" height="160" viewBox="0 0 120 120"')}<rect x="6" y="6" width="148" height="78" rx="9" fill="none" stroke="#5a3c28" opacity=".22"/><text x="10" y="81" font-size="10" fill="#5f432f">Plate ${Label}</text></svg>`;
}

function RenderWorldCards() {
    const List = document.getElementById("WorldList");
    List.innerHTML = "";

    Data.worlds.forEach(World => {
        const Unlocked = IsWorldUnlocked(Save, World.id);
        const Card = document.createElement("section");
        Card.id = `world-${World.id}`;
        Card.className = `WorldCard ${Unlocked ? "" : "Locked"}`;

        let Stars = 0;
        World.levels.forEach(StageId => Stars += Number(Save.stars[StageId] || 0));

        const Header = document.createElement("div");
        Header.className = "WorldCardHeader";
        Header.innerHTML = `<div><div class="Eyebrow">World ${World.number} · ${EscapeText(World.theme)}</div><h2>${EscapeText(World.name)}</h2><p>${EscapeText(World.description)}</p></div><div class="WorldStars">${Stars} / 30 ★</div>`;
        Card.appendChild(Header);

        const Grid = document.createElement("div");
        Grid.className = "LevelGrid";

        World.levels.forEach(StageId => {
            const Stage = Data.stages[StageId];
            const StageUnlocked = IsStageUnlocked(Save, StageId);
            const StarsEarned = Number(Save.stars[StageId] || 0);
            const StarsText = StarsEarned > 0 ? `${"★".repeat(StarsEarned)}${"☆".repeat(3 - StarsEarned)}` : "Not cleared";

            const Tile = document.createElement("div");
            Tile.className = "LevelTile";
            Tile.innerHTML = `<div class="DifficultyBadge">${EscapeText(Stage.difficulty)}</div>`;

            const Button = document.createElement("button");
            Button.className = "LevelButton";
            Button.disabled = !StageUnlocked;
            Button.innerHTML = `<div class="LevelTop"><div><div class="LevelNumber">Level ${Stage.levelNumber}</div><div class="LevelName">${EscapeText(Stage.name)}</div></div><div class="LevelStars">${StageUnlocked ? StarsText : "Locked"}</div></div><div class="LevelPreview">${PreviewArt(World.theme, Stage.levelNumber)}</div>`;
            if (StageUnlocked) Button.addEventListener("click", () => GoStage(StageId));

            Tile.appendChild(Button);
            Grid.appendChild(Tile);
        });

        Card.appendChild(Grid);
        List.appendChild(Card);
    });
}

async function AnimateWorldUnlock(WorldId) {
    const Index = Data.worlds.findIndex(World => World.id === WorldId);
    if (Index <= 0) return;

    const Previous = Data.worlds[Index - 1];
    const Current = Data.worlds[Index];
    const Connector = document.getElementById(`connector-${Previous.id}-${Current.id}`);

    if (Connector) {
        Connector.classList.add("Active", "Animating");
    }

    const CurrentNode = [...document.querySelectorAll(".WorldNode")][Index];
    if (CurrentNode) {
        CurrentNode.classList.remove("Locked");
        CurrentNode.classList.add("Unlocked", "Current");
    }

    await Delay(1900);

    if (Connector) {
        Connector.classList.remove("Animating");
    }
}
