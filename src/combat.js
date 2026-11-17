// ============================================================================
// combat.js: Reef Run controls and weapons (GAME_API.md "Combat: throttle, weapons, proximity, Super Easy").
// carpetshark, 2026-11-16: "W and S should go faster and slow (allow slow to slow speed with shift to be a parking brake or a turbo ..
// then also add a proxmity sensor. and in super easy mode (new mode), let user be auto-targeting with AI assistance and they only
// have to shoot. then make a sound board ... also allow lasers as a 1 2 primary / secondary .. space is shoot as well", then
// "1 is blasters, 2 is lasers (as you'd expect a mining laster needs time to blow the rock)".
//   - Throttle: W / S (turret; Q / E in pilot mode) move a throttle lever 0.4×-1.8× cruise; Shift+W turbo 2.5× on a meter;
//     Shift+S the parking brake (0.05×, released on let go). Pad: left stick Y (1 player turret), L3 turbo, R3 brake.
//   - Weapons: 1 Blaster (reefrun.js WEAPONS and its levels), 2 Mining laser: a continuous beam that heats a rock until it
//     bursts (bigger rocks take longer), with its own heat meter. Pad: Y or d-pad down cycles. Each split-screen gunner has their own.
//   - Proximity sensor: rocks on a collision course and homing drifters within 40 m: edge glows, a tightening ring round the
//     reticle, PROXIMITY under 1.5 s, an accelerating beep (only if mapped on the sound board).
//   - Super Easy (DIFF.supereasy, reefrun.js): AI aim assist; the turret eases onto the best target, the player only fires.
// Everything reads the run through the `X` view reefrun.js passes to init (small, commented hooks there). Drawing: the beam,
// heated rocks and turbo speed lines are G.lines glow segments (HDR, after holo.js's route in the same buffer); the HUD is one
// 2D canvas. Load-time allocation only.
// ============================================================================
const COMBAT = (() => {
  const { min, max, abs, hypot, sqrt, exp, sin, cos, atan2, floor, round, PI } = Math, TAU = PI * 2;
  const cl = (x, a, b) => (x < a ? a : x > b ? b : x), sstep = (a, b, x) => { const t = cl((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const wrap = (a) => { a %= TAU; return a > PI ? a - TAU : a <= -PI ? a + TAU : a; };
  const REDUCED = (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches) || (typeof QS !== 'undefined' && QS.has('reduced'));
  // ---------------------------------------------------------------- tuning (one table each)
  const THR = {
    min: 0.4, max: 1.8,   // the throttle lever (× cruise SPEED); W / S move it at `rate` per s and it holds where you leave it
    rate: 0.9,
    turbo: 2.5, turboDur: 2.2, turboRefill: 6, turboMin: 0.25, // turbo: × cruise; a full meter lasts turboDur s; refills fully in turboRefill s; needs turboMin to start; empty = cooling until full
    brake: 0.05,          // parking brake (× cruise), held
    stickUp: 1.8, stickDown: 0.4, // pad left stick Y: spring-loaded, straight to these at full deflection
    timeCap: 3000,        // tally time bonus cap (before the difficulty multiplier): faster than cruise pays, but a turbo run can't run away with it
  };
  const LASER = {
    range: 160,
    burn: [0.6, 1.5, 3.0], sizeM: 1.1, sizeL: 1.9, // seconds to burst a small / medium / large rock at level 1 (radius < 1.1, < 1.9 m, else large)
    level: [1, 0.85, 0.72, 0.6, 0.5],             // × burn time per blaster level (the laser levels with the same XP)
    names: ['Mining laser', 'Mining laser Mk II', 'Twin cutter', 'Deep cutter', 'Core drill'],
    heat: 0.26, cool: 0.42, resume: 0.3,           // beam heat per s held (× DIFF.heat), cooling per s, overheat clears below `resume`
    rockCool: 0.3, grace: 0.5,                    // a heated rock cools at rockCool/s once the beam has been off it for grace s
    shot: 0.1,                                    // accuracy: one "shot" per this many s of beam, a hit when it is on a rock
    core: [4.2, 9.5, 10.5], glow: [0.35, 1.1, 1.4], // HDR colours: white-cyan core in a teal glow
  };
  const PROX = { range: 40, margin: 0.6, warn: 1.5, ring: 3, n: 4 };
  const ASSIST = { cone: 0.95, range: 130, threat: 60, hold: 0.7, better: 0.6, rate: REDUCED ? 3 : 5, maxRate: REDUCED ? 2 : 3, manual: 1.5 };
  const W_STORE = 'reef-run:weapon';

  // ---------------------------------------------------------------- state
  let G = null, shell = null, hud = null, X = null, L = null, cap = 0, on = { prox: true };
  const WSEL = new Uint8Array(4), LH = new Float32Array(4), LOV = new Uint8Array(4), BON = new Uint8Array(4), BHIT = new Int32Array(4).fill(-1);
  const BO = new Float64Array(4 * 6), BN = new Uint8Array(4), BE = new Float64Array(4 * 3), SPK = new Float32Array(4), ACC = new Float32Array(4), BURN = new Float32Array(4);
  let HEAT = null, HN = null, HQ = null, HSEED = null; // per target: heat 0..1, contact normal, seconds since beamed, crack seed
  try { const w = localStorage.getItem(W_STORE); if (w === 'laser') WSEL[0] = 1; } catch {}
  if (typeof QS !== 'undefined' && (QS.get('weapon') === 'laser' || QS.get('weapon') === 'blaster')) WSEL[0] = QS.get('weapon') === 'laser' ? 1 : 0;
  // throttle
  let tset = 1, thr = 1, stick = 0, turboM = 1, turboLock = false, turboOn = false, brakeOn = false, tCur = 1;
  // input edges: keys 1 / 2, pad buttons Y, d-pad down, L3, R3 (per pad index)
  let kWant = -1; const PY = new Uint8Array(16), PL3 = new Uint8Array(16), PR3 = new Uint8Array(16), PDD = new Uint8Array(16);
  let padTurbo = false, padBrake = false;
  // assist
  const AMAN = new Float32Array(4), ATGT = new Int32Array(4).fill(-1), AHOLD = new Float32Array(4), AON = new Uint8Array(4);
  // proximity: threats [dirX, dirY, dirZ (unit, world), tti, dist, homer] × n
  const PT = new Float64Array(PROX.n * 6); let pn = 0, pmin = 9, beepT = 0;
  const ED = new Float64Array(4);
  // speed lines (turbo FX): ship-frame offsets
  const NSL = 56, SLX = new Float32Array(NSL), SLY = new Float32Array(NSL), SLZ = new Float32Array(NSL), SLW = new Float32Array(NSL);
  for (let i = 0; i < NSL; i++) { const a = (i * 2.399963) % TAU, r = 3.2 + ((i * 7919) % 97) / 97 * 8; SLX[i] = cos(a) * r; SLY[i] = sin(a) * r * 0.75; SLZ[i] = ((i * 4111) % 89) / 89 * 75 - 12; SLW[i] = 0.6 + ((i * 131) % 13) / 13 * 0.8; }
  let tPrev = -1, tNow = 0, fdt = 0, fxK = 0;

  // ---------------------------------------------------------------- set-up
  function init(G_, shell_, X_) {
    G = G_; shell = shell_; hud = shell_.hud; X = X_;
    if (!G.lines) G.lines = { data: new Float32Array(600 * 16), n: 0, ghost: 0.2, scan: 0, scanRate: 0 }; // holo.js normally owns it; we append after its route
    L = G.lines; cap = L.data.length >> 4;
    HEAT = new Float32Array(X.nT); HN = new Float32Array(X.nT * 3); HQ = new Float32Array(X.nT).fill(99); HSEED = new Float32Array(X.nT);
    for (let i = 0; i < X.nT; i++) HSEED[i] = ((i * 2654435761) >>> 0) / 4294967296;
    if (typeof QS !== 'undefined' && QS.has('debug')) window.reefCombat = API;
    if (typeof document !== 'undefined') { buildHud();
      addEventListener('keydown', (e) => { const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
        if (e.code === 'Digit1' || e.code === 'Numpad1') kWant = 0; else if (e.code === 'Digit2' || e.code === 'Numpad2') kWant = 1; }); }
  }
  function reset() {
    tset = 1; thr = 1; stick = 0; turboM = 1; turboLock = turboOn = brakeOn = false; tCur = 1;
    LH.fill(0); LOV.fill(0); BON.fill(0); BHIT.fill(-1); SPK.fill(0); ACC.fill(0); BURN.fill(0); AMAN.fill(0); ATGT.fill(-1); AHOLD.fill(0); AON.fill(0);
    if (HEAT) { HEAT.fill(0); HQ.fill(99); }
    pn = 0; pmin = 9; beepT = 0; fxK = 0; for (let p = 1; p < 4; p++) WSEL[p] = 0;
  }
  const event = (n) => { if (hud) hud.event(n); };
  function select(p, w) {
    w = w ? 1 : 0; if (WSEL[p] === w) return; WSEL[p] = w; BON[p] = 0; BHIT[p] = -1; event('weapon');
    if (p === 0) try { localStorage.setItem(W_STORE, w ? 'laser' : 'blaster'); } catch {}
    if (hud && X && X.live) { const hp = hud.player; if (X.mpRun) hud.player = p; hud.popup(w ? 'MINING LASER' : 'BLASTER', 0, -0.42, 'info'); hud.player = hp; }
  }

  // ---------------------------------------------------------------- input (reefrun.js update, each frame, before the look is stepped)
  function input(dt, inp) {
    const R = shell && shell.raw; if (!R) return;
    const K = R.keys, live = shell.state === 'run' && !shell.open, tur = X.turret;
    // turret: W / S are the throttle, so they no longer look up and down (the arrows still do)
    if (tur) {
      const ky = (K.has('ArrowUp') ? 1 : 0) - (K.has('ArrowDown') ? 1 : 0);
      if (inp.look.ky) inp.look.ky = ky;
      if (inp.mp) for (let q = 0; q < inp.mp.n; q++) { const s = inp.mp.p[q]; if (s.dev === 'kbm' && s.look.ky) s.look.ky = ky; }
    }
    // weapons: 1 / 2 (keyboard + mouse player), Y or d-pad down on a pad (that pad's gunner)
    if (kWant >= 0) { let kp = 0; if (X.mpRun && inp.mp) for (let q = 0; q < inp.mp.n; q++) if (inp.mp.p[q].dev === 'kbm') { kp = q; break; } if (live) select(kp, kWant); kWant = -1; } // a quick tap is caught by the keydown listener
    const gp = R.pads(); padTurbo = padBrake = false; let padY = 0;
    if (gp) for (let i = 0; i < gp.length && i < 16; i++) {
      const p = gp[i]; if (!p || !p.connected) { PY[i] = PL3[i] = PR3[i] = PDD[i] = 0; continue; }
      const b = (j) => !!(p.buttons[j] && (p.buttons[j].pressed || p.buttons[j].value > 0.35));
      const y = b(3), dd = b(13), l3 = b(10), r3 = b(11);
      if (live && ((y && !PY[i]) || (dd && !PDD[i]))) {
        let who = 0; if (X.mpRun && inp.mp) { who = -1; for (let q = 0; q < inp.mp.n; q++) if (inp.mp.p[q].dev === 'pad' && inp.mp.p[q].pad === i) who = q; }
        if (who >= 0) select(who, WSEL[who] ? 0 : 1);
      }
      PY[i] = y ? 1 : 0; PDD[i] = dd ? 1 : 0; PL3[i] = l3 ? 1 : 0; PR3[i] = r3 ? 1 : 0;
      if (l3) padTurbo = true; if (r3) padBrake = true;
    }
    // pad left stick Y is the throttle in one-player turret mode (spring-loaded); it stops pitching the look there
    if (tur && !X.mpRun && R.pad.n && abs(R.pad.pilotY) > 0.05) { padY = R.pad.pilotY; if (live) inp.look.sy = cl(inp.look.sy - padY, -1, 1); }
    // throttle keys: turret W / S, pilot Q / E (WASD steer there); Shift makes them turbo / brake
    const sh = K.has('ShiftLeft') || K.has('ShiftRight'), up = live && (tur ? K.has('KeyW') : K.has('KeyE')), dn = live && (tur ? K.has('KeyS') : K.has('KeyQ'));
    const wantT = live && ((sh && up) || padTurbo), wantB = live && ((sh && dn) || padBrake);
    if (!X.live) { thr = 1; turboOn = brakeOn = false; return; }
    if (!sh) { if (up) tset += THR.rate * dt; if (dn) tset -= THR.rate * dt; tset = cl(tset, THR.min, THR.max); }
    stick = padY > 0 ? 1 + (THR.stickUp - 1) * padY : padY < 0 ? 1 + (1 - THR.stickDown) * padY : 0;
    // turbo: drains the meter; empty = cooling until it is full again; let go early and it refills, usable again above turboMin
    if (wantT && X.boost > 0) { // crystal charge: the turbo spends it first and leaves the meter alone (reefrun.js; it was the old alt-fire boost)
      if (!turboOn) { event('turbo'); hud.popup('CRYSTAL TURBO', 0, -0.32, 'info'); } turboOn = true; X.spendBoost(dt * 0.35);
    } else if (wantT && !turboLock && turboM > 0 && (turboOn || turboM >= THR.turboMin)) {
      if (!turboOn) { event('turbo'); hud.popup('TURBO', 0, -0.32, 'info'); } turboOn = true; turboM -= dt / THR.turboDur;
      if (turboM <= 0) { turboM = 0; turboOn = false; turboLock = true; hud.popup('TURBO COOLING', 0, -0.32, 'bad'); }
    } else { turboOn = false; turboM = min(1, turboM + dt / THR.turboRefill); if (turboLock && turboM >= 1) turboLock = false; }
    const wasB = brakeOn; brakeOn = wantB && !turboOn; if (brakeOn && !wasB) { event('brake'); hud.popup('PARKING BRAKE', 0, -0.32, 'info'); }
    thr = brakeOn ? THR.brake : turboOn ? THR.turbo : stick || tset;
  }
  // tally: the time bonus (par = the rail at cruise + pad); capped, so going fast pays but a turbo run can't run away with it
  const timeBonus = (par, t, m) => round(cl((par - t) * 100, 0, THR.timeCap) * m);

  // ---------------------------------------------------------------- Super Easy aim assist (reefrun.js update, after the look step)
  function assist(dt, inp) {
    tick(dt);
    const DF = X.DF; if (!DF.assist || !X.turret || !X.live) { AON.fill(0); return; }
    const n = X.mpRun ? X.NP : 1;
    for (let p = 0; p < n; p++) {
      const T = X.mpRun ? X.TTS[p] : X.TT; if (!T) continue;
      if (X.mpRun && inp.mp && inp.mp.p[p].bot) { AON[p] = 0; continue; }
      if (T.active) AMAN[p] = ASSIST.manual; else AMAN[p] = max(0, AMAN[p] - dt);
      if (AMAN[p] > 0) { AON[p] = 0; ATGT[p] = -1; continue; } // the player looks: assist waits ASSIST.manual s, then resumes
      const ox = X.mpRun ? X.EYE[p * 3] : X.eye[0], oy = X.mpRun ? X.EYE[p * 3 + 1] : X.eye[1], oz = X.mpRun ? X.EYE[p * 3 + 2] : X.eye[2];
      AHOLD[p] -= dt;
      let bi = ATGT[p], bs = bi >= 0 && X.TAL[bi] ? pickScore(bi, ox, oy, oz, T) : 1e9; if (bs >= 1e9) bi = -1;
      if (bi < 0 || AHOLD[p] <= 0) { // re-pick: nearest threat first, then rocks in the cone; a new pick must be clearly better (no flicking)
        let ni = -1, ns = 1e9;
        for (let i = 0; i < X.nT; i++) { if (!X.TAL[i]) continue; let taken = false; for (let q = 0; q < n; q++) if (q !== p && ATGT[q] === i && AON[q]) taken = true; const sc = pickScore(i, ox, oy, oz, T) * (taken ? 1.6 : 1); if (sc < ns) { ns = sc; ni = i; } }
        if (ni >= 0 && (bi < 0 || ns < bs * ASSIST.better)) { bi = ni; bs = ns; }
        ATGT[p] = bi; AHOLD[p] = ASSIST.hold;
      }
      AON[p] = bi >= 0 ? 1 : 0; if (bi < 0) continue;
      // aim (with blaster lead: bolts carry the ship's velocity; the laser is instant)
      const F = X.FR, d0 = hypot(X.TX[bi] - ox, X.TY[bi] - oy, X.TZ[bi] - oz), tl = WSEL[p] ? 0 : d0 / X.bolt, mv = bi >= X.nD0 && X.DST[bi] === 1 ? 1 : 0, sp = X.spd;
      const dx = X.TX[bi] + (X.TVX[bi] * mv - F[0] * sp) * tl - ox, dy = X.TY[bi] + (X.TVY[bi] * mv - F[1] * sp) * tl - oy, dz = X.TZ[bi] + (X.TVZ[bi] * mv - F[2] * sp) * tl - oz, d = hypot(dx, dy, dz) || 1;
      const f = (dx * F[0] + dy * F[1] + dz * F[2]) / d, r = (dx * F[3] + dy * F[4] + dz * F[5]) / d, u = (dx * F[6] + dy * F[7] + dz * F[8]) / d;
      const wy = atan2(r, f), wp = Math.asin(cl(u, -1, 1)), ey = wrap(wy - T.yaw), ep = wp - T.pitch, k = 1 - exp(-dt * ASSIST.rate), m = ASSIST.maxRate * dt;
      T.yaw = wrap(T.yaw + cl(ey * k, -m, m)); T.pitch = cl(T.pitch + cl(ep * k, -m, m), -T.pitchMax, T.pitchMax); T.idle = 0; // eased and rate-limited: smooth, never a snap
    }
  }
  function pickScore(i, ox, oy, oz, T) { // lower is better; 1e9 = not a candidate
    const dx = X.TX[i] - ox, dy = X.TY[i] - oy, dz = X.TZ[i] - oz, d = hypot(dx, dy, dz); if (d < 4 || d > ASSIST.range) return 1e9;
    const homer = i >= X.nD0 && X.DRAM[i] && X.DST[i] === 1;
    const F = X.FR, pF = dx * F[0] + dy * F[1] + dz * F[2], lx = dx - F[0] * pF, ly = dy - F[1] * pF, lz = dz - F[2] * pF, onPath = pF > 0 && pF < 50 && lx * lx + ly * ly + lz * lz < (X.TR[i] + 1.5) ** 2;
    if ((homer || onPath) && d < ASSIST.threat) return d * 0.25; // threats first, nearest first
    // look direction now (rail frame + turret yaw / pitch)
    const cy = cos(T.yaw), sy = sin(T.yaw), cp = cos(T.pitch), sp = sin(T.pitch);
    const lxx = cp * (cy * F[0] + sy * F[3]) + sp * F[6], lyy = cp * (cy * F[1] + sy * F[4]) + sp * F[7], lzz = cp * (cy * F[2] + sy * F[5]) + sp * F[8];
    const a = Math.acos(cl((dx * lxx + dy * lyy + dz * lzz) / d, -1, 1)); if (a > ASSIST.cone) return 1e9;
    return 20 + a * 60 + d * 0.4 + (pF < 0 ? 45 : 0); // rocks the ship has passed are receding: last choice
  }

  // ---------------------------------------------------------------- mining laser (reefrun.js update, per gunner p, with use(p) in effect)
  const laserOn = (p) => WSEL[p] === 1;
  function beam(p, dt, fireIn) {
    let h = LH[p]; const firing = fireIn && !LOV[p];
    if (firing) { h += LASER.heat * (X.DF.heat || 1) * dt; if (h >= 1) { h = 1; LOV[p] = 1; event('overheat'); hud.popup('LASER OVERHEAT', 0, -0.15, 'bad'); } }
    else { h = max(0, h - LASER.cool * dt); if (LOV[p] && h < LASER.resume) LOV[p] = 0; }
    LH[p] = h; BON[p] = firing && !LOV[p] ? 1 : 0;
    if (!BON[p]) { BHIT[p] = -1; return; }
    // the aim ray from this gunner's eye through the reticle
    const E = X.eye, C = X.CB, ax = X.aim[0] * X.tanH * X.aspect, ay = X.aim[1] * X.tanH;
    let dx = C[0] + C[3] * ax + C[6] * ay, dy = C[1] + C[4] * ax + C[7] * ay, dz = C[2] + C[5] * ax + C[8] * ay; const dl = hypot(dx, dy, dz) || 1; dx /= dl; dy /= dl; dz /= dl;
    let bi = -1, bt = LASER.range;
    for (let i = 0; i < X.nT; i++) {
      if (!X.TAL[i]) continue; const ox = X.TX[i] - E[0], oy = X.TY[i] - E[1], oz = X.TZ[i] - E[2], t = ox * dx + oy * dy + oz * dz; if (t < 0 || t > bt + X.TR[i]) continue;
      const r = X.TR[i] * 0.95, d2 = ox * ox + oy * oy + oz * oz - t * t; if (d2 > r * r) continue; const th = t - sqrt(r * r - d2); if (th > 0.5 && th < bt) { bt = th; bi = i; }
    }
    const ex = E[0] + dx * bt, ey = E[1] + dy * bt, ez = E[2] + dz * bt, o = p * 3; BE[o] = ex; BE[o + 1] = ey; BE[o + 2] = ez; BHIT[p] = bi;
    // origins: the turret's two tubes (P1), the gunner's cannon pair (P2, P3), else under the eye; the muzzles glow
    const M = X.MZW, F6 = p * 6;
    if (X.gun && p < 3 && (p > 0 || X.mpRun || X.tubes > 0)) { /* P1's tubes hide while the look is below their -10° stop: then the beam leaves from under the eye */ const a = p === 0 ? 0 : p === 1 ? 6 : 12; for (let j = 0; j < 6; j++) BO[F6 + j] = M[a + j]; BN[p] = 2; const f = p * 2; X.MF[f] = max(X.MF[f], 0.3); X.MF[f + 1] = max(X.MF[f + 1], 0.3); }
    else { const pe = X.mpRun ? p * 3 : -1, hx = pe >= 0 ? X.HPW[pe] : E[0] - C[6] * 0.55, hy = pe >= 0 ? X.HPW[pe + 1] : E[1] - C[7] * 0.55, hz = pe >= 0 ? X.HPW[pe + 2] : E[2] - C[8] * 0.55; BO[F6] = hx; BO[F6 + 1] = hy; BO[F6 + 2] = hz; BN[p] = 1; }
    // accuracy: a "shot" per LASER.shot s of beam, a hit while it is on a rock
    if ((ACC[p] += dt) >= LASER.shot) { ACC[p] -= LASER.shot; X.count(1, bi >= 0 ? 1 : 0); }
    if (bi < 0) return;
    // heat the rock: bigger rocks take longer; level shortens it
    const r = X.TR[bi], tb = (r < LASER.sizeM ? LASER.burn[0] : r < LASER.sizeL ? LASER.burn[1] : LASER.burn[2]) * LASER.level[min(X.level, 5) - 1];
    HEAT[bi] += dt / tb; HQ[bi] = 0;
    const nx = ex - X.TX[bi], ny = ey - X.TY[bi], nz = ez - X.TZ[bi], nl = hypot(nx, ny, nz) || 1, k = HEAT[bi] > 0.05 ? 0.12 : 1; // the contact drifts slowly (the cracks stay put)
    HN[bi * 3] += (nx / nl - HN[bi * 3]) * k; HN[bi * 3 + 1] += (ny / nl - HN[bi * 3 + 1]) * k; HN[bi * 3 + 2] += (nz / nl - HN[bi * 3 + 2]) * k;
    if ((SPK[p] -= dt) <= 0) { SPK[p] = REDUCED ? 0.08 : 0.035; X.sparks(ex, ey, ez, 2 + (HEAT[bi] * 3 | 0), 3 + HEAT[bi] * 4, 0.55 + HEAT[bi] * 0.4); }
    if ((BURN[p] -= dt) <= 0) { BURN[p] = 0.25; event('laserburn'); }
    X.flash(bi, 0.02 + HEAT[bi] * 0.05);
    if (HEAT[bi] >= 1) { // burst: the normal destroy (score, chain, crystals, boom, cracked children)
      HEAT[bi] = 0; HQ[bi] = 99; if (typeof FX !== 'undefined' && FX.pow) FX.pow(X.TX[bi], X.TY[bi], X.TZ[bi], { scale: r / 1.5, text: 'MELT!' });
      X.sparks(X.TX[bi], X.TY[bi], X.TZ[bi], 18 + (r * 6 | 0), 6 + r * 3, 1.3); X.destroy(bi); BHIT[p] = -1;
    }
  }
  function tick(dt) { // rocks cool once the beam is off them
    if (!HEAT) return;
    for (let i = 0; i < X.nT; i++) { if (HEAT[i] <= 0) continue; if (!X.TAL[i]) { HEAT[i] = 0; continue; } if ((HQ[i] += dt) > LASER.grace) HEAT[i] = max(0, HEAT[i] - LASER.rockCool * dt); }
  }

  // ---------------------------------------------------------------- glow segments (G.lines, after holo.js's route)
  let n = 0;
  function seg(ax, ay, az, bx, by, bz, w0, w1, r, g, b, k0, k1, px) {
    if (n >= cap) return; const D = L.data, o = n * 16;
    D[o] = ax; D[o + 1] = ay; D[o + 2] = az; D[o + 3] = w0; D[o + 4] = bx; D[o + 5] = by; D[o + 6] = bz; D[o + 7] = w1;
    D[o + 8] = r * k0; D[o + 9] = g * k0; D[o + 10] = b * k0; D[o + 11] = px; D[o + 12] = r * k1; D[o + 13] = g * k1; D[o + 14] = b * k1; D[o + 15] = 0; n++;
  }
  // a soft round glow: three nested layers of four crossing camera-facing bars (the bars' soft profile across, nested lengths along),
  // so it falls off from the centre with no hard outline
  function blob(x, y, z, rad, r, g, b, k, V) {
    for (let l = 0; l < 3; l++) { const rl = rad * (l === 0 ? 1 : l === 1 ? 0.6 : 0.3), kl = k * (l === 0 ? 0.12 : l === 1 ? 0.2 : 0.35);
      for (let j = 0; j < 4; j++) { const a = j * PI / 4 + l * 0.39, cx = cos(a) * rl, cy = sin(a) * rl;
        const ux = V.r[0] * cx + V.u[0] * cy, uy = V.u[1] * cy, uz = V.r[2] * cx + V.u[2] * cy; seg(x - ux, y - uy, z - uz, x + ux, y + uy, z + uz, rl * 0.42, rl * 0.42, r, g, b, kl, kl, 0.5); } }
  }
  function drawBeams(V) {
    const t = tNow, fl = REDUCED ? 1 : 0.85 + 0.15 * sin(t * 61) * sin(t * 23 + 1);
    const np = X.mpRun ? X.NP : 1, C = LASER.core, Gl = LASER.glow;
    for (let p = 0; p < np; p++) {
      if (!BON[p]) continue; const e = p * 3, ex = BE[e], ey = BE[e + 1], ez = BE[e + 2];
      for (let j = 0; j < BN[p]; j++) { const o = p * 6 + j * 3, x = BO[o], y = BO[o + 1], z = BO[o + 2];
        seg(x, y, z, ex, ey, ez, 0.03, 0.22 * fl, Gl[0], Gl[1], Gl[2], 0.35, 0.8, 1.5); // glow (thin and dim at the muzzle, near the eye)
        seg(x, y, z, ex, ey, ez, 0.008, 0.035, C[0], C[1], C[2], 0.5 * fl, fl, 0.9); } // core
      if (BHIT[p] < 0) continue;
      const i = BHIT[p], h = HEAT[i], nx = HN[i * 3], ny = HN[i * 3 + 1], nz = HN[i * 3 + 2];
      blob(ex, ey, ez, 0.35 + 0.3 * h, 2.6, 2.2, 1.6, fl, V); // white-hot contact
      // heat shimmer: faint wavering threads rising off the contact (still with reduced motion)
      for (let j = 0; j < 4; j++) {
        const ph = REDUCED ? j : t * (5 + j) + j * 1.7, wob = 0.18 * sin(ph), ln = 0.7 + 0.35 * j;
        const qx = V.r[0] * wob, qz = V.r[2] * wob, bx = ex + nx * 0.1 + V.u[0] * 0.05 * j, by = ey + ny * 0.1 + V.u[1] * 0.05 * j, bz = ez + nz * 0.1 + V.u[2] * 0.05 * j;
        seg(bx + qx, by, bz + qz, bx + nx * ln - qx + V.u[0] * ln * 0.5, by + ny * ln + V.u[1] * ln * 0.5, bz + nz * ln - qz + V.u[2] * ln * 0.5, 0.06, 0.12, 1.2, 0.75, 0.45, 0.35, 0, 1);
      }
    }
  }
  function drawHeated(V) { // glow, then cracks, on each heating rock (up to 8, hottest drawn even if more)
    let drawn = 0;
    for (let i = 0; i < X.nT && drawn < 8; i++) {
      const h = HEAT ? HEAT[i] : 0; if (h <= 0.01 || !X.TAL[i]) continue; drawn++;
      const R = X.TR[i], cx = X.TX[i], cy = X.TY[i], cz = X.TZ[i]; let nx = HN[i * 3], ny = HN[i * 3 + 1], nz = HN[i * 3 + 2]; const nl = hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      const px = cx + nx * R * 1.02, py = cy + ny * R * 1.02, pz = cz + nz * R * 1.02;
      // the glow: dull red → orange → yellow-white, spreading over the rock
      const g = sstep(0, 0.5, h), w = sstep(0.55, 1, h), pul = REDUCED ? 1 : 0.9 + 0.1 * sin(tNow * 9 + i);
      blob(px, py, pz, R * (0.3 + 0.5 * g), 1.6 + 1.8 * w, 0.32 + 0.9 * g * g + 0.9 * w, 0.05 + 0.5 * w, (0.2 + 0.6 * g) * pul, V);
      if (h < 0.3) continue;
      // cracks: deterministic per rock, radiating from the contact over the surface, longer as it heats
      let t1x = ny, t1y = -nx, t1z = 0; if (abs(nz) > 0.9) { t1x = 0; t1y = nz; t1z = -ny; } const tl = hypot(t1x, t1y, t1z) || 1; t1x /= tl; t1y /= tl; t1z /= tl;
      const t2x = ny * t1z - nz * t1y, t2y = nz * t1x - nx * t1z, t2z = nx * t1y - ny * t1x;
      const grow = sstep(0.3, 0.95, h), sd = HSEED[i], NC = 7, ck = 1.4 + 2.6 * w;
      for (let c = 0; c < NC; c++) {
        let a = (c + sd * 3.7 + 0.37 * sin(c * 12.9898 + sd * 78.233)) * TAU / NC, lx = px, ly = py, lz = pz;
        const reach = R * (0.6 + 0.6 * ((c * 0.618 + sd) % 1)) * grow;
        for (let k = 1; k <= 3; k++) {
          a += 0.55 * sin(c * 3.1 + k * 5.7 + sd * 40); const dd = reach * k / 3, ca = cos(a), sa = sin(a);
          let qx = nx * R + (t1x * ca + t2x * sa) * dd, qy = ny * R + (t1y * ca + t2y * sa) * dd, qz = nz * R + (t1z * ca + t2z * sa) * dd; const ql = hypot(qx, qy, qz) || 1, s = R * 1.05 / ql;
          qx = cx + qx * s; qy = cy + qy * s; qz = cz + qz * s;
          const f = 1 - k / 4; seg(lx, ly, lz, qx, qy, qz, 0.035, 0.02, 4.2, 1.5 + 1.5 * w, 0.35 + 0.6 * w, ck * (f + 0.25), ck * f, 1);
          lx = qx; ly = qy; lz = qz;
        }
      }
    }
  }
  // the turret's own barrels show the selected weapon's heat (carpetshark: "make them functional"): a red-orange glow that ramps toward the
  // tips as heat builds (a glow line just in front of each tube, plus a faint emissive on the tube mesh), and steam off the tips on overheat
  function drawBarrels() {
    const sc = X.tubes, GH = X.GH; if (!GH) return;
    const h = WSEL[0] ? LH[0] : X.heat, ov = WSEL[0] ? !!LOV[0] : X.overheated, hk = sc > 0 ? sstep(0.12, 1, h) : 0;
    for (let j = 3; j <= 4; j++) { const m = GH[j]; m.emissive[0] = 0.42 * hk * hk; m.emissive[1] = 0.09 * hk * hk; m.emissive[2] = 0.012 * hk * hk; m.emissiveCut = hk > 0.01 ? -1 : 1; } // cold: exactly the mesh as before
    if (hk <= 0.01 && !ov) return;
    const E = X.eye, T = X.TBW, M = X.MZW, t = tNow;
    for (let j = 0; j < 2; j++) {
      const bx = T[j * 3], by = T[j * 3 + 1], bz = T[j * 3 + 2], mx = M[j * 3], my = M[j * 3 + 1], mz = M[j * 3 + 2];
      let cx = E[0] - mx, cy = E[1] - my, cz = E[2] - mz; const cl2 = hypot(cx, cy, cz) || 1, off = 0.055 * sc / cl2; cx *= off; cy *= off; cz *= off; // just in front of the tube (it hides its own axis)
      const ax = bx + (mx - bx) * 0.25, ay = by + (my - by) * 0.25, az = bz + (mz - bz) * 0.25, fl = REDUCED ? 1 : 0.9 + 0.1 * sin(t * 17 + j * 2);
      seg(ax + cx, ay + cy, az + cz, mx + cx, my + cy, mz + cz, 0.03 * sc, 0.045 * sc, 3.4, 0.95, 0.18, 0, hk * 1.2 * fl, 1);
      seg(ax + cx, ay + cy, az + cz, mx + cx, my + cy, mz + cz, 0.01 * sc, 0.014 * sc, 4, 2.2, 0.8, 0, hk * hk * 1.4 * fl, 0.7);
      if (ov) for (let k = 0; k < 3; k++) { // overheat: steam wisps rising and wavering off the tip (held still with reduced motion)
        const ph = REDUCED ? k * 0.33 : (t * 0.9 + k * 0.33 + j * 0.17) % 1, rise = 0.08 + ph * 0.55, wv = REDUCED ? 0.03 : 0.06 * sin(t * 7 + k * 2.1 + j);
        const rs = rise * 0.45, sx = mx + X.CB[3] * wv * 0.4, sy = my + 0.03 + rs, sz = mz + X.CB[5] * wv * 0.4, a = 0.32 * (1 - ph) * sstep(0, 0.15, ph);
        seg(sx, sy - 0.05, sz, sx + X.CB[3] * wv * 0.3, sy + 0.05, sz + X.CB[5] * wv * 0.3, 0.008 * sc, 0.02 * sc, 0.9, 0.95, 1, a * 0.4, a, 0.6);
      }
    }
  }
  function drawSpeedLines(dt) { // turbo FX: streaks streaming past the ship, in the ship's rail frame
    const r = X.spd / X.SPEED; fxK += (sstep(1.7, 2.4, r) - fxK) * (1 - exp(-dt * 6)); if (fxK < 0.02) return;
    const F = X.FR, c = X.cam, k = fxK * (REDUCED ? 0.35 : 1), rel = X.spd * 1.6, ln = 1 + X.spd * 0.07 * (REDUCED ? 0.4 : 1);
    for (let i = 0; i < NSL; i++) {
      if (!REDUCED) { SLZ[i] -= rel * dt; if (SLZ[i] < -14) SLZ[i] += 80; } if (REDUCED && i % 2) continue;
      const x = SLX[i], y = SLY[i], z = SLZ[i], a = k * SLW[i] * sstep(-14, -6, z) * (1 - sstep(48, 66, z));
      const bx = c[0] + F[3] * x + F[6] * y + F[0] * z, by = c[1] + F[4] * x + F[7] * y + F[1] * z, bz = c[2] + F[5] * x + F[8] * y + F[2] * z;
      seg(bx, by, bz, bx + F[0] * ln, by + F[1] * ln, bz + F[2] * ln, 0.012, 0.02, 0.6, 1.3, 1.6, a * 0.2, a, 0.8);
    }
  }

  // ---------------------------------------------------------------- proximity sensor (post): rocks on a collision course, homers
  function sense(dt) {
    pn = 0; pmin = 9; if (!X.live) return;
    const c = X.cam, F = X.FR, sp = X.spd, vx0 = -F[0] * sp, vy0 = -F[1] * sp, vz0 = -F[2] * sp, R2 = PROX.range * PROX.range;
    for (let i = 0; i < X.nT; i++) {
      if (!X.TAL[i]) continue; const rx = X.TX[i] - c[0], ry = X.TY[i] - c[1], rz = X.TZ[i] - c[2], d2 = rx * rx + ry * ry + rz * rz; if (d2 > R2) continue;
      const mv = i >= X.nD0 && X.DST[i] === 1, homer = mv && X.DRAM[i];
      const vx = vx0 + (mv ? X.TVX[i] : 0), vy = vy0 + (mv ? X.TVY[i] : 0), vz = vz0 + (mv ? X.TVZ[i] : 0), vv = vx * vx + vy * vy + vz * vz, d = sqrt(d2);
      let tti = 9;
      if (homer) { const close = -(rx * vx + ry * vy + rz * vz) / (d || 1); tti = close > 0.5 ? d / close : 9; if (tti > 8) continue; }
      else { if (vv < 1e-4) continue; const ts = -(rx * vx + ry * vy + rz * vz) / vv; if (ts <= 0) continue;
        const mx = rx + vx * ts, my = ry + vy * ts, mz = rz + vz * ts, miss = hypot(mx, my, mz), rad = X.TR[i] * 0.7 + 0.4 + PROX.margin; if (miss > rad) continue;
        tti = max(0, ts - sqrt(rad * rad - miss * miss) / sqrt(vv)); }
      // keep the PROX.n most urgent
      let k = pn < PROX.n ? pn++ : PROX.n - 1; if (k === PROX.n - 1 && pn === PROX.n && tti >= PT[k * 6 + 3]) continue;
      while (k > 0 && tti < PT[(k - 1) * 6 + 3]) { for (let j = 0; j < 6; j++) PT[k * 6 + j] = PT[(k - 1) * 6 + j]; k--; }
      const o = k * 6; PT[o] = rx / (d || 1); PT[o + 1] = ry / (d || 1); PT[o + 2] = rz / (d || 1); PT[o + 3] = tti; PT[o + 4] = d; PT[o + 5] = homer ? 1 : 0;
    }
    pmin = pn ? PT[3] : 9;
    // the beep (silent unless mapped on the sound board): faster as impact nears
    if (pn && pmin < PROX.ring && on.prox && shell.settings.layers.proximity !== false) { if ((beepT -= dt) <= 0) { beepT = 0.1 + 0.5 * cl(pmin / PROX.ring, 0, 1); event('proximity'); } } else beepT = 0;
  }

  // ---------------------------------------------------------------- HUD: one 2D canvas (weapons, speed, laser heat, proximity, AUTO-AIM)
  let cv = null, cx = null, cw = 0, ch = 0, dpr = 1, shown = false, styleT = 0;
  const COL = { h: '#ffb547', s: '#ffe1b0', a: '#7fe4ff', d: '#ff6f6f', fl: 'ui-monospace,Menlo,monospace', fn: 'ui-monospace,Menlo,monospace' };
  let FNT_K = '', FNT_S = '', FNT_B = '', FNT_P = '';
  const SPDTXT = []; for (let k = 0; k <= 300; k++) SPDTXT.push('×' + (k / 100).toFixed(2));
  const PCOL = ['#ffb547', '#5ee6ff', '#ff5ad8', '#a6ff4d'];
  function buildHud() {
    const st = document.createElement('style'); st.textContent = '#rrcmb{position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:7}'; document.head.appendChild(st);
    cv = document.createElement('canvas'); cv.id = 'rrcmb'; cv.className = 'sgjolt'; cv.setAttribute('aria-hidden', 'true'); (document.getElementById('sgr') || document.body).appendChild(cv); cx = cv.getContext('2d');
  }
  function readStyle() {
    const sg = document.getElementById('sgr'); if (!sg) return; const cs = getComputedStyle(sg), g = (n, d) => (cs.getPropertyValue(n) || '').trim() || d;
    COL.h = g('--h', COL.h); COL.s = g('--s', COL.s); COL.a = g('--a', COL.a); COL.fl = g('--fl', COL.fl); COL.fn = g('--fn', COL.fn);
    const dc = g('--d', COL.d); if (dc !== COL.d || !glow) { COL.d = dc; glowSprite(); } fk = -1;
  }
  // the off-screen threat glow, drawn once per palette into a sprite (no gradient objects per frame)
  let glow = null;
  function glowSprite() {
    glow = glow || document.createElement('canvas'); glow.width = glow.height = 128; const g = glow.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, COL.d); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.clearRect(0, 0, 128, 128); g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  }
  let fk = -1;
  function fonts(K) { if (K === fk) return; fk = K; FNT_K = `700 ${round(13 * K)}px ${COL.fl}`; FNT_S = `600 ${round(11 * K)}px ${COL.fl}`; FNT_B = `800 ${round(15 * K)}px ${COL.fn}`; FNT_P = `900 ${round(26 * K)}px ${COL.fl}`; }
  function hudFrame(view) {
    if (!cv) return;
    const st = shell.state, live = X.live && st === 'run', pw = hud.power ?? 1, Ly = shell.settings.layers;
    const want = live && pw > 0.02;
    if (!want) { if (shown) { cx.setTransform(1, 0, 0, 1, 0, 0); cx.clearRect(0, 0, cv.width, cv.height); shown = false; } return; }
    const d = min(2, devicePixelRatio || 1), W = innerWidth, H = innerHeight;
    if (round(W * d) !== cw || round(H * d) !== ch || d !== dpr) { dpr = d; cv.width = cw = round(W * d); cv.height = ch = round(H * d); styleT = 0; }
    if ((styleT -= 1) <= 0) { styleT = 30; readStyle(); }
    cx.setTransform(d, 0, 0, d, 0, 0); cx.clearRect(0, 0, W, H); shown = true; cx.globalAlpha = pw * pw; cx.lineCap = 'round';
    if (X.mpRun && shell.mp && view.mv) {
      for (let v = 0; v < view.mv; v++) { const m = view.views[v], x = m.x * W, y = m.y * H, w = m.w * W, h = m.h * H;
        cx.save(); cx.beginPath(); cx.rect(x, y, w, h); cx.clip(); const K = cl(min(w / 900, h / 560), 0.62, 1.1); fonts(K);
        if (Ly.proximity !== false && on.prox) drawProx(m, x, y, w, h, K);
        drawAssistTag(v, x + w / 2, y + h / 2, K);
        if (Ly.weapon) drawWeapons(v, x + w / 2, y + h - 26 * K, K, true, PCOL[v]);
        cx.restore(); }
      if (Ly.weapon) { fonts(0.8); drawSpeed(W / 2 - 40, 66, 0.75); } // the shared ship's speed, under the shared hull / timer pill
    } else {
      const K = cl(H / 900, 0.7, 1.15) * (shell.settings.hudScale === 's' ? 0.85 : shell.settings.hudScale === 'l' ? 1.15 : 1); fonts(K);
      if (Ly.proximity !== false && on.prox) drawProx(view, 0, 0, W, H, K);
      drawAssistTag(0, W / 2, H / 2, K);
      if (Ly.weapon) { const px = W / 2 + 270 * K; drawWeapons(0, px, H - 104 * K, K, false, COL.h); drawSpeed(px - 22 * K, H - 58 * K, K); } // right of the radar
    }
    cx.globalAlpha = 1;
  }
  function keycap(x, y, w, h, key, label, sel, col, K) {
    cx.globalAlpha = (hud.power ?? 1) ** 2 * (sel ? 1 : 0.55);
    cx.fillStyle = sel ? col : 'rgba(6,14,22,0.45)'; cx.strokeStyle = col; cx.lineWidth = 1.5;
    cx.beginPath(); cx.roundRect(x, y, w, h, 6 * K); cx.fill(); cx.stroke();
    const kw = h - 8 * K; cx.fillStyle = sel ? 'rgba(6,14,22,0.85)' : col; cx.beginPath(); cx.roundRect(x + 4 * K, y + 4 * K, kw, kw, 4 * K); cx.fill();
    cx.font = FNT_K; cx.textBaseline = 'middle'; cx.textAlign = 'center'; cx.fillStyle = sel ? col : '#06121a'; cx.fillText(key, x + 4 * K + kw / 2, y + h / 2 + 0.5);
    cx.textAlign = 'left'; cx.fillStyle = sel ? '#06121a' : col; cx.fillText(label, x + kw + 11 * K, y + h / 2 + 0.5);
  }
  function drawWeapons(p, x, y, K, mp, col) {
    const w = 118 * K, h = 26 * K, g = 8 * K;
    keycap(x - w - g / 2, y - h / 2, w, h, '1', 'BLASTER', WSEL[p] === 0, col, K);
    keycap(x + g / 2, y - h / 2, w, h, '2', 'LASER', WSEL[p] === 1, col, K);
    if (WSEL[p] === 1) { // the laser's heat bar under its keycap
      const bx = x + g / 2, by = y + h / 2 + 4 * K; cx.globalAlpha = (hud.power ?? 1) ** 2;
      cx.fillStyle = 'rgba(6,14,22,0.5)'; cx.fillRect(bx, by, w, 4 * K); cx.fillStyle = LOV[p] ? COL.d : col; cx.fillRect(bx, by, w * LH[p], 4 * K);
      if (LOV[p] && (REDUCED || (tNow * 3 % 1) < 0.6)) { cx.font = FNT_S; cx.fillStyle = COL.d; cx.textAlign = 'left'; cx.fillText('OVERHEAT', bx + w + 6 * K, by + 2 * K); }
    }
    void mp;
  }
  function drawSpeed(x, y, K) { // a gauge: 0 → 2.5 × cruise, ticks at the lever's range, the lever mark, the needle, turbo meter
    const r = X.spd / X.SPEED, w = 180 * K, x0 = x - w / 2, sc = w / 2.6, a = (hud.power ?? 1) ** 2, col = brakeOn ? COL.d : turboOn ? COL.a : COL.h;
    cx.globalAlpha = a * 0.9; cx.fillStyle = 'rgba(6,14,22,0.42)'; cx.beginPath(); cx.roundRect(x0 - 8 * K, y - 30 * K, w + 100 * K, 44 * K, 7 * K); cx.fill();
    cx.globalAlpha = a; cx.fillStyle = 'rgba(255,255,255,0.12)'; cx.fillRect(x0, y - 2 * K, w, 4 * K);
    cx.fillStyle = COL.h; cx.globalAlpha = a * 0.35; cx.fillRect(x0 + THR.min * sc, y - 2 * K, (THR.max - THR.min) * sc, 4 * K);
    cx.globalAlpha = a; cx.fillStyle = col; cx.fillRect(x0, y - 2 * K, cl(r, 0, 2.6) * sc, 4 * K);
    for (const t of TICKS) { cx.fillStyle = t === 1 ? COL.s : COL.h; cx.globalAlpha = a * (t === 1 ? 0.9 : 0.5); cx.fillRect(x0 + t * sc - 0.75, y - (t === 1 ? 7 : 5) * K, 1.5, (t === 1 ? 14 : 10) * K); }
    cx.globalAlpha = a; cx.fillStyle = COL.s; const lx = x0 + (stick || tset) * sc; cx.beginPath(); cx.moveTo(lx, y - 6 * K); cx.lineTo(lx - 4 * K, y - 11 * K); cx.lineTo(lx + 4 * K, y - 11 * K); cx.fill(); // the lever
    cx.font = FNT_B; cx.textBaseline = 'middle'; cx.textAlign = 'right'; cx.fillStyle = col; cx.fillText(SPDTXT[cl(round(r * 100), 0, 300)], x0 + w, y - 18 * K);
    cx.font = FNT_S; cx.textAlign = 'left'; cx.fillStyle = col; cx.fillText('SPEED', x0, y - 18 * K);
    const lab = brakeOn ? (r < 0.12 ? 'PARKED' : 'BRAKE') : turboOn ? 'TURBO!' : turboLock ? 'COOLING' : 'TURBO';
    cx.fillText(lab, x0 + w + 14 * K, y - 6 * K);
    cx.fillStyle = 'rgba(255,255,255,0.14)'; cx.fillRect(x0 + w + 14 * K, y + 3 * K, 64 * K, 4 * K); cx.fillStyle = turboLock ? COL.d : COL.a; cx.fillRect(x0 + w + 14 * K, y + 3 * K, 64 * K * turboM, 4 * K);
  }
  const TICKS = [0.4, 1, 1.8, 2.5];
  function drawProx(V, x, y, w, h, K) {
    if (!pn) return;
    const cxp = x + w / 2, cyp = y + h / 2, ta = V.tan * V.aspect, a0 = cx.globalAlpha;
    for (let k = 0; k < pn; k++) {
      const o = k * 6, dx = PT[o], dy = PT[o + 1], dz = PT[o + 2], tti = PT[o + 3], u = 1 - cl(tti / PROX.ring, 0, 1); if (u <= 0.01 && tti > 6) continue;
      const rR = dx * V.r[0] + dz * V.r[2], rU = dx * V.u[0] + dy * V.u[1] + dz * V.u[2], rF = dx * V.f[0] + dy * V.f[1] + dz * V.f[2];
      Turret.edge(rR, rU, rF, V.tan, V.aspect, 0.02, ED); void ta;
      const ex = cxp + ED[0] * w / 2, ey = cyp - ED[1] * h / 2, ang = -ED[2], pul = REDUCED ? 1 : 0.75 + 0.25 * sin(tNow * (6 + 14 * u));
      const al = a0 * (0.25 + 0.75 * u) * pul;
      if (!ED[3]) { // off screen: a glow on the edge toward it
        const rad = (70 + 90 * u) * K; cx.globalAlpha = al * 0.6; if (glow) cx.drawImage(glow, ex - rad, ey - rad, rad * 2, rad * 2);
      }
      // an arc on the reticle ring, in the threat's direction
      const rr = (36 + 120 * cl(tti / PROX.ring, 0, 1)) * K; cx.globalAlpha = al; cx.strokeStyle = COL.d; cx.lineWidth = (2.5 + 3 * u) * K;
      cx.beginPath(); cx.arc(cxp, cyp, rr, ang - 0.38, ang + 0.38); cx.stroke();
    }
    // the ring round the reticle tightens as time to impact drops
    const u = 1 - cl(pmin / PROX.ring, 0, 1);
    if (u > 0) { const rr = (36 + 120 * (1 - u)) * K; cx.globalAlpha = a0 * (0.2 + 0.6 * u); cx.strokeStyle = COL.d; cx.lineWidth = 1.5 * K; cx.setLineDash(DASH); cx.beginPath(); cx.arc(cxp, cyp, rr, 0, TAU); cx.stroke(); cx.setLineDash(NODASH); }
    if (pmin < PROX.warn && (REDUCED || (tNow * 4 % 1) < 0.62)) {
      cx.globalAlpha = a0; cx.font = FNT_P; cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.lineWidth = 4 * K; cx.strokeStyle = 'rgba(0,0,0,0.7)';
      cx.strokeText('PROXIMITY', cxp, cyp - 150 * K); cx.fillStyle = COL.d; cx.fillText('PROXIMITY', cxp, cyp - 150 * K);
    }
    cx.globalAlpha = a0;
  }
  const DASH = [6, 6], NODASH = [];
  function drawAssistTag(p, x, y, K) {
    if (!X.DF.assist || !X.turret) return;
    const a0 = cx.globalAlpha, engaged = AON[p], man = AMAN[p] > 0, lab = man ? 'YOU AIM · AUTO-AIM SOON' : engaged ? 'AUTO-AIM' : 'AUTO-AIM · LOOKING';
    cx.font = FNT_K; cx.textAlign = 'center'; cx.textBaseline = 'middle'; const tw = cx.measureText(lab).width + 22 * K, ty = y + 58 * K;
    cx.globalAlpha = a0 * (man ? 0.55 : 0.95); cx.fillStyle = 'rgba(6,20,26,0.55)'; cx.beginPath(); cx.roundRect(x - tw / 2, ty - 11 * K, tw, 22 * K, 11 * K); cx.fill();
    cx.strokeStyle = COL.a; cx.lineWidth = 1.5; cx.stroke(); cx.fillStyle = COL.a; cx.fillText(lab, x, ty + 0.5);
    if (engaged && !man) { const r = (REDUCED ? 26 : 26 + 2 * sin(tNow * 3)) * K; cx.globalAlpha = a0 * 0.7; cx.lineWidth = 2 * K; cx.beginPath(); cx.arc(x, y, r, -2.4, -0.74); cx.stroke(); cx.beginPath(); cx.arc(x, y, r, 0.74, 2.4); cx.stroke(); }
    cx.globalAlpha = a0;
  }

  // ---------------------------------------------------------------- per frame drawing (reefrun.js post, after holo.js) + HUD numbers
  function post(view, stats) {
    if (!X || !L) return;
    const t = view.F[8]; fdt = tPrev < 0 ? 0 : cl(t - tPrev, 0, 0.1); tPrev = t; tNow = t;
    const live = X.live && shell.state === 'run';
    if (live && stats) { // the shell's weapon panel shows the selected weapon (laser: its own heat)
      if (WSEL[0]) { stats.heat = LH[0]; stats.overheated = !!LOV[0]; stats.weaponName = LASER.names[min(X.level, 5) - 1]; }
      stats.throttle = thr; stats.turbo = turboM;
    }
    n = L.n | 0;
    if (live) { drawBeams(view); drawHeated(view); drawSpeedLines(fdt); drawBarrels(); } else if (X.GH) for (let j = 3; j <= 4; j++) X.GH[j].emissiveCut = 1;
    L.n = n;
    if (!(shell.state === 'run' && !shell.open)) BON.fill(0);
    let any = false; for (let p = 0; p < 4; p++) if (BON[p]) any = true;
    if (typeof SOUNDBOARD !== 'undefined') SOUNDBOARD.loop('laser', any && live && !shell.open);
    sense(live && !shell.open ? fdt : 0);
    hudFrame(view);
  }
  function mpHud(p, H) { if (WSEL[p]) { H.heat = LH[p]; H.overheated = !!LOV[p]; } } // split screen: that gunner's laser heat in their panel

  // ---------------------------------------------------------------- commands, settings
  function command(a) {
    switch (a[0]) {
      case 'weapon': case 'laser': case 'blaster': {
        const w = a[0] === 'laser' ? 1 : a[0] === 'blaster' ? 0 : a[1] === 'laser' || a[1] === '2' ? 1 : a[1] === 'blaster' || a[1] === '1' ? 0 : a[1] === 'toggle' || !a[1] ? 1 - WSEL[0] : -1;
        if (w < 0) return 'weapon blaster|laser|toggle (keys 1 and 2)'; select(0, w); return 'weapon: ' + (w ? 'mining laser (hold fire: the beam heats a rock until it bursts)' : 'blaster');
      }
      case 'proximity': case 'prox': { const r = shell.command('hud proximity ' + (a[1] || 'toggle')); return 'proximity sensor ' + (shell.settings.layers.proximity ? 'on' : 'off') + ' (' + r + ')'; }
      case 'throttle': if (a[1] === 'reset' || a[1] === '1') { tset = 1; return 'throttle: cruise'; } if (+a[1] > 0) { tset = cl(+a[1], THR.min, THR.max); return 'throttle ×' + tset.toFixed(2); } return 'throttle ×' + tset.toFixed(2) + ' (W / S; Shift+W turbo, Shift+S brake; throttle reset)';
      case 'assist': return 'aim assist is part of Super Easy: difficulty supereasy';
    }
    return null;
  }
  const help = '\n  1 / 2                         blaster / mining laser (pad: Y or d-pad down)\n  weapon blaster|laser|toggle\n  W / S  ·  Shift+W  ·  Shift+S  throttle · turbo · parking brake (pilot: Q / E; pad: left stick Y, L3, R3)\n  throttle <0.4-1.8>|reset\n  proximity on|off|toggle       the proximity sensor (also a HUD layer)';
  const settingsHTML = () => '<h4>Weapons and speed</h4><div class="seg"><button type="button" data-game="weapon blaster" aria-pressed="false">1 · Blaster</button><button type="button" data-game="weapon laser" aria-pressed="false">2 · Mining laser</button></div>' +
    '<div class="row"><button type="button" data-game="proximity toggle" aria-pressed="false" data-cmbprox>Proximity sensor</button><button type="button" data-game="throttle reset">Throttle to cruise</button></div>' +
    '<p class="note">Space or click fires. Turret: W / S throttle, Shift+W turbo, Shift+S parking brake. Pilot: Q / E. Pad: left stick up / down, L3 turbo, R3 brake, Y weapon.</p>';
  function sync(root) {
    if (!root) return;
    for (const b of root.querySelectorAll('[data-game^="weapon "]')) b.setAttribute('aria-pressed', String(b.dataset.game === (WSEL[0] ? 'weapon laser' : 'weapon blaster')));
    const sh = shell || (typeof Shell !== 'undefined' ? Shell : null), pb = root.querySelector('[data-cmbprox]'); if (pb && sh) pb.setAttribute('aria-pressed', String(!!sh.settings.layers.proximity));
  }
  const API = { THR, LASER, PROX, ASSIST, WSEL, LH, HEAT,
    get state() { return { thr, tset, stick, turbo: turboOn, turboM, turboLock, brake: brakeOn, weapon: Array.from(WSEL.subarray(0, 4)), laserHeat: Array.from(LH), beam: Array.from(BON), beamHit: Array.from(BHIT), prox: pn, tti: pmin, assist: Array.from(AON), target: Array.from(ATGT), manual: Array.from(AMAN), fx: fxK }; },
    // test aids: the nearest live rock of at least minR m within maxD m ahead-ish; point the turret at rock i (holds while `hold` s)
    findRock(minR = 0, maxR = 9, maxD = 90, minUp = -2) { let bi = -1, bd = maxD; for (let i = 0; i < X.nT; i++) { if (!X.TAL[i] || X.TR[i] < minR || X.TR[i] >= maxR) continue; const d = hypot(X.TX[i] - X.cam[0], X.TY[i] - X.cam[1], X.TZ[i] - X.cam[2]); if (((X.TX[i] - X.cam[0]) * X.FR[6] + (X.TY[i] - X.cam[1]) * X.FR[7] + (X.TZ[i] - X.cam[2]) * X.FR[8]) / (d || 1) < minUp) continue; if (d > 8 && d < bd) { bd = d; bi = i; } } return bi < 0 ? null : { i: bi, r: +X.TR[bi].toFixed(2), d: +bd.toFixed(1) }; },
    aim(i) { const T = X.TT, F = X.FR, E = X.eye; if (!T || i < 0) return; const dx = X.TX[i] - E[0], dy = X.TY[i] - E[1], dz = X.TZ[i] - E[2], d = hypot(dx, dy, dz) || 1;
      T.yaw = atan2((dx * F[3] + dy * F[4] + dz * F[5]) / d, (dx * F[0] + dy * F[1] + dz * F[2]) / d); T.pitch = Math.asin(cl((dx * F[6] + dy * F[7] + dz * F[8]) / d, -1, 1)); T.idle = 0; },
    heat(i) { return HEAT ? +HEAT[i].toFixed(3) : 0; },
    select, threats() { const o = []; for (let k = 0; k < pn; k++) o.push({ tti: +PT[k * 6 + 3].toFixed(2), d: +PT[k * 6 + 4].toFixed(1), homer: !!PT[k * 6 + 5] }); return o; } };
  return { init, reset, input, assist, laserOn, beam, tick, post, mpHud, timeBonus, command, help, settingsHTML, sync, get thr() { return thr; }, api: API };
})();
