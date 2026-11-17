// ============================================================================
// bodyglow-game.js: Body Defenders, Glow Run. A rail shooter down the glowing vessel of BD-2.2 (GAME_API.md,
// BODY_GAMES.md). Blast the red virus swarm in combo chains, ride the cyan vein boost lanes for speed, and pop the
// mother virus in the chamber at the end. Camera (VIEW.md): the menu and ?shot frames keep the concept's third-person
// view with the ship (BG-K1) and engine trails (BG-T1) at the lower right. Once a run starts the camera blends to the
// player's view: cockpit by default (the camera is the ship; no ship model or trails), or over the right shoulder
// (Shell.view, V key), with the ship lower-left, nudged clear of the reticle.
// Load-time allocation only; update() and post() reuse preallocated typed arrays. Hits use FX (fx2d.js): splat on pops,
// boom on big ones.
// ============================================================================
const GAME = (() => {
  // ---------------------------------------------------------------- tuning
  const SPEED = 22, LANE_SPEED = 42, BUMP_SPEED = 11, BOX = 5.4, LOOK_AIM = 0.12;
  const BOLT_SPEED = 160, BOLT_LIFE = 0.9, LOCK_RANGE = 150, RADAR_RANGE = 220;
  const COMBO_TIME = 1.8, COMBO_MAX = 12, LANE_R = 1.6, LANE_RAD = 4.6, FINISH_BACK = 12;
  // Blaster levels (data, so a shop can extend it later). rate: shots/s · bolts · spread (rad) · heat per shot · cool: heat/s · size (m) · dmg
  const WEAPONS = [
    { xp: 0, name: 'Glow pulse', rate: 6.0, bolts: 1, spread: 0, heat: 0.10, cool: 0.45, size: 0.10, dmg: 1.0 },
    { xp: 300, name: 'Glow pulse II', rate: 7.0, bolts: 1, spread: 0, heat: 0.09, cool: 0.50, size: 0.12, dmg: 1.5 },
    { xp: 800, name: 'Twin pulse', rate: 7.5, bolts: 2, spread: 0, heat: 0.09, cool: 0.55, size: 0.13, dmg: 1.5 },
    { xp: 1500, name: 'Twin flare', rate: 8.5, bolts: 2, spread: 0, heat: 0.08, cool: 0.62, size: 0.15, dmg: 2.0 },
    { xp: 2500, name: 'Antibody storm', rate: 9.0, bolts: 3, spread: 0.04, heat: 0.075, cool: 0.70, size: 0.17, dmg: 2.5 },
  ];
  // vein boost lanes (DECOMPOSITION section 7, P): [start s, end s, start angle] on a ring LANE_RAD m from the axis
  const LANES = [[175, 295, 2.4], [380, 480, 5.6], [560, 690, 0.6], [770, 870, 3.6], [960, 1085, 1.2], [1150, 1260, 4.4]];
  const fxOn = () => typeof FX !== 'undefined';
  // view (VIEW.md): shoulder camera offsets from the pilot position, blend time, and the camera's offset clamp in the vessel
  const SH_BACK = 5, SH_UP = 1.15, SH_RIGHT = 0.9, SH_CONVERGE = 30, VIEW_BLEND = 0.35, CAM_R = BOX + 2.2, PUSH_MAX = 2;
  const RET_RX = 0.36, RET_RY = 0.32, CTR_RX = 0.3, CTR_RY = 0.28; // the ship's keep-out ellipses round the reticle and the screen centre (NDC half-axes)
  const ease = (t) => t * t * (3 - 2 * t);

  // ---------------------------------------------------------------- state
  let SC = null, rail = null, len = 0, H = null, G = null, hud = null, F = null, sEnd = 0;
  let tanH = Math.tan(BG_FOV / 2), aspect = 16 / 9;
  const stats = { score: 0, combo: 1, hull: 0, hullMax: 0, level: 1, xp: 0, xpNext: WEAPONS[1].xp, heat: 0, overheated: false,
    counterLabel: 'Viruses', counterValue: 0, counterMax: 0, weaponName: WEAPONS[0].name, speed: SPEED, boost: 0 };
  let s = 0, ox = 0, oy = 0, vx = 0, vy = 0, spd = SPEED, runT = 0, started = false, ended = false, roll = 0;
  let score = 0, combo = 1, comboT = 0, bestCombo = 1, xp = 0, level = 1, heat = 0, overheated = false, fireCD = 0;
  let boost = 0, onLane = -1, laneT = 0, bumps = 0, popped = 0, motherDown = false, histT = 0;
  const cam = new Float64Array(3), CB = new Float64Array(9), L = new Float64Array(3), YP = new Float64Array(2);
  const FR = new Float64Array(9), FS = new Float64Array(9), T1 = [0, 0, 0], T2 = [0, 0, 0], T3 = new Float64Array(3), PJ = new Float64Array(3);
  const ship = new Float64Array(3), SB = new Float64Array(9), SQ = new Float64Array(4), aim = new Float64Array(2);
  const NH = 72, HU = new Float32Array(NH), HV = new Float32Array(NH); let hHead = 0; // offset history at 30 Hz (trails)

  // targets
  let nT = 0, iMother = -1, TX, TY, TZ, TR, TS, THP, THPM, TAL, TFL, TPTS, TM, TO;
  const vm = {}; let baseInst = {};
  // points
  let P = null, BO0 = 0, SP0 = 0, EN0 = 0, TR0 = 0;
  const NBOLT = 54, NSPARK = 480, NTR = 170;
  const BX = new Float32Array(NBOLT * 3), BV = new Float32Array(NBOLT * 3), BL = new Float32Array(NBOLT), BD = new Float32Array(NBOLT), BS = new Float32Array(NBOLT);
  const SX = new Float32Array(NSPARK * 3), SV = new Float32Array(NSPARK * 3), SL = new Float32Array(NSPARK), SL0 = new Float32Array(NSPARK), SS = new Float32Array(NSPARK);
  let sparkNext = 0, boltNext = 0, ENG = null, MK = null, BLP = null;
  let auto = false; // ?debug test autopilot
  let SH = null, vwT = 0, cwT = 1, vis = 1, pu = 0, pv = 0; // view: shoulder blend (0 cockpit), concept blend (1 opening), ship visibility, reticle push (m)
  const FC = new Float64Array(9), C1 = new Float64Array(3);
  const wantView = () => (SH && SH.view === 'shoulder' ? 1 : 0);

  // ---------------------------------------------------------------- helpers (no allocation)
  const setPt = (i, x, y, z, sz, r, g, b, k) => { const o = i * 8; P[o] = x; P[o + 1] = y; P[o + 2] = z; P[o + 3] = sz; P[o + 4] = r; P[o + 5] = g; P[o + 6] = b; P[o + 7] = k; };
  const project = (x, y, z, o) => {
    const dx = x - cam[0], dy = y - cam[1], dz = z - cam[2], d = dx * CB[0] + dy * CB[1] + dz * CB[2], q = d > 1e-3 ? d : 1e-3;
    o[0] = (dx * CB[3] + dz * CB[5]) / (q * tanH * aspect); o[1] = (dx * CB[6] + dy * CB[7] + dz * CB[8]) / (q * tanH); o[2] = d; return o;
  };
  const randDir = (o) => { const z = rnd() * 2 - 1, a = rnd() * TAU, r = sqrt(1 - z * z); o[0] = r * cos(a); o[1] = r * sin(a); o[2] = z; return o; };
  const weapon = () => WEAPONS[level - 1];
  const laneAngle = (k, st) => LANES[k][2] + (st - LANES[k][0]) * 0.0045;
  const laneAt = (st) => { for (let k = 0; k < LANES.length; k++) if (st >= LANES[k][0] && st <= LANES[k][1]) return k; return -1; };

  // ---------------------------------------------------------------- prepare (before the scene builds)
  function prepare(S) { SC = S; rail = S.rail; len = rail.len; H = S.hero; sEnd = len - FINISH_BACK - H.shipAhead; S.p1 = S.p1 || [0, 0, 0, 1]; }

  // ---------------------------------------------------------------- init
  function init(G_, Shell_) {
    G = G_; hud = Shell_.hud; SH = Shell_;
    if (typeof QS !== 'undefined' && QS.has('debug')) {
      window.glowRun = GAME; auto = QS.has('auto');
      GAME.debug = { jump(v) { s = v; }, set auto(v) { auto = !!v; }, get auto() { return auto; }, get state() { return { s, sEnd, len, spd, boost, onLane, score, combo, bestCombo, popped, nT, level, xp, heat, overheated, bumps, motherDown, ended, runT, ox, oy, view: SH ? SH.view : 'cockpit', viewBlend: vwT, conceptBlend: cwT, shipVisible: vis }; }, cam, ship };
    }
    hud.labels = ['Virus', 'Boost lane', 'Mother virus'];
    for (const m of G.meshes) if (m.variant) vm[m.variant] = m;
    const V = G.viruses; nT = V.length;
    TX = new Float32Array(nT); TY = new Float32Array(nT); TZ = new Float32Array(nT); TR = new Float32Array(nT); TS = new Float32Array(nT);
    THP = new Float32Array(nT); THPM = new Float32Array(nT); TAL = new Uint8Array(nT); TFL = new Float32Array(nT); TPTS = new Uint16Array(nT);
    TM = new Array(nT); TO = new Uint32Array(nT);
    for (let i = 0; i < nT; i++) {
      const q = V[i]; TX[i] = q.x; TY[i] = q.y; TZ[i] = q.z; TR[i] = q.r; TS[i] = q.s; TM[i] = vm[q.v]; TO[i] = q.slot * 12;
      if (q.id === 'MOTHER') { iMother = i; THPM[i] = 40; TPTS[i] = 3000; continue; }
      THPM[i] = q.r < 0.6 ? 1 : q.r < 1.0 ? 2 : q.r < 1.6 ? 3 : 8; TPTS[i] = q.r < 0.6 ? 100 : q.r < 1.0 ? 150 : q.r < 1.6 ? 250 : 1000;
    }
    for (const k in vm) baseInst[k] = vm[k].inst.slice();
    ENG = G.engines;
    // points: the scene's motes, then static ghost rail and boost lanes, then one dynamic range
    const ghost = rail.ghost(1.6, 0.06, [0.25, 1.1, 1.6]);
    const lanes = [], p = [0, 0, 0];
    for (let k = 0; k < LANES.length; k++) {
      for (let st = LANES[k][0]; st <= LANES[k][1]; st += 0.3) {
        rail.at(st, p); SC.frame(st, FR); const a = laneAngle(k, st), cu = cos(a) * LANE_RAD, cv = sin(a) * LANE_RAD;
        const fade = min(1, (st - LANES[k][0]) / 6, (LANES[k][1] - st) / 6);
        const put = (u, v, sz, r, g, b) => lanes.push(p[0] + FR[3] * u + FR[6] * v, p[1] + FR[4] * u + FR[7] * v, p[2] + FR[5] * u + FR[8] * v, sz, r * fade, g * fade, b * fade, 0);
        put(cu, cv, 0.07, 0.35, 1.25, 1.7); // the vein core
        for (const ph of [0, PI]) { const w = st * 0.9 + ph; put(cu + cos(w) * 0.55, cv + sin(w) * 0.55, 0.09, 0.15, 0.6, 1.05); } // two twisting strands
      }
    }
    const old = G.points, nDyn = NBOLT * 3 + NSPARK + 4 + 4 * NTR, dyn0 = (old.length + ghost.length + lanes.length) / 8;
    P = new Float32Array(old.length + ghost.length + lanes.length + nDyn * 8); P.set(old); P.set(ghost, old.length); P.set(lanes, old.length + ghost.length);
    BO0 = dyn0; SP0 = BO0 + NBOLT * 3; EN0 = SP0 + NSPARK; TR0 = EN0 + 4;
    G.points = P; G.dynPts = [dyn0, nDyn];
    MK = new Float32Array(8 * 6); BLP = new Float32Array((nT + 8) * 4);
    stats.counterMax = nT;
    reset();
  }

  // ---------------------------------------------------------------- targets
  const showTarget = (i, on) => { TAL[i] = on ? 1 : 0; TM[i].inst[TO[i] + 3] = on ? TR[i] : 0; TM[i].dirty = true; };
  const sparks = (x, y, z, n, sp, sz) => {
    for (let k = 0; k < n; k++) {
      const i = sparkNext; sparkNext = (sparkNext + 1) % NSPARK; randDir(T3); const v = sp * rr(0.3, 1);
      SX[i * 3] = x; SX[i * 3 + 1] = y; SX[i * 3 + 2] = z; SV[i * 3] = T3[0] * v; SV[i * 3 + 1] = T3[1] * v; SV[i * 3 + 2] = T3[2] * v;
      SL[i] = SL0[i] = rr(0.3, 0.8); SS[i] = rr(0.04, 0.1) * sz;
    }
  };
  const addXP = (n) => {
    xp += n;
    while (level < WEAPONS.length && xp >= WEAPONS[level].xp) { level++; hud.event('levelup'); hud.popup('LEVEL ' + level + ' · ' + WEAPONS[level - 1].name, 0, 0.35, 'info'); }
  };
  const pop = (i, byPlayer) => {
    showTarget(i, false);
    const r = TR[i], x = TX[i], y = TY[i], z = TZ[i];
    sparks(x, y, z, 18 + (r * 10 | 0), 5 + r * 3, 1 + r * 0.4);
    if (!byPlayer) { if (fxOn()) FX.splat(x, y, z, { color: '#ff5d8f', scale: 0.6, text: 'BUMP!' }); return; }
    popped++;
    combo = comboT > 0 ? min(combo + 1, COMBO_MAX) : 1; comboT = COMBO_TIME; if (combo > bestCombo) bestCombo = combo;
    const pts = TPTS[i] * combo; score += pts;
    project(x, y, z, PJ); if (PJ[2] > 0) hud.popup('+' + pts + (combo > 1 ? ' ×' + combo : ''), PJ[0], PJ[1], 'good');
    if (combo > 1 && combo % 5 === 0) hud.popup('CHAIN ×' + combo + '!', 0, 0.22, 'info');
    hud.event('destroy');
    addXP(18 + (r * 14 | 0));
    if (fxOn()) {
      if (i === iMother) FX.boom(x, y, z, { rad: 9 });
      else if (r >= 1.05) FX.boom(x, y, z, { rad: r * 2.2 });
      else FX.splat(x, y, z, { color: '#ff4f86', scale: clamp(r * 1.3, 0.55, 1.4), text: combo >= 5 ? 'COMBO!' : 'POP!' });
    }
    if (i === iMother) { motherDown = true; score += 2000; hud.popup('MOTHER VIRUS POPPED! +2000', 0, 0.3, 'info'); hud.event('gate'); }
  };
  const damage = (i, dmg, x, y, z) => {
    THP[i] -= dmg; TFL[i] = 0.14;
    if (THP[i] <= 0) { pop(i, true); return; }
    sparks(x, y, z, 6, 4, 0.8); hud.event('hit'); addXP(2);
    if (fxOn() && TR[i] >= 1.05) FX.pow(x, y, z, { scale: min(1.2, TR[i] / 2), color: '#ff7fb0' });
  };

  // ---------------------------------------------------------------- run control
  // the opening pose: the ship is steering in toward the axis, which gives the concept's heading (BG-K1)
  function reset() {
    for (const k in vm) { vm[k].inst.set(baseInst[k]); vm[k].dirty = true; }
    for (let i = 0; i < nT; i++) { THP[i] = THPM[i]; TFL[i] = 0; TAL[i] = 1; }
    BL.fill(0); SL.fill(0); if (fxOn()) FX.clear?.();
    s = H.s; ox = H.shipU; oy = H.shipV; vx = H.shipVX; vy = H.shipVY; spd = SPEED; runT = 0; started = false; ended = false; roll = 0;
    score = 0; combo = 1; comboT = 0; bestCombo = 1; xp = 0; level = 1; heat = 0; overheated = false; fireCD = 0;
    boost = 0; onLane = -1; laneT = 0; bumps = 0; popped = 0; motherDown = false;
    for (let k = 0; k < NH; k++) { HU[k] = ox; HV[k] = oy; } histT = 0;
    L[0] = L[1] = L[2] = 0; cwT = 1; vwT = wantView(); pu = pv = 0;
    placeCamera(0); writePools();
  }
  function finish() {
    ended = true; hud.event(motherDown ? 'win' : 'gate');
    hud.results({ title: motherDown ? 'Swarm cleared!' : 'Through the vessel!', lines: [
      ['Score', score], ['Viruses popped', popped + ' / ' + nT], ['Best chain', '×' + bestCombo], ['Mother virus', motherDown ? 'Popped' : 'Got away'],
      ['Boost lane time', laneT.toFixed(1) + ' s'], ['Bumps', bumps], ['Blaster', 'L' + level + ' · ' + weapon().name], ['Time', (stats.time || runT).toFixed(1) + ' s']] }, () => GAME.reset());
  }

  // ---------------------------------------------------------------- camera + ship
  const glowAt = (st, o) => { if (st <= len) return rail.at(st, o); rail.at(len, o); rail.tan(len, T2); const e = st - len; o[0] += T2[0] * e; o[1] += T2[1] * e; o[2] += T2[2] * e; return o; };
  function placeCamera(dt) {
    SC.frame(s, FR); rail.at(s, T1);
    let jx = 0, jy = 0; const sh = fxOn() ? (FX.shake || 0) * 0.35 : 0;
    if (sh > 0 && dt > 0) { jx = (rnd() * 2 - 1) * sh; jy = (rnd() * 2 - 1) * sh; }
    // concept (opening) camera: trails the ship up-left of it, following 75% of its offset (section 6: camera −2.6 m, +1.85 m from the ship at the hero pose)
    const u = ox * 0.75 - 2.3 + jx, v = oy * 0.75 + 1.6 + jy;
    cam[0] = T1[0] + FR[3] * u + FR[6] * v; cam[1] = T1[1] + FR[4] * u + FR[7] * v; cam[2] = T1[2] + FR[5] * u + FR[8] * v;
    // look: the rail tangent turned right and down so the ship sits at the lower right (BG-K1), blended toward the aim
    const ty = Math.tan(H.yaw), tp = Math.tan(H.pitch);
    let lx = FR[0] + FR[3] * ty + FR[6] * tp, ly = FR[1] + FR[4] * ty + FR[7] * tp, lz = FR[2] + FR[5] * ty + FR[8] * tp; let l = hypot(lx, ly, lz); lx /= l; ly /= l; lz /= l;
    // play camera (VIEW.md): cockpit = the pilot position (the ship's rail point plus the steering offset); shoulder =
    // SH_BACK m back along the rail, SH_UP up and SH_RIGHT right (plus the reticle push), clamped inside the vessel.
    // Looks down the rail like the cockpit, converging on the pilot's line SH_CONVERGE m ahead of the ship (a ~2° tilt, so
    // the ship clears the canopy dash at the bottom of the screen). Blended in from the concept camera over VIEW_BLEND once the run starts.
    const cw = ease(cwT), w = ease(vwT);
    vis = max(cw, w);
    if (cw < 1) {
      const sc = s + H.shipAhead - SH_BACK * w; SC.frame(sc, FC); rail.at(sc, C1);
      let pu_ = ox + (SH_RIGHT + pu) * w + jx, pv_ = oy + (SH_UP + pv) * w + jy; const pr = hypot(pu_, pv_); if (pr > CAM_R) { pu_ *= CAM_R / pr; pv_ *= CAM_R / pr; }
      const px = C1[0] + FC[3] * pu_ + FC[6] * pv_, py = C1[1] + FC[4] * pu_ + FC[7] * pv_, pz = C1[2] + FC[5] * pu_ + FC[8] * pv_;
      cam[0] = mix(px, cam[0], cw); cam[1] = mix(py, cam[1], cw); cam[2] = mix(pz, cam[2], cw);
      const cu = SH_RIGHT * w / (SH_BACK * w + SH_CONVERGE), cv = SH_UP * w / (SH_BACK * w + SH_CONVERGE);
      lx = mix(FC[0] - FC[3] * cu - FC[6] * cv, lx, cw); ly = mix(FC[1] - FC[4] * cu - FC[7] * cv, ly, cw); lz = mix(FC[2] - FC[5] * cu - FC[8] * cv, lz, cw); l = hypot(lx, ly, lz); lx /= l; ly /= l; lz /= l;
    }
    if (started) {
      const ax = aim[0] * tanH * aspect, ay = aim[1] * tanH;
      let dx = lx + CB[3] * ax + CB[6] * ay, dy = ly + CB[4] * ax + CB[7] * ay, dz = lz + CB[5] * ax + CB[8] * ay; const dl = hypot(dx, dy, dz);
      const la = LOOK_AIM * (1 - 0.6 * w * (1 - cw)); // less look-swing over the shoulder, so the ship holds its place on screen
      lx = mix(lx, dx / dl, la); ly = mix(ly, dy / dl, la); lz = mix(lz, dz / dl, la);
    }
    const k = started && dt > 0 && L[0] + L[1] + L[2] !== 0 ? 1 - exp(-dt * 6) : 1;
    L[0] += (lx - L[0]) * k; L[1] += (ly - L[1]) * k; L[2] += (lz - L[2]) * k; l = hypot(L[0], L[1], L[2]);
    rail.yawPitch(L[0] / l, L[1] / l, L[2] / l, YP);
    const cy = cos(YP[0]), sy = sin(YP[0]), cp = cos(YP[1]), sp = sin(YP[1]);
    CB[0] = sy * cp; CB[1] = sp; CB[2] = cy * cp; CB[3] = cy; CB[4] = 0; CB[5] = -sy; CB[6] = -sp * sy; CB[7] = cp; CB[8] = -sp * cy;
    if (F) { F[0] = cam[0]; F[1] = cam[1]; F[2] = cam[2]; F[3] = YP[0]; F[4] = YP[1]; F[11] = H.fov + 0.14 * clamp((spd - SPEED) / (LANE_SPEED - SPEED), 0, 1); }
    // the glow (L1) lies down the vessel: the shader's p0
    glowAt(s + 180, T2); { const dx = T2[0] - cam[0], dy = T2[1] - cam[1], dz = T2[2] - cam[2], d = hypot(dx, dy, dz); SC.p0[0] = dx / d; SC.p0[1] = dy / d; SC.p0[2] = dz / d; }
    placeShip();
    if (dt > 0) keepReticleClear(dt, w * (1 - cw));
  }
  // shoulder view: the ship must never sit under the reticle (which follows the aim) or over the screen centre. Work out
  // where the ship would be on screen without the push; if that is inside the keep-out ellipse round the reticle, then
  // round the centre, move it to that ellipse's edge, away from the ellipse's middle. The camera shifts to do it (up to
  // PUSH_MAX m each way, smoothed).
  const QN = new Float64Array(2);
  const keepOut = (cx, cy, rx, ry, fx, fy) => {
    let ex = (QN[0] - cx) / rx, ey = (QN[1] - cy) / ry; const e = hypot(ex, ey);
    if (e >= 1) return;
    if (e < 1e-3) { ex = fx; ey = fy; } else { ex /= e; ey /= e; }
    QN[0] = cx + ex * rx; QN[1] = cy + ey * ry;
  };
  function keepReticleClear(dt, w) {
    let tu = 0, tv = 0;
    if (w > 0.02) {
      project(ship[0], ship[1], ship[2], PJ);
      if (PJ[2] > 0.5) {
        const sx = PJ[2] * tanH * aspect, sy = PJ[2] * tanH; // metres per NDC unit at the ship's depth
        const bx = PJ[0] + pu * w / sx, by = PJ[1] + pv * w / sy; // the ship's NDC without the push
        QN[0] = bx; QN[1] = by;
        keepOut(aim[0], aim[1], RET_RX, RET_RY, -0.5, -0.85);
        keepOut(0, 0, CTR_RX, CTR_RY, -0.6, -0.8);
        tu = clamp(-(QN[0] - bx) * sx / w, -PUSH_MAX, PUSH_MAX); tv = clamp(-(QN[1] - by) * sy / w, -PUSH_MAX, PUSH_MAX);
      }
    }
    const k = 1 - exp(-dt * 9); pu += (tu - pu) * k; pv += (tv - pv) * k;
  }
  function placeShip() {
    const ss = s + H.shipAhead; SC.frame(ss, FS); rail.at(ss, T1);
    ship[0] = T1[0] + FS[3] * ox + FS[6] * oy; ship[1] = T1[1] + FS[4] * ox + FS[7] * oy; ship[2] = T1[2] + FS[5] * ox + FS[8] * oy;
    // basis: nose along the rail, turned a little toward its sideways motion; then banked by roll
    const yw = clamp(vx * 0.05, -0.35, 0.35), pt = clamp(vy * 0.05, -0.3, 0.3);
    let fx = FS[0] + FS[3] * yw + FS[6] * pt, fy = FS[1] + FS[4] * yw + FS[7] * pt, fz = FS[2] + FS[5] * yw + FS[8] * pt; const fl = hypot(fx, fy, fz); fx /= fl; fy /= fl; fz /= fl;
    let rx = fz, rz = -fx; const rl = hypot(rx, rz) || 1; rx /= rl; rz /= rl; let ux = fy * rz, uy = fz * rx - fx * rz, uz = -fy * rx;
    const cr = cos(roll), sr = sin(roll);
    const Rx = rx * cr + ux * sr, Ry = uy * sr, Rz = rz * cr + uz * sr, Ux = ux * cr - rx * sr, Uy = uy * cr, Uz = uz * cr - rz * sr;
    SB[0] = Rx; SB[1] = Ry; SB[2] = Rz; SB[3] = Ux; SB[4] = Uy; SB[5] = Uz; SB[6] = fx; SB[7] = fy; SB[8] = fz;
    // quaternion from the basis columns (x = right, y = up, z = forward)
    const m00 = Rx, m11 = Uy, m22 = fz, tr = m00 + m11 + m22;
    if (tr > 0) { const q = sqrt(tr + 1) * 2; SQ[3] = 0.25 * q; SQ[0] = (Uz - fy) / q; SQ[1] = (fx - Rz) / q; SQ[2] = (Ry - Ux) / q; }
    else if (m00 > m11 && m00 > m22) { const q = sqrt(1 + m00 - m11 - m22) * 2; SQ[3] = (Uz - fy) / q; SQ[0] = 0.25 * q; SQ[1] = (Ux + Ry) / q; SQ[2] = (fx + Rz) / q; }
    else if (m11 > m22) { const q = sqrt(1 + m11 - m00 - m22) * 2; SQ[3] = (fx - Rz) / q; SQ[0] = (Ux + Ry) / q; SQ[1] = 0.25 * q; SQ[2] = (fy + Uz) / q; }
    else { const q = sqrt(1 + m22 - m00 - m11) * 2; SQ[3] = (Ry - Ux) / q; SQ[0] = (fx + Rz) / q; SQ[1] = (fy + Uz) / q; SQ[2] = 0.25 * q; }
    for (const m of G.meshes) if (m.shipPart) { const a = m.inst; a[0] = ship[0]; a[1] = ship[1]; a[2] = ship[2]; a[3] = vis; a[4] = SQ[0]; a[5] = SQ[1]; a[6] = SQ[2]; a[7] = SQ[3]; m.dirty = true; }
  }

  // ---------------------------------------------------------------- weapon
  function fire() {
    const w = weapon(), ax = aim[0] * tanH * aspect, ay = aim[1] * tanH;
    let dx = CB[0] + CB[3] * ax + CB[6] * ay, dy = CB[1] + CB[4] * ax + CB[7] * ay, dz = CB[2] + CB[5] * ax + CB[8] * ay; const dl = hypot(dx, dy, dz); dx /= dl; dy /= dl; dz /= dl;
    // converge on the first live virus along the aim ray (so bolts from the off-centre ship land under the reticle)
    let tHit = 90;
    for (let i = 0; i < nT; i++) {
      if (!TAL[i] || TS[i] < s - 5 || TS[i] > s + 160) continue;
      const fx = TX[i] - cam[0], fy = TY[i] - cam[1], fz = TZ[i] - cam[2], b = fx * dx + fy * dy + fz * dz; if (b < 2 || b > tHit) continue;
      const c = fx * fx + fy * fy + fz * fz - b * b, R = TR[i] * 1.3; if (c < R * R) tHit = b - sqrt(R * R - c) * 0.5;
    }
    const tx = cam[0] + dx * tHit, ty = cam[1] + dy * tHit, tz = cam[2] + dz * tHit;
    for (let b = 0; b < w.bolts; b++) {
      const side = w.bolts === 1 ? 0 : w.bolts === 2 ? (b ? 0.5 : -0.5) : (b - 1) * 0.5, ang = w.bolts === 3 ? (b - 1) * w.spread : 0;
      const x0 = ship[0] + SB[6] * 1.7 + SB[0] * side, y0 = ship[1] + SB[7] * 1.7 + SB[1] * side, z0 = ship[2] + SB[8] * 1.7 + SB[2] * side;
      let vx_ = tx - x0 + CB[3] * ang * tHit, vy_ = ty - y0, vz_ = tz - z0 + CB[5] * ang * tHit; const vl = hypot(vx_, vy_, vz_);
      const i = boltNext; boltNext = (boltNext + 1) % NBOLT;
      BX[i * 3] = x0; BX[i * 3 + 1] = y0; BX[i * 3 + 2] = z0;
      BV[i * 3] = vx_ / vl * BOLT_SPEED + FR[0] * spd; BV[i * 3 + 1] = vy_ / vl * BOLT_SPEED + FR[1] * spd; BV[i * 3 + 2] = vz_ / vl * BOLT_SPEED + FR[2] * spd;
      BL[i] = BOLT_LIFE; BD[i] = w.dmg; BS[i] = w.size;
    }
    hud.event('fire');
  }
  // test autopilot (?debug&auto): aim at the nearest live virus ahead, steer onto lanes, fire
  function autopilot(input) {
    let best = -1, bd = 1e9;
    for (let i = 0; i < nT; i++) { if (!TAL[i] || TS[i] < s + 8 || TS[i] > s + 90) continue; project(TX[i], TY[i], TZ[i], PJ); if (PJ[2] < 4 || abs(PJ[0]) > 0.9 || abs(PJ[1]) > 0.9) continue; if (PJ[2] < bd) { bd = PJ[2]; best = i; } }
    if (best >= 0) { project(TX[best], TY[best], TZ[best], PJ); input.gunner.x = PJ[0]; input.gunner.y = PJ[1]; input.gunner.fire = true; } else input.gunner.fire = false;
    const k = laneAt(s + H.shipAhead + 25);
    if (k >= 0) { const a = laneAngle(k, s + H.shipAhead); input.pilot.x = cos(a) * LANE_RAD / BOX; input.pilot.y = sin(a) * LANE_RAD / BOX; } else { input.pilot.x = 0.2; input.pilot.y = -0.2; }
  }

  // ---------------------------------------------------------------- frame
  function update(dt, input) {
    if (auto && dt > 0) autopilot(input);
    aim[0] = clamp(input.gunner.x, -1, 1); aim[1] = clamp(input.gunner.y, -1, 1);
    if (fxOn() && dt > 0) dt *= FX.timeScale ?? 1;
    if (ended || dt <= 0) { if (started) vwT = wantView(); placeCamera(0); writePools(); return; } // paused: a view switch shows at once
    started = true; runT += dt;
    vwT += clamp(wantView() - vwT, -dt / VIEW_BLEND, dt / VIEW_BLEND); cwT = max(0, cwT - dt / VIEW_BLEND);
    // steering: the ship's offset follows the pilot inside a disk (the vessel is ~11 m in radius)
    let tx = clamp(input.pilot.x, -1, 1) * BOX, ty = clamp(input.pilot.y, -1, 1) * BOX; const tl = hypot(tx, ty); if (tl > BOX) { tx *= BOX / tl; ty *= BOX / tl; }
    const k = 1 - exp(-dt * 3.4), nox = ox + (tx - ox) * k, noy = oy + (ty - oy) * k;
    vx = (nox - ox) / dt; vy = (noy - oy) / dt; ox = nox; oy = noy;
    roll += (clamp(-vx * 0.12, -0.7, 0.7) - roll) * (1 - exp(-dt * 4));
    // boost lanes: riding within LANE_R of a lane's vein fills the boost; off the lane it drains
    const ss = s + H.shipAhead, kL = laneAt(ss);
    let riding = false;
    if (kL >= 0) { const a = laneAngle(kL, ss); riding = hypot(ox - cos(a) * LANE_RAD, oy - sin(a) * LANE_RAD) < LANE_R; }
    if (riding) { if (onLane !== kL) { onLane = kL; hud.event('pickup'); hud.popup('BOOST!', 0, -0.2, 'info'); if (fxOn()) FX.kick(0.15); } boost = min(1, boost + dt * 1.6); laneT += dt; score += (dt * 60) | 0; }
    else { onLane = -1; boost = max(0, boost - dt * 0.55); }
    spd += (SPEED + (LANE_SPEED - SPEED) * boost - spd) * (1 - exp(-dt * (riding ? 2.5 : 1.5)));
    s += spd * dt;
    histT += dt; while (histT > 1 / 30) { histT -= 1 / 30; hHead = (hHead + 1) % NH; HU[hHead] = ox; HV[hHead] = oy; }
    placeCamera(dt);

    // weapon: heat, overheat lock, rate cooldown
    const w = weapon();
    heat = max(0, heat - w.cool * dt); if (overheated && heat < 0.35) { overheated = false; hud.event('cooled'); }
    fireCD = max(-0.05, fireCD - dt);
    if (input.gunner.fire && !overheated && fireCD <= 0) {
      fire(); fireCD += 1 / w.rate; heat += w.heat;
      if (heat >= 1) { heat = 1; overheated = true; hud.event('overheat'); hud.popup('OVERHEAT', 0, -0.15, 'bad'); }
    }
    comboT -= dt; if (comboT <= 0) { comboT = 0; combo = 1; }

    // bolts: segment-vs-sphere against live viruses near the run
    for (let b = 0; b < NBOLT; b++) {
      if (BL[b] <= 0) continue;
      const x0 = BX[b * 3], y0 = BX[b * 3 + 1], z0 = BX[b * 3 + 2], mx = BV[b * 3] * dt, my = BV[b * 3 + 1] * dt, mz = BV[b * 3 + 2] * dt, mm = mx * mx + my * my + mz * mz;
      BX[b * 3] += mx; BX[b * 3 + 1] += my; BX[b * 3 + 2] += mz; BL[b] -= dt;
      for (let i = 0; i < nT; i++) {
        if (!TAL[i] || TS[i] < s - 10 || TS[i] > s + 180) continue;
        const fx = x0 - TX[i], fy = y0 - TY[i], fz = z0 - TZ[i], R = TR[i] * 1.25 + BS[b];
        if (fx * fx + fy * fy + fz * fz > (R + 5) * (R + 5) + mm * 4) continue;
        const t = clamp(-(fx * mx + fy * my + fz * mz) / (mm || 1), 0, 1), cx = fx + mx * t, cy = fy + my * t, cz = fz + mz * t;
        if (cx * cx + cy * cy + cz * cz < R * R) { BL[b] = 0; damage(i, BD[b], x0 + mx * t, y0 + my * t, z0 + mz * t); break; }
      }
    }
    // bumps: flying the ship into a live virus pops it, breaks the chain and slows you (no damage: kid-friendly)
    for (let i = 0; i < nT; i++) {
      if (!TAL[i] || abs(TS[i] - ss) > 6) continue;
      const dx = ship[0] - TX[i], dy = ship[1] - TY[i], dz = ship[2] - TZ[i], R = TR[i] * 0.85 + 0.5;
      if (dx * dx + dy * dy + dz * dz < R * R) {
        if (i === iMother) continue;
        bumps++; pop(i, false); hud.event('damage'); hud.popup('BUMP! chain lost', 0, -0.3, 'bad'); combo = 1; comboT = 0; spd = min(spd, BUMP_SPEED); if (fxOn()) FX.kick(0.45);
      }
    }
    // sparks and hit flashes
    const drag = exp(-dt * 2.5);
    for (let i = 0; i < NSPARK; i++) { if (SL[i] <= 0) continue; SL[i] -= dt; SX[i * 3] += SV[i * 3] * dt; SX[i * 3 + 1] += SV[i * 3 + 1] * dt; SX[i * 3 + 2] += SV[i * 3 + 2] * dt; SV[i * 3] *= drag; SV[i * 3 + 1] *= drag; SV[i * 3 + 2] *= drag; }
    for (let i = 0; i < nT; i++) if (TFL[i] > 0) { TFL[i] = max(0, TFL[i] - dt); if (TAL[i]) { TM[i].inst[TO[i] + 11] = TFL[i] * 6; TM[i].dirty = true; } }

    if (!ended && s >= sEnd) finish();
    writePools();
  }

  function writePools() {
    if (!P) return;
    for (let b = 0; b < NBOLT; b++) {
      const on = BL[b] > 0, vl = hypot(BV[b * 3], BV[b * 3 + 1], BV[b * 3 + 2]) || 1;
      for (let k = 0; k < 3; k++) {
        const back = k * 0.8 / vl, sz = on ? BS[b] * (1 - k * 0.25) : 0;
        setPt(BO0 + b * 3 + k, BX[b * 3] - BV[b * 3] * back, BX[b * 3 + 1] - BV[b * 3 + 1] * back, BX[b * 3 + 2] - BV[b * 3 + 2] * back, sz, 1.6 - k * 0.3, 3.4 - k * 0.6, 3.8 - k * 0.5, 0);
      }
    }
    for (let i = 0; i < NSPARK; i++) {
      const c = SL[i] > 0 ? SL[i] / SL0[i] : 0;
      setPt(SP0 + i, SX[i * 3], SX[i * 3 + 1], SX[i * 3 + 2], c > 0 ? SS[i] * (0.4 + 0.6 * c) : 0, (3.2 * c + 0.5) * c, (1.2 * c * c + 0.2) * c, (1.8 * c * c + 0.3) * c, 0);
    }
    // BG-K1 engine glows and BG-T1 trails: each trail follows the ship's offset history back along the rail
    // hidden in the cockpit view (they are your own engines, behind you), scaled in with the ship otherwise
    const ss = s + H.shipAhead, glow = 1 + 0.6 * boost;
    for (let e = 0; e < 4; e++) {
      const ex = ENG[e][0], ey = ENG[e][1], ez = ENG[e][2];
      const wx = ship[0] + SB[0] * ex + SB[3] * ey + SB[6] * ez, wy = ship[1] + SB[1] * ex + SB[4] * ey + SB[7] * ez, wz = ship[2] + SB[2] * ex + SB[5] * ey + SB[8] * ez;
      setPt(EN0 + e, wx, wy, wz, 0.035 * vis, 0.45 * glow, 0.95 * glow, 1.05 * glow, 0);
      // the engine's offset from the ship centre, in the rail frame (u, v)
      const eu = (wx - ship[0]) * FS[3] + (wy - ship[1]) * FS[4] + (wz - ship[2]) * FS[5], ev = (wx - ship[0]) * FS[6] + (wy - ship[1]) * FS[7] + (wz - ship[2]) * FS[8];
      for (let j = 0; j < NTR; j++) {
        const back = 1.62 + j * 0.07, st = ss - back, age = back / max(spd, 1), hk = min(NH - 1, (age * 30) | 0), h = (hHead - hk + NH) % NH;
        rail.at(max(st, 0), T1); SC.frame(max(st, 0), FR);
        const u = HU[h] + eu, v = HV[h] + ev, f = 1 - j / NTR, a = f * (0.6 + 0.4 * glow);
        setPt(TR0 + e * NTR + j, T1[0] + FR[3] * u + FR[6] * v, T1[1] + FR[4] * u + FR[7] * v, T1[2] + FR[5] * u + FR[8] * v, (0.09 + j * 0.0004) * vis, 0.05 * a, 0.13 * a, 0.21 * a, 0);
      }
    }
    SC.frame(s, FR); // placeCamera's FR is reused by fire(); restore it
  }

  // ---------------------------------------------------------------- HUD feed
  function post(view) {
    F = view.F; tanH = view.tan; aspect = view.aspect;
    const w = weapon();
    stats.score = score; stats.combo = combo; stats.level = level; stats.xp = xp;
    stats.xpNext = level < WEAPONS.length ? WEAPONS[level].xp : WEAPONS[WEAPONS.length - 1].xp; stats.heat = heat; stats.overheated = overheated;
    stats.counterValue = popped; stats.weaponName = w.name; stats.speed = spd; stats.boost = boost;
    hud.set(stats);
    if (!MK) return;
    const fx = view.f[0], fy = view.f[1], fz = view.f[2], rx = view.r[0], rz = view.r[2], ux = view.u[0], uy = view.u[1], uz = view.u[2], cx = F[0], cy = F[1], cz = F[2];
    let b1 = -1, b2 = -1, d1 = 0.3 * 0.3, d2 = d1, nb = 0;
    const ax = aim[0], ay = aim[1], ta = view.tan * view.aspect, tv = view.tan;
    for (let i = 0; i < nT; i++) {
      if (!TAL[i] || TS[i] < s - 10 || TS[i] > s + RADAR_RANGE) continue;
      const dx = TX[i] - cx, dy = TY[i] - cy, dz = TZ[i] - cz, z = dx * fx + dy * fy + dz * fz, rR = dx * rx + dz * rz, rU = dx * ux + dy * uy + dz * uz;
      if (z > 2 && z < LOCK_RANGE) { const nx = rR / (z * ta) - ax, ny = rU / (z * tv) - ay, e = nx * nx + ny * ny; if (e < d1) { d2 = d1; b2 = b1; d1 = e; b1 = i; } else if (e < d2) { d2 = e; b2 = i; } }
      const o = nb * 4; BLP[o] = rR; BLP[o + 1] = rU; BLP[o + 2] = z; BLP[o + 3] = i === iMother ? 2 : 0; nb++;
    }
    let nm = 0;
    const mark = (x, y, z, kind, label) => {
      const dx = x - cx, dy = y - cy, dz = z - cz, d = dx * fx + dy * fy + dz * fz; if (d <= 0.5 || nm >= 6) return;
      const o = nm * 6; MK[o] = (dx * rx + dz * rz) / (d * ta); MK[o + 1] = (dx * ux + dy * uy + dz * uz) / (d * tv); MK[o + 2] = d; MK[o + 3] = kind; MK[o + 4] = hypot(dx, dy, dz); MK[o + 5] = label; nm++;
    };
    if (b1 >= 0) mark(TX[b1], TY[b1], TZ[b1], 0, b1 === iMother ? 2 : 0);
    if (b2 >= 0) mark(TX[b2], TY[b2], TZ[b2], 0, b2 === iMother ? 2 : 0);
    // the next boost lane's entry
    const ss = s + H.shipAhead;
    for (let k = 0; k < LANES.length; k++) if (LANES[k][1] > ss && LANES[k][0] < ss + 140) {
      const st = max(LANES[k][0], ss + 12); rail.at(st, T1); SC.frame(st, FS); const a = laneAngle(k, st), u = cos(a) * LANE_RAD, v = sin(a) * LANE_RAD;
      const x = T1[0] + FS[3] * u + FS[6] * v, y = T1[1] + FS[4] * u + FS[7] * v, z = T1[2] + FS[5] * u + FS[8] * v;
      mark(x, y, z, 1, 1); const o = nb * 4; BLP[o] = (x - cx) * rx + (z - cz) * rz; BLP[o + 1] = (x - cx) * ux + (y - cy) * uy + (z - cz) * uz; BLP[o + 2] = (x - cx) * fx + (y - cy) * fy + (z - cz) * fz; BLP[o + 3] = 1; nb++;
      break;
    }
    SC.frame(ss, FS); // restore the ship frame used by writePools
    hud.marks(MK, nm); hud.blips(BLP, nb);
  }

  return { id: 'body-glow', title: 'Glow Run', skin: 'canopy', palette: 'Synth Violet', weapons: WEAPONS, lanes: LANES, prepare, init, update, post, reset,
    get rail() { return rail; } };
})();
