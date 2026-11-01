const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const cheerio = require("cheerio");

const PORT = process.env.PORT || 10000;
const ROOT = __dirname;
const STOCK_API_URL = "https://api.parse.bot/scraper/e534d388-6640-4c19-b9b6-b2ba12930793/get_stock";
const CACHE_MS = 30 * 60 * 1000;
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
    return send(res, 200, "application/json; charset=utf-8", JSON.stringify({
      ok: true,
      provider: "Parse managed FruityBlox stock API",
      configured: Boolean(process.env.PARSE_API_KEY),
      cache_age_seconds: cachedAt ? Math.floor((Date.now() - cachedAt) / 1000) : null
    }), true);
  }

  if (pathname === "/api/stock") {
    try {
      if (cachedBody && Date.now() - cachedAt < CACHE_MS) {
        return send(res, 200, "application/json; charset=utf-8", cachedBody, true);
      }
      const apiKey = process.env.PARSE_API_KEY;
      if (!apiKey) {
        return send(res, 503, "application/json; charset=utf-8", JSON.stringify({
          error: "Stock provider key is not configured",
          setup: "Add PARSE_API_KEY to the Render API service environment variables"
        }), true);
      }
      const upstream = await fetch(STOCK_API_URL, {
        headers: { "Accept": "application/json", "X-API-Key": apiKey },
        signal: AbortSignal.timeout(20000)
      });
      const raw = await upstream.text();
      if (!upstream.ok) {
        return send(res, 502, "application/json; charset=utf-8", JSON.stringify({
          error: "Managed stock provider returned HTTP " + upstream.status,
          detail: raw.slice(0, 500)
        }), true);
      }
      let payload;
      try { payload = JSON.parse(raw); }
      catch { throw new Error("Provider returned invalid JSON"); }
      const body = payload && payload.data ? payload.data : payload;
      const normal = body && (body.normal || body.normal_now);
      const mirage = body && (body.mirage || body.mirage_now);
      if (!Array.isArray(normal) || !normal.length || !Array.isArray(mirage) || !mirage.length) {
        throw new Error("Provider response did not contain non-empty normal and mirage arrays");
      }
      const normalize = list => list.map(item => {
        if (typeof item === "string") return item;
        if (!item || typeof item.name !== "string") return null;
        return {
          name: item.name,
          type: item.type || "",
          price_beli: item.price_beli ?? item.money_price ?? null,
          price_robux: item.price_robux ?? item.robux_price ?? null,
          image_url: item.image_url || null
        };
      }).filter(Boolean);
      const data = {
        status: true,
        normal_now: normalize(normal),
        mirage_now: normalize(mirage),
        source: "Parse managed FruityBlox API",
        source_url: STOCK_API_URL,
        source_type: "community",
        updated_at: new Date().toISOString()
      };
      if (!data.normal_now.length || !data.mirage_now.length) {
        throw new Error("Provider stock lists could not be normalized");
      }
      cachedBody = JSON.stringify(data);
      cachedAt = Date.now();
      return send(res, 200, "application/json; charset=utf-8", cachedBody, true);
    } catch (error) {
      return send(res, 502, "application/json; charset=utf-8", JSON.stringify({
        error: "Could not retrieve verified stock data",
        detail: error.message
      }), true);
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
