const fs = require("fs");
const path = require("path");
const Module = require("module");

const WrapperPath = path.join(__dirname, "server-v10.js");
let WrapperSource = fs.readFileSync(WrapperPath, "utf8");

function ReplaceWrapperRequired(Search, Replacement, Label) {
    if (!WrapperSource.includes(Search)) {
        throw new Error(`server-v11 patch failed: ${Label}`);
    }
    WrapperSource = WrapperSource.replace(Search, Replacement);
}

ReplaceWrapperRequired(
    '"const BackendVersion = 10;"',
    '"const BackendVersion = 11;"',
    "backend version"
);

const V11ConstantsSearch = `const StoryBotContextMessages = 12;`;
const V11ConstantsReplacement = `const StoryBotContextMessages = 12;
const ChatSafetyModel = String(process.env.OPENAI_CHAT_FILTER_MODEL || OpenAIModel).trim();
const ChatSafetyTimeout = 15000;
const MaxRevives = 3;
const ReviveEarnEvery = 5;`;

const OldCensorFunction = `function CensorChatText(Value) {
    let Text = String(Value || "")
        .replace(/[\\u0000-\\u001F\\u007F]/g, " ")
        .replace(/\\s+/g, " ")
        .trim()
        .slice(0, ChatMaxLength);

    for (const Word of ProfanityWords) {
        const Pattern = new RegExp("\\\\b" + Word + "\\\\b", "gi");
        Text = Text.replace(Pattern, Match => "*".repeat(Math.min(Match.length, 12)));
    }

    return Text;
}`;

const NewNormalizeFunction = `function NormalizeChatText(Value) {
    return String(Value || "")
        .replace(/[\\u0000-\\u001F\\u007F]/g, " ")
        .replace(/\\s+/g, " ")
        .trim()
        .slice(0, ChatMaxLength);
}`;

const SaveDefaultsSearch = `        deaths: 0,
        settings: {`;
const SaveDefaultsReplacement = `        deaths: 0,
        revives: 1,
        winsSinceRevive: 0,
        winsSinceHeartRefresh: 0,
        stageHeartsLost: 0,
        settings: {`;

const NormalizeSaveSearch = `    if (!Number.isInteger(Save.deaths)) Save.deaths = 0;
    if (!Save.settings || typeof Save.settings !== "object") Save.settings = { ...Base.settings };`;
const NormalizeSaveReplacement = `    if (!Number.isInteger(Save.deaths)) Save.deaths = 0;
    if (!Number.isInteger(Save.revives)) Save.revives = 1;
    if (!Number.isInteger(Save.winsSinceRevive)) Save.winsSinceRevive = 0;
    if (!Number.isInteger(Save.winsSinceHeartRefresh)) Save.winsSinceHeartRefresh = 0;
    if (!Number.isInteger(Save.stageHeartsLost)) Save.stageHeartsLost = 0;
    Save.revives = Math.max(0, Math.min(MaxRevives, Save.revives));
    Save.winsSinceRevive = Math.max(0, Save.winsSinceRevive);
    Save.winsSinceHeartRefresh = Math.max(0, Save.winsSinceHeartRefresh);
    Save.stageHeartsLost = Math.max(0, Save.stageHeartsLost);
    if (!Save.settings || typeof Save.settings !== "object") Save.settings = { ...Base.settings };`;

const RestartChapterSearch = `    Save.currentStage = World.entryStage;
    Save.lives = Save.maxLives;
    Account.save = Save;`;
const RestartChapterReplacement = `    Save.currentStage = World.entryStage;
    Save.lives = Save.maxLives;
    Save.stageHeartsLost = 0;
    Account.save = Save;`;

const ApplyFailureSearch = `    Save.lives = Math.max(0, Save.lives - 1);
    Save.deaths += 1;
    Account.save = Save;`;
const ApplyFailureReplacement = `    Save.lives = Math.max(0, Save.lives - 1);
    Save.deaths += 1;
    Save.stageHeartsLost += 1;
    Account.save = Save;`;

const OldApplySuccessFunction = `function ApplySuccessToAccount(Account, StageId, Stars) {
    const Save = NormalizeSave(Account.save);
    const Stage = StagesData.stages[StageId];
    Save.stars[StageId] = Math.max(Number(Save.stars[StageId] || 0), Stars);
    if (Stage.nextStage) {
        UnlockStage(Save, Stage.nextStage);
        Save.currentStage = Stage.nextStage;
    } else {
        Save.currentStage = StageId;
    }
    if (Stage.isChapterEnd) Save.lives = Save.maxLives;
    Account.save = Save;
}`;

const NewApplySuccessFunction = `function ApplySuccessToAccount(Account, StageId, Stars) {
    const Save = NormalizeSave(Account.save);
    const Stage = StagesData.stages[StageId];
    Save.stars[StageId] = Math.max(Number(Save.stars[StageId] || 0), Stars);

    Save.winsSinceHeartRefresh += 1;
    Save.winsSinceRevive += 1;

    const RefreshWins = GetHeartRefreshWins(Stage?.difficulty);
    let Refilled = false;
    let ReviveEarned = false;

    if (Save.winsSinceHeartRefresh >= RefreshWins) {
        Save.winsSinceHeartRefresh = 0;
        Save.lives = Save.maxLives;
        Refilled = true;
    }

    if (Save.winsSinceRevive >= ReviveEarnEvery) {
        Save.winsSinceRevive = 0;
        if (Save.revives < MaxRevives) {
            Save.revives += 1;
            ReviveEarned = true;
        }
    }

    if (Stage.nextStage) {
        UnlockStage(Save, Stage.nextStage);
        Save.currentStage = Stage.nextStage;
    } else {
        Save.currentStage = StageId;
    }

    if (Stage.isChapterEnd) {
        Save.lives = Save.maxLives;
        Save.winsSinceHeartRefresh = 0;
        Refilled = true;
    }

    Save.stageHeartsLost = 0;
    Account.save = Save;

    return {
        save: Save,
        refilled: Refilled,
        reviveEarned: ReviveEarned,
        refreshWins: RefreshWins
    };
}`;

const StageEnterSearch = `        Account.save.currentStage = Stage.id;
        await SaveAccount(Account);`;
const StageEnterReplacement = `        if (Account.save.currentStage !== Stage.id) Account.save.stageHeartsLost = 0;
        Account.save.currentStage = Stage.id;
        await SaveAccount(Account);`;

const SingleSuccessSearch = `        ApplySuccessToAccount(Account, Stage.id, Result.stars);
        await SaveAccount(Account);
        return SendJson(Response, 200, {
            success: true,
            stars: Result.stars,
            nextStage: Stage.nextStage,
            isChapterEnd: Stage.isChapterEnd,
            lives: Account.save.lives,
            maxLives: Account.save.maxLives,
            save: Account.save
        }, Origin);`;

const SingleSuccessReplacement = `        const Stars = ComputeHeartStars(Account.save.stageHeartsLost);
        const Progress = ApplySuccessToAccount(Account, Stage.id, Stars);
        await SaveAccount(Account);
        return SendJson(Response, 200, {
            success: true,
            stars: Stars,
            nextStage: Stage.nextStage,
            isChapterEnd: Stage.isChapterEnd,
            lives: Account.save.lives,
            maxLives: Account.save.maxLives,
            revives: Account.save.revives,
            refilled: Progress.refilled,
            reviveEarned: Progress.reviveEarned,
            refreshWins: Progress.refreshWins,
            save: Account.save
        }, Origin);`;

const SettingsRouteSearch = `    if (RequestPath === "/api/settings" && Request.method === "POST") {`;
const ReviveRouteReplacement = `    if (RequestPath === "/api/revive" && Request.method === "POST") {
        if (Account.save.lives > 0) return SendJson(Response, 409, { error: "A revive can only be used when no hearts remain." }, Origin);
        if (Account.save.revives <= 0) return SendJson(Response, 409, { error: "No revives are available." }, Origin);

        Account.save.revives -= 1;
        Account.save.lives = 1;
        await SaveAccount(Account);

        return SendJson(Response, 200, {
            ok: true,
            lives: Account.save.lives,
            maxLives: Account.save.maxLives,
            revives: Account.save.revives,
            save: Account.save
        }, Origin);
    }

    if (RequestPath === "/api/settings" && Request.method === "POST") {`;

const RoomStateSearch = `        botBusy: false,
        lastBotAt: 0`;
const RoomStateReplacement = `        botBusy: false,
        lastBotAt: 0,
        checkBusy: false,
        stageHeartsLost: 0,
        winsSinceHeartRefresh: 0,
        winsSinceRevive: 0,
        revives: 1`;

const VoteStateInitSearch = `    const Votes = {};
    const SelectedIndexes = [];`;
const VoteStateInitReplacement = `    const Votes = {};
    const VoteUsers = {};
    const SelectedIndexes = [];`;

const VoteStateCountSearch = `        Votes[Index] = Count;
        if (Count >= Threshold) SelectedIndexes.push(Number(Index));`;
const VoteStateCountReplacement = `        Votes[Index] = Count;
        VoteUsers[Index] = [...Usernames].filter(Username => ActiveNames.has(Username));
        if (Count >= Threshold) SelectedIndexes.push(Number(Index));`;

const VoteStateReturnSearch = `    return { votes: Votes, selectedIndexes: SelectedIndexes, threshold: Threshold };`;
const VoteStateReturnReplacement = `    return { votes: Votes, voteUsers: VoteUsers, selectedIndexes: SelectedIndexes, threshold: Threshold };`;

const BuildRoomStateSearch = `        votes: VoteState.votes,
        voteThreshold: VoteState.threshold,
        lastOutcome: Room.lastOutcome`;
const BuildRoomStateReplacement = `        votes: VoteState.votes,
        voteUsers: VoteState.voteUsers,
        voteThreshold: VoteState.threshold,
        revives: Room.revives,
        stageHeartsLost: Room.stageHeartsLost,
        winsSinceHeartRefresh: Room.winsSinceHeartRefresh,
        winsSinceRevive: Room.winsSinceRevive,
        lastOutcome: Room.lastOutcome`;

const RoomStartSearch = `            Room.lastOutcome = null;
            Room.lives = MaxLives;`;
const RoomStartReplacement = `            Room.lastOutcome = null;
            Room.lives = MaxLives;
            Room.stageHeartsLost = 0;
            Room.checkBusy = false;`;

const OldVoteHandler = `    Socket.on("game:vote", Payload => {
        const Room = GetRoomForSocket(Socket);
        if (!Room || Room.status !== "playing") return;
        const Stage = StagesData.stages[Room.stageId];
        const Index = Number(Payload?.index);
        if (!Stage || !Number.isInteger(Index) || Index < 0 || Index >= Stage.sentences.length) return;
        if (!Room.votes.has(Index)) Room.votes.set(Index, new Set());
        const Votes = Room.votes.get(Index);
        if (Votes.has(Socket.data.username)) Votes.delete(Socket.data.username);
        else Votes.add(Socket.data.username);
        if (Votes.size === 0) Room.votes.delete(Index);
        EmitRoom(Room);
    });`;

const NewVoteHandler = `    Socket.on("game:vote", Payload => {
        const Room = GetRoomForSocket(Socket);
        if (!Room || Room.status !== "playing") return;
        const Stage = StagesData.stages[Room.stageId];
        const Index = Number(Payload?.index);
        if (!Stage || !Number.isInteger(Index) || Index < 0 || Index >= Stage.sentences.length) return;
        ToggleRoomVote(Room, Socket, Index, true);
    });`;

const OldGameCheckHandler = `    Socket.on("game:check", async (Payload, Reply = () => {}) => {
        try {
            const Room = GetRoomForSocket(Socket);
            if (!Room || Room.status !== "playing") return Reply({ ok: false, error: "Game is not active." });
            if (Room.hostSocketId !== Socket.id) return Reply({ ok: false, error: "Only the host can check survival." });

            const Result = ValidateStageResult(Room.stageId, GetVoteState(Room).selectedIndexes);
            const Stage = StagesData.stages[Room.stageId];

            if (!Result.success) {
                Room.lives = Math.max(0, Room.lives - 1);
                Room.lastOutcome = {
                    success: false,
                    reason: Result.reason,
                    aftermath: Result.aftermath,
                    lives: Room.lives,
                    maxLives: Room.maxLives,
                    gameOver: Room.lives <= 0
                };
                if (Room.lives <= 0) Room.status = "gameover";
                Io.to(Room.code).emit("game:outcome", Room.lastOutcome);
                EmitRoom(Room);
                return Reply({ ok: true });
            }

            const Accounts = [];
            for (const Username of Room.memberNames) {
                const MemberAccount = await GetAccountByUsername(Username);
                if (!MemberAccount) continue;
                ApplySuccessToAccount(MemberAccount, Stage.id, Result.stars);
                Accounts.push(MemberAccount);
            }
            await SaveAccounts(Accounts);

            Room.lastOutcome = {
                success: true,
                stars: Result.stars,
                nextStage: Stage.nextStage,
                isChapterEnd: Stage.isChapterEnd,
                lives: Room.lives,
                maxLives: Room.maxLives
            };
            Io.to(Room.code).emit("game:outcome", Room.lastOutcome);
            EmitRoom(Room);
            Reply({ ok: true });
        } catch (Error) {
            console.error("Multiplayer result save failed", Error);
            Reply({ ok: false, error: "Could not save the multiplayer result." });
        }
    });`;

const NewGameCheckHandler = `    Socket.on("game:check", async (Payload, Reply = () => {}) => {
        const Room = GetRoomForSocket(Socket);
        if (!Room || Room.status !== "playing") return Reply({ ok: false, error: "Game is not active." });
        if (Room.hostSocketId !== Socket.id) return Reply({ ok: false, error: "Only the host can check survival." });
        if (Room.checkBusy) return Reply({ ok: false, error: "A survival check is already running." });

        Room.checkBusy = true;

        try {
            const Result = ValidateStageResult(Room.stageId, GetVoteState(Room).selectedIndexes);
            const Stage = StagesData.stages[Room.stageId];

            if (!Result.success) {
                Room.lives = Math.max(0, Room.lives - 1);
                Room.stageHeartsLost += 1;
                Room.lastOutcome = {
                    success: false,
                    reason: Result.reason,
                    aftermath: Result.aftermath,
                    lives: Room.lives,
                    maxLives: Room.maxLives,
                    revives: Room.revives,
                    gameOver: Room.lives <= 0
                };
                if (Room.lives <= 0) Room.status = "gameover";
                Io.to(Room.code).emit("game:outcome", Room.lastOutcome);
                EmitRoom(Room);
                return Reply({ ok: true });
            }

            const Stars = ComputeHeartStars(Room.stageHeartsLost);
            Room.winsSinceHeartRefresh += 1;
            Room.winsSinceRevive += 1;

            const RefreshWins = GetHeartRefreshWins(Stage?.difficulty);
            let Refilled = false;
            let ReviveEarned = false;

            if (Room.winsSinceHeartRefresh >= RefreshWins) {
                Room.winsSinceHeartRefresh = 0;
                Room.lives = Room.maxLives;
                Refilled = true;
            }

            if (Room.winsSinceRevive >= ReviveEarnEvery) {
                Room.winsSinceRevive = 0;
                if (Room.revives < MaxRevives) {
                    Room.revives += 1;
                    ReviveEarned = true;
                }
            }

            const Accounts = [];
            for (const Username of Room.memberNames) {
                const MemberAccount = await GetAccountByUsername(Username);
                if (!MemberAccount) continue;
                ApplySuccessToAccount(MemberAccount, Stage.id, Stars);
                Accounts.push(MemberAccount);
            }
            await SaveAccounts(Accounts);

            Room.lastOutcome = {
                success: true,
                stars: Stars,
                nextStage: Stage.nextStage,
                isChapterEnd: Stage.isChapterEnd,
                lives: Room.lives,
                maxLives: Room.maxLives,
                revives: Room.revives,
                refilled: Refilled,
                reviveEarned: ReviveEarned,
                refreshWins: RefreshWins
            };
            Io.to(Room.code).emit("game:outcome", Room.lastOutcome);
            EmitRoom(Room);
            Reply({ ok: true });
        } catch (Error) {
            console.error("Multiplayer result save failed", Error);
            Reply({ ok: false, error: "Could not save the multiplayer result." });
        } finally {
            Room.checkBusy = false;
        }
    });`;

const GameNextSearch = `        Room.stageId = Stage.nextStage;
        Room.votes.clear();
        Room.lastOutcome = null;
        Room.status = "playing";
        if (Stage.isChapterEnd) Room.lives = Room.maxLives;`;
const GameNextReplacement = `        Room.stageId = Stage.nextStage;
        Room.votes.clear();
        Room.lastOutcome = null;
        Room.status = "playing";
        Room.stageHeartsLost = 0;
        if (Stage.isChapterEnd) {
            Room.lives = Room.maxLives;
            Room.winsSinceHeartRefresh = 0;
        }`;

const RestartGameSearch = `            Room.stageId = World.entryStage;
            Room.lives = Room.maxLives;
            Room.votes.clear();`;
const RestartGameReplacement = `            Room.stageId = World.entryStage;
            Room.lives = Room.maxLives;
            Room.stageHeartsLost = 0;
            Room.votes.clear();`;

