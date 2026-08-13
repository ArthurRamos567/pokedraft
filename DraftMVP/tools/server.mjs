// LAN draft server: serves the app, owns the draft state, persists it to
// SQLite and pushes every change to connected devices over SSE.
//
//   node tools/server.mjs [port] [db-file]
//
// Anyone on the LAN can act (free-for-all). Actions are validated and applied
// one at a time here, so two phones tapping the same Pokémon cannot both win.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createState, ensureBracket } from '../src/draft.js';
import { applyAction } from '../src/actions.js';
import { openDb } from './db.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2]) || 4173;
const DB_FILE = process.argv[3] ?? resolve(ROOT, 'draft.db');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

// ------------------------------------------------------------------ state

const POOL = JSON.parse(await readFile(resolve(ROOT, 'data/pool.json'), 'utf8'));
const db = openDb(DB_FILE);

const restored = db.load();
let revision = restored?.revision ?? 0;
let state = ensureBracket(restored?.state ?? createState(100));
if (!restored) db.save(revision, state);
console.log(restored ? `· restored draft from ${DB_FILE} (revision ${revision})` : `· new draft in ${DB_FILE}`);

/** @type {Set<import('node:http').ServerResponse>} */
const clients = new Set();

const snapshot = () => JSON.stringify({ revision, state });

function broadcast(event, data) {
  const frame = `event: ${event}\ndata: ${data}\n\n`;
  for (const res of clients) res.write(frame);
}

const announcePresence = () => broadcast('presence', JSON.stringify({ devices: clients.size }));

function commit(action) {
  state = applyAction(state, POOL, action);
  revision += 1;
  db.save(revision, state);
  broadcast('state', snapshot());
}

// ------------------------------------------------------------------ routes

const json = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};

async function readJsonBody(req, limit = 2_000_000) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('payload too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function openStream(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`retry: 2000\n`);
  res.write(`event: state\ndata: ${snapshot()}\n\n`);
  clients.add(res);
  announcePresence();

  const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
  req.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
    announcePresence();
  });
}

// Everything the browser legitimately needs. Anything else in the project
// directory — draft.db, tools/, package.json — stays off the LAN.
const PUBLIC_FILES = new Set(['/index.html', '/bracket.html', '/styles.css']);
const PUBLIC_DIRS = ['/src/', '/assets/'];

const isPublic = (url) => PUBLIC_FILES.has(url) || PUBLIC_DIRS.some((dir) => url.startsWith(dir));

async function serveStatic(url, res) {
  const wanted = url === '/' ? '/index.html' : normalize(url);
  if (!isPublic(wanted)) return json(res, 403, { error: 'forbidden' });

  const path = join(ROOT, wanted);
  if (!path.startsWith(ROOT + sep)) return json(res, 403, { error: 'forbidden' });

  try {
    if ((await stat(path)).isDirectory()) return json(res, 403, { error: 'forbidden' });
    const body = await readFile(path);
    // Only sprites are safe to cache: markup, code and the pool must never be
    // stale, or a device would price a pick differently than the server does.
    const ext = extname(path);
    const cacheable = ext === '.png' || ext === '.gif' || ext === '.svg';
    res.writeHead(200, {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Cache-Control': cacheable ? 'max-age=86400' : 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
  }
}

const server = createServer(async (req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);

  if (url === '/api/events') return openStream(req, res);
  if (url === '/api/pool') return json(res, 200, POOL);
  if (url === '/api/state') return json(res, 200, JSON.parse(snapshot()));

  if (url === '/api/action') {
    if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
    // Optimistic concurrency: a device acting on a board it has not seen yet
    // (someone else just picked) is refused and handed the current state.
    if (body.revision !== undefined && body.revision !== revision) {
      return json(res, 409, { error: 'the board moved on — try again', revision, state });
    }
    try {
      commit(body.action);
    } catch (err) {
      return json(res, 400, { error: err.message, revision, state });
    }
    return json(res, 200, { revision, state });
  }

  if (url.startsWith('/api/')) return json(res, 404, { error: 'unknown endpoint' });
  return serveStatic(url, res);
});

server.listen(PORT, '0.0.0.0', () => {
  const addrs = Object.values(networkInterfaces())
    .flat()
    .filter((n) => n.family === 'IPv4' && !n.internal)
    .map((n) => n.address);
  console.log(`\n  draft board → http://localhost:${PORT}`);
  for (const a of addrs) console.log(`  on your LAN  → http://${a}:${PORT}`);
  console.log('');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    for (const res of clients) res.end();
    db.close();
    server.close(() => process.exit(0));
  });
}
