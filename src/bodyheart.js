// ============================================================================
// Scene: Body Defenders, Heart Gate. Reconstructs BD-4.0 (experiments/space-garden/concept/body/heart/DECOMPOSITION.md).
// IDs in comments (HG-xx) refer to that record. The look is painterly (section 1): soft lit shading with patchy
// brush modulation, a strong pink-white in-scatter and radial streaks toward the heart, a teal-grey wall in the gaps.
// The scene owns the rail (a vessel tube follows it), so the game reads G.rail. The finale straight ends at the heart.
// Live uniforms the game may write each frame: SCENE.sun (light position, ahead of the camera), SCENE.p0[3] (beat pulse
// 0..1), SCENE.p1[0..2] (heart centre, for the post streaks; p1[3] is the ghost-rail switch).
// ============================================================================
const HEART_FOV = 72 * PI / 180;                 // section 6 (I)
const HEART_YAW = -0.075, HEART_PITCH = -0.068;  // the axis vanishes at NDC (0.06, 0.09) (HG-C1)
const HEART_DIST = 24, HEART_CAM_DY = 0;         // hero camera: 24 m before the heart plane, on the axis (v2: the heart's box centre sits on the vanishing point)
const HEART_TILT = -21 * PI / 180, HEART_W = 8.8; // HG-H1: tilt and half-width (m): 222 px half-width at 24 m once the glow is included
const HB_LIGHT_DROP = 4.5; // I: the key light sits low in the opening (the source lights the floor pipes, C3-C4 streaks, and keeps the top dark)
const HB_RW = 13, HB_CHUNK = 24, HB_FUNNEL = 3.0; // HG-W1 wall radius; breathing chunk length; ring-plate depth (HG-H2: rim at ~300 px)
// the run: a gentle S through the vessel, then a straight 150 m to the heart along +z (collinear points keep it straight)
const HEART_CTRL = [[0, 0, 0], [0, 0, 40], [7, 4, 100], [20, 6, 170], [24, -3, 240], [13, -8, 310], [-5, -5, 380], [-13, 3, 450], [-7, 7, 515], [0, 6, 560], [0, 6, 590], [0, 6, 640], [0, 6, 690], [0, 6, 742]];
// unit heart (half-width 1), centred on its box and tilted (HG-H1 grammar)
const heartXY = (() => {
  const raw = (t) => [sin(t) ** 3, (13 * cos(t) - 5 * cos(2 * t) - 2 * cos(3 * t) - cos(4 * t)) / 16];
  // squashed to the source's height/width (375/445 px, measured after the tilt), then centred on the tilted box
  const c = cos(HEART_TILT), s = sin(HEART_TILT), SQ = 0.9, tilt = (p) => [p[0] * c - p[1] * SQ * s, p[0] * s + p[1] * SQ * c];
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (let i = 0; i < 720; i++) { const q = tilt(raw(i / 720 * TAU)); x0 = min(x0, q[0]); x1 = max(x1, q[0]); y0 = min(y0, q[1]); y1 = max(y1, q[1]); }
  const xc = (x0 + x1) / 2, yc = (y0 + y1) / 2, k = 2 / (x1 - x0);
  return (t) => { const q = tilt(raw(t)); return [(q[0] - xc) * k, (q[1] - yc) * k]; };
})();

