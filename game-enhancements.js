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
                <path class="ThreatTeeth" d="M58 102h44M66 108v8M80 110v9M94 108v8"></path>
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
