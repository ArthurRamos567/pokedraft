import {
  getPlayer, remaining, costOf, isTaken, cheapestAvailable, turnOrder, canPick, currentTurn, upcoming,
} from './draft.js';
import { standings, roundRobinComplete, champion } from './bracket.js';

// The server owns the draft. This client renders `state`, sends actions over
// POST /api/action and re-renders whenever /api/events pushes a new revision.

// Fetched from the server rather than data/pool.json directly: it is the exact
// pool the server prices picks against, even if the file changed since boot.
const POOL = await (await fetch('api/pool')).json();

let revision = 0;
let state = null;

/** Purely local view preferences — never synced. */
const ui = { view: 'draft', search: '', tier: 'ALL', sort: 'cost-desc', affordableOnly: false, hideTaken: true };

const TYPE_COLORS = {
  Normal: '#a8a878', Fire: '#f08030', Water: '#6890f0', Electric: '#f8d030',
  Grass: '#78c850', Ice: '#98d8d8', Fighting: '#c03028', Poison: '#a040a0',
  Ground: '#e0c068', Flying: '#a890f0', Psychic: '#f85888', Bug: '#a8b820',
  Rock: '#b8a038', Ghost: '#705898', Dragon: '#7038f8', Dark: '#705848',
  Steel: '#b8b8d0', Fairy: '#ee99ac',
};

const $ = (sel) => document.querySelector(sel);

// ---------------------------------------------------------------- transport

let toastTimer = null;

