// The one place a draft state can be mutated. The server applies every action
// through here so LAN clients stay byte-identical; clients never mutate locally.

import {
  STATE_VERSION, createState, addPlayer, removePlayer, randomizeOrder, startDraft,
  pick, undo, setDone, setCost, ensureBracket,
} from './draft.js';
import { emptyBracket, draw as drawBracket, report, clear } from './bracket.js';

const str = (v, field) => {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${field} is required`);
  return v.trim().slice(0, 40);
};

const num = (v, field, min = 0) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min) throw new Error(`${field} must be a number >= ${min}`);
  return Math.round(n);
};

/**
 * Applies `action` to `state` and returns the state to keep (usually the same
 * object; reset/import return a new one). Throws on anything illegal.
 */
export function applyAction(state, pool, action) {
  switch (action?.type) {
    case 'addPlayer':
      addPlayer(state, str(action.name, 'name'), num(action.budget ?? state.defaultBudget, 'budget', 1));
      return state;

    case 'removePlayer':
      removePlayer(state, str(action.id, 'id'));
      return state;

    case 'setBudget': {
      const budget = num(action.budget, 'budget', 1);
      if (state.started) throw new Error('budget is locked once the draft starts');
      state.defaultBudget = budget;
      for (const p of state.players) p.budget = budget;
      return state;
    }

    case 'setMaxRoster':
      if (state.started) throw new Error('roster cap is locked once the draft starts');
      state.maxRoster = num(action.maxRoster, 'maxRoster');
      return state;

    case 'randomizeOrder':
      randomizeOrder(state);
      return state;

    case 'start':
      startDraft(state);
      return state;

    case 'pick':
      pick(state, pool, str(action.mon, 'mon'));
      return state;

    case 'undo':
      undo(state);
      return state;

    case 'setDone':
      setDone(state, str(action.id, 'id'), Boolean(action.done));
      return state;

    case 'setCost': {
      const mon = str(action.mon, 'mon');
      if (!pool.some((m) => m.name === mon)) throw new Error(`unknown pokemon: ${mon}`);
      setCost(state, mon, num(action.cost, 'cost'));
      state.log.unshift({ type: 'cost', mon, cost: num(action.cost, 'cost') });
      return state;
    }

    // ---- tournament stage ------------------------------------------------

    case 'drawBracket': {
      ensureBracket(state);
      state.bracket = drawBracket(state.bracket, state.players.map((p) => p.id));
      const order = state.bracket.seeds.map((id) => state.players.find((p) => p.id === id).name);
      state.log.unshift({ type: 'draw', names: order });
      return state;
    }

    case 'reportMatch': {
      ensureBracket(state);
      const id = str(action.id, 'match id');
      const winner = str(action.winner, 'winner');
      const score = [num(action.score?.[0], 'games'), num(action.score?.[1], 'games')];
      report(state.bracket, id, winner, score);
      state.log.unshift({
        type: 'match',
        match: id,
        player: state.players.find((p) => p.id === winner)?.name ?? winner,
        score: score.join('–'),
      });
      return state;
    }

    case 'clearMatch':
      ensureBracket(state);
      clear(state.bracket, str(action.id, 'match id'));
      state.log.unshift({ type: 'clearMatch', match: action.id });
      return state;

    case 'resetBracket':
      state.bracket = emptyBracket();
      state.log.unshift({ type: 'resetBracket' });
      return state;

    case 'reset':
      return createState(state.defaultBudget);

    // An imported file replaces the board for every device, so it is checked
    // field by field rather than trusted — a malformed one would wedge everyone.
    case 'import': {
      const s = action.state;
      if (!s || typeof s !== 'object' || s.version !== STATE_VERSION) throw new Error('unsupported save file');
      if (!Array.isArray(s.players) || !Array.isArray(s.history) || !Array.isArray(s.order)) {
        throw new Error('malformed save file');
      }
      if (!s.taken || typeof s.taken !== 'object' || !s.costOverrides || typeof s.costOverrides !== 'object') {
        throw new Error('malformed save file');
      }
      for (const p of s.players) {
        if (typeof p?.id !== 'string' || typeof p?.name !== 'string') throw new Error('malformed player entry');
        if (!Number.isFinite(p.budget) || !Array.isArray(p.picks)) throw new Error('malformed player entry');
      }
      for (const mon of Object.keys(s.taken)) {
        if (!pool.some((m) => m.name === mon)) throw new Error(`save file references unknown pokemon: ${mon}`);
      }
      return ensureBracket({
        ...s,
        defaultBudget: num(s.defaultBudget, 'defaultBudget', 1),
        maxRoster: num(s.maxRoster ?? 0, 'maxRoster'),
        round: num(s.round ?? 0, 'round'),
        pos: num(s.pos ?? 0, 'pos'),
        started: Boolean(s.started),
        log: Array.isArray(s.log) ? s.log : [],
      });
    }

    default:
      throw new Error(`unknown action: ${action?.type}`);
  }
}
