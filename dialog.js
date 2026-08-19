let Data;
let Save;
let Stage;
let World;
let Profile;
let RemovedSentences = new Set();
let LastCheckFailed = false;
let TransitionBusy = false;
let MultiplayerSocket = null;
let MultiplayerState = null;
let RoomCode = "";

window.addEventListener("DOMContentLoaded", async () => {
    try {
        const ProfileResult = await RequireAccount();
        Profile = ProfileResult.profile;
        Data = await LoadStoryData();
        Save = await LoadSave(Data);

        const Params = new URLSearchParams(window.location.search);
        const StageId = Params.get("stage") || Save.currentStage;
        RoomCode = String(Params.get("room") || "").trim().toUpperCase();
        Stage = Data.stages[StageId];

        if (!Stage) {
            window.location.href = "levels.html";
            return;
        }

        if (!RoomCode && !IsStageUnlocked(Save, StageId)) {
            window.location.href = "levels.html";
            return;
        }

        World = GetWorld(Data, Stage.worldId);

        if (!RoomCode) Save = await EnterServerStage(Stage.id);

        StoryAudio.Configure(Save.settings);
        StoryAudio.PlayMusic(World.theme || "menu");
        BindActions();
        RenderStage();

        if (RoomCode) StartMultiplayer();
    } catch (Error) {
        document.getElementById("GameRoot").innerHTML = `<div class="Panel" style="padding:28px">${EscapeText(Error.message)}</div>`;
    }
});

function BindActions() {
    document.getElementById("CheckButton").addEventListener("click", CheckStage);
    document.getElementById("RestoreButton").addEventListener("click", RestoreStage);
    document.getElementById("BackButton").addEventListener("click", () => window.location.href = RoomCode ? "multiplayer.html" : "levels.html");
    document.getElementById("NextButton").addEventListener("click", NextStage);
    document.getElementById("ReplayButton").addEventListener("click", ReplayStage);
    document.getElementById("CompleteSelectButton").addEventListener("click", ReturnToSelectWithTrail);
    document.getElementById("TbcSelectButton").addEventListener("click", () => window.location.href = "levels.html");
    document.getElementById("RestartChapterButton").addEventListener("click", RestartChapter);
    document.getElementById("GameOverMapButton").addEventListener("click", () => window.location.href = RoomCode ? "multiplayer.html" : "levels.html");
    document.getElementById("GameChatForm").addEventListener("submit", SendGameChat);
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
    document.getElementById("EraseHint").textContent = RoomCode
        ? "Vote on sentences with your group. A sentence is crossed out when a majority agrees."
        : "Click a sentence to cross it out. Click it again to restore it. When you are ready, check survival.";

    RenderSentences();
    RenderLives();
    RenderIllustration();
    RenderRemainingStory();
}

function RenderSentences() {
    const SentenceList = document.getElementById("SentenceList");
    SentenceList.innerHTML = "";

    Stage.sentences.forEach((Text, Index) => {
        const Button = document.createElement("button");
        Button.className = `Sentence ${RemovedSentences.has(Index) ? "Crossed" : ""}`;
        Button.type = "button";

        const TextNode = document.createElement("span");
        TextNode.textContent = Text;
        Button.appendChild(TextNode);

        if (RoomCode) {
            const VoteCount = document.createElement("span");
            VoteCount.className = "VoteCount";
            const Count = Number(MultiplayerState?.votes?.[Index] || 0);
            VoteCount.textContent = `${Count}/${MultiplayerState?.voteThreshold || 1}`;
            Button.appendChild(VoteCount);
        }

        Button.addEventListener("click", () => ToggleSentence(Index));
        SentenceList.appendChild(Button);
    });

    document.getElementById("CrossedCount").textContent = RemovedSentences.size;
}

