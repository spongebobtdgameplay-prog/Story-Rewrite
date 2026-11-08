"use strict";

function createThinkRuntime(Dependencies) {
    const Database = Dependencies.Database;
    const Io = Dependencies.Io;
    const UsernameKey = Dependencies.UsernameKey;
    const ReadJson = Dependencies.ReadJson;
    const SendJson = Dependencies.SendJson;
    const Rooms = Dependencies.Rooms instanceof Map ? Dependencies.Rooms : null;
    const OwnerKey = "darius56";
    let SchemaPromise = null;
    const SafetyBotRequestWindows = new Map();

    async function ensureSchema() {
        if (!Database) throw new Error("The account database is not configured.");
        if (!SchemaPromise) {
            SchemaPromise = (async () => {
                await Database.query("CREATE TABLE IF NOT EXISTS story_rewrite_think_staff (username_key TEXT PRIMARY KEY, username TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('developer','moderator','top_moderator')), active BOOLEAN NOT NULL DEFAULT TRUE, appointed_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
                await Database.query("CREATE TABLE IF NOT EXISTS story_rewrite_think_cases (id BIGSERIAL PRIMARY KEY, target_username_key TEXT NOT NULL, target_username TEXT NOT NULL, category TEXT NOT NULL, reason TEXT NOT NULL, evidence TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'reported' CHECK (status IN ('reported','under_review','confirmed','cleared')), filed_by_key TEXT NOT NULL, filed_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), reviewed_by TEXT, review_note TEXT)");
                await Database.query("CREATE INDEX IF NOT EXISTS story_rewrite_think_cases_target_idx ON story_rewrite_think_cases (target_username_key, created_at DESC)");
                await Database.query("CREATE TABLE IF NOT EXISTS story_rewrite_think_requests (id BIGSERIAL PRIMARY KEY, case_id BIGINT NOT NULL REFERENCES story_rewrite_think_cases(id), action_type TEXT NOT NULL CHECK (action_type IN ('suspend_account','terminate_sessions')), target_username_key TEXT NOT NULL, target_username TEXT NOT NULL, reason TEXT NOT NULL, evidence TEXT NOT NULL, requested_by_key TEXT NOT NULL, requested_by TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')), storybot_json JSONB NOT NULL DEFAULT '{}'::jsonb, reviewed_by TEXT, review_note TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), reviewed_at TIMESTAMPTZ)");
                await Database.query("ALTER TABLE story_rewrite_think_requests ADD COLUMN IF NOT EXISTS safetybot_json JSONB NOT NULL DEFAULT '{}'::jsonb");
                await Database.query("CREATE INDEX IF NOT EXISTS story_rewrite_think_requests_status_idx ON story_rewrite_think_requests (status, created_at DESC)");
                await Database.query("CREATE TABLE IF NOT EXISTS story_rewrite_think_ideas (id BIGSERIAL PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, submitted_by_key TEXT NOT NULL, submitted_by TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','reviewing','accepted','declined')), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
                await Database.query("CREATE TABLE IF NOT EXISTS story_rewrite_think_audit (id BIGSERIAL PRIMARY KEY, actor_username_key TEXT NOT NULL, actor_username TEXT NOT NULL, actor_role TEXT NOT NULL, action TEXT NOT NULL, target_username TEXT, details_json JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
                await Database.query("CREATE INDEX IF NOT EXISTS story_rewrite_think_audit_actor_idx ON story_rewrite_think_audit (actor_username_key, action, created_at DESC)");
                await Database.query("CREATE TABLE IF NOT EXISTS story_rewrite_think_alerts (id BIGSERIAL PRIMARY KEY, recipient_username_key TEXT NOT NULL, recipient_username TEXT NOT NULL, severity TEXT NOT NULL DEFAULT 'warning', message TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'storybot', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), acknowledged_at TIMESTAMPTZ)");
                await Database.query("CREATE INDEX IF NOT EXISTS story_rewrite_think_alerts_recipient_idx ON story_rewrite_think_alerts (recipient_username_key, created_at DESC)");
                await Database.query("CREATE TABLE IF NOT EXISTS story_rewrite_think_access_requests (id BIGSERIAL PRIMARY KEY, requester_username_key TEXT NOT NULL, requester_username TEXT NOT NULL, requested_role TEXT NOT NULL CHECK (requested_role IN ('moderator','top_moderator')), reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')), reviewed_by TEXT, review_note TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), reviewed_at TIMESTAMPTZ)");
                await Database.query("CREATE TABLE IF NOT EXISTS story_rewrite_think_restrictions (username_key TEXT PRIMARY KEY, username TEXT NOT NULL, reason TEXT NOT NULL, restricted_by TEXT NOT NULL, expires_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
            })().catch(Error => {
                SchemaPromise = null;
                throw Error;
            });
        }
        return SchemaPromise;
    }

    async function getStaff(Username) {
        const Key = UsernameKey(Username);
        if (Key === OwnerKey) return { username: "Darius56", role: "owner", active: true, isOwner: true };
        const Result = await Database.query(
            "SELECT username, role, active FROM story_rewrite_think_staff WHERE username_key = $1 AND active = TRUE LIMIT 1",
            [Key]
        );
        return Result.rowCount ? Object.assign({}, Result.rows[0], { isOwner: false }) : null;
    }

    function canRead(Role) { return ["owner", "top_moderator", "moderator", "developer"].includes(String(Role || "")); }
    function canCreateCase(Role) { return ["owner", "top_moderator", "moderator"].includes(String(Role || "")); }
    function canReview(Role) { return ["owner", "top_moderator"].includes(String(Role || "")); }
    function redactModerationText(Value, Limit = 240) {
        return String(Value || "")
            .replace(/\b(?:password|passcode|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|session[_ -]?(?:id|token|cookie))\b\s*[:=]\s*\S+/gi, "[redacted secret]")
            .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
            .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, "[redacted API key]")
            .replace(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gi, "[redacted private key]")
            .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted email]")
            .slice(0, Limit);
    }

    async function readModerationHistory(Staff, TargetUsername) {
        if (!canCreateCase(Staff?.role)) {
            const Error = new Error("Moderation history is available only to moderators and higher.");
            Error.status = 403;
            throw Error;
        }
        const Target = String(TargetUsername || "").trim().slice(0, 32);
        if (!/^[A-Za-z0-9_]{3,20}$/.test(Target)) throw new Error("Enter a valid player username.");
        const TargetKey = UsernameKey(Target);
        const [Cases, Requests, Restrictions, Audit] = await Promise.all([
            Database.query(
                "SELECT id, category, reason, status, filed_by, created_at, updated_at, reviewed_by, review_note FROM story_rewrite_think_cases WHERE target_username_key = $1 ORDER BY created_at DESC LIMIT 20",
                [TargetKey]
            ),
            Database.query(
                "SELECT id, case_id, action_type, reason, requested_by, status, reviewed_by, review_note, created_at, reviewed_at FROM story_rewrite_think_requests WHERE target_username_key = $1 ORDER BY created_at DESC LIMIT 20",
                [TargetKey]
            ),
            Database.query(
                "SELECT reason, restricted_by, expires_at, created_at FROM story_rewrite_think_restrictions WHERE username_key = $1 LIMIT 5",
                [TargetKey]
            ),
            Database.query(
                "SELECT action, actor_username, actor_role, created_at FROM story_rewrite_think_audit WHERE LOWER(target_username) = LOWER($1) AND action IN ('think_case_created','think_case_status_changed','think_action_requested','think_action_approved','think_action_rejected','think_action_blocked_by_storybot','think_action_blocked_by_safetybot') ORDER BY created_at DESC LIMIT 30",
                [Target]
            )
        ]);
        const RoomChatBans = [];
        if (Rooms) {
            for (const Room of Rooms.values()) {
                const BannedNames = Room.chatBannedNames instanceof Set ? [...Room.chatBannedNames] : [];
                if (BannedNames.some(Name => UsernameKey(Name) === TargetKey)) {
                    RoomChatBans.push({
                        roomCode: String(Room.code || "").slice(0, 12),
                        status: "room chat disabled",
                        current: true
                    });
                    if (RoomChatBans.length >= 10) break;
                }
            }
        }
        const History = {
            username: Target,
            cases: Cases.rows.map(Row => ({
                id: String(Row.id),
                category: redactModerationText(Row.category, 60),
                reason: redactModerationText(Row.reason, 240),
                status: String(Row.status || "reported"),
                filedBy: redactModerationText(Row.filed_by, 32),
                createdAt: Row.created_at,
                updatedAt: Row.updated_at,
                reviewedBy: redactModerationText(Row.reviewed_by, 32),
                reviewNote: redactModerationText(Row.review_note, 240)
            })),
            actionRequests: Requests.rows.map(Row => ({
                id: String(Row.id),
                caseId: String(Row.case_id),
                action: String(Row.action_type || ""),
                reason: redactModerationText(Row.reason, 240),
                requestedBy: redactModerationText(Row.requested_by, 32),
                status: String(Row.status || "pending"),
                reviewedBy: redactModerationText(Row.reviewed_by, 32),
                reviewNote: redactModerationText(Row.review_note, 240),
                createdAt: Row.created_at,
                reviewedAt: Row.reviewed_at
            })),
            restrictions: Restrictions.rows.map(Row => ({
                reason: redactModerationText(Row.reason, 240),
                restrictedBy: redactModerationText(Row.restricted_by, 32),
                active: !Row.expires_at || new Date(Row.expires_at).getTime() > Date.now(),
                expiresAt: Row.expires_at,
                createdAt: Row.created_at
            })),
            moderationActions: Audit.rows.map(Row => ({
                action: String(Row.action || ""),
                actor: redactModerationText(Row.actor_username, 32),
                actorRole: String(Row.actor_role || ""),
                createdAt: Row.created_at
            })),
            currentRoomChatBans: RoomChatBans
        };
        await writeAudit(Staff, "safetybot_moderation_history_viewed", Target, {
            cases: History.cases.length,
            actionRequests: History.actionRequests.length,
            restrictions: History.restrictions.length,
            moderationActions: History.moderationActions.length
        });
        return History;
    }

    function normalizeSafetyBotAttachments(Value) {
        if (Value === undefined || Value === null) return [];
        if (!Array.isArray(Value) || Value.length > 2) throw new Error("Attach no more than two images.");
        return Value.map((Item, Index) => {
            const Name = String(Item?.name || ("image-" + (Index + 1))).replace(/[\/\u0000-\u001f]/g, "_").slice(0, 100);
            const MimeType = String(Item?.mimeType || Item?.type || "").toLowerCase();
            const Base64 = String(Item?.base64 || "");
            if (!["image/jpeg", "image/png", "image/webp"].includes(MimeType)) {
                throw new Error("SafetyBot accepts JPEG, PNG, and WebP images only.");
            }
            if (!/^[A-Za-z0-9+/]*={0,2}$/.test(Base64) || !Base64.length) {
                throw new Error("One of the image attachments is invalid.");
            }
            const Bytes = Buffer.from(Base64, "base64");
            if (!Bytes.length || Bytes.length > 900 * 1024) throw new Error("Each image must be 900 KB or smaller after compression.");
            return { name: Name, mimeType: MimeType, base64: Bytes.toString("base64") };
        });
    }


    async function isRestricted(Username) {
        if (!Username || !Database) return false;
        try {
            const Result = await Database.query(
                "SELECT 1 FROM story_rewrite_think_restrictions WHERE username_key = $1 AND (expires_at IS NULL OR expires_at > NOW()) LIMIT 1",
                [UsernameKey(Username)]
            );
            return Result.rowCount > 0;
        } catch (Error) {
            // Oversight storage must never break normal account sign-in.
            console.error("Story Rewrite suspension lookup failed open", Error);
            return false;
        }
    }

    async function writeAudit(Staff, Action, TargetUsername, Details) {
        await Database.query(
            "INSERT INTO story_rewrite_think_audit (actor_username_key, actor_username, actor_role, action, target_username, details_json) VALUES ($1,$2,$3,$4,$5,$6::jsonb)",
            [UsernameKey(Staff.username), Staff.username, Staff.role, String(Action).slice(0, 80), TargetUsername ? String(TargetUsername).slice(0, 32) : null, JSON.stringify(Details || {})]
        );
    }

    async function addAlert(Username, Message, Severity, Source = "storybot") {
        const Name = String(Username || "").trim().slice(0, 32);
        if (!Name) return;
        const SafeSource = Source === "safetybot" ? "safetybot" : "storybot";
        await Database.query(
            "INSERT INTO story_rewrite_think_alerts (recipient_username_key, recipient_username, severity, message, source) VALUES ($1,$2,$3,$4,$5)",
            [UsernameKey(Name), Name, Severity || "warning", String(Message || "").slice(0, 500), SafeSource]
        );
    }

    async function preActionReview(Reviewer, RequestRow, CaseRow) {
        const Warnings = [];
        const Blockers = [];
        if (!Reviewer || Reviewer.role === "owner") {
            return { allowed: true, exempt: true, warnings: [], blockers: [], summary: "Owner actions are exempt from StoryBot moderator oversight." };
        }
        if (!CaseRow || Number(CaseRow.id) !== Number(RequestRow.case_id)) Blockers.push("The action request is not linked to a valid investigation case.");
        if (CaseRow && UsernameKey(CaseRow.target_username) !== UsernameKey(RequestRow.target_username)) Blockers.push("The investigation case target does not match the requested account.");
        if (CaseRow && !["under_review", "confirmed"].includes(String(CaseRow.status))) Blockers.push("The investigation case must be marked Under review or Confirmed before a high-level action.");
        if (String(RequestRow.reason || "").trim().length < 20) Blockers.push("The action reason is too short; provide a specific explanation.");
        if (String(RequestRow.evidence || "").trim().length < 30) Blockers.push("The evidence summary is too short; include the relevant event and its context.");
        if (UsernameKey(RequestRow.target_username) === OwnerKey) Blockers.push("The owner account is protected from moderator enforcement.");
        if (UsernameKey(RequestRow.target_username) === UsernameKey(RequestRow.requested_by)) Blockers.push("A moderator cannot request enforcement against their own account.");

        const Recent = await Database.query(
            "SELECT COUNT(*)::int AS count FROM story_rewrite_think_audit WHERE actor_username_key = $1 AND action = 'think_action_approved' AND created_at > NOW() - INTERVAL '5 minutes'",
            [UsernameKey(Reviewer.username)]
        );
        if (Number(Recent.rows[0] && Recent.rows[0].count || 0) >= 3) {
            Blockers.push("Review pace is unusually high. Pause and ask the owner to review the recent moderation activity.");
            Warnings.push("Pay more attention to what you're doing. Review the relevant messages and evidence before taking moderation action. Your actions are being reviewed.");
        }
        return {
            allowed: Blockers.length === 0,
            exempt: false,
            warnings: Warnings,
            blockers: Blockers,
            summary: Blockers.length ? "StoryBot requires additional review before this action can proceed." : "StoryBot's evidence and policy checks passed. Human approval is still required."
        };
    }

    async function preActionSafetyReview(Reviewer, RequestRow, CaseRow) {
        const Blockers = [];
        const Warnings = [];
        if (!Reviewer || Reviewer.role === "owner") {
            return {
                allowed: true,
                exempt: true,
                warnings: [],
                blockers: [],
                summary: "Owner review is logged separately from moderator-only SafetyBot checks."
            };
        }

        const EvidenceText = [
            RequestRow?.reason,
            RequestRow?.evidence,
            CaseRow?.reason,
            CaseRow?.evidence
        ].map(Value => String(Value || "")).join("\n");

        const ContainsCredential = [
            /\b(?:password|passcode|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|session[_ -]?(?:id|token|cookie))\b\s*[:=]\s*\S+/i,
            /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/i,
            /\bsk-[A-Za-z0-9_-]{16,}\b/,
            /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i
        ].some(Pattern => Pattern.test(EvidenceText));

        if (ContainsCredential) {
            Blockers.push("Remove passwords, API keys, bearer tokens, session cookies, and private keys from the case evidence before continuing.");
        }
        if (RequestRow?.action_type === "suspend_account" && String(CaseRow?.status || "") !== "confirmed") {
            Blockers.push("SafetyBot requires a confirmed investigation finding before an account suspension can be approved.");
        }
        if (RequestRow?.action_type === "terminate_sessions" && CaseRow && CaseRow.status === "under_review") {
            Warnings.push("Session termination signs the account out of active sessions. Confirm that this limited action is proportionate to the evidence.");
        }

        return {
            allowed: Blockers.length === 0,
            exempt: false,
            warnings: Warnings,
            blockers: Blockers,
            summary: Blockers.length
                ? "SafetyBot blocked this request until its privacy or action-severity checks are addressed."
                : "SafetyBot's privacy and action-severity checks passed. Human approval is still required."
        };
    }

    async function disconnectTargetSessions(Username) {
        const Key = UsernameKey(Username);
        await Database.query("DELETE FROM story_rewrite_sessions WHERE username_key = $1", [Key]);
        for (const ConnectedSocket of Io.sockets.sockets.values()) {
            if (UsernameKey(ConnectedSocket.data && ConnectedSocket.data.username || "") === Key) ConnectedSocket.disconnect(true);
        }
    }

    async function handle(Request, Response, RequestPath, Origin, Account) {
        if (RequestPath === "/api/safetybot/chat" && Request.method === "POST") {
            await ensureSchema();
            const SafetyBotStaff = await getStaff(Account.username);
            if (!SafetyBotStaff || !canRead(SafetyBotStaff.role)) {
                SendJson(Response, 403, { error: "SafetyBot is available only inside the authorized Silicon Valley developer workspace." }, Origin);
                return true;
            }
            const Body = await ReadJson(Request).catch(() => ({}));
            const Question = String(Body && Body.question || "").trim().slice(0, 1200);
            const Messages = Array.isArray(Body && Body.messages)
                ? Body.messages
                : (Array.isArray(Body && Body.context) ? Body.context.map(Text => ({ role: "user", text: Text })) : []);
            let ModerationHistory = null;
            let Attachments = [];
            try {
                if (Body && Body.lookupUsername) {
                    ModerationHistory = await readModerationHistory(SafetyBotStaff, Body.lookupUsername);
                }
                Attachments = normalizeSafetyBotAttachments(Body && Body.attachments);
            } catch (Error) {
                SendJson(Response, Error.status || 400, { error: Error.message || "The SafetyBot request could not be prepared." }, Origin);
                return true;
            }
            if (!Question) {
                SendJson(Response, 400, { error: "Write a message for SafetyBot." }, Origin);
                return true;
            }
            const Now = Date.now();
            const Key = UsernameKey(Account.username);
            const Window = SafetyBotRequestWindows.get(Key);
            if (!Window || Now - Window.startedAt >= 60000) {
                SafetyBotRequestWindows.set(Key, { startedAt: Now, count: 1 });
            } else if (Window.count >= 20) {
                SendJson(Response, 429, { error: "SafetyBot is taking a short break. Try again in a minute." }, Origin);
                return true;
            } else {
                Window.count += 1;
            }
            try {
                const SafetyBotGemini = require("./storybot-gemini-guest.js");
                const Answer = await SafetyBotGemini.askSafetyBotGemini({
                    username: Account.username,
                    question: Question,
                    messages: Messages,
                    moderationHistory: ModerationHistory,
                    attachments: Attachments
                });
                if (!Answer) throw new Error("The model returned an empty reply.");
                SendJson(Response, 200, { ok: true, outcome: "conversation", answer: Answer.slice(0, 4000), findings: [] }, Origin);
            } catch (Error) {
                console.error("SafetyBot conversation request failed:", String(Error?.message || Error).slice(0, 220));
                const UploadError = Attachments.length > 0 ? String(Error?.message || "") : "";
                const PublicError = /image|upload|guest session/i.test(UploadError)
                    ? UploadError.slice(0, 240)
                    : "SafetyBot is temporarily unavailable. Please try again.";
                SendJson(Response, 503, { error: PublicError }, Origin);
            }
            return true;
        }

        if (!RequestPath.startsWith("/api/think")) return false;
        await ensureSchema();
        const Staff = await getStaff(Account.username);
        if (!Staff || !canRead(Staff.role)) {
            SendJson(Response, 403, { error: "Silicon Valley access is restricted to authorized Story Rewrite developers." }, Origin);
            return true;
        }

        if (RequestPath === "/api/think/heartbeat" && Request.method === "POST") {
            let PreservedRooms = 0;
            if (Rooms) {
                const CurrentKey = UsernameKey(Account.username);
                for (const Room of Rooms.values()) {
                    const MemberNames = Room.memberNames instanceof Set ? [...Room.memberNames] : [];
                    const IsMember = MemberNames.some(Name => UsernameKey(Name) === CurrentKey)
                        || UsernameKey(Room.hostUsername || "") === CurrentKey
                        || [...(Room.players?.values?.() || [])].some(Player => UsernameKey(Player?.username || "") === CurrentKey);
                    if (!IsMember) continue;
                    PreservedRooms += 1;
                    if (Number(Room.players?.size || 0) === 0) {
                        if (Room.cleanupTimer) clearTimeout(Room.cleanupTimer);
                        Room.cleanupTimer = setTimeout(() => {
                            if (Number(Room.players?.size || 0) === 0) Rooms.delete(Room.code);
                        }, 120000);
                        Room.cleanupTimer.unref?.();
                    }
                }
            }
            SendJson(Response, 200, { ok: true, preservedRooms: PreservedRooms }, Origin);
            return true;
        }

        if (RequestPath === "/api/think/overview" && Request.method === "GET") {
            const Results = await Promise.all([
                Database.query("SELECT username, role, active, created_at FROM story_rewrite_think_staff WHERE active = TRUE ORDER BY CASE role WHEN 'top_moderator' THEN 1 WHEN 'moderator' THEN 2 ELSE 3 END, username"),
                Database.query("SELECT id, target_username, category, reason, evidence, status, filed_by, created_at, updated_at, reviewed_by, review_note FROM story_rewrite_think_cases ORDER BY created_at DESC LIMIT 100"),
                Database.query("SELECT id, case_id, action_type, target_username, reason, evidence, requested_by, status, storybot_json, safetybot_json, reviewed_by, review_note, created_at, reviewed_at FROM story_rewrite_think_requests ORDER BY created_at DESC LIMIT 100"),
                Database.query("SELECT id, title, body, submitted_by, status, created_at FROM story_rewrite_think_ideas ORDER BY created_at DESC LIMIT 50"),
                Database.query("SELECT id, actor_username, actor_role, action, target_username, details_json, created_at FROM story_rewrite_think_audit ORDER BY created_at DESC LIMIT 100"),
                Database.query("SELECT id, severity, message, source, created_at, acknowledged_at FROM story_rewrite_think_alerts WHERE recipient_username_key = $1 ORDER BY created_at DESC LIMIT 50", [UsernameKey(Account.username)]),
                Staff.role === "owner"
                    ? Database.query("SELECT id, requester_username, requested_role, reason, status, created_at FROM story_rewrite_think_access_requests ORDER BY created_at DESC LIMIT 50")
                    : Database.query("SELECT id, requester_username, requested_role, reason, status, created_at FROM story_rewrite_think_access_requests WHERE requester_username_key = $1 ORDER BY created_at DESC LIMIT 20", [UsernameKey(Account.username)])
            ]);
            const Roster = [{ username: "Darius56", role: "owner", active: true }];
            for (const Row of Results[0].rows) if (UsernameKey(Row.username) !== OwnerKey) Roster.push(Row);
            SendJson(Response, 200, {
                ok: true,
                staff: { username: Staff.username || Account.username, role: Staff.role, isOwner: Staff.role === "owner" },
                permissions: { canCreateCase: canCreateCase(Staff.role), canReview: canReview(Staff.role), canManageStaff: Staff.role === "owner", canSubmitIdea: true },
                roster: Roster,
                cases: Results[1].rows,
                requests: Results[2].rows,
                ideas: Results[3].rows,
                audit: Results[4].rows,
                alerts: Results[5].rows,
                accessRequests: Results[6].rows
            }, Origin);
            return true;
        }

        if (RequestPath === "/api/think/cases" && Request.method === "POST") {
            if (!canCreateCase(Staff.role)) {
                SendJson(Response, 403, { error: "Your developer tier is read-only. You can submit an idea or request higher-level review." }, Origin);
                return true;
            }
            const Body = await ReadJson(Request).catch(() => ({}));
            const Target = String(Body && Body.targetUsername || "").trim().slice(0, 32);
            const Category = String(Body && Body.category || "other").trim().slice(0, 40);
            const Reason = String(Body && Body.reason || "").trim().slice(0, 1200);
            const Evidence = String(Body && Body.evidence || "").trim().slice(0, 4000);
            if (!/^[A-Za-z0-9_]{3,20}$/.test(Target)) {
                SendJson(Response, 400, { error: "Enter a valid account username." }, Origin);
                return true;
            }
            if (Reason.length < 12 || Evidence.length < 30) {
                SendJson(Response, 400, { error: "Add a clear reason and at least 30 characters of evidence context." }, Origin);
                return true;
            }
            if (UsernameKey(Target) === OwnerKey) {
                SendJson(Response, 403, { error: "The owner account cannot be added to moderator investigations." }, Origin);
                return true;
            }
            const TargetResult = await Database.query("SELECT username FROM accounts WHERE username_key = $1 LIMIT 1", [UsernameKey(Target)]);
            if (!TargetResult.rowCount) {
                SendJson(Response, 404, { error: "That account could not be found." }, Origin);
                return true;
            }
            const RealTarget = TargetResult.rows[0].username;
            const Inserted = await Database.query(
                "INSERT INTO story_rewrite_think_cases (target_username_key,target_username,category,reason,evidence,filed_by_key,filed_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
                [UsernameKey(RealTarget), RealTarget, Category, Reason, Evidence, UsernameKey(Account.username), Account.username]
            );
            const Pace = await Database.query(
                "SELECT COUNT(*)::int AS count FROM story_rewrite_think_cases WHERE filed_by_key = $1 AND created_at > NOW() - INTERVAL '2 minutes'",
                [UsernameKey(Account.username)]
            );
            await writeAudit(Staff, "think_case_created", RealTarget, { caseId: Inserted.rows[0].id, category: Category });
            if (Staff.role !== "owner" && Number(Pace.rows[0] && Pace.rows[0].count || 0) >= 4) {
                await addAlert(Account.username, "Pay more attention to what you're doing. Review the relevant messages and evidence before adding more investigation cases. Your activity is being reviewed.");
            }
            SendJson(Response, 201, { ok: true, caseId: Inserted.rows[0].id }, Origin);
            return true;
        }

        const CaseStatusMatch = RequestPath.match(/^\/api\/think\/cases\/(\d+)\/status$/);
        if (CaseStatusMatch && Request.method === "POST") {
            if (!canReview(Staff.role)) {
                SendJson(Response, 403, { error: "Only a top-tier moderator or owner can change an investigation status." }, Origin);
                return true;
            }
            const Body = await ReadJson(Request).catch(() => ({}));
            const Status = String(Body && Body.status || "");
            const Note = String(Body && Body.note || "").trim().slice(0, 1000);
            if (!["under_review", "confirmed", "cleared"].includes(Status)) {
                SendJson(Response, 400, { error: "Invalid investigation status." }, Origin);
                return true;
            }
            if (Status === "confirmed" && Note.length < 25) {
                SendJson(Response, 400, { error: "Add a review note explaining why the evidence supports a confirmed finding." }, Origin);
                return true;
            }
            const Updated = await Database.query(
                "UPDATE story_rewrite_think_cases SET status = $1, updated_at = NOW(), reviewed_by = $2, review_note = $3 WHERE id = $4 RETURNING id,target_username,status",
                [Status, Account.username, Note, Number(CaseStatusMatch[1])]
            );
            if (!Updated.rowCount) {
                SendJson(Response, 404, { error: "Investigation case not found." }, Origin);
                return true;
            }
            await writeAudit(Staff, "think_case_status_changed", Updated.rows[0].target_username, { caseId: Updated.rows[0].id, status: Status, note: Note });
            SendJson(Response, 200, { ok: true, case: Updated.rows[0] }, Origin);
            return true;
        }

        if (RequestPath === "/api/think/requests" && Request.method === "POST") {
            const Body = await ReadJson(Request).catch(() => ({}));
            const CaseId = Number(Body && Body.caseId);
            const ActionType = String(Body && Body.actionType || "");
            const Reason = String(Body && Body.reason || "").trim().slice(0, 1200);
            const Evidence = String(Body && Body.evidence || "").trim().slice(0, 4000);
            if (!Number.isSafeInteger(CaseId) || CaseId <= 0 || !["suspend_account", "terminate_sessions"].includes(ActionType)) {
                SendJson(Response, 400, { error: "Choose a valid case and supported higher-level action." }, Origin);
                return true;
            }
            if (Reason.length < 20 || Evidence.length < 30) {
                SendJson(Response, 400, { error: "Provide a specific reason and at least 30 characters of evidence." }, Origin);
                return true;
            }
            const CaseResult = await Database.query("SELECT * FROM story_rewrite_think_cases WHERE id = $1 LIMIT 1", [CaseId]);
            if (!CaseResult.rowCount) {
                SendJson(Response, 404, { error: "Investigation case not found." }, Origin);
                return true;
            }
            const CaseRow = CaseResult.rows[0];
            const Target = CaseRow.target_username;
            if (UsernameKey(Target) === OwnerKey || UsernameKey(Target) === UsernameKey(Account.username)) {
                SendJson(Response, 403, { error: "This account cannot be the target of your request." }, Origin);
                return true;
            }
            const Preliminary = await preActionReview(Staff, {
                case_id: CaseId, target_username: Target, requested_by: Account.username, reason: Reason, evidence: Evidence
            }, CaseRow);
            const SafetyPreliminary = await preActionSafetyReview(Staff, {
                case_id: CaseId, action_type: ActionType, target_username: Target,
                requested_by: Account.username, reason: Reason, evidence: Evidence
            }, CaseRow);
            const CheckedAt = new Date().toISOString();
            const StoredReview = Object.assign({}, Preliminary, { checkedAt: CheckedAt, stage: "submission" });
            const StoredSafetyReview = Object.assign({}, SafetyPreliminary, { checkedAt: CheckedAt, stage: "submission" });
            const Inserted = await Database.query(
                "INSERT INTO story_rewrite_think_requests (case_id,action_type,target_username_key,target_username,reason,evidence,requested_by_key,requested_by,storybot_json,safetybot_json) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb) RETURNING id",
                [CaseId, ActionType, UsernameKey(Target), Target, Reason, Evidence, UsernameKey(Account.username), Account.username, JSON.stringify(StoredReview), JSON.stringify(StoredSafetyReview)]
            );
            await writeAudit(Staff, "think_action_requested", Target, {
                requestId: Inserted.rows[0].id, caseId: CaseId, actionType: ActionType,
                storybotAllowed: Preliminary.allowed, safetybotAllowed: SafetyPreliminary.allowed
            });
            SendJson(Response, 201, {
                ok: true, requestId: Inserted.rows[0].id, storybot: StoredReview, safetybot: StoredSafetyReview
            }, Origin);
            return true;
        }

        const RequestReviewMatch = RequestPath.match(/^\/api\/think\/requests\/(\d+)\/review$/);
        if (RequestReviewMatch && Request.method === "POST") {
            if (!canReview(Staff.role)) {
                SendJson(Response, 403, { error: "Only a top-tier moderator or owner can review higher-action requests." }, Origin);
                return true;
            }
            const Body = await ReadJson(Request).catch(() => ({}));
            const Decision = String(Body && Body.decision || "");
            const ReviewNote = String(Body && Body.note || "").trim().slice(0, 1000);
            if (!["approve", "reject"].includes(Decision)) {
                SendJson(Response, 400, { error: "Choose approve or reject." }, Origin);
                return true;
            }
            if (Decision === "approve" && ReviewNote.length < 25) {
                SendJson(Response, 400, { error: "Add a review note of at least 25 characters explaining why this action is justified." }, Origin);
                return true;
            }
            const PendingResult = await Database.query("SELECT * FROM story_rewrite_think_requests WHERE id = $1 AND status = 'pending' LIMIT 1", [Number(RequestReviewMatch[1])]);
            if (!PendingResult.rowCount) {
                SendJson(Response, 404, { error: "Pending action request not found." }, Origin);
                return true;
            }
            const Pending = PendingResult.rows[0];
            if (Staff.role !== "owner" && Pending.requested_by_key === UsernameKey(Account.username)) {
                SendJson(Response, 403, { error: "A top-tier moderator cannot approve their own higher-action request. Another reviewer must check it." }, Origin);
                return true;
            }
            const CaseResult = await Database.query("SELECT * FROM story_rewrite_think_cases WHERE id = $1 LIMIT 1", [Pending.case_id]);
            const CaseRow = CaseResult.rows[0] || null;

            if (Decision === "reject") {
                await Database.query("UPDATE story_rewrite_think_requests SET status = 'rejected', reviewed_by = $1, review_note = $2, reviewed_at = NOW() WHERE id = $3", [Account.username, ReviewNote || "Rejected by reviewer.", Pending.id]);
                await writeAudit(Staff, "think_action_rejected", Pending.target_username, { requestId: Pending.id, note: ReviewNote });
                SendJson(Response, 200, { ok: true, status: "rejected" }, Origin);
                return true;
            }

            const BotReview = await preActionReview(Staff, Pending, CaseRow);
            const SafetyReview = await preActionSafetyReview(Staff, Pending, CaseRow);
            const CheckedAt = new Date().toISOString();
            const StoredBotReview = Object.assign({}, BotReview, { checkedAt: CheckedAt, stage: "approval" });
            const StoredSafetyReview = Object.assign({}, SafetyReview, { checkedAt: CheckedAt, stage: "approval" });
            await Database.query(
                "UPDATE story_rewrite_think_requests SET storybot_json = $1::jsonb, safetybot_json = $2::jsonb WHERE id = $3",
                [JSON.stringify(StoredBotReview), JSON.stringify(StoredSafetyReview), Pending.id]
            );
            if (!BotReview.allowed || !SafetyReview.allowed) {
                if (BotReview.warnings?.length) await addAlert(Account.username, BotReview.warnings.join(" "), "warning", "storybot");
                if (SafetyReview.warnings?.length) await addAlert(Account.username, SafetyReview.warnings.join(" "), "warning", "safetybot");
                if (!BotReview.allowed) {
                    await writeAudit(Staff, "think_action_blocked_by_storybot", Pending.target_username, { requestId: Pending.id, blockers: BotReview.blockers });
                }
                if (!SafetyReview.allowed) {
                    await writeAudit(Staff, "think_action_blocked_by_safetybot", Pending.target_username, { requestId: Pending.id, blockers: SafetyReview.blockers });
                }
                SendJson(Response, 409, {
                    error: !BotReview.allowed ? BotReview.summary : SafetyReview.summary,
                    storybot: StoredBotReview,
                    safetybot: StoredSafetyReview
                }, Origin);
                return true;
            }

            if (Pending.action_type === "terminate_sessions") {
                await disconnectTargetSessions(Pending.target_username);
            } else if (Pending.action_type === "suspend_account") {
                const DurationMinutes = Math.max(15, Math.min(43200, Number(Body && Body.durationMinutes || 1440)));
                await Database.query(
                    "INSERT INTO story_rewrite_think_restrictions (username_key,username,reason,restricted_by,expires_at) VALUES ($1,$2,$3,$4,NOW() + ($5::int * INTERVAL '1 minute')) ON CONFLICT (username_key) DO UPDATE SET username = EXCLUDED.username, reason = EXCLUDED.reason, restricted_by = EXCLUDED.restricted_by, expires_at = EXCLUDED.expires_at, created_at = NOW()",
                    [Pending.target_username_key, Pending.target_username, Pending.reason, Account.username, DurationMinutes]
                );
                await disconnectTargetSessions(Pending.target_username);
            }

            await Database.query("UPDATE story_rewrite_think_requests SET status = 'approved', reviewed_by = $1, review_note = $2, reviewed_at = NOW() WHERE id = $3", [Account.username, ReviewNote || "Approved after StoryBot review.", Pending.id]);
            await writeAudit(Staff, "think_action_approved", Pending.target_username, { requestId: Pending.id, actionType: Pending.action_type, caseId: Pending.case_id });
            if (Staff.role !== "owner") {
                const Recent = await Database.query(
                    "SELECT COUNT(*)::int AS count FROM story_rewrite_think_audit WHERE actor_username_key = $1 AND action = 'think_action_approved' AND created_at > NOW() - INTERVAL '5 minutes'",
                    [UsernameKey(Account.username)]
                );
                if (Number(Recent.rows[0] && Recent.rows[0].count || 0) >= 3) {
                    await addAlert(Account.username, "Pay more attention to what you're doing. Review the relevant messages and evidence before taking moderation action. Your actions are being reviewed.");
                }
            }
            SendJson(Response, 200, { ok: true, status: "approved", action: Pending.action_type }, Origin);
            return true;
        }

        if (RequestPath === "/api/think/staff" && Request.method === "POST") {
            if (Staff.role !== "owner") {
                SendJson(Response, 403, { error: "Only Darius56 can appoint or remove Story Rewrite developers." }, Origin);
                return true;
            }
            const Body = await ReadJson(Request).catch(() => ({}));
            const Target = String(Body && Body.username || "").trim().slice(0, 32);
            const Role = String(Body && Body.role || "");
            if (!/^[A-Za-z0-9_]{3,20}$/.test(Target) || !["developer", "moderator", "top_moderator", "remove"].includes(Role)) {
                SendJson(Response, 400, { error: "Enter an account username and a valid developer tier." }, Origin);
                return true;
            }
            if (UsernameKey(Target) === OwnerKey) {
                SendJson(Response, 403, { error: "The owner role cannot be reassigned." }, Origin);
                return true;
            }
            const TargetResult = await Database.query("SELECT username FROM accounts WHERE username_key = $1 LIMIT 1", [UsernameKey(Target)]);
            if (!TargetResult.rowCount) {
                SendJson(Response, 404, { error: "That account could not be found." }, Origin);
                return true;
            }
            const RealTarget = TargetResult.rows[0].username;
            if (Role === "remove") {
                await Database.query("UPDATE story_rewrite_think_staff SET active = FALSE, updated_at = NOW() WHERE username_key = $1", [UsernameKey(RealTarget)]);
            } else {
                await Database.query(
                    "INSERT INTO story_rewrite_think_staff (username_key,username,role,active,appointed_by) VALUES ($1,$2,$3,TRUE,$4) ON CONFLICT (username_key) DO UPDATE SET username = EXCLUDED.username, role = EXCLUDED.role, active = TRUE, appointed_by = EXCLUDED.appointed_by, updated_at = NOW()",
                    [UsernameKey(RealTarget), RealTarget, Role, Account.username]
                );
            }
            await writeAudit(Staff, Role === "remove" ? "think_staff_removed" : "think_staff_appointed", RealTarget, { role: Role });
            SendJson(Response, 200, { ok: true }, Origin);
            return true;
        }

        if (RequestPath === "/api/think/access-requests" && Request.method === "POST") {
            if (!["developer", "moderator"].includes(Staff.role)) {
                SendJson(Response, 403, { error: "Your current tier cannot request further access." }, Origin);
                return true;
            }
            const Body = await ReadJson(Request).catch(() => ({}));
            const ExpectedRole = Staff.role === "developer" ? "moderator" : "top_moderator";
            const RequestedRole = String(Body && Body.role || ExpectedRole);
            const Reason = String(Body && Body.reason || "").trim().slice(0, 1000);
            if (RequestedRole !== ExpectedRole || Reason.length < 15) {
                SendJson(Response, 400, { error: "Request only the next developer tier and explain why you need it." }, Origin);
                return true;
            }
            const Existing = await Database.query("SELECT id FROM story_rewrite_think_access_requests WHERE requester_username_key = $1 AND status = 'pending' LIMIT 1", [UsernameKey(Account.username)]);
            if (Existing.rowCount) {
                SendJson(Response, 409, { error: "You already have a pending access request." }, Origin);
                return true;
            }
            const Inserted = await Database.query("INSERT INTO story_rewrite_think_access_requests (requester_username_key,requester_username,requested_role,reason) VALUES ($1,$2,$3,$4) RETURNING id", [UsernameKey(Account.username), Account.username, RequestedRole, Reason]);
            await writeAudit(Staff, "think_access_requested", null, { requestId: Inserted.rows[0].id, requestedRole: RequestedRole });
            SendJson(Response, 201, { ok: true, requestId: Inserted.rows[0].id }, Origin);
            return true;
        }

        if (RequestPath.startsWith("/api/think/access-requests/") && RequestPath.endsWith("/review") && Request.method === "POST") {
            if (Staff.role !== "owner") {
                SendJson(Response, 403, { error: "Only Darius56 can approve developer access requests." }, Origin);
                return true;
            }
            const AccessRequestId = Number(RequestPath.split("/")[4]);
            const Body = await ReadJson(Request).catch(() => ({}));
            const Decision = String(Body && Body.decision || "");
            const Note = String(Body && Body.note || "").trim().slice(0, 1000);
            if (!Number.isSafeInteger(AccessRequestId) || AccessRequestId <= 0 || !["approve", "reject"].includes(Decision)) {
                SendJson(Response, 400, { error: "Choose a valid access request and approve or reject it." }, Origin);
                return true;
            }
            const Pending = await Database.query("SELECT * FROM story_rewrite_think_access_requests WHERE id = $1 AND status = 'pending' LIMIT 1", [AccessRequestId]);
            if (!Pending.rowCount) {
                SendJson(Response, 404, { error: "Pending access request not found." }, Origin);
                return true;
            }
            const RequestRow = Pending.rows[0];
            if (Decision === "approve") {
                const AccountRow = await Database.query("SELECT username FROM accounts WHERE username_key = $1 LIMIT 1", [RequestRow.requester_username_key]);
                if (!AccountRow.rowCount) {
                    SendJson(Response, 404, { error: "The requesting account no longer exists." }, Origin);
                    return true;
                }
                await Database.query("INSERT INTO story_rewrite_think_staff (username_key,username,role,active,appointed_by) VALUES ($1,$2,$3,TRUE,$4) ON CONFLICT (username_key) DO UPDATE SET username = EXCLUDED.username, role = EXCLUDED.role, active = TRUE, appointed_by = EXCLUDED.appointed_by, updated_at = NOW()", [RequestRow.requester_username_key, AccountRow.rows[0].username, RequestRow.requested_role, Account.username]);
            }
            await Database.query("UPDATE story_rewrite_think_access_requests SET status = $1, reviewed_by = $2, review_note = $3, reviewed_at = NOW() WHERE id = $4", [Decision === "approve" ? "approved" : "rejected", Account.username, Note, RequestRow.id]);
            await writeAudit(Staff, "think_access_" + Decision, RequestRow.requester_username, { requestId: RequestRow.id, requestedRole: RequestRow.requested_role, note: Note });
            SendJson(Response, 200, { ok: true, status: Decision === "approve" ? "approved" : "rejected" }, Origin);
            return true;
        }

        if (RequestPath === "/api/think/ideas" && Request.method === "POST") {
            const Body = await ReadJson(Request).catch(() => ({}));
            const Title = String(Body && Body.title || "").trim().slice(0, 120);
            const Idea = String(Body && Body.body || "").trim().slice(0, 3000);
            if (Title.length < 3 || Idea.length < 15) {
                SendJson(Response, 400, { error: "Add an idea title and a little detail." }, Origin);
                return true;
            }
            const Result = await Database.query(
                "INSERT INTO story_rewrite_think_ideas (title,body,submitted_by_key,submitted_by) VALUES ($1,$2,$3,$4) RETURNING id",
                [Title, Idea, UsernameKey(Account.username), Account.username]
            );
            await writeAudit(Staff, "think_idea_submitted", null, { ideaId: Result.rows[0].id });
            SendJson(Response, 201, { ok: true, ideaId: Result.rows[0].id }, Origin);
            return true;
        }

        SendJson(Response, 404, { error: "Silicon Valley route not found." }, Origin);
        return true;
    }

    return { ensureSchema, isRestricted, handle };
}

module.exports = { createThinkRuntime };
