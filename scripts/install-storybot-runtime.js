const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

if (String(process.env.RENDER || "").toLowerCase() !== "true") {
    console.log("StoryBot runtime preparation skipped outside Render.");
    process.exit(0);
}

if (String(process.env.STORYBOT_LOCAL_FALLBACK || "").toLowerCase() !== "true") {
    console.log("StoryBot local CPU fallback disabled; using Vercel AI Gateway.");
    process.exit(0);
}

const Root = path.resolve(__dirname, "..");
const Python = process.env.PYTHON || "python3";
const PackageDirectory = path.join(Root, ".storybot-python");
const ModelDirectory = path.join(Root, ".storybot-model");

function Run(Arguments) {
    execFileSync(Python, Arguments, {
        cwd: Root,
        stdio: "inherit",
        env: process.env
    });
}

fs.mkdirSync(PackageDirectory, { recursive: true });
fs.mkdirSync(ModelDirectory, { recursive: true });

try {
    Run(["-c", "import sys; sys.path.insert(0, r'" + PackageDirectory.replace(/\\/g, "\\\\") + "'); import llama_cpp"]);
    console.log("StoryBot Python runtime already installed.");
} catch {
    console.log("Installing StoryBot CPU runtime...");
    Run([
        "-m", "pip", "install",
        "--disable-pip-version-check",
        "--no-cache-dir",
        "--only-binary=:all:",
        "--target", PackageDirectory,
        "llama-cpp-python==0.3.35",
        "--extra-index-url", "https://abetlen.github.io/llama-cpp-python/whl/cpu"
    ]);
}

console.log("Preparing StoryBot model...");
Run(["storybot_ai.py", "--download-only"]);
console.log("StoryBot build preparation complete.");
