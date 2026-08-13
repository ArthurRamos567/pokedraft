// node --test tools/bracket.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyBracket, roundRobin, draw, standings, roundRobinComplete, report, clear,
  findMatch, allMatches, champion,
} from '../src/bracket.js';

const EIGHT = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];

/** Deterministic "shuffle": identity, so seeds come out in the given order. */
const noShuffle = () => 0.9999999;

const drawn = (ids = EIGHT) => draw(emptyBracket(), ids, noShuffle);

test('8 players: 7 rounds of 4, every pair exactly once', () => {
  const rounds = roundRobin(EIGHT);
  assert.equal(rounds.length, 7);
  assert.ok(rounds.every((r) => r.length === 4));

  const pairs = new Set();
  for (const m of rounds.flat()) pairs.add([m.a, m.b].sort().join('|'));
  assert.equal(pairs.size, 28);           // C(8,2)
  assert.equal(rounds.flat().length, 28);

  for (const round of rounds) {           // nobody plays twice in a round
    const seen = round.flatMap((m) => [m.a, m.b]);
    assert.equal(new Set(seen).size, seen.length);
  }
});

test('odd counts get byes, not phantom opponents', () => {
  const rounds = roundRobin(['a', 'b', 'c', 'd', 'e']);
  assert.equal(rounds.length, 5);
  assert.ok(rounds.every((r) => r.length === 2));
  assert.ok(rounds.flat().every((m) => m.a && m.b));
  assert.equal(rounds.flat().length, 10); // C(5,2)
});

test('draw keeps every player exactly once and refuses a lone player', () => {
  const b = drawn();
  assert.deepEqual([...b.seeds].sort(), [...EIGHT].sort());
  assert.equal(b.drawn, true);
  assert.throws(() => draw(emptyBracket(), ['solo']), /two players/);
});

test('reporting validates the winner and the score', () => {
  const b = drawn();
  const m = b.rounds[0][0];
  assert.throws(() => report(b, m.id, 'p99', [2, 0]), /must be one of/);
  assert.throws(() => report(b, m.id, m.a, [0, 2]), /more games than/);
  assert.throws(() => report(b, m.id, m.a, [2, 2]), /more games than/);
  assert.throws(() => report(b, m.id, m.a, [2, 1.5]), /whole numbers/);
  assert.throws(() => report(b, 'nope', m.a, [2, 0]), /unknown match/);

  report(b, m.id, m.a, [2, 1]);
  assert.equal(findMatch(b, m.id).winner, m.a);
  assert.deepEqual(findMatch(b, m.id).score, [2, 1]);
});

/** Plays out every round-robin match; `winnerOf` picks the winner. */
function playAll(b, winnerOf = (m) => m.a) {
  for (const m of b.rounds.flat()) {
    const winner = winnerOf(m);
    report(b, m.id, winner, winner === m.a ? [2, 0] : [0, 2]); // score is [a, b]
  }
  return b;
}

test('standings order by wins, then game difference', () => {
  const b = drawn();
  // seed order p1..p8; lower index always wins → strict pecking order
  playAll(b, (m) => (EIGHT.indexOf(m.a) < EIGHT.indexOf(m.b) ? m.a : m.b));
  const table = standings(b);
  assert.deepEqual(table.map((r) => r.id), EIGHT);
  assert.equal(table[0].wins, 7);
  assert.equal(table[0].losses, 0);
  assert.equal(table.at(-1).wins, 0);
  assert.equal(table[0].diff, 14);        // 7 × (2-0)
});

test('head-to-head breaks a tie the game difference cannot', () => {
  const b = draw(emptyBracket(), ['a', 'b'], noShuffle);
  report(b, b.rounds[0][0].id, 'b', [0, 2]);
  const [first] = standings(b);
  assert.equal(first.id, 'b');
});

