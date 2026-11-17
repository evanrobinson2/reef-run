// ============================================================================
// soundboard.js: Reef Run's sound board (GAME_API.md "Sound board"). carpetshark, 2026-11-16: "make a sound board and help me to map key
// sounds - phaser blast"; earlier, sound effects "ruin it" and only the crash stayed. So every game event is a row that is OFF by
// default except the hull crash (damage → explosion-big), the same result as the old `sfxOnly: ['damage']`. Each row: on/off, a
// catalogue sound (sounds/manifest.json only, no synthesised audio), ▶ preview and a volume. Saved per game in localStorage;
// "Reset to defaults" and "Copy mapping" (JSON) let carpetshark send his mapping back.
// The shell asks GAME.sfx(name) for every hud.event (shell.js hook); loops (the mining laser) go through loop(name, on).
// Load-time allocation only on the per-event path: sfx() returns a preallocated entry per row.
// ============================================================================
const SOUNDBOARD = (() => {
  // [event, label, default catalogue id, default on, default volume 0..1, min gap ms, dropdown keywords (first = best match), loop]
  // The first block is the list carpetshark asked for, in his order; then the game's other events; then the reality device's switches.
  const ROWS = [
    ['fire', 'Blaster shot (phaser blast)', 'blaster-zap', 1, 0.5, 60, /* carpetshark: 'trim that for the blaster' (on by default) */ ['laser', 'zap', 'phaser', 'blast', 'shot', 'lightning', 'sci-fi', 'force-field']],
    ['laser', 'Mining laser beam (loop)', 'force-field', 0, 0.4, 0, ['force-field', 'laser', 'scanner', 'hologram', 'hum', 'sizzle', 'sci-fi', 'fan'], true],
    ['laserburn', 'Laser rock burn', 'sizzle', 0, 0.5, 260, ['sizzle', 'steam', 'ignite', 'fire', 'crack', 'crunch']],
    ['hit', 'Rock hit', 'coin-1', 0, 0.5, 60, ['hit', 'tap', 'bonk', 'stone', 'rock', 'knock', 'punch', 'anvil']],
    ['destroy', 'Rock destroyed', 'rock-burst-*', 1, 0.7, 45, /* carpetshark: 'rock burst all 3' - one of the three takes at random each burst */ ['explosion', 'rock', 'meteor', 'boom', 'crash', 'firework', 'pop']],
    ['damage', 'Hull crash', 'hull-crash-*', 1, 0.8, 160, /* carpetshark: 'hull crash all 3' */ ['explosion', 'crash', 'meteor', 'glass', 'boom', 'thunder']],
    ['proximity', 'Proximity beep', 'beep-1', 0, 0.45, 0, ['beep', 'countdown', 'tick', 'scanner', 'error', 'notify']],
    ['turbo', 'Turbo', 'warp', 0, 0.7, 300, ['warp', 'whoosh', 'rocket', 'power-up', 'zip', 'teleport']],
    ['brake', 'Brake', 'steam', 0, 0.6, 300, ['steam', 'power-down', 'slide', 'gust', 'ratchet']],
    ['weapon', 'Weapon switch', 'switch', 0, 0.6, 120, ['switch', 'toggle', 'click', 'select', 'lock', 'unlock']],
    ['tick', 'Countdown tick', 'countdown', 0, 0.6, 150, ['countdown', 'tick', 'beep', 'clock', 'click']],
    ['go', 'GO', 'confirm-1', 0, 0.7, 300, ['confirm', 'success', 'power-up', 'whoosh', 'start', 'achievement']],
    ['levelup', 'Level up', 'level-up', 0, 0.9, 300, ['level', 'achievement', 'power-up', 'success', 'star']],
    ['pickup', 'Pickup (crystals, initials)', 'pickup-1', 0, 0.6, 50, ['pickup', 'coin', 'star', 'sparkle', 'pop']],
    ['gate', 'Gate', 'magic-whoosh', 0, 0.9, 250, ['whoosh', 'portal', 'warp', 'magic', 'teleport']],
    ['win', 'Win', 'win-sting', 0, 0.9, 500, ['win', 'success', 'cheer', 'applause', 'achievement']],
    ['lose', 'Lose', 'lose-sting', 0, 0.9, 500, ['lose', 'error', 'power-down', 'cancel', 'gasp']],
    ['overheat', 'Overheat', 'power-down', 0, 0.8, 300, ['power-down', 'steam', 'error', 'sizzle']],
    ['cooled', 'Chain ×4 / ×8 sting', 'power-up', 0, 0.6, 300, ['power-up', 'achievement', 'star', 'sparkle']],
    ['zap', 'Shield absorbs a hit', 'lightning', 0, 0.7, 200, ['lightning', 'shield', 'force-field', 'zap']],
    ['rescue', 'Shield up', 'magic-chime', 0, 0.8, 120, ['chime', 'shield', 'force-field', 'power-up']],
    ['coin', 'Tally count tick', 'coin-1', 0, 0.6, 50, ['coin', 'tick', 'click', 'type-blip']],
    ['start', 'Run start', 'whoosh-1', 0, 0.7, 300, ['whoosh', 'warp', 'rocket', 'go']],
    ['pulse', 'Reality Pulse shot', 'warp', 0, 0.7, 300, ['warp', 'laser', 'zap', 'magic', 'spell', 'whoosh', 'portal']],
    ['spread', 'Reality Pulse impact (the bubble opens)', 'portal', 0, 0.8, 300, ['portal', 'magic', 'warp', 'teleport', 'force-field', 'whoosh']],
    ['timestop', 'Time stops', 'power-down', 0, 0.8, 300, ['power-down', 'slide', 'warp', 'freeze', 'steam']],
    ['timego', 'Time snaps back', 'power-up', 0, 0.8, 300, ['power-up', 'whoosh', 'warp', 'zip', 'rocket']],
    ['world-switch', 'World switch (reality device)', 'portal', 0, 0.8, 300, ['portal', 'teleport', 'warp', 'magic', 'whoosh']],
    ['style-switch', 'Style switch (reality device)', 'sparkle-1', 0, 0.7, 200, ['sparkle', 'spell', 'magic', 'switch', 'toggle']],
    ['music-switch', 'Music switch (reality device)', 'notify-1', 0, 0.7, 200, ['notify', 'chime', 'switch', 'select', 'confirm']],
  ];
  // variant sets (carpetshark: 'rock burst all 3', 'hull crash all 3'): the row's id names a set; each play picks one take at random
  const VAR = { 'rock-burst-*': { name: 'All 3 rock bursts (random)', ids: ['rock-burst-1', 'rock-burst-2', 'rock-burst-3'] },
    'hull-crash-*': { name: 'All 3 hull crashes (random)', ids: ['explosion-big', 'meteor', 'anvil-2'] } };
  const resolve = (id) => (VAR[id] ? VAR[id].ids[(Math.random() * VAR[id].ids.length) | 0] : id);
  const KEY = 'sg-shell:reef-run:sounds', V = 2; // v2: the blaster is on with carpetshark's zap
  const R = {}; // name → { on, id, vol, row, entry: [id, gap, vol, flashKey, flash] }
  for (const r of ROWS) R[r[0]] = { on: !!r[3], id: r[2], vol: r[4], row: r, entry: [r[2], r[5], r[4], undefined, 0] };
  const defaults = () => { for (const r of ROWS) { const q = R[r[0]]; q.on = !!r[3]; q.id = r[2]; q.vol = r[4]; } };
  function load() {
    try { const o = JSON.parse(localStorage.getItem(KEY) || 'null'); const m = o && (o.sounds || o);
      if (m && typeof m === 'object') for (const k in m) { const q = R[k], v = m[k]; if (!q || !v) continue; if ((o.v || 1) < 2 && (k === 'fire' || k === 'destroy' || k === 'damage')) continue; // v2 defaults win over older saves
        if (typeof v.on === 'boolean') q.on = v.on; if (typeof v.id === 'string' && v.id) q.id = v.id; if (typeof v.vol === 'number') q.vol = Math.max(0, Math.min(1, v.vol)); } } catch {}
  }
  const mapping = () => { const o = {}; for (const r of ROWS) { const q = R[r[0]]; o[r[0]] = { on: q.on, id: q.id, vol: Math.round(q.vol * 100) / 100 }; } return { game: 'reef-run', v: V, sounds: o }; };
  function save() { try { localStorage.setItem(KEY, JSON.stringify(mapping())); } catch {} }
  load();
  if (typeof QS !== 'undefined' && QS.get('sounds') === 'all') for (const r of ROWS) R[r[0]].on = true; // testing: every row on for this visit (not saved)

  // ---- the shell's per-event question (shell.js hook GAME.sfx): the row's entry when on, else null (silent; flash only with sound,
  // as before: the crash keeps its red flash)
  function sfx(name, ev) {
    const q = R[name]; if (!q || !q.on || !q.id || q.row[7]) return null;
    const e = q.entry; e[0] = resolve(q.id); // a variant set plays one of its takes at random e[1] = q.row[5]; e[2] = q.vol; e[3] = ev ? ev[3] : undefined; e[4] = ev ? ev[4] : 0; return e;
  }
  const isOn = (name) => !!(R[name] && R[name].on);

  // ---- loops (the mining laser beam): a catalogue sound looped through WebAudio when the file decodes (CORS), otherwise a looping
  // <audio> element (the catalogue's R2 blobs send no CORS header, so WebAudio cannot read them; playback still works)
  const LOOPS = {};
  function loop(name, on) {
    const q = R[name], A = typeof Shell !== 'undefined' && Shell.audio; if (!q || !A) return;
    let L = LOOPS[name]; if (!L) L = LOOPS[name] = { on: false, id: '', src: null, g: null, el: null };
    const want = on && q.on && !!q.id && A.has(q.id) && A.vol > 0;
    if (want && L.on && L.id !== q.id) stopLoop(L);
    if (want && !L.on) {
      L.on = true; L.id = q.id; A.load(q.id); const b = A.buf(q.id), ctx = A.ctx;
      if (b && ctx && A.out) { L.src = ctx.createBufferSource(); L.src.buffer = b; L.src.loop = true; L.g = ctx.createGain(); L.g.gain.value = q.vol; L.src.connect(L.g); L.g.connect(A.out); L.src.start(); }
      else { if (!L.el || L.el._id !== q.id) { L.el = new Audio(); L.el.loop = true; L.el.preload = 'auto'; L.el.src = A["url"](q.id) /* brackets: the study publisher reads ".url(" as a CSS dependency */; L.el._id = q.id; } L.el.volume = Math.min(1, q.vol * A.vol); try { L.el.currentTime = 0; } catch {} L.el.play().catch(() => {}); }
    } else if (!want && L.on) stopLoop(L);
    else if (L.on && L.el) { const v = Math.min(1, q.vol * A.vol); if (Math.abs(L.el.volume - v) > 0.01) L.el.volume = v; }
  }
  function stopLoop(L) { L.on = false; try { if (L.src) L.src.stop(); } catch {} L.src = null; L.g = null; if (L.el) L.el.pause(); }

  // ---- Settings → Sounds (inside the shell's panel: GAME.settingsHTML / GAME.syncSettings). Buttons carry data-game commands,
  // which the shell routes to GAME.command; toggles, dropdowns and sliders are handled here.
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const CSS = `#sgset .sbr{display:grid;grid-template-columns:1fr 34px 76px;gap:4px 6px;align-items:center;padding:5px 0;border-bottom:1px solid #1c2833}
#sgset .sbr label{grid-column:1/-1;min-height:26px;font-size:13px}#sgset .sbr select{grid-column:1;min-height:32px;font-size:12.5px;padding:4px 6px}
#sgset .sbr button{min-height:32px;padding:0;font-size:14px}#sgset .sbr input[type=range]{min-width:0;width:76px}#sgset .sbr.off select,#sgset .sbr.off input[type=range]{opacity:.45}
#sgset textarea.sbout{width:100%;box-sizing:border-box;height:90px;margin-top:6px;font:11px/1.35 ui-monospace,Menlo,monospace;color:#b9c8d3;background:#0b131b;border:1px solid #2a3b4a;border-radius:8px;display:none}`;
  function settingsHTML() {
    return `<h4>Sounds</h4><p class="note">Every game sound. All off except the hull crash; turn a row on, pick a catalogue sound, ▶ to hear it. Saved for Reef Run.</p>` +
      ROWS.map((r) => `<div class="sbr" data-sbr="${r[0]}"><label><input type="checkbox" data-sbon="${r[0]}">${esc(r[1])}</label><select data-sbid="${r[0]}" aria-label="${esc(r[1])} sound"><option value="${r[2]}">${r[2]}</option></select><button type="button" data-game="sound preview ${r[0]}" aria-label="Preview ${esc(r[1])}">▶</button><input type="range" min="0" max="100" data-sbvol="${r[0]}" aria-label="${esc(r[1])} volume"></div>`).join('') +
      `<div class="row"><button type="button" data-game="sound reset">Reset to defaults</button><button type="button" data-game="sound copy">Copy mapping</button></div><textarea class="sbout" readonly aria-label="Sound mapping JSON"></textarea>`;
  }
  // dropdown order for a row: catalogue effects whose id, name or tags match the row's keywords (in keyword order) first, then the rest
  function ordered(r, list) {
    const kw = r[6], score = (s) => { const t = (s.id + ' ' + s.name + ' ' + s.tags.join(' ')).toLowerCase(); for (let k = 0; k < kw.length; k++) if (t.includes(kw[k])) return k; return 99; };
    const sets = Object.entries(VAR).map(([id, v]) => ({ id, name: v.name, kind: 'set', tags: [] }));
    return sets.concat(list).filter((s) => s.kind !== 'music' && s.kind !== 'ambience').map((s) => [score(s), s]).sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name)).map((e) => e[1]);
  }
  let el = null, filled = 0, css = false;
  function sync(root) {
    if (!root) return;
    if (!css) { css = true; const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st); }
    if (el !== root) { el = root; filled = 0;
      root.addEventListener('change', (e) => { const t = e.target, d = t.dataset;
        if (d.sbon) { R[d.sbon].on = t.checked; t.closest('.sbr').classList.toggle('off', !t.checked); save(); }
        else if (d.sbid) { R[d.sbid].id = t.value; save(); preview(d.sbid); } });
      root.addEventListener('input', (e) => { const d = e.target.dataset; if (d.sbvol) { R[d.sbvol].vol = e.target.value / 100; save(); } });
    }
    const list = typeof Shell !== 'undefined' && Shell.audio ? Shell.audio.list() : [];
    if (list.length && filled !== list.length) { filled = list.length;
      for (const r of ROWS) { const s = root.querySelector(`[data-sbid="${r[0]}"]`); if (!s) continue; const o = ordered(r, list);
        s.innerHTML = o.map((x) => `<option value="${esc(x.id)}">${esc(x.name)} · ${esc(x.id)}</option>`).join('') + (o.some((x) => x.id === R[r[0]].id) ? '' : `<option value="${esc(R[r[0]].id)}">${esc(R[r[0]].id)} (not in catalogue)</option>`); } }
    for (const r of ROWS) { const q = R[r[0]], row = root.querySelector(`[data-sbr="${r[0]}"]`); if (!row) continue;
      row.querySelector('[data-sbon]').checked = q.on; row.classList.toggle('off', !q.on); row.querySelector('[data-sbid]').value = q.id; row.querySelector('[data-sbvol]').value = Math.round(q.vol * 100); }
  }
  function preview(name) { const q = R[name], A = typeof Shell !== 'undefined' && Shell.audio; if (!q || !A) return 'no audio'; A.unlock(); const id = resolve(q.id); if (!A.has(id)) return 'sound "' + id + '" is not in the catalogue (yet)'; A.play(id, q.vol, 0); return '▶ ' + q.row[1] + ': ' + id; }
  function command(a) {
    if (a[0] !== 'sound' && a[0] !== 'sounds') return null;
    const n = a[2], q = R[n];
    switch (a[1]) {
      case 'preview': case 'play': return q ? preview(n) : 'sound preview <event>';
      case 'on': case 'off': if (!q) return 'sound on|off <event>. Events: ' + ROWS.map((r) => r[0]).join(' '); q.on = a[1] === 'on'; save(); if (el) sync(el); return n + ' ' + a[1] + ' (' + q.id + ')';
      case 'set': if (!q || !a[3]) return 'sound set <event> <catalogue id> [volume 0-100]'; q.id = a[3]; if (a[4]) q.vol = Math.max(0, Math.min(1, +a[4] / 100 || 0)); q.on = true; save(); if (el) sync(el); return n + ' → ' + q.id + ' at ' + Math.round(q.vol * 100) + '%';
      case 'reset': defaults(); save(); for (const k in LOOPS) stopLoop(LOOPS[k]); if (el) sync(el); return 'sounds reset: everything off except the hull crash';
      case 'copy': { const j = JSON.stringify(mapping(), null, 1); const ta = el && el.querySelector('textarea.sbout'); if (ta) { ta.style.display = 'block'; ta.value = j; ta.select(); }
        try { navigator.clipboard.writeText(j).catch(() => {}); } catch {} return 'mapping copied (also shown below the buttons): ' + ROWS.filter((r) => R[r[0]].on).map((r) => r[0] + '=' + R[r[0]].id).join(', '); }
      default: return ROWS.map((r) => `${r[0].padEnd(13)} ${R[r[0]].on ? 'on ' : 'off'} ${R[r[0]].id} ${Math.round(R[r[0]].vol * 100)}%`).join('\n');
    }
  }
  const help = '\n  sound [list]                  the sound board (Settings → Sounds)\n  sound on|off <event>          e.g. sound on fire (the phaser blast)\n  sound set <event> <id> [vol]  map an event to a catalogue sound\n  sound preview <event> · sound reset · sound copy';
  if (typeof QS !== 'undefined' && QS.has('debug')) window.reefSounds = { R, ROWS, mapping, loops: LOOPS };
  return { sfx, isOn, loop, settingsHTML, sync, command, help, mapping, rows: ROWS };
})();
