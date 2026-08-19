const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");
const { Server: SocketServer } = require("socket.io");

const Root = __dirname;
const Port = Number(process.env.PORT || 57410);
const DatabaseUrl = String(process.env.DATABASE_URL || "").trim();
const SessionSecret = String(process.env.SESSION_SECRET || crypto.randomBytes(48).toString("hex"));
const StagesData = JSON.parse(fs.readFileSync(path.join(Root, "stages.json"), "utf8"));

const Rooms = new Map();
const MaxPlayers = 5;
const MaxLives = 3;
const BackendVersion = 8;
const ChatMaxLength = 180;
const ChatHistoryLimit = 30;
const ChatRateLimitCount = 5;
const ChatRateLimitWindow = 10000;

const Database = DatabaseUrl
    ? new Pool({
        connectionString: DatabaseUrl,
        ssl: { rejectUnauthorized: false },
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000
    })
    : null;

function DefaultSave() {
    const FirstWorld = StagesData.worlds[0];
    return {
        version: 6,
        unlockedWorlds: [FirstWorld.id],
        unlockedStages: [FirstWorld.entryStage],
        stars: {},
        currentStage: FirstWorld.entryStage,
        lives: MaxLives,
        maxLives: MaxLives,
        deaths: 0,
        settings: {
            musicVolume: 0.45,
            soundVolume: 0.75
        }
    };
}

function Clone(Value) {
    return JSON.parse(JSON.stringify(Value));
}

function ClampNumber(Value, Minimum, Maximum, Fallback) {
    const NumberValue = Number(Value);
    return Number.isFinite(NumberValue)
        ? Math.max(Minimum, Math.min(Maximum, NumberValue))
        : Fallback;
}

function NormalizeSave(Value) {
    const Base = DefaultSave();
    const Save = Value && typeof Value === "object" && !Array.isArray(Value)
        ? Clone(Value)
        : Clone(Base);

    Save.version = 6;
    if (!Array.isArray(Save.unlockedWorlds)) Save.unlockedWorlds = [...Base.unlockedWorlds];
    if (!Array.isArray(Save.unlockedStages)) Save.unlockedStages = [...Base.unlockedStages];
    if (!Save.stars || typeof Save.stars !== "object" || Array.isArray(Save.stars)) Save.stars = {};
    if (!StagesData.stages[Save.currentStage]) Save.currentStage = Base.currentStage;
    if (!Number.isInteger(Save.lives)) Save.lives = MaxLives;
    if (!Number.isInteger(Save.maxLives)) Save.maxLives = MaxLives;
    if (!Number.isInteger(Save.deaths)) Save.deaths = 0;
    if (!Save.settings || typeof Save.settings !== "object") Save.settings = { ...Base.settings };

    Save.settings.musicVolume = ClampNumber(Save.settings.musicVolume, 0, 1, Base.settings.musicVolume);
    Save.settings.soundVolume = ClampNumber(Save.settings.soundVolume, 0, 1, Base.settings.soundVolume);
    Save.lives = Math.max(0, Math.min(Save.maxLives, Save.lives));

    if (!Save.unlockedWorlds.includes(Base.unlockedWorlds[0])) Save.unlockedWorlds.push(Base.unlockedWorlds[0]);
    if (!Save.unlockedStages.includes(Base.unlockedStages[0])) Save.unlockedStages.push(Base.unlockedStages[0]);

    return Save;
}

function NormalizeUsername(Value) {
    return String(Value || "").trim();
}

function UsernameKey(Value) {
    return NormalizeUsername(Value).toLowerCase();
}

function ValidateUsername(Value) {
    return /^[A-Za-z0-9_]{3,20}$/.test(String(Value || ""));
}

function ValidatePassword(Value) {
    return typeof Value === "string" && Value.length >= 8 && Value.length <= 128;
}

function CreatePasswordHash(Password) {
    const Salt = crypto.randomBytes(16);
    const Hash = crypto.scryptSync(Password, Salt, 64);
    return `scrypt$${Salt.toString("hex")}$${Hash.toString("hex")}`;
}

function PasswordMatches(Password, StoredHash) {
    try {
        const Parts = String(StoredHash || "").split("$");
        if (Parts.length !== 3 || Parts[0] !== "scrypt") return false;
        const Salt = Buffer.from(Parts[1], "hex");
        const Expected = Buffer.from(Parts[2], "hex");
        const Actual = crypto.scryptSync(Password, Salt, Expected.length);
        return Actual.length === Expected.length && crypto.timingSafeEqual(Actual, Expected);
    } catch {
        return false;
    }
}

