const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const cheerio = require("cheerio");

const PORT = process.env.PORT || 10000;
const ROOT = __dirname;
const PROVIDERS = [
  { url: "https://fruityblox.com/stock", normal: "Normal", mirage: "Mirage" },
  { url: "https://blox-fruitswiki.com/wiki/stock/", normal: "Current Stock", mirage: "Current Mirage Stock" },
  { url: "https://bloxfruits-wiki.com/wiki/stock/", normal: "Current Stock", mirage: "Current Mirage Stock" }
];
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

function send(res, status, type, body, cors = false) {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...(cors ? { "Access-Control-Allow-Origin": "https://draconic.onrender.com", "Vary": "Origin" } : {})
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;

  if (pathname === "/api/health") {
    return send(res, 200, "application/json; charset=utf-8", JSON.stringify({ ok: true }), true);
  }

  if (pathname === "/api/stock") {
    try {
      if (cachedBody && Date.now() - cachedAt < 20000) {
        return send(res, 200, "application/json; charset=utf-8", cachedBody, true);
      }
      const failures = [];
      for (const provider of PROVIDERS) {
        try {
          const upstream = await fetch(provider.url, {
            headers: {
              "Accept": "text/html,application/xhtml+xml",
              "Accept-Language": "en-US,en;q=0.9",
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
              "Referer": new URL(provider.url).origin + "/"
            },
            signal: AbortSignal.timeout(12000)
          });
          if (!upstream.ok) {
            failures.push({ source: provider.url, status: upstream.status });
            continue;
          }
          const $ = cheerio.load(await upstream.text());
          function sectionFruits(label) {
            const heading = $("h1,h2,h3").filter((_, el) =>
              $(el).text().trim().toLowerCase() === label.toLowerCase()
            ).first();
            if (!heading.length) return [];
            let section = heading.closest("section");
            if (!section.length) section = heading.parent();
            let found = section.find("h3").map((_, el) => $(el).text().trim()).get().filter(Boolean);
            if (!found.length) {
              let node = heading.next();
              while (node.length && !/^h[1-3]$/i.test(node[0].tagName || "")) {
                node.find("h3,a").each((_, el) => {
                  const name = $(el).text().trim().split(/\\s+/)[0];
                  if (/^[A-Z][A-Za-z-]*$/.test(name) && !found.includes(name)) found.push(name);
                });
                node = node.next();
              }
            }
            return [...new Set(found)];
          }
          const normal = sectionFruits(provider.normal);
          const mirage = sectionFruits(provider.mirage);
          if (!normal.length || !mirage.length) {
            failures.push({ source: provider.url, error: "Stock sections were not recognized" });
            continue;
          }
          const data = {
            status: true,
            normal_now: normal,
            mirage_now: mirage,
            source: provider.url,
            updated_at: new Date().toISOString(),
            source_type: "community"
          };
          cachedBody = JSON.stringify(data);
          cachedAt = Date.now();
          return send(res, 200, "application/json; charset=utf-8", cachedBody, true);
        } catch (providerError) {
          failures.push({ source: provider.url, error: providerError.message });
        }
      }
      return send(res, 502, "application/json; charset=utf-8",
        JSON.stringify({ error: "All configured community stock sources were unavailable", attempts: failures }), true);
    } catch (error) {
      return send(res, 502, "application/json; charset=utf-8",
        JSON.stringify({ error: "Could not reach the community stock provider", detail: error.message }), true);
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