const GameRestartHandlerSearch = `    Socket.on("game:restartChapter", async () => {`;
const ReviveHandlerReplacement = `    Socket.on("game:revive", (Payload, Reply = () => {}) => {
        const Room = GetRoomForSocket(Socket);
        if (!Room) return Reply({ ok: false, error: "Room missing." });
        if (Room.hostSocketId !== Socket.id) return Reply({ ok: false, error: "Only the host can use a team revive." });
        if (Room.lives > 0 || Room.status !== "gameover") return Reply({ ok: false, error: "A revive is only needed after the team loses all hearts." });
        if (Room.revives <= 0) return Reply({ ok: false, error: "The team has no revives." });

        Room.revives -= 1;
        Room.lives = 1;
        Room.votes.clear();
        Room.lastOutcome = null;
        Room.status = "playing";
        EmitRoom(Room);
        Io.to(Room.code).emit("game:retry", { revived: true, revives: Room.revives });
        Reply({ ok: true, lives: Room.lives, revives: Room.revives });
    });

    Socket.on("game:restartChapter", async () => {`;

const OldChatHandlerPrefix = `    Socket.on("room:chat", Payload => {
        const Room = GetRoomForSocket(Socket);
        if (!Room) return;
        if (Room.chatBannedNames.has(Socket.data.username)) {
            Socket.emit("room:chatError", { error: "The host has disabled your room chat." });
            return;
        }
        if (!Payload || typeof Payload !== "object" || Array.isArray(Payload)) return;

        const Text = CensorChatText(Payload.text);
        if (!Text) return;
        if (Text.length > ChatMaxLength) {
            Socket.emit("room:chatError", { error: \`Messages are limited to \${ChatMaxLength} characters.\` });
            return;
        }
        if (!AllowChatMessage(Socket)) return;

        const Message = { username: Socket.data.username, text: Text, sentAt: Date.now() };
        Room.messages.push(Message);
        Room.messages = Room.messages.slice(-ChatHistoryLimit);
        Io.to(Room.code).emit("room:chat", Message);
        MaybeReplyAsStoryBot(Room, Socket, Message).catch(Error => {
            console.error("StoryBot background failure", Error);
        });
    });`;

const NewChatHandlerPrefix = `    Socket.on("room:chat", async Payload => {
        const Room = GetRoomForSocket(Socket);
        if (!Room) return;
        if (Room.chatBannedNames.has(Socket.data.username)) {
            Socket.emit("room:chatError", { error: "The host has disabled your room chat." });
            return;
        }
        if (!Payload || typeof Payload !== "object" || Array.isArray(Payload)) return;

        const RawText = NormalizeChatText(Payload.text);
        if (!RawText) return;
        if (RawText.length > ChatMaxLength) {
            Socket.emit("room:chatError", { error: \`Messages are limited to \${ChatMaxLength} characters.\` });
            return;
        }
        if (!AllowChatMessage(Socket)) return;

        const Stage = StagesData.stages[Room.stageId];
        const VoteOption = ParseVoteOption(RawText, Stage);
        if (VoteOption !== null && Room.status === "playing") {
            ToggleRoomVote(Room, Socket, VoteOption, true);
            return;
        }

        if (Socket.data.chatFilterBusy) {
            Socket.emit("room:chatError", { error: "Your previous message is still being checked." });
            return;
        }

        Socket.data.chatFilterBusy = true;

        try {
            const Text = await SanitizeChatMessage(RawText);
            if (!Text) return;

            const Message = { username: Socket.data.username, text: Text, sentAt: Date.now() };
            Room.messages.push(Message);
            Room.messages = Room.messages.slice(-ChatHistoryLimit);
            Io.to(Room.code).emit("room:chat", Message);
            MaybeReplyAsStoryBot(Room, Socket, Message).catch(Error => {
                console.error("StoryBot background failure", Error);
            });
        } catch (Error) {
            console.error("Chat safety failed", Error);
            Socket.emit("room:chatError", {
                error: Error?.name === "AbortError"
                    ? "Chat safety took too long. Try again."
                    : "Chat safety is temporarily unavailable."
            });
        } finally {
            Socket.data.chatFilterBusy = false;
        }
    });`;

const AIHelpersV11 = `function ReadResponseOutputText(ResponseData) {
    if (typeof ResponseData?.output_text === "string") return ResponseData.output_text.trim();

    const Parts = [];
    for (const Item of Array.isArray(ResponseData?.output) ? ResponseData.output : []) {
        for (const Content of Array.isArray(Item?.content) ? Item.content : []) {
            if (Content?.type === "output_text" && typeof Content.text === "string") Parts.push(Content.text);
        }
    }
    return Parts.join(" ").trim();
}

async function SanitizeChatMessage(Value) {
    const InputText = NormalizeChatText(Value);
    if (!InputText) return "";
    if (!OpenAIApiKey) throw new Error("CHAT_SAFETY_UNAVAILABLE");

    const Controller = new AbortController();
    const Timeout = setTimeout(() => Controller.abort(), ChatSafetyTimeout);

    try {
        const ApiResponse = await fetch("https://api.openai.com/v1/responses", {
            method: "POST",
            headers: {
                "Authorization": "Bearer " + OpenAIApiKey,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: ChatSafetyModel,
                store: false,
                instructions: "You are a multiplayer game chat sanitizer. Return only the sanitized message, no quotes and no explanation. Preserve harmless meaning, usernames, @StoryBot mentions, numbers, room discussion, and vote commands. Replace profanity, slurs, explicit sexual wording, abusive insults, threats, and harmful wording with [censored]. Detect obfuscation such as spaced-out letters, punctuation between letters, repeated characters, and leetspeak. Do not censor ordinary harmless horror-game words just because the fictional game contains danger.",
                input: InputText,
                max_output_tokens: 120
            }),
            signal: Controller.signal
        });

        const ResponseData = await ApiResponse.json().catch(() => ({}));
        if (!ApiResponse.ok) throw new Error(ResponseData?.error?.message || "Chat safety request failed.");

        return NormalizeChatText(ReadResponseOutputText(ResponseData));
    } finally {
        clearTimeout(Timeout);
    }
}

function GetHeartRefreshWins(Difficulty) {
    const Value = String(Difficulty || "").toLowerCase();
    if (/nightmare|extreme|brutal|insane/.test(Value)) return 2;
    if (/hard/.test(Value)) return 3;
    if (/normal|medium/.test(Value)) return 4;
    return 5;
}

function ComputeHeartStars(HeartsLost) {
    return Math.max(0, Math.min(3, 3 - Math.max(0, Number(HeartsLost || 0))));
}

function ParseVoteOption(Text, Stage) {
    if (!Stage || !Array.isArray(Stage.sentences)) return null;
    const Match = String(Text || "").trim().match(/^(?:#|\\/vote\\s*)?(\\d{1,2})$/i);
    if (!Match) return null;
    const Index = Number(Match[1]) - 1;
    return Number.isInteger(Index) && Index >= 0 && Index < Stage.sentences.length ? Index : null;
}

function PushRoomMessage(Room, Message) {
    Room.messages.push(Message);
    Room.messages = Room.messages.slice(-ChatHistoryLimit);
    Io.to(Room.code).emit("room:chat", Message);
}

function ToggleRoomVote(Room, Socket, Index, Announce = false) {
    if (!Room.votes.has(Index)) Room.votes.set(Index, new Set());
    const Votes = Room.votes.get(Index);
    const Username = Socket.data.username;
    const WasSelected = Votes.has(Username);

    if (WasSelected) Votes.delete(Username);
    else Votes.add(Username);

    if (Votes.size === 0) Room.votes.delete(Index);

    if (Announce) {
        PushRoomMessage(Room, {
            username: Username,
            text: WasSelected ? \`removed their vote from option \${Index + 1}.\` : \`chose option \${Index + 1}.\`,
            sentAt: Date.now(),
            system: true,
            vote: true,
            option: Index + 1
        });
    }

    EmitRoom(Room);
}`;

const StoryBotCensorReturnSearch = `        return CensorChatText(Reply);`;
const StoryBotCensorReturnReplacement = `        return NormalizeChatText(Reply);`;

const V11PatchCode = [
    `ReplaceRequired(${JSON.stringify(V11ConstantsSearch)}, ${JSON.stringify(V11ConstantsReplacement)}, "v11 constants");`,
    `Source = Source.replace(/const ProfanityWords = \\[\\s\\S]*?\\];\\n/, "");`,
    `ReplaceRequired(${JSON.stringify(OldCensorFunction)}, ${JSON.stringify(NewNormalizeFunction)}, "replace hardcoded censor");`,
    `ReplaceRequired(${JSON.stringify(SaveDefaultsSearch)}, ${JSON.stringify(SaveDefaultsReplacement)}, "save defaults");`,
    `ReplaceRequired(${JSON.stringify(NormalizeSaveSearch)}, ${JSON.stringify(NormalizeSaveReplacement)}, "normalize save progression");`,
    `ReplaceRequired(${JSON.stringify(RestartChapterSearch)}, ${JSON.stringify(RestartChapterReplacement)}, "restart hearts lost");`,
    `ReplaceRequired(${JSON.stringify(ApplyFailureSearch)}, ${JSON.stringify(ApplyFailureReplacement)}, "track hearts lost");`,
    `ReplaceRequired(${JSON.stringify(OldApplySuccessFunction)}, ${JSON.stringify(NewApplySuccessFunction)}, "heart based stars and rewards");`,
    `ReplaceRequired(${JSON.stringify(StageEnterSearch)}, ${JSON.stringify(StageEnterReplacement)}, "stage attempt state");`,
    `ReplaceRequired(${JSON.stringify(SingleSuccessSearch)}, ${JSON.stringify(SingleSuccessReplacement)}, "single player star rewards");`,
    `ReplaceRequired(${JSON.stringify(SettingsRouteSearch)}, ${JSON.stringify(ReviveRouteReplacement)}, "single player revive route");`,
    `ReplaceRequired(${JSON.stringify(RoomStateSearch)}, ${JSON.stringify(RoomStateReplacement)}, "room reward state");`,
    `ReplaceRequired(${JSON.stringify(VoteStateInitSearch)}, ${JSON.stringify(VoteStateInitReplacement)}, "vote user state init");`,
    `ReplaceRequired(${JSON.stringify(VoteStateCountSearch)}, ${JSON.stringify(VoteStateCountReplacement)}, "vote usernames");`,
    `ReplaceRequired(${JSON.stringify(VoteStateReturnSearch)}, ${JSON.stringify(VoteStateReturnReplacement)}, "vote state return");`,
    `ReplaceRequired(${JSON.stringify(BuildRoomStateSearch)}, ${JSON.stringify(BuildRoomStateReplacement)}, "public room rewards and voters");`,
    `ReplaceRequired(${JSON.stringify(RoomStartSearch)}, ${JSON.stringify(RoomStartReplacement)}, "fresh room hearts");`,
    `ReplaceRequired(${JSON.stringify(OldVoteHandler)}, ${JSON.stringify(NewVoteHandler)}, "numbered vote handler");`,
    `ReplaceRequired(${JSON.stringify(OldGameCheckHandler)}, ${JSON.stringify(NewGameCheckHandler)}, "atomic multiplayer check");`,
    `ReplaceRequired(${JSON.stringify(GameNextSearch)}, ${JSON.stringify(GameNextReplacement)}, "next stage heart tracking");`,
    `ReplaceRequired(${JSON.stringify(RestartGameSearch)}, ${JSON.stringify(RestartGameReplacement)}, "restart stage heart tracking");`,
    `ReplaceRequired(${JSON.stringify(GameRestartHandlerSearch)}, ${JSON.stringify(ReviveHandlerReplacement)}, "team revive handler");`,
    `ReplaceRequired(${JSON.stringify(OldChatHandlerPrefix)}, ${JSON.stringify(NewChatHandlerPrefix)}, "AI chat safety and vote commands");`,
    `ReplaceRequired(${JSON.stringify("function EmitRoom(Room) {")}, ${JSON.stringify(AIHelpersV11 + "\n\nfunction EmitRoom(Room) {")}, "v11 gameplay helpers");`,
    `ReplaceRequired(${JSON.stringify(StoryBotCensorReturnSearch)}, ${JSON.stringify(StoryBotCensorReturnReplacement)}, "StoryBot normalization");`
].join("\n\n");

