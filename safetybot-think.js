(() => {
    "use strict";

    const Root = document.getElementById("ThinkApp");
    const Form = document.getElementById("SafetyBotChatForm");
    const Input = document.getElementById("SafetyBotChatInput");
    const Send = document.getElementById("SafetyBotChatSend");
    const NewChat = document.getElementById("SafetyBotChatNew");
    const Messages = document.getElementById("SafetyBotChatMessages");
    const Status = document.getElementById("SafetyBotChatStatus");
    const AttachButton = document.getElementById("SafetyBotChatAttach");
    const FileInput = document.getElementById("SafetyBotChatFileInput");
    const AttachmentList = document.getElementById("SafetyBotChatAttachmentList");
    const LookupInput = document.getElementById("SafetyBotLookupUsername");
    const LookupButton = document.getElementById("SafetyBotChatLookup");
    if (!Root || !Form || !Input || !Send || !NewChat || !Messages || !Status || Form.dataset.initialized === "1") return;
    Form.dataset.initialized = "1";

    const History = [];
    const MaxHistory = 12;
    const MaxAttachments = 2;
    const MaxAttachmentBytes = 900 * 1024;
    let Busy = false;
    let PendingAttachments = [];
    let PendingLookupUsername = "";

    function SetStatus(Message, State = "") {
        Status.textContent = String(Message || "");
        Status.classList.toggle("Good", State === "good");
        Status.classList.toggle("Bad", State === "bad");
    }

    function ScrollToLatest() {
        Messages.scrollTop = Messages.scrollHeight;
    }

    function AppendInline(Parent, RawText) {
        const Text = String(RawText || "");
        const Pattern = /\[font=(sans|serif|mono)\]([\s\S]*?)\[\/font\]|\*\*([^*]+)\*\*|~~([^~]+)~~|`([^`]+)`|\*([^*\n]+)\*/g;
        let Offset = 0;
        let Match;
        while ((Match = Pattern.exec(Text))) {
            if (Match.index > Offset) Parent.appendChild(document.createTextNode(Text.slice(Offset, Match.index)));
            let Node;
            if (Match[1]) {
                Node = document.createElement("span");
                Node.className = "ThinkSafetyChatFont" + Match[1][0].toUpperCase() + Match[1].slice(1);
                Node.textContent = Match[2];
            } else if (Match[3]) {
                Node = document.createElement("strong");
                Node.textContent = Match[3];
            } else if (Match[4]) {
                Node = document.createElement("s");
                Node.textContent = Match[4];
            } else if (Match[5]) {
                Node = document.createElement("code");
                Node.textContent = Match[5];
            } else {
                Node = document.createElement("em");
                Node.textContent = Match[6];
            }
            Parent.appendChild(Node);
            Offset = Pattern.lastIndex;
        }
        if (Offset < Text.length) Parent.appendChild(document.createTextNode(Text.slice(Offset)));
    }

    function RenderFormattedText(Parent, Message) {
        const Lines = String(Message || "").replace(/\r\n?/g, "\n").split("\n");
        let CodeLines = [];
        let InCode = false;
        let ListNode = null;
        let ListType = "";
        const CloseList = () => { ListNode = null; ListType = ""; };
        for (const Line of Lines) {
            if (Line.trim().startsWith("```")) {
                CloseList();
                if (InCode) {
                    const Pre = document.createElement("pre");
                    const Code = document.createElement("code");
                    Code.textContent = CodeLines.join("\n");
                    Pre.appendChild(Code);
                    Parent.appendChild(Pre);
                    CodeLines = [];
                    InCode = false;
                } else {
                    InCode = true;
                }
                continue;
            }
            if (InCode) {
                CodeLines.push(Line);
                continue;
            }
            if (!Line.trim()) {
                CloseList();
                continue;
            }
            const Heading = Line.match(/^(#{1,3})\s+(.+)$/);
            if (Heading) {
                CloseList();
                const Element = document.createElement("h" + Heading[1].length);
                AppendInline(Element, Heading[2]);
                Parent.appendChild(Element);
                continue;
            }
            const Bullet = Line.match(/^\s*[-*]\s+(.+)$/);
            const Numbered = Line.match(/^\s*\d+[.)]\s+(.+)$/);
            if (Bullet || Numbered) {
                const Type = Bullet ? "ul" : "ol";
                if (!ListNode || ListType !== Type) {
                    CloseList();
                    ListNode = document.createElement(Type);
                    ListType = Type;
                    Parent.appendChild(ListNode);
                }
                const Item = document.createElement("li");
                AppendInline(Item, (Bullet || Numbered)[1]);
                ListNode.appendChild(Item);
                continue;
            }
            const Quote = Line.match(/^>\s?(.*)$/);
            if (Quote) {
                CloseList();
                const Block = document.createElement("blockquote");
                AppendInline(Block, Quote[1]);
                Parent.appendChild(Block);
                continue;
            }
            CloseList();
            const Paragraph = document.createElement("p");
            AppendInline(Paragraph, Line);
            Parent.appendChild(Paragraph);
        }
        if (InCode) {
            const Pre = document.createElement("pre");
            const Code = document.createElement("code");
            Code.textContent = CodeLines.join("\n");
            Pre.appendChild(Code);
            Parent.appendChild(Pre);
        }
    }

    function AddMessage(Kind, Message, Reply = null, Images = []) {
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
            Label.textContent = "Private chat";
            Header.appendChild(Label);
        }
        Row.appendChild(Header);

        const Body = document.createElement("div");
        Body.className = "ThinkSafetyChatBody";
        RenderFormattedText(Body, Message);
        Row.appendChild(Body);

        if (Images.length) {
            const ImageWrap = document.createElement("div");
            ImageWrap.className = "ThinkSafetyChatMessageImages";
            for (const Image of Images) {
                const Preview = document.createElement("img");
                Preview.src = Image.dataUrl;
                Preview.alt = Image.name || "Attached image";
                ImageWrap.appendChild(Preview);
            }
            Row.appendChild(ImageWrap);
        }

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
        Row.textContent = "SafetyBot is thinking…";
        Messages.appendChild(Row);
        ScrollToLatest();
    }

    function RemoveTyping() {
        document.getElementById("SafetyBotChatTyping")?.remove();
    }

    function RenderPendingAttachments() {
        if (!AttachmentList) return;
        AttachmentList.replaceChildren();
        PendingAttachments.forEach((Attachment, Index) => {
            const Item = document.createElement("div");
            Item.className = "ThinkSafetyAttachmentPreview";
            const Image = document.createElement("img");
            Image.src = Attachment.dataUrl;
            Image.alt = Attachment.name;
            const Name = document.createElement("span");
            Name.textContent = Attachment.name;
            const Remove = document.createElement("button");
            Remove.type = "button";
            Remove.textContent = "×";
            Remove.setAttribute("aria-label", "Remove " + Attachment.name);
            Remove.disabled = Busy;
            Remove.addEventListener("click", () => {
                PendingAttachments.splice(Index, 1);
                RenderPendingAttachments();
            });
            Item.append(Image, Name, Remove);
            AttachmentList.appendChild(Item);
        });
    }

    function SetBusy(Value) {
        Busy = Boolean(Value);
        Input.disabled = Busy;
        Send.disabled = Busy;
        NewChat.disabled = Busy;
        if (AttachButton) AttachButton.disabled = Busy;
        if (FileInput) FileInput.disabled = Busy;
        if (LookupInput) LookupInput.disabled = Busy;
        if (LookupButton) LookupButton.disabled = Busy;
        Form.classList.toggle("IsBusy", Busy);
        Send.textContent = Busy ? "Thinking…" : "Send to SafetyBot";
        RenderPendingAttachments();
    }

    function ResetConversation() {
        if (Busy) return;
        History.length = 0;
        Messages.replaceChildren();
        PendingAttachments = [];
        PendingLookupUsername = "";
        if (LookupInput) LookupInput.value = "";
        if (FileInput) FileInput.value = "";
        RenderPendingAttachments();
        AddMessage("bot", "Hey! What would you like to look into today?");
        Input.value = "";
        SetStatus("Private conversation · History lookups are read-only and audited · Enter sends · Shift+Enter adds a new line.");
        Input.focus({ preventScroll: true });
    }

    function ReadFileAsDataUrl(File) {
        return new Promise((Resolve, Reject) => {
            const Reader = new FileReader();
            Reader.onload = () => Resolve(String(Reader.result || ""));
            Reader.onerror = () => Reject(new Error("Could not read " + File.name + "."));
            Reader.readAsDataURL(File);
        });
    }

    async function CompressImage(File) {
        if (!File.type.startsWith("image/")) throw new Error("Choose an image file.");
        if (typeof createImageBitmap !== "function") throw new Error("This browser cannot prepare image attachments.");
        const Bitmap = await createImageBitmap(File);
        try {
            const MaxEdge = 1440;
            const Scale = Math.min(1, MaxEdge / Math.max(Bitmap.width, Bitmap.height));
            const Canvas = document.createElement("canvas");
            Canvas.width = Math.max(1, Math.round(Bitmap.width * Scale));
            Canvas.height = Math.max(1, Math.round(Bitmap.height * Scale));
            const Context = Canvas.getContext("2d");
            if (!Context) throw new Error("Could not prepare the image.");
            Context.fillStyle = "#ffffff";
            Context.fillRect(0, 0, Canvas.width, Canvas.height);
            Context.drawImage(Bitmap, 0, 0, Canvas.width, Canvas.height);
            let BlobValue = await new Promise(Resolve => Canvas.toBlob(Resolve, "image/jpeg", .82));
            if (!BlobValue) throw new Error("Could not compress the image.");
            if (BlobValue.size > MaxAttachmentBytes) {
                BlobValue = await new Promise(Resolve => Canvas.toBlob(Resolve, "image/jpeg", .66));
            }
            if (!BlobValue || BlobValue.size > MaxAttachmentBytes) {
                throw new Error("That image is too large. Try a smaller image.");
            }
            const DataUrl = await ReadFileAsDataUrl(BlobValue);
            return {
                name: String(File.name || "image.jpg").slice(0, 80),
                mimeType: "image/jpeg",
                dataUrl: DataUrl,
                base64: DataUrl.split(",")[1] || ""
            };
        } finally {
            Bitmap.close?.();
        }
    }

    async function HandleFiles() {
        const Files = Array.from(FileInput?.files || []);
        if (!Files.length) return;
        if (PendingAttachments.length + Files.length > MaxAttachments) {
            SetStatus("Attach up to two images per message.", "bad");
            if (FileInput) FileInput.value = "";
            return;
        }
        SetBusy(true);
        SetStatus("Preparing image attachments…");
        try {
            const Prepared = await Promise.all(Files.map(CompressImage));
            PendingAttachments.push(...Prepared);
            RenderPendingAttachments();
            SetStatus("Images ready to send with your next message.");
        } catch (Error) {
            SetStatus(Error.message || "Could not prepare that image.", "bad");
        } finally {
            if (FileInput) FileInput.value = "";
            SetBusy(false);
            Input.focus({ preventScroll: true });
        }
    }

    async function SendQuestion(QuestionValue, LookupUsername = "") {
        if (Busy) return;
        const Question = String(QuestionValue || "").trim().slice(0, 1200);
        if (!Question) {
            SetStatus("Write a message before sending.", "bad");
            Input.focus({ preventScroll: true });
            return;
        }
        if (typeof ApiRequest !== "function") {
            SetStatus("The existing authenticated chat connection is unavailable on this page.", "bad");
            return;
        }

        const OutgoingAttachments = PendingAttachments.slice(0, MaxAttachments);
        const AttachmentPreviews = OutgoingAttachments.map(Item => ({ name: Item.name, dataUrl: Item.dataUrl }));
        const AttachmentPayload = OutgoingAttachments.map(Item => ({
            name: Item.name,
            mimeType: Item.mimeType,
            base64: Item.base64
        }));
        AddMessage("user", Question, null, AttachmentPreviews);
        AddTyping();
        SetBusy(true);
        SetStatus(LookupUsername ? "Reviewing the stored moderation history…" : "SafetyBot is thinking…");
        try {
            const Result = await ApiRequest("/api/safetybot/chat", {
                method: "POST",
                timeoutMs: 80000,
                body: JSON.stringify({
                    question: Question,
                    messages: History.slice(-12),
                    lookupUsername: LookupUsername || undefined,
                    attachments: AttachmentPayload
                })
            });
            RemoveTyping();
            const Answer = String(Result?.answer || "I couldn't put together a reply just now.");
            AddMessage("bot", Answer, Result);
            History.push({ role: "user", text: Question }, { role: "assistant", text: Answer });
            if (History.length > MaxHistory) History.splice(0, History.length - MaxHistory);
            PendingAttachments = [];
            RenderPendingAttachments();
            Input.value = "";
            SetStatus("Ready. Keep chatting or start a new conversation.", "good");
        } catch (Error) {
            RemoveTyping();
            AddMessage("bot", Error.message || "I couldn't reach the conversation service just now.");
            SetStatus(Error.message || "The reply failed. Your message is still here so you can retry.", "bad");
        } finally {
            SetBusy(false);
            if (!Input.value) Input.focus({ preventScroll: true });
        }
    }

    async function SubmitQuestion(Event) {
        Event?.preventDefault();
        await SendQuestion(Input.value);
    }

    Form.addEventListener("submit", SubmitQuestion);
    Input.addEventListener("keydown", Event => {
        if (Event.key === "Enter" && !Event.shiftKey) {
            Event.preventDefault();
            void SubmitQuestion(Event);
        }
    });
    NewChat.addEventListener("click", ResetConversation);
    AttachButton?.addEventListener("click", () => FileInput?.click());
    FileInput?.addEventListener("change", () => { void HandleFiles(); });
    LookupButton?.addEventListener("click", () => {
        const Username = String(LookupInput?.value || "").trim();
        if (!/^[A-Za-z0-9_]{3,20}$/.test(Username)) {
            SetStatus("Enter a valid player username (3–20 letters, numbers, or underscores).", "bad");
            LookupInput?.focus({ preventScroll: true });
            return;
        }
        PendingLookupUsername = Username;
        void SendQuestion(
            "Please review the stored moderation history for @" + Username + ". Summarize recorded cases and actions, clearly separating confirmed findings from reports or open cases, and say whether any account restriction is currently active.",
            Username
        ).finally(() => { PendingLookupUsername = ""; });
    });
    ResetConversation();
})();