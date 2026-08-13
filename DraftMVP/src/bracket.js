// Tournament stage: a full round robin, then a single-elimination cut for the
// top four. Pure functions over a `bracket` object — no DOM, no I/O.

export const emptyBracket = () => ({
  drawn: false,
  seeds: [],      // player ids in draw order; seed 1 is seeds[0]
  rounds: [],     // [[match, …], …] — one array per round-robin round
  cut: null,      // { semis: [match, match], final: match, third: match }
});

const match = (id, a, b) => ({ id, a, b, winner: null, score: null });

export const allMatches = (bracket) => [
  ...bracket.rounds.flat(),
  ...(bracket.cut ? [...bracket.cut.semis, bracket.cut.final, bracket.cut.third] : []),
];

export const findMatch = (bracket, id) => allMatches(bracket).find((m) => m.id === id);

/**
 * Circle method: fix the first seed, rotate the rest. For n players it yields
 * n-1 rounds of n/2 matches, and every pair meets exactly once. An odd count
 * gets a `null` opponent, which is a bye.
 */
export function roundRobin(seeds) {
  const ids = [...seeds];
  if (ids.length % 2) ids.push(null);

  const half = ids.length / 2;
  const rotating = ids.slice(1);
  const rounds = [];

  for (let r = 0; r < ids.length - 1; r++) {
    const line = [ids[0], ...rotating];
    const games = [];
    for (let i = 0; i < half; i++) {
      const a = line[i];
      const b = line[line.length - 1 - i];
      if (a !== null && b !== null) games.push(match(`rr-${r + 1}-${i + 1}`, a, b));
    }
    rounds.push(games);
    rotating.unshift(rotating.pop()); // rotate clockwise for the next round
  }
  return rounds;
}

export function draw(bracket, playerIds, random = Math.random) {
  if (playerIds.length < 2) throw new Error('need at least two players');
  const seeds = [...playerIds];
  for (let i = seeds.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [seeds[i], seeds[j]] = [seeds[j], seeds[i]];
  }
  return { drawn: true, seeds, rounds: roundRobin(seeds), cut: null };
}

// ---------------------------------------------------------------- standings

/**
 * One row per seed, ordered by: match wins, then game difference, then the
 * head-to-head result, then games won, then seed. Only round-robin games count.
 */
export function standings(bracket) {
  const rows = new Map(bracket.seeds.map((id, seed) => ({
    id, seed, played: 0, wins: 0, losses: 0, gamesFor: 0, gamesAgainst: 0, beat: new Set(),
  })).map((row) => [row.id, row]));

  for (const m of bracket.rounds.flat()) {
    if (!m.winner) continue;
    const [ga, gb] = m.score ?? [0, 0];
    const a = rows.get(m.a);
    const b = rows.get(m.b);
    if (!a || !b) continue;

    a.played++; b.played++;
    a.gamesFor += ga; a.gamesAgainst += gb;
    b.gamesFor += gb; b.gamesAgainst += ga;

    const winner = m.winner === m.a ? a : b;
    const loser = m.winner === m.a ? b : a;
    winner.wins++; loser.losses++;
    winner.beat.add(loser.id);
  }

  return [...rows.values()]
    .map((r) => ({ ...r, diff: r.gamesFor - r.gamesAgainst }))
    .sort((x, y) =>
      y.wins - x.wins ||
      y.diff - x.diff ||
      (x.beat.has(y.id) ? -1 : y.beat.has(x.id) ? 1 : 0) ||
      y.gamesFor - x.gamesFor ||
      x.seed - y.seed);
}

export const roundRobinComplete = (bracket) =>
  bracket.rounds.length > 0 && bracket.rounds.flat().every((m) => m.winner);

/**
 * Builds the cut once the round robin is done, and tears it down again if a
 * result is later cleared. Existing cut results are kept when the qualifiers
 * are unchanged, so reporting a semi does not rebuild it out from under you.
 */
export function syncCut(bracket) {
  if (!roundRobinComplete(bracket)) {
    bracket.cut = null;
    return bracket;
  }

  const table = standings(bracket);
  const top = table.slice(0, 4).map((r) => r.id);

  const wanted = top.length >= 4
    ? [[top[0], top[3]], [top[1], top[2]]]
    : [[top[0], top[1] ?? null]];

  const sameSemis = bracket.cut?.semis.length === wanted.length &&
    bracket.cut.semis.every((m, i) => m.a === wanted[i][0] && m.b === wanted[i][1]);
  if (sameSemis) return bracket;

  bracket.cut = {
    semis: wanted.map(([a, b], i) => match(`sf${i + 1}`, a, b)),
    final: match('final', null, null),
    third: match('third', null, null),
  };
  advanceCut(bracket);
  return bracket;
}

/** Feeds semi-final winners into the final and losers into the 3rd-place match. */
export function advanceCut(bracket) {
  const cut = bracket.cut;
  if (!cut) return;

  if (cut.semis.length === 1) {                 // fewer than four players
    cut.final.a = cut.semis[0].a;
    cut.final.b = cut.semis[0].b;
    return;
  }

  const winnerOf = (m) => m.winner;
  const loserOf = (m) => (m.winner ? (m.winner === m.a ? m.b : m.a) : null);

  const [sf1, sf2] = cut.semis;
  for (const [slot, pick] of [['a', sf1], ['b', sf2]]) {
    if (cut.final[slot] !== winnerOf(pick)) { cut.final[slot] = winnerOf(pick); resetIfOrphaned(cut.final); }
    if (cut.third[slot] !== loserOf(pick)) { cut.third[slot] = loserOf(pick); resetIfOrphaned(cut.third); }
  }
}

/** A result cannot survive its participants changing. */
function resetIfOrphaned(m) {
  if (m.winner && m.winner !== m.a && m.winner !== m.b) { m.winner = null; m.score = null; }
  if (!m.a || !m.b) { m.winner = null; m.score = null; }
}

// ------------------------------------------------------------------ results

export function report(bracket, id, winner, score) {
  const m = findMatch(bracket, id);
  if (!m) throw new Error(`unknown match: ${id}`);
  if (!m.a || !m.b) throw new Error('that match has no opponents yet');
  if (winner !== m.a && winner !== m.b) throw new Error('the winner must be one of the two players');

  const [ga, gb] = score;
  if (![ga, gb].every((g) => Number.isInteger(g) && g >= 0 && g <= 9)) {
    throw new Error('games must be whole numbers between 0 and 9');
  }
  const winnerGames = winner === m.a ? ga : gb;
  const loserGames = winner === m.a ? gb : ga;
  if (winnerGames <= loserGames) throw new Error('the winner needs more games than the loser');

  m.winner = winner;
  m.score = [ga, gb];

  syncCut(bracket);
  advanceCut(bracket);
  return bracket;
}

export function clear(bracket, id) {
  const m = findMatch(bracket, id);
  if (!m) throw new Error(`unknown match: ${id}`);
  m.winner = null;
  m.score = null;

  syncCut(bracket);
  advanceCut(bracket);
  return bracket;
}

export const champion = (bracket) => bracket.cut?.final?.winner ?? null;