const V12PatchCode = "ReplaceRequired(\"const BackendVersion = 11;\", \"const BackendVersion = 12;\", \"v12 backend version\");\n\nReplaceRequired(\"function DefaultSave() {\\n    const FirstWorld = StagesData.worlds[0];\\n    return {\\n        version: 6,\\n        unlockedWorlds: [FirstWorld.id],\\n        unlockedStages: [FirstWorld.entryStage],\\n        stars: {},\\n        currentStage: FirstWorld.entryStage,\\n        lives: MaxLives,\\n        maxLives: MaxLives,\\n        deaths: 0,\\n        revives: 1,\\n        winsSinceRevive: 0,\\n        winsSinceHeartRefresh: 0,\\n        stageHeartsLost: 0,\\n        settings: {\\n            musicVolume: 0.45,\\n            soundVolume: 0.75\\n        }\\n    };\\n}\", \"function DefaultSave() {\\n    const FirstWorld = StagesData.worlds[0];\\n    return {\\n        version: 6,\\n        unlockedWorlds: [FirstWorld.id],\\n        unlockedStages: [FirstWorld.entryStage],\\n        stars: {},\\n        currentStage: FirstWorld.entryStage,\\n        lives: MaxLives,\\n        maxLives: MaxLives,\\n        deaths: 0,\\n        revives: 1,\\n        winsSinceRevive: 0,\\n        winsSinceHeartRefresh: 0,\\n        stageHeartsLost: 0,\\n        cosmetics: {\\n            unlocked: [],\\n            equipped: \\\"classic\\\"\\n        },\\n        settings: {\\n            musicVolume: 0.45,\\n            soundVolume: 0.75\\n        }\\n    };\\n}\", \"v12 cosmetic defaults\");\n\nReplaceRequired(\"function NormalizeSave(Value) {\\n    const Base = DefaultSave();\\n    const Save = Value && typeof Value === \\\"object\\\" && !Array.isArray(Value)\\n        ? Clone(Value)\\n        : Clone(Base);\\n\\n    Save.version = 6;\\n    if (!Array.isArray(Save.unlockedWorlds)) Save.unlockedWorlds = [...Base.unlockedWorlds];\\n    if (!Array.isArray(Save.unlockedStages)) Save.unlockedStages = [...Base.unlockedStages];\\n    if (!Save.stars || typeof Save.stars !== \\\"object\\\" || Array.isArray(Save.stars)) Save.stars = {};\\n    if (!StagesData.stages[Save.currentStage]) Save.currentStage = Base.currentStage;\\n    if (!Number.isInteger(Save.lives)) Save.lives = MaxLives;\\n    if (!Number.isInteger(Save.maxLives)) Save.maxLives = MaxLives;\\n    if (!Number.isInteger(Save.deaths)) Save.deaths = 0;\\n    if (!Number.isInteger(Save.revives)) Save.revives = 1;\\n    if (!Number.isInteger(Save.winsSinceRevive)) Save.winsSinceRevive = 0;\\n    if (!Number.isInteger(Save.winsSinceHeartRefresh)) Save.winsSinceHeartRefresh = 0;\\n    if (!Number.isInteger(Save.stageHeartsLost)) Save.stageHeartsLost = 0;\\n    Save.revives = Math.max(0, Math.min(MaxRevives, Save.revives));\\n    Save.winsSinceRevive = Math.max(0, Save.winsSinceRevive);\\n    Save.winsSinceHeartRefresh = Math.max(0, Save.winsSinceHeartRefresh);\\n    Save.stageHeartsLost = Math.max(0, Save.stageHeartsLost);\\n    if (!Save.settings || typeof Save.settings !== \\\"object\\\") Save.settings = { ...Base.settings };\\n\\n    Save.settings.musicVolume = ClampNumber(Save.settings.musicVolume, 0, 1, Base.settings.musicVolume);\\n    Save.settings.soundVolume = ClampNumber(Save.settings.soundVolume, 0, 1, Base.settings.soundVolume);\\n    Save.lives = Math.max(0, Math.min(Save.maxLives, Save.lives));\\n\\n    if (!Save.unlockedWorlds.includes(Base.unlockedWorlds[0])) Save.unlockedWorlds.push(Base.unlockedWorlds[0]);\\n    if (!Save.unlockedStages.includes(Base.unlockedStages[0])) Save.unlockedStages.push(Base.unlockedStages[0]);\\n\\n    return Save;\\n}\", \"function NormalizeSave(Value) {\\n    const Base = DefaultSave();\\n    const Save = Value && typeof Value === \\\"object\\\" && !Array.isArray(Value)\\n        ? Clone(Value)\\n        : Clone(Base);\\n\\n    Save.version = 6;\\n    if (!Array.isArray(Save.unlockedWorlds)) Save.unlockedWorlds = [...Base.unlockedWorlds];\\n    if (!Array.isArray(Save.unlockedStages)) Save.unlockedStages = [...Base.unlockedStages];\\n    if (!Save.stars || typeof Save.stars !== \\\"object\\\" || Array.isArray(Save.stars)) Save.stars = {};\\n    if (!StagesData.stages[Save.currentStage]) Save.currentStage = Base.currentStage;\\n    if (!Number.isInteger(Save.lives)) Save.lives = MaxLives;\\n    if (!Number.isInteger(Save.maxLives)) Save.maxLives = MaxLives;\\n    if (!Number.isInteger(Save.deaths)) Save.deaths = 0;\\n    if (!Number.isInteger(Save.revives)) Save.revives = 1;\\n    if (!Number.isInteger(Save.winsSinceRevive)) Save.winsSinceRevive = 0;\\n    if (!Number.isInteger(Save.winsSinceHeartRefresh)) Save.winsSinceHeartRefresh = 0;\\n    if (!Number.isInteger(Save.stageHeartsLost)) Save.stageHeartsLost = 0;\\n    if (!Save.cosmetics || typeof Save.cosmetics !== \\\"object\\\" || Array.isArray(Save.cosmetics)) Save.cosmetics = { ...Base.cosmetics };\\n    if (!Array.isArray(Save.cosmetics.unlocked)) Save.cosmetics.unlocked = [];\\n    Save.cosmetics.unlocked = [...new Set(Save.cosmetics.unlocked.filter(Value => typeof Value === \\\"string\\\"))];\\n    if (typeof Save.cosmetics.equipped !== \\\"string\\\") Save.cosmetics.equipped = \\\"classic\\\";\\n    Save.revives = Math.max(0, Math.min(MaxRevives, Save.revives));\\n    Save.winsSinceRevive = Math.max(0, Save.winsSinceRevive);\\n    Save.winsSinceHeartRefresh = Math.max(0, Save.winsSinceHeartRefresh);\\n    Save.stageHeartsLost = Math.max(0, Save.stageHeartsLost);\\n    if (!Save.settings || typeof Save.settings !== \\\"object\\\") Save.settings = { ...Base.settings };\\n\\n    Save.settings.musicVolume = ClampNumber(Save.settings.musicVolume, 0, 1, Base.settings.musicVolume);\\n    Save.settings.soundVolume = ClampNumber(Save.settings.soundVolume, 0, 1, Base.settings.soundVolume);\\n    Save.lives = Math.max(0, Math.min(Save.maxLives, Save.lives));\\n\\n    if (!Save.unlockedWorlds.includes(Base.unlockedWorlds[0])) Save.unlockedWorlds.push(Base.unlockedWorlds[0]);\\n    if (!Save.unlockedStages.includes(Base.unlockedStages[0])) Save.unlockedStages.push(Base.unlockedStages[0]);\\n\\n    return Save;\\n}\", \"v12 cosmetic normalization\");\n\nReplaceRequired(\"function ApplySuccessToAccount(Account, StageId, Stars) {\\n    const Save = NormalizeSave(Account.save);\\n    const Stage = StagesData.stages[StageId];\\n    Save.stars[StageId] = Math.max(Number(Save.stars[StageId] || 0), Stars);\\n\\n    Save.winsSinceHeartRefresh += 1;\\n    Save.winsSinceRevive += 1;\\n\\n    const RefreshWins = GetHeartRefreshWins(Stage?.difficulty);\\n    let Refilled = false;\\n    let ReviveEarned = false;\\n\\n    if (Save.winsSinceHeartRefresh >= RefreshWins) {\\n        Save.winsSinceHeartRefresh = 0;\\n        Save.lives = Save.maxLives;\\n        Refilled = true;\\n    }\\n\\n    if (Save.winsSinceRevive >= ReviveEarnEvery) {\\n        Save.winsSinceRevive = 0;\\n        if (Save.revives < MaxRevives) {\\n            Save.revives += 1;\\n            ReviveEarned = true;\\n        }\\n    }\\n\\n    if (Stage.nextStage) {\\n        UnlockStage(Save, Stage.nextStage);\\n        Save.currentStage = Stage.nextStage;\\n    } else {\\n        Save.currentStage = StageId;\\n    }\\n\\n    if (Stage.isChapterEnd) {\\n        Save.lives = Save.maxLives;\\n        Save.winsSinceHeartRefresh = 0;\\n        Refilled = true;\\n    }\\n\\n    Save.stageHeartsLost = 0;\\n    Account.save = Save;\\n\\n    return {\\n        save: Save,\\n        refilled: Refilled,\\n        reviveEarned: ReviveEarned,\\n        refreshWins: RefreshWins\\n    };\\n}\", \"function ApplySuccessToAccount(Account, StageId, Stars, BranchId = \\\"\\\") {\\n    const Save = NormalizeSave(Account.save);\\n    const Stage = StagesData.stages[StageId];\\n    const Branch = GetStageBranch(Stage, BranchId);\\n    const NextStage = Branch.nextStage;\\n    Save.stars[StageId] = Math.max(Number(Save.stars[StageId] || 0), Stars);\\n\\n    Save.winsSinceHeartRefresh += 1;\\n    Save.winsSinceRevive += 1;\\n\\n    const RefreshWins = GetHeartRefreshWins(Stage?.difficulty);\\n    let Refilled = false;\\n    let ReviveEarned = false;\\n    let CosmeticUnlocked = null;\\n\\n    if (Save.winsSinceHeartRefresh >= RefreshWins) {\\n        Save.winsSinceHeartRefresh = 0;\\n        Save.lives = Save.maxLives;\\n        Refilled = true;\\n    }\\n\\n    if (Save.winsSinceRevive >= ReviveEarnEvery) {\\n        Save.winsSinceRevive = 0;\\n        if (Save.revives < MaxRevives) {\\n            Save.revives += 1;\\n            ReviveEarned = true;\\n        }\\n    }\\n\\n    if (NextStage) {\\n        UnlockStage(Save, NextStage);\\n        Save.currentStage = NextStage;\\n    } else {\\n        Save.currentStage = StageId;\\n    }\\n\\n    const World = StagesData.worlds.find(Entry => Entry.id === Stage?.worldId);\\n    const Cosmetic = GetWorldCosmetic(Stage);\\n    if (Cosmetic && Stage?.id === World?.finalStage && Number(Save.stars[StageId] || 0) >= 3 && !Save.cosmetics.unlocked.includes(Cosmetic.id)) {\\n        Save.cosmetics.unlocked.push(Cosmetic.id);\\n        CosmeticUnlocked = Cosmetic;\\n    }\\n\\n    if (Stage.isChapterEnd) {\\n        Save.lives = Save.maxLives;\\n        Save.winsSinceHeartRefresh = 0;\\n        Refilled = true;\\n    }\\n\\n    Save.stageHeartsLost = 0;\\n    Account.save = Save;\\n\\n    return {\\n        save: Save,\\n        nextStage: NextStage,\\n        refilled: Refilled,\\n        reviveEarned: ReviveEarned,\\n        refreshWins: RefreshWins,\\n        cosmeticUnlocked: CosmeticUnlocked\\n    };\\n}\", \"v12 branching progression\");\n\nReplaceRequired(\"function BuildRoomState(Room) {\\n    const VoteState = GetVoteState(Room);\\n    return {\\n        code: Room.code,\\n        hostUsername: Room.hostUsername,\\n        status: Room.status,\\n        stageId: Room.stageId,\\n        lives: Room.lives,\\n        maxLives: Room.maxLives,\\n        maxPlayers: MaxPlayers,\\n        players: [...Room.players.values()].map(Player => ({\\n            username: Player.username,\\n            ready: Player.ready,\\n            chatBanned: Room.chatBannedNames.has(Player.username)\\n        })),\\n        messages: Room.messages.slice(-ChatHistoryLimit),\\n        selectedIndexes: VoteState.selectedIndexes,\\n        votes: VoteState.votes,\\n        voteUsers: VoteState.voteUsers,\\n        voteThreshold: VoteState.threshold,\\n        revives: Room.revives,\\n        stageHeartsLost: Room.stageHeartsLost,\\n        winsSinceHeartRefresh: Room.winsSinceHeartRefresh,\\n        winsSinceRevive: Room.winsSinceRevive,\\n        lastOutcome: Room.lastOutcome\\n    };\\n}\", \"function GetStageBranch(Stage, BranchId) {\\n    const Branches = Array.isArray(Stage?.branches) ? Stage.branches : [];\\n    const Requested = Branches.find(Branch => Branch?.id === BranchId);\\n    return Requested || {\\n        id: \\\"\\\",\\n        nextStage: Stage?.nextStage || \\\"\\\",\\n        label: \\\"\\\"\\n    };\\n}\\n\\nfunction GetWorldCosmetic(Stage) {\\n    const World = StagesData.worlds.find(Entry => Entry.id === Stage?.worldId);\\n    return World?.cosmetic?.id ? World.cosmetic : null;\\n}\\n\\nfunction GetStageDangerSeconds(Stage) {\\n    const Configured = Number(Stage?.dangerSeconds);\\n    if (Number.isFinite(Configured) && Configured > 0) return Configured;\\n\\n    const Difficulty = String(Stage?.difficulty || \\\"\\\").toLowerCase();\\n    if (/nightmare|extreme|brutal|insane/.test(Difficulty)) return 42;\\n    if (/hard/.test(Difficulty)) return 55;\\n    if (/normal|medium/.test(Difficulty)) return 70;\\n    return 85;\\n}\\n\\nfunction EnsureRoomSystems(Room) {\\n    if (!Room) return;\\n    if (!Room.powers || typeof Room.powers !== \\\"object\\\") Room.powers = { reveal: 1, undo: 1, seal: 1 };\\n    if (!(Room.revealedIndexes instanceof Set)) Room.revealedIndexes = new Set(Room.revealedIndexes || []);\\n    if (!(Room.sealedIndexes instanceof Set)) Room.sealedIndexes = new Set(Room.sealedIndexes || []);\\n    if (!Array.isArray(Room.selectionHistory)) Room.selectionHistory = [];\\n    if (typeof Room.branchId !== \\\"string\\\") Room.branchId = \\\"\\\";\\n    if (!Number.isFinite(Room.dangerEndsAt)) Room.dangerEndsAt = 0;\\n}\\n\\nfunction ClearRoomDanger(Room) {\\n    if (Room?.dangerTimer) clearTimeout(Room.dangerTimer);\\n    if (Room) {\\n        Room.dangerTimer = null;\\n        Room.dangerEndsAt = 0;\\n    }\\n}\\n\\nfunction ExpireRoomDanger(Room) {\\n    if (!Room || Room.status !== \\\"playing\\\" || Room.checkBusy) return;\\n    ClearRoomDanger(Room);\\n    Room.lives = Math.max(0, Room.lives - 1);\\n    Room.stageHeartsLost += 1;\\n    Room.lastOutcome = {\\n        success: false,\\n        reason: \\\"The danger timer ran out.\\\",\\n        aftermath: StagesData.stages[Room.stageId]?.aftermath || \\\"\\\",\\n        lives: Room.lives,\\n        maxLives: Room.maxLives,\\n        revives: Room.revives,\\n        gameOver: Room.lives <= 0,\\n        timedOut: true\\n    };\\n    if (Room.lives <= 0) Room.status = \\\"gameover\\\";\\n    Io.to(Room.code).emit(\\\"game:outcome\\\", Room.lastOutcome);\\n    EmitRoom(Room);\\n}\\n\\nfunction ResetRoomStageSystems(Room) {\\n    EnsureRoomSystems(Room);\\n    ClearRoomDanger(Room);\\n    Room.powers = { reveal: 1, undo: 1, seal: 1 };\\n    Room.revealedIndexes = new Set();\\n    Room.sealedIndexes = new Set();\\n    Room.selectionHistory = [];\\n    const Stage = StagesData.stages[Room.stageId];\\n    const Branches = Array.isArray(Stage?.branches) ? Stage.branches : [];\\n    Room.branchId = String(Branches[0]?.id || \\\"\\\");\\n    const Seconds = GetStageDangerSeconds(Stage);\\n    Room.dangerEndsAt = Date.now() + Seconds * 1000;\\n    Room.dangerTimer = setTimeout(() => ExpireRoomDanger(Room), Seconds * 1000);\\n}\\n\\nfunction BuildPersonalClue(Stage, Username, Room) {\\n    if (!Stage || !Username) return \\\"\\\";\\n    const Required = Array.isArray(Stage.requiredRemoved) ? Stage.requiredRemoved : [];\\n    const Safe = (Stage.sentences || []).map((_, Index) => Index).filter(Index => !Required.includes(Index));\\n    const Clues = [\\n        ...Required.map(Index => \\\"Sentence \\\" + (Index + 1) + \\\" is directly feeding the danger.\\\"),\\n        ...Safe.slice(0, Math.max(1, Required.length)).map(Index => \\\"Sentence \\\" + (Index + 1) + \\\" is needed; do not cross it out.\\\")\\n    ];\\n    if (!Clues.length) return \\\"Compare what each sentence changes before the threat reaches the page.\\\";\\n    const Names = [...Room.memberNames].sort((A, B) => A.localeCompare(B));\\n    const Position = Math.max(0, Names.indexOf(Username));\\n    return Clues[Position % Clues.length];\\n}\\n\\nfunction BuildRoomState(Room, ViewerUsername = \\\"\\\") {\\n    EnsureRoomSystems(Room);\\n    const VoteState = GetVoteState(Room);\\n    const Stage = StagesData.stages[Room.stageId];\\n    return {\\n        code: Room.code,\\n        hostUsername: Room.hostUsername,\\n        status: Room.status,\\n        stageId: Room.stageId,\\n        lives: Room.lives,\\n        maxLives: Room.maxLives,\\n        maxPlayers: MaxPlayers,\\n        players: [...Room.players.values()].map(Player => ({\\n            username: Player.username,\\n            ready: Player.ready,\\n            chatBanned: Room.chatBannedNames.has(Player.username)\\n        })),\\n        messages: Room.messages.slice(-ChatHistoryLimit),\\n        selectedIndexes: VoteState.selectedIndexes,\\n        votes: VoteState.votes,\\n        voteUsers: VoteState.voteUsers,\\n        voteThreshold: VoteState.threshold,\\n        revives: Room.revives,\\n        stageHeartsLost: Room.stageHeartsLost,\\n        winsSinceHeartRefresh: Room.winsSinceHeartRefresh,\\n        winsSinceRevive: Room.winsSinceRevive,\\n        powers: { ...Room.powers },\\n        revealedIndexes: [...Room.revealedIndexes],\\n        sealedIndexes: [...Room.sealedIndexes],\\n        dangerEndsAt: Room.dangerEndsAt,\\n        branchId: Room.branchId,\\n        personalClue: BuildPersonalClue(Stage, ViewerUsername, Room),\\n        lastOutcome: Room.lastOutcome\\n    };\\n}\", \"v12 private room state\");\n\nReplaceRequired(\"function ToggleRoomVote(Room, Socket, Index, Announce = false) {\\n    if (!Room.votes.has(Index)) Room.votes.set(Index, new Set());\\n    const Votes = Room.votes.get(Index);\\n    const Username = Socket.data.username;\\n    const WasSelected = Votes.has(Username);\\n\\n    if (WasSelected) Votes.delete(Username);\\n    else Votes.add(Username);\\n\\n    if (Votes.size === 0) Room.votes.delete(Index);\\n\\n    if (Announce) {\\n        PushRoomMessage(Room, {\\n            username: Username,\\n            text: WasSelected ? `removed their vote from option ${Index + 1}.` : `chose option ${Index + 1}.`,\\n            sentAt: Date.now(),\\n            system: true,\\n            vote: true,\\n            option: Index + 1\\n        });\\n    }\\n\\n    EmitRoom(Room);\\n}\", \"function ToggleRoomVote(Room, Socket, Index, Announce = false) {\\n    EnsureRoomSystems(Room);\\n    if (Room.sealedIndexes.has(Index)) {\\n        Socket.emit(\\\"room:chatError\\\", { error: \\\"That sentence is sealed for this attempt.\\\" });\\n        return false;\\n    }\\n\\n    if (!Room.votes.has(Index)) Room.votes.set(Index, new Set());\\n    const Votes = Room.votes.get(Index);\\n    const Username = Socket.data.username;\\n    const WasSelected = Votes.has(Username);\\n\\n    if (WasSelected) Votes.delete(Username);\\n    else Votes.add(Username);\\n\\n    if (Votes.size === 0) Room.votes.delete(Index);\\n    if (!WasSelected && GetVoteState(Room).selectedIndexes.includes(Index)) Room.selectionHistory.push(Index);\\n\\n    if (Announce) {\\n        PushRoomMessage(Room, {\\n            username: Username,\\n            text: WasSelected ? `removed their vote from option ${Index + 1}.` : `chose option ${Index + 1}.`,\\n            sentAt: Date.now(),\\n            system: true,\\n            vote: true,\\n            option: Index + 1\\n        });\\n    }\\n\\n    EmitRoom(Room);\\n    return true;\\n}\", \"v12 sealed votes\");\n\nReplaceRequired(\"function EmitRoom(Room) {\\n    Io.to(Room.code).emit(\\\"room:state\\\", BuildRoomState(Room));\\n}\", \"function EmitRoom(Room) {\\n    for (const [SocketId, Player] of Room.players.entries()) {\\n        Io.to(SocketId).emit(\\\"room:state\\\", BuildRoomState(Room, Player.username));\\n    }\\n}\", \"v12 individualized room emit\");\n\nReplaceRequired(\"        winsSinceRevive: 0,\\n        revives: 1\", \"        winsSinceRevive: 0,\\n        revives: 1,\\n        powers: { reveal: 1, undo: 1, seal: 1 },\\n        revealedIndexes: new Set(),\\n        sealedIndexes: new Set(),\\n        selectionHistory: [],\\n        branchId: \\\"\\\",\\n        dangerEndsAt: 0,\\n        dangerTimer: null\", \"v12 room systems\");\n\nReplaceRequired(\"if (RequestPath === \\\"/api/stage/check\\\" && Request.method === \\\"POST\\\") {\\n        const Body = await ReadJson(Request).catch(() => ({}));\\n        const Stage = StagesData.stages[Body.stageId];\\n        if (!Stage || !Account.save.unlockedStages.includes(Stage.id)) return SendJson(Response, 403, { error: \\\"Stage is locked.\\\" }, Origin);\\n        const Result = ValidateStageResult(Stage.id, Body.removedIndexes);\\n\\n        if (!Result.success) {\\n            const UpdatedSave = ApplyFailureToAccount(Account);\\n            await SaveAccount(Account);\\n            return SendJson(Response, 200, {\\n                success: false,\\n                reason: Result.reason,\\n                aftermath: Result.aftermath,\\n                lives: UpdatedSave.lives,\\n                maxLives: UpdatedSave.maxLives,\\n                gameOver: UpdatedSave.lives <= 0,\\n                save: UpdatedSave\\n            }, Origin);\\n        }\\n\\n        const Stars = ComputeHeartStars(Account.save.stageHeartsLost);\\n        const Progress = ApplySuccessToAccount(Account, Stage.id, Stars);\\n        await SaveAccount(Account);\\n        return SendJson(Response, 200, {\\n            success: true,\\n            stars: Stars,\\n            nextStage: Stage.nextStage,\\n            isChapterEnd: Stage.isChapterEnd,\\n            lives: Account.save.lives,\\n            maxLives: Account.save.maxLives,\\n            revives: Account.save.revives,\\n            refilled: Progress.refilled,\\n            reviveEarned: Progress.reviveEarned,\\n            refreshWins: Progress.refreshWins,\\n            save: Account.save\\n        }, Origin);\\n    }\", \"if (RequestPath === \\\"/api/cosmetics\\\" && Request.method === \\\"POST\\\") {\\n        const Body = await ReadJson(Request).catch(() => ({}));\\n        const CosmeticId = String(Body.cosmeticId || \\\"classic\\\");\\n        const Available = new Set([\\\"classic\\\", ...(Account.save.cosmetics?.unlocked || [])]);\\n        if (!Available.has(CosmeticId)) return SendJson(Response, 403, { error: \\\"That bookmark is still locked.\\\" }, Origin);\\n        Account.save.cosmetics.equipped = CosmeticId;\\n        await SaveAccount(Account);\\n        return SendJson(Response, 200, { save: Account.save }, Origin);\\n    }\\n\\n    if (RequestPath === \\\"/api/stage/timeout\\\" && Request.method === \\\"POST\\\") {\\n        const Body = await ReadJson(Request).catch(() => ({}));\\n        const Stage = StagesData.stages[Body.stageId];\\n        if (!Stage || !Account.save.unlockedStages.includes(Stage.id)) return SendJson(Response, 403, { error: \\\"Stage is locked.\\\" }, Origin);\\n        const UpdatedSave = ApplyFailureToAccount(Account);\\n        await SaveAccount(Account);\\n        return SendJson(Response, 200, {\\n            success: false,\\n            reason: \\\"The danger timer ran out.\\\",\\n            aftermath: Stage.aftermath,\\n            lives: UpdatedSave.lives,\\n            maxLives: UpdatedSave.maxLives,\\n            gameOver: UpdatedSave.lives <= 0,\\n            timedOut: true,\\n            save: UpdatedSave\\n        }, Origin);\\n    }\\n\\n    if (RequestPath === \\\"/api/stage/check\\\" && Request.method === \\\"POST\\\") {\\n        const Body = await ReadJson(Request).catch(() => ({}));\\n        const Stage = StagesData.stages[Body.stageId];\\n        if (!Stage || !Account.save.unlockedStages.includes(Stage.id)) return SendJson(Response, 403, { error: \\\"Stage is locked.\\\" }, Origin);\\n        const Result = ValidateStageResult(Stage.id, Body.removedIndexes);\\n\\n        if (!Result.success) {\\n            const UpdatedSave = ApplyFailureToAccount(Account);\\n            await SaveAccount(Account);\\n            return SendJson(Response, 200, {\\n                success: false,\\n                reason: Result.reason,\\n                aftermath: Result.aftermath,\\n                lives: UpdatedSave.lives,\\n                maxLives: UpdatedSave.maxLives,\\n                gameOver: UpdatedSave.lives <= 0,\\n                save: UpdatedSave\\n            }, Origin);\\n        }\\n\\n        const Stars = ComputeHeartStars(Account.save.stageHeartsLost);\\n        const Progress = ApplySuccessToAccount(Account, Stage.id, Stars, String(Body.branchId || \\\"\\\"));\\n        await SaveAccount(Account);\\n        return SendJson(Response, 200, {\\n            success: true,\\n            stars: Stars,\\n            nextStage: Progress.nextStage,\\n            isChapterEnd: Stage.isChapterEnd,\\n            lives: Account.save.lives,\\n            maxLives: Account.save.maxLives,\\n            revives: Account.save.revives,\\n            refilled: Progress.refilled,\\n            reviveEarned: Progress.reviveEarned,\\n            refreshWins: Progress.refreshWins,\\n            cosmeticUnlocked: Progress.cosmeticUnlocked,\\n            save: Account.save\\n        }, Origin);\\n    }\", \"v12 stage timeout and cosmetics\");\n\nReplaceRequired(\"Socket.on(\\\"room:start\\\", async (Payload, Reply = () => {}) => {\\n        try {\\n            const Room = GetRoomForSocket(Socket);\\n            if (!Room) return Reply({ ok: false, error: \\\"Room missing.\\\" });\\n            if (Room.hostSocketId !== Socket.id) return Reply({ ok: false, error: \\\"Only the host can start.\\\" });\\n            if (Room.status !== \\\"lobby\\\") return Reply({ ok: false, error: \\\"Game already started.\\\" });\\n            if ([...Room.players.values()].some(Player => !Player.ready && Player.username !== Room.hostUsername)) {\\n                return Reply({ ok: false, error: \\\"Everyone else must be ready.\\\" });\\n            }\\n\\n            const RequestedStage = StagesData.stages[Payload?.stageId] || StagesData.stages[Room.stageId];\\n            const HostAccount = await GetAccountByUsername(Room.hostUsername);\\n            if (!RequestedStage || !HostAccount || !NormalizeSave(HostAccount.save).unlockedStages.includes(RequestedStage.id)) {\\n                return Reply({ ok: false, error: \\\"The host has not unlocked that stage.\\\" });\\n            }\\n\\n            Room.stageId = RequestedStage.id;\\n            Room.status = \\\"playing\\\";\\n            Room.votes.clear();\\n            Room.lastOutcome = null;\\n            Room.lives = MaxLives;\\n            Room.stageHeartsLost = 0;\\n            Room.checkBusy = false;\\n\\n            Reply({ ok: true, stageId: Room.stageId });\\n            Io.to(Room.code).emit(\\\"game:started\\\", { code: Room.code, stageId: Room.stageId });\\n            EmitRoom(Room);\\n        } catch (Error) {\\n            console.error(\\\"Room start failed\\\", Error);\\n            Reply({ ok: false, error: \\\"Could not start the room.\\\" });\\n        }\\n    });\", \"Socket.on(\\\"room:start\\\", async (Payload, Reply = () => {}) => {\\n        try {\\n            const Room = GetRoomForSocket(Socket);\\n            if (!Room) return Reply({ ok: false, error: \\\"Room missing.\\\" });\\n            if (Room.hostSocketId !== Socket.id) return Reply({ ok: false, error: \\\"Only the host can start.\\\" });\\n            if (Room.status !== \\\"lobby\\\") return Reply({ ok: false, error: \\\"Game already started.\\\" });\\n            if ([...Room.players.values()].some(Player => !Player.ready && Player.username !== Room.hostUsername)) {\\n                return Reply({ ok: false, error: \\\"Everyone else must be ready.\\\" });\\n            }\\n\\n            const RequestedStage = StagesData.stages[Payload?.stageId] || StagesData.stages[Room.stageId];\\n            const HostAccount = await GetAccountByUsername(Room.hostUsername);\\n            if (!RequestedStage || !HostAccount || !NormalizeSave(HostAccount.save).unlockedStages.includes(RequestedStage.id)) {\\n                return Reply({ ok: false, error: \\\"The host has not unlocked that stage.\\\" });\\n            }\\n\\n            Room.stageId = RequestedStage.id;\\n            Room.status = \\\"playing\\\";\\n            Room.votes.clear();\\n            Room.lastOutcome = null;\\n            Room.lives = MaxLives;\\n            Room.stageHeartsLost = 0;\\n            Room.checkBusy = false;\\n            ResetRoomStageSystems(Room);\\n\\n            Reply({ ok: true, stageId: Room.stageId });\\n            Io.to(Room.code).emit(\\\"game:started\\\", { code: Room.code, stageId: Room.stageId });\\n            EmitRoom(Room);\\n        } catch (Error) {\\n            console.error(\\\"Room start failed\\\", Error);\\n            Reply({ ok: false, error: \\\"Could not start the room.\\\" });\\n        }\\n    });\", \"v12 room timer start\");\n\nReplaceRequired(\"Socket.on(\\\"game:vote\\\", Payload => {\\n        const Room = GetRoomForSocket(Socket);\\n        if (!Room || Room.status !== \\\"playing\\\") return;\\n        const Stage = StagesData.stages[Room.stageId];\\n        const Index = Number(Payload?.index);\\n        if (!Stage || !Number.isInteger(Index) || Index < 0 || Index >= Stage.sentences.length) return;\\n        ToggleRoomVote(Room, Socket, Index, true);\\n    });\", \"Socket.on(\\\"game:vote\\\", Payload => {\\n        const Room = GetRoomForSocket(Socket);\\n        if (!Room || Room.status !== \\\"playing\\\") return;\\n        const Stage = StagesData.stages[Room.stageId];\\n        const Index = Number(Payload?.index);\\n        if (!Stage || !Number.isInteger(Index) || Index < 0 || Index >= Stage.sentences.length) return;\\n        ToggleRoomVote(Room, Socket, Index, true);\\n    });\\n\\n    Socket.on(\\\"game:branch\\\", (Payload, Reply = () => {}) => {\\n        const Room = GetRoomForSocket(Socket);\\n        if (!Room || Room.status !== \\\"playing\\\") return Reply({ ok: false, error: \\\"Game is not active.\\\" });\\n        if (Room.hostSocketId !== Socket.id) return Reply({ ok: false, error: \\\"Only the host can choose the route.\\\" });\\n        const Branch = GetStageBranch(StagesData.stages[Room.stageId], String(Payload?.branchId || \\\"\\\"));\\n        if (!Branch.id) return Reply({ ok: false, error: \\\"That route is not available on this page.\\\" });\\n        Room.branchId = Branch.id;\\n        EmitRoom(Room);\\n        Reply({ ok: true, branchId: Branch.id });\\n    });\\n\\n    Socket.on(\\\"game:power\\\", (Payload, Reply = () => {}) => {\\n        const Room = GetRoomForSocket(Socket);\\n        if (!Room || Room.status !== \\\"playing\\\") return Reply({ ok: false, error: \\\"Game is not active.\\\" });\\n        if (Room.hostSocketId !== Socket.id) return Reply({ ok: false, error: \\\"Only the host can use shared powers.\\\" });\\n        EnsureRoomSystems(Room);\\n        const Name = String(Payload?.name || \\\"\\\");\\n        if (![\\\"reveal\\\", \\\"undo\\\", \\\"seal\\\"].includes(Name) || Number(Room.powers[Name] || 0) <= 0) {\\n            return Reply({ ok: false, error: \\\"That power is not available.\\\" });\\n        }\\n\\n        const Stage = StagesData.stages[Room.stageId];\\n        let Index = -1;\\n        if (Name === \\\"reveal\\\") {\\n            Index = (Stage?.requiredRemoved || []).find(Value => !Room.revealedIndexes.has(Value));\\n            if (!Number.isInteger(Index)) return Reply({ ok: false, error: \\\"Every direct danger is already revealed.\\\" });\\n            Room.revealedIndexes.add(Index);\\n        }\\n\\n        if (Name === \\\"undo\\\") {\\n            const Selected = new Set(GetVoteState(Room).selectedIndexes);\\n            Index = [...Room.selectionHistory].reverse().find(Value => Selected.has(Value) && !Room.sealedIndexes.has(Value));\\n            if (!Number.isInteger(Index)) return Reply({ ok: false, error: \\\"There is no team decision to undo.\\\" });\\n            Room.votes.delete(Index);\\n        }\\n\\n        if (Name === \\\"seal\\\") {\\n            const Selected = new Set(GetVoteState(Room).selectedIndexes);\\n            Index = [...Room.selectionHistory].reverse().find(Value => Selected.has(Value) && !Room.sealedIndexes.has(Value));\\n            if (!Number.isInteger(Index)) return Reply({ ok: false, error: \\\"Select a sentence before sealing it.\\\" });\\n            Room.sealedIndexes.add(Index);\\n        }\\n\\n        Room.powers[Name] -= 1;\\n        EmitRoom(Room);\\n        Reply({ ok: true, index: Index });\\n    });\", \"v12 powers and routes\");\n\nReplaceRequired(\"Socket.on(\\\"game:check\\\", async (Payload, Reply = () => {}) => {\\n        const Room = GetRoomForSocket(Socket);\\n        if (!Room || Room.status !== \\\"playing\\\") return Reply({ ok: false, error: \\\"Game is not active.\\\" });\\n        if (Room.hostSocketId !== Socket.id) return Reply({ ok: false, error: \\\"Only the host can check survival.\\\" });\\n        if (Room.checkBusy) return Reply({ ok: false, error: \\\"A survival check is already running.\\\" });\\n\\n        Room.checkBusy = true;\\n\\n        try {\\n            const Result = ValidateStageResult(Room.stageId, GetVoteState(Room).selectedIndexes);\\n            const Stage = StagesData.stages[Room.stageId];\\n\\n            if (!Result.success) {\\n                Room.lives = Math.max(0, Room.lives - 1);\\n                Room.stageHeartsLost += 1;\\n                Room.lastOutcome = {\\n                    success: false,\\n                    reason: Result.reason,\\n                    aftermath: Result.aftermath,\\n                    lives: Room.lives,\\n                    maxLives: Room.maxLives,\\n                    revives: Room.revives,\\n                    gameOver: Room.lives <= 0\\n                };\\n                if (Room.lives <= 0) Room.status = \\\"gameover\\\";\\n                Io.to(Room.code).emit(\\\"game:outcome\\\", Room.lastOutcome);\\n                EmitRoom(Room);\\n                return Reply({ ok: true });\\n            }\\n\\n            const Stars = ComputeHeartStars(Room.stageHeartsLost);\\n            Room.winsSinceHeartRefresh += 1;\\n            Room.winsSinceRevive += 1;\\n\\n            const RefreshWins = GetHeartRefreshWins(Stage?.difficulty);\\n            let Refilled = false;\\n            let ReviveEarned = false;\\n\\n            if (Room.winsSinceHeartRefresh >= RefreshWins) {\\n                Room.winsSinceHeartRefresh = 0;\\n                Room.lives = Room.maxLives;\\n                Refilled = true;\\n            }\\n\\n            if (Room.winsSinceRevive >= ReviveEarnEvery) {\\n                Room.winsSinceRevive = 0;\\n                if (Room.revives < MaxRevives) {\\n                    Room.revives += 1;\\n                    ReviveEarned = true;\\n                }\\n            }\\n\\n            const Accounts = [];\\n            for (const Username of Room.memberNames) {\\n                const MemberAccount = await GetAccountByUsername(Username);\\n                if (!MemberAccount) continue;\\n                ApplySuccessToAccount(MemberAccount, Stage.id, Stars);\\n                Accounts.push(MemberAccount);\\n            }\\n            await SaveAccounts(Accounts);\\n\\n            Room.lastOutcome = {\\n                success: true,\\n                stars: Stars,\\n                nextStage: Stage.nextStage,\\n                isChapterEnd: Stage.isChapterEnd,\\n                lives: Room.lives,\\n                maxLives: Room.maxLives,\\n                revives: Room.revives,\\n                refilled: Refilled,\\n                reviveEarned: ReviveEarned,\\n                refreshWins: RefreshWins\\n            };\\n            Io.to(Room.code).emit(\\\"game:outcome\\\", Room.lastOutcome);\\n            EmitRoom(Room);\\n            Reply({ ok: true });\\n        } catch (Error) {\\n            console.error(\\\"Multiplayer result save failed\\\", Error);\\n            Reply({ ok: false, error: \\\"Could not save the multiplayer result.\\\" });\\n        } finally {\\n            Room.checkBusy = false;\\n        }\\n    });\", \"Socket.on(\\\"game:check\\\", async (Payload, Reply = () => {}) => {\\n        const Room = GetRoomForSocket(Socket);\\n        if (!Room || Room.status !== \\\"playing\\\") return Reply({ ok: false, error: \\\"Game is not active.\\\" });\\n        if (Room.hostSocketId !== Socket.id) return Reply({ ok: false, error: \\\"Only the host can check survival.\\\" });\\n        if (Room.checkBusy) return Reply({ ok: false, error: \\\"A survival check is already running.\\\" });\\n\\n        Room.checkBusy = true;\\n        ClearRoomDanger(Room);\\n\\n        try {\\n            const Result = ValidateStageResult(Room.stageId, GetVoteState(Room).selectedIndexes);\\n            const Stage = StagesData.stages[Room.stageId];\\n\\n            if (!Result.success) {\\n                Room.lives = Math.max(0, Room.lives - 1);\\n                Room.stageHeartsLost += 1;\\n                Room.lastOutcome = {\\n                    success: false,\\n                    reason: Result.reason,\\n                    aftermath: Result.aftermath,\\n                    lives: Room.lives,\\n                    maxLives: Room.maxLives,\\n                    revives: Room.revives,\\n                    gameOver: Room.lives <= 0\\n                };\\n                if (Room.lives <= 0) Room.status = \\\"gameover\\\";\\n                Io.to(Room.code).emit(\\\"game:outcome\\\", Room.lastOutcome);\\n                EmitRoom(Room);\\n                return Reply({ ok: true });\\n            }\\n\\n            const Stars = ComputeHeartStars(Room.stageHeartsLost);\\n            Room.winsSinceHeartRefresh += 1;\\n            Room.winsSinceRevive += 1;\\n\\n            const RefreshWins = GetHeartRefreshWins(Stage?.difficulty);\\n            let Refilled = false;\\n            let ReviveEarned = false;\\n\\n            if (Room.winsSinceHeartRefresh >= RefreshWins) {\\n                Room.winsSinceHeartRefresh = 0;\\n                Room.lives = Room.maxLives;\\n                Refilled = true;\\n            }\\n\\n            if (Room.winsSinceRevive >= ReviveEarnEvery) {\\n                Room.winsSinceRevive = 0;\\n                if (Room.revives < MaxRevives) {\\n                    Room.revives += 1;\\n                    ReviveEarned = true;\\n                }\\n            }\\n\\n            const Branch = GetStageBranch(Stage, Room.branchId);\\n            const Accounts = [];\\n            let CosmeticUnlocked = null;\\n            for (const Username of Room.memberNames) {\\n                const MemberAccount = await GetAccountByUsername(Username);\\n                if (!MemberAccount) continue;\\n                const Progress = ApplySuccessToAccount(MemberAccount, Stage.id, Stars, Branch.id);\\n                if (!CosmeticUnlocked && Progress.cosmeticUnlocked) CosmeticUnlocked = Progress.cosmeticUnlocked;\\n                Accounts.push(MemberAccount);\\n            }\\n            await SaveAccounts(Accounts);\\n\\n            Room.lastOutcome = {\\n                success: true,\\n                stars: Stars,\\n                nextStage: Branch.nextStage,\\n                isChapterEnd: Stage.isChapterEnd,\\n                lives: Room.lives,\\n                maxLives: Room.maxLives,\\n                revives: Room.revives,\\n                refilled: Refilled,\\n                reviveEarned: ReviveEarned,\\n                refreshWins: RefreshWins,\\n                cosmeticUnlocked: CosmeticUnlocked\\n            };\\n            Io.to(Room.code).emit(\\\"game:outcome\\\", Room.lastOutcome);\\n            EmitRoom(Room);\\n            Reply({ ok: true });\\n        } catch (Error) {\\n            console.error(\\\"Multiplayer result save failed\\\", Error);\\n            Reply({ ok: false, error: \\\"Could not save the multiplayer result.\\\" });\\n        } finally {\\n            Room.checkBusy = false;\\n        }\\n    });\", \"v12 multiplayer check\");\n\nReplaceRequired(\"Socket.on(\\\"game:retry\\\", () => {\\n        const Room = GetRoomForSocket(Socket);\\n        if (!Room || Room.hostSocketId !== Socket.id || Room.lives <= 0) return;\\n        Room.votes.clear();\\n        Room.lastOutcome = null;\\n        Room.status = \\\"playing\\\";\\n        EmitRoom(Room);\\n        Io.to(Room.code).emit(\\\"game:retry\\\");\\n    });\", \"Socket.on(\\\"game:retry\\\", () => {\\n        const Room = GetRoomForSocket(Socket);\\n        if (!Room || Room.hostSocketId !== Socket.id || Room.lives <= 0) return;\\n        Room.votes.clear();\\n        Room.lastOutcome = null;\\n        Room.status = \\\"playing\\\";\\n        ResetRoomStageSystems(Room);\\n        EmitRoom(Room);\\n        Io.to(Room.code).emit(\\\"game:retry\\\");\\n    });\", \"v12 retry timer\");\n\nReplaceRequired(\"Socket.on(\\\"game:next\\\", () => {\\n        const Room = GetRoomForSocket(Socket);\\n        if (!Room || Room.hostSocketId !== Socket.id || !Room.lastOutcome?.success) return;\\n        const Stage = StagesData.stages[Room.stageId];\\n        if (!Stage?.nextStage) {\\n            Io.to(Room.code).emit(\\\"game:finished\\\");\\n            return;\\n        }\\n        Room.stageId = Stage.nextStage;\\n        Room.votes.clear();\\n        Room.lastOutcome = null;\\n        Room.status = \\\"playing\\\";\\n        Room.stageHeartsLost = 0;\\n        if (Stage.isChapterEnd) {\\n            Room.lives = Room.maxLives;\\n            Room.winsSinceHeartRefresh = 0;\\n        }\\n        EmitRoom(Room);\\n        Io.to(Room.code).emit(\\\"game:stage\\\", { stageId: Room.stageId });\\n    });\", \"Socket.on(\\\"game:next\\\", () => {\\n        const Room = GetRoomForSocket(Socket);\\n        if (!Room || Room.hostSocketId !== Socket.id || !Room.lastOutcome?.success) return;\\n        const Stage = StagesData.stages[Room.stageId];\\n        const NextStage = String(Room.lastOutcome.nextStage || \\\"\\\");\\n        if (!NextStage || !StagesData.stages[NextStage]) {\\n            Io.to(Room.code).emit(\\\"game:finished\\\");\\n            return;\\n        }\\n        Room.stageId = NextStage;\\n        Room.votes.clear();\\n        Room.lastOutcome = null;\\n        Room.status = \\\"playing\\\";\\n        Room.stageHeartsLost = 0;\\n        if (Stage?.isChapterEnd) {\\n            Room.lives = Room.maxLives;\\n            Room.winsSinceHeartRefresh = 0;\\n        }\\n        ResetRoomStageSystems(Room);\\n        EmitRoom(Room);\\n        Io.to(Room.code).emit(\\\"game:stage\\\", { stageId: Room.stageId });\\n    });\", \"v12 next branch\");\n\nReplaceRequired(\"Socket.on(\\\"game:revive\\\", (Payload, Reply = () => {}) => {\\n        const Room = GetRoomForSocket(Socket);\\n        if (!Room) return Reply({ ok: false, error: \\\"Room missing.\\\" });\\n        if (Room.hostSocketId !== Socket.id) return Reply({ ok: false, error: \\\"Only the host can use a team revive.\\\" });\\n        if (Room.lives > 0 || Room.status !== \\\"gameover\\\") return Reply({ ok: false, error: \\\"A revive is only needed after the team loses all hearts.\\\" });\\n        if (Room.revives <= 0) return Reply({ ok: false, error: \\\"The team has no revives.\\\" });\\n\\n        Room.revives -= 1;\\n        Room.lives = 1;\\n        Room.votes.clear();\\n        Room.lastOutcome = null;\\n        Room.status = \\\"playing\\\";\\n        EmitRoom(Room);\\n        Io.to(Room.code).emit(\\\"game:retry\\\", { revived: true, revives: Room.revives });\\n        Reply({ ok: true, lives: Room.lives, revives: Room.revives });\\n    });\", \"Socket.on(\\\"game:revive\\\", (Payload, Reply = () => {}) => {\\n        const Room = GetRoomForSocket(Socket);\\n        if (!Room) return Reply({ ok: false, error: \\\"Room missing.\\\" });\\n        if (Room.hostSocketId !== Socket.id) return Reply({ ok: false, error: \\\"Only the host can use a team revive.\\\" });\\n        if (Room.lives > 0 || Room.status !== \\\"gameover\\\") return Reply({ ok: false, error: \\\"A revive is only needed after the team loses all hearts.\\\" });\\n        if (Room.revives <= 0) return Reply({ ok: false, error: \\\"The team has no revives.\\\" });\\n\\n        Room.revives -= 1;\\n        Room.lives = 1;\\n        Room.votes.clear();\\n        Room.lastOutcome = null;\\n        Room.status = \\\"playing\\\";\\n        ResetRoomStageSystems(Room);\\n        EmitRoom(Room);\\n        Io.to(Room.code).emit(\\\"game:retry\\\", { revived: true, revives: Room.revives });\\n        Reply({ ok: true, lives: Room.lives, revives: Room.revives });\\n    });\", \"v12 revive timer\");\n\nReplaceRequired(\"Socket.on(\\\"game:restartChapter\\\", async () => {\\n        try {\\n            const Room = GetRoomForSocket(Socket);\\n            if (!Room || Room.hostSocketId !== Socket.id || Room.lives > 0) return;\\n            const CurrentStage = StagesData.stages[Room.stageId];\\n            const World = GetWorld(CurrentStage?.worldId) || StagesData.worlds[0];\\n            Room.stageId = World.entryStage;\\n            Room.lives = Room.maxLives;\\n            Room.stageHeartsLost = 0;\\n            Room.votes.clear();\\n            Room.lastOutcome = null;\\n            Room.status = \\\"playing\\\";\\n\\n            const Accounts = [];\\n            for (const Username of Room.memberNames) {\\n                const MemberAccount = await GetAccountByUsername(Username);\\n                if (!MemberAccount) continue;\\n                RestartChapterForAccount(MemberAccount, World.id);\\n                Accounts.push(MemberAccount);\\n            }\\n            await SaveAccounts(Accounts);\\n            EmitRoom(Room);\\n            Io.to(Room.code).emit(\\\"game:stage\\\", { stageId: Room.stageId, restarted: true });\\n        } catch (Error) {\\n            console.error(\\\"Restart chapter save failed\\\", Error);\\n        }\\n    });\", \"Socket.on(\\\"game:restartChapter\\\", async () => {\\n        try {\\n            const Room = GetRoomForSocket(Socket);\\n            if (!Room || Room.hostSocketId !== Socket.id || Room.lives > 0) return;\\n            const CurrentStage = StagesData.stages[Room.stageId];\\n            const World = GetWorld(CurrentStage?.worldId) || StagesData.worlds[0];\\n            Room.stageId = World.entryStage;\\n            Room.lives = Room.maxLives;\\n            Room.stageHeartsLost = 0;\\n            Room.votes.clear();\\n            Room.lastOutcome = null;\\n            Room.status = \\\"playing\\\";\\n            ResetRoomStageSystems(Room);\\n\\n            const Accounts = [];\\n            for (const Username of Room.memberNames) {\\n                const MemberAccount = await GetAccountByUsername(Username);\\n                if (!MemberAccount) continue;\\n                RestartChapterForAccount(MemberAccount, World.id);\\n                Accounts.push(MemberAccount);\\n            }\\n            await SaveAccounts(Accounts);\\n            EmitRoom(Room);\\n            Io.to(Room.code).emit(\\\"game:stage\\\", { stageId: Room.stageId, restarted: true });\\n        } catch (Error) {\\n            console.error(\\\"Restart chapter save failed\\\", Error);\\n        }\\n    });\", \"v12 restart timer\");\n\nReplaceRequired(\"const State = BuildRoomState(Room);\", \"const State = BuildRoomState(Room, Username);\", \"v12 joining clue\");";

