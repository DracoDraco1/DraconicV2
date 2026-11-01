const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const cheerio = require("cheerio");

const PORT = process.env.PORT || 10000;
const ROOT = __dirname;
const UPSTREAM = "https://fruityblox.com/stock";
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
      const upstream = await fetch(UPSTREAM, {
        headers: { "Accept": "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36", "Referer": "https://fruityblox.com/" },
        signal: AbortSignal.timeout(20000)
      });
      if (!upstream.ok) {
        return send(res, 502, "application/json; charset=utf-8",
          JSON.stringify({ error: "Stock provider returned HTTP " + upstream.status, source: UPSTREAM }), true);
      }
      const html = await upstream.text();
      const $ = cheerio.load(html);
      function sectionFruits(headingText) {
        const heading = $("h2").filter((_, el) => $(el).text().trim().toLowerCase() === headingText.toLowerCase()).first();
        if (!heading.length) return [];
        const section = heading.closest("section").length ? heading.closest("section") : heading.parent();
        const found = [];
        section.find("h3").each((_, el) => {
          const name = $(el).text().trim();
          if (name && !found.includes(name)) found.push(name);
        });
        if (found.length) return found;
        let sibling = heading.next();
        while (sibling.length && !sibling.is("h2")) {
          sibling.find("h3, a").each((_, el) => {
            const name = $(el).text().trim().split(/\\s+/)[0];
            if (name && /^[A-Z][A-Za-z-]*$/.test(name) && !found.includes(name)) found.push(name);
          });
          sibling = sibling.next();
        }
        return found;
      }
      const normal = sectionFruits("Normal");
      const mirage = sectionFruits("Mirage");
      if (!normal.length || !mirage.length) {
        return send(res, 502, "application/json; charset=utf-8",
          JSON.stringify({ error: "Could not parse Normal and Mirage stock sections", source: UPSTREAM }), true);
      }
      const data = { status: true, normal_now: normal, mirage_now: mirage, source: UPSTREAM, updated_at: new Date().toISOString() };
      cachedBody = JSON.stringify(data);
      cachedAt = Date.now();
      return send(res, 200, "application/json; charset=utf-8", cachedBody, true);
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
