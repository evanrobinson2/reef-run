// ============================================================================
// shell.js: the rail games' shell (GAME_API.md "Shell API"). Owns input roles (pilot / gunner, one or two players),
// the HUD overlay (Canopy or Visor skin, six palettes from the cockpit board), the Esc settings bump-out, catalogue
// audio (music + effects; no synthesised sound, INVARIANTS.md §3), gamepads, the webcam toy pilot and the results screen.
// The HUD is DOM/SVG over the canvas. Elements and pools are built once; per frame the shell only writes values that
// changed (cached), so steady play does not churn the DOM.
// URL: ?layers=-rail,-minimap,+stats &scheme=arctic &players=2 &pilot=toy &gunner=gamepad &music=<id> &volume=40
//      &sfx=60 &skin=visor &toytest (synthetic webcam stream) &timer (engine: frames on a timer)
// ============================================================================
const Shell = (() => {
  const URLP = new URLSearchParams(location.search), D = document, NS = 'http://www.w3.org/2000/svg';
  const cl = (x, a, b) => (x < a ? a : x > b ? b : x);
  const TOYTEST = URLP.has('toytest');
  // Palettes from the cockpit board (carpetshark chose these): h HUD, s highlight, a friend/goal, d danger/target, dash, tint
  const PAL = [
    { name: 'Amber Night', h: '#ffb547', s: '#ffe1b0', a: '#7fe4ff', d: '#ff6f6f', dash: '#0d0a08', tint: '#1a1410' },
    { name: 'Arctic', h: '#c4f1ff', s: '#ffffff', a: '#ffd166', d: '#ff6f8e', dash: '#0a1016', tint: '#121c24' },
    { name: 'Mint', h: '#8ff0c8', s: '#e4fff4', a: '#ffd166', d: '#ff7a7a', dash: '#07110d', tint: '#0e1c17' },
    { name: 'Coral', h: '#ff8a6b', s: '#ffd6c8', a: '#7fe4ff', d: '#ffd166', dash: '#120a0b', tint: '#1e1112' },
    { name: 'Synth Violet', h: '#c9a3ff', s: '#f2e8ff', a: '#5ef2d6', d: '#ffb547', dash: '#0d0915', tint: '#171024' },
    { name: 'Signal', h: '#ff5d5d', s: '#ffffff', a: '#7fe4ff', d: '#ffd166', dash: '#110808', tint: '#1d0f0f' },
    { name: 'Phosphor', h: '#5dff8a', s: '#d6ffde', a: '#ffe066', d: '#ff6b5b', dash: '#030a05', tint: '#08140b' },
  ];
  // HUD styles (carpetshark, 2026-11-16: "add styles that change up the font too .. let players have more control and fun"). Each pairs a
  // palette with fonts (display: popups, chain, titles; label: small caps text; num: score and readouts, tabular digits) and
  // (num fonts are monospaced, so the rolling score never jitters) traits: fz font-size factor (wide pixel fonts run small; fzl
  // for labels when it differs), wt weight, r panel radius, bw border weight, cut corner cuts,
  // tx text effect (plain | outline | glow), pop popup word style, ret reticle shape ('' = the skin's own). Fonts come from Google
  // Fonts (gf), loaded only for the chosen style (all of them, subset to the swatch text, while Settings is open), with fallbacks.
  const MONO = 'ui-monospace,Menlo,Consolas,monospace', SANS = 'system-ui,-apple-system,sans-serif', RND = 'ui-rounded,"Arial Rounded MT Bold",' + SANS;
  const STYLES = [
    { id: 'pilot', name: 'Clean pilot', pal: '', fd: MONO, fl: MONO, fn: MONO, gf: [], fz: 1, wt: 600, r: 10, bw: 1, cut: 0, tx: 'plain', pop: '', ret: '' },
    { id: 'arcade', name: 'Arcade', pal: 'Signal', fd: `'Press Start 2P',${MONO}`, fl: `'Silkscreen',${MONO}`, fn: `'Press Start 2P',${MONO}`, gf: ['Press+Start+2P', 'Silkscreen'], fz: 0.6, fzl: 0.95, wt: 400, r: 0, bw: 2, cut: 1, tx: 'outline', pop: 'upper', ret: 'pixel' },
    { id: 'retro', name: 'Retro sci-fi', pal: 'Arctic', fd: `'Orbitron',${SANS}`, fl: `'Audiowide',${SANS}`, fn: `'Share Tech Mono',${MONO}`, gf: ['Orbitron:wght@700;900', 'Audiowide', 'Share+Tech+Mono'], fz: 0.9, wt: 700, r: 16, bw: 1.5, cut: 0, tx: 'glow', pop: 'wide', ret: 'diamond' },
    { id: 'comic', name: 'Comic', pal: 'Coral', fd: `'Bangers',${SANS}`, fl: `'Luckiest Guy',${SANS}`, fn: `'Rubik Mono One',${MONO}`, gf: ['Bangers', 'Luckiest+Guy', 'Rubik+Mono+One'], fz: 1.12, wt: 400, r: 4, bw: 3, cut: 0, tx: 'outline', pop: 'skew', ret: 'star' },
    { id: 'neon', name: 'Neon', pal: 'Synth Violet', fd: `'Tilt Neon',${SANS}`, fl: `'Tilt Neon',${SANS}`, fn: `'Kode Mono',${MONO}`, gf: ['Tilt+Neon', 'Kode+Mono:wght@500'], fz: 1.02, wt: 400, r: 22, bw: 1.5, cut: 0, tx: 'glow', pop: 'wide', ret: 'ring2' },
    { id: 'toy', name: 'Chunky toy', pal: 'Mint', fd: `'Fredoka',${RND}`, fl: `'Baloo 2',${RND}`, fn: `'Martian Mono',${MONO}`, gf: ['Fredoka:wght@600;700', 'Baloo+2:wght@700', 'Martian+Mono:wght@700'], fz: 1.05, wt: 700, r: 24, bw: 3, cut: 0, tx: 'outline', pop: '', ret: 'dot' },
    { id: 'terminal', name: 'Terminal green', pal: 'Phosphor', fd: `'VT323',${MONO}`, fl: `'VT323',${MONO}`, fn: `'VT323',${MONO}`, gf: ['VT323'], fz: 1.3, wt: 400, r: 0, bw: 1, cut: 0, tx: 'glow', pop: 'upper', ret: 'cross' },
    { id: 'scrawl', name: 'Scrawl', pal: 'Amber Night', fd: `'Permanent Marker',cursive,${SANS}`, fl: `'Patrick Hand',cursive,${SANS}`, fn: `'Courier Prime',${MONO}`, gf: ['Permanent+Marker', 'Patrick+Hand', 'Courier+Prime:wght@700'], fz: 0.98, wt: 400, r: 8, bw: 2, cut: 0, tx: 'outline', pop: 'tilt', ret: '' },
  ];
  const findStyle = (q) => { q = pkey(q); return q ? STYLES.find((s) => s.id === q || pkey(s.name) === q) || STYLES.find((s) => pkey(s.name).startsWith(q) || s.id.startsWith(q)) || STYLES.find((s) => pkey(s.fd).includes(q)) : null; };
  const RETICLE = {
    pixel: '<path d="M-30 -30 h14 M-30 -30 v14 M30 -30 h-14 M30 -30 v14 M-30 30 h14 M-30 30 v-14 M30 30 h-14 M30 30 v-14"/><rect x="-3" y="-3" width="6" height="6" class="fh" stroke="none"/>',
    diamond: '<path d="M0 -30 L30 0 L0 30 L-30 0 Z"/><path d="M-50 0 H-38 M38 0 H50 M0 -50 V-38 M0 38 V50"/><circle r="2.5" class="fh" stroke="none"/>',
    star: '<path d="M0 -34 L8 -10 L32 -12 L13 4 L22 28 L0 14 L-22 28 L-13 4 L-32 -12 L-8 -10 Z" stroke-linejoin="round"/><circle r="3" class="fh" stroke="none"/>',
    ring2: '<circle r="30"/><circle r="21" stroke-opacity=".5"/><circle r="3" class="fh" stroke="none"/>',
    dot: '<circle r="23" stroke-width="5" stroke-linecap="round" stroke-dasharray="10 14"/><circle r="7" class="fh" stroke="none"/>',
    cross: '<path d="M-26 0 h16 M10 0 h16 M0 -26 v16 M0 10 v16"/><circle r="2" class="fh" stroke="none"/>',
  };
  const HUDSCALE = { s: 0.85, m: 1, l: 1.18 };
  const pkey = (n) => String(n).toLowerCase().replace(/[^a-z]/g, '');
  const findPal = (q) => { q = pkey(q); return q ? PAL.find((p) => pkey(p.name) === q) || PAL.find((p) => pkey(p.name).startsWith(q)) || PAL.find((p) => pkey(p.name).includes(q)) : null; };
  const LAYERS = ['frame', 'reticle', 'minimap', 'score', 'timer', 'weapon', 'popups', 'marks', 'rail', 'stats', 'fx'];
  const ALIAS = { radar: 'minimap', map: 'minimap', cube: 'minimap', popup: 'popups', mark: 'marks', brackets: 'marks', heat: 'weapon', clock: 'timer', time: 'timer', crosshair: 'reticle', effects: 'fx' };
  const PILOTS = { keys: 'Keys', gamepad: 'Gamepad', touch: 'Touch', toy: 'Webcam toy' }, GUNNERS = { mouse: 'Mouse', gamepad: 'Gamepad', touch: 'Touch' };
  // hud.event name -> [catalogue id, min gap ms, volume, flash colour key, flash strength]
  const EVENTS = {
    fire: ['laser-shot-1', 75, 0.35], hit: ['coin-1', 60, 0.5], destroy: ['explosion-small', 45, 0.7], damage: ['explosion-big', 160, 0.8, 'd', 0.38],
    rescue: ['magic-chime', 120, 0.8, 'a', 0.22], levelup: ['level-up', 300, 0.9, 'a', 0.25], overheat: ['power-down', 300, 0.8, 'd', 0.18],
    cooled: ['power-up', 300, 0.6], gate: ['magic-whoosh', 250, 0.9, 's', 0.3], pickup: ['pickup-1', 50, 0.6], coin: ['coin-1', 50, 0.6],
    start: ['whoosh-1', 300, 0.7], win: ['win-sting', 500, 0.9], lose: ['lose-sting', 500, 0.9], zap: ['lightning', 200, 0.7, 's', 0.3],
  };
  // ?sounds=<origin or path> points at a mirror of the catalogue (testing only); default is the live catalogue
  const SOUND_BASE = URLP.get('sounds') || 'https://abbies.world', MANIFEST = SOUND_BASE + '/sounds/manifest.json';

  // ------------------------------------------------------------------ shared state
  const input = { pilot: { x: 0, y: 0 }, gunner: { x: 0, y: 0, fire: false, alt: false }, players: 1,
    // turret games (GAME.controls; GAME_API.md "Turret"): control mode and raw look input for this frame
    control: '', look: { dx: 0, dy: 0, sx: 0, sy: 0, kx: 0, ky: 0, sens: 1, recentre: true, locked: false } };
  let jolted = false;
  const S = { layers: {}, scheme: '', style: 'pilot', font: '', hudScale: 'm', players: 1, split: 'v', pilot: 'keys', gunner: 'mouse', music: '', musicVol: 0.5, sfxVol: 0.7, fxWords: true, shake: -1, view: 'cockpit', toy: null, control: '', lookSens: 1, recentre: null }; // recentre: null = default (on, off with reduced motion); shake: -1 = default (100%, or 30% with reduced motion)
  for (const l of LAYERS) S.layers[l] = l !== 'stats';
  // optional GAME.layers = { layer: bool }: per-game default layers (Reef Run: { frame: false }); GAME.hudFloat: light
  // translucent panel backings and a small translucent radar disc instead of the dark dashboard look
  let SC = null, GM = null, G = null, skin = 'canopy', P = PAL[0], storeKey = 'sg-shell', CTRL = null; // CTRL: GAME.controls ({ mode: label }, first = default)
  const REDUCED = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const turretOn = () => !!CTRL && S.control === 'turret';
  const recentreOn = () => (S.recentre === null ? !REDUCED : S.recentre);
  let state = 'menu', open = false, hidePause = false, runTime = 0, statsRef = {}, againFn = null, lastDt = 0;
  let statsSynced = false, blipArr = null, blipN = 0, markArr = null, markN = 0;
  const MAX_BRACKETS = 5, KEEP = new Uint8Array(256);
  const view = { F: null, f: [0, 0, 1], r: [1, 0, 0], u: [0, 1, 0], tan: 0.6, aspect: 1.6, W: 1, H: 1,
    project(x, y, z, o) { const F = this.F, dx = x - F[0], dy = y - F[1], dz = z - F[2], f = this.f, r = this.r, u = this.u;
      const d = dx * f[0] + dy * f[1] + dz * f[2]; o[2] = d; const q = d > 1e-3 ? d : 1e-3;
      o[0] = (dx * r[0] + dz * r[2]) / (q * this.tan * this.aspect); o[1] = (dx * u[0] + dy * u[1] + dz * u[2]) / (q * this.tan); return o; } };

  // ------------------------------------------------------------------ persistence (localStorage, try/catch) + URL
  function save() { try { localStorage.setItem(storeKey, JSON.stringify(S)); } catch {} }
  function load() {
    try { const o = JSON.parse(localStorage.getItem(storeKey) || 'null'); if (o && typeof o === 'object') {
      if (o.layers) for (const l of LAYERS) if (typeof o.layers[l] === 'boolean') S.layers[l] = o.layers[l];
      // a game's own layer defaults (GAME.layers) win once over layers saved before they existed (or changed)
      if (GM && GM.layers && o.gameLayers !== JSON.stringify(GM.layers)) for (const l in GM.layers) if (l in S.layers) S.layers[l] = !!GM.layers[l];
      for (const k of ['scheme', 'music', 'toy']) if (k in o) S[k] = o[k];
      if (findStyle(o.style)) S.style = findStyle(o.style).id; if (o.font === '' || findStyle(o.font)) S.font = o.font || ''; if (HUDSCALE[o.hudScale]) S.hudScale = o.hudScale;
      if (o.players >= 1 && o.players <= 4 && o.players === (o.players | 0)) S.players = o.players;
      if (o.split === 'v' || o.split === 'h') S.split = o.split;
      if (PILOTS[o.pilot]) S.pilot = o.pilot; if (GUNNERS[o.gunner]) S.gunner = o.gunner;
      for (const k of ['musicVol', 'sfxVol']) if (typeof o[k] === 'number') S[k] = cl(o[k], 0, 1);
      if (typeof o.fxWords === 'boolean') S.fxWords = o.fxWords;
      if (o.view === 'cockpit' || o.view === 'shoulder') S.view = o.view;
      if (CTRL && CTRL[o.control]) S.control = o.control;
      if (typeof o.lookSens === 'number') S.lookSens = cl(o.lookSens, 0.2, 3);
      if (typeof o.recentre === 'boolean') S.recentre = o.recentre;
    } } catch {}
    if (CTRL && CTRL[URLP.get('control')]) S.control = URLP.get('control');
    if (CTRL && !CTRL[S.control]) S.control = Object.keys(CTRL)[0];
    const lay = URLP.get('layers') || URLP.get('hud');
    if (lay) for (let t of lay.split(',')) { t = t.trim().toLowerCase(); if (!t) continue; const on = t[0] !== '-', n = t.replace(/^[-+]/, ''), l = ALIAS[n] || n;
      if (l === 'all') for (const x of LAYERS) S.layers[x] = on; else if (l in S.layers) S.layers[l] = on; }
    if (URLP.get('scheme') && findPal(URLP.get('scheme'))) S.scheme = findPal(URLP.get('scheme')).name;
    if (URLP.get('palette') && findPal(URLP.get('palette'))) S.scheme = findPal(URLP.get('palette')).name;
    if (findStyle(URLP.get('style'))) S.style = findStyle(URLP.get('style')).id;
    if (findStyle(URLP.get('font'))) S.font = findStyle(URLP.get('font')).id;
    if (HUDSCALE[(URLP.get('hudscale') || '').toLowerCase()]) S.hudScale = URLP.get('hudscale').toLowerCase();
    if (/^[1-4]$/.test(URLP.get('players') || '')) S.players = +URLP.get('players');
    if (URLP.get('split') === 'v' || URLP.get('split') === 'h') S.split = URLP.get('split');
    // split screen follows the devices that joined this visit: a saved 2-4 turret count resets to 1 unless ?players= (or ?fakepads=) asks
    if (CTRL && S.control === 'turret' && S.players > 1 && !URLP.has('players')) S.players = 1;
    if (CTRL && !URLP.has('players') && +URLP.get('fakepads') > 0) { S.players = Math.min(4, 1 + (+URLP.get('fakepads') | 0)); S.control = 'turret'; }
    if (CTRL && S.players > 2) S.control = 'turret'; // 3-4 players are always split-screen turret gunners
    if (URLP.get('view') === 'cockpit' || URLP.get('view') === 'shoulder') S.view = URLP.get('view');
    if (PILOTS[URLP.get('pilot')]) S.pilot = URLP.get('pilot');
    if (GUNNERS[URLP.get('gunner')]) S.gunner = URLP.get('gunner');
    if (URLP.has('music')) S.music = URLP.get('music') === 'off' ? '' : URLP.get('music');
    if (URLP.has('volume')) S.musicVol = cl(+URLP.get('volume') / 100 || 0, 0, 1);
    if (URLP.has('sfx')) S.sfxVol = cl(+URLP.get('sfx') / 100 || 0, 0, 1);
    if (TOYTEST) { S.pilot = 'toy'; S.toy = null; }
  }

  // ------------------------------------------------------------------ DOM helpers
  const svgEl = (tag, attrs, parent) => { const e = D.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
  const html = (tag, attrs, parent) => { const e = D.createElement(tag); for (const k in attrs) { if (k === 'text') e.textContent = attrs[k]; else e.setAttribute(k, attrs[k]); } if (parent) parent.appendChild(e); return e; };
  // write-if-changed helpers: steady frames do no DOM writes
  const txt = (e, v) => { if (e && e._t !== v) { e._t = v; e.textContent = v; } };
  const att = (e, n, v) => { if (e && e['_' + n] !== v) { e['_' + n] = v; e.setAttribute(n, v); } };
  const num = (e, n, v, eps) => { if (e && Math.abs((e['_n' + n] ?? 1e9) - v) > eps) { e['_n' + n] = v; e.setAttribute(n, v.toFixed(1)); } };
  const tr = (e, x, y, s) => { if (!e) return; if (Math.abs((e._x ?? 1e9) - x) > 0.4 || Math.abs((e._y ?? 1e9) - y) > 0.4 || e._s !== s) { e._x = x; e._y = y; e._s = s;
    e.setAttribute('transform', s === undefined ? `translate(${x.toFixed(1)} ${y.toFixed(1)})` : `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s})`); } };
  const vis = (e, v) => { if (e && e._v !== v) { e._v = v; e.style.display = v ? '' : 'none'; } };
  const fmtInt = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fmtTime = (t) => { const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1); };
  const fmtDist = (d) => (d >= 1000 ? (d / 1000).toFixed(1) + ' km' : Math.round(d) + ' m');

  const CSS = `
#sgr{--h:#ffb547;--s:#ffe1b0;--a:#7fe4ff;--d:#ff6f6f;--dash:#0d0a08;--tint:#1a1410}
#sgh{position:fixed;inset:0;pointer-events:none;z-index:6;overflow:hidden}
#sgh,#sgr .sgjolt{transform:var(--sgj,none)}
#sgh svg{position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible}
#sgh text{font-family:var(--fl,ui-monospace,Menlo,monospace);font-weight:var(--wt,600)}
#sgh text.fs,#sgh text.fa{font-family:var(--fn,ui-monospace,Menlo,monospace);font-variant-numeric:tabular-nums}
#sgr .pnl{rx:var(--pr,10px);ry:var(--pr,10px);stroke-width:var(--pb,1px)}
#sgr.cut .pnl{clip-path:polygon(12px 0,100% 0,100% calc(100% - 12px),calc(100% - 12px) 100%,0 100%,0 12px)}
#sgr.tx-outline #sgh text,#sgr.tx-outline #tthud text{paint-order:stroke;stroke:#000;stroke-opacity:.8;stroke-width:3.5px;stroke-linejoin:round}
#sgr.tx-glow #sgh text{filter:drop-shadow(0 0 3px var(--h)) drop-shadow(0 1px 1px #000)}
#sgr.tx-outline #sgpop div{-webkit-text-stroke:1.6px rgba(0,0,0,.85);paint-order:stroke fill}
#sgr.tx-glow #sgpop div{text-shadow:0 0 10px currentColor,0 1px 2px #000}
#sgr.pop-upper #sgpop div{text-transform:uppercase}#sgr.pop-wide #sgpop div{letter-spacing:.12em}
#sgr.pop-skew #sgpop div{font-style:italic;letter-spacing:.03em}#sgr.pop-tilt #sgpop div{font-style:oblique 8deg}
#sgh .sh{stroke:var(--h);fill:none}#sgh .fh{fill:var(--h)}#sgh .fs{fill:var(--s)}#sgh .fa{fill:var(--a)}#sgh .fd{fill:var(--d)}
#sgh .sa{stroke:var(--a)}#sgh .sd{stroke:var(--d)}#sgh .fdash{fill:var(--dash)}#sgh .pnl{fill:var(--dash);stroke:var(--h);stroke-opacity:.5;fill-opacity:.88}
#sgr.float #sgh .pnl{fill-opacity:.3;stroke-opacity:.35}#sgr.float #sgh text{paint-order:stroke;stroke:rgba(0,0,0,.55);stroke-width:3px;stroke-linejoin:round}
#sgh .trk{fill:var(--h);fill-opacity:.18}#sgh .hot{fill:var(--d)}
#sgh .blink,#sgset .blink{animation:sgb 1.2s ease-in-out infinite}@keyframes sgb{50%{opacity:.3}}
#sgh canvas{position:absolute;left:0;top:0}
#sgpop{position:absolute;inset:0}
#sgmp{position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:6}
#sgpop div{position:absolute;left:0;top:0;font:800 22px/1 var(--fd,ui-monospace,Menlo,monospace);font-variant-numeric:tabular-nums;white-space:nowrap;text-shadow:0 0 6px rgba(0,0,0,.85),0 1px 2px #000;will-change:transform,opacity;display:none}
#sgflash{position:absolute;inset:0;opacity:0}
#sgscan{position:absolute;inset:0;opacity:0;pointer-events:none;background:repeating-linear-gradient(0deg,rgba(255,255,255,.09) 0 1px,transparent 1px 3px)}
#sgjoy{position:absolute;left:0;top:0;width:120px;height:120px;margin:-60px 0 0 -60px;border-radius:50%;border:2px solid var(--h);opacity:.55;display:none}
#sgjoy i{position:absolute;left:50%;top:50%;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;background:var(--h);opacity:.6}
#sghint{position:fixed;left:max(10px,env(safe-area-inset-left));top:max(10px,env(safe-area-inset-top));z-index:25;display:flex;align-items:center;gap:8px;font:600 12px ui-monospace,Menlo,monospace;color:var(--s);text-shadow:0 1px 3px #000;pointer-events:none}
#sghint button{pointer-events:auto;width:40px;height:40px;border-radius:10px;border:1.5px solid var(--h);background:rgba(6,10,16,.7);color:var(--h);display:grid;place-items:center;cursor:pointer;padding:0}
#sghint button:focus-visible{outline:2px solid var(--s);outline-offset:2px}
#sgnote{position:fixed;left:max(10px,env(safe-area-inset-left));top:58px;z-index:25;font:600 13px ui-monospace,Menlo,monospace;color:var(--d);text-shadow:0 1px 3px #000;pointer-events:none}
#sgres{position:fixed;inset:0;z-index:20;display:none;place-items:center;padding:16px;pointer-events:none}
#sgres>div{pointer-events:auto;min-width:min(340px,100%);max-width:440px;background:rgba(6,10,16,.92);border:2px solid var(--h);border-radius:14px;padding:18px 20px;color:#eef4f8;font:500 15px system-ui,sans-serif;box-shadow:0 0 40px rgba(0,0,0,.6)}
#sgres h2{margin:0 0 10px;font:700 26px var(--fd,ui-monospace,Menlo,monospace);color:var(--h);letter-spacing:.04em}
#sgres dl{display:grid;grid-template-columns:1fr auto;gap:6px 18px;margin:0 0 16px}#sgres dt{color:#b9c8d3}#sgres dd{margin:0;font:700 16px var(--fn,ui-monospace,Menlo,monospace);font-variant-numeric:tabular-nums;color:var(--s);text-align:right}
#sgres button{width:100%;padding:12px;font:700 17px system-ui;border:0;border-radius:10px;background:var(--h);color:#08121a;cursor:pointer}
#sgres p{margin:8px 0 0;font-size:12px;color:#9fb2c0;text-align:center}
#sgset{position:fixed;top:0;right:0;bottom:0;width:min(370px,100vw);box-sizing:border-box;transform:translateX(105%);transition:transform .22s ease-out;z-index:30;pointer-events:auto;overflow-y:auto;overscroll-behavior:contain;
 background:rgba(7,11,17,.95);border-left:2px solid var(--h);color:#e8eff4;font:500 14px/1.4 system-ui,-apple-system,sans-serif;padding:12px 16px calc(28px + env(safe-area-inset-bottom));visibility:hidden}
#sgset.open{transform:none;visibility:visible}
#sgset .hd{display:flex;align-items:center;gap:10px;position:sticky;top:-12px;background:rgba(7,11,17,.98);margin:-12px -16px 6px;padding:12px 16px 8px;z-index:1;border-bottom:1px solid #22303c}
#sgset .hd b{font:700 18px ui-monospace,Menlo,monospace;color:var(--h)}#sgset .hd span{flex:1;color:#9fb2c0;font-size:12px}
#sgset h4{margin:14px 0 6px;font:600 11px ui-monospace,Menlo,monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--h)}
#sgset button,#sgset select,#sgset input[type=text]{font:600 14px system-ui;color:#e8eff4;background:#111b25;border:1px solid #2a3b4a;border-radius:8px;min-height:38px;padding:6px 10px;cursor:pointer}
#sgset button[aria-pressed=true]{background:var(--h);color:#08121a;border-color:var(--h)}
#sgset button:focus-visible,#sgset select:focus-visible,#sgset input:focus-visible{outline:2px solid var(--s);outline-offset:1px}
#sgset .x{margin-left:auto;width:40px;font-size:20px;padding:0}
#sgset .lay{display:grid;grid-template-columns:repeat(auto-fill,minmax(98px,1fr));gap:4px 8px}
#sgset label{display:flex;align-items:center;gap:6px;min-height:32px;cursor:pointer}
#sgset input[type=checkbox]{width:18px;height:18px;accent-color:var(--h)}
#sgset input[type=range]{flex:1;accent-color:var(--h);min-width:90px}
#sgset .seg{display:flex;flex-wrap:wrap;gap:6px}#sgset .seg button{flex:1 1 auto}
#sgset .pal{display:grid;grid-template-columns:1fr 1fr;gap:6px}#sgset .pal button{display:flex;align-items:center;gap:6px;text-align:left;font-size:13px}
#sgset .pal i{display:inline-block;width:10px;height:10px;border-radius:3px}
#sgset .sty{display:grid;grid-template-columns:1fr 1fr;gap:6px}#sgset .sty button{display:grid;gap:3px;text-align:left;font-size:12px;padding:6px 8px}
#sgset .sty b{display:block;overflow:hidden;white-space:nowrap;padding:5px 7px;font-size:17px;line-height:1.1;font-variant-numeric:tabular-nums;border:1px solid}
#sgset .row{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:6px}
#sgset select{width:100%}
#sgset .note{color:#9fb2c0;font-size:12.5px;margin:6px 0 0}
#sgset .toy{display:flex;gap:10px;align-items:flex-start;margin-top:8px}
#sgset .toy canvas{position:static;display:block;width:160px;height:120px;border-radius:8px;border:1px solid #2a3b4a;background:#000;flex:none}
#sgset .toy>div{display:grid;gap:6px;min-width:0}
#sgset .meter{height:8px;border-radius:4px;background:#1b2834;overflow:hidden}#sgset .meter i{display:block;height:100%;width:0;background:var(--a)}
#sgset input[type=text]{width:100%;box-sizing:border-box;font-family:ui-monospace,Menlo,monospace;cursor:text}
#sgset pre{margin:6px 0 0;white-space:pre-wrap;font:12px/1.45 ui-monospace,Menlo,monospace;color:#b9c8d3;max-height:180px;overflow:auto}
@media (max-width:420px){#sgset .toy{flex-direction:column}}
@media (prefers-reduced-motion:reduce){#sgset{transition:none}#sgh .blink{animation:none}}`;

  // ------------------------------------------------------------------ HUD markup (from the cockpit board's SVG designs)
  const WEAPON = `<g data-k="wpn" data-l="weapon"><rect x="-120" y="-30" width="240" height="62" rx="9" class="pnl"/>
    <text data-k="wname" x="-104" y="-10" class="fh" font-size="13" letter-spacing="2">BLASTER</text><text data-k="wlvl" x="104" y="-10" class="fs" font-size="14" text-anchor="end">L1</text>
    <text x="-104" y="7" class="fh" font-size="10" letter-spacing="1">XP</text><rect x="-80" y="0" width="184" height="6" rx="3" class="trk"/><rect data-k="xpf" x="-80" y="0" width="0" height="6" rx="3" class="fa"/>
    <text x="-104" y="24" class="fh" font-size="10" letter-spacing="1">HEAT</text><rect x="-68" y="15" width="172" height="10" rx="3" class="trk"/><rect data-k="heatf" x="-68" y="15" width="0" height="10" rx="3" class="fh"/>
    <text data-k="ovh" x="0" y="-38" class="fd blink" font-size="16" letter-spacing="3" text-anchor="middle" style="display:none">OVERHEAT</text></g>`;
  const CANOPY = `<defs><radialGradient id="sgglass" cx=".5" cy=".5" r=".5"><stop offset=".55" style="stop-color:var(--h);stop-opacity:0"/><stop offset="1" style="stop-color:var(--h);stop-opacity:.08"/></radialGradient>
    <linearGradient id="sgdashg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--tint)"/><stop offset="1" style="stop-color:var(--dash)"/></linearGradient></defs>
  <g data-l="frame"><rect data-k="glass" fill="url(#sgglass)" width="100" height="100"/>
    <path data-k="strutL" class="fdash" opacity=".93" d="M0 0 L120 0 C 70 220 60 420 96 640 L0 690 Z"/>
    <path data-k="strutR" class="fdash" opacity=".93" d="M0 0 L-120 0 C -70 220 -60 420 -96 640 L0 690 Z"/>
    <g data-k="dash"><path fill="url(#sgdashg)" d="M0 1 L0 -176 C 300 -226 520 -216 728 -216 C 936 -216 1156 -226 1456 -176 L1456 1 Z"/>
      <path class="sh" stroke-opacity=".35" stroke-width="2" vector-effect="non-scaling-stroke" d="M80 -164 C 360 -206 540 -200 728 -200 C 916 -200 1096 -206 1376 -164"/></g></g>
  <g data-l="marks" data-k="marks"></g>
  <g data-l="reticle"><path data-k="bore" class="sh" stroke-width="2" stroke-opacity=".6" d="M-150 -40 L-135 -40 M-150 0 L-128 0 M-150 40 L-135 40 M150 -40 L135 -40 M150 0 L128 0 M150 40 L135 40"/>
    <g data-k="ret" class="sh" stroke-width="2"><circle r="30"/><path d="M-52 0 H-36 M36 0 H52 M0 -52 V-36 M0 36 V52"/><circle r="3" class="fh"/></g></g>
  <g data-l="score"><g data-k="pL"><rect x="-120" y="-44" width="240" height="96" rx="10" class="pnl"/>
      <g data-k="hullg"><text x="-104" y="-18" class="fh" font-size="14" letter-spacing="2">HULL</text><g data-k="hull"></g></g>
      <text data-k="score" x="-104" y="34" class="fs" font-size="22">SCORE 0</text></g>
    <g data-k="pR"><rect x="-120" y="-44" width="240" height="96" rx="10" class="pnl"/>
      <text data-k="clab" x="-104" y="-18" class="fh" font-size="14" letter-spacing="2">COMBO</text><text data-k="combo" x="-104" y="14" class="fs" font-size="30">×1</text>
      <text data-k="counter" x="-104" y="38" class="fa" font-size="15"></text></g></g>
  ${WEAPON}
  <g data-l="timer" data-k="tmr"><rect x="-66" y="-19" width="132" height="34" rx="8" class="pnl"/><text data-k="time" y="6" text-anchor="middle" class="fs" font-size="18">0:00.0</text></g>`;
  const VISOR = `<defs><radialGradient id="sgvis" cx=".5" cy=".5" r=".72"><stop offset=".72" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></radialGradient>
    <clipPath id="sgclip"><rect x="-312" y="0" width="624" height="100"/></clipPath></defs>
  <g data-l="frame"><rect data-k="glass" fill="url(#sgvis)" width="100" height="100"/>
    <g class="sh" stroke-width="2" stroke-opacity=".85"><path data-k="cTL" d="M40 90 V40 H90"/><path data-k="cTR" d="M-40 90 V40 H-90"/><path data-k="cBL" d="M40 -90 V-40 H90"/><path data-k="cBR" d="M-40 -90 V-40 H-90"/></g>
    <g data-k="ladL" class="sh" stroke-opacity=".6" stroke-width="2"><path d="M0 -150 q-30 150 0 300 M-18 -70 h24 M-24 0 h34 M-18 70 h24"/><text data-k="pitch" x="-52" y="4" class="fh" stroke="none" font-size="13" text-anchor="end">+0°</text></g>
    <g data-k="ladR" class="sh" stroke-opacity=".6" stroke-width="2"><path d="M0 -150 q30 150 0 300 M-6 -70 h24 M-10 0 h34 M-6 70 h24"/><text data-k="spd" x="52" y="4" class="fh" stroke="none" font-size="13">SPD 0.0</text></g></g>
  <g data-k="ribbon"><g data-l="frame"><path class="sh" stroke-opacity=".4" stroke-width="2" d="M-308 58 H308"/>
      <g clip-path="url(#sgclip)"><g data-k="ticks"><path class="sh" stroke-opacity=".7" stroke-width="2" d="${Array.from({ length: 15 }, (_, i) => { const j = i - 7, x = j * 60; return j % 2 ? `M${x} 54 V62` : `M${x} 52 V64`; }).join(' ')}"/>
        ${Array.from({ length: 8 }, (_, i) => `<text data-k="tl${i}" x="${(i * 2 - 7) * 60 + 60}" y="84" text-anchor="middle" class="fh" font-size="13">000</text>`).join('')}</g></g>
      <path class="fh" d="M0 40 l-8 -12 h16z"/></g>
    <g data-l="marks" data-k="cmp"></g></g>
  <g data-l="marks" data-k="marks"></g>
  <g data-l="reticle"><g data-k="ret" class="sh" stroke-width="2"><path d="M-22 0 h14 M8 0 h14 M0 -22 v14 M0 8 v14"/><circle r="2" class="fh" stroke="none"/></g></g>
  <g data-l="score"><g data-k="vscore"><text x="0" y="0" class="fh" font-size="13" letter-spacing="2" text-anchor="end">SCORE</text>
      <text data-k="score" x="0" y="34" class="fs" font-size="30" text-anchor="end">0</text><text data-k="combo" x="0" y="58" class="fa" font-size="18" text-anchor="end">×1</text></g>
    <g data-k="vcount"><text data-k="clabel" class="fh" font-size="13" letter-spacing="2"></text><text data-k="counter" y="38" class="fs" font-size="36"></text>
      <rect data-k="cbar" y="54" width="160" height="8" rx="4" class="trk"/><rect data-k="cfill" y="54" width="0" height="8" rx="4" class="fh"/>
      <g data-k="hullg"><text y="84" class="fh" font-size="12" letter-spacing="2">HULL</text><g data-k="hull" transform="translate(46 0)"></g></g></g></g>
  ${WEAPON}
  <g data-l="timer" data-k="tmr"><text data-k="time" y="0" text-anchor="middle" class="fs" font-size="16">0:00.0</text></g>`;

  // ------------------------------------------------------------------ build the overlay (once; rebuilt only on a skin change)
  let scanEl, root, hudEl, svg, E = {}, LEL = {}, mm, mmCtx, popEl, flashEl, joyEl, hintEl, noteEl, resEl, setEl, U = {};
  const POPS = [], MARKS = [], CMPS = [], HULLS = [];
  let W = 1, H = 1, K = 1, mmSize = 200, mmScale = 1, dpr = 1;

  function buildDom() {
    const st = html('style', { text: CSS }, D.head);
    root = html('div', { id: 'sgr' }, D.body);
    if (GM && GM.hudFloat) root.classList.add('float');
    hudEl = html('div', { id: 'sgh', 'aria-hidden': 'true' }, root);
    flashEl = html('div', { id: 'sgflash' }, hudEl);
    svg = svgEl('svg', { xmlns: NS }, hudEl);
    scanEl = html('div', { id: 'sgscan' }, hudEl);
    mm = html('canvas', { 'data-l': 'minimap' }, hudEl); mmCtx = mm.getContext('2d');
    popEl = html('div', { id: 'sgpop', 'data-l': 'popups' }, hudEl);
    for (let i = 0; i < 24; i++) POPS.push({ el: html('div', {}, popEl), t: 0, life: 0, x: 0, y: 0 });
    joyEl = html('div', { id: 'sgjoy' }, hudEl); html('i', {}, joyEl);
    hintEl = html('div', { id: 'sghint' }, root);
    hintEl.innerHTML = `<button type="button" aria-label="Open settings" title="Settings (Esc)"><svg width="22" height="22" viewBox="-12 -12 24 24" fill="none" stroke="currentColor"><circle r="7" stroke-width="4" stroke-dasharray="2.6 2.9"/><circle r="5.2" stroke-width="2"/><circle r="1.8" stroke-width="1.6"/></svg></button><span>Esc · settings</span>`;
    hintEl.querySelector('button').onclick = (e) => { e.stopPropagation(); unlock(); setOpen(!open); };
    noteEl = html('div', { id: 'sgnote', 'aria-live': 'polite' }, root);
    resEl = html('div', { id: 'sgres', role: 'dialog', 'aria-label': 'Results' }, root);
    resEl.innerHTML = '<div><h2></h2><dl></dl><button type="button">Play again</button><p>Enter or gamepad A</p></div>';
    resEl.querySelector('button').onclick = () => again();
    buildSettings();
    void st;
  }

  function buildSkin() {
    svg.innerHTML = skin === 'visor' ? VISOR : CANOPY;
    E = {}; for (const e of svg.querySelectorAll('[data-k]')) E[e.dataset.k] = e;
    LEL = {}; for (const l of LAYERS) LEL[l] = [];
    for (const e of root.querySelectorAll('[data-l]')) LEL[e.dataset.l].push(e);
    for (const e of LEL.weapon) e._v = undefined;
    // pools
    MARKS.length = 0; CMPS.length = 0; HULLS.length = 0;
    const visor = skin === 'visor';
    const bracket = visor ? 'M-1 -1 h.26 M-1 -1 v.36 M1 -1 h-.26 M1 -1 v.36 M-1 1 h.26 M-1 1 v-.36 M1 1 h-.26 M1 1 v-.36'
      : 'M-1 -.5 V-1 H-.5 M.5 -1 H1 V-.5 M1 .5 V1 H.5 M-.5 1 H-1 V.5';
    for (let i = 0; i < 24; i++) {
      const g = svgEl('g', { style: 'display:none' }, E.marks);
      const p = svgEl('path', { d: bracket, fill: 'none', 'stroke-width': visor ? 2 : 3, 'vector-effect': 'non-scaling-stroke' }, g);
      const t = svgEl('text', { 'font-size': visor ? 13 : 14 }, g);
      MARKS.push({ g, p, t, _v: false });
      MARKS[i].g._v = false;
    }
    if (E.cmp) for (let i = 0; i < 10; i++) {
      const g = svgEl('g', { style: 'display:none' }, E.cmp);
      const p = svgEl('path', { d: 'M0 -10 l8 10 -8 10 -8 -10z' }, g), t = svgEl('text', { y: -16, 'text-anchor': 'middle', 'font-size': 13 }, g);
      g._v = false; CMPS.push({ g, p, t });
    }
    for (let i = 0; i < 8; i++) { const r = svgEl('rect', { y: visor ? 76 : -6, height: visor ? 9 : 14, rx: 3, class: 'fh' }, E.hull); r._v = true; HULLS.push(r); }
    if (!visor) txt(E.wname, GM && GM.weaponName ? GM.weaponName : 'BLASTER'); else txt(E.wname, 'TRACTOR');
    // optional GAME.comboPanel: false hides the combo readout (a game that shows its own chain); { label, field } repurposes it
    // to show stats[field] as a whole number under that label (Reef Run: KILLS). Default: the combo, as before.
    const cp = GM ? GM.comboPanel : undefined;
    if (E.clab) txt(E.clab, cp && cp.label ? String(cp.label).toUpperCase() : 'COMBO');
    vis(E.combo, cp !== false); if (E.clab) vis(E.clab, cp !== false);
    for (const k in cache) cache[k] = undefined;
    layout(); applyLayers(); if (root) applyStyle();
  }

  function layout() {
    W = innerWidth; H = innerHeight; dpr = Math.min(2, devicePixelRatio || 1);
    K = cl(Math.min(W / 1180, H / 700), 0.42, 1.25) * (HUDSCALE[S.hudScale] || 1);
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    if (E.glass) { E.glass.setAttribute('width', W); E.glass.setAttribute('height', H); }
    const set = (k, s) => { if (E[k]) E[k].setAttribute('transform', s); };
    const k = K.toFixed(3);
    if (skin === 'canopy') {
      set('strutL', `scale(${k} ${(H / 816).toFixed(3)})`); set('strutR', `translate(${W} 0) scale(${k} ${(H / 816).toFixed(3)})`);
      set('dash', `translate(0 ${H}) scale(${(W / 1456).toFixed(4)} ${k})`);
      const xl = Math.max(W / 2 - 468 * K, 126 * K), xr = Math.min(W / 2 + 468 * K, W - 126 * K), y = H - 116 * K;
      set('pL', `translate(${xl} ${y}) scale(${k})`); set('pR', `translate(${xr} ${y}) scale(${k})`);
      set('wpn', `translate(${xl} ${H - 200 * K}) scale(${k})`); set('tmr', `translate(${W / 2} ${34 * K + 4}) scale(${k})`);
      set('bore', `translate(${W / 2} ${H / 2}) scale(${k})`);
      mmSize = 212 * K;
      if (GM && GM.hudLayout && GM.hudLayout.radar === 'right') placeMM(xr, H - 300 * K, 212, 212, 106, 106); // HOOK: Reef Run keeps the bottom centre for its turret barrels
      else placeMM(W / 2, H - 104 * K, 212, 212, 106, 106);
    } else {
      set('cTL', `scale(${k})`); set('cTR', `translate(${W} 0) scale(${k})`); set('cBL', `translate(0 ${H}) scale(${k})`); set('cBR', `translate(${W} ${H}) scale(${k})`);
      const dx = Math.min(428 * K, W / 2 - 44 * K);
      set('ladL', `translate(${W / 2 - dx} ${H / 2}) scale(${k})`); set('ladR', `translate(${W / 2 + dx} ${H / 2}) scale(${k})`);
      set('ribbon', `translate(${W / 2} ${4 * K}) scale(${k})`); set('tmr', `translate(${W / 2} ${116 * K}) scale(${k})`);
      set('vscore', `translate(${W - 60 * K} ${128 * K}) scale(${k})`); set('vcount', `translate(${W - 236 * K} ${H - 176 * K}) scale(${k})`);
      set('wpn', `translate(${W - 160 * K} ${H - 252 * K}) scale(${k})`);
      placeMM(150 * K, H - 176 * K, 190, 206, 95, 72);
    }
  }
  let mmOX = 0, mmOY = 0;
  function placeMM(cx, cy, w, h, ox, oy) { // canvas in design units w×h, design origin at (ox, oy), placed so the origin is at (cx, cy)
    mm.style.width = w * K + 'px'; mm.style.height = h * K + 'px';
    mm.style.transform = `translate(${(cx - ox * K).toFixed(1)}px, ${(cy - oy * K).toFixed(1)}px)`;
    mm.width = Math.round(w * K * dpr); mm.height = Math.round(h * K * dpr); mmScale = K * dpr; mmOX = ox; mmOY = oy;
  }

  // ------------------------------------------------------------------ apply settings
  function applyPalette() {
    P = findPal(S.scheme) || findPal(ST.pal) || findPal(GM && GM.palette) || (skin === 'visor' ? PAL[1] : PAL[0]);
    for (const k of ['h', 's', 'a', 'd', 'dash', 'tint']) root.style.setProperty('--' + k, P[k]);
  }
  function applyLayers() {
    for (const l of LAYERS) for (const e of LEL[l] || []) e.style.display = S.layers[l] ? '' : 'none';
    if (SC) { if (!SC.p1) SC.p1 = [0, 0, 0, 1]; SC.p1[3] = S.layers.rail ? 1 : 0; }
    const st = D.getElementById('i');
    if (st && G && st.hidden === S.layers.stats) { synthH = true; dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyH', key: 'h' })); dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyH', key: 'h' })); synthH = false; }
    if (typeof FX !== 'undefined') { FX.enabled = !!S.layers.fx; FX.words = !!S.fxWords; if (S.shake >= 0) FX.shakeScale = S.shake / 100; }
  }
  // ---- HUD style: fonts (CSS variables on #sgr, lazy Google Fonts), traits (classes), font sizes, reticle; palette via applyPalette
  let ST = STYLES[0], FZ = 1; const fontsIn = new Set();
  function loadFonts(st, text) {
    if (!st.gf.length) return; const key = st.id + (text ? ':t' : ''); if (fontsIn.has(key) || fontsIn.has(st.id)) return; fontsIn.add(key);
    html('link', { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?' + st.gf.map((f) => 'family=' + f).join('&') + '&display=swap' + (text ? '&text=' + encodeURIComponent(text) : '') }, D.head);
  }
  function applyStyle() {
    ST = STYLES.find((s) => s.id === S.style) || STYLES[0]; const FT = STYLES.find((s) => s.id === S.font) || ST;
    loadFonts(ST); if (FT !== ST) loadFonts(FT);
    if (!root) return;
    root.style.setProperty('--fd', FT.fd); root.style.setProperty('--fl', FT.fl); root.style.setProperty('--fn', FT.fn); root.style.setProperty('--wt', FT.wt);
    root.style.setProperty('--pr', ST.r + 'px'); root.style.setProperty('--pb', ST.bw + 'px');
    for (const c of [...root.classList]) if (/^(tx-|pop-|cut$)/.test(c)) root.classList.remove(c);
    root.classList.add('tx-' + ST.tx); if (ST.pop) root.classList.add('pop-' + ST.pop); if (ST.cut) root.classList.toggle('cut', true);
    MPF = { d: FT.fd, l: FT.fl, n: FT.fn, wt: FT.wt, fz: FT.fz, fzl: FT.fzl || FT.fz, tx: ST.tx, ret: ST.ret }; // the split HUD (canvas) uses the same fonts and text effect
    const fz = FT.fz; FZ = fz; // font sizes: design size × the font's factor (pixel fonts run wide)
    const fzl = FT.fzl || fz; // labels may scale differently from the numbers (fzl)
    for (const e of svg.querySelectorAll('text')) { if (e._fs === undefined) e._fs = +e.getAttribute('font-size') || 0; const c = e.getAttribute('class') || ''; if (e._fs) e.setAttribute('font-size', (e._fs * (/\bf[sa]\b/.test(c) ? fz : fzl)).toFixed(1)); }
    if (E.ret) { if (E.ret._def === undefined) E.ret._def = E.ret.innerHTML; E.ret.innerHTML = ST.ret && RETICLE[ST.ret] ? RETICLE[ST.ret] : E.ret._def; }
    applyPalette();
  }
  function applyAll() { input.players = S.players; applyStyle(); applyPalette(); applyLayers(); audioApplyVol(); syncUI(); }

  // ------------------------------------------------------------------ settings panel
  function buildSettings() {
    setEl = html('aside', { id: 'sgset', 'aria-label': 'Settings', role: 'dialog' }, root);
    const segs = (attr, obj) => Object.keys(obj).map((k) => `<button type="button" data-${attr}="${k}" aria-pressed="false">${obj[k]}</button>`).join('');
    setEl.innerHTML = `<div class="hd"><b>Settings</b><span>Paused · Esc to resume</span><button type="button" class="x" data-act="close" aria-label="Close settings">×</button></div>
<h4>HUD layers</h4><div class="lay">${LAYERS.map((l) => `<label><input type="checkbox" data-layer="${l}">${l}</label>`).join('')}</div>
<h4>HUD style</h4><div class="sty">${STYLES.map((s) => { const p = findPal(s.pal) || findPal(GM && GM.palette) || PAL[0];
  return `<button type="button" data-style="${s.id}" aria-pressed="false"><b style="font-family:${s.fd.replace(/"/g, "'")};font-weight:${s.wt};font-size:${(17 * s.fz).toFixed(1)}px;color:${p.h};background:${p.dash};border-color:${p.h};border-radius:${Math.min(s.r, 12)}px${s.tx === 'glow' ? ';text-shadow:0 0 6px ' + p.h : s.tx === 'outline' ? ';-webkit-text-stroke:1px #000;paint-order:stroke fill' : ''}">12,340 ×4</b>${s.name}</button>`; }).join('')}</div>
<div class="row"><label style="flex:1">Font <select data-u="font" aria-label="HUD font"><option value="">From the style</option>${STYLES.map((s) => `<option value="${s.id}">${s.name} · ${s.fd.split(',')[0].replace(/'/g, '')}</option>`).join('')}</select></label></div>
<div class="row"><span>HUD size</span><div class="seg" style="flex:1"><button type="button" data-hscale="s" aria-pressed="false">S</button><button type="button" data-hscale="m" aria-pressed="false">M</button><button type="button" data-hscale="l" aria-pressed="false">L</button></div></div>
<h4>Colour scheme</h4><div class="pal"><button type="button" data-scheme="" aria-pressed="false">From the style</button>${PAL.map((p) => `<button type="button" data-scheme="${p.name}" aria-pressed="false"><span>${[p.h, p.s, p.a, p.d].map((c) => `<i style="background:${c}"></i>`).join('')}</span>${p.name}</button>`).join('')}</div>
<h4>View</h4><div class="seg"><button type="button" data-view="cockpit" aria-pressed="false">Cockpit · you are the ship</button><button type="button" data-view="shoulder" aria-pressed="false">Over the shoulder</button></div>
${GM && GM.settingsHTML ? GM.settingsHTML() : ''}
${CTRL ? `<h4>Control</h4><div class="seg">${segs('control', CTRL)}</div>
<div class="row" data-u="lookrow"><label style="flex:1">Look speed <input type="range" min="20" max="300" data-u="lsens" aria-label="Look sensitivity"></label><label><input type="checkbox" data-u="recentre">Recentre</label></div>
<p class="note">Turret: the ship flies the rail. Mouse looks (click to capture, Esc releases), right stick or arrows/WASD look, click/Space/RT fires.</p>` : ''}
<h4>Players</h4><div class="seg"><button type="button" data-players="1" aria-pressed="false">1 · fly and shoot</button>${CTRL ? `<button type="button" data-players="2s" aria-pressed="false">2 · split</button><button type="button" data-players="3s" aria-pressed="false">3 · split</button><button type="button" data-players="4s" aria-pressed="false">4 · split</button>` : ''}<button type="button" data-players="2" aria-pressed="false">2 · pilot + gunner</button></div>
${CTRL ? `<div class="row"><span>Two-player split</span><div class="seg" style="flex:1"><button type="button" data-split="v" aria-pressed="false">Side by side</button><button type="button" data-split="h" aria-pressed="false">Stacked</button></div></div>
<p class="note">Split screen: one ship, a turret gunner per player. Gamepads join on the start menu with A (B leaves); keyboard + mouse is one player.</p>` : ''}
<h4>Pilot input</h4><div class="seg">${segs('pilot', PILOTS)}</div>
<div class="toy" data-u="toybox"><canvas width="160" height="120" data-u="toycv" aria-label="Webcam preview with the toy box"></canvas>
  <div><button type="button" data-act="toyreg">Register toy</button><div class="meter" aria-label="Tracking confidence"><i data-u="toymeter"></i></div><p class="note" data-u="toystat">Hold a brightly coloured toy inside the box, then press Register.</p></div></div>
<h4>Gunner input</h4><div class="seg">${segs('gunner', GUNNERS)}</div><p class="note" data-u="padstat">No gamepad. Press a button on one to connect it.</p>
<h4>Music</h4><select data-u="music" aria-label="Music track"><option value="">Off</option></select>
<div class="row"><button type="button" data-act="mplay">Play</button><button type="button" data-act="mstop">Stop</button><label>Volume <input type="range" min="0" max="100" data-u="mvol"></label></div>
<p class="note" data-u="mstat">Loading the sound catalogue…</p>
<h4>Effects</h4><div class="row"><label style="flex:1">Volume <input type="range" min="0" max="100" data-u="svol"></label></div>
<h4>Command line</h4><input type="text" data-u="cmd" placeholder="try: help" aria-label="Command" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go"><pre data-u="log"></pre>`;
    for (const e of setEl.querySelectorAll('[data-u]')) U[e.dataset.u] = e;
    U.toyctx = U.toycv.getContext('2d');
    setEl.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return; unlock();
      const d = b.dataset;
      if (d.act === 'close') setOpen(false);
      else if (d.act === 'toyreg') say(command('toy register'));
      else if (d.act === 'mplay') { if (!S.music && AU.music.length) S.music = AU.music[0].id; musicPlay(); syncUI(); save(); }
      else if (d.act === 'mstop') musicStop();
      else if (d.scheme !== undefined) say(command('palette ' + (d.scheme || 'style')));
      else if (d.style) say(command('style ' + d.style));
      else if (d.hscale) say(command('hudsize ' + d.hscale));
      else if (d.game) say(command(d.game)); // optional game settings (GAME.settingsHTML: buttons with data-game="<command>")
      else if (d.view) say(command('view ' + d.view));
      else if (d.players) say(command(d.players.endsWith('s') ? 'players ' + d.players[0] : CTRL && d.players === '2' ? 'players 2 pilot' : 'players ' + d.players));
      else if (d.split) say(command('split ' + d.split));
      else if (d.pilot) say(command('pilot ' + d.pilot));
      else if (d.gunner) say(command('gunner ' + d.gunner));
      else if (d.control) say(command('control ' + d.control));
    });
    setEl.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.layer) say(command(`hud ${t.dataset.layer} ${t.checked ? 'on' : 'off'}`));
      else if (t === U.recentre) say(command('recentre ' + (t.checked ? 'on' : 'off')));
      else if (t === U.font) say(command('font ' + (t.value || 'style')));
      else if (t === U.music) { unlock(); S.music = t.value; if (S.music) musicPlay(); else musicStop(); save(); }
    });
    setEl.addEventListener('input', (e) => {
      if (e.target === U.lsens) { S.lookSens = U.lsens.value / 100; save(); }
      else if (e.target === U.mvol) { S.musicVol = U.mvol.value / 100; audioApplyVol(); save(); }
      else if (e.target === U.svol) { S.sfxVol = U.svol.value / 100; audioApplyVol(); save(); play('pickup-1', 0.6, 120); }
    });
    // keys inside the panel stay in the panel (the engine's H toggle must not see typing)
    setEl.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.code === 'Escape') { e.preventDefault(); setOpen(false); }
      else if (e.target === U.cmd && (e.key === 'Enter')) { e.preventDefault(); const v = U.cmd.value.trim(); if (v) { say('> ' + v); say(command(v)); hist.push(v); hi = hist.length; } U.cmd.value = ''; }
      else if (e.target === U.cmd && e.key === 'ArrowUp' && hist.length) { hi = Math.max(0, hi - 1); U.cmd.value = hist[hi]; e.preventDefault(); }
      else if (e.target === U.cmd && e.key === 'ArrowDown') { hi = Math.min(hist.length, hi + 1); U.cmd.value = hist[hi] || ''; e.preventDefault(); }
    });
    setEl.addEventListener('keyup', (e) => e.stopPropagation());
    setEl.addEventListener('pointerdown', (e) => e.stopPropagation());
  }
  const hist = []; let hi = 0; const logLines = [];
  function say(m) { if (!m) return; for (const l of String(m).split('\n')) logLines.push(l); while (logLines.length > 14) logLines.shift(); if (U.log) { U.log.textContent = logLines.join('\n'); U.log.scrollTop = 1e6; } }
  function syncUI() {
    if (!setEl) return;
    for (const e of setEl.querySelectorAll('[data-layer]')) e.checked = !!S.layers[e.dataset.layer];
    if (GM && GM.syncSettings) GM.syncSettings(setEl); // optional: the game marks its own settings (aria-pressed)
    for (const e of setEl.querySelectorAll('[data-scheme]')) e.setAttribute('aria-pressed', String(e.dataset.scheme === S.scheme));
    for (const e of setEl.querySelectorAll('[data-style]')) e.setAttribute('aria-pressed', String(e.dataset.style === S.style));
    for (const e of setEl.querySelectorAll('[data-hscale]')) e.setAttribute('aria-pressed', String(e.dataset.hscale === S.hudScale));
    if (U.font && U.font.value !== S.font) U.font.value = S.font;
    for (const e of setEl.querySelectorAll('[data-view]')) e.setAttribute('aria-pressed', String(e.dataset.view === S.view));
    for (const e of setEl.querySelectorAll('[data-players]')) { const v = e.dataset.players, sp = v.endsWith('s'); e.setAttribute('aria-pressed', String(+v[0] === S.players && (S.players === 1 || !CTRL || sp === turretOn()))); }
    for (const e of setEl.querySelectorAll('[data-split]')) e.setAttribute('aria-pressed', String(e.dataset.split === S.split));
    lobbySync();
    for (const e of setEl.querySelectorAll('[data-pilot]')) e.setAttribute('aria-pressed', String(e.dataset.pilot === S.pilot));
    for (const e of setEl.querySelectorAll('[data-gunner]')) e.setAttribute('aria-pressed', String(e.dataset.gunner === S.gunner));
    U.toybox.style.display = S.pilot === 'toy' ? '' : 'none';
    for (const e of setEl.querySelectorAll('[data-control]')) e.setAttribute('aria-pressed', String(e.dataset.control === S.control));
    if (U.lsens) { U.lsens.value = Math.round(S.lookSens * 100); U.recentre.checked = recentreOn(); U.lookrow.style.opacity = turretOn() ? '' : '0.5'; }
    U.mvol.value = Math.round(S.musicVol * 100); U.svol.value = Math.round(S.sfxVol * 100);
    if (U.music.value !== S.music) U.music.value = S.music;
  }
  function setOpen(v) {
    if (open === v) return; open = v;
    setEl.classList.toggle('open', v); setEl.setAttribute('aria-hidden', String(!v));
    if (v) { syncUI(); for (const s of STYLES) loadFonts(s, '12,340 ×4'); if (S.pilot === 'toy') toyStart(); setEl.querySelector('.x').focus({ preventScroll: true }); unlockPointer(); }
    else { if (D.activeElement && setEl.contains(D.activeElement)) D.activeElement.blur(); save(); lockPointer(false); }
  }

  // ------------------------------------------------------------------ commands
  const HELP = () => `commands:
  rail on|off|toggle            ghost rail
  hud <layer> on|off|toggle     layers: ${LAYERS.join(' ')}
  hud all on|off · hud list
  fx words on|off               comic words on hit effects
  shake <0-100>                 screen shake strength on impacts
  scheme <name>                 ${PAL.map((p) => pkey(p.name)).join(' ')}
  style <name>                  HUD style: ${STYLES.map((s) => s.id).join(' ')} (?style=)
  font <name|style>             mix a style's fonts in (?font=) · palette <name|style> (?palette=)
  hudsize s|m|l                 HUD scale (?hudscale=)
  view cockpit|shoulder|toggle   camera (V switches)
  players 1-4 [pilot]           2-4 in turret control: split screen, one gunner each; players 2 pilot: pilot + gunner
  split v|h                     two-player split: side by side (v) or stacked (h) (?split=)
  pilot keys|gamepad|touch|toy  gunner mouse|gamepad|touch${CTRL ? `
  control ${Object.keys(CTRL).join('|')}|toggle    turret: free look, autopilot · pilot: steer
  sens <0.2-3> · recentre on|off|toggle   turret look speed, drift back to forward` : ''}
  toy register · toy off
  music <name|next|off|list> · volume <0-100> · sfx <0-100>
  skin canopy|visor · help`;
  const TURRET_CMDS = new Set(['control', 'mode', 'sens', 'sensitivity', 'look', 'recentre', 'recenter']);
  function layerCmd(name, op) {
    const l = ALIAS[name] || name;
    if (!(l in S.layers)) return `unknown layer "${name}". Layers: ${LAYERS.join(', ')}`;
    const v = op === 'on' || op === '1' || op === 'show' ? true : op === 'off' || op === '0' || op === 'hide' ? false : !S.layers[l];
    S.layers[l] = v; applyLayers(); syncUI(); save();
    return `${l} ${v ? 'on' : 'off'}`;
  }
  function command(line) {
    const a = String(line).trim().toLowerCase().split(/\s+/), c = a[0];
    if (GM && GM.commandFirst) { const r = GM.commandFirst(a); if (r != null) return r; } // a game's sub-commands of shell commands (Reef Run: style reroll, music cycle)
    switch (!CTRL && TURRET_CMDS.has(c) ? '\u0000' : c) { // turret commands exist only on pages whose game declares GAME.controls
      case '': return '';
      case 'help': case '?': return HELP() + (GM && GM.help ? '\n' + GM.help : '');
      case 'rail': { const r = a[1] && GM && GM.command ? GM.command(a) : null; return r != null ? r : layerCmd('rail', a[1]); } // a game may add rail modes (Reef Run: rail holo|classic)
      case 'hud': case 'layer': case 'layers':
        if (!a[1] || a[1] === 'list') return LAYERS.map((l) => `${l} ${S.layers[l] ? 'on' : 'off'}`).join(' · ');
        if (a[1] === 'all') { for (const l of LAYERS) S.layers[l] = a[2] !== 'off'; applyLayers(); syncUI(); save(); return 'all layers ' + (a[2] !== 'off' ? 'on' : 'off'); }
        return layerCmd(a[1], a[2]);
      case 'fx':
        if (a[1] === 'words') { S.fxWords = a[2] === 'on' ? true : a[2] === 'off' ? false : !S.fxWords; applyLayers(); save(); return 'fx words ' + (S.fxWords ? 'on' : 'off') + (typeof FX === 'undefined' ? ' (no FX module on this page)' : ''); }
        return layerCmd('fx', a[1]);
      case 'shake': { const v = Math.max(0, Math.min(100, +a[1])); if (!Number.isFinite(+a[1])) return 'shake ' + Math.round((typeof FX !== 'undefined' ? FX.shakeScale : 1) * 100) + ' (0-100)'; S.shake = v; applyLayers(); save(); return 'shake ' + v; }
      case 'style': case 'theme': {
        const s = findStyle(a.slice(1).join(' ')); if (!s) return 'style: ' + ST.name + '. Styles: ' + STYLES.map((x) => x.id).join(', ');
        S.style = s.id; S.scheme = ''; S.font = ''; applyStyle(); layout(); for (const k in cache) cache[k] = undefined; syncUI(); save(); return 'style ' + s.name + ' (palette and font follow it; override with palette <name> or font <name>)';
      }
      case 'font': {
        const q = a.slice(1).join(' '); if (q === 'style' || q === 'default' || q === 'reset') { S.font = ''; applyStyle(); syncUI(); save(); return 'font: from the style'; }
        const s = findStyle(q); if (!s) return 'fonts: ' + STYLES.map((x) => x.id + ' (' + x.fd.split(',')[0].replace(/'/g, '') + ')').join(', ');
        S.font = s.id; applyStyle(); for (const k in cache) cache[k] = undefined; syncUI(); save(); return 'font ' + s.fd.split(',')[0].replace(/'/g, '');
      }
      case 'hudsize': case 'size': { const v = (a[1] || '').toLowerCase()[0]; if (!HUDSCALE[v]) return 'hudsize s | m | l'; S.hudScale = v; layout(); for (const k in cache) cache[k] = undefined; syncUI(); save(); return 'HUD size ' + v.toUpperCase(); }
      case 'scheme': case 'colour': case 'color': case 'palette': {
        if (a[1] === 'style' || a[1] === 'default' || a[1] === 'reset') { S.scheme = ''; applyPalette(); syncUI(); save(); return 'palette: from the style'; }
        const p = findPal(a.slice(1).join(' ')); if (!p) return 'schemes: ' + PAL.map((x) => x.name).join(', ');
        S.scheme = p.name; applyPalette(); syncUI(); save(); return 'scheme ' + p.name;
      }
      case 'view': case 'camera': { const v = a[1] === 'toggle' || !a[1] ? (S.view === 'cockpit' ? 'shoulder' : 'cockpit') : a[1] === 'shoulder' || a[1] === '3rd' || a[1] === 'third' ? 'shoulder' : a[1] === 'cockpit' || a[1] === '1st' || a[1] === 'first' ? 'cockpit' : '';
        if (!v) return 'view cockpit | shoulder | toggle'; S.view = v; syncUI(); save(); return v === 'cockpit' ? 'view: cockpit (you are the ship)' : 'view: over the shoulder'; }
      case 'players': { const n = +a[1], mx = CTRL ? 4 : 2; if (!(n >= 1 && n <= mx && n === (n | 0))) return 'players 1-' + mx;
        if (CTRL && n === 2 && a[2] === 'pilot') S.control = 'pilot'; else if (CTRL && n > 2) S.control = 'turret';
        S.players = n; input.players = n; mpFill(); syncUI(); save();
        if (n > 1 && turretOn()) return `${n} players: split screen, one gunner each (${mpDevList()})`;
        return n === 2 ? `2 players: pilot on ${PILOTS[S.pilot]}, gunner on ${GUNNERS[S.gunner]}` : '1 player: you fly and aim; the ship follows your aim'; }
      case 'split': case 'layout': { const v = a[1] === 'h' || a[1] === 'horizontal' || a[1] === 'stacked' ? 'h' : a[1] === 'v' || a[1] === 'vertical' || a[1] === 'side' ? 'v' : a[1] === 'toggle' || !a[1] ? (S.split === 'v' ? 'h' : 'v') : '';
        if (!v) return 'split v | h | toggle'; S.split = v; syncUI(); save(); return 'two-player split: ' + (v === 'v' ? 'side by side' : 'stacked'); }
      case 'pilot': { if (!PILOTS[a[1]]) return 'pilot: ' + Object.keys(PILOTS).join(' | ');
        S.pilot = a[1]; if (S.pilot === 'toy') toyStart(); else if (!TOYTEST) toyStop(); syncUI(); save(); return 'pilot ' + PILOTS[S.pilot]; }
      case 'gunner': { if (!GUNNERS[a[1]]) return 'gunner: ' + Object.keys(GUNNERS).join(' | '); S.gunner = a[1]; syncUI(); save(); return 'gunner ' + GUNNERS[S.gunner]; }
      case 'control': case 'mode': {
        const ks = Object.keys(CTRL), v = a[1] === 'toggle' || !a[1] ? ks[(ks.indexOf(S.control) + 1) % ks.length] : a[1];
        if (!CTRL[v]) return 'control ' + ks.join(' | ') + ' | toggle';
        S.control = v; if (v !== 'turret' && S.players > 2) S.players = 2; mpFill(); syncUI(); save(); if (v === 'turret') lockPointer(false); else unlockPointer(); return 'control: ' + CTRL[v]; }
      case 'sens': case 'sensitivity': case 'look': { const q = a[0] === 'look' ? a[2] ?? a[1] : a[1]; let v = +q; if (v > 3) v /= 100;
        if (!(v >= 0.2 && v <= 3)) return 'sens ' + S.lookSens.toFixed(2) + ' (0.2-3)'; S.lookSens = v; syncUI(); save(); return 'look sensitivity ' + v.toFixed(2); }
      case 'recentre': case 'recenter': { const v = a[1] === 'on' ? true : a[1] === 'off' ? false : !recentreOn(); S.recentre = v; syncUI(); save(); return 'recentre ' + (v ? 'on: the view drifts back to forward after 3 s without look input' : 'off'); }
      case 'toy':
        if (a[1] === 'register' || a[1] === 'reg') { if (S.pilot !== 'toy') { S.pilot = 'toy'; syncUI(); } toyStart(); toy.wantReg = true; save(); return toy.src ? 'registering: hold the toy in the box' : 'starting the camera; registering when it is ready'; }
        if (a[1] === 'off') { toyStop(); S.toy = null; toy.sig = null; if (S.pilot === 'toy') S.pilot = 'keys'; syncUI(); save(); return 'toy off; pilot on keys'; }
        if (a[1] === 'on') return command('pilot toy');
        return 'toy register | toy off';
      case 'music': {
        const q = a.slice(1).join(' ');
        if (!q || q === 'list') return AU.music.length ? AU.music.map((m) => m.id).join('\n') : AU.status;
        if (q === 'off' || q === 'stop') { musicStop(); return 'music off'; }
        if (q === 'on' || q === 'play') { unlock(); if (!S.music && AU.music.length) S.music = AU.music[0].id; musicPlay(); syncUI(); save(); return 'music ' + (S.music || 'none'); }
        if (!AU.music.length) return AU.status;
        let m;
        if (q === 'next' || q === 'prev') { const i = AU.music.findIndex((x) => x.id === S.music); m = AU.music[(i + (q === 'next' ? 1 : AU.music.length - 1) + (i < 0 && q === 'next' ? 0 : 0)) % AU.music.length]; }
        else { const k = pkey(q); m = AU.music.find((x) => x.id === q) || AU.music.find((x) => pkey(x.name).includes(k) || pkey(x.id).includes(k)); }
        if (!m) return `no track matches "${q}". Try: music list`;
        unlock(); S.music = m.id; musicPlay(); syncUI(); save(); return 'music: ' + m.name;
      }
      case 'volume': case 'vol': { const v = +a[1]; if (!(v >= 0 && v <= 100)) return 'volume 0-100'; S.musicVol = v / 100; audioApplyVol(); syncUI(); save(); return 'music volume ' + v; }
      case 'sfx': case 'effects': { const v = +a[1]; if (!(v >= 0 && v <= 100)) return 'sfx 0-100'; S.sfxVol = v / 100; audioApplyVol(); syncUI(); save(); return 'effects volume ' + v; }
      case 'skin': if (a[1] !== 'canopy' && a[1] !== 'visor') return 'skin canopy | visor'; skin = a[1]; buildSkin(); applyPalette(); return 'skin ' + skin + ' (this session)';
      default: { const r = GM && GM.command ? GM.command(a) : null; return r != null ? r : `unknown command "${c}". Type help.`; } // game commands (optional GAME.command(args) → reply or null)
    }
  }

  // ------------------------------------------------------------------ audio (catalogue only: decoded samples + an <audio> element)
  const AU = { voices: 0, mpRoute: false, comp: null, ctx: null, gain: null, urls: new Map(), buf: new Map(), pool: new Map(), loading: new Set(), last: new Map(), music: [], status: 'Loading the sound catalogue…', el: null, ok: false, unlocked: false };
  // GAME.localSounds = { id: { url, name, tags } }: sounds that ship with the game page (carpetshark's own picks), resolved next to the page
  function localSounds() { for (const [id, u] of Object.entries((GM && GM.localSounds) || {})) AU.urls.set(id, new URL(u.url, location.href).href); }
  function loadManifest(tries = 0) {
    localSounds(); // usable even if the catalogue fails to load
    fetch(MANIFEST, { cache: 'no-store' }).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then((m) => {
      for (const s of m.sounds || []) if (s && s.id && s.urls && s.urls.audio) AU.urls.set(s.id, s.urls.audio.startsWith('http') ? s.urls.audio : SOUND_BASE + s.urls.audio);
      AU.music = (m.sounds || []).filter((s) => s.kind === 'music' && AU.urls.has(s.id)).map((s) => ({ id: s.id, name: s.name || s.id }));
      if (GM && GM.ownMusic) { AU.music = GM.ownMusic.map((t) => { AU.urls.set(t.id, new URL(t.url, location.href).href); return { id: t.id, name: t.name }; }); if (S.music && !AU.music.some((t) => t.id === S.music)) S.music = ''; } // GAME.ownMusic: only the game's own tracks in the picker
      localSounds();
      AU.list = (m.sounds || []).filter((s) => s && s.id && AU.urls.has(s.id)).map((s) => ({ id: s.id, name: s.name || s.id, kind: s.kind || '', tags: s.tags || [] }));
      for (const [id, u] of Object.entries((GM && GM.localSounds) || {})) AU.list.unshift({ id, name: u.name || id, kind: 'effect', tags: u.tags || [] }); // HOOK (sound board, soundboard.js): the catalogue list
      AU.ok = true; AU.status = `${AU.music.length} tracks from the Abbie's World catalogue.`;
      if (U.music) { for (const t of AU.music) html('option', { value: t.id, text: t.name }, U.music); U.music.value = S.music; }
      if (AU.unlocked) preload();
      if (AU.unlocked && S.music && state === 'run') musicPlay();
      if (U.mstat) U.mstat.textContent = AU.status;
    }).catch((e) => { if (tries < 2) { setTimeout(() => loadManifest(tries + 1), 1500 * (tries + 1)); return; } AU.status = 'Sound catalogue unavailable (' + e.message + '): playing silently.'; if (U.mstat) U.mstat.textContent = AU.status; });
  }
  function unlock() {
    if (!AU.unlocked) {
      AU.unlocked = true;
      try { AU.ctx = new (window.AudioContext || window.webkitAudioContext)(); AU.gain = AU.ctx.createGain(); AU.gain.connect(AU.ctx.destination); audioApplyVol(); } catch { AU.ctx = null; }
      if (AU.ok) preload();
      if (S.pilot === 'toy') toyStart();
    }
    if (AU.ctx && AU.ctx.state === 'suspended') AU.ctx.resume().catch(() => {});
  }
  function preload() { for (const k in EVENTS) loadBuf(EVENTS[k][0]); }
  // Effects decode into WebAudio buffers when the file allows CORS (lowest latency); catalogue blobs on R2 send no CORS
  // header, so those fall back to a small pool of <audio> elements per id (playback needs no CORS).
  function loadBuf(id) {
    if (!AU.ctx || AU.buf.has(id) || AU.loading.has(id) || AU.pool.has(id) || !AU.urls.has(id)) return;
    AU.loading.add(id);
    fetch(AU.urls.get(id), { mode: 'cors', cache: 'no-store' }).then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); }).then((b) => AU.ctx.decodeAudioData(b)).then((b) => AU.buf.set(id, b))
      .catch(() => { const els = []; for (let i = 0; i < 4; i++) { const a = new Audio(); a.preload = 'auto'; a.src = AU.urls.get(id); els.push(a); } AU.pool.set(id, { els, i: 0 }); })
      .finally(() => AU.loading.delete(id));
  }
  function play(id, vol, gap) {
    if (!AU.ctx || S.sfxVol <= 0) return;
    // split screen: four gunners firing would stack voices and clip, so gaps widen, levels drop, voices are capped and a compressor rides the mix
    const mp = mpOn() && state === 'run' ? S.players : 1;
    if (mp > 1) { gap *= 1 + 0.45 * (mp - 1); vol *= 1 / Math.sqrt(1 + 0.35 * (mp - 1)); if (AU.voices >= 10) return; }
    if (AU.ctx && AU.mpRoute !== mp > 1) { AU.mpRoute = mp > 1; try { AU.gain.disconnect(); if (mp > 1) { if (!AU.comp) { AU.comp = AU.ctx.createDynamicsCompressor(); AU.comp.threshold.value = -14; AU.comp.ratio.value = 6; AU.comp.connect(AU.ctx.destination); } AU.gain.connect(AU.comp); } else AU.gain.connect(AU.ctx.destination); } catch {} }
    const now = performance.now(), l = AU.last.get(id) || 0; if (now - l < gap) return;
    const b = AU.buf.get(id), pl = AU.pool.get(id);
    if (!b && !pl) { loadBuf(id); return; }
    AU.last.set(id, now);
    if (pl) { const a = pl.els[pl.i]; pl.i = (pl.i + 1) % pl.els.length; a.volume = cl(vol * S.sfxVol, 0, 1); try { a.currentTime = 0; } catch {} a.play().catch(() => {}); return; }
    const src = AU.ctx.createBufferSource(); src.buffer = b; AU.voices++; src.onended = () => { AU.voices--; };
    if (vol < 0.99) { const g = AU.ctx.createGain(); g.gain.value = vol; src.connect(g); g.connect(AU.gain); } else src.connect(AU.gain);
    src.start();
  }
  function audioApplyVol() { if (AU.gain) AU.gain.gain.value = S.sfxVol; if (AU.el) AU.el.volume = S.musicVol; }
  function musicPlay() {
    if (GM && GM.onMusic) GM.onMusic();
    if (!S.music || !AU.urls.has(S.music)) { if (U.mstat) U.mstat.textContent = AU.ok ? 'Pick a track.' : AU.status; return; }
    if (!AU.el) { AU.el = new Audio(); AU.el.loop = true; AU.el.preload = 'auto'; }
    const url = AU.urls.get(S.music); AU.game = false;
    if (AU.el.src !== url) AU.el.src = url;
    AU.el.volume = S.musicVol;
    AU.el.play().then(() => { if (U.mstat) U.mstat.textContent = 'Playing: ' + ((AU.music.find((m) => m.id === S.music) || {}).name || S.music); })
      .catch((e) => { if (U.mstat) U.mstat.textContent = 'Could not play (' + e.name + '). Press Play.'; });
  }
  // optional GAME.music = { url, name }: the game's own track (Reef Run: Soaring Melody, its title intro is the first 38 s). Played
  // from 0 on Start when no track is picked in Settings; it goes through the same element and volume. Shell.musicClock() is its
  // playhead in seconds while it plays (-1 otherwise), so a game can sync to the audio rather than wall time.
  function gameMusicAt(t) { gameMusicPlay(false, t); } // start the game's track at t seconds (Reef Run: after its title movie)
  function gameMusicPlay(restart, at) {
    if (GM && GM.onMusic) GM.onMusic();
    const m = GM && GM.music; if (!m || !m.url) return;
    if (!AU.el) { AU.el = new Audio(); AU.el.loop = true; AU.el.preload = 'auto'; }
    const url = new URL(m.url, location.href).href; AU.gameUrl = url;
    if (AU.el.src !== url) AU.el.src = url;
    if (restart || at != null) { try { AU.el.currentTime = at || 0; } catch {} }
    AU.game = true; AU.el.volume = S.musicVol;
    AU.el.play().then(() => { if (U.mstat) U.mstat.textContent = 'Playing: ' + (m.name || 'game music'); }).catch((e) => { if (U.mstat) U.mstat.textContent = 'Could not play (' + e.name + '). Press Play.'; });
  }
  // the reality device (realms.js, music.js) takes the music over: pause this player and say what it was playing; the shell's
  // own players hand it back (GAME.onMusic) whenever they start again
  function musicPause() { const e = AU.el, playing = !!e && !e.paused, r = { playing, t: playing ? e.currentTime : 0, game: !!AU.game, id: AU.game ? '' : S.music }; if (e) e.pause(); return r; }
  function musicTracks() { return AU.music.map((m) => ({ id: m.id, name: m.name, url: AU.urls.get(m.id) })); }
  function musicClock() { const e = AU.el; return e && AU.game && !e.paused && e.src === AU.gameUrl && e.readyState >= 2 ? e.currentTime : -1; }
  function musicStop() { if (AU.el) AU.el.pause(); if (U.mstat) U.mstat.textContent = 'Stopped.'; }

  // ------------------------------------------------------------------ keyboard, mouse, touch
  const keys = new Set(); let synthH = false;
  const typing = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  addEventListener('keydown', (e) => {
    if (e.code === 'KeyH' && !synthH && !typing(e.target)) setTimeout(() => { const st = D.getElementById('i'); if (st) { S.layers.stats = !st.hidden; syncUI(); save(); } }, 0);
    if (synthH || typing(e.target)) return;
    keys.add(e.code); unlock();
    if (state === 'run' && !open && GM && GM.intercept && GM.intercept(e.code)) { e.preventDefault(); return; } // optional: the game consumes a key (an intro skip)
    if (e.code === 'Escape') { e.preventDefault(); if (performance.now() - lockLostAt < 300) return; setOpen(!open); } // (Esc that just released pointer lock already opened settings)
    else if (e.code === 'Space') e.preventDefault();
    else if (e.code === 'KeyV' && !open) command('view toggle');
    else if ((e.code === 'Enter' || e.code === 'NumpadEnter') && state === 'over' && !open) { e.preventDefault(); again(); }
    else if (e.code === 'Slash' && !open) { e.preventDefault(); setOpen(true); U.cmd.focus(); }
  });
  addEventListener('keyup', (e) => { keys.delete(e.code); });
  addEventListener('blur', () => keys.clear());
  const mouse = { x: 0, y: 0, fire: false, alt: false, moved: 0 };
  const touch = { joyId: -1, ox: 0, oy: 0, jx: 0, jy: 0, aimId: -1, ax: 0, ay: 0, fire: false, lx: 0, ly: 0 };
  let canvas = null;
  // ---- pointer lock (turret control): a click on the canvas (or Start / Play again / closing settings) captures the mouse;
  // Esc releases it and opens settings. Where lock is unavailable, mouse movement still looks (cursor visible).
  let lockFailed = false, lockGesture = false, selfUnlock = false, lockLostAt = -1e9;
  const locked = () => !!canvas && D.pointerLockElement === canvas;
  const lookLive = () => turretOn() && state === 'run' && !open;
  function lockPointer(gesture) {
    if (!canvas || !turretOn() || state !== 'run' || open || locked() || !canvas.requestPointerLock) return;
    lockGesture = gesture;
    try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => { if (lockGesture) lockFailed = true; }); } catch { if (gesture) lockFailed = true; }
  }
  function unlockPointer() { if (locked()) { selfUnlock = true; D.exitPointerLock(); } }
  D.addEventListener('pointerlockerror', () => { if (lockGesture) lockFailed = true; });
  D.addEventListener('pointerlockchange', () => {
    input.look.locked = locked();
    if (locked()) { lockFailed = false; return; }
    if (selfUnlock) { selfUnlock = false; return; }
    // the browser released the lock (Esc): skip the intro if the game takes Esc, otherwise open settings as Esc does
    lockLostAt = performance.now();
    if (state === 'run' && !open && !(GM && GM.intercept && GM.intercept('Escape'))) setOpen(true);
  });
  const ndcX = (cx) => (cx / innerWidth) * 2 - 1, ndcY = (cy) => 1 - (cy / innerHeight) * 2;
  addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse' && lookLive() && (locked() || lockFailed)) { input.look.dx += e.movementX || 0; input.look.dy -= e.movementY || 0; }
    if (e.pointerType === 'mouse') { const x = ndcX(e.clientX), y = ndcY(e.clientY); mouse.moved += Math.abs(x - mouse.x) + Math.abs(y - mouse.y); mouse.x = x; mouse.y = y;
      if (mouse.moved > 0.6 && S.gunner === 'gamepad' && S.players === 1 && !open) { S.gunner = 'mouse'; syncUI(); } return; }
    if (e.pointerId === touch.joyId) { const r = 70 * Math.max(K, 0.8); let dx = (e.clientX - touch.ox) / r, dy = -(e.clientY - touch.oy) / r; const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; } touch.jx = dx; touch.jy = dy;
      joyEl.firstChild.style.transform = `translate(${(dx * 38).toFixed(0)}px,${(-dy * 38).toFixed(0)}px)`; }
    else if (e.pointerId === touch.aimId) { touch.ax = ndcX(e.clientX); touch.ay = ndcY(e.clientY);
      if (lookLive()) { input.look.dx += (e.clientX - touch.lx) * 1.4; input.look.dy -= (e.clientY - touch.ly) * 1.4; } touch.lx = e.clientX; touch.ly = e.clientY; } // turret: drag to look
  });
  function onDown(e) {
    unlock();
    if (e.pointerType === 'mouse') { mouse.moved = 0; if (e.button === 0) mouse.fire = true; else if (e.button === 2) mouse.alt = true; if (lookLive() && !locked()) lockPointer(true); return; }
    e.preventDefault();
    if (S.pilot === 'keys') S.pilot = 'touch'; if (S.gunner === 'mouse') S.gunner = 'touch'; // first touch: switch roles to touch
    if (e.clientX < innerWidth / 2 && touch.joyId < 0) {
      touch.joyId = e.pointerId; touch.ox = e.clientX; touch.oy = e.clientY; touch.jx = touch.jy = 0;
      joyEl.style.display = 'block'; joyEl.style.transform = `translate(${e.clientX}px,${e.clientY}px)`; joyEl.firstChild.style.transform = '';
    } else if (touch.aimId < 0) { touch.aimId = e.pointerId; touch.ax = ndcX(e.clientX); touch.ay = ndcY(e.clientY); touch.lx = e.clientX; touch.ly = e.clientY; touch.fire = true; }
    try { e.target.setPointerCapture(e.pointerId); } catch {}
  }
  function onUp(e) {
    if (e.pointerType === 'mouse') { if (e.button === 0) mouse.fire = false; else if (e.button === 2) mouse.alt = false; return; }
    if (e.pointerId === touch.joyId) { touch.joyId = -1; touch.jx = touch.jy = 0; joyEl.style.display = 'none'; }
    if (e.pointerId === touch.aimId) { touch.aimId = -1; touch.fire = false; }
  }
  addEventListener('pointerup', onUp); addEventListener('pointercancel', onUp);

  // ------------------------------------------------------------------ gamepads (standard mapping; twin stick; pad 1 pilot, pad 2 gunner in 2-player)
  const pad = { pilotX: 0, pilotY: 0, aimRX: 0, aimRY: 0, fire: false, alt: false, n: 0, lastN: -1, pilotActive: false, aimActive: false, startPrev: [false, false], aPrev: [false, false], label: '' };
  const dz = (v) => (Math.abs(v) < 0.16 ? 0 : (v - Math.sign(v) * 0.16) / 0.84);
  let lastGP = null;
  const btn = (p, i) => (p.buttons[i] ? p.buttons[i].value > 0.35 || p.buttons[i].pressed : false);
  function pollPads() {
    pad.pilotX = pad.pilotY = pad.aimRX = pad.aimRY = 0; pad.fire = pad.alt = false; pad.n = 0;
    const gp = navigator.getGamepads ? navigator.getGamepads() : null; lastGP = gp; // HOOK (combat.js): Shell.raw.pads()
    let A = null, B = null;
    if (gp) for (let i = 0; i < gp.length; i++) { const p = gp[i]; if (p && p.connected) { if (!A) A = p; else if (!B) B = p; pad.n++; } }
    if (pad.n !== pad.lastN) { pad.lastN = pad.n; if (U.padstat) U.padstat.textContent = !pad.n ? 'No gamepad. Press a button on one to connect it.' : pad.n === 1 ? 'Gamepad 1 connected: left stick flies, right stick aims, RT or A fires, Start opens settings.' : '2 gamepads: in 2-player mode pad 1 flies and pad 2 shoots.'; }
    if (!A) return;
    let pp = A, pg = A; // pilot pad, gunner pad
    if (S.players === 2) { if (B) pg = B; else if (S.pilot === 'gamepad' && S.gunner !== 'gamepad') pg = null; else if (S.gunner === 'gamepad' && S.pilot !== 'gamepad') pp = null; }
    if (pp) { pad.pilotX = dz(pp.axes[0] || 0); pad.pilotY = -dz(pp.axes[1] || 0); }
    if (pg) {
      pad.aimRX = dz(pg.axes[2] || 0); pad.aimRY = -dz(pg.axes[3] || 0);
      if (pg !== pp) { pad.aimRX += dz(pg.axes[0] || 0); pad.aimRY -= dz(pg.axes[1] || 0); } // a gunner-only pad aims with either stick
      pad.fire = btn(pg, 7) || btn(pg, 0) || btn(pg, 5); pad.alt = btn(pg, 6) || btn(pg, 1) || btn(pg, 4);
    }
    if (turretOn() && pp && pp !== pg && !mpOn()) { pad.fire = pad.fire || btn(pp, 7) || btn(pp, 0) || btn(pp, 5); pad.alt = pad.alt || btn(pp, 6) || btn(pp, 1) || btn(pp, 4); } // one shared turret: both pads shoot
    pad.pilotActive = Math.abs(pad.pilotX) + Math.abs(pad.pilotY) > 0.05; pad.aimActive = Math.abs(pad.aimRX) + Math.abs(pad.aimRY) > 0.05;
    const ab = [A, B];
    for (let i = 0; i < (mpOn() || (state === 'menu' && CTRL) ? 0 : 2); i++) { const p = ab[i]; if (!p) continue; // split screen and the lobby handle every pad in mpInput
      const st = btn(p, 9), a = btn(p, 0);
      if (st && !pad.startPrev[i]) { unlock(); setOpen(!open); }
      if (a && !pad.aPrev[i] && state === 'over' && !open) again();
      pad.startPrev[i] = st; pad.aPrev[i] = a; }
    // first real use of a pad switches roles from the keyboard / mouse defaults
    if ((pad.pilotActive || pad.aimActive || pad.fire) && !open) {
      let ch = false;
      if (S.pilot === 'keys' && pp) { S.pilot = 'gamepad'; ch = true; }
      if (S.gunner === 'mouse' && pg && (S.players === 1 || B)) { S.gunner = 'gamepad'; ch = true; }
      if (ch) { syncUI(); save(); }
    }
  }

  // ------------------------------------------------------------------ webcam toy pilot (colour signature + centroid; ?toytest uses a synthetic stream)
  const TW = 160, TH = 120;
  const toy = { src: null, stream: null, video: null, cv: null, ctx: null, synth: null, sctx: null, sig: null, wantReg: false, starting: false,
    x: 0, y: 0, found: false, conf: 0, lostMs: 0, lastT: 0, t0: 0, cx: 0, cy: 0, status: '' };
  function toyStatus(m) { toy.status = m; if (U.toystat) U.toystat.textContent = m; }
  async function toyStart() {
    if (toy.src || toy.starting) return;
    toy.starting = true;
    if (!toy.cv) { toy.cv = D.createElement('canvas'); toy.cv.width = TW; toy.cv.height = TH; toy.ctx = toy.cv.getContext('2d', { willReadFrequently: true }); }
    if (S.toy && !toy.sig) toy.sig = S.toy;
    try {
      if (TOYTEST) {
        toy.synth = D.createElement('canvas'); toy.synth.width = 320; toy.synth.height = 240; toy.sctx = toy.synth.getContext('2d'); toy.src = toy.synth;
        toyStatus('Test stream: an orange blob moves in a circle.');
      } else {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('this browser has no camera access');
        toyStatus('Asking for the camera…');
        toy.stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 320 }, height: { ideal: 240 }, facingMode: 'user' }, audio: false });
        toy.video = D.createElement('video'); toy.video.muted = true; toy.video.playsInline = true; toy.video.srcObject = toy.stream;
        await toy.video.play(); toy.src = toy.video;
        toyStatus(toy.sig ? 'Camera on. Using the registered toy.' : 'Hold a brightly coloured toy inside the box, then press Register.');
      }
      toy.t0 = 0; // set by the first tracking step
    } catch (e) { toyStatus('Camera unavailable: ' + e.message + '. Pilot falls back to keys.'); }
    toy.starting = false;
  }
  function toyStop() {
    if (toy.stream) for (const t of toy.stream.getTracks()) t.stop();
    toy.stream = null; toy.video = null; toy.src = null; toy.found = false; toy.conf = 0;
  }
  function drawSynth(now) { // a stand-in camera: textured background, two distractor blobs, the "toy" (orange) holds the box for 2 s then circles
    const c = toy.sctx, t = (now - toy.t0) / 1000;
    c.fillStyle = '#4a4f55'; c.fillRect(0, 0, 320, 240);
    for (let i = 0; i < 12; i++) { c.fillStyle = i % 2 ? '#3c4046' : '#5a5e62'; c.fillRect((i * 53) % 320, (i * 37) % 240, 40, 30); }
    c.fillStyle = '#2f6fd6'; c.beginPath(); c.arc(40, 200, 16, 0, 6.283); c.fill();
    c.fillStyle = '#3cbf5a'; c.beginPath(); c.arc(285, 35, 14, 0, 6.283); c.fill();
    const a = t < 2 ? 0 : (t - 2) * 1.3, r = t < 2 ? 0 : 75;
    const x = 160 + Math.cos(a) * r, y = 120 + Math.sin(a) * r * 0.75;
    c.fillStyle = '#ff7a18'; c.beginPath(); c.arc(x, y, 17, 0, 6.283); c.fill();
    c.fillStyle = '#ffb066'; c.beginPath(); c.arc(x - 5, y - 6, 6, 0, 6.283); c.fill();
    toy.synthX = x; toy.synthY = y;
  }
  // rgb -> hue (0..1), sat, val written into hsv[0..2]
  const hsv = new Float32Array(3);
  function toHsv(r, g, b) {
    const mx = r > g ? (r > b ? r : b) : g > b ? g : b, mn = r < g ? (r < b ? r : b) : g < b ? g : b, d = mx - mn;
    let h = 0; if (d > 0) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h /= 6; if (h < 0) h += 1; }
    hsv[0] = h; hsv[1] = mx > 0 ? d / mx : 0; hsv[2] = mx / 255;
  }
  const hueHist = new Float32Array(36);
  const BX0 = 56, BX1 = 104, BY0 = 42, BY1 = 78; // centre box (30% × 30%)
  function toyRegister(px) {
    hueHist.fill(0); let n = 0;
    for (let y = BY0; y < BY1; y++) for (let x = BX0; x < BX1; x++) { const i = (y * TW + x) * 4; toHsv(px[i], px[i + 1], px[i + 2]);
      if (hsv[1] > 0.3 && hsv[2] > 0.18) { hueHist[Math.floor(hsv[0] * 36) % 36] += hsv[1] * hsv[2]; n++; } }
    if (n < 40) return toyStatus('Not enough colour in the box. Try a brighter toy, or more light.');
    let best = 0, bv = -1; for (let i = 0; i < 36; i++) { const v = hueHist[(i + 35) % 36] + hueHist[i] + hueHist[(i + 1) % 36]; if (v > bv) { bv = v; best = i; } }
    const hc = (best + 0.5) / 36;
    let sx = 0, sy = 0, ss = 0, sv = 0, ss2 = 0, sv2 = 0, m = 0, dh2 = 0;
    for (let y = BY0; y < BY1; y++) for (let x = BX0; x < BX1; x++) { const i = (y * TW + x) * 4; toHsv(px[i], px[i + 1], px[i + 2]);
      if (hsv[1] < 0.3 || hsv[2] < 0.18) continue; let dh = hsv[0] - hc; if (dh > 0.5) dh -= 1; if (dh < -0.5) dh += 1; if (Math.abs(dh) > 0.06) continue;
      sx += Math.cos(hsv[0] * 6.2832); sy += Math.sin(hsv[0] * 6.2832); ss += hsv[1]; sv += hsv[2]; ss2 += hsv[1] * hsv[1]; sv2 += hsv[2] * hsv[2]; dh2 += dh * dh; m++; }
    if (m < 30) return toyStatus('The colour in the box is too mixed. Fill the box with the toy.');
    let h = Math.atan2(sy, sx) / 6.2832; if (h < 0) h += 1;
    const ms = ss / m, mv = sv / m, ds = Math.sqrt(Math.max(0, ss2 / m - ms * ms)), dv = Math.sqrt(Math.max(0, sv2 / m - mv * mv));
    toy.sig = { h, tol: cl(2.5 * Math.sqrt(dh2 / m), 0.03, 0.08), sMin: Math.max(0.22, ms - 2.5 * ds), vMin: Math.max(0.12, mv - 2.5 * dv), area: m };
    S.toy = toy.sig; save();
    toyStatus(`Registered: hue ${Math.round(h * 360)}°, ${m} px. Move the toy to steer.`);
  }
  function toyStep(now) {
    if (!toy.src || now - toy.lastT < 33) return; toy.lastT = now; if (!toy.t0) toy.t0 = now;
    if (toy.synth) drawSynth(now);
    if (toy.video && toy.video.readyState < 2) return;
    toy.ctx.drawImage(toy.src, 0, 0, TW, TH);
    const px = toy.ctx.getImageData(0, 0, TW, TH).data;
    if (toy.wantReg || (TOYTEST && !toy.sig && now - toy.t0 > 600)) { toy.wantReg = false; toyRegister(px); }
    const g = toy.sig;
    if (g) {
      let sx = 0, sy = 0, n = 0;
      for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) { const i = (y * TW + x) * 4; toHsv(px[i], px[i + 1], px[i + 2]);
        if (hsv[1] < g.sMin || hsv[2] < g.vMin) continue; let dh = hsv[0] - g.h; if (dh > 0.5) dh -= 1; if (dh < -0.5) dh += 1;
        if (dh > g.tol || dh < -g.tol) continue; sx += x; sy += y; n++; }
      const need = Math.max(10, g.area * 0.15);
      toy.conf = cl(n / (g.area * 0.7), 0, 1);
      if (n >= need) {
        toy.cx = sx / n; toy.cy = sy / n; toy.found = true; toy.lostMs = 0;
        const tx = cl(-((toy.cx / TW) * 2 - 1) * 1.45, -1, 1), ty = cl(-((toy.cy / TH) * 2 - 1) * 1.45, -1, 1); // mirrored: toy right -> steer right
        toy.x += (tx - toy.x) * 0.45; toy.y += (ty - toy.y) * 0.45;
      } else { toy.lostMs += 33; if (toy.lostMs > 350) { toy.found = false; toy.x *= 0.9; toy.y *= 0.9; } }
    }
    if (open && S.pilot === 'toy') drawToyPreview(px);
  }
  function drawToyPreview() {
    const c = U.toyctx; c.save(); c.setTransform(-1, 0, 0, 1, TW, 0); c.drawImage(toy.cv, 0, 0); c.restore(); // mirrored like a mirror
    c.strokeStyle = P.h; c.lineWidth = 2; c.strokeRect(TW - BX1, BY0, BX1 - BX0, BY1 - BY0);
    if (toy.found) { c.strokeStyle = P.a; c.beginPath(); c.arc(TW - toy.cx, toy.cy, 8, 0, 6.283); c.stroke(); }
    U.toymeter.style.width = Math.round(toy.conf * 100) + '%';
    if (toy.sig) U.toystat.textContent = toy.found ? `Tracking · confidence ${Math.round(toy.conf * 100)}% · steer ${toy.x.toFixed(2)}, ${toy.y.toFixed(2)}` : 'Toy lost: hold it in view. Steering eases to the centre.';
  }

  // ------------------------------------------------------------------ input composition (each frame, before GAME.update)
  function composeInput(dt) {
    pollPads();
    toyStep(performance.now());
    const g = input.gunner;
    // gunner
    if (S.gunner === 'gamepad' && pad.n) { g.x = cl(g.x + pad.aimRX * 1.7 * dt, -1, 1); g.y = cl(g.y + pad.aimRY * 1.7 * dt, -1, 1); }
    else if (S.gunner === 'touch') { if (touch.aimId >= 0) { g.x = touch.ax; g.y = touch.ay; } }
    else if (S.gunner === 'mouse') { g.x = mouse.x; g.y = mouse.y; }
    g.fire = !open && (keys.has('Space') || pad.fire || (S.gunner === 'mouse' && mouse.fire) || (S.gunner === 'touch' && touch.fire) || (S.gunner !== 'touch' && touch.fire));
    g.alt = !open && (keys.has('KeyF') || keys.has('ShiftLeft') || pad.alt || mouse.alt);
    // pilot
    const kx = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
    const ky = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
    let tx = 0, ty = 0, rate = 6, active = false;
    if (kx || ky) { tx = kx; ty = ky; active = true; }
    else if (S.pilot === 'toy' && toy.sig && toy.src) { tx = toy.x; ty = toy.y; rate = 14; active = toy.found; if (!toy.found) rate = 2; }
    else if ((S.pilot === 'touch' || touch.joyId >= 0) && touch.joyId >= 0) { tx = touch.jx; ty = touch.jy; active = true; rate = 10; }
    else if (pad.pilotActive && (S.pilot === 'gamepad' || S.players === 1)) { tx = pad.pilotX; ty = pad.pilotY; active = true; rate = 9; }
    if (!active && S.players === 1 && !(S.pilot === 'toy' && toy.sig && toy.src)) { tx = g.x; ty = g.y; rate = 2.5; } // one player: the ship follows the aim
    const k = 1 - Math.exp(-dt * rate);
    input.pilot.x = cl(input.pilot.x + (tx - input.pilot.x) * k, -1, 1);
    input.pilot.y = cl(input.pilot.y + (ty - input.pilot.y) * k, -1, 1);
    input.players = S.players;
    // turret: the reticle stays at the screen centre; sticks, keys and the touch joystick feed look rates (the mouse and touch
    // drag add deltas in their event handlers). Both pads look the one shared turret: left and right stick of the gunner pad,
    // plus the left stick of the pilot pad (pad 1 when one player).
    const lk = input.look; input.control = CTRL ? S.control : '';
    lk.sens = S.lookSens; lk.recentre = recentreOn(); lk.locked = locked();
    if (turretOn()) {
      g.x = g.y = 0; input.pilot.x = input.pilot.y = 0;
    }
    // raw sticks and keys are always filled (a game may use them for menus such as initials entry); only turret mode zeroes the aim
    lk.sx = cl(pad.aimRX + pad.pilotX + (touch.joyId >= 0 ? touch.jx : 0), -1, 1); lk.sy = cl(pad.aimRY + pad.pilotY + (touch.joyId >= 0 ? touch.jy : 0), -1, 1);
    lk.kx = kx; lk.ky = ky;
    mpInput(kx, ky); // split screen: per-player devices (and the lobby on the start menu)
    if (open || state !== 'run') { lk.dx = lk.dy = lk.sx = lk.sy = lk.kx = lk.ky = 0; }
  }

  // ------------------------------------------------------------------ split screen (GAME_API.md "Split screen"; turret games only)
  // One ship, up to four turret gunners, each with a viewport. Devices: keyboard + mouse (one player, in unless switched out on
  // the lobby), gamepads that joined with A on the start menu (B leaves, Start begins), then ?fakepads=N bots (the game drives
  // them). input.mp = { n, p: [{ dev 'kbm'|'pad'|'bot'|'none', pad, bot, fire, alt, look, color, name }] } every frame.
  // The game sets hud.mp (per-player HUD data, below) and G.views; the shell draws a compact HUD per viewport on one canvas.
  const PCOL = ['#ffb547', '#5ee6ff', '#ff5ad8', '#a6ff4d'], PNAME = ['P1', 'P2', 'P3', 'P4'];
  const FAKE = Math.max(0, Math.min(4, (+(URLP.get('fakepads') || 0)) | 0));
  const mpOn = () => turretOn() && S.players > 1;
  const MPD = { kbm: true, pads: [], aPrev: new Uint8Array(16), bPrev: new Uint8Array(16), sPrev: new Uint8Array(16), nPads: -1 };
  const mkLook = () => ({ dx: 0, dy: 0, sx: 0, sy: 0, kx: 0, ky: 0, sens: 1, recentre: true, locked: false });
  input.mp = { n: 1, p: [0, 1, 2, 3].map((i) => ({ i, dev: '', pad: -1, bot: false, fire: false, alt: false, look: mkLook(), color: PCOL[i], name: PNAME[i] })) };
  const devCount = () => (MPD.kbm ? 1 : 0) + MPD.pads.length;
  function mpFill() { // the S.players slots: real devices first, then ?fakepads bots in the last slots
    const n = mpOn() ? S.players : 1, bots = Math.min(FAKE, n), real = n - bots, devs = [];
    if (MPD.kbm || n === 1) devs.push(['kbm', -1]); for (const i of MPD.pads) devs.push(['pad', i]);
    for (let s = 0; s < 4; s++) { const q = input.mp.p[s];
      if (s < real && devs[s]) { q.dev = devs[s][0]; q.pad = devs[s][1]; q.bot = false; }
      else if (s < n && s >= real) { q.dev = 'bot'; q.pad = -1; q.bot = true; }
      else { q.dev = s < n ? 'none' : ''; q.pad = -1; q.bot = false; } }
    input.mp.n = n;
  }
  const devName = (q) => q.dev === 'kbm' ? 'keyboard + mouse' : q.dev === 'pad' ? 'gamepad ' + (q.pad + 1) : q.dev === 'bot' ? 'bot' : 'no device';
  const mpDevList = () => input.mp.p.slice(0, input.mp.n).map((q) => q.name + ' ' + devName(q)).join(', ');
  function joinChanged() { // lobby: the player count follows the joined devices
    S.players = cl(devCount() + FAKE, 1, 4); if (S.players > 1 && CTRL) S.control = 'turret';
    input.players = S.players; mpFill(); syncUI(); save();
  }
  function mpInput(kx, ky) {
    const gp = navigator.getGamepads ? navigator.getGamepads() : null, lobby = state === 'menu' && !!CTRL && !open;
    let np = 0;
    for (let i = 0; i < 16; i++) {
      const p = gp && i < gp.length ? gp[i] : null, j = MPD.pads.indexOf(i);
      if (!p || !p.connected) { if (j >= 0) { MPD.pads.splice(j, 1); if (lobby) joinChanged(); else mpFill(); } MPD.aPrev[i] = MPD.bPrev[i] = MPD.sPrev[i] = 0; continue; }
      np++;
      const a = btn(p, 0) ? 1 : 0, b = btn(p, 1) ? 1 : 0, st = btn(p, 9) ? 1 : 0;
      if (lobby) {
        if (a && !MPD.aPrev[i] && j < 0 && devCount() + FAKE < 4) { MPD.pads.push(i); unlock(); joinChanged(); hud.event('pickup'); }
        else if (b && !MPD.bPrev[i] && j >= 0) { MPD.pads.splice(j, 1); joinChanged(); }
        if (st && !MPD.sPrev[i]) { const go = D.getElementById('go'); if (go && D.body.classList.contains('m')) go.click(); }
      } else if (mpOn()) {
        if (st && !MPD.sPrev[i]) { unlock(); setOpen(!open); }
        if (a && !MPD.aPrev[i] && state === 'over' && !open) again();
      }
      MPD.aPrev[i] = a; MPD.bPrev[i] = b; MPD.sPrev[i] = st;
    }
    if (np !== MPD.nPads) { MPD.nPads = np; lobbySync(); }
    const P = input.mp.p, L0 = input.look, live = mpOn() && state === 'run' && !open && !hidePause;
    let any = false;
    for (let s = 0; s < 4; s++) {
      const q = P[s], l = q.look; l.dx = l.dy = l.sx = l.sy = l.kx = l.ky = 0; q.fire = q.alt = false; l.sens = S.lookSens; l.recentre = recentreOn(); l.locked = false;
      if (!live || s >= input.mp.n) continue;
      if (q.dev === 'kbm') { l.dx = L0.dx; l.dy = L0.dy; l.kx = kx; l.ky = ky; l.locked = locked(); q.fire = keys.has('Space') || mouse.fire || touch.fire; q.alt = keys.has('KeyF') || keys.has('ShiftLeft') || mouse.alt; }
      else if (q.dev === 'pad') { const p = gp && gp[q.pad]; if (p && p.connected) {
        l.sx = cl(dz(p.axes[2] || 0) + dz(p.axes[0] || 0), -1, 1); l.sy = cl(-dz(p.axes[3] || 0) - dz(p.axes[1] || 0), -1, 1);
        q.fire = btn(p, 7) || btn(p, 0) || btn(p, 5); q.alt = btn(p, 6) || btn(p, 4); } }
      if (q.fire && !q.bot) any = true;
    }
    if (mpOn() && any) input.gunner.fire = true; // any player's fire skips counts and advances the tally
  }
  function mpLayout(n, o) { // view rects (fractions x, y, w, h; y down) per player
    const set = (i, x, y, w, h) => { o[i * 4] = x; o[i * 4 + 1] = y; o[i * 4 + 2] = w; o[i * 4 + 3] = h; };
    if (n <= 1) set(0, 0, 0, 1, 1);
    else if (n === 2) { if (S.split === 'h') { set(0, 0, 0, 1, 0.5); set(1, 0, 0.5, 1, 0.5); } else { set(0, 0, 0, 0.5, 1); set(1, 0.5, 0, 0.5, 1); } }
    else if (n === 3) { set(0, 0, 0, 1, 0.5); set(1, 0, 0.5, 0.5, 0.5); set(2, 0.5, 0.5, 0.5, 0.5); } // P1 wide on top, two below
    else { set(0, 0, 0, 0.5, 0.5); set(1, 0.5, 0, 0.5, 0.5); set(2, 0, 0.5, 0.5, 0.5); set(3, 0.5, 0.5, 0.5, 0.5); }
    return o;
  }
  // per-view projection for FX and the HUD (filled from G.views after the engine wrote the rects and bases)
  const mpV = [0, 1, 2, 3].map((i) => ({ i, c: new Float64Array(3), f: [0, 0, 1], r: [1, 0, 0], u: [0, 1, 0], tan: 0.6, aspect: 1, x: 0, y: 0, w: 1, h: 1,
    project(x, y, z, o) { const dx = x - this.c[0], dy = y - this.c[1], dz = z - this.c[2], f = this.f, r = this.r, u = this.u;
      const d = dx * f[0] + dy * f[1] + dz * f[2]; o[2] = d; const q = d > 1e-3 ? d : 1e-3;
      o[0] = (dx * r[0] + dz * r[2]) / (q * this.tan * this.aspect); o[1] = (dx * u[0] + dy * u[1] + dz * u[2]) / (q * this.tan); return o; } }));
  function mpViewsSync(Wd, Hd) {
    const V = G.views;
    for (let v = 0; v < V.n; v++) { const m = mpV[v], c = V.cam, k = v * 6, B = V.B, b = v * 9, o = v * 4;
      m.c[0] = c[k]; m.c[1] = c[k + 1]; m.c[2] = c[k + 2]; for (let j = 0; j < 3; j++) { m.f[j] = B[b + j]; m.r[j] = B[b + 3 + j]; m.u[j] = B[b + 6 + j]; }
      m.tan = Math.tan(c[k + 5] / 2); m.aspect = V.aspect[v]; m.x = V.px[o] / Wd; m.y = V.px[o + 1] / Hd; m.w = V.px[o + 2] / Wd; m.h = V.px[o + 3] / Hd; }
  }
  const mpLive = () => mpOn() && state !== 'menu' && !!hud.mp && hud.mp.n > 1 && !!G && G.views.n > 1;
  // ---- the split HUD: one 2D canvas over the views, per viewport a compact HUD in the player's colour and the chosen style's
  // fonts and text effect (reticle, lock brackets, FWD chevron, threat arrows, score, chain, blaster level, XP and heat, popups,
  // clipped to the viewport), plus the shared hull and run timer once, centred over the dividers. hud.mp (written by the game):
  // { n, players: [{ score, chain, chainT (0..1), heat, overheated, level, xp (0..1), kills, shield, marks Float32Array
  // [ndcX, ndcY, depth, kind, dist, label] × nm, nm, arrows Float32Array [ndcX, ndcY, angle, kind, dist] × na, na, fwd [x, y, angle, on], showFwd }] }
  let mpCv = null, mpCx = null, mpW = 0, mpH = 0, mpDrawn = false, mpPopI = 0, MPF = { d: MONO, l: MONO, n: MONO, wt: 600, fz: 1, fzl: 1, tx: 'plain', ret: '' };
  const MPOP = []; for (let i = 0; i < 64; i++) MPOP.push({ v: 0, text: '', x: 0, y: 0, kind: '', t: 0, life: 0 });
  function mpPopup(v, text, nx, ny, kind) {
    const p = MPOP[mpPopI]; mpPopI = (mpPopI + 1) % MPOP.length;
    p.v = v; p.text = text; p.x = nx; p.y = ny; p.kind = kind; p.t = 0; p.life = kind === 'info' ? 1.4 : kind === 'big' ? 1.15 : kind === 'chain' ? 1.05 : 0.95;
  }
  function mtext(g, str, x, y, size, col, font, align, wt, flat) {
    g.font = (wt || MPF.wt) + ' ' + size.toFixed(1) + 'px ' + font; g.textAlign = align || 'left';
    if (flat) { g.fillStyle = col; g.fillText(str, x, y); return; }
    if (MPF.tx === 'outline') { g.lineJoin = 'round'; g.lineWidth = Math.max(2, size * 0.2); g.strokeStyle = 'rgba(0,0,0,.85)'; g.strokeText(str, x, y); }
    else { g.shadowColor = MPF.tx === 'glow' ? col : 'rgba(0,0,0,.95)'; g.shadowBlur = size * (MPF.tx === 'glow' ? 0.45 : 0.3); }
    g.fillStyle = col; g.fillText(str, x, y); g.shadowBlur = 0;
  }
  function bar(g, x, y, w, h, f, col, track) { g.globalAlpha *= 0.3; g.fillStyle = track || col; g.fillRect(x, y, w, h); g.globalAlpha /= 0.3; g.fillStyle = col; g.fillRect(x, y, w * cl(f, 0, 1), h); }
  function mpReticle(g, x, y, r, col, lw) {
    g.strokeStyle = col; g.fillStyle = col; g.lineWidth = lw; g.beginPath();
    const ret = MPF.ret;
    if (ret === 'pixel') { const a = r, b = r * 0.45; for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { g.moveTo(x + sx * a, y + sy * (a - b)); g.lineTo(x + sx * a, y + sy * a); g.lineTo(x + sx * (a - b), y + sy * a); } g.stroke(); g.fillRect(x - lw, y - lw, lw * 2, lw * 2); return; }
    if (ret === 'diamond') { g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y); g.closePath(); }
    else if (ret === 'star') { for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.42 : r * 1.1; g[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * rr, y + Math.sin(a) * rr); } g.closePath(); }
    else if (ret === 'cross') { g.moveTo(x - r, y); g.lineTo(x - r * 0.35, y); g.moveTo(x + r * 0.35, y); g.lineTo(x + r, y); g.moveTo(x, y - r); g.lineTo(x, y - r * 0.35); g.moveTo(x, y + r * 0.35); g.lineTo(x, y + r); }
    else if (ret === 'dot') { g.setLineDash([r * 0.4, r * 0.55]); g.arc(x, y, r * 0.8, 0, 6.283); g.stroke(); g.setLineDash([]); g.beginPath(); g.arc(x, y, r * 0.25, 0, 6.283); g.fill(); return; }
    else { g.arc(x, y, r, 0, 6.283); if (ret === 'ring2') { g.moveTo(x + r * 0.7, y); g.arc(x, y, r * 0.7, 0, 6.283); } else { g.moveTo(x - r * 1.7, y); g.lineTo(x - r * 1.2, y); g.moveTo(x + r * 1.2, y); g.lineTo(x + r * 1.7, y); g.moveTo(x, y - r * 1.7); g.lineTo(x, y - r * 1.2); g.moveTo(x, y + r * 1.2); g.lineTo(x, y + r * 1.7); } }
    g.stroke(); g.beginPath(); g.arc(x, y, Math.max(1.5, lw), 0, 6.283); g.fill();
  }
  function mpPlayer(g, v, pl, X, Y, Wv, Hv, dp, t, dt) {
    const col = PCOL[v], k = cl(Math.min(Wv / (820 * dp), Hv / (470 * dp)), 0.62, 1.15) * (HUDSCALE[S.hudScale] || 1) * dp, fz = MPF.fz, fzl = MPF.fzl;
    const cx = X + Wv / 2, cy = Y + Hv / 2, toX = (nx) => X + (nx + 1) * 0.5 * Wv, toY = (ny) => Y + (1 - ny) * 0.5 * Hv;
    g.save(); g.beginPath(); g.rect(X, Y, Wv, Hv); g.clip();
    g.globalAlpha = 0.45; g.strokeStyle = col; g.lineWidth = 2 * dp; g.strokeRect(X + dp, Y + dp, Wv - 2 * dp, Hv - 2 * dp); g.globalAlpha = 1; // the player's colour frames the view
    if (S.layers.marks) {
      for (let i = 0; i < pl.nm; i++) { // lock brackets: the nearest one to the reticle is the lock
        const o = i * 6, x = toX(pl.marks[o]), y = toY(pl.marks[o + 1]), dep = pl.marks[o + 2], kind = pl.marks[o + 3] | 0; if (dep <= 0.5) continue;
        const r = cl(1300 / Math.max(dep, 1), 12, 56) * k * 0.8, lock = i === 0 && kind !== 1, c = kind === 1 ? P.a : kind === 2 || lock ? P.d : col, e = r * 0.45;
        g.strokeStyle = c; g.lineWidth = (lock ? 2.4 : 1.8) * dp; g.globalAlpha = lock && (t * 4 | 0) % 2 ? 0.55 : kind === 0 && !lock ? 0.8 : 1; g.beginPath();
        for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { g.moveTo(x + sx * r, y + sy * (r - e)); g.lineTo(x + sx * r, y + sy * r); g.lineTo(x + sx * (r - e), y + sy * r); }
        g.stroke(); g.globalAlpha = 1;
        if (lock) mtext(g, 'LOCK ' + Math.round(pl.marks[o + 4]) + 'm', x + r + 6 * k, y + 4 * k, 11 * k * fzl, c, MPF.l);
      }
      for (let i = 0; i < pl.na; i++) { // off-screen threats
        const o = i * 5, x = toX(pl.arrows[o]), y = toY(pl.arrows[o + 1]), a = -pl.arrows[o + 2], c = pl.arrows[o + 3] === 2 ? P.d : col;
        g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = c; g.beginPath(); g.moveTo(12 * k, 0); g.lineTo(-8 * k, -10 * k); g.lineTo(-3 * k, 0); g.lineTo(-8 * k, 10 * k); g.closePath(); g.fill(); g.restore();
        mtext(g, Math.round(pl.arrows[o + 4]) + 'm', x, y + 24 * k, 11 * k * fzl, c, MPF.l, 'center');
      }
      if (pl.showFwd) { const x = toX(pl.fwd[0]), y = toY(pl.fwd[1]); g.save(); g.translate(x, y); g.rotate(-pl.fwd[2]); g.strokeStyle = col; g.lineWidth = 2.6 * dp; g.lineCap = 'round'; g.beginPath();
        g.moveTo(-7 * k, -12 * k); g.lineTo(5 * k, 0); g.lineTo(-7 * k, 12 * k); g.moveTo(-15 * k, -12 * k); g.lineTo(-3 * k, 0); g.lineTo(-15 * k, 12 * k); g.stroke(); g.restore();
        mtext(g, 'FWD', x, y + 28 * k, 11 * k * fzl, col, MPF.l, 'center'); }
    }
    if (S.layers.reticle) mpReticle(g, cx, cy, 20 * k, col, 2 * dp);
    const m = 14 * k, by = Y + Hv - m;
    if (S.layers.score) { // bottom left: tag, score, chain and its window
      g.fillStyle = col; g.fillRect(X + m, by - 66 * k, 30 * k, 18 * k); mtext(g, PNAME[v], X + m + 15 * k, by - 52.5 * k, 13 * k * fzl, '#08121a', MPF.l, 'center', 800, true);
      if (pl.kills) mtext(g, pl.kills + ' KILLS', X + m + 38 * k, by - 52 * k, 11 * k * fzl, P.s, MPF.l);
      mtext(g, fmtInt(pl.score), X + m, by - 20 * k, 27 * k * fz, P.s, MPF.n);
      if (pl.chain > 1) { mtext(g, '×' + pl.chain + ' CHAIN', X + m, by, 15 * k * fz, col, MPF.d); bar(g, X + m, by + 4 * k, 110 * k, 3 * k, pl.chainT, col); }
      if (pl.shield) mtext(g, 'SHIELD', X + m + 130 * k, by, 12 * k * fzl, P.a, MPF.l);
    }
    if (S.layers.weapon) { // bottom right: level, XP, heat
      const w = 132 * k, x0 = X + Wv - m - w;
      mtext(g, 'L' + pl.level, x0, by - 30 * k, 14 * k * fz, col, MPF.n);
      mtext(g, 'XP', x0 + 34 * k, by - 30 * k, 10 * k * fzl, col, MPF.l); bar(g, x0 + 54 * k, by - 37 * k, w - 54 * k, 5 * k, pl.xp, P.a);
      mtext(g, 'HEAT', x0, by - 4 * k, 10 * k * fzl, col, MPF.l); bar(g, x0 + 40 * k, by - 13 * k, w - 40 * k, 9 * k, pl.heat, pl.overheated || pl.heat > 0.8 ? P.d : col);
      if (pl.overheated && (t * 2.5 | 0) % 2 === 0) mtext(g, 'OVERHEAT', cx, cy + 46 * k, 15 * k * fzl, P.d, MPF.l, 'center', 800);
    }
    if (S.layers.popups) for (let i = 0; i < MPOP.length; i++) { // popups, clipped to this view
      const p = MPOP[i]; if (p.life <= 0 || p.v !== v) continue;
      const u = p.t / p.life, rise = 40 * k * (1 - (1 - u) * (1 - u)), sc = u < 0.12 ? 0.7 + u * 2.5 : 1;
      const sz = (p.kind === 'info' ? 20 : p.kind === 'big' ? 30 : p.kind === 'chain' ? 22 : 17) * k * sc * MPF.fz;
      const c = p.kind === 'bad' ? P.d : p.kind === 'info' || p.kind === 'chain' ? P.a : p.kind === 'big' ? col : P.s;
      g.globalAlpha = u < 0.7 ? 1 : (1 - u) / 0.3; mtext(g, p.text, toX(p.x), toY(p.y) - rise, sz, c, MPF.d, 'center', 800); g.globalAlpha = 1;
    }
    g.restore();
  }
  function drawMP(dt) {
    if (!mpCv) { mpCv = html('canvas', { id: 'sgmp', 'aria-hidden': 'true' }, root); mpCv.className = 'sgjolt'; mpCx = mpCv.getContext('2d'); }
    const dp = Math.min(2, devicePixelRatio || 1), w = Math.round(innerWidth * dp), h = Math.round(innerHeight * dp), g = mpCx, M = hud.mp, n = Math.min(M.n, G.views.n), t = performance.now() / 1000;
    if (w !== mpW || h !== mpH) { mpCv.width = mpW = w; mpCv.height = mpH = h; }
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, w, h); mpDrawn = true; vis(mpCv, true);
    for (let i = 0; i < MPOP.length; i++) { const p = MPOP[i]; if (p.life > 0 && (p.t += dt) >= p.life) p.life = 0; }
    const pw = cl(hud.power ?? 1, 0, 1); if (pw <= 0.01) return;
    bootN++; g.globalAlpha = pw < 1 ? pw * ((bootN * 7) % 5 < 1 ? 0.3 : 1) : 1;
    const gl = cl(hud.glitch || 0, 0, 1); if (gl > 0.01) g.translate((Math.random() - 0.5) * gl * 9 * dp * (typeof FX !== 'undefined' ? FX.shakeScale : 1), 0);
    const ga = g.globalAlpha;
    for (let v = 0; v < n; v++) { const m = mpV[v]; g.globalAlpha = ga; mpPlayer(g, v, M.players[v], m.x * w, m.y * h, m.w * w, m.h * h, dp, t, dt); }
    g.globalAlpha = ga;
    // the shared hull and timer, once, centred over the dividers
    const st = statsRef, k = cl(Math.min(w / (1500 * dp), h / (850 * dp)), 0.7, 1.1) * (HUDSCALE[S.hudScale] || 1) * dp, hx = w / 2, hy = n === 2 && S.split === 'v' ? 30 * k : h / 2;
    const hm = Math.min(8, st.hullMax || 0), hu = st.hull ?? hm, pw2 = 250 * k, ph = 40 * k;
    if (!S.layers.score && !S.layers.timer) { g.globalAlpha = 1; return; }
    g.fillStyle = 'rgba(6,10,16,.78)'; g.strokeStyle = P.h; g.lineWidth = 1.5 * dp; g.beginPath(); g.roundRect(hx - pw2 / 2, hy - ph / 2, pw2, ph, ph / 2); g.fill(); g.globalAlpha = ga * 0.6; g.stroke(); g.globalAlpha = ga;
    if (S.layers.score && hm) { mtext(g, 'HULL', hx - pw2 / 2 + 16 * k, hy + 4 * k, 11 * k * MPF.fzl, P.h, MPF.l); const sw = (84 * k - 4 * k * (hm - 1)) / hm;
      for (let i = 0; i < hm; i++) { g.fillStyle = i < hu ? (hu <= 1 && HULL_LOW() ? P.d : P.h) : 'rgba(255,255,255,.15)'; g.fillRect(hx - pw2 / 2 + 54 * k + i * (sw + 4 * k), hy - 6 * k, sw, 12 * k); } }
    if (S.layers.timer) mtext(g, fmtTime(Math.floor((st.time || 0) * 10) / 10), hx + pw2 / 2 - 14 * k, hy + 6 * k, 16 * k * MPF.fz, P.s, MPF.n, 'right');
    g.globalAlpha = 1;
  }
  const HULL_LOW = () => (statsRef.hullMax || 0) > 1;
  function mpHide() { if (mpDrawn) { mpCx.setTransform(1, 0, 0, 1, 0, 0); mpCx.clearRect(0, 0, mpW, mpH); mpDrawn = false; } if (mpCv) vis(mpCv, false); for (const p of MPOP) p.life = 0; }
  // ---- lobby on the start menu (turret games): four slots in the player colours
  let lobEl = null;
  function lobbyBuild() {
    if (lobEl || !CTRL) return; const go = D.getElementById('go'); if (!go) return;
    html('style', { text: `#sglob{margin:12px auto 0;max-width:560px}#sglob b{display:block;font:600 12px ui-monospace,Menlo,monospace;letter-spacing:.14em;color:#9fc3d1;margin-bottom:6px}
#sglob .sl{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}#sglob button{display:grid;gap:2px;padding:7px 6px;border-radius:10px;border:1.5px solid #2a3b4a;background:rgba(6,18,28,.6);color:#9fb2c0;font:600 12px system-ui;text-align:center;cursor:pointer;min-height:52px}
#sglob button.in{color:#eef7fb;background:rgba(6,18,28,.85)}#sglob button span{font:800 15px ui-monospace,Menlo,monospace}#sglob i{display:block;margin-top:6px;font:500 13px system-ui;color:#c9dde6;font-style:normal}
body.l #sglob{display:none}@media (max-width:420px){#sglob .sl{grid-template-columns:repeat(2,1fr)}}` }, D.head);
    lobEl = html('div', { id: 'sglob' }, null); go.parentNode.insertBefore(lobEl, go);
    lobEl.innerHTML = '<b>PLAYERS · SPLIT SCREEN</b><div class="sl">' + PNAME.map((n, i) => `<button type="button" data-slot="${i}" style="border-color:${PCOL[i]}55"><span style="color:${PCOL[i]}">${n}</span><em style="font-style:normal"></em></button>`).join('') + '</div><i>Press A / fire to join · B leaves · Start begins</i>';
    lobEl.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; unlock();
      if (+b.dataset.slot === 0 || input.mp.p[+b.dataset.slot].dev === 'kbm') { MPD.kbm = !MPD.kbm || devCount() === 0; joinChanged(); } });
    lobbySync();
  }
  function lobbySync() {
    mpFill(); if (!lobEl) return;
    const n = input.mp.n, bs = lobEl.querySelectorAll('button');
    for (let i = 0; i < 4; i++) { const q = input.mp.p[i], on = i < n && q.dev !== 'none', b = bs[i];
      b.className = on ? 'in' : ''; b.style.borderColor = on ? PCOL[i] : PCOL[i] + '55';
      b.querySelector('em').textContent = i < n ? (q.dev === 'kbm' ? 'Keyboard + mouse' : q.dev === 'pad' ? 'Gamepad ' + (q.pad + 1) : q.dev === 'bot' ? 'Bot (fakepads)' : 'No device yet') : i === 0 && !MPD.kbm ? 'Keys out · click' : 'Press A to join'; }
    lobEl.querySelector('i').textContent = n > 1 && !turretOn() ? '2 players: pilot + gunner (Settings → Players for split screen)' : (n > 1 ? n + ' gunners on one ship · ' : '') + 'Press A / fire to join · B leaves · Start begins';
  }

  // ------------------------------------------------------------------ HUD drawing (per frame)
  const cache = {};
  let speed = 0, lpx = 0, lpy = 0, lpz = 0, flashA = 0, flashMax = 0, tickBase = -999;
  function render(dt) {
    const visor = skin === 'visor', L = S.layers, st = statsRef, F = view.F;
    vis(hudEl, state !== 'menu');
    if (state === 'menu') { mpHide(); return; }
    const split = mpLive(); vis(svg, !split); vis(mm, !split); vis(popEl, !split);
    if (split) { drawMP(dt); bootFx(); if (flashA > 0) { flashA = Math.max(0, flashA - dt * 2.2); flashEl.style.opacity = (flashA * flashMax).toFixed(3); } return; }
    mpHide();
    // reticle follows the gunner's aim
    if (L.reticle) tr(E.ret, (input.gunner.x + 1) * 0.5 * W, (1 - input.gunner.y) * 0.5 * H, K.toFixed(3));
    // score, combo, hull, counter
    if (L.score) {
      const sc = st.score || 0;
      if (cache.score !== sc) { cache.score = sc; txt(E.score, visor ? fmtInt(sc) : 'SCORE ' + fmtInt(sc)); }
      const cp = GM && GM.comboPanel;
      if (cp && cp.field) { const v = st[cp.field] || 0; if (cache.combo !== v) { cache.combo = v; txt(E.combo, visor ? String(cp.label || '').toUpperCase() + ' ' + fmtInt(v) : fmtInt(v)); } }
      else if (cp !== false) { const cb = st.combo || 1; if (cache.combo !== cb) { cache.combo = cb; txt(E.combo, '×' + (Math.round(cb * 10) / 10)); } }
      const hm = st.hullMax || 0, hu = st.hull ?? hm;
      if (cache.hull !== hu || cache.hullMax !== hm) {
        cache.hull = hu; cache.hullMax = hm; vis(E.hullg, hm > 0);
        const n = Math.min(8, hm), w = visor ? 112 : 208, gap = visor ? 4 : 8, sw = n ? (w - gap * (n - 1)) / n : 0;
        for (let i = 0; i < 8; i++) { const r = HULLS[i]; vis(r, i < n); if (i < n) { r.setAttribute('x', (visor ? 0 : -104) + i * (sw + gap)); r.setAttribute('width', sw); r.setAttribute('fill-opacity', i < hu ? 1 : 0.2); } }
      }
      const cv = st.counterValue, cm = st.counterMax, lab = st.counterLabel || '';
      if (cache.cv !== cv || cache.cm !== cm || cache.cl !== lab) {
        cache.cv = cv; cache.cm = cm; cache.cl = lab;
        const has = lab !== '' || cv !== undefined;
        if (visor) { vis(E.vcount, has); txt(E.clabel, lab.toUpperCase()); txt(E.counter, cv === undefined ? '' : cm ? `${cv} / ${cm}` : String(cv));
          vis(E.cfill, !!cm); vis(E.cbar, !!cm); if (cm) E.cfill.setAttribute('width', (160 * cl(cv / cm, 0, 1)).toFixed(1)); }
        else txt(E.counter, has ? `${lab} ${cv ?? ''}${cm ? ' / ' + cm : ''}`.trim() : '');
      }
    }
    // weapon: level, XP, heat, OVERHEAT
    if (L.weapon) {
      if (cache.wn !== st.weaponName && st.weaponName) { cache.wn = st.weaponName; txt(E.wname, String(st.weaponName).toUpperCase()); }
      const lv = st.level || 1; if (cache.lv !== lv) { cache.lv = lv; txt(E.wlvl, 'L' + lv); }
      const xn = st.xpNext || 0, xp = st.xp || 0; num(E.xpf, 'width', xn > 0 ? 184 * cl(xp / xn, 0, 1) : 184, 0.5);
      const ht = cl(st.heat || 0, 0, 1); num(E.heatf, 'width', 172 * ht, 0.5);
      const hot = !!st.overheated || ht > 0.8; if (cache.hot !== hot) { cache.hot = hot; E.heatf.setAttribute('class', hot ? 'hot' : 'fh'); }
      vis(E.ovh, !!st.overheated);
      if (cache.ovw !== !!st.overheated) { if (st.overheated && cache.ovw === false) hud.event('overheat'); cache.ovw = !!st.overheated; }
    }
    if (L.timer) { const t = Math.floor((st.time || 0) * 10); if (cache.time !== t) { cache.time = t; txt(E.time, fmtTime(t / 10)); } }
    // visor frame: compass ribbon heading, pitch, speed
    if (dt > 0) { const sp = Math.hypot(F[0] - lpx, F[1] - lpy, F[2] - lpz) / dt; if (sp < 500) speed += (sp - speed) * Math.min(1, dt * 4); }
    lpx = F[0]; lpy = F[1]; lpz = F[2];
    if (visor && L.frame) {
      let hd = (F[3] * 180 / Math.PI) % 360; if (hd < 0) hd += 360;
      const base = Math.floor(hd / 20) * 20;
      tr(E.ticks, -(hd - base) * 6, 0);
      if (base !== tickBase) { tickBase = base; for (let i = 0; i < 8; i++) { let a = (base + (i * 2 - 6) * 10) % 360; if (a < 0) a += 360; txt(E['tl' + i], String(a).padStart(3, '0')); } }
      const pd = Math.round(F[4] * 180 / Math.PI); if (cache.pitch !== pd) { cache.pitch = pd; txt(E.pitch, (pd >= 0 ? '+' : '') + pd + '°'); }
      const sd = Math.round(speed * 10); if (cache.spd !== sd) { cache.spd = sd; txt(E.spd, 'SPD ' + (sd / 10).toFixed(1)); }
    }
    bootFx();
    if (L.marks) drawMarks(visor);
    if (L.popups) stepPops(dt);
    if (L.minimap) (visor ? drawCube : drawRadar)(F[8] || 0);
    // flash
    if (flashA > 0) { flashA = Math.max(0, flashA - dt * 2.2); flashEl.style.opacity = (flashA * flashMax).toFixed(3); }
    // toy note
    const note = S.pilot === 'toy' && toy.src ? (!toy.sig ? 'Toy: not registered (Esc → Register)' : toy.found ? '' : 'Toy lost: hold it in view') : '';
    if (cache.note !== note) { cache.note = note; noteEl.textContent = note; }
  }

  function drawMarks(visor) {
    const n = markArr ? Math.min(markN, MARKS.length) : 0, labels = hud.labels || [];
    let lock = -1, ld = 1e9;
    if (!visor) for (let i = 0; i < n; i++) { const o = i * 6; if (markArr[o + 3] === 0 && markArr[o + 2] > 0 && markArr[o + 4] < ld && Math.abs(markArr[o]) < 1 && Math.abs(markArr[o + 1]) < 1) { ld = markArr[o + 4]; lock = i; } }
    // at most MAX_BRACKETS on screen (carpetshark, 2026-11-16: "limit the targeting to like 5 reticules max"): goals first, then nearest
    KEEP.fill(0);
    const onAt = (o) => markArr[o + 2] > 0.5 && Math.abs(markArr[o]) < 1.15 && Math.abs(markArr[o + 1]) < 1.15;
    let kept = 0;
    for (let i = 0; i < n && kept < MAX_BRACKETS; i++) { const o = i * 6; if ((markArr[o + 3] | 0) === 1 && onAt(o)) { KEEP[i] = 1; kept++; } }
    while (kept < MAX_BRACKETS) { let bi = -1, bd = 1e9; for (let i = 0; i < n; i++) { const o = i * 6; if (!KEEP[i] && onAt(o) && markArr[o + 4] < bd) { bd = markArr[o + 4]; bi = i; } } if (bi < 0) break; KEEP[bi] = 1; kept++; }
    let ci = 0;
    for (let i = 0; i < MARKS.length; i++) {
      const m = MARKS[i];
      if (i >= n) { vis(m.g, false); continue; }
      const o = i * 6, x = markArr[o], y = markArr[o + 1], dep = markArr[o + 2], kind = markArr[o + 3] | 0, dist = markArr[o + 4], li = markArr[o + 5];
      const lab = li >= 0 && labels[li | 0] ? labels[li | 0] : '';
      // compass ribbon marker (visor): bearing recovered from ndc and depth
      if (visor && ci < CMPS.length && (lab || kind === 1)) {
        const c = CMPS[ci++], q = dep > 1e-3 ? dep : 1e-3, deg = Math.atan2(x * q * view.tan * view.aspect, dep) * 57.2958;
        const px = cl(deg * 6, -300, 300);
        vis(c.g, true); tr(c.g, px, 40); att(c.g, 'opacity', Math.abs(deg * 6) > 300 ? '0.5' : '1');
        const cls = kind === 1 ? 'fa' : kind === 2 ? 'fd' : 'fh'; att(c.p, 'class', cls); att(c.t, 'class', cls);
        const key = (lab || 'GOAL') + ' ' + fmtDist(dist); txt(c.t, key.toUpperCase());
      }
      const on = KEEP[i] === 1 && dep > 0.5 && x > -1.15 && x < 1.15 && y > -1.15 && y < 1.15;
      vis(m.g, on); if (!on) continue;
      const sx = (x + 1) * 0.5 * W, sy = (1 - y) * 0.5 * H;
      const r = cl(1400 / Math.max(dep, 1), visor ? 22 : 16, visor ? 90 : 70) * K;
      tr(m.g, sx, sy);
      att(m.p, 'transform', `scale(${(visor ? r * 1.4 : r).toFixed(1)} ${r.toFixed(1)})`);
      const locked = i === lock;
      const sc = kind === 1 ? 'sa' : kind === 2 || locked ? 'sd' : 'sh', fc = kind === 1 ? 'fa' : kind === 2 || locked ? 'fd' : 'fh';
      att(m.p, 'class', sc + (locked || kind === 2 ? ' blink' : '')); att(m.p, 'stroke-opacity', kind === 0 && !locked ? '0.75' : '1'); att(m.t, 'class', fc);
      if (visor) { att(m.t, 'x', (-r * 1.4).toFixed(0)); att(m.t, 'y', (r + 18).toFixed(0)); txt(m.t, ((lab || (kind === 1 ? 'FRIEND' : kind === 2 ? 'DANGER' : 'TARGET')) + ' · ' + fmtDist(dist)).toUpperCase()); }
      else { att(m.t, 'x', (r + 8).toFixed(0)); att(m.t, 'y', '5'); txt(m.t, locked ? 'LOCK ' + fmtDist(dist) : lab ? lab.toUpperCase() : ''); }
    }
    for (let i = ci; i < CMPS.length; i++) vis(CMPS[i].g, false);
  }

  let popI = 0;
  function stepPops(dt) {
    for (let i = 0; i < POPS.length; i++) {
      const p = POPS[i]; if (p.life <= 0) continue;
      p.t += dt; const u = p.t / p.life;
      if (u >= 1) { p.life = 0; p.el.style.display = 'none'; continue; }
      const rise = 46 * K * (1 - (1 - u) * (1 - u)), sc = u < 0.12 ? 0.7 + u * 2.5 : 1;
      p.el.style.transform = `translate(${p.x.toFixed(0)}px,${(p.y - rise).toFixed(0)}px) translate(-50%,-50%) scale(${sc.toFixed(2)})`;
      p.el.style.opacity = u < 0.7 ? '1' : ((1 - u) / 0.3).toFixed(2);
    }
  }

  function drawRadar(t) {
    const c = mmCtx, s = mmScale, R = hud.range || 300;
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, mm.width, mm.height);
    c.setTransform(s, 0, 0, s, mmOX * s, mmOY * s);
    c.globalAlpha = GM && GM.hudFloat ? 0.32 : 0.92; c.fillStyle = P.dash; c.beginPath(); c.arc(0, 0, 78, 0, 6.283); c.fill(); c.globalAlpha = 1;
    c.strokeStyle = P.h; c.lineWidth = 2; c.globalAlpha = 0.55; c.beginPath(); c.arc(0, 0, 78, 0, 6.283); c.stroke();
    c.lineWidth = 1; c.globalAlpha = 0.25; c.beginPath(); c.arc(0, 0, 52, 0, 6.283); c.stroke(); c.beginPath(); c.arc(0, 0, 26, 0, 6.283); c.stroke();
    const a = (t * 1.5708) % 6.283 - 1.5708; c.globalAlpha = 0.18; c.fillStyle = P.h; c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, 78, a, a + 0.53); c.closePath(); c.fill();
    c.globalAlpha = 1;
    const n = blipArr ? blipN : 0;
    for (let i = 0; i < n; i++) {
      const o = i * 4; let x = (blipArr[o] / R) * 78, y = -(blipArr[o + 2] / R) * 78; const up = cl(blipArr[o + 1] / R, -1, 1) * 22, kind = blipArr[o + 3] | 0;
      const l = Math.hypot(x, y), out = l > 76; if (out) { x *= 76 / l; y *= 76 / l; }
      const col = kind === 1 ? P.a : P.d;
      c.globalAlpha = kind === 2 ? 0.55 + 0.45 * Math.sin(t * 8) : out ? 0.5 : 1;
      c.strokeStyle = col; c.fillStyle = col; c.lineWidth = 2;
      if (!out && Math.abs(up) > 1) { c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - up); c.stroke(); }
      const by = out ? y : y - up;
      c.beginPath(); c.arc(x, by, kind === 2 ? 5.5 : 4.5, 0, 6.283); if (out) c.stroke(); else c.fill();
      if (kind === 2 && !out) { c.beginPath(); c.arc(x, by, 9, 0, 6.283); c.lineWidth = 1.2; c.stroke(); }
    }
    c.globalAlpha = 1; c.fillStyle = P.s; c.beginPath(); c.moveTo(-7, 8); c.lineTo(0, -10); c.lineTo(7, 8); c.closePath(); c.fill();
    c.fillStyle = P.h; c.font = '600 13px ui-monospace,Menlo,monospace'; c.textAlign = 'center';
    c.fillText((hud.radarLabel || 'RADAR') + ' ' + R + ' m', 0, -88);
  }

  function drawCube(t) { // the Visor's wireframe holo cube: ship at the centre, forward = up the screen, every blip with a stem to the floor
    const c = mmCtx, s = mmScale, R = hud.range || 300;
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, mm.width, mm.height);
    c.setTransform(s, 0, 0, s, mmOX * s, mmOY * s);
    c.strokeStyle = P.h; c.lineWidth = 1.6; c.globalAlpha = 0.9;
    c.beginPath(); c.moveTo(0, -60); c.lineTo(80, -20); c.lineTo(0, 20); c.lineTo(-80, -20); c.closePath(); c.stroke();
    c.globalAlpha = 0.45; c.beginPath(); c.moveTo(-80, -20); c.lineTo(-80, 60); c.lineTo(0, 100); c.lineTo(80, 60); c.lineTo(80, -20); c.moveTo(0, 20); c.lineTo(0, 100); c.stroke();
    c.globalAlpha = 0.18; c.beginPath(); c.moveTo(0, 20); c.lineTo(80, 60); c.moveTo(0, 20); c.lineTo(-80, 60); c.stroke();
    const n = blipArr ? blipN : 0;
    for (let i = 0; i < n; i++) {
      const o = i * 4; let X = blipArr[o] / R, Z = blipArr[o + 2] / R; const Y = cl(blipArr[o + 1] / R, -1, 1), kind = blipArr[o + 3] | 0;
      const l1 = Math.abs(X) + Math.abs(Z), out = l1 > 1; if (out) { X /= l1; Z /= l1; }
      const fx = 80 * X, fy = 60 - 40 * Z, py = fy - 40 * (Y + 1);
      const col = kind === 1 ? P.a : P.d;
      c.strokeStyle = col; c.fillStyle = col; c.lineWidth = 1.6; c.globalAlpha = kind === 2 ? 0.55 + 0.45 * Math.sin(t * 8) : out ? 0.5 : 1;
      c.beginPath(); c.moveTo(fx, fy); c.lineTo(fx, py); c.stroke();
      c.beginPath(); c.arc(fx, py, 4, 0, 6.283); if (out) c.stroke(); else c.fill();
    }
    c.globalAlpha = 1; c.fillStyle = P.s; c.beginPath(); c.arc(0, 20, 5, 0, 6.283); c.fill();
    c.strokeStyle = P.s; c.lineWidth = 2; c.beginPath(); c.moveTo(0, 20); c.lineTo(0, 8); c.stroke();
    c.fillStyle = P.h; c.font = '600 12px ui-monospace,Menlo,monospace'; c.textAlign = 'left';
    c.fillText((hud.radarLabel || 'HOLO') + ' ' + fmtDist(R), -80, 122);
  }

  // ------------------------------------------------------------------ the HUD API games call
  // Optional HUD power and glitch, written by a game each frame (defaults change nothing):
  //   hud.power 0..1: boot progress; layers power on in BOOT order with a flicker and scanlines (1 = fully on)
  //   hud.glitch 0..1: damage glitch (jitter scaled by FX.shakeScale for reduced motion, flicker, scanlines)
  //   hud.clock false: holds the run timer (an intro plays before the clock starts)
  const BOOT = ['frame', 'minimap', 'score', 'weapon', 'timer', 'reticle', 'marks', 'popups'];
  let bootOn = false, glitchOn = false, bootN = 0;
  function bootFx() {
    const p = cl(hud.power ?? 1, 0, 1), g = cl(hud.glitch || 0, 0, 1);
    let scan = 0;
    if (p < 1) {
      bootOn = true; bootN++;
      for (let i = 0; i < BOOT.length; i++) {
        const a = cl((p - i * 0.08) / 0.3, 0, 1), fl = a > 0 && a < 1 && (bootN * 7 + i * 13) % 5 < 2 ? 0.2 : 1, o = (a * fl).toFixed(2);
        for (const e of LEL[BOOT[i]] || []) if (e._o !== o) { e._o = o; e.style.opacity = o; }
      }
      const ho = p > 0 ? '1' : '0'; if (hudEl._o !== ho) { hudEl._o = ho; hudEl.style.opacity = ho; }
      scan = p > 0 ? 0.9 * (1 - p) : 0;
    } else if (bootOn) {
      bootOn = false; hudEl._o = ''; hudEl.style.opacity = '';
      for (const l of BOOT) for (const e of LEL[l] || []) { e._o = ''; e.style.opacity = ''; }
    }
    if (g > 0.01) {
      glitchOn = true; const j = g * 9 * (typeof FX !== 'undefined' ? FX.shakeScale : 1);
      svg.style.transform = `translate(${((Math.random() - 0.5) * j).toFixed(1)}px,${((Math.random() - 0.5) * j * 0.4).toFixed(1)}px)`;
      svg.style.opacity = Math.random() < g * 0.45 ? '0.3' : '';
      scan = Math.max(scan, g * 0.8);
    } else if (glitchOn) { glitchOn = false; svg.style.transform = ''; svg.style.opacity = ''; }
    const so = scan.toFixed(2); if (scanEl._o !== so) { scanEl._o = so; scanEl.style.opacity = so; }
  }

  const hud = {
    labels: [], range: 0, radarLabel: '', power: 1, glitch: 0, clock: true,
    set(s) { if (s && typeof s === 'object') statsRef = s; },
    player: -1, // split screen: the viewport popups go to (the game sets it; -1 = every viewport)
    mp: null,   // split screen: per-player HUD data from the game (see drawMP)
    popup(text, nx, ny, kind) {
      if (mpLive()) { if (!S.layers.popups) return; if (hud.player >= 0) mpPopup(hud.player, text, nx, ny, kind); else for (let v = 0; v < hud.mp.n; v++) mpPopup(v, text, nx, ny, kind); return; }
      if (!S.layers.popups || !POPS.length) return;
      const p = POPS[popI]; popI = (popI + 1) % POPS.length;
      // kinds: good | bad | info, plus arcade 'big' (large score) and 'chain' (combo callouts)
      p.t = 0; p.life = kind === 'info' ? 1.4 : kind === 'big' ? 1.15 : kind === 'chain' ? 1.05 : 0.95; p.x = (nx + 1) * 0.5 * W; p.y = (1 - ny) * 0.5 * H;
      if (p.el._t !== text) { p.el._t = text; p.el.textContent = text; }
      const col = kind === 'bad' ? 'var(--d)' : kind === 'info' || kind === 'chain' ? 'var(--a)' : kind === 'big' ? 'var(--h)' : 'var(--s)';
      if (p.el._c !== col) { p.el._c = col; p.el.style.color = col; }
      p.el.style.fontSize = (kind === 'info' ? 26 : kind === 'big' ? 40 : kind === 'chain' ? 30 : 22) * Math.max(K, 0.7) * FZ + 'px';
      p.el.style.display = 'block'; p.el.style.opacity = '1';
    },
    blips(arr, n) { blipArr = arr; blipN = n | 0; },
    marks(arr, n) { markArr = arr; markN = n | 0; },
    event(name) {
      let e = EVENTS[name];
      // HOOK: a game's sound board (GAME.sfx(name, EVENTS[name]) → [id, gap ms, volume, flash colour key, flash] or null) decides every
      // effect; Reef Run's board (soundboard.js) replaces the old sfxOnly list with the same default: only the crash plays
      if (GM && GM.sfx) { e = GM.sfx(name, EVENTS[name]); if (!e) { if (name === 'levelup') hud.popup('LEVEL UP', 0, 0.35, 'info'); return; } }
      else if (GM && GM.sfxOnly && !GM.sfxOnly.includes(name)) e = null; // a game can keep only some sounds
      if (e) { play(e[0], e[2], e[1]); if (e[3]) { flashEl.style.background = P[e[3]]; flashMax = e[4]; flashA = 1; } }
      else if (AU.urls.has(name)) play(name, 0.8, 60); // any catalogue id plays directly
      if (name === 'levelup') hud.popup('LEVEL UP', 0, 0.35, 'info');
    },
    results(summary, onAgain) {
      state = 'over'; againFn = onAgain || null; unlockPointer();
      resEl.querySelector('h2').textContent = (summary && summary.title) || 'Run complete';
      const dl = resEl.querySelector('dl'); dl.textContent = '';
      for (const [k, v] of (summary && summary.lines) || []) { html('dt', { text: k }, dl); html('dd', { text: v }, dl); }
      resEl.style.display = 'grid';
      setTimeout(() => { if (state === 'over' && !open) resEl.querySelector('button').focus({ preventScroll: true }); }, 50);
    },
  };
  function again() {
    if (state !== 'over') return;
    resEl.style.display = 'none'; if (D.activeElement) D.activeElement.blur();
    state = 'run'; runTime = 0; if (statsRef) statsRef.time = 0;
    if (againFn) againFn(); else if (GM && GM.reset) GM.reset();
    hud.event('start'); lockPointer(true);
  }

  // ------------------------------------------------------------------ boot: wraps SCENE.build, installs G.update / G.post / G.start
  function boot(scene, game) {
    window.Shell = Shell; // for the console and tests (the page scripts run inside one async closure)
    SC = scene; GM = game; CTRL = game.controls || null; storeKey = 'sg-shell:' + (game.id || scene.id || 'game');
    game.prepare?.(scene);
    skin = URLP.get('skin') === 'visor' || URLP.get('skin') === 'canopy' ? URLP.get('skin') : game.skin === 'visor' ? 'visor' : 'canopy';
    for (const l of game.extraLayers || []) if (!LAYERS.includes(l)) { LAYERS.push(l); S.layers[l] = true; } // HOOK: game-drawn HUD layers (Reef Run: proximity)
    for (const l in game.layers || {}) if (l in S.layers) S.layers[l] = !!game.layers[l];
    S.gameLayers = game.layers ? JSON.stringify(game.layers) : undefined;
    load();
    if (!SC.p1) SC.p1 = [0, 0, 0, 1];
    buildDom(); buildSkin(); applyAll(); loadManifest();
    addEventListener('resize', () => { layout(); for (const k in cache) cache[k] = undefined; });
    D.addEventListener('visibilitychange', () => { hidePause = D.hidden && !URLP.has('timer'); if (D.hidden && state === 'run' && !URLP.has('timer')) setOpen(true); });
    if (TOYTEST) toyStart();
    const base = scene.build;
    scene.build = () => {
      G = base();
      game.init(G, Shell);
      canvas = D.getElementById('c');
      if (canvas) {
        canvas.style.touchAction = 'none';
        canvas.addEventListener('pointerdown', onDown);
        canvas.addEventListener('contextmenu', (e) => e.preventDefault());
      }
      applyLayers(); lobbyBuild(); mpFill();
      // G.grab(name) composites the 2D layers (effects, cockpit glass, split HUD) over the frame
      G.grabOverlay = (g, w, h) => { for (const id of ['fx2d', 'rrcock', 'sgmp']) { const c = D.getElementById(id); if (c && c.width && c.style.display !== 'none' && c.style.opacity !== '0') { g.globalAlpha = +(c.style.opacity || 1); g.drawImage(c, 0, 0, w, h); } } g.globalAlpha = 1; };
      G.start = () => {
        unlock(); if (D.activeElement) D.activeElement.blur();
        state = 'run'; runTime = 0; if (statsRef) statsRef.time = 0; resEl.style.display = 'none';
        if (S.music) musicPlay(); else if (GM && GM.music && !(GM.musicHold && GM.musicHold())) gameMusicPlay(true); // a track picked in Settings wins over the game's own; musicHold: the game starts it itself
        hud.event('start'); lockPointer(true);
      };
      G.update = (F, dt) => {
        lastDt = dt;
        if (!statsSynced) { statsSynced = true; applyLayers(); }
        composeInput(dt);
        const run = state === 'run' && !open && !hidePause;
        if (run) { if (hud.clock !== false) runTime += dt; if (statsRef) statsRef.time = runTime; }
        game.update(run ? dt : 0, input);
        input.look.dx = input.look.dy = 0; // deltas are per frame
      };
      G.post = (F, fx, fy, fz, rx, rz, ux, uy, uz, Wd, Hd) => {
        view.F = F; view.f[0] = fx; view.f[1] = fy; view.f[2] = fz; view.r[0] = rx; view.r[2] = rz; view.u[0] = ux; view.u[1] = uy; view.u[2] = uz;
        view.tan = Math.tan(F[11] / 2); view.aspect = Wd / Hd; view.W = Wd; view.H = Hd;
        if (mpLive()) { mpViewsSync(Wd, Hd); view.mv = G.views.n; view.views = mpV; } else view.mv = 0; // FX draws per viewport
        game.post?.(view);
        if (typeof FX !== 'undefined') FX.frame(open ? 0 : lastDt, view);
        render(lastDt);
        // the HUD jolts with big impacts (it rides the same shake as the camera)
        // #sgr itself has no box (its fixed children size to the viewport), so transforming it would make it their containing
        // block and collapse them; instead the shift goes to #sgh and to any full-screen layer a game marks with class 'sgjolt'
        if (root && typeof FX !== 'undefined') { const j = open ? 0 : FX.shake * 12; if (j > 0.4) { root.style.setProperty('--sgj', `translate(${((Math.random() - 0.5) * j).toFixed(1)}px,${((Math.random() - 0.5) * j).toFixed(1)}px)`); jolted = true; } else if (jolted) { root.style.removeProperty('--sgj'); jolted = false; } }
      };
      return G;
    };
  }

  const mp = { layout: mpLayout, views: mpV, colors: PCOL, names: PNAME, fill: mpFill, get on() { return mpOn(); }, get live() { return mpLive(); }, devices: MPD, fakepads: FAKE };
  // HOOKS for game modules (Reef Run combat.js / soundboard.js): raw keys and pads (read-only use), and the catalogue audio
  const raw = { keys, pad, pads: () => lastGP, dz };
  const audio = { play: (id, vol, gap) => play(id, vol, gap ?? 0), list: () => AU.list || [], has: (id) => AU.urls.has(id), url: (id) => AU.urls.get(id), load: (id) => loadBuf(id),
    buf: (id) => AU.buf.get(id), get ctx() { return AU.ctx; }, get out() { return AU.gain; }, get vol() { return S.sfxVol; }, get ok() { return AU.ok; }, unlock: () => unlock() };
  return { boot, hud, input, command, mp, raw, audio, musicClock, gameMusicAt, musicPause, musicTracks, get view() { return S.view; }, get control() { return CTRL ? S.control : ''; }, settings: S, palettes: PAL, toy, setOpen, get open() { return open; }, get state() { return state; }, get stats() { return statsRef; } };
})();
