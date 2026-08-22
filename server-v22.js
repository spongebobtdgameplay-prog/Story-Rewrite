const fs = require("fs");
const path = require("path");
const vm = require("vm");
const Module = require("module");

const Root = __dirname;
const BaseWrapperPath = path.join(Root, "server-v11.js");
const V20Path = path.join(Root, "server-v20.js");
const V21Path = path.join(Root, "server-v21.js");

function ExtractPatchCode(FilePath, VariableName, StopMarker) {
    const Source = fs.readFileSync(FilePath, "utf8");
    const StopIndex = Source.indexOf(StopMarker);
    if (StopIndex < 0) throw new Error(`server-v22 extraction failed: ${path.basename(FilePath)} ${StopMarker}`);

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
        Prefix + `\nglobalThis.__ExtractedPatchCode = ${VariableName};`,
        Context,
        { filename: FilePath }
    );

    const PatchCode = Context.__ExtractedPatchCode;
    if (typeof PatchCode !== "string" || !PatchCode.trim()) {
        throw new Error(`server-v22 extraction failed: ${VariableName}`);
    }
    return PatchCode;
}

const V20PatchCode = ExtractPatchCode(V20Path, "V20PatchCode", "const InjectionNeedle =");
const V21PatchCode = ExtractPatchCode(V21Path, "V21PatchCode", "const Marker =");

let WrapperSource = fs.readFileSync(BaseWrapperPath, "utf8");
const InjectionNeedle = '${JSON.stringify(V19PatchCode)} + "\\\\n\\\\nconst RuntimeModule = new Module(SourcePath, module);"';

if (!WrapperSource.includes(InjectionNeedle)) {
    throw new Error("server-v22 patch failed: v19 injection point");
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
