const VoteTapLocks = new Set();
let MultiplayerCheckBusyV11 = false;

function GetDifficultyLevelValue() {
    const Value = String(Stage?.difficulty || "").toLowerCase();
    if (/nightmare|extreme|brutal|insane/.test(Value)) return 4;
    if (/hard/.test(Value)) return 3;
    if (/normal|medium/.test(Value)) return 2;
    return 1;
}

function BuildSmilerArt() {
    return `
        <div class="SceneThreatArt SceneThreatArtSmiler" aria-label="A smiling night creature watches the story">
            <svg viewBox="0 0 160 190" aria-hidden="true">
                <path class="ThreatShadow" d="M34 173c2-38 18-58 46-58s44 20 46 58H34Z"></path>
                <ellipse class="ThreatFace" cx="80" cy="76" rx="47" ry="56"></ellipse>
                <path class="ThreatHair" d="M37 70c0-39 18-61 44-61 27 0 45 22 45 61-11-15-26-23-45-23-18 0-33 8-44 23Z"></path>
                <ellipse class="ThreatEye" cx="62" cy="72" rx="5" ry="7"></ellipse>
                <ellipse class="ThreatEye" cx="98" cy="72" rx="5" ry="7"></ellipse>
                <path class="ThreatSmile" d="M50 93c18 22 42 22 60 0-5 32-55 32-60 0Z"></path>
                <path class="ThreatFang" d="M58 100 64 111 70 100ZM74 102 80 114 86 101ZM90 101 96 112 102 99Z"></path>
            </svg>
        </div>
    `;
}

function BuildManInYellowArt() {
    return `
        <div class="SceneThreatArt SceneThreatArtYellow" aria-label="A mysterious man in yellow stands behind the story">
            <svg viewBox="0 0 170 210" aria-hidden="true">
                <ellipse class="YellowGlow" cx="85" cy="94" rx="68" ry="90"></ellipse>
                <path class="YellowHat" d="M43 48h84l-12-18H58L43 48Z"></path>
                <path class="YellowHead" d="M61 48h48v47H61Z"></path>
                <path class="YellowCoat" d="M48 89h74l28 104H20L48 89Z"></path>
                <path class="YellowLapels" d="M61 91 84 125 109 91M84 125v68"></path>
                <path class="YellowFace" d="M70 65h8M94 65h8M74 82c8 5 14 5 22 0"></path>
            </svg>
        </div>
    `;
}

function BuildDifficultyThreatArt() {
    return GetDifficultyLevelValue() >= 3 ? BuildManInYellowArt() : BuildSmilerArt();
}

if (typeof BuildSceneVisual === "function" && !BuildSceneVisual.V11Wrapped) {
    const BaseBuildSceneVisual = BuildSceneVisual;
    const WrappedBuildSceneVisual = function(...Arguments) {
        const Markup = BaseBuildSceneVisual(...Arguments);
        return Markup.replace('<div class="SceneFocus">', `${BuildDifficultyThreatArt()}<div class="SceneFocus">`);
    };
    WrappedBuildSceneVisual.V11Wrapped = true;
    BuildSceneVisual = WrappedBuildSceneVisual;
}

if (typeof ToggleSentence === "function" && !ToggleSentence.V11Wrapped) {
    const BaseToggleSentence = ToggleSentence;
    const WrappedToggleSentence = function(Index) {
        if (!RoomCode) return BaseToggleSentence(Index);
        if (VoteTapLocks.has(Index)) return;

        VoteTapLocks.add(Index);
        StoryAudio?.PlaySound?.("vote");
        BaseToggleSentence(Index);
        setTimeout(() => VoteTapLocks.delete(Index), 280);
    };
    WrappedToggleSentence.V11Wrapped = true;
    ToggleSentence = WrappedToggleSentence;
}