function ToggleSentence(Index) {
    LastCheckFailed = false;
    document.getElementById("Aftermath").classList.add("Hidden");

    if (RoomCode) {
        if (!MultiplayerSocket) return;
        StoryAudio.PlaySound("click");
        MultiplayerSocket.emit("game:vote", { index: Index });
        return;
    }

    if (RemovedSentences.has(Index)) {
        RemovedSentences.delete(Index);
        StoryAudio.PlaySound("restore");
    } else {
        RemovedSentences.add(Index);
        StoryAudio.PlaySound("cross");
    }

    document.getElementById("StatusText").className = "StatusText";
    document.getElementById("StatusText").textContent = "The story changed. Check survival when you think the route is safe.";
    RenderSentences();
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

function RenderLives() {
    const Lives = RoomCode ? Number(MultiplayerState?.lives ?? 3) : Number(Save?.lives ?? 3);
    const MaxLives = RoomCode ? Number(MultiplayerState?.maxLives ?? 3) : Number(Save?.maxLives ?? 3);
    document.getElementById("LivesLabel").textContent = RoomCode ? "Team lives" : "Lives";
    const Container = document.getElementById("LivesHearts");
    Container.innerHTML = "";

    for (let Index = 0; Index < MaxLives; Index += 1) {
        const Heart = document.createElement("span");
        Heart.className = `LifeHeart ${Index < Lives ? "" : "Empty"}`;
        Heart.textContent = "♥";
        Container.appendChild(Heart);
    }
}

function GetSceneMessage(Mode) {
    if (Mode === "failure") return Stage.aftermath;
    if (Mode === "chapter") return World.chapterEnding;
    if (RemovedSentences.size === 0) return "The original account is still intact. The danger has not been rewritten yet.";
    if (RemovedSentences.size === 1) return "One event has been removed. The route is changing, but survival has not been checked.";
    return `${RemovedSentences.size} events have been removed. The rewritten route is waiting for a survival check.`;
}

function GetSceneStateLabel(Mode) {
    if (Mode === "failure") return "BAD OUTCOME";
    if (Mode === "chapter") return "CHAPTER CLEARED";
    return "STORY IN PLAY";
}

function BuildSceneEyes() {
    if (World.theme !== "fromville") return "";
    return `<div class="SceneEyes"><i></i><i></i><i></i></div>`;
}

function BuildSceneVisual(Mode = "active") {
    const Theme = EscapeText(World.theme || Stage.theme || "fromville");
    const StateClass = Mode === "failure" ? "SceneMode-failure" : Mode === "chapter" ? "SceneMode-chapter" : "SceneMode-active";
    const Kicker = Mode === "chapter" ? `WORLD ${World.number} COMPLETE` : `WORLD ${World.number} · LEVEL ${Stage.levelNumber}`;
    const Title = Mode === "chapter" ? World.name : Stage.name;
    const FooterRight = Mode === "failure" ? "SURVIVAL FAILED" : Mode === "chapter" ? "ROUTE OPEN" : `${RemovedSentences.size} CROSSED OUT`;

    return `
        <div class="GameScene SceneTheme-${Theme} ${StateClass}">
            <div class="SceneAtmosphere"></div>
            <div class="SceneGeometry"></div>
            ${BuildSceneEyes()}
            <div class="SceneHudTop"><span>${EscapeText(Kicker)}</span><span class="SceneStateBadge">${GetSceneStateLabel(Mode)}</span></div>
            <div class="SceneFocus"><div class="SceneChapter">${EscapeText(World.shortName || World.name)}</div><h3>${EscapeText(Title)}</h3><p>${EscapeText(GetSceneMessage(Mode))}</p></div>
            <div class="SceneHudBottom"><span>${EscapeText(World.shortName || World.name)}</span><span>${EscapeText(FooterRight)}</span></div>
        </div>
    `;
}

function RenderIllustration() {
    document.getElementById("Illustration").innerHTML = BuildSceneVisual(LastCheckFailed ? "failure" : "active");
}

async function CheckStage() {
    const Status = document.getElementById("StatusText");
    document.getElementById("CheckButton").disabled = true;

    try {
        if (RoomCode) {
            if (!MultiplayerState || MultiplayerState.hostUsername !== Profile.username) {
                Status.className = "StatusText";
                Status.textContent = `Only ${MultiplayerState?.hostUsername || "the host"} can check survival.`;
                return;
            }

            MultiplayerSocket.emit("game:check", {}, Result => {
                if (!Result?.ok) {
                    Status.className = "StatusText Bad";
                    Status.textContent = Result?.error || "Could not check survival.";
                }
            });
            return;
        }

        const Result = await CheckServerStage(Stage.id, [...RemovedSentences]);
        Save = NormalizeSave(Data, Result.save);
        RenderLives();

        if (!Result.success) {
            ApplyFailureOutcome(Result);
            return;
        }

        LastCheckFailed = false;
        StoryAudio.PlaySound("success");
        Status.className = "StatusText Good";
        Status.textContent = "The rewritten account satisfies the objective and survival rule.";
        ShowComplete(Result.stars);
    } catch (Error) {
        Status.className = "StatusText Bad";
        Status.textContent = Error.message;
    } finally {
        document.getElementById("CheckButton").disabled = false;
    }
}

function ApplyFailureOutcome(Result) {
    LastCheckFailed = true;
    StoryAudio.PlaySound(Result.gameOver ? "life" : "fail");
    StoryAudio.PlayMusic("danger");
    const Status = document.getElementById("StatusText");
    Status.className = "StatusText Bad";
    Status.textContent = `${Result.reason} Life lost.`;

    const Aftermath = document.getElementById("Aftermath");
    Aftermath.classList.remove("Hidden");
    Aftermath.innerHTML = `<strong>Bad outcome</strong>${EscapeText(Result.aftermath)}`;
    RenderIllustration();
    RenderLives();
    ShakeBook();

    if (Result.gameOver) {
        document.getElementById("GameOverText").textContent = `${Result.aftermath} No lives remain. Restart the chapter to continue.`;
        document.getElementById("GameOverOverlay").classList.add("Show");
    }
}

function ShakeBook() {
    document.getElementById("Book").animate([
        { transform: "translateX(0)" },
        { transform: "translateX(-7px)" },
        { transform: "translateX(7px)" },
        { transform: "translateX(-4px)" },
        { transform: "translateX(0)" }
    ], { duration: 330, easing: "ease" });
}

function RestoreStage() {
    if (RoomCode) {
        document.getElementById("StatusText").className = "StatusText";
        document.getElementById("StatusText").textContent = "In multiplayer, remove votes by clicking the voted sentences again.";
        return;
    }

    RemovedSentences.clear();
    LastCheckFailed = false;
    StoryAudio.PlaySound("restore");
    document.getElementById("Aftermath").classList.add("Hidden");
    document.getElementById("StatusText").className = "StatusText";
    document.getElementById("StatusText").textContent = "The whole page has been restored.";
    StoryAudio.PlayMusic(World.theme || "menu");
    RenderStage();
}

function ShowComplete(Stars) {
    document.getElementById("CompleteDifficulty").textContent = Stage.difficulty;
    document.getElementById("CompleteText").textContent = `${World.name} · ${Stage.name}`;
    document.getElementById("StarRow").textContent = `${"★".repeat(Stars)}${"☆".repeat(3 - Stars)}`;
    document.getElementById("NextButton").textContent = Stage.isChapterEnd ? (Stage.nextStage ? "Finish Chapter" : "Finish Final Chapter") : "Next Level";
    document.getElementById("CompleteOverlay").classList.add("Show");
}

async function ShowTrail(TargetStageId, SelectOnly = false) {
    if (TransitionBusy) return false;
    TransitionBusy = true;
    const Overlay = document.getElementById("TravelOverlay");
    const Target = TargetStageId ? Data.stages[TargetStageId] : null;

    document.getElementById("TravelTitle").textContent = SelectOnly ? "Returning to the chapter map..." : Target ? `Opening Level ${Target.levelNumber}...` : "Following the final route...";
    document.getElementById("TravelCaption").textContent = SelectOnly ? "The current page closes." : Target ? Target.name : "There are no recovered pages beyond this point.";
    document.getElementById("TravelTarget").textContent = SelectOnly ? "☰" : Target ? Target.levelNumber : "?";

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

    if (RoomCode) {
        if (MultiplayerState?.hostUsername !== Profile.username) {
            document.getElementById("CompleteText").textContent = `Waiting for ${MultiplayerState?.hostUsername || "the host"} to continue...`;
            return;
        }
        document.getElementById("CompleteOverlay").classList.remove("Show");
        MultiplayerSocket.emit("game:next");
        return;
    }

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
    document.getElementById("CompleteOverlay").classList.remove("Show");
    if (RoomCode) {
        window.location.href = "multiplayer.html";
        return;
    }
    const Traveled = await ShowTrail(null, true);
    if (Traveled) window.location.href = "levels.html";
}

function ReplayStage() {
    document.getElementById("CompleteOverlay").classList.remove("Show");

    if (RoomCode) {
        if (MultiplayerState?.hostUsername === Profile.username) MultiplayerSocket.emit("game:retry");
        return;
    }

    RemovedSentences.clear();
    LastCheckFailed = false;
    document.getElementById("Aftermath").classList.add("Hidden");
    document.getElementById("StatusText").className = "StatusText";
    document.getElementById("StatusText").textContent = "The page has been reset.";
    StoryAudio.PlayMusic(World.theme || "menu");
    RenderStage();
}

async function RestartChapter() {
    if (RoomCode) {
        if (MultiplayerState?.hostUsername !== Profile.username) return;
        document.getElementById("GameOverOverlay").classList.remove("Show");
        MultiplayerSocket.emit("game:restartChapter");
        return;
    }

    Save = await RestartServerChapter(World.id);
    document.getElementById("GameOverOverlay").classList.remove("Show");
    GoStage(GetWorld(Data, World.id).entryStage);
}

function StartMultiplayer() {
    document.getElementById("MultiplayerDock").classList.remove("Hidden");
    document.getElementById("MultiplayerRoomLabel").textContent = `Room ${RoomCode}`;
    MultiplayerSocket = ConnectStorySocket();

    MultiplayerSocket.on("connect", () => {
        MultiplayerSocket.emit("room:join", { code: RoomCode }, Result => {
            if (!Result?.ok) {
                document.getElementById("StatusText").className = "StatusText Bad";
                document.getElementById("StatusText").textContent = Result?.error || "Could not reconnect to the multiplayer room.";
                return;
            }
            MultiplayerState = Result.state;
            ApplyRoomState(Result.state);
        });
    });

    MultiplayerSocket.on("room:state", ApplyRoomState);
    MultiplayerSocket.on("room:chat", Message => AppendGameChat(Message));
    MultiplayerSocket.on("game:outcome", HandleMultiplayerOutcome);
    MultiplayerSocket.on("game:retry", () => {
        RemovedSentences.clear();
        LastCheckFailed = false;
        document.getElementById("Aftermath").classList.add("Hidden");
        document.getElementById("CompleteOverlay").classList.remove("Show");
        StoryAudio.PlayMusic(World.theme || "menu");
        RenderStage();
    });
    MultiplayerSocket.on("game:stage", Payload => {
        window.location.href = `dialog.html?stage=${encodeURIComponent(Payload.stageId)}&room=${encodeURIComponent(RoomCode)}`;
    });
    MultiplayerSocket.on("game:finished", () => document.getElementById("TbcOverlay").classList.add("Show"));
    MultiplayerSocket.on("connect_error", Error => {
        document.getElementById("StatusText").className = "StatusText Bad";
        document.getElementById("StatusText").textContent = Error.message;
    });
}

function ApplyRoomState(State) {
    MultiplayerState = State;
    RemovedSentences = new Set(State.selectedIndexes || []);
    RenderLives();
    RenderSentences();
    RenderRemainingStory();
    RenderIllustration();
    document.getElementById("MultiplayerVoteLabel").textContent = `Majority ${State.voteThreshold}`;

    const IsHost = State.hostUsername === Profile.username;
    document.getElementById("CheckButton").textContent = IsHost ? "Check Team Survival" : `Host ${State.hostUsername} Checks`;
    document.getElementById("CheckButton").disabled = !IsHost;

    const Chat = document.getElementById("GameChatMessages");
    if (Chat && Chat.childElementCount === 0 && State.messages) {
        for (const Message of State.messages) AppendGameChat(Message, false);
        Chat.scrollTop = Chat.scrollHeight;
    }
}

function HandleMultiplayerOutcome(Result) {
    RenderLives();
    if (!Result.success) {
        ApplyFailureOutcome(Result);
        return;
    }

    LastCheckFailed = false;
    StoryAudio.PlaySound("success");
    document.getElementById("StatusText").className = "StatusText Good";
    document.getElementById("StatusText").textContent = "The team rewrite survived.";
    ShowComplete(Result.stars);
}

function SendGameChat(Event) {
    Event.preventDefault();
    if (!MultiplayerSocket) return;
    const Input = document.getElementById("GameChatInput");
    const Text = Input.value.trim();
    if (!Text) return;
    MultiplayerSocket.emit("room:chat", { text });
    Input.value = "";
}

function AppendGameChat(Message, Scroll = true) {
    const Container = document.getElementById("GameChatMessages");
    const Element = document.createElement("div");
    Element.className = "ChatMessage";
    const Strong = document.createElement("strong");
    Strong.textContent = `${Message.username}: `;
    Element.appendChild(Strong);
    Element.appendChild(document.createTextNode(Message.text));
    Container.appendChild(Element);
    StoryAudio.PlaySound("message");
    if (Scroll) Container.scrollTop = Container.scrollHeight;
}