function toast(message, kind = 'info') {
  const el = $('#toast');
  el.textContent = message;
  el.className = `toast ${kind}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}

function adopt(payload) {
  revision = payload.revision;
  state = payload.state;
  render();
}

// Actions from this device are sent one at a time. Firing two in parallel would
// make the second carry the revision the first is about to invalidate, and the
// server would refuse it as stale — which is exactly what a fast typist does
// when adding four players in a row.
let queue = Promise.resolve(true);

const act = (action) => (queue = queue.then(() => send(action)));

/** Sends an action; the answer (or the SSE push) updates the board. */
async function send(action) {
  try {
    const res = await fetch('api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision, action }),
    });
    const payload = await res.json();

    if (res.ok) { adopt(payload); return true; }

    if (payload.state) adopt(payload);           // 400/409 carry the truth with them
    toast(res.status === 409 ? 'Board changed — have another look.' : payload.error, 'bad');
    return false;
  } catch (err) {
    toast(`Server unreachable: ${err.message}`, 'bad');
    return false;
  }
}

function connect() {
  const source = new EventSource('api/events');

  source.addEventListener('state', (ev) => adopt(JSON.parse(ev.data)));
  source.addEventListener('presence', (ev) => {
    const { devices } = JSON.parse(ev.data);
    $('#devices').textContent = `${devices} device${devices === 1 ? '' : 's'}`;
  });
  source.onopen = () => setLink(true);
  source.onerror = () => setLink(false);   // EventSource reconnects on its own
}

function setLink(online) {
  const el = $('#link');
  el.classList.toggle('online', online);
  el.classList.toggle('offline', !online);
  el.title = online ? 'live — synced with the server' : 'reconnecting to the server…';
}

// ---------------------------------------------------------------- rendering

function render() {
  if (!state) return;
  $('#view-draft').hidden = ui.view !== 'draft';
  $('#view-bracket').hidden = ui.view !== 'bracket';

  renderSetup();
  if (ui.view === 'draft') {
    renderPlayers();
    renderBoard();
    renderStore();
  } else {
    renderBracket();
  }
}

function renderSetup() {
  // Draft-only controls: meaningless while looking at the bracket.
  const draftView = ui.view === 'draft';
  for (const sel of ['#btn-randomize', '#btn-start', '#btn-undo', '.setup']) {
    $(sel).hidden = !draftView;
  }

  $('#default-budget').value = state.defaultBudget;
  $('#max-roster').value = state.maxRoster;
  $('#default-budget').disabled = state.started;
  $('#max-roster').disabled = state.started;
  $('#btn-randomize').disabled = state.started || state.players.length < 2;
  $('#btn-start').disabled = state.started || state.players.length < 2;
  $('#btn-start').textContent = state.started ? 'Draft running' : 'Start draft';
  $('#btn-undo').disabled = state.history.length === 0;
  $('#add-player button').disabled = state.started;
  $('#player-name').disabled = state.started;
}

function renderPlayers() {
  const list = $('#player-list');
  const turn = currentTurn(state, POOL);
  const cheapest = cheapestAvailable(state, POOL);
  list.replaceChildren();

  const ordered = state.started
    ? state.order.map((id) => getPlayer(state, id)).filter(Boolean)
    : state.players;

  for (const player of ordered) {
    const left = remaining(player);
    const broke = state.started && !canPick(state, POOL, player);

    const li = document.createElement('li');
    li.className = 'player' + (turn?.playerId === player.id ? ' active' : '') + (broke ? ' broke' : '');

    const head = document.createElement('div');
    head.className = 'player-head';
    head.innerHTML =
      `<span class="player-name"></span>` +
      `<span class="player-pts${left < cheapest ? ' low' : ''}"><b>${left}</b> <span class="muted">/ ${player.budget}</span></span>`;
    head.querySelector('.player-name').textContent = player.name;
    li.append(head);

    if (player.picks.length) {
      const roster = document.createElement('ul');
      roster.className = 'roster';
      for (const p of player.picks) {
        const mon = POOL.find((m) => m.name === p.name);
        const item = document.createElement('li');
        item.innerHTML = `<img src="${mon?.sprite ?? ''}" alt="" loading="lazy"><span></span><span class="c">${p.cost}</span>`;
        item.querySelector('span').textContent = p.name;
        roster.append(item);
      }
      li.append(roster);
    }

    const tools = document.createElement('div');
    tools.className = 'player-tools';
    if (!state.started) {
      const del = document.createElement('button');
      del.className = 'danger';
      del.textContent = 'Remove';
      del.onclick = () => act({ type: 'removePlayer', id: player.id });
      tools.append(del);
    } else {
      const done = document.createElement('button');
      done.className = 'ghost';
      done.textContent = player.done ? 'Un-finish' : 'Mark done';
      done.onclick = () => act({ type: 'setDone', id: player.id, done: !player.done });
      tools.append(done);
    }
    li.append(tools);
    list.append(li);
  }
}

function renderBoard() {
  const turn = currentTurn(state, POOL);
  const box = $('#turn');

  if (!state.started) {
    box.className = 'turn';
    box.innerHTML = `<div class="who">Setup</div><div class="meta">add players, randomize, then start</div>`;
  } else if (!turn) {
    box.className = 'turn over';
    box.innerHTML = `<div class="who">Draft complete</div><div class="meta">${state.history.length} picks made</div>`;
  } else {
    const player = getPlayer(state, turn.playerId);
    const dir = turn.round % 2 === 0 ? '→ forward' : '← backward';
    box.className = 'turn';
    box.innerHTML =
      `<div class="meta">round ${turn.round + 1} ${dir}</div>` +
      `<div class="who"></div>` +
      `<div class="meta">${remaining(player)} points left</div>`;
    box.querySelector('.who').textContent = player.name;
  }

  const order = $('#order-list');
  order.replaceChildren();
  const round = turn?.round ?? state.round;
  const activeOrder = state.started ? turnOrder(state, round) : state.order;
  $('#order-title').textContent = state.started
    ? `Order · round ${round + 1} ${round % 2 === 0 ? '→' : '←'}`
    : 'Order';

  for (const id of activeOrder) {
    const player = getPlayer(state, id);
    if (!player) continue;
    const li = document.createElement('li');
    if (turn?.playerId === id) li.classList.add('active');
    li.textContent = player.name;
    order.append(li);
  }

  const next = $('#upnext');
  next.replaceChildren();
  for (const t of upcoming(state, POOL, 6).slice(1)) {
    const li = document.createElement('li');
    li.textContent = getPlayer(state, t.playerId).name;
    const rnd = document.createElement('span');
    rnd.className = 'rnd';
    rnd.textContent = `R${t.round + 1}`;
    li.append(rnd);
    next.append(li);
  }

  const log = $('#log');
  log.replaceChildren();
  for (const entry of state.log.slice(0, 40)) {
    const li = document.createElement('li');
    if (entry.type === 'pick') {
      li.innerHTML = `<span class="c">${entry.cost}</span> `;
      li.append(`${entry.player} drafted ${entry.mon} (R${entry.round})`);
    } else {
      li.className = 'evt';
      li.textContent =
        entry.type === 'order' ? `order: ${entry.names.join(' → ')}` :
        entry.type === 'start' ? `draft started with ${entry.players} players` :
        entry.type === 'undo' ? `undid ${entry.player}'s ${entry.mon}` :
        entry.type === 'done' ? `${entry.player} finished` :
        entry.type === 'undone' ? `${entry.player} is back in` :
        entry.type === 'cost' ? `${entry.mon} repriced to ${entry.cost}` :
        entry.type === 'draw' ? `bracket drawn: ${entry.names.join(', ')}` :
        entry.type === 'match' ? `${entry.match}: ${entry.player} won ${entry.score}` :
        entry.type === 'clearMatch' ? `cleared result of ${entry.match}` :
        entry.type === 'resetBracket' ? 'bracket cleared' : entry.type;
    }
    log.append(li);
  }
}

