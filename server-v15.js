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

        const LoginAnchor = "            const Account = await GetAccountByUsername(Body.username);\n            if (!Account || !ValidatePassword(Body.password) || !PasswordMatches(Body.password, Account.passwordHash)) {";
        if (GeneratedSource.split(LoginAnchor).length !== 2) {
            throw new Error("server-v15 Silicon Valley patch failed: login restriction anchor.");
        }
        GeneratedSource = GeneratedSource.replace(LoginAnchor,
            "            const Account = await GetAccountByUsername(Body.username);\n            if (!Account || !ValidatePassword(Body.password) || !PasswordMatches(Body.password, Account.passwordHash)) {"
        );

        const LoginSuccessAnchor = "            Account.save = NormalizeSave(Account.save);\n            await SaveAccount(Account);\n            const StoryIssuedToken = CreateToken(Account.username);";
        if (GeneratedSource.split(LoginSuccessAnchor).length !== 2) throw new Error("server-v15 login success anchor.");
        GeneratedSource = GeneratedSource.replace(LoginSuccessAnchor, "            if (await GetThinkRuntime().isRestricted(Account.username)) return SendJson(Response, 403, { error: \"Account access is temporarily restricted. Contact Story Rewrite support.\" }, Origin);\n" + LoginSuccessAnchor);

        const ApiGateAnchor = "    if (!Account) return SendJson(Response, 401, { error: \"Sign in required.\" }, Origin);";
        if (GeneratedSource.split(ApiGateAnchor).length !== 2) {
            throw new Error("server-v15 Silicon Valley patch failed: authenticated API gate anchor.");
        }
        GeneratedSource = GeneratedSource.replace(ApiGateAnchor,
            ApiGateAnchor + "\n" +
            "    await GetThinkRuntime().ensureSchema();\n" +
            "    if (await GetThinkRuntime().isRestricted(Account.username)) return SendJson(Response, 403, { error: \"Account access is temporarily restricted. Contact Story Rewrite support.\" }, Origin);\n" +
            "    if (RequestPath.startsWith(\"/api/think\")) return GetThinkRuntime().handle(Request, Response, RequestPath, Origin, Account);\n"
        );

        const ConnectionAnchor = 'Io.on("connection", Socket => {';
        if (GeneratedSource.split(ConnectionAnchor).length !== 2) {
            throw new Error("server-v15 Silicon Valley patch failed: Socket.IO restriction anchor.");
        }
        GeneratedSource = GeneratedSource.replace(ConnectionAnchor,
            "Io.use(async (Socket, Next) => {\n" +
            "    try {\n" +
            "        if (await GetThinkRuntime().isRestricted(Socket.data && Socket.data.username || \"\")) return Next(new Error(\"ACCOUNT_RESTRICTED\"));\n" +
            "        Next();\n" +
            "    } catch (Error) {\n" +
            "        console.error(\"Story Rewrite restriction check failed\", Error);\n" +
            "        Next(new Error(\"AUTH_REQUIRED\"));\n" +
            "    }\n" +
            "});\n\n" + ConnectionAnchor
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
