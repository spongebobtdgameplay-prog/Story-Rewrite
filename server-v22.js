const path = require("path");
const Module = require("module");

const OriginalCompile = Module.prototype._compile;
const TargetGeneratedServer = path.resolve(__dirname, "server-v8.js");
let PatchApplied = false;

Module.prototype._compile = function(Content, Filename) {
    if (Filename && path.resolve(Filename) === TargetGeneratedServer) {
        let Source = String(Content);
        const VersionAnchor = "const BackendVersion = 62;";
        if (Source.split(VersionAnchor).length !== 2) {
            throw new Error("server-v22 Turnstile patch failed: expected backend version 62 exactly once.");
        }
        Source = Source.replace(VersionAnchor, "const BackendVersion = 64;");

        const HelperAnchor = "function CleanExpiredJoinRequests(Room) {";
        if (Source.split(HelperAnchor).length !== 2) {
            throw new Error("server-v22 Turnstile patch failed: helper insertion anchor.");
        }

        const Helpers = String.raw`
const AuthorizedAiRateLimits = new Map();
const AuthorizedAiWindowMs = 60 * 1000;
const AuthorizedAiMaxRequests = 8;

function TakeAuthorizedAiRateLimit(Request) {
    const Ip = String(Request.socket?.remoteAddress || "unknown").slice(0, 80);
    const Now = Date.now();
    const Recent = (AuthorizedAiRateLimits.get(Ip) || []).filter(At => Now - At < AuthorizedAiWindowMs);
    if (Recent.length >= AuthorizedAiMaxRequests) {
        return {
            allowed: false,
            retryAfter: Math.max(1, Math.ceil((AuthorizedAiWindowMs - (Now - Recent[0])) / 1000))
        };
    }
    if (!AuthorizedAiRateLimits.has(Ip) && AuthorizedAiRateLimits.size >= 10000) {
        const Oldest = AuthorizedAiRateLimits.keys().next().value;
        if (Oldest !== undefined) AuthorizedAiRateLimits.delete(Oldest);
    }
    Recent.push(Now);
    AuthorizedAiRateLimits.set(Ip, Recent);
    return { allowed: true, retryAfter: 0 };
}

async function HandleAuthorizedAi(Request, Response, Origin) {
    const ApiKey = String(process.env.GEMINI_API_KEY || "").trim();
    if (!ApiKey) {
        return SendJson(Response, 503, { error: "Gemini is not configured on the server." }, Origin);
    }

    const Limit = TakeAuthorizedAiRateLimit(Request);
    if (!Limit.allowed) {
        return SendJson(Response, 429, {
            error: "Too many AI requests. Please wait before trying again.",
            retryAfter: Limit.retryAfter
        }, Origin);
    }

    let Body;
    try {
        Body = await ReadJson(Request);
    } catch {
        return SendJson(Response, 400, { error: "Request body must be valid JSON." }, Origin);
    }

    const Message = typeof Body?.message === "string" ? Body.message.trim() : "";
    if (!Message) return SendJson(Response, 400, { error: "Message is required." }, Origin);
    if (Message.length > 4000) {
        return SendJson(Response, 413, { error: "Messages are limited to 4,000 characters." }, Origin);
    }

    const Controller = new AbortController();
    const Timeout = setTimeout(() => Controller.abort(), 30000);
    Timeout.unref?.();

    try {
        const GeminiResponse = await fetch(
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-goog-api-key": ApiKey
                },
                body: JSON.stringify({
                    contents: [{ role: "user", parts: [{ text: Message }] }],
                    generationConfig: {
                        temperature: 0.7,
                        maxOutputTokens: 1200
                    }
                }),
                signal: Controller.signal
            }
        );

        const Result = await GeminiResponse.json().catch(() => ({}));
        if (!GeminiResponse.ok) {
            const ProviderError = Result?.error && typeof Result.error === "object"
                ? {
                    code: Result.error.code,
                    status: Result.error.status,
                    message: String(Result.error.message || "").slice(0, 500)
                }
                : { message: "No structured provider error returned." };
            console.error("Gemini API request failed:", JSON.stringify({
                httpStatus: GeminiResponse.status,
                providerError: ProviderError
            }));
            return SendJson(Response, 502, {
                error: GeminiResponse.status === 429
                    ? "Gemini is temporarily rate-limited. Try again shortly."
                    : "Gemini could not complete the request."
            }, Origin);
        }

        const Text = Array.isArray(Result?.candidates?.[0]?.content?.parts)
            ? Result.candidates[0].content.parts
                .map(Part => typeof Part?.text === "string" ? Part.text : "")
                .join("")
                .trim()
            : "";
        if (!Text) {
            return SendJson(Response, 502, { error: "Gemini returned an empty response." }, Origin);
        }

        return SendJson(Response, 200, {
            ok: true,
            text: Text.slice(0, 12000),
            model: "gemini-2.5-flash"
        }, Origin);
    } catch (Error) {
        console.error("Authorized AI request failed:", String(Error?.message || Error).slice(0, 180));
        return SendJson(Response, 504, {
            error: Controller.signal.aborted
                ? "Gemini request timed out."
                : "Gemini is temporarily unavailable."
        }, Origin);
    } finally {
        clearTimeout(Timeout);
    }
}

async function VerifyRegistrationTurnstileToken(Token) {
    const Secret = String(process.env.TURNSTILE_SECRET_KEY || "").trim();
    const ResponseToken = String(Token || "").trim();
    if (!Secret || !ResponseToken || ResponseToken.length > 2048) return false;

    const Controller = new AbortController();
    const Timeout = setTimeout(() => Controller.abort(), 5000);
    Timeout.unref?.();

    try {
        const Form = new URLSearchParams();
        Form.set("secret", Secret);
        Form.set("response", ResponseToken);

        const VerificationResponse = await fetch(
            "https://challenges.cloudflare.com/turnstile/v0/siteverify",
            {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: Form,
                signal: Controller.signal
            }
        );
        if (!VerificationResponse.ok) return false;

        const Result = await VerificationResponse.json();
        return Result?.success === true
            && ["storyrewritegame.com", "www.storyrewritegame.com"].includes(
                String(Result.hostname || "").toLowerCase()
            );
    } catch (Error) {
        console.warn("Turnstile verification unavailable:", String(Error?.message || Error).slice(0, 160));
        return false;
    } finally {
        clearTimeout(Timeout);
    }
}

`;
        Source = Source.replace(HelperAnchor, Helpers + HelperAnchor);

        const PasswordValidationAnchor =
            '            if (!ValidatePassword(Body.password)) return SendJson(Response, 400, { error: "Password must be 8-128 characters." }, Origin);';
        const RouteStart = '    if (RequestPath === "/api/register" && Request.method === "POST") {';
        const RouteIndex = Source.indexOf(RouteStart);
        const ValidationIndex = Source.indexOf(PasswordValidationAnchor, RouteIndex);
        if (RouteIndex < 0 || ValidationIndex < 0 || Source.indexOf(PasswordValidationAnchor, ValidationIndex + 1) >= 0) {
            throw new Error("server-v22 Turnstile patch failed: password-validation insertion anchor.");
        }
        const AfterValidation = ValidationIndex + PasswordValidationAnchor.length;
        const Verification = `
            const RecentRegistrationCreations = (RegistrationCreationTimes.get(RegistrationIpKey) || [])
                .filter(At => RegistrationNow - Number(At || 0) < RegistrationCreationWindowMs);
            if (RecentRegistrationCreations.length >= RegistrationCreationMax) {
                const RetryAfterSeconds = Math.max(
                    1,
                    Math.ceil((RegistrationCreationWindowMs - (RegistrationNow - RecentRegistrationCreations[0])) / 1000)
                );
                return SendJson(Response, 429, {
                    error: "This network has reached its account creation limit. Please try again later.",
                    retryAfter: RetryAfterSeconds
                }, Origin);
            }

            const RegistrationChallengeThreshold = Math.max(1, RegistrationCreationMax - 1);
            const RegistrationChallengeRequired = RecentRegistrationCreations.length >= RegistrationChallengeThreshold;
            if (
                RegistrationChallengeRequired
                && !await VerifyRegistrationTurnstileToken(Body.turnstileToken)
            ) {
                return SendJson(Response, 428, {
                    error: "Please complete the quick verification to continue.",
                    challengeRequired: true
                }, Origin);
            }`;
        Source = Source.slice(0, AfterValidation) + Verification + Source.slice(AfterValidation);

        const AuthorizedAiRouteAnchor =
            '    if (!Account) return SendJson(Response, 401, { error: "Sign in required." }, Origin);';
        if (Source.split(AuthorizedAiRouteAnchor).length !== 2) {
            throw new Error("server-v22 Gemini API patch failed: API route insertion anchor.");
        }
        Source = Source.replace(
            AuthorizedAiRouteAnchor,
            AuthorizedAiRouteAnchor + '\n\n' +
            '    if (RequestPath === "/api/authorized-ai" && Request.method === "POST") {\n' +
            '        return HandleAuthorizedAi(Request, Response, Origin);\n' +
            '    }'
        );

        PatchApplied = true;
        return OriginalCompile.call(this, Source, Filename);
    }
    return OriginalCompile.call(this, Content, Filename);
};

try {
    require("./server-v21.js");
} finally {
    Module.prototype._compile = OriginalCompile;
}

if (!PatchApplied) {
    throw new Error("server-v22 Turnstile patch did not attach to the active backend.");
}

if (String(process.env.BROWSERBASE_TEST_ON_START || "") === "1") {
    const { runBrowserbaseSmokeTest } = require("./scripts/browserbase-smoke-test.js");
    setImmediate(() => {
        runBrowserbaseSmokeTest().catch(Error => {
            console.error(
                "BROWSERBASE_SMOKE_FAILED: " +
                String(Error?.message || Error).slice(0, 500)
            );
        });
    });
}