function visibleMons() {
  const turn = currentTurn(state, POOL);
  const budget = turn ? remaining(getPlayer(state, turn.playerId)) : Infinity;
  const q = ui.search.trim().toLowerCase();

  const mons = POOL.filter((mon) => {
    if (ui.tier === 'UR') { if (mon.tier !== 'UR') return false; }
    else if (ui.tier !== 'ALL' && !(ui.tier in mon.ranks)) return false;
    if (ui.hideTaken && isTaken(state, mon.name)) return false;
    if (ui.affordableOnly && costOf(state, mon) > budget) return false;
    if (!q) return true;
    return (
      mon.name.toLowerCase().includes(q) ||
      mon.types.some((t) => t.toLowerCase().includes(q)) ||
      mon.abilities.some((a) => a.toLowerCase().includes(q))
    );
  });

  // BST breaks cost ties: the 1-point bin is 493 deep, and alphabetical order
  // buries the only mons worth looking at down there.
  const by = {
    'cost-desc': (a, b) => costOf(state, b) - costOf(state, a) || b.bst - a.bst || a.name.localeCompare(b.name),
    'cost-asc': (a, b) => costOf(state, a) - costOf(state, b) || b.bst - a.bst || a.name.localeCompare(b.name),
    'name': (a, b) => a.name.localeCompare(b.name),
    'bst-desc': (a, b) => b.bst - a.bst || a.name.localeCompare(b.name),
  };
  return mons.sort(by[ui.sort]);
}

/** "OU A+ · UU S" for ranked mons, "ND RU · unranked" for the 1-point bin. */
const rankLine = (mon) =>
  Object.keys(mon.ranks).length
    ? Object.entries(mon.ranks).map(([t, r]) => `${t} ${r}`).join(' · ')
    : `ND ${mon.ndTier ?? '?'} · unranked`;