if (typeof RenderSentences === "function" && !RenderSentences.V11Wrapped) {
    const WrappedRenderSentences = function() {
        const SentenceList = document.getElementById("SentenceList");
        if (!SentenceList || !Stage) return;

        SentenceList.innerHTML = "";

        Stage.sentences.forEach((Text, Index) => {
            const Button = document.createElement("button");
            Button.className = `Sentence NumberedSentence ${RemovedSentences.has(Index) ? "Crossed" : ""}`;
            Button.type = "button";
            Button.dataset.option = String(Index + 1);

            const NumberBadge = document.createElement("span");
            NumberBadge.className = "SentenceOptionNumber";
            NumberBadge.textContent = String(Index + 1);
            Button.appendChild(NumberBadge);

            const Content = document.createElement("span");
            Content.className = "SentenceOptionContent";

            const TextNode = document.createElement("span");
            TextNode.className = "SentenceOptionText";
            TextNode.textContent = Text;
            Content.appendChild(TextNode);

            if (RoomCode) {
                const VoteUsers = Array.isArray(MultiplayerState?.voteUsers?.[Index])
                    ? MultiplayerState.voteUsers[Index]
                    : [];
                const Count = Number(MultiplayerState?.votes?.[Index] || 0);

                const VoteMeta = document.createElement("span");
                VoteMeta.className = "SentenceVoteMeta";

                const VoteCount = document.createElement("span");
                VoteCount.className = "VoteCount";
                VoteCount.textContent = `${Count}/${MultiplayerState?.voteThreshold || 1}`;
                VoteMeta.appendChild(VoteCount);

                const Voters = document.createElement("span");
                Voters.className = "SentenceVoters";
                Voters.textContent = VoteUsers.length ? VoteUsers.join(", ") : "No votes yet";
                VoteMeta.appendChild(Voters);

                Content.appendChild(VoteMeta);
            }

            Button.appendChild(Content);
            Button.addEventListener("click", () => ToggleSentence(Index));
            SentenceList.appendChild(Button);
        });

        const CrossedCount = document.getElementById("CrossedCount");
        if (CrossedCount) CrossedCount.textContent = String(RemovedSentences.size);
    };

    WrappedRenderSentences.V11Wrapped = true;
    RenderSentences = WrappedRenderSentences;
}

if (typeof CheckStage === "function" && !CheckStage.V11Wrapped) {
    const BaseCheckStage = CheckStage;

    const WrappedCheckStage = async function() {
        if (!RoomCode) return BaseCheckStage();
        if (MultiplayerCheckBusyV11) return;

        const Status = document.getElementById("StatusText");
        const Button = document.getElementById("CheckButton");

        if (!MultiplayerState || MultiplayerState.hostUsername !== Profile?.username) {
            if (Status) {
                Status.className = "StatusText";
                Status.textContent = `Only ${MultiplayerState?.hostUsername || "the host"} can check survival.`;
            }
            return;
        }

        if (!MultiplayerSocket?.connected) {
            if (Status) {
                Status.className = "StatusText";
                Status.textContent = "Multiplayer is reconnecting.";
            }
            return;
        }

        MultiplayerCheckBusyV11 = true;
        if (Button) {
            Button.disabled = true;
            Button.dataset.previousText = Button.textContent;
            Button.textContent = "Checking...";
        }

        MultiplayerSocket.timeout(15000).emit("game:check", {}, (Error, Result) => {
            MultiplayerCheckBusyV11 = false;

            if (Button) {
                Button.disabled = false;
                Button.textContent = Button.dataset.previousText || "Check Team Survival";
                delete Button.dataset.previousText;
            }

            if (Error) {
                if (Status) {
                    Status.className = "StatusText";
                    Status.textContent = "The server is still checking. Wait a moment before trying again.";
                }
                return;
            }

            if (!Result?.ok && Status) {
                Status.className = "StatusText Bad";
                Status.textContent = Result?.error || "Could not check survival.";
            }
        });
    };

    WrappedCheckStage.V11Wrapped = true;
    CheckStage = WrappedCheckStage;
}

