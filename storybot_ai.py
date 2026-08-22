import json
import os
import sys
import tempfile
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


def BuildPrompt(Context):
    ContextText = json.dumps(Context, ensure_ascii=False, separators=(",", ":"))
    if len(ContextText) > 5200:
        ContextText = ContextText[-5200:]
    return (
        "Use the live JSON context below. Answer the asking player's question naturally. "
        "Help with the current story, votes, danger, objective, or multiplayer discussion. "
        "Never invent room state. Keep the answer under two short sentences.\n"
        + ContextText
    )


def LoadModel():
    return Llama(
        model_path=str(ModelPath),
        n_ctx=int(os.environ.get("STORYBOT_CONTEXT_SIZE", "1536")),
        n_threads=max(1, int(os.environ.get("STORYBOT_THREADS", "1"))),
        n_batch=128,
        use_mmap=True,
        use_mlock=False,
        verbose=False,
    )


def GenerateReply(Model, Context):
    Result = Model.create_chat_completion(
        messages=[
            {
                "role": "system",
                "content": (
                    "You are StoryBot, the cooperative AI assistant inside Story Rewrite. "
                    "Use only the supplied room and stage context. You are not a human player."
                ),
            },
            {"role": "user", "content": BuildPrompt(Context)},
        ],
        temperature=0.7,
        top_p=0.9,
        max_tokens=120,
        repeat_penalty=1.12,
    )
    Reply = str(Result["choices"][0]["message"]["content"] or "").strip()
    if not Reply:
        raise RuntimeError("The local model returned an empty response.")
    return Reply[:500]


def Send(Message):
    sys.stdout.write(json.dumps(Message, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def Main():
    EnsureModel()
    if "--download-only" in sys.argv:
        return
    Model = LoadModel()
    Send({"type": "ready"})
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