function CreateToken(Username) {
    const Payload = Buffer.from(JSON.stringify({
        username: Username,
        expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 30,
        nonce: crypto.randomBytes(12).toString("hex")
    })).toString("base64url");
    const Signature = crypto.createHmac("sha256", SessionSecret).update(Payload).digest("base64url");
    return `${Payload}.${Signature}`;
}

function VerifyToken(Token) {
    try {
        if (typeof Token !== "string" || !Token.includes(".")) return null;
        const [Payload, Signature] = Token.split(".");
        const Expected = crypto.createHmac("sha256", SessionSecret).update(Payload).digest("base64url");
        const SignatureBuffer = Buffer.from(Signature);
        const ExpectedBuffer = Buffer.from(Expected);
        if (SignatureBuffer.length !== ExpectedBuffer.length) return null;
        if (!crypto.timingSafeEqual(SignatureBuffer, ExpectedBuffer)) return null;
        const Parsed = JSON.parse(Buffer.from(Payload, "base64url").toString("utf8"));
        if (!Parsed.username || Number(Parsed.expiresAt || 0) < Date.now()) return null;
        return NormalizeUsername(Parsed.username);
    } catch {
        return null;
    }
}

function GetBearerToken(Request) {
    const Header = String(Request.headers.authorization || "");
    return Header.startsWith("Bearer ") ? Header.slice(7) : "";
}

async function GetAccountByUsername(Username) {
    if (!Database) return null;
    const Result = await Database.query(
        `SELECT username_key, username, password_hash, save_data, created_at
         FROM accounts
         WHERE username_key = $1
         LIMIT 1`,
        [UsernameKey(Username)]
    );
    if (Result.rowCount === 0) return null;
    const Row = Result.rows[0];
    return {
        usernameKey: Row.username_key,
        username: Row.username,
        passwordHash: Row.password_hash,
        save: NormalizeSave(Row.save_data),
        createdAt: Row.created_at instanceof Date ? Row.created_at.toISOString() : Row.created_at
    };
}

async function GetAccountByToken(Token) {
    const Username = VerifyToken(Token);
    return Username ? GetAccountByUsername(Username) : null;
}

async function CreateAccount(Username, Password) {
    const Save = DefaultSave();
    const Result = await Database.query(
        `INSERT INTO accounts (username_key, username, password_hash, save_data)
         VALUES ($1, $2, $3, $4::jsonb)
         RETURNING created_at`,
        [UsernameKey(Username), Username, CreatePasswordHash(Password), JSON.stringify(Save)]
    );
    return {
        usernameKey: UsernameKey(Username),
        username: Username,
        passwordHash: "",
        save: Save,
        createdAt: Result.rows[0].created_at.toISOString()
    };
}

async function SaveAccount(Account) {
    Account.save = NormalizeSave(Account.save);
    await Database.query(
        `UPDATE accounts
         SET username = $2,
             save_data = $3::jsonb,
             updated_at = NOW()
         WHERE username_key = $1`,
        [Account.usernameKey || UsernameKey(Account.username), Account.username, JSON.stringify(Account.save)]
    );
}

async function SaveAccounts(Accounts) {
    if (!Accounts.length) return;
    const Client = await Database.connect();
    try {
        await Client.query("BEGIN");
        for (const Account of Accounts) {
            Account.save = NormalizeSave(Account.save);
            await Client.query(
                `UPDATE accounts
                 SET save_data = $2::jsonb,
                     updated_at = NOW()
                 WHERE username_key = $1`,
                [Account.usernameKey || UsernameKey(Account.username), JSON.stringify(Account.save)]
            );
        }
        await Client.query("COMMIT");
    } catch (Error) {
        await Client.query("ROLLBACK");
        throw Error;
    } finally {
        Client.release();
    }
}

function PublicProfile(Account) {
    const Save = NormalizeSave(Account.save);
    return {
        username: Account.username,
        createdAt: Account.createdAt,
        save: {
            lives: Save.lives,
            maxLives: Save.maxLives,
            deaths: Save.deaths,
            stars: Object.values(Save.stars).reduce((Total, Value) => Total + Number(Value || 0), 0),
            clearedStages: Object.values(Save.stars).filter(Value => Number(Value) > 0).length
        }
    };
}

function GetWorld(WorldId) {
    return StagesData.worlds.find(World => World.id === WorldId) || null;
}

function UnlockStage(Save, StageId) {
    const Stage = StagesData.stages[StageId];
    if (!Stage) return;
    if (!Save.unlockedStages.includes(StageId)) Save.unlockedStages.push(StageId);
    if (!Save.unlockedWorlds.includes(Stage.worldId)) Save.unlockedWorlds.push(Stage.worldId);
}