function EnsureReviveUi() {
    const Overlay = document.getElementById("GameOverOverlay");
    const Actions = Overlay?.querySelector(".OverlayActions");
    if (!Actions || document.getElementById("ReviveButton")) return;

    const Button = document.createElement("button");
    Button.id = "ReviveButton";
    Button.type = "button";
    Button.className = "PrimaryButton ReviveButton";
    Button.innerHTML = `
        <span class="ReviveIcon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M12 3v6M9 6h6"></path><path d="M5.5 11.5A7 7 0 1 0 18.5 9"></path><path d="m18.5 5.5.2 4.1-4.1.2"></path></svg>
        </span>
        <span>Revive</span>
        <span class="ReviveCount" id="ReviveCount">0</span>
    `;
    Button.addEventListener("click", UseRevive);
    Actions.prepend(Button);

    const LivesBar = document.querySelector(".Sidebar .LivesBar");
    if (LivesBar && !document.getElementById("SidebarReviveCount")) {
        const Meta = document.createElement("div");
        Meta.className = "ReviveMeta";
        Meta.innerHTML = `<span>Revives</span><strong id="SidebarReviveCount">0</strong>`;
        LivesBar.appendChild(Meta);
    }

    SyncReviveUi();
}

function GetAvailableRevives() {
    return RoomCode ? Number(MultiplayerState?.revives || 0) : Number(Save?.revives || 0);
}

function SyncReviveUi() {
    const Count = GetAvailableRevives();
    const SidebarCount = document.getElementById("SidebarReviveCount");
    const OverlayCount = document.getElementById("ReviveCount");
    const Button = document.getElementById("ReviveButton");
    const Lives = RoomCode ? Number(MultiplayerState?.lives ?? 3) : Number(Save?.lives ?? 3);
    const IsHost = !RoomCode || MultiplayerState?.hostUsername === Profile?.username;

    if (SidebarCount) SidebarCount.textContent = String(Count);
    if (OverlayCount) OverlayCount.textContent = String(Count);
    if (Button) {
        Button.disabled = Count <= 0 || Lives > 0 || !IsHost;
        Button.classList.toggle("Hidden", Count <= 0 || !IsHost);
    }
}

async function UseRevive() {
    const Button = document.getElementById("ReviveButton");
    if (!Button || Button.disabled) return;

    Button.disabled = true;
    StoryAudio?.PlaySound?.("revive");

    try {
        if (RoomCode) {
            if (!MultiplayerSocket?.connected) throw new Error("Multiplayer is reconnecting.");

            await new Promise((Resolve, Reject) => {
                MultiplayerSocket.timeout(12000).emit("game:revive", {}, (Error, Result) => {
                    if (Error) return Reject(new Error("The server did not answer in time."));
                    if (!Result?.ok) return Reject(new Error(Result?.error || "Could not use the team revive."));
                    Resolve(Result);
                });
            });
            return;
        }

        const Result = await ApiRequest("/api/revive", { method: "POST" });
        Save = NormalizeSave(Data, Result.save);
        RemovedSentences.clear();
        LastCheckFailed = false;
        document.getElementById("GameOverOverlay")?.classList.remove("Show");
        document.getElementById("Aftermath")?.classList.add("Hidden");
        StoryAudio?.PlayMusic?.(World?.theme || "menu");
        RenderStage();
    } catch (Error) {
        const Status = document.getElementById("StatusText");
        if (Status) {
            Status.className = "StatusText Bad";
            Status.textContent = Error.message;
        }
    } finally {
        SyncReviveUi();
    }
}

if (typeof RenderLives === "function" && !RenderLives.V11Wrapped) {
    const BaseRenderLives = RenderLives;
    const WrappedRenderLives = function(...Arguments) {
        const Result = BaseRenderLives(...Arguments);
        SyncReviveUi();
        return Result;
    };
    WrappedRenderLives.V11Wrapped = true;
    RenderLives = WrappedRenderLives;
}

if (typeof ApplyRoomState === "function" && !ApplyRoomState.V11Wrapped) {
    const BaseApplyRoomState = ApplyRoomState;
    const WrappedApplyRoomState = function(State) {
        const Result = BaseApplyRoomState(State);
        SyncReviveUi();
        return Result;
    };
    WrappedApplyRoomState.V11Wrapped = true;
    ApplyRoomState = WrappedApplyRoomState;
}