function renderStore() {
  const grid = $('#grid');
  const turn = currentTurn(state, POOL);
  const budget = turn ? remaining(getPlayer(state, turn.playerId)) : Infinity;
  const mons = visibleMons();

  $('#pool-count').textContent =
    `${mons.length} shown · ${POOL.length - Object.keys(state.taken).length} left of ${POOL.length}`;

  const frag = document.createDocumentFragment();
  for (const mon of mons) {
    const cost = costOf(state, mon);
    const taken = isTaken(state, mon.name);
    const unaffordable = !taken && turn && cost > budget;
    const locked = !turn; // setup phase or draft over — nothing is draftable

    const card = document.createElement('div');
    card.className = 'card' +
      (taken ? ' taken' : '') + (unaffordable ? ' unaffordable' : '') + (locked ? ' locked' : '');
    card.innerHTML =
      `<span class="cost">${cost}</span>` +
      `<span class="tier ${mon.tier}">${mon.tier}</span>` +
      `<img src="${mon.sprite}" alt="${mon.name}" loading="lazy">` +
      `<div class="name"></div>` +
      `<div class="types"></div>` +
      `<div class="rankline">${rankLine(mon)} · ${mon.bst} BST</div>` +
      `<button class="edit" title="Change cost">✎</button>`;
    card.querySelector('.name').textContent = mon.name;

    const types = card.querySelector('.types');
    for (const t of mon.types) {
      const badge = document.createElement('span');
      badge.className = 'type';
      badge.style.background = TYPE_COLORS[t] ?? '#666';
      badge.textContent = t;
      types.append(badge);
    }

    if (taken) {
      const owner = getPlayer(state, state.taken[mon.name]);
      const tag = document.createElement('div');
      tag.className = 'taken-by';
      tag.textContent = owner ? owner.name : 'drafted';
      card.append(tag);
    }

    card.querySelector('.edit').onclick = (ev) => {
      ev.stopPropagation();
      const input = prompt(`Cost for ${mon.name}:`, String(cost));
      if (input === null) return;
      const value = Number(input);
      if (!Number.isFinite(value) || value < 0) return toast('Cost must be a number ≥ 0.', 'bad');
      act({ type: 'setCost', mon: mon.name, cost: value });
    };

    if (!taken && !locked) card.onclick = () => askPick(mon, cost, unaffordable, turn);
    frag.append(card);
  }
  grid.replaceChildren(frag);
}

// ------------------------------------------------------------------ bracket

const nameOf = (id) => (id ? getPlayer(state, id)?.name ?? '—' : '—');

function renderBracket() {
  const bracket = state.bracket ?? { drawn: false, seeds: [], rounds: [], cut: null };

  $('#btn-draw').textContent = bracket.drawn ? '🎲 Redraw' : '🎲 Draw round robin';
  $('#btn-draw').disabled = state.players.length < 2;
  $('#btn-reset-bracket').disabled = !bracket.drawn;

  renderStandings(bracket);
  renderRounds(bracket);
  renderCut(bracket);
}

function renderStandings(bracket) {
  const body = $('#standings-table tbody');
  body.replaceChildren();

  if (!bracket.drawn) {
    $('#standings-note').textContent = state.players.length < 2
      ? 'Add players on the Draft tab first.'
      : `Draw to pair all ${state.players.length} players — everyone plays everyone once, then the top 4 cut.`;
    return;
  }

  const table = standings(bracket);
  table.forEach((row, i) => {
    const tr = document.createElement('tr');
    if (i < 4) tr.className = 'qualified';
    tr.innerHTML =
      `<td>${i + 1}</td><td class="who"></td><td>${row.played}</td><td>${row.wins}</td>` +
      `<td>${row.losses}</td><td>${row.gamesFor}–${row.gamesAgainst}</td>` +
      `<td>${row.diff > 0 ? '+' : ''}${row.diff}</td>`;
    tr.querySelector('.who').textContent = nameOf(row.id);
    body.append(tr);
  });

  const winner = champion(bracket);
  $('#standings-note').textContent = winner
    ? `🏆 ${nameOf(winner)} wins the tournament.`
    : roundRobinComplete(bracket)
      ? 'Round robin done — play the cut below.'
      : `Top 4 (highlighted) advance. Ties break on game difference, then head-to-head.`;
}

