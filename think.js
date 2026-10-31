(() => {
    "use strict";

    const Root = document.getElementById("ThinkApp");
    if (!Root || Root.dataset.initialized === "1") return;
    Root.dataset.initialized = "1";

    const $ = Id => document.getElementById(Id);
    const IsHackersPage = document.body.dataset.thinkPage === "hackers";
    let Overview = null;

    function Esc(Value) {
        return String(Value === null || Value === undefined ? "" : Value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }
    function DateText(Value) {
        const DateValue = new Date(Value);
        return Number.isFinite(DateValue.getTime()) ? DateValue.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "Time unavailable";
    }
    function RoleText(Role) {
        return ({
            owner: "Owner",
            top_moderator: "Top-tier moderator",
            moderator: "Moderator",
            developer: "Developer"
        })[Role] || "Unknown role";
    }
    function StatusText(Status) {
        return String(Status || "unknown").replace(/_/g, " ");
    }
    function Feedback(Id, Message, Good) {
        const Node = $(Id);
        if (!Node) return;
        Node.textContent = Message || "";
        Node.style.color = Good ? "#b6d8ac" : "#e7ad9e";
    }
    function Empty(Text) {
        return '<div class="ThinkEmpty">' + Esc(Text) + "</div>";
    }
    function Badge(Status) {
        const Key = String(Status || "unknown").toLowerCase().replace(/[^a-z_]/g, "");
        return '<span class="ThinkBadge ' + Esc(Key) + '">' + Esc(StatusText(Status)) + "</span>";
    }
    async function Post(Path, Body) {
        return ApiRequest(Path, { method: "POST", body: JSON.stringify(Body || {}) });
    }

    function RenderAlerts() {
        const Items = Overview.alerts || [];
        const Container = $("ThinkAlerts");
        if (!Container) return;
        Container.innerHTML = Items.length ? Items.map(Item =>
            '<article class="ThinkRow"><div class="ThinkRowMain"><strong>StoryBot · ' + Esc(Item.severity || "notice") + '</strong><p>' + Esc(Item.message) + '</p><div class="ThinkMeta">' + Esc(DateText(Item.created_at)) + '</div></div></article>'
        ).join("") : Empty("No StoryBot notices for your account.");
        const Metric = $("MetricAlerts");
        if (Metric) Metric.textContent = String(Items.length);
    }

    function RenderRoster() {
        const Container = $("ThinkRoster");
        if (!Container) return;
        const Items = Overview.roster || [];
        Container.innerHTML = Items.length ? Items.map(Item =>
            '<article class="ThinkRow"><div class="ThinkRowMain"><strong>' + Esc(Item.username) + '</strong><div class="ThinkMeta">' + Esc(RoleText(Item.role)) + "</div></div>" + Badge(Item.active === false ? "inactive" : "active") + "</article>"
        ).join("") : Empty("No developers have been appointed yet.");
        const Metric = $("MetricStaff");
        if (Metric) Metric.textContent = String(Items.length);
    }

    function CaseActions(Case) {
        if (!Overview.permissions.canReview) return "";
        const Buttons = [];
        if (Case.status !== "under_review") Buttons.push('<button class="ThinkButton small" type="button" data-case-status="under_review" data-case-id="' + Esc(Case.id) + '">Mark under review</button>');
        if (Case.status !== "confirmed") Buttons.push('<button class="ThinkButton small" type="button" data-case-status="confirmed" data-case-id="' + Esc(Case.id) + '">Confirm finding</button>');
        if (Case.status !== "cleared") Buttons.push('<button class="ThinkButton small danger" type="button" data-case-status="cleared" data-case-id="' + Esc(Case.id) + '">Clear case</button>');
        return Buttons.length ? '<div class="ThinkActions">' + Buttons.join("") + "</div>" : "";
    }

    function RenderCases() {
        const Container = $("ThinkCases");
        if (!Container) return;
        const Search = String($("CaseSearch")?.value || "").trim().toLowerCase();
        const Filter = String($("CaseStatusFilter")?.value || "all");
        const Items = (Overview.cases || []).filter(Case => {
            if (Filter !== "all" && Case.status !== Filter) return false;
            if (!Search) return true;
            return [Case.target_username, Case.category, Case.reason, Case.evidence, Case.filed_by].some(Value => String(Value || "").toLowerCase().includes(Search));
        });
        Container.innerHTML = Items.length ? Items.map(Case =>
            '<article class="ThinkRow"><div class="ThinkRowMain"><strong>#' + Esc(Case.id) + " · " + Esc(Case.target_username) + '</strong><div class="ThinkMeta">' + Badge(Case.status) + '<span>' + Esc(Case.category) + '</span><span>Reported by ' + Esc(Case.filed_by) + '</span><span>' + Esc(DateText(Case.created_at)) + '</span></div><p><b>Reason:</b> ' + Esc(Case.reason) + '</p><p><b>Evidence:</b> ' + Esc(Case.evidence) + '</p>' + (Case.review_note ? '<p><b>Review note:</b> ' + Esc(Case.review_note) + '</p>' : "") + CaseActions(Case) + '</div></article>'
        ).join("") : Empty("No investigation cases match this filter.");
        const Select = $("RequestCase");
        if (Select) {
            const Available = (Overview.cases || []).filter(Case => Case.status !== "cleared");
            Select.innerHTML = '<option value="">Choose a case</option>' + Available.map(Case =>
                '<option value="' + Esc(Case.id) + '">#' + Esc(Case.id) + " · " + Esc(Case.target_username) + " · " + Esc(StatusText(Case.status)) + "</option>"
            ).join("");
        }
        const Metric = $("MetricCases");
        if (Metric) Metric.textContent = String((Overview.cases || []).length);
    }

    function RenderRequests() {
        const Container = $("ThinkRequests");
        if (!Container) return;
        const Items = Overview.requests || [];
        Container.innerHTML = Items.length ? Items.map(Item => {
            const Bot = Item.storybot_json || {};
            const DecisionControls = Overview.permissions.canReview && Item.status === "pending"
                ? '<div class="ThinkActions"><button class="ThinkButton small primary" type="button" data-request-review="approve" data-request-id="' + Esc(Item.id) + '">Approve</button><button class="ThinkButton small danger" type="button" data-request-review="reject" data-request-id="' + Esc(Item.id) + '">Reject</button></div>'
                : "";
            const BotText = Bot.summary || "StoryBot review pending at approval.";
            const Blockers = Array.isArray(Bot.blockers) && Bot.blockers.length
                ? '<p><b>StoryBot checks:</b> ' + Esc(Bot.blockers.join(" ")) + "</p>"
                : "";
            return '<article class="ThinkRow"><div class="ThinkRowMain"><strong>Request #' + Esc(Item.id) + " · " + Esc(Item.action_type === "suspend_account" ? "Suspend account" : "Terminate active sessions") + " · " + Esc(Item.target_username) + '</strong><div class="ThinkMeta">' + Badge(Item.status) + '<span>Case #' + Esc(Item.case_id) + '</span><span>Requested by ' + Esc(Item.requested_by) + '</span><span>' + Esc(DateText(Item.created_at)) + '</span></div><p><b>Reason:</b> ' + Esc(Item.reason) + '</p><p><b>Evidence:</b> ' + Esc(Item.evidence) + '</p><p><b>StoryBot:</b> ' + Esc(BotText) + '</p>' + Blockers + (Item.review_note ? '<p><b>Review note:</b> ' + Esc(Item.review_note) + '</p>' : "") + DecisionControls + '</div></article>';
        }).join("") : Empty("No higher-action requests have been submitted.");
        const Metric = $("MetricRequests");
        if (Metric) Metric.textContent = String(Items.filter(Item => Item.status === "pending").length);
    }

    function RenderIdeas() {
        const Container = $("ThinkIdeas");
        if (!Container) return;
        const Items = Overview.ideas || [];
        Container.innerHTML = Items.length ? Items.map(Item =>
            '<article class="ThinkRow"><div class="ThinkRowMain"><strong>' + Esc(Item.title) + '</strong><div class="ThinkMeta"><span>' + Esc(Item.submitted_by) + '</span><span>' + Esc(DateText(Item.created_at)) + '</span>' + Badge(Item.status) + '</div><p>' + Esc(Item.body) + '</p></div></article>'
        ).join("") : Empty("No developer ideas have been submitted yet.");
    }

    function RenderAudit() {
        const Container = $("ThinkAudit");
        if (!Container) return;
        const Items = Overview.audit || [];
        Container.innerHTML = Items.length ? Items.slice(0, 40).map(Item =>
            '<article class="ThinkRow"><div class="ThinkRowMain"><strong>' + Esc(Item.actor_username) + " · " + Esc(Item.action) + '</strong><div class="ThinkMeta"><span>' + Esc(RoleText(Item.actor_role)) + '</span><span>' + Esc(Item.target_username || "Workspace") + '</span><span>' + Esc(DateText(Item.created_at)) + '</span></div></div></article>'
        ).join("") : Empty("No security actions have been recorded yet.");
    }

    function RenderAccessRequests() {
        const Container = $("ThinkAccessRequests");
        if (!Container) return;
        const Items = Overview.accessRequests || [];
        if (Overview.permissions.canManageStaff) {
            Container.innerHTML = Items.length ? Items.map(Item =>
                '<article class="ThinkRow"><div class="ThinkRowMain"><strong>Access request #' + Esc(Item.id) + " · " + Esc(Item.requester_username) + '</strong><div class="ThinkMeta">' + Badge(Item.status) + '<span>Requested tier: ' + Esc(RoleText(Item.requested_role)) + '</span><span>' + Esc(DateText(Item.created_at)) + '</span></div><p>' + Esc(Item.reason) + '</p>' + (Item.status === "pending" ? '<div class="ThinkActions"><button class="ThinkButton small primary" type="button" data-access-review="approve" data-access-id="' + Esc(Item.id) + '">Approve tier</button><button class="ThinkButton small danger" type="button" data-access-review="reject" data-access-id="' + Esc(Item.id) + '">Reject</button></div>' : "") + '</div></article>'
            ).join("") : Empty("No developer access requests.");
        } else {
            Container.innerHTML = Items.length ? Items.map(Item =>
                '<article class="ThinkRow"><div class="ThinkRowMain"><strong>Your request #' + Esc(Item.id) + '</strong><div class="ThinkMeta">' + Badge(Item.status) + '<span>' + Esc(RoleText(Item.requested_role)) + '</span></div><p>' + Esc(Item.reason) + '</p></div></article>'
            ).join("") : "";
        }
    }

    function Render() {
        const Role = Overview.staff.role;
        const Status = $("ThinkConnectionStatus");
        if (Status) Status.textContent = "Authorized · " + Overview.staff.username;
        const RoleBadge = $("ThinkRoleBadge");
        if (RoleBadge) RoleBadge.textContent = RoleText(Role);
        if ($("ThinkStaffManageCard")) $("ThinkStaffManageCard").hidden = !Overview.permissions.canManageStaff;
        if ($("ThinkCreateCaseCard")) $("ThinkCreateCaseCard").hidden = !Overview.permissions.canCreateCase;
        if ($("ThinkAccessForm")) $("ThinkAccessForm").hidden = !["developer", "moderator"].includes(Role);
        RenderAlerts();
        RenderRoster();
        RenderCases();
        RenderRequests();
        RenderIdeas();
        RenderAudit();
        RenderAccessRequests();
    }

    async function Load() {
        const Status = $("ThinkConnectionStatus");
        if (Status) Status.textContent = "Refreshing authorized workspace…";
        try {
            await RequireAccount();
            Overview = await ApiRequest("/api/think/overview");
            Render();
        } catch (Error) {
            if (Status) Status.textContent = Error.status === 403 ? "Access not authorized" : (Error.message || "Could not load workspace");
            if (Error.status === 401) return;
            Root.querySelectorAll("form").forEach(Form => { Form.hidden = true; });
            const Existing = Root.querySelector(".ThinkMain");
            if (Existing) Existing.insertAdjacentHTML("afterbegin", '<div class="ThinkNotice warning">' + Esc(Error.message || "Your account is not an authorized Story Rewrite developer.") + "</div>");
        }
    }

    async function SubmitForm(Form, FeedbackId, Path, BuildBody) {
        const Button = Form.querySelector('button[type="submit"]');
        if (Button) Button.disabled = true;
        Feedback(FeedbackId, "Submitting…", true);
        try {
            await Post(Path, BuildBody(new FormData(Form)));
            Form.reset();
            Feedback(FeedbackId, "Saved successfully.", true);
            await Load();
        } catch (Error) {
            Feedback(FeedbackId, Error.message || "The request could not be completed.", false);
        } finally {
            if (Button) Button.disabled = false;
        }
    }

    const CaseForm = $("ThinkCaseForm");
    if (CaseForm) CaseForm.addEventListener("submit", Event => {
        Event.preventDefault();
        SubmitForm(CaseForm, "ThinkCaseFeedback", "/api/think/cases", Data => ({
            targetUsername: Data.get("targetUsername"),
            category: Data.get("category"),
            reason: Data.get("reason"),
            evidence: Data.get("evidence")
        }));
    });

    const RequestForm = $("ThinkRequestForm");
    if (RequestForm) RequestForm.addEventListener("submit", Event => {
        Event.preventDefault();
        SubmitForm(RequestForm, "ThinkRequestFeedback", "/api/think/requests", Data => ({
            caseId: Number(Data.get("caseId")),
            actionType: Data.get("actionType"),
            reason: Data.get("reason"),
            evidence: Data.get("evidence")
        }));
    });

    const StaffForm = $("ThinkStaffForm");
    if (StaffForm) StaffForm.addEventListener("submit", Event => {
        Event.preventDefault();
        SubmitForm(StaffForm, "ThinkStaffFeedback", "/api/think/staff", Data => ({
            username: Data.get("username"),
            role: Data.get("role")
        }));
    });

    const IdeaForm = $("ThinkIdeaForm");
    if (IdeaForm) IdeaForm.addEventListener("submit", Event => {
        Event.preventDefault();
        SubmitForm(IdeaForm, "ThinkIdeaFeedback", "/api/think/ideas", Data => ({
            title: Data.get("title"),
            body: Data.get("body")
        }));
    });

    const AccessForm = $("ThinkAccessForm");
    if (AccessForm) AccessForm.addEventListener("submit", Event => {
        Event.preventDefault();
        SubmitForm(AccessForm, "ThinkAccessFeedback", "/api/think/access-requests", Data => ({
            reason: Data.get("reason")
        }));
    });

    if ($("CaseSearch")) $("CaseSearch").addEventListener("input", RenderCases);
    if ($("CaseStatusFilter")) $("CaseStatusFilter").addEventListener("change", RenderCases);
    Root.querySelectorAll(".ThinkReload").forEach(Button => Button.addEventListener("click", Load));

    Root.addEventListener("click", async Event => {
        const Button = Event.target.closest("button");
        if (!Button || !Overview) return;
        try {
            if (Button.dataset.caseStatus) {
                const CaseId = Number(Button.dataset.caseId);
                const Note = Button.dataset.caseStatus === "confirmed"
                    ? window.prompt("Explain why the evidence supports a confirmed finding (at least 25 characters):", "")
                    : "Investigation status updated after review.";
                if (Button.dataset.caseStatus === "confirmed" && (!Note || Note.trim().length < 25)) return;
                await Post("/api/think/cases/" + CaseId + "/status", { status: Button.dataset.caseStatus, note: Note });
                await Load();
            } else if (Button.dataset.requestReview) {
                const RequestId = Number(Button.dataset.requestId);
                const Decision = Button.dataset.requestReview;
                const Note = Decision === "approve" ? "Approved after review in Silicon Valley." : "Rejected after review in Silicon Valley.";
                await Post("/api/think/requests/" + RequestId + "/review", { decision: Decision, note: Note, durationMinutes: 1440 });
                await Load();
            } else if (Button.dataset.accessReview) {
                const AccessId = Number(Button.dataset.accessId);
                const Decision = Button.dataset.accessReview;
                await Post("/api/think/access-requests/" + AccessId + "/review", { decision: Decision, note: "Reviewed by the owner." });
                await Load();
            }
        } catch (Error) {
            window.alert(Error.data?.storybot
                ? Error.data.storybot.blockers.join("\n")
                : (Error.message || "The action could not be completed."));
            if (Error.data?.storybot && Error.data.storybot.warnings?.length) {
                await Load();
            }
        }
    });

    Load();
})();