if (typeof HandleMultiplayerOutcome === "function" && !HandleMultiplayerOutcome.V11Wrapped) {
    const BaseHandleMultiplayerOutcome = HandleMultiplayerOutcome;
    const WrappedHandleMultiplayerOutcome = function(Result) {
        if (Result?.refilled) StoryAudio?.PlaySound?.("heartRefill");
        if (Result?.reviveEarned) StoryAudio?.PlaySound?.("reviveEarned");
        return BaseHandleMultiplayerOutcome(Result);
    };
    WrappedHandleMultiplayerOutcome.V11Wrapped = true;
    HandleMultiplayerOutcome = WrappedHandleMultiplayerOutcome;
}

if (typeof CheckServerStage === "function" && !CheckServerStage.V11Wrapped) {
    const BaseCheckServerStage = CheckServerStage;
    const WrappedCheckServerStage = async function(...Arguments) {
        const Result = await BaseCheckServerStage(...Arguments);
        if (Result?.success && Result?.refilled) StoryAudio?.PlaySound?.("heartRefill");
        if (Result?.success && Result?.reviveEarned) StoryAudio?.PlaySound?.("reviveEarned");
        return Result;
    };
    WrappedCheckServerStage.V11Wrapped = true;
    CheckServerStage = WrappedCheckServerStage;
}

function InitializeV11GameEnhancements() {
    EnsureReviveUi();
    SyncReviveUi();

    const ChatInput = document.getElementById("GameChatInput");
    if (ChatInput) {
        ChatInput.autocapitalize = "sentences";
        ChatInput.enterKeyHint = "send";
    }
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", InitializeV11GameEnhancements, { once: true });
} else {
    InitializeV11GameEnhancements();
}


const StoryPowerNamesV12 = ["reveal", "undo", "seal"];
let StoryPowerChargesV12 = { reveal: 1, undo: 1, seal: 1 };
let StoryPowerHistoryV12 = [];
let StoryPowerSealedV12 = new Set();
let StoryPowerRevealedV12 = new Set();
let StoryBranchIdV12 = "";
let StorySingleDangerEndV12 = 0;
let StorySingleDangerStageIdV12 = "";
let StoryDangerTimerV12 = null;
let StoryDangerExpiredV12 = false;

function GetStoryDangerSecondsV12(StageData = Stage) {
    const Configured = Number(StageData?.dangerSeconds);
    if (Number.isFinite(Configured) && Configured > 0) return Configured;

    const Difficulty = String(StageData?.difficulty || "").toLowerCase();
    if (/nightmare|extreme|brutal|insane/.test(Difficulty)) return 42;
    if (/hard/.test(Difficulty)) return 55;
    if (/normal|medium/.test(Difficulty)) return 70;
    return 85;
}

function GetStoryPowerChargesV12() {
    if (RoomCode) {
        const Powers = MultiplayerState?.powers || {};
        return {
            reveal: Number(Powers.reveal || 0),
            undo: Number(Powers.undo || 0),
            seal: Number(Powers.seal || 0)
        };
    }

    return StoryPowerChargesV12;
}

function IsStoryPowerHostV12() {
    return !RoomCode || MultiplayerState?.hostUsername === Profile?.username;
}

function SetStoryStatusV12(Text, Tone = "") {
    const Status = document.getElementById("StatusText");
    if (!Status) return;
    Status.className = Tone ? `StatusText ${Tone}` : "StatusText";
    Status.textContent = Text;
}

function EnsureStoryFeatureUiV12() {
    const Panel = document.getElementById("PowerPanel");
    if (Panel && !Panel.dataset.bound) {
        Panel.dataset.bound = "1";
        Panel.querySelectorAll("[data-story-power]").forEach(Button => {
            Button.addEventListener("click", () => UseStoryPowerV12(Button.dataset.storyPower));
        });
    }
}

