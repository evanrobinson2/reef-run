// ============================================================================
// reefbay.js: Reef Run's mothership launch bay. Reconstructs RI-1.0
// (experiments/space-garden/concept/reef-bay/DECOMPOSITION.md; IDs RB-xx refer to that record).
// One global, REEF_BAY:
//   REEF_BAY.scene        a standalone SCENE (reef-bay.html): the bay from the concept camera (pose 0 = RI-1.0's view)
//   REEF_BAY.pre          [{ dur, step(t, F) }]: the launch as an INTRO.pre segment for reefrun.js (camera only, Nebula world)
//   REEF_BAY.launch(t, F, world)  writes the launch camera at time t (s) into F (0..4 position/yaw/pitch, 11 FOV)
//   REEF_BAY.ship(t, o7, world)   the ship's pose at t: o7 = [x, y, z, qx, qy, qz, qw]; returns its visible scale (0 once the camera is in the cockpit)
//   REEF_BAY.DUR, REEF_BAY.OFFSET (bay space → Nebula world: world = local + OFFSET), REEF_BAY.FRAME0 (the pose the launch ends on)
// Bay space: floor y = 0, the trench runs along +z (the far end at z ≈ 62), the pad centre is the origin.
// Load-time allocation only in build(); launch() and ship() allocate nothing.
// ============================================================================
const REEF_BAY = (() => {
  const FOV = 51 * PI / 180, PITCH = 0.073; // section 5: vertical FOV ~51° (pad-ring ellipse), pitch ~4° (VP at 0.576 of the height)
  const CAM = [0, 2.25, -7.0];              // section 5: camera 2.25 m up, 7.0 m behind the pad centre
  const SHIP_Y = 0.86;                       // RB-K: ship centre above the floor
  // the bay's dimensions below are written in the first solve's units (camera 2.0 m up); KS scales them to the final
  // solve (2.25 m, ship pods' rear 6 m ahead). The ship and the asteroids are not scaled.
  const KS = 1.125;
  const RIB0 = 0.8, RIBS = 4.5;              // RB-R4: rib stations z = 0.8 + 4.5k (× KS). The yellow cabinets stand half-way between ribs:
                                             // the nearest knees (A2, F2) measure ~0.2–1.4 m past the pad, the nearest cabinets (B3–B4, F3–F4) ~3.1–4.3 m
  const ZEND = 60;                           // RB-E1: far bulkhead (× KS ≈ 68 m)
  const KEY = (() => { const d = [-0.5, 0.8, 0.35], l = hypot(...d); return d.map((v) => v / l); })(); // section 4: key from the slot, upper left
  // launch → Reef Run Frame 0 (reefrun.js: rail position sHero = Nebula origin, yaw 0, pitch HERO_PITCH 0.42, HERO_FOV 70°)
  const OFFSET = [0, -20, -70], F0_PITCH = 0.42, F0_FOV = 70 * PI / 180;
  const FRAME0 = { pos: [0, 0, 0], yaw: 0, pitch: F0_PITCH, fov: F0_FOV };

  // ---------------------------------------------------------------- shaders
  const wgsl = /*wgsl*/`
const KS = ${KS};
const SKY_TOP = vec3f(0.50, 0.82, 0.62);   // RB-S1 mint (D1 p90 #77bf92, C1 #58a795)
const SKY_LOW = vec3f(0.44, 0.72, 0.68);   // paler, hazier toward the far end (#5dada7)
const HAZE = vec3f(0.36, 0.53, 0.58);      // trench haze (C3/D3 #588289, #538089)
const KEYC = vec3f(0.80, 0.80, 0.74);      // key light (cool-neutral)
const SKYA = vec3f(0.28, 0.48, 0.60);      // teal sky fill from above
const GNDA = vec3f(0.20, 0.30, 0.34);      // bounce from the deck
const WARM = vec3f(1.00, 0.60, 0.28);      // rib light panels (RB-L1)
fn sky(rd: vec3f) -> vec3f {
  // C1 p90 #58a795 (left, bluer) → D1 p90 #77bf92 (right, greener)
  var c = mix(SKY_LOW, mix(vec3f(0.40, 0.74, 0.66), SKY_TOP, smoothstep(-0.25, 0.25, rd.x)), smoothstep(0.0, 0.6, rd.y));
  c *= 0.92 + 0.10 * fbm3(rd * 3.0, 3);
  c = mix(c, HAZE * 1.05, (1.0 - smoothstep(0.02, 0.22, rd.y)) * 0.7); // haze above the far bulkhead
  // RB-S2 star specks
  let g = rd * 300.0; let cell = floor(g); let h = h31(cell);
  if (h > 0.985) { let f = fract(g) - 0.5; c += vec3f(0.9, 0.95, 1.0) * sat(1.0 - length(f) * 3.0) * fract(h * 53.0) * 1.4; }
  return c;
}
// haze only along the part of the ray inside the trench (below the girder tops, before the far end): section 6
fn insideLen(wp: vec3f, d: f32) -> f32 {
  let rd = (wp - u.cam.xyz) / max(d, 1e-3);
  var t = d;
  if (rd.y > 1e-3) { t = min(t, max(8.4 * KS - u.cam.y, 0.0) / rd.y); }
  if (rd.z > 1e-3) { t = min(t, max(${(ZEND + 2).toFixed(1)} * KS - u.cam.z, 0.0) / rd.z); }
  return select(t, d, u.cam.y > 8.4 * KS);
}
fn fogApply(c: vec3f, wp: vec3f, d: f32) -> vec3f {
  let L = insideLen(wp, d);
  let f = 1.0 - exp(-max(L - 6.0, 0.0) * 0.052);
  return mix(c, HAZE, f);
}
// nearest rib light (RB-L1) on the side of x: warm pool under each knee
fn ribLight(wp: vec3f, n: vec3f) -> vec3f {
  let s = select(-1.0, 1.0, wp.x > 0.0);
  let k = round((wp.z / KS - ${RIB0}) / ${RIBS.toFixed(2)});
  var acc = 0.0;
  for (var j = -1; j <= 1; j++) {
    let lp = vec3f(s * 4.9, 3.25, ${RIB0} + (k + f32(j)) * ${RIBS.toFixed(2)}) * KS;
    let dv = lp - wp; let d2 = dot(dv, dv);
    acc += sat(dot(n, dv * inverseSqrt(max(d2, 1e-4))) * 0.8 + 0.2) * sat(dv.y * 1.5 + 0.3) / (1.0 + d2 * 0.55); // the panels face down: they light what is below them
  }
  return WARM * acc * 0.85;
}
// painted panel texture from world position: seams and per-panel tone (section 6)
fn panels(wp: vec3f, n: vec3f) -> f32 {
  let an = abs(n);
  var q = vec2f(wp.z, wp.y);
  if (an.y > an.x && an.y > an.z) { q = vec2f(wp.z, wp.x); } else if (an.z > an.x) { q = vec2f(wp.x, wp.y); }
  let cs = vec2f(1.6, 0.9); let id = floor(q / cs); let f = abs(fract(q / cs) - 0.5) * cs;
  let seam = smoothstep(0.0, 0.035, min(f.x, f.y));
  let tone = 0.86 + 0.24 * h31(vec3f(id, floor(wp.x * 0.3)));
  return mix(0.55, 1.0, seam) * tone;
}
fn lightPainted(alb: vec3f, wp: vec3f, n: vec3f, pan: f32, ao: f32) -> vec3f {
  // inside the trench the source keeps the right wall dark and the left lit (E3/F3 vs A1–B1), so the key reaches the right wall weakly
  let key = KEYC * sat(dot(n, u.sun.xyz)) * select(1.0, 0.3, wp.x > 2.5);
  let amb = mix(GNDA, SKYA, sat(n.y * 0.5 + 0.5)) * ao;
  // sky seen through the open slot: faces turned toward the opening above the trench's centre, more so higher up (B1 pale beam)
  let slot = sat(dot(n, normalize(vec3f(-sign(wp.x) * 0.75, 0.6, 0.25)))) * sat((wp.y - 1.5) / 6.0);
  // the pad's glow ring warms the ship's belly and the dais (RB-P3)
  let pr = length(wp.xz);
  let padGlow = vec3f(0.55, 0.28, 0.10) * sat(-n.y + 0.2) * (1.0 - smoothstep(1.5, 3.2, pr)) * sat(1.6 - wp.y);
  // the source lights the left stack's inner faces (pale beam, B1) and leaves the right one dark (E1–F2): asymmetric, as observed
  let sw = select(0.25, 0.9, wp.x < 0.0);
  return alb * pan * (key + amb * select(0.45, 1.0, wp.x < 0.0 || wp.y < 3.6 * KS) + SKYA * slot * sw + ribLight(wp, n) * ao + padGlow);
}
// RB-F floor and RB-P pad, procedural from world xz
fn floorShade(wp: vec3f) -> vec3f {
  let x = wp.x / KS; let z = wp.z / KS; let ax = abs(x);
  let pf = vec2f(x, z); let gs = vec2f(2.0, 1.0); let fp = abs(fract(pf / gs) - 0.5) * gs;
  let seam = smoothstep(0.0, 0.03, min(fp.x, fp.y));
  var alb = vec3f(0.265, 0.265, 0.25) * (0.86 + 0.22 * h31(vec3f(floor(pf / gs), 3.0))) * mix(0.6, 1.0, seam);
  alb *= 0.9 + 0.2 * fbm3(vec3f(x * 0.7, 0.0, z * 0.25), 3);
  // track grooves along z
  alb *= mix(0.55, 1.0, smoothstep(0.0, 0.04, abs(fract(ax * 0.8) - 0.5) - 0.02));
  let YEL = vec3f(0.68, 0.51, 0.23);
  if (ax > 3.85 && ax < 4.4) { alb = YEL * (0.9 + 0.1 * seam); }            // RB-F2 lanes
  if (ax > 1.45 && ax < 1.6 && z > 3.0) { alb = YEL * 0.85; }               // thin lane lines toward the far end
  var emit = vec3f(0.0);
  if (ax > 3.5 && ax < 3.68 && fract(z / 4.0 + 0.1) < 0.72) { emit = vec3f(2.4, 2.35, 2.2); } // RB-F3 white strips (dashed)
  // RB-P pad rings
  let r = length(vec2f(x, z));
  if (r < 2.9) {
    if (r < 2.24) { alb = YEL * (0.72 + 0.3 * h31(vec3f(floor(atan2(z, x) * 4.0), 1.0, 2.0))); }
    if (r < 1.2) { alb = vec3f(0.10, 0.15, 0.17); }
    if (r > 2.34 && r < 2.75) { alb = YEL * 0.95; }
    if (r >= 2.75) { alb = vec3f(0.30, 0.33, 0.33); }
    emit += vec3f(3.2, 1.7, 0.75) * (smoothstep(0.05, 0.0, abs(r - 2.29)) * 1.6 + exp(-abs(r - 2.29) * 9.0) * 0.25);
  }
  // further floor glows down the trench (RB-F4)
  for (var i = 0; i < 2; i++) { let c = vec2f(select(-2.6, 2.6, i == 1), 22.0); emit += vec3f(1.6, 0.8, 0.3) * exp(-length((pf - c) * vec2f(1.0, 0.4)) * 2.0) * 0.8; }
  // P6: the ship's shadow, projected along the key light (u.p0.xyz = ship centre)
  let sp = u.p0.xyz - u.sun.xyz * (u.p0.y / max(u.sun.y, 0.1));
  let e = (wp.xz - sp.xz) * vec2f(1.0 / 1.7, 1.0 / 1.5);
  let sh = 1.0 - 0.72 * (1.0 - smoothstep(0.55, 1.0, length(e))) * u.p0.w;
  let n = vec3f(0.0, 1.0, 0.0);
  let lit = KEYC * u.sun.y * sh + SKYA * 0.9 + ribLight(wp, n) * 0.9;
  return alb * lit + emit;
}
fn rockShade(wp: vec3f, n: vec3f, lp: vec3f, seed: f32) -> vec3f {
  let t = fbm3(lp * 5.0 + vec3f(seed * 30.0), 4);
  let alb = vec3f(0.66, 0.66, 0.63) * (0.7 + 0.5 * t);
  let dif = sat(dot(n, u.p1.xyz) * 1.1); // the asteroids' own light: from the upper left, toward the camera (RB-S3)
  let amb = mix(vec3f(0.10, 0.20, 0.20), vec3f(0.28, 0.42, 0.40), sat(n.y * 0.5 + 0.5));
  return alb * (KEYC * dif * 1.15 + amb);
}
fn shadeSolid(wp: vec3f, n0: vec3f, aux: f32, prm: vec4f, lp: vec3f) -> vec3f {
  let v = normalize(u.cam.xyz - wp);
  let n = select(-n0, n0, dot(n0, v) >= 0.0); // two-sided: hard-surface parts are not all wound the same way
  let mat = prm.x;
  if (mat > 3.5 && mat < 4.5) { return prm.yzw; }                          // emissive (lights, windows, glow)
  if (mat > 4.5 && mat < 5.5) { return floorShade(wp); }                   // deck and pad
  if (mat > 5.5 && mat < 6.5) { return rockShade(wp, n, lp, aux); }        // asteroids
  if (mat > 6.5) { // ship paint: no panel grid, a neutral fill (the source's ship reads warm pale, #d7d9c2)
    let pr = length(wp.xz);
    let glow = vec3f(0.55, 0.28, 0.10) * sat(-n.y + 0.2) * (1.0 - smoothstep(1.5, 3.4, pr));
    return prm.yzw * (KEYC * sat(dot(n, u.sun.xyz)) * 0.8 + vec3f(0.44, 0.46, 0.43) * mix(0.55, 1.0, sat(n.y * 0.5 + 0.5)) + glow) + vec3f(0.05) * pow(1.0 - sat(dot(n, v)), 3.0);
  }
  return lightPainted(prm.yzw, wp, n, panels(wp, n), sat(aux * 0.5 + 0.5)); // painted structure
}
fn pointMotion(p: vec3f, k: f32, t: f32) -> vec3f { let h = h31(floor(p * 5.0)); return vec3f(sin(t * 0.3 + h * 6.28), sin(t * 0.23 + h * 9.1), cos(t * 0.27 + h * 3.3)) * 0.25; }
`;
  const post = /*wgsl*/`
fn grade(c0: vec3f, bl: vec3f, uv: vec2f, px: vec2i, d0: f32) -> vec3f {
  var c = c0 + bl * 0.35;
  // colours are authored in display values; a soft shoulder keeps the HDR lights from clipping hard
  c = select(c, 0.82 + 0.18 * (1.0 - exp(-(c - 0.82) / 0.18)), c > vec3f(0.82));
  let vg = 1.0 - 0.12 * dot(uv - 0.5, uv - 0.5) * 2.0;
  return clamp(c * vg, vec3f(0.0), vec3f(1.0));
}
`;

  // ---------------------------------------------------------------- geometry helpers (load time)
  // flat-shaded polygon: its own vertices, so edges stay hard
  const face = (m, P, aux = 1) => { const i0 = m.p.length / 3; for (const p of P) m.v(p[0], p[1], p[2], aux); for (let k = 1; k < P.length - 1; k++) m.tri(i0, i0 + k, i0 + k + 1); };
  // loft: consecutive sections (same vertex count) joined by quads, optional end caps
  const loft = (m, S, caps = true, aux = 1) => {
    for (let i = 0; i < S.length - 1; i++) { const a = S[i], b = S[i + 1], n = a.length; for (let j = 0; j < n; j++) { const j2 = (j + 1) % n; face(m, [a[j], a[j2], b[j2], b[j]], aux); } }
    if (caps) { face(m, S[0].slice().reverse(), aux); face(m, S[S.length - 1], aux); }
  };
  const prismZ = (m, prof, z0, z1, aux) => loft(m, [prof.map(([x, y]) => [x, y, z0]), prof.map(([x, y]) => [x, y, z1])], true, aux);
  const box = (m, x0, y0, z0, x1, y1, z1, aux) => prismZ(m, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], z0, z1, aux);
  const mirror = (prof, s) => prof.map(([x, y]) => [x * s, y]);
  const inst = (mesh, list) => { mesh.inst = new Float32Array(list); return mesh; };
  const one = (mat, c) => [0, 0, 0, 1, 0, 0, 0, 1, mat, c[0], c[1], c[2]];

  // ---------------------------------------------------------------- the ship (RB-K), in its own frame: x right, y up, z nose; 2.4 m long
  const shipParts = () => {
    const WHITE = [0.84, 0.88, 0.80], GREY = [0.46, 0.52, 0.48], DARK = [0.05, 0.06, 0.07], STRUT = [0.62, 0.66, 0.62];
    const parts = [];
    const add = (fn, col, mat = 7) => { const m = new Mesh(); fn(m); parts.push([m.build(), col, mat]); };
    const sec = (z, w0, w1, wt, y0, ym, y1) => [[-w0, y0, z], [w0, y0, z], [w1, ym, z], [wt, y1, z], [-wt, y1, z], [-w1, ym, z]];
    add((m) => loft(m, [sec(-1.15, 0.42, 0.5, 0.36, -0.22, 0.0, 0.06), sec(-0.3, 0.46, 0.53, 0.36, -0.28, 0.08, 0.3), sec(0.45, 0.36, 0.42, 0.28, -0.24, 0.1, 0.42), sec(1.25, 0.1, 0.12, 0.05, -0.1, 0.0, 0.08)]), WHITE); // K1 hull: the deck rises from a low rear to the canopy
    add((m) => loft(m, [[[-0.31, 0.3, 0.1], [0.31, 0.3, 0.1], [0.27, 0.66, 0.2], [-0.27, 0.66, 0.2]], [[-0.2, 0.26, 0.95], [0.2, 0.26, 0.95], [0.1, 0.42, 0.88], [-0.1, 0.42, 0.88]]]), DARK); // K2 canopy hood
    add((m) => { for (const x of [-0.12, 0.12]) box(m, x - 0.025, 0.34, 0.1, x + 0.025, 0.64, 0.16); box(m, -0.26, 0.6, 0.12, 0.26, 0.66, 0.2); box(m, -0.3, 0.3, 0.08, 0.3, 0.36, 0.14); }, STRUT); // K2 window frames on the hood's rear
    for (const s of [-1, 1]) {
      const root = [[s * 0.45, -0.12, 0.3], [s * 0.45, 0.2, 0.2], [s * 0.45, 0.2, -0.95], [s * 0.45, -0.12, -0.95]];
      const tip = [[s * 1.25, -0.12, -0.25], [s * 1.25, 0.05, -0.3], [s * 1.25, 0.05, -0.85], [s * 1.25, -0.12, -0.85]];
      add((m) => loft(m, [root, tip]), WHITE); // K3 wings: thick, slight anhedral
      add((m) => box(m, s * 0.56, -0.08, -0.98, s * 0.86, 0.1, -0.93), [0.16, 0.19, 0.19]); // dark-grey recesses in the wings' rear faces (C4, D4)
      add((m) => loft(m, [-0.98, -0.6, 0.15, 0.3].map((z, i) => { const w = [0.18, 0.2, 0.2, 0.12][i], h = [0.2, 0.22, 0.2, 0.12][i], c = 0.06, x0 = s * 1.42, y0 = 0.0;
        return [[x0 - w, y0 - h + c, z], [x0 - w + c, y0 - h, z], [x0 + w - c, y0 - h, z], [x0 + w, y0 - h + c, z], [x0 + w, y0 + h - c, z], [x0 + w - c, y0 + h, z], [x0 - w + c, y0 + h, z], [x0 - w, y0 + h - c, z]]; })), WHITE); // K4 pods
      add((m) => { m.tube([[s * 1.42, 0.0, -0.99], [s * 1.42, 0.0, -0.97]], 0.13, 12, true); }, DARK); // pod rear openings
      add((m) => box(m, s * 0.26, -0.2, -1.17, s * 0.42, 0.02, -1.12), DARK); // K5 rear vents
      add((m) => box(m, s * 0.44, -0.22, -1.0, s * 0.52, 0.08, -0.5), GREY);  // side recess panels
      add((m) => m.tube([[s * 0.35, -0.28, 0.0], [s * 0.42, -0.5, 0.0]], 0.035, 6, true), DARK); // landing struts
    }
    add((m) => m.tube([[0, -0.28, 0.75], [0, -0.5, 0.78]], 0.035, 6, true), DARK);
    add((m) => { box(m, -0.3, -0.25, -1.14, -0.12, -0.21, -0.95); box(m, 0.12, -0.25, -1.14, 0.3, -0.21, -0.95); }, [2.6, 1.1, 0.3], 4); // K5 orange under-glow (two small glows)
    return parts;
  };

  // ---------------------------------------------------------------- asteroids (RB-S3..S6): noise-displaced icospheres, grey
  const rockMesh = (sub, seed) => {
    rseed(seed); const o = [rr(0, 50), rr(0, 50), rr(0, 50)], el = rr(1, 1.35), fl = rr(0.75, 0.95);
    const m = icosphere(sub, (x, y, z) => {
      const r = 1 + 0.38 * (fbm(x * 1.2 + o[0], y * 1.2 + o[1], z * 1.2 + o[2], 3) - 0.5) * 2 + 0.16 * (fbm(x * 4 + o[1], y * 4 + o[2], z * 4 + o[0], 3) - 0.5) + 0.07 * (fbm(x * 10 + o[2], y * 10 + o[0], z * 10, 2) - 0.5);
      return [x * r * el, y * r * fl, z * r];
    });
    for (let k = 0; k < m.aux.length; k++) m.aux[k] = (seed % 7) / 7; // aux carries a texture seed
    return m.build();
  };

  // ---------------------------------------------------------------- build
  function build() {
    const meshes = [], pts = [];
    const t = Math.tan(FOV / 2), asp = 1456 / 816, cp = cos(PITCH), sp = sin(PITCH);
    // world point seen at frame point (fx, fy) of the concept camera, d metres along the view axis
    const at = (fx, fy, d) => { const nx = 2 * fx - 1, ny = 1 - 2 * fy; return [CAM[0] + nx * t * asp * d, CAM[1] + (sp + ny * t * cp) * d, CAM[2] + (cp - ny * t * sp) * d]; };
    const Z0 = -14, Z1 = ZEND + 1;
    const YEL = [0.95, 0.63, 0.27], YEL2 = [0.66, 0.48, 0.18], TEAL = [0.16, 0.30, 0.40], TEAL2 = [0.12, 0.26, 0.40], GIRDER = [0.62, 0.62, 0.56];

    // RB-F floor + pad (procedural in floorShade)
    { const m = new Mesh(); face(m, [[-5.9, 0, Z0], [5.9, 0, Z0], [5.9, 0, Z1], [-5.9, 0, Z1]]); meshes.push(inst(m.build(), one(5, [0, 0, 0]))); }
    // RB-P1 dais: a low disc with a ring of relief blocks
    { const m = new Mesh(); m.tube([[0, 0, 0], [0, 0.12, 0]], 1.0, 28, true, () => 1); m.tube([[0, 0.12, 0], [0, 0.2, 0]], 0.62, 6, true, () => 1);
      for (let i = 0; i < 8; i++) { const a = i / 8 * TAU + 0.2, r = 0.82; box(m, cos(a) * r - 0.1, 0.1, sin(a) * r - 0.1, cos(a) * r + 0.1, 0.18, sin(a) * r + 0.1); }
      meshes.push(inst(m.build(), one(3, [0.28, 0.34, 0.36]))); }
    // RB-P5 rim lamps
    for (let i = 0; i < 14; i++) { const a = (i + 0.5) / 14 * TAU; pts.push(cos(a) * 2.72, 0.04, sin(a) * 2.72, 0.05, 4.0, 1.8, 0.6, 0); }

    // ---- walls, overhangs and girders (section 6 cross-section). The upper stacks are not mirror images (section 6, v3 fan
    // measurement): seen from the vanishing point the left stack reaches 112° (sky boundary) with its pale beam at 125–140°,
    // the right stack only 48° with its beam at 35–45°. Per side: overhang foot → head, beam [x0, x1, y0, y1], top edge.
    const UPPER = { [-1]: { foot: [5.9, 3.3], head: [4.6, 5.3], beam: [4.44, 5.3, 5.3, 8.36], top: [3.02, 9.47] },
                    [1]: { foot: [5.9, 3.3], head: [5.0, 5.48], beam: [4.98, 5.9, 5.48, 6.98], top: [4.6, 7.05] } };
    for (const s of [-1, 1]) {
      const U = UPPER[s], [bx0, bx1, by0, by1] = U.beam;
      const wall = new Mesh();
      prismZ(wall, mirror([U.foot, [U.foot[0] + 0.5, U.foot[1]], [U.head[0] + 0.9, U.head[1] + 0.2], U.head], s), Z0, Z1, 0.0); // RB-W2 overhang
      prismZ(wall, mirror([[bx0, by1], [bx1 + 0.4, by1], [U.top[0] + 0.6, U.top[1] + 0.3], U.top], s), Z0, Z1, 0.3);           // top plating above the beam
      prismZ(wall, mirror(s < 0 ? [[6.4, 3.3], [8.0, 3.3], [8.0, 11.5], [5.3, 11.5]] : [[6.4, 3.3], [8.0, 3.3], [8.0, 8.0], [6.0, 8.0]], s), Z0, Z1, 0.0); // closed backing: no sky through the stack (F1)
      meshes.push(inst(wall.build(), one(3, TEAL2)));
      const low = new Mesh(); prismZ(low, mirror([[5.8, 0], [6.6, 0], [6.6, 3.4], [5.8, 3.4]], s), Z0, Z1, 0.6); meshes.push(inst(low.build(), one(3, s < 0 ? [0.17, 0.31, 0.40] : [0.10, 0.27, 0.44]))); // RB-W1 lower wall
      const gir = new Mesh(); prismZ(gir, mirror([[bx0, by0], [bx1, by0], [bx1, by1], [bx0, by1]], s), Z0, Z1, 1);            // RB-G1 pale beam
      meshes.push(inst(gir.build(), one(3, s < 0 ? GIRDER : [0.26, 0.31, 0.35]))); // E1: the right beam reads darker
      const trim = new Mesh(); // yellow trim: the beam's lower inner edge and the sky edge
      prismZ(trim, mirror([[bx0 - 0.08, by0 - 0.05], [bx0 + 0.15, by0 - 0.05], [bx0 + 0.15, by0 + 0.25], [bx0 - 0.08, by0 + 0.25]], s), Z0, Z1);
      prismZ(trim, mirror([[U.top[0] - 0.1, U.top[1] - 0.1], [U.top[0] + 0.2, U.top[1] - 0.1], [U.top[0] + 0.2, U.top[1] + 0.15], [U.top[0] - 0.1, U.top[1] + 0.15]], s), Z0, Z1);
      meshes.push(inst(trim.build(), one(3, YEL)));
      // RB-W1 ledge at the cabinet tops
      const ledge = new Mesh(); prismZ(ledge, mirror([[5.3, 3.25], [5.85, 3.25], [5.85, 3.4], [5.3, 3.4]], s), Z0, Z1); meshes.push(inst(ledge.build(), one(3, TEAL)));
    }

    // ---- ribs (RB-R1..R3, RB-L1): one mesh per material and side, instanced at every station
    const stations = []; for (let k = -3; k <= 12; k++) stations.push(RIB0 + k * RIBS);
    // dz: offset from the rib station; every: 2 puts the item in every second bay only (the cabinets: B3–B4, E3, F3–F4 but dark bays between)
    const ribInst = (mat, c, tint = 0, dz = 0, every = 1) => { const a = []; stations.forEach((z0, i) => { const z = z0 + dz; if (i % every) return; const v = tint ? 1 + tint * (((i * 7) % 5) / 4 - 0.5) : 1; a.push(0, 0, z, 1, 0, 0, 0, 1, mat, c[0] * v, c[1] * v, c[2] * v); }); return a; };
    for (const s of [-1, 1]) {
      const y = new Mesh();
      prismZ(y, mirror([[5.4, 0], [5.8, 0], [5.8, 3.3], [5.4, 3.3]], s), -0.2, 0.2, 1);                   // rib column under the knee
      prismZ(y, mirror([[3.95, 3.45], [5.8, 3.2], [5.8, 4.5], [5.2, 4.75], [3.95, 4.1]], s), -0.9, 0.9, 1); // R2 knee (F2: a big chamfered bracket)
      // the right strut leans well inward to the top edge (E1 crop: knee at F2 → ~45° from the VP); the left one meets the pale beam
      const H = s > 0 ? [4.55, 6.85] : UPPER[s].head; prismZ(y, mirror([[4.95, 4.4], [5.5, 4.5], [H[0] + 0.45, H[1] + 0.05], [H[0], H[1]]], s), -0.32, 0.32, 1); // R3 strut, up to the beam
      meshes.push(inst(y.build(), ribInst(3, YEL, 0.12)));
      const cab = new Mesh(); prismZ(cab, mirror([[5.0, 0], [5.8, 0], [5.8, 3.0], [5.25, 3.0], [5.0, 2.75]], s), -0.55, 0.55, 1); // R1 cabinet, half-way between ribs
      meshes.push(inst(cab.build(), ribInst(3, YEL, 0.15, RIBS / 2, 2)));
      const d = new Mesh(); // cabinet details: a dark inset panel and a red tag
      box(d, ...(s > 0 ? [4.97, 0.6, -0.4, 5.01, 2.2, 0.15] : [-5.01, 0.6, -0.4, -4.97, 2.2, 0.15]));
      meshes.push(inst(d.build(), ribInst(3, [0.20, 0.17, 0.10], 0, RIBS / 2, 2)));
      const L = new Mesh(); // L1 light panel under the knee, in three stripes
      for (let j = 0; j < 3; j++) { const z0 = -0.55 + j * 0.38; face(L, [[s * 4.3, 3.4, z0], [s * 5.5, 3.27, z0], [s * 5.5, 3.27, z0 + 0.26], [s * 4.3, 3.4, z0 + 0.26]]); }
      meshes.push(inst(L.build(), ribInst(4, [5.0, 3.5, 2.1])));
      const tag = new Mesh(); box(tag, ...(s > 0 ? [4.96, 2.4, 0.2, 4.99, 2.5, 0.5] : [-4.99, 2.4, 0.2, -4.96, 2.5, 0.5]));
      meshes.push(inst(tag.build(), ribInst(4, [1.6, 0.25, 0.2], 0, RIBS / 2, 2)));
    }

    // ---- between the ribs: windows (RB-W3), greeble (D5), small lights (RB-L2), seeded per segment
    rseed(41);
    const greeble = [new Mesh(), new Mesh(), new Mesh()], gCol = [[0.18, 0.34, 0.46], [0.50, 0.55, 0.58], [0.12, 0.22, 0.32]];
    const winL = new Mesh(), winR = new Mesh(), winRed = new Mesh();
    // a point on the overhang plane of side s: u 0..1 from its foot to its head, pushed inward (along the plane's normal) by e
    const ovh = (s, u, z, e) => { const U = UPPER[s], dx = U.head[0] - U.foot[0], dy = U.head[1] - U.foot[1], l = hypot(dx, dy), nx = -dy / l, ny = dx / l;
      const x = mix(U.foot[0], U.head[0], u), y = mix(U.foot[1], U.head[1], u); return [s * (x - Math.abs(nx) * e), y - Math.abs(ny) * e, z]; };
    for (const s of [-1, 1]) for (let k = -3; k < 12; k++) {
      const z0 = RIB0 + k * RIBS + 0.7, z1 = RIB0 + (k + 1) * RIBS - 0.7;
      // lower wall windows: teal glass with mullions
      const wz = mix(z0, z1, rr(0.05, 0.25)), ww = rr(1.2, 1.9);
      face(s < 0 ? winL : winR, [[s * 5.78, 1.6, wz], [s * 5.78, 1.6, wz + ww], [s * 5.78, 2.1, wz + ww], [s * 5.78, 2.1, wz]]);
      if (rnd() < 0.5) face(winRed, [[s * 5.77, 2.55, z0 + 0.2], [s * 5.77, 2.55, z1 - 0.3], [s * 5.77, 2.65, z1 - 0.3], [s * 5.77, 2.65, z0 + 0.2]]);
      // consoles in front of the lower wall
      for (let j = 0; j < 2; j++) { const zc = rr(z0, z1 - 0.6), h = rr(0.5, 1.3), dx = rr(0.25, 0.6); box(greeble[2], ...(s > 0 ? [5.78 - dx, 0, zc, 5.78, h, zc + rr(0.3, 0.7)] : [-5.78, 0, zc, -5.78 + dx, h, zc + rr(0.3, 0.7)])); }
      // overhang greeble: panels, boxes and pipes along the slant
      for (let j = 0; j < 18; j++) {
        const g = greeble[rnd() < 0.7 ? 0 : 1], u0 = rr(0.05, 0.9), du = rr(0.04, 0.15), zz = rr(z0 - 0.6, z1), dz = rr(0.3, 1.4), e = rr(0.08, 0.35);
        const a = ovh(s, u0, zz, 0), b = ovh(s, u0 + du, zz, 0), c = ovh(s, u0 + du, zz, e), d = ovh(s, u0, zz, e);
        loft(g, [[a, b, c, d], [a, b, c, d].map((p) => [p[0], p[1], p[2] + dz])]);
      }
      if (rnd() < 0.8) { const u0 = rr(0.3, 0.8); greeble[1].tube([ovh(s, u0, z0 - 1, 0.12), ovh(s, u0, z1 + 1, 0.12)], 0.06, 6, false); }
      // sagging cables between the ribs (A1–B2 crop)
      for (let j = 0; j < 3; j++) { const u0 = rr(0.2, 0.95), a = ovh(s, u0, z0 - 0.5, 0.05), b = ovh(s, u0 + rr(-0.1, 0.1), z1 + 0.5, 0.05), sag = rr(0.2, 0.7);
        greeble[2].tube([0, 0.25, 0.5, 0.75, 1].map((f) => [mix(a[0], b[0], f), mix(a[1], b[1], f) - sag * 4 * f * (1 - f), mix(a[2], b[2], f)]), 0.03, 5, false); }
      // teal window bars high on the overhang (A2, E3)
      if (rnd() < 0.6) { const u0 = rr(0.15, 0.45); face(s < 0 ? winL : winR, [ovh(s, u0, z0, 0.02), ovh(s, u0, z1, 0.02), ovh(s, u0 + 0.06, z1, 0.02), ovh(s, u0 + 0.06, z0, 0.02)]); }
      // RB-L2 small lights: cabinet tops and along the strut-girder line
      pts.push(s * 5.3, 3.45, z0 + rr(0.5, 1.5), 0.05, 2.6, 2.5, 2.3, 0);
      for (let j = 0; j < 4; j++) { const b = rr(1.0, 2.4); pts.push(s * 5.74, rr(0.4, 2.9), rr(z0, z1), 0.035, 0.9 * b, 1.4 * b, 2.0 * b, 0); } // lower-wall indicator lights (B3, E3)
      pts.push(...ovh(s, 0.62, z0 + rr(0, 2), 0.05), 0.05, 2.2, 2.0, 1.7, 0);
      if (rnd() < 0.5) pts.push(...ovh(s, 0.95, z0 + rr(0, 2), 0.05), 0.05, 2.4, 2.3, 2.1, 0);
      for (let j = 0; j < 4; j++) { const b = rr(1.2, 2.6), c = rnd() < 0.7; pts.push(...ovh(s, rr(0.05, 1), rr(z0, z1), 0.06), 0.035, (c ? 0.8 : 1.8) * b, (c ? 1.4 : 1.2) * b, (c ? 2.0 : 0.6) * b, 0); }
    }
    greeble.forEach((g, i) => meshes.push(inst(g.build(), one(3, gCol[i]))));
    meshes.push(inst(winL.build(), one(4, [0.15, 0.36, 0.44])));
    meshes.push(inst(winR.build(), one(4, [0.22, 0.50, 0.86]))); // E3: the right wall's windows read blue
    meshes.push(inst(winRed.build(), one(4, [0.9, 0.18, 0.16])));
    // hanging clamps and sensors under the girders (C1, E1)
    { const m = new Mesh(); for (const [x, y, z] of [[-4.2, 5.7, 9], [4.75, 5.45, 5.5], [-4.2, 5.7, 26], [4.75, 5.45, 21]]) { box(m, x - 0.25, y - 0.6, z - 0.4, x + 0.25, y, z + 0.4); box(m, x - 0.05, y - 0.9, z - 0.05, x + 0.05, y - 0.6, z + 0.05); } meshes.push(inst(m.build(), one(3, [0.07, 0.09, 0.1]))); }
    // D6: the cart at the far left (A4)
    { const m = new Mesh(); box(m, -5.6, 0.25, 4.2, -4.6, 0.85, 6.0); box(m, -5.5, 0.85, 4.4, -4.8, 1.15, 5.4); box(m, -5.6, 0, 4.3, -4.6, 0.25, 4.5); box(m, -5.6, 0, 5.7, -4.6, 0.25, 5.9); meshes.push(inst(m.build(), one(3, [0.55, 0.58, 0.56]))); }

    // ---- RB-E1 far bulkhead: low, with a central doorway
    { const m = new Mesh(); box(m, -5.9, 0, ZEND, -1.5, 2.2, ZEND + 1.5); box(m, 1.5, 0, ZEND, 5.9, 2.2, ZEND + 1.5); box(m, -5.9, 2.2, ZEND, 5.9, 2.9, ZEND + 1.5);
      box(m, -6.6, 2.9, ZEND + 0.5, 6.6, 3.3, ZEND + 1.2); meshes.push(inst(m.build(), one(3, [0.42, 0.52, 0.52]))); }

    // ---- the ship on the pad (RB-K)
    // KS: everything built so far is bay structure in first-solve units
    for (const m of meshes) for (let i = 0; i < m.inst.length; i += 12) { m.inst[i] *= KS; m.inst[i + 1] *= KS; m.inst[i + 2] *= KS; m.inst[i + 3] *= KS; }
    for (let i = 0; i < pts.length; i += 8) { pts[i] *= KS; pts[i + 1] *= KS; pts[i + 2] *= KS; pts[i + 3] *= KS; }
    const parts = shipParts(), shipMeshes = [];
    for (const [b, c, mat] of parts) { b.shipPart = true; meshes.push(inst(b, [0, SHIP_Y, 0, 1, 0, 0, 0, 1, mat, c[0], c[1], c[2]])); shipMeshes.push(b); }

    // ---- asteroids outside (RB-S3..S6), placed at their source frame positions: [px x, px y, px diameter, distance m, seed]
    const ROCKS = [[885, 235, 190, 70, 1], [1030, 92, 200, 80, 2], [612, 220, 75, 85, 3], [530, 45, 78, 85, 4], [640, 35, 92, 90, 5], [690, 62, 45, 95, 6],
      [785, 292, 66, 85, 7], [700, 232, 35, 95, 8], [612, 300, 55, 95, 9], [640, 372, 45, 100, 10], [945, 10, 45, 90, 11],
      [858, 95, 25, 100, 12], [850, 122, 20, 100, 13], [840, 140, 18, 100, 14], [960, 68, 20, 100, 15], [745, 12, 15, 110, 16], [735, 265, 15, 110, 17],
      [800, 325, 12, 110, 18], [745, 370, 10, 110, 19], [752, 386, 12, 110, 20], [780, 60, 10, 110, 21], [812, 62, 10, 110, 22], [640, 268, 12, 110, 23], [998, 10, 15, 110, 24]];
    const rv = [rockMesh(4, 301), rockMesh(4, 302), rockMesh(3, 303), rockMesh(3, 304)];
    const rInst = rv.map(() => []);
    rseed(77);
    for (const [px, py, pd, d, seed] of ROCKS) {
      const p = at(px / 1456, py / 816, d), r = pd / 1456 * t * asp * d; // radius from the diameter in px
      const v = pd > 60 ? seed % 2 : 2 + (seed % 2);
      rInst[v].push(p[0], p[1], p[2], r * 0.92, ...qRand(), 6, seed / 30, 0, 0);
    }
    rv.forEach((m, i) => { if (rInst[i].length) meshes.push(inst(m, rInst[i])); });

    // ---- RB-C7 floating specks in the trench, densest toward the far end
    rseed(9);
    for (let i = 0; i < 700; i++) { const z = 6 + Math.pow(rnd(), 0.6) * 56, w = 4.5; const warm = rnd() < 0.3, b = rr(0.6, 2.0); pts.push(rr(-w, w) * KS, rr(0.5, 8) * KS, z * KS, rr(0.012, 0.03), warm ? 1.6 * b : 1.0 * b, warm ? 1.0 * b : 1.1 * b, warm ? 0.5 * b : 1.1 * b, 1); }

    const G = { meshes, points: new Float32Array(pts), shipMeshes,
      // 0 concept (RI-1.0) · 1 trench overview · 2 the end of the launch in bay space (= Frame 0) · 3 ship side study · 4 ship 3/4 front study · 5 high section view
      poses: [[CAM[0], CAM[1], CAM[2], 0, PITCH, FOV], [0, 6, -12, 0, -0.05, 1.1], [0, 20, 70, 0, F0_PITCH, F0_FOV],
        [4.6, SHIP_Y + 0.5, 0, -PI / 2, -0.06, 0.62], [3.4, SHIP_Y + 1.6, 4.6, Math.atan2(-3.4, -4.6), -0.24, 0.6], [0, 14, -16, 0, -0.5, 1.25]] };
    // ?launch: play the launch in a loop (camera and ship), in bay space
    if (typeof QS !== 'undefined' && QS.has('launch')) {
      const o7 = new Float64Array(7);
      G.update = (F, dt) => {
        const tt = (F[8] % (DUR + 1.5)); launch(tt, F, false);
        const sc = ship(tt, o7, false);
        for (const b of shipMeshes) { const I = b.inst; I[0] = o7[0]; I[1] = o7[1]; I[2] = o7[2]; I[3] = sc; I[4] = o7[3]; I[5] = o7[4]; I[6] = o7[5]; I[7] = o7[6]; b.dirty = true; }
        SCENE.p0[0] = o7[0]; SCENE.p0[1] = o7[1]; SCENE.p0[2] = o7[2]; SCENE.p0[3] = sc * clamp(1.6 - (o7[1] - SHIP_Y) * 0.35, 0, 1);
      };
    }
    return G;
  }

  // ---------------------------------------------------------------- launch path (section 7)
  const T_HOLD = 0.8, T_LIFT = 1.6, T_PUSH = 4.2, DUR = T_HOLD + T_LIFT + T_PUSH, LIFT_Y = 2.4;
  const V_END = 0.3 * 14; // Reef Run's speed at Frame 0 (INTRO.speed0 × SPEED)
  let path = null, PL = 0;
  // rail.js's at() compresses its last partial step, so the end of the push-out follows Frame 0's line of flight analytically instead
  const T = new Float64Array(3), T2 = new Float64Array(3);
  const ensure = () => {
    if (path) return;
    // the last three points lie on Frame 0's line of flight (pitch 0.42 through the bay-space image of the Nebula origin)
    const E = [-OFFSET[0], -OFFSET[1], -OFFSET[2]], dy = sin(F0_PITCH), dz = cos(F0_PITCH), on = (d) => [E[0], E[1] - dy * d, E[2] - dz * d];
    path = makeRail([[0, LIFT_Y, 0], [0, 2.5, 8], [0, 3.1, 18], on(36), on(24), on(12), on(0)], 0.25); PL = path.len;
  };
  const smooth = (x, a, b) => { const k = clamp((x - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };
  // arc length along the push-out at time u (s): Hermite ease from rest to V_END
  const pushS = (u) => { const x = clamp(u / T_PUSH, 0, 1), m1 = V_END * T_PUSH / PL; return PL * ((-2 * x + 3) * x * x + m1 * (x * x * x - x * x)); };
  // ship pose in bay space: position T, pitch; returns pitch
  const shipAt = (t) => {
    ensure();
    if (t < T_HOLD + T_LIFT) { T[0] = 0; T[1] = mix(SHIP_Y, LIFT_Y, smooth(t, T_HOLD, T_HOLD + T_LIFT)); T[2] = 0; return 0.03 * sin(PI * clamp((t - T_HOLD) / T_LIFT, 0, 1)); }
    const s = pushS(t - T_HOLD - T_LIFT); path.at(s, T); path.tan(min(s, PL - 0.3), T2);
    const w = smooth(s, PL - 10, PL - 6), r = PL - s; // the last 12 m of the rail are this straight line
    T[0] = mix(T[0], -OFFSET[0], w); T[1] = mix(T[1], -OFFSET[1] - sin(F0_PITCH) * r, w); T[2] = mix(T[2], -OFFSET[2] - cos(F0_PITCH) * r, w);
    return Math.asin(clamp(T2[1], -1, 1));
  };
  function ship(t, o, world = true) {
    const p = shipAt(clamp(t, 0, DUR));
    o[0] = T[0]; o[1] = T[1]; o[2] = T[2];
    if (world) { o[0] += OFFSET[0]; o[1] += OFFSET[1]; o[2] += OFFSET[2]; }
    o[3] = sin(-p / 2); o[4] = 0; o[5] = 0; o[6] = cos(-p / 2); // nose up by p (rotation about +x by -p)
    return 1 - smooth(t, DUR - 2.0, DUR - 1.5); // hidden once the closing camera is within ~3 m (it then becomes the cockpit)
  }
  function launch(t, F, world = true) {
    t = clamp(t, 0, DUR);
    const p = shipAt(t), sx = T[0], sy = T[1], sz = T[2];
    // chase offset (concept: 6.2 m behind, 1.25 m above the ship) in the ship's pitched frame, closing into the cockpit at the end
    const k = 1 - smooth(t, T_HOLD + T_LIFT + 0.8, DUR), bk = 6.2 * k, up = (CAM[1] - SHIP_Y) * k, c = cos(p), s = sin(p);
    const cx = sx, cy = sy + up * c - bk * s, cz = sz - bk * c - up * s;
    const w = smooth(t, T_HOLD + 0.3, T_HOLD + T_LIFT + 0.6); // the camera holds the concept view while the pad lifts, then follows
    F[0] = mix(CAM[0], cx, w); F[1] = mix(CAM[1], cy, w); F[2] = mix(CAM[2], cz, w);
    F[3] = 0; F[4] = mix(PITCH, p, w); F[11] = mix(FOV, F0_FOV, smooth(t, T_HOLD + T_LIFT, DUR));
    if (t >= DUR) { F[0] = sx; F[1] = sy; F[2] = sz; F[4] = F0_PITCH; F[11] = F0_FOV; }
    if (world) { F[0] += OFFSET[0]; F[1] += OFFSET[1]; F[2] += OFFSET[2]; }
  }

  const ROCK_KEY = (() => { const d = [-0.6, 0.55, -0.55], l = hypot(...d); return [...d.map((v) => v / l), 0]; })();
  const SCENE = { id: 'reef-bay', sun: KEY, p0: [0, SHIP_Y, 0, 1], p1: ROCK_KEY, wgsl, post, build };
  return { scene: SCENE, launch, ship, DUR, OFFSET, FRAME0, CAM, FOV, PITCH, pre: [{ dur: DUR, step: (t, F) => launch(t, F, true) }] };
})();
