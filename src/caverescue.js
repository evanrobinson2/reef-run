// ============================================================================
// caverescue.js: Cave Rescue. A rail run through the Hollow Asteroid: hit stranded explorers with the tractor shot and
// they float to your ship. You are the ship (VIEW.md): cockpit view by default, the concept ship shown over the shoulder
// on request. Follows GAME_API.md (game module contract).
// Everything below is load-time allocation; update() and post() reuse preallocated arrays.
// ============================================================================
const GAME = (() => {
  // ---------------------------------------------------------------- tuning (data)
  const SPEED = 5.0;            // m/s along the rail
  const BOX_X = 3, BOX_Y = 2.2; // pilot offset box (m)
  const CLEAR_RAIL = 2.5, CLEAR_CAM = 0.8;
  const FOV = 60 * Math.PI / 180;
  const LOOK_AIM = 0.15;        // look = rail tangent blended this far toward the aim
  // view (VIEW.md): cockpit = the camera is the ship; shoulder = the camera sits behind, above and right of the ship
  const SH_BACK = 4.5, SH_UP = 1.3, SH_RIGHT = 0.9, BLEND_T = 0.35;
  const SHIP_S = 0.8, NOSE = 1.3; // the player's ship scale in play (concept scale 1) and its nose (local +z, m at scale 1)
  const CLEAR_SHIP = 1.3;         // in shoulder view the pilot position keeps this much rock clearance (the ship has wings)
  const LOOK_AHEAD = 7;
  const LOST_AFTER = 15;        // metres past a person before they count as lost
  const COMBO_WINDOW = 7;       // seconds between rescues to keep the combo
  const RESCUE_POINTS = 200, RESCUE_XP = 150, COMBO_XP = 10;
  const TRACTOR_TIME = 1.0;
  // weapon levels: shop upgrades can later write to this table
  const WEAPON = [
    { xp: 0, radius: 0.9, speed: 42, rate: 3.5, heat: 0.14, cool: 0.32, twin: false },
    { xp: 300, radius: 1.1, speed: 50, rate: 4.0, heat: 0.13, cool: 0.38, twin: false },
    { xp: 800, radius: 1.3, speed: 58, rate: 4.5, heat: 0.12, cool: 0.45, twin: true },
    { xp: 1500, radius: 1.5, speed: 66, rate: 5.0, heat: 0.11, cool: 0.55, twin: true },
    { xp: 2500, radius: 1.8, speed: 75, rate: 5.5, heat: 0.10, cool: 0.65, twin: true },
  ];
  const HEAT_RESUME = 0.35;
  const NAMES = ['Mira', 'Tobi', 'Ana', 'Kai', 'Lio', 'Suki', 'Remy', 'Juno', 'Pip', 'Nell', 'Otto', 'Zara', 'Bo', 'Ivy', 'Finn', 'Wren'];
  const NP = 14;
  // draft rail (refined against G.field in init): tunnel → concept camera (yaw -0.02) → two rising laps of the
  // chamber → a corkscrew up the exit tube → out into the bright void
  const DRAFT = [
    [0.36, 0.6, -18], [0.24, 0.6, -12], [0.12, 0.6, -6], [0.06, 0.6, -3], [0, 0.6, 0], [-0.06, 0.6, 3], [-0.12, 0.6, 6],
    [-0.6, 0.4, 7], [-2.2, -0.5, 12.5], [-2.6, -1, 18], [-2.8, -0.8, 23], [-4.3, -0.4, 26.8], [-6.9, 0.1, 25.6],
    [-8, 0.6, 20.5], [-7.3, 1.0, 15.2], [-4.8, 1.4, 13.4], [-2.8, 1.8, 16.2], [-2.6, 2.2, 21.5], [-3.9, 2.8, 26.6],
    [-6.8, 3.3, 25.6], [-8, 3.6, 20.5], [-7.6, 3.8, 16.5], [-6.0, 4.0, 14.2], [-4.0, 4.2, 15.2], [-3.6, 4.5, 18.8],
    [-4.6, 5.1, 23.5], [-5.4, 6.4, 28.5],
    // a corkscrew up the exit tube (axis about x -5.5, y 7.2), then straight out
    ...Array.from({ length: 8 }, (_, k) => { const a = Math.PI * (1 + k * 0.5); return [-5.5 + 2.7 * Math.cos(a), 7.2 + 2.3 * Math.sin(a), 32 + k * 4.2]; }),
    [-6.6, 8.2, 64], [-7.5, 8.5, 70],
  ];
  const CONCEPT = [0, 0.6, 0];
  const PIN_Z = 6;     // |z| <= this around the concept camera stays exactly as drafted
  const VOID_Z = 61;     // beyond the asteroid shell the field is constant (open void); no push there

  // ---------------------------------------------------------------- state
  let shell = null, vb = 0, kEye = 1, shipRoll = 0;
  let G = null, hud = null, field = null, rail = null, F = null, view = null;
  let s0 = 0, s = 0, ox = 0, oy = 0, t = 0, runTime = 0, over = false;
  let heat = 0, overheated = false, fireT = 0, level = 1, xp = 0, score = 0, combo = 1, lastRescue = -99, rescued = 0, lost = 0;
  const stats = { score: 0, combo: 1, time: 0, level: 1, xp: 0, xpNext: 300, heat: 0, overheated: false, weaponName: 'Tractor', counterLabel: 'Rescued', counterValue: 0, counterMax: NP };
  const fr = new Float64Array(9), rp = [0, 0, 0], tp = [0, 0, 0], tq = [0, 0, 0], cam = [0, 0, 0], eye = [0, 0, 0], look = [0, 0, 1], o3 = [0, 0, 0];
  const vf = [0, 0, 1], vr = [1, 0, 0], vu = [0, 1, 0]; let vtan = Math.tan(FOV / 2), vasp = 1.6;
  // people
  const P = { s: new Float32Array(NP), base: new Float32Array(NP * 3), q: new Float32Array(NP * 4), up: new Float32Array(NP * 3), pos: new Float32Array(NP * 3),
    state: new Uint8Array(NP), tt: new Float32Array(NP), ph: new Float32Array(NP), scale: new Float32Array(NP), name: new Array(NP).fill('') };
  let parts = [], arm = null, shipParts = [], shipBase = null;
  const SHOULDER = [0.3, 1.04, 0];
  // points: [beacons NP][bolts NB*7][beams NBM*BMN][sparks NS]
  const NB = 24, BP = 7, NBM = 4, BMN = 12, NS = 48;
  let P0 = 0, PB = 0, PBM = 0, PS = 0, PEND = 0;
  const bolt = { on: new Uint8Array(NB), p: new Float32Array(NB * 3), v: new Float32Array(NB * 3), life: new Float32Array(NB), r: new Float32Array(NB) };
  const beam = { who: new Int8Array(NBM).fill(-1) };
  const spark = { p: new Float32Array(NS * 3), v: new Float32Array(NS * 3), life: new Float32Array(NS) }; let sparkNext = 0;
  // HUD feeds
  const marks = new Float32Array((NP + 1) * 6), blips = new Float32Array((NP + 1) * 4), endP = [0, 0, 0];
  // ship pose scratch (cam is the pilot position = the ship; eye is the render camera)
  const sq = [0, 0, 0, 1], sqb = [0, 0, 0, 1], bR = [1, 0, 0], bU = [0, 1, 0], bF = [0, 0, 1];

  // local PRNG, so the scene's random streams stay untouched
  let seed = 9177;
  const rand = () => { seed = (seed + 0x6D2B79F5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };

  // ---------------------------------------------------------------- small vector / quaternion helpers (no allocation)
  const grad = (x, y, z, o) => { const e = 0.4; o[0] = field(x + e, y, z) - field(x - e, y, z); o[1] = field(x, y + e, z) - field(x, y - e, z); o[2] = field(x, y, z + e) - field(x, y, z - e); const l = Math.hypot(o[0], o[1], o[2]) || 1; o[0] /= l; o[1] /= l; o[2] /= l; return o; };
  const qmul = (a, b, o) => { const x = a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], y = a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], z = a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], w = a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]; o[0] = x; o[1] = y; o[2] = z; o[3] = w; return o; };
  const qaxis = (x, y, z, a, o) => { const sa = Math.sin(a / 2); o[0] = x * sa; o[1] = y * sa; o[2] = z * sa; o[3] = Math.cos(a / 2); return o; };
  const qrot = (q, x, y, z, o) => { // v + w*t + q×t, t = 2 q×v
    const tx = 2 * (q[1] * z - q[2] * y), ty = 2 * (q[2] * x - q[0] * z), tz = 2 * (q[0] * y - q[1] * x);
    o[0] = x + q[3] * tx + q[1] * tz - q[2] * ty; o[1] = y + q[3] * ty + q[2] * tx - q[0] * tz; o[2] = z + q[3] * tz + q[0] * ty - q[1] * tx; return o; };
  // quaternion from an orthonormal basis (columns right, up, forward = local x, y, z)
  const qBasis = (r, u, f, o) => {
    const m00 = r[0], m10 = r[1], m20 = r[2], m01 = u[0], m11 = u[1], m21 = u[2], m02 = f[0], m12 = f[1], m22 = f[2], tr = m00 + m11 + m22;
    if (tr > 0) { const k = 0.5 / Math.sqrt(tr + 1); o[3] = 0.25 / k; o[0] = (m21 - m12) * k; o[1] = (m02 - m20) * k; o[2] = (m10 - m01) * k; }
    else if (m00 > m11 && m00 > m22) { const k = 2 * Math.sqrt(1 + m00 - m11 - m22); o[3] = (m21 - m12) / k; o[0] = 0.25 * k; o[1] = (m01 + m10) / k; o[2] = (m02 + m20) / k; }
    else if (m11 > m22) { const k = 2 * Math.sqrt(1 + m11 - m00 - m22); o[3] = (m02 - m20) / k; o[0] = (m01 + m10) / k; o[1] = 0.25 * k; o[2] = (m12 + m21) / k; }
    else { const k = 2 * Math.sqrt(1 + m22 - m00 - m11); o[3] = (m10 - m01) / k; o[0] = (m02 + m20) / k; o[1] = (m12 + m21) / k; o[2] = 0.25 * k; }
    return o; };
  const sstep = (a, b, x) => { x = Math.min(1, Math.max(0, (x - a) / (b - a))); return x * x * (3 - 2 * x); };

  // ---------------------------------------------------------------- rail: draft, then push clear of the rock
  function pushClear(p) {
    if (p[2] > VOID_Z) return p;
    const g = [0, 0, 0];
    for (let it = 0; it < 80; it++) {
      const f = field(p[0], p[1], p[2]); if (f < -CLEAR_RAIL - 0.08) break;
      grad(p[0], p[1], p[2], g); const k = (f + CLEAR_RAIL + 0.12) * 0.5;
      p[0] -= g[0] * k; p[1] -= g[1] * k; p[2] -= g[2] * k;
    }
    return p;
  }
  function buildRail() {
    const pinned = (p) => Math.abs(p[2]) <= PIN_Z + 1e-6 && Math.abs(p[0]) < 0.2;
    const pins = DRAFT.filter(pinned);
    let ctrl = DRAFT.map((p) => (pinned(p) ? p.slice() : pushClear(p.slice())));
    for (let pass = 0; pass < 2; pass++) {
      // resample every 1.5 m (the pinned concept segment stays exact), push each sample clear, relax lightly, push again
      const r = makeRail(ctrl, 0.5), out = []; let before = true;
      for (let q = 0; q <= r.len + 1e-6; q += 1.5) {
        const p = r.at(q, [0, 0, 0]);
        if (Math.abs(p[2]) <= PIN_Z + 1 && Math.abs(p[0]) < 1) { if (before) { out.push(...pins.map((c) => c.slice())); before = false; } continue; }
        out.push(pushClear(p));
      }
      out.push(DRAFT[DRAFT.length - 1].slice());
      for (let i = 1; i < out.length - 1; i++) { if (pinned(out[i])) continue; const a = out[i - 1], b = out[i + 1], p = out[i]; for (let c = 0; c < 3; c++) p[c] = p[c] * 0.8 + (a[c] + b[c]) * 0.1; pushClear(p); }
      ctrl = out;
    }
    rail = makeRail(ctrl, 0.5);
    // the concept camera's arc length
    let best = 1e9; const p = [0, 0, 0];
    for (let q = 0; q <= rail.len; q += 0.002) { rail.at(q, p); const d = Math.hypot(p[0] - CONCEPT[0], p[1] - CONCEPT[1], p[2] - CONCEPT[2]); if (d < best) { best = d; s0 = q; } }
    rail.conceptErr = best;
    rail.at(rail.len, endP);
  }
  // minimum clearance along the rail, including the corners of the full pilot box after the camera clamp;
  // clearance('shoulder') measures the over-the-shoulder camera instead (pilot clamp at CLEAR_SHIP, then the eye clamp)
  function clearance(mode) {
    const sh = mode === 'shoulder';
    let railMin = 1e9, railAt = 0, camMin = 1e9, camAt = 0, eyeKMin = 1; const p = [0, 0, 0], f9 = new Float64Array(9);
    for (let q = s0; q <= rail.len; q += 0.25) {
      rail.at(q, p); if (p[2] > VOID_Z) continue;
      const f = field(p[0], p[1], p[2]); if (-f < railMin) { railMin = -f; railAt = q; }
      rail.frame(q, f9);
      for (let k = 0; k < 8; k++) {
        const a = k / 8 * Math.PI * 2, c = clampOffset(p, f9, Math.cos(a) * BOX_X * (k % 2 ? 1 : 0.7), Math.sin(a) * BOX_Y * (k % 2 ? 1 : 0.7), o3, sh ? CLEAR_SHIP : CLEAR_CAM);
        let x = p[0] + f9[3] * c[0] + f9[6] * c[1], y = p[1] + f9[4] * c[0] + f9[7] * c[1], z = p[2] + f9[5] * c[0] + f9[8] * c[1];
        if (sh) {
          const dx = -f9[0] * SH_BACK + f9[3] * SH_RIGHT + f9[6] * SH_UP, dy = -f9[1] * SH_BACK + f9[4] * SH_RIGHT + f9[7] * SH_UP, dz = -f9[2] * SH_BACK + f9[5] * SH_RIGHT + f9[8] * SH_UP;
          const ke = eyeK(x, y, z, dx, dy, dz); if (ke < eyeKMin) eyeKMin = ke; x += dx * ke; y += dy * ke; z += dz * ke;
        }
        const fc = field(x, y, z);
        if (-fc < camMin) { camMin = -fc; camAt = q; }
      }
    }
    return { mode: sh ? 'shoulder' : 'cockpit', railMin, railAt, camMin, camAt, eyeKMin, len: rail.len, s0, runLen: rail.len - s0, conceptErr: rail.conceptErr };
  }
  // largest fraction of the offset (x right, y up) that keeps the camera at least CLEAR_CAM in open space
  function clampOffset(p, f9, x, y, o, clr = CLEAR_CAM) {
    const at = (k) => field(p[0] + (f9[3] * x + f9[6] * y) * k, p[1] + (f9[4] * x + f9[7] * y) * k, p[2] + (f9[5] * x + f9[8] * y) * k);
    let k = 1;
    if (at(1) > -clr) { let lo = 0, hi = 1; for (let i = 0; i < 7; i++) { const m = (lo + hi) / 2; if (at(m) <= -clr) lo = m; else hi = m; } k = lo; }
    o[0] = x * k; o[1] = y * k; return o;
  }
  // the shoulder camera: the largest fraction k of the vector d from the ship (x, y, z) that keeps the eye, and the
  // line back to the ship, at least CLEAR_CAM in open space (march out, then refine). The ship is already clear.
  function eyeK(x, y, z, dx, dy, dz) {
    const at = (k) => field(x + dx * k, y + dy * k, z + dz * k);
    let lo = 0, hi = -1;
    for (let i = 1; i <= 6; i++) { const m = i / 6; if (at(m) > -CLEAR_CAM) { hi = m; break; } lo = m; }
    if (hi < 0) return 1;
    for (let i = 0; i < 6; i++) { const m = (lo + hi) / 2; if (at(m) <= -CLEAR_CAM) lo = m; else hi = m; }
    return lo;
  }

  // ---------------------------------------------------------------- people
  function placePeople() {
    const p = [0, 0, 0], d = [0, 0, 0], g = [0, 0, 0], f9 = new Float64Array(9);
    const sA = s0 + 14, sB = rail.len - 26;
    for (let i = 0; i < NP; i++) {
      let ok = false;
      for (let tries = 0; tries < 400 && !ok; tries++) {
        const si = sA + (sB - sA) * (i + 0.5 + (rand() - 0.5) * 0.6) / NP;
        rail.at(si, p); rail.frame(si, f9);
        if (p[2] > VOID_Z - 4) continue;
        // a random direction perpendicular to the rail, biased toward floors and side walls
        const a = rand() * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a) * (sa0(a) ? 1 : 0.6);
        for (let c = 0; c < 3; c++) d[c] = f9[3 + c] * ca + f9[6 + c] * sa;
        const dl = Math.hypot(d[0], d[1], d[2]); d[0] /= dl; d[1] /= dl; d[2] /= dl;
        // march out until the field crosses 0
        let hit = -1;
        for (let m = 0.5; m < 11; m += 0.25) { if (field(p[0] + d[0] * m, p[1] + d[1] * m, p[2] + d[2] * m) > 0) { hit = m; break; } }
        if (hit < 4 || hit > 10) continue;
        let lo = hit - 0.25, hi = hit; for (let k = 0; k < 8; k++) { const m = (lo + hi) / 2; if (field(p[0] + d[0] * m, p[1] + d[1] * m, p[2] + d[2] * m) > 0) hi = m; else lo = m; }
        const x = p[0] + d[0] * lo, y = p[1] + d[1] * lo, z = p[2] + d[2] * lo;
        grad(x, y, z, g); const nx = -g[0], ny = -g[1], nz = -g[2];
        if (ny < -0.55) continue; // not hanging from the ceiling
        if (nx * -d[0] + ny * -d[1] + nz * -d[2] < 0.35) continue; // the surface must face the rail
        // keep apart from the others
        let near = false; for (let j = 0; j < i; j++) if (Math.hypot(P.base[j * 3] - x, P.base[j * 3 + 1] - y, P.base[j * 3 + 2] - z) < 4) near = true;
        if (near) continue;
        P.base[i * 3] = x - nx * 0.06; P.base[i * 3 + 1] = y - ny * 0.06; P.base[i * 3 + 2] = z - nz * 0.06;
        P.up[i * 3] = nx; P.up[i * 3 + 1] = ny; P.up[i * 3 + 2] = nz;
        // face the rail: forward = direction to the rail point projected onto the surface plane
        let fx = p[0] - x, fy = p[1] - y, fz = p[2] - z; const dn = fx * nx + fy * ny + fz * nz; fx -= nx * dn; fy -= ny * dn; fz -= nz * dn;
        let fl = Math.hypot(fx, fy, fz); if (fl < 1e-3) { fx = f9[0]; fy = f9[1]; fz = f9[2]; fl = 1; }
        fx /= fl; fy /= fl; fz /= fl;
        const rx = ny * fz - nz * fy, ry = nz * fx - nx * fz, rz = nx * fy - ny * fx; // right = up × forward
        const q = qBasis([rx, ry, rz], [nx, ny, nz], [fx, fy, fz], [0, 0, 0, 1]);
        P.q.set(q, i * 4);
        // the rail station where they are passed (closest approach)
        let bs = si, bd = 1e9; for (let qq = si - 12; qq <= si + 12; qq += 0.5) { rail.at(qq, tp); const dd = Math.hypot(tp[0] - x, tp[1] - y, tp[2] - z); if (dd < bd) { bd = dd; bs = qq; } }
        P.s[i] = bs; P.ph[i] = rand(); P.scale[i] = 1.12; P.name[i] = NAMES[i % NAMES.length];
        ok = true;
      }
      if (!ok) { P.s[i] = -1; P.scale[i] = 0; }
    }
  }
  const sa0 = (a) => Math.sin(a) < 0; // downward half of the circle: full weight

  function buildPeopleMeshes() {
    const ORANGE = [0.98, 0.50, 0.13], DORANGE = [0.80, 0.36, 0.10], WHITE = [0.95, 0.95, 0.97], VISOR = [0.05, 0.06, 0.14];
    const legs = new Mesh(); for (const x of [-0.11, 0.11]) legs.tube([[x, 0.62, 0], [x, 0.3, 0.02], [x, 0.0, 0]], 0.1, 8, true);
    const torso = new Mesh(); torso.tube([[0, 0.5, 0], [0, 0.66, 0], [0, 0.9, 0], [0, 1.1, 0]], (k) => [0.19, 0.25, 0.26, 0.17][k], 10, true);
    torso.tube([[-0.3, 1.04, 0], [-0.36, 0.78, 0.04], [-0.37, 0.55, 0.08]], 0.075, 7, true); // the other arm, resting
    const helmet = icosphere(2, (x, y, z) => [x * 0.25, 1.33 + y * 0.25, z * 0.25]);
    helmet.tube([[0, 0.86, -0.22], [0, 0.86, -0.42]], 0.17, 10, true); // backpack
    const visor = icosphere(2, (x, y, z) => [x * 0.18, 1.34 + y * 0.13, 0.13 + z * 0.12]);
    const armM = new Mesh(); armM.tube([[0, 0, 0], [0.02, -0.26, 0.03], [0.02, -0.52, 0.05]], 0.075, 7, true);
    const mk = (m, rgb) => { const b = m.build(); b.inst = new Float32Array(NP * 12); for (let i = 0; i < NP; i++) { b.inst[i * 12 + 7] = 1; b.inst[i * 12 + 8] = 3; b.inst[i * 12 + 9] = rgb[0]; b.inst[i * 12 + 10] = rgb[1]; b.inst[i * 12 + 11] = rgb[2]; } b.caveRescue = true; return b; };
    parts = [mk(legs, DORANGE), mk(torso, ORANGE), mk(helmet, WHITE), mk(visor, VISOR)];
    arm = mk(armM, ORANGE);
    return [...parts, arm];
  }
  // write person i's instances from P.pos, rotation q (4 floats at qa[qo]) and scale
  const qtmp = [0, 0, 0, 1], qtmp2 = [0, 0, 0, 1], qw = [0, 0, 0, 1];
  function writePerson(i, q, sc) {
    const x = P.pos[i * 3], y = P.pos[i * 3 + 1], z = P.pos[i * 3 + 2], o = i * 12;
    for (const m of parts) { const a = m.inst; a[o] = x; a[o + 1] = y; a[o + 2] = z; a[o + 3] = sc; a[o + 4] = q[0]; a[o + 5] = q[1]; a[o + 6] = q[2]; a[o + 7] = q[3]; m.dirty = true; }
    // waving arm: pivot at the shoulder, swinging about the person's forward axis
    const wave = 2.25 + 0.5 * Math.sin(t * 6.5 + P.ph[i] * 6.28);
    qmul(q, qaxis(0, 0, 1, wave, qw), qtmp2);
    qrot(q, SHOULDER[0] * sc, SHOULDER[1] * sc, SHOULDER[2] * sc, o3);
    const a = arm.inst; a[o] = x + o3[0]; a[o + 1] = y + o3[1]; a[o + 2] = z + o3[2]; a[o + 3] = sc; a[o + 4] = qtmp2[0]; a[o + 5] = qtmp2[1]; a[o + 6] = qtmp2[2]; a[o + 7] = qtmp2[3];
    arm.dirty = true;
  }

  // ---------------------------------------------------------------- points
  const setPt = (k, x, y, z, size, r, g, b) => { const a = G.points, o = k * 8; a[o] = x; a[o + 1] = y; a[o + 2] = z; a[o + 3] = size; a[o + 4] = r; a[o + 5] = g; a[o + 6] = b; a[o + 7] = 0; };
  const hidePt = (k) => { G.points[k * 8 + 3] = 0; };

  // ---------------------------------------------------------------- init
  function init(g, Shell) {
    G = g; hud = Shell.hud; shell = Shell;
    // solid = cave rock or a sponge (the sponges are meshes, not part of G.field): above 0 is solid
    const sp = G.meshes.find((m) => m.inst.length >= 12 && m.inst[8] === 1), SPN = sp ? sp.inst.length / 12 : 0, SP = sp ? sp.inst : null;
    field = (x, y, z) => {
      let f = G.field(x, y, z);
      for (let i = 0; i < SPN; i++) { const o = i * 12, dx = x - SP[o], dy = y - SP[o + 1], dz = z - SP[o + 2], r = SP[o + 3] + 0.25; if (dx * dx + dy * dy + dz * dz < (r + 3) * (r + 3)) { const d = r - Math.sqrt(dx * dx + dy * dy + dz * dz); if (d > f) f = d; } }
      return f;
    };
    shipParts = G.meshes.filter((m) => m.shipPart);
    shipBase = { pos: G.ship.pos.slice(), q: G.ship.q.slice(), scale: shipParts[0].inst[3] };
    buildRail();
    placePeople();
    G.meshes.push(...buildPeopleMeshes());
    // points: scene points, then the static ghost rail, then the dynamic pools
    const ghost = rail.ghost(0.5, 0.05, [0.62, 0.95, 1.05]);
    const n0 = G.points.length / 8, ng = ghost.length / 8;
    P0 = n0 + ng; PB = P0 + NP; PBM = PB + NB * BP; PS = PBM + NBM * BMN; PEND = PS + NS;
    const pts = new Float32Array(PEND * 8); pts.set(G.points); pts.set(ghost, n0 * 8);
    G.points = pts; G.dynPts = [P0, PEND - P0];
    hud.labels = [...P.name, 'Exit'];
    if (typeof QS !== 'undefined' && QS.has('debug')) window.caveRescue = GAME; // test hook: ?debug
    GAME.debug = { rail, clearance, P, view: () => view, field: () => field, ship: () => G.shipNow, s0: () => s0, get s() { return s; }, set s(v) { s = v; }, bolt, WEAPON, shipNdc,
      get state() { return { heat, overheated, level, xp, score, combo, rescued, lost, over, runTime, view: shell.view, blend: vb, eyeK: kEye, eyeClear: -field(eye[0], eye[1], eye[2]) }; } };
    reset();
  }

  // ---------------------------------------------------------------- reset (also Play again)
  function reset() {
    s = s0; ox = oy = 0; t = 0; runTime = 0; over = false;
    heat = 0; overheated = false; fireT = 0; level = 1; xp = 0; score = 0; combo = 1; lastRescue = -99; rescued = 0; lost = 0; shipRoll = 0;
    vb = shell && shell.view === 'shoulder' ? 1 : 0; kEye = 1;
    rail.tan(s0, look);
    for (let i = 0; i < NP; i++) {
      P.state[i] = P.s[i] < 0 ? 2 : 0; P.tt[i] = 0;
      P.pos[i * 3] = P.base[i * 3]; P.pos[i * 3 + 1] = P.base[i * 3 + 1]; P.pos[i * 3 + 2] = P.base[i * 3 + 2];
      qtmp[0] = P.q[i * 4]; qtmp[1] = P.q[i * 4 + 1]; qtmp[2] = P.q[i * 4 + 2]; qtmp[3] = P.q[i * 4 + 3];
      writePerson(i, qtmp, P.state[i] === 2 ? 0 : P.scale[i]);
    }
    bolt.on.fill(0); beam.who.fill(-1); spark.life.fill(0);
    for (let k = P0; k < PEND; k++) hidePt(k);
    // the concept pose (menu); once the run starts it is the player's ship (placeShip)
    for (const m of shipParts) { const a = m.inst; a[0] = shipBase.pos[0]; a[1] = shipBase.pos[1]; a[2] = shipBase.pos[2]; a[3] = shipBase.scale; a[4] = shipBase.q[0]; a[5] = shipBase.q[1]; a[6] = shipBase.q[2]; a[7] = shipBase.q[3]; m.dirty = true; }
    writeStats();
  }

  function writeStats() {
    const w = WEAPON[level - 1];
    stats.score = score; stats.combo = combo; stats.time = runTime; stats.level = level; stats.xp = xp;
    stats.xpNext = level < WEAPON.length ? WEAPON[level].xp : WEAPON[WEAPON.length - 1].xp;
    stats.heat = heat; stats.overheated = overheated; stats.counterValue = rescued; stats.counterMax = NP;
  }

  // ---------------------------------------------------------------- firing
  function fire(gx, gy) {
    const w = WEAPON[level - 1];
    // aim ray from the camera (eye) through the reticle; aim point = first rock along it (or 45 m)
    let dx = vf[0] + (vr[0] * gx * vasp + vu[0] * gy) * vtan, dy = vf[1] + (vr[1] * gx * vasp + vu[1] * gy) * vtan, dz = vf[2] + (vr[2] * gx * vasp + vu[2] * gy) * vtan;
    const dl = Math.hypot(dx, dy, dz); dx /= dl; dy /= dl; dz /= dl;
    let D = 45; for (let m = 1; m < 45; m += 0.75) if (field(eye[0] + dx * m, eye[1] + dy * m, eye[2] + dz * m) > 0) { D = m; break; }
    const ax = eye[0] + dx * D, ay = eye[1] + dy * D, az = eye[2] + dz * D;
    // bolts leave the ship: just below the eye in the cockpit, from the ship's nose over the shoulder
    const b = sstep(0, 1, vb), sc = SHIP_S * kEye, fwd = 0.6 * (1 - b) + NOSE * sc * b, dn = 0.35 * (1 - b), wid = 1 - b + b * sc;
    for (let n = 0; n < (w.twin ? 2 : 1); n++) {
      let k = -1; for (let j = 0; j < NB; j++) if (!bolt.on[j]) { k = j; break; }
      if (k < 0) return;
      const side = (w.twin ? (n ? 0.5 : -0.5) : 0) * wid;
      const px = cam[0] + vr[0] * side - vu[0] * dn + vf[0] * fwd, py = cam[1] + vr[1] * side - vu[1] * dn + vf[1] * fwd, pz = cam[2] + vr[2] * side - vu[2] * dn + vf[2] * fwd;
      let ex = ax - px, ey = ay - py, ez = az - pz; const el = Math.hypot(ex, ey, ez) || 1;
      bolt.on[k] = 1; bolt.life[k] = 0.75; bolt.r[k] = w.radius;
      bolt.p[k * 3] = px; bolt.p[k * 3 + 1] = py; bolt.p[k * 3 + 2] = pz;
      bolt.v[k * 3] = ex / el * w.speed; bolt.v[k * 3 + 1] = ey / el * w.speed; bolt.v[k * 3 + 2] = ez / el * w.speed;
    }
    hud.event('fire');
  }
  function rescue(i) {
    P.state[i] = 1; P.tt[i] = 0;
    combo = t - lastRescue < COMBO_WINDOW && rescued > 0 ? combo + 1 : 1; lastRescue = t;
    const pts = RESCUE_POINTS * combo; score += pts; rescued++;
    xp += RESCUE_XP + COMBO_XP * (combo - 1);
    if (view) { const u = 0.9 * P.scale[i]; view.project(P.pos[i * 3] + P.up[i * 3] * u, P.pos[i * 3 + 1] + P.up[i * 3 + 1] * u, P.pos[i * 3 + 2] + P.up[i * 3 + 2] * u, o3); }
    else { o3[0] = 0; o3[1] = 0; }
    hud.popup('+' + pts + ' ' + P.name[i], o3[0], o3[1], 'good');
    hud.event('rescue');
    if (typeof FX !== 'undefined') FX.kick(0.35); // a rescue lands with a jolt
    for (let b = 0; b < NBM; b++) if (beam.who[b] < 0) { beam.who[b] = i; break; }
    while (level < WEAPON.length && xp >= WEAPON[level].xp) { level++; hud.event('levelup'); hud.popup('Tractor L' + level, 0, 0.32, 'info'); }
  }
  function sparks(x, y, z) {
    for (let n = 0; n < 8; n++) {
      const k = sparkNext; sparkNext = (sparkNext + 1) % NS;
      spark.p[k * 3] = x; spark.p[k * 3 + 1] = y; spark.p[k * 3 + 2] = z;
      const a = rand() * 6.283, b = rand() * 2 - 1, c = Math.sqrt(1 - b * b), sp = 2 + rand() * 3;
      spark.v[k * 3] = Math.cos(a) * c * sp; spark.v[k * 3 + 1] = b * sp; spark.v[k * 3 + 2] = Math.sin(a) * c * sp; spark.life[k] = 0.35;
    }
  }

  // ---------------------------------------------------------------- per frame
  function update(dt, input) {
    if (!F) return; // the engine's frame array arrives with the first post(view)
    t += dt; if (!over) runTime += dt;
    if (!over) s = Math.min(s + SPEED * dt, rail.len);
    rail.at(s, rp); rail.frame(s, fr);
    // view blend (V, Settings → View): 0 cockpit .. 1 shoulder, over BLEND_T seconds; snaps while paused (dt 0).
    // The shell also calls update(0) on the menu: until the run clock starts, the concept view and ship stay as they are.
    const live = runTime > 0, want = shell.view === 'shoulder' ? 1 : 0;
    if (dt > 0) vb += Math.max(-dt / BLEND_T, Math.min(dt / BLEND_T, want - vb)); else if (live) vb = want;
    const vbe = live ? sstep(0, 1, vb) : 0;
    // pilot offset inside the box, clamped so the ship stays in open space (more room for the wings over the shoulder)
    const kk = 1 - Math.exp(-dt * 4), ox0 = ox;
    ox += (input.pilot.x * BOX_X - ox) * kk; oy += (input.pilot.y * BOX_Y - oy) * kk;
    clampOffset(rp, fr, ox, oy, o3, CLEAR_CAM + (CLEAR_SHIP - CLEAR_CAM) * vbe); ox = o3[0]; oy = o3[1];
    // bank into sideways moves
    shipRoll += (Math.max(-0.5, Math.min(0.5, -(ox - ox0) / Math.max(dt, 1e-3) * 0.12)) - shipRoll) * (1 - Math.exp(-dt * 5));
    cam[0] = rp[0] + fr[3] * ox + fr[6] * oy; cam[1] = rp[1] + fr[4] * ox + fr[7] * oy; cam[2] = rp[2] + fr[5] * ox + fr[8] * oy;
    // look: the rail tangent (smoothed over a few metres) blended toward the aim
    // a chord a few metres ahead: steadier than the local tangent through the laps and the corkscrew
    rail.at(s + LOOK_AHEAD, tp); rail.at(s, tq);
    let tx = tp[0] - tq[0], ty = tp[1] - tq[1], tz = tp[2] - tq[2]; let tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    if (s - s0 < 2.5) { tx = fr[0]; ty = fr[1]; tz = fr[2]; } // the concept segment is straight: open exactly on its view
    const gx = input.gunner.x, gy = input.gunner.y, ramp = Math.min(1, runTime / 1.5);
    let axx = fr[0] + (fr[3] * gx * vasp + fr[6] * gy) * vtan, axy = fr[1] + (fr[4] * gx * vasp + fr[7] * gy) * vtan, axz = fr[2] + (fr[5] * gx * vasp + fr[8] * gy) * vtan;
    const al = Math.hypot(axx, axy, axz) || 1; axx /= al; axy /= al; axz /= al;
    const w = LOOK_AIM * ramp;
    let lx = tx * (1 - w) + axx * w, ly = ty * (1 - w) + axy * w, lz = tz * (1 - w) + axz * w;
    const lk = runTime < 1e-6 ? 1 : 1 - Math.exp(-dt * 6);
    look[0] += (lx - look[0]) * lk; look[1] += (ly - look[1]) * lk; look[2] += (lz - look[2]) * lk;
    const ll = Math.hypot(look[0], look[1], look[2]) || 1; look[0] /= ll; look[1] /= ll; look[2] /= ll;
    // the camera basis from the look (right is horizontal, as the engine's)
    bF[0] = look[0]; bF[1] = look[1]; bF[2] = look[2];
    { let rx = look[2], rz = -look[0]; const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl; bR[0] = rx; bR[1] = 0; bR[2] = rz; bU[0] = look[1] * rz; bU[1] = look[2] * rx - look[0] * rz; bU[2] = -look[1] * rx; }
    // the eye: the ship itself in the cockpit; over the shoulder, behind, above and right of it, pulled in where rock is close
    { const dx = (-bF[0] * SH_BACK + bR[0] * SH_RIGHT + bU[0] * SH_UP) * vbe, dy = (-bF[1] * SH_BACK + bR[1] * SH_RIGHT + bU[1] * SH_UP) * vbe, dz = (-bF[2] * SH_BACK + bR[2] * SH_RIGHT + bU[2] * SH_UP) * vbe;
      const kt = vbe > 0 ? eyeK(cam[0], cam[1], cam[2], dx, dy, dz) : 1;
      kEye = Math.min(kt, kEye + dt * 1.5); // pull in at once, ease back out
      if (kEye < kt && field(cam[0] + dx * kEye, cam[1] + dy * kEye, cam[2] + dz * kEye) > -CLEAR_CAM) kEye = kt;
      eye[0] = cam[0] + dx * kEye; eye[1] = cam[1] + dy * kEye; eye[2] = cam[2] + dz * kEye; }
    F[0] = eye[0]; F[1] = eye[1]; F[2] = eye[2];
    if (typeof FX !== 'undefined' && FX.shake > 0.001) { const j = FX.shake * 0.22; F[0] += (Math.random() - 0.5) * j; F[1] += (Math.random() - 0.5) * j; F[2] += (Math.random() - 0.5) * j; } // impact shake (small, so the camera stays clear of rock)
    F[3] = Math.atan2(look[0], look[2]); F[4] = Math.asin(Math.max(-1, Math.min(1, look[1]))); F[11] = FOV;

    // weapon: heat, cooldown, fire
    const wpn = WEAPON[level - 1];
    heat = Math.max(0, heat - wpn.cool * dt); fireT -= dt;
    if (overheated && heat < HEAT_RESUME) overheated = false;
    if (!over && dt > 0 && input.gunner.fire && !overheated && fireT <= 0) {
      fire(gx, gy); fireT = 1 / wpn.rate; heat += wpn.heat;
      if (heat >= 1) { heat = 1; overheated = true; hud.event('overheat'); }
    }
    // bolts
    for (let k = 0; k < NB; k++) {
      const base = (PB + k * BP);
      if (!bolt.on[k]) { for (let j = 0; j < BP; j++) hidePt(base + j); continue; }
      const px = bolt.p[k * 3], py = bolt.p[k * 3 + 1], pz = bolt.p[k * 3 + 2], vx = bolt.v[k * 3] * dt, vy = bolt.v[k * 3 + 1] * dt, vz = bolt.v[k * 3 + 2] * dt;
      const vv = vx * vx + vy * vy + vz * vz;
      // hit: segment against each waiting person's capture sphere
      let hit = -1;
      for (let i = 0; i < NP && vv > 0; i++) {
        if (P.state[i] !== 0) continue;
        const u = 0.9 * P.scale[i], cx = P.pos[i * 3] + P.up[i * 3] * u, cy = P.pos[i * 3 + 1] + P.up[i * 3 + 1] * u, cz = P.pos[i * 3 + 2] + P.up[i * 3 + 2] * u;
        const h = Math.max(0, Math.min(1, ((cx - px) * vx + (cy - py) * vy + (cz - pz) * vz) / vv));
        if (Math.hypot(px + vx * h - cx, py + vy * h - cy, pz + vz * h - cz) < bolt.r[k]) { hit = i; break; }
      }
      bolt.p[k * 3] = px + vx; bolt.p[k * 3 + 1] = py + vy; bolt.p[k * 3 + 2] = pz + vz;
      bolt.life[k] -= dt;
      if (hit >= 0) { rescue(hit); bolt.on[k] = 0; }
      else if (field(px + vx, py + vy, pz + vz) > 0) { sparks(px, py, pz); bolt.on[k] = 0; if (typeof FX !== 'undefined') FX.kick(0.12); }
      else if (bolt.life[k] <= 0) bolt.on[k] = 0;
      if (!bolt.on[k]) { for (let j = 0; j < BP; j++) hidePt(base + j); continue; }
      // a cyan ring (6 points) around a bright core, in the plane across the flight direction
      const sl = Math.sqrt(vv) || 1, fx = vx / sl, fy = vy / sl, fz = vz / sl;
      let ax = -fz, az = fx, ay = 0; let a2 = Math.hypot(ax, az) || 1; ax /= a2; az /= a2;
      const bx = fy * az - fz * ay, by = fz * ax - fx * az, bz = fx * ay - fy * ax;
      const rr = 0.18 + 0.1 * bolt.r[k], spin = t * 9 + k;
      const qx = bolt.p[k * 3], qy = bolt.p[k * 3 + 1], qz = bolt.p[k * 3 + 2];
      setPt(base, qx, qy, qz, 0.09, 1.6, 2.6, 2.8);
      for (let j = 1; j < BP; j++) { const an = spin + j / (BP - 1) * 6.283, c = Math.cos(an) * rr, sn = Math.sin(an) * rr; setPt(base + j, qx + ax * c + bx * sn, qy + ay * c + by * sn, qz + az * c + bz * sn, 0.06, 0.3, 1.6, 2.2); }
    }
    // people: waiting (wave, beacon fades once passed), tractored (float to the ship), rescued, lost
    // the tractor point: just ahead of and below the eye in the cockpit, the ship itself over the shoulder
    const tf = 1.4 * (1 - vbe), td = 0.7 * (1 - vbe);
    const shx = cam[0] + vf[0] * tf - vu[0] * td, shy = cam[1] + vf[1] * tf - vu[1] * td, shz = cam[2] + vf[2] * tf - vu[2] * td;
    for (let i = 0; i < NP; i++) {
      const st = P.state[i], k = P0 + i;
      qtmp[0] = P.q[i * 4]; qtmp[1] = P.q[i * 4 + 1]; qtmp[2] = P.q[i * 4 + 2]; qtmp[3] = P.q[i * 4 + 3];
      const ux = P.up[i * 3], uy = P.up[i * 3 + 1], uz = P.up[i * 3 + 2], sc = P.scale[i];
      if (st === 0) {
        if (!over && s > P.s[i] + LOST_AFTER) { P.state[i] = 3; lost++; combo = 1; hud.popup(P.name[i] + ' lost', 0, -0.4, 'bad'); }
        writePerson(i, qtmp, sc);
        const fade = s < P.s[i] ? 1 : Math.max(0, 1 - (s - P.s[i]) / LOST_AFTER);
        const blink = ((t * 1.3 + P.ph[i]) % 1) < 0.22 ? 1 : 0.22;
        const e = blink * fade * fade;
        setPt(k, P.pos[i * 3] + ux * 1.78 * sc, P.pos[i * 3 + 1] + uy * 1.78 * sc, P.pos[i * 3 + 2] + uz * 1.78 * sc, 0.17, 0.35 * e, 1.6 * e, 2.3 * e);
      } else if (st === 1) {
        P.tt[i] += dt; const e = sstep(0, TRACTOR_TIME, P.tt[i]), bx = P.base[i * 3], by = P.base[i * 3 + 1], bz = P.base[i * 3 + 2];
        P.pos[i * 3] = bx + (shx - bx) * e; P.pos[i * 3 + 1] = by + (shy - by) * e + Math.sin(e * 3.14) * 0.8; P.pos[i * 3 + 2] = bz + (shz - bz) * e;
        qmul(qtmp, qaxis(0, 1, 0, e * 7, qw), qtmp2);
        const scl = sc * (1 - sstep(0.6, 1, P.tt[i] / TRACTOR_TIME));
        writePerson(i, qtmp2, scl);
        setPt(k, P.pos[i * 3] + ux * 0.9 * scl, P.pos[i * 3 + 1] + uy * 0.9 * scl, P.pos[i * 3 + 2] + uz * 0.9 * scl, 0.5 * (1 - e) + 0.1, 0.5, 2.2, 2.8);
        if (P.tt[i] >= TRACTOR_TIME) { P.state[i] = 2; writePerson(i, qtmp, 0); hidePt(k); for (let b = 0; b < NBM; b++) if (beam.who[b] === i) beam.who[b] = -1; }
      } else if (st === 3) { writePerson(i, qtmp, sc); hidePt(k); }
      else hidePt(k);
    }
    // tractor beams: a pulsing line of points from the ship to each person being pulled in
    for (let b = 0; b < NBM; b++) {
      const i = beam.who[b], base = PBM + b * BMN;
      if (i < 0) { for (let j = 0; j < BMN; j++) hidePt(base + j); continue; }
      const sc = P.scale[i], cx = P.pos[i * 3] + P.up[i * 3] * 0.9 * sc, cy = P.pos[i * 3 + 1] + P.up[i * 3 + 1] * 0.9 * sc, cz = P.pos[i * 3 + 2] + P.up[i * 3 + 2] * 0.9 * sc;
      for (let j = 0; j < BMN; j++) {
        const u = (j + 0.5) / BMN, pulse = 0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.sin(u * 18 + t * 22), 4);
        setPt(base + j, shx + (cx - shx) * u, shy + (cy - shy) * u, shz + (cz - shz) * u, 0.07 + 0.05 * u, 0.3 * pulse, 1.5 * pulse, 2.2 * pulse);
      }
    }
    // sparks
    for (let k = 0; k < NS; k++) {
      if (spark.life[k] <= 0) { hidePt(PS + k); continue; }
      spark.life[k] -= dt;
      spark.p[k * 3] += spark.v[k * 3] * dt; spark.p[k * 3 + 1] += spark.v[k * 3 + 1] * dt; spark.p[k * 3 + 2] += spark.v[k * 3 + 2] * dt;
      const e = Math.max(0, spark.life[k] / 0.35);
      setPt(PS + k, spark.p[k * 3], spark.p[k * 3 + 1], spark.p[k * 3 + 2], 0.05 * e + 0.01, 0.6 * e, 1.8 * e, 2.4 * e);
    }
    if (live) placeShip(vbe);
    // the end: out through the opening
    if (!over && s >= rail.len - 1e-3) {
      over = true;
      for (let i = 0; i < NP; i++) if (P.state[i] === 0) { P.state[i] = 3; lost++; }
      writeStats();
      hud.results({ title: 'Cave Rescue', lines: [['Rescued', rescued + ' / ' + NP], ['Score', String(score)], ['Time', runTime.toFixed(1) + ' s'], ['Level', 'L' + level]] }, againFn);
    }
    writeStats();
  }
  const againFn = () => reset();

  // the player's ship (the concept ship model): at the pilot position, facing the look direction, banking into moves.
  // Hidden in the cockpit; over the shoulder it fades in with the view blend. Scaled with the eye pull-in (kEye), so
  // where rock pulls the camera closer the ship keeps the same size and place on screen and stays clear of the rock.
  function placeShip(vbe) {
    qBasis(bR, bU, bF, sq); qmul(sq, qaxis(0, 0, 1, shipRoll, sqb), sq);
    const sc = vbe > 0.01 ? SHIP_S * kEye * vbe : 0;
    for (const m of shipParts) { const a = m.inst; a[0] = cam[0]; a[1] = cam[1]; a[2] = cam[2]; a[3] = sc; a[4] = sq[0]; a[5] = sq[1]; a[6] = sq[2]; a[7] = sq[3]; m.dirty = true; }
    G.shipNow = G.shipNow || [0, 0, 0]; G.shipNow[0] = cam[0]; G.shipNow[1] = cam[1]; G.shipNow[2] = cam[2];
  }
  // test (?debug): the ship's on-screen extent, projecting every vertex of every visible part with the current view
  function shipNdc() {
    const r = { minX: 1e9, maxX: -1e9, minY: 1e9, maxY: -1e9, n: 0, minDepth: 1e9 }, o = [0, 0, 0], v = [0, 0, 0];
    if (!view) return r;
    for (const m of shipParts) {
      const a = m.inst, sc = a[3]; if (!(sc > 0)) continue; const q = [a[4], a[5], a[6], a[7]], f = new Float32Array(m.vb);
      for (let k = 0; k < m.nv; k++) {
        qrot(q, f[k * 4] * sc, f[k * 4 + 1] * sc, f[k * 4 + 2] * sc, v); view.project(a[0] + v[0], a[1] + v[1], a[2] + v[2], o);
        if (o[2] <= 0) continue; r.n++; r.minX = Math.min(r.minX, o[0]); r.maxX = Math.max(r.maxX, o[0]); r.minY = Math.min(r.minY, o[1]); r.maxY = Math.max(r.maxY, o[1]); r.minDepth = Math.min(r.minDepth, o[2]);
      }
    }
    return r;
  }

  // ---------------------------------------------------------------- post: HUD feeds (marks, blips, stats)
  function post(v) {
    view = v; F = v.F;
    vf[0] = v.f[0]; vf[1] = v.f[1]; vf[2] = v.f[2]; vr[0] = v.r[0]; vr[1] = v.r[1]; vr[2] = v.r[2]; vu[0] = v.u[0]; vu[1] = v.u[1]; vu[2] = v.u[2]; vtan = v.tan; vasp = v.aspect;
    const cx = F[0], cy = F[1], cz = F[2];
    let nm = 0, nb = 0;
    for (let i = 0; i < NP; i++) {
      if (P.state[i] !== 0) continue;
      const u = 0.9 * P.scale[i], x = P.pos[i * 3] + P.up[i * 3] * u, y = P.pos[i * 3 + 1] + P.up[i * 3 + 1] * u, z = P.pos[i * 3 + 2] + P.up[i * 3 + 2] * u;
      const dx = x - cx, dy = y - cy, dz = z - cz, d = Math.hypot(dx, dy, dz);
      if (d > 70) continue;
      v.project(x, y, z, o3);
      marks[nm * 6] = o3[0]; marks[nm * 6 + 1] = o3[1]; marks[nm * 6 + 2] = o3[2]; marks[nm * 6 + 3] = 0; marks[nm * 6 + 4] = d; marks[nm * 6 + 5] = i; nm++;
      blips[nb * 4] = dx * vr[0] + dz * vr[2]; blips[nb * 4 + 1] = dx * vu[0] + dy * vu[1] + dz * vu[2]; blips[nb * 4 + 2] = dx * vf[0] + dy * vf[1] + dz * vf[2]; blips[nb * 4 + 3] = 0; nb++;
    }
    { // the exit: end of the rail, in the bright void
      const dx = endP[0] - cx, dy = endP[1] - cy, dz = endP[2] - cz, d = Math.hypot(dx, dy, dz);
      v.project(endP[0], endP[1], endP[2], o3);
      marks[nm * 6] = o3[0]; marks[nm * 6 + 1] = o3[1]; marks[nm * 6 + 2] = o3[2]; marks[nm * 6 + 3] = 1; marks[nm * 6 + 4] = d; marks[nm * 6 + 5] = NP; nm++;
      blips[nb * 4] = dx * vr[0] + dz * vr[2]; blips[nb * 4 + 1] = dx * vu[0] + dy * vu[1] + dz * vu[2]; blips[nb * 4 + 2] = dx * vf[0] + dy * vf[1] + dz * vf[2]; blips[nb * 4 + 3] = 1; nb++;
    }
    hud.marks(marks, nm); hud.blips(blips, nb);
    hud.set(stats);
  }

  return {
    id: 'cave-rescue', title: 'Cave Rescue', skin: 'visor', palette: 'Arctic',
    prepare(SC) { if (SC.p1) SC.p1[3] = 1; }, // ghost rail on; p1.xyz is the key-light cone, left alone
    init, update, post, reset,
  };
})();
