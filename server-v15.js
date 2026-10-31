const path = require("path");
const Module = require("module");

const OriginalCompile = Module.prototype._compile;
const TargetGeneratedServer = path.resolve(__dirname, "server-v8.js");
let ThinkPatchApplied = false;

Module.prototype._compile = function(Content, Filename) {
    if (Filename && path.resolve(Filename) === TargetGeneratedServer) {
        let GeneratedSource = String(Content);

        const VersionAnchor = "const BackendVersion = 54;";
        if (GeneratedSource.split(VersionAnchor).length !== 2) {
            throw new Error("server-v15 Silicon Valley patch failed: expected backend version 54 exactly once.");
        }
        GeneratedSource = GeneratedSource.replace(VersionAnchor, "const BackendVersion = 55;");

        const ThinkHelpers = String.raw