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
        document.getElementById("GameRoot").innerHTML = `<div class="Panel" style="padding:28px">${EscapeText(Error.message)}. Use GitHub Pages or run node server.js.</div>`;
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
    document.getElementById("StatusText").textContent = "The page changed. Decide whether the objective and survival rule can both still be true.";

    RenderIllustration();
    RenderRemainingStory();
}

function RenderRemainingStory() {
    const Caption = document.getElementById("SceneCaption");
    const Remaining = Stage.sentences.filter((Text, Index) => !RemovedSentences.has(Index));
    Caption.textContent = Remaining.join(" ");
}

function BuildCreature(X, Y, Scale = 1, Attack = false) {
    const Mouth = Attack
        ? `<path class="CreatureMouth" d="M-16 11 Q0 50 18 12 Q2 29 -16 11Z"/><path class="CreatureTeeth" d="M-12 14 L-7 26 L-2 14 L3 27 L8 14 L13 26"/>`
        : `<path class="CreatureFace" d="M-10 10 Q0 23 10 10"/>`;

    return `<g transform="translate(${X} ${Y}) scale(${Scale})"><ellipse class="CreatureSkin" cx="0" cy="0" rx="23" ry="29"/><path class="CreatureBody" d="M-27 20 Q0 5 27 20 L33 92 L-33 92Z"/><circle class="CreatureEye" cx="-8" cy="-5" r="5.5"/><circle class="CreatureEye" cx="8" cy="-5" r="5.5"/><circle class="CreaturePupil" cx="-8" cy="-5" r="2"/><circle class="CreaturePupil" cx="8" cy="-5" r="2"/><path class="CreatureFace" d="M-12 -12 Q-5 -18 1 -12 M2 -12 Q9 -17 15 -9"/>${Mouth}</g>`;
}