function RestartChapterForAccount(Account, WorldId) {
    const Save = NormalizeSave(Account.save);
    const World = GetWorld(WorldId) || GetWorld(StagesData.stages[Save.currentStage]?.worldId) || StagesData.worlds[0];
    UnlockStage(Save, World.entryStage);
    Save.currentStage = World.entryStage;
    Save.lives = Save.maxLives;
    Account.save = Save;
    return Save;
}

function ComputeStars(Stage, RemovedIndexes) {
    const Required = new Set(Stage.requiredRemoved);
    const ExtraRemoved = RemovedIndexes.filter(Index => !Required.has(Index)).length;
    if (ExtraRemoved === 0 && RemovedIndexes.length <= Stage.par) return 3;
    if (ExtraRemoved <= 1 && RemovedIndexes.length <= Stage.par + 1) return 2;
    return 1;
}

function ValidateStageResult(StageId, RemovedIndexes) {
    const Stage = StagesData.stages[StageId];
    if (!Stage) return { success: false, reason: "Unknown stage.", aftermath: "The page could not be read." };

    const UniqueIndexes = [...new Set((Array.isArray(RemovedIndexes) ? RemovedIndexes : []).map(Number))]
        .filter(Index => Number.isInteger(Index) && Index >= 0 && Index < Stage.sentences.length)
        .sort((A, B) => A - B);
    const RemovedSet = new Set(UniqueIndexes);
    const HasAllRequired = Stage.requiredRemoved.every(Index => RemovedSet.has(Index));
    const RemovedForbidden = Stage.forbiddenRemoved.some(Index => RemovedSet.has(Index));

    if (!HasAllRequired || RemovedForbidden) {
        return {
            success: false,
            removedIndexes: UniqueIndexes,
            reason: RemovedForbidden
                ? "You erased something the successful ending still needs."
                : "At least one cause of failure is still active.",
            aftermath: Stage.aftermath
        };
    }

    return {
        success: true,
        removedIndexes: UniqueIndexes,
        stars: ComputeStars(Stage, UniqueIndexes),
        stage: Stage
    };
}

function ApplySuccessToAccount(Account, StageId, Stars) {
    const Save = NormalizeSave(Account.save);
    const Stage = StagesData.stages[StageId];
    Save.stars[StageId] = Math.max(Number(Save.stars[StageId] || 0), Stars);
    if (Stage.nextStage) {
        UnlockStage(Save, Stage.nextStage);
        Save.currentStage = Stage.nextStage;
    } else {
        Save.currentStage = StageId;
    }
    if (Stage.isChapterEnd) Save.lives = Save.maxLives;
    Account.save = Save;
}

function ApplyFailureToAccount(Account) {
    const Save = NormalizeSave(Account.save);
    Save.lives = Math.max(0, Save.lives - 1);
    Save.deaths += 1;
    Account.save = Save;
    return Save;
}

function IsAllowedOrigin(Origin) {
    if (!Origin) return true;
    const Configured = String(process.env.ALLOWED_ORIGINS || "")
        .split(",")
        .map(Value => Value.trim())
        .filter(Boolean);
    if (Configured.includes(Origin)) return true;
    try {
        const Parsed = new URL(Origin);
        const Hostname = Parsed.hostname.toLowerCase();
        if (Parsed.protocol === "https:" && Hostname === "spongebobtdgameplay-prog.github.io") return true;
        if (Parsed.protocol === "https:" && Hostname === "story-rewrite-backend.onrender.com") return true;
        if (Parsed.protocol === "http:" && (Hostname === "localhost" || Hostname === "127.0.0.1")) return true;
    } catch {}
    return false;
}

function SendJson(Response, Status, Payload, Origin = "") {
    const Headers = {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Vary": "Origin"
    };
    if (Origin && IsAllowedOrigin(Origin)) Headers["Access-Control-Allow-Origin"] = Origin;
    Response.writeHead(Status, Headers);
    Response.end(JSON.stringify(Payload));
}

function ReadJson(Request) {
    return new Promise((Resolve, Reject) => {
        let Body = "";
        Request.on("data", Chunk => {
            Body += Chunk;
            if (Body.length > 131072) {
                Reject(new Error("Request body too large."));
                Request.destroy();
            }
        });
        Request.on("end", () => {
            try {
                Resolve(Body ? JSON.parse(Body) : {});
            } catch (Error) {
                Reject(Error);
            }
        });
        Request.on("error", Reject);
    });
}

function GenerateRoomCode() {
    const Alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    for (let Attempt = 0; Attempt < 100; Attempt += 1) {
        let Code = "";
        for (let Index = 0; Index < 6; Index += 1) {
            Code += Alphabet[crypto.randomInt(Alphabet.length)];
        }
        if (!Rooms.has(Code)) return Code;
    }
    throw new Error("Could not allocate room code.");
}