const V13PatchCode = "ReplaceRequired(\n    'const BackendVersion = 12;',\n    'const BackendVersion = 13;',\n    \"backend version 13\"\n);\n\nReplaceRequired(\n    'const OpenAIModel = String(process.env.OPENAI_MODEL || \"gpt-5.6\").trim();',\n    'const OpenAIModel = String(process.env.OPENAI_MODEL || \"gpt-4.1-mini\").trim();',\n    \"StoryBot default model\"\n);\n\nReplaceRequired(\n    '            const Text = await SanitizeChatMessage(RawText);',\n    '            const Text = IsStoryBotMention(RawText) ? RawText : await SanitizeChatMessage(RawText);',\n    \"StoryBot chat safety bypass\"\n);\n\nReplaceRequired(\n    '            if (Room.status !== \"lobby\") return Reply({ ok: false, error: \"Game already started.\" });\\n            if ([...Room.players.values()].some(Player => !Player.ready && Player.username !== Room.hostUsername)) {',\n    '            if (Room.status !== \"lobby\") return Reply({ ok: false, error: \"Game already started.\" });\\n            if (Room.players.size < 2) return Reply({ ok: false, error: \"Multiplayer requires at least 2 players.\" });\\n            if ([...Room.players.values()].some(Player => !Player.ready && Player.username !== Room.hostUsername)) {',\n    \"minimum multiplayer players\"\n);";

