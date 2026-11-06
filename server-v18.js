const path = require("path");
const Module = require("module");

const OriginalCompile = Module.prototype._compile;
const TargetGeneratedServer = path.resolve(__dirname, "server-v8.js");
let YouTubeCorsPatchApplied = false;

Module.prototype._compile = function(Content, Filename) {
    if (Filename && path.resolve(Filename) === TargetGeneratedServer) {
        let Source = String(Content);
        const VersionAnchor = "const BackendVersion = 56;";
        if (Source.split(VersionAnchor).length !== 2) {
            throw new Error("server-v18 CORS patch failed: expected backend version 56 exactly once.");
        }
        Source = Source.replace(VersionAnchor, "const BackendVersion = 57;");

        const CorsAnchor = '"Access-Control-Allow-Headers": "Content-Type, Authorization",';
        if (Source.split(CorsAnchor).length !== 2) {
            throw new Error("server-v18 CORS patch failed: credentialed CORS header anchor missing.");
        }
        Source = Source.replace(CorsAnchor,
            CorsAnchor + '\n        "Access-Control-Allow-Credentials": "true",'
        );

        YouTubeCorsPatchApplied = true;
        return OriginalCompile.call(this, Source, Filename);
    }
    return OriginalCompile.call(this, Content, Filename);
};

try {
    require("./server-v17.js");
} finally {
    Module.prototype._compile = OriginalCompile;
}

if (!YouTubeCorsPatchApplied) {
    throw new Error("server-v18 credentialed CORS patch did not attach to the active backend.");
}