function CreateRoom(Account) {
    const Code = GenerateRoomCode();
    const StageId = StagesData.stages[Account.save.currentStage]
        ? Account.save.currentStage
        : StagesData.worlds[0].entryStage;
    const Room = {
        code: Code,
        hostUsername: Account.username,
        hostSocketId: null,
        players: new Map(),
        memberNames: new Set([Account.username]),
        messages: [],
        votes: new Map(),
        lives: MaxLives,
        maxLives: MaxLives,
        stageId: StageId,
        status: "lobby",
        lastOutcome: null,
        cleanupTimer: null
    };
    Rooms.set(Code, Room);
    ScheduleRoomCleanup(Room);
    return Room;
}

function GetRoomForSocket(Socket) {
    return Socket.data.roomCode ? Rooms.get(Socket.data.roomCode) || null : null;
}

function GetVoteState(Room) {
    const ActiveNames = new Set([...Room.players.values()].map(Player => Player.username));
    const Threshold = Math.max(1, Math.floor(Room.players.size / 2) + 1);
    const Votes = {};
    const SelectedIndexes = [];
    for (const [Index, Usernames] of Room.votes.entries()) {
        const Count = [...Usernames].filter(Username => ActiveNames.has(Username)).length;
        Votes[Index] = Count;
        if (Count >= Threshold) SelectedIndexes.push(Number(Index));
    }
    SelectedIndexes.sort((A, B) => A - B);
    return { votes: Votes, selectedIndexes: SelectedIndexes, threshold: Threshold };
}

function BuildRoomState(Room) {
    const VoteState = GetVoteState(Room);
    return {
        code: Room.code,
        hostUsername: Room.hostUsername,
        status: Room.status,
        stageId: Room.stageId,
        lives: Room.lives,
        maxLives: Room.maxLives,
        maxPlayers: MaxPlayers,
        players: [...Room.players.values()].map(Player => ({ username: Player.username, ready: Player.ready })),
        messages: Room.messages.slice(-ChatHistoryLimit),
        selectedIndexes: VoteState.selectedIndexes,
        votes: VoteState.votes,
        voteThreshold: VoteState.threshold,
        lastOutcome: Room.lastOutcome
    };
}

function EmitRoom(Room) {
    Io.to(Room.code).emit("room:state", BuildRoomState(Room));
}

function ScheduleRoomCleanup(Room) {
    if (Room.cleanupTimer) clearTimeout(Room.cleanupTimer);
    Room.cleanupTimer = setTimeout(() => {
        if (Room.players.size === 0) Rooms.delete(Room.code);
    }, 120000);
}

function ReassignHost(Room) {
    const FirstPlayer = [...Room.players.entries()][0];
    if (!FirstPlayer) {
        Room.hostSocketId = null;
        return;
    }
    Room.hostSocketId = FirstPlayer[0];
    Room.hostUsername = FirstPlayer[1].username;
}

function LeaveRoom(Socket, Explicit = false) {
    const Room = GetRoomForSocket(Socket);
    if (!Room) return;
    const Player = Room.players.get(Socket.id);
    Room.players.delete(Socket.id);
    Socket.leave(Room.code);
    Socket.data.roomCode = null;

    if (Player && Explicit) {
        Room.memberNames.delete(Player.username);
        for (const Usernames of Room.votes.values()) Usernames.delete(Player.username);
    }

    if (Room.hostSocketId === Socket.id) {
        Room.hostSocketId = null;
        if (Explicit && Room.players.size > 0) ReassignHost(Room);
    }

    if (Room.players.size === 0) ScheduleRoomCleanup(Room);
    else EmitRoom(Room);
}

function RemoveUsernameFromRooms(Username) {
    for (const [Code, Room] of [...Rooms.entries()]) {
        let Changed = false;

        for (const [SocketId, Player] of [...Room.players.entries()]) {
            if (Player.username !== Username) continue;
            const PlayerSocket = Io.sockets.sockets.get(SocketId);
            if (PlayerSocket) {
                PlayerSocket.data.roomCode = null;
                PlayerSocket.leave(Code);
            }
            Room.players.delete(SocketId);
            Changed = true;
        }

        if (Room.memberNames.delete(Username)) Changed = true;
        for (const Usernames of Room.votes.values()) Usernames.delete(Username);

        if (Room.hostUsername === Username) {
            if (Room.players.size > 0) ReassignHost(Room);
            else {
                if (Room.cleanupTimer) clearTimeout(Room.cleanupTimer);
                Rooms.delete(Code);
                continue;
            }
        }

        if (Changed) EmitRoom(Room);
    }
}