function GetSelectedBranchIdV12() {
    const Branches = Array.isArray(Stage?.branches) ? Stage.branches : [];
    if (RoomCode) {
        const Selected = String(MultiplayerState?.branchId || "");
        return Branches.some(Branch => Branch.id === Selected) ? Selected : String(Branches[0]?.id || "");
    }

    if (!Branches.some(Branch => Branch.id === StoryBranchIdV12)) {
        StoryBranchIdV12 = String(Branches[0]?.id || "");
    }

    return StoryBranchIdV12;
}

function RenderStoryBranchUiV12() {
    const Panel = document.getElementById("BranchPanel");
    const Choices = document.getElementById("BranchChoices");
    const Branches = Array.isArray(Stage?.branches) ? Stage.branches : [];

    if (!Panel || !Choices) return;
    Panel.classList.toggle("Hidden", Branches.length < 2);
    if (Branches.length < 2) return;

    const Selected = GetSelectedBranchIdV12();
    const IsHost = IsStoryPowerHostV12();

    Choices.innerHTML = "";
    for (const Branch of Branches) {
        const Button = document.createElement("button");
        Button.type = "button";
        Button.className = `BranchChoice ${Branch.id === Selected ? "Selected" : ""}`;
        Button.disabled = RoomCode && !IsHost;
        Button.innerHTML = `<strong></strong><span></span>`;
        Button.querySelector("strong").textContent = String(Branch.label || "Route");
        Button.querySelector("span").textContent = String(Branch.description || "");
        Button.addEventListener("click", () => SelectStoryBranchV12(Branch.id));
        Choices.appendChild(Button);
    }
}

function SelectStoryBranchV12(BranchId) {
    const Branches = Array.isArray(Stage?.branches) ? Stage.branches : [];
    if (!Branches.some(Branch => Branch.id === BranchId)) return;

    if (RoomCode) {
        if (!IsStoryPowerHostV12()) {
            SetStoryStatusV12(`Only ${MultiplayerState?.hostUsername || "the host"} can choose the route.`);
            return;
        }

        MultiplayerSocket?.timeout(10000).emit("game:branch", { branchId: BranchId }, (Error, Result) => {
            if (Error) return SetStoryStatusV12("The server did not save the route in time.", "Bad");
            if (!Result?.ok) return SetStoryStatusV12(Result?.error || "Could not choose that route.", "Bad");
        });
        return;
    }

    StoryBranchIdV12 = BranchId;
    RenderStoryBranchUiV12();
    const Selected = Branches.find(Branch => Branch.id === BranchId);
    SetStoryStatusV12(`${Selected?.label || "Route"} selected. Survive this page to follow it.`);
}

function RenderTeamClueV12() {
    const Card = document.getElementById("TeamClueCard");
    const Text = document.getElementById("TeamClueText");
    if (!Card || !Text) return;

    const Clue = String(MultiplayerState?.personalClue || "");
    Card.classList.toggle("Hidden", !RoomCode || !Clue);
    if (Clue) Text.textContent = Clue;
}

function GetStoryPowerSetsV12() {
    if (RoomCode) {
        return {
            revealed: new Set(MultiplayerState?.revealedIndexes || []),
            sealed: new Set(MultiplayerState?.sealedIndexes || [])
        };
    }

    return {
        revealed: StoryPowerRevealedV12,
        sealed: StoryPowerSealedV12
    };
}

