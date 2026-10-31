const path = require("path");
const Module = require("module");

const OriginalCompile = Module.prototype._compile;
const TargetGeneratedServer = path.resolve(__dirname, "server-v8.js");
let XaiTtsPatchApplied = false;

Module.prototype._compile = function(Content, Filename) {
    if (Filename && path.resolve(Filename) === TargetGeneratedServer) {
        let GeneratedSource = String(Content);

        const EdgeBlock = [
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
            '            if (!Audio.length) throw new Error("The TTS service returned no audio.");'
        ].join("\n");

        if (GeneratedSource.includes(EdgeBlock)) {
            const XaiBlock = [
                "            let Audio = null;",
                '            const XaiKey = String(process.env.XAI_API_KEY || "").trim();',
                '            const GrokVoices = ["eve", "ara", "rex", "leo", "sal"];',
                '            const RequestedLower = String(Body?.voice || Voice || "").trim().toLowerCase();',
                '            const GrokVoice = GrokVoices.includes(RequestedLower) ? RequestedLower : "eve";',
                "            if (XaiKey) {",
                '                const TtsResponse = await fetch("https://api.x.ai/v1/tts", {',
                '                    method: "POST",',
                "                    headers: {",
                '                        "Authorization": "Bearer " + XaiKey,',
                '                        "Content-Type": "application/json",',
                '                        "Accept": "audio/mpeg"',
                "                    },",
                "                    body: JSON.stringify({",
                "                        text: Text,",
                "                        voice_id: GrokVoice,",
                '                        language: "en"',
                "                    })",
                "                });",
                "                if (!TtsResponse.ok) {",
                '                    const Detail = await TtsResponse.text().catch(() => "");',
                '                    throw new Error("xAI TTS failed (" + TtsResponse.status + "): " + String(Detail).slice(0, 220));',
                "                }",
                "                Audio = Buffer.from(await TtsResponse.arrayBuffer());",
                "            } else {",
                '                const { EdgeTTS } = require("node-edge-tts");',
                "                const Tts = new EdgeTTS({",
                "                    voice: Voice,",
                '                    lang: "en-US",',
                '                    outputFormat: "audio-24khz-96kbitrate-mono-mp3",',
                "                    timeout: 60000",
                "                });",
                "                const AudioChunks = [];",
                "                for await (const Chunk of Tts.streamAudio(Text)) {",
                "                    if (Buffer.isBuffer(Chunk)) AudioChunks.push(Chunk);",
                "                }",
                "                Audio = Buffer.concat(AudioChunks);",
                "            }",
                '            if (!Audio || !Audio.length) throw new Error("The TTS service returned no audio.");'
            ].join("\n");

            GeneratedSource = GeneratedSource.replace(EdgeBlock, XaiBlock);
            XaiTtsPatchApplied = true;
        }

        return OriginalCompile.call(this, GeneratedSource, Filename);
    }

    return OriginalCompile.call(this, Content, Filename);
};

try {
    require("./server-v15.js");
} finally {
    Module.prototype._compile = OriginalCompile;
}

if (!XaiTtsPatchApplied) {
    console.warn("server-v16: xAI TTS patch did not attach; Edge-only TTS remains active.");
}