function AllowChatMessage(Socket) {
    const Now = Date.now();
    const Recent = Array.isArray(Socket.data.chatTimes)
        ? Socket.data.chatTimes.filter(Time => Now - Time < ChatRateLimitWindow)
        : [];

    if (Recent.length >= ChatRateLimitCount) {
        Socket.data.chatTimes = Recent;
        Socket.emit("room:chatError", { error: "Slow down. You can send up to 5 messages every 10 seconds." });
        return false;
    }

    Recent.push(Now);
    Socket.data.chatTimes = Recent;
    return true;
}

async function HandleApi(Request, Response, RequestPath, Origin) {
    if (!IsAllowedOrigin(Origin)) return SendJson(Response, 403, { error: "Origin not allowed." }, Origin);
    if (Request.method === "OPTIONS") return SendJson(Response, 204, {}, Origin);

    if (RequestPath === "/api/health" && Request.method === "GET") {
        if (!Database) return SendJson(Response, 503, { ok: false, multiplayer: true, database: false, version: BackendVersion, error: "DATABASE_URL is not configured." }, Origin);
        try {
            await Database.query("SELECT 1");
            return SendJson(Response, 200, { ok: true, multiplayer: true, database: true, version: BackendVersion }, Origin);
        } catch (Error) {
            console.error("Health database check failed", Error);
            return SendJson(Response, 503, { ok: false, multiplayer: true, database: false, version: BackendVersion, error: "Database connection failed." }, Origin);
        }
    }

    if (!Database) return SendJson(Response, 503, { error: "The account database is not configured yet." }, Origin);

    if (RequestPath === "/api/register" && Request.method === "POST") {
        try {
            const Body = await ReadJson(Request);
            const Username = NormalizeUsername(Body.username);
            if (!ValidateUsername(Username)) return SendJson(Response, 400, { error: "Username must be 3-20 letters, numbers, or underscores." }, Origin);
            if (!ValidatePassword(Body.password)) return SendJson(Response, 400, { error: "Password must be 8-128 characters." }, Origin);
            if (await GetAccountByUsername(Username)) return SendJson(Response, 409, { error: "That username already exists." }, Origin);
            const Account = await CreateAccount(Username, Body.password);
            return SendJson(Response, 201, { token: CreateToken(Username), profile: PublicProfile(Account), save: Account.save }, Origin);
        } catch (Error) {
            if (Error?.code === "23505") return SendJson(Response, 409, { error: "That username already exists." }, Origin);
            console.error("Register failed", Error);
            return SendJson(Response, 500, { error: "Could not create the account." }, Origin);
        }
    }

    if (RequestPath === "/api/login" && Request.method === "POST") {
        try {
            const Body = await ReadJson(Request);
            const Account = await GetAccountByUsername(Body.username);
            if (!Account || !ValidatePassword(Body.password) || !PasswordMatches(Body.password, Account.passwordHash)) {
                return SendJson(Response, 401, { error: "Wrong username or password." }, Origin);
            }
            Account.save = NormalizeSave(Account.save);
            await SaveAccount(Account);
            return SendJson(Response, 200, { token: CreateToken(Account.username), profile: PublicProfile(Account), save: Account.save }, Origin);
        } catch (Error) {
            console.error("Login failed", Error);
            return SendJson(Response, 500, { error: "Could not sign in." }, Origin);
        }
    }

    let Account;
    try {
        Account = await GetAccountByToken(GetBearerToken(Request));
    } catch (Error) {
        console.error("Authenticated account lookup failed", Error);
        return SendJson(Response, 503, { error: "Account database unavailable." }, Origin);
    }

    if (!Account) return SendJson(Response, 401, { error: "Sign in required." }, Origin);
    Account.save = NormalizeSave(Account.save);

    if (RequestPath === "/api/me" && Request.method === "GET") return SendJson(Response, 200, { profile: PublicProfile(Account) }, Origin);
    if (RequestPath === "/api/save" && Request.method === "GET") return SendJson(Response, 200, { save: Account.save }, Origin);

    if (RequestPath === "/api/room/create" && Request.method === "POST") {
        try {
            const Room = CreateRoom(Account);
            return SendJson(Response, 201, { ok: true, code: Room.code }, Origin);
        } catch (Error) {
            console.error("HTTP room create failed", Error);
            return SendJson(Response, 500, { error: "Could not create the room." }, Origin);
        }
    }

    if (RequestPath === "/api/account" && Request.method === "DELETE") {
        try {
            const Result = await Database.query("DELETE FROM accounts WHERE username_key = $1", [Account.usernameKey || UsernameKey(Account.username)]);
            if (Result.rowCount === 0) return SendJson(Response, 404, { error: "Account not found." }, Origin);
            RemoveUsernameFromRooms(Account.username);
            return SendJson(Response, 200, { ok: true }, Origin);
        } catch (Error) {
            console.error("Account deletion failed", Error);
            return SendJson(Response, 500, { error: "Could not delete the account." }, Origin);
        }
    }

    if (RequestPath === "/api/account/reset" && Request.method === "POST") {
        Account.save = DefaultSave();
        await SaveAccount(Account);
        return SendJson(Response, 200, { save: Account.save }, Origin);
    }

    if (RequestPath === "/api/stage/enter" && Request.method === "POST") {
        const Body = await ReadJson(Request).catch(() => ({}));
        const Stage = StagesData.stages[Body.stageId];
        if (!Stage || !Account.save.unlockedStages.includes(Stage.id)) return SendJson(Response, 403, { error: "Stage is locked." }, Origin);
        Account.save.currentStage = Stage.id;
        await SaveAccount(Account);
        return SendJson(Response, 200, { save: Account.save }, Origin);
    }

    if (RequestPath === "/api/stage/check" && Request.method === "POST") {
        const Body = await ReadJson(Request).catch(() => ({}));
        const Stage = StagesData.stages[Body.stageId];
        if (!Stage || !Account.save.unlockedStages.includes(Stage.id)) return SendJson(Response, 403, { error: "Stage is locked." }, Origin);
        const Result = ValidateStageResult(Stage.id, Body.removedIndexes);

        if (!Result.success) {
            const UpdatedSave = ApplyFailureToAccount(Account);
            await SaveAccount(Account);
            return SendJson(Response, 200, {
                success: false,
                reason: Result.reason,
                aftermath: Result.aftermath,
                lives: UpdatedSave.lives,
                maxLives: UpdatedSave.maxLives,
                gameOver: UpdatedSave.lives <= 0,
                save: UpdatedSave
            }, Origin);
        }

        ApplySuccessToAccount(Account, Stage.id, Result.stars);
        await SaveAccount(Account);
        return SendJson(Response, 200, {
            success: true,
            stars: Result.stars,
            nextStage: Stage.nextStage,
            isChapterEnd: Stage.isChapterEnd,
            lives: Account.save.lives,
            maxLives: Account.save.maxLives,
            save: Account.save
        }, Origin);
    }

    if (RequestPath === "/api/chapter/restart" && Request.method === "POST") {
        const Body = await ReadJson(Request).catch(() => ({}));
        const UpdatedSave = RestartChapterForAccount(Account, Body.worldId);
        await SaveAccount(Account);
        return SendJson(Response, 200, { save: UpdatedSave }, Origin);
    }

    if (RequestPath === "/api/settings" && Request.method === "POST") {
        const Body = await ReadJson(Request).catch(() => ({}));
        Account.save.settings.musicVolume = ClampNumber(Body.musicVolume, 0, 1, Account.save.settings.musicVolume);
        Account.save.settings.soundVolume = ClampNumber(Body.soundVolume, 0, 1, Account.save.settings.soundVolume);
        await SaveAccount(Account);
        return SendJson(Response, 200, { settings: Account.save.settings }, Origin);
    }

    return SendJson(Response, 404, { error: "API route not found." }, Origin);
}

