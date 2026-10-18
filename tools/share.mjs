// Play over the internet: starts the game server (if it is not already running on PORT) and a free Cloudflare
// quick tunnel, then points the board's QR code at the public https link.
// Usage: npm run share        (needs `cloudflared`: brew install cloudflared)
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 3000);
const local = `http://localhost:${PORT}`;
const children = [];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function up() { try { const r = await fetch(`${local}/api/info`); return r.ok ? await r.json() : null; } catch { return null; } }
async function canRegister() { try { const r = await fetch(`${local}/api/public-url`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: '' }) }); return r.ok; } catch { return false; } }

function stop(code = 0) { for (const c of children) { try { c.kill('SIGINT'); } catch {} } setTimeout(() => process.exit(code), 300); }
process.on('SIGINT', () => stop(0)); process.on('SIGTERM', () => stop(0));

let info = await up();
if (info && !(await canRegister())) {
  console.error(`\n  A game server is already running on port ${PORT}, but it is an older version that cannot share a link.\n  Stop it (Ctrl+C in its terminal) and run "npm run share" again.\n`); process.exit(1);
}
if (!info) {
  const srv = spawn(process.execPath, [path.join(root, 'server/index.js')], { cwd: root, env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'inherit', 'inherit'] });
  children.push(srv); srv.on('exit', (c) => { console.error(`\n  game server exited (${c})`); stop(c || 1); });
  for (let i = 0; i < 50 && !(info = await up()); i++) await sleep(200);
  if (!info) { console.error('  the game server did not start'); stop(1); }
}

console.log('\n  Opening a public link (Cloudflare quick tunnel)…');
const tun = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', local], { stdio: ['ignore', 'pipe', 'pipe'] });
children.push(tun);
tun.on('error', () => { console.error('\n  cloudflared is not installed. Install it with:  brew install cloudflared\n'); stop(1); });
let announced = false;
const onData = async (buf) => {
  const m = String(buf).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (!m || announced) return; announced = true; const url = m[0];
  // wait until the tunnel actually serves the game before advertising it
  for (let i = 0; i < 40; i++) { try { const r = await fetch(`${url}/api/info`); if (r.ok) break; } catch {} await sleep(750); }
  const r = await fetch(`${local}/api/public-url`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }) }).then(r => r.json()).catch(() => null);
  console.log(`\n  ✦ Board (this laptop):  ${local}/board/`);
  console.log(`  ✦ Players (anywhere):  ${r?.joinUrl || url + '/play/'}`);
  console.log('    The QR code on the board now points at this link. It changes each time you run "npm run share".');
  console.log('    Press Ctrl+C to stop sharing.\n');
};
tun.stdout.on('data', onData); tun.stderr.on('data', onData);
tun.on('exit', (c) => { if (!announced) console.error(`\n  cloudflared exited before giving a link (${c}). Check your internet connection and try again.\n`); stop(c || 1); });
