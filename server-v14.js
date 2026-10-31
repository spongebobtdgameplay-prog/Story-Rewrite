const path = require("path");
const Module = require("module");

const OriginalCompile = Module.prototype._compile;
const TargetGeneratedServer = path.resolve(__dirname, "server-v8.js");
let DeletedAccountGuardApplied = false;

Module.prototype._compile = function(Content, Filename) {
    if (Filename && path.resolve(Filename) === TargetGeneratedServer) {
        let GeneratedSource = String(Content);

        const VersionAnchor = "const BackendVersion = 53;";
        if (GeneratedSource.split(VersionAnchor).length !== 2) {
            throw new Error("server-v14 deleted-account guard failed: expected backend version 53 exactly once.");
        }
        GeneratedSource = GeneratedSource.replace(VersionAnchor, "const BackendVersion = 54;");

        const AuthQuery = "WHERE Account.username_key = $1 AND story_session.token_hash = $2 AND story_session.expires_at > NOW() LIMIT 1";
        const AuthQueryMatches = GeneratedSource.split(AuthQuery).length - 1;
        if (AuthQueryMatches !== 2) {
            throw new Error("server-v14 deleted-account guard failed: expected two session account lookups, found " + AuthQueryMatches + ".");
        }
        GeneratedSource = GeneratedSource.split(AuthQuery).join(
            "WHERE Account.username_key = $1 AND Account.deleted_at IS NULL AND story_session.token_hash = $2 AND story_session.expires_at > NOW() LIMIT 1"
        );

        const DeleteRouteAnchor = "RemoveUsernameFromRooms(Account.username);";
        if (GeneratedSource.split(DeleteRouteAnchor).length !== 2) {
            throw new Error("server-v14 deleted-account guard failed: account deletion route anchor.");
        }
        GeneratedSource = GeneratedSource.replace(
            DeleteRouteAnchor,
            DeleteRouteAnchor + "\n            await Database.query(\"DELETE FROM story_rewrite_sessions WHERE username_key = $1\", [UsernameKey(Account.username)]);\n            ClearStorySessionCookie(Response);\n            DisconnectDeletedAccountSockets(Account.username);"
        );

        const ConnectionAnchor = 'Io.on("connection", Socket => {';
        if (GeneratedSource.split(ConnectionAnchor).length !== 2) {
            throw new Error("server-v14 deleted-account guard failed: socket connection anchor.");
        }
        GeneratedSource = GeneratedSource.replace(
            ConnectionAnchor,
            ConnectionAnchor + "\n    InstallDeletedAccountSocketGuard(Socket);"
        );

        const SocketGuardAnchor = 'Io.on("connection", Socket => {';
        const SocketGuardSource = [
            "function DisconnectDeletedAccountSockets(Username) {",
            "    const Key = UsernameKey(Username);",
            "    for (const Socket of Io.sockets.sockets.values()) {",
            "        if (UsernameKey(Socket.data?.username || \"\") === Key) Socket.disconnect(true);",
            "    }",
            "}",
            "",
            "function InstallDeletedAccountSocketGuard(Socket) {",
            "    const OriginalSocketOn = Socket.on.bind(Socket);",
            "    Socket.on = function(EventName, Listener) {",
            "        if ([\"disconnect\", \"disconnecting\", \"error\"].includes(EventName) || typeof Listener !== \"function\") {",
            "            return OriginalSocketOn(EventName, Listener);",
            "        }",
            "        return OriginalSocketOn(EventName, (...Args) => {",
            "            void (async () => {",
            "                try {",
            "                    await EnsureStorySocialSchema();",
            "                    const Result = await Database.query(",
            "                        \"SELECT 1 FROM accounts AS account \" +",
            "                        \"INNER JOIN story_rewrite_sessions AS session ON session.username_key = account.username_key \" +",
            "                        \"WHERE account.username_key = $1 AND account.deleted_at IS NULL \" +",
            "                        \"AND session.token_hash = $2 AND session.expires_at > NOW() LIMIT 1\",",
            "                        [UsernameKey(Socket.data?.username || \"\"), String(Socket.data?.sessionTokenHash || \"\")]",
            "                    );",
            "                    if (!Result.rowCount) {",
            "                        Socket.disconnect(true);",
            "                        return;",
            "                    }",
            "                    return Listener(...Args);",
            "                } catch (Error) {",
            "                    console.error(\"Socket account validation failed; disconnecting.\", Error);",
            "                    Socket.disconnect(true);",
            "                }",
            "            })();",
            "        });",
            "    };",
            "}",
            "",
            SocketGuardAnchor
        ].join("\n");
        GeneratedSource = GeneratedSource.replace(SocketGuardAnchor, SocketGuardSource);

        DeletedAccountGuardApplied = true;
        return OriginalCompile.call(this, GeneratedSource, Filename);
    }

    return OriginalCompile.call(this, Content, Filename);
};

try {
    require("./server-v13.js");
} finally {
    Module.prototype._compile = OriginalCompile;
}

if (!DeletedAccountGuardApplied) {
    throw new Error("server-v14 deleted-account guard did not attach to the generated server.");
}
