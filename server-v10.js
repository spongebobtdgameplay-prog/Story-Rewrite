const fs = require("fs");
const path = require("path");
const Module = require("module");

const WrapperPath = path.join(__dirname, "server-v9.js");
let WrapperSource = fs.readFileSync(WrapperPath, "utf8");

function ReplaceWrapperRequired(Search, Replacement, Label) {
    if (!WrapperSource.includes(Search)) {
        throw new Error(`server-v10 patch failed: ${Label}`);
    }
    WrapperSource = WrapperSource.replace(Search, Replacement);
}

ReplaceWrapperRequired(
    '"const BackendVersion = 9;"',
    '"const BackendVersion = 10;"',
    "backend version"
);

const AIConstantsSearch = "const JoinRequestLifetime = 45000;";
const AIConstantsReplacement = `const JoinRequestLifetime = 45000;
const OpenAIApiKey = String(process.env.OPENAI_API_KEY || "").trim();
const OpenAIModel = String(process.env.OPENAI_MODEL || "gpt-5.6").trim();
const StoryBotName = "StoryBot";
const StoryBotCooldown = 4000;
const StoryBotTimeout = 20000;
const StoryBotContextMessages = 12;`;

const AIRoomStateSearch = "        moderationRevision: 0";
const AIRoomStateReplacement = `        moderationRevision: 0,
        botBusy: false,
        lastBotAt: 0`;

const AIHelpers = `function IsStoryBotMention(Text) {
    const Value = String(Text || "");
    return /(^|\\s)@storybot\\b/i.test(Value) || /^\\s*\\/bot\\b/i.test(Value);
}

function GetStoryBotQuestion(Text) {
    return String(Text || "")
        .replace(/(^|\\s)@storybot\\b/ig, " ")
        .replace(/^\\s*\\/bot\\b/i, "")
        .replace(/\\s+/g, " ")
        .trim();
}

function ReadOpenAIOutput(ResponseData) {
    if (typeof ResponseData?.output_text === "string") return ResponseData.output_text.trim();

    const Parts = [];
    for (const Item of Array.isArray(ResponseData?.output) ? ResponseData.output : []) {
        for (const Content of Array.isArray(Item?.content) ? Item.content : []) {
            if (Content?.type === "output_text" && typeof Content.text === "string") Parts.push(Content.text);
        }
    }
    return Parts.join(" ").trim();
}

async function GenerateStoryBotReply(Room, Username, Question) {
    if (!OpenAIApiKey) throw new Error("AI_NOT_CONFIGURED");

    const Stage = StagesData.stages[Room.stageId] || null;
    const VoteState = GetVoteState(Room);
    const RecentChat = Room.messages.slice(-StoryBotContextMessages).map(Message => ({
        username: Message.username,
        text: Message.text
    }));

    const Context = {
        room: {
            status: Room.status,
            lives: Room.lives,
            maxLives: Room.maxLives,
            players: [...Room.players.values()].map(Player => Player.username)
        },
        stage: Stage ? {
            id: Stage.id,
            name: Stage.name,
            objective: Stage.objective,
            threat: Stage.threat,
            survivalRule: Stage.survivalRule,
            hint: Stage.hint,
            sentences: Stage.sentences,
            selectedIndexes: VoteState.selectedIndexes,
            voteThreshold: VoteState.threshold
        } : null,
        recentChat: RecentChat,
        askingPlayer: Username,
        question: Question || "Help the room decide what to do next."
    };

    const Controller = new AbortController();
    const Timeout = setTimeout(() => Controller.abort(), StoryBotTimeout);

    try {
        const ApiResponse = await fetch("https://api.openai.com/v1/responses", {
            method: "POST",
            headers: {
                "Authorization": "Bearer " + OpenAIApiKey,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: OpenAIModel,
                store: false,
                instructions: "You are StoryBot, an in-game cooperative assistant for Story Rewrite. Reply naturally to the players using only the supplied live game context. Be concise enough for group chat, usually one or two short sentences. Help reason about causes, consequences, voting, survival, multiplayer controls, or the current discussion. Do not invent room state that is not supplied. Do not claim to be a human player. If the players ask for the direct puzzle solution, you may explain your reasoning instead of using canned answers.",
                input: JSON.stringify(Context),
                max_output_tokens: 140
            }),
            signal: Controller.signal
        });

        const ResponseData = await ApiResponse.json().catch(() => ({}));
        if (!ApiResponse.ok) {
            const ErrorMessage = ResponseData?.error?.message || "OpenAI request failed.";
            throw new Error(ErrorMessage);
        }

        const Reply = ReadOpenAIOutput(ResponseData);
        if (!Reply) throw new Error("StoryBot returned an empty response.");
        return CensorChatText(Reply);
    } finally {
        clearTimeout(Timeout);
    }
}

async function MaybeReplyAsStoryBot(Room, Socket, Message) {
    if (!Room || !Socket || !Message || !IsStoryBotMention(Message.text)) return;

    if (!OpenAIApiKey) {
        Socket.emit("room:botError", { error: "StoryBot is not configured on the server yet." });
        return;
    }

    const Now = Date.now();
    if (Room.botBusy) {
        Socket.emit("room:botError", { error: "StoryBot is already answering someone." });
        return;
    }
    if (Now - Number(Room.lastBotAt || 0) < StoryBotCooldown) {
        Socket.emit("room:botError", { error: "StoryBot needs a moment before the next question." });
        return;
    }

    Room.botBusy = true;
    Room.lastBotAt = Now;
    Io.to(Room.code).emit("room:botTyping", { typing: true, username: StoryBotName });

    try {
        const ReplyText = await GenerateStoryBotReply(
            Room,
            Socket.data.username,
            GetStoryBotQuestion(Message.text)
        );

        if (!ReplyText) return;

        const BotMessage = {
            username: StoryBotName,
            text: ReplyText,
            sentAt: Date.now(),
            bot: true
        };

        Room.messages.push(BotMessage);
        Room.messages = Room.messages.slice(-ChatHistoryLimit);
        Io.to(Room.code).emit("room:chat", BotMessage);
    } catch (Error) {
        console.error("StoryBot request failed", Error);
        Socket.emit("room:botError", {
            error: Error?.name === "AbortError"
                ? "StoryBot took too long to answer."
                : "StoryBot could not answer right now."
        });
    } finally {
        Room.botBusy = false;
        Io.to(Room.code).emit("room:botTyping", { typing: false, username: StoryBotName });
    }
}
`;

