const fs = require("fs");
const path = require("path");
const Module = require("module");

const WrapperPath = path.join(__dirname, "server-v20.js");
let WrapperSource = fs.readFileSync(WrapperPath, "utf8");

function ReplaceWrapperRequired(Search, Replacement, Label) {
    if (!WrapperSource.includes(Search)) throw new Error(`server-v21 patch failed: ${Label}`);
    WrapperSource = WrapperSource.replace(Search, Replacement);
}

const V21PatchCode = `ReplaceRequired(
    'const BackendVersion = 20;',
    'const BackendVersion = 21;',
    "backend version 21"
);

ReplaceRequired(
    'const HostModerationRestrictions = new Map();',
    \`const HostModerationRestrictions = new Map();

async function InitializePersistentHostModeration() {
    if (!Database) return;
    await Database.query(\\\`CREATE TABLE IF NOT EXISTS host_moderation_restrictions (
        host_username_key TEXT NOT NULL,
        target_username_key TEXT NOT NULL,
        host_username TEXT NOT NULL,
        target_username TEXT NOT NULL,
        chat_until BIGINT NOT NULL DEFAULT 0,
        game_until BIGINT NOT NULL DEFAULT 0,
        game_banned BOOLEAN NOT NULL DEFAULT FALSE,
        chat_reason TEXT NOT NULL DEFAULT '',
        game_reason TEXT NOT NULL DEFAULT '',
        chat_issued_by TEXT NOT NULL DEFAULT '',
        game_issued_by TEXT NOT NULL DEFAULT '',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (host_username_key, target_username_key)
    )\\\`);

    const Result = await Database.query(\\\`SELECT host_username, target_username, chat_until, game_until, game_banned, chat_reason, game_reason, chat_issued_by, game_issued_by
        FROM host_moderation_restrictions\\\`);

    HostModerationRestrictions.clear();
    const Now = Date.now();
    for (const Row of Result.rows) {
        const ChatUntil = Number(Row.chat_until || 0);
        const GameUntil = Number(Row.game_until || 0);
        const ActiveChatUntil = ChatUntil > Now ? ChatUntil : 0;
        const ActiveGameUntil = GameUntil > Now ? GameUntil : 0;
        if (!ActiveChatUntil && !ActiveGameUntil && !Row.game_banned) continue;
        HostModerationRestrictions.set(ModerationKey(Row.host_username, Row.target_username), {
            chatUntil: ActiveChatUntil,
            gameUntil: Row.game_banned ? Infinity : ActiveGameUntil,
            gameBanned: Boolean(Row.game_banned),
            chatReason: String(Row.chat_reason || ''),
            gameReason: String(Row.game_reason || ''),
            chatIssuedBy: String(Row.chat_issued_by || ''),
            gameIssuedBy: String(Row.game_issued_by || '')
        });
    }

    await Database.query(\\\`DELETE FROM host_moderation_restrictions
        WHERE game_banned = FALSE
          AND chat_until > 0 AND chat_until <= $1
          AND game_until > 0 AND game_until <= $1\\\`, [Now]).catch(() => {});
}

async function PersistHostRestriction(HostUsername, TargetUsername) {
    if (!Database) return;
    const Key = ModerationKey(HostUsername, TargetUsername);
    const Restriction = HostModerationRestrictions.get(Key);
    const HostKey = UsernameKey(HostUsername);
    const TargetKey = UsernameKey(TargetUsername);

    if (!Restriction || (!Restriction.chatUntil && !Restriction.gameUntil && !Restriction.gameBanned)) {
        await Database.query(
            'DELETE FROM host_moderation_restrictions WHERE host_username_key = $1 AND target_username_key = $2',
            [HostKey, TargetKey]
        );
        return;
    }

    const ChatUntil = Restriction.chatUntil === Infinity ? Number.MAX_SAFE_INTEGER : Number(Restriction.chatUntil || 0);
    const GameUntil = Restriction.gameUntil === Infinity ? Number.MAX_SAFE_INTEGER : Number(Restriction.gameUntil || 0);

    await Database.query(\\\`INSERT INTO host_moderation_restrictions (
            host_username_key, target_username_key, host_username, target_username,
            chat_until, game_until, game_banned, chat_reason, game_reason,
            chat_issued_by, game_issued_by, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
        ON CONFLICT (host_username_key, target_username_key) DO UPDATE SET
            host_username = EXCLUDED.host_username,
            target_username = EXCLUDED.target_username,
            chat_until = EXCLUDED.chat_until,
            game_until = EXCLUDED.game_until,
            game_banned = EXCLUDED.game_banned,
            chat_reason = EXCLUDED.chat_reason,
            game_reason = EXCLUDED.game_reason,
            chat_issued_by = EXCLUDED.chat_issued_by,
            game_issued_by = EXCLUDED.game_issued_by,
            updated_at = NOW()\\\`, [
        HostKey, TargetKey, HostUsername, TargetUsername,
        ChatUntil, GameUntil, Boolean(Restriction.gameBanned),
        String(Restriction.chatReason || ''), String(Restriction.gameReason || ''),
        String(Restriction.chatIssuedBy || ''), String(Restriction.gameIssuedBy || '')
    ]);
}

function PersistHostRestrictionSafe(HostUsername, TargetUsername) {
    PersistHostRestriction(HostUsername, TargetUsername).catch(Error => {
        console.error('Could not persist host moderation restriction', Error);
    });
}\`,
    "persistent host moderation helpers"
);

ReplaceRequired(
    '    Room.chatBannedNames.add(Username);\\n    Room.moderationRevision += 1;',
    '    Room.chatBannedNames.add(Username);\\n    PersistHostRestrictionSafe(Room.hostUsername, Username);\\n    Room.moderationRevision += 1;',
    "persist chat timeout"
);

ReplaceRequired(
    '    Room.chatBannedNames.delete(Username);\\n    Room.moderationRevision += 1;',
    '    Room.chatBannedNames.delete(Username);\\n    PersistHostRestrictionSafe(Room.hostUsername, Username);\\n    Room.moderationRevision += 1;',
    "persist chat untimeout"
);

ReplaceRequired(
    '            Restriction.gameIssuedBy = "host";\\n            FindRoomPlayerSocket(Room, Username)?.emit("room:gameRestrictionState", { active: true, banned: false, until: Restriction.gameUntil, reason: Restriction.gameReason });',
    '            Restriction.gameIssuedBy = "host";\\n            PersistHostRestrictionSafe(Room.hostUsername, Username);\\n            FindRoomPlayerSocket(Room, Username)?.emit("room:gameRestrictionState", { active: true, banned: false, until: Restriction.gameUntil, reason: Restriction.gameReason });',
    "persist game timeout"
);

ReplaceRequired(
    '            Restriction.gameIssuedBy = "";\\n            FindRoomPlayerSocket(Room, Username)?.emit("room:gameRestrictionState", { active: false, banned: false, until: 0, reason: "The host removed your game timeout." });',
    '            Restriction.gameIssuedBy = "";\\n            PersistHostRestrictionSafe(Room.hostUsername, Username);\\n            FindRoomPlayerSocket(Room, Username)?.emit("room:gameRestrictionState", { active: false, banned: false, until: 0, reason: "The host removed your game timeout." });',
    "persist game untimeout"
);

ReplaceRequired(
    '            Restriction.gameIssuedBy = "host";\\n            const TargetSocket = FindRoomPlayerSocket(Room, Username);',
    '            Restriction.gameIssuedBy = "host";\\n            PersistHostRestrictionSafe(Room.hostUsername, Username);\\n            const TargetSocket = FindRoomPlayerSocket(Room, Username);',
    "persist game ban"
);

ReplaceRequired(
    '            Restriction.gameIssuedBy = "";\\n            EmitRoom(Room);\\n            Reply({ ok: true });',
    '            Restriction.gameIssuedBy = "";\\n            PersistHostRestrictionSafe(Room.hostUsername, Username);\\n            EmitRoom(Room);\\n            Reply({ ok: true });',
    "persist game unban"
);

ReplaceRequired(
    'HttpServer.listen(Port, () => {\\n    console.log(\\`Story Rewrite backend v\\${BackendVersion} listening on \\${Port}\\`);\\n});',
    'InitializePersistentHostModeration()\\n    .then(() => {\\n        HttpServer.listen(Port, () => {\\n            console.log(\\`Story Rewrite backend v\\${BackendVersion} listening on \\${Port}\\`);\\n        });\\n    })\\n    .catch(Error => {\\n        console.error("Host moderation database initialization failed", Error);\\n        process.exit(1);\\n    });',
    "load moderation database before listen"
);`;