const SCENE = {
  id: 'body-heart',
  sun: [0, 6, 740],          // light position: the heart (the game moves it ahead of the camera during the run)
  p0: [0, 0, 1, 0],          // xyz: the tunnel axis near the heart (stroke direction); w: beat pulse
  p1: [0, 6, 742, 1],        // xyz: heart centre; w: ghost rail on/off
  wgsl: /*wgsl*/`
const CREAM = vec3f(1.00, 0.93, 0.80);                // HG-H1 #fbd0b7 → #fdface
const PINK = vec3f(0.96, 0.47, 0.51);                 // #f57782
const HOT = vec3f(0.79, 0.23, 0.33);                  // #c93b54
const CRIM = vec3f(0.43, 0.07, 0.16);                 // #6d1129
const DEEP = vec3f(0.25, 0.03, 0.08);                 // #400715
const TEAL = vec3f(0.26, 0.44, 0.46);                 // HG-W1 #606b73 / #43676f
fn sky(rd: vec3f) -> vec3f {
  // only seen through the heart opening: a cream-white HDR void (HG-H1)
  let a = sat(dot(rd, normalize(u.p1.xyz - u.cam.xyz)));
  let fl = smoothstep(0.56, 0.7, fbm3(rd * 38.0, 3));
  let c = mix(PINK * 1.1, CREAM * 1.55, smoothstep(0.95, 0.993, a));
  return mix(c, HOT * 1.05, fl * 0.7) * (1.0 + 0.15 * u.p0.w);
}
// in-scatter toward the light: things near the heart wash to pink and then cream-white (section 4: glow)
fn glowCol(a: f32) -> vec3f {
  return mix(mix(vec3f(0.50, 0.12, 0.20), PINK * 0.95, smoothstep(0.75, 0.95, a)), CREAM * 1.15, smoothstep(0.975, 0.998, a));
}
fn fogApply(c: vec3f, wp: vec3f, d: f32) -> vec3f {
  let rd = (wp - u.cam.xyz) / max(d, 1e-3);
  let a = sat(dot(rd, normalize(u.sun.xyz - u.cam.xyz)));
  let f = (1.0 - exp(-max(d - 8.0, 0.0) * 0.03)) * (0.3 + 0.7 * smoothstep(0.6, 0.97, a));
  return mix(c, glowCol(a) * (1.0 + 0.2 * u.p0.w), f);
}
fn voro(p: vec3f) -> vec2f { // (F1, id)
  let i = floor(p); var b1 = 9.0; var id = 0.0;
  for (var z = -1; z <= 1; z++) { for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
    let g = i + vec3f(f32(x), f32(y), f32(z)); let o = vec3f(h31(g), h31(g + 11.3), h31(g + 27.1));
    let d = length(g + o - p); if (d < b1) { b1 = d; id = h31(g + 5.7); }
  } } }
  return vec2f(b1, id);
}
// brush patches: chunky cells stretched along the tunnel axis (section 1: radial strokes)
fn brush(wp: vec3f) -> f32 {
  let ax = u.p0.xyz; let along = dot(wp, ax); let across = wp - ax * along;
  return vn3(across * 0.9 + vec3f(along * 0.09)) * 0.65 + vn3(across * 3.1 + vec3f(along * 0.25)) * 0.35;
}
fn shadeSolid(wp: vec3f, n0: vec3f, aux: f32, prm: vec4f, lp: vec3f) -> vec3f {
  let v = normalize(u.cam.xyz - wp);
  var n = n0; if (dot(n, v) < 0.0) { n = -n; } // open surfaces: the visible side faces the camera
  let ld = u.sun.xyz - wp; let dist = length(ld); let l = ld / dist;
  let ndl = dot(n, l);
  let pulse = u.p0.w;
  let I = 1.7 * exp(-dist / 20.0) * (1.0 + 0.3 * pulse) + 0.06;   // the heart's light falls off down the tunnel
  let wrap = sat(ndl * 0.55 + 0.45);
  let rim = pow(1.0 - sat(dot(n, v)), 2.2);
  let back = sat(-ndl);
  let mat = prm.x;
  let br = brush(wp + vec3f(prm.y * 13.0));
  if (mat < 0.5) { // HG-W1 tunnel wall: teal-grey with long radial strokes, pink where the heart reaches
    var c = mix(vec3f(0.22, 0.26, 0.30), TEAL * 1.1, smoothstep(0.25, 0.8, br));
    c = c * (0.75 + 0.35 * wrap) + vec3f(0.95, 0.32, 0.40) * I * wrap * 0.22;
    c = mix(c, CRIM * 1.1 + HOT * 0.3 * wrap, smoothstep(14.0, 4.0, dist) * 0.8);  // near the ring plate the wall takes its colour
    return c;
  }
  if (mat < 1.5) { // HG-P pipe family: translucent pink-red, collars from geometry; cool sheen on the far side
    let t = sat(0.05 + wrap * I * 0.55 + (br - 0.5) * 0.2);
    var c = mix(mix(DEEP * 1.15, CRIM * 1.1, smoothstep(0.0, 0.3, t)), mix(HOT, PINK, smoothstep(0.75, 1.0, t)), smoothstep(0.28, 0.75, t));
    c += vec3f(0.30, 0.34, 0.38) * rim * (0.35 + 0.5 * back);           // HG-P4 glassy grey sheen
    c += PINK * 0.25 * pow(sat(dot(reflect(-l, n), v)), 12.0) * I;       // a soft highlight toward the heart
    return c;
  }
  if (mat < 2.5) { // HG-R red cells: lumpy crimson spheroids with dark dimple blotches (HG-RX)
    let vv = voro(lp * 2.3 + vec3f(prm.y * 37.0));
    let dimple = smoothstep(0.42, 0.22, vv.x) * (0.5 + 0.5 * vv.y);
    let t = sat(0.34 + prm.w * 0.14 + wrap * I * 0.8 + (br - 0.5) * 0.12);
    var c = mix(mix(DEEP, CRIM, smoothstep(0.0, 0.3, t)), mix(vec3f(0.58, 0.16, 0.26), vec3f(0.90, 0.26, 0.37), smoothstep(0.7, 1.0, t)), smoothstep(0.28, 0.75, t));
    c = mix(c, DEEP * 0.8 + c * 0.25, dimple * 0.55);
    c += vec3f(0.28, 0.30, 0.34) * rim * 0.35 * (0.4 + back);             // teal rim from the wall gaps
    c += vec3f(0.9, 0.3, 0.4) * rim * I * 0.35 * sat(ndl + 0.3);          // pink rim toward the heart
    c += vec3f(0.95, 0.28, 0.38) * I * pow(sat(dot(-v, l)), 6.0) * (0.25 + 0.75 * rim) * 0.8; // backlit membrane
    return c;
  }
  if (mat < 3.5) { // painted parts (ship HG-K1): colour in prm.yzw, two soft light bands, cool rim
    return prm.yzw * (0.62 + 0.38 * smoothstep(0.35, 0.6, wrap)) + vec3f(0.25, 0.3, 0.35) * rim * 0.4;
  }
  if (mat < 4.5) { return prm.yzw; } // emissive (HDR colour in prm.yzw)
  if (mat < 5.5) { // HG-H2 heart funnel: emissive, cream at the opening to hot pink at the rim, ridges catch light
    let w = aux * 0.5 + 0.5;
    let ridge = pow(sat(dot(n, v)), 3.0);
    var c = mix(PINK * 1.12, PINK * 1.05, smoothstep(0.0, 0.1, w));
    c = mix(c, HOT * 1.05, smoothstep(0.2, 0.6, w));
    c = mix(c, CRIM * 0.9, smoothstep(0.7, 0.95, w));
    c = mix(c, CRIM * 0.7, smoothstep(0.92, 1.0, w));
    let band = 0.5 + 0.5 * cos(w * 5.0 * 6.2832);                       // HG-H2 concentric ridges, light and dark
    c *= 0.78 + 0.22 * band + 0.2 * ridge + (br - 0.5) * 0.4;
    return c * (1.0 + 0.3 * pulse);
  }
  if (mat < 6.5) { // clots (game, P): dark red-purple goo, glossy, flashes when hit (prm.y)
    let vv = voro(lp * 3.0 + vec3f(prm.z * 17.0));
    var c = mix(vec3f(0.16, 0.02, 0.07), vec3f(0.42, 0.07, 0.18), wrap * min(I + 0.35, 1.0));
    c = mix(c, c * 0.55, smoothstep(0.35, 0.15, vv.x));
    c += vec3f(0.95, 0.55, 0.65) * pow(sat(dot(reflect(-l, n), v)), 18.0) * 0.6;
    c += vec3f(0.3, 0.32, 0.4) * rim * 0.4;
    return c + vec3f(1.2, 0.5, 0.6) * prm.y;
  }
  if (mat < 7.5) { // valve leaflets (game, P): pink membrane lit from the heart side, glowing more when open (prm.y)
    let t = sat(wrap * I + 0.25);
    var c = mix(vec3f(0.55, 0.14, 0.24), vec3f(0.98, 0.52, 0.58), t) * (0.8 + 0.3 * br);
    c += PINK * rim * 0.4 + vec3f(0.2, 0.9, 0.9) * prm.y * 0.25 * rim;
    return c;
  }
  // mat 8 gate ring (HG-P collar grammar + HG-M1 cyan windows) and mat 9 machinery (HG-M1):
  // dark metal lit pink, with cyan window panels around the local y axis
  let ang = atan2(lp.z, lp.x);
  let win = select(step(0.6, fract(ang * 12.0 / 6.2832)), step(0.5, fract(ang * 6.0 / 6.2832 + 0.25)) * step(abs(lp.y), 0.6), mat > 8.5);
  var c = mix(vec3f(0.10, 0.08, 0.12), vec3f(0.55, 0.20, 0.30), wrap * min(I + 0.3, 1.0)) + vec3f(0.22, 0.32, 0.36) * rim * 0.6;
  let glow = select(0.6 + 1.4 * prm.y, 0.75 + 0.25 * pulse, mat > 8.5);
  return mix(c, vec3f(0.12, 0.95, 0.92) * glow, win * 0.85);
}
fn pointMotion(p: vec3f, k: f32, t: f32) -> vec3f { let h = h31(floor(p * 3.0)); return vec3f(sin(t * 0.7 + h * 6.0), sin(t * 0.6 + h * 9.0), sin(t * 0.5 + h * 4.0)) * 0.25; }
`,
  post: /*wgsl*/`
fn grade(c0: vec3f, bl: vec3f, uv: vec2f, px: vec2i, d0: f32) -> vec3f {
  // radial light streaks toward the heart's screen position (HG-H3, the radial brush strokes)
  let r = u.sun.xyz - u.cam.xyz; let z = dot(r, u.fwd.xyz);
  var st = vec3f(0.0);
  if (z > 1.0) {
    let hn = vec2f(dot(r, u.right.xyz) / (z * u.fwd.w * u.right.w), dot(r, u.up.xyz) / (z * u.fwd.w));
    let huv = vec2f(hn.x * 0.5 + 0.5, 0.5 - hn.y * 0.5);
    let dir = huv - uv;
    for (var i = 1; i <= 8; i++) { let s = hdrAt(uv + dir * (f32(i) * 0.03)); st += max(s - vec3f(0.75), vec3f(0.0)) * (1.0 - f32(i) / 9.0); }
    st *= 0.16 * smoothstep(0.0, 0.25, length(dir));
  }
  var c = c0 + st + bl * 0.4;
  // vignette: the corners are darkest (section 4)
  let q = uv - 0.5; c *= 1.0 - 0.55 * smoothstep(0.15, 0.6, dot(q * vec2f(1.0, 0.8), q * vec2f(1.0, 0.8)) * 2.2);
  // soft shoulder so the heart clips to cream rather than flat white
  let sh = vec3f(0.82); let over = max(c - sh, vec3f(0.0));
  c = min(c, sh) + (vec3f(1.0) - exp(-over * 3.0)) * 0.18;
  return clamp(c, vec3f(0.0), vec3f(1.0)); // colours are authored in display values measured from the source
}
`,
  build() {
    const rail = makeRail(HEART_CTRL, 0.5), len = rail.len, sH = len, sFun = sH - HB_FUNNEL;
    const T0 = [0, 0, 0], T1 = [0, 0, 0], T2 = [0, 0, 0];
    // smooth frame: tangent from a 6 m chord, horizontal right, up = forward × right (the engine camera's convention)
    const frame = (s, o) => {
      rail.at(min(s + 3, len), T1); rail.at(max(s - 3, 0), T2);
      let fx = T1[0] - T2[0], fy = T1[1] - T2[1], fz = T1[2] - T2[2]; const l = hypot(fx, fy, fz) || 1; fx /= l; fy /= l; fz /= l;
      let rx = fz, rz = -fx; const rl = hypot(rx, rz) || 1; rx /= rl; rz /= rl;
      o[0] = fx; o[1] = fy; o[2] = fz; o[3] = rx; o[4] = 0; o[5] = rz; o[6] = fy * rz; o[7] = fz * rx - fx * rz; o[8] = -fy * rx; return o;
    };
    const FR = new Float64Array(9);
    // world point at rail distance s, angle a (0 = right, counter-clockwise toward up), radius R
    const tubeAt = (s, a, R, o) => { rail.at(s, T0); frame(s, FR); const c = cos(a) * R, d = sin(a) * R; o[0] = T0[0] + FR[3] * c + FR[6] * d; o[1] = T0[1] + FR[4] * c + FR[7] * d; o[2] = T0[2] + FR[5] * c + FR[8] * d; return o; };
    const heart = rail.at(sH, [0, 0, 0]);
    SCENE.sun = [heart[0], heart[1] - HB_LIGHT_DROP, heart[2]]; SCENE.p1[0] = heart[0]; SCENE.p1[1] = heart[1]; SCENE.p1[2] = heart[2];
    const meshes = [];
    const nCh = Math.ceil(sFun / HB_CHUNK);
    const chunkC = (k) => rail.at(min((k + 0.5) * HB_CHUNK, sFun), [0, 0, 0]);
    // a chunk mesh's vertices are stored relative to its centre so the game can breathe it by instance scale (walls only)
    const local = (m, c) => { for (let i = 0; i < m.p.length; i += 3) { m.p[i] -= c[0]; m.p[i + 1] -= c[1]; m.p[i + 2] -= c[2]; } };
    const chunks = [];

    // ---- HG-W1 tunnel wall: a radial distance field around the rail, R_w(s, θ), meshed directly as a swept tube
    const P = [0, 0, 0], SIDES = 48;
    for (let k = 0; k < nCh; k++) {
      const s0 = max(0, k * HB_CHUNK - 0.7), s1 = min(sFun + 0.6, (k + 1) * HB_CHUNK + 0.7), n = Math.ceil((s1 - s0) / 1.5);
      const m = new Mesh(), c = chunkC(k);
      for (let i = 0; i <= n; i++) {
        const s = mix(s0, s1, i / n);
        for (let j = 0; j < SIDES; j++) {
          const a = j / SIDES * TAU; tubeAt(s, a, HB_RW, P);
          const R = HB_RW + 1.4 * (fbm(P[0] * 0.09, P[1] * 0.09, P[2] * 0.09, 3) - 0.5);
          tubeAt(s, a, R, P); m.v(P[0], P[1], P[2], 0);
        }
      }
      for (let i = 0; i < n; i++) for (let j = 0; j < SIDES; j++) { const j2 = (j + 1) % SIDES; m.quad(i * SIDES + j, i * SIDES + j2, (i + 1) * SIDES + j2, (i + 1) * SIDES + j); }
      local(m, c);
      const b = m.build(); b.inst = new Float32Array([c[0], c[1], c[2], 1, 0, 0, 0, 1, 0, rnd(), 0, 0]); b.chunk = k; meshes.push(b); chunks.push(b);
    }

    // ---- HG-P pipe family: cylinders parallel to the rail at two radii, with collars and round caps (HG-P1..P5)
    rseed(41);
    const pipeM = Array.from({ length: nCh }, () => new Mesh());
    const PSIDES = 14;
    const ringAt = (m, s, a, R, r, aux) => { // one ring of a pipe around the pipe's axis point (rail s, angle a, radius R)
      rail.at(s, T0); frame(s, FR); const ca = cos(a), sa = sin(a);
      const ox = FR[3] * ca + FR[6] * sa, oy = FR[4] * ca + FR[7] * sa, oz = FR[5] * ca + FR[8] * sa; // radial out
      const tx = -FR[3] * sa + FR[6] * ca, ty = -FR[4] * sa + FR[7] * ca, tz = -FR[5] * sa + FR[8] * ca; // around
      const cx = T0[0] + ox * R, cy = T0[1] + oy * R, cz = T0[2] + oz * R, i0 = m.p.length / 3;
      for (let q = 0; q < PSIDES; q++) { const b = q / PSIDES * TAU, cb = cos(b) * r, sb = sin(b) * r; m.v(cx + ox * cb + tx * sb, cy + oy * cb + ty * sb, cz + oz * cb + tz * sb, aux); }
      return i0;
    };
    const joinRings = (m, A, B) => { for (let q = 0; q < PSIDES; q++) { const q2 = (q + 1) % PSIDES; m.quad(A + q, A + q2, B + q2, B + q); } };
    const capAt = (m, s, a, R, ring, dir) => { rail.at(s, T0); frame(s, FR); const ca = cos(a), sa = sin(a); const c = m.v(T0[0] + (FR[3] * ca + FR[6] * sa) * R + FR[0] * dir, T0[1] + (FR[4] * ca + FR[7] * sa) * R + FR[1] * dir, T0[2] + (FR[5] * ca + FR[8] * sa) * R + FR[2] * dir, 0); for (let q = 0; q < PSIDES; q++) m.tri(ring + q, ring + (q + 1) % PSIDES, c); };
    // a profile along the pipe: [s, radius scale] pairs give collars and the round caps
    const pipe = (sa, sb, a, R, r) => {
      const prof = [];
      prof.push([sa, 0.55], [sa + r * 0.18, 0.86], [sa + r * 0.45, 1]);
      let s = sa + rr(1.5, 5);
      while (s < sb - 1.2) {
        const cs = s; if (cs > sa + 0.8) prof.push([cs - 0.05, 1], [cs, 1.14], [cs + 0.38, 1.14], [cs + 0.43, 1]);
        const nx = min(sb - 1, s + rr(3, 8)); for (let q = s + 2; q < nx - 0.5; q += 2.2) prof.push([q, 1]); s = nx;
      }
      prof.push([sb - r * 0.45, 1], [sb - r * 0.18, 0.86], [sb, 0.55]);
      prof.sort((x, y) => x[0] - y[0]);
      let k = -1, m = null, prev = -1;
      for (let i = 0; i < prof.length; i++) {
        const [ps, sc] = prof[i], kk = min(nCh - 1, floor(ps / HB_CHUNK));
        if (kk !== k) { // the pipe crosses into a new chunk: repeat the ring there (overlap) so the seam stays closed
          if (m && prev >= 0) { const r2 = ringAt(pipeM[kk], ps, a, R, r * sc, 0); joinRings(pipeM[kk], ringAt(pipeM[kk], prof[i - 1][0], a, R, r * prof[i - 1][1], 0), r2); k = kk; m = pipeM[kk]; prev = r2; continue; }
          k = kk; m = pipeM[kk]; prev = -1;
        }
        const ri = ringAt(m, ps, a, R, r * sc, 0);
        if (prev >= 0) joinRings(m, prev, ri); else capAt(m, ps, a, R, ri, -r * 0.25);
        prev = ri;
      }
      capAt(m, prof[prof.length - 1][0], a, R, prev, r * 0.25);
    };
    for (const [R, r0, r1, gap0, gap1, fill] of [[9.4, 0.5, 0.95, 0.3, 1.2, 0.8], [11.4, 0.42, 0.75, 0.25, 0.9, 0.85]]) {
      let a = rr(0, 0.3);
      while (a < TAU - 0.05) {
        const r = rr(r0, r1); a += r / R;
        let s = rr(-4, 6);
        while (s < sFun - 3) {
          const L = rr(10, 46), e = min(s + L, sFun - 0.8 - rr(0, 4));
          if (rnd() < fill && e - max(s, 0.5) > 3) pipe(max(s, 0.5), e, a, R, r);
          s = e + rr(1, 7);
        }
        a += r / R + rr(gap0, gap1) * r / R * 2;
      }
    }
    for (let k = 0; k < nCh; k++) {
      const m = pipeM[k], c = chunkC(k); if (!m.i.length) continue; local(m, c);
      const b = m.build(); b.inst = new Float32Array([c[0], c[1], c[2], 1, 0, 0, 0, 1, 1, rnd(), 0, 0]); b.chunk = k; meshes.push(b); // pipes stay still (breathing them shows seams)
    }

    // ---- HG-H2 heart funnel: concentric heart ridges stepping out 1.0→1.65 and back 0→7 m, then a skirt to the wall
    {
      frame(sH, FR); const m = new Mesh(), NT = 200, WS = 64, WMAX = 5;
      for (let i = 0; i <= WS; i++) {
        const w = i / WS * WMAX, sc = 1 + 0.095 * min(w, 4), ridge = w < 4 ? 1 - 0.035 * Math.pow(1 - abs(2 * (w % 1) - 1), 3) : 1;
        const depth = w <= 4 ? 0.5 * w : 2 + (w - 4);
        const mrph = sstep(4, WMAX, w);
        for (let j = 0; j < NT; j++) {
          const t = j / NT * TAU, h = heartXY(t);
          let x = h[0] * HEART_W * sc * ridge, y = h[1] * HEART_W * sc * ridge;
          const ang = atan2(y, x); x = mix(x, cos(ang) * (HB_RW + 0.3), mrph); y = mix(y, sin(ang) * (HB_RW + 0.3), mrph);
          m.v(heart[0] + FR[3] * x + FR[6] * y - FR[0] * depth, heart[1] + FR[4] * x + FR[7] * y - FR[1] * depth, heart[2] + FR[5] * x + FR[8] * y - FR[2] * depth, clamp(w / WMAX, 0, 1) * 2 - 1);
        }
      }
      for (let i = 0; i < WS; i++) for (let j = 0; j < NT; j++) { const j2 = (j + 1) % NT; m.quad(i * NT + j, i * NT + j2, (i + 1) * NT + j2, (i + 1) * NT + j); }
      const b = m.build(); b.inst = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 5, 0, 0, 0]); meshes.push(b);
    }

    // ---- hero camera (section 6) and its unprojection, used to place the source's landmarks
    const hs = sH - HEART_DIST, hp = rail.at(hs, [0, 0, 0]);
    const hero = [hp[0], hp[1] + HEART_CAM_DY, hp[2], HEART_YAW, HEART_PITCH, HEART_FOV];
    const tH = Math.tan(HEART_FOV / 2), asp = 1456 / 816;
    const cy0 = cos(HEART_YAW), sy0 = sin(HEART_YAW), cp0 = cos(HEART_PITCH), sp0 = sin(HEART_PITCH);
    const HF = [sy0 * cp0, sp0, cy0 * cp0], HRt = [cy0, 0, -sy0], HU = [-sp0 * sy0, cp0, -sp0 * cy0];
    const unproj = (px, py, d) => { const nx = px / 728 - 1, ny = 1 - py / 408, a = nx * tH * asp * d, b = ny * tH * d; return [hero[0] + HF[0] * d + HRt[0] * a + HU[0] * b, hero[1] + HF[1] * d + HRt[1] * a + HU[1] * b, hero[2] + HF[2] * d + HRt[2] * a + HU[2] * b]; };
    const pxR = (rpx, d) => rpx / 408 * tH * d; // a radius in source pixels → metres at depth d

    // ---- HG-R red cells: lumpy, slightly oblate spheroids (HG-RX)
    const cellMesh = (seed, sub) => { rseed(seed); const o = [rr(0, 40), rr(0, 40), rr(0, 40)]; return icosphere(sub, (x, y, z) => { const r = 1 + 0.10 * (fbm(x * 1.6 + o[0], y * 1.6 + o[1], z * 1.6 + o[2], 3) - 0.5) * 2; return [x * r, y * r * 0.84, z * r]; }).build(); };
    const heroCells = cellMesh(501, 3), hci = [];
    rseed(502);
    const heroCell = (px, py, rpx, d) => { const p = unproj(px, py, d), q = qRand(); hci.push(p[0], p[1], p[2], pxR(rpx, d), q[0], q[1], q[2], q[3], 2, rnd(), 0, 1); }; // p3 = 1: hero cells catch a little more light (HG-R1..R3 are lit crimson)
    heroCell(55, 370, 140, 4.6);    // HG-R1 huge left
    heroCell(150, 830, 270, 4.2);   // HG-R2 giant lower left
    heroCell(1230, 760, 145, 5.0);  // HG-R3 giant lower right
    heroCell(1440, 800, 100, 5.5);  // HG-R3 at the F4 edge
    heroCell(1228, 155, 72, 9);     // HG-R4 E1
    heroCell(1445, 80, 75, 8);      // HG-R4 F1
    for (const [px, py, r, d] of [[185, 225, 52, 10], [430, 125, 38, 12], [410, 230, 30, 13], [330, 330, 30, 12], [258, 282, 27, 12], [295, 645, 78, 7], [1105, 595, 42, 11], [1405, 530, 50, 9], [100, 120, 70, 15]]) heroCell(px, py, r, d); // HG-R5, HG-R7
    heroCells.inst = new Float32Array(hci); meshes.push(heroCells);
    // flowing cells (HG-R6 swarm and the cells along the whole vessel): the game moves them; positions are rail coords
    const NFLOW = 1500, flow = { s: new Float32Array(NFLOW), u: new Float32Array(NFLOW), v: new Float32Array(NFLOW), r: new Float32Array(NFLOW), meshes: [], slot: new Uint16Array(NFLOW), var: new Uint8Array(NFLOW) };
    const fm = [cellMesh(511, 2), cellMesh(512, 2), cellMesh(513, 2)], fcount = [0, 0, 0];
    rseed(514);
    for (let i = 0; i < NFLOW; i++) {
      const r = clamp(0.12 * Math.pow(1 / max(rnd(), 0.04), 0.5), 0.1, 0.9), rmin = r < 0.3 ? 1.4 : 4.0, rad = rmin + Math.pow(rnd(), 0.6) * (8.6 - r - rmin), a = rr(0, TAU);
      // denser toward the heart (HG-R6): a quarter of the cells live in the finale straight
      flow.s[i] = i < NFLOW / 4 ? rr(sH - 150, sH - 6) : rr(0, sH - 6); flow.u[i] = cos(a) * rad; flow.v[i] = sin(a) * rad; flow.r[i] = r;
      const vv = i % 3; flow.var[i] = vv; flow.slot[i] = fcount[vv]++;
    }
    rseed(515);
    for (let v = 0; v < 3; v++) { fm[v].inst = new Float32Array(fcount[v] * 12); meshes.push(fm[v]); flow.meshes.push(fm[v]); }
    for (let i = 0; i < NFLOW; i++) { const I = fm[flow.var[i]].inst, o = flow.slot[i] * 12, q = qRand(); I[o + 3] = flow.r[i]; I[o + 4] = q[0]; I[o + 5] = q[1]; I[o + 6] = q[2]; I[o + 7] = q[3]; I[o + 8] = 2; I[o + 9] = rnd(); I[o + 10] = 0.04 + flow.r[i] * 0.05; }
    const placeFlow = (t) => { // positions at time t (flow speed 2.2 m/s down the vessel toward the heart); wraps
      for (let i = 0; i < NFLOW; i++) {
        let s = flow.s[i] + t * 2.2; const lo = i < NFLOW / 4 ? sH - 150 : 0, span = sH - 6 - lo; s = lo + (((s - lo) % span) + span) % span;
        rail.at(s, T0); frame(s, FR); const u = flow.u[i], v = flow.v[i], I = fm[flow.var[i]].inst, o = flow.slot[i] * 12;
        I[o] = T0[0] + FR[3] * u + FR[6] * v; I[o + 1] = T0[1] + FR[4] * u + FR[7] * v; I[o + 2] = T0[2] + FR[5] * u + FR[8] * v;
      }
      for (const m of fm) m.dirty = true;
    };
    placeFlow(0);
    flow.place = placeFlow;
    // HG-R6 swarm hugging the ring plate: static instances that bob (the source crowds the rim with cells)
    {
      const sw = cellMesh(516, 2), I = [];
      rseed(517);
      for (let i = 0; i < 330; i++) {
        const inner = i >= 240, a = rr(0, TAU), st = inner ? sH - rr(1, 7) : sH - rr(0.6, 9), r = inner ? rr(0.05, 0.16) : clamp(0.09 * Math.pow(1 / max(rnd(), 0.05), 0.55), 0.07, 0.5);
        const rad = (inner ? rr(0.1, 0.8) : rr(0.9, 1.45)) * HEART_W * (0.75 + 0.25 * abs(sin(a))); tubeAt(st, a, min(rad, HB_RW - r), P); const q = qRand();
        I.push(P[0], P[1], P[2], r, q[0], q[1], q[2], q[3], 2, rnd(), 0.05, inner ? 3 : 0.5); // inner flecks read pink in the glow
      }
      sw.inst = new Float32Array(I); meshes.push(sw);
    }

    // ---- HG-M1 teal machinery: a column from the ceiling with two drums of cyan windows, hanging over the notch
    {
      const top = unproj(905, -260, 17), d1 = unproj(880, 55, 15.5), d2 = unproj(845, 150, 16.5);
      const ax = [d2[0] - top[0], d2[1] - top[1], d2[2] - top[2]], al = hypot(...ax); ax[0] /= al; ax[1] /= al; ax[2] /= al;
      const q = qFromY(ax[0], ax[1], ax[2]);
      const drum = new Mesh(); drum.tube([[0, -1.1, 0], [0, -0.95, 0], [0, 0.95, 0], [0, 1.1, 0]], (k) => [1.45, 1.7, 1.7, 1.45][k], 24, false);
      const db = drum.build(); db.inst = new Float32Array([d1[0], d1[1], d1[2], 1.2, ...q, 9, 0, 0, 0, d2[0], d2[1], d2[2], 0.95, ...q, 9, 0, 0, 0]); meshes.push(db);
      const col = new Mesh(); col.tube([[top[0], top[1], top[2]], [d2[0], d2[1], d2[2]]], 1.2, 16, true);
      const cb = col.build(); cb.inst = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 1, 0.3, 0, 0]); meshes.push(cb);
    }

    // ---- HG-K1 the ship, seen from behind against the opening: white round body, blue and cyan engine rings with a
    // pale core, four stubby blue fins, one white swept fin at the upper right
    const ship = [], shipPos = unproj(765, 372, 16);
    const part = (m, mat, rgb) => { const b = m.build(); b.shipPart = true; b.shipMat = mat; b.shipRGB = rgb; ship.push(b); };
    {
      const body = icosphere(2, (x, y, z) => [x * 0.6, y * 0.58, z * 0.72]); part(body, 3, [0.93, 0.92, 0.95]);
      const ring = (R, r, z) => { const m = new Mesh(), pts = []; for (let k = 0; k <= 32; k++) { const a = k / 32 * TAU; pts.push([cos(a) * R, sin(a) * R, z]); } m.tube(pts, r, 8, false); return m; };
      part(ring(0.46, 0.1, -0.62), 3, [0.08, 0.2, 0.42]);
      part(ring(0.3, 0.06, -0.68), 4, [0.2, 0.95, 1.15]);
      const disc = icosphere(1, (x, y, z) => [x * 0.36, y * 0.36, z * 0.05 - 0.64]); part(disc, 3, [0.05, 0.08, 0.16]);
      const core = icosphere(1, (x, y, z) => [x * 0.15, y * 0.15, z * 0.06 - 0.7]); part(core, 4, [0.85, 1.1, 0.95]);
      const fins = new Mesh(); for (const a of [0.4, 2.0, 3.6, 5.0]) { const c = cos(a), s = sin(a); fins.tube([[c * 0.45, s * 0.45, -0.2], [c * 0.85, s * 0.85, -0.42]], (k) => (k ? 0.13 : 0.1), 8, true); }
      part(fins, 3, [0.12, 0.5, 0.82]);
      const sail = new Mesh(); sail.sweep([[0.25, 0.45, 0.25], [0.55, 0.72, 0.0], [0.85, 0.9, -0.3]], (k) => [0.5, 0.35, 0.16][k], 0.08, () => [0.7, -0.7, 0], true); part(sail, 3, [0.92, 0.92, 0.95]);
    }
    const shipQ = qMul(qAxis(0, 1, 0, 0.5), qMul(qAxis(1, 0, 0, 0.25), qAxis(0, 0, 1, 0.5))), SHIP_S = 2.0;
    for (const b of ship) { b.inst = new Float32Array([shipPos[0], shipPos[1], shipPos[2], SHIP_S, ...shipQ, b.shipMat, ...b.shipRGB]); meshes.push(b); }

    // ---- points: flecks around the heart (HG-R6) and faint drifting motes along the vessel
    const pts = [];
    rseed(520);
    for (let i = 0; i < 260; i++) { const a = rr(0, TAU), rad = Math.pow(rnd(), 0.6) * 11, s = rr(sH - 40, sH - 2); tubeAt(s, a, rad, P); pts.push(P[0], P[1], P[2], rr(0.03, 0.09), 1.4, 0.45, 0.5, 1); }
    for (let i = 0; i < 500; i++) { const a = rr(0, TAU), rad = rr(1, 9), s = rr(0, sH - 10); tubeAt(s, a, rad, P); pts.push(P[0], P[1], P[2], rr(0.02, 0.05), 0.9, 0.35, 0.4, 1); }

    return { meshes, points: new Float32Array(pts), rail, frame, len, sH, sHero: hs, hero, chunks, flow, ship: { meshes: ship, pos: shipPos, q: shipQ, scale: SHIP_S },
      poses: [hero, [0, 0, 0, 0, 0, 1.1], [heart[0], heart[1] - 2, heart[2] - 60, 0, 0, 1.1]] };
  },
};
