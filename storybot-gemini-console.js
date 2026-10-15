// Story Rewrite StoryBot — Gemini website-session console helper.
// Paste this whole file into DevTools Console on a Gemini tab opened by Story Rewrite.
// No Developer API key is used. This reads the signed-in page token only in this tab.
(() => {
  "use strict";

  const CHANNEL = "story-rewrite-gemini-console-v1";
  const APP_SOURCE = "StoryRewriteApp";
  const GEMINI_SOURCE = "StoryRewriteGeminiConsole";
  const ALLOWED_APP_ORIGINS = new Set([
    "https://story-rewrite-iota.vercel.app",
    "https://spongebobtdgameplay-prog.github.io"
  ]);

  if (location.hostname !== "gemini.google.com") {
    console.error("[StoryBot Gemini] Open Gemini first, then paste this helper in Gemini's DevTools Console.");
    return;
  }

  function ShowStoryBotSessionLabel(Text, State) {
    let Label = document.getElementById("StoryRewriteGeminiConsoleLabel");
    if (!Label) {
      Label = document.createElement("div");
      Label.id = "StoryRewriteGeminiConsoleLabel";
      Object.assign(Label.style, {
        position: "fixed",
        right: "12px",
        bottom: "12px",
        zIndex: "2147483647",
        maxWidth: "min(380px, calc(100vw - 24px))",
        padding: "9px 12px",
        border: "2px solid #17120e",
        borderRadius: "9px",
        background: "#2d2118",
        color: "#ffe2b5",
        boxShadow: "0 5px 22px rgba(0,0,0,.35)",
        font: "700 12px/1.4 system-ui, sans-serif"
      });
      document.documentElement.appendChild(Label);
    }
    Label.textContent = Text;
    Label.dataset.state = State || "ready";
    Label.style.borderColor = State === "connected" ? "#54b96a" : State === "error" ? "#df655d" : "#17120e";
  }

  function ReadGeminiSessionConfig() {
    const Html = document.documentElement?.innerHTML || "";
    const PageData = window.WIZ_global_data || {};

    const ReadPageValue = Key => {
      const Direct = PageData[Key];
      if (typeof Direct === "string" && Direct.trim()) return Direct.trim();
      if ((typeof Direct === "number") && Number.isFinite(Direct)) return String(Direct);
      return Html.match(new RegExp('"' + Key + '"\\s*:\\s*"([^"]+)"'))?.[1] || "";
    };

    const AuthorizationToken = ReadPageValue("SNlM0e");
    let BuildLabel = ReadPageValue("cfb2h");
    const FrontEndSessionId = ReadPageValue("FdrFJe");
    const Locale = Html.match(/<html[^>]*\blang=["']([^"']+)/i)?.[1]
      || document.documentElement?.lang
      || "en-US";

    if (!BuildLabel) {
      const ResourceUrls = performance.getEntriesByType("resource").map(Entry => {
        try { return new URL(Entry.name); } catch { return null; }
      }).filter(Boolean);
      BuildLabel = ResourceUrls.map(Url => Url.searchParams.get("bl")).find(Boolean) || "";
    }
    if (!BuildLabel) {
      BuildLabel = Html.match(/boq_assistant-bard-web-server_[A-Za-z0-9._-]+/)?.[0] || "";
    }

    if (!AuthorizationToken || !BuildLabel || !FrontEndSessionId) {
      throw new Error(
        "Gemini session values are incomplete. Refresh Gemini while signed in, then paste the latest helper again."
      );
    }
    return { AuthorizationToken, BuildLabel, FrontEndSessionId, Locale };
  }

  async function AskAI(PromptText) {
    const Prompt = String(PromptText || "").trim().slice(0, 9000);
    if (!Prompt) throw new TypeError("AskAI needs a non-empty prompt.");

    const {
      AuthorizationToken,
      BuildLabel,
      FrontEndSessionId,
      Locale
    } = ReadGeminiSessionConfig();

    const AccountIndex = location.pathname.match(/^\/u\/(\d+)/)?.[1] || "0";
    const AccountPrefix = AccountIndex !== "0" ? "/u/" + AccountIndex : "";
    const Endpoint = location.origin + AccountPrefix +
      "/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate";

    const RequestId = crypto.randomUUID();
    const Query = new URLSearchParams({
      bl: BuildLabel,
      "f.sid": FrontEndSessionId,
      hl: Locale,
      _reqid: String(100000 + Math.floor(Math.random() * 900000)),
      rt: "c"
    });

    // Current Gemini Web sends this model/mode metadata in headers. An old
    // 80-slot body without these headers can be rejected with HTTP 400.
    const ModelHeader = [];
    ModelHeader[0] = 1;
    ModelHeader[4] = "56fdd199312815e2"; // Gemini 3.8 Flash
    ModelHeader[7] = 0; // Temporary chat disabled.
    ModelHeader[8] = [4, 5, 6, 8, 4, 5, 6, 8];
    ModelHeader[11] = 2; // Legacy mode retained by the current web client.
    ModelHeader[14] = 1; // Native mode.
    ModelHeader[15] = 1; // Standard thinking level.
    ModelHeader[16] = RequestId;

    // Current text-only request shape: [null, JSON.stringify([message, null, emptyContextIds]).
    // FdrFJe is the f.sid session value; it is not the rpcids operation name.
    const MessageStruct = [Prompt];
    const RequestPayload = [MessageStruct, null, ["", "", ""]];
    const Body = new URLSearchParams({
      at: AuthorizationToken,
      "f.req": JSON.stringify([null, JSON.stringify(RequestPayload)])
    });

    const Headers = {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      "X-Same-Domain": "1",
      "x-goog-ext-525001261-jspb": JSON.stringify(ModelHeader),
      "x-goog-ext-525005358-jspb": JSON.stringify([RequestId, 1]),
      "x-goog-ext-73010989-jspb": "[0]",
      "x-goog-ext-73010990-jspb": "[0,0,0]"
    };
    if (AccountIndex !== "0") Headers["X-Goog-AuthUser"] = AccountIndex;

    const Controller = new AbortController();
    const Timeout = setTimeout(() => Controller.abort(), 60000);
    let Response;
    let ResponseText = "";
    try {
      Response = await fetch(Endpoint + "?" + Query.toString(), {
        method: "POST",
        credentials: "include",
        headers: Headers,
        body: Body.toString(),
        signal: Controller.signal
      });
      ResponseText = await Response.text();
    } catch (Error) {
      if (Controller.signal.aborted) throw new Error("Gemini web-session request timed out.");
      throw Error;
    } finally {
      clearTimeout(Timeout);
    }

    if (!Response.ok) {
      console.error(
        "[StoryBot Gemini] HTTP " + Response.status + " response preview:",
        ResponseText.slice(0, 1200)
      );
      throw new Error(
        "Gemini web-session request rejected (HTTP " + Response.status +
        "). Refresh the signed-in Gemini page and reconnect; Google may have changed the private request format."
      );
    }

    const Lines = ResponseText.replace(/^\)\]\}'\s*/, "")
      .split(/\r?\n/).map(Line => Line.trim()).filter(Boolean);
    let Answer = "";
    for (const Line of Lines) {
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
          const Text = Candidate?.[1]?.[0];
          if (typeof Text === "string" && Text.trim()) Answer = Text;
        }
      } catch {
        // Ignore metadata and partial frames that do not contain a candidate.
      }
    }

    if (!Answer.trim()) {
      console.error(
        "[StoryBot Gemini] No answer found; response preview:",
        ResponseText.slice(0, 1800)
      );
      throw new Error(
        "Gemini returned no extractable answer. Its private response format may have changed."
      );
    }

    console.log(
      "%c🤖 STORYBOT GEMINI RESPONSE",
      "background:#22e65b;color:#000;border:4px solid #000;border-radius:8px;padding:12px 16px;font-size:16px;font-weight:800;white-space:pre-wrap;"
    );
    console.log(Answer.trim());
    return Answer.trim().slice(0, 700);
  }

  window.AskAI = AskAI;

  function PostToStoryRewrite(TargetOrigin, Message) {
    try {
      if (window.opener && ALLOWED_APP_ORIGINS.has(TargetOrigin)) {
        window.opener.postMessage({ ...Message, source: GEMINI_SOURCE, channel: CHANNEL }, TargetOrigin);
      }
    } catch {}
  }

  function AnnounceReady(TargetOrigin) {
    PostToStoryRewrite(TargetOrigin, { type: "ready" });
    ShowStoryBotSessionLabel("Story Rewrite · Gemini session helper ready. Keep this tab open.", "connected");
  }

  window.addEventListener("message", async Event => {
    if (!window.opener || Event.source !== window.opener) return;
    if (!ALLOWED_APP_ORIGINS.has(Event.origin)) return;
    const Message = Event.data;
    if (Message?.source !== APP_SOURCE || Message.channel !== CHANNEL) return;

    if (Message.type === "hello") {
      AnnounceReady(Event.origin);
      return;
    }
    if (Message.type !== "request") return;

    const RequestId = String(Message.requestId || "").slice(0, 180);
    const Prompt = String(Message.prompt || "").trim().slice(0, 9000);
    if (!RequestId || !Prompt) return;

    ShowStoryBotSessionLabel("Story Rewrite · StoryBot is asking Gemini…", "working");
    try {
      const Answer = await AskAI(Prompt);
      PostToStoryRewrite(Event.origin, { type: "result", requestId: RequestId, answer: Answer, error: "" });
      ShowStoryBotSessionLabel("Story Rewrite · Gemini session connected.", "connected");
    } catch (Error) {
      const ErrorText = String(Error?.message || Error).slice(0, 300);
      PostToStoryRewrite(Event.origin, { type: "result", requestId: RequestId, answer: "", error: ErrorText });
      ShowStoryBotSessionLabel("Story Rewrite · " + ErrorText, "error");
    }
  });

  console.log("✅ StoryBot Gemini console helper is ready. Test with AskAI('Say hello in one sentence.').");
  if (window.opener) {
    ShowStoryBotSessionLabel("Story Rewrite · waiting for connection handshake…", "ready");
    for (const Origin of ALLOWED_APP_ORIGINS) PostToStoryRewrite(Origin, { type: "ready" });
  } else {
    ShowStoryBotSessionLabel("AskAI is ready, but no Story Rewrite opener was found. Open Gemini with Story Rewrite’s Connect Gemini button for game integration.", "error");
    console.warn("[StoryBot Gemini] Run Connect Gemini from Story Rewrite to establish the tab relationship. AskAI still works in this console.");
  }
})();