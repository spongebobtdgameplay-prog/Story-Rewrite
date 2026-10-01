import json
import os
import sys
import tempfile
import urllib.parse
import urllib.request
from pathlib import Path

from llama_cpp import Llama

ModelFileName = "SmolLM2-360M-Instruct-Q4_0.gguf"
ModelUrl = os.environ.get(
    "STORYBOT_MODEL_URL",
    "https://huggingface.co/bartowski/SmolLM2-360M-Instruct-GGUF/resolve/main/SmolLM2-360M-Instruct-Q4_0.gguf?download=true",
)
ModelDirectory = Path(os.environ.get("STORYBOT_MODEL_DIRECTORY", Path(__file__).parent / ".storybot-model"))
ModelPath = Path(os.environ.get("STORYBOT_MODEL_PATH", ModelDirectory / ModelFileName))


def EnsureModel():
    if ModelPath.exists() and ModelPath.stat().st_size > 200_000_000:
        return
    ModelPath.parent.mkdir(parents=True, exist_ok=True)
    FileDescriptor, TemporaryName = tempfile.mkstemp(prefix="storybot-", suffix=".gguf", dir=ModelPath.parent)
    os.close(FileDescriptor)
    TemporaryPath = Path(TemporaryName)
    try:
        urllib.request.urlretrieve(ModelUrl, TemporaryPath)
        TemporaryPath.replace(ModelPath)
    finally:
        if TemporaryPath.exists():
            TemporaryPath.unlink()


def WebKnowledgeEnabled():
    return str(os.environ.get("STORYBOT_WEB_KNOWLEDGE", "true")).strip().lower() not in {"0", "false", "no", "off"}


def ShouldSearchWeb(Context):
    Question = str((Context or {}).get("question", "")).strip()
    if len(Question) < 8:
        return False
    Lower = Question.lower()
    GameTerms = (
        "stage", "objective", "threat", "vote", "voting", "life", "lives",
        "host", "player", "players", "room", "timer", "story", "sentence",
        "survive", "survival", "game", "multiplayer", "playing", "lobby"
    )
    if any(Term in Lower for Term in GameTerms) and not any(
        Marker in Lower for Marker in ("who is", "what is", "tell me about", "how does", "why does", "explain")
    ):
        return False
    return True


def FetchWebKnowledge(Context):
    if not WebKnowledgeEnabled() or not ShouldSearchWeb(Context):
        return []

    Question = str((Context or {}).get("question", "")).strip()
    SearchUrl = "https://en.wikipedia.org/w/api.php?" + urllib.parse.urlencode({
        "action": "query",
        "list": "search",
        "srsearch": Question,
        "srlimit": 3,
        "srprop": "snippet",
        "format": "json",
        "formatversion": 2,
    })
    try:
        Request = urllib.request.Request(
            SearchUrl,
            headers={
                "User-Agent": "StoryRewrite-StoryBot/1.0 (game AI knowledge retrieval)",
                "Accept": "application/json",
            },
        )
        with urllib.request.urlopen(Request, timeout=3.5) as Response:
            Data = json.loads(Response.read().decode("utf-8", "replace"))

        Results = []
        for Item in (Data.get("query", {}) or {}).get("search", [])[:3]:
            Title = str(Item.get("title", "")).strip()
            PageId = Item.get("pageid")
            Snippet = str(Item.get("snippet", "")).replace('<span class="searchmatch">', "").replace("</span>", "").strip()
            if Title:
                Results.append({"title": Title, "pageid": PageId, "snippet": Snippet})

        Knowledge = []
        for Item in Results[:2]:
            PageId = Item.get("pageid")
            Extract = ""
            if PageId:
                ExtractUrl = "https://en.wikipedia.org/w/api.php?" + urllib.parse.urlencode({
                    "action": "query",
                    "prop": "extracts",
                    "pageids": PageId,
                    "exintro": 1,
                    "explaintext": 1,
                    "exchars": 1800,
                    "format": "json",
                    "formatversion": 2,
                })
                try:
                    Request = urllib.request.Request(
                        ExtractUrl,
                        headers={"User-Agent": "StoryRewrite-StoryBot/1.0 (game AI knowledge retrieval)"},
                    )
                    with urllib.request.urlopen(Request, timeout=3.5) as Response:
                        PageData = json.loads(Response.read().decode("utf-8", "replace"))
                    Pages = (PageData.get("query", {}) or {}).get("pages", [])
                    if Pages:
                        Extract = str(Pages[0].get("extract", "")).strip()
                except Exception:
                    Extract = ""

            Knowledge.append({
                "title": Item["title"],
                "snippet": Item["snippet"],
                "extract": Extract[:1800],
                "source": "Wikipedia",
            })
        return Knowledge
    except Exception:
        return []


def BuildPrompt(Context):
    ContextCopy = dict(Context or {})
    WebKnowledge = ContextCopy.pop("webKnowledge", None)
    ContextText = json.dumps(ContextCopy, ensure_ascii=False, separators=(",", ":"))
    if len(ContextText) > 3300:
        ContextText = ContextText[:1900] + "...[context trimmed]..." + ContextText[-1200:]

    WebText = json.dumps(WebKnowledge or [], ensure_ascii=False, separators=(",", ":"))
    if len(WebText) > 2200:
        WebText = WebText[:2200]

    return (
        "Read the live game context first, then answer the asking player's exact question. "
        "Think about which facts actually answer the question before writing. "
        "For gameplay questions, prefer live room/stage/chat facts over web knowledge. "
        "For general-knowledge questions, use the web notes as supporting evidence, but never pretend "
        "the web notes are part of the live game state. "
        "Write an original response instead of repeating a canned StoryBot line. "
        "Do not begin every answer with the player's name, 'Yes', or 'I can confirm'. "
        "Mention a concrete relevant name, stage, objective, threat, vote, player, or fact when one is available. "
        "Rephrase the answer naturally so two different questions produce clearly different wording. "
        "Do not copy the question back to the player. "
        "Never invent missing state. Keep the answer to 2-4 concise sentences.\n\n"
        "LIVE_CONTEXT:\n" + ContextText + "\n\n"
        "WEB_KNOWLEDGE:\n" + WebText
    )


