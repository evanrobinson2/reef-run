// ============================================================================
// Scene: Body Defenders, Gooey Toy. Reconstructs BD-1.0 (see experiments/space-garden/concept/body/toy/DECOMPOSITION.md).
// IDs in comments (BT-xx) refer to that record. The look is a soft clay-toy render (section 1): smooth wrap light, subsurface
// reds, a pale back-lit core, and a depth-of-field post pass. Every hero object is placed from its measured pixel centre and
// radius at a chosen depth (section 5, "screen-anchored placement"), so the hero camera reproduces the composition.
// ============================================================================
const T_FOV = 50 * PI / 180, T_ASP = 1456 / 816, T_TAN = Math.tan(T_FOV / 2);
const T_YAW = 0.0, T_PITCH = 0.0;                     // hero camera (section 6), tuned in the comparison
const T_LAM = 1.7, T_AMP = 0.42, T_TWIST = 2;          // ribbon folds: wavelength, depth, fold periods per turn (BT-C2)
const T_ZEND = 440, T_ZCH = 418;                      // tunnel end and the finale chamber's centre (P)
// vessel centreline c(z) (BT-C1, BT-C4: bends left after the hero). The same formulas are in the WGSL below.
const tcx = (z) => -3.0 * (1 - Math.cos(0.06 * z)) + 1.2 * Math.sin(0.013 * z) * Math.sin(0.013 * z) * 4;
const tcy = (z) => 1.4 * (1 - Math.cos(0.044 * z)) * Math.sin(0.019 * z + 0.3);
const tR0 = (z) => (4.7 + 0.45 * Math.sin(0.05 * z + 1.0) + 5.2 * Math.exp(-(((z - T_ZCH) / 13) ** 2))) * sstep(-24, -12, z) * sstep(T_ZEND, T_ZEND - 14, z);
// fold profile: |sin(pi*phi)|^0.6, crests come inward, crevices are the dark lines (section 5)
const tPhase = (z, th) => z / T_LAM + T_TWIST * th / TAU + 0.34 * Math.sin(th * 3 + z * 0.11) + 0.22 * Math.sin(th * 5 - z * 0.07 + 1.3) + 0.15 * Math.sin(th * 2 + z * 0.23 + 0.7);
const tAmp = (z, th) => T_AMP * (0.7 + 0.3 * Math.sin(th * 2 + z * 0.05));
// vessel density: > 0 in the wall (metres, approximately)
function toyField(x, y, z) {
  const dx = x - tcx(z), dy = y - tcy(z), d = Math.hypot(dx, dy), r0 = tR0(z);
  if (Math.abs(d - r0) > 1.4) return d - r0;
  const th = Math.atan2(dy, dx), f = Math.pow(Math.abs(Math.sin(PI * tPhase(z, th))), 0.6);
  return d - (r0 - tAmp(z, th) * f);
}