function BuildNormalArt() {
    const Start = `<svg class="PictureBookArt" viewBox="0 0 760 420" xmlns="http://www.w3.org/2000/svg"><rect width="760" height="420" fill="#e4cfaa"/><rect x="14" y="14" width="732" height="392" rx="13" fill="none" stroke="#6d4b31" opacity=".22"/>`;
    const End = `<text x="25" y="394" font-size="14" font-style="italic" fill="#60442f">Plate ${World.number}.${Stage.levelNumber} — ${EscapeText(Stage.name)}</text></svg>`;

    if (World.theme === "fromville") {
        return Start + `<path d="M0 305 Q180 260 338 296 T760 280 L760 420 L0 420Z" fill="#a78661"/><path d="M245 420 Q314 315 390 264 Q475 205 760 188" fill="none" stroke="#7e6041" stroke-width="74" opacity=".62"/><g transform="translate(48 108)"><rect width="175" height="174" fill="#b5845c" stroke="#4c3425" stroke-width="3"/><path d="M-15 18 L88 -46 L190 18Z" fill="#745037" stroke="#4c3425" stroke-width="3"/><rect x="105" y="74" width="36" height="100" fill="#6f4a32"/></g><g transform="translate(506 90)"><rect width="193" height="128" fill="#c69b69" stroke="#4c3425" stroke-width="3"/><rect x="17" y="22" width="158" height="53" fill="#ead1a1"/><text x="96" y="56" font-size="23" font-weight="700" text-anchor="middle">DINER</text></g><g transform="translate(328 258)"><circle cx="0" cy="0" r="18" fill="#59402f"/><path d="M-24 24 Q0 8 24 24 L29 96 L-29 96Z" fill="#736047"/></g>${BuildCreature(565,250,.92)}${BuildCreature(636,242,.8)}${BuildCreature(700,235,.68)}` + End;
    }

    if (World.theme === "anime") {
        return Start + `<path d="M0 90 Q120 20 220 78 Q320 132 420 62 Q530 -8 630 70 Q690 112 760 56 L760 420 L0 420Z" fill="#8f727c"/><path d="M70 420 Q130 250 250 195 Q380 132 520 196 Q650 255 710 420" fill="#cbb69b" stroke="#5a3b43" stroke-width="3"/><g transform="translate(340 235)"><circle cx="0" cy="0" r="20" fill="#382e35"/><path d="M-26 24 Q0 7 26 24 L31 102 L-31 102Z" fill="#885365"/><rect x="-42" y="38" width="19" height="31" fill="#e1ba72" transform="rotate(-9)"/></g><g transform="translate(585 225)"><ellipse cx="0" cy="0" rx="36" ry="45" fill="#b4ada5" stroke="#51424a" stroke-width="3"/><circle cx="-12" cy="-7" r="8" fill="#eee4cf"/><circle cx="13" cy="-5" r="8" fill="#eee4cf"/><path d="M-18 19 Q0 4 18 20" fill="none" stroke="#49373e" stroke-width="4"/></g>` + End;
    }

    if (World.theme === "manor") {
        return Start + `<rect x="82" y="78" width="596" height="230" fill="#777783" stroke="#403943" stroke-width="4"/><path d="M54 89 L380 22 L706 89Z" fill="#4e4d59" stroke="#403943" stroke-width="4"/><rect x="130" y="125" width="102" height="74" fill="#e3cf9d" stroke="#403943" stroke-width="3"/><rect x="528" y="125" width="102" height="74" fill="#e3cf9d" stroke="#403943" stroke-width="3"/><g transform="translate(360 272)"><circle cx="0" cy="0" r="19" fill="#4c3a37"/><path d="M-25 24 Q0 7 25 24 L30 95 L-30 95Z" fill="#695c62"/></g><g transform="translate(585 218)"><ellipse cx="0" cy="0" rx="33" ry="48" fill="#89878a"/><circle cx="-10" cy="-5" r="7" fill="#efe7d5"/><circle cx="12" cy="-3" r="7" fill="#efe7d5"/><path d="M-10 18 Q2 31 14 18" fill="none" stroke="#383034" stroke-width="3"/></g>` + End;
    }

    if (World.theme === "forest") {
        return Start + `<path d="M0 330 Q150 260 310 302 T760 270 L760 420 L0 420Z" fill="#91a17a"/><path d="M365 30 V250" stroke="#594a31" stroke-width="27"/><path d="M365 92 Q270 48 180 24 M366 140 Q475 75 570 37" fill="none" stroke="#594a31" stroke-width="15"/><g transform="translate(225 63)"><path d="M0 0 V28" stroke="#514331" stroke-width="3"/><rect x="-11" y="28" width="22" height="37" rx="5" fill="#96abb0" stroke="#514331" stroke-width="3"/></g><g transform="translate(495 75)"><path d="M0 0 V28" stroke="#514331" stroke-width="3"/><rect x="-11" y="28" width="22" height="37" rx="5" fill="#cdb18a" stroke="#514331" stroke-width="3"/></g><g transform="translate(300 270)"><circle cx="0" cy="0" r="19" fill="#493a32"/><path d="M-25 24 Q0 7 25 24 L30 95 L-30 95Z" fill="#6d845b"/></g><path d="M580 238 q-58 -46 -102 -24" fill="none" stroke="#eadfb8" stroke-width="6" stroke-dasharray="13 10"/>` + End;
    }

    return Start + `<rect x="48" y="48" width="175" height="220" fill="#727986" stroke="#38414b" stroke-width="4"/><rect x="538" y="48" width="175" height="220" fill="#626a78" stroke="#38414b" stroke-width="4"/><g fill="#d7b877"><rect x="79" y="77" width="36" height="45"/><rect x="139" y="77" width="36" height="45"/><rect x="569" y="77" width="36" height="45"/><rect x="628" y="77" width="36" height="45"/></g><path d="M223 285 Q380 155 538 285" fill="none" stroke="#53687b" stroke-width="12" stroke-dasharray="18 12"/><g transform="translate(382 255)"><circle cx="0" cy="0" r="19" fill="#3f3734"/><path d="M-25 24 Q0 8 25 24 L30 96 L-30 96Z" fill="#667a8b"/></g><g transform="translate(585 254)"><circle cx="0" cy="0" r="20" fill="#d6c6af"/><path d="M-25 24 Q0 8 25 24 L30 96 L-30 96Z" fill="#626d78"/></g>` + End;
}

