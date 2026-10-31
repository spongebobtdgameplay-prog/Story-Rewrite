"use strict";

function createThinkRuntime(Dependencies) {
    const Database = Dependencies.Database;
    const Io = Dependencies.Io;
    const UsernameKey = Dependencies.UsernameKey;
    const ReadJson = Dependencies.ReadJson;
    const SendJson = Dependencies.SendJson;
    const OwnerKey = "darius56";
    let SchemaPromise = null;

    async function ensureSchema() {
        if (!Database) throw new Error("The account database is not configured.");
        if (!SchemaPromise) {
            SchemaPromise = (async () => {
                await Database.query("CREATE TABLE IF NOT EXISTS story_rewrite_think_staff (username_key TEXT PRIMARY KEY, username TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('developer','moderator','top_moderator')), active BOOLEAN NOT NULL DEFAULT TRUE, appointed_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
                await Database.query("CREATE TABLE IF NOT EXISTS story_rewrite_think_cases (id BIGSERIAL PRIMARY KEY, target_username_key TEXT NOT NULL, target_username TEXT NOT NULL, category TEXT NOT NULL, reason TEXT NOT NULL, evidence TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'reported' CHECK (status IN ('reported','under_review','confirmed','cleared')), filed_by_key TEXT NOT NULL, filed_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), reviewed_by TEXT, review_note TEXT)");
                await Database.query("CREATE INDEX IF NOT EXISTS story_rewrite_think_cases_target_idx ON story_rewrite_think_cases (target_username_key, created_at DESC)");
                await Database.query("CREATE TABLE IF NOT EXISTS story_rewrite_think_requests (id BIGSERIAL PRIMARY KEY, case_id BIGINT NOT NULL REFERENCES story_rewrite_think_cases(id), action_type TEXT NOT NULL CHECK (action_type IN ('suspend_account','terminate_sessions')), target_username_key TEXT NOT NULL, target_username TEXT NOT NULL, reason TEXT NOT NULL, evidence TEXT NOT NULL, requested_by_key TEXT NOT NULL, requested_by TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')), storybot_json JSONB NOT NULL DEFAULT '{}'::jsonb, reviewed_by TEXT, review_note TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), reviewed_at TIMESTAMPTZ)");
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

    async function isRestricted(Username) {
        if (!Username || !Database) return false;
        await ensureSchema();
        const Result = await Database.query(
            "SELECT 1 FROM story_rewrite_think_restrictions WHERE username_key = $1 AND (expires_at IS NULL OR expires_at > NOW()) LIMIT 1",
            [UsernameKey(Username)]
        );
        return Result.rowCount > 0;
    }

    async function writeAudit(Staff, Action, TargetUsername, Details) {
        await Database.query(
            "INSERT INTO story_rewrite_think_audit (actor_username_key, actor_username, actor_role, action, target_username, details_json) VALUES ($1,$2,$3,$4,$5,$6::jsonb)",
            [UsernameKey(Staff.username), Staff.username, Staff.role, String(Action).slice(0, 80), TargetUsername ? String(TargetUsername).slice(0, 32) : null, JSON.stringify(Details || {})]
        );
    }

    async function addAlert(Username, Message, Severity) {
        const Name = String(Username || "").trim().slice(0, 32);
        if (!Name) return;
        await Database.query(
            "INSERT INTO story_rewrite_think_alerts (recipient_username_key, recipient_username, severity, message, source) VALUES ($1,$2,$3,$4,'storybot')",
            [UsernameKey(Name), Name, Severity || "warning", String(Message || "").slice(0, 500)]
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

    async function disconnectTargetSessions(Username) {
        const Key = UsernameKey(Username);
        await Database.query("DELETE FROM story_rewrite_sessions WHERE username_key = $1", [Key]);
        for (const ConnectedSocket of Io.sockets.sockets.values()) {
            if (UsernameKey(ConnectedSocket.data && ConnectedSocket.data.username || "") === Key) ConnectedSocket.disconnect(true);
        }
    }

    async function handle(Request, Response, RequestPath, Origin, Account) {
        if (!RequestPath.startsWith("/api/think")) return false;
        await ensureSchema();
        const Staff = await getStaff(Account.username);
        if (!Staff || !canRead(Staff.role)) {
            SendJson(Response, 403, { error: "Silicon Valley access is restricted to authorized Story Rewrite developers." }, Origin);
            return true;
        }

        if (RequestPath === "/api/think/overview" && Request.method === "GET") {
            const Results = await Promise.all([
                Database.query("SELECT username, role, active, created_at FROM story_rewrite_think_staff WHERE active = TRUE ORDER BY CASE role WHEN 'top_moderator' THEN 1 WHEN 'moderator' THEN 2 ELSE 3 END, username"),
                Database.query("SELECT id, target_username, category, reason, evidence, status, filed_by, created_at, updated_at, reviewed_by, review_note FROM story_rewrite_think_cases ORDER BY created_at DESC LIMIT 100"),
                Database.query("SELECT id, case_id, action_type, target_username, reason, evidence, requested_by, status, storybot_json, reviewed_by, review_note, created_at, reviewed_at FROM story_rewrite_think_requests ORDER BY created_at DESC LIMIT 100"),
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
            const StoredReview = Object.assign({}, Preliminary, { checkedAt: new Date().toISOString(), stage: "submission" });
            const Inserted = await Database.query(
                "INSERT INTO story_rewrite_think_requests (case_id,action_type,target_username_key,target_username,reason,evidence,requested_by_key,requested_by,storybot_json) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) RETURNING id",
                [CaseId, ActionType, UsernameKey(Target), Target, Reason, Evidence, UsernameKey(Account.username), Account.username, JSON.stringify(StoredReview)]
            );
            await writeAudit(Staff, "think_action_requested", Target, { requestId: Inserted.rows[0].id, caseId: CaseId, actionType: ActionType, storybotAllowed: Preliminary.allowed });
            SendJson(Response, 201, { ok: true, requestId: Inserted.rows[0].id, storybot: StoredReview }, Origin);
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
            const PendingResult = await Database.query("SELECT * FROM story_rewrite_think_requests WHERE id = $1 AND status = 'pending' LIMIT 1", [Number(RequestReviewMatch[1])]);
            if (!PendingResult.rowCount) {
                SendJson(Response, 404, { error: "Pending action request not found." }, Origin);
                return true;
            }
            const Pending = PendingResult.rows[0];
            const CaseResult = await Database.query("SELECT * FROM story_rewrite_think_cases WHERE id = $1 LIMIT 1", [Pending.case_id]);
            const CaseRow = CaseResult.rows[0] || null;

            if (Decision === "reject") {
                await Database.query("UPDATE story_rewrite_think_requests SET status = 'rejected', reviewed_by = $1, review_note = $2, reviewed_at = NOW() WHERE id = $3", [Account.username, ReviewNote || "Rejected by reviewer.", Pending.id]);
                await writeAudit(Staff, "think_action_rejected", Pending.target_username, { requestId: Pending.id, note: ReviewNote });
                SendJson(Response, 200, { ok: true, status: "rejected" }, Origin);
                return true;
            }

            const BotReview = await preActionReview(Staff, Pending, CaseRow);
            await Database.query("UPDATE story_rewrite_think_requests SET storybot_json = $1::jsonb WHERE id = $2", [JSON.stringify(Object.assign({}, BotReview, { checkedAt: new Date().toISOString(), stage: "approval" })), Pending.id]);
            if (!BotReview.allowed) {
                if (BotReview.warnings && BotReview.warnings.length) await addAlert(Account.username, BotReview.warnings.join(" "));
                await writeAudit(Staff, "think_action_blocked_by_storybot", Pending.target_username, { requestId: Pending.id, blockers: BotReview.blockers });
                SendJson(Response, 409, { error: BotReview.summary, storybot: BotReview }, Origin);
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