const SCENE = {
  id: 'body-toy',
  sun: (() => { const d = [-0.45, 0.8, -0.4], l = hypot(...d); return d.map((v) => v / l); })(), // key light direction: above, front-left (section 4)
  p0: [0, 0, 1, 0],          // xyz: direction of the core glow (set in build); w unused
  p1: [1, 6.4, 0, 0],        // x: depth-of-field strength, y: focus distance (m), w: ghost rail (GAME_API)
  wgsl: /*wgsl*/`
fn tcx(z: f32) -> f32 { let s = sin(0.013 * z); return -3.0 * (1.0 - cos(0.06 * z)) + 4.8 * s * s; }
fn tcy(z: f32) -> f32 { return 1.4 * (1.0 - cos(0.044 * z)) * sin(0.019 * z + 0.3); }
fn tPhase(z: f32, th: f32) -> f32 { return z / ${T_LAM} + ${T_TWIST}.0 * th / 6.2831853 + 0.34 * sin(th * 3.0 + z * 0.11) + 0.22 * sin(th * 5.0 - z * 0.07 + 1.3) + 0.15 * sin(th * 2.0 + z * 0.23 + 0.7); }
const CORE = vec3f(0.93, 0.60, 0.59);      // BT-C3 pale pink core (#f3aca7 highlights, #efa19e)
fn sky(rd: vec3f) -> vec3f { return CORE; }
fn fogApply(c: vec3f, wp: vec3f, d: f32) -> vec3f {
  // tissue scatter: with depth everything goes paler pink toward the core (section 4, back light)
  let rd = (wp - u.cam.xyz) / max(d, 1e-3);
  let o = pow(sat(dot(rd, u.p0.xyz)), 30.0);
  let f = (1.0 - exp(-max(d - 8.0, 0.0) * (0.018 + 0.03 * o))) * (0.5 + 0.5 * o);
  // far tissue near the core reads as pale lumpy lobes (BT-C3), approximated in the scatter colour
  let lobe = fbm3(wp * 0.16, 3);
  let far = mix(vec3f(0.88, 0.38, 0.41), CORE * (0.86 + 0.24 * lobe), o);
  return mix(c, far, f);
}
fn wrapL(n: vec3f, l: vec3f, w: f32) -> f32 { return sat((dot(n, l) + w) / (1.0 + w)); }
fn shadeSolid(wp: vec3f, n0: vec3f, aux: f32, prm: vec4f, lp: vec3f) -> vec3f {
  let L = normalize(u.sun.xyz); let v = normalize(u.cam.xyz - wp); let mat = prm.x;
  var n = n0; if (dot(n, v) < 0.0) { n = -n; }
  let fres = pow(1.0 - sat(dot(n, v)), 2.0);
  if (mat < 0.5) { // BT-C2 vessel wall: ribbon folds with fibre streaks, crest/crevice colour from the analytic fold phase
    let dx = wp.x - tcx(wp.z); let dy = wp.y - tcy(wp.z); let th = atan2(dy, dx);
    let ph = tPhase(wp.z, th);
    let sn = sin(3.14159265 * ph);
    let f = pow(abs(sn), 0.6);
    // ribbon relief: tilt the normal along the vessel by the fold slope (the mesh grid smooths the folds' shape)
    let slope = 0.6 * pow(max(abs(sn), 0.05), -0.4) * sign(sn) * cos(3.14159265 * ph) * 3.14159265 / ${T_LAM};
    n = normalize(n + vec3f(0.0, 0.0, 1.0) * clamp(slope * ${T_AMP} * 0.8, -1.2, 1.2));
    if (dot(n, v) < 0.05) { n = normalize(n + v * (0.05 - dot(n, v))); }
    let fib = vn3(vec3f(ph * 7.0, th * 2.2, wp.z * 0.08)) * 0.45 + vn3(vec3f(ph * 19.0 + th * 3.0, th * 1.0, 0.0)) * 0.35 + vn3(vec3f(ph * 41.0, th * 0.6, 3.0)) * 0.2;
    let lit = sat(wrapL(n, L, 0.6) * 0.75 + 0.25 * sat(dot(n, v)) + 0.25 * sat(n.y)); // floor bounce: the source's floor (C4-E4) is the brightest wall
    let crest = vec3f(0.94, 0.58, 0.53); let mid = vec3f(0.87, 0.33, 0.37); let crev = vec3f(0.78, 0.22, 0.27);
    // crevice lines fade where they would alias (grazing and far): the source's far walls read as smooth folds
    let cv = sat(dot(n0 * sign(dot(n0, v)), v) * 2.5) * (1.0 - smoothstep(9.0, 24.0, length(wp - u.cam.xyz)));
    var c = mix(crev, mid, 1.0 - (1.0 - smoothstep(0.0, 0.3, f) * (0.6 + 0.4 * fib)) * 0.75 * cv);
    c = mix(c, crest, smoothstep(0.5, 1.0, f) * lit * (0.5 + 0.5 * fib));
    c *= 0.8 + 0.3 * lit;
    c *= 0.84 + 0.3 * fib;
    c += vec3f(0.30, 0.20, 0.20) * fres * 0.35;           // soft sheen
    return c;
  }
  if (mat < 1.5) { // BT-R red ball: raspberry bumps, subsurface wrap, velvet rim
    let b = vn3(lp * 26.0 + vec3f(prm.y * 40.0)); let b2 = vn3(lp * 55.0);
    let lit = wrapL(n, L, 0.8);
    var c = mix(vec3f(0.55, 0.03, 0.07), vec3f(0.90, 0.24, 0.25), lit);
    c = mix(c, vec3f(0.95, 0.42, 0.33), max(prm.w, 0.0));      // orange-tinted variant (BT-R10)
    c *= 1.0 + min(prm.w, 0.0) * 0.55;                         // shadowed foreground blobs (BT-C6..C8)
    c *= 0.8 + 0.28 * b + 0.12 * b2;
    c += vec3f(0.35, 0.10, 0.08) * fres * 0.6;
    return c;
  }
  if (mat < 2.5) { // BT-R nubs: gummy yellow-orange with a soft highlight
    let lit = wrapL(n, L, 0.5);
    var c = mix(vec3f(0.80, 0.42, 0.24), vec3f(0.98, 0.74, 0.46), lit);
    c = mix(c, c * vec3f(0.82, 0.48, 0.34), -min(prm.w, 0.0));   // shadowed foreground nubs go orange-brown (BT-C6 #9a3b21)
    let h = normalize(L + v); c += vec3f(0.25, 0.2, 0.15) * pow(sat(dot(n, h)), 24.0);
    return c;
  }
  let col = prm.yzw;
  if (mat < 3.5) { // painted toy plastic (ship BT-K1, faces): soft clay light, pink bounce from the vessel
    let lit = wrapL(n, L, 0.7);
    var c = col * (vec3f(0.70, 0.58, 0.56) + vec3f(0.30, 0.30, 0.28) * lit);
    if (mat > 3.2) { let sm = vn3(lp * 9.0); c = mix(c, c * vec3f(1.0, 0.78, 0.76), smoothstep(0.72, 0.85, sm) * 0.5); } // smudges (BT-K1c)
    let h = normalize(L + v); c += vec3f(0.18) * pow(sat(dot(n, h)), 30.0);
    c += vec3f(0.25, 0.10, 0.10) * fres * 0.5;
    return c;
  }
  if (mat < 4.5) { // BT-V virus body and stalks: lumpy pastel green
    let b = vn3(lp * 6.0 + vec3f(prm.y * 3.0));
    let lit = wrapL(n, L, 0.7);
    var c = col * (vec3f(0.62, 0.50, 0.48) + vec3f(0.45, 0.45, 0.42) * lit) * (0.88 + 0.22 * b);
    c += vec3f(0.30, 0.16, 0.16) * fres * 0.5;
    return c;
  }
  if (mat < 5.5) { return col; } // emissive paint (BT-K1e stripes, bolts): HDR colour
  // BT-K1b glass dome: only the fresnel rim and the highlight are drawn; the centre is see-through
  let h = pow(sat(dot(n, normalize(L + v))), 40.0);
  let top = smoothstep(0.55, 0.9, dot(n, normalize(vec3f(-0.25, 1.0, 0.1))));
  let rim = smoothstep(0.55, 0.95, 1.0 - sat(dot(n, v)));
  let a = max(rim * 0.85, max(top * 0.35, h));
  let cs = toClip(wp); let sp = (cs.xy / cs.w * 0.5 + 0.5) * u.res.xy;
  let dither = fract(dot(floor(sp), vec2f(0.5, 0.25)) + 0.125);
  if (a < dither) { discard; }
  return mix(vec3f(0.92, 0.70, 0.68), vec3f(1.0, 0.95, 0.92), max(h, top));
}
fn pointMotion(p: vec3f, k: f32, t: f32) -> vec3f { let h = h31(floor(p * 3.0)); return vec3f(sin(t * 0.7 + h * 6.0), sin(t * 0.55 + h * 9.0), sin(t * 0.4 + h * 4.0)) * 0.12; }
`,
  post: /*wgsl*/`
// depth of field (section 5): a single-pass gather. Reversed-Z: view depth = 0.05 / d.
fn vz(d: f32) -> f32 { return select(0.05 / max(d, 1e-9), 1e5, d <= 0.0); }
fn coc(d: f32) -> f32 { // signed: < 0 in front of focus
  let z = vz(d); let zf = u.p1.y; let k = u.p1.x * u.res.y / 816.0;
  return select(min(6.0 * (1.0 - zf / z), 6.0), -min(30.0 * (zf / z - 1.0), 46.0), z < zf) * k;
}
fn grade(c0: vec3f, bl: vec3f, uv: vec2f, px: vec2i, d0: f32) -> vec3f {
  let k = u.p1.x * u.res.y / 816.0;
  var c = c0;
  if (k > 0.01) {
    let cc = coc(d0); var R = abs(cc);
    // nearer blurred neighbours spread over this pixel (foreground bleed)
    for (var i = 0; i < 8; i++) {
      let a = f32(i) * 0.7853982; let o = vec2f(cos(a), sin(a)) * 18.0 * k;
      let dn = depthAt(px + vec2i(o)); let cn = coc(dn);
      if (dn > d0 && cn < 0.0) { R = max(R, min(-cn, 18.0 * k + 2.0)); }
    }
    if (R > 0.75) {
      var acc = c0; var wsum = 1.0;
      for (var i = 1; i < 25; i++) {
        let r = sqrt(f32(i) / 24.0) * R; let a = f32(i) * 2.3999632;
        let o = vec2f(cos(a), sin(a)) * r;
        let ds = depthAt(px + vec2i(o)); var cs = abs(coc(ds));
        if (ds < d0) { cs = min(cs, abs(cc)); }           // farther samples cannot spread wider than this pixel's own blur
        let w = sat(1.0 + cs - r);
        acc += hdrAt(uv + o * u.res.zw) * w; wsum += w;
      }
      c = acc / wsum;
    }
  }
  c += bl * 0.3;
  return clamp(c, vec3f(0.0), vec3f(1.0));
}
`,
  build() {
    const yaw = T_YAW, f = [Math.sin(yaw), 0, Math.cos(yaw)], r = [Math.cos(yaw), 0, -Math.sin(yaw)], up = [0, 1, 0];
    // screen-anchored placement from the hero camera (section 5): pixel centre (px, py), depth d, pixel radius rpx
    const place = (px, py, d, rpx = 0) => {
      const nx = px / 728 - 1, ny = 1 - py / 408, x = nx * T_TAN * T_ASP * d, y = ny * T_TAN * d;
      return [r[0] * x + f[0] * d, y, r[2] * x + f[2] * d, rpx / 408 * T_TAN * d];
    };
    // wall-stuck hero objects: the depth along the pixel's ray where the object's centre sits `sink` radii inside the wall
    // (comparison v1: at a free depth guess R1/R5-R8 fell outside the tube, so in the source they must be on the wall)
    const placeWall = (px, py, rpx, sink) => {
      let lo = 1, hi = 40;
      for (let i = 0; i < 40; i++) { const d = (lo + hi) / 2, p = place(px, py, d, rpx), a = hypot(p[0] - tcx(p[2]), p[1] - tcy(p[2])); if (a + p[3] * sink < tR0(p[2])) lo = d; else hi = d; }
      return place(px, py, lo, rpx);
    };
    // the core glow direction: down the tunnel from the hero camera (BT-C3)
    { const z = 60, dx = tcx(z), dy = tcy(z) + 0.0, l = hypot(dx, dy, z); SCENE.p0 = [dx / l, dy / l, z / l, 0]; }

    // ---- BT-C1/C2 vessel: density grid -> surface nets, analytic normals
    const GV = 0.3; let xmin = 1e9, xmax = -1e9, ymin = 1e9, ymax = -1e9;
    for (let z = -24; z <= T_ZEND + 4; z += 1) { const R = tR0(z) + 1.2; xmin = min(xmin, tcx(z) - R); xmax = max(xmax, tcx(z) + R); ymin = min(ymin, tcy(z) - R); ymax = max(ymax, tcy(z) + R); }
    const G0 = [floor(xmin) - 1, floor(ymin) - 1, -26], GX = Math.ceil((xmax - G0[0] + 1) / GV) + 1, GY = Math.ceil((ymax - G0[1] + 1) / GV) + 1, GZ = Math.ceil((T_ZEND + 6 - G0[2]) / GV) + 1;
    const D = new Float32Array(GX * GY * GZ);
    for (let k = 0; k < GZ; k++) {
      const z = G0[2] + k * GV, cx = tcx(z), cy = tcy(z), r0 = tR0(z);
      for (let j = 0; j < GY; j++) { const dy = G0[1] + j * GV - cy; for (let i = 0; i < GX; i++) {
        const dx = G0[0] + i * GV - cx, d = Math.hypot(dx, dy); let v;
        if (Math.abs(d - r0) > 1.4) v = d - r0;
        else { const th = Math.atan2(dy, dx); v = d - (r0 - tAmp(z, th) * Math.pow(Math.abs(Math.sin(PI * tPhase(z, th))), 0.6)); }
        D[i + GX * (j + GY * k)] = v;
      } }
    }
    const sn = surfaceNets(D, GX, GY, GZ);
    const m = new Mesh();
    for (let k = 0; k < sn.nv; k++) m.v(G0[0] + sn.pos[k * 3] * GV, G0[1] + sn.pos[k * 3 + 1] * GV, G0[2] + sn.pos[k * 3 + 2] * GV, 1);
    for (let i = 0; i < sn.ni; i++) m.i.push(sn.idx[i]);
    const e = 0.08;
    const wall = m.build((x, y, z) => [toyField(x - e, y, z) - toyField(x + e, y, z), toyField(x, y - e, z) - toyField(x, y + e, z), toyField(x, y, z - e) - toyField(x, y, z + e)]); // outward (toward open space)
    wall.inst = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0]);

    // ---- BT-R red nubbed ball family: an egg-ish bumpy body + a nub mesh sharing the instance transform
    rseed(11);
    const ball = icosphere(3, (x, y, z) => { const k = 1 + 0.04 * (vnoise(x * 4 + 3, y * 4, z * 4) - 0.5); return [x * k, y * 0.94 * k, z * 1.06 * k]; }).build();
    const nubs = new Mesh();
    for (let i = 0; i < 40; i++) { // Fibonacci sphere with jitter; ~2/3 short rounded rods, ~1/3 flat dots (BT-R)
      const yy = 1 - 2 * (i + 0.5) / 40, rr0 = Math.sqrt(1 - yy * yy), a = i * 2.39996 + rr(-0.25, 0.25);
      const nx = Math.cos(a) * rr0, ny = yy, nz = Math.sin(a) * rr0, rod = rnd() < 0.66;
      const L = rod ? rr(0.16, 0.3) : 0.03, w = rod ? rr(0.065, 0.1) : rr(0.07, 0.11);
      nubs.tube([[nx * 0.93, ny * 0.88, nz * 0.99], [nx * (0.98 + L * 0.6), ny * (0.92 + L * 0.6), nz * (1.04 + L * 0.6)], [nx * (0.98 + L), ny * (0.92 + L), nz * (1.04 + L)]], (k) => [w, w * 1.05, w * 0.7][k], 8, true);
    }
    const nub = nubs.build();
    const balls = [];
    // seed: texture seed; bob: shader bob amplitude (m); tint: 0 red .. 1 orange
    const addBall = (p, rad, seed, bob, tint, q) => { q = q || qRand(); balls.push([p[0], p[1], p[2], rad, q[0], q[1], q[2], q[3], 1, seed, bob, tint]); };
    // tint: 0 red, > 0 toward orange, < 0 darker (the shadowed foreground blobs, A4 #7c0f17)
    const hero = (px, py, d, rpx, tint = 0, bob = 0.02) => { const p = place(px, py, d, rpx); addBall(p, p[3], rnd(), bob, tint); };
    const heroW = (px, py, rpx, sink, tint = 0) => { const p = placeWall(px, py, rpx, sink); addBall(p, p[3], rnd(), 0, tint); };
    heroW(1170, 70, 120, 0.25);        // BT-R1, on the upper-right wall
    hero(470, 355, 8.0, 85);           // BT-R2
    hero(575, 575, 7.0, 125, 0, 0);    // BT-R3, leaning on the lower-left wall
    hero(805, 225, 12, 75);            // BT-R4
    heroW(578, 75, 36, 0.2);           // BT-R5 (ceiling)
    heroW(475, 190, 32, 0.2);          // BT-R6
    heroW(940, 130, 25, 0.2);          // BT-R7
    heroW(1170, 535, 42, 0.3);         // BT-R8, on the right wall
    heroW(845, 680, 70, 0.75);         // BT-R9 half-dome: centre sunk into the floor
    hero(680, 490, 18, 45, 0.7);       // BT-R10 orange-tinted, behind R3
    hero(-40, 470, 3.0, 400, -0.6, 0);  // BT-C6 foreground blob, left (dark, shadowed)
    hero(1420, 590, 3.6, 250, -0.7, 0); // BT-C7 foreground blob, right
    hero(450, 712, 4.0, 100, 0, 0); // BT-C8 blurred lump, lower left
    const NHERO_BALLS = balls.length;
    // ambient cells along the vessel: some stuck to the wall (half sunk, like BT-R9), most floating in the stream (P: density)
    for (let z = 34; z < T_ZEND - 8; z += rr(2.6, 5.0)) { // starts beyond the hero's sharp field (v1: far clutter not in the source)
      const th = rnd() * TAU, R = tR0(z), wallStuck = rnd() < 0.55, rad = wallStuck ? rr(0.5, 1.1) : rr(0.45, 1.0);
      const rho = wallStuck ? R - 0.25 * rad : rr(1.8, R - rad - 0.6);
      const ax = tcx(z) + Math.cos(th) * rho, ay = tcy(z) + Math.sin(th) * rho;
      if (z < 95 && Math.abs(ax / z) < T_TAN * T_ASP * 1.05 && Math.abs(ay / z) < T_TAN * 1.05) continue;
      addBall([tcx(z) + Math.cos(th) * rho, tcy(z) + Math.sin(th) * rho, z], rad, rnd(), wallStuck ? 0 : rr(0.03, 0.12), rnd() < 0.12 ? rr(0.4, 0.8) : 0);
    }
    const NSTATIC = balls.length, NSTREAM = 40; // the game owns the stream pool (drifting cells)
    for (let i = 0; i < NSTREAM; i++) balls.push([0, 0, 0, 0, 0, 0, 0, 1, 1, rnd(), 0, 0]);
    const ballInst = new Float32Array(balls.flat()), nubInst = ballInst.slice();
    for (let i = 0; i < balls.length; i++) nubInst[i * 12 + 8] = 2;
    ball.inst = ballInst; nub.inst = nubInst; ball.toyCell = true; nub.toyNub = true;

    // ---- BT-V virus family: lumpy body, stalks with ball tips, a face (eyes + smile or frown)
    rseed(23);
    const vBody = icosphere(3, (x, y, z) => { const k = 1 + 0.07 * (vnoise(x * 3.2, y * 3.2 + 5, z * 3.2) - 0.5); return [x * k, y * k, z * k]; }).build();
    const stalks = new Mesh();
    for (let i = 0; i < 14; i++) {
      const yy = 1 - 2 * (i + 0.5) / 14, rr0 = Math.sqrt(1 - yy * yy), a = i * 2.39996 + 0.4;
      const nx = Math.cos(a) * rr0, ny = yy, nz = Math.sin(a) * rr0;
      if (nz > 0.72 && Math.abs(ny) < 0.6) continue; // keep the face clear
      stalks.tube([[nx * 0.9, ny * 0.9, nz * 0.9], [nx * 1.25, ny * 1.25, nz * 1.25], [nx * 1.42, ny * 1.42, nz * 1.42]], (k) => [0.07, 0.05, 0.05][k], 6, false);
      const tip = icosphere(1, (x, y, z) => [nx * 1.5 + x * 0.12, ny * 1.5 + y * 0.12, nz * 1.5 + z * 0.12]);
      const o = stalks.p.length / 3; stalks.p.push(...tip.p); stalks.aux.push(...tip.aux); for (const t of tip.i) stalks.i.push(t + o);
    }
    const vStalk = stalks.build();
    const eyesM = new Mesh();
    for (const sx of [-0.33, 0.33]) { const s = icosphere(1, (x, y, z) => [sx + x * 0.1, 0.1 + y * 0.12, 0.95 + z * 0.06]); const o = eyesM.p.length / 3; eyesM.p.push(...s.p); eyesM.aux.push(...s.aux); for (const t of s.i) eyesM.i.push(t + o); }
    const vEyes = eyesM.build();
    const smileM = icosphere(2, (x, y, z) => { const yy = y < 0 ? y : y * 0.25; return [x * 0.2, -0.14 + yy * 0.13, 0.97 + z * 0.05]; }); // open pink mouth (BT-V2)
    const vSmile = smileM.build();
    const frownM = new Mesh(); // grumpy: a frown and two slanted brows (section 8, P)
    frownM.tube(Array.from({ length: 9 }, (_, k) => { const a = (k / 8 - 0.5) * 1.6; return [Math.sin(a) * 0.22, -0.26 + Math.cos(a) * 0.1, 0.98]; }), 0.035, 6, true);
    for (const s of [-1, 1]) frownM.sweep([[s * 0.48, 0.34, 0.86], [s * 0.18, 0.24, 0.98]], 0.07, 0.05, null, true);
    const vFrown = frownM.build();
    const NG = 56;
    const gI = () => { const a = new Float32Array(NG * 12); for (let i = 0; i < NG; i++) a[i * 12 + 7] = 1; return a; };
    const germ = { body: Object.assign(vBody, { inst: gI() }), stalk: Object.assign(vStalk, { inst: gI() }), eyes: Object.assign(vEyes, { inst: gI() }), smile: Object.assign(vSmile, { inst: gI() }), frown: Object.assign(vFrown, { inst: gI() }), n: NG };
    const GREEN_FAR = [0.66, 0.78, 0.62], MINT = [0.80, 0.92, 0.74], DARK = [0.13, 0.03, 0.05], MOUTH = [0.86, 0.36, 0.38];
    // write germ i: position, radius, rotation, colour, face (0 frown, 1 smile)
    const setGerm = (i, p, rad, q, col, smile) => {
      for (const [mm, c, show] of [[germ.body, col, 1], [germ.stalk, col, 1], [germ.eyes, DARK, 1], [germ.smile, MOUTH, smile], [germ.frown, DARK, 1 - smile]]) {
        const a = mm.inst, o = i * 12; a[o] = p[0]; a[o + 1] = p[1]; a[o + 2] = p[2]; a[o + 3] = rad * show; a[o + 4] = q[0]; a[o + 5] = q[1]; a[o + 6] = q[2]; a[o + 7] = q[3];
        a[o + 8] = mm === germ.body || mm === germ.stalk ? 4 : 3; a[o + 9] = c[0]; a[o + 10] = c[1]; a[o + 11] = c[2];
      }
    };
    // a germ faces direction (dx,dy,dz): local +z -> that direction
    const faceQ = (dx, dy, dz, roll = 0) => { const yw = Math.atan2(dx, dz), pt = -Math.asin(clamp(dy / (hypot(dx, dy, dz) || 1), -1, 1)); return qMul(qMul(qAxis(0, 1, 0, yw), qAxis(1, 0, 0, pt)), qAxis(0, 0, 1, roll)); };
    { const p = place(603, 188, 14, 38); setGerm(0, p, p[3], faceQ(-p[0], -p[1], -p[2], 0.3), GREEN_FAR, 0); }   // BT-V1
    { const p = place(1362, 272, 6.0, 60); setGerm(1, p, p[3], faceQ(-p[0] - 1.2, -p[1], -p[2], -0.15), MINT, 1); } // BT-V2, smiling
    germ.heroN = 2; germ.setGerm = setGerm; germ.faceQ = faceQ; germ.colours = { GREEN_FAR, MINT };

    // ---- BT-K1 the ship: marshmallow robot in a glass helmet (local +z = its front, +x = its right, +y = up)
    const shipParts = [];
    const part = (mesh, mat, rgb) => shipParts.push([mesh, mat, rgb]);
    const supE = (hx, hy, hz, n, taper = 0, sub = 4) => icosphere(sub, (x, y, z) => { const k = Math.pow(Math.pow(abs(x), n) + Math.pow(abs(y), n) + Math.pow(abs(z), n), 1 / n); const t = 1 - taper * (y / k + 1) * 0.5; return [x / k * hx * t, y / k * hy, z / k * hz * t]; });
    const tr = (mm, dx, dy, dz) => { for (let k = 0; k < mm.p.length; k += 3) { mm.p[k] += dx; mm.p[k + 1] += dy; mm.p[k + 2] += dz; } return mm; };
    const WHITE = [1.0, 0.93, 0.86], PINK = [0.95, 0.52, 0.52], PINKD = [0.86, 0.38, 0.42], YEL = [1.0, 0.86, 0.52], CYAN = [0.62, 1.25, 1.3], SALMON = [0.98, 0.62, 0.55], BLACK = [0.20, 0.02, 0.04];
    part(tr(supE(0.95, 0.42, 0.66, 3.6, 0.08), 0, 0, 0), 3.3, WHITE);                       // BT-K1c body tub
    part(tr(supE(0.98, 0.065, 0.68, 3.0), 0, -0.37, 0), 3, PINK);                             // BT-K1d base band
    { const c = new Mesh(); c.tube(Array.from({ length: 33 }, (_, k) => { const a = k / 32 * TAU; return [Math.cos(a) * 0.8, 0.43, Math.sin(a) * 0.56]; }), 0.075, 8, false); part(c, 3, PINK); } // collar
    part(tr(supE(0.6, 0.53, 0.47, 3.2, 0.14), 0, 0.86, 0.02), 3, WHITE);                    // BT-K1a head
    { const ey = new Mesh(); for (const sx of [-0.2, 0.2]) { const s = icosphere(1, (x, y, z) => [sx + x * 0.065, 0.93 + y * 0.075, 0.46 + z * 0.04]); const o = ey.p.length / 3; ey.p.push(...s.p); ey.aux.push(...s.aux); for (const t of s.i) ey.i.push(t + o); }
      ey.tube(Array.from({ length: 9 }, (_, k) => { const t = k / 8; return [(t - 0.5) * 0.3, 0.8 + 0.035 * Math.sin(t * PI * 1.6 + 0.3), 0.48]; }), 0.018, 5, true); part(ey, 3, BLACK); } // face: eyes + wavy frown
    part(icosphere(4, (x, y, z) => [x * 0.86, 0.82 + y * 0.86, 0.02 + z * 0.86]), 6, [1, 1, 1]); // BT-K1b glass dome
    part(tr(supE(0.42, 0.13, 0.05, 3.2), 0, -0.02, 0.66), 3, PINKD);                         // BT-K1e chest panel
    for (const [yy, col, mat] of [[0.055, YEL, 5], [0, SALMON, 3], [-0.055, CYAN, 5]]) part(tr(supE(0.33, 0.022, 0.02, 3), 0, -0.02 + yy, 0.705), mat, col); // three stripes
    { const a = new Mesh(); a.tube([[0.85, 0.02, 0.1], [1.12, -0.02, 0.18]], 0.12, 10, true); part(a, 3, WHITE);         // BT-K1f arm (its right = viewer's left in the hero)
      const cf = new Mesh(); cf.tube([[1.1, -0.02, 0.18], [1.2, -0.03, 0.2]], 0.14, 10, true); part(cf, 3, PINK);
      const cl = new Mesh(); for (const s of [-1, 1]) cl.tube([[1.2, -0.03, 0.2], [1.36, -0.03 + s * 0.07, 0.22], [1.44, -0.03 + s * 0.04, 0.25]], (k) => [0.07, 0.06, 0.045][k], 7, true); part(cl, 3, PINK); }
    { const a = new Mesh(); a.tube([[-0.85, 0.25, 0.0], [-1.0, 0.6, 0.05], [-1.08, 0.92, 0.08]], 0.13, 10, true); part(a, 3, WHITE);     // BT-K1g raised arm
      const c1 = new Mesh(); c1.tube([[-0.86, 0.26, 0.0], [-0.92, 0.38, 0.02]], 0.16, 10, true); part(c1, 3, PINK);
      const c2 = new Mesh(); c2.tube([[-1.05, 0.82, 0.07], [-1.09, 0.94, 0.08]], 0.155, 10, true); part(c2, 3, PINK);
      const cap = icosphere(2, (x, y, z) => [-1.1 + x * 0.14, 1.0 + y * 0.09, 0.08 + z * 0.14]); part(cap, 3, WHITE);
      const cone = new Mesh(); cone.tube([[-0.9, -0.04, 0.08], [-1.1, -0.04, 0.1], [-1.36, -0.04, 0.12]], (k) => [0.17, 0.15, 0.03][k], 12, true); part(cone, 3, PINK); } // the pink cone (blaster, I)
    { const w = new Mesh(); for (const [sx, sz] of [[0.42, 0.22], [-0.5, 0.18]]) { const b = icosphere(2, (x, y, z) => [sx + x * 0.13, -0.47 + y * 0.17, sz + z * 0.19]); const o = w.p.length / 3; w.p.push(...b.p); w.aux.push(...b.aux); for (const t of b.i) w.i.push(t + o); } part(w, 3, BLACK); } // BT-K1h wheels (rounded feet)
    // hero pose: right of centre and slightly low, front turned toward camera-left, rolled so its right side (viewer's left) dips
    const SHIP = place(935, 488, 6.3), shipQ = qMul(qMul(qAxis(0, 1, 0, -2.45), qAxis(1, 0, 0, -0.3)), qAxis(0, 0, 1, -0.36));
    const meshes = [wall, ball, nub, germ.body, germ.stalk, germ.eyes, germ.smile, germ.frown];
    for (const [pm, mat, rgb] of shipParts) { const b = pm.build(); b.shipPart = true; b.inst = new Float32Array([SHIP[0], SHIP[1], SHIP[2], 1, shipQ[0], shipQ[1], shipQ[2], shipQ[3], mat, rgb[0], rgb[1], rgb[2]]); meshes.push(b); }

    // ---- BT-P1 floating yellow specks (core region and along the vessel)
    const pts = [];
    rseed(31);
    for (let i = 0; i < 70; i++) { const p = place(rr(560, 820), rr(250, 520), rr(14, 26)); pts.push(p[0], p[1], p[2], rr(0.03, 0.06), 0.95, 0.62, 0.30, 1); }
    for (let i = 0; i < 700; i++) { const z = rr(10, T_ZEND - 10), th = rnd() * TAU, rho = Math.sqrt(rnd()) * (tR0(z) - 0.8); pts.push(tcx(z) + Math.cos(th) * rho, tcy(z) + Math.sin(th) * rho, z, rr(0.03, 0.07), 0.9, 0.6, 0.3, 1); }

    const poses = [[0, 0, 0, T_YAW, T_PITCH, T_FOV], [tcx(120), tcy(120), 120, Math.atan2(tcx(130) - tcx(120), 10), 0, T_FOV], [tcx(392), tcy(392) + 1, 392, 0, 0, 1.1]];
    return { meshes, points: new Float32Array(pts), field: toyField, ship: { pos: SHIP, q: shipQ }, poses,
      cells: { ball, nub, first: NSTATIC, n: NSTREAM, heroN: NHERO_BALLS }, germ,
      vessel: { cx: tcx, cy: tcy, R0: tR0, zEnd: T_ZEND, zChamber: T_ZCH } };
  },
};