const HttpServer = http.createServer(async (Request, Response) => {
    const Url = new URL(Request.url, `http://${Request.headers.host || "localhost"}`);
    const RequestPath = decodeURIComponent(Url.pathname);
    const Origin = String(Request.headers.origin || "");

    if (RequestPath.startsWith("/api/")) {
        try {
            await HandleApi(Request, Response, RequestPath, Origin);
        } catch (Error) {
            console.error("Unhandled API failure", Error);
            if (!Response.headersSent) SendJson(Response, 500, { error: "Server error." }, Origin);
        }
        return;
    }

    if (RequestPath === "/") {
        Response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        Response.end(JSON.stringify({ ok: true, service: "Story Rewrite backend", version: BackendVersion }));
        return;
    }

    Response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    Response.end("Not found");
});

const Io = new SocketServer(HttpServer, {
    cors: {
        origin(Origin, Callback) {
            if (IsAllowedOrigin(Origin)) return Callback(null, true);
            Callback(new Error("Origin not allowed"));
        },
        methods: ["GET", "POST"]
    }
});

Io.use(async (Socket, Next) => {
    try {
        if (!Database) return Next(new Error("DATABASE_UNAVAILABLE"));
        const Username = VerifyToken(Socket.handshake.auth?.token);
        if (!Username) return Next(new Error("AUTH_REQUIRED"));
        const Account = await GetAccountByUsername(Username);
        if (!Account) return Next(new Error("AUTH_REQUIRED"));
        Socket.data.username = Account.username;
        Socket.data.chatTimes = [];
        Next();
    } catch (Error) {
        console.error("Socket authentication failed", Error);
        Next(new Error("DATABASE_UNAVAILABLE"));
    }
});

