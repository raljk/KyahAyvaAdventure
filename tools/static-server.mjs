// Tiny static server for previewing board modules without the game server.
// Usage: node tools/static-server.mjs [port]
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2] || 8101);
const mounts = [
  ['/vendor/three/', path.join(root, 'node_modules/three/')],
  ['/vendor/gsap/', path.join(root, 'node_modules/gsap/')],
  ['/vendor/fonts/', path.join(root, 'node_modules/@fontsource/')],
  ['/socket.io/', path.join(root, 'node_modules/socket.io/client-dist/')],
  ['/', path.join(root, 'public/')],
];
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' };
http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  for (const [prefix, dir] of mounts) {
    if (!url.startsWith(prefix)) continue;
    let file = path.join(dir, url.slice(prefix.length));
    if (!file.startsWith(dir)) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end('not found: ' + url); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    return fs.createReadStream(file).pipe(res);
  }
  res.writeHead(404); res.end();
}).listen(port, () => console.log(`static preview on http://localhost:${port}/`));
