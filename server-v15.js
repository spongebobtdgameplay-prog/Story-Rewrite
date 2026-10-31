const path = require("path");
const Module = require("module");

const OriginalCompile = Module.prototype._compile;
const TargetGeneratedServer = path.resolve(__dirname, "server-v8.js");
let ThinkPatchApplied = false;

Module.prototype._compile = function(Content, Filename) {
    if (Filename && path.resolve(Filename) === TargetGeneratedServer) {
        let GeneratedSource = String(Content);
        const VersionAnchor = "const BackendVersion = 54;";
        if (GeneratedSource.split(VersionAnchor).length !== 2) {
            throw new Error("server-v15 Silicon Valley patch failed: expected backend version 54 exactly once.");
        }
        GeneratedSource = GeneratedSource.replace(VersionAnchor, "const BackendVersion = 55;");

        const RuntimeAnchor = "async function HandleApi(Request, Response, RequestPath, Origin) {";
        const RuntimeSource = [
            'const ThinkRuntimeFactory = require("./server-think-runtime.js");',
            "let ThinkRuntimeInstance = null;",
            "function GetThinkRuntime() {",
            "    if (!ThinkRuntimeInstance) ThinkRuntimeInstance = ThinkRuntimeFactory.createThinkRuntime({ Database, Io, UsernameKey, ReadJson, SendJson });",
            "    return ThinkRuntimeInstance;",
            "}"
        ].join("\n");
        if (GeneratedSource.split(RuntimeAnchor).length !== 2) {
            throw new Error("server-v15 Silicon Valley patch failed: runtime insertion anchor.");
        }
        GeneratedSource = GeneratedSource.replace(RuntimeAnchor, RuntimeSource + "\n\n" + RuntimeAnchor);

        const LoginThrottleSuccessAnchor = "            ClearLoginFailure(LoginAccountFailures, AccountKey);\n            ClearLoginFailure(LoginIpFailures, IpKey);\n\n            Account.save = NormalizeSave(Account.save);";
        if (GeneratedSource.split(LoginThrottleSuccessAnchor).length !== 2) throw new Error("server-v15 login throttle success anchor.");
        GeneratedSource = GeneratedSource.replace(LoginThrottleSuccessAnchor,
            "            ClearLoginFailure(LoginAccountFailures, AccountKey);\n            ClearLoginFailure(LoginIpFailures, IpKey);\n\n            if (await GetThinkRuntime().isRestricted(Account.username)) return SendJson(Response, 403, { error: \"Account access is temporarily restricted. Contact Story Rewrite support.\" }, Origin);\n\n            Account.save = NormalizeSave(Account.save);"
        );

        const ApiGateAnchor = "    if (!Account) return SendJson(Response, 401, { error: \"Sign in required.\" }, Origin);";
        if (GeneratedSource.split(ApiGateAnchor).length !== 2) {
            throw new Error("server-v15 Silicon Valley patch failed: authenticated API gate anchor.");
        }
        GeneratedSource = GeneratedSource.replace(ApiGateAnchor,
            ApiGateAnchor + "\n" +
            "    if (RequestPath.startsWith(\"/api/think\")) return GetThinkRuntime().handle(Request, Response, RequestPath, Origin, Account);\n"
        );

        ThinkPatchApplied = true;
        return OriginalCompile.call(this, GeneratedSource, Filename);
    }
    return OriginalCompile.call(this, Content, Filename);
};

try {
    require("./server-v14.js");
} finally {
    Module.prototype._compile = OriginalCompile;
}

if (!ThinkPatchApplied) {
    throw new Error("server-v15 Silicon Valley patch did not attach to the active backend.");
}
