// ==UserScript==
// @name         Story Rewrite Gemini Session Bridge
// @namespace    https://story-rewrite-iota.vercel.app/
// @version      1.0.0
// @description  Bridges Story Rewrite StoryBot prompts to the signed-in Gemini web session in another tab.
// @match        https://gemini.google.com/*
// @match        https://story-rewrite-iota.vercel.app/*
// @match        https://spongebobtdgameplay-prog.github.io/Story-Rewrite/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @run-at       document-start
// ==/UserScript==

(() => {
    "use strict";
    const Channel = "story-rewrite-gemini-session-bridge-v1";
    const PageSource = "StoryRewriteApp";
    const BridgeSource = "StoryRewriteGeminiBridge";
    const QueueKey = "srGeminiBridgeQueueV1";
    const ResultsKey = "srGeminiBridgeResultsV1";
    const LockKey = "srGeminiBridgeLockV1";
    const IsGeminiPage = location.hostname === "gemini.google.com";
    const RunnerId = "runner-" + Math.random().toString(36).slice(2, 12);
    const ActivePageRequests = new Set();
    const PageRequestTimers = new Map();
    let IsProcessingQueue = false;
    let LocalLockId = null;

    function PostToPage(Message) {
        window.postMessage({ ...Message, source: BridgeSource, channel: Channel }, location.origin);
    }
    function NormalizeQueue(Value) {
        return Array.isArray(Value)
            ? Value.filter(Item => Item && typeof Item.id === "string" && typeof Item.prompt === "string").slice(-25)
            : [];
    }
    function NormalizeResults(Value) {
        return Value && typeof Value === "object" && !Array.isArray(Value) ? Value : {};
    }
    async function AddRequestToQueue(Request) {
        const Queue = NormalizeQueue(await GM_getValue(QueueKey, []));
        if (!Queue.some(Item => Item.id === Request.id)) {
            Queue.push({ id: Request.id, prompt: Request.prompt.slice(0, 9000), createdAt: Date.now() });
            await GM_setValue(QueueKey, Queue.slice(-25));
        }
    }
    async function StoreResult(RequestId, Answer = "", ErrorText = "") {
        const Results = NormalizeResults(await GM_getValue(ResultsKey, {}));
        Results[RequestId] = {
            answer: String(Answer || "").slice(0, 700),
            error: String(ErrorText || "").slice(0, 300),
            createdAt: Date.now()
        };
        const Entries = Object.entries(Results).sort((A, B) => Number(A[1]?.createdAt || 0) - Number(B[1]?.createdAt || 0));
        while (Entries.length > 40) delete Results[Entries.shift()[0]];
        await GM_setValue(ResultsKey, Results);
    }
    async function ReadGeminiSessionConfig() {
        const Deadline = Date.now() + 30000;
        while (Date.now() < Deadline) {
            const HtmlContent = document.documentElement?.innerHTML || "";
            let AuthorizationToken = "";
            let BuildLabel = "";
            const PageData = window.WIZ_global_data || {};
            if (typeof PageData.SNlM0e === "string") AuthorizationToken = PageData.SNlM0e;
            if (typeof PageData.cfb2h === "string") BuildLabel = PageData.cfb2h;
            if (!AuthorizationToken) {
                const TokenMatch = HtmlContent.match(/"SNlM0e"\s*:\s*"([^"]+)"/);
                if (TokenMatch) AuthorizationToken = TokenMatch[1];
            }
            if (!BuildLabel) {
                const PageBuildMatch = HtmlContent.match(/"cfb2h"\s*:\s*"([^"]+)"/);
                if (PageBuildMatch) BuildLabel = PageBuildMatch[1];
            }
            for (const Resource of performance.getEntriesByType("resource")) {
                try {
                    const ResourceUrl = new URL(Resource.name);
                    if (!ResourceUrl.hostname.endsWith("google.com")) continue;
                    const ResourceBuild = ResourceUrl.searchParams.get("bl");
                    if (ResourceBuild) { BuildLabel = ResourceBuild; break; }
                } catch {}
            }
            if (!BuildLabel) {
                const BuildMatch = HtmlContent.match(/(boq_gemini-web-uiserver_[^"']+)/);
                if (BuildMatch) BuildLabel = BuildMatch[1];
            }
            if (AuthorizationToken && BuildLabel) return { AuthorizationToken, BuildLabel };
            await new Promise(Resolve => setTimeout(Resolve, 500));
        }
        throw new Error("Gemini session values were not found. Reload Gemini while signed in, then retry.");
    }
    async function AskGeminiWebSession(PromptText) {
        if (!IsGeminiPage) throw new Error("A Gemini tab is required for the web-session request.");
        const Prompt = String(PromptText || "").trim();
        if (!Prompt) throw new TypeError("The Gemini prompt is empty.");
        const { AuthorizationToken, BuildLabel } = await ReadGeminiSessionConfig();
        const AccountPrefix = location.pathname.match(/^\/u\/\d+/)?.[0] || "";
        const DispatchUrl = new URL(location.origin + AccountPrefix + "/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate");
        DispatchUrl.searchParams.set("bl", BuildLabel);
        DispatchUrl.searchParams.set("hl", "en");
        DispatchUrl.searchParams.set("_reqid", String(Date.now() % 1000000));
        DispatchUrl.searchParams.set("rt", "c");
        const RequestData = Array(80).fill(null);
        RequestData[0] = [Prompt, 0, null, null, null, null, 0];
        RequestData[1] = ["en"];
        RequestData[2] = ["", "", "", null, null, null, null, null, null, ""];
        RequestData[6] = [0];
        RequestData[7] = 1;
        RequestData[10] = 1;
        RequestData[11] = 0;
        RequestData[17] = [[4]];
        RequestData[18] = 0;
        RequestData[27] = 1;
        RequestData[30] = [4];
        RequestData[41] = [2];
        RequestData[45] = 1;
        RequestData[53] = 0;
        RequestData[59] = crypto.randomUUID();
        RequestData[61] = [];
        RequestData[68] = 1;
        RequestData[79] = 1;
        const BodyParameters = new URLSearchParams();
        BodyParameters.set("f.req", JSON.stringify([null, JSON.stringify(RequestData)]));
        BodyParameters.set("at", AuthorizationToken);
        const ModelHeader = '[1,null,null,null,"9ec249fc9ad08861",null,null,0,[4]]';
        const Controller = new AbortController();
        const Timeout = setTimeout(() => Controller.abort(), 60000);
        let ResponseObject;
        let ResponseText;
        try {
            ResponseObject = await fetch(DispatchUrl.toString(), {
                method: "POST",
                credentials: "include",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                    "X-Same-Domain": "1",
                    "x-goog-ext-525001261-jspb": ModelHeader
                },
                body: BodyParameters.toString(),
                signal: Controller.signal
            });
            ResponseText = await ResponseObject.text();
        } catch (Error) {
            if (Controller.signal.aborted) throw new Error("Gemini web-session request timed out.");
            throw Error;
        } finally {
            clearTimeout(Timeout);
        }
        if (!ResponseObject.ok) {
            console.error("[Story Rewrite Gemini Bridge] HTTP error response:", ResponseText.slice(0, 1200));
            throw new Error("Gemini web-session request rejected (HTTP " + ResponseObject.status + ").");
        }
        const CleanedText = ResponseText.replace(/^\)\]\}'\s*/, "");
        const ResponseLines = CleanedText.split(/\r?\n/).map(Line => Line.trim()).filter(Boolean);
        let Answer = "";
        for (const Line of ResponseLines) {
            if (!Line.includes('"wrb.fr"')) continue;
            const Start = Line.indexOf('[["wrb.fr"');
            if (Start < 0) continue;
            try {
                const Frame = JSON.parse(Line.slice(Start));
                const InnerText = Frame?.[0]?.[2];
                if (typeof InnerText !== "string") continue;
                const Inner = JSON.parse(InnerText);
                const Candidates = Inner?.[4];
                if (!Array.isArray(Candidates)) continue;
                for (const Candidate of Candidates) {
                    const CandidateText = Candidate?.[1]?.[0];
                    if (typeof CandidateText === "string" && CandidateText.trim()) {
                        Answer = CandidateText;
                    }
                }
                if (Answer) return Answer.trim().slice(0, 700);
            } catch {}
        }
        console.error("[Story Rewrite Gemini Bridge] No answer found:", ResponseText.slice(0, 1500));
        throw new Error("Gemini returned no extractable answer. The private web response format may have changed.");
    }
    async function AcquireLock() {
        const CurrentLock = await GM_getValue(LockKey, null);
        if (CurrentLock && CurrentLock.owner !== RunnerId && Number(CurrentLock.expiresAt) > Date.now()) return false;
        await GM_setValue(LockKey, { owner: RunnerId, expiresAt: Date.now() + 90000 });
        const VerifyLock = await GM_getValue(LockKey, null);
        if (VerifyLock?.owner !== RunnerId) return false;
        LocalLockId = RunnerId;
        return true;
    }
    async function ReleaseLock() {
        const Lock = await GM_getValue(LockKey, null);
        if (LocalLockId && Lock?.owner === LocalLockId) await GM_setValue(LockKey, null);
        LocalLockId = null;
    }
    async function ProcessRequestQueue() {
        if (!IsGeminiPage || IsProcessingQueue || document.visibilityState === "prerender") return;
        IsProcessingQueue = true;
        try {
            while (true) {
                const Queue = NormalizeQueue(await GM_getValue(QueueKey, []));
                const Request = Queue[0];
                if (!Request) break;
                if (Date.now() - Number(Request.createdAt || 0) > 180000) {
                    await StoreResult(Request.id, "", "The Gemini request expired in the bridge queue. Send it again.");
                    await GM_setValue(QueueKey, Queue.filter(Item => Item.id !== Request.id));
                    continue;
                }
                if (!(await AcquireLock())) {
                    setTimeout(() => { void ProcessRequestQueue(); }, 1500);
                    break;
                }
                try {
                    const Answer = await AskGeminiWebSession(Request.prompt);
                    await StoreResult(Request.id, Answer, "");
                } catch (Error) {
                    await StoreResult(Request.id, "", String(Error?.message || Error));
                } finally {
                    const UpdatedQueue = NormalizeQueue(await GM_getValue(QueueKey, []));
                    await GM_setValue(QueueKey, UpdatedQueue.filter(Item => Item.id !== Request.id));
                    await ReleaseLock();
                }
            }
        } finally { IsProcessingQueue = false; }
    }

    if (IsGeminiPage) {
        GM_addValueChangeListener(QueueKey, () => { void ProcessRequestQueue(); });
        window.addEventListener("focus", () => { void ProcessRequestQueue(); });
        setTimeout(() => { void ProcessRequestQueue(); }, 800);
    } else {
        window.addEventListener("message", async Event => {
            if (Event.source !== window || Event.origin !== location.origin) return;
            const Message = Event.data;
            if (Message?.source !== PageSource || Message.channel !== Channel) return;
            if (Message.type === "hello") { PostToPage({ type: "ready" }); return; }
            if (Message.type !== "request") return;
            const RequestId = String(Message.requestId || "");
            const Prompt = String(Message.prompt || "").trim().slice(0, 1200);
            if (!RequestId || !Prompt) return;
            ActivePageRequests.add(RequestId);
            if (PageRequestTimers.has(RequestId)) clearTimeout(PageRequestTimers.get(RequestId));
            PageRequestTimers.set(RequestId, setTimeout(() => {
                if (!ActivePageRequests.has(RequestId)) return;
                ActivePageRequests.delete(RequestId);
                PageRequestTimers.delete(RequestId);
                PostToPage({ type: "result", requestId: RequestId, answer: "", error: "No result came back from Gemini. Keep one signed-in Gemini tab open and try again." });
            }, 100000));
            await AddRequestToQueue({ id: RequestId, prompt: Prompt });
            const Results = NormalizeResults(await GM_getValue(ResultsKey, {}));
            if (Results[RequestId]) {
                ActivePageRequests.delete(RequestId);
                clearTimeout(PageRequestTimers.get(RequestId));
                PageRequestTimers.delete(RequestId);
                PostToPage({ type: "result", requestId: RequestId, ...Results[RequestId] });
            }
        });
        GM_addValueChangeListener(ResultsKey, (_Name, _OldValue, NewValue) => {
            const Results = NormalizeResults(NewValue);
            for (const RequestId of [...ActivePageRequests]) {
                const Result = Results[RequestId];
                if (!Result) continue;
                ActivePageRequests.delete(RequestId);
                const Timer = PageRequestTimers.get(RequestId);
                if (Timer) clearTimeout(Timer);
                PageRequestTimers.delete(RequestId);
                PostToPage({ type: "result", requestId: RequestId, ...Result });
            }
        });
    }
})();