Io.on("connection", Socket => {
    Socket.on("room:join", (Payload, Reply = () => {}) => {
        try {
            const Code = String(Payload?.code || "").trim().toUpperCase();
            const Room = Rooms.get(Code);
            if (!Room) return Reply({ ok: false, error: "Game code not found." });

            const Username = Socket.data.username;
            const ExistingEntry = [...Room.players.entries()].find(([, Player]) => Player.username === Username);
            if (ExistingEntry && ExistingEntry[0] !== Socket.id) {
                const OldSocket = Io.sockets.sockets.get(ExistingEntry[0]);
                if (OldSocket) {
                    OldSocket.data.roomCode = null;
                    OldSocket.leave(Room.code);
                }
                Room.players.delete(ExistingEntry[0]);
            }

            const ReturningMember = Room.memberNames.has(Username);
            if (Room.status !== "lobby" && !ReturningMember) return Reply({ ok: false, error: "That game already started." });
            if (!ReturningMember && Room.memberNames.size >= MaxPlayers) return Reply({ ok: false, error: "That game is full. Rooms can have up to 5 players." });

            LeaveRoom(Socket, true);
            if (Room.cleanupTimer) {
                clearTimeout(Room.cleanupTimer);
                Room.cleanupTimer = null;
            }

            Room.memberNames.add(Username);
            Room.players.set(Socket.id, { username: Username, ready: Room.status !== "lobby" });
            Socket.join(Room.code);
            Socket.data.roomCode = Room.code;
            if (Room.hostUsername === Username || !Room.hostSocketId) Room.hostSocketId = Socket.id;

            const State = BuildRoomState(Room);
            Reply({ ok: true, code: Room.code, state: State });
            EmitRoom(Room);
        } catch (Error) {
            console.error("Room join failed", Error);
            Reply({ ok: false, error: "Could not join the room." });
        }
    });

    Socket.on("room:leave", () => LeaveRoom(Socket, true));

    Socket.on("room:ready", Payload => {
        const Room = GetRoomForSocket(Socket);
        const Player = Room?.players.get(Socket.id);
        if (!Room || !Player || Room.status !== "lobby") return;
        Player.ready = Boolean(Payload?.ready);
        EmitRoom(Room);
    });

    Socket.on("room:chat", Payload => {
        const Room = GetRoomForSocket(Socket);
        if (!Room) return;

        const Text = String(Payload?.text || "").trim();
        if (!Text) return;
        if (Text.length > ChatMaxLength) {
            Socket.emit("room:chatError", { error: `Messages are limited to ${ChatMaxLength} characters.` });
            return;
        }
        if (!AllowChatMessage(Socket)) return;

        const Message = { username: Socket.data.username, text: Text, sentAt: Date.now() };
        Room.messages.push(Message);
        Room.messages = Room.messages.slice(-ChatHistoryLimit);
        Io.to(Room.code).emit("room:chat", Message);
    });

    Socket.on("room:start", async (Payload, Reply = () => {}) => {
        try {
            const Room = GetRoomForSocket(Socket);
            if (!Room) return Reply({ ok: false, error: "Room missing." });
            if (Room.hostSocketId !== Socket.id) return Reply({ ok: false, error: "Only the host can start." });
            if (Room.status !== "lobby") return Reply({ ok: false, error: "Game already started." });
            if ([...Room.players.values()].some(Player => !Player.ready && Player.username !== Room.hostUsername)) {
                return Reply({ ok: false, error: "Everyone else must be ready." });
            }

            const RequestedStage = StagesData.stages[Payload?.stageId] || StagesData.stages[Room.stageId];
            const HostAccount = await GetAccountByUsername(Room.hostUsername);
            if (!RequestedStage || !HostAccount || !NormalizeSave(HostAccount.save).unlockedStages.includes(RequestedStage.id)) {
                return Reply({ ok: false, error: "The host has not unlocked that stage." });
            }

            Room.stageId = RequestedStage.id;
            Room.status = "playing";
            Room.votes.clear();
            Room.lastOutcome = null;
            Room.lives = MaxLives;

            Reply({ ok: true, stageId: Room.stageId });
            Io.to(Room.code).emit("game:started", { code: Room.code, stageId: Room.stageId });
            EmitRoom(Room);
        } catch (Error) {
            console.error("Room start failed", Error);
            Reply({ ok: false, error: "Could not start the room." });
        }
    });

    Socket.on("game:vote", Payload => {
        const Room = GetRoomForSocket(Socket);
        if (!Room || Room.status !== "playing") return;
        const Stage = StagesData.stages[Room.stageId];
        const Index = Number(Payload?.index);
        if (!Stage || !Number.isInteger(Index) || Index < 0 || Index >= Stage.sentences.length) return;
        if (!Room.votes.has(Index)) Room.votes.set(Index, new Set());
        const Votes = Room.votes.get(Index);
        if (Votes.has(Socket.data.username)) Votes.delete(Socket.data.username);
        else Votes.add(Socket.data.username);
        if (Votes.size === 0) Room.votes.delete(Index);
        EmitRoom(Room);
    });

    Socket.on("game:check", async (Payload, Reply = () => {}) => {
        try {
            const Room = GetRoomForSocket(Socket);
            if (!Room || Room.status !== "playing") return Reply({ ok: false, error: "Game is not active." });
            if (Room.hostSocketId !== Socket.id) return Reply({ ok: false, error: "Only the host can check survival." });

            const Result = ValidateStageResult(Room.stageId, GetVoteState(Room).selectedIndexes);
            const Stage = StagesData.stages[Room.stageId];

            if (!Result.success) {
                Room.lives = Math.max(0, Room.lives - 1);
                Room.lastOutcome = {
                    success: false,
                    reason: Result.reason,
                    aftermath: Result.aftermath,
                    lives: Room.lives,
                    maxLives: Room.maxLives,
                    gameOver: Room.lives <= 0
                };
                if (Room.lives <= 0) Room.status = "gameover";
                Io.to(Room.code).emit("game:outcome", Room.lastOutcome);
                EmitRoom(Room);
                return Reply({ ok: true });
            }

            const Accounts = [];
            for (const Username of Room.memberNames) {
                const MemberAccount = await GetAccountByUsername(Username);
                if (!MemberAccount) continue;
                ApplySuccessToAccount(MemberAccount, Stage.id, Result.stars);
                Accounts.push(MemberAccount);
            }
            await SaveAccounts(Accounts);

            Room.lastOutcome = {
                success: true,
                stars: Result.stars,
                nextStage: Stage.nextStage,
                isChapterEnd: Stage.isChapterEnd,
                lives: Room.lives,
                maxLives: Room.maxLives
            };
            Io.to(Room.code).emit("game:outcome", Room.lastOutcome);
            EmitRoom(Room);
            Reply({ ok: true });
        } catch (Error) {
            console.error("Multiplayer result save failed", Error);
            Reply({ ok: false, error: "Could not save the multiplayer result." });
        }
    });

    Socket.on("game:retry", () => {
        const Room = GetRoomForSocket(Socket);
        if (!Room || Room.hostSocketId !== Socket.id || Room.lives <= 0) return;
        Room.votes.clear();
        Room.lastOutcome = null;
        Room.status = "playing";
        EmitRoom(Room);
        Io.to(Room.code).emit("game:retry");
    });

    Socket.on("game:next", () => {
        const Room = GetRoomForSocket(Socket);
        if (!Room || Room.hostSocketId !== Socket.id || !Room.lastOutcome?.success) return;
        const Stage = StagesData.stages[Room.stageId];
        if (!Stage?.nextStage) {
            Io.to(Room.code).emit("game:finished");
            return;
        }
        Room.stageId = Stage.nextStage;
        Room.votes.clear();
        Room.lastOutcome = null;
        Room.status = "playing";
        if (Stage.isChapterEnd) Room.lives = Room.maxLives;
        EmitRoom(Room);
        Io.to(Room.code).emit("game:stage", { stageId: Room.stageId });
    });

    Socket.on("game:restartChapter", async () => {
        try {
            const Room = GetRoomForSocket(Socket);
            if (!Room || Room.hostSocketId !== Socket.id || Room.lives > 0) return;
            const CurrentStage = StagesData.stages[Room.stageId];
            const World = GetWorld(CurrentStage?.worldId) || StagesData.worlds[0];
            Room.stageId = World.entryStage;
            Room.lives = Room.maxLives;
            Room.votes.clear();
            Room.lastOutcome = null;
            Room.status = "playing";

            const Accounts = [];
            for (const Username of Room.memberNames) {
                const MemberAccount = await GetAccountByUsername(Username);
                if (!MemberAccount) continue;
                RestartChapterForAccount(MemberAccount, World.id);
                Accounts.push(MemberAccount);
            }
            await SaveAccounts(Accounts);
            EmitRoom(Room);
            Io.to(Room.code).emit("game:stage", { stageId: Room.stageId, restarted: true });
        } catch (Error) {
            console.error("Restart chapter save failed", Error);
        }
    });

    Socket.on("disconnect", () => LeaveRoom(Socket, false));
});

HttpServer.listen(Port, () => {
    console.log(`Story Rewrite backend v${BackendVersion} listening on ${Port}`);
});

async function Shutdown() {
    try {
        await Database?.end();
    } finally {
        process.exit(0);
    }
}

process.on("SIGTERM", Shutdown);
process.on("SIGINT", Shutdown);
