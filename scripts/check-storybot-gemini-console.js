"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const HelperPath = path.join(__dirname, "..", "storybot-gemini-console.js");
const HelperSource = fs.readFileSync(HelperPath, "utf8");

const PageData = {
    SNlM0e: "mock-session-token",
    cfb2h: "boq_assistant-bard-web-server_20260521.02_p1",
    FdrFJe: "12345678901234567890"
};
const Label = { style: {}, dataset: {} };
const Log = [];
let FetchCall = null;

const InnerResponse = [
    null,
    ["conversation-id", "response-id"],
    null,
    null,
    [["choice-id", ["Mock Gemini response"]]]
];
const RpcFrame = [["wrb.fr", "RxAFq", JSON.stringify(InnerResponse), null, null, null]];
const RpcLine = JSON.stringify(RpcFrame);
const MockResponseBody = ")]}'\n" + RpcLine.length + "\n" + RpcLine + "\n";

const Window = {
    WIZ_global_data: PageData,
    opener: { postMessage() {} },
    addEventListener() {},
    postMessage() {}
};
const Document = {
    documentElement: {
        lang: "en-US",
        innerHTML: '<html lang="en-US"></html>',
        appendChild() {}
    },
    getElementById(Id) {
        return Id === "StoryRewriteGeminiConsoleLabel" ? Label : null;
    },
    createElement() {
        return Label;
    }
};

const Context = {
    window: Window,
    document: Document,
    location: {
        hostname: "gemini.google.com",
        origin: "https://gemini.google.com",
        pathname: "/u/2/app"
    },
    performance: { getEntriesByType: () => [] },
    console: {
        log: (...Args) => Log.push(["log", ...Args]),
        warn: (...Args) => Log.push(["warn", ...Args]),
        error: (...Args) => Log.push(["error", ...Args])
    },
    crypto: webcrypto,
    URL,
    URLSearchParams,
    AbortController,
    setTimeout,
    clearTimeout,
    fetch: async (Url, Options) => {
        FetchCall = { url: String(Url), options: Options };
        return {
            ok: true,
            status: 200,
            text: async () => MockResponseBody
        };
    }
};

(async () => {
    vm.runInNewContext(HelperSource, Context, { filename: HelperPath });

    assert.equal(typeof Window.AskAI, "function", "the Gemini console helper must expose AskAI");
    const Answer = await Window.AskAI("Mock StoryBot test prompt");
    assert.equal(Answer, "Mock Gemini response");
    assert.ok(FetchCall, "AskAI must issue a Gemini request");

    const RequestUrl = new URL(FetchCall.url);
    assert.equal(RequestUrl.origin, "https://gemini.google.com");
    assert.equal(RequestUrl.pathname, "/u/2/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate");
    assert.equal(RequestUrl.searchParams.get("bl"), PageData.cfb2h);
    assert.equal(RequestUrl.searchParams.get("f.sid"), PageData.FdrFJe);
    assert.equal(RequestUrl.searchParams.get("hl"), "en-US");
    assert.equal(RequestUrl.searchParams.get("rt"), "c");
    assert.ok(RequestUrl.searchParams.get("_reqid"));

    const Options = FetchCall.options;
    assert.equal(Options.method, "POST");
    assert.equal(Options.credentials, "include");
    assert.equal(Options.headers["X-Goog-AuthUser"], "2");
    assert.equal(Options.headers["X-Same-Domain"], "1");

    const Form = new URLSearchParams(Options.body);
    assert.equal(Form.get("at"), PageData.SNlM0e);
    const Envelope = JSON.parse(Form.get("f.req"));
    assert.equal(Envelope[0], null);
    const Payload = JSON.parse(Envelope[1]);
    assert.deepEqual(Payload[0], ["Mock StoryBot test prompt"]);
    assert.equal(Payload[1], null);
    assert.deepEqual(Payload[2], ["", "", ""]);

    const ModelHeader = JSON.parse(Options.headers["x-goog-ext-525001261-jspb"]);
    assert.equal(ModelHeader[0], 1);
    assert.equal(ModelHeader[4], "56fdd199312815e2");
    assert.equal(ModelHeader[7], 0);
    assert.deepEqual(ModelHeader[8], [4, 5, 6, 8, 4, 5, 6, 8]);
    assert.equal(ModelHeader[11], 2);
    assert.equal(ModelHeader[14], 1);
    assert.equal(ModelHeader[15], 1);
    assert.ok(ModelHeader[16], "model header should carry its request UUID");

    const RequestMetadata = JSON.parse(Options.headers["x-goog-ext-525005358-jspb"]);
    assert.equal(RequestMetadata[0], ModelHeader[16]);
    assert.equal(RequestMetadata[1], 1);
    assert.equal(Options.headers["x-goog-ext-73010989-jspb"], "[0]");
    assert.equal(Options.headers["x-goog-ext-73010990-jspb"], "[0,0,0]");
    assert.ok(Log.some(Entry => String(Entry[1]).includes("STORYBOT GEMINI RESPONSE")));
    assert.ok(Log.some(Entry => Entry[Entry.length - 1] === "Mock Gemini response"));

    console.log("StoryBot Gemini request contract smoke test OK.");
})().catch(Error => {
    console.error(Error);
    process.exitCode = 1;
});
