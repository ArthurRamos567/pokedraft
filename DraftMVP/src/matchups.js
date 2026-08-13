// Read-only matchup display: player names and who plays whom, nothing else.
// Meant for a second screen or a phone passed around — results are entered on
// the Bracket tab of the draft board, and land here over the same SSE stream.

const $ = (sel) => document.querySelector(sel);

let state = null;

const nameOf = (id) => (id ? state.players.find((p) => p.id === id)?.name ?? '—' : '—');

function matchRow(m, label) {
  const card = document.createElement('div');
  card.className = 'vs' + (m.winner ? ' done' : '') + (m.a && m.b ? '' : ' pending');

  if (label) {
    const tag = document.createElement('div');
    tag.className = 'vs-label';
    tag.textContent = label;
    card.append(tag);
  }

  for (const side of ['a', 'b']) {
    const id = m[side];
    const row = document.createElement('div');
    row.className = 'vs-side' + (m.winner === id && id ? ' won' : '') + (m.winner && m.winner !== id ? ' lost' : '');

    const who = document.createElement('span');
    who.textContent = nameOf(id);
    row.append(who);

    if (m.score) {
      const games = document.createElement('span');
      games.className = 'vs-games';
      games.textContent = side === 'a' ? m.score[0] : m.score[1];
      row.append(games);
    }
    card.append(row);
  }
  return card;
}

function render() {
  if (!state) return;
  const bracket = state.bracket ?? { drawn: false, rounds: [], cut: null };

  $('#empty').hidden = bracket.drawn;
  $('#rounds-wrap').hidden = !bracket.drawn;
  $('#cut-wrap').hidden = !bracket.cut;

  const games = bracket.rounds.flat();
  const played = games.filter((m) => m.winner).length;
  $('#progress').textContent = bracket.drawn ? `${played} / ${games.length} played` : '';

  const rounds = $('#rounds');
  rounds.replaceChildren();
  bracket.rounds.forEach((round, i) => {
    const block = document.createElement('div');
    block.className = 'display-round';
    const h = document.createElement('h3');
    h.textContent = `Round ${i + 1}`;
    block.append(h);
    for (const m of round) block.append(matchRow(m));
    rounds.append(block);
  });

  const cut = $('#cut');
  cut.replaceChildren();
  if (bracket.cut) {
    const columns = [
      ['Semi-finals', bracket.cut.semis],
      ['Final', [bracket.cut.final]],
      ['3rd place', [bracket.cut.third]],
    ];
    for (const [title, matches] of columns) {
      const col = document.createElement('div');
      col.className = 'display-round';
      const h = document.createElement('h3');
      h.textContent = title;
      col.append(h);
      matches.forEach((m, i) => col.append(matchRow(m, matches.length > 1 ? `SF${i + 1}` : null)));
      cut.append(col);
    }

    const winner = bracket.cut.final.winner;
    if (winner) {
      const banner = document.createElement('div');
      banner.className = 'champion';
      banner.textContent = `🏆 ${nameOf(winner)}`;
      cut.append(banner);
    }
  }
}

function setLink(online) {
  $('#link').classList.toggle('online', online);
  $('#link').classList.toggle('offline', !online);
}

const source = new EventSource('api/events');
source.addEventListener('state', (ev) => { state = JSON.parse(ev.data).state; render(); });
source.addEventListener('presence', (ev) => {
  const { devices } = JSON.parse(ev.data);
  $('#devices').textContent = `${devices} device${devices === 1 ? '' : 's'}`;
});
source.onopen = () => setLink(true);
source.onerror = () => setLink(false);

state = (await (await fetch('api/state')).json()).state;
render();