test('the cut appears only when the round robin is complete', () => {
  const b = drawn();
  assert.equal(b.cut, null);
  const games = b.rounds.flat();
  for (const m of games.slice(0, -1)) report(b, m.id, m.a, [2, 0]);
  assert.equal(roundRobinComplete(b), false);
  assert.equal(b.cut, null);

  report(b, games.at(-1).id, games.at(-1).a, [2, 0]);
  assert.equal(roundRobinComplete(b), true);
  assert.ok(b.cut, 'cut built');
  assert.equal(b.cut.semis.length, 2);
});

test('top 4 are seeded 1v4 and 2v3', () => {
  const b = drawn();
  playAll(b, (m) => (EIGHT.indexOf(m.a) < EIGHT.indexOf(m.b) ? m.a : m.b));
  const top = standings(b).slice(0, 4).map((r) => r.id);
  assert.deepEqual([b.cut.semis[0].a, b.cut.semis[0].b], [top[0], top[3]]);
  assert.deepEqual([b.cut.semis[1].a, b.cut.semis[1].b], [top[1], top[2]]);
});

test('semi results feed the final and the 3rd-place match', () => {
  const b = drawn();
  playAll(b, (m) => (EIGHT.indexOf(m.a) < EIGHT.indexOf(m.b) ? m.a : m.b));
  const [sf1, sf2] = b.cut.semis;

  report(b, sf1.id, sf1.a, [2, 0]);
  report(b, sf2.id, sf2.b, [1, 2]);

  assert.deepEqual([b.cut.final.a, b.cut.final.b], [sf1.a, sf2.b]);
  assert.deepEqual([b.cut.third.a, b.cut.third.b], [sf1.b, sf2.a]);

  report(b, 'final', b.cut.final.b, [0, 3]);
  assert.equal(champion(b), sf2.b);
});

test('clearing a semi result unwinds the final', () => {
  const b = drawn();
  playAll(b, (m) => (EIGHT.indexOf(m.a) < EIGHT.indexOf(m.b) ? m.a : m.b));
  const [sf1, sf2] = b.cut.semis;
  report(b, sf1.id, sf1.a, [2, 0]);
  report(b, sf2.id, sf2.a, [2, 0]);
  report(b, 'final', sf1.a, [2, 0]);
  assert.equal(champion(b), sf1.a);

  clear(b, sf1.id);
  assert.equal(b.cut.final.a, null);
  assert.equal(champion(b), null, 'a final without both players keeps no winner');
});

test('clearing a round-robin result tears the cut down', () => {
  const b = drawn();
  playAll(b);
  assert.ok(b.cut);
  clear(b, b.rounds[0][0].id);
  assert.equal(b.cut, null);
  assert.equal(roundRobinComplete(b), false);
});

test('re-reporting a round-robin match keeps cut results when the top 4 hold', () => {
  const b = drawn();
  playAll(b, (m) => (EIGHT.indexOf(m.a) < EIGHT.indexOf(m.b) ? m.a : m.b));
  const [sf1] = b.cut.semis;
  report(b, sf1.id, sf1.a, [2, 0]);

  // 7th vs 8th changes nothing at the top
  const bottom = b.rounds.flat().find((m) => [m.a, m.b].every((p) => ['p7', 'p8'].includes(p)));
  report(b, bottom.id, 'p8', bottom.a === 'p8' ? [2, 1] : [1, 2]);

  assert.equal(findMatch(b, sf1.id).winner, sf1.a, 'semi result survived');
});

test('fewer than four players: a straight final, no semis', () => {
  const b = draw(emptyBracket(), ['a', 'b', 'c'], noShuffle);
  for (const m of b.rounds.flat()) report(b, m.id, m.a, [2, 0]);
  assert.equal(b.cut.semis.length, 1);
  assert.ok(b.cut.final.a && b.cut.final.b);
});

test('allMatches covers the cut once it exists', () => {
  const b = drawn();
  assert.equal(allMatches(b).length, 28);
  playAll(b);
  assert.equal(allMatches(b).length, 28 + 4);
});