const Marker = 'const InjectionNeedle = `+ ${JSON.stringify(V19PatchCode)} + "\\\\n\\\\nconst RuntimeModule = new Module(SourcePath, module);",`;';
const MarkerReplacement = `const V21PatchCode = ${JSON.stringify(V21PatchCode)};\n\n${Marker}`;
ReplaceWrapperRequired(Marker, MarkerReplacement, "v21 patch declaration");

const OldInjection = 'const InjectionReplacement = `+ ${JSON.stringify(V19PatchCode)} + "\\\\n\\\\n" + ${JSON.stringify(V20PatchCode)} + "\\\\n\\\\nconst RuntimeModule = new Module(SourcePath, module);",`;';
const NewInjection = 'const InjectionReplacement = `+ ${JSON.stringify(V19PatchCode)} + "\\\\n\\\\n" + ${JSON.stringify(V20PatchCode)} + "\\\\n\\\\n" + V21PatchCode + "\\\\n\\\\nconst RuntimeModule = new Module(SourcePath, module);",`;';
ReplaceWrapperRequired(OldInjection, NewInjection, "v21 injection chain");

const RuntimeModule = new Module(WrapperPath, module);
RuntimeModule.filename = WrapperPath;
RuntimeModule.paths = Module._nodeModulePaths(__dirname);
RuntimeModule._compile(WrapperSource, WrapperPath);