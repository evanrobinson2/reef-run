// ============================================================================
// bodytoy-game.js: Body Defenders: Gooey Run. A rail run down the BD-1.0 vessel (bodytoy.js). You fly the concept's
// marshmallow-robot ship (VIEW.md: cockpit by default, the camera is the ship and its model is hidden; V switches to over the
// right shoulder, the ship lower-left so the reticle stays clear) and blast grumpy germs off the walls and out of the stream.
// Red nubbed "gummy cells" are friendly (DECOMPOSITION section 8): shots only wobble them; bumping one costs the combo.
// The run opens on the concept's exact view; the ship turns around and the camera flies into it (cockpit) or over its right
// shoulder. Germs pop with a green FX.splat. Finale: the King Germ.
// Follows GAME_API.md / BODY_GAMES.md. Load-time allocation only; update() and post() reuse preallocated arrays.
// ============================================================================
const GAME = (() => {
  // ---------------------------------------------------------------- tuning (data)
  const SPEED = 8.0;                 // m/s along the rail (about 50 s of tunnel)
  const BOX_X = 2.6, BOX_Y = 2.0;    // pilot offset box (m)
  const SHIP_CLEAR = 1.3, CAM_CLEAR = 0.7;
  const BACK = 4.6, CAMX = 0.9, CAMY = 1.3;   // shoulder camera (VIEW.md): behind, right and above the pilot (ship lower-left)
  const SEAT = 0.85;                 // the pilot sits in the glass dome: the ship model's origin is this far below the pilot
  const VIEW_BLEND = 0.35;           // seconds to switch cockpit <-> shoulder
  const FOV_PLAY = 56 * Math.PI / 180;
  const LOOK_AIM = 0.15, LOOK_AHEAD = 8;
  const COMBO_WINDOW = 3.0, COMBO_MAX = 8;
  const PTS_WALL = 100, PTS_STREAM = 150, PTS_KING = 2000;
  const XP_POP = 60;
  const KING_HP = 45, BOSS_MAX = 15;  // seconds the King Germ stays before it wriggles away
  const STREAM_FLOW = 3.0;            // m/s: the cells drift with the blood flow
  // weapon levels (GAME_API): shop upgrades can later write to this table
  const WEAPON = [
    { xp: 0, name: 'Goo Blaster', rate: 5.0, heat: 0.10, cool: 0.30, dmg: 1.0, radius: 0.55, speed: 55, twin: false, spread: 0 },
    { xp: 300, name: 'Goo Blaster+', rate: 5.5, heat: 0.09, cool: 0.36, dmg: 1.2, radius: 0.65, speed: 60, twin: false, spread: 0 },
    { xp: 800, name: 'Twin Goo', rate: 6.0, heat: 0.085, cool: 0.42, dmg: 1.3, radius: 0.7, speed: 64, twin: true, spread: 0 },
    { xp: 1500, name: 'Twin Goo+', rate: 6.5, heat: 0.08, cool: 0.50, dmg: 1.5, radius: 0.8, speed: 68, twin: true, spread: 0.02 },
    { xp: 2500, name: 'Bubble Storm', rate: 7.5, heat: 0.075, cool: 0.60, dmg: 1.8, radius: 0.9, speed: 72, twin: true, spread: 0.035 },
  ];
  const HEAT_RESUME = 0.35;
  const WORDS = ['SPLAT!', 'POP!', 'SPLOOSH!', 'GLOOP!', 'SPLAT!'];

  // ---------------------------------------------------------------- state
  let G = null, hud = null, field = null, rail = null, F = null, view = null, V = null, germ = null, cells = null;
  let s0 = 0, sEnd = 0, s = 0, ox = 0, oy = 0, vox = 0, voy = 0, ox0 = 0, oy0 = 0, t = 0, runTime = 0, over = false, overT = 0;
  let heat = 0, overheated = false, fireT = 0, level = 1, xp = 0, score = 0, combo = 1, comboT = 0, bestCombo = 1, popped = 0, missed = 0, bonks = 0;
  let bossT = 0, kingHp = KING_HP, kingDone = 0; // kingDone: 0 alive, 1 splatted, 2 got away
  const stats = { score: 0, combo: 1, time: 0, level: 1, xp: 0, xpNext: 300, heat: 0, overheated: false, weaponName: WEAPON[0].name, counterLabel: 'Germs', counterValue: 0, counterMax: 0 };
  const fr = new Float64Array(9), frc = new Float64Array(9), rp = [0, 0, 0], rc = [0, 0, 0], tp = [0, 0, 0], tq = [0, 0, 0], o3 = [0, 0, 0], cam = [0, 0, 0], look = [0, 0, 1], ship = [0, 0, 0];
  const vf = [0, 0, 1], vr = [1, 0, 0], vu = [0, 1, 0]; let vtan = Math.tan(FOV_PLAY / 2), vasp = 1.6;
  const heroShip = [0, 0, 0], heroEuler = [-2.45, -0.3, -0.36]; let heroCam = null;
  const sq = [0, 0, 0, 1], qa = [0, 0, 0, 1], qb = [0, 0, 0, 1], gq = [0, 0, 0, 1];
  let shipParts = [], SH = null, vbl = 0, vb = 0, shipVis = 1; // vbl: 0 cockpit .. 1 shoulder (linear), vb: eased
  const mdl = [0, 0, 0]; // the ship model's origin (pilot position minus the seat height)
  const viewWant = () => (SH && SH.view === 'shoulder' ? 1 : 0);
  // germs (scene pool): kind 0 wall, 1 stream, 2 king; state 0 hidden, 1 alive, 2 popping, 3 missed
  let NG = 0, KING = 0;
  let gx, gy, gz, gr, ghp, gst, gkind, gyaw, gpit, gph, gwob, gsmile, gcol, gpop;
  // stream cells (scene pool) + the scene's static cells (for collisions and wobble)
  let CF = 0, CN = 0, NSTAT = 0, CI = null, NI = null;
  let crad = null, cwob = null, HERO_CELLS = 0;
  // points: [ghost][bolts NB*BP][sparks NS]
  const NB = 28, BP = 6, NS = 64;
  let PB = 0, PS = 0, PEND = 0;
  const bolt = { on: new Uint8Array(NB), p: new Float32Array(NB * 3), v: new Float32Array(NB * 3), life: new Float32Array(NB), r: new Float32Array(NB) };
  const spark = { p: new Float32Array(NS * 3), v: new Float32Array(NS * 3), life: new Float32Array(NS), c: new Float32Array(NS * 3) }; let sparkNext = 0;
  const marks = new Float32Array(64 * 6), blips = new Float32Array(64 * 4);
  const debug = { auto: false };
  const PLAYSHOT = typeof QS !== 'undefined' && QS.has('playshot') ? +QS.get('playshot') : 0;

  let seed = 4421;
  const rand = () => { seed = (seed + 0x6D2B79F5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  const sst = (a, b, x) => { x = Math.min(1, Math.max(0, (x - a) / (b - a))); return x * x * (3 - 2 * x); };
  const fxOn = () => typeof FX !== 'undefined' && FX.enabled;
  // quaternion helpers (no allocation)
  const qmul = (a, b, o) => { const x = a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], y = a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], z = a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], w = a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]; o[0] = x; o[1] = y; o[2] = z; o[3] = w; return o; };
  const euler = (yw, pt, rl, o) => { // Y(yaw) * X(pitch) * Z(roll), as the scene builds the ship pose
    qa[0] = 0; qa[1] = Math.sin(yw / 2); qa[2] = 0; qa[3] = Math.cos(yw / 2);
    qb[0] = Math.sin(pt / 2); qb[1] = 0; qb[2] = 0; qb[3] = Math.cos(pt / 2); qmul(qa, qb, o);
    qb[0] = 0; qb[1] = 0; qb[2] = Math.sin(rl / 2); qb[3] = Math.cos(rl / 2); return qmul(o, qb, o); };
  const qrot = (q, x, y, z, o) => { const tx = 2 * (q[1] * z - q[2] * y), ty = 2 * (q[2] * x - q[0] * z), tz = 2 * (q[0] * y - q[1] * x);
    o[0] = x + q[3] * tx + q[1] * tz - q[2] * ty; o[1] = y + q[3] * ty + q[2] * tx - q[0] * tz; o[2] = z + q[3] * tz + q[0] * ty - q[1] * tx; return o; };

  // largest fraction of an offset (x right, y up) from rail point p that keeps the point `clear` metres inside the vessel
  function clampOffset(p, f9, x, y, clear, o) {
    const at = (k) => field(p[0] + (f9[3] * x + f9[6] * y) * k, p[1] + (f9[4] * x + f9[7] * y) * k, p[2] + (f9[5] * x + f9[8] * y) * k);
    let k = 1;
    if (at(1) > -clear) { let lo = 0, hi = 1; for (let i = 0; i < 7; i++) { const m = (lo + hi) / 2; if (at(m) <= -clear) lo = m; else hi = m; } k = lo; }
    o[0] = x * k; o[1] = y * k; return o;
  }

  // ---------------------------------------------------------------- rail along the vessel centreline
  function buildRail() {
    const ctrl = []; const Vz = V.zChamber - 14;
    for (let z = -4; z <= Vz + 1e-6; z += 4) ctrl.push([V.cx(z), V.cy(z), z]);
    rail = makeRail(ctrl, 0.5);
    // the ship's start station: the arc length where the rail reaches the concept ship's depth
    let best = 1e9; const p = [0, 0, 0];
    for (let q = 0; q <= 40; q += 0.01) { rail.at(q, p); const d = Math.abs(p[2] - heroShip[2]); if (d < best) { best = d; s0 = q; } }
    sEnd = rail.len;
    rail.at(s0, p); rail.frame(s0, fr);
    const dx = heroShip[0] - p[0], dy = heroShip[1] - p[1], dz = heroShip[2] - p[2];
    ox0 = dx * fr[3] + dy * fr[4] + dz * fr[5]; oy0 = dx * fr[6] + dy * fr[7] + dz * fr[8];
  }

  // ---------------------------------------------------------------- germs
  function placeGerms() {
    const N = NG - 3; // slots 0,1 are the hero viruses (BT-V1/V2), the last is the King Germ
    for (let k = 0; k < N; k++) {
      const i = k + 2, sAt = s0 + 18 + (sEnd - 40 - s0 - 18) * (k + 0.5 + (rand() - 0.5) * 0.7) / N;
      rail.at(sAt, rp); const z = rp[2], cx = V.cx(z), cy = V.cy(z), R = V.R0(z);
      const big = rand() < 0.2, r = big ? 1.0 : 0.55 + rand() * 0.2, th = rand() * Math.PI * 2;
      gkind[i] = rand() < 0.55 ? 0 : 1; gr[i] = r; ghp[i] = big ? 3 : 1;
      if (gkind[i] === 0) { // on the wall, sunk a little, facing the vessel's axis
        const rho = R - 0.25 - r * 0.55;
        gx[i] = cx + Math.cos(th) * rho; gy[i] = cy + Math.sin(th) * rho; gz[i] = z;
        const dx = -Math.cos(th), dy = -Math.sin(th), dz = -0.35, dl = Math.hypot(dx, dy, dz); // face the axis, a little toward the ship
        gyaw[i] = Math.atan2(dx, dz); gpit[i] = -Math.asin(dy / dl);
      } else { // in the stream
        const rho = 0.8 + rand() * (R - r * 1.6 - 1.8);
        gx[i] = cx + Math.cos(th) * rho; gy[i] = cy + Math.sin(th) * rho; gz[i] = z + 6;
      }
      gph[i] = rand() * 6.28; gsmile[i] = 0; gcol[i] = rand() < 0.5 ? 0 : 1;
    }
    // King Germ in the finale chamber (P)
    const zk = V.zChamber + 3; KING = NG - 1;
    gx[KING] = V.cx(zk); gy[KING] = V.cy(zk) + 0.3; gz[KING] = zk; gr[KING] = 3.0; gkind[KING] = 2; ghp[KING] = KING_HP; gsmile[KING] = 0; gcol[KING] = 0; gph[KING] = 0;
  }
  const base = new Float32Array(56 * 3); // germ base positions (stream germs drift from here)
  let GM = null; // the five germ meshes (body, stalks, eyes, smile, frown)
  function writeGerm(i, sc, q) {
    const o = i * 12;
    for (let j = 0; j < 5; j++) {
      const m = GM[j], a = m.inst, show = j === 3 ? gsmile[i] : j === 4 ? 1 - gsmile[i] : 1;
      a[o] = gx[i]; a[o + 1] = gy[i]; a[o + 2] = gz[i]; a[o + 3] = sc * show; a[o + 4] = q[0]; a[o + 5] = q[1]; a[o + 6] = q[2]; a[o + 7] = q[3]; m.dirty = true;
    }
  }
  function colourGerm(i) {
    const c = gcol[i] ? germ.colours.MINT : germ.colours.GREEN_FAR;
    const DARK = [0.13, 0.03, 0.05], MOUTH = [0.86, 0.36, 0.38]; // load time only
    for (let j = 0; j < 5; j++) { const m = GM[j], a = m.inst, o = i * 12, cc = j < 2 ? c : j === 3 ? MOUTH : DARK; a[o + 8] = j < 2 ? 4 : 3; a[o + 9] = cc[0]; a[o + 10] = cc[1]; a[o + 11] = cc[2]; m.dirty = true; }
  }

  // ---------------------------------------------------------------- points
  const setPt = (k, x, y, z, size, r, g, b) => { const a = G.points, o = k * 8; a[o] = x; a[o + 1] = y; a[o + 2] = z; a[o + 3] = size; a[o + 4] = r; a[o + 5] = g; a[o + 6] = b; a[o + 7] = 0; };
  const hidePt = (k) => { G.points[k * 8 + 3] = 0; };
  function sparks(x, y, z, n, r, g, b, spd) {
    for (let i = 0; i < n; i++) {
      const k = sparkNext; sparkNext = (sparkNext + 1) % NS;
      spark.p[k * 3] = x; spark.p[k * 3 + 1] = y; spark.p[k * 3 + 2] = z;
      const a = rand() * 6.283, bb = rand() * 2 - 1, c = Math.sqrt(1 - bb * bb), sp = spd * (0.5 + rand());
      spark.v[k * 3] = Math.cos(a) * c * sp; spark.v[k * 3 + 1] = bb * sp; spark.v[k * 3 + 2] = Math.sin(a) * c * sp; spark.life[k] = 0.4;
      spark.c[k * 3] = r; spark.c[k * 3 + 1] = g; spark.c[k * 3 + 2] = b;
    }
  }

  // ---------------------------------------------------------------- init
  function init(g, Shell) {
    G = g; SH = Shell; hud = Shell.hud; V = G.vessel; germ = G.germ; cells = G.cells;
    field = G.field;
    shipParts = G.meshes.filter((m) => m.shipPart);
    heroShip[0] = G.ship.pos[0]; heroShip[1] = G.ship.pos[1]; heroShip[2] = G.ship.pos[2];
    heroCam = G.poses[0];
    NG = germ.n; GM = [germ.body, germ.stalk, germ.eyes, germ.smile, germ.frown];
    gx = new Float32Array(NG); gy = new Float32Array(NG); gz = new Float32Array(NG); gr = new Float32Array(NG); ghp = new Float32Array(NG); gst = new Uint8Array(NG);
    gkind = new Uint8Array(NG); gyaw = new Float32Array(NG); gpit = new Float32Array(NG); gph = new Float32Array(NG); gwob = new Float32Array(NG); gsmile = new Uint8Array(NG); gcol = new Uint8Array(NG); gpop = new Float32Array(NG);
    buildRail();
    // hero viruses: read their scene pose (BT-V1, BT-V2)
    for (let i = 0; i < germ.heroN; i++) {
      const a = germ.body.inst, o = i * 12; gx[i] = a[o]; gy[i] = a[o + 1]; gz[i] = a[o + 2]; gr[i] = a[o + 3]; gkind[i] = i === 1 ? 0 : 1; ghp[i] = 1; gsmile[i] = germ.smile.inst[o + 3] > 0 ? 1 : 0; gcol[i] = i === 1 ? 1 : 0;
      const q = [a[o + 4], a[o + 5], a[o + 6], a[o + 7]]; // load time
      const fx = qrot(q, 0, 0, 1, [0, 0, 0]); gyaw[i] = Math.atan2(fx[0], fx[2]); gpit[i] = -Math.asin(Math.max(-1, Math.min(1, fx[1])));
      gph[i] = i * 2.1;
    }
    placeGerms();
    for (let i = 0; i < NG; i++) { base[i * 3] = gx[i]; base[i * 3 + 1] = gy[i]; base[i * 3 + 2] = gz[i]; colourGerm(i); }
    stats.counterMax = NG;
    // cells: the stream pool and the static ones (for wobble and bumps)
    CI = cells.ball.inst; NI = cells.nub.inst; CF = cells.first; CN = cells.n; NSTAT = cells.first; HERO_CELLS = cells.heroN;
    crad = new Float32Array(CF + CN); cwob = new Float32Array(CF + CN); for (let c = 0; c < CF; c++) crad[c] = CI[c * 12 + 3];
    // points: scene points, then the ghost rail, then the dynamic pools
    const ghost = rail.ghost(0.6, 0.05, [0.6, 1.15, 1.25]);
    const n0 = G.points.length / 8, ng = ghost.length / 8;
    PB = n0 + ng; PS = PB + NB * BP; PEND = PS + NS;
    const pts = new Float32Array(PEND * 8); pts.set(G.points); pts.set(ghost, n0 * 8);
    G.points = pts; G.dynPts = [PB, PEND - PB];
    hud.labels = ['King Germ'];
    if (typeof QS !== 'undefined' && QS.has('debug')) window.bodyToy = GAME;
    GAME.debug = { rail, debug, germs: () => Array.from({ length: NG }, (_, i) => [i, gst[i], gkind[i], +gx[i].toFixed(1), +gy[i].toFixed(1), +gz[i].toFixed(1), +gr[i].toFixed(2)]), inst: () => germ.body.inst, get s() { return s; }, set s(v) { s = v; }, s0: () => s0, sEnd: () => sEnd, WEAPON,
      get state() { return { s, s0, sEnd, runTime, over, score, combo, bestCombo, popped, missed, bonks, level, xp, heat, overheated, kingHp, kingDone, bossT, view: SH ? SH.view : 'cockpit', viewBlend: vb, shipVis, cam: cam.slice(), ship: ship.slice() }; } };
    reset();
  }

  // ---------------------------------------------------------------- reset (also Play again)
  function reset() {
    s = s0; ox = ox0; oy = oy0; vox = voy = 0; t = 0; runTime = 0; over = false; overT = 0;
    heat = 0; overheated = false; fireT = 0; level = 1; xp = 0; score = 0; combo = 1; comboT = 0; bestCombo = 1; popped = 0; missed = 0; bonks = 0;
    bossT = 0; kingHp = KING_HP; kingDone = 0;
    for (let i = 0; i < NG; i++) { gx[i] = base[i * 3]; gy[i] = base[i * 3 + 1]; gz[i] = base[i * 3 + 2]; gst[i] = 1; gwob[i] = 0; gpop[i] = 0; ghp[i] = i === KING ? KING_HP : gr[i] >= 0.95 && i >= 2 ? 3 : 1; }
    // stream cells start spread ahead of the ship
    for (let i = 0; i < CN; i++) spawnCell(i, heroShip[2] + 70 + i * 2.5); // beyond the hero's haze: the opening view stays the concept's
    for (let c = 0; c < CF; c++) { if (cwob[c] > 0) { CI[c * 12 + 3] = NI[c * 12 + 3] = crad[c]; } } cwob.fill(0);
    bolt.on.fill(0); spark.life.fill(0);
    for (let k = PB; k < PEND; k++) hidePt(k);
    rail.tan(s0, look);
    vbl = vb = viewWant();
    writeStats();
  }
  function spawnCell(i, z) {
    const k = (CF + i) * 12, R = V.R0(z), th = rand() * 6.283, rad = 0.45 + rand() * 0.45, rho = 1.2 + rand() * Math.max(0.2, R - rad - 2.0);
    crad[CF + i] = rad; cwob[CF + i] = 0;
    CI[k] = V.cx(z) + Math.cos(th) * rho; CI[k + 1] = V.cy(z) + Math.sin(th) * rho; CI[k + 2] = z; CI[k + 3] = rad;
    let qx = rand() - 0.5, qy = rand() - 0.5, qz = rand() - 0.5, qw = 1; const l = Math.hypot(qx, qy, qz, qw); qx /= l; qy /= l; qz /= l; qw /= l;
    CI[k + 4] = qx; CI[k + 5] = qy; CI[k + 6] = qz; CI[k + 7] = qw;
    for (let c = 0; c < 8; c++) NI[k + c] = CI[k + c];
    cells.ball.dirty = cells.nub.dirty = true;
  }

  function writeStats() {
    const w = WEAPON[level - 1];
    stats.score = score; stats.combo = combo; stats.time = runTime; stats.level = level; stats.xp = xp;
    stats.xpNext = level < WEAPON.length ? WEAPON[level].xp : WEAPON[WEAPON.length - 1].xp;
    stats.heat = heat; stats.overheated = overheated; stats.counterValue = popped; stats.weaponName = w.name;
  }

  // ---------------------------------------------------------------- firing
  function fire(ax, ay) {
    const w = WEAPON[level - 1];
    // aim ray from the camera; aim point = first wall along it (or 60 m)
    let dx = vf[0] + (vr[0] * ax * vasp + vu[0] * ay) * vtan, dy = vf[1] + (vr[1] * ax * vasp + vu[1] * ay) * vtan, dz = vf[2] + (vr[2] * ax * vasp + vu[2] * ay) * vtan;
    const dl = Math.hypot(dx, dy, dz); dx /= dl; dy /= dl; dz /= dl;
    let D = 60; for (let m = 2; m < 60; m += 0.8) if (field(cam[0] + dx * m, cam[1] + dy * m, cam[2] + dz * m) > 0) { D = m; break; }
    const tx = cam[0] + dx * D, ty = cam[1] + dy * D, tz = cam[2] + dz * D;
    for (let b = 0; b < (w.twin ? 2 : 1); b++) {
      let k = -1; for (let j = 0; j < NB; j++) if (!bolt.on[j]) { k = j; break; }
      if (k < 0) return;
      // muzzle: shoulder view, the pink cone (BT-K1g) or the claw for the twin shot; cockpit, just under the pilot
      // (twin shots left and right of it). Both start at the ship and fly at the aim point.
      qrot(sq, b ? 1.44 : -1.36, -0.04, b ? 0.25 : 0.12, o3);
      const lat = w.twin ? (b ? 0.45 : -0.45) : 0, c = 1 - vb;
      const px = (mdl[0] + o3[0]) * vb + (ship[0] + vr[0] * lat - vu[0] * 0.4) * c,
        py = (mdl[1] + o3[1]) * vb + (ship[1] + vr[1] * lat - vu[1] * 0.4) * c,
        pz = (mdl[2] + o3[2]) * vb + (ship[2] + vr[2] * lat - vu[2] * 0.4) * c;
      let ex = tx - px + (rand() - 0.5) * w.spread * D, ey = ty - py + (rand() - 0.5) * w.spread * D, ez = tz - pz; const el = Math.hypot(ex, ey, ez) || 1;
      bolt.on[k] = 1; bolt.life[k] = 1.1; bolt.r[k] = w.radius;
      bolt.p[k * 3] = px; bolt.p[k * 3 + 1] = py; bolt.p[k * 3 + 2] = pz;
      bolt.v[k * 3] = ex / el * w.speed; bolt.v[k * 3 + 1] = ey / el * w.speed; bolt.v[k * 3 + 2] = ez / el * w.speed;
    }
    hud.event('fire');
  }
  function popGerm(i) {
    const king = i === KING;
    gst[i] = 2; gpop[i] = 0;
    comboT = COMBO_WINDOW; combo = Math.min(COMBO_MAX, combo + (popped > 0 ? 1 : 0)); bestCombo = Math.max(bestCombo, combo);
    const pts = (king ? PTS_KING : gkind[i] === 0 ? PTS_WALL : PTS_STREAM) * (gr[i] >= 0.95 && !king ? 2 : 1) * combo;
    score += pts; popped++; xp += king ? 0 : XP_POP * (gr[i] >= 0.95 ? 2 : 1);
    if (view) view.project(gx[i], gy[i] + gr[i], gz[i], o3); else { o3[0] = 0; o3[1] = 0; }
    hud.popup('+' + pts + (combo > 1 ? ' ×' + combo : ''), o3[0], o3[1], 'good');
    hud.event('destroy');
    if (fxOn()) {
      if (king) { FX.splat(gx[i], gy[i], gz[i], { scale: 3.2, text: 'SPLAT!!' }); FX.splat(gx[i] - 2, gy[i] + 1.5, gz[i] - 1, { scale: 1.6, text: 'POP!' }); FX.splat(gx[i] + 2.2, gy[i] - 1, gz[i] - 1, { scale: 1.6, text: 'GLOOP!' }); FX.kick(0.8); }
      else FX.splat(gx[i], gy[i], gz[i], { scale: Math.max(0.55, gr[i] * 0.95), text: WORDS[(popped + i) % WORDS.length] });
    } else sparks(gx[i], gy[i], gz[i], 14, 0.6, 1.6, 0.4, 4);
    if (king) { kingDone = 1; overT = 1.6; }
    while (level < WEAPON.length && xp >= WEAPON[level].xp) { level++; hud.event('levelup'); hud.popup(WEAPON[level - 1].name, 0, 0.25, 'info'); }
  }

  // ---------------------------------------------------------------- per frame
  function update(dt0, input) {
    if (!F) return; // the engine's frame array arrives with the first post(view)
    // ?playshot=<seconds> (with ?shot): a frozen mid-run frame for visual checks of the third-person view
    if (PLAYSHOT > 0) { runTime = PLAYSHOT; t = PLAYSHOT; s = Math.min(s0 + SPEED * PLAYSHOT, sEnd); ox = oy = 0; }
    const dt = dt0 > 0 && fxOn() ? dt0 * FX.timeScale : dt0;
    t += dt; if (!over) runTime += dt;
    const intro = sst(0, 1.8, runTime), spin = sst(0.15, 1.6, runTime);
    // advance: slow to a stop at the end of the rail (the chamber)
    if (!over) { const k = Math.max(0.12, Math.min(1, (sEnd - s) / 22)); s = Math.min(s + SPEED * k * dt, sEnd); }
    rail.at(s, rp); rail.frame(s, fr);
    // pilot offset inside the box (after the intro the ship eases from the concept pose to the pilot)
    const kk = 1 - Math.exp(-dt * 3.5);
    const tx = (input.pilot.x * BOX_X) * intro + ox0 * (1 - intro), ty = (input.pilot.y * BOX_Y) * intro + oy0 * (1 - intro);
    const pox = ox, poy = oy;
    ox += (tx - ox) * kk + vox * dt; oy += (ty - oy) * kk + voy * dt; vox *= Math.exp(-dt * 4); voy *= Math.exp(-dt * 4);
    if (runTime > 0) { clampOffset(rp, fr, ox, oy, SHIP_CLEAR, o3); ox = o3[0]; oy = o3[1]; }
    const dvx = dt > 0 ? (ox - pox) / dt : 0, dvy = dt > 0 ? (oy - poy) / dt : 0;
    ship[0] = rp[0] + fr[3] * ox + fr[6] * oy; ship[1] = rp[1] + fr[4] * ox + fr[7] * oy; ship[2] = rp[2] + fr[5] * ox + fr[8] * oy;
    if (runTime <= 0) { ship[0] = heroShip[0]; ship[1] = heroShip[1]; ship[2] = heroShip[2]; }
    // view: cockpit (camera = pilot) or shoulder (behind, right and above), eased over VIEW_BLEND seconds
    const want = viewWant();
    if (dt0 > 0 && vbl !== want) vbl = want > vbl ? Math.min(1, vbl + dt0 / VIEW_BLEND) : Math.max(0, vbl - dt0 / VIEW_BLEND);
    vb = sst(0, 1, vbl);
    const sc = Math.max(0, s - BACK); rail.at(sc, rc); rail.frame(sc, frc);
    clampOffset(rc, frc, ox + CAMX, oy + CAMY, CAM_CLEAR, o3);
    const shx = rc[0] + frc[3] * o3[0] + frc[6] * o3[1], shy = rc[1] + frc[4] * o3[0] + frc[7] * o3[1], shz = rc[2] + frc[5] * o3[0] + frc[8] * o3[1];
    const chx = ship[0] + (shx - ship[0]) * vb, chy = ship[1] + (shy - ship[1]) * vb, chz = ship[2] + (shz - ship[2]) * vb;
    cam[0] = heroCam[0] + (chx - heroCam[0]) * intro; cam[1] = heroCam[1] + (chy - heroCam[1]) * intro; cam[2] = heroCam[2] + (chz - heroCam[2]) * intro;
    // look: a chord ahead (from the camera's station on the rail) blended toward the aim; from the concept's view at the start
    rail.at(s + LOOK_AHEAD, tp); rail.at(Math.max(0, s - BACK * vb), tq);
    let lx = tp[0] - tq[0], ly = tp[1] - tq[1], lz = tp[2] - tq[2]; let ll = Math.hypot(lx, ly, lz) || 1; lx /= ll; ly /= ll; lz /= ll;
    const ax = input.gunner.x, ay = input.gunner.y;
    let aix = lx + (fr[3] * ax * vasp + fr[6] * ay) * vtan, aiy = ly + (fr[4] * ax * vasp + fr[7] * ay) * vtan, aiz = lz + (fr[5] * ax * vasp + fr[8] * ay) * vtan;
    const al = Math.hypot(aix, aiy, aiz) || 1; aix /= al; aiy /= al; aiz /= al;
    const w = LOOK_AIM * intro;
    lx = lx * (1 - w) + aix * w; ly = ly * (1 - w) + aiy * w; lz = lz * (1 - w) + aiz * w;
    const hx = Math.sin(heroCam[3]) * Math.cos(heroCam[4]), hy = Math.sin(heroCam[4]), hz = Math.cos(heroCam[3]) * Math.cos(heroCam[4]);
    lx = hx + (lx - hx) * intro; ly = hy + (ly - hy) * intro; lz = hz + (lz - hz) * intro;
    const lk = runTime < 1e-6 ? 1 : 1 - Math.exp(-dt * 6);
    look[0] += (lx - look[0]) * lk; look[1] += (ly - look[1]) * lk; look[2] += (lz - look[2]) * lk;
    ll = Math.hypot(look[0], look[1], look[2]) || 1; look[0] /= ll; look[1] /= ll; look[2] /= ll;
    F[0] = cam[0]; F[1] = cam[1]; F[2] = cam[2];
    if (fxOn() && FX.shake > 0.001) { const j = FX.shake * 0.25; F[0] += (Math.random() - 0.5) * j; F[1] += (Math.random() - 0.5) * j; F[2] += (Math.random() - 0.5) * j; }
    F[3] = Math.atan2(look[0], look[2]); F[4] = Math.asin(Math.max(-1, Math.min(1, look[1]))); F[11] = heroCam[5] + (FOV_PLAY - heroCam[5]) * intro;

    // ship pose: from the concept pose (facing the camera) it turns around to fly forward, banking with the pilot
    const fy = Math.atan2(fr[0], fr[2]), fp = -Math.asin(Math.max(-1, Math.min(1, fr[1])));
    const bank = Math.max(-0.6, Math.min(0.6, -dvx * 0.12)), nod = Math.max(-0.35, Math.min(0.35, -dvy * 0.08));
    euler(heroEuler[0] + (fy - heroEuler[0]) * spin, heroEuler[1] + (fp + nod - heroEuler[1]) * spin, heroEuler[2] + (bank + 0.06 * Math.sin(t * 1.7) - heroEuler[2]) * spin, sq);
    // the model hangs SEAT below the pilot; in cockpit it vanishes as the camera climbs in (shown in the concept view and shoulder)
    const bob = Math.sin(t * 2.1) * 0.06 * intro, seat = SEAT * intro;
    mdl[0] = ship[0] - fr[6] * seat; mdl[1] = ship[1] - fr[7] * seat + bob; mdl[2] = ship[2] - fr[8] * seat;
    const cd = Math.hypot(cam[0] - mdl[0], cam[1] - mdl[1], cam[2] - mdl[2]);
    shipVis = Math.max(vb, sst(1.6, 3.4, cd));
    for (const m of shipParts) { const a = m.inst; a[0] = mdl[0]; a[1] = mdl[1]; a[2] = mdl[2]; a[3] = shipVis; a[4] = sq[0]; a[5] = sq[1]; a[6] = sq[2]; a[7] = sq[3]; m.dirty = true; }

    // weapon: heat, cooldown, fire
    const wpn = WEAPON[level - 1];
    heat = Math.max(0, heat - wpn.cool * dt); fireT -= dt;
    if (overheated && heat < HEAT_RESUME) { overheated = false; hud.event('cooled'); }
    let fx = input.gunner.x, fyy = input.gunner.y, wantFire = input.gunner.fire;
    if (debug.auto) { const i = autoTarget(); if (i >= 0) { view.project(gx[i], gy[i], gz[i], o3); fx = o3[0]; fyy = o3[1]; wantFire = true; } }
    if (!over && dt > 0 && intro > 0.6 && wantFire && !overheated && fireT <= 0) {
      fire(fx, fyy); fireT = 1 / wpn.rate; heat += wpn.heat;
      if (heat >= 1) { heat = 1; overheated = true; hud.event('overheat'); }
    }
    if (comboT > 0) { comboT -= dt; if (comboT <= 0) combo = 1; }

    updateBolts(dt);
    updateGerms(dt);
    updateCells(dt);
    // sparks
    for (let k = 0; k < NS; k++) {
      if (spark.life[k] <= 0) { hidePt(PS + k); continue; }
      spark.life[k] -= dt;
      spark.p[k * 3] += spark.v[k * 3] * dt; spark.p[k * 3 + 1] += spark.v[k * 3 + 1] * dt; spark.p[k * 3 + 2] += spark.v[k * 3 + 2] * dt;
      const e = Math.max(0, spark.life[k] / 0.4);
      setPt(PS + k, spark.p[k * 3], spark.p[k * 3 + 1], spark.p[k * 3 + 2], 0.06 * e + 0.015, spark.c[k * 3] * e, spark.c[k * 3 + 1] * e, spark.c[k * 3 + 2] * e);
    }
    // finale: the King Germ stays BOSS_MAX seconds once the ship has slowed in the chamber
    if (!over && sEnd - s < 30 && kingDone === 0) { bossT += dt; if (bossT > BOSS_MAX) { kingDone = 2; overT = 1.2; hud.popup('The King Germ wriggled away!', 0, 0.2, 'bad'); } }
    if (!over && kingDone && (overT -= dt) <= 0) finish();
    writeStats();
  }
  function finish() {
    over = true;
    for (let i = 0; i < NG; i++) if (gst[i] === 1 && i !== KING) missed++;
    writeStats();
    hud.event(kingDone === 1 ? 'win' : 'lose');
    hud.results({ title: kingDone === 1 ? 'King Germ splatted!' : 'Gooey Run complete', lines: [
      ['Germs popped', popped + ' / ' + NG], ['King Germ', kingDone === 1 ? 'Splatted' : 'Got away'], ['Best combo', '×' + bestCombo],
      ['Score', String(score)], ['Blaster', WEAPON[level - 1].name + ' (L' + level + ')'], ['Bumps', String(bonks)], ['Time', runTime.toFixed(1) + ' s']] }, againFn);
  }
  const againFn = () => reset();

  function autoTarget() { // ?debug test hook: the nearest live germ in view
    let best = -1, bd = 1e9;
    for (let i = 0; i < NG; i++) { if (gst[i] !== 1) continue; view.project(gx[i], gy[i], gz[i], o3); if (o3[2] < 3 || o3[2] > 55 || Math.abs(o3[0]) > 0.9 || Math.abs(o3[1]) > 0.9) continue; if (o3[2] < bd) { bd = o3[2]; best = i; } }
    return best;
  }

  function updateBolts(dt) {
    const w = WEAPON[level - 1];
    for (let k = 0; k < NB; k++) {
      const pb = PB + k * BP;
      if (!bolt.on[k]) { for (let j = 0; j < BP; j++) hidePt(pb + j); continue; }
      const px = bolt.p[k * 3], py = bolt.p[k * 3 + 1], pz = bolt.p[k * 3 + 2], vx = bolt.v[k * 3] * dt, vy = bolt.v[k * 3 + 1] * dt, vz = bolt.v[k * 3 + 2] * dt;
      const vv = vx * vx + vy * vy + vz * vz;
      let hit = -1, cell = -1;
      for (let i = 0; i < NG && vv > 0; i++) {
        if (gst[i] !== 1) continue;
        const rr = gr[i] * 1.35 + bolt.r[k], cx = gx[i], cy = gy[i], cz2 = gz[i];
        if (Math.abs(cz2 - pz) > rr + Math.abs(vz) + 1) continue;
        const h = Math.max(0, Math.min(1, ((cx - px) * vx + (cy - py) * vy + (cz2 - pz) * vz) / vv));
        if (Math.hypot(px + vx * h - cx, py + vy * h - cy, pz + vz * h - cz2) < rr) { hit = i; break; }
      }
      if (hit < 0 && vv > 0) for (let c = 0; c < CF + CN; c++) { // friendly cells: shots only wobble them
        const o = c * 12, r = CI[o + 3]; if (r <= 0 || c < HERO_CELLS) continue; // the hero blobs are scenery
        if (Math.abs(CI[o + 2] - pz) > r + Math.abs(vz) + 1) continue;
        const h = Math.max(0, Math.min(1, ((CI[o] - px) * vx + (CI[o + 1] - py) * vy + (CI[o + 2] - pz) * vz) / vv));
        if (Math.hypot(px + vx * h - CI[o], py + vy * h - CI[o + 1], pz + vz * h - CI[o + 2]) < r) { cell = c; break; }
      }
      bolt.p[k * 3] = px + vx; bolt.p[k * 3 + 1] = py + vy; bolt.p[k * 3 + 2] = pz + vz;
      bolt.life[k] -= dt;
      if (hit >= 0) {
        bolt.on[k] = 0;
        const dmg = w.dmg;
        if (hit === KING) { kingHp -= dmg; ghp[hit] = kingHp; gwob[hit] = 0.25; hud.event('hit'); if (fxOn()) FX.splat(px, py, pz, { scale: 0.5, text: 'SPLAT!' }); if (kingHp <= 0) popGerm(hit); }
        else { ghp[hit] -= dmg; gwob[hit] = 0.3; if (ghp[hit] <= 0) popGerm(hit); else { hud.event('hit'); sparks(px, py, pz, 6, 0.7, 1.7, 0.5, 3); } }
      } else if (cell >= 0) {
        bolt.on[k] = 0; cwob[cell] = 0.5; sparks(px, py, pz, 5, 2.0, 0.9, 0.7, 2.5);
        if (view) { view.project(px, py, pz, o3); hud.popup('boing', o3[0], o3[1], 'info'); }
      } else if (field(px + vx, py + vy, pz + vz) > 0) { sparks(px, py, pz, 6, 1.8, 0.8, 0.8, 2.5); bolt.on[k] = 0; }
      else if (bolt.life[k] <= 0) bolt.on[k] = 0;
      if (!bolt.on[k]) { for (let j = 0; j < BP; j++) hidePt(pb + j); continue; }
      // a goo bubble: bright core with a cyan ring (the ship's stripe colour, BT-K1e)
      const sl = Math.sqrt(vv) || 1, fx = vx / sl, fy = vy / sl, fz = vz / sl;
      let ax = -fz, az = fx; const a2 = Math.hypot(ax, az) || 1; ax /= a2; az /= a2;
      const bx = fy * az, by = fz * ax - fx * az, bz = -fy * ax;
      const rr = 0.16 + 0.12 * bolt.r[k], spin = t * 10 + k, qx = bolt.p[k * 3], qy = bolt.p[k * 3 + 1], qz = bolt.p[k * 3 + 2];
      setPt(pb, qx, qy, qz, 0.13 + 0.08 * bolt.r[k], 2.6, 2.4, 2.2);
      for (let j = 1; j < BP; j++) { const an = spin + j / (BP - 1) * 6.283, c = Math.cos(an) * rr, sn = Math.sin(an) * rr; setPt(pb + j, qx + ax * c + bx * sn, qy + by * sn, qz + az * c + bz * sn, 0.07, 0.5, 2.2, 2.4); }
    }
  }

  function updateGerms(dt) {
    for (let i = 0; i < NG; i++) {
      const st = gst[i];
      if (st === 0 || st === 3) { writeGerm(i, 0, sq); continue; }
      if (st === 2) { // popping: a quick squash and vanish (FX.splat does the goo)
        gpop[i] += dt; const e = gpop[i] / 0.15; if (e >= 1) { gst[i] = 0; writeGerm(i, 0, sq); continue; }
        euler(gyaw[i], gpit[i], 0, gq); writeGerm(i, gr[i] * (1 + e * 0.5) * (1 - e), gq); continue;
      }
      // alive
      if (gkind[i] === 1 && i !== KING) { // stream germs drift toward the ship and bob
        gz[i] = base[i * 3 + 2] - (runTime * 1.2); gy[i] = base[i * 3 + 1] + Math.sin(t * 1.3 + gph[i]) * 0.3; gx[i] = base[i * 3] + Math.sin(t * 0.9 + gph[i] * 2) * 0.3;
        const dx = cam[0] - gx[i], dy = cam[1] - gy[i], dz = cam[2] - gz[i];
        gyaw[i] = Math.atan2(dx, dz); gpit[i] = -Math.asin(Math.max(-1, Math.min(1, dy / (Math.hypot(dx, dy, dz) || 1))));
      }
      if (i === KING) { // sways and glares at the ship
        gx[i] = base[i * 3] + Math.sin(t * 0.8) * 1.2; gy[i] = base[i * 3 + 1] + Math.sin(t * 1.1) * 0.6;
        const dx = cam[0] - gx[i], dy = cam[1] - gy[i], dz = cam[2] - gz[i];
        gyaw[i] = Math.atan2(dx, dz); gpit[i] = -Math.asin(Math.max(-1, Math.min(1, dy / (Math.hypot(dx, dy, dz) || 1))));
      }
      if (gz[i] < cam[2] - 3 && !over && i !== KING && runTime > 0) { gst[i] = 3; missed++; combo = 1; comboT = 0; writeGerm(i, 0, sq); continue; }
      if (gwob[i] > 0) gwob[i] = Math.max(0, gwob[i] - dt);
      const wob = 1 + 0.05 * Math.sin(t * 3.2 + gph[i]) + gwob[i] * 0.6 * Math.sin(gwob[i] * 40);
      euler(gyaw[i], gpit[i], 0.25 * Math.sin(t * 1.5 + gph[i]), gq);
      writeGerm(i, gr[i] * wob, gq);
    }
  }

  function updateCells(dt) {
    // stream cells: drift with the flow, tumble, respawn ahead once behind the camera
    for (let i = 0; i < CN; i++) {
      const o = (CF + i) * 12;
      if (runTime > 0) { CI[o + 2] += STREAM_FLOW * dt; NI[o + 2] = CI[o + 2]; }
      if (CI[o + 2] < cam[2] - 4 && runTime > 0) spawnCell(i, cam[2] + 60 + rand() * 20);
    }
    // bumps: the ship against any cell (static or stream)
    for (let c = HERO_CELLS; c < CF + CN; c++) {
      const o = c * 12, r = crad[c]; if (r <= 0) continue;
      if (cwob[c] > 0) { const e = Math.max(0, cwob[c] - dt); cwob[c] = e; NI[o + 3] = CI[o + 3] = r * (1 + 0.18 * Math.sin(e * 30) * e); }
      const dz = CI[o + 2] - ship[2]; if (dz > r + 1.5 || dz < -r - 1.5) continue;
      const dx = CI[o] - ship[0], dy = CI[o + 1] - ship[1], d = Math.hypot(dx, dy, dz), lim = r + 1.0;
      if (d < lim && runTime > 0 && !over) {
        // push the ship away in the rail plane, cost the combo, wobble the cell
        const nx = -(dx * fr[3] + dy * fr[4] + dz * fr[5]), ny = -(dx * fr[6] + dy * fr[7] + dz * fr[8]), nl = Math.hypot(nx, ny) || 1;
        vox += nx / nl * 6; voy += ny / nl * 6; ox += nx / nl * (lim - d) * 0.5; oy += ny / nl * (lim - d) * 0.5;
        if (cwob[c] <= 0.2) { bonks++; combo = 1; comboT = 0; cwob[c] = 0.6; if (fxOn()) FX.kick(0.35); if (view) { view.project(ship[0], ship[1] + 1, ship[2], o3); hud.popup('Bonk!', o3[0], o3[1], 'bad'); } }
      }
    }
    cells.ball.dirty = cells.nub.dirty = true;
  }

  // ---------------------------------------------------------------- post: HUD feeds (marks, blips, stats)
  function post(v) {
    view = v; F = v.F;
    vf[0] = v.f[0]; vf[1] = v.f[1]; vf[2] = v.f[2]; vr[0] = v.r[0]; vr[1] = v.r[1]; vr[2] = v.r[2]; vu[0] = v.u[0]; vu[1] = v.u[1]; vu[2] = v.u[2]; vtan = v.tan; vasp = v.aspect;
    const cx = F[0], cy = F[1], cz0 = F[2];
    let nm = 0, nb = 0;
    for (let i = 0; i < NG && nm < 60; i++) {
      if (gst[i] !== 1) continue;
      const dx = gx[i] - cx, dy = gy[i] - cy, dz = gz[i] - cz0, d = Math.hypot(dx, dy, dz);
      if (d > (i === KING ? 90 : 45)) continue;
      v.project(gx[i], gy[i], gz[i], o3);
      marks[nm * 6] = o3[0]; marks[nm * 6 + 1] = o3[1]; marks[nm * 6 + 2] = o3[2]; marks[nm * 6 + 3] = 0; marks[nm * 6 + 4] = d; marks[nm * 6 + 5] = i === KING ? 0 : -1; nm++;
      blips[nb * 4] = dx * vr[0] + dz * vr[2]; blips[nb * 4 + 1] = dx * vu[0] + dy * vu[1] + dz * vu[2]; blips[nb * 4 + 2] = dx * vf[0] + dy * vf[1] + dz * vf[2]; blips[nb * 4 + 3] = i === KING ? 2 : 0; nb++;
    }
    hud.marks(marks, nm); hud.blips(blips, nb);
    hud.set(stats);
  }

  return {
    id: 'body-toy', title: 'Body Defenders: Gooey Run', skin: 'visor', palette: 'Arctic',
    prepare(SC) { SC.p1 = SC.p1 || [1, 6.4, 0, 1]; SC.p1[3] = 1; }, // ghost rail on; p1.xy is the scene's depth of field
    init, update, post, reset,
  };
})();
