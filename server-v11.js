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

const ProfanityDeclaration = `const ProfanityWords = [
    "fuck", "fucking", "fucker", "shit", "bitch", "asshole", "dick", "cunt", "nigger", "nigga", "faggot", "retard"
];`;

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
    `ReplaceRequired(${JSON.stringify(ProfanityDeclaration)}, "", "remove hardcoded profanity list");`,
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

const InjectionSearch = `ExtraPatches + "\\n\\nconst RuntimeModule = new Module(SourcePath, module);",`;
const InjectionReplacement = `ExtraPatches + "\\n\\n" + ${JSON.stringify(V11PatchCode)} + "\\n\\nconst RuntimeModule = new Module(SourcePath, module);",`;

ReplaceWrapperRequired(
    InjectionSearch,
    InjectionReplacement,
    "v11 source patch injection"
);

const RuntimeModule = new Module(WrapperPath, module);
RuntimeModule.filename = WrapperPath;
RuntimeModule.paths = Module._nodeModulePaths(__dirname);
RuntimeModule._compile(WrapperSource, WrapperPath);
