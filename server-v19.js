const path = require("path");
const Module = require("module");

const OriginalCompile = Module.prototype._compile;
const TargetGeneratedServer = path.resolve(__dirname, "server-v8.js");
let ModerationPatchApplied = false;

Module.prototype._compile = function(Content, Filename) {
    if (Filename && path.resolve(Filename) === TargetGeneratedServer) {
        let Source = String(Content);

        const VersionAnchor = "const BackendVersion = 57;";
        if (Source.split(VersionAnchor).length !== 2) {
            throw new Error("server-v19 moderation patch failed: expected backend version 57 exactly once.");
        }
        Source = Source.replace(VersionAnchor, "const BackendVersion = 58;");

        const HelperAnchor = "function CleanExpiredJoinRequests(Room) {";
        if (Source.split(HelperAnchor).length !== 2) {
            throw new Error("server-v19 moderation patch failed: chat helper insertion anchor.");
        }
        const HelperCode = "const ModerationApiUrl = \"https://18.117.242.189/moderate\";\nconst ModerationRequestTimeoutMs = 4000;\nconst ModerationRetryDelayMs = 15000;\nlet ModerationUnavailableUntil = 0;\nlet ModerationFallbackLogged = false;\n\nconst ProfanityWords = [\n    \"fuck\", \"fucking\", \"fucker\", \"shit\", \"bitch\", \"asshole\",\n    \"dick\", \"cunt\", \"nigger\", \"nigga\", \"faggot\", \"retard\"\n];\n\nfunction CensorChatText(Value) {\n    let Text = NormalizeChatText(Value);\n\n    for (const Word of ProfanityWords) {\n        const Pattern = new RegExp(\"\\\\b\" + Word + \"\\\\b\", \"gi\");\n        Text = Text.replace(Pattern, Match => \"*\".repeat(Math.min(Match.length, 12)));\n    }\n\n    return Text;\n}\n\nasync function CheckRemoteChatModeration(Value) {\n    const InputText = NormalizeChatText(Value);\n    if (!InputText) return { flagged: false, categories: [], fallback: false };\n\n    const ApiKey = String(process.env.MODERATION_API_KEY || \"\").trim();\n    if (!ApiKey) {\n        if (!ModerationFallbackLogged) {\n            console.warn(\"MODERATION_API_KEY is missing; using the local hardcoded chat fallback.\");\n        }\n        ModerationFallbackLogged = true;\n        return { flagged: false, categories: [], fallback: true };\n    }\n\n    if (Date.now() < ModerationUnavailableUntil) {\n        return { flagged: false, categories: [], fallback: true };\n    }\n\n    const Controller = new AbortController();\n    const Timeout = setTimeout(() => Controller.abort(), ModerationRequestTimeoutMs);\n    Timeout.unref?.();\n\n    try {\n        const ApiResponse = await fetch(ModerationApiUrl, {\n            method: \"POST\",\n            headers: {\n                \"Content-Type\": \"application/json\",\n                \"X-Moderation-Key\": ApiKey\n            },\n            body: JSON.stringify({ text: InputText }),\n            signal: Controller.signal\n        });\n\n        if (!ApiResponse.ok) {\n            throw new Error(\"Moderation server returned HTTP \" + ApiResponse.status + \".\");\n        }\n\n        const Result = await ApiResponse.json();\n        if (typeof Result?.flagged !== \"boolean\") {\n            throw new Error(\"Moderation server returned an invalid response.\");\n        }\n\n        ModerationUnavailableUntil = 0;\n        ModerationFallbackLogged = false;\n\n        return {\n            flagged: Result.flagged,\n            categories: Array.isArray(Result.flagged_categories)\n                ? Result.flagged_categories\n                    .filter(Category => typeof Category === \"string\")\n                    .slice(0, 7)\n                : [],\n            fallback: false\n        };\n    } catch (Error) {\n        ModerationUnavailableUntil = Date.now() + ModerationRetryDelayMs;\n\n        if (!ModerationFallbackLogged) {\n            console.warn(\n                \"EC2 moderation server unavailable; using the local hardcoded chat fallback.\",\n                String(Error?.message || Error).slice(0, 180)\n            );\n        }\n\n        ModerationFallbackLogged = true;\n        return { flagged: false, categories: [], fallback: true };\n    } finally {\n        clearTimeout(Timeout);\n    }\n}";
        Source = Source.replace(HelperAnchor, HelperCode + "\n\n" + HelperAnchor);

        const ChatHandlerStart = '    Socket.on("room:chat", async Payload => {';
        const ChatHandlerEnd = '    Socket.on("room:start", async (Payload, Reply = () => {}) => {';
        if (Source.split(ChatHandlerStart).length !== 2) {
            throw new Error("server-v19 moderation patch failed: expected one active room:chat handler.");
        }

        const StartIndex = Source.indexOf(ChatHandlerStart);
        const EndIndex = Source.indexOf(ChatHandlerEnd, StartIndex);
        if (StartIndex < 0 || EndIndex < 0) {
            throw new Error("server-v19 moderation patch failed: room:chat handler boundary.");
        }

        const NewChatHandler = "    Socket.on(\"room:chat\", async Payload => {\n        const Room = GetRoomForSocket(Socket);\n        if (!Room) return;\n        if (Room.chatBannedNames.has(Socket.data.username)) {\n            Socket.emit(\"room:chatError\", { error: \"The host has disabled your room chat.\" });\n            return;\n        }\n        if (!Payload || typeof Payload !== \"object\" || Array.isArray(Payload)) return;\n\n        const RawText = NormalizeChatText(Payload.text);\n        if (!RawText) return;\n        if (RawText.length > ChatMaxLength) {\n            Socket.emit(\"room:chatError\", { error: \"Messages are limited to \" + ChatMaxLength + \" characters.\" });\n            return;\n        }\n        if (!AllowChatMessage(Socket)) return;\n\n        const Stage = StagesData.stages[Room.stageId];\n        const VoteOption = ParseVoteOption(RawText, Stage);\n        if (VoteOption !== null && Room.status === \"playing\") {\n            ToggleRoomVote(Room, Socket, VoteOption, true);\n            return;\n        }\n\n        if (Socket.data.chatFilterBusy) {\n            Socket.emit(\"room:chatError\", { error: \"Your previous message is still being checked.\" });\n            return;\n        }\n\n        Socket.data.chatFilterBusy = true;\n\n        try {\n            const Moderation = await CheckRemoteChatModeration(RawText);\n\n            if (GetRoomForSocket(Socket) !== Room || !Room.players.has(Socket.id)) return;\n\n            if (Moderation.flagged) {\n                const Detected = Moderation.categories.length\n                    ? Moderation.categories.map(Category => String(Category).replace(/_/g, \" \")).join(\", \")\n                    : \"Abusive content\";\n\n                Socket.emit(\"room:chatError\", { error: \"Your message was blocked by chat moderation.\" });\n                Socket.emit(\"room:contentWarning\", {\n                    detected: Detected,\n                    aiDetected: true,\n                    contentWarning: true\n                });\n                return;\n            }\n\n            const Text = Moderation.fallback ? CensorChatText(RawText) : RawText;\n            if (!Text) return;\n\n            const Message = { username: Socket.data.username, text: Text, sentAt: Date.now() };\n            if (BlockSplitMessageAbuse(Room, Message, Socket)) return;\n\n            Room.messages.push(Message);\n            Room.messages = Room.messages.slice(-ChatHistoryLimit);\n            Io.to(Room.code).emit(\"room:chat\", Message);\n            QueueAutomaticAbuseReview(Room, Message);\n        } catch (Error) {\n            console.error(\"Chat moderation failed\", Error);\n            Socket.emit(\"room:chatError\", {\n                error: \"Chat moderation is temporarily unavailable.\"\n            });\n        } finally {\n            Socket.data.chatFilterBusy = false;\n        }\n    });";
        Source = Source.slice(0, StartIndex)
            + NewChatHandler + "\n\n"
            + Source.slice(EndIndex);

        ModerationPatchApplied = true;
        return OriginalCompile.call(this, Source, Filename);
    }

    return OriginalCompile.call(this, Content, Filename);
};

try {
    require("./server-v18.js");
} finally {
    Module.prototype._compile = OriginalCompile;
}

if (!ModerationPatchApplied) {
    throw new Error("server-v19 moderation patch did not attach to the active backend.");
}
