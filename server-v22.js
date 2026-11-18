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
        Source = Source.replace(VersionAnchor, "const BackendVersion = 63;");

        const HelperAnchor = "function CleanExpiredJoinRequests(Room) {";
        if (Source.split(HelperAnchor).length !== 2) {
            throw new Error("server-v22 Turnstile patch failed: helper insertion anchor.");
        }

        const Helpers = String.raw`
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

        const BodyAnchor = "            const Body = await ReadJson(Request);";
        if (Source.split(BodyAnchor).length !== 2) {
            throw new Error("server-v22 Turnstile patch failed: registration body anchor.");
        }
        const RouteStart = '    if (RequestPath === "/api/register" && Request.method === "POST") {';
        const RouteIndex = Source.indexOf(RouteStart);
        const BodyIndex = Source.indexOf(BodyAnchor, RouteIndex);
        if (RouteIndex < 0 || BodyIndex < 0) {
            throw new Error("server-v22 Turnstile patch failed: registration route not found.");
        }
        const AfterBody = BodyIndex + BodyAnchor.length;
        const Verification = `
            if (!await VerifyRegistrationTurnstileToken(Body.turnstileToken)) {
                return SendJson(Response, 403, { error: "Please complete the human verification challenge and try again." }, Origin);
            }`;
        Source = Source.slice(0, AfterBody) + Verification + Source.slice(AfterBody);

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
