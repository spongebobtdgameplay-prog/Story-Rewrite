const path = require("path");
const Module = require("module");

const OriginalCompile = Module.prototype._compile;
const TargetGeneratedServer = path.resolve(__dirname, "server-v8.js");
let PatchApplied = false;

Module.prototype._compile = function(Content, Filename) {
    if (Filename && path.resolve(Filename) === TargetGeneratedServer) {
        let Source = String(Content);
        const VersionAnchor = "const BackendVersion = 64;";
        if (Source.split(VersionAnchor).length !== 2) {
            throw new Error("server-v23 cookie-session patch failed: expected backend version 64 exactly once.");
        }
        Source = Source.replace(VersionAnchor, "const BackendVersion = 65;");

        const HelperAnchor = "function CleanExpiredJoinRequests(Room) {";
        if (Source.split(HelperAnchor).length !== 2) {
            throw new Error("server-v23 cookie-session patch failed: helper insertion anchor.");
        }

        const Helpers = [
            'const StorySessionCookieName = "story_rewrite_session";',
            "const StorySessionCookieMaxAge = 60 * 60 * 24 * 30;",
            "",
            "function GetStoryCookieToken(Request) {",
            '    const Header = String(Request.headers.cookie || "");',
            '    for (const Part of Header.split(";")) {',
            '        const Separator = Part.indexOf("=");',
            "        if (Separator < 0) continue;",
            '        if (Part.slice(0, Separator).trim() !== StorySessionCookieName) continue;',
            "        return Part.slice(Separator + 1).trim();",
            "    }",
            '    return "";',
            "}",
            "",
            "function SetStorySessionCookie(Response, Token) {",
            '    Response.setHeader("Set-Cookie", StorySessionCookieName + "=" + String(Token || "")',
            '        + "; Path=/; Max-Age=" + StorySessionCookieMaxAge + "; HttpOnly; Secure; SameSite=Lax");',
            "}",
            "",
            "function ClearStorySessionCookie(Response) {",
            '    Response.setHeader("Set-Cookie", StorySessionCookieName + "=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax");',
            "}",
            ""
        ].join("\n");
        Source = Source.replace(HelperAnchor, Helpers + HelperAnchor);

        const RegisterResponseAnchor =
            '            return SendJson(Response, 201, { token: CreateToken(Username), profile: PublicProfile(Account), save: Account.save }, Origin);';
        if (Source.split(RegisterResponseAnchor).length !== 2) {
            throw new Error("server-v23 cookie-session patch failed: registration response anchor.");
        }
        Source = Source.replace(RegisterResponseAnchor,
            "            SetStorySessionCookie(Response, CreateToken(Username));\n" +
            "            return SendJson(Response, 201, { profile: PublicProfile(Account), save: Account.save }, Origin);"
        );

        const LoginResponseAnchor =
            '            return SendJson(Response, 200, { token: CreateToken(Account.username), profile: PublicProfile(Account), save: Account.save }, Origin);';
        if (Source.split(LoginResponseAnchor).length !== 2) {
            throw new Error("server-v23 cookie-session patch failed: login response anchor.");
        }
        Source = Source.replace(LoginResponseAnchor,
            "            SetStorySessionCookie(Response, CreateToken(Account.username));\n" +
            "            return SendJson(Response, 200, { profile: PublicProfile(Account), save: Account.save }, Origin);"
        );

        const AuthAnchor = "        Account = await GetAccountByToken(GetBearerToken(Request));";
        if (Source.split(AuthAnchor).length !== 1) {
            throw new Error("server-v23 cookie-session patch failed: authenticated request anchor.");
        }
        Source = Source.replace(AuthAnchor,
            "        Account = await GetAccountByToken(GetBearerToken(Request) || GetStoryCookieToken(Request));"
        );

        const SessionRoutesAnchor =
            '    if (RequestPath === "/api/register" && Request.method === "POST") {';
        if (Source.split(SessionRoutesAnchor).length !== 2) {
            throw new Error("server-v23 cookie-session patch failed: session route insertion anchor.");
        }
        const SessionRoutes = [
            '    if (RequestPath === "/api/session" && Request.method === "DELETE") {',
            "        ClearStorySessionCookie(Response);",
            '        return SendJson(Response, 200, { ok: true }, Origin);',
            "    }",
            "",
            '    if (RequestPath === "/api/session/migrate" && Request.method === "POST") {',
            "        const LegacyToken = GetBearerToken(Request);",
            "        let LegacyAccount;",
            "        try {",
            "            LegacyAccount = await GetAccountByToken(LegacyToken);",
            "        } catch (Error) {",
            '            console.error("Session migration account lookup failed", Error);',
            '            return SendJson(Response, 503, { error: "Account database unavailable." }, Origin);',
            "        }",
            '        if (!LegacyAccount) return SendJson(Response, 401, { error: "Sign in required." }, Origin);',
            "        SetStorySessionCookie(Response, CreateToken(LegacyAccount.username));",
            '        return SendJson(Response, 200, { profile: PublicProfile(LegacyAccount) }, Origin);',
            "    }",
            ""
        ].join("\n");
        Source = Source.replace(SessionRoutesAnchor, SessionRoutes + SessionRoutesAnchor);

        PatchApplied = true;
        return OriginalCompile.call(this, Source, Filename);
    }
    return OriginalCompile.call(this, Content, Filename);
};

try {
    require("./server-v22.js");
} finally {
    Module.prototype._compile = OriginalCompile;
}

if (!PatchApplied) {
    throw new Error("server-v23 cookie-session patch did not attach to the active backend.");
}
