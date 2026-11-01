const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = process.env.PORT || 10000;
const ROOT = __dirname;
const UPSTREAM = "https://bloxfruits-api.onrender.com/info/stock";
let cachedBody = null;
let cachedAt = 0;

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

function send(res, status, type, body) {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;

  if (pathname === "/api/health") {
    return send(res, 200, "application/json; charset=utf-8", JSON.stringify({ ok: true }));
  }

  if (pathname === "/api/stock") {
    try {
      if (cachedBody && Date.now() - cachedAt < 20000) {
        return send(res, 200, "application/json; charset=utf-8", cachedBody);
      }
      const upstream = await fetch(UPSTREAM, {
        headers: { "Accept": "application/json", "User-Agent": "DraconicStockTracker/1.0" },
        signal: AbortSignal.timeout(15000)
      });
      const body = await upstream.text();
      if (!upstream.ok) {
        return send(res, 502, "application/json; charset=utf-8",
          JSON.stringify({ error: "Stock provider returned HTTP " + upstream.status }));
      }
      let data;
      try { data = JSON.parse(body); }
      catch { return send(res, 502, "application/json; charset=utf-8",
        JSON.stringify({ error: "Stock provider returned invalid JSON" })); }
      if (!(data.normal_now || data.normal || data.mirage_now || data.mirage)) {
        return send(res, 502, "application/json; charset=utf-8",
          JSON.stringify({ error: "Stock provider response format was not recognized" }));
      }
      cachedBody = JSON.stringify(data);
      cachedAt = Date.now();
      return send(res, 200, "application/json; charset=utf-8", cachedBody);
    } catch (error) {
      return send(res, 502, "application/json; charset=utf-8",
        JSON.stringify({ error: "Could not reach the community stock provider", detail: error.message }));
    }
  }

  let filePath = path.resolve(ROOT, "." + decodeURIComponent(pathname));
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== path.join(ROOT, "index.html")) {
    return send(res, 403, "text/plain; charset=utf-8", "Forbidden");
  }
  if (pathname === "/") filePath = path.join(ROOT, "index.html");
  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (!path.extname(pathname)) {
        fs.readFile(path.join(ROOT, "index.html"), (fallbackError, fallback) => {
          if (fallbackError) return send(res, 404, "text/plain; charset=utf-8", "Not found");
          send(res, 200, mime[".html"], fallback);
        });
      } else send(res, 404, "text/plain; charset=utf-8", "Not found");
      return;
    }
    send(res, 200, mime[path.extname(filePath)] || "application/octet-stream", content);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("Draconic server listening on port " + PORT);
});