function BuildFailureArt() {
    const Start = `<svg class="PictureBookArt" viewBox="0 0 760 420" xmlns="http://www.w3.org/2000/svg"><rect width="760" height="420" fill="#c7aa84"/><rect width="760" height="420" fill="#2c0e0b" opacity=".36"/>`;
    const End = `<text x="25" y="394" font-size="14" font-style="italic" fill="#f0d9bd">Aftermath — the uncorrected page</text></svg>`;

    if (World.theme === "fromville") {
        return Start + `<path d="M0 314 Q180 270 378 304 T760 272 L760 420 L0 420Z" fill="#51463f" opacity=".7"/>${BuildCreature(145,250,.95)}${BuildCreature(275,260,1.08)}${BuildCreature(545,214,2.05,true)}<path d="M112 62 L187 105 M151 51 L226 95 M193 43 L269 86" stroke="#9d332e" stroke-width="7" stroke-linecap="round"/>` + End;
    }

    if (World.theme === "anime") {
        return Start + `<path d="M0 110 Q180 34 350 101 T760 71 L760 420 L0 420Z" fill="#5d4d57" opacity=".65"/><g transform="translate(500 235)"><ellipse cx="0" cy="0" rx="79" ry="87" fill="#aaa49d"/><circle cx="-20" cy="-10" r="13" fill="#eee4cf"/><circle cx="20" cy="-5" r="13" fill="#eee4cf"/><circle cx="-20" cy="-10" r="4" fill="#30231e"/><circle cx="20" cy="-5" r="4" fill="#30231e"/><path d="M-27 28 Q0 7 26 30" fill="none" stroke="#3e3130" stroke-width="5"/></g><path d="M170 78 Q245 156 190 260" fill="none" stroke="#d9ad61" stroke-width="7" stroke-dasharray="13 8"/>` + End;
    }

    if (World.theme === "manor") {
        return Start + `<rect x="92" y="64" width="576" height="244" fill="#49464e"/><rect x="130" y="104" width="110" height="80" fill="#e0c795" opacity=".2"/><g transform="translate(540 225) scale(1.45)"><ellipse cx="0" cy="0" rx="36" ry="49" fill="#8c898b"/><circle cx="-11" cy="-6" r="8" fill="#efe6d4"/><circle cx="13" cy="-3" r="8" fill="#efe6d4"/><path d="M-13 20 Q3 45 19 19" fill="#1e1110" stroke="#433536" stroke-width="2"/></g>` + End;
    }

    if (World.theme === "forest") {
        return Start + `<path d="M0 326 Q190 252 380 304 T760 274 L760 420 L0 420Z" fill="#59634b"/><path d="M382 12 V214" stroke="#413827" stroke-width="28"/><path d="M382 75 Q300 38 220 15 M382 120 Q475 72 558 32" fill="none" stroke="#413827" stroke-width="16"/><path d="M612 232 q-70 -67 -132 -30" fill="none" stroke="#ece1c1" stroke-width="7" stroke-dasharray="12 10"/>` + End;
    }

    return Start + `<rect x="42" y="42" width="180" height="230" fill="#505761"/><rect x="540" y="42" width="180" height="230" fill="#505761"/><path d="M222 280 Q380 132 540 280" fill="none" stroke="#71503a" stroke-width="14" stroke-dasharray="16 10"/><g transform="translate(386 245)"><circle cx="0" cy="0" r="21" fill="#d1c1aa"/><path d="M-26 24 Q0 9 26 24 L33 100 L-33 100Z" fill="#4d5964"/></g>` + End;
}

