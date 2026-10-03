import json
import os
import sys
import tempfile
import urllib.parse
import urllib.request
from pathlib import Path

LocalStoryBotPython = Path(__file__).parent / ".storybot-python"
if LocalStoryBotPython.exists():
    sys.path.insert(0, str(LocalStoryBotPython))

from llama_cpp import Llama

ModelFileName = "SmolLM2-135M-Instruct-Q4_K_M.gguf"
ModelUrl = os.environ.get(
    "STORYBOT_MODEL_URL",
    "https://huggingface.co/bartowski/SmolLM2-135M-Instruct-GGUF/resolve/main/SmolLM2-135M-Instruct-Q4_K_M.gguf?download=true",
)
ModelDirectory = Path(os.environ.get("STORYBOT_MODEL_DIRECTORY", Path(__file__).parent / ".storybot-model"))
ModelPath = Path(os.environ.get("STORYBOT_MODEL_PATH", ModelDirectory / ModelFileName))


def EnsureModel():
    if ModelPath.exists() and ModelPath.stat().st_size > 70_000_000:
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
    return str(os.environ.get("STORYBOT_WEB_KNOWLEDGE", "false")).strip().lower() not in {"0", "false", "no", "off"}


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


def ChooseResponseStyle(Context):
    Question = str((Context or {}).get("question", "")).strip()
    Score = sum((Index + 1) * ord(Character) for Index, Character in enumerate(Question[:80]))
    Styles = (
        "answer directly in a natural conversational tone",
        "lead with the most useful fact, then add a brief explanation",
        "give a compact explanation in your own words",
        "respond casually but precisely, focusing on the player's exact question",
    )
    return Styles[Score % len(Styles)]


def BuildPrompt(Context):
    ContextCopy = dict(Context or {})
    WebKnowledge = ContextCopy.pop("webKnowledge", None)
    ContextText = json.dumps(ContextCopy, ensure_ascii=False, separators=(",", ":"))
    if len(ContextText) > 2200:
        ContextText = ContextText[:1500] + "...[context trimmed]..." + ContextText[-700:]

    WebText = json.dumps(WebKnowledge or [], ensure_ascii=False, separators=(",", ":"))
    if len(WebText) > 1000:
        WebText = WebText[:1000]

    return (
        "Read the live game context first, then answer the asking player's exact question. "
        "Think about which facts actually answer the question before writing. "
        "For gameplay questions, prefer live room/stage/chat facts over web knowledge. "
        "For general-knowledge questions, use the web notes as supporting evidence, but never pretend "
        "the web notes are part of the live game state. "
        "Write an original response instead of repeating a canned StoryBot line. "
        "Do not begin every answer with the player's name, 'Yes', or 'I can confirm'. "
        "Vary the wording and sentence structure; never reuse a previous answer verbatim. "
        + ChooseResponseStyle(Context) + ". "
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
        n_ctx=int(os.environ.get("STORYBOT_CONTEXT_SIZE", "1024")),
        n_threads=max(1, int(os.environ.get("STORYBOT_THREADS", "2"))),
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
        "Answer the player's exact question using the live game context. "
        "For gameplay, use only the supplied room, stage, votes, and recent chat facts. "
        "For general knowledge, use WEB_KNOWLEDGE only as supporting background. "
        "Never invent missing game state. Do not repeat the question or use a canned opening. "
        "Be natural, specific, and concise."
    )

    Result = Model.create_chat_completion(
        messages=[
            {"role": "system", "content": SystemPrompt},
            {"role": "user", "content": BuildPrompt(Context)},
        ],
        temperature=0.78,
        top_p=0.9,
        max_tokens=max(24, int(os.environ.get("STORYBOT_MAX_TOKENS", "32"))),
        repeat_penalty=1.12,
        frequency_penalty=0.2,
    )
    Reply = str(Result["choices"][0]["message"]["content"] or "").strip()

    if not Reply:
        raise RuntimeError("The local model returned an empty response.")
    return Reply[:400]


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
