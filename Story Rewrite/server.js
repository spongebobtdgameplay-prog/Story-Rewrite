const http = require("http");
const fs = require("fs");
const path = require("path");

const Root = __dirname;
const Port = Number(process.env.PORT || 57410);

const MimeTypes = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".mp4": "video/mp4",
    ".webm": "video/webm"
};

const Server = http.createServer((Request, Response) => {
    let RequestPath = decodeURIComponent(Request.url.split("?")[0]);

    if (RequestPath === "/") {
        RequestPath = "/index.html";
    }

    const SafePath = path.normalize(RequestPath).replace(/^(\.\.[/\\])+/, "");
    const FilePath = path.join(Root, SafePath);

    if (!FilePath.startsWith(Root)) {
        Response.writeHead(403);
        Response.end("Forbidden");
        return;
    }

    fs.stat(FilePath, (StatError, Stats) => {
        if (StatError || !Stats.isFile()) {
            Response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
            Response.end("Not found");
            return;
        }

        const Extension = path.extname(FilePath).toLowerCase();
        const MimeType = MimeTypes[Extension] || "application/octet-stream";

        Response.writeHead(200, {
            "Content-Type": MimeType,
            "Cache-Control": "no-store"
        });

        fs.createReadStream(FilePath).pipe(Response);
    });
});

Server.listen(Port, () => {
    console.log(`Story Rewrite running at http://localhost:${Port}`);
});