const V14PatchCode = "ReplaceRequired(\n    'const ChatSafetyModel = String(process.env.OPENAI_CHAT_FILTER_MODEL || OpenAIModel).trim();',\n    'const StoryBotUsesOpenAI = String(process.env.STORYBOT_USE_OPENAI || \"0\").trim() === \"1\";\\nconst ChatSafetyModel = String(process.env.OPENAI_CHAT_FILTER_MODEL || OpenAIModel).trim();',\n    \"optional paid StoryBot\"\n);\n\nReplaceRequired(\n    'const BackendVersion = 13;',\n    'const BackendVersion = 14;',\n    \"backend version 14\"\n);\n\nReplaceRequired(\n    '            const Text = IsStoryBotMention(RawText) ? RawText : await SanitizeChatMessage(RawText);',\n    '            const Text = NormalizeChatText(RawText);',\n    \"local multiplayer chat\"\n);\n\nReplaceRequired(\n    'async function GenerateStoryBotReply(Room, Username, Question) {',\n    \"function GenerateProceduralStoryBotReply(Room, Username, Question) {\\n    const Stage = StagesData.stages[Room?.stageId] || null;\\n    const Prompt = String(Question || \\\"\\\").toLowerCase();\\n\\n    if (!Stage) {\\n        return Username + \\\", invite another player, ready up, and start the story when the room has at least two players.\\\";\\n    }\\n\\n    const RequiredOptions = (Stage.requiredRemoved || [])\\n        .filter(Index => Number.isInteger(Index))\\n        .map(Index => Index + 1);\\n\\n    if (/(answer|solution|which|option|remove|cross)/.test(Prompt) && RequiredOptions.length > 0) {\\n        const Label = RequiredOptions.length === 1 ? \\\"option \\\" : \\\"options \\\";\\n        return \\\"The direct danger is in \\\" + Label + RequiredOptions.join(\\\", \\\") + \\\". Check how each sentence affects \\\" + Stage.objective;\\n    }\\n\\n    if (/(hint|help|stuck|clue)/.test(Prompt) && Stage.hint) {\\n        return String(Stage.hint);\\n    }\\n\\n    if (/(danger|threat|risk)/.test(Prompt) && Stage.threat) {\\n        return \\\"Main threat: \\\" + Stage.threat;\\n    }\\n\\n    const VoteState = GetVoteState(Room);\\n    if (VoteState.selectedIndexes.length > 0) {\\n        return \\\"The room currently selected \\\" + VoteState.selectedIndexes.map(Index => Index + 1).join(\\\", \\\") + \\\". Compare those choices with the objective: \\\" + Stage.objective;\\n    }\\n\\n    return \\\"For \\\" + Stage.name + \\\", focus on this objective: \\\" + Stage.objective;\\n}\\n\\nasync function GenerateStoryBotReply(Room, Username, Question) {\",\n    \"procedural StoryBot fallback\"\n);\n\nReplaceRequired(\n    '    if (!OpenAIApiKey) throw new Error(\"AI_NOT_CONFIGURED\");',\n    '    if (!StoryBotUsesOpenAI || !OpenAIApiKey) return GenerateProceduralStoryBotReply(Room, Username, Question);',\n    \"StoryBot missing key fallback\"\n);\n\nReplaceRequired(\n    '        return NormalizeChatText(Reply);\\n    } finally {',\n    '        return NormalizeChatText(Reply);\\n    } catch (Error) {\\n        console.error(\"StoryBot API request failed; using procedural fallback\", Error);\\n        return GenerateProceduralStoryBotReply(Room, Username, Question);\\n    } finally {',\n    \"StoryBot request fallback\"\n);\n\nReplaceRequired(\n    '    if (!OpenAIApiKey) {\\n        Socket.emit(\"room:botError\", { error: \"StoryBot is not configured on the server yet.\" });\\n        return;\\n    }\\n\\n',\n    '',\n    \"StoryBot no-key gate\"\n);";

