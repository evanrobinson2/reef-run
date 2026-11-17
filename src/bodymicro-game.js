// ============================================================================
// bodymicro-game.js: Body Defenders, Micro Mission. A calm rail run through the capillary of BD-3.0 (bodymicro.js).
// One tool, the bubble shot (oxygen and nutrients), does three kind things:
//   - a hungry body cell (cream) is FED;
//   - a red cell or platelet with a germ drifting toward it is TRACTORED to your ship, safe;
//   - a germ (bacterium or virus) is TAGGED, and a white blood cell glides over and swallows it.
// A short fact card appears the first time each cell type is met. Follows GAME_API.md and BODY_GAMES.md.
// View (VIEW.md): cockpit by default, the camera is the ship and the K1 model is hidden; V switches to over the right
// shoulder, the K1 at the pilot position lower-left of the reticle. No guide ship flies ahead.
// Everything below is load-time allocation; update() and post() reuse preallocated arrays.
// ============================================================================
const GAME = (() => {
  // ---------------------------------------------------------------- tuning (data)
  const SPEED = 4.0;              // m/s along the rail (calm); the run is about 60 s
  const BOX_X = 2.6, BOX_Y = 1.9; // pilot offset box (m)
  const CLEAR_RAIL = 2.6, CLEAR_CAM = 1.0;
  const FOV = 40 * Math.PI / 180; // the concept camera's FOV (DECOMPOSITION.md section 6)
  const LOOK_AIM = 0.15, LOOK_AHEAD = 7;
  const SH_BACK = 4.8, SH_UP = 1.15, SH_RIGHT = 0.9; // shoulder camera: behind, above and right of the pilot (ship lower-left;
                                                   // the 40-degree concept FOV puts a 1.3 m rise near the bottom edge)
  const VIEW_BLEND = 0.35;        // seconds to switch cockpit <-> shoulder
  const COMBO_WINDOW = 6;
  const PTS = { feed: 100, save: 150, tag: 120 }, XP = { feed: 90, save: 130, tag: 110 };
  const TRACTOR_TIME = 1.1, GULP_TIME = 1.3;
  const GERM_SPEED = 0.45;        // m/s a threatening germ drifts toward its cell
  // bubble shot levels: shop upgrades can later write to this table
  const WEAPON = [
    { xp: 0, radius: 0.75, speed: 30, rate: 3.0, heat: 0.13, cool: 0.30, twin: false },
    { xp: 300, radius: 0.9, speed: 34, rate: 3.5, heat: 0.12, cool: 0.36, twin: false },
    { xp: 800, radius: 1.05, speed: 38, rate: 4.0, heat: 0.11, cool: 0.44, twin: true },
    { xp: 1500, radius: 1.2, speed: 43, rate: 4.5, heat: 0.10, cool: 0.52, twin: true },
    { xp: 2500, radius: 1.35, speed: 48, rate: 5.0, heat: 0.09, cool: 0.60, twin: true },
  ];
  const HEAT_RESUME = 0.35;
  // facts: correct and simple (checked against standard school biology); shown once per run, first meeting
  const FACTS = {
    rbc: ['Red blood cell', 'Red blood cells carry oxygen from your lungs to every part of your body. Each one is a round disc, dented in the middle on both sides.'],
    wbc: ['White blood cell', 'White blood cells are your body’s defenders. Some of them find germs and swallow them up. (In microscope pictures they are often dyed purple so we can see them.)'],
    platelet: ['Platelet', 'Platelets are tiny pieces of cells. If you get a cut, they stick together to help plug it.'],
    bacterium: ['Bacterium', 'A bacterium is a tiny living thing made of just one cell. Most bacteria are harmless or even helpful, but a few can make you sick.'],
    virus: ['Virus', 'A virus is much smaller than a cell. It cannot grow on its own; it can only make copies of itself inside a living cell.'],
    cell: ['Hungry body cell', 'Your body’s cells need oxygen and food to make energy. They get them from the blood flowing through tiny capillaries.'],
  };
  // ---------------------------------------------------------------- pools
  const NH = 14;    // hungry body cells (CRM family)
  const NG = 10;    // good cells in danger: red cells (7) and platelets (3)
  const NB = 9;     // bacteria (NG of them threaten a good cell, the rest float free)
  const NV = 7;     // viruses
  const NW = 6;     // helper white cells (WBC family), recycled
  const NBUB = 24, BP = 7, NBM = 4, BMN = 12, NS = 48;
  // labels for the HUD marks
  const LAB = { hungry: 0, rbc: 1, platelet: 2, bacterium: 3, virus: 4, exit: 5 };

  // ---------------------------------------------------------------- state
  let G = null, hud = null, field = null, rail = null, F = null, view = null, SC = null;
  let s0 = 0, s = 0, ox = 0, oy = 0, t = 0, runTime = 0, over = false;
  let heat = 0, overheated = false, fireT = 0, level = 1, xp = 0, score = 0, combo = 1, lastHelp = -99;
  let fed = 0, saved = 0, tagged = 0, sick = 0;
  const TOTAL = NH + NG + NB + NV;
  const stats = { score: 0, combo: 1, time: 0, level: 1, xp: 0, xpNext: 300, heat: 0, overheated: false, weaponName: 'Bubble', counterLabel: 'Helped', counterValue: 0, counterMax: TOTAL };
  const fr = new Float64Array(9), rp = [0, 0, 0], tp = [0, 0, 0], tq = [0, 0, 0], cam = [0, 0, 0], look = [0, 0, 1], o3 = [0, 0, 0];
  const vf = [0, 0, 1], vr = [1, 0, 0], vu = [0, 1, 0]; let vtan = Math.tan(FOV / 2), vasp = 1.78;
  // targets share one record layout: position, radius, kind, state, timers
  //   kind: 0 hungry, 1 red cell, 2 platelet, 3 bacterium, 4 virus
  //   state: 0 waiting, 1 done (fed / tractoring / tagged), 2 gone, 3 sick (good cell reached by a germ)
  const NT = NH + NG + NB + NV;
  const T = { kind: new Uint8Array(NT), state: new Uint8Array(NT), pos: new Float32Array(NT * 3), base: new Float32Array(NT * 3), r: new Float32Array(NT), s: new Float32Array(NT),
    tt: new Float32Array(NT), ph: new Float32Array(NT), victim: new Int16Array(NT).fill(-1), helper: new Int8Array(NT).fill(-1), mesh: new Array(NT), slot: new Int16Array(NT), q: new Float32Array(NT * 4) };
  const W = { on: new Uint8Array(NW), who: new Int16Array(NW), from: new Float32Array(NW * 3), tt: new Float32Array(NW), pos: new Float32Array(NW * 3) };
  let mHungry = null, mRbc = null, mPlt = null, mBac = null, mVir = null, mWbc = null, shipParts = [], shipBase = null, decor = [];
  // points: [bubbles NBUB*BP][beams NBM*BMN][sparks NS]
  let PB = 0, PBM = 0, PS = 0, PEND = 0;
  const bub = { on: new Uint8Array(NBUB), p: new Float32Array(NBUB * 3), v: new Float32Array(NBUB * 3), life: new Float32Array(NBUB), r: new Float32Array(NBUB) };
  const beam = { who: new Int16Array(NBM).fill(-1) };
  const spark = { p: new Float32Array(NS * 3), v: new Float32Array(NS * 3), life: new Float32Array(NS), c: new Float32Array(NS * 3) }; let sparkNext = 0;
  const marks = new Float32Array(16 * 6), blips = new Float32Array((NT + 1) * 4), endP = [0, 0, 0];
  const sq = [0, 0, 0, 1], sqa = [0, 0, 0, 1], sqb = [0, 0, 0, 1], spos = [0, 0, 0]; let shipRoll = 0;
  // view: cam is the ship (pilot position: hits, pickups, tractor, radar, bolt origin); eye is the rendered camera
  // (= cam in cockpit, behind/above/right in shoulder). ef/er/eu: the look basis. vbl 0 cockpit .. 1 shoulder (linear),
  // vb eased, ve = vb times the opening ramp (the concept view is always cockpit). side: the shoulder's right offset,
  // widened when the reticle drops toward the ship so the ship slides left, clear of it.
  const eye = [0, 0, 0], ef = [0, 0, 1], er = [1, 0, 0], eu = [0, 1, 0], deye = [0, 0, 0];
  let SH = null, vbl = 0, vb = 0, ve = 0, side = SH_RIGHT, shipVis = 1, pox = 0, shipDist = 0;
  const viewWant = () => (SH && SH.view === 'shoulder' ? 1 : 0);
  // facts
  const seen = { rbc: false, wbc: false, platelet: false, bacterium: false, virus: false, cell: false };
  const factQ = []; let factEl = null, factT = 0, factOn = false, factTop = false;
  let bot = false; // ?debug: an autopilot that aims at the nearest target (testing only)

  let seed = 31337;
  const rand = () => { seed = (seed + 0x6D2B79F5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  const sstep = (a, b, x) => { x = Math.min(1, Math.max(0, (x - a) / (b - a))); return x * x * (3 - 2 * x); };
  const grad = (x, y, z, o) => { const e = 0.4; o[0] = field(x + e, y, z) - field(x - e, y, z); o[1] = field(x, y + e, z) - field(x, y - e, z); o[2] = field(x, y, z + e) - field(x, y, z - e); const l = Math.hypot(o[0], o[1], o[2]) || 1; o[0] /= l; o[1] /= l; o[2] /= l; return o; };
  const qmul = (a, b, o) => { const x = a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], y = a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], z = a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], w = a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]; o[0] = x; o[1] = y; o[2] = z; o[3] = w; return o; };
  const qaxis = (x, y, z, a, o) => { const sa = Math.sin(a / 2); o[0] = x * sa; o[1] = y * sa; o[2] = z * sa; o[3] = Math.cos(a / 2); return o; };

  // ---------------------------------------------------------------- rail: hero camera, up over the fold, then the vessel's centre line
  function pushClear(p) {
    const g = [0, 0, 0];
    for (let it = 0; it < 80; it++) { const f = field(p[0], p[1], p[2]); if (f < -CLEAR_RAIL - 0.08) break; grad(p[0], p[1], p[2], g); const k = (f + CLEAR_RAIL + 0.12) * 0.5; p[0] -= g[0] * k; p[1] -= g[1] * k; p[2] -= g[2] * k; }
    return p;
  }
  function buildRail() {
    const c = [0, 0, 0];
    // the opening stretch is pinned: it starts exactly on the concept camera (origin, yaw 0, pitch 0) and runs straight
    const pins = [[0, 0, -6], [0, 0, -3], [0, 0, 0], [0, 0, 2.5]];
    const ctrl = [...pins, [0.35, 0.55, 6], [1.5, 2.2, 11], [2.6, 3.6, 17]];
    for (let z = 26; z <= G.vesselLen - 8; z += 12) { G.centre(z, c); ctrl.push(pushClear([c[0] + 0.8 * Math.sin(z * 0.05), c[1] - 0.5, z])); }
    for (let pass = 0; pass < 2; pass++) { // relax the free points, push them clear again
      for (let i = pins.length + 1; i < ctrl.length - 1; i++) { const a = ctrl[i - 1], b = ctrl[i + 1], p = ctrl[i]; for (let k = 0; k < 3; k++) p[k] = p[k] * 0.7 + (a[k] + b[k]) * 0.15; if (p[2] > 20) pushClear(p); }
    }
    rail = makeRail(ctrl, 0.5);
    let best = 1e9; const p = [0, 0, 0];
    for (let q = 0; q <= 12; q += 0.002) { rail.at(q, p); const d = Math.hypot(p[0], p[1], p[2]); if (d < best) { best = d; s0 = q; } }
    rail.conceptErr = best;
    rail.at(rail.len, endP);
  }
  function clampOffset(p, f9, x, y, o) {
    const at = (k) => field(p[0] + (f9[3] * x + f9[6] * y) * k, p[1] + (f9[4] * x + f9[7] * y) * k, p[2] + (f9[5] * x + f9[8] * y) * k);
    let k = 1;
    if (at(1) > -CLEAR_CAM) { let lo = 0, hi = 1; for (let i = 0; i < 7; i++) { const m = (lo + hi) / 2; if (at(m) <= -CLEAR_CAM) lo = m; else hi = m; } k = lo; }
    o[0] = x * k; o[1] = y * k; return o;
  }
  function clearance() {
    let railMin = 1e9, railAt = 0; const p = [0, 0, 0];
    for (let q = s0; q <= rail.len; q += 0.25) { rail.at(q, p); const f = field(p[0], p[1], p[2]); if (-f < railMin) { railMin = -f; railAt = q; } }
    return { railMin, railAt, len: rail.len, s0, runLen: rail.len - s0, runSeconds: (rail.len - s0) / SPEED, conceptErr: rail.conceptErr };
  }

  // ---------------------------------------------------------------- placement
  // a point d metres from the rail at station si, in direction angle a around it; onWall: march until the wall
  function spot(si, a, dmin, dmax, onWall, r, out) {
    const p = [0, 0, 0], f9 = new Float64Array(9); rail.at(si, p); rail.frame(si, f9);
    const dx = f9[3] * Math.cos(a) + f9[6] * Math.sin(a), dy = f9[4] * Math.cos(a) + f9[7] * Math.sin(a), dz = f9[5] * Math.cos(a) + f9[8] * Math.sin(a);
    if (onWall) {
      for (let m = dmin; m < dmax; m += 0.2) if (field(p[0] + dx * m, p[1] + dy * m, p[2] + dz * m) > -r * 0.4) { out[0] = p[0] + dx * (m - r * 0.5); out[1] = p[1] + dy * (m - r * 0.5); out[2] = p[2] + dz * (m - r * 0.5); return true; }
      return false;
    }
    const m = dmin + (dmax - dmin) * rand();
    out[0] = p[0] + dx * m; out[1] = p[1] + dy * m; out[2] = p[2] + dz * m;
    return field(out[0], out[1], out[2]) < -r - 0.4;
  }
  const lowSide = () => (rand() < 0.75 ? Math.PI * (1.05 + rand() * 0.9) : rand() * Math.PI); // mostly the lower half (screen-friendly)
  function placeAll() {
    const sA = s0 + 16, sB = rail.len - 6, o = [0, 0, 0];
    let k = 0;
    const add = (kind, si, x, y, z, r) => { T.kind[k] = kind; T.s[k] = si; T.base[k * 3] = x; T.base[k * 3 + 1] = y; T.base[k * 3 + 2] = z; T.r[k] = r; T.ph[k] = rand(); return k++; };
    // hungry body cells resting in the flow 4-7.5 m off the rail, like CRM-1 (the vessel is ~14 m wide, so cells on its
    // walls would sit outside the view cone); the last five crowd the end (the finale: a hungry tissue patch)
    for (let i = 0; i < NH; i++) {
      const fin = i >= NH - 5, si = fin ? rail.len - 34 + (i - (NH - 5)) * 5.5 : sA + (sB - 40 - sA) * (i + 0.5) / (NH - 5);
      let ok = false;
      for (let tries = 0; tries < 60 && !ok; tries++) { const r = 0.75 + rand() * 0.35; if (spot(si + (rand() - 0.5) * 4, fin ? rand() * 6.283 : lowSide(), 4.0, 7.5, false, r, o)) { add(0, si, o[0], o[1], o[2], r); ok = true; } }
      if (!ok) { rail.at(si, o); add(0, si, o[0] + 5, o[1] - 3, o[2], 0.8); }
    }
    // good cells in danger, each with a germ approaching
    const bacOf = [];
    for (let i = 0; i < NG; i++) {
      const si = sA + 6 + (sB - 46 - sA) * (i + 0.5) / NG, plt = i % 3 === 1, r = plt ? 0.32 : 0.75;
      let ok = false;
      for (let tries = 0; tries < 60 && !ok; tries++) if (spot(si, lowSide(), 3.2, 6.5, false, r, o)) ok = true;
      bacOf.push(add(plt ? 2 : 1, si, o[0], o[1], o[2], r));
    }
    // germs: the first NG threaten a good cell (bacteria for most, viruses for some), the rest float free
    let nb = 0, nv = 0;
    for (let i = 0; i < NG; i++) {
      const vir = i % 4 === 3 && nv < NV, g = bacOf[i], a = rand() * 6.283, d = 2.8;
      const x = T.base[g * 3] + Math.cos(a) * d, y = T.base[g * 3 + 1] + Math.sin(a) * d * 0.6, z = T.base[g * 3 + 2] + 1.5 + rand() * 1.5;
      const j = add(vir ? 4 : 3, T.s[g] + 1, x, y, z, vir ? 0.45 : 0.5); T.victim[j] = g; if (vir) nv++; else nb++;
    }
    for (; nb < NB || nv < NV;) {
      const vir = nv < NV && (nb >= NB || rand() < 0.45), si = sA + (sB - 30 - sA) * rand(), r = vir ? 0.45 : 0.5;
      let ok = false; for (let tries = 0; tries < 60 && !ok; tries++) if (spot(si, rand() * 6.283, 3.0, 7.5, false, r, o)) ok = true;
      add(vir ? 4 : 3, si, o[0], o[1], o[2], r); if (vir) nv++; else nb++;
    }
    // slot index within each kind's mesh pool
    const cnt = [0, 0, 0, 0, 0];
    for (let i = 0; i < NT; i++) { T.slot[i] = cnt[T.kind[i]]++; const q = qaxis(rand() - 0.5, rand() - 0.5, rand() - 0.5, rand() * 6.283, [0, 0, 0, 1]); const l = Math.hypot(q[0], q[1], q[2], q[3]); for (let c = 0; c < 4; c++) T.q[i * 4 + c] = q[c] / l; }
    return cnt;
  }

  function buildMeshes(cnt) {
    const g = G.geo;
    const pool = (geo, n, mat, a, b, c) => { const m = Object.assign({}, geo); m.inst = new Float32Array(Math.max(1, n) * 12); for (let i = 0; i < n; i++) { const o = i * 12; m.inst[o + 7] = 1; m.inst[o + 8] = mat; m.inst[o + 9] = a; m.inst[o + 10] = b; m.inst[o + 11] = c; } m.microGame = true; return m; };
    mHungry = pool(g.lumpy, cnt[0], 6, 0.5, 0, 0);
    mRbc = pool(g.rbc, cnt[1], 4, 0.3, 0, 0);
    mPlt = pool(g.bead, cnt[2], 7, 0, 0, 0);
    mBac = pool(g.rod, cnt[3], 3, 0.45, 0.80, 0.42);   // soft lime-green rods (P: game addition, kid-friendly colour)
    mVir = pool(g.virus, cnt[4], 3, 0.55, 0.82, 0.62); // pale green spiky balls
    mWbc = pool(g.lumpy, NW, 5, 0.2, 0, 0);
    return [mHungry, mRbc, mPlt, mBac, mVir, mWbc];
  }
  const meshOf = (k) => [mHungry, mRbc, mPlt, mBac, mVir][k];
  // write target i's instance (scale sc, prm z/w)
  let appear = 0; // game cells fade in when the run starts, so the menu and ?shot frames are the concept view
  function writeT(i, sc, pz, pw) {
    const m = meshOf(T.kind[i]), o = T.slot[i] * 12, a = m.inst;
    a[o] = T.pos[i * 3]; a[o + 1] = T.pos[i * 3 + 1]; a[o + 2] = T.pos[i * 3 + 2]; a[o + 3] = sc * appear;
    a[o + 4] = T.q[i * 4]; a[o + 5] = T.q[i * 4 + 1]; a[o + 6] = T.q[i * 4 + 2]; a[o + 7] = T.q[i * 4 + 3];
    const k = T.kind[i];
    if (k <= 2) { a[o + 10] = pz; a[o + 11] = pw; } // cells: prm.z (fed / sick), prm.w (glow)
    else { const b = 1 + pw; a[o + 9] = (k === 3 ? 0.45 : 0.55) * b; a[o + 10] = (k === 3 ? 0.80 : 0.82) * b; a[o + 11] = (k === 3 ? 0.42 : 0.62) * b; }
    m.dirty = true;
  }
  // the scene's static cells near the rail drift aside as you approach (the flow parts for the ship)
  function collectDecor() {
    const p = [0, 0, 0];
    for (const m of G.meshes) {
      if (!m.family) continue;
      const a = m.inst, n = a.length / 12;
      for (let i = 0; i < n; i++) {
        const x = a[i * 12], y = a[i * 12 + 1], z = a[i * 12 + 2], r = a[i * 12 + 3];
        let bd = 1e9, bs = 0; for (let q = s0; q <= rail.len; q += 1) { rail.at(q, p); const d = Math.hypot(p[0] - x, p[1] - y, p[2] - z); if (d < bd) { bd = d; bs = q; } }
        if (bd < r + 2.6) { for (let q = bs - 1; q <= bs + 1; q += 0.1) { rail.at(q, p); const d = Math.hypot(p[0] - x, p[1] - y, p[2] - z); if (d <= bd) { bd = d; bs = q; } } rail.at(bs, p);
          const dx = x - p[0], dy = y - p[1], dz = z - p[2], dl = Math.hypot(dx, dy, dz) || 1;
          decor.push({ a, o: i * 12, x, y, z, s: bs, push: r + 2.8 - bd, nx: dx / dl, ny: dy / dl, nz: dz / dl, m }); }
      }
    }
  }

  // ---------------------------------------------------------------- points
  const setPt = (k, x, y, z, size, r, g, b) => { const a = G.points, o = k * 8; a[o] = x; a[o + 1] = y; a[o + 2] = z; a[o + 3] = size; a[o + 4] = r; a[o + 5] = g; a[o + 6] = b; a[o + 7] = 0; };
  const hidePt = (k) => { G.points[k * 8 + 3] = 0; };

  // ---------------------------------------------------------------- fact cards (DOM; the shell's popups are too short for a sentence)
  function buildFactEl() {
    if (typeof document === 'undefined') return;
    factEl = document.createElement('div');
    factEl.setAttribute('role', 'status'); factEl.setAttribute('aria-live', 'polite');
    factEl.style.cssText = 'position:fixed;left:50%;bottom:9%;transform:translate(-50%,12px);max-width:min(560px,86vw);padding:12px 18px 13px;border-radius:14px;background:rgba(7,22,20,.78);border:2px solid #8ff0c8;color:#e4fff4;font:500 16px/1.4 system-ui,-apple-system,sans-serif;box-shadow:0 6px 30px rgba(0,0,0,.35);opacity:0;transition:opacity .35s,transform .35s;pointer-events:none;z-index:40;text-align:left';
    factEl.innerHTML = '<div style="font:700 12px/1 ui-monospace,Menlo,monospace;letter-spacing:.14em;color:#8ff0c8;margin-bottom:6px">NEW CELL FACT</div><div data-h style="font-weight:800;font-size:18px;margin-bottom:2px"></div><div data-b></div>';
    document.body.appendChild(factEl);
  }
  function meet(key) {
    if (seen[key]) return; seen[key] = true; factQ.push(key);
  }
  function stepFacts(dt) {
    if (!factEl) return;
    const top = ve > 0.5; // shoulder view: the card moves to the top so it never hides the ship (lower-left)
    if (top !== factTop) { factTop = top; factEl.style.bottom = top ? 'auto' : '9%'; factEl.style.top = top ? '13%' : 'auto'; }
    if (factOn) { factT -= dt; if (factT <= 0) { factOn = false; factEl.style.opacity = '0'; factEl.style.transform = 'translate(-50%,12px)'; factT = 0.6; } return; }
    if (factT > 0) { factT -= dt; return; }
    if (!factQ.length || over) return;
    const key = factQ.shift(), f = FACTS[key];
    factEl.querySelector('[data-h]').textContent = f[0]; factEl.querySelector('[data-b]').textContent = f[1];
    factEl.style.opacity = '1'; factEl.style.transform = 'translate(-50%,0)'; factOn = true; factT = 5.5;
    hud.event('pickup');
  }
  function hideFact() { if (factEl) { factEl.style.opacity = '0'; factOn = false; factT = 0; } factQ.length = 0; }

  // ---------------------------------------------------------------- init
  function init(g, Shell) {
    G = g; SH = Shell; hud = Shell.hud; field = G.field;
    shipParts = G.meshes.filter((m) => m.shipPart);
    shipBase = { pos: G.ship.pos.slice(), q: G.ship.q.slice() };
    buildRail();
    const cnt = placeAll();
    G.meshes.push(...buildMeshes(cnt));
    collectDecor();
    const ghost = rail.ghost(0.5, 0.04, [0.65, 1.05, 0.95]);
    const n0 = G.points.length / 8, ng = ghost.length / 8;
    PB = n0 + ng; PBM = PB + NBUB * BP; PS = PBM + NBM * BMN; PEND = PS + NS;
    const pts = new Float32Array(PEND * 8); pts.set(G.points); pts.set(ghost, n0 * 8);
    G.points = pts; G.dynPts = [PB, PEND - PB];
    G.dof = SC.dof ? Object.assign({}, SC.dof) : null; // the engine's DOF pass reads this live; we rack focus below
    hud.labels = ['Hungry cell', 'Red cell', 'Platelet', 'Germ', 'Virus', 'Exit'];
    buildFactEl();
    if (typeof QS !== 'undefined' && QS.has('debug')) window.microMission = GAME;
    GAME.debug = { rail, clearance, field: (x, y, z) => field(x, y, z), T, W, WEAPON, FACTS, seen, decor, view: () => view, s0: () => s0, get s() { return s; }, set s(v) { s = v; }, get bot() { return bot; }, set bot(v) { bot = v; },
      get state() { return { heat, overheated, level, xp, score, combo, fed, saved, tagged, sick, over, runTime, s, len: rail.len, factQ: factQ.slice(), factOn, view: SH ? SH.view : 'cockpit', viewBlend: vb, viewEff: ve, side, shipVis, cam: cam.slice(), eye: eye.slice() }; } };
    reset();
  }

  // ---------------------------------------------------------------- reset (also Play again)
  function reset() {
    s = s0; ox = oy = 0; t = 0; runTime = 0; over = false;
    heat = 0; overheated = false; fireT = 0; level = 1; xp = 0; score = 0; combo = 1; lastHelp = -99; fed = saved = tagged = sick = 0; shipRoll = 0;
    vbl = vb = viewWant(); ve = 0; side = SH_RIGHT; shipVis = 1; pox = 0;
    rail.tan(s0, look);
    for (let i = 0; i < NT; i++) {
      T.state[i] = 0; T.tt[i] = 0; T.helper[i] = -1;
      T.pos[i * 3] = T.base[i * 3]; T.pos[i * 3 + 1] = T.base[i * 3 + 1]; T.pos[i * 3 + 2] = T.base[i * 3 + 2];
      writeT(i, T.r[i], 0, 0);
    }
    W.on.fill(0); for (let w = 0; w < NW; w++) { mWbc.inst[w * 12 + 3] = 0; } mWbc.dirty = true;
    bub.on.fill(0); beam.who.fill(-1); spark.life.fill(0);
    for (let k = PB; k < PEND; k++) hidePt(k);
    for (const d of decor) { d.a[d.o] = d.x; d.a[d.o + 1] = d.y; d.a[d.o + 2] = d.z; d.m.dirty = true; }
    for (const m of shipParts) { const a = m.inst; a[0] = shipBase.pos[0]; a[1] = shipBase.pos[1]; a[2] = shipBase.pos[2]; a[3] = 1; a[4] = shipBase.q[0]; a[5] = shipBase.q[1]; a[6] = shipBase.q[2]; a[7] = shipBase.q[3]; m.dirty = true; }
    for (const k in seen) seen[k] = false; hideFact();
    writeStats();
  }
  function writeStats() {
    stats.score = score; stats.combo = combo; stats.time = runTime; stats.level = level; stats.xp = xp;
    stats.xpNext = level < WEAPON.length ? WEAPON[level].xp : WEAPON[WEAPON.length - 1].xp;
    stats.heat = heat; stats.overheated = overheated; stats.counterValue = fed + saved + tagged;
  }

  // ---------------------------------------------------------------- firing and helping
  function fire(gx, gy) {
    const w = WEAPON[level - 1];
    let dx = vf[0] + (vr[0] * gx * vasp + vu[0] * gy) * vtan, dy = vf[1] + (vr[1] * gx * vasp + vu[1] * gy) * vtan, dz = vf[2] + (vr[2] * gx * vasp + vu[2] * gy) * vtan;
    const dl = Math.hypot(dx, dy, dz); dx /= dl; dy /= dl; dz /= dl;
    // the aim ray runs from the camera (eye) through the reticle; the bubbles start at the ship
    let D = 40; for (let m = 1; m < 40; m += 0.75) if (field(eye[0] + dx * m, eye[1] + dy * m, eye[2] + dz * m) > 0) { D = m; break; }
    // converge on the first waiting target the ray passes through (else the wall), so shots from the ship in shoulder
    // view still land where the reticle points despite the parallax
    for (let i = 0; i < NT; i++) {
      if (T.state[i] !== 0) continue;
      const cx = T.pos[i * 3] - eye[0], cy = T.pos[i * 3 + 1] - eye[1], cz = T.pos[i * 3 + 2] - eye[2], m = cx * dx + cy * dy + cz * dz;
      if (m < 1 || m >= D) continue;
      const ex = cx - dx * m, ey = cy - dy * m, ez = cz - dz * m, rr = T.r[i] + w.radius * 0.5;
      if (ex * ex + ey * ey + ez * ez < rr * rr) D = m;
    }
    const ax = eye[0] + dx * D, ay = eye[1] + dy * D, az = eye[2] + dz * D;
    for (let b = 0; b < (w.twin ? 2 : 1); b++) {
      let k = -1; for (let j = 0; j < NBUB; j++) if (!bub.on[j]) { k = j; break; }
      if (k < 0) return;
      // cockpit: just below the eye (twin: left and right of it); shoulder: from the K1's nose (+x, about 0.95 m ahead)
      const lat = (w.twin ? (b ? 0.4 : -0.4) : 0) * (1 - 0.5 * ve), dn = 0.3 * (1 - ve), fw = 0.6 + 0.45 * ve;
      const px = cam[0] + vr[0] * lat - vu[0] * dn + vf[0] * fw, py = cam[1] + vr[1] * lat - vu[1] * dn + vf[1] * fw, pz = cam[2] + vr[2] * lat - vu[2] * dn + vf[2] * fw;
      let ex = ax - px, ey = ay - py, ez = az - pz; const el = Math.hypot(ex, ey, ez) || 1;
      bub.on[k] = 1; bub.life[k] = 1.2; bub.r[k] = w.radius;
      bub.p[k * 3] = px; bub.p[k * 3 + 1] = py; bub.p[k * 3 + 2] = pz;
      bub.v[k * 3] = ex / el * w.speed; bub.v[k * 3 + 1] = ey / el * w.speed; bub.v[k * 3 + 2] = ez / el * w.speed;
    }
    hud.event('fire');
  }
  function award(kind, i) {
    combo = t - lastHelp < COMBO_WINDOW && (fed + saved + tagged) > 0 ? combo + 1 : 1; lastHelp = t;
    const p = PTS[kind] * Math.min(combo, 5); score += p; xp += XP[kind] + 8 * (combo - 1);
    if (view) view.project(T.pos[i * 3], T.pos[i * 3 + 1] + T.r[i], T.pos[i * 3 + 2], o3); else { o3[0] = 0; o3[1] = 0; }
    hud.popup('+' + p + (kind === 'feed' ? ' Fed!' : kind === 'save' ? ' Safe!' : ' Caught!'), o3[0], o3[1], 'good');
    while (level < WEAPON.length && xp >= WEAPON[level].xp) { level++; hud.event('levelup'); hud.popup('Bubble L' + level, 0, 0.32, 'info'); }
  }
  function hitTarget(i) {
    const k = T.kind[i];
    if (k === 0) { // feed a hungry cell
      T.state[i] = 1; T.tt[i] = 0; fed++; award('feed', i); hud.event('pickup');
      if (typeof FX !== 'undefined') FX.kick(0.12);
      sparks(T.pos[i * 3], T.pos[i * 3 + 1], T.pos[i * 3 + 2], 1.0, 0.85, 0.7);
    } else if (k === 1 || k === 2) { // tractor a good cell to the ship
      T.state[i] = 1; T.tt[i] = 0; saved++; award('save', i); hud.event('rescue');
      if (typeof FX !== 'undefined') FX.kick(0.18);
      for (let b = 0; b < NBM; b++) if (beam.who[b] < 0) { beam.who[b] = i; break; }
    } else { // tag a germ: a white cell comes for it
      T.state[i] = 1; T.tt[i] = 0; tagged++; award('tag', i); hud.event('hit');
      let w = -1; for (let j = 0; j < NW; j++) if (!W.on[j]) { w = j; break; }
      if (w < 0) { let best = -1; for (let j = 0; j < NW; j++) if (best < 0 || W.tt[j] > W.tt[best]) best = j; w = best; const old = W.who[w]; if (old >= 0) finishGulp(old); }
      W.on[w] = 1; W.who[w] = i; W.tt[w] = 0; T.helper[i] = w;
      // the helper comes from the nearest wall side, away from the rail
      rail.at(T.s[i], tp); let dx = T.pos[i * 3] - tp[0], dy = T.pos[i * 3 + 1] - tp[1], dz = T.pos[i * 3 + 2] - tp[2]; const dl = Math.hypot(dx, dy, dz) || 1;
      W.from[w * 3] = T.pos[i * 3] + dx / dl * 4.5; W.from[w * 3 + 1] = T.pos[i * 3 + 1] + dy / dl * 4.5; W.from[w * 3 + 2] = T.pos[i * 3 + 2] + dz / dl * 4.5 + 1.5;
      meet('wbc');
    }
  }
  function finishGulp(i) {
    const w = T.helper[i]; T.state[i] = 2; writeT(i, 0, 0, 0);
    if (typeof FX !== 'undefined') FX.splat(T.pos[i * 3], T.pos[i * 3 + 1], T.pos[i * 3 + 2], { color: '#9fe07a', scale: 0.45, text: 'GULP!' });
    if (w >= 0) { W.tt[w] = Math.max(W.tt[w], GULP_TIME); }
    T.helper[i] = -1;
  }
  function sparks(x, y, z, r, g, b) {
    for (let n = 0; n < 8; n++) {
      const k = sparkNext; sparkNext = (sparkNext + 1) % NS;
      spark.p[k * 3] = x; spark.p[k * 3 + 1] = y; spark.p[k * 3 + 2] = z; spark.c[k * 3] = r; spark.c[k * 3 + 1] = g; spark.c[k * 3 + 2] = b;
      const a = rand() * 6.283, bb = rand() * 2 - 1, c = Math.sqrt(1 - bb * bb), sp = 1 + rand() * 2;
      spark.v[k * 3] = Math.cos(a) * c * sp; spark.v[k * 3 + 1] = bb * sp; spark.v[k * 3 + 2] = Math.sin(a) * c * sp; spark.life[k] = 0.6;
    }
  }

  // ---------------------------------------------------------------- per frame
  const aim = { x: 0, y: 0, fire: false };
  function botAim() { // debug autopilot: nearest waiting target in view
    let best = -1, bd = 1e9;
    for (let i = 0; i < NT; i++) { if (T.state[i] !== 0) continue; const dx = T.pos[i * 3] - cam[0], dy = T.pos[i * 3 + 1] - cam[1], dz = T.pos[i * 3 + 2] - cam[2], d = Math.hypot(dx, dy, dz); if (d > 26 || d < 2) continue; view.project(T.pos[i * 3], T.pos[i * 3 + 1], T.pos[i * 3 + 2], o3); if (o3[2] < 1 || Math.abs(o3[0]) > 0.95 || Math.abs(o3[1]) > 0.95) continue; if (d < bd) { bd = d; best = i; } }
    if (best < 0) { aim.fire = false; return; }
    view.project(T.pos[best * 3], T.pos[best * 3 + 1], T.pos[best * 3 + 2], o3); aim.x = o3[0]; aim.y = o3[1]; aim.fire = true;
  }
  function update(dt, input) {
    if (!F) return;
    t += dt; if (!over) runTime += dt;
    appear = sstep(0, 1.5, runTime);
    if (!over) s = Math.min(s + SPEED * dt, rail.len);
    rail.at(s, rp); rail.frame(s, fr);
    const kk = 1 - Math.exp(-dt * 4);
    ox += (input.pilot.x * BOX_X - ox) * kk; oy += (input.pilot.y * BOX_Y - oy) * kk;
    clampOffset(rp, fr, ox, oy, o3); ox = o3[0]; oy = o3[1];
    cam[0] = rp[0] + fr[3] * ox + fr[6] * oy; cam[1] = rp[1] + fr[4] * ox + fr[7] * oy; cam[2] = rp[2] + fr[5] * ox + fr[8] * oy;
    rail.at(s + LOOK_AHEAD, tp); rail.at(s, tq);
    let tx = tp[0] - tq[0], ty = tp[1] - tq[1], tz = tp[2] - tq[2]; const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    if (s - s0 < 2) { tx = 0; ty = 0; tz = 1; } // open exactly on the concept view (yaw 0, pitch 0)
    if (bot && view) botAim(); else { aim.x = input.gunner.x; aim.y = input.gunner.y; aim.fire = input.gunner.fire; }
    const gx = aim.x, gy = aim.y, ramp = Math.min(1, runTime / 1.5);
    let axx = fr[0] + (fr[3] * gx * vasp + fr[6] * gy) * vtan, axy = fr[1] + (fr[4] * gx * vasp + fr[7] * gy) * vtan, axz = fr[2] + (fr[5] * gx * vasp + fr[8] * gy) * vtan;
    const al = Math.hypot(axx, axy, axz) || 1; axx /= al; axy /= al; axz /= al;
    const w = (bot ? 0 : LOOK_AIM) * ramp;
    const lx = tx * (1 - w) + axx * w, ly = ty * (1 - w) + axy * w, lz = tz * (1 - w) + axz * w;
    const lk = runTime < 1e-6 ? 1 : 1 - Math.exp(-dt * 4);
    look[0] += (lx - look[0]) * lk; look[1] += (ly - look[1]) * lk; look[2] += (lz - look[2]) * lk;
    const ll = Math.hypot(look[0], look[1], look[2]) || 1; look[0] /= ll; look[1] /= ll; look[2] /= ll;
    placeEye(dt);
    F[0] = eye[0]; F[1] = eye[1]; F[2] = eye[2];
    if (typeof FX !== 'undefined' && FX.shake > 0.001) { const j = FX.shake * 0.15; F[0] += (Math.random() - 0.5) * j; F[1] += (Math.random() - 0.5) * j; F[2] += (Math.random() - 0.5) * j; }
    F[3] = Math.atan2(look[0], look[2]); F[4] = Math.asin(Math.max(-1, Math.min(1, look[1]))); F[11] = FOV;

    // weapon: heat and cooldown
    const wpn = WEAPON[level - 1];
    heat = Math.max(0, heat - wpn.cool * dt); fireT -= dt;
    if (overheated && heat < HEAT_RESUME) { overheated = false; hud.event('cooled'); }
    if (!over && dt > 0 && aim.fire && !overheated && fireT <= 0) {
      fire(gx, gy); fireT = 1 / wpn.rate; heat += wpn.heat;
      if (heat >= 1) { heat = 1; overheated = true; hud.event('overheat'); }
    }
    // bubbles: a bright core with a ring of six small bubbles
    for (let k = 0; k < NBUB; k++) {
      const base = PB + k * BP;
      if (!bub.on[k]) { for (let j = 0; j < BP; j++) hidePt(base + j); continue; }
      const px = bub.p[k * 3], py = bub.p[k * 3 + 1], pz = bub.p[k * 3 + 2], vx = bub.v[k * 3] * dt, vy = bub.v[k * 3 + 1] * dt, vz = bub.v[k * 3 + 2] * dt, vv = vx * vx + vy * vy + vz * vz;
      let hit = -1;
      for (let i = 0; i < NT && vv > 0; i++) {
        if (T.state[i] !== 0) continue;
        const cx = T.pos[i * 3], cy = T.pos[i * 3 + 1], cz = T.pos[i * 3 + 2];
        const h = Math.max(0, Math.min(1, ((cx - px) * vx + (cy - py) * vy + (cz - pz) * vz) / vv));
        if (Math.hypot(px + vx * h - cx, py + vy * h - cy, pz + vz * h - cz) < bub.r[k] + T.r[i] * 0.6) { hit = i; break; }
      }
      bub.p[k * 3] = px + vx; bub.p[k * 3 + 1] = py + vy; bub.p[k * 3 + 2] = pz + vz; bub.life[k] -= dt;
      if (hit >= 0) { hitTarget(hit); bub.on[k] = 0; }
      else if (field(px + vx, py + vy, pz + vz) > 0) { sparks(px, py, pz, 0.7, 0.95, 1.0); bub.on[k] = 0; if (typeof FX !== 'undefined') FX.kick(0.05); }
      else if (bub.life[k] <= 0) bub.on[k] = 0;
      if (!bub.on[k]) { for (let j = 0; j < BP; j++) hidePt(base + j); continue; }
      const qx = bub.p[k * 3], qy = bub.p[k * 3 + 1], qz = bub.p[k * 3 + 2], sp = t * 5 + k;
      setPt(base, qx, qy, qz, 0.1, 1.4, 1.9, 2.0);
      for (let j = 1; j < BP; j++) { const an = sp + j * 1.047, rr = 0.2 + 0.05 * Math.sin(t * 9 + j); setPt(base + j, qx + vr[0] * Math.cos(an) * rr + vu[0] * Math.sin(an) * rr, qy + vr[1] * Math.cos(an) * rr + vu[1] * Math.sin(an) * rr, qz + vr[2] * Math.cos(an) * rr + vu[2] * Math.sin(an) * rr, 0.05, 0.6, 1.3, 1.5); }
    }
    // targets
    if (runTime > 0.4) meet('rbc'); // the concept's red cells are the first thing you meet
    // the tractor pulls to the ship: below and ahead of the eye in cockpit, onto the K1's deck in shoulder
    const tf = 1.6 - 1.3 * ve, tu = 0.6 - 0.75 * ve;
    const shx = cam[0] + vf[0] * tf - vu[0] * tu, shy = cam[1] + vf[1] * tf - vu[1] * tu, shz = cam[2] + vf[2] * tf - vu[2] * tu;
    for (let i = 0; i < NT; i++) {
      const k = T.kind[i], st = T.state[i], ahead = T.s[i] - s;
      if (st === 0 && ahead < 34 && ahead > -6 && runTime > 0.6) { // first meetings (facts)
        if (k === 0) meet('cell'); else if (k === 1) meet('rbc'); else if (k === 2) meet('platelet'); else if (k === 3) meet('bacterium'); else meet('virus');
      }
      if (k === 0) { // hungry cell: a slow "hungry" pulse; once fed it turns rosy and swells a little
        if (st === 0) { const pulse = 0.5 + 0.5 * Math.sin(t * 3 + T.ph[i] * 6.28); writeT(i, T.r[i] * (1 + 0.04 * pulse), 0, 0.12 * pulse); }
        else { T.tt[i] += dt; const e = sstep(0, 0.8, T.tt[i]); writeT(i, T.r[i] * (1 + 0.12 * e - 0.05 * sstep(0.8, 1.6, T.tt[i])), e, 0.25 * (1 - e)); }
      } else if (k === 1 || k === 2) {
        if (st === 0) { // gentle tumble and bob
          T.pos[i * 3 + 1] = T.base[i * 3 + 1] + Math.sin(t * 0.9 + T.ph[i] * 6) * 0.15;
          const glow = 0.1 * (0.5 + 0.5 * Math.sin(t * 4 + T.ph[i] * 6));
          writeT(i, T.r[i], 0, glow);
        } else if (st === 1) { // tractored to the ship
          T.tt[i] += dt; const e = sstep(0, TRACTOR_TIME, T.tt[i]), bx = T.base[i * 3], by = T.base[i * 3 + 1], bz = T.base[i * 3 + 2];
          T.pos[i * 3] = bx + (shx - bx) * e; T.pos[i * 3 + 1] = by + (shy - by) * e + Math.sin(e * 3.14) * 0.6; T.pos[i * 3 + 2] = bz + (shz - bz) * e;
          writeT(i, T.r[i] * (1 - sstep(0.6, 1, T.tt[i] / TRACTOR_TIME)), 0, 0.5);
          if (T.tt[i] >= TRACTOR_TIME) { T.state[i] = 2; writeT(i, 0, 0, 0); for (let b = 0; b < NBM; b++) if (beam.who[b] === i) beam.who[b] = -1; }
        } else if (st === 3) writeT(i, T.r[i], 1, 0);
      } else { // germs
        if (st === 0) {
          const v = T.victim[i];
          if (v >= 0 && T.state[v] === 0 && ahead < 40 && !over) { // drift toward the victim
            const dx = T.pos[v * 3] - T.pos[i * 3], dy = T.pos[v * 3 + 1] - T.pos[i * 3 + 1], dz = T.pos[v * 3 + 2] - T.pos[i * 3 + 2], d = Math.hypot(dx, dy, dz);
            if (d < T.r[v] + T.r[i] * 0.8) { T.state[v] = 3; sick++; hud.popup('Oh no, a germ got it', 0, -0.4, 'bad'); combo = 1; }
            else { const m = Math.min(d, GERM_SPEED * dt) / (d || 1); T.pos[i * 3] += dx * m; T.pos[i * 3 + 1] += dy * m; T.pos[i * 3 + 2] += dz * m; }
          } else T.pos[i * 3 + 1] = T.base[i * 3 + 1] + Math.sin(t * 1.3 + T.ph[i] * 6) * 0.2;
          sqa[0] = T.q[i * 4]; sqa[1] = T.q[i * 4 + 1]; sqa[2] = T.q[i * 4 + 2]; sqa[3] = T.q[i * 4 + 3]; qmul(sqa, qaxis(0.3, 1, 0.2, dt * 0.8, sqb), sq); { const l = Math.hypot(sq[0], sq[1], sq[2], sq[3]) || 1; sq[0] /= l; sq[1] /= l; sq[2] /= l; sq[3] /= l; } T.q[i * 4] = sq[0]; T.q[i * 4 + 1] = sq[1]; T.q[i * 4 + 2] = sq[2]; T.q[i * 4 + 3] = sq[3];
          writeT(i, T.r[i], 0, 0);
        } else if (st === 1) { // tagged: glows, waits for the white cell
          T.tt[i] += dt; writeT(i, T.r[i] * (1 - 0.3 * sstep(GULP_TIME * 0.7, GULP_TIME, T.tt[i])), 0, 0.6 + 0.4 * Math.sin(t * 12));
          if (T.tt[i] >= GULP_TIME) finishGulp(i);
        }
      }
    }
    // helper white cells: glide in from the wall, swallow, then drift back and fade
    for (let w2 = 0; w2 < NW; w2++) {
      const o = w2 * 12, a = mWbc.inst;
      if (!W.on[w2]) { if (a[o + 3] !== 0) { a[o + 3] = 0; mWbc.dirty = true; } continue; }
      W.tt[w2] += dt; const i = W.who[w2], tt = W.tt[w2];
      const gx2 = T.pos[i * 3], gy2 = T.pos[i * 3 + 1], gz2 = T.pos[i * 3 + 2], fx2 = W.from[w2 * 3], fy2 = W.from[w2 * 3 + 1], fz2 = W.from[w2 * 3 + 2];
      const e = tt < GULP_TIME ? sstep(0, GULP_TIME, tt) : 1 - sstep(GULP_TIME + 0.3, GULP_TIME + 1.6, tt);
      a[o] = fx2 + (gx2 - fx2) * e * 0.92; a[o + 1] = fy2 + (gy2 - fy2) * e * 0.92; a[o + 2] = fz2 + (gz2 - fz2) * e * 0.92;
      a[o + 3] = 1.0 * sstep(0, 0.35, tt) * (1 - sstep(GULP_TIME + 1.0, GULP_TIME + 1.6, tt));
      a[o + 7] = 1; a[o + 8] = 5; a[o + 9] = 0.33; a[o + 10] = 0; a[o + 11] = tt < GULP_TIME ? 0.12 : 0;
      mWbc.dirty = true;
      if (tt > GULP_TIME + 1.6) W.on[w2] = 0;
    }
    // tractor beams
    for (let b = 0; b < NBM; b++) {
      const i = beam.who[b], base = PBM + b * BMN;
      if (i < 0) { for (let j = 0; j < BMN; j++) hidePt(base + j); continue; }
      const cx = T.pos[i * 3], cy = T.pos[i * 3 + 1], cz = T.pos[i * 3 + 2];
      for (let j = 0; j < BMN; j++) { const u = (j + 0.5) / BMN, pulse = 0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.sin(u * 18 + t * 20), 4); setPt(base + j, shx + (cx - shx) * u, shy + (cy - shy) * u, shz + (cz - shz) * u, 0.06 + 0.04 * u, 0.5 * pulse, 1.3 * pulse, 1.1 * pulse); }
    }
    for (let k = 0; k < NS; k++) {
      if (spark.life[k] <= 0) { hidePt(PS + k); continue; }
      spark.life[k] -= dt; spark.p[k * 3] += spark.v[k * 3] * dt; spark.p[k * 3 + 1] += spark.v[k * 3 + 1] * dt; spark.p[k * 3 + 2] += spark.v[k * 3 + 2] * dt;
      const e = Math.max(0, spark.life[k] / 0.6);
      setPt(PS + k, spark.p[k * 3], spark.p[k * 3 + 1], spark.p[k * 3 + 2], 0.05 * e + 0.01, spark.c[k * 3] * e, spark.c[k * 3 + 1] * e, spark.c[k * 3 + 2] * e);
    }
    // static cells near the rail drift aside (none move in the opening second, so the run opens on the concept frame)
    const part = sstep(0, 1.5, runTime);
    for (let d = 0; d < decor.length; d++) {
      const D = decor[d], ah = D.s - s, m = D.push * part * sstep(16, 5, ah) * (ah > -8 ? 1 : sstep(-30, -8, ah));
      D.a[D.o] = D.x + D.nx * m; D.a[D.o + 1] = D.y + D.ny * m; D.a[D.o + 2] = D.z + D.nz * m; D.m.dirty = true;
    }
    if (runTime > 9) meet('wbc');
    stepFacts(dt);
    updateShip(dt);
    // depth of field: rack focus to the aimed distance (shorter aperture than the hero still, so play stays readable)
    focusRack(dt);
    // the end: the hungry tissue patch at the end of the capillary
    if (!over && s >= rail.len - 1e-3) {
      over = true; hideFact(); writeStats();
      hud.event('win');
      hud.results({ title: 'Micro Mission complete', lines: [['Cells fed', fed + ' / ' + NH], ['Cells kept safe', saved + ' / ' + NG], ['Germs caught', tagged + ' / ' + (NB + NV)], ['Score', String(score)], ['Time', runTime.toFixed(1) + ' s'], ['Bubble level', 'L' + level]] }, againFn);
    }
    writeStats();
  }
  const againFn = () => reset();
  let focus = 10.5;
  function focusRack(dt) {
    let want = 10.5;
    if (runTime > 1.0) { // the nearest waiting target near the aim (seen from the eye), else 11 m
      let best = 1e9; want = 11;
      for (let i = 0; i < NT; i++) { if (T.state[i] !== 0) continue; const dx = T.pos[i * 3] - eye[0], dy = T.pos[i * 3 + 1] - eye[1], dz = T.pos[i * 3 + 2] - eye[2], d = dx * vf[0] + dy * vf[1] + dz * vf[2]; if (d < 3 || d > 30) continue; const lx = (dx * vr[0] + dz * vr[2]) / (d * vtan * vasp) - aim.x, ly = (dx * vu[0] + dy * vu[1] + dz * vu[2]) / (d * vtan) - aim.y, e = lx * lx + ly * ly; if (e < 0.08 && e < best) { best = e; want = d; } }
    }
    focus += (want - focus) * (runTime < 1e-6 ? 1 : 1 - Math.exp(-dt * 3));
    const ap = runTime < 1e-6 ? 1 : 1 - 0.45 * sstep(0, 2, runTime); // the hero still keeps the full source blur; play uses about half
    // shoulder: widen the sharp band so it holds both the ship and the aimed distance (cockpit unchanged)
    const lo = Math.min(focus, shipDist - 0.7), hi = Math.max(focus, shipDist + 0.7), rg0 = SC.dof && SC.dof.range != null ? SC.dof.range : 1;
    const fo = focus + ((lo + hi) / 2 - focus) * ve, rg = rg0 + (Math.max(rg0, (hi - lo) / 2) - rg0) * ve;
    if (SC.p1) { SC.p1[0] = fo; if (MICRO_DOF_FALLBACK) SC.p1[1] = 30 * ap * (1 - 0.6 * ve); SC.p1[2] = runTime < 1e-6 ? 0 : 1 - 0.72 * sstep(0, 3, runTime); }
    if (G.dof) { G.dof.focus = fo; G.dof.range = rg; G.dof.maxBlur = SC.dof.maxBlur * ap; }
  }

  // view (VIEW.md): blend cockpit <-> shoulder over VIEW_BLEND, place the eye (clamped inside the vessel like the pilot)
  const eyeAt = (k) => field(cam[0] + (deye[0] - cam[0]) * k, cam[1] + (deye[1] - cam[1]) * k, cam[2] + (deye[2] - cam[2]) * k);
  function placeEye(dt) {
    const want = viewWant();
    if (dt > 0 && vbl !== want) vbl = want > vbl ? Math.min(1, vbl + dt / VIEW_BLEND) : Math.max(0, vbl - dt / VIEW_BLEND);
    vb = sstep(0, 1, vbl); ve = vb * sstep(0.3, 3.0, runTime); // the menu and ?shot frames stay the concept (cockpit) view
    // look basis (the engine's: r = (cos yaw, 0, -sin yaw), u = f x r)
    ef[0] = look[0]; ef[1] = look[1]; ef[2] = look[2];
    const hl = Math.hypot(ef[0], ef[2]) || 1; er[0] = ef[2] / hl; er[1] = 0; er[2] = -ef[0] / hl;
    eu[0] = ef[1] * er[2] - ef[2] * er[1]; eu[1] = ef[2] * er[0] - ef[0] * er[2]; eu[2] = ef[0] * er[1] - ef[1] * er[0];
    // keep the ship off the reticle: when the aim drops toward the ship's height, widen the right offset (ship slides left)
    if (dt > 0) {
      const rx = aim.x * SH_BACK * vtan * vasp, ry = aim.y * SH_BACK * vtan, k = sstep(-0.15, -0.6, ry);
      const tgt = SH_RIGHT + (Math.min(4.2, Math.max(SH_RIGHT, 1.3 - rx)) - SH_RIGHT) * k;
      side += (tgt - side) * (1 - Math.exp(-dt * 8));
    }
    const bk = SH_BACK * ve, up = SH_UP * ve, rt = side * ve;
    deye[0] = cam[0] - ef[0] * bk + er[0] * rt + eu[0] * up; deye[1] = cam[1] - ef[1] * bk + er[1] * rt + eu[1] * up; deye[2] = cam[2] - ef[2] * bk + er[2] * rt + eu[2] * up;
    // the same wall clearance as the pilot offset (CLEAR_CAM), along the segment from the ship to the wanted eye
    let k = 1;
    if (ve > 0 && eyeAt(1) > -CLEAR_CAM) { let lo = 0, hi = 1; for (let i = 0; i < 7; i++) { const m = (lo + hi) / 2; if (eyeAt(m) <= -CLEAR_CAM) lo = m; else hi = m; } k = lo; }
    eye[0] = cam[0] + (deye[0] - cam[0]) * k; eye[1] = cam[1] + (deye[1] - cam[1]) * k; eye[2] = cam[2] + (deye[2] - cam[2]) * k;
  }

  // the concept ship (K1) becomes the player's ship: it lifts off the fold to the pilot position. Cockpit: the camera flies
  // into it and it is hidden; shoulder: it stays there, facing the look direction and banking with the steering.
  function updateShip(dt) {
    const fx = ef[0], fy = ef[1], fz = ef[2];
    if (dt > 0) { const dvx = (ox - pox) / dt; pox = ox; shipRoll += (Math.max(-0.6, Math.min(0.6, -dvx * 0.15)) - shipRoll) * (1 - Math.exp(-dt * 5)); }
    // the ship's nose is local +x: yaw so +x points along the look, pitch about local z, bank about local x
    qaxis(0, 1, 0, Math.atan2(fx, fz) - Math.PI / 2, sqa); qaxis(0, 0, 1, Math.asin(Math.max(-1, Math.min(1, fy))), sqb); qmul(sqa, sqb, sq);
    qmul(sq, qaxis(1, 0, 0, shipRoll + 0.04 * Math.sin(t * 1.3), sqb), sq);
    spos[0] = cam[0]; spos[1] = cam[1] + Math.sin(t * 1.7) * 0.04 * ve; spos[2] = cam[2];
    const b = sstep(0.3, 3.0, runTime), B = shipBase, dot = B.q[0] * sq[0] + B.q[1] * sq[1] + B.q[2] * sq[2] + B.q[3] * sq[3], sg = dot < 0 ? -1 : 1;
    let qx = B.q[0] + (sq[0] * sg - B.q[0]) * b, qy = B.q[1] + (sq[1] * sg - B.q[1]) * b, qz = B.q[2] + (sq[2] * sg - B.q[2]) * b, qq = B.q[3] + (sq[3] * sg - B.q[3]) * b;
    const ql = Math.hypot(qx, qy, qz, qq) || 1; qx /= ql; qy /= ql; qz /= ql; qq /= ql;
    const px = B.pos[0] + (spos[0] - B.pos[0]) * b, py = B.pos[1] + (spos[1] - B.pos[1]) * b + Math.sin(b * Math.PI) * 0.8, pz = B.pos[2] + (spos[2] - B.pos[2]) * b;
    const cd = Math.hypot(eye[0] - px, eye[1] - py, eye[2] - pz);
    shipDist = (px - eye[0]) * ef[0] + (py - eye[1]) * ef[1] + (pz - eye[2]) * ef[2];
    shipVis = Math.max(sstep(0.25, 0.75, ve), sstep(1.6, 3.4, cd)); // hidden in cockpit once the camera is in it
    for (const m of shipParts) { const a = m.inst; a[0] = px; a[1] = py; a[2] = pz; a[3] = shipVis; a[4] = qx; a[5] = qy; a[6] = qz; a[7] = qq; m.dirty = true; }
  }

  // ---------------------------------------------------------------- post: HUD feeds
  function post(v) {
    view = v; F = v.F;
    vf[0] = v.f[0]; vf[1] = v.f[1]; vf[2] = v.f[2]; vr[0] = v.r[0]; vr[1] = v.r[1]; vr[2] = v.r[2]; vu[0] = v.u[0]; vu[1] = v.u[1]; vu[2] = v.u[2]; vtan = v.tan; vasp = v.aspect;
    const cx = cam[0], cy = cam[1], cz = cam[2]; // distances and radar from the ship; screen marks via the camera (v.project)
    let nm = 0, nb = 0;
    for (let i = 0; i < NT; i++) {
      if (T.state[i] !== 0) continue;
      const x = T.pos[i * 3], y = T.pos[i * 3 + 1], z = T.pos[i * 3 + 2], dx = x - cx, dy = y - cy, dz = z - cz, d = Math.hypot(dx, dy, dz);
      if (d > 45) continue;
      const k = T.kind[i], bk = k === 0 ? 0 : k <= 2 ? 1 : 2;
      blips[nb * 4] = dx * vr[0] + dz * vr[2]; blips[nb * 4 + 1] = dx * vu[0] + dy * vu[1] + dz * vu[2]; blips[nb * 4 + 2] = dx * vf[0] + dy * vf[1] + dz * vf[2]; blips[nb * 4 + 3] = bk; nb++;
      if (nm < 12 && d < 30) {
        v.project(x, y, z, o3);
        // marks: hungry = target (0), good cell in danger = friend (1), germ = danger (2)
        const threatened = (k === 1 || k === 2);
        marks[nm * 6] = o3[0]; marks[nm * 6 + 1] = o3[1]; marks[nm * 6 + 2] = o3[2]; marks[nm * 6 + 3] = bk; marks[nm * 6 + 4] = d; marks[nm * 6 + 5] = k === 0 ? LAB.hungry : k === 1 ? LAB.rbc : k === 2 ? LAB.platelet : k === 3 ? LAB.bacterium : LAB.virus; nm++;
        if (threatened) { /* the friend bracket reads as "help this one" */ }
      }
    }
    { const dx = endP[0] - cx, dy = endP[1] - cy, dz = endP[2] - cz, d = Math.hypot(dx, dy, dz);
      blips[nb * 4] = dx * vr[0] + dz * vr[2]; blips[nb * 4 + 1] = dx * vu[0] + dy * vu[1] + dz * vu[2]; blips[nb * 4 + 2] = dx * vf[0] + dy * vf[1] + dz * vf[2]; blips[nb * 4 + 3] = 1; nb++; }
    hud.marks(marks, nm); hud.blips(blips, nb);
    hud.set(stats);
  }

  return {
    id: 'body-micro', title: 'Micro Mission', skin: 'visor', palette: 'Mint',
    prepare(scene) { SC = scene; if (scene.p1) scene.p1[3] = 1; }, // ghost rail on; p1.x/y are the DOF focus and fallback strength
    init, update, post, reset,
  };
})();
