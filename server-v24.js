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
            "    return `${Payload}.${Signature}`;",
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
            "    const SessionId = crypto.randomBytes(16).toString(\"hex\");",
            "    const TokenId = crypto.randomBytes(24).toString(\"base64url\");",
            "    const UserKey = UsernameKey(Normalized);",
            "    const UserId = \"srw_user_\" + crypto.createHash(\"sha256\").update(UserKey).digest(\"hex\").slice(0, 24);",
            "    const AccountId = \"srw_account_\" + crypto.createHash(\"sha256\").update(UserKey).digest(\"hex\").slice(0, 24);",
            "",
            "    const Header = {",
            "        alg: \"HS256\",",
            "        typ: \"JWT\",",
            "        kid: \"srw-session-v1\"",
            "    };",
            "",
            "    const Claims = {",
            "        \"https://storyrewritegame.com/auth\": {",
            "            user_id: UserId,",
            "            account_user_id: UserId,",
            "            account_id: AccountId,",
            "            amr: [\"pwd\"],",
            "            auth_method: \"password\",",
            "            session_id: SessionId,",
            "            token_use: \"session\",",
            "            token_version: 1",
            "        },",
            "        \"https://storyrewritegame.com/profile\": {",
            "            username: Normalized",
            "        },",
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
            "        // Continue accepting existing two-part sessions so current users are not logged out.",
            "        if (Parts.length === 2) {",
            "            const [LegacyPayload, LegacySignature] = Parts;",
            "            const LegacyExpected = crypto.createHmac(\"sha256\", SessionSecret).update(LegacyPayload).digest(\"base64url\");",
            "            const LegacySignatureBuffer = Buffer.from(LegacySignature);",
            "            const LegacyExpectedBuffer = Buffer.from(LegacyExpected);",
            "            if (LegacySignatureBuffer.length !== LegacyExpectedBuffer.length) return null;",
            "            if (!crypto.timingSafeEqual(LegacySignatureBuffer, LegacyExpectedBuffer)) return null;",
            "            const LegacyClaims = JSON.parse(Buffer.from(LegacyPayload, \"base64url\").toString(\"utf8\"));",
            "            if (!LegacyClaims.username || Number(LegacyClaims.expiresAt || 0) < Date.now()) return null;",
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
            "        const AuthClaims = Claims[\"https://storyrewritegame.com/auth\"];",
            "        const ProfileClaims = Claims[\"https://storyrewritegame.com/profile\"];",
            "        const Username = NormalizeUsername(ProfileClaims?.username);",
            "        const Audience = Array.isArray(Claims.aud) ? Claims.aud : [Claims.aud];",
            "        const Now = Math.floor(Date.now() / 1000);",
            "",
            "        if (!Username || !AuthClaims || AuthClaims.token_use !== \"session\") return null;",
            "        if (Claims.iss !== \"https://storyrewritegame.com\") return null;",
            "        if (!Audience.includes(\"https://storyrewritegame.com/api\")) return null;",
            "        if (!Claims.sub || Claims.sub !== AuthClaims.user_id) return null;",
            "        if (!Claims.jti || !Claims.session_id || Claims.session_id !== AuthClaims.session_id) return null;",
            "        if (!Number.isFinite(Number(Claims.exp)) || Number(Claims.exp) <= Now) return null;",
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

        const CookieMigrationAnchor = [
            '    const StoryRequestCookieToken = GetStorySessionCookieToken(Request.headers.cookie || "");',
            "    if (StoryRequestCookieToken) SetStorySessionCookie(Response, StoryRequestCookieToken);"
        ].join("\n");
        const CookieMigrationReplacement = [
            '    const StoryRequestCookieToken = GetStorySessionCookieToken(Request.headers.cookie || "");',
            "    if (StoryRequestCookieToken) {",
            "        const StoryRequestCookieUsername = VerifyToken(StoryRequestCookieToken);",
            "        const StoryRequestCookieIsJwt = StoryRequestCookieToken.split(\".\").length === 3;",
            "        if (StoryRequestCookieUsername) {",
            "            SetStorySessionCookie(",
            "                Response,",
            "                StoryRequestCookieIsJwt ? StoryRequestCookieToken : CreateToken(StoryRequestCookieUsername)",
            "            );",
            "        }",
            "    }"
        ].join("\n");
        if (Source.split(CookieMigrationAnchor).length !== 2) {
            throw new Error("server-v24 JWT patch failed: cookie token migration anchor.");
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