const ChatBroadcastSearch = '        Io.to(Room.code).emit("room:chat", Message);';
const ChatBroadcastReplacement = `        Io.to(Room.code).emit("room:chat", Message);
        MaybeReplyAsStoryBot(Room, Socket, Message).catch(Error => {
            console.error("StoryBot background failure", Error);
        });`;

const ExtraPatches = [
    `ReplaceRequired(${JSON.stringify(AIConstantsSearch)}, ${JSON.stringify(AIConstantsReplacement)}, "AI constants");`,
    `ReplaceRequired(${JSON.stringify(AIRoomStateSearch)}, ${JSON.stringify(AIRoomStateReplacement)}, "AI room state");`,
    `ReplaceRequired(${JSON.stringify("function EmitRoom(Room) {")}, ${JSON.stringify(AIHelpers + "\nfunction EmitRoom(Room) {")}, "AI helpers");`,
    `ReplaceRequired(${JSON.stringify(ChatBroadcastSearch)}, ${JSON.stringify(ChatBroadcastReplacement)}, "AI chat trigger");`
].join("\n\n");

ReplaceWrapperRequired(
    "const RuntimeModule = new Module(SourcePath, module);",
    ExtraPatches + "\n\nconst RuntimeModule = new Module(SourcePath, module);",
    "AI patch injection"
);

const RuntimeModule = new Module(WrapperPath, module);
RuntimeModule.filename = WrapperPath;
RuntimeModule.paths = Module._nodeModulePaths(__dirname);
RuntimeModule._compile(WrapperSource, WrapperPath);