function matchCard(m, label) {
  const card = document.createElement('div');
  card.className = 'match' + (m.winner ? ' done' : '') + (m.a && m.b ? '' : ' pending');
  if (label) {
    const tag = document.createElement('div');
    tag.className = 'match-label';
    tag.textContent = label;
    card.append(tag);
  }

  for (const side of ['a', 'b']) {
    const id = m[side];
    const row = document.createElement('button');
    row.className = 'side' + (m.winner === id && id ? ' won' : '') + (m.winner && m.winner !== id ? ' lost' : '');
    row.disabled = !m.a || !m.b;

    const who = document.createElement('span');
    who.textContent = nameOf(id);
    row.append(who);

    if (m.score) {
      const games = document.createElement('span');
      games.className = 'games';
      games.textContent = side === 'a' ? m.score[0] : m.score[1];
      row.append(games);
    }
    row.onclick = () => askResult(m, id);
    card.append(row);
  }

  if (m.winner) {
    const undoBtn = document.createElement('button');
    undoBtn.className = 'match-undo';
    undoBtn.textContent = '↶';
    undoBtn.title = 'clear this result';
    undoBtn.onclick = () => act({ type: 'clearMatch', id: m.id });
    card.append(undoBtn);
  }
  return card;
}

function renderRounds(bracket) {
  const host = $('#rounds');
  host.replaceChildren();

  const games = bracket.rounds.flat();
  const played = games.filter((m) => m.winner).length;
  $('#rr-progress').textContent = bracket.drawn ? `${played} / ${games.length} played` : '';

  bracket.rounds.forEach((round, i) => {
    const block = document.createElement('div');
    block.className = 'round';
    const h = document.createElement('h3');
    h.textContent = `Round ${i + 1}`;
    block.append(h);

    const list = document.createElement('div');
    list.className = 'round-matches';
    for (const m of round) list.append(matchCard(m));
    block.append(list);
    host.append(block);
  });
}

function renderCut(bracket) {
  const host = $('#cut');
  host.replaceChildren();

  if (!bracket.cut) {
    const note = document.createElement('p');
    note.className = 'muted';
    note.textContent = bracket.drawn
      ? 'Unlocks when every round-robin match has a result.'
      : 'Draw the round robin first.';
    host.append(note);
    return;
  }

  const columns = [
    ['Semi-finals', bracket.cut.semis],
    ['Final', [bracket.cut.final]],
    ['3rd place', [bracket.cut.third]],
  ];
  for (const [title, matches] of columns) {
    const col = document.createElement('div');
    col.className = 'cut-col';
    const h = document.createElement('h3');
    h.textContent = title;
    col.append(h);
    matches.forEach((m, i) => col.append(matchCard(m, matches.length > 1 ? `SF${i + 1}` : null)));
    host.append(col);
  }
}

// -------------------------------------------------------------- result entry

function askResult(m, winnerId) {
  if (!m.a || !m.b || !winnerId) return;
  const loserId = winnerId === m.a ? m.b : m.a;

  $('#result-text').textContent = `${nameOf(winnerId)} beat ${nameOf(loserId)}`;
  $('#result-winner').textContent = nameOf(winnerId);
  $('#result-loser').textContent = nameOf(loserId);
  $('#score-winner').value = 2;
  $('#score-loser').value = 0;
  $('#result').hidden = false;

  $('#result-yes').onclick = async () => {
    const win = Number($('#score-winner').value);
    const lose = Number($('#score-loser').value);
    if (!(win > lose)) return toast('The winner needs more games than the loser.', 'bad');
    $('#result').hidden = true;
    // score is stored in [a, b] order, not winner-first
    const score = winnerId === m.a ? [win, lose] : [lose, win];
    await act({ type: 'reportMatch', id: m.id, winner: winnerId, score });
  };
}

$('#result-no').onclick = () => { $('#result').hidden = true; };
$('#result').onclick = (ev) => { if (ev.target.id === 'result') $('#result').hidden = true; };
$('#quick-scores').onclick = (ev) => {
  const btn = ev.target.closest('button[data-score]');
  if (!btn) return;
  const [win, lose] = btn.dataset.score.split('-');
  $('#score-winner').value = win;
  $('#score-loser').value = lose;
};

