"use strict";

const path = require("path");
const Module = require("module");

const OriginalCompile = Module.prototype._compile;
const TargetGeneratedServer = path.resolve(__dirname, "server-v8.js");
let CookieRenamePatchApplied = false;

Module.prototype._compile = function(Content, Filename) {
    if (Filename && path.resolve(Filename) === TargetGeneratedServer) {
        let Source = String(Content);

        const VersionAnchor = "const BackendVersion = 64;";
        if (Source.split(VersionAnchor).length !== 2) {
            throw new Error("server-v23 cookie rename failed: expected backend version 64 exactly once.");
        }
        Source = Source.replace(VersionAnchor, "const BackendVersion = 65;");

        const CookieNameAnchor = 'const StorySessionCookieName = "__Host-story_rewrite_session";';
        if (Source.split(CookieNameAnchor).length !== 2) {
            throw new Error("server-v23 cookie rename failed: existing cookie name anchor.");
        }
        Source = Source.replace(
            CookieNameAnchor,
            'const StorySessionCookieName = "__Host-srw_k9p4x2_r1";\nconst StoryLegacySessionCookieName = "__Host-story_rewrite_session";'
        );

        const CookieReaderAnchor = [
            "function GetStorySessionCookieToken(CookieHeader) {",
            "    const Prefix = StorySessionCookieName + \"=\";",
            "    for (const Part of String(CookieHeader || \"\").split(\";\")) {",
            "        const Entry = Part.trim();",
            "        if (!Entry.startsWith(Prefix)) continue;",
            "        try { return decodeURIComponent(Entry.slice(Prefix.length)); } catch { return \"\"; }",
            "    }",
            "    return \"\";",
            "}"
        ].join("\n");
        const CookieReaderReplacement = [
            "function GetStorySessionCookieToken(CookieHeader) {",
            "    const Parts = String(CookieHeader || \"\").split(\";\");",
            "    for (const CookieName of [StorySessionCookieName, StoryLegacySessionCookieName]) {",
            "        const Prefix = CookieName + \"=\";",
            "        for (const Part of Parts) {",
            "            const Entry = Part.trim();",
            "            if (!Entry.startsWith(Prefix)) continue;",
            "            try { return decodeURIComponent(Entry.slice(Prefix.length)); } catch { continue; }",
            "        }",
            "    }",
            "    return \"\";",
            "}"
        ].join("\n");
        if (Source.split(CookieReaderAnchor).length !== 2) {
            throw new Error("server-v23 cookie rename failed: cookie reader anchor.");
        }
        Source = Source.replace(CookieReaderAnchor, CookieReaderReplacement);

        const SetCookieAnchor = 'Response.setHeader("Set-Cookie", StorySessionCookieName + "=" + encodeURIComponent(Token) + "; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=" + MaxAge);';
        const SetCookieReplacement = [
            'Response.setHeader("Set-Cookie", [',
            '    StorySessionCookieName + "=" + encodeURIComponent(Token) + "; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=" + MaxAge,',
            '    StoryLegacySessionCookieName + "=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT"',
            ']);'
        ].join("\n");
        if (Source.split(SetCookieAnchor).length !== 2) {
            throw new Error("server-v23 cookie rename failed: cookie setter anchor.");
        }
        Source = Source.replace(SetCookieAnchor, SetCookieReplacement);

        const ClearCookieAnchor = 'Response.setHeader("Set-Cookie", StorySessionCookieName + "=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT");';
        const ClearCookieReplacement = [
            'Response.setHeader("Set-Cookie", [',
            '    StorySessionCookieName + "=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT",',
            '    StoryLegacySessionCookieName + "=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT"',
            ']);'
        ].join("\n");
        if (Source.split(ClearCookieAnchor).length !== 2) {
            throw new Error("server-v23 cookie rename failed: cookie clearing anchor.");
        }
        Source = Source.replace(ClearCookieAnchor, ClearCookieReplacement);

        const AuthenticatedApiAnchor = '    if (!Account) return SendJson(Response, 401, { error: "Sign in required." }, Origin);';
        const AuthenticatedApiReplacement = AuthenticatedApiAnchor + [
            "",
            "",
            '    const StoryRequestCookieToken = GetStorySessionCookieToken(Request.headers.cookie || "");',
            "    if (StoryRequestCookieToken) SetStorySessionCookie(Response, StoryRequestCookieToken);"
        ].join("\n");
        if (Source.split(AuthenticatedApiAnchor).length !== 2) {
            throw new Error("server-v23 cookie rename failed: authenticated API gate anchor.");
        }
        Source = Source.replace(AuthenticatedApiAnchor, AuthenticatedApiReplacement);

        CookieRenamePatchApplied = true;
        return OriginalCompile.call(this, Source, Filename);
    }

    return OriginalCompile.call(this, Content, Filename);
};

try {
    require("./server-v22.js");
} finally {
    Module.prototype._compile = OriginalCompile;
}

if (!CookieRenamePatchApplied) {
    throw new Error("server-v23 cookie rename patch did not attach to the active backend.");
}