def LoadModel():
    return Llama(
        model_path=str(ModelPath),
        n_ctx=int(os.environ.get("STORYBOT_CONTEXT_SIZE", "2048")),
        n_threads=max(1, int(os.environ.get("STORYBOT_THREADS", "1"))),
        n_batch=128,
        use_mmap=True,
        use_mlock=False,
        verbose=False,
    )


def GenerateModerationDecision(Model, Context):
    ContextText = json.dumps(Context, ensure_ascii=False, separators=(",", ":"))
    if len(ContextText) > 5200:
        ContextText = ContextText[-5200:]
    Result = Model.create_chat_completion(
        messages=[
            {
                "role": "system",
                "content": (
                    "Classify the reported multiplayer message using the surrounding conversation. "
                    "Return exactly ABUSE or SAFE. Decide from meaning, target, intent, and context rather than "
                    "single swear words. Swearing, profanity, frustration, jokes, game criticism, or story "
                    "criticism is SAFE when it is not targeted abusive conduct. ABUSE is targeted harassment, "
                    "repeated demeaning personal attacks, threats of harm, targeted slurs, intimidation, or "
                    "severe abusive conduct aimed at another player. Examples: \"this timer is fucking awful\" "
                    "= SAFE; \"fuck this game\" = SAFE; \"you are worthless, get out of here\" = ABUSE; "
                    "\"I am going to hurt you\" = ABUSE. Do not treat the number of swear words as evidence by itself."
                ),
            },
            {"role": "user", "content": ContextText},
        ],
        temperature=0.0,
        top_p=1.0,
        max_tokens=4,
        repeat_penalty=1.0,
    )
    Reply = str(Result["choices"][0]["message"]["content"] or "").strip().upper()
    return "ABUSE" if Reply.startswith("ABUSE") else "SAFE"


def GenerateReply(Model, Context):
    if isinstance(Context, dict) and isinstance(Context.get("moderationReview"), dict):
        return GenerateModerationDecision(Model, Context["moderationReview"])

    Context = dict(Context or {})
    Context["webKnowledge"] = FetchWebKnowledge(Context)

    SystemPrompt = (
        "You are StoryBot, a conversational AI teammate inside Story Rewrite. "
        "Use the live context to understand what is happening, then formulate a fresh answer to the player's "
        "actual question. You are not a scripted dialogue box. You may rephrase, explain, compare, or summarize "
        "facts differently depending on the question. "
        "For live gameplay, only use room, stage, vote, and recent chat information supplied in LIVE_CONTEXT. "
        "For lobby status, say that the host has not started the game yet and do not invent story events, votes, "
        "threats, or outcomes. "
        "WEB_KNOWLEDGE is optional background retrieved for the player's general-knowledge question; do not use it "
        "to override live game state, and do not claim you personally browsed the web. "
        "Avoid canned openings and avoid repeating the same sentence across answers. "
        "Be concise, natural, and specific."
    )

    FirstResult = Model.create_chat_completion(
        messages=[
            {"role": "system", "content": SystemPrompt},
            {"role": "user", "content": BuildPrompt(Context)},
        ],
        temperature=0.82,
        top_p=0.92,
        max_tokens=150,
        repeat_penalty=1.18,
        frequency_penalty=0.35,
    )
    Reply = str(FirstResult["choices"][0]["message"]["content"] or "").strip()

    GenericPatterns = (
        "i cannot safely read the current story state",
        "i will not make up story events",
        "i can confirm the live game state",
        "ask me again after the host starts the game",
        "what would you like to know"
    )
    LowerReply = Reply.lower()
    if any(Pattern in LowerReply for Pattern in GenericPatterns):
        RewritePrompt = (
            "Rewrite the previous answer so it directly answers the player's question using the concrete facts "
            "in LIVE_CONTEXT or WEB_KNOWLEDGE. Do not use a generic StoryBot fallback. Do not start with 'Yes' or "
            "'I can confirm'. Use different wording and include at least one specific relevant fact. Keep it to "
            "2-4 concise sentences.\n\n" + BuildPrompt(Context)
        )
        SecondResult = Model.create_chat_completion(
            messages=[
                {"role": "system", "content": SystemPrompt},
                {"role": "user", "content": RewritePrompt},
            ],
            temperature=0.9,
            top_p=0.94,
            max_tokens=150,
            repeat_penalty=1.2,
            frequency_penalty=0.4,
        )
        Candidate = str(SecondResult["choices"][0]["message"]["content"] or "").strip()
        if Candidate:
            Reply = Candidate

    if not Reply:
        raise RuntimeError("The local model returned an empty response.")
    return Reply[:700]


def Send(Message):
    sys.stdout.write(json.dumps(Message, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def Main():
    EnsureModel()
    if "--download-only" in sys.argv:
        return
    Model = LoadModel()
    Send({"type": "ready", "webKnowledge": WebKnowledgeEnabled()})
    for Line in sys.stdin:
        try:
            Request = json.loads(Line)
            RequestId = str(Request.get("id", ""))
            Reply = GenerateReply(Model, Request.get("context") or {})
            Send({"id": RequestId, "ok": True, "reply": Reply})
        except Exception as Error:
            Send({"id": str(locals().get("RequestId", "")), "ok": False, "error": str(Error)[:240]})


if __name__ == "__main__":
    Main()