$('#btn-draw').onclick = () => {
  if (state.bracket?.drawn && !confirm('Redraw? Every match result is erased.')) return;
  act({ type: 'drawBracket' });
};
$('#btn-reset-bracket').onclick = () => {
  if (!confirm('Clear the bracket for every device?')) return;
  act({ type: 'resetBracket' });
};

$('#tabs').onclick = (ev) => {
  const btn = ev.target.closest('button[data-view]');
  if (!btn) return;
  ui.view = btn.dataset.view;
  for (const b of $('#tabs').children) b.classList.toggle('active', b === btn);
  render();
};

// ------------------------------------------------------------------ picking

function askPick(mon, cost, unaffordable, turn) {
  const player = getPlayer(state, turn.playerId);
  if (unaffordable) return toast(`${player.name} has ${remaining(player)} points — ${mon.name} costs ${cost}.`, 'bad');

  $('#confirm-sprite').src = mon.sprite;
  $('#confirm-text').textContent = `Draft ${mon.name} for ${player.name} — ${cost} points?`;
  $('#confirm').hidden = false;
  $('#confirm-yes').onclick = async () => {
    $('#confirm').hidden = true;
    await act({ type: 'pick', mon: mon.name });
  };
}

$('#confirm-no').onclick = () => { $('#confirm').hidden = true; };
$('#confirm').onclick = (ev) => { if (ev.target.id === 'confirm') $('#confirm').hidden = true; };
document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Escape') return;
  $('#confirm').hidden = true;
  $('#result').hidden = true;
});

// ------------------------------------------------------------------ wiring

$('#add-player').onsubmit = async (ev) => {
  ev.preventDefault();
  const name = $('#player-name').value.trim();
  if (!name) return;
  if (await act({ type: 'addPlayer', name })) $('#player-name').value = '';
  $('#player-name').focus();
};

$('#default-budget').onchange = (ev) => act({ type: 'setBudget', budget: ev.target.value });
$('#max-roster').onchange = (ev) => act({ type: 'setMaxRoster', maxRoster: ev.target.value });
$('#btn-randomize').onclick = () => act({ type: 'randomizeOrder' });
$('#btn-start').onclick = () => act({ type: 'start' });
$('#btn-undo').onclick = () => act({ type: 'undo' });

$('#btn-reset').onclick = () => {
  if (!confirm('Reset the draft for EVERY connected device? Players, picks and order are erased.')) return;
  act({ type: 'reset' });
};

$('#btn-export').onclick = () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'pokedraft.json';
  a.click();
  URL.revokeObjectURL(a.href);
};

$('#btn-import').onclick = () => $('#file-import').click();
$('#file-import').onchange = async (ev) => {
  const file = ev.target.files[0];
  if (!file) return;
  try {
    await act({ type: 'import', state: JSON.parse(await file.text()) });
  } catch (err) {
    toast(`Import failed: ${err.message}`, 'bad');
  }
  ev.target.value = '';
};

$('#search').oninput = (ev) => { ui.search = ev.target.value; renderStore(); };
$('#sort').onchange = (ev) => { ui.sort = ev.target.value; renderStore(); };
$('#hide-unaffordable').onchange = (ev) => { ui.affordableOnly = ev.target.checked; renderStore(); };
$('#hide-taken').onchange = (ev) => { ui.hideTaken = ev.target.checked; renderStore(); };

$('#tier-filter').onclick = (ev) => {
  const btn = ev.target.closest('button[data-tier]');
  if (!btn) return;
  ui.tier = btn.dataset.tier;
  for (const b of $('#tier-filter').children) b.classList.toggle('active', b === btn);
  renderStore();
};

// -------------------------------------------------------------------- boot

adopt(await (await fetch('api/state')).json());
connect();
