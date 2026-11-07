(() => {
    "use strict";

    const Root = document.getElementById("ThinkApp");
    const Form = document.getElementById("SafetyBotChatForm");
    const Input = document.getElementById("SafetyBotChatInput");
    const Send = document.getElementById("SafetyBotChatSend");
    const NewChat = document.getElementById("SafetyBotChatNew");
    const Messages = document.getElementById("SafetyBotChatMessages");
    const Status = document.getElementById("SafetyBotChatStatus");
    if (!Root || !Form || !Input || !Send || !NewChat || !Messages || !Status || Form.dataset.initialized === "1") return;
    Form.dataset.initialized = "1";

    const History = [];
    const MaxHistory = 12;
    let Busy = false;

    function SetStatus(Message, State = "") {
        Status.textContent = String(Message || "");
        Status.classList.toggle("Good", State === "good");
        Status.classList.toggle("Bad", State === "bad");
    }

    function ScrollToLatest() {
        Messages.scrollTop = Messages.scrollHeight;
    }

    function AddMessage(Kind, Message, Reply = null) {
        const Row = document.createElement("article");
        Row.className = "ThinkSafetyChatMessage " + (Kind === "user" ? "User" : "Bot");

        const Header = document.createElement("div");
        Header.className = "ThinkSafetyChatMessageHead";
        const Name = document.createElement("strong");
        Name.textContent = Kind === "user" ? "You" : "SafetyBot";
        Header.appendChild(Name);
        if (Kind !== "user") {
            const Label = document.createElement("span");
            Label.className = "ThinkSafetyChatPrivate";
            Label.textContent = "Rule check";
            Header.appendChild(Label);
        }

        const Paragraph = document.createElement("p");
        Paragraph.textContent = String(Message || "");
        Row.append(Header, Paragraph);

        const Findings = Array.isArray(Reply?.findings) ? Reply.findings : [];
        if (Findings.length) {
            const List = document.createElement("ul");
            List.className = "ThinkSafetyChatFindings";
            for (const Finding of Findings) {
                const Item = document.createElement("li");
                const Rule = document.createElement("strong");
                Rule.textContent = String(Finding?.rule || "Rule to review");
                const Detail = document.createElement("span");
                Detail.textContent = String(Finding?.detail || "");
                Item.append(Rule, Detail);
                List.appendChild(Item);
            }
            Row.appendChild(List);
        }

        if (Reply?.note) {
            const Note = document.createElement("p");
            Note.className = "ThinkSafetyChatNote";
            Note.textContent = String(Reply.note);
            Row.appendChild(Note);
        }
        Messages.appendChild(Row);
        ScrollToLatest();
        return Row;
    }

    function AddTyping() {
        const Row = document.createElement("div");
        Row.className = "ThinkSafetyChatTyping";
        Row.id = "SafetyBotChatTyping";
        Row.textContent = "SafetyBot is checking the rule context…";
        Messages.appendChild(Row);
        ScrollToLatest();
    }

    function RemoveTyping() {
        document.getElementById("SafetyBotChatTyping")?.remove();
    }

    function SetBusy(Value) {
        Busy = Boolean(Value);
        Input.disabled = Busy;
        Send.disabled = Busy;
        NewChat.disabled = Busy;
        Form.classList.toggle("IsBusy", Busy);
        Send.textContent = Busy ? "Checking…" : "Send to SafetyBot";
    }

    function ResetConversation() {
        if (Busy) return;
        History.length = 0;
        Messages.replaceChildren();
        AddMessage("bot", "Hi. I’m SafetyBot. Ask me about a Story Rewrite rule or paste the exact message you want checked. Include enough context to distinguish a real threat from fictional story dialogue. Do not send passwords, tokens, or private personal information.");
        Input.value = "";
        SetStatus("Only the text you submit is checked. SafetyBot does not monitor players or file reports.");
        Input.focus({ preventScroll: true });
    }

    async function SubmitQuestion(Event) {
        Event?.preventDefault();
        if (Busy) return;
        const Question = String(Input.value || "").trim().slice(0, 1200);
        if (!Question) {
            SetStatus("Write a rule question or describe the message you want checked.", "bad");
            Input.focus({ preventScroll: true });
            return;
        }
        if (typeof ApiRequest !== "function") {
            SetStatus("The existing authenticated chat connection is unavailable on this page.", "bad");
            return;
        }

        AddMessage("user", Question);
        AddTyping();
        SetBusy(true);
        SetStatus("Checking the community rules…");
        try {
            const Context = History.slice(-4).map(Entry => Entry.question);
            const Result = await ApiRequest("/api/safetybot/chat", {
                method: "POST",
                timeoutMs: 30000,
                body: JSON.stringify({ question: Question, context: Context })
            });
            RemoveTyping();
            AddMessage("bot", String(Result?.answer || "I could not complete that rules check."), Result);
            History.push({ question: Question, answer: String(Result?.answer || "") });
            if (History.length > MaxHistory) History.splice(0, History.length - MaxHistory);
            Input.value = "";
            SetStatus("Ready. Ask a follow-up or start a new chat.", "good");
        } catch (Error) {
            RemoveTyping();
            AddMessage("bot", "I couldn’t reach the SafetyBot checker: " + String(Error?.message || "Request failed") + " You can retry your question.");
            SetStatus("The check failed. Your text is still in the input so you can retry.", "bad");
        } finally {
            SetBusy(false);
            if (!Input.value) Input.focus({ preventScroll: true });
        }
    }

    Form.addEventListener("submit", SubmitQuestion);
    Input.addEventListener("keydown", Event => {
        if ((Event.ctrlKey || Event.metaKey) && Event.key === "Enter") {
            Event.preventDefault();
            void SubmitQuestion(Event);
        }
    });
    NewChat.addEventListener("click", ResetConversation);
    ResetConversation();
})();