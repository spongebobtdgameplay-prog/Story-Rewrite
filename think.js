(() => {
    "use strict";

    const Root = document.getElementById("ThinkApp");
    if (!Root || Root.dataset.initialized === "1") return;
    Root.dataset.initialized = "1";

    const $ = Id => document.getElementById(Id);
    const IsHackersPage = document.body.dataset.thinkPage === "hackers";
    let Overview = null;
    let PendingReviewAction = null;
    let ReviewReturnFocus = null;
    let LastFocusedCaseId = "";

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
        if (Container) Container.innerHTML = Items.length ? Items.map(Item =>
            '<article class="ThinkRow ThinkSafetyRow"><div class="ThinkRowMain"><strong>SafetyBot · ' + Esc(Item.severity || "notice") + '</strong><p>' + Esc(Item.message) + '</p><div class="ThinkMeta">' + Esc(DateText(Item.created_at)) + '</div></div></article>'
        ).join("") : Empty("No SafetyBot notices for your account.");
        const Metric = $("MetricAlerts");
        if (Metric) Metric.textContent = String(Items.length);
        const Status = $("ThinkSafetyBotStatus");
        if (Status) Status.textContent = "Active · conversational rule guidance, privacy checks, and action-severity review";
        const PolicyStatus = $("ThinkSafetyBotPolicyStatus");
        if (PolicyStatus) PolicyStatus.textContent = "Active · policy context, evidence quality, and fair review";
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
        const Search = String($("CaseSearch")?.value || "").trim().toLowerCase();
        const Filter = String($("CaseStatusFilter")?.value || "all");
        const Items = (Overview.cases || []).filter(Case => {
            if (Filter !== "all" && Case.status !== Filter) return false;
            if (!Search) return true;
            return [Case.target_username, Case.category, Case.reason, Case.evidence, Case.filed_by].some(Value => String(Value || "").toLowerCase().includes(Search));
        });
        if (Container) Container.innerHTML = Items.length ? Items.map(Case =>
            '<article class="ThinkRow" data-investigation-case-id="' + Esc(Case.id) + '"><div class="ThinkRowMain"><strong>#' + Esc(Case.id) + " · " + Esc(Case.target_username) + '</strong><div class="ThinkMeta">' + Badge(Case.status) + '<span>' + Esc(Case.category) + '</span><span>Reported by ' + Esc(Case.filed_by) + '</span><span>' + Esc(DateText(Case.created_at)) + '</span></div><p><b>Reason:</b> ' + Esc(Case.reason) + '</p><p><b>Evidence:</b> ' + Esc(Case.evidence) + '</p>' + (Case.review_note ? '<p><b>Review note:</b> ' + Esc(Case.review_note) + '</p>' : "") + CaseActions(Case) + '</div></article>'
        ).join("") : Empty("No investigation cases match this filter.");
        const Select = $("RequestCase");
        if (Select) {
            const PreviousValue = Select.value;
            const Available = (Overview.cases || []).filter(Case => Case.status !== "cleared");
            Select.innerHTML = '<option value="">Choose a case</option>' + Available.map(Case =>
                '<option value="' + Esc(Case.id) + '">#' + Esc(Case.id) + " · " + Esc(Case.target_username) + " · " + Esc(StatusText(Case.status)) + "</option>"
            ).join("");
            if ([...Select.options].some(Option => Option.value === PreviousValue)) Select.value = PreviousValue;
        }
        const Metric = $("MetricCases");
        if (Metric) Metric.textContent = String((Overview.cases || []).length);
        if (IsHackersPage) {
            const FocusCaseId = new URLSearchParams(window.location.search).get("case") || "";
            if (/^\d+$/.test(FocusCaseId)) {
                const Focused = Container?.querySelector('[data-investigation-case-id="' + FocusCaseId + '"]');
                if (Focused) {
                    Focused.classList.add("IsFocusedCase");
                    if (LastFocusedCaseId !== FocusCaseId) {
                        LastFocusedCaseId = FocusCaseId;
                        window.setTimeout(() => Focused.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
                    }
                }
            }
        }
    }

    function RenderRequests() {
        const Container = $("ThinkRequests");
        if (!Container) return;
        const Items = Overview.requests || [];
        Container.innerHTML = Items.length ? Items.map(Item => {
            const Review = Item.storybot_json || {};
            const Safety = Item.safetybot_json || {};
            const DecisionControls = Overview.permissions.canReview && Item.status === "pending"
                ? '<div class="ThinkActions"><button class="ThinkButton small primary" type="button" data-request-review="approve" data-request-id="' + Esc(Item.id) + '">Approve</button><button class="ThinkButton small danger" type="button" data-request-review="reject" data-request-id="' + Esc(Item.id) + '">Reject</button></div>' : "";
            const Summary = [Review.summary, Safety.summary].filter(Boolean).join(" ");
            const Checks = [
                ...(Array.isArray(Review.blockers) ? Review.blockers : []),
                ...(Array.isArray(Safety.blockers) ? Safety.blockers : [])
            ];
            const BlockerText = Checks.length ? '<p><b>SafetyBot checks:</b> ' + Esc(Checks.join(" ")) + "</p>" : "";
            const Warnings = [
                ...(Array.isArray(Review.warnings) ? Review.warnings : []),
                ...(Array.isArray(Safety.warnings) ? Safety.warnings : [])
            ];
            const WarningText = Warnings.length ? '<p class="ThinkSubtle"><b>SafetyBot:</b> ' + Esc(Warnings.join(" ")) + "</p>" : "";
            const CaseLink = '<div class="ThinkActions"><a class="ThinkButton small" href="hackers.html?case=' + encodeURIComponent(String(Item.case_id)) + '" data-story-go="hackers.html?case=' + encodeURIComponent(String(Item.case_id)) + '">View investigation</a></div>';
            return '<article class="ThinkRow"><div class="ThinkRowMain"><strong>Request #' + Esc(Item.id) + " · " + Esc(Item.action_type === "suspend_account" ? "Suspend account" : "Terminate active sessions") + " · " + Esc(Item.target_username) + '</strong><div class="ThinkMeta">' + Badge(Item.status) + '<span>Case #' + Esc(Item.case_id) + '</span><span>Requested by ' + Esc(Item.requested_by) + '</span><span>' + Esc(DateText(Item.created_at)) + '</span></div><p><b>Reason:</b> ' + Esc(Item.reason) + '</p><p><b>Evidence:</b> ' + Esc(Item.evidence) + '</p><p><b>SafetyBot review:</b> ' + Esc(Summary || "SafetyBot review pending at approval.") + '</p>' + BlockerText + WarningText + (Item.review_note ? '<p><b>Review note:</b> ' + Esc(Item.review_note) + '</p>' : "") + CaseLink + DecisionControls + '</div></article>';
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
        for (const Id of ["ThinkSafetyBotMetric", "ThinkAlertsCard", "ThinkSafetyPolicyCard", "ThinkSafetyBotCard"]) {
            if ($(Id)) $(Id).hidden = false;
        }
        if ($("ThinkAccessForm")) $("ThinkAccessForm").hidden = !["developer", "moderator"].includes(Role);
        RenderAlerts();
        RenderRoster();
        RenderCases();
        RenderRequests();
        RenderIdeas();
        RenderAudit();
        RenderAccessRequests();
    }

    function SetReviewModalFeedback(Message, Good = false) {
        const Node = $("ThinkReviewNoteFeedback");
        if (!Node) return;
        Node.textContent = Message || "";
        Node.className = "ThinkReviewFeedback" + (Good ? " Good" : Message ? " Bad" : "");
    }
    function UpdateReviewNoteCount() {
        const Input = $("ThinkReviewNoteInput"), Count = $("ThinkReviewNoteCount"), Hint = $("ThinkReviewNoteHint");
        if (!Input) return;
        const Minimum = Number(PendingReviewAction?.minimum || 0), Length = Input.value.trim().length;
        if (Count) Count.textContent = Minimum ? Length + " / " + Minimum + " characters minimum" : Length + " characters (optional)";
        if (Hint) Hint.textContent = Minimum ? "Minimum " + Minimum + " characters. Explain the evidence and why the decision is justified." : "A reason is optional when rejecting this request.";
    }
    function CloseReviewNoteModal() {
        const Modal = $("ThinkReviewModal");
        if (Modal) Modal.hidden = true;
        document.body.classList.remove("ThinkModalOpen");
        PendingReviewAction = null;
        if (ReviewReturnFocus?.isConnected) ReviewReturnFocus.focus({ preventScroll: true });
        ReviewReturnFocus = null;
    }
    function OpenReviewNoteModal(Action) {
        const Modal = $("ThinkReviewModal"), Input = $("ThinkReviewNoteInput");
        const Title = $("ThinkReviewModalTitle"), Intro = $("ThinkReviewModalIntro");
        const Label = $("ThinkReviewNoteLabel"), Submit = $("ThinkReviewSubmit");
        if (!Modal || !Input || !Title || !Intro || !Label || !Submit) return;
        PendingReviewAction = Action;
        ReviewReturnFocus = document.activeElement;
        const IsCase = Action.type === "case", IsRequired = Number(Action.minimum || 0) > 0;
        Title.textContent = IsCase ? "Confirm investigation finding" : Action.decision === "approve" ? "Approve higher-action request" : "Reject higher-action request";
        Intro.textContent = IsCase ? "Record the evidence-based reason for confirming this case." : "Record the review decision for this linked investigation.";
        Label.textContent = IsCase ? "Why does the evidence support confirming this finding?" : Action.decision === "approve" ? "Explain why the evidence justifies this action" : "Reason for rejection (optional)";
        Submit.textContent = IsCase ? "Confirm finding" : Action.decision === "approve" ? "Approve request" : "Reject request";
        Input.value = "";
        Input.required = IsRequired;
        Input.minLength = IsRequired ? Number(Action.minimum) : 0;
        SetReviewModalFeedback("");
        UpdateReviewNoteCount();
        Modal.hidden = false;
        document.body.classList.add("ThinkModalOpen");
        window.requestAnimationFrame(() => Input.focus({ preventScroll: true }));
    }
    async function SubmitReviewNote(Event) {
        Event.preventDefault();
        if (!PendingReviewAction) return;
        const Input = $("ThinkReviewNoteInput"), Submit = $("ThinkReviewSubmit");
        const Note = String(Input?.value || "").trim(), Minimum = Number(PendingReviewAction.minimum || 0);
        if (Note.length < Minimum) {
            SetReviewModalFeedback("Please enter at least " + Minimum + " characters before submitting.");
            Input?.focus({ preventScroll: true });
            UpdateReviewNoteCount();
            return;
        }
        const Action = PendingReviewAction;
        if (Submit) Submit.disabled = true;
        SetReviewModalFeedback("Submitting review…", true);
        try {
            if (Action.type === "case") await Post("/api/think/cases/" + Action.id + "/status", { status: "confirmed", note: Note });
            else await Post("/api/think/requests/" + Action.id + "/review", { decision: Action.decision, note: Note, durationMinutes: 1440 });
            CloseReviewNoteModal();
            await Load();
        } catch (Error) {
            const BotDetails = [
                ...(Array.isArray(Error.data?.storybot?.blockers) ? Error.data.storybot.blockers : []),
                ...(Array.isArray(Error.data?.safetybot?.blockers) ? Error.data.safetybot.blockers : [])
            ];
            SetReviewModalFeedback(BotDetails.length ? BotDetails.join(" ") : (Error.message || "The review could not be submitted."));
            if (Error.data?.storybot || Error.data?.safetybot) await Load();
        } finally {
            if (Submit) Submit.disabled = false;
        }
    }
    $("ThinkReviewNoteInput")?.addEventListener("input", UpdateReviewNoteCount);
    $("ThinkReviewForm")?.addEventListener("submit", SubmitReviewNote);
    $("ThinkReviewModal")?.addEventListener("click", Event => {
        if (Event.target.closest("[data-review-close]")) CloseReviewNoteModal();
    });
    document.addEventListener("keydown", Event => {
        if (Event.key === "Escape" && $("ThinkReviewModal") && !$("ThinkReviewModal").hidden) CloseReviewNoteModal();
    });

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
            if (Error.status === 403) {
                for (const Id of ["ThinkSafetyBotMetric", "ThinkAlertsCard", "ThinkSafetyPolicyCard", "ThinkSafetyBotCard"]) {
                    if ($(Id)) $(Id).hidden = true;
                }
            }
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
                if (Button.dataset.caseStatus === "confirmed") {
                    OpenReviewNoteModal({ type: "case", id: CaseId, minimum: 25 });
                    return;
                }
                await Post("/api/think/cases/" + CaseId + "/status", { status: Button.dataset.caseStatus, note: "Investigation status updated after review." });
                await Load();
            } else if (Button.dataset.requestReview) {
                OpenReviewNoteModal({
                    type: "request", id: Number(Button.dataset.requestId),
                    decision: Button.dataset.requestReview,
                    minimum: Button.dataset.requestReview === "approve" ? 25 : 0
                });
            } else if (Button.dataset.accessReview) {
                const AccessId = Number(Button.dataset.accessId), Decision = Button.dataset.accessReview;
                await Post("/api/think/access-requests/" + AccessId + "/review", { decision: Decision, note: "Reviewed by the owner." });
                await Load();
            }
        } catch (Error) {
            const FeedbackNode = $("ThinkActionFeedback");
            const BotDetails = [
                ...(Array.isArray(Error.data?.storybot?.blockers) ? Error.data.storybot.blockers : []),
                ...(Array.isArray(Error.data?.safetybot?.blockers) ? Error.data.safetybot.blockers : [])
            ];
            if (FeedbackNode) {
                FeedbackNode.textContent = BotDetails.length ? BotDetails.join(" ") : (Error.message || "The action could not be completed.");
                FeedbackNode.className = "ThinkSubtle ThinkActionFeedback Bad";
            }
            if (Error.data?.storybot || Error.data?.safetybot) await Load();
        }
    });

    async function KeepThinkRoomAlive() {
        if (document.visibilityState !== "visible" || typeof ApiRequest !== "function") return;
        try {
            await ApiRequest("/api/think/heartbeat", { method: "POST", timeoutMs: 8000 });
        } catch {
            // A missed lease pulse must not interrupt the developer workspace.
        }
    }

    Load();
    KeepThinkRoomAlive();
    window.setInterval(() => {
        if (document.visibilityState !== "visible") return;
        Load();
        KeepThinkRoomAlive();
    }, 20000);
})();