function RenderStoryPowerUiV12() {
    const Charges = GetStoryPowerChargesV12();
    const Sets = GetStoryPowerSetsV12();
    const IsHost = IsStoryPowerHostV12();

    document.querySelectorAll("[data-story-power]").forEach(Button => {
        const Name = Button.dataset.storyPower;
        const Charge = Number(Charges[Name] || 0);
        const HasSoloUndo = StoryPowerHistoryV12.length > 0;
        const HasSoloSeal = [...RemovedSentences].some(Index => !Sets.sealed.has(Index));
        const ExtraDisabled = !RoomCode && (Name === "undo" ? !HasSoloUndo : Name === "seal" ? !HasSoloSeal : false);

        Button.disabled = Charge <= 0 || !IsHost || ExtraDisabled;
        Button.dataset.charge = String(Charge);
        const Label = Button.querySelector("span");
        if (Label) Label.textContent = `${Name[0].toUpperCase()}${Name.slice(1)} · ${Charge}`;
    });

    const SentenceList = document.getElementById("SentenceList");
    if (SentenceList) {
        SentenceList.querySelectorAll(".Sentence[data-option]").forEach(Button => {
            const Index = Number(Button.dataset.option) - 1;
            Button.classList.toggle("IsRevealed", Sets.revealed.has(Index));
            Button.classList.toggle("IsSealed", Sets.sealed.has(Index));
            Button.setAttribute("aria-label", `Sentence ${Index + 1}${Sets.revealed.has(Index) ? ", revealed danger" : ""}${Sets.sealed.has(Index) ? ", sealed" : ""}`);
        });
    }
}

async function UseStoryPowerV12(Name) {
    if (!StoryPowerNamesV12.includes(Name) || !Stage) return;

    if (RoomCode) {
        if (!IsStoryPowerHostV12()) {
            SetStoryStatusV12(`Only ${MultiplayerState?.hostUsername || "the host"} can use the shared page powers.`);
            return;
        }

        MultiplayerSocket?.timeout(12000).emit("game:power", { name: Name }, (Error, Result) => {
            if (Error) return SetStoryStatusV12("The server did not answer in time.", "Bad");
            if (!Result?.ok) return SetStoryStatusV12(Result?.error || "That power cannot be used now.", "Bad");
            StoryAudio?.PlaySound?.(Name === "reveal" ? "ready" : Name === "undo" ? "restore" : "success");
        });
        return;
    }

    if (Number(StoryPowerChargesV12[Name] || 0) <= 0) return;

    if (Name === "reveal") {
        const Index = (Stage.requiredRemoved || []).find(Value => !StoryPowerRevealedV12.has(Value));
        if (!Number.isInteger(Index)) {
            SetStoryStatusV12("Every direct danger on this page has already been revealed.");
            return;
        }

        StoryPowerRevealedV12.add(Index);
        SetStoryStatusV12(`Reveal marked sentence ${Index + 1}. It creates a direct danger.`);
        StoryAudio?.PlaySound?.("ready");
    }

    if (Name === "undo") {
        const Action = StoryPowerHistoryV12.pop();
        if (!Action) {
            SetStoryStatusV12("There is no edit to undo yet.");
            return;
        }

        if (Action.wasRemoved) RemovedSentences.add(Action.index);
        else RemovedSentences.delete(Action.index);

        SetStoryStatusV12(`Undo restored your previous edit on sentence ${Action.index + 1}.`);
        StoryAudio?.PlaySound?.("restore");
    }

    if (Name === "seal") {
        const Index = [...StoryPowerHistoryV12]
            .reverse()
            .map(Action => Action.index)
            .find(Value => RemovedSentences.has(Value) && !StoryPowerSealedV12.has(Value));

        if (!Number.isInteger(Index)) {
            SetStoryStatusV12("Cross out a sentence first, then seal it.");
            return;
        }

        StoryPowerSealedV12.add(Index);
        SetStoryStatusV12(`Sentence ${Index + 1} is sealed and cannot be restored this attempt.`);
        StoryAudio?.PlaySound?.("success");
    }

    StoryPowerChargesV12[Name] -= 1;
    RenderSentences();
    RenderStoryPowerUiV12();
}

function ClearStoryDangerTimerV12() {
    if (StoryDangerTimerV12) {
        clearInterval(StoryDangerTimerV12);
        StoryDangerTimerV12 = null;
    }

    StorySingleDangerEndV12 = 0;
    document.getElementById("Book")?.classList.remove("StoryDangerActive", "StoryDangerCritical");
    document.getElementById("Illustration")?.classList.remove("StoryDangerActive", "StoryDangerCritical");
}

