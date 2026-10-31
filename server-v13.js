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
        const VersionReplacement = "const BackendVersion = 53;\nconst StoryTtsRateLimits = new Map();\nconst StoryBotRequestRateLimits = new Map();\nconst StoryApiRequestRateLimits = new Map();\nlet StoryAuthSessionSchemaPromise = null;\nconst StorySocketTickets = new Map();\nconst StorySocketTicketLifetimeMs = 30000;\nconst StorySessionCookieName = \"__Host-story_rewrite_session\";\nfunction GetStorySessionCookieToken(CookieHeader) {\n    const Prefix = StorySessionCookieName + \"=\";\n    for (const Part of String(CookieHeader || \"\").split(\";\")) {\n        const Entry = Part.trim();\n        if (!Entry.startsWith(Prefix)) continue;\n        try { return decodeURIComponent(Entry.slice(Prefix.length)); } catch { return \"\"; }\n    }\n    return \"\";\n}\nfunction SetStorySessionCookie(Response, Token) {\n    const Parts = String(Token || \"\").split(\".\");\n    let ExpiresAt = 0;\n    try { ExpiresAt = Number(JSON.parse(Buffer.from(Parts[0] || \"\", \"base64url\").toString(\"utf8\"))?.expiresAt || 0); } catch {}\n    const MaxAge = Math.max(0, Math.floor((ExpiresAt - Date.now()) / 1000));\n    Response.setHeader(\"Set-Cookie\", StorySessionCookieName + \"=\" + encodeURIComponent(Token) + \"; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=\" + MaxAge);\n}\nfunction ClearStorySessionCookie(Response) {\n    Response.setHeader(\"Set-Cookie\", StorySessionCookieName + \"=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT\");\n}";
        GeneratedSource = GeneratedSource.replace(VersionAnchor, VersionReplacement);

        const AuthLookupAnchor = "async function GetAccountByToken(Token) {\n    const Username = VerifyToken(Token);\n    return Username ? GetAccountByUsername(Username) : null;\n}";
        const AuthLookupReplacement = "async function EnsureStoryAuthSessionSchema() {\n    if (!Database) throw new Error(\"The account database is not configured.\");\n    if (!StoryAuthSessionSchemaPromise) {\n        StoryAuthSessionSchemaPromise = (async () => {\n            await Database.query(\"CREATE TABLE IF NOT EXISTS story_rewrite_sessions (username_key TEXT PRIMARY KEY, token_hash TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW())\");\n            await Database.query(\"CREATE INDEX IF NOT EXISTS story_rewrite_sessions_expiry_idx ON story_rewrite_sessions (expires_at)\");\n            await Database.query(\"DELETE FROM story_rewrite_sessions WHERE expires_at <= NOW()\");\n        })().catch(Error => { StoryAuthSessionSchemaPromise = null; throw Error; });\n    }\n    return StoryAuthSessionSchemaPromise;\n}\n\nfunction HashStoryAuthToken(Token) { return crypto.createHash(\"sha256\").update(String(Token || \"\")).digest(\"hex\"); }\n\nasync function StoreStoryAuthSession(Username, Token) {\n    await EnsureStoryAuthSessionSchema();\n    const Parts = String(Token || \"\").split(\".\");\n    if (Parts.length !== 2) throw new Error(\"The issued session token is invalid.\");\n    const Claims = JSON.parse(Buffer.from(Parts[0], \"base64url\").toString(\"utf8\"));\n    const ExpiresAt = Number(Claims?.expiresAt || 0);\n    if (!ExpiresAt || ExpiresAt <= Date.now()) throw new Error(\"Cannot create an expired session.\");\n    const UserKey = UsernameKey(Username);\n    const TokenHash = HashStoryAuthToken(Token);\n    await Database.query(\"INSERT INTO story_rewrite_sessions (username_key, token_hash, expires_at, created_at, last_seen_at) VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT (username_key) DO UPDATE SET token_hash = EXCLUDED.token_hash, expires_at = EXCLUDED.expires_at, created_at = NOW(), last_seen_at = NOW()\", [UserKey, TokenHash, new Date(ExpiresAt)]);\n    try {\n        for (const ConnectedSocket of Io.sockets.sockets.values()) {\n            if (UsernameKey(ConnectedSocket.data?.username || \"\") !== UserKey) continue;\n            if (ConnectedSocket.data?.sessionTokenHash === TokenHash) continue;\n            ConnectedSocket.emit(\"session:conflict\", { username: String(Username || \"\") });\n            ConnectedSocket.disconnect(true);\n        }\n    } catch {}\n}\n\nasync function GetAccountByToken(Token) {\n    const Username = VerifyToken(Token);\n    if (!Username || !Database) return null;\n    await EnsureStoryAuthSessionSchema();\n    const Result = await Database.query(\"SELECT Account.username_key, Account.username, Account.password_hash, Account.save_data, Account.created_at FROM accounts AS Account INNER JOIN story_rewrite_sessions AS story_session ON story_session.username_key = Account.username_key WHERE Account.username_key = $1 AND story_session.token_hash = $2 AND story_session.expires_at > NOW() LIMIT 1\", [UsernameKey(Username), HashStoryAuthToken(Token)]);\n    if (!Result.rowCount) return null;\n    const Row = Result.rows[0];\n    return { usernameKey: Row.username_key, username: Row.username, passwordHash: Row.password_hash, save: NormalizeSave(Row.save_data), createdAt: Row.created_at instanceof Date ? Row.created_at.toISOString() : Row.created_at };\n}";
        if (GeneratedSource.split(AuthLookupAnchor).length !== 2) throw new Error("server-v13 session patch failed: account-token lookup anchor.");
        GeneratedSource = GeneratedSource.replace(AuthLookupAnchor, AuthLookupReplacement);

        const CookieAuthAnchor = "function GetBearerToken(Request) {\n    const Header = String(Request.headers.authorization || \"\");\n    return Header.startsWith(\"Bearer \") ? Header.slice(7) : \"\";\n}";
        const CookieAuthReplacement = "function GetBearerToken(Request) {\n    return GetStorySessionCookieToken(Request.headers.cookie || \"\");\n}";
        if (GeneratedSource.split(CookieAuthAnchor).length !== 2) throw new Error("server-v13 cookie patch failed: API auth helper anchor.");
        GeneratedSource = GeneratedSource.replace(CookieAuthAnchor, CookieAuthReplacement);

        const RegisterTokenAnchor = "return SendJson(Response, 201, { token: CreateToken(Username),";
        if (GeneratedSource.split(RegisterTokenAnchor).length !== 2) throw new Error("server-v13 cookie patch failed: registration token issue anchor.");
        const RegisterReplacement = "const StoryIssuedToken = CreateToken(Username);\n            await StoreStoryAuthSession(Username, StoryIssuedToken);\n            SetStorySessionCookie(Response, StoryIssuedToken);\n            return SendJson(Response, 201, {";
        GeneratedSource = GeneratedSource.replace(RegisterTokenAnchor, RegisterReplacement);

        const LoginTokenAnchor = "            return SendJson(Response, 200, {\n                token: CreateToken(Account.username),\n                profile: PublicProfile(Account),\n                save: Account.save\n            }, Origin);";
        if (GeneratedSource.split(LoginTokenAnchor).length !== 2) throw new Error("server-v13 cookie patch failed: login token issue anchor.");
        const LoginReplacement = "            const StoryIssuedToken = CreateToken(Account.username);\n            await StoreStoryAuthSession(Account.username, StoryIssuedToken);\n            SetStorySessionCookie(Response, StoryIssuedToken);\n            return SendJson(Response, 200, {\n                profile: PublicProfile(Account),\n                save: Account.save\n            }, Origin);";
        GeneratedSource = GeneratedSource.replace(LoginTokenAnchor, LoginReplacement);

        const SocketAuthAnchor = "Io.use(async (Socket, Next) => {\n    try {\n        if (!Database) return Next(new Error(\"DATABASE_UNAVAILABLE\"));\n        const Username = VerifyToken(Socket.handshake.auth?.token);\n        if (!Username) return Next(new Error(\"AUTH_REQUIRED\"));\n        const Account = await GetAccountByUsername(Username);\n        if (!Account) return Next(new Error(\"AUTH_REQUIRED\"));\n        Socket.data.username = Account.username;\n        Socket.data.chatTimes = [];\n        Next();\n    } catch (Error) {\n        console.error(\"Socket authentication failed\", Error);\n        Next(new Error(\"DATABASE_UNAVAILABLE\"));\n    }\n});";
        const SocketAuthReplacement = "Io.use(async (Socket, Next) => {\n    try {\n        if (!Database) return Next(new Error(\"DATABASE_UNAVAILABLE\"));\n        if (Socket.handshake.auth?.socketAuthError === \"SOCKET_TICKET_UNAVAILABLE\") return Next(new Error(\"SOCKET_TICKET_UNAVAILABLE\"));\n\n        let Account = null;\n        const RawTicket = String(Socket.handshake.auth?.ticket || \"\");\n        const TicketHash = RawTicket ? HashStoryAuthToken(RawTicket) : \"\";\n        const Ticket = TicketHash ? StorySocketTickets.get(TicketHash) : null;\n        if (Ticket) {\n            StorySocketTickets.delete(TicketHash);\n            if (Ticket.expiresAt <= Date.now()) return Next(new Error(\"AUTH_REQUIRED\"));\n            const Result = await Database.query(\"SELECT Account.username_key, Account.username, Account.password_hash, Account.save_data, Account.created_at FROM accounts AS Account INNER JOIN story_rewrite_sessions AS story_session ON story_session.username_key = Account.username_key WHERE Account.username_key = $1 AND story_session.token_hash = $2 AND story_session.expires_at > NOW() LIMIT 1\", [Ticket.usernameKey, Ticket.sessionTokenHash]);\n            if (!Result.rowCount) return Next(new Error(\"AUTH_REQUIRED\"));\n            const Row = Result.rows[0];\n            Account = { usernameKey: Row.username_key, username: Row.username, passwordHash: Row.password_hash, save: NormalizeSave(Row.save_data), createdAt: Row.created_at instanceof Date ? Row.created_at.toISOString() : Row.created_at };\n            Socket.data.sessionTokenHash = Ticket.sessionTokenHash;\n        } else {\n            const SessionToken = GetStorySessionCookieToken(Socket.handshake.headers?.cookie || \"\");\n            Account = await GetAccountByToken(SessionToken);\n            if (!Account) return Next(new Error(\"AUTH_REQUIRED\"));\n            Socket.data.sessionTokenHash = HashStoryAuthToken(SessionToken);\n        }\n\n        Socket.data.username = Account.username;\n        Socket.data.chatTimes = [];\n        Next();\n    } catch (Error) {\n        console.error(\"Socket authentication failed\", Error);\n        Next(new Error(\"DATABASE_UNAVAILABLE\"));\n    }\n});";
        if (GeneratedSource.split(SocketAuthAnchor).length !== 2) throw new Error("server-v13 session patch failed: Socket.IO authentication anchor.");
        GeneratedSource = GeneratedSource.replace(SocketAuthAnchor, SocketAuthReplacement);

        const ApiCorsAnchor = "\"Access-Control-Allow-Methods\": \"GET, POST, DELETE, OPTIONS\",";
        const ApiCorsReplacement = "\"Access-Control-Allow-Methods\": \"GET, POST, DELETE, OPTIONS\",\n        \"Access-Control-Allow-Credentials\": \"true\",";
        if (GeneratedSource.split(ApiCorsAnchor).length !== 2) throw new Error("server-v13 cookie patch failed: API CORS anchor.");
        GeneratedSource = GeneratedSource.replace(ApiCorsAnchor, ApiCorsReplacement);
        const SocketCorsAnchor = "        methods: [\"GET\", \"POST\"]\n    }\n});\n\nIo.use(async (Socket, Next) => {";
        const SocketCorsReplacement = "        methods: [\"GET\", \"POST\"],\n        credentials: true\n    }\n});\n\nIo.use(async (Socket, Next) => {";
        if (GeneratedSource.split(SocketCorsAnchor).length !== 2) throw new Error("server-v13 cookie patch failed: Socket.IO CORS anchor.");
        GeneratedSource = GeneratedSource.replace(SocketCorsAnchor, SocketCorsReplacement);
        const ApiGateAnchor = "    if (!Account) return SendJson(Response, 401, { error: \"Sign in required.\" }, Origin);\n    Account.save = NormalizeSave(Account.save);";
        const ApiGateReplacement = "    if (!Account) return SendJson(Response, 401, { error: \"Sign in required.\" }, Origin);\n\n    const ApiRateKey = String(Account.usernameKey || Account.username || \"\").trim().toLowerCase();\n    const ApiRateNow = Date.now();\n    const RecentApiRequests = (StoryApiRequestRateLimits.get(ApiRateKey) || []).filter(At => ApiRateNow - At < 60000);\n    if (RecentApiRequests.length >= 180) {\n        StoryApiRequestRateLimits.set(ApiRateKey, RecentApiRequests);\n        return SendJson(Response, 429, { error: \"Too many requests. Wait a moment and try again.\" }, Origin);\n    }\n    RecentApiRequests.push(ApiRateNow);\n    StoryApiRequestRateLimits.set(ApiRateKey, RecentApiRequests);\n    if (StoryApiRequestRateLimits.size > 3000) {\n        for (const [Key, Times] of StoryApiRequestRateLimits.entries()) {\n            const Active = Times.filter(At => ApiRateNow - At < 60000);\n            if (Active.length) StoryApiRequestRateLimits.set(Key, Active);\n            else StoryApiRequestRateLimits.delete(Key);\n        }\n    }\n    Account.save = NormalizeSave(Account.save);";
        if (GeneratedSource.split(ApiGateAnchor).length !== 2) throw new Error("server-v13 session patch failed: authenticated API gate anchor.");
        GeneratedSource = GeneratedSource.replace(ApiGateAnchor, ApiGateReplacement);

        const MigrationAnchor = "    let Account;\n    try {\n        Account = await GetAccountByToken(GetBearerToken(Request));";
        const MigrationRoute = "    if (RequestPath === \"/api/session/migrate\" && Request.method === \"POST\") {\n        const LegacyHeader = String(Request.headers.authorization || \"\");\n        const LegacyToken = LegacyHeader.startsWith(\"Bearer \") ? LegacyHeader.slice(7) : \"\";\n        const LegacyAccount = await GetAccountByToken(LegacyToken);\n        if (!LegacyAccount) return SendJson(Response, 401, { error: \"Sign in required.\" }, Origin);\n        const StoryIssuedToken = CreateToken(LegacyAccount.username);\n        await StoreStoryAuthSession(LegacyAccount.username, StoryIssuedToken);\n        SetStorySessionCookie(Response, StoryIssuedToken);\n        return SendJson(Response, 200, { profile: PublicProfile(LegacyAccount), migrated: true }, Origin);\n    }";
        if (GeneratedSource.split(MigrationAnchor).length !== 2) throw new Error("server-v13 cookie patch failed: legacy migration route anchor.");
        GeneratedSource = GeneratedSource.replace(MigrationAnchor, MigrationRoute + "\n" + MigrationAnchor);

        const SocketTicketRoute = "    if (RequestPath === \"/api/socket-ticket\" && Request.method === \"POST\") {\n        const SessionToken = GetStorySessionCookieToken(Request.headers.cookie || \"\");\n        const SessionTokenHash = HashStoryAuthToken(SessionToken);\n        if (!SessionToken || !SessionTokenHash) return SendJson(Response, 401, { error: \"Sign in required.\" }, Origin);\n        const Now = Date.now();\n        for (const [Key, Ticket] of StorySocketTickets.entries()) { if (Ticket.expiresAt <= Now) StorySocketTickets.delete(Key); }\n        if (StorySocketTickets.size >= 5000) return SendJson(Response, 503, { error: \"Multiplayer authentication is busy. Please retry.\" }, Origin);\n        const TicketValue = crypto.randomBytes(32).toString(\"base64url\");\n        const TicketHash = HashStoryAuthToken(TicketValue);\n        const ExpiresAt = Now + StorySocketTicketLifetimeMs;\n        StorySocketTickets.set(TicketHash, { usernameKey: UsernameKey(Account.username), sessionTokenHash: SessionTokenHash, expiresAt: ExpiresAt });\n        return SendJson(Response, 200, { ticket: TicketValue, expiresAt: ExpiresAt }, Origin);\n    }";
        const ProfileRouteAnchor = "    if (RequestPath === \"/api/me\" && Request.method === \"GET\") return SendJson(Response, 200, { profile: PublicProfile(Account) }, Origin);";
        GeneratedSource = GeneratedSource.replace(ProfileRouteAnchor, SocketTicketRoute + "\n" + ProfileRouteAnchor);
        const SessionRoute = "    if (RequestPath === \"/api/session\" && Request.method === \"DELETE\") {\n        const SessionToken = GetBearerToken(Request);\n        const SessionTokenHash = HashStoryAuthToken(SessionToken);\n        await Database.query(\n            \"DELETE FROM story_rewrite_sessions WHERE username_key = $1 AND token_hash = $2\",\n            [Account.usernameKey || UsernameKey(Account.username), SessionTokenHash]\n        );\n        for (const ConnectedSocket of Io.sockets.sockets.values()) {\n            if (UsernameKey(ConnectedSocket.data?.username || \"\") === UsernameKey(Account.username)\n                && ConnectedSocket.data?.sessionTokenHash === SessionTokenHash) ConnectedSocket.disconnect(true);\n        }\n        ClearStorySessionCookie(Response);\n        return SendJson(Response, 200, { ok: true }, Origin);\n    }\n";
        if (GeneratedSource.split(ProfileRouteAnchor).length !== 2) throw new Error("server-v13 session patch failed: profile route anchor.");
        GeneratedSource = GeneratedSource.replace(ProfileRouteAnchor, SessionRoute + ProfileRouteAnchor);

        const StoryBotAskStart = GeneratedSource.indexOf('Socket.on("storybot:ask",');
        const StoryBotAskEnd = StoryBotAskStart < 0 ? -1 : GeneratedSource.indexOf('Socket.on("room:chat"', StoryBotAskStart);
        const BotNowAnchor = "        const Now = Date.now();";
        const BotNowAt = StoryBotAskStart < 0 ? -1 : GeneratedSource.indexOf(BotNowAnchor, StoryBotAskStart);
        if (StoryBotAskStart < 0 || StoryBotAskEnd < 0 || BotNowAt < StoryBotAskStart || BotNowAt >= StoryBotAskEnd) throw new Error("server-v13 session patch failed: StoryBot handler rate-limit insertion anchor.");
        const BotRateBlock = "        \n        const BotRateKey = String(Socket.data?.username || \"\").trim().toLowerCase();\n        const BotRateNow = Date.now();\n        const RecentBotRequests = (StoryBotRequestRateLimits.get(BotRateKey) || []).filter(At => BotRateNow - At < 60000);\n        if (RecentBotRequests.length >= 8) {\n            StoryBotRequestRateLimits.set(BotRateKey, RecentBotRequests);\n            return Reply({ ok: false, error: \"StoryBot request limit reached. Try again shortly.\" });\n        }\n        RecentBotRequests.push(BotRateNow);\n        StoryBotRequestRateLimits.set(BotRateKey, RecentBotRequests);\n        if (StoryBotRequestRateLimits.size > 3000) {\n            for (const [Key, Times] of StoryBotRequestRateLimits.entries()) {\n                const Active = Times.filter(At => BotRateNow - At < 60000);\n                if (Active.length) StoryBotRequestRateLimits.set(Key, Active);\n                else StoryBotRequestRateLimits.delete(Key);\n            }\n        }";
        const BotRateInsertAt = BotNowAt + BotNowAnchor.length;
        GeneratedSource = GeneratedSource.slice(0, BotRateInsertAt) + BotRateBlock + GeneratedSource.slice(BotRateInsertAt);
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
