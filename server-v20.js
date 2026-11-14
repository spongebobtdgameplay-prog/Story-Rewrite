const path = require("path");
const Module = require("module");

const OriginalCompile = Module.prototype._compile;
const TargetGeneratedServer = path.resolve(__dirname, "server-v8.js");
let PatchApplied = false;

Module.prototype._compile = function(Content, Filename) {
    if (Filename && path.resolve(Filename) === TargetGeneratedServer) {
        let Source = String(Content);
        const VersionAnchor = "const BackendVersion = 60;";
        if (Source.split(VersionAnchor).length !== 2) {
            throw new Error("server-v20 chat rendering patch failed: expected backend version 60 exactly once.");
        }
        Source = Source.replace(VersionAnchor, "const BackendVersion = 61;");

        const HelperAnchor = "function CleanExpiredJoinRequests(Room) {";
        if (Source.split(HelperAnchor).length !== 2) {
            throw new Error("server-v20 chat rendering patch failed: helper insertion anchor.");
        }

        const Helpers = `
function DecodeChatEntitiesV20(Value) {
    let Text = String(Value ?? "");
    for (let Pass = 0; Pass < 2; Pass += 1) {
        Text = Text
            .replace(/&#x([0-9a-f]{1,6});?/gi, (Match, Hex) => {
                const Code = Number.parseInt(Hex, 16);
                return Code > 0 && Code <= 0x10FFFF ? String.fromCodePoint(Code) : Match;
            })
            .replace(/&#([0-9]{1,7});?/g, (Match, Decimal) => {
                const Code = Number(Decimal);
                return Code > 0 && Code <= 0x10FFFF ? String.fromCodePoint(Code) : Match;
            })
            .replace(/&nbsp;/gi, " ")
            .replace(/&amp;/gi, "&")
            .replace(/&lt;/gi, "<")
            .replace(/&gt;/gi, ">")
            .replace(/&quot;/gi, '"')
            .replace(/&#39;|&apos;/gi, "'");
    }
    return Text;
}

NormalizeChatLayoutTextV19 = function(Value, MaximumLength = ChatMaxLength) {
    return DecodeChatEntitiesV20(Value)
        .replace(/\\r\\n?/g, "\\n")
        .replace(/[\\u0000-\\u0008\\u000B\\u000C-\\u001F\\u007F\\u200B-\\u200D\\uFEFF]/g, "")
        .trim()
        .slice(0, Math.max(0, Number(MaximumLength) || 0));
};

MaskChatProfanityV19 = function(Value, MaximumLength = ChatMaxLength) {
    let Text = NormalizeChatLayoutTextV19(Value, MaximumLength);
    for (const Word of ModerationFallbackWordsV19) {
        const Separators = "[\\\\s\\\\p{P}\\\\p{S}\\\\u200B-\\\\u200D\\\\uFEFF]*";
        const Pattern = new RegExp(
            "(^|[^a-z0-9])(" + Word.split("").join(Separators) + ")(?=$|[^a-z0-9])",
            "giu"
        );
        Text = Text.replace(Pattern, (FullMatch, Prefix) => Prefix + "*".repeat(Word.length));
    }
    return Text;
};

function DetectSplitProfanitySequenceV20(Room, Username, CurrentText) {
    const Recent = (Array.isArray(Room.messages) ? Room.messages : [])
        .slice(-7)
        .filter(Message => String(Message?.username || "").toLowerCase() === String(Username || "").toLowerCase())
        .map(Message => String(Message?.text || "").replace(/[^a-z0-9]/gi, "").toLowerCase())
        .filter(Part => Part.length > 0 && Part.length <= 2);
    const Current = String(CurrentText || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
    if (!Current || Current.length > 2) return false;
    const Combined = [...Recent, Current].slice(-8).join("");
    return ModerationFallbackWordsV19.some(Word => Combined.endsWith(Word));
}

`;

        Source = Source.replace(HelperAnchor, Helpers + HelperAnchor);

        const RateLimitAnchor = "        if (!AllowChatMessage(Socket)) return;";
        if (Source.split(RateLimitAnchor).length !== 2) {
            throw new Error("server-v20 chat rendering patch failed: chat rate-limit anchor.");
        }
        Source = Source.replace(
            RateLimitAnchor,
            RateLimitAnchor + "\\n\\n        const IsSplitProfanity = DetectSplitProfanitySequenceV20(Room, Socket.data.username, RawText);"
        );

        const DisplayAnchor = "            const Text = Moderation.fallback\\n                ? CensorChatTextLocalFallbackV19(RawText)\\n                : MaskChatProfanityV19(RawText);";
        if (Source.split(DisplayAnchor).length !== 2) {
            throw new Error("server-v20 chat rendering patch failed: chat display-text anchor.");
        }
        Source = Source.replace(
            DisplayAnchor,
            "            const Text = IsSplitProfanity\\n                ? \"****\"\\n                : (Moderation.fallback\\n                    ? CensorChatTextLocalFallbackV19(RawText)\\n                    : MaskChatProfanityV19(RawText));"
        );

        PatchApplied = true;
        return OriginalCompile.call(this, Source, Filename);
    }
    return OriginalCompile.call(this, Content, Filename);
};

try {
    require("./server-v19.js");
} finally {
    Module.prototype._compile = OriginalCompile;
}

if (!PatchApplied) {
    throw new Error("server-v20 chat rendering patch did not attach to the active backend.");
}