const V16PatchCode = "ReplaceRequired(\n    'const BackendVersion = 14;',\n    'const BackendVersion = 16;',\n    \"backend version 16\"\n);\n\nReplaceRequired(\n    'const StoryBotTimeout = 20000;',\n    'const StoryBotTimeout = 90000;',\n    \"local StoryBot timeout\"\n);\n\nReplaceRequired(\n    '            const Text = NormalizeChatText(RawText);',\n    '            const Text = SanitizeLocalChat(RawText);',\n    \"local profanity filter\"\n);\n\nReplaceRequired(\n    'async function GenerateStoryBotReply(Room, Username, Question) {',\n    \"const LocalChatBlockedWords = [\\n    \\\"fuck\\\",\\n    \\\"fucking\\\",\\n    \\\"fucker\\\",\\n    \\\"shit\\\",\\n    \\\"bitch\\\",\\n    \\\"asshole\\\",\\n    \\\"dick\\\",\\n    \\\"cunt\\\",\\n    \\\"nigger\\\",\\n    \\\"faggot\\\"\\n];\\n\\nlet StoryBotPythonProcess = null;\\nlet StoryBotPythonBuffer = \\\"\\\";\\nlet StoryBotPythonRequestId = 0;\\nconst StoryBotPythonRequests = new Map();\\n\\nfunction SanitizeLocalChat(Value) {\\n    let Text = NormalizeChatText(Value);\\n    for (const Word of LocalChatBlockedWords) {\\n        Text = Text.replace(new RegExp(\\\"\\\\\\\\b\\\" + Word + \\\"\\\\\\\\b\\\", \\\"gi\\\"), \\\"[censored]\\\");\\n    }\\n    return Text;\\n}\\n\\nfunction RejectStoryBotPythonRequests(Error) {\\n    for (const Pending of StoryBotPythonRequests.values()) {\\n        clearTimeout(Pending.timeout);\\n        Pending.reject(Error);\\n    }\\n    StoryBotPythonRequests.clear();\\n}\\n\\nfunction HandleStoryBotPythonOutput(Chunk) {\\n    StoryBotPythonBuffer += String(Chunk || \\\"\\\");\\n    while (StoryBotPythonBuffer.includes(\\\"\\\\n\\\")) {\\n        const BreakIndex = StoryBotPythonBuffer.indexOf(\\\"\\\\n\\\");\\n        const Line = StoryBotPythonBuffer.slice(0, BreakIndex).trim();\\n        StoryBotPythonBuffer = StoryBotPythonBuffer.slice(BreakIndex + 1);\\n        if (!Line) continue;\\n\\n        let Message;\\n        try {\\n            Message = JSON.parse(Line);\\n        } catch {\\n            continue;\\n        }\\n\\n        if (Message?.type === \\\"ready\\\") {\\n            console.log(\\\"Local StoryBot model ready\\\");\\n            continue;\\n        }\\n\\n        const Pending = StoryBotPythonRequests.get(String(Message?.id || \\\"\\\"));\\n        if (!Pending) continue;\\n        StoryBotPythonRequests.delete(String(Message.id));\\n        clearTimeout(Pending.timeout);\\n\\n        if (Message.ok && Message.reply) {\\n            Pending.resolve(SanitizeLocalChat(Message.reply));\\n        } else {\\n            Pending.reject(new Error(Message.error || \\\"Local StoryBot failed.\\\"));\\n        }\\n    }\\n}\\n\\nfunction EnsureStoryBotPythonProcess() {\\n    if (StoryBotPythonProcess && !StoryBotPythonProcess.killed) return StoryBotPythonProcess;\\n\\n    const PythonExecutable = String(process.env.PYTHON_EXECUTABLE || \\\"python3\\\");\\n    const ScriptPath = require(\\\"path\\\").join(__dirname, \\\"storybot_ai.py\\\");\\n    const Worker = require(\\\"child_process\\\").spawn(PythonExecutable, [ScriptPath], {\\n        cwd: __dirname,\\n        env: process.env,\\n        stdio: [\\\"pipe\\\", \\\"pipe\\\", \\\"pipe\\\"]\\n    });\\n\\n    StoryBotPythonProcess = Worker;\\n    StoryBotPythonBuffer = \\\"\\\";\\n\\n    Worker.stdout.setEncoding(\\\"utf8\\\");\\n    Worker.stdout.on(\\\"data\\\", HandleStoryBotPythonOutput);\\n    Worker.stderr.setEncoding(\\\"utf8\\\");\\n    Worker.stderr.on(\\\"data\\\", Chunk => console.error(\\\"Local StoryBot:\\\", String(Chunk || \\\"\\\").trim()));\\n    Worker.on(\\\"error\\\", Error => RejectStoryBotPythonRequests(Error));\\n    Worker.on(\\\"exit\\\", Code => {\\n        if (StoryBotPythonProcess === Worker) StoryBotPythonProcess = null;\\n        RejectStoryBotPythonRequests(new Error(\\\"Local StoryBot stopped with code \\\" + Code + \\\".\\\"));\\n    });\\n\\n    return Worker;\\n}\\n\\nfunction GenerateLocalStoryBotReply(Context) {\\n    return new Promise((Resolve, Reject) => {\\n        const Worker = EnsureStoryBotPythonProcess();\\n        const RequestId = String(++StoryBotPythonRequestId);\\n        const Timeout = setTimeout(() => {\\n            StoryBotPythonRequests.delete(RequestId);\\n            Reject(new Error(\\\"Local StoryBot took too long.\\\"));\\n        }, StoryBotTimeout);\\n\\n        StoryBotPythonRequests.set(RequestId, {\\n            resolve: Resolve,\\n            reject: Reject,\\n            timeout: Timeout\\n        });\\n\\n        try {\\n            Worker.stdin.write(JSON.stringify({ id: RequestId, context: Context }) + \\\"\\\\n\\\");\\n        } catch (Error) {\\n            clearTimeout(Timeout);\\n            StoryBotPythonRequests.delete(RequestId);\\n            Reject(Error);\\n        }\\n    });\\n}\\n\\nasync function GenerateStoryBotReply(Room, Username, Question) {\",\n    \"local Python StoryBot bridge\"\n);\n\nSource = Source.replace(/function GenerateProceduralStoryBotReply\\([\\s\\S]*?\\n\\}\\n\\n(?=const LocalChatBlockedWords)/, \"\");\n\nReplaceRequired(\n    '    if (!StoryBotUsesOpenAI || !OpenAIApiKey) return GenerateProceduralStoryBotReply(Room, Username, Question);\\n\\n',\n    '',\n    \"remove scripted StoryBot guard\"\n);\n\nReplaceRequired(\n    '        question: Question || \"Help the room decide what to do next.\"\\n    };\\n\\n    const Controller = new AbortController();',\n    '        question: Question || \"Help the room decide what to do next.\"\\n    };\\n\\n    return GenerateLocalStoryBotReply(Context);\\n\\n    const Controller = new AbortController();',\n    \"local Python StoryBot routing\"\n);\n\nReplaceRequired(\n    '    } catch (Error) {\\n        console.error(\"StoryBot API request failed; using procedural fallback\", Error);\\n        return GenerateProceduralStoryBotReply(Room, Username, Question);\\n    } finally {',\n    '    } catch (Error) {\\n        throw Error;\\n    } finally {',\n    \"remove scripted StoryBot fallback\"\n);";

const V17PatchCode = "ReplaceRequired(\n    'const BackendVersion = 16;',\n    'const BackendVersion = 17;',\n    \"backend version 17\"\n);\n\nReplaceRequired(\n    \"function SanitizeLocalChat(Value) {\\n    let Text = NormalizeChatText(Value);\\n    for (const Word of LocalChatBlockedWords) {\\n        Text = Text.replace(new RegExp(\\\"\\\\\\\\b\\\" + Word + \\\"\\\\\\\\b\\\", \\\"gi\\\"), \\\"[censored]\\\");\\n    }\\n    return Text;\\n}\",\n    \"const LocalChatCharacterPatterns = Object.freeze({\\n    a: \\\"[a@4а]\\\",\\n    b: \\\"[b8]\\\",\\n    c: \\\"[cсk(<{]\\\",\\n    d: \\\"d\\\",\\n    e: \\\"[e3е]\\\",\\n    f: \\\"(?:f|ph)\\\",\\n    g: \\\"[g69]\\\",\\n    h: \\\"h\\\",\\n    i: \\\"[i1!|і]\\\",\\n    j: \\\"j\\\",\\n    k: \\\"k\\\",\\n    l: \\\"[l1!|]\\\",\\n    m: \\\"m\\\",\\n    n: \\\"n\\\",\\n    o: \\\"[o0о]\\\",\\n    p: \\\"[pр]\\\",\\n    q: \\\"q\\\",\\n    r: \\\"r\\\",\\n    s: \\\"[s5$]\\\",\\n    t: \\\"[t7+]\\\",\\n    u: \\\"[uüv0@4]\\\",\\n    v: \\\"v\\\",\\n    w: \\\"w\\\",\\n    x: \\\"[xх]\\\",\\n    y: \\\"[yу]\\\",\\n    z: \\\"[z2]\\\"\\n});\\n\\nfunction BuildLocalChatWordPattern(Word) {\\n    return Array.from(Word)\\n        .map(Character => (LocalChatCharacterPatterns[Character] || Character) + \\\"+\\\")\\n        .join(\\\"[^a-z0-9]*\\\");\\n}\\n\\nfunction SanitizeLocalChat(Value) {\\n    let Text = NormalizeChatText(Value).normalize(\\\"NFKC\\\");\\n    for (const Word of LocalChatBlockedWords) {\\n        const BodyPattern = BuildLocalChatWordPattern(Word);\\n        const Pattern = new RegExp(\\\"(^|[^a-z0-9])(\\\" + BodyPattern + \\\")(?=$|[^a-z0-9])\\\", \\\"giu\\\");\\n        Text = Text.replace(Pattern, (Match, Prefix, BlockedText) => {\\n            const StarCount = Math.min(24, Math.max(Word.length, Array.from(BlockedText).length));\\n            return Prefix + \\\"*\\\".repeat(StarCount);\\n        });\\n    }\\n    return Text;\\n}\",\n    \"obfuscation-resistant starred chat filter\"\n);";

const V18PatchCode = "ReplaceRequired(\n    'const BackendVersion = 17;',\n    'const BackendVersion = 18;',\n    \"backend version 18\"\n);\n\nReplaceRequired(\n    \"const LocalChatCharacterPatterns = Object.freeze({\\n    a: \\\"[a@4а]\\\",\\n    b: \\\"[b8]\\\",\\n    c: \\\"[cсk(<{]\\\",\\n    d: \\\"d\\\",\\n    e: \\\"[e3е]\\\",\\n    f: \\\"(?:f|ph)\\\",\\n    g: \\\"[g69]\\\",\\n    h: \\\"h\\\",\\n    i: \\\"[i1!|і]\\\",\\n    j: \\\"j\\\",\\n    k: \\\"k\\\",\\n    l: \\\"[l1!|]\\\",\\n    m: \\\"m\\\",\\n    n: \\\"n\\\",\\n    o: \\\"[o0о]\\\",\\n    p: \\\"[pр]\\\",\\n    q: \\\"q\\\",\\n    r: \\\"r\\\",\\n    s: \\\"[s5$]\\\",\\n    t: \\\"[t7+]\\\",\\n    u: \\\"[uüv0@4]\\\",\\n    v: \\\"v\\\",\\n    w: \\\"w\\\",\\n    x: \\\"[xх]\\\",\\n    y: \\\"[yу]\\\",\\n    z: \\\"[z2]\\\"\\n});\\n\\nfunction BuildLocalChatWordPattern(Word) {\\n    return Array.from(Word)\\n        .map(Character => (LocalChatCharacterPatterns[Character] || Character) + \\\"+\\\")\\n        .join(\\\"[^a-z0-9]*\\\");\\n}\\n\\nfunction SanitizeLocalChat(Value) {\\n    let Text = NormalizeChatText(Value).normalize(\\\"NFKC\\\");\\n    for (const Word of LocalChatBlockedWords) {\\n        const BodyPattern = BuildLocalChatWordPattern(Word);\\n        const Pattern = new RegExp(\\\"(^|[^a-z0-9])(\\\" + BodyPattern + \\\")(?=$|[^a-z0-9])\\\", \\\"giu\\\");\\n        Text = Text.replace(Pattern, (Match, Prefix, BlockedText) => {\\n            const StarCount = Math.min(24, Math.max(Word.length, Array.from(BlockedText).length));\\n            return Prefix + \\\"*\\\".repeat(StarCount);\\n        });\\n    }\\n    return Text;\\n}\",\n    \"const LocalChatCharacterPatterns = Object.freeze({\\n    a: \\\"[a@4]\\\",\\n    b: \\\"[b8]\\\",\\n    c: \\\"[ck]\\\",\\n    d: \\\"d\\\",\\n    e: \\\"[e3]\\\",\\n    f: \\\"(?:f|ph)\\\",\\n    g: \\\"[g69]\\\",\\n    h: \\\"h\\\",\\n    i: \\\"[i1!|]\\\",\\n    j: \\\"j\\\",\\n    k: \\\"k\\\",\\n    l: \\\"[l1!|]\\\",\\n    m: \\\"m\\\",\\n    n: \\\"n\\\",\\n    o: \\\"[o0]\\\",\\n    p: \\\"p\\\",\\n    q: \\\"q\\\",\\n    r: \\\"r\\\",\\n    s: \\\"[s5$]\\\",\\n    t: \\\"[t7+]\\\",\\n    u: \\\"[uv0@4]\\\",\\n    v: \\\"v\\\",\\n    w: \\\"w\\\",\\n    x: \\\"x\\\",\\n    y: \\\"y\\\",\\n    z: \\\"[z2]\\\"\\n});\\n\\nconst LocalChatConfusableCharacters = Object.freeze({\\n    \\\"а\\\": \\\"a\\\",\\n    \\\"α\\\": \\\"a\\\",\\n    \\\"ɑ\\\": \\\"a\\\",\\n    \\\"ь\\\": \\\"b\\\",\\n    \\\"с\\\": \\\"c\\\",\\n    \\\"ϲ\\\": \\\"c\\\",\\n    \\\"ԁ\\\": \\\"d\\\",\\n    \\\"е\\\": \\\"e\\\",\\n    \\\"ε\\\": \\\"e\\\",\\n    \\\"ƒ\\\": \\\"f\\\",\\n    \\\"ɡ\\\": \\\"g\\\",\\n    \\\"һ\\\": \\\"h\\\",\\n    \\\"і\\\": \\\"i\\\",\\n    \\\"ι\\\": \\\"i\\\",\\n    \\\"ӏ\\\": \\\"i\\\",\\n    \\\"ⅼ\\\": \\\"i\\\",\\n    \\\"ј\\\": \\\"j\\\",\\n    \\\"κ\\\": \\\"k\\\",\\n    \\\"к\\\": \\\"k\\\",\\n    \\\"м\\\": \\\"m\\\",\\n    \\\"ո\\\": \\\"n\\\",\\n    \\\"η\\\": \\\"n\\\",\\n    \\\"о\\\": \\\"o\\\",\\n    \\\"ο\\\": \\\"o\\\",\\n    \\\"р\\\": \\\"p\\\",\\n    \\\"ρ\\\": \\\"p\\\",\\n    \\\"ԛ\\\": \\\"q\\\",\\n    \\\"г\\\": \\\"r\\\",\\n    \\\"ѕ\\\": \\\"s\\\",\\n    \\\"τ\\\": \\\"t\\\",\\n    \\\"υ\\\": \\\"u\\\",\\n    \\\"ս\\\": \\\"u\\\",\\n    \\\"ν\\\": \\\"v\\\",\\n    \\\"ԝ\\\": \\\"w\\\",\\n    \\\"х\\\": \\\"x\\\",\\n    \\\"χ\\\": \\\"x\\\",\\n    \\\"у\\\": \\\"y\\\",\\n    \\\"γ\\\": \\\"y\\\",\\n    \\\"ᴢ\\\": \\\"z\\\"\\n});\\n\\nfunction BuildLocalChatWordPattern(Word) {\\n    return Array.from(Word)\\n        .map(Character => (LocalChatCharacterPatterns[Character] || Character) + \\\"+?\\\")\\n        .join(\\\"\\\");\\n}\\n\\nfunction FoldLocalChatCharacter(Character) {\\n    const CompatibilityText = Character.normalize(\\\"NFKD\\\").replace(/\\\\p{M}/gu, \\\"\\\").toLowerCase();\\n    let FoldedText = \\\"\\\";\\n    for (const CompatibilityCharacter of CompatibilityText) {\\n        const MappedCharacter = LocalChatConfusableCharacters[CompatibilityCharacter] || CompatibilityCharacter;\\n        if (/^[a-z0-9@$!|+]$/.test(MappedCharacter)) FoldedText += MappedCharacter;\\n    }\\n    return FoldedText;\\n}\\n\\nfunction BuildLocalChatScan(Text) {\\n    let ScanText = \\\"\\\";\\n    const Positions = [];\\n    let Offset = 0;\\n\\n    for (const Character of Text) {\\n        const Start = Offset;\\n        Offset += Character.length;\\n        const FoldedText = FoldLocalChatCharacter(Character);\\n        for (const FoldedCharacter of FoldedText) {\\n            ScanText += FoldedCharacter;\\n            Positions.push({ start: Start, end: Offset });\\n        }\\n    }\\n\\n    return { text: ScanText, positions: Positions };\\n}\\n\\nfunction SanitizeLocalChat(Value) {\\n    let Text = NormalizeChatText(Value).normalize(\\\"NFKC\\\");\\n    const Scan = BuildLocalChatScan(Text);\\n    const Ranges = [];\\n\\n    for (const Word of LocalChatBlockedWords) {\\n        const Pattern = new RegExp(BuildLocalChatWordPattern(Word), \\\"giu\\\");\\n        for (const Match of Scan.text.matchAll(Pattern)) {\\n            const StartIndex = Number(Match.index);\\n            let EndIndex = StartIndex + Match[0].length - 1;\\n            const FinalCharacter = Scan.text[EndIndex];\\n            while (\\n                Scan.text[EndIndex + 1] === FinalCharacter\\n                && Scan.positions[EndIndex]?.end === Scan.positions[EndIndex + 1]?.start\\n            ) {\\n                EndIndex += 1;\\n            }\\n            const StartPosition = Scan.positions[StartIndex];\\n            const EndPosition = Scan.positions[EndIndex];\\n            if (StartPosition && EndPosition) {\\n                Ranges.push({ start: StartPosition.start, end: EndPosition.end });\\n            }\\n        }\\n    }\\n\\n    Ranges.sort((FirstRange, SecondRange) => FirstRange.start - SecondRange.start || FirstRange.end - SecondRange.end);\\n    const MergedRanges = [];\\n    for (const Range of Ranges) {\\n        const PreviousRange = MergedRanges[MergedRanges.length - 1];\\n        if (PreviousRange && Range.start <= PreviousRange.end) {\\n            PreviousRange.end = Math.max(PreviousRange.end, Range.end);\\n        } else {\\n            MergedRanges.push({ start: Range.start, end: Range.end });\\n        }\\n    }\\n\\n    for (let Index = MergedRanges.length - 1; Index >= 0; Index -= 1) {\\n        const Range = MergedRanges[Index];\\n        const StarCount = Math.min(24, Math.max(4, Array.from(Text.slice(Range.start, Range.end)).length));\\n        Text = Text.slice(0, Range.start) + \\\"*\\\".repeat(StarCount) + Text.slice(Range.end);\\n    }\\n\\n    return Text;\\n}\",\n    \"full-message canonical starred chat filter\"\n);";

