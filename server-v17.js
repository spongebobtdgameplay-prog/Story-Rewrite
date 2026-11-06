const path = require("path");
const Module = require("module");

const OriginalCompile = Module.prototype._compile;
const TargetGeneratedServer = path.resolve(__dirname, "server-v8.js");
let YouTubePatchApplied = false;

Module.prototype._compile = function(Content, Filename) {
    if (Filename && path.resolve(Filename) === TargetGeneratedServer) {
        let Source = String(Content);
        const VersionAnchor = "const BackendVersion = 55;";
        if (Source.split(VersionAnchor).length !== 2) throw new Error("server-v17 YouTube patch: expected backend version 55 exactly once.");
        Source = Source.replace(VersionAnchor, "const BackendVersion = 56;");

        const HandleAnchor = "async function HandleApi(Request, Response, RequestPath, Origin) {";
        const RuntimeSource = [
            'const YouTubeRuntimeFactory = require("./server-youtube-runtime.js");',
            "let YouTubeRuntimeInstance = null;",
            "function GetYouTubeRuntime() {",
            "    if (!YouTubeRuntimeInstance) YouTubeRuntimeInstance = YouTubeRuntimeFactory.createYouTubeRuntime({ Database, SendJson });",
            "    return YouTubeRuntimeInstance;",
            "}"
        ].join("\n");
        if (Source.split(HandleAnchor).length !== 2) throw new Error("server-v17 YouTube patch: API handler anchor missing.");
        Source = Source.replace(HandleAnchor, RuntimeSource + "\n\n" + HandleAnchor);

        const PublicAnchor = '    if (Request.method === "OPTIONS") return SendJson(Response, 204, {}, Origin);';
        if (Source.split(PublicAnchor).length !== 2) throw new Error("server-v17 YouTube patch: public callback anchor missing.");
        Source = Source.replace(PublicAnchor, PublicAnchor + '\n    if (RequestPath === "/api/youtube/callback" && Request.method === "GET") return GetYouTubeRuntime().handle(Request, Response, RequestPath, null, Origin);');

        const AuthAnchor = '    if (!Account) return SendJson(Response, 401, { error: "Sign in required." }, Origin);';
        if (Source.split(AuthAnchor).length !== 2) throw new Error("server-v17 YouTube patch: auth gate anchor missing.");
        Source = Source.replace(AuthAnchor, AuthAnchor + '\n    if (RequestPath.startsWith("/api/youtube/") && await GetYouTubeRuntime().handle(Request, Response, RequestPath, Account, Origin)) return;');

        YouTubePatchApplied = true;
        return OriginalCompile.call(this, Source, Filename);
    }
    return OriginalCompile.call(this, Content, Filename);
};

try {
    require("./server-v16.js");
} finally {
    Module.prototype._compile = OriginalCompile;
}

if (!YouTubePatchApplied) throw new Error("server-v17 YouTube patch did not attach to the active backend.");