function GetStoryDangerEndV12() {
    if (RoomCode) return Number(MultiplayerState?.dangerEndsAt || 0);
    return StorySingleDangerEndV12;
}

function RefreshStoryDangerUiV12() {
    if (!Stage) return;

    const Value = document.getElementById("DangerTimerValue");
    const Fill = document.getElementById("DangerTimerFill");
    const End = GetStoryDangerEndV12();
    const Total = GetStoryDangerSecondsV12();

    if (!End) {
        if (Value) Value.textContent = "--:--";
        if (Fill) Fill.style.width = "0%";
        document.getElementById("Book")?.classList.remove("StoryDangerActive", "StoryDangerCritical");
        document.getElementById("Illustration")?.classList.remove("StoryDangerActive", "StoryDangerCritical");
        return;
    }

    const Remaining = Math.max(0, End - Date.now());
    const Seconds = Math.ceil(Remaining / 1000);
    const Critical = Remaining > 0 && Remaining <= Math.min(15000, Total * 250);

    if (Value) Value.textContent = `${Math.floor(Seconds / 60)}:${String(Seconds % 60).padStart(2, "0")}`;
    if (Fill) Fill.style.width = `${Math.max(0, Math.min(100, Remaining / (Total * 10)))}%`;

    document.getElementById("Book")?.classList.toggle("StoryDangerActive", Remaining > 0);
    document.getElementById("Illustration")?.classList.toggle("StoryDangerActive", Remaining > 0);
    document.getElementById("Book")?.classList.toggle("StoryDangerCritical", Critical);
    document.getElementById("Illustration")?.classList.toggle("StoryDangerCritical", Critical);

    if (!RoomCode && End > 0 && Remaining <= 0 && !StoryDangerExpiredV12) {
        ExpireSingleStoryDangerV12();
    }
}

function EnsureStoryDangerLoopV12() {
    if (StoryDangerTimerV12) return;
    StoryDangerTimerV12 = setInterval(RefreshStoryDangerUiV12, 250);
}

function StartSingleStoryDangerV12(Force = false) {
    if (RoomCode || !Stage) return;
    if (!Force && StorySingleDangerStageIdV12 === Stage.id && StorySingleDangerEndV12 > Date.now()) return;

    ClearStoryDangerTimerV12();
    StorySingleDangerStageIdV12 = Stage.id;
    StorySingleDangerEndV12 = Date.now() + GetStoryDangerSecondsV12() * 1000;
    StoryDangerExpiredV12 = false;
    RefreshStoryDangerUiV12();
    EnsureStoryDangerLoopV12();
}

async function ExpireSingleStoryDangerV12() {
    if (StoryDangerExpiredV12 || !Stage) return;

    StoryDangerExpiredV12 = true;
    ClearStoryDangerTimerV12();
    SetStoryStatusV12("The threat reached the page before the rewrite was checked.", "Bad");

    try {
        const Result = await ApiRequest("/api/stage/timeout", {
            method: "POST",
            body: JSON.stringify({ stageId: Stage.id })
        });

        Save = NormalizeSave(Data, Result.save);
        ApplyFailureOutcome(Result);
    } catch (Error) {
        SetStoryStatusV12(Error.message, "Bad");
    }
}

if (typeof ToggleSentence === "function" && !ToggleSentence.V12Wrapped) {
    const BaseToggleSentenceV12 = ToggleSentence;
    const WrappedToggleSentenceV12 = function(Index) {
        const Sets = GetStoryPowerSetsV12();
        if (Sets.sealed.has(Index)) {
            SetStoryStatusV12(`Sentence ${Index + 1} is sealed for this attempt.`);
            return;
        }

        if (!RoomCode) {
            const WasRemoved = RemovedSentences.has(Index);
            const Result = BaseToggleSentenceV12(Index);
            if (RemovedSentences.has(Index) !== WasRemoved) StoryPowerHistoryV12.push({ index: Index, wasRemoved: WasRemoved });
            RenderStoryPowerUiV12();
            return Result;
        }

        return BaseToggleSentenceV12(Index);
    };
    WrappedToggleSentenceV12.V12Wrapped = true;
    ToggleSentence = WrappedToggleSentenceV12;
}

