/* Minimal static server for the site/ folder. Usage: node pipeline/serve.mjs [port] */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "site");
const PORT = Number(process.argv[2] || process.env.PORT || 4178);

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".ico": "image/x-icon", ".woff2": "font/woff2", ".map": "application/json"
};

http.createServer((req, res) => {
  let url = decodeURIComponent(req.url.split("?")[0]);
  if (url === "/") url = "/index.html";
  const file = path.normalize(path.join(ROOT, url));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end("forbidden"); }
  fs.readFile(file, (err, buf) => {
    if (err) {
      // SPA fallback for unknown non-asset routes
      if (!path.extname(file)) { return fs.readFile(path.join(ROOT, "index.html"), (e2, b2) => { res.writeHead(e2 ? 404 : 200, { "content-type": "text/html; charset=utf-8" }); res.end(e2 ? "not found" : b2); }); }
      res.writeHead(404); return res.end("not found");
    }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-cache" });
    res.end(buf);
  });
}).listen(PORT, () => console.log(`LinkedIn Learn running at http://localhost:${PORT}/`));