const V19PatchCode = "ReplaceRequired(\n    'const BackendVersion = 18;',\n    'const BackendVersion = 19;',\n    \"backend version 19\"\n);\n\nReplaceRequired(\n    \"        lastBotAt: 0\",\n    \"        lastBotAt: 0,\\n        reportQueue: new Map(),\\n        abuseStrikes: new Map(),\\n        nextMessageId: 1\",\n    \"room reporting state\"\n);\n\nReplaceRequired(\n    \"            const Message = { username: Socket.data.username, text: Text, sentAt: Date.now() };\",\n    \"            const Message = {\\n                id: \\\"msg-\\\" + Room.code + \\\"-\\\" + String(Room.nextMessageId++),\\n                username: Socket.data.username,\\n                text: Text,\\n                sentAt: Date.now()\\n            };\",\n    \"multiplayer message ids\"\n);\n\nReplaceRequired(\n    \"            Room.messages.push(Message);\\n            Room.messages = Room.messages.slice(-ChatHistoryLimit);\\n            Io.to(Room.code).emit(\\\"room:chat\\\", Message);\\n            MaybeReplyAsStoryBot(Room, Socket, Message).catch(Error => {\\n                console.error(\\\"StoryBot background failure\\\", Error);\\n            });\",\n    \"            Room.messages.push(Message);\\n            Room.messages = Room.messages.slice(-ChatHistoryLimit);\\n            Io.to(Room.code).emit(\\\"room:chat\\\", Message);\\n            QueueAutomaticAbuseReview(Room, Message);\\n            MaybeReplyAsStoryBot(Room, Socket, Message).catch(Error => {\\n                console.error(\\\"StoryBot background failure\\\", Error);\\n            });\",\n    \"automatic delayed abuse review\"\n);\n\nReplaceRequired(\n    \"    Socket.on(\\\"room:leave\\\", () => LeaveRoom(Socket, true));\",\n    \"    Socket.on(\\\"room:leave\\\", (Payload, Reply = () => {}) => {\\n        LeaveRoom(Socket, true);\\n        Reply({ ok: true });\\n    });\",\n    \"acknowledged room leave\"\n);\n\nReplaceRequired(\n    \"function LeaveRoom(Socket, Explicit = false) {\\n    const Room = GetRoomForSocket(Socket);\\n    if (!Room) return;\\n    const Player = Room.players.get(Socket.id);\\n    Room.players.delete(Socket.id);\\n    Socket.leave(Room.code);\\n    Socket.data.roomCode = null;\\n\\n    if (Player && Explicit) {\\n        Room.memberNames.delete(Player.username);\\n        for (const Usernames of Room.votes.values()) Usernames.delete(Player.username);\\n    }\\n\\n    if (Room.hostSocketId === Socket.id) {\\n        Room.hostSocketId = null;\\n        if (Explicit && Room.players.size > 0) ReassignHost(Room);\\n    }\\n\\n    if (Room.players.size === 0) ScheduleRoomCleanup(Room);\\n    else EmitRoom(Room);\\n}\",\n    \"function ClearRoomReportTimers(Room) {\\n    for (const Review of Room.reportQueue?.values?.() || []) {\\n        if (Review.timer) clearTimeout(Review.timer);\\n    }\\n    Room.reportQueue?.clear?.();\\n}\\n\\nfunction LeaveRoom(Socket, Explicit = false) {\\n    const Room = GetRoomForSocket(Socket);\\n    if (!Room) return;\\n\\n    const Player = Room.players.get(Socket.id);\\n    const WasHost = Room.hostSocketId === Socket.id;\\n    Room.players.delete(Socket.id);\\n    Socket.leave(Room.code);\\n    Socket.data.roomCode = null;\\n\\n    if (Player && Explicit) {\\n        Room.memberNames.delete(Player.username);\\n        for (const Usernames of Room.votes.values()) Usernames.delete(Player.username);\\n    }\\n\\n    if (Room.players.size === 0) {\\n        ClearRoomReportTimers(Room);\\n        if (Room.cleanupTimer) clearTimeout(Room.cleanupTimer);\\n        Rooms.delete(Room.code);\\n        return;\\n    }\\n\\n    if (WasHost) ReassignHost(Room);\\n    EmitRoom(Room);\\n}\",\n    \"host transfer and immediate room deletion\"\n);\n\nReplaceRequired(\n    'function EmitRoom(Room) {',\n    \"const ChatReportReviewDelay = 60000;\\nconst AutomaticAbusePattern = /\\\\b(stupid|idiot|dumb|moron|loser|worthless|retard|shut\\\\s+up|nobody\\\\s+likes\\\\s+you|kill\\\\s+yourself|kys|go\\\\s+die)\\\\b/i;\\nconst DirectedAbusePattern = /\\\\b(you|youre|you're|ur|u)\\\\b.{0,28}\\\\b(trash|awful|pathetic|useless|horrible)\\\\b/i;\\n\\nfunction LooksLikeDirectAbuse(Value) {\\n    const Text = NormalizeChatText(Value);\\n    return AutomaticAbusePattern.test(Text)\\n        || DirectedAbusePattern.test(Text)\\n        || /\\\\*{4,}\\\\s*(you|u)\\\\b/i.test(Text)\\n        || /\\\\b(you|u)\\\\b.{0,16}\\\\*{4,}/i.test(Text);\\n}\\n\\nfunction GenerateLocalModerationDecision(Context) {\\n    return GenerateLocalStoryBotReply({ moderationReview: Context })\\n        .then(Reply => /^ABUSE\\\\b/i.test(String(Reply || \\\"\\\").trim()));\\n}\\n\\nfunction FindRoomMessage(Room, MessageId) {\\n    return Room.messages.find(Message => String(Message?.id || \\\"\\\") === String(MessageId || \\\"\\\")) || null;\\n}\\n\\nfunction SendReportResult(Room, Review, ActionTaken) {\\n    for (const [ReporterUsername, ReportId] of Review.reporters.entries()) {\\n        const ReporterSocket = FindRoomPlayerSocket(Room, ReporterUsername);\\n        ReporterSocket?.emit(\\\"room:reportResult\\\", {\\n            reportId: ReportId,\\n            messageId: Review.messageId,\\n            actionTaken: Boolean(ActionTaken)\\n        });\\n    }\\n}\\n\\nasync function ReviewQueuedAbuse(RoomCode, MessageId) {\\n    const Room = Rooms.get(RoomCode);\\n    const Review = Room?.reportQueue?.get(MessageId);\\n    if (!Room || !Review) return;\\n\\n    Room.reportQueue.delete(MessageId);\\n    const Message = FindRoomMessage(Room, MessageId);\\n    if (!Message) {\\n        SendReportResult(Room, Review, false);\\n        return;\\n    }\\n\\n    const RuleDecision = LooksLikeDirectAbuse(Message.text);\\n    let ModelDecision = false;\\n\\n    try {\\n        ModelDecision = await GenerateLocalModerationDecision({\\n            reportedMessage: {\\n                username: Message.username,\\n                text: Message.text\\n            },\\n            recentConversation: Room.messages.slice(-12).map(ChatMessage => ({\\n                username: ChatMessage.username,\\n                text: ChatMessage.text\\n            })),\\n            manuallyReported: Review.reporters.size > 0,\\n            automaticallyFlagged: Review.automatic\\n        });\\n    } catch (Error) {\\n        console.error(\\\"Delayed abuse review failed\\\", Error);\\n    }\\n\\n    const CurrentRoom = Rooms.get(RoomCode);\\n    if (CurrentRoom !== Room) return;\\n\\n    const ActionTaken = RuleDecision || ModelDecision;\\n    if (!ActionTaken) {\\n        SendReportResult(Room, Review, false);\\n        return;\\n    }\\n\\n    Room.messages = Room.messages.filter(ChatMessage => ChatMessage.id !== MessageId);\\n    const StrikeCount = Number(Room.abuseStrikes.get(Message.username) || 0) + 1;\\n    Room.abuseStrikes.set(Message.username, StrikeCount);\\n\\n    const Muted = StrikeCount >= 2;\\n    if (Muted) Room.chatBannedNames.add(Message.username);\\n\\n    FindRoomPlayerSocket(Room, Message.username)?.emit(\\\"room:moderationResult\\\", {\\n        messageId: MessageId,\\n        muted: Muted,\\n        strikes: StrikeCount\\n    });\\n\\n    Io.to(Room.code).emit(\\\"room:chatRemoved\\\", { messageId: MessageId });\\n    SendReportResult(Room, Review, true);\\n    EmitRoom(Room);\\n}\\n\\nfunction QueueAbuseReview(Room, Message, ReporterUsername = \\\"\\\", Automatic = false) {\\n    if (!Room.reportQueue) Room.reportQueue = new Map();\\n    if (!Room.abuseStrikes) Room.abuseStrikes = new Map();\\n\\n    let Review = Room.reportQueue.get(Message.id);\\n    if (!Review) {\\n        const DueAt = Date.now() + ChatReportReviewDelay;\\n        Review = {\\n            messageId: Message.id,\\n            username: Message.username,\\n            reporters: new Map(),\\n            automatic: Boolean(Automatic),\\n            dueAt: DueAt,\\n            timer: null\\n        };\\n        Review.timer = setTimeout(\\n            () => ReviewQueuedAbuse(Room.code, Message.id),\\n            ChatReportReviewDelay\\n        );\\n        Review.timer.unref?.();\\n        Room.reportQueue.set(Message.id, Review);\\n    } else if (Automatic) {\\n        Review.automatic = true;\\n    }\\n\\n    let ReportId = \\\"\\\";\\n    if (ReporterUsername) {\\n        ReportId = Review.reporters.get(ReporterUsername) || \\\"report-\\\" + crypto.randomBytes(8).toString(\\\"hex\\\");\\n        Review.reporters.set(ReporterUsername, ReportId);\\n    }\\n\\n    return { review: Review, reportId: ReportId };\\n}\\n\\nfunction QueueAutomaticAbuseReview(Room, Message) {\\n    if (!Message?.id || !LooksLikeDirectAbuse(Message.text)) return;\\n    QueueAbuseReview(Room, Message, \\\"\\\", true);\\n}\\n\\nfunction EmitRoom(Room) {\",\n    \"delayed report review helpers\"\n);\n\nReplaceRequired(\n    '    Socket.on(\"room:start\", async (Payload, Reply = () => {}) => {',\n    \"    Socket.on(\\\"room:report\\\", (Payload, Reply = () => {}) => {\\n        const Room = GetRoomForSocket(Socket);\\n        const Reporter = Room?.players.get(Socket.id);\\n        if (!Room || !Reporter) return Reply({ ok: false, error: \\\"Room missing.\\\" });\\n\\n        const MessageId = String(Payload?.messageId || \\\"\\\").trim();\\n        const Message = FindRoomMessage(Room, MessageId);\\n        if (!Message || Message.bot || Message.system || Message.vote) {\\n            return Reply({ ok: false, error: \\\"That message is no longer available.\\\" });\\n        }\\n        if (Message.username === Reporter.username) {\\n            return Reply({ ok: false, error: \\\"You cannot report your own message.\\\" });\\n        }\\n\\n        const ExistingReview = Room.reportQueue?.get(MessageId);\\n        if (ExistingReview?.reporters?.has(Reporter.username)) {\\n            return Reply({ ok: false, error: \\\"You already reported that message.\\\" });\\n        }\\n\\n        const Queued = QueueAbuseReview(Room, Message, Reporter.username, false);\\n        Reply({\\n            ok: true,\\n            reportId: Queued.reportId,\\n            dueAt: Queued.review.dueAt\\n        });\\n    });\\n\\n    Socket.on(\\\"room:start\\\", async (Payload, Reply = () => {}) => {\",\n    \"message report handler\"\n);";

