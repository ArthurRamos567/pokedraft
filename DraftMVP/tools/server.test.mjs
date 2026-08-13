// node --test tools/server.test.mjs
// Boots a real server on a throwaway SQLite file and exercises the LAN sync
// contract: SSE push, optimistic concurrency, and no double-drafting.

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4899;
const BASE = `http://127.0.0.1:${PORT}`;

let child;
let dir;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pokedraft-'));
  child = spawn('node', [join(ROOT, 'tools/server.mjs'), String(PORT), join(dir, 'test.db')], {
    cwd: ROOT, stdio: 'ignore',
  });
  for (let i = 0; i < 60; i++) {
    try { await fetch(`${BASE}/api/state`); return; } catch { await sleep(100); }
  }
  throw new Error('server did not start');
});

after(async () => {
  child.kill('SIGTERM');
  await rm(dir, { recursive: true, force: true });
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getState = () => fetch(`${BASE}/api/state`).then((r) => r.json());

async function send(action, revision) {
  const res = await fetch(`${BASE}/api/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, revision }),
  });
  return { status: res.status, body: await res.json() };
}

/** Collects SSE events until `stop()` is called. */
function listen() {
  const events = [];
  const controller = new AbortController();
  const done = (async () => {
    const res = await fetch(`${BASE}/api/events`, { signal: controller.signal });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { value, done: end } = await reader.read();
        if (end) break;
        buffer += decoder.decode(value, { stream: true });
        let at;
        while ((at = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, at);
          buffer = buffer.slice(at + 2);
          const type = /^event: (.+)$/m.exec(frame)?.[1];
          const data = /^data: (.+)$/m.exec(frame)?.[1];
          if (type && data) events.push({ type, data: JSON.parse(data) });
        }
      }
    } catch { /* aborted */ }
  })();
  return { events, stop: () => { controller.abort(); return done; } };
}

test('serves the pool and an initial state', async () => {
  const pool = await (await fetch(`${BASE}/api/pool`)).json();
  assert.ok(pool.length > 100);
  const { revision, state } = await getState();
  assert.equal(typeof revision, 'number');
  assert.deepEqual(state.players, []);
});

test('a new subscriber immediately gets a state frame', async () => {
  const sub = listen();
  await sleep(300);
  await sub.stop();
  assert.equal(sub.events[0].type, 'state');
  assert.ok('revision' in sub.events[0].data);
});

test('actions are pushed to every connected device', async () => {
  const a = listen();
  const b = listen();
  await sleep(300);

  await send({ type: 'addPlayer', name: 'Ana' });
  await send({ type: 'addPlayer', name: 'Bruno' });
  await sleep(300);

  await a.stop();
  await b.stop();

  for (const sub of [a, b]) {
    const last = sub.events.filter((e) => e.type === 'state').at(-1);
    assert.deepEqual(last.data.state.players.map((p) => p.name), ['Ana', 'Bruno']);
  }
  // both devices saw the presence count rise
  assert.ok(a.events.some((e) => e.type === 'presence' && e.data.devices >= 2));
});

test('stale revisions are refused and handed the current board', async () => {
  const { revision } = await getState();
  const stale = await send({ type: 'addPlayer', name: 'Ghost' }, revision - 1);
  assert.equal(stale.status, 409);
  assert.equal(stale.body.revision, revision);
  assert.ok(stale.body.state, 'the 409 carries the real state');
  const now = await getState();
  assert.ok(!now.state.players.some((p) => p.name === 'Ghost'));
});

test('invalid actions are rejected without bumping the revision', async () => {
  const before = await getState();
  const bad = await send({ type: 'addPlayer', name: '   ' });
  assert.equal(bad.status, 400);
  assert.equal((await getState()).revision, before.revision);

  const unknown = await send({ type: 'nope' });
  assert.equal(unknown.status, 400);
  assert.match(unknown.body.error, /unknown action/);
});

test('two devices racing for the same pokemon: exactly one wins', async () => {
  await send({ type: 'randomizeOrder' });
  await send({ type: 'start' });
  const { revision } = await getState();
  const pool = await (await fetch(`${BASE}/api/pool`)).json();
  const mon = pool.find((m) => m.cost <= 20).name;

  // same revision, sent simultaneously — the server serializes them
  const [first, second] = await Promise.all([
    send({ type: 'pick', mon }, revision),
    send({ type: 'pick', mon }, revision),
  ]);

  const codes = [first.status, second.status].sort();
  assert.deepEqual(codes, [200, 409], 'one accepted, one refused as stale');

  const { state } = await getState();
  assert.equal(state.history.filter((h) => h.mon === mon).length, 1);
  assert.equal(Object.values(state.taken).filter((v) => v).length, 1);
});

test('state survives a server restart (sqlite)', async () => {
  const before = await getState();
  child.kill('SIGTERM');
  await sleep(400);

  child = spawn('node', [join(ROOT, 'tools/server.mjs'), String(PORT), join(dir, 'test.db')], {
    cwd: ROOT, stdio: 'ignore',
  });
  for (let i = 0; i < 60; i++) {
    try { await fetch(`${BASE}/api/state`); break; } catch { await sleep(100); }
  }

  const after = await getState();
  assert.equal(after.revision, before.revision);
  assert.deepEqual(after.state.history, before.state.history);
  assert.deepEqual(after.state.players.map((p) => p.name), before.state.players.map((p) => p.name));
});
