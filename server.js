const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");
const { Server: SocketServer } = require("socket.io");

const Root = __dirname;
const Port = Number(process.env.PORT || 57410);
const DatabaseUrl = String(process.env.DATABASE_URL || "").trim();
const StagesData = JSON.parse(fs.readFileSync(path.join(Root, "stages.json"), "utf8"));
const SessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(48).toString("hex");
const Rooms = new Map();
const MaxPlayers = 4;
const MaxLives = 3;

const Database = DatabaseUrl
    ? new Pool({
        connectionString: DatabaseUrl,
        ssl: { rejectUnauthorized: false },
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000
    })
    : null;

const MimeTypes = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
    ".wav": "audio/wav",
    ".mp4": "video/mp4",
    ".webm": "video/webm"
};

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

function ClampNumber(Value, Minimum, Maximum, Fallback) {
    const NumberValue = Number(Value);
    return Number.isFinite(NumberValue)
        ? Math.max(Minimum, Math.min(Maximum, NumberValue))
        : Fallback;
}

function NormalizeSave(Save) {
    const Base = DefaultSave();
    const Result = Save && typeof Save === "object" ? structuredClone(Save) : structuredClone(Base);

    Result.version = 6;
    if (!Array.isArray(Result.unlockedWorlds)) Result.unlockedWorlds = [...Base.unlockedWorlds];
    if (!Array.isArray(Result.unlockedStages)) Result.unlockedStages = [...Base.unlockedStages];
    if (!Result.stars || typeof Result.stars !== "object" || Array.isArray(Result.stars)) Result.stars = {};
    if (!StagesData.stages[Result.currentStage]) Result.currentStage = Base.currentStage;
    if (!Number.isInteger(Result.lives)) Result.lives = MaxLives;
    if (!Number.isInteger(Result.maxLives)) Result.maxLives = MaxLives;
    if (!Number.isInteger(Result.deaths)) Result.deaths = 0;
    if (!Result.settings || typeof Result.settings !== "object") Result.settings = { ...Base.settings };

    Result.settings.musicVolume = ClampNumber(Result.settings.musicVolume, 0, 1, Base.settings.musicVolume);
    Result.settings.soundVolume = ClampNumber(Result.settings.soundVolume, 0, 1, Base.settings.soundVolume);

    if (!Result.unlockedWorlds.includes(Base.unlockedWorlds[0])) Result.unlockedWorlds.push(Base.unlockedWorlds[0]);
    if (!Result.unlockedStages.includes(Base.unlockedStages[0])) Result.unlockedStages.push(Base.unlockedStages[0]);

    Result.lives = Math.max(0, Math.min(Result.maxLives, Result.lives));
    return Result;
}

function NormalizeUsername(Value) {
    return String(Value || "").trim();
}

function UsernameKey(Value) {
    return NormalizeUsername(Value).toLowerCase();
}

function ValidateUsername(Username) {
    return /^[A-Za-z0-9_]{3,20}$/.test(Username);
}

function ValidatePassword(Password) {
    return typeof Password === "string" && Password.length >= 8 && Password.length <= 128;
}

function CreatePasswordHash(Password) {
    const Salt = crypto.randomBytes(16);
    const Hash = crypto.scryptSync(Password, Salt, 64);
    return `scrypt$${Salt.toString("hex")}$${Hash.toString("hex")}`;
}

