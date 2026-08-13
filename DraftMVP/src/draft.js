// Pure draft logic — no DOM, no storage. Every function takes the state object
// explicitly so it can be unit-tested in plain node.

import { emptyBracket } from './bracket.js';

export const STATE_VERSION = 1;

export function createState(defaultBudget = 100) {
  return {
    version: STATE_VERSION,
    defaultBudget,
    maxRoster: 0,        // 0 = unlimited; draft then ends on budget exhaustion
    players: [],
    order: [],           // player ids, randomized before the draft starts
    started: false,
    round: 0,            // 0-indexed; even = forward, odd = reversed (snake)
    pos: 0,              // index into turnOrder(round)
    taken: {},           // monName -> playerId
    costOverrides: {},   // monName -> cost, set from the in-app editor
    history: [],         // {playerId, mon, cost, round, pos}
    log: [],             // {type, ...} human-readable event trail
    bracket: emptyBracket(),
  };
}

/** Older saves and DB rows predate the tournament stage. */
export function ensureBracket(state) {
  if (!state.bracket) state.bracket = emptyBracket();
  return state;
}

// ------------------------------------------------------------------ players

let idSeed = 0;
const newId = () => `p${Date.now().toString(36)}${(idSeed++).toString(36)}`;

export function addPlayer(state, name, budget = state.defaultBudget) {
  if (state.started) throw new Error('cannot add players after the draft starts');
  const player = { id: newId(), name, budget, picks: [], done: false };
  state.players.push(player);
  state.order.push(player.id);
  return player;
}

export function removePlayer(state, id) {
  if (state.started) throw new Error('cannot remove players after the draft starts');
  state.players = state.players.filter((p) => p.id !== id);
  state.order = state.order.filter((x) => x !== id);
}

export const getPlayer = (state, id) => state.players.find((p) => p.id === id);

export const spent = (player) => player.picks.reduce((sum, pick) => sum + pick.cost, 0);
export const remaining = (player) => player.budget - spent(player);

// -------------------------------------------------------------------- costs

export function costOf(state, mon) {
  const override = state.costOverrides[mon.name];
  return override === undefined ? mon.cost : override;
}

export function setCost(state, monName, cost) {
  state.costOverrides[monName] = Math.max(0, Math.round(cost));
}

export const isTaken = (state, monName) => monName in state.taken;

export function available(state, pool) {
  return pool.filter((mon) => !isTaken(state, mon.name));
}

export function cheapestAvailable(state, pool) {
  let min = Infinity;
  for (const mon of pool) {
    if (isTaken(state, mon.name)) continue;
    const cost = costOf(state, mon);
    if (cost < min) min = cost;
  }
  return min;
}

// --------------------------------------------------------------------- turn

/** Snake: forward on even rounds, reversed on odd ones. */
export function turnOrder(state, round) {
  return round % 2 === 0 ? [...state.order] : [...state.order].reverse();
}

export function canPick(state, pool, player) {
  if (player.done) return false;
  if (state.maxRoster > 0 && player.picks.length >= state.maxRoster) return false;
  return remaining(player) >= cheapestAvailable(state, pool);
}

export function isComplete(state, pool) {
  if (!state.started) return false;
  return !state.players.some((p) => canPick(state, pool, p));
}

/**
 * Turn at or after the current cursor, skipping players who are done or broke.
 * Returns null when the draft is over.
 */
export function currentTurn(state, pool) {
  if (!state.started || isComplete(state, pool)) return null;

  let { round, pos } = state;
  // Bounded by: every full round either seats someone or the draft is complete,
  // which isComplete() already ruled out.
  for (let guard = 0; guard < 10000; guard++) {
    const order = turnOrder(state, round);
    if (order.length === 0) return null;
    if (pos >= order.length) { round += 1; pos = 0; continue; }

    const player = getPlayer(state, order[pos]);
    if (player && canPick(state, pool, player)) return { round, pos, playerId: player.id };
    pos += 1;
  }
  return null;
}

/** The next `count` turns after the current one, for the "up next" list. */
export function upcoming(state, pool, count = 5) {
  const turns = [];
  const scratch = { ...state, players: state.players.map((p) => ({ ...p, picks: [...p.picks] })) };
  const cheapest = cheapestAvailable(state, pool);

  let turn = currentTurn(scratch, pool);
  for (let i = 0; i < count && turn; i++) {
    scratch.round = turn.round;
    scratch.pos = turn.pos + 1;
    // Assume the picker spends the cheapest mon available, so players who are
    // about to run dry drop out of the preview instead of repeating forever.
    const player = getPlayer(scratch, turn.playerId);
    player.picks = [...player.picks, { name: '?', cost: cheapest }];
    turns.push(turn);
    turn = currentTurn(scratch, pool);
  }
  return turns;
}

// ------------------------------------------------------------------ actions

export function randomizeOrder(state) {
  if (state.started) throw new Error('order is locked once the draft starts');
  const ids = state.players.map((p) => p.id);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  state.order = ids;
  state.log.unshift({ type: 'order', names: ids.map((id) => getPlayer(state, id).name) });
}

export function startDraft(state) {
  if (state.players.length < 2) throw new Error('need at least two players');
  state.started = true;
  state.round = 0;
  state.pos = 0;
  state.log.unshift({ type: 'start', players: state.players.length });
}

export function pick(state, pool, monName) {
  const turn = currentTurn(state, pool);
  if (!turn) throw new Error('the draft is over');

  const mon = pool.find((m) => m.name === monName);
  if (!mon) throw new Error(`unknown pokemon: ${monName}`);
  if (isTaken(state, monName)) throw new Error(`${monName} is already drafted`);

  const player = getPlayer(state, turn.playerId);
  const cost = costOf(state, mon);
  if (cost > remaining(player)) throw new Error(`${player.name} cannot afford ${monName}`);

  player.picks.push({ name: monName, cost });
  state.taken[monName] = player.id;
  state.history.push({ playerId: player.id, mon: monName, cost, round: turn.round, pos: turn.pos });
  state.log.unshift({ type: 'pick', player: player.name, mon: monName, cost, round: turn.round + 1 });

  state.round = turn.round;
  state.pos = turn.pos + 1;
  return { player, cost };
}

export function undo(state) {
  const last = state.history.pop();
  if (!last) return null;

  const player = getPlayer(state, last.playerId);
  const at = player.picks.findIndex((p) => p.name === last.mon);
  if (at !== -1) player.picks.splice(at, 1);
  delete state.taken[last.mon];

  state.round = last.round;
  state.pos = last.pos;
  state.log.unshift({ type: 'undo', player: player.name, mon: last.mon });
  return last;
}

export function setDone(state, id, done) {
  const player = getPlayer(state, id);
  if (!player) return;
  player.done = done;
  state.log.unshift({ type: done ? 'done' : 'undone', player: player.name });
}
