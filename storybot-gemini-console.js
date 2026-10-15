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
    const Wiz = window.WIZ_global_data || {};
    const Match = Pattern => Html.match(Pattern)?.[1] || "";

    const AuthorizationToken =
      Wiz.SNlM0e ||
      Match(/"SNlM0e"\s*:\s*"([^"]+)"/) ||
      Match(/"thykhd"\s*:\s*"([^"]+)"/) ||
      "";

    const ResourceUrls = performance.getEntriesByType("resource")
      .map(Entry => {
        try { return new URL(Entry.name); } catch { return null; }
      })
      .filter(Boolean);
    const ResourceBuildLabel = ResourceUrls
      .map(Url => Url.searchParams.get("bl"))
      .find(Boolean);

    const LabelMatches = [
      ...Html.matchAll(/boq_(?:assistant-bard-web-server|gemini-web-uiserver)_[A-Za-z0-9._-]+/g)
    ];
    const BuildLabel =
      ResourceBuildLabel ||
      Wiz.cfb2h ||
      Match(/"cfb2h"\s*:\s*"([^"]+)"/) ||
      LabelMatches.at(-1)?.[0] ||
      "";

    if (!AuthorizationToken) {
      throw new Error("Gemini session token was not found. Refresh Gemini while signed in, then try again.");
    }
    if (!BuildLabel) {
      throw new Error("Gemini build label was not found. Refresh Gemini and try again.");
    }
    return { AuthorizationToken: String(AuthorizationToken), BuildLabel: String(BuildLabel) };
  }

  async function AskAI(PromptText) {
    if (typeof PromptText !== "string" || !PromptText.trim()) {
      throw new TypeError("AskAI requires a non-empty message.");
    }

    const Prompt = PromptText.trim().slice(0, 9000);
    const { AuthorizationToken, BuildLabel } = ReadGeminiSessionConfig();
    const AccountPrefix = location.pathname.match(/^\/u\/\d+/)?.[0] || "";
    const Endpoint = location.origin + AccountPrefix +
      "/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate";

    const Query = new URLSearchParams({
      bl: String(BuildLabel),
      hl: "en",
      _reqid: String(Date.now() % 1000000),
      rt: "c"
    });

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

    const Body = new URLSearchParams({
      at: String(AuthorizationToken),
      "f.req": JSON.stringify([null, JSON.stringify(RequestData)])
    });

    const Controller = new AbortController();
    const Timeout = window.setTimeout(() => Controller.abort(), 60000);
    let Raw = "";
    let Response;
    try {
      Response = await fetch(Endpoint + "?" + Query.toString(), {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          "X-Same-Domain": "1"
        },
        body: Body.toString(),
        signal: Controller.signal,
        cache: "no-store"
      });
      Raw = await Response.text();
    } catch (Error) {
      if (Controller.signal.aborted) throw new Error("Gemini web-session request timed out.");
      throw Error;
    } finally {
      window.clearTimeout(Timeout);
    }

    if (!Response.ok) {
      console.error("❌ Gemini returned HTTP " + Response.status + ".");
      console.error("Response preview:", Raw.slice(0, 1800));
      throw new Error("Gemini returned HTTP " + Response.status + ".");
    }

    let Answer = "";
    const Lines = Raw.replace(/^\)\]\}'\s*/, "").split(/\r?\n/);
    for (const RawLine of Lines) {
      if (!RawLine.includes('"wrb.fr"')) continue;
      try {
        const Start = RawLine.indexOf('[["wrb.fr"');
        if (Start < 0) continue;
        const Frame = JSON.parse(RawLine.slice(Start));
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
        // Ignore incomplete/non-answer stream frames.
      }
    }

    if (!Answer) {
      console.warn("⚠️ Gemini responded, but the answer parser found no text.");
      console.log("Response preview:", Raw.slice(0, 2500));
      throw new Error("Gemini returned no extractable answer. Its private response format may have changed.");
    }

    console.log(
      "%c🤖 GEMINI AI RESPONSE",
      "background:#20a44b;color:#fff;padding:6px 10px;border:2px solid #111;font-weight:bold;font-size:14px;"
    );
    console.log(Answer);
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

  console.log("✅ AskAI is ready.");
  if (window.opener) {
    ShowStoryBotSessionLabel("Story Rewrite · waiting for connection handshake…", "ready");
    for (const Origin of ALLOWED_APP_ORIGINS) PostToStoryRewrite(Origin, { type: "ready" });
  } else {
    ShowStoryBotSessionLabel("AskAI is ready, but no Story Rewrite opener was found. Open Gemini with Story Rewrite’s Connect Gemini button for game integration.", "error");
    console.warn("[StoryBot Gemini] Run Connect Gemini from Story Rewrite to establish the tab relationship. AskAI still works in this console.");
    void window.AskAI("Reply with exactly this sentence: StoryBot Gemini console test succeeded.");
  }
})();