"use strict";

const path = require("path");
const Module = require("module");

const OriginalCompile = Module.prototype._compile;
const TargetGeneratedServer = path.resolve(__dirname, "server-v8.js");
let JwtSessionPatchApplied = false;

Module.prototype._compile = function(Content, Filename) {
    if (Filename && path.resolve(Filename) === TargetGeneratedServer) {
        let Source = String(Content);

        const VersionAnchor = "const BackendVersion = 65;";
        if (Source.split(VersionAnchor).length !== 2) {
            throw new Error("server-v24 JWT patch failed: expected backend version 65 exactly once.");
        }
        Source = Source.replace(VersionAnchor, "const BackendVersion = 66;");

        const TokenFunctionsAnchor = [
            "function CreateToken(Username) {",
            "    const Payload = Buffer.from(JSON.stringify({",
            "        username: Username,",
            "        expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 30,",
            "        nonce: crypto.randomBytes(12).toString(\"hex\")",
            "    })).toString(\"base64url\");",
            "    const Signature = crypto.createHmac(\"sha256\", SessionSecret).update(Payload).digest(\"base64url\");",
            "    return " + String.fromCharCode(96) + "$" + "{Payload}." + "$" + "{Signature}" + String.fromCharCode(96) + ";",
            "}",
            "",
            "function VerifyToken(Token) {",
            "    try {",
            "        if (typeof Token !== \"string\" || !Token.includes(\".\")) return null;",
            "        const [Payload, Signature] = Token.split(\".\");",
            "        const Expected = crypto.createHmac(\"sha256\", SessionSecret).update(Payload).digest(\"base64url\");",
            "        const SignatureBuffer = Buffer.from(Signature);",
            "        const ExpectedBuffer = Buffer.from(Expected);",
            "        if (SignatureBuffer.length !== ExpectedBuffer.length) return null;",
            "        if (!crypto.timingSafeEqual(SignatureBuffer, ExpectedBuffer)) return null;",
            "        const Parsed = JSON.parse(Buffer.from(Payload, \"base64url\").toString(\"utf8\"));",
            "        if (!Parsed.username || Number(Parsed.expiresAt || 0) < Date.now()) return null;",
            "        return NormalizeUsername(Parsed.username);",
            "    } catch {",
            "        return null;",
            "    }",
            "}"
        ].join("\n");

        const TokenFunctionsReplacement = [
            "function CreateToken(Username) {",
            "    const Normalized = NormalizeUsername(Username);",
            "    if (!Normalized) throw new Error(\"Cannot create a session token without a username.\");",
            "",
            "    const IssuedAt = Math.floor(Date.now() / 1000);",
            "    const ExpiresAt = IssuedAt + 60 * 60 * 24 * 30;",
            "    const ExpiresAtMs = ExpiresAt * 1000;",
            "    const SessionId = crypto.randomBytes(16).toString(\"hex\");",
            "    const Nonce = crypto.randomBytes(12).toString(\"hex\");",
            "    const TokenId = crypto.randomBytes(24).toString(\"base64url\");",
            "    const UserKey = UsernameKey(Normalized);",
            "    const UserId = \"srw_user_\" + crypto.createHash(\"sha256\").update(UserKey).digest(\"hex\").slice(0, 24);",
            "",
            "    const Header = { alg: \"HS256\", typ: \"JWT\", kid: \"srw-session-v1\" };",
            "    const Claims = {",
            "        // Legacy top-level fields are retained for Story Rewrite's session store.",
            "        username: Normalized,",
            "        expiresAt: ExpiresAtMs,",
            "        nonce: Nonce,",
            "        \"https://storyrewritegame.com/auth\": {",
            "            user_id: UserId,",
            "            account_user_id: UserId,",
            "            account_id: UserId,",
            "            amr: [\"pwd\"],",
            "            auth_method: \"password\",",
            "            session_id: SessionId,",
            "            token_use: \"session\",",
            "            token_version: 1",
            "        },",
            "        \"https://storyrewritegame.com/profile\": { username: Normalized },",
            "        auth_time: IssuedAt,",
            "        session_id: SessionId,",
            "        iss: \"https://storyrewritegame.com\",",
            "        sub: UserId,",
            "        aud: [\"https://storyrewritegame.com/api\"],",
            "        client_id: \"storyrewrite_web\",",
            "        scp: [",
            "            \"profile.read\",",
            "            \"session.read\",",
            "            \"game.save.read\",",
            "            \"game.save.write\",",
            "            \"chat.read\",",
            "            \"chat.write\",",
            "            \"multiplayer.connect\"",
            "        ],",
            "        iat: IssuedAt,",
            "        exp: ExpiresAt,",
            "        jti: TokenId,",
            "        nbf: IssuedAt",
            "    };",
            "",
            "    const EncodedHeader = Buffer.from(JSON.stringify(Header)).toString(\"base64url\");",
            "    const EncodedClaims = Buffer.from(JSON.stringify(Claims)).toString(\"base64url\");",
            "    const SigningInput = EncodedHeader + \".\" + EncodedClaims;",
            "    const Signature = crypto.createHmac(\"sha256\", SessionSecret).update(SigningInput).digest(\"base64url\");",
            "    return SigningInput + \".\" + Signature;",
            "}",
            "",
            "function VerifyToken(Token) {",
            "    try {",
            "        if (typeof Token !== \"string\") return null;",
            "        const Parts = Token.split(\".\");",
            "",
            "        // Preserve legacy two-part sessions until each browser makes an authenticated request.",
            "        if (Parts.length === 2 && Parts[0] && Parts[1]) {",
            "            const [LegacyPayload, LegacySignature] = Parts;",
            "            const LegacyExpected = crypto.createHmac(\"sha256\", SessionSecret).update(LegacyPayload).digest(\"base64url\");",
            "            const Actual = Buffer.from(LegacySignature);",
            "            const Expected = Buffer.from(LegacyExpected);",
            "            if (Actual.length !== Expected.length || !crypto.timingSafeEqual(Actual, Expected)) return null;",
            "            const LegacyClaims = JSON.parse(Buffer.from(LegacyPayload, \"base64url\").toString(\"utf8\"));",
            "            if (!LegacyClaims.username || Number(LegacyClaims.expiresAt || 0) <= Date.now()) return null;",
            "            return NormalizeUsername(LegacyClaims.username);",
            "        }",
            "",
            "        if (Parts.length !== 3 || Parts.some(Part => !Part)) return null;",
            "        const [EncodedHeader, EncodedClaims, EncodedSignature] = Parts;",
            "        const Header = JSON.parse(Buffer.from(EncodedHeader, \"base64url\").toString(\"utf8\"));",
            "        if (Header.alg !== \"HS256\" || Header.typ !== \"JWT\" || Header.kid !== \"srw-session-v1\") return null;",
            "",
            "        const SigningInput = EncodedHeader + \".\" + EncodedClaims;",
            "        const ExpectedSignature = crypto.createHmac(\"sha256\", SessionSecret).update(SigningInput).digest();",
            "        const ActualSignature = Buffer.from(EncodedSignature, \"base64url\");",
            "        if (ActualSignature.length !== ExpectedSignature.length) return null;",
            "        if (!crypto.timingSafeEqual(ActualSignature, ExpectedSignature)) return null;",
            "",
            "        const Claims = JSON.parse(Buffer.from(EncodedClaims, \"base64url\").toString(\"utf8\"));",
            "        const Username = NormalizeUsername(Claims.username || Claims[\"https://storyrewritegame.com/profile\"]?.username);",
            "        const Audience = Array.isArray(Claims.aud) ? Claims.aud : [Claims.aud];",
            "        const Now = Math.floor(Date.now() / 1000);",
            "        const ExpiresAtMs = Number(Claims.expiresAt || 0);",
            "",
            "        if (!Username || !Claims.jti || !Claims.nonce || !Claims.session_id) return null;",
            "        if (Claims.iss !== \"https://storyrewritegame.com\") return null;",
            "        if (!Audience.includes(\"https://storyrewritegame.com/api\")) return null;",
            "        if (Claims.sub !== \"srw_user_\" + crypto.createHash(\"sha256\").update(UsernameKey(Username)).digest(\"hex\").slice(0, 24)) return null;",
            "        if (!Number.isFinite(Number(Claims.exp)) || Number(Claims.exp) <= Now) return null;",
            "        if (!Number.isFinite(ExpiresAtMs) || ExpiresAtMs <= Date.now()) return null;",
            "        if (!Number.isFinite(Number(Claims.nbf)) || Number(Claims.nbf) > Now + 10) return null;",
            "        if (!Number.isFinite(Number(Claims.iat)) || Number(Claims.iat) > Now + 60) return null;",
            "",
            "        return Username;",
            "    } catch {",
            "        return null;",
            "    }",
            "}"
        ].join("\n");

        if (Source.split(TokenFunctionsAnchor).length !== 2) {
            throw new Error("server-v24 JWT patch failed: token function anchor.");
        }
        Source = Source.replace(TokenFunctionsAnchor, TokenFunctionsReplacement);

        const SessionStoreAnchor = [
            "    const Parts = String(Token || \"\").split(\".\");",
            "    if (Parts.length !== 2) throw new Error(\"The issued session token is invalid.\");",
            "    const Claims = JSON.parse(Buffer.from(Parts[0], \"base64url\").toString(\"utf8\"));",
            "    const ExpiresAt = Number(Claims?.expiresAt || 0);"
        ].join("\n");
        const SessionStoreReplacement = [
            "    const Parts = String(Token || \"\").split(\".\");",
            "    const PayloadPart = Parts.length === 2 ? Parts[0] : Parts.length === 3 ? Parts[1] : \"\";",
            "    if (!PayloadPart) throw new Error(\"The issued session token is invalid.\");",
            "    const Claims = JSON.parse(Buffer.from(PayloadPart, \"base64url\").toString(\"utf8\"));",
            "    const ExpiresAt = Number(Claims?.expiresAt || (Number(Claims?.exp || 0) * 1000));"
        ].join("\n");
        if (Source.split(SessionStoreAnchor).length !== 2) {
            throw new Error("server-v24 JWT patch failed: session-store token parser anchor.");
        }
        Source = Source.replace(SessionStoreAnchor, SessionStoreReplacement);

        const CookieExpiryParserAnchor = '    try { ExpiresAt = Number(JSON.parse(Buffer.from(Parts[0] || "", "base64url").toString("utf8"))?.expiresAt || 0); } catch {}';
        const CookieExpiryParserReplacement = [
            "    const PayloadPart = Parts.length === 3 ? Parts[1] : Parts[0];",
            '    try { ExpiresAt = Number(JSON.parse(Buffer.from(PayloadPart || "", "base64url").toString("utf8"))?.expiresAt || 0); } catch {}'
        ].join("\n");
        if (Source.split(CookieExpiryParserAnchor).length !== 2) {
            throw new Error("server-v24 JWT patch failed: cookie expiry parser anchor.");
        }
        Source = Source.replace(CookieExpiryParserAnchor, CookieExpiryParserReplacement);

        const CookieMigrationAnchor = [
            '    const StoryRequestCookieToken = GetStorySessionCookieToken(Request.headers.cookie || "");',
            "    if (StoryRequestCookieToken) SetStorySessionCookie(Response, StoryRequestCookieToken);"
        ].join("\n");
        const CookieMigrationReplacement = [
            '    const StoryRequestCookieToken = GetStorySessionCookieToken(Request.headers.cookie || "");',
            "    if (StoryRequestCookieToken) {",
            "        if (StoryRequestCookieToken.split(\".\").length === 3) {",
            "            SetStorySessionCookie(Response, StoryRequestCookieToken);",
            "        } else {",
            "            const StoryMigratedToken = CreateToken(Account.username);",
            "            await StoreStoryAuthSession(Account.username, StoryMigratedToken);",
            "            SetStorySessionCookie(Response, StoryMigratedToken);",
            "        }",
            "    }"
        ].join("\n");
        if (Source.split(CookieMigrationAnchor).length !== 2) {
            throw new Error("server-v24 JWT patch failed: legacy cookie migration anchor.");
        }
        Source = Source.replace(CookieMigrationAnchor, CookieMigrationReplacement);

        JwtSessionPatchApplied = true;
        return OriginalCompile.call(this, Source, Filename);
    }

    return OriginalCompile.call(this, Content, Filename);
};

try {
    require("./server-v23.js");
} finally {
    Module.prototype._compile = OriginalCompile;
}

if (!JwtSessionPatchApplied) {
    throw new Error("server-v24 JWT patch did not attach to the active backend.");
}