function RenderIllustration() {
    document.getElementById("Illustration").innerHTML = LastCheckFailed ? BuildFailureArt() : BuildNormalArt();
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
        ? "Following the ink trail back to World Select..."
        : Target
            ? `Following the ink trail to Level ${Target.levelNumber}...`
            : "Following the final ink trail...";

    document.getElementById("TravelCaption").textContent = SelectOnly
        ? "The current page closes. No new stage opens."
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

function ChapterArt() {
    const Start = `<svg class="PictureBookArt" viewBox="0 0 720 300" xmlns="http://www.w3.org/2000/svg"><rect width="720" height="300" fill="#dbc197"/><rect x="12" y="12" width="696" height="276" rx="9" fill="none" stroke="#69472e" opacity=".28"/>`;
    const End = `</svg>`;

    if (World.theme === "fromville") {
        return Start + `<path d="M0 300 Q190 215 350 229 T720 170" fill="none" stroke="#947451" stroke-width="72"/><g transform="translate(95 85)"><rect width="180" height="160" fill="#aa7c54" stroke="#4d3424" stroke-width="3"/><path d="M-15 15 L90 -45 L195 15Z" fill="#735036" stroke="#4d3424" stroke-width="3"/><rect class="AnimA" x="112" y="78" width="42" height="82" fill="#5f402d"/></g>${BuildCreature(515,210,.8)}` + End;
    }

    if (World.theme === "anime") {
        return Start + `<circle class="AnimA" cx="360" cy="150" r="112" fill="none" stroke="#894d62" stroke-width="18" stroke-dasharray="25 12"/><path d="M275 230 Q360 85 445 230" fill="none" stroke="#5d3e49" stroke-width="13"/><rect x="345" y="74" width="30" height="62" fill="#d9ad62" stroke="#5b4038" stroke-width="3"/>` + End;
    }

    if (World.theme === "manor") {
        return Start + `<rect x="145" y="72" width="430" height="200" fill="#73727d" stroke="#3e3840" stroke-width="4"/><path d="M115 82 L360 21 L605 82Z" fill="#4f4d57" stroke="#3e3840" stroke-width="4"/><rect class="AnimA" x="205" y="118" width="96" height="72" fill="#e2cb99" stroke="#3e3840" stroke-width="3"/><rect class="AnimA" x="420" y="118" width="96" height="72" fill="#e2cb99" stroke="#3e3840" stroke-width="3"/>` + End;
    }

    if (World.theme === "forest") {
        return Start + `<path d="M0 300 Q170 230 350 266 T720 230" fill="none" stroke="#84946f" stroke-width="82"/><path d="M350 20 V220" stroke="#55472f" stroke-width="29"/><path d="M350 80 Q260 42 185 18 M350 124 Q460 68 548 29" fill="none" stroke="#55472f" stroke-width="15"/><g class="AnimA" transform="translate(240 62)"><path d="M0 0 V26" stroke="#514331" stroke-width="3"/><rect x="-11" y="26" width="22" height="37" rx="5" fill="#9baeb2" stroke="#514331" stroke-width="3"/></g>` + End;
    }

    return Start + `<g class="AnimA"><rect x="54" y="52" width="170" height="210" fill="#707885" stroke="#39424d" stroke-width="4"/><rect x="496" y="52" width="170" height="210" fill="#606977" stroke="#39424d" stroke-width="4"/></g><path d="M224 270 Q360 170 496 270" fill="none" stroke="#556b7e" stroke-width="8" stroke-dasharray="13 10"/>` + End;
}

async function ShowChapterComplete() {
    const Overlay = document.getElementById("ChapterOverlay");
    document.getElementById("ChapterTitle").textContent = World.name;
    document.getElementById("ChapterText").textContent = World.chapterEnding;
    const Art = document.getElementById("ChapterArt");
    Art.className = `ChapterArt Theme-${World.theme}`;
    Art.innerHTML = ChapterArt();

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
