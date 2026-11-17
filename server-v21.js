const path = require("path");
const Module = require("module");

const OriginalCompile = Module.prototype._compile;
const TargetGeneratedServer = path.resolve(__dirname, "server-v8.js");
let PatchApplied = false;

Module.prototype._compile = function(Content, Filename) {
    if (Filename && path.resolve(Filename) === TargetGeneratedServer) {
        let Source = String(Content);

        const VersionAnchor = "const BackendVersion = 61;";
        if (Source.split(VersionAnchor).length !== 2) {
            throw new Error("server-v21 registration protection patch failed: expected backend version 61 exactly once.");
        }
        Source = Source.replace(VersionAnchor, "const BackendVersion = 62;");

        const HelperAnchor = "function CleanExpiredJoinRequests(Room) {";
        if (Source.split(HelperAnchor).length !== 2) {
            throw new Error("server-v21 registration protection patch failed: helper insertion anchor.");
        }

        const Helpers = [
            'const RegistrationRequestWindowMs = Math.max(60000, Number(process.env.REGISTER_IP_WINDOW_MS || 10 * 60 * 1000));',
            'const RegistrationRequestMax = Math.max(3, Math.min(100, Number(process.env.REGISTER_IP_MAX_REQUESTS || 12)));',
            'const RegistrationCreationWindowMs = Math.max(60000, Number(process.env.REGISTER_IP_CREATION_WINDOW_MS || 60 * 60 * 1000));',
            'const RegistrationCreationMax = Math.max(1, Math.min(20, Number(process.env.REGISTER_IP_MAX_CREATIONS || 3)));',
            'const RegistrationRequestTimes = new Map();',
            'const RegistrationCreationTimes = new Map();',
            '',
            'function TakeRegistrationRateLimitSlot(Store, IpKey, Limit, WindowMs, Now) {',
            '    const Key = String(IpKey || "unknown");',
            '    const Times = (Store.get(Key) || []).filter(At => Now - Number(At || 0) < WindowMs);',
            '',
            '    if (Times.length >= Limit) {',
            '        Store.set(Key, Times);',
            '        return {',
            '            allowed: false,',
            '            retryAfterSeconds: Math.max(1, Math.ceil((WindowMs - (Now - Times[0])) / 1000))',
            '        };',
            '    }',
            '',
            '    if (!Store.has(Key) && Store.size >= 20000) {',
            '        const OldestKey = Store.keys().next().value;',
            '        if (OldestKey !== undefined) Store.delete(OldestKey);',
            '    }',
            '',
            '    Times.push(Now);',
            '    Store.set(Key, Times);',
            '    return { allowed: true, retryAfterSeconds: 0 };',
            '}',
            '',
            'function CleanupRegistrationRateLimitStore(Store, WindowMs, Now) {',
            '    for (const [Key, ExistingTimes] of Store.entries()) {',
            '        const Times = ExistingTimes.filter(At => Now - Number(At || 0) < WindowMs);',
            '        if (Times.length) Store.set(Key, Times);',
            '        else Store.delete(Key);',
            '    }',
            '}',
            '',
            'function CleanupRegistrationRateLimits() {',
            '    const Now = Date.now();',
            '    CleanupRegistrationRateLimitStore(RegistrationRequestTimes, RegistrationRequestWindowMs, Now);',
            '    CleanupRegistrationRateLimitStore(RegistrationCreationTimes, RegistrationCreationWindowMs, Now);',
            '}',
            '',
            'const RegistrationRateCleanupTimer = setInterval(CleanupRegistrationRateLimits, 5 * 60 * 1000);',
            'RegistrationRateCleanupTimer.unref?.();',
            ''
        ].join("\n");
        Source = Source.replace(HelperAnchor, Helpers + "\n" + HelperAnchor);

        const RegisterRouteAnchor =
            '    if (RequestPath === "/api/register" && Request.method === "POST") {\n' +
            '        try {\n' +
            '            const Body = await ReadJson(Request);';
        if (Source.split(RegisterRouteAnchor).length !== 2) {
            throw new Error("server-v21 registration protection patch failed: registration route anchor.");
        }

        const RegisterRouteReplacement = [
            '    if (RequestPath === "/api/register" && Request.method === "POST") {',
            '        const RegistrationIpKey = GetLoginClientKey(Request);',
            '        const RegistrationNow = Date.now();',
            '        const RequestLimit = TakeRegistrationRateLimitSlot(',
            '            RegistrationRequestTimes,',
            '            RegistrationIpKey,',
            '            RegistrationRequestMax,',
            '            RegistrationRequestWindowMs,',
            '            RegistrationNow',
            '        );',
            '        if (!RequestLimit.allowed) {',
            '            return SendJson(Response, 429, {',
            '                error: "Too many account creation requests from this network. Please try again later.",',
            '                retryAfter: RequestLimit.retryAfterSeconds',
            '            }, Origin);',
            '        }',
            '',
            '        try {',
            '            const Body = await ReadJson(Request);'
        ].join("\n");
        Source = Source.replace(RegisterRouteAnchor, RegisterRouteReplacement);

        const PasswordValidationAnchor =
            '            if (!ValidatePassword(Body.password)) return SendJson(Response, 400, { error: "Password must be 8-128 characters." }, Origin);\n' +
            '            if (await GetAccountByUsername(Username)) return SendJson(Response, 409, { error: "That username already exists." }, Origin);';
        if (Source.split(PasswordValidationAnchor).length !== 2) {
            throw new Error("server-v21 registration protection patch failed: password validation anchor.");
        }

        const PasswordValidationReplacement = [
            '            if (!ValidatePassword(Body.password)) return SendJson(Response, 400, { error: "Password must be 8-128 characters." }, Origin);',
            '',
            '            const CreationLimit = TakeRegistrationRateLimitSlot(',
            '                RegistrationCreationTimes,',
            '                RegistrationIpKey,',
            '                RegistrationCreationMax,',
            '                RegistrationCreationWindowMs,',
            '                RegistrationNow',
            '            );',
            '            if (!CreationLimit.allowed) {',
            '                return SendJson(Response, 429, {',
            '                    error: "This network has reached its account creation limit. Please try again later.",',
            '                    retryAfter: CreationLimit.retryAfterSeconds',
            '                }, Origin);',
            '            }',
            '',
            '            if (await GetAccountByUsername(Username)) return SendJson(Response, 409, { error: "That username already exists." }, Origin);'
        ].join("\n");
        Source = Source.replace(PasswordValidationAnchor, PasswordValidationReplacement);

        PatchApplied = true;
        return OriginalCompile.call(this, Source, Filename);
    }
    return OriginalCompile.call(this, Content, Filename);
};

try {
    require("./server-v20.js");
} finally {
    Module.prototype._compile = OriginalCompile;
}

if (!PatchApplied) {
    throw new Error("server-v21 registration protection patch did not attach to the active backend.");
}
