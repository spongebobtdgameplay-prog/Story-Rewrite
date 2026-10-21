const path = require("path");
const Module = require("module");

const OriginalCompile = Module.prototype._compile;
const TargetGeneratedServer = path.resolve(__dirname, "server-v8.js");
let TtsPatchApplied = false;

Module.prototype._compile = function(Content, Filename) {
    if (Filename && path.resolve(Filename) === TargetGeneratedServer) {
        let GeneratedSource = String(Content);
        const VersionAnchor = "const BackendVersion = 49;";
        if (GeneratedSource.split(VersionAnchor).length !== 2) {
            throw new Error("server-v13 TTS patch failed: expected backend version 49 exactly once.");
        }
        GeneratedSource = GeneratedSource.replace(
            VersionAnchor,
            "const BackendVersion = 50;\nconst StoryTtsRateLimits = new Map();"
        );

        const TtsRouteAnchor = '    return SendJson(Response, 404, { error: "API route not found." }, Origin);';
        if (GeneratedSource.split(TtsRouteAnchor).length !== 2) {
            throw new Error("server-v13 TTS patch failed: API 404 insertion anchor.");
        }

        const TtsRoute = [
            '    if (RequestPath === "/api/tts" && Request.method === "POST") {',
            "        let Body;",
            "        try {",
            "            Body = await ReadJson(Request);",
            "        } catch {",
            '            return SendJson(Response, 400, { error: "Invalid speech request." }, Origin);',
            "        }",
            "",
            '        const RawText = String(Body?.text || "");',
            "        if (RawText.length > 4000) {",
            '            return SendJson(Response, 413, { error: "Speech text must be 4000 characters or fewer." }, Origin);',
            "        }",
            "        const Text = RawText",
            '            .replace(/[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]/g, " ")',
            '            .replace(/\\s+/g, " ")',
            "            .trim();",
            '        if (!Text) return SendJson(Response, 400, { error: "Speech text is required." }, Origin);',
            "",
            '        const UserKey = String(Account.usernameKey || Account.username || "").trim().toLowerCase();',
            '        if (!UserKey) return SendJson(Response, 401, { error: "Sign in required." }, Origin);',
            "        const Now = Date.now();",
            "        const Recent = (StoryTtsRateLimits.get(UserKey) || []).filter(At => Now - At < 60000);",
            "        if (Recent.length >= 12) {",
            "            StoryTtsRateLimits.set(UserKey, Recent);",
            '            return SendJson(Response, 429, { error: "Too many speech requests. Try again in a moment." }, Origin);',
            "        }",
            "        Recent.push(Now);",
            "        StoryTtsRateLimits.set(UserKey, Recent);",
            "        if (StoryTtsRateLimits.size > 2000) {",
            "            for (const [Key, Times] of StoryTtsRateLimits.entries()) {",
            "                if (!Times.some(At => Now - At < 60000)) StoryTtsRateLimits.delete(Key);",
            "            }",
            "        }",
            "",
            "        const SupportedVoices = [",
            '            "en-US-AndrewNeural",',
            '            "en-US-AndrewMultilingualNeural",',
            '            "en-US-AvaNeural",',
            '            "en-US-BrianNeural",',
            '            "en-US-EmmaNeural"',
            "        ];",
            '        const RequestedVoice = String(Body?.voice || "");',
            '        const Voice = SupportedVoices.includes(RequestedVoice) ? RequestedVoice : "en-US-AndrewNeural";',
            "",
            "        try {",
            '            const { EdgeTTS } = require("node-edge-tts");',
            "            const Tts = new EdgeTTS({",
            "                voice: Voice,",
            '                lang: "en-US",',
            '                outputFormat: "audio-24khz-96kbitrate-mono-mp3",',
            "                timeout: 60000",
            "            });",
            "            const AudioChunks = [];",
            "            for await (const Chunk of Tts.streamAudio(Text)) {",
            "                if (Buffer.isBuffer(Chunk)) AudioChunks.push(Chunk);",
            "            }",
            "            const Audio = Buffer.concat(AudioChunks);",
            '            if (!Audio.length) throw new Error("The TTS service returned no audio.");',
            "",
            "            Response.writeHead(200, {",
            '                "Content-Type": "audio/mpeg",',
            '                "Content-Length": String(Audio.length),',
            '                "Cache-Control": "no-store",',
            '                "X-Content-Type-Options": "nosniff",',
            '                "Access-Control-Allow-Origin": Origin,',
            '                "Access-Control-Allow-Credentials": "true",',
            '                "Vary": "Origin"',
            "            });",
            "            Response.end(Audio);",
            "            return;",
            "        } catch (Error) {",
            '            console.error("Story Rewrite neural TTS failed", Error);',
            '            return SendJson(Response, 502, { error: "StoryBot voice synthesis failed. Please retry." }, Origin);',
            "        }",
            "    }",
            ""
        ].join("\n");
        GeneratedSource = GeneratedSource.replace(TtsRouteAnchor, TtsRoute + "\n" + TtsRouteAnchor);
        TtsPatchApplied = true;
        return OriginalCompile.call(this, GeneratedSource, Filename);
    }

    return OriginalCompile.call(this, Content, Filename);
};

try {
    require("./server-v11.js");
} finally {
    Module.prototype._compile = OriginalCompile;
}

if (!TtsPatchApplied) {
    throw new Error("server-v13 TTS patch did not attach to the generated server.");
}
