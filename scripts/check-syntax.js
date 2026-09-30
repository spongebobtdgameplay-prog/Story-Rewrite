const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const Root = process.cwd();
const SkipDirectories = new Set([".git", "node_modules"]);

function FindJavaScriptFiles(CurrentPath) {
    const Entries = fs.readdirSync(CurrentPath, { withFileTypes: true });
    const Files = [];

    for (const Entry of Entries) {
        if (SkipDirectories.has(Entry.name)) continue;

        const FullPath = path.join(CurrentPath, Entry.name);
        if (Entry.isDirectory()) {
            Files.push(...FindJavaScriptFiles(FullPath));
            continue;
        }

        if (Entry.isFile() && Entry.name.endsWith(".js")) {
            Files.push(FullPath);
        }
    }

    return Files;
}

const JavaScriptFiles = FindJavaScriptFiles(Root).sort();

function CheckDomEventBindings() {
    const HtmlIds = new Set();

    function CollectHtmlFiles(CurrentPath) {
        const Entries = fs.readdirSync(CurrentPath, { withFileTypes: true });
        for (const Entry of Entries) {
            if (SkipDirectories.has(Entry.name)) continue;

            const FullPath = path.join(CurrentPath, Entry.name);
            if (Entry.isDirectory()) {
                CollectHtmlFiles(FullPath);
            } else if (Entry.isFile() && Entry.name.endsWith(".html")) {
                const Html = fs.readFileSync(FullPath, "utf8");
                for (const Match of Html.matchAll(/\bid=["']([^"']+)["']/g)) {
                    HtmlIds.add(Match[1]);
                }
            }
        }
    }

    CollectHtmlFiles(Root);

    const BindingPattern = /document\.getElementById\(["']([^"']+)["']\)\.addEventListener\s*\(/g;
    for (const File of JavaScriptFiles) {
        const Source = fs.readFileSync(File, "utf8");
        for (const Match of Source.matchAll(BindingPattern)) {
            const Id = Match[1];
            if (!HtmlIds.has(Id)) {
                Failed = true;
                process.stderr.write("\nUNGUARDED DOM EVENT BINDING: " + path.relative(Root, File) + "\n");
                process.stderr.write('Missing HTML id "' + Id + '". Guard the element with ?.addEventListener(...) or an explicit null check.\n');
            }
        }
    }
}


if (!JavaScriptFiles.length) {
    console.error("No JavaScript files found.");
    process.exit(1);
}

let Failed = false;

for (const File of JavaScriptFiles) {
    const Result = spawnSync(process.execPath, ["--check", File], {
        cwd: Root,
        encoding: "utf8"
    });

    if (Result.status !== 0) {
        Failed = true;
        process.stderr.write(`\nSYNTAX ERROR: ${path.relative(Root, File)}\n`);
        process.stderr.write(Result.stderr || Result.stdout || "node --check failed.\n");
    }
}

CheckDomEventBindings();

if (Failed) {
    process.exit(1);
}

console.log(`Syntax OK: ${JavaScriptFiles.length} JavaScript files checked.`);
