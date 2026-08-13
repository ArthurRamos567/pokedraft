// node --test tools/draft.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createState, addPlayer, startDraft, randomizeOrder, currentTurn, pick, undo,
  remaining, isComplete, cheapestAvailable, setDone, upcoming, setCost,
} from '../src/draft.js';

const mon = (name, cost) => ({ name, cost, tier: 'OU', ranks: { OU: 'A' }, types: ['Normal'], abilities: [], bst: 500 });
const POOL = [mon('Alpha', 10), mon('Bravo', 10), mon('Charlie', 5), mon('Delta', 5), mon('Echo', 3), mon('Foxtrot', 3)];

function setup(budget, names = ['P1', 'P2', 'P3']) {
  const s = createState(budget);
  names.forEach((n) => addPlayer(s, n, budget));
  startDraft(s);
  return s;
}

const who = (s) => {
  const t = currentTurn(s, POOL);
  return t ? s.players.find((p) => p.id === t.playerId).name : null;
};

test('snake order: forward, then backward with a double pick at the turn', () => {
  const s = setup(100);
  const seen = [];
  for (let i = 0; i < 6; i++) {
    seen.push(who(s));
    pick(s, POOL, POOL[i].name);
  }
  assert.deepEqual(seen, ['P1', 'P2', 'P3', 'P3', 'P2', 'P1']);
});

test('players who cannot afford the cheapest mon are skipped, not blocked', () => {
  const s = setup(10);
  pick(s, POOL, 'Alpha');            // P1 spends all 10
  assert.equal(remaining(s.players[0]), 0);
  pick(s, POOL, 'Charlie');          // P2 -> 5 left
  pick(s, POOL, 'Echo');             // P3 -> 7 left
  assert.equal(who(s), 'P3');        // round 2 reversed, P3 again
  pick(s, POOL, 'Foxtrot');          // P3 -> 4 left
  assert.equal(who(s), 'P2');
  pick(s, POOL, 'Delta');            // P2 -> 0 left
  assert.equal(who(s), null);        // P1 broke, P2 broke, P3 has 4 but nothing < 4 remains
  assert.equal(isComplete(s, POOL), true);
});

test('draft ends when the pool runs out', () => {
  const s = setup(1000, ['A', 'B']);
  for (const m of POOL) pick(s, POOL, m.name);
  assert.equal(cheapestAvailable(s, POOL), Infinity);
  assert.equal(isComplete(s, POOL), true);
  assert.throws(() => pick(s, POOL, 'Alpha'), /over/);
});

test('undo restores budget, pool and turn', () => {
  const s = setup(100);
  pick(s, POOL, 'Alpha');
  pick(s, POOL, 'Bravo');
  assert.equal(who(s), 'P3');
  undo(s);
  assert.equal(who(s), 'P2');
  assert.equal(remaining(s.players[1]), 100);
  assert.equal('Bravo' in s.taken, false);
  pick(s, POOL, 'Bravo');            // re-drafting the undone mon works
  assert.equal(s.players[1].picks[0].name, 'Bravo');
});

test('rejects illegal picks', () => {
  const s = setup(6);
  pick(s, POOL, 'Charlie');
  assert.throws(() => pick(s, POOL, 'Charlie'), /already drafted/);
  assert.throws(() => pick(s, POOL, 'Nobody'), /unknown/);
  const s2 = setup(4);
  assert.throws(() => pick(s2, POOL, 'Alpha'), /cannot afford/);
});

test('maxRoster ends a player early', () => {
  const s = createState(100);
  ['P1', 'P2'].forEach((n) => addPlayer(s, n, 100));
  s.maxRoster = 1;
  startDraft(s);
  pick(s, POOL, 'Alpha');
  pick(s, POOL, 'Bravo');
  assert.equal(isComplete(s, POOL), true);
});

test('mark done removes a player from the rotation', () => {
  const s = setup(100);
  setDone(s, s.players[0].id, true);
  assert.equal(who(s), 'P2');
});

test('cost overrides drive affordability', () => {
  const s = setup(10);
  setCost(s, 'Alpha', 11);
  assert.throws(() => pick(s, POOL, 'Alpha'), /cannot afford/);
  setCost(s, 'Alpha', 2);
  pick(s, POOL, 'Alpha');
  assert.equal(remaining(s.players[0]), 8);
});

test('upcoming preview does not mutate state and terminates', () => {
  const s = setup(12);
  const before = JSON.stringify(s);
  const next = upcoming(s, POOL, 10);
  assert.equal(JSON.stringify(s), before);
  assert.ok(next.length > 0 && next.length <= 10);
});

test('randomizeOrder keeps every player exactly once', () => {
  const s = createState(100);
  ['A', 'B', 'C', 'D'].forEach((n) => addPlayer(s, n, 100));
  randomizeOrder(s);
  assert.deepEqual([...s.order].sort(), s.players.map((p) => p.id).sort());
  startDraft(s);
  assert.throws(() => randomizeOrder(s), /locked/);
});