if (typeof RenderSentences === "function" && !RenderSentences.V12Wrapped) {
    const BaseRenderSentencesV12 = RenderSentences;
    const WrappedRenderSentencesV12 = function(...Arguments) {
        const Result = BaseRenderSentencesV12(...Arguments);
        RenderStoryPowerUiV12();
        return Result;
    };
    WrappedRenderSentencesV12.V12Wrapped = true;
    RenderSentences = WrappedRenderSentencesV12;
}

if (typeof RenderStage === "function" && !RenderStage.V12Wrapped) {
    const BaseRenderStageV12 = RenderStage;
    const WrappedRenderStageV12 = function(...Arguments) {
        const Result = BaseRenderStageV12(...Arguments);
        EnsureStoryFeatureUiV12();
        RenderStoryBranchUiV12();
        RenderTeamClueV12();
        RenderStoryPowerUiV12();

        if (RoomCode) {
            RefreshStoryDangerUiV12();
            EnsureStoryDangerLoopV12();
        } else StartSingleStoryDangerV12();

        return Result;
    };
    WrappedRenderStageV12.V12Wrapped = true;
    RenderStage = WrappedRenderStageV12;
}

if (typeof ApplyRoomState === "function" && !ApplyRoomState.V12Wrapped) {
    const BaseApplyRoomStateV12 = ApplyRoomState;
    const WrappedApplyRoomStateV12 = function(State) {
        const Result = BaseApplyRoomStateV12(State);
        RenderStoryBranchUiV12();
        RenderTeamClueV12();
        RenderStoryPowerUiV12();
        RefreshStoryDangerUiV12();
        EnsureStoryDangerLoopV12();
        return Result;
    };
    WrappedApplyRoomStateV12.V12Wrapped = true;
    ApplyRoomState = WrappedApplyRoomStateV12;
}

if (typeof CheckServerStage === "function" && !CheckServerStage.V12Wrapped) {
    const BaseCheckServerStageV12 = CheckServerStage;
    const WrappedCheckServerStageV12 = async function(StageId, RemovedIndexes, BranchId = GetSelectedBranchIdV12()) {
        const Result = await BaseCheckServerStageV12(StageId, RemovedIndexes, BranchId);

        if (Result?.success) ClearStoryDangerTimerV12();
        else if (!StoryDangerExpiredV12 && !Result?.gameOver) StartSingleStoryDangerV12(true);

        return Result;
    };
    WrappedCheckServerStageV12.V12Wrapped = true;
    CheckServerStage = WrappedCheckServerStageV12;
}

if (typeof HandleMultiplayerOutcome === "function" && !HandleMultiplayerOutcome.V12Wrapped) {
    const BaseHandleMultiplayerOutcomeV12 = HandleMultiplayerOutcome;
    const WrappedHandleMultiplayerOutcomeV12 = function(Result) {
        if (Result?.success) ClearStoryDangerTimerV12();
        if (Result?.success && Result?.cosmeticUnlocked?.name) {
            SetStoryStatusV12(`${Result.cosmeticUnlocked.name} was added to every survivor's account.`, "Good");
        }

        return BaseHandleMultiplayerOutcomeV12(Result);
    };
    WrappedHandleMultiplayerOutcomeV12.V12Wrapped = true;
    HandleMultiplayerOutcome = WrappedHandleMultiplayerOutcomeV12;
}

function InitializeV12GameEnhancements() {
    EnsureStoryFeatureUiV12();
    RenderStoryBranchUiV12();
    RenderTeamClueV12();
    RenderStoryPowerUiV12();
    if (Stage) {
        if (RoomCode) RefreshStoryDangerUiV12();
        else StartSingleStoryDangerV12();
    }
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", InitializeV12GameEnhancements, { once: true });
} else {
    InitializeV12GameEnhancements();
}
