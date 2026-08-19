const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Server: SocketServer } = require("socket.io");

const Root = __dirname;
const Port = Number(process.env.PORT || 57410);
const DataDirectory = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(Root, "data");
const AccountsPath = path.join(DataDirectory, "accounts.json");
const StagesData = JSON.parse(fs.readFileSync(path.join(Root, "stages.json"), "utf8"));
const SessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(48).toString("hex");
const Rooms = new Map();
const MaxPlayers = 4;
const MaxLives = 3;

fs.mkdirSync(DataDirectory, { recursive: true });

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

function LoadAccounts() {
    try {
        if (!fs.existsSync(AccountsPath)) return {};
        const Parsed = JSON.parse(fs.readFileSync(AccountsPath, "utf8"));
        return Parsed && typeof Parsed === "object" ? Parsed : {};
    } catch {
        return {};
    }
}

let Accounts = LoadAccounts();

function WriteAccounts() {
    const TemporaryPath = `${AccountsPath}.tmp`;
    fs.writeFileSync(TemporaryPath, JSON.stringify(Accounts, null, 2));
    fs.renameSync(TemporaryPath, AccountsPath);
}

function DefaultSave() {
    const FirstWorld = StagesData.worlds[0];
    return {
        version: 5,
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

function NormalizeSave(Save) {
    const Base = DefaultSave();
    const Result = Save && typeof Save === "object" ? Save : Base;

    Result.version = 5;
    if (!Array.isArray(Result.unlockedWorlds)) Result.unlockedWorlds = [...Base.unlockedWorlds];
    if (!Array.isArray(Result.unlockedStages)) Result.unlockedStages = [...Base.unlockedStages];
    if (!Result.stars || typeof Result.stars !== "object") Result.stars = {};
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

function ClampNumber(Value, Minimum, Maximum, Fallback) {
    const NumberValue = Number(Value);
    if (!Number.isFinite(NumberValue)) return Fallback;
    return Math.max(Minimum, Math.min(Maximum, NumberValue));
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

function HashPassword(Password, SaltHex) {
    return crypto.scryptSync(Password, Buffer.from(SaltHex, "hex"), 64).toString("hex");
}

function PasswordMatches(Password, Account) {
    const Actual = Buffer.from(HashPassword(Password, Account.salt), "hex");
    const Expected = Buffer.from(Account.passwordHash, "hex");
    return Actual.length === Expected.length && crypto.timingSafeEqual(Actual, Expected);
}

function EncodeBase64Url(Value) {
    return Buffer.from(Value).toString("base64url");
}

function CreateToken(Username) {
    const Payload = EncodeBase64Url(JSON.stringify({
        username: Username,
        expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 30,
        nonce: crypto.randomBytes(12).toString("hex")
    }));
    const Signature = crypto.createHmac("sha256", SessionSecret).update(Payload).digest("base64url");
    return `${Payload}.${Signature}`;
}

function VerifyToken(Token) {
    if (typeof Token !== "string" || !Token.includes(".")) return null;
    const [Payload, Signature] = Token.split(".");
    const Expected = crypto.createHmac("sha256", SessionSecret).update(Payload).digest("base64url");

    try {
        if (!crypto.timingSafeEqual(Buffer.from(Signature), Buffer.from(Expected))) return null;
        const Parsed = JSON.parse(Buffer.from(Payload, "base64url").toString("utf8"));
        if (!Parsed.username || Parsed.expiresAt < Date.now()) return null;
        const Key = UsernameKey(Parsed.username);
        if (!Accounts[Key]) return null;
        return Accounts[Key].username;
    } catch {
        return null;
    }
}

function GetBearerToken(Request) {
    const Header = Request.headers.authorization || "";
    return Header.startsWith("Bearer ") ? Header.slice(7) : "";
}

function GetAccountByToken(Token) {
    const Username = VerifyToken(Token);
    if (!Username) return null;
    return Accounts[UsernameKey(Username)] || null;
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
    const RemovedCount = RemovedIndexes.length;

    if (ExtraRemoved === 0 && RemovedCount <= Stage.par) return 3;
    if (ExtraRemoved <= 1 && RemovedCount <= Stage.par + 1) return 2;
    return 1;
}

function ValidateStageResult(StageId, RemovedIndexes) {
    const Stage = StagesData.stages[StageId];
    if (!Stage) return { valid: false, reason: "Unknown stage." };

    const UniqueIndexes = [...new Set((Array.isArray(RemovedIndexes) ? RemovedIndexes : []).map(Number))]
        .filter(Index => Number.isInteger(Index) && Index >= 0 && Index < Stage.sentences.length)
        .sort((A, B) => A - B);

    const RemovedSet = new Set(UniqueIndexes);
    const HasAllRequired = Stage.requiredRemoved.every(Index => RemovedSet.has(Index));
    const RemovedForbidden = Stage.forbiddenRemoved.some(Index => RemovedSet.has(Index));

    if (!HasAllRequired || RemovedForbidden) {
        return {
            valid: true,
            success: false,
            removedIndexes: UniqueIndexes,
            reason: RemovedForbidden
                ? "You erased something the successful ending still needs."
                : "At least one cause of failure is still active.",
            aftermath: Stage.aftermath
        };
    }

    return {
        valid: true,
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

function SendJson(Response, Status, Payload, Origin) {
    const Headers = {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
    };
    if (Origin) Headers["Access-Control-Allow-Origin"] = Origin;
    Headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization";
    Headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    Response.writeHead(Status, Headers);
    Response.end(JSON.stringify(Payload));
}

function IsAllowedOrigin(Origin) {
    if (!Origin) return true;
    const Configured = String(process.env.ALLOWED_ORIGINS || "")
        .split(",")
        .map(Value => Value.trim())
        .filter(Boolean);
    const Defaults = [
        `http://localhost:${Port}`,
        `http://127.0.0.1:${Port}`,
        "https://spongebobtdgameplay-prog.github.io"
    ];
    return [...Defaults, ...Configured].includes(Origin);
}

function ReadJson(Request) {
    return new Promise((Resolve, Reject) => {
        let Body = "";
        Request.on("data", Chunk => {
            Body += Chunk;
            if (Body.length > 1024 * 128) Request.destroy();
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
    if (!IsAllowedOrigin(Origin)) {
        SendJson(Response, 403, { error: "Origin not allowed." });
        return true;
    }

    if (Request.method === "OPTIONS") {
        SendJson(Response, 204, {}, Origin);
        return true;
    }

    if (RequestPath === "/api/health" && Request.method === "GET") {
        SendJson(Response, 200, { ok: true, multiplayer: true, version: 2 }, Origin);
        return true;
    }

    if (RequestPath === "/api/register" && Request.method === "POST") {
        try {
            const Body = await ReadJson(Request);
            const Username = NormalizeUsername(Body.username);
            const Password = Body.password;
            const Key = UsernameKey(Username);

            if (!ValidateUsername(Username)) {
                SendJson(Response, 400, { error: "Username must be 3-20 letters, numbers, or underscores." }, Origin);
                return true;
            }

            if (!ValidatePassword(Password)) {
                SendJson(Response, 400, { error: "Password must be 8-128 characters." }, Origin);
                return true;
            }

            if (Accounts[Key]) {
                SendJson(Response, 409, { error: "That username already exists." }, Origin);
                return true;
            }

            const Salt = crypto.randomBytes(16).toString("hex");
            const Account = {
                username: Username,
                salt: Salt,
                passwordHash: HashPassword(Password, Salt),
                createdAt: new Date().toISOString(),
                save: DefaultSave()
            };

            Accounts[Key] = Account;
            WriteAccounts();
            SendJson(Response, 201, { token: CreateToken(Username), profile: PublicProfile(Account), save: Account.save }, Origin);
            return true;
        } catch {
            SendJson(Response, 400, { error: "Invalid request." }, Origin);
            return true;
        }
    }

    if (RequestPath === "/api/login" && Request.method === "POST") {
        try {
            const Body = await ReadJson(Request);
            const Account = Accounts[UsernameKey(Body.username)];

            if (!Account || !ValidatePassword(Body.password) || !PasswordMatches(Body.password, Account)) {
                SendJson(Response, 401, { error: "Wrong username or password." }, Origin);
                return true;
            }

            Account.save = NormalizeSave(Account.save);
            WriteAccounts();
            SendJson(Response, 200, { token: CreateToken(Account.username), profile: PublicProfile(Account), save: Account.save }, Origin);
            return true;
        } catch {
            SendJson(Response, 400, { error: "Invalid request." }, Origin);
            return true;
        }
    }

    const Account = GetAccountByToken(GetBearerToken(Request));
    if (!Account) {
        SendJson(Response, 401, { error: "Sign in required." }, Origin);
        return true;
    }

    Account.save = NormalizeSave(Account.save);

    if (RequestPath === "/api/me" && Request.method === "GET") {
        SendJson(Response, 200, { profile: PublicProfile(Account) }, Origin);
        return true;
    }

    if (RequestPath === "/api/save" && Request.method === "GET") {
        SendJson(Response, 200, { save: Account.save }, Origin);
        return true;
    }

    if (RequestPath === "/api/account/reset" && Request.method === "POST") {
        Account.save = DefaultSave();
        WriteAccounts();
        SendJson(Response, 200, { save: Account.save }, Origin);
        return true;
    }

    if (RequestPath === "/api/stage/enter" && Request.method === "POST") {
        const Body = await ReadJson(Request).catch(() => ({}));
        const Stage = StagesData.stages[Body.stageId];

        if (!Stage || !Account.save.unlockedStages.includes(Stage.id)) {
            SendJson(Response, 403, { error: "Stage is locked." }, Origin);
            return true;
        }

        Account.save.currentStage = Stage.id;
        WriteAccounts();
        SendJson(Response, 200, { save: Account.save }, Origin);
        return true;
    }

    if (RequestPath === "/api/stage/check" && Request.method === "POST") {
        const Body = await ReadJson(Request).catch(() => ({}));
        const Stage = StagesData.stages[Body.stageId];

        if (!Stage || !Account.save.unlockedStages.includes(Stage.id)) {
            SendJson(Response, 403, { error: "Stage is locked." }, Origin);
            return true;
        }

        const Result = ValidateStageResult(Stage.id, Body.removedIndexes);
        if (!Result.success) {
            const Save = ApplyFailureToAccount(Account);
            WriteAccounts();
            SendJson(Response, 200, {
                success: false,
                reason: Result.reason,
                aftermath: Result.aftermath,
                lives: Save.lives,
                maxLives: Save.maxLives,
                gameOver: Save.lives <= 0,
                save: Save
            }, Origin);
            return true;
        }

        ApplySuccessToAccount(Account, Stage.id, Result.stars);
        WriteAccounts();
        SendJson(Response, 200, {
            success: true,
            stars: Result.stars,
            nextStage: Stage.nextStage,
            isChapterEnd: Stage.isChapterEnd,
            lives: Account.save.lives,
            maxLives: Account.save.maxLives,
            save: Account.save
        }, Origin);
        return true;
    }

    if (RequestPath === "/api/chapter/restart" && Request.method === "POST") {
        const Body = await ReadJson(Request).catch(() => ({}));
        const Save = RestartChapterForAccount(Account, Body.worldId);
        WriteAccounts();
        SendJson(Response, 200, { save: Save }, Origin);
        return true;
    }

    if (RequestPath === "/api/settings" && Request.method === "POST") {
        const Body = await ReadJson(Request).catch(() => ({}));
        Account.save.settings.musicVolume = ClampNumber(Body.musicVolume, 0, 1, Account.save.settings.musicVolume);
        Account.save.settings.soundVolume = ClampNumber(Body.soundVolume, 0, 1, Account.save.settings.soundVolume);
        WriteAccounts();
        SendJson(Response, 200, { settings: Account.save.settings }, Origin);
        return true;
    }

    SendJson(Response, 404, { error: "API route not found." }, Origin);
    return true;
}

const HttpServer = http.createServer(async (Request, Response) => {
    const Url = new URL(Request.url, `http://${Request.headers.host || "localhost"}`);
    let RequestPath = decodeURIComponent(Url.pathname);
    const Origin = Request.headers.origin || "";

    if (RequestPath.startsWith("/api/")) {
        await HandleApi(Request, Response, RequestPath, Origin);
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
            "Cache-Control": Extension === ".mp3" || Extension === ".ogg" || Extension === ".wav" ? "public, max-age=3600" : "no-store"
        });
        fs.createReadStream(FilePath).pipe(Response);
    });
});

const Io = new SocketServer(HttpServer, {
    cors: {
        origin(Origin, Callback) {
            if (IsAllowedOrigin(Origin)) Callback(null, true);
            else Callback(new Error("Origin not allowed"));
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

function GetRoomPlayer(Room, Socket) {
    return Room.players.get(Socket.id) || null;
}

function GetRoomForSocket(Socket) {
    if (!Socket.data.roomCode) return null;
    return Rooms.get(Socket.data.roomCode) || null;
}

function GetVoteState(Room) {
    const Players = [...Room.players.values()];
    const Threshold = Math.floor(Players.length / 2) + 1;
    const Votes = {};
    const SelectedIndexes = [];

    for (const [Index, Usernames] of Room.votes.entries()) {
        const ActiveNames = new Set(Players.map(Player => Player.username));
        const Count = [...Usernames].filter(Username => ActiveNames.has(Username)).length;
        Votes[Index] = Count;
        if (Count >= Threshold) SelectedIndexes.push(Number(Index));
    }

    SelectedIndexes.sort((A, B) => A - B);
    return { votes: Votes, selectedIndexes: SelectedIndexes, threshold };
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

function LeaveRoom(Socket) {
    const Room = GetRoomForSocket(Socket);
    if (!Room) return;

    const Player = Room.players.get(Socket.id);
    Room.players.delete(Socket.id);

    if (Player) {
        for (const Usernames of Room.votes.values()) Usernames.delete(Player.username);
    }

    Socket.leave(Room.code);
    Socket.data.roomCode = null;

    if (Room.players.size === 0) {
        Rooms.delete(Room.code);
        return;
    }

    if (Room.hostSocketId === Socket.id) {
        const [NextSocketId, NextPlayer] = Room.players.entries().next().value;
        Room.hostSocketId = NextSocketId;
        Room.hostUsername = NextPlayer.username;
    }

    EmitRoom(Room);
}

Io.use((Socket, Next) => {
    const Username = VerifyToken(Socket.handshake.auth?.token);
    if (!Username) {
        Next(new Error("AUTH_REQUIRED"));
        return;
    }
    Socket.data.username = Username;
    Next();
});

Io.on("connection", Socket => {
    Socket.on("room:create", (Payload, Reply = () => {}) => {
        LeaveRoom(Socket);
        const Account = Accounts[UsernameKey(Socket.data.username)];
        const Save = NormalizeSave(Account.save);
        const Code = GenerateRoomCode();
        const Room = {
            code: Code,
            hostSocketId: Socket.id,
            hostUsername: Socket.data.username,
            players: new Map(),
            messages: [],
            votes: new Map(),
            lives: MaxLives,
            maxLives: MaxLives,
            stageId: Save.currentStage,
            status: "lobby",
            lastOutcome: null
        };

        Room.players.set(Socket.id, { username: Socket.data.username, ready: false });
        Rooms.set(Code, Room);
        Socket.join(Code);
        Socket.data.roomCode = Code;
        Reply({ ok: true, code, state: BuildRoomState(Room) });
        EmitRoom(Room);
    });

    Socket.on("room:join", (Payload, Reply = () => {}) => {
        const Code = String(Payload?.code || "").trim().toUpperCase();
        const Room = Rooms.get(Code);

        if (!Room) return Reply({ ok: false, error: "Game code not found." });
        if (Room.status !== "lobby") return Reply({ ok: false, error: "That game already started." });
        if (Room.players.size >= MaxPlayers) return Reply({ ok: false, error: "That game is full." });
        if ([...Room.players.values()].some(Player => Player.username === Socket.data.username)) {
            return Reply({ ok: false, error: "That account is already in the room." });
        }

        LeaveRoom(Socket);
        Room.players.set(Socket.id, { username: Socket.data.username, ready: false });
        Socket.join(Code);
        Socket.data.roomCode = Code;
        Reply({ ok: true, code, state: BuildRoomState(Room) });
        EmitRoom(Room);
    });

    Socket.on("room:leave", () => LeaveRoom(Socket));

    Socket.on("room:ready", Payload => {
        const Room = GetRoomForSocket(Socket);
        const Player = Room ? GetRoomPlayer(Room, Socket) : null;
        if (!Room || !Player || Room.status !== "lobby") return;
        Player.ready = Boolean(Payload?.ready);
        EmitRoom(Room);
    });

    Socket.on("room:chat", Payload => {
        const Room = GetRoomForSocket(Socket);
        if (!Room) return;
        const Text = String(Payload?.text || "").trim().slice(0, 300);
        if (!Text) return;
        Room.messages.push({
            username: Socket.data.username,
            text: Text,
            sentAt: Date.now()
        });
        Room.messages = Room.messages.slice(-50);
        Io.to(Room.code).emit("room:chat", Room.messages[Room.messages.length - 1]);
    });

    Socket.on("room:start", (Payload, Reply = () => {}) => {
        const Room = GetRoomForSocket(Socket);
        if (!Room) return Reply({ ok: false, error: "Room missing." });
        if (Room.hostSocketId !== Socket.id) return Reply({ ok: false, error: "Only the host can start." });
        if (Room.status !== "lobby") return Reply({ ok: false, error: "Game already started." });
        if ([...Room.players.values()].some(Player => !Player.ready && Player.username !== Room.hostUsername)) {
            return Reply({ ok: false, error: "Everyone else must be ready." });
        }

        const RequestedStage = StagesData.stages[Payload?.stageId] || StagesData.stages[Room.stageId];
        const HostAccount = Accounts[UsernameKey(Room.hostUsername)];
        if (!RequestedStage || !NormalizeSave(HostAccount.save).unlockedStages.includes(RequestedStage.id)) {
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
    });

    Socket.on("game:vote", Payload => {
        const Room = GetRoomForSocket(Socket);
        if (!Room || Room.status !== "playing") return;
        const Stage = StagesData.stages[Room.stageId];
        const Index = Number(Payload?.index);
        if (!Stage || !Number.isInteger(Index) || Index < 0 || Index >= Stage.sentences.length) return;

        if (!Room.votes.has(Index)) Room.votes.set(Index, new Set());
        const Set = Room.votes.get(Index);
        if (Set.has(Socket.data.username)) Set.delete(Socket.data.username);
        else Set.add(Socket.data.username);
        if (Set.size === 0) Room.votes.delete(Index);
        EmitRoom(Room);
    });

    Socket.on("game:check", (Payload, Reply = () => {}) => {
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
            Reply({ ok: true });
            return;
        }

        for (const Player of Room.players.values()) {
            const Account = Accounts[UsernameKey(Player.username)];
            if (Account) ApplySuccessToAccount(Account, Stage.id, Result.stars);
        }
        WriteAccounts();

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

    Socket.on("game:restartChapter", () => {
        const Room = GetRoomForSocket(Socket);
        if (!Room || Room.hostSocketId !== Socket.id || Room.lives > 0) return;
        const CurrentStage = StagesData.stages[Room.stageId];
        const World = GetWorld(CurrentStage?.worldId) || StagesData.worlds[0];
        Room.stageId = World.entryStage;
        Room.lives = Room.maxLives;
        Room.votes.clear();
        Room.lastOutcome = null;
        Room.status = "playing";

        for (const Player of Room.players.values()) {
            const Account = Accounts[UsernameKey(Player.username)];
            if (Account) RestartChapterForAccount(Account, World.id);
        }
        WriteAccounts();

        EmitRoom(Room);
        Io.to(Room.code).emit("game:stage", { stageId: Room.stageId, restarted: true });
    });

    Socket.on("disconnect", () => LeaveRoom(Socket));
});

HttpServer.listen(Port, () => {
    console.log(`Story Rewrite server running at http://localhost:${Port}`);
    if (!process.env.SESSION_SECRET) console.log("SESSION_SECRET is not set. Development sessions will reset when the server restarts.");
});
