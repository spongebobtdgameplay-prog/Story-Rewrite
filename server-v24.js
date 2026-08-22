const fs = require("fs");
const path = require("path");
const vm = require("vm");
const Module = require("module");

const Root = __dirname;
const BaseWrapperPath = path.join(Root, "server-v11.js");
const V20Path = path.join(Root, "server-v20.js");
const V21Path = path.join(Root, "server-v21.js");

function ExtractPatchCode(FilePath, VariableName, StopMarker, RepairSource = null) {
    let Source = fs.readFileSync(FilePath, "utf8");
    if (typeof RepairSource === "function") Source = RepairSource(Source);

    const StopIndex = Source.indexOf(StopMarker);
    if (StopIndex < 0) throw new Error("server-v24 extraction failed: " + path.basename(FilePath) + " " + StopMarker);

    const Prefix = Source.slice(0, StopIndex);
    const Context = {
        require,
        __dirname: Root,
        __filename: FilePath,
        console,
        process,
        Buffer,
        setTimeout,
        clearTimeout,
        globalThis: null
    };
    Context.globalThis = Context;

    vm.runInNewContext(
        Prefix + "\nglobalThis.__ExtractedPatchCode = " + VariableName + ";",
        Context,
        { filename: FilePath }
    );

    const PatchCode = Context.__ExtractedPatchCode;
    if (typeof PatchCode !== "string" || !PatchCode.trim()) {
        throw new Error("server-v24 extraction failed: " + VariableName);
    }
    return PatchCode;
}

function RepairV21Source(Source) {
    const StartMarker = "ReplaceRequired(\n    'HttpServer.listen(Port, () => {";
    const EndMarker = "    \"load moderation database before listen\"\n);";
    const StartIndex = Source.indexOf(StartMarker);
    const EndIndex = Source.indexOf(EndMarker, StartIndex);

    if (StartIndex < 0 || EndIndex < 0) {
        throw new Error("server-v24 repair failed: v21 listen patch block not found");
    }

    const Replacement = [
        "ReplaceRequired(",
        "    'HttpServer.listen(Port, () => {\\n    console.log(\\\"Story Rewrite backend v\\\" + BackendVersion + \\\" listening on \\\" + Port);\\n});',",
        "    'InitializePersistentHostModeration()\\n    .then(() => {\\n        HttpServer.listen(Port, () => {\\n            console.log(\\\"Story Rewrite backend v\\\" + BackendVersion + \\\" listening on \\\" + Port);\\n        });\\n    })\\n    .catch(Error => {\\n        console.error(\\\"Host moderation database initialization failed\\\", Error);\\n        process.exit(1);\\n    });',",
        "    \"load moderation database before listen\"",
        ");"
    ].join("\n");

    return Source.slice(0, StartIndex) + Replacement + Source.slice(EndIndex + EndMarker.length);
}

const V20PatchCode = ExtractPatchCode(V20Path, "V20PatchCode", "const InjectionNeedle =");
const V21PatchCode = ExtractPatchCode(V21Path, "V21PatchCode", "const Marker =", RepairV21Source);

let WrapperSource = fs.readFileSync(BaseWrapperPath, "utf8");
const InjectionNeedle = '${JSON.stringify(V19PatchCode)} + "\\\\n\\\\nconst RuntimeModule = new Module(SourcePath, module);"';

if (!WrapperSource.includes(InjectionNeedle)) {
    throw new Error("server-v24 patch failed: v19 injection point");
}

const InjectionReplacement =
    '${JSON.stringify(V19PatchCode)} + "\\\\n\\\\n" + ' +
    JSON.stringify(V20PatchCode) +
    ' + "\\\\n\\\\n" + ' +
    JSON.stringify(V21PatchCode) +
    ' + "\\\\n\\\\nconst RuntimeModule = new Module(SourcePath, module);"';

WrapperSource = WrapperSource.replace(InjectionNeedle, InjectionReplacement);

const RuntimeModule = new Module(BaseWrapperPath, module);
RuntimeModule.filename = BaseWrapperPath;
RuntimeModule.paths = Module._nodeModulePaths(Root);
RuntimeModule._compile(WrapperSource, BaseWrapperPath);
