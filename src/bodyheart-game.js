// ============================================================================
// bodyheart-game.js: Body Defenders, Heart Gate. A rhythm rail run through a vessel to the heart (BODY_GAMES.md).
// A beat clock (fixed BPM, default 72, ?bpm=) drives everything: the walls breathe, the cells surge, the valve gates
// open on each beat, and your ship surges in step. Thread each valve while it is open; pass on the beat for PERFECT.
// Clots stick in the valves and float in the lane: pop them with the Pulse Popper (dark red FX.splat). Shots fired
// on the beat hit twice as hard. The run ends through the glowing heart opening (BD-4.0, the finale gate).
// You are the ship (VIEW.md): cockpit view by default; over the shoulder shows the concept ship (HG-K1) at the pilot position.
// Load-time allocation only; update() and post() reuse preallocated typed arrays.
// ============================================================================
const GAME = (() => {
  const URLQ = new URLSearchParams(location.search), IS_SHOT = URLQ.has('shot');
  // ---------------------------------------------------------------- tuning
  const BPM = clamp(Math.round(+URLQ.get('bpm') || 72), 40, 160), BEAT = 60 / BPM;
  const V_NOM = 12.5, SURGE_A = 0.32, BOOST_RATE = 1.45, ASSIST = 0.06, BUMP_RATE = 0.4, BUMP_T = 0.5;
  const BOX_X = 5, BOX_Y = 4, LOOK_AIM = 0.15, SHIP_AHEAD = 16; // SHIP_AHEAD: only the concept (menu) pose uses it now
  // view (VIEW.md): shoulder camera behind, above and right of the ship; the player's ship scale (concept 2.0) and nose
  const SH_BACK = 4.5, SH_UP = 1.3, SH_RIGHT = 0.9, BLEND_T = 0.35, SHIP_S = 0.8, NOSE = 0.72;
  const GN = 7, GATE_R = 8.5, OPEN_LO = -0.16, OPEN_HI = 0.33, PERFECT = 0.09, ONBEAT_SHOT = 0.1;
  const BOLT_SPEED = 120, BOLT_LIFE = 0.9, LOCK_RANGE = 120, RADAR_RANGE = 200;
  const COMBO_TIME = 3.5, COMBO_MAX = 10;
  const PTS_PERFECT = 1000, PTS_GOOD = 500, PTS_HEART_PERFECT = 3000, PTS_HEART_GOOD = 1500;
  // Pulse Popper levels. Data, so a shop or upgrade screen can edit or extend it later.
  // rate: shots/s · bolts per shot · spread: rad · heat per shot · cool: heat/s (cooldown) · size: bolt radius (m) · dmg per bolt
  const WEAPONS = [
    { xp: 0, name: 'Pulse Popper', rate: 4.5, bolts: 1, spread: 0, heat: 0.13, cool: 0.42, size: 0.12, dmg: 1.0 },
    { xp: 300, name: 'Pulse Popper II', rate: 5.5, bolts: 1, spread: 0, heat: 0.11, cool: 0.48, size: 0.14, dmg: 1.3 },
    { xp: 800, name: 'Twin Popper', rate: 6.0, bolts: 2, spread: 0, heat: 0.11, cool: 0.52, size: 0.15, dmg: 1.3 },
    { xp: 1500, name: 'Twin Thumper', rate: 7.0, bolts: 2, spread: 0, heat: 0.10, cool: 0.58, size: 0.17, dmg: 1.7 },
    { xp: 2500, name: 'Heartbeat Spread', rate: 7.5, bolts: 3, spread: 0.03, heat: 0.09, cool: 0.65, size: 0.19, dmg: 2.0 },
  ];
  const fxOn = () => typeof FX !== 'undefined';
  // beat envelope: "lub" on the beat, a softer "dub" 0.22 s later (seconds since the beat)
  const lubdub = (ts) => min(1, exp(-ts * 10) + (ts > 0.22 ? 0.6 * exp(-(ts - 0.22) * 12) : 0));
  const wrapBeat = (t) => t - Math.round(t / BEAT) * BEAT; // signed seconds from the nearest beat
  const openness = (e) => sstep(OPEN_LO - 0.08, OPEN_LO + 0.04, e) * (1 - sstep(OPEN_HI - 0.06, OPEN_HI + 0.08, e));

  // ---------------------------------------------------------------- state
  let shell = null, vb = 0, shipRoll = 0, lockD = 0;
  let G = null, hud = null, F = null, rail = null, len = 0, sH = 0, frameFn = null, SC = null;
  let tanH = Math.tan(HEART_FOV / 2), aspect = 16 / 9;
  const stats = { score: 0, combo: 1, hull: 0, hullMax: 0, level: 1, xp: 0, xpNext: WEAPONS[1].xp, heat: 0, overheated: false,
    counterLabel: '♥ ' + BPM + ' BPM · Gates', counterValue: 0, counterMax: GN + 1, weaponName: WEAPONS[0].name, bpm: BPM };
  let s = 0, tau = 0, beatT = 0, flowT = 0, ox = 0, oy = 0, runT = 0, started = false, ended = false, endT = 0;
  let score = 0, combo = 1, comboT = 0, bestCombo = 1, xp = 0, level = 1, heat = 0, overheated = false, fireCD = 0;
  let bumps = 0, bumpT = 0, rate = 1, popped = 0, perfect = 0, good = 0, bonk = 0, nextGate = 0, heartDone = false, pulse = 0, bot = false;
  const cam = new Float64Array(3), CB = new Float64Array(9), L = new Float64Array([0, 0, 1]), FR = new Float64Array(9), T2 = new Float64Array(3), PJ = new Float64Array(3), YP = new Float64Array(2);
  const aim = new Float64Array(2), PP = new Float64Array(3); // PP: the pilot position = the ship (cam is the render camera)
  // schedule: s = S(tau), the default run's distance at schedule time tau (speed surges with the beat, mean v0)
  let SCH = null, SDT = 1 / 120, v0 = V_NOM, tauEnd = 0;
  const S = (t) => { const f = clamp(t / SDT, 0, SCH.length - 1.001), k = floor(f); return mix(SCH[k], SCH[k + 1], f - k); };
  // gates
  const GS = new Float32Array(GN), GT = new Float32Array(GN), GC = new Float32Array(GN * 3), GF = new Float32Array(GN * 9);
  let ringM = null, leafM = null, plateM = null, LQ = null;
  // clots
  let nC = 0, CXp, CYp, CZp, CR, CHP, CHPM, CAL, CFL, CGATE, CVAR, CSLOT; const clotM = [];
  // points
  let P = null, BO0 = 0, SP0 = 0;
  const NBOLT = 40, NSPARK = 300;
  const BX = new Float32Array(NBOLT * 3), BV = new Float32Array(NBOLT * 3), BL = new Float32Array(NBOLT), BD = new Float32Array(NBOLT), BS = new Float32Array(NBOLT), BB = new Uint8Array(NBOLT);
  const SX = new Float32Array(NSPARK * 3), SV = new Float32Array(NSPARK * 3), SL = new Float32Array(NSPARK), SL0 = new Float32Array(NSPARK), SS = new Float32Array(NSPARK);
  let sparkNext = 0, boltNext = 0, MK = null, BLP = null;
  // the ship (HG-K1): its concept offset relative to the rail (menu pose)
  let shipOff = [0, 0, 0], shipQ0 = [0, 0, 0, 1];
  const QF = new Float64Array(4), QS2 = new Float64Array(4);

  // ---------------------------------------------------------------- helpers (no allocation)
  const setPt = (i, x, y, z, sz, r, g, b, k) => { const o = i * 8; P[o] = x; P[o + 1] = y; P[o + 2] = z; P[o + 3] = sz; P[o + 4] = r; P[o + 5] = g; P[o + 6] = b; P[o + 7] = k; };
  const project = (x, y, z, o) => {
    const dx = x - cam[0], dy = y - cam[1], dz = z - cam[2], d = dx * CB[0] + dy * CB[1] + dz * CB[2], q = d > 1e-3 ? d : 1e-3;
    o[0] = (dx * CB[3] + dz * CB[5]) / (q * tanH * aspect); o[1] = (dx * CB[6] + dy * CB[7] + dz * CB[8]) / (q * tanH); o[2] = d; return o;
  };
  const weapon = () => WEAPONS[level - 1];
  // quaternion from a basis (columns right, up, forward) into o
  const qBasis = (rx, ry, rz, ux, uy, uz, fx, fy, fz, o) => {
    const tr = rx + uy + fz;
    if (tr > 0) { const k = 0.5 / sqrt(tr + 1); o[3] = 0.25 / k; o[0] = (uz - fy) * k; o[1] = (fx - rz) * k; o[2] = (ry - ux) * k; }
    else if (rx > uy && rx > fz) { const k = 2 * sqrt(1 + rx - uy - fz); o[3] = (uz - fy) / k; o[0] = 0.25 * k; o[1] = (ux + ry) / k; o[2] = (fx + rz) / k; }
    else if (uy > fz) { const k = 2 * sqrt(1 + uy - rx - fz); o[3] = (fx - rz) / k; o[0] = (ux + ry) / k; o[1] = 0.25 * k; o[2] = (fy + uz) / k; }
    else { const k = 2 * sqrt(1 + fz - rx - uy); o[3] = (ry - ux) / k; o[0] = (fx + rz) / k; o[1] = (fy + uz) / k; o[2] = 0.25 * k; }
    return o;
  };
  const qmul = (a, b, o) => { const x = a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], y = a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], z = a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], w = a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]; o[0] = x; o[1] = y; o[2] = z; o[3] = w; return o; };
  const randDir = (o) => { const z = rnd() * 2 - 1, a = rnd() * TAU, r = sqrt(1 - z * z); o[0] = r * cos(a); o[1] = r * sin(a); o[2] = z; return o; };
  const T3 = new Float64Array(3);

  function prepare(SC_) { SC = SC_; SC.p1 = SC.p1 || [0, 0, 0, 1]; }

  // ---------------------------------------------------------------- init: schedule, gates, clots, pools
  function init(G_, Shell_) {
    G = G_; hud = Shell_.hud; shell = Shell_; rail = G.rail; len = G.len; sH = G.sH; frameFn = G.frame;
    hud.labels = ['Clot', '♥ on beat', 'open', 'late · Shift to surge', 'early · ease off', 'Heart Gate'];
    // schedule: the heart is reached on a whole beat; the speed surges with the lub-dub but averages v0
    const N = Math.max(8, Math.round(sH / (V_NOM * BEAT))); v0 = sH / (N * BEAT); tauEnd = N * BEAT;
    let pm = 0; for (let i = 0; i < 200; i++) pm += lubdub(i / 200 * BEAT) / 200;
    const n = Math.ceil((tauEnd + 6) / SDT) + 2; SCH = new Float32Array(n);
    for (let i = 1; i < n; i++) { const t = (i - 0.5) * SDT; SCH[i] = SCH[i - 1] + v0 * (1 + SURGE_A * (lubdub(t % BEAT) - pm)) * SDT; }
    // gates on whole beats between 5 s and the last point that keeps the finale straight clear (the hero view)
    let tLast = 0; for (let t = 0; t < tauEnd; t += SDT) if (S(t) < sH - 80) tLast = t;
    for (let k = 0; k < GN; k++) { GT[k] = Math.round(mix(5, tLast, k / (GN - 1)) / BEAT) * BEAT; GS[k] = S(GT[k]); }
    const p = [0, 0, 0];
    for (let k = 0; k < GN; k++) { rail.at(GS[k], p); frameFn(GS[k], FR); GC.set(p, k * 3); for (let c = 0; c < 9; c++) GF[k * 9 + c] = FR[c]; }

    // ---- valve gates (P): a membrane plate with a triangular opening, a collar ring with cyan lights (HG-P collar,
    // HG-M1 windows), and three cusps hinged on the triangle's sides that fold forward on the beat
    const gq = [];
    for (let k = 0; k < GN; k++) { const o = k * 9; gq.push(qBasis(GF[o + 3], GF[o + 4], GF[o + 5], GF[o + 6], GF[o + 7], GF[o + 8], GF[o], GF[o + 1], GF[o + 2], [0, 0, 0, 0]).slice()); }
    const CH = GATE_R / 2, HALF = GATE_R * Math.sin(PI / 3), CUSP = [-PI / 2, PI / 6, 5 * PI / 6];
    {
      const m = new Mesh(), NA = 96, RO = 10.2;
      for (let j = 0; j <= NA; j++) {
        const a = j / NA * TAU; let rin = 1e9; for (const c of CUSP) { const d = cos(a - c); if (d > 1e-3) rin = min(rin, CH / d); }
        m.v(cos(a) * rin, sin(a) * rin, 0, -1); m.v(cos(a) * RO, sin(a) * RO, 0.6, 1);
      }
      for (let j = 0; j < NA; j++) m.quad(j * 2, j * 2 + 2, j * 2 + 3, j * 2 + 1);
      plateM = m.build(); const I = new Float32Array(GN * 12);
      for (let k = 0; k < GN; k++) I.set([GC[k * 3], GC[k * 3 + 1], GC[k * 3 + 2], 1, ...gq[k], 7, 0, 0, 0], k * 12);
      plateM.inst = I; G.meshes.push(plateM);
    }
    {
      const m = new Mesh(), pts = []; for (let j = 0; j <= 72; j++) { const a = j / 72 * TAU; pts.push([cos(a) * 9.0, 0, sin(a) * 9.0]); }
      m.tube(pts, 0.55, 10, false); ringM = m.build();
      // the ring is built around local y; the gate frame needs it around local z (forward)
      const I = new Float32Array(GN * 12), qx = qAxis(1, 0, 0, PI / 2);
      for (let k = 0; k < GN; k++) I.set([GC[k * 3], GC[k * 3 + 1], GC[k * 3 + 2], 1, ...qMul(gq[k], qx), 8, 0, 0, 0], k * 12);
      ringM.inst = I; G.meshes.push(ringM);
    }
    {
      // cusp in its hinge frame: the hinge (a side of the triangle) lies along local y at x = 0; the tip points to -x
      const m = new Mesh(), NU = 8, NV = 10;
      for (let i = 0; i <= NU; i++) for (let j = 0; j <= NV; j++) {
        const u = i / NU, w = (j / NV) * 2 - 1, x = -CH * u * 0.97, y = w * HALF * (1 - u) * 0.98, z = 0.9 * sin(PI * u * 0.9) * (1 - w * w) * 0.6;
        m.v(x, y, z, u * 2 - 1);
      }
      for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) { const a = i * (NV + 1) + j; m.quad(a, a + 1, a + NV + 2, a + NV + 1); }
      leafM = m.build(); leafM.inst = new Float32Array(GN * 3 * 12); LQ = new Float32Array(GN * 3 * 4);
      for (let k = 0; k < GN; k++) for (let c = 0; c < 3; c++) {
        const a = CUSP[c], o = k * 9, hx = cos(a) * CH, hy = sin(a) * CH, i = k * 3 + c;
        const x = GC[k * 3] + GF[o + 3] * hx + GF[o + 6] * hy, y = GC[k * 3 + 1] + GF[o + 4] * hx + GF[o + 7] * hy, z = GC[k * 3 + 2] + GF[o + 5] * hx + GF[o + 8] * hy;
        // local x of the cusp points outward along the cusp's normal direction a: rotate by a about the gate's forward
        const qb = qMul(gq[k], qAxis(0, 0, 1, a)); LQ.set(qb, i * 4);
        leafM.inst.set([x, y, z, 1, ...qb, 7, 0, 0, 0], i * 12);
      }
      G.meshes.push(leafM);
    }

    // ---- clots (P, from the RC family, darker and stickier): in each valve's opening, floating in the lane, and at the heart
    const clotVar = (seed) => { rseed(seed); const o = [rr(0, 30), rr(0, 30), rr(0, 30)]; const m = icosphere(2, (x, y, z) => { const r = 1 + 0.28 * (fbm(x * 1.3 + o[0], y * 1.3 + o[1], z * 1.3 + o[2], 3) - 0.5) * 2; return [x * r, y * r, z * r]; }); const b = m.build(); b.inst = []; return b; };
    clotM.push(clotVar(701), clotVar(702));
    rseed(710);
    const cl = [];
    const at = (st, u, v) => { rail.at(st, p); frameFn(st, FR); return [p[0] + FR[3] * u + FR[6] * v, p[1] + FR[4] * u + FR[7] * v, p[2] + FR[5] * u + FR[8] * v]; };
    for (let k = 0; k < GN; k++) {
      const n2 = k < 2 ? 1 + k : 3; const a0 = rr(0, TAU);
      for (let c = 0; c < n2; c++) { const a = a0 + c * TAU / n2, rad = c === 0 && k > 1 ? rr(0, 0.8) : rr(1.2, 2.6), r = rr(0.75, 1.15); const q = at(GS[k] - 1.2, cos(a) * rad, sin(a) * rad); cl.push({ q, r, gate: k }); }
    }
    for (let k = 0; k <= GN; k++) { // floating clots between gates (and before the first)
      const s0 = k ? GS[k - 1] + 14 : 40, s1 = k < GN ? GS[k] - 14 : sH - 90;
      for (let c = 0, tries = 0; c < 4 && tries < 60; tries++) {
        const st = rr(s0, s1), u = rr(-BOX_X, BOX_X), v = rr(-BOX_Y, BOX_Y), r = rr(0.6, 1.2), q = at(st, u, v);
        if (cl.some((o) => hypot(o.q[0] - q[0], o.q[1] - q[1], o.q[2] - q[2]) < o.r + r + 3)) continue;
        cl.push({ q, r, gate: -1 }); c++;
      }
    }
    for (let c = 0; c < 4; c++) { const a = c * TAU / 4 + 0.4, rad = rr(2.5, 4.5); cl.push({ q: at(sH - 3, cos(a) * rad, sin(a) * rad * 0.8), r: rr(0.8, 1.1), gate: GN }); } // around the heart opening
    nC = cl.length;
    CXp = new Float32Array(nC); CYp = new Float32Array(nC); CZp = new Float32Array(nC); CR = new Float32Array(nC); CHP = new Float32Array(nC); CHPM = new Float32Array(nC);
    CAL = new Uint8Array(nC); CFL = new Float32Array(nC); CGATE = new Int8Array(nC); CVAR = new Uint8Array(nC); CSLOT = new Uint16Array(nC);
    for (let i = 0; i < nC; i++) {
      const c = cl[i]; CXp[i] = c.q[0]; CYp[i] = c.q[1]; CZp[i] = c.q[2]; CR[i] = c.r; CHPM[i] = Math.round(1 + c.r * 2); CGATE[i] = c.gate;
      CVAR[i] = i % 2; const m = clotM[i % 2], qq = qRand(); CSLOT[i] = m.inst.length / 12; m.inst.push(c.q[0], c.q[1], c.q[2], c.r, ...qq, 6, 0, rnd(), 0);
    }
    for (const m of clotM) { m.inst = new Float32Array(m.inst); G.meshes.push(m); }

    // ---- guide ship: keep the concept offset from the rail (HG-K1 at the hero pose)
    { const ss = G.sHero + SHIP_AHEAD; rail.at(ss, p); frameFn(ss, FR); const d = [G.ship.pos[0] - p[0], G.ship.pos[1] - p[1], G.ship.pos[2] - p[2]];
      shipOff = [d[0] * FR[3] + d[1] * FR[4] + d[2] * FR[5], d[0] * FR[6] + d[1] * FR[7] + d[2] * FR[8], d[0] * FR[0] + d[1] * FR[1] + d[2] * FR[2]];
      const qf = qBasis(FR[3], FR[4], FR[5], FR[6], FR[7], FR[8], FR[0], FR[1], FR[2], [0, 0, 0, 0]); qf[0] = -qf[0]; qf[1] = -qf[1]; qf[2] = -qf[2]; // inverse
      shipQ0 = qMul(qf, G.ship.q); }

    // ---- points: ghost rail, then one dynamic range for bolts and sparks
    const ghost = rail.ghost(1.6, 0.07, [1.6, 0.9, 1.0]);
    const old = G.points, nGhost = ghost.length / 8, dyn0 = old.length / 8 + nGhost, nDyn = NBOLT * 3 + NSPARK;
    P = new Float32Array(old.length + ghost.length + nDyn * 8); P.set(old); P.set(ghost, old.length);
    BO0 = dyn0; SP0 = BO0 + NBOLT * 3;
    G.points = P; G.dynPts = [dyn0, nDyn];
    MK = new Float32Array(6 * 6); BLP = new Float32Array((nC + 2) * 4);
    // test hook (?debug): jump along the rail, read state, or let a bot play (aims, fires on the beat, surges when late)
    // sim(seconds, dt): step the real update() synchronously with the bot's input (a hidden pane throttles timers)
    const simIn = { pilot: { x: 0, y: 0 }, gunner: { x: 0, y: 0, fire: false, alt: false }, players: 1 };
    if (URLQ.has('debug')) window.heartGate = { shipNdc, jump(v) { tau = clamp(v, 0, tauEnd); s = S(tau); }, set bot(v) { bot = !!v; }, get bot() { return bot; },
      sim(sec, step = 1 / 60, idle = false) { const b = bot, fe = fxOn() && FX.enabled; bot = !idle; if (fxOn()) { FX.enabled = false; FX.timeScale = 1; } for (let t = 0; t < sec && !ended; t += step) update(step, simIn); bot = b; if (fxOn()) FX.enabled = fe; return this.state; },
      get state() { return { view: shell.view, blend: vb, s, tau, sH, len, beatT, lag: wrapBeat(runT - tau), score, combo, bestCombo, popped, nC, perfect, good, bonk, bumps, nextGate, level, xp, heat, overheated, ended, runT, v0, tauEnd, gates: Array.from(GS), BPM }; } };
    reset(); s = G.sHero; started = false; // the menu shows the concept view (hero pose); the run starts at s = 0
    if (IS_SHOT && URLQ.has('at')) { started = true; s = +URLQ.get('at'); tau = 0; for (let t = 0; t < tauEnd && S(t) < s; t += SDT) tau = t; ox = +(URLQ.get('ox') || 0); oy = +(URLQ.get('oy') || 0); }
  }

  // ---------------------------------------------------------------- clots
  const showClot = (i, on) => { CAL[i] = on ? 1 : 0; const m = clotM[CVAR[i]]; m.inst[CSLOT[i] * 12 + 3] = on ? CR[i] : 0; m.dirty = true; };
  const sparks = (x, y, z, n, sp, sz) => {
    for (let k = 0; k < n; k++) {
      const i = sparkNext; sparkNext = (sparkNext + 1) % NSPARK; randDir(T3); const v = sp * rr(0.3, 1);
      SX[i * 3] = x; SX[i * 3 + 1] = y; SX[i * 3 + 2] = z; SV[i * 3] = T3[0] * v; SV[i * 3 + 1] = T3[1] * v; SV[i * 3 + 2] = T3[2] * v; SL[i] = SL0[i] = rr(0.3, 0.8); SS[i] = rr(0.05, 0.11) * sz;
    }
  };
  const addXP = (n) => { xp += n; while (level < WEAPONS.length && xp >= WEAPONS[level].xp) { level++; hud.event('levelup'); hud.popup('LEVEL ' + level + ' · ' + WEAPONS[level - 1].name, 0, 0.35, 'info'); } };
  const bumpCombo = () => { combo = comboT > 0 ? min(combo + 1, COMBO_MAX) : max(combo, 1); comboT = COMBO_TIME; if (combo > bestCombo) bestCombo = combo; };
  const popClot = (i, onBeat) => {
    showClot(i, false); popped++;
    const r = CR[i]; sparks(CXp[i], CYp[i], CZp[i], 18, 6, 1.2);
    if (fxOn()) FX.splat(CXp[i], CYp[i], CZp[i], { color: '#7a1030', scale: 0.7 + r * 0.5, text: onBeat ? 'ON BEAT!' : 'POP!' });
    bumpCombo();
    const pts = Math.round((100 + r * 60) * (onBeat ? 2 : 1)) * combo; score += pts;
    project(CXp[i], CYp[i], CZp[i], PJ); if (PJ[2] > 0) hud.popup('+' + pts + (onBeat ? ' ♥' : ''), PJ[0], PJ[1], 'good');
    hud.event('destroy'); addXP(30 + (r * 20 | 0) + (onBeat ? 15 : 0));
  };
  const damage = (i, dmg, onBeat, x, y, z) => {
    CHP[i] -= dmg; CFL[i] = 0.12;
    if (CHP[i] <= 0) { popClot(i, onBeat); return; }
    sparks(x, y, z, 6, 4, 0.8); hud.event('hit'); addXP(2);
    if (fxOn()) FX.pow(x, y, z, { scale: 0.5 + CR[i] * 0.3, color: '#ff9fb4' });
  };
  const bump = (text) => {
    bumpT = BUMP_T; combo = 1; comboT = 0; bumps++;
    if (fxOn()) FX.kick(0.45);
    hud.event('damage'); hud.popup(text, 0, -0.3, 'bad');
  };

  // ---------------------------------------------------------------- run control
  function reset() {
    for (let i = 0; i < nC; i++) { CHP[i] = CHPM[i]; CFL[i] = 0; showClot(i, true); }
    BL.fill(0); SL.fill(0); if (fxOn()) FX.clear?.();
    s = 0; tau = 0; beatT = 0; flowT = 0; ox = oy = 0; runT = 0; started = false; ended = false; endT = 0; heartDone = false;
    score = 0; combo = 1; comboT = 0; bestCombo = 1; xp = 0; level = 1; heat = 0; overheated = false; fireCD = 0;
    bumps = 0; bumpT = 0; rate = 1; popped = 0; perfect = 0; good = 0; bonk = 0; nextGate = 0; L[0] = 0; L[1] = 0; L[2] = 1;
    vb = shell && shell.view === 'shoulder' ? 1 : 0; shipRoll = 0; lockD = 0;
    writePools();
  }
  function finish() {
    ended = true;
    const gatesOn = perfect + good;
    hud.event('win');
    hud.results({ title: 'Through the Heart Gate', lines: [
      ['Score', score], ['Gates on the beat', gatesOn + ' / ' + (GN + 1) + ' (' + perfect + ' perfect)'], ['Bonks (shut valves)', bonk], ['Sticky bumps', bumps],
      ['Clots popped', popped + ' / ' + nC], ['Best combo', '×' + bestCombo], ['Popper', 'L' + level + ' · ' + weapon().name],
      ['Heartbeat', BPM + ' bpm'], ['Time', runT.toFixed(1) + ' s']] }, () => GAME.reset());
  }
  // pass a gate (k < GN) or the heart (k = GN): judged by how close to the beat you cross
  function judge(k) {
    const e = wrapBeat(beatT), heartGate = k === GN, c = heartGate ? null : k;
    const open = heartGate || (e > OPEN_LO && e < OPEN_HI);
    // a valve also needs you inside its triangular opening (heart: always inside)
    let inside = true;
    if (!heartGate) { const o = c * 9, dx = PP[0] - GC[c * 3], dy = PP[1] - GC[c * 3 + 1], dz = PP[2] - GC[c * 3 + 2], u = dx * GF[o + 3] + dy * GF[o + 4] + dz * GF[o + 5], v = dx * GF[o + 6] + dy * GF[o + 7] + dz * GF[o + 8];
      for (const a of [-PI / 2, PI / 6, 5 * PI / 6]) if (u * cos(a) + v * sin(a) > GATE_R / 2 - 0.3) inside = false; }
    const gx = heartGate ? SC.p1[0] : GC[c * 3], gy = heartGate ? SC.p1[1] : GC[c * 3 + 1], gz = heartGate ? SC.p1[2] : GC[c * 3 + 2];
    const clogged = !heartGate && bumpT > 0; // you hit one of its clots on the way in
    if (open && inside && !clogged) {
      const pf = abs(e) < PERFECT || (heartGate && abs(e) < PERFECT * 1.6);
      if (pf) perfect++; else good++;
      bumpCombo();
      const pts = (heartGate ? (pf ? PTS_HEART_PERFECT : PTS_HEART_GOOD) : (pf ? PTS_PERFECT : PTS_GOOD)) * combo; score += pts;
      hud.event('gate'); hud.popup((pf ? 'PERFECT BEAT ♥ +' : 'ON TIME +') + pts, 0, 0.18, pf ? 'good' : 'info');
      if (fxOn()) FX.pow(gx + (cam[0] - gx) * 0.6, gy + (cam[1] - gy) * 0.6, gz + (cam[2] - gz) * 0.6, { scale: heartGate ? 2.2 : 1.3, color: pf ? '#7fe4ff' : '#ffd6c8', text: heartGate ? 'HEART GATE!' : pf ? 'PERFECT!' : 'NICE!' });
      addXP(pf ? 60 : 30);
    } else { bonk++; bump(clogged ? 'BONK · pop the clots first' : inside ? 'BONK · the valve was shut' : 'BONK · aim for the opening'); bumps--; }
  }

  // ---------------------------------------------------------------- camera
  function placeCamera(dt) {
    if (!started) { // the concept's hero view (menu, and ?shot)
      const h = G.hero; cam[0] = h[0]; cam[1] = h[1]; cam[2] = h[2]; YP[0] = h[3]; YP[1] = h[4];
      if (F) { F[0] = h[0]; F[1] = h[1]; F[2] = h[2]; F[3] = h[3]; F[4] = h[4]; F[11] = h[5]; }
    } else {
      frameFn(min(s, sH), FR); rail.at(s, T2);
      if (s > sH) { T2[0] += FR[0] * (s - sH); T2[1] += FR[1] * (s - sH); T2[2] += FR[2] * (s - sH); }
      // view blend (V, Settings → View): 0 cockpit .. 1 shoulder
      const want = shell.view === 'shoulder' ? 1 : 0;
      if (dt > 0) vb += clamp(want - vb, -dt / BLEND_T, dt / BLEND_T); else vb = want; // snaps while paused or in a ?shot
      const b = sstep(0, 1, vb);
      // the pilot position (the ship)
      PP[0] = T2[0] + FR[3] * ox + FR[6] * oy; PP[1] = T2[1] + FR[4] * ox + FR[7] * oy; PP[2] = T2[2] + FR[5] * ox + FR[8] * oy;
      const ax = aim[0] * tanH * aspect, ay = aim[1] * tanH;
      let dx = FR[0] + FR[3] * ax + FR[6] * ay, dy = FR[1] + FR[4] * ax + FR[7] * ay, dz = FR[2] + FR[5] * ax + FR[8] * ay; const dl = hypot(dx, dy, dz);
      const lx = mix(FR[0], dx / dl, LOOK_AIM), ly = mix(FR[1], dy / dl, LOOK_AIM), lz = mix(FR[2], dz / dl, LOOK_AIM);
      const k = dt > 0 ? 1 - exp(-dt * 6) : 1;
      L[0] += (lx - L[0]) * k; L[1] += (ly - L[1]) * k; L[2] += (lz - L[2]) * k; const ll = hypot(L[0], L[1], L[2]);
      rail.yawPitch(L[0] / ll, L[1] / ll, L[2] / ll, YP);
      camBasis();
      // the eye: the ship in the cockpit; over the shoulder behind, above and right of it, kept inside the pilot box
      let jx = 0, jy = 0; const sh = (fxOn() ? FX.shake || 0 : 0) * 0.35 + bumpT * 0.3;
      if (sh > 0 && dt > 0) { jx = (rnd() * 2 - 1) * sh; jy = (rnd() * 2 - 1) * sh; }
      const eb = -SH_BACK * b, er = SH_RIGHT * b, eu = SH_UP * b;
      cam[0] = PP[0] + CB[0] * eb + CB[3] * er + CB[6] * eu; cam[1] = PP[1] + CB[1] * eb + CB[4] * er + CB[7] * eu; cam[2] = PP[2] + CB[2] * eb + CB[5] * er + CB[8] * eu;
      { const rx = cam[0] - T2[0], ry = cam[1] - T2[1], rz = cam[2] - T2[2], u = rx * FR[3] + ry * FR[4] + rz * FR[5], v = rx * FR[6] + ry * FR[7] + rz * FR[8];
        const cu = clamp(u, -BOX_X, BOX_X) - u + jx, cv = clamp(v, -BOX_Y, BOX_Y) - v + jy;
        cam[0] += FR[3] * cu + FR[6] * cv; cam[1] += FR[4] * cu + FR[7] * cv; cam[2] += FR[5] * cu + FR[8] * cv; }
      if (F) { F[0] = cam[0]; F[1] = cam[1]; F[2] = cam[2]; F[3] = YP[0]; F[4] = YP[1]; F[11] = HEART_FOV + 0.08 * clamp(rate - 1, 0, 1); }
      placeShip(b);
      return;
    }
    camBasis();
  }
  function camBasis() { // forward 0..2, right 3..5, up 6..8 from the camera's yaw and pitch (the engine's basis)
    const cy = cos(YP[0]), sy = sin(YP[0]), cp = cos(YP[1]), sp = sin(YP[1]);
    CB[0] = sy * cp; CB[1] = sp; CB[2] = cy * cp; CB[3] = cy; CB[4] = 0; CB[5] = -sy; CB[6] = -sp * sy; CB[7] = cp; CB[8] = -sp * cy;
  }
  // the player's ship (the concept model) at the pilot position, facing the look, banking into moves; hidden in the
  // cockpit, fading in with the blend over the shoulder
  function placeShip(b) {
    qBasis(CB[3], CB[4], CB[5], CB[6], CB[7], CB[8], CB[0], CB[1], CB[2], QF);
    QS2[0] = 0; QS2[1] = 0; QS2[2] = sin(shipRoll / 2); QS2[3] = cos(shipRoll / 2); qmul(QF, QS2, QF);
    const sc = b > 0.01 ? SHIP_S * b * (1 + 0.04 * pulse) : 0;
    for (const m of G.ship.meshes) { const I = m.inst; I[0] = PP[0]; I[1] = PP[1]; I[2] = PP[2]; I[3] = sc; I[4] = QF[0]; I[5] = QF[1]; I[6] = QF[2]; I[7] = QF[3]; m.dirty = true; }
  }
  // test (?debug): the ship's on-screen extent, projecting every vertex of every visible part with the current camera
  function shipNdc() {
    const r = { minX: 1e9, maxX: -1e9, minY: 1e9, maxY: -1e9, n: 0, minDepth: 1e9 }, o = [0, 0, 0];
    for (const m of G.ship.meshes) {
      const I = m.inst, sc = I[3]; if (!(sc > 0)) continue; const q = [I[4], I[5], I[6], I[7]], f = new Float32Array(m.vb);
      for (let k = 0; k < m.nv; k++) {
        const x = f[k * 4] * sc, y = f[k * 4 + 1] * sc, z = f[k * 4 + 2] * sc, tx = 2 * (q[1] * z - q[2] * y), ty = 2 * (q[2] * x - q[0] * z), tz = 2 * (q[0] * y - q[1] * x);
        project(I[0] + x + q[3] * tx + q[1] * tz - q[2] * ty, I[1] + y + q[3] * ty + q[2] * tx - q[0] * tz, I[2] + z + q[3] * tz + q[0] * ty - q[1] * tx, o);
        if (o[2] <= 0) continue; r.n++; r.minX = min(r.minX, o[0]); r.maxX = max(r.maxX, o[0]); r.minY = min(r.minY, o[1]); r.maxY = max(r.maxY, o[1]); r.minDepth = min(r.minDepth, o[2]);
      }
    }
    return r;
  }

  // ---------------------------------------------------------------- the living vessel: pulse, breathing, cells, gates, ship
  function animate(t, dt) {
    const e = wrapBeat(t), ts = e >= 0 ? e : e + BEAT;
    pulse = started || IS_SHOT ? lubdub(ts) : 0.35;
    SC.p0[3] = pulse;
    // light: ahead of the camera along the vessel, the heart itself on the finale straight
    const sl = started ? min(s + 55, sH) : sH; rail.at(sl, T2); frameFn(sl, FR); SC.sun[0] = T2[0] - FR[6] * HB_LIGHT_DROP; SC.sun[1] = T2[1] - FR[7] * HB_LIGHT_DROP; SC.sun[2] = T2[2] - FR[8] * HB_LIGHT_DROP;
    frameFn(min(max(s, 0), sH), FR); SC.p0[0] = FR[0]; SC.p0[1] = FR[1]; SC.p0[2] = FR[2];
    // the walls breathe (chunks scale about their centres; their geometry overlaps so seams stay closed)
    const sc = 1 + 0.03 * pulse;
    for (const m of G.chunks) { if (m.inst[3] !== sc) { m.inst[3] = sc; m.dirty = true; } }
    // cells surge down the vessel on each beat
    flowT += dt * (1 + 1.8 * pulse); if (dt > 0 || !G.flow.placed) { G.flow.place(flowT); G.flow.placed = true; }
    // valve cusps fold open on the beat; the ring's cyan lights flash with it
    const o = openness(e), ang = o * 1.35, sa = sin(ang / 2), ca = cos(ang / 2);
    for (let k = 0; k < GN; k++) {
      const near = !started || abs(GS[k] - s) < 160;
      for (let c = 0; c < 3; c++) {
        const i = k * 3 + c, I = leafM.inst, b = i * 12;
        QS2[0] = 0; QS2[1] = sa; QS2[2] = 0; QS2[3] = ca; QF[0] = LQ[i * 4]; QF[1] = LQ[i * 4 + 1]; QF[2] = LQ[i * 4 + 2]; QF[3] = LQ[i * 4 + 3];
        if (near) { qmul(QF, QS2, QF); I[b + 4] = QF[0]; I[b + 5] = QF[1]; I[b + 6] = QF[2]; I[b + 7] = QF[3]; I[b + 9] = o; }
        I[b + 3] = started ? 1 : 0;
      }
      ringM.inst[k * 12 + 9] = o; ringM.inst[k * 12 + 3] = started ? 1 : 0; plateM.inst[k * 12 + 3] = started ? 1 : 0; plateM.inst[k * 12 + 9] = o;
    }
    leafM.dirty = ringM.dirty = plateM.dirty = true;
    // clots wobble with the pulse and flash when hit; hidden on the concept view (they are game elements)
    for (let i = 0; i < nC; i++) { const m = clotM[CVAR[i]], b = CSLOT[i] * 12; m.inst[b + 3] = CAL[i] && started ? CR[i] * (1 + 0.06 * pulse) : 0; m.inst[b + 9] = CFL[i] * 6; }
    for (const m of clotM) m.dirty = true;
    // the ship on the concept view (menu, ?shot): the concept offset SHIP_AHEAD m ahead of the hero station, as before.
    // In play there is no guide: the ship is the player's (placeShip, after the camera).
    if (!started) {
      const ss = G.sHero + SHIP_AHEAD, sc2 = min(ss, sH);
      frameFn(sc2, FR); rail.at(sc2, T2); const ex = max(0, ss - sH);
      const offR = shipOff[0], offU = shipOff[1], offF = shipOff[2] + ex;
      const x = T2[0] + FR[3] * offR + FR[6] * offU + FR[0] * offF, y = T2[1] + FR[4] * offR + FR[7] * offU + FR[1] * offF, z = T2[2] + FR[5] * offR + FR[8] * offU + FR[2] * offF;
      qBasis(FR[3], FR[4], FR[5], FR[6], FR[7], FR[8], FR[0], FR[1], FR[2], QF); QS2[0] = shipQ0[0]; QS2[1] = shipQ0[1]; QS2[2] = shipQ0[2]; QS2[3] = shipQ0[3]; qmul(QF, QS2, QF);
      for (const m of G.ship.meshes) { const I = m.inst; I[0] = x; I[1] = y; I[2] = z; I[4] = QF[0]; I[5] = QF[1]; I[6] = QF[2]; I[7] = QF[3]; I[3] = G.ship.scale * (1 + 0.04 * pulse); m.dirty = true; }
    }
  }

  // ---------------------------------------------------------------- frame
  function fire(onBeat) {
    const w = weapon(), ax = aim[0] * tanH * aspect, ay = aim[1] * tanH;
    let dx = CB[0] + CB[3] * ax + CB[6] * ay, dy = CB[1] + CB[4] * ax + CB[7] * ay, dz = CB[2] + CB[5] * ax + CB[8] * ay; const dl = hypot(dx, dy, dz);
    // the aim ray runs from the camera through the reticle; bolts leave the ship and meet it at the locked clot (or 60 m)
    const D = lockD > 3 ? lockD : 60, tx = cam[0] + dx / dl * D, ty = cam[1] + dy / dl * D, tz = cam[2] + dz / dl * D;
    const vbe = sstep(0, 1, vb), dn = 0.5 * (1 - vbe), fw = NOSE * SHIP_S * vbe, wd = 1 - vbe * 0.4;
    for (let b = 0; b < w.bolts; b++) {
      const side = (w.bolts === 1 ? 0 : w.bolts === 2 ? (b ? 0.7 : -0.7) : (b - 1) * 0.7) * wd, ang = w.bolts === 3 ? (b - 1) * w.spread : 0;
      const x0 = PP[0] - CB[6] * dn + CB[3] * side + CB[0] * fw, y0 = PP[1] - CB[7] * dn + CB[1] * fw, z0 = PP[2] - CB[8] * dn + CB[5] * side + CB[2] * fw;
      let vx = tx - x0 + CB[3] * ang * D, vy = ty - y0, vz = tz - z0 + CB[5] * ang * D; const vl = hypot(vx, vy, vz);
      const i = boltNext; boltNext = (boltNext + 1) % NBOLT;
      BX[i * 3] = x0; BX[i * 3 + 1] = y0; BX[i * 3 + 2] = z0;
      BV[i * 3] = vx / vl * BOLT_SPEED + FR[0] * v0; BV[i * 3 + 1] = vy / vl * BOLT_SPEED + FR[1] * v0; BV[i * 3 + 2] = vz / vl * BOLT_SPEED + FR[2] * v0;
      BL[i] = BOLT_LIFE; BD[i] = w.dmg * (onBeat ? 2 : 1); BS[i] = w.size * (onBeat ? 1.4 : 1); BB[i] = onBeat ? 1 : 0;
    }
    hud.event('fire');
  }
  // the test bot (?debug, heartGate.bot = true): aims at the nearest live clot ahead, fires on beats, surges when late
  function botInput(input) {
    let best = -1, bd = 1e9;
    for (let i = 0; i < nC; i++) { if (!CAL[i]) continue; project(CXp[i], CYp[i], CZp[i], PJ); if (PJ[2] > 2 && PJ[2] < 70 && abs(PJ[0]) < 1 && abs(PJ[1]) < 1 && PJ[2] < bd) { bd = PJ[2]; best = i; } }
    if (best >= 0) { project(CXp[best], CYp[best], CZp[best], PJ); input.gunner.x = PJ[0]; input.gunner.y = PJ[1]; } else { input.gunner.x *= 0.9; input.gunner.y *= 0.9; }
    input.gunner.fire = best >= 0; input.pilot.x = 0; input.pilot.y = 0;
    input.gunner.alt = wrapBeat(runT - tau) > 0.06;
  }

  function update(dt, input) {
    if (bot && started && !ended) botInput(input);
    aim[0] = clamp(input.gunner.x, -1, 1); aim[1] = clamp(input.gunner.y, -1, 1);
    if (fxOn() && dt > 0) dt *= FX.timeScale ?? 1;
    if (dt <= 0 || (ended && endT <= 0)) { animate(IS_SHOT && F ? F[8] : beatT, 0); if (IS_SHOT && started) { L[0] = 0; L[1] = 0; L[2] = 0; } placeCamera(0); writePools(); return; }
    if (!started) { started = true; s = 0; tau = 0; }
    runT += dt; beatT += dt;
    // schedule rate: surge (Shift) when late, a gentle assist toward the beat, a short slow-down after a bump
    const lag = wrapBeat(runT - tau);
    rate = input.gunner.alt ? BOOST_RATE : 1 + clamp(lag * 0.4, -ASSIST, ASSIST);
    if (bumpT > 0) { bumpT = max(0, bumpT - dt); rate *= BUMP_RATE; }
    const sPrev = s; tau += dt * rate; s = S(tau);
    if (heartDone) s = max(s, sPrev + v0 * dt); // after the heart, fly on into the light
    // pilot offset; over the shoulder the box gives up the camera's right and up offsets, so the eye stays in the box too
    const k = 1 - exp(-dt * 3.2), vbe = sstep(0, 1, vb), ox0 = ox;
    ox += (clamp(clamp(input.pilot.x, -1, 1) * BOX_X, -BOX_X, BOX_X - SH_RIGHT * vbe) - ox) * k; oy += (clamp(clamp(input.pilot.y, -1, 1) * BOX_Y, -BOX_Y, BOX_Y - SH_UP * vbe) - oy) * k;
    shipRoll += (clamp(-(ox - ox0) / dt * 0.12, -0.5, 0.5) - shipRoll) * (1 - exp(-dt * 5)); // bank into sideways moves
    animate(beatT, dt);
    placeCamera(dt);

    // weapon: heat, overheat lock, rate cooldown
    const w = weapon();
    heat = max(0, heat - w.cool * dt); if (overheated && heat < 0.35) { overheated = false; hud.event('cooled'); }
    fireCD = max(-0.05, fireCD - dt);
    if (input.gunner.fire && !overheated && fireCD <= 0 && !heartDone) {
      fire(abs(wrapBeat(beatT)) < ONBEAT_SHOT); fireCD += 1 / w.rate; heat += w.heat;
      if (heat >= 1) { heat = 1; overheated = true; hud.event('overheat'); hud.popup('OVERHEAT', 0, -0.15, 'bad'); }
    }
    comboT -= dt; if (comboT <= 0) { comboT = 0; combo = 1; }

    // bolts vs clots (segment vs sphere)
    for (let b = 0; b < NBOLT; b++) {
      if (BL[b] <= 0) continue;
      const x0 = BX[b * 3], y0 = BX[b * 3 + 1], z0 = BX[b * 3 + 2], mx = BV[b * 3] * dt, my = BV[b * 3 + 1] * dt, mz = BV[b * 3 + 2] * dt, mm = mx * mx + my * my + mz * mz;
      BX[b * 3] += mx; BX[b * 3 + 1] += my; BX[b * 3 + 2] += mz; BL[b] -= dt;
      for (let i = 0; i < nC; i++) {
        if (!CAL[i]) continue;
        const fx = x0 - CXp[i], fy = y0 - CYp[i], fz = z0 - CZp[i], R = CR[i] * 1.1 + BS[b];
        if (fx * fx + fy * fy + fz * fz > (R + 4) * (R + 4) + mm * 4) continue;
        const t = clamp(-(fx * mx + fy * my + fz * mz) / (mm || 1), 0, 1), cx = fx + mx * t, cy = fy + my * t, cz = fz + mz * t;
        if (cx * cx + cy * cy + cz * cz < R * R) { BL[b] = 0; damage(i, BD[b], BB[b] === 1, x0 + mx * t, y0 + my * t, z0 + mz * t); break; }
      }
    }
    // flying into a clot: it pops (no points) and bumps you off the beat
    for (let i = 0; i < nC; i++) {
      if (!CAL[i]) continue;
      const dx = PP[0] - CXp[i], dy = PP[1] - CYp[i], dz = PP[2] - CZp[i], R = CR[i] * 0.85 + 0.5;
      if (dx * dx + dy * dy + dz * dz < R * R) { showClot(i, false); sparks(CXp[i], CYp[i], CZp[i], 12, 4, 1); if (fxOn()) FX.splat(CXp[i], CYp[i], CZp[i], { color: '#7a1030', scale: 0.6, text: 'SPLOT' }); bump('BONK · sticky clot'); }
    }
    // gates and the heart
    while (nextGate < GN && sPrev < GS[nextGate] && s >= GS[nextGate]) { judge(nextGate); nextGate++; }
    if (!heartDone && s >= sH - 0.5) { heartDone = true; judge(GN); nextGate = GN + 1; endT = 1.1; }
    if (heartDone && !ended) { endT -= dt; if (endT <= 0) { endT = 0; finish(); } }
    // sparks
    const drag = exp(-dt * 2.5);
    for (let i = 0; i < NSPARK; i++) { if (SL[i] <= 0) continue; SL[i] -= dt; SX[i * 3] += SV[i * 3] * dt; SX[i * 3 + 1] += SV[i * 3 + 1] * dt; SX[i * 3 + 2] += SV[i * 3 + 2] * dt; SV[i * 3] *= drag; SV[i * 3 + 1] *= drag; SV[i * 3 + 2] *= drag; }
    for (let i = 0; i < nC; i++) if (CFL[i] > 0) CFL[i] = max(0, CFL[i] - dt);
    writePools();
  }

  function writePools() {
    if (!P) return;
    for (let b = 0; b < NBOLT; b++) {
      const on = BL[b] > 0, vl = hypot(BV[b * 3], BV[b * 3 + 1], BV[b * 3 + 2]) || 1, ob = BB[b];
      for (let k = 0; k < 3; k++) {
        const back = k * 0.6 / vl, sz = on ? BS[b] * (1 - k * 0.25) : 0;
        // normal shots are warm white-pink; on-beat shots cyan (the HG-M1 accent)
        setPt(BO0 + b * 3 + k, BX[b * 3] - BV[b * 3] * back, BX[b * 3 + 1] - BV[b * 3 + 1] * back, BX[b * 3 + 2] - BV[b * 3 + 2] * back, sz, ob ? 0.8 : 4.5 - k, ob ? 4 - k * 0.8 : 2.4 - k * 0.5, ob ? 4.2 - k * 0.8 : 2.0 - k * 0.4, 0);
      }
    }
    for (let i = 0; i < NSPARK; i++) {
      const c = SL[i] > 0 ? SL[i] / SL0[i] : 0;
      setPt(SP0 + i, SX[i * 3], SX[i * 3 + 1], SX[i * 3 + 2], c > 0 ? SS[i] * (0.4 + 0.6 * c) : 0, (3.2 * c + 0.4) * c, (1.0 * c * c + 0.1) * c, (1.2 * c * c + 0.15) * c, 0);
    }
  }

  // ---------------------------------------------------------------- HUD feed
  function post(view) {
    F = view.F; tanH = view.tan; aspect = view.aspect;
    if (!started && !ended) placeCamera(0); // hold the concept view before the run
    const w = weapon();
    stats.score = score; stats.combo = combo; stats.level = level; stats.xp = xp;
    stats.xpNext = level < WEAPONS.length ? WEAPONS[level].xp : WEAPONS[WEAPONS.length - 1].xp; stats.heat = heat; stats.overheated = overheated;
    stats.counterValue = perfect + good + bonk; stats.weaponName = w.name; stats.pulse = pulse;
    hud.set(stats);
    if (!MK || !started) return;
    const fx = view.f[0], fy = view.f[1], fz = view.f[2], rx = view.r[0], rz = view.r[2], ux = view.u[0], uy = view.u[1], uz = view.u[2], cx = F[0], cy = F[1], cz = F[2];
    const ax = aim[0], ay = aim[1], ta = view.tan * view.aspect, tv = view.tan;
    let b1 = -1, b2 = -1, d1 = 0.35 * 0.35, d2 = d1, nb = 0, z1 = 0;
    for (let i = 0; i < nC; i++) {
      if (!CAL[i]) continue;
      const dx = CXp[i] - cx, dy = CYp[i] - cy, dz = CZp[i] - cz, z = dx * fx + dy * fy + dz * fz, rR = dx * rx + dz * rz, rU = dx * ux + dy * uy + dz * uz;
      if (z > 0.5 && z < LOCK_RANGE) { const nx = rR / (z * ta) - ax, ny = rU / (z * tv) - ay, e = nx * nx + ny * ny; if (e < d1) { d2 = d1; b2 = b1; d1 = e; b1 = i; z1 = z; } else if (e < d2) { d2 = e; b2 = i; } }
      if (dx * dx + dy * dy + dz * dz < RADAR_RANGE * RADAR_RANGE) { const o = nb * 4; BLP[o] = rR; BLP[o + 1] = rU; BLP[o + 2] = z; BLP[o + 3] = z > 0 && z < 60 && rR * rR + rU * rU < (CR[i] + 1.5) ** 2 ? 2 : 0; nb++; }
    }
    lockD = b1 >= 0 ? z1 : 0;
    let nm = 0;
    const mark = (x, y, z, kind, label) => {
      const dx = x - cx, dy = y - cy, dz = z - cz, d = dx * fx + dy * fy + dz * fz; if (d <= 0.5) return;
      const o = nm * 6; MK[o] = (dx * rx + dz * rz) / (d * ta); MK[o + 1] = (dx * ux + dy * uy + dz * uz) / (d * tv); MK[o + 2] = d; MK[o + 3] = kind; MK[o + 4] = hypot(dx, dy, dz); MK[o + 5] = label; nm++;
    };
    // the next gate first; then one clot lock, and only if it isn't sitting on the gate label (labels stacked up before)
    const e = wrapBeat(runT - tau), lab = abs(e) < PERFECT ? 1 : e > OPEN_LO && e < OPEN_HI ? 2 : e >= OPEN_HI ? 3 : 4;
    if (nextGate < GN) mark(GC[nextGate * 3], GC[nextGate * 3 + 1], GC[nextGate * 3 + 2], 1, lab);
    else if (nextGate === GN) mark(SC.p1[0], SC.p1[1], SC.p1[2], 1, 5);
    if (b1 >= 0) { const g0 = nm; mark(CXp[b1], CYp[b1], CZp[b1], 0, 0); if (nm > g0 && g0 > 0) { const o = g0 * 6, ddx = MK[o] - MK[0], ddy = MK[o + 1] - MK[1]; if (ddx * ddx + ddy * ddy < 0.22 * 0.22) nm = g0; } }
    const gx = nextGate < GN ? GC[nextGate * 3] : SC.p1[0], gy = nextGate < GN ? GC[nextGate * 3 + 1] : SC.p1[1], gz = nextGate < GN ? GC[nextGate * 3 + 2] : SC.p1[2];
    { const dx = gx - cx, dy = gy - cy, dz = gz - cz, o = nb * 4; BLP[o] = dx * rx + dz * rz; BLP[o + 1] = dx * ux + dy * uy + dz * uz; BLP[o + 2] = dx * fx + dy * fy + dz * fz; BLP[o + 3] = 1; nb++; }
    hud.marks(MK, nm); hud.blips(BLP, nb);
  }

  return { id: 'body-heart', title: 'Body Defenders: Heart Gate', skin: 'canopy', palette: 'Coral', weapons: WEAPONS, bpm: BPM, prepare, init, update, post, reset,
    get debug() { return window.heartGate ? window.heartGate.state : null; } };
})();
