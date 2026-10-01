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
const OpenAIApiKey = String(process.env.GROQ_API_KEY || "").trim();
const OpenAIModel = String(process.env.GROQ_MODEL || "openai/gpt-oss-120b").trim();
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
    const RecentChat = Room.messages.slice(-20).map(Message => ({
        username: Message.username,
        text: Message.text
    }));

    const Context = {
        room: {
            code: Room.code,
            status: Room.status,
            lives: Room.lives,
            maxLives: Room.maxLives,
            hostUsername: Room.hostUsername,
            players: [...Room.players.values()].map(Player => ({
                username: Player.username,
                ready: Boolean(Player.ready)
            }))
        },
        stage: Stage ? {
            id: Stage.id,
            name: Stage.name,
            objective: Stage.objective,
            threat: Stage.threat,
            survivalRule: Stage.survivalRule,
            hint: Stage.hint,
            sentences: Array.isArray(Stage.sentences) ? Stage.sentences : [],
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
        const ApiResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": "Bearer " + OpenAIApiKey,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: OpenAIModel,
                messages: [
                    {
                        role: "system",
                        content: "You are StoryBot, the in-game cooperative AI assistant for Story Rewrite multiplayer. Use only the supplied live room and stage context. Reason carefully about the current objective, threat, sentence choices, votes, consequences, and what players have said. Do not invent hidden room state, player actions, or story facts. Distinguish what is known from what is uncertain. When players ask for help, explain the reasoning briefly and concretely. Do not pretend to be a player. Keep replies natural and concise, usually two or three sentences."
                    },
                    {
                        role: "user",
                        content: JSON.stringify(Context)
                    }
                ],
                temperature: 0.55,
                top_p: 0.9,
                max_tokens: 220
            }),
            signal: Controller.signal
        });

        const ResponseData = await ApiResponse.json().catch(() => ({}));
        if (!ApiResponse.ok) {
            throw new Error(ResponseData?.error?.message || "Groq StoryBot request failed.");
        }

        const Reply = String(ResponseData?.choices?.[0]?.message?.content || "").trim();
        if (!Reply) throw new Error("StoryBot returned an empty response.");

        return typeof NormalizeChatText === "function"
            ? NormalizeChatText(Reply).slice(0, 500)
            : Reply.slice(0, 500);
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