function PasswordMatches(Password, StoredHash) {
    if (typeof StoredHash !== "string") return false;

    const Parts = StoredHash.split("$");
    if (Parts.length !== 3 || Parts[0] !== "scrypt") return false;

    try {
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
    if (typeof Token !== "string" || !Token.includes(".")) return null;

    const [Payload, Signature] = Token.split(".");
    const Expected = crypto.createHmac("sha256", SessionSecret).update(Payload).digest("base64url");

    try {
        const SignatureBuffer = Buffer.from(Signature);
        const ExpectedBuffer = Buffer.from(Expected);
        if (SignatureBuffer.length !== ExpectedBuffer.length) return null;
        if (!crypto.timingSafeEqual(SignatureBuffer, ExpectedBuffer)) return null;

        const Parsed = JSON.parse(Buffer.from(Payload, "base64url").toString("utf8"));
        if (!Parsed.username || Parsed.expiresAt < Date.now()) return null;
        return NormalizeUsername(Parsed.username);
    } catch {
        return null;
    }
}

function GetBearerToken(Request) {
    const Header = Request.headers.authorization || "";
    return Header.startsWith("Bearer ") ? Header.slice(7) : "";
}

function DatabaseReady() {
    return Boolean(Database);
}

async function GetAccountByUsername(Username) {
    if (!Database) return null;

    const Key = UsernameKey(Username);
    const Result = await Database.query(
        `SELECT username_key, username, password_hash, save_data, created_at
         FROM accounts
         WHERE username_key = $1
         LIMIT 1`,
        [Key]
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
    if (!Username) return null;
    return GetAccountByUsername(Username);
}

async function CreateAccount(Username, Password) {
    const Account = {
        usernameKey: UsernameKey(Username),
        username: Username,
        passwordHash: CreatePasswordHash(Password),
        save: DefaultSave()
    };

    const Result = await Database.query(
        `INSERT INTO accounts (username_key, username, password_hash, save_data)
         VALUES ($1, $2, $3, $4::jsonb)
         RETURNING created_at`,
        [
            Account.usernameKey,
            Account.username,
            Account.passwordHash,
            JSON.stringify(Account.save)
        ]
    );

    Account.createdAt = Result.rows[0].created_at.toISOString();
    return Account;
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

function UnlockStage(Save, StageId) {
    const Stage = StagesData.stages[StageId];
    if (!Stage) return;
    if (!Save.unlockedStages.includes(StageId)) Save.unlockedStages.push(StageId);
    if (!Save.unlockedWorlds.includes(Stage.worldId)) Save.unlockedWorlds.push(Stage.worldId);
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

    if (!Stage) {
        return {
            success: false,
            reason: "Unknown stage.",
            aftermath: "The page could not be read."
        };
    }

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

function GetWorld(WorldId) {
    return StagesData.worlds.find(World => World.id === WorldId) || null;
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

function IsAllowedOrigin(Origin) {
    if (!Origin) return true;

    const Configured = String(process.env.ALLOWED_ORIGINS || "")
        .split(",")
        .map(Value => Value.trim())
        .filter(Boolean);

    return [
        `http://localhost:${Port}`,
        `http://127.0.0.1:${Port}`,
        "https://spongebobtdgameplay-prog.github.io",
        ...Configured
    ].includes(Origin);
}

function SendJson(Response, Status, Payload, Origin = "") {
    const Headers = {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
    };

    if (Origin) Headers["Access-Control-Allow-Origin"] = Origin;
    Response.writeHead(Status, Headers);
    Response.end(JSON.stringify(Payload));
}

function ReadJson(Request) {
    return new Promise((Resolve, Reject) => {
        let Body = "";

        Request.on("data", Chunk => {
            Body += Chunk;
            if (Body.length > 131072) Request.destroy();
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

async function HandleApi(Request, Response, RequestPath, Origin) {
    if (!IsAllowedOrigin(Origin)) return SendJson(Response, 403, { error: "Origin not allowed." });
    if (Request.method === "OPTIONS") return SendJson(Response, 204, {}, Origin);

    if (RequestPath === "/api/health" && Request.method === "GET") {
        if (!Database) {
            return SendJson(Response, 503, {
                ok: false,
                multiplayer: true,
                database: false,
                error: "DATABASE_URL is not configured."
            }, Origin);
        }

        try {
            await Database.query("SELECT 1");
            return SendJson(Response, 200, {
                ok: true,
                multiplayer: true,
                database: true,
                version: 3
            }, Origin);
        } catch {
            return SendJson(Response, 503, {
                ok: false,
                multiplayer: true,
                database: false,
                error: "Database connection failed."
            }, Origin);
        }
    }

    if (!DatabaseReady()) {
        return SendJson(Response, 503, { error: "The account database is not configured yet." }, Origin);
    }

    if (RequestPath === "/api/register" && Request.method === "POST") {
        try {
            const Body = await ReadJson(Request);
            const Username = NormalizeUsername(Body.username);
            const Password = Body.password;

            if (!ValidateUsername(Username)) {
                return SendJson(Response, 400, { error: "Username must be 3-20 letters, numbers, or underscores." }, Origin);
            }

            if (!ValidatePassword(Password)) {
                return SendJson(Response, 400, { error: "Password must be 8-128 characters." }, Origin);
            }

            const Existing = await GetAccountByUsername(Username);
            if (Existing) return SendJson(Response, 409, { error: "That username already exists." }, Origin);

            const Account = await CreateAccount(Username, Password);
            return SendJson(Response, 201, {
                token: CreateToken(Username),
                profile: PublicProfile(Account),
                save: Account.save
            }, Origin);
        } catch (Error) {
            if (Error?.code === "23505") {
                return SendJson(Response, 409, { error: "That username already exists." }, Origin);
            }
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

            return SendJson(Response, 200, {
                token: CreateToken(Account.username),
                profile: PublicProfile(Account),
                save: Account.save
            }, Origin);
        } catch (Error) {
            console.error("Login failed", Error);
            return SendJson(Response, 500, { error: "Could not sign in." }, Origin);
        }
    }

    let Account;

    try {
        Account = await GetAccountByToken(GetBearerToken(Request));
    } catch (Error) {
        console.error("Account lookup failed", Error);
        return SendJson(Response, 503, { error: "Account database unavailable." }, Origin);
    }

    if (!Account) return SendJson(Response, 401, { error: "Sign in required." }, Origin);
    Account.save = NormalizeSave(Account.save);

    if (RequestPath === "/api/me" && Request.method === "GET") {
        return SendJson(Response, 200, { profile: PublicProfile(Account) }, Origin);
    }

    if (RequestPath === "/api/save" && Request.method === "GET") {
        return SendJson(Response, 200, { save: Account.save }, Origin);
    }

    if (RequestPath === "/api/account/reset" && Request.method === "POST") {
        Account.save = DefaultSave();
        await SaveAccount(Account);
        return SendJson(Response, 200, { save: Account.save }, Origin);
    }

    if (RequestPath === "/api/stage/enter" && Request.method === "POST") {
        const Body = await ReadJson(Request).catch(() => ({}));
        const Stage = StagesData.stages[Body.stageId];

        if (!Stage || !Account.save.unlockedStages.includes(Stage.id)) {
            return SendJson(Response, 403, { error: "Stage is locked." }, Origin);
        }

        Account.save.currentStage = Stage.id;
        await SaveAccount(Account);
        return SendJson(Response, 200, { save: Account.save }, Origin);
    }

    if (RequestPath === "/api/stage/check" && Request.method === "POST") {
        const Body = await ReadJson(Request).catch(() => ({}));
        const Stage = StagesData.stages[Body.stageId];

        if (!Stage || !Account.save.unlockedStages.includes(Stage.id)) {
            return SendJson(Response, 403, { error: "Stage is locked." }, Origin);
        }

        const Result = ValidateStageResult(Stage.id, Body.removedIndexes);

        if (!Result.success) {
            const Save = ApplyFailureToAccount(Account);
            await SaveAccount(Account);

            return SendJson(Response, 200, {
                success: false,
                reason: Result.reason,
                aftermath: Result.aftermath,
                lives: Save.lives,
                maxLives: Save.maxLives,
                gameOver: Save.lives <= 0,
                save: Save
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
        const Save = RestartChapterForAccount(Account, Body.worldId);
        await SaveAccount(Account);
        return SendJson(Response, 200, { save: Save }, Origin);
    }

    if (RequestPath === "/api/settings" && Request.method === "POST") {
        const Body = await ReadJson(Request).catch(() => ({}));

        Account.save.settings.musicVolume = ClampNumber(
            Body.musicVolume,
            0,
            1,
            Account.save.settings.musicVolume
        );

        Account.save.settings.soundVolume = ClampNumber(
            Body.soundVolume,
            0,
            1,
            Account.save.settings.soundVolume
        );

        await SaveAccount(Account);
        return SendJson(Response, 200, { settings: Account.save.settings }, Origin);
    }

    return SendJson(Response, 404, { error: "API route not found." }, Origin);
}

const HttpServer = http.createServer(async (Request, Response) => {
    const Url = new URL(Request.url, `http://${Request.headers.host || "localhost"}`);
    let RequestPath = decodeURIComponent(Url.pathname);
    const Origin = Request.headers.origin || "";

    if (RequestPath.startsWith("/api/")) {
        try {
            await HandleApi(Request, Response, RequestPath, Origin);
        } catch (Error) {
            console.error("API request failed", Error);
            if (!Response.headersSent) SendJson(Response, 500, { error: "Server error." }, Origin);
        }
        return;
    }

    if (RequestPath === "/") RequestPath = "/index.html";

    const RelativePath = RequestPath.replace(/^\/+/, "");
    const FilePath = path.resolve(Root, RelativePath);

    if (!FilePath.startsWith(`${Root}${path.sep}`) && FilePath !== Root) {
        Response.writeHead(403);
        Response.end("Forbidden");
        return;
    }

    fs.stat(FilePath, (StatError, Stats) => {
        if (StatError || !Stats.isFile()) {
            Response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
            Response.end("Not found");
            return;
        }

        const Extension = path.extname(FilePath).toLowerCase();

        Response.writeHead(200, {
            "Content-Type": MimeTypes[Extension] || "application/octet-stream",
            "Cache-Control": [".mp3", ".ogg", ".wav"].includes(Extension)
                ? "public, max-age=3600"
                : "no-store"
        });

        fs.createReadStream(FilePath).pipe(Response);
    });
});

const Io = new SocketServer(HttpServer, {
    cors: {
        origin(Origin, Callback) {
            IsAllowedOrigin(Origin)
                ? Callback(null, true)
                : Callback(new Error("Origin not allowed"));
        },
        methods: ["GET", "POST"]
    }
});

function GenerateRoomCode() {
    const Alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let Code = "";

    do {
        Code = "";
        for (let Index = 0; Index < 6; Index += 1) {
            Code += Alphabet[crypto.randomInt(0, Alphabet.length)];
        }
    } while (Rooms.has(Code));

    return Code;
}

function GetRoomForSocket(Socket) {
    return Socket.data.roomCode ? Rooms.get(Socket.data.roomCode) || null : null;
}

function GetVoteState(Room) {
    const Players = [...Room.players.values()];
    const Threshold = Math.max(1, Math.floor(Players.length / 2) + 1);
    const ActiveNames = new Set(Players.map(Player => Player.username));
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
        players: [...Room.players.values()].map(Player => ({
            username: Player.username,
            ready: Player.ready
        })),
        messages: Room.messages.slice(-50),
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
    clearTimeout(Room.cleanupTimer);
    Room.cleanupTimer = setTimeout(() => {
        if (Room.players.size === 0) Rooms.delete(Room.code);
    }, 60000);
}

function ReassignHost(Room) {
    const Next = [...Room.players.entries()][0];
    if (!Next) return;
    Room.hostSocketId = Next[0];
    Room.hostUsername = Next[1].username;
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

        if (Explicit) {
            ReassignHost(Room);
        } else {
            setTimeout(() => {
                if (!Rooms.has(Room.code) || Room.hostSocketId) return;
                ReassignHost(Room);
                EmitRoom(Room);
            }, 5000);
        }
    }

    if (Room.players.size === 0) ScheduleRoomCleanup(Room);
    else EmitRoom(Room);
}

Io.use(async (Socket, Next) => {
    try {
        if (!Database) return Next(new Error("DATABASE_UNAVAILABLE"));

        const Username = VerifyToken(Socket.handshake.auth?.token);
        if (!Username) return Next(new Error("AUTH_REQUIRED"));

        const Account = await GetAccountByUsername(Username);
        if (!Account) return Next(new Error("AUTH_REQUIRED"));

        Socket.data.username = Account.username;
        Next();
    } catch (Error) {
        console.error("Socket authentication failed", Error);
        Next(new Error("DATABASE_UNAVAILABLE"));
    }
});

Io.on("connection", Socket => {
    Socket.on("room:create", async (Payload, Reply = () => {}) => {
        try {
            LeaveRoom(Socket, true);
            const Account = await GetAccountByUsername(Socket.data.username);
            if (!Account) return Reply({ ok: false, error: "Account not found." });

            const Save = NormalizeSave(Account.save);
            const Code = GenerateRoomCode();
            const Room = {
                code: Code,
                hostSocketId: Socket.id,
                hostUsername: Socket.data.username,
                players: new Map(),
                memberNames: new Set([Socket.data.username]),
                messages: [],
                votes: new Map(),
                lives: MaxLives,
                maxLives: MaxLives,
                stageId: Save.currentStage,
                status: "lobby",
                lastOutcome: null,
                cleanupTimer: null
            };

            Room.players.set(Socket.id, { username: Socket.data.username, ready: false });
            Rooms.set(Code, Room);
            Socket.join(Code);
            Socket.data.roomCode = Code;
            Reply({ ok: true, code, state: BuildRoomState(Room) });
            EmitRoom(Room);
        } catch (Error) {
            console.error("Room create failed", Error);
            Reply({ ok: false, error: "Could not create the room." });
        }
    });

    Socket.on("room:join", (Payload, Reply = () => {}) => {
        const Code = String(Payload?.code || "").trim().toUpperCase();
        const Room = Rooms.get(Code);

        if (!Room) return Reply({ ok: false, error: "Game code not found." });

        const ExistingConnected = [...Room.players.values()]
            .some(Player => Player.username === Socket.data.username);

        if (ExistingConnected) {
            return Reply({ ok: false, error: "That account is already connected to the room." });
        }

        const ReturningMember = Room.memberNames.has(Socket.data.username);
        if (Room.status !== "lobby" && !ReturningMember) {
            return Reply({ ok: false, error: "That game already started." });
        }

        if (!ReturningMember && Room.memberNames.size >= MaxPlayers) {
            return Reply({ ok: false, error: "That game is full." });
        }

        LeaveRoom(Socket, true);
        clearTimeout(Room.cleanupTimer);
        Room.cleanupTimer = null;
        Room.memberNames.add(Socket.data.username);
        Room.players.set(Socket.id, {
            username: Socket.data.username,
            ready: Room.status !== "lobby"
        });

        Socket.join(Code);
        Socket.data.roomCode = Code;
        if (Room.hostUsername === Socket.data.username) Room.hostSocketId = Socket.id;
        Reply({ ok: true, code, state: BuildRoomState(Room) });
        EmitRoom(Room);
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

        const Text = String(Payload?.text || "").trim().slice(0, 300);
        if (!Text) return;

        const Message = {
            username: Socket.data.username,
            text: Text,
            sentAt: Date.now()
        };

        Room.messages.push(Message);
        Room.messages = Room.messages.slice(-50);
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
                const Account = await GetAccountByUsername(Username);
                if (!Account) continue;
                ApplySuccessToAccount(Account, Stage.id, Result.stars);
                Accounts.push(Account);
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
        if (!Stage?.nextStage) return Io.to(Room.code).emit("game:finished");

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
                const Account = await GetAccountByUsername(Username);
                if (!Account) continue;
                RestartChapterForAccount(Account, World.id);
                Accounts.push(Account);
            }

            await SaveAccounts(Accounts);
            EmitRoom(Room);
            Io.to(Room.code).emit("game:stage", {
                stageId: Room.stageId,
                restarted: true
            });
        } catch (Error) {
            console.error("Restart chapter save failed", Error);
        }
    });

    Socket.on("disconnect", () => LeaveRoom(Socket, false));
});

HttpServer.listen(Port, () => {
    console.log(`Story Rewrite server running at http://localhost:${Port}`);
    console.log(Database ? "Neon Postgres configured." : "DATABASE_URL is not configured.");

    if (!process.env.SESSION_SECRET) {
        console.log("SESSION_SECRET is not set. Development sessions will reset when the server restarts.");
    }
});

process.on("SIGTERM", async () => {
    try {
        await Database?.end();
    } finally {
        process.exit(0);
    }
});