const V20PatchCode = "ReplaceRequired(\n    'const BackendVersion = 19;',\n    'const BackendVersion = 21;',\n    \"backend version 21\"\n);\n\nReplaceRequired(\n    'function EmitRoom(Room) {',\n    `const HostGameRestrictions = new Map();\n\nfunction ClampHostModerationDuration(Value) {\n    const Duration = Number(Value);\n    if (!Number.isFinite(Duration)) return 600000;\n    return Math.max(60000, Math.min(604800000, Math.round(Duration)));\n}\n\nfunction ReadHostModerationReason(Value, Fallback) {\n    const Reason = String(Value || \"\").replace(/\\\\s+/g, \" \").trim().slice(0, 180);\n    return Reason || Fallback;\n}\n\nfunction EnsureHostModerationState(Room) {\n    if (!(Room.chatTimeouts instanceof Map)) Room.chatTimeouts = new Map();\n    if (!(Room.chatTimeoutTimers instanceof Map)) Room.chatTimeoutTimers = new Map();\n}\n\nfunction GetHostChatTimeout(Room, Username) {\n    EnsureHostModerationState(Room);\n    const TimeoutState = Room.chatTimeouts.get(Username) || null;\n    if (!TimeoutState) return null;\n\n    if (Number(TimeoutState.until || 0) <= Date.now()) {\n        Room.chatTimeouts.delete(Username);\n        const Timer = Room.chatTimeoutTimers.get(Username);\n        if (Timer) clearTimeout(Timer);\n        Room.chatTimeoutTimers.delete(Username);\n        if (!TimeoutState.priorChatBan) Room.chatBannedNames.delete(Username);\n        return null;\n    }\n\n    return TimeoutState;\n}\n\nfunction EmitHostChatTimeoutState(Room, Username, Active, TimeoutState = null) {\n    FindRoomPlayerSocket(Room, Username)?.emit(\"room:chatTimeoutState\", {\n        active: Boolean(Active),\n        until: Active ? Number(TimeoutState?.until || 0) : 0,\n        reason: Active\n            ? String(TimeoutState?.reason || \"The host timed out your chat.\")\n            : \"The host removed your chat timeout.\"\n    });\n}\n\nfunction ClearHostChatTimeout(Room, Username, Notify = true) {\n    EnsureHostModerationState(Room);\n    const TimeoutState = Room.chatTimeouts.get(Username) || null;\n    const Timer = Room.chatTimeoutTimers.get(Username);\n    if (Timer) clearTimeout(Timer);\n    Room.chatTimeoutTimers.delete(Username);\n    Room.chatTimeouts.delete(Username);\n\n    if (!TimeoutState?.priorChatBan) Room.chatBannedNames.delete(Username);\n    if (Notify) EmitHostChatTimeoutState(Room, Username, false);\n    Room.moderationRevision += 1;\n    return Boolean(TimeoutState);\n}\n\nfunction SetHostChatTimeout(Room, Username, DurationMs, Reason, IssuedBy) {\n    EnsureHostModerationState(Room);\n\n    const Existing = Room.chatTimeouts.get(Username);\n    const ExistingTimer = Room.chatTimeoutTimers.get(Username);\n    if (ExistingTimer) clearTimeout(ExistingTimer);\n\n    const Duration = ClampHostModerationDuration(DurationMs);\n    const Until = Date.now() + Duration;\n    const TimeoutState = {\n        until: Until,\n        reason: ReadHostModerationReason(Reason, \"The host timed out your chat.\"),\n        issuedBy: String(IssuedBy || Room.hostUsername || \"host\"),\n        priorChatBan: Existing ? Boolean(Existing.priorChatBan) : Room.chatBannedNames.has(Username)\n    };\n\n    Room.chatTimeouts.set(Username, TimeoutState);\n    Room.chatBannedNames.add(Username);\n\n    const Timer = setTimeout(() => {\n        const Current = Room.chatTimeouts.get(Username);\n        if (!Current || Number(Current.until || 0) !== Until) return;\n        ClearHostChatTimeout(Room, Username, true);\n        EmitRoom(Room);\n    }, Duration);\n    Timer.unref?.();\n    Room.chatTimeoutTimers.set(Username, Timer);\n\n    Room.moderationRevision += 1;\n    EmitHostChatTimeoutState(Room, Username, true, TimeoutState);\n    return TimeoutState;\n}\n\nfunction GetHostRestrictionBucket(HostUsername, Create = false) {\n    const HostKey = String(HostUsername || \"\");\n    if (!HostKey) return null;\n    let Bucket = HostGameRestrictions.get(HostKey) || null;\n    if (!Bucket && Create) {\n        Bucket = new Map();\n        HostGameRestrictions.set(HostKey, Bucket);\n    }\n    return Bucket;\n}\n\nfunction GetHostGameRestriction(HostUsername, Username) {\n    const Bucket = GetHostRestrictionBucket(HostUsername, false);\n    const Restriction = Bucket?.get(String(Username || \"\")) || null;\n    if (!Restriction) return null;\n    if (!Restriction.banned && Number(Restriction.until || 0) <= Date.now()) {\n        Bucket.delete(String(Username || \"\"));\n        if (Bucket.size === 0) HostGameRestrictions.delete(String(HostUsername || \"\"));\n        return null;\n    }\n    return Restriction;\n}\n\nfunction SetHostGameRestriction(HostUsername, Username, Options = {}) {\n    const Bucket = GetHostRestrictionBucket(HostUsername, true);\n    const Banned = Boolean(Options.banned);\n    const Restriction = {\n        banned: Banned,\n        until: Banned ? 0 : Date.now() + ClampHostModerationDuration(Options.durationMs),\n        reason: ReadHostModerationReason(Options.reason, Banned ? \"The host banned you from their games.\" : \"The host timed you out from joining their games.\"),\n        issuedBy: String(HostUsername || \"host\")\n    };\n    Bucket.set(String(Username || \"\"), Restriction);\n    return Restriction;\n}\n\nfunction ClearHostGameRestriction(HostUsername, Username) {\n    const Bucket = GetHostRestrictionBucket(HostUsername, false);\n    if (!Bucket) return false;\n    const Removed = Bucket.delete(String(Username || \"\"));\n    if (Bucket.size === 0) HostGameRestrictions.delete(String(HostUsername || \"\"));\n    return Removed;\n}\n\nfunction EmitHostGameRestrictionState(Room, Username, Active, Restriction = null) {\n    FindRoomPlayerSocket(Room, Username)?.emit(\"room:gameRestrictionState\", {\n        active: Boolean(Active),\n        banned: Boolean(Restriction?.banned),\n        until: Active ? Number(Restriction?.until || 0) : 0,\n        reason: Active\n            ? String(Restriction?.reason || \"The host restricted joining their games.\")\n            : \"The host removed your game restriction.\"\n    });\n}\n\nconst SplitMessageWindowMs = 12000;\nconst SplitMessageMaxParts = 12;\n\nfunction NormalizeSplitMessageFragment(Value) {\n    const Text = NormalizeChatText(Value);\n    if (!Text) return \"\";\n    if (Text.length > 4) return null;\n\n    const Scan = typeof BuildLocalChatScan === \"function\"\n        ? BuildLocalChatScan(Text)\n        : { text: Text.toLowerCase() };\n\n    return String(Scan?.text || \"\")\n        .replace(/[^a-z0-9]/g, \"\")\n        .slice(0, 4);\n}\n\nfunction BlockSplitMessageAbuse(Room, Message, Socket) {\n    if (!Room || !Message?.id || !Message?.username) return false;\n    if (!(Room.splitMessageBursts instanceof Map)) Room.splitMessageBursts = new Map();\n\n    const Fragment = NormalizeSplitMessageFragment(Message.text);\n    if (Fragment === null) {\n        Room.splitMessageBursts.delete(Message.username);\n        return false;\n    }\n\n    if (!Fragment) return false;\n\n    const Now = Number(Message.sentAt || Date.now());\n    const Existing = Room.splitMessageBursts.get(Message.username) || [];\n    const Entries = Existing\n        .filter(Entry => Now - Number(Entry.sentAt || 0) <= SplitMessageWindowMs)\n        .concat({\n            id: Message.id,\n            text: Fragment,\n            sentAt: Now\n        })\n        .slice(-SplitMessageMaxParts);\n\n    const Combined = Entries.map(Entry => Entry.text).join(\"\");\n    const MatchedWord = LocalChatBlockedWords.find(Word => Combined.includes(Word));\n\n    if (!MatchedWord) {\n        Room.splitMessageBursts.set(Message.username, Entries);\n        return false;\n    }\n\n    const MessageIds = new Set(Entries.map(Entry => String(Entry.id || \"\")).filter(Boolean));\n    Room.messages = Room.messages.filter(ChatMessage => !MessageIds.has(String(ChatMessage?.id || \"\")));\n\n    for (const MessageId of MessageIds) {\n        Io.to(Room.code).emit(\"room:chatRemoved\", { messageId: MessageId });\n    }\n\n    Room.splitMessageBursts.delete(Message.username);\n\n    if (!(Room.abuseStrikes instanceof Map)) Room.abuseStrikes = new Map();\n    const StrikeCount = Number(Room.abuseStrikes.get(Message.username) || 0) + 1;\n    Room.abuseStrikes.set(Message.username, StrikeCount);\n\n    const TimedOut = StrikeCount >= 3;\n    if (TimedOut) {\n        SetHostChatTimeout(\n            Room,\n            Message.username,\n            600000,\n            \"Three confirmed abuse warnings were reached.\",\n            \"Automatic moderation\"\n        );\n    }\n\n    Socket.emit(\"room:chatError\", {\n        error: \"That split-message sequence was blocked.\"\n    });\n\n    Socket.emit(\"room:moderationResult\", {\n        messageId: Message.id,\n        muted: TimedOut,\n        timedOut: TimedOut,\n        strikes: StrikeCount,\n        reason: TimedOut\n            ? \"Three confirmed abuse warnings were reached.\"\n            : \"A split-message profanity sequence was blocked.\"\n    });\n\n    EmitRoom(Room);\n    return true;\n}\n\nfunction EmitRoom(Room) {`,\n    \"host moderation helpers\"\n);\n\nReplaceRequired(\n    `        players: [...Room.players.values()].map(Player => ({\n            username: Player.username,\n            ready: Player.ready,\n            chatBanned: Room.chatBannedNames.has(Player.username)\n        })),`,\n    `        players: [...Room.players.values()].map(Player => {\n            const ChatTimeout = GetHostChatTimeout(Room, Player.username);\n            const GameRestriction = GetHostGameRestriction(Room.hostUsername, Player.username);\n            return {\n                username: Player.username,\n                ready: Player.ready,\n                chatBanned: Room.chatBannedNames.has(Player.username),\n                moderation: {\n                    chatTimedOut: Boolean(ChatTimeout),\n                    chatTimeoutUntil: Number(ChatTimeout?.until || 0),\n                    chatTimeoutIssuedBy: String(ChatTimeout?.issuedBy || \"\"),\n                    chatTimeoutReason: String(ChatTimeout?.reason || \"\"),\n                    gameBanned: Boolean(GameRestriction?.banned),\n                    gameTimedOut: Boolean(GameRestriction && !GameRestriction.banned),\n                    gameTimeoutUntil: Number(GameRestriction?.until || 0),\n                    gameReason: String(GameRestriction?.reason || \"\")\n                }\n            };\n        }),`,\n    \"public host moderation state\"\n);\n\nReplaceRequired(\n    `            const ReturningMember = Room.memberNames.has(Username);\n            CleanExpiredJoinRequests(Room);\n\n            if (Room.status !== \"lobby\" && !ReturningMember) {`,\n    `            const ReturningMember = Room.memberNames.has(Username);\n            CleanExpiredJoinRequests(Room);\n\n            const HostRestriction = GetHostGameRestriction(Room.hostUsername, Username);\n            if (HostRestriction && Username !== Room.hostUsername) {\n                return Reply({\n                    ok: false,\n                    error: HostRestriction.banned\n                        ? \"You are banned from games hosted by this player.\"\n                        : \"You are timed out from joining games hosted by this player.\"\n                });\n            }\n\n            if (Room.status !== \"lobby\" && !ReturningMember) {`,\n    \"host game restriction join gate\"\n);\n\nReplaceRequired(\n    `        Reply({\n            ok: true,\n            reportId: Queued.reportId,\n            dueAt: Queued.review.dueAt\n        });`,\n    `        Reply({\n            ok: true,\n            reportId: Queued.reportId\n        });`,\n    \"hide report review timing\"\n);\n\nReplaceRequired(\n    `    const Muted = StrikeCount >= 2;\n    if (Muted) Room.chatBannedNames.add(Message.username);\n\n    FindRoomPlayerSocket(Room, Message.username)?.emit(\"room:moderationResult\", {\n        messageId: MessageId,\n        muted: Muted,\n        strikes: StrikeCount\n    });`,\n    `    const TimedOut = StrikeCount >= 3;\n    if (TimedOut) {\n        SetHostChatTimeout(\n            Room,\n            Message.username,\n            600000,\n            \"Three confirmed abuse warnings were reached.\",\n            \"Automatic moderation\"\n        );\n    }\n\n    FindRoomPlayerSocket(Room, Message.username)?.emit(\"room:moderationResult\", {\n        messageId: MessageId,\n        muted: TimedOut,\n        timedOut: TimedOut,\n        strikes: StrikeCount,\n        reason: TimedOut\n            ? \"Three confirmed abuse warnings were reached.\"\n            : \"A reported message was confirmed as abusive.\"\n    });`,\n    \"three warning automatic timeout\"\n);\n\nReplaceRequired(\n    '    Socket.on(\"room:start\", async (Payload, Reply = () => {}) => {',\n    `    Socket.on(\"host:chatTimeout\", (Payload, Reply = () => {}) => {\n        try {\n            const Room = GetRoomForSocket(Socket);\n            if (!IsHostSocket(Room, Socket)) return Reply({ ok: false, error: \"Only the host can time out chat.\" });\n\n            const Username = ReadModerationUsername(Payload);\n            if (!Username || Username === Room.hostUsername || !Room.memberNames.has(Username)) {\n                return Reply({ ok: false, error: \"That player cannot be timed out.\" });\n            }\n\n            const TimeoutState = SetHostChatTimeout(\n                Room,\n                Username,\n                Payload?.durationMs,\n                Payload?.reason,\n                Room.hostUsername\n            );\n\n            EmitRoom(Room);\n            Reply({ ok: true, until: TimeoutState.until });\n        } catch (Error) {\n            console.error(\"Chat timeout failed\", Error);\n            Reply({ ok: false, error: \"Could not time out that player's chat.\" });\n        }\n    });\n\n    Socket.on(\"host:chatUntimeout\", (Payload, Reply = () => {}) => {\n        try {\n            const Room = GetRoomForSocket(Socket);\n            if (!IsHostSocket(Room, Socket)) return Reply({ ok: false, error: \"Only the host can remove chat timeouts.\" });\n\n            const Username = ReadModerationUsername(Payload);\n            if (!Username || Username === Room.hostUsername) {\n                return Reply({ ok: false, error: \"That player cannot be changed.\" });\n            }\n\n            ClearHostChatTimeout(Room, Username, true);\n            EmitRoom(Room);\n            Reply({ ok: true });\n        } catch (Error) {\n            console.error(\"Chat untimeout failed\", Error);\n            Reply({ ok: false, error: \"Could not remove that chat timeout.\" });\n        }\n    });\n\n    Socket.on(\"host:gameTimeout\", (Payload, Reply = () => {}) => {\n        try {\n            const Room = GetRoomForSocket(Socket);\n            if (!IsHostSocket(Room, Socket)) return Reply({ ok: false, error: \"Only the host can restrict their games.\" });\n\n            const Username = ReadModerationUsername(Payload);\n            if (!Username || Username === Room.hostUsername || !Room.memberNames.has(Username)) {\n                return Reply({ ok: false, error: \"That player cannot be restricted.\" });\n            }\n\n            const Restriction = SetHostGameRestriction(Room.hostUsername, Username, {\n                banned: false,\n                durationMs: Payload?.durationMs,\n                reason: Payload?.reason\n            });\n\n            EmitHostGameRestrictionState(Room, Username, true, Restriction);\n            EmitRoom(Room);\n            Reply({ ok: true, until: Restriction.until });\n        } catch (Error) {\n            console.error(\"Game timeout failed\", Error);\n            Reply({ ok: false, error: \"Could not restrict that player from your games.\" });\n        }\n    });\n\n    Socket.on(\"host:gameUntimeout\", (Payload, Reply = () => {}) => {\n        try {\n            const Room = GetRoomForSocket(Socket);\n            if (!IsHostSocket(Room, Socket)) return Reply({ ok: false, error: \"Only the host can remove game restrictions.\" });\n\n            const Username = ReadModerationUsername(Payload);\n            ClearHostGameRestriction(Room.hostUsername, Username);\n            EmitHostGameRestrictionState(Room, Username, false);\n            EmitRoom(Room);\n            Reply({ ok: true });\n        } catch (Error) {\n            console.error(\"Game untimeout failed\", Error);\n            Reply({ ok: false, error: \"Could not remove that game timeout.\" });\n        }\n    });\n\n    Socket.on(\"host:gameBan\", (Payload, Reply = () => {}) => {\n        try {\n            const Room = GetRoomForSocket(Socket);\n            if (!IsHostSocket(Room, Socket)) return Reply({ ok: false, error: \"Only the host can ban players from their games.\" });\n\n            const Username = ReadModerationUsername(Payload);\n            if (!Username || Username === Room.hostUsername || !Room.memberNames.has(Username)) {\n                return Reply({ ok: false, error: \"That player cannot be banned.\" });\n            }\n\n            const Restriction = SetHostGameRestriction(Room.hostUsername, Username, {\n                banned: true,\n                reason: Payload?.reason\n            });\n\n            EmitHostGameRestrictionState(Room, Username, true, Restriction);\n            EmitRoom(Room);\n            Reply({ ok: true });\n        } catch (Error) {\n            console.error(\"Game ban failed\", Error);\n            Reply({ ok: false, error: \"Could not ban that player from your games.\" });\n        }\n    });\n\n    Socket.on(\"host:gameUnban\", (Payload, Reply = () => {}) => {\n        try {\n            const Room = GetRoomForSocket(Socket);\n            if (!IsHostSocket(Room, Socket)) return Reply({ ok: false, error: \"Only the host can unban players.\" });\n\n            const Username = ReadModerationUsername(Payload);\n            ClearHostGameRestriction(Room.hostUsername, Username);\n            EmitHostGameRestrictionState(Room, Username, false);\n            EmitRoom(Room);\n            Reply({ ok: true });\n        } catch (Error) {\n            console.error(\"Game unban failed\", Error);\n            Reply({ ok: false, error: \"Could not unban that player.\" });\n        }\n    });\n\n    Socket.on(\"room:start\", async (Payload, Reply = () => {}) => {`,\n    \"host moderation socket handlers\"\n);\n\nReplaceRequired(\n    \"            Room.messages.push(Message);\\n            Room.messages = Room.messages.slice(-ChatHistoryLimit);\\n            Io.to(Room.code).emit(\\\"room:chat\\\", Message);\\n            QueueAutomaticAbuseReview(Room, Message);\\n            MaybeReplyAsStoryBot(Room, Socket, Message).catch(Error => {\\n                console.error(\\\"StoryBot background failure\\\", Error);\\n            });\",\n    \"            if (BlockSplitMessageAbuse(Room, Message, Socket)) return;\\n\\n            Room.messages.push(Message);\\n            Room.messages = Room.messages.slice(-ChatHistoryLimit);\\n            Io.to(Room.code).emit(\\\"room:chat\\\", Message);\\n            QueueAutomaticAbuseReview(Room, Message);\\n            MaybeReplyAsStoryBot(Room, Socket, Message).catch(Error => {\\n                console.error(\\\"StoryBot background failure\\\", Error);\\n            });\",\n    \"split-message profanity gate\"\n);";

const InjectionSearch = `ExtraPatches + "\\n\\nconst RuntimeModule = new Module(SourcePath, module);",`;
const InjectionReplacement = `ExtraPatches + "\\n\\n" + ${JSON.stringify(V11PatchCode)} + "\\n\\n" + ${JSON.stringify(V12PatchCode)} + "\\n\\n" + ${JSON.stringify(V13PatchCode)} + "\\n\\n" + ${JSON.stringify(V14PatchCode)} + "\\n\\n" + ${JSON.stringify(V16PatchCode)} + "\\n\\n" + ${JSON.stringify(V17PatchCode)} + "\\n\\n" + ${JSON.stringify(V18PatchCode)} + "\\n\\n" + ${JSON.stringify(V19PatchCode)} + "\\n\\n" + ${JSON.stringify(V20PatchCode)} + "\\n\\nconst RuntimeModule = new Module(SourcePath, module);",`;

ReplaceWrapperRequired(
    InjectionSearch,
    InjectionReplacement,
    "v11 source patch injection"
);

const RuntimeModule = new Module(WrapperPath, module);
RuntimeModule.filename = WrapperPath;
RuntimeModule.paths = Module._nodeModulePaths(__dirname);
RuntimeModule._compile(WrapperSource, WrapperPath);
