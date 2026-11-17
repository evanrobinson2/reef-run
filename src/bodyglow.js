// ============================================================================
// Scene: Body Defenders, Glow Run. Reconstructs BD-2.2 (see experiments/space-garden/concept/body/glow/DECOMPOSITION.md).
// IDs in comments (BG-xx) refer to that record. The look is a smooth CG render (section 1): an HDR glow medium down the
// vessel, fresnel-lit translucent viruses, dark wet tissue with cool rims on the fold ridges, no banding or ink.
// The scene owns the rail (SCENE.rail) because the vessel is a field along it; the game reads it in prepare().
// ============================================================================
const BG_FOV = 60 * PI / 180; // section 6 (I)
// hero camera (section 6), in the rail frame at s = s: camera offset (u right, v up), ship offset and lead, look offsets
const BG_HERO = { s: 20, camU: -1.4, camV: 0.85, shipU: 1.2, shipV: -1.0, shipAhead: 6.5, yaw: 0.163, pitch: -0.098, fov: BG_FOV, shipVX: -7, shipVY: 1 };
const BG_R0 = 11; // vessel radius (I: from the landmark viruses sitting inside the lumen at the frame corners)
// the rail: straight for the opening view (so the glow sits at the vanishing point), then gentle bends; the last stretch
// widens into the finale chamber that opens into the light
const BG_CTRL = [[0, 0, -20], [0, 0, 0], [0, 0, 60], [0, 0, 140], [6, 3, 230], [28, 8, 320], [52, 4, 410], [60, -10, 500], [45, -22, 590],
  [15, -24, 680], [-15, -14, 770], [-35, 0, 860], [-38, 12, 950], [-25, 18, 1040], [-5, 12, 1130], [10, 4, 1220], [16, 0, 1310], [16, 0, 1400], [16, 0, 1490]];
let BG_RAIL = null;
const bgRail = () => BG_RAIL || (BG_RAIL = makeRail(BG_CTRL, 0.5));
// smooth rail frame at s (symmetric 6 m chord): forward 0..2, right 3..5 (horizontal), up 6..8 (forward × right, as the engine)
const BG_T1 = [0, 0, 0], BG_T2 = [0, 0, 0];
const bgFrame = (s, o) => {
  const R = bgRail(), T1 = BG_T1, T2 = BG_T2; R.at(min(s + 3, R.len), T1); R.at(max(s - 3, 0), T2);
  let fx = T1[0] - T2[0], fy = T1[1] - T2[1], fz = T1[2] - T2[2]; const l = hypot(fx, fy, fz) || 1; fx /= l; fy /= l; fz /= l;
  let rx = fz, rz = -fx; const rl = hypot(rx, rz) || 1; rx /= rl; rz /= rl;
  o[0] = fx; o[1] = fy; o[2] = fz; o[3] = rx; o[4] = 0; o[5] = rz; o[6] = fy * rz; o[7] = fz * rx - fx * rz; o[8] = -fy * rx; return o;
};
// vessel radius along the rail: constant, widening into the finale chamber over the last 160 m
const bgR0 = (s) => { const L = bgRail().len; return BG_R0 + 4.5 * sstep(L - 170, L - 70, s); };
// BG-W1..W5 vessel field in rail-frame coordinates: > 0 in tissue (section 5)
const bgFold = (x) => { const c = 0.5 + 0.5 * cos(x); return c * c * c; };
function bgDensity(s, u, v) {
  const r = hypot(u, v), th = atan2(v, u), R0 = bgR0(s);
  // helical folds (7 per turn) whose phase twists along s: the counter-clockwise swirl into the glow (BG-W1); minor folds
  const tw = s * 0.11 + 1.2 * (fbm(s * 0.012, 3.1, 0.7, 2) - 0.5);
  let R = R0 * (1 - 0.17 * bgFold(th * 7 + tw) - 0.04 * bgFold(th * 15 - s * 0.07));
  // low-frequency bulges (BG-W2..W4 large wall masses)
  R += R0 * 0.22 * (fbm(s * 0.018, cos(th) * 0.9 + 4, sin(th) * 0.9, 3) - 0.5);
  // membrane flaps and overhangs (BG-W3): 3D noise in the straightened frame
  const n = fbm(u * 0.11 + 7, v * 0.11, s * 0.06, 3) - 0.5;
  return r - R + n * 2.6;
}

const SCENE = {
  id: 'body-glow',
  sun: [0, 0, 0],
  p0: [0, 0, 1, 0],   // direction of the glow down the vessel (the game updates it every frame)
  p1: [0, 0, 0, 1],   // .w: ghost rail on/off (shell)
  get rail() { return bgRail(); },
  frame: bgFrame,
  hero: BG_HERO,
  R0: bgR0,
  density: bgDensity,
  wgsl: /*wgsl*/`
const DEEP = vec3f(0.22, 0.06, 0.11);    // the medium near the camera (cluster #461624 lifted)
const PINK = vec3f(0.94, 0.42, 0.60);    // BG-G1 halo (C2 mean #ef7ba4)
const CORE = vec3f(1.30, 1.00, 1.20);    // BG-G1 white-hot core (#fdd1f0, HDR so it blooms)
fn sky(rd: vec3f) -> vec3f {
  // the light beyond the vessel's open end (the finale)
  let o = sat(dot(rd, u.p0.xyz));
  return mix(PINK, CORE, pow(o, 4.0)) * 1.1;
}
fn fogApply(c: vec3f, wp: vec3f, d: f32) -> vec3f {
  // L1: a luminous medium. In-scatter is strongest along the vessel axis ahead (the halo, about 26° across: BG-G1) and
  // builds with distance; the white-hot core is a narrow cone around the axis
  let rd = (wp - u.cam.xyz) / max(d, 1e-3);
  let ax = sat(dot(rd, u.p0.xyz));
  let near = smoothstep(4.0, 70.0, d);
  let halo = pow(ax, 18.0) * near;
  var fc = mix(DEEP, PINK, sat(halo * 1.15 + 0.05 * near));
  fc = mix(fc, CORE, pow(ax, 260.0) * smoothstep(30.0, 120.0, d));
  let f = 1.0 - exp(-d * (0.016 + 0.06 * halo));
  return mix(c, fc, f);
}
// L1 light reaching a surface: strongest for surfaces that lie near the axis ahead (seen from the camera) and that
// face back up the vessel toward the camera, so the walls around the glow are flooded pink (BG-W1)
fn glowLight(wp: vec3f, n: vec3f) -> f32 {
  // O: the lit walls extend right of and below the core (C1, D2, D3) and the left wall stays dark (A2), so the light's
  // axis leans a little right and down of the glow core (I: the vessel bends that way beyond the core)
  let rd = normalize(wp - u.cam.xyz);
  let ax = sat(dot(rd, normalize(u.p0.xyz + u.right.xyz * 0.09 + u.up.xyz * 0.02)));
  // the lit funnel has a fairly sharp edge about 30° off the axis (O: D2 and D3 lit, E2 and F2 dark)
  return smoothstep(0.84, 0.975, ax) * 1.25 * (0.35 + 0.65 * sat(dot(n, -rd)));
}
fn shadeSolid(wp: vec3f, n: vec3f, aux: f32, prm: vec4f, lp: vec3f) -> vec3f {
  let v = normalize(u.cam.xyz - wp);
  let g = u.p0.xyz;
  let mat = prm.x;
  let fr = 1.0 - abs(dot(n, v));
  if (mat > 3.5) { return prm.yzw; } // emissive parts (engine nozzles)
  if (mat > 2.5) { // BG-K1 ship paint: dark gunmetal, lit from above, pink glow from ahead, cool rim (L2)
    var c = prm.yzw * (0.45 + 0.55 * sat(n.y * 0.5 + 0.5));
    c += vec3f(0.55, 0.18, 0.32) * sat(dot(n, g)) * 0.30;
    c += vec3f(0.30, 0.52, 0.72) * pow(fr, 4.0) * 0.35;
    return c;
  }
  if (mat > 0.5) { // BG-V virus: dark core, glowing silhouette and spike tips (L3), hit flash in prm.w
    let tip = sat(aux);
    var c = vec3f(0.22, 0.035, 0.085) * (0.6 + 0.6 * vn3(lp * 5.0 + vec3f(prm.y * 40.0)));
    c += vec3f(0.95, 0.20, 0.34) * (pow(fr, 3.2) * 1.25 + tip * tip * 0.85);
    c += vec3f(0.80, 0.24, 0.38) * glowLight(wp, n) * 0.9;
    c += vec3f(1.6, 0.9, 1.1) * prm.w;
    return c;
  }
  // BG-W tissue: maroon membrane with darker veins and fine striations; blue-violet where it turns away (BG-W2, W4);
  // flooded pink near the glow (L1); cool wet rim on the fold ridges (L2)
  let ridge = sat(-aux * 1.5);
  let m = fbm3(wp * vec3f(0.21), 3);
  let vein = smoothstep(0.05, 0.0, abs(vn3(wp * 0.45) - 0.5));
  let stri = vn3(wp * vec3f(1.7, 1.7, 0.35));
  var c = mix(vec3f(0.12, 0.04, 0.075), vec3f(0.30, 0.08, 0.14), m);
  c = mix(c, vec3f(0.16, 0.17, 0.25), sat(n.y * 1.1 + (fbm3(wp * 0.07 + vec3f(5.0), 2) - 0.45) * 2.0) * 0.9);
  c *= (1.0 - 0.35 * vein) * (0.85 + 0.3 * stri);
  let gl = glowLight(wp, n);
  c += vec3f(0.95, 0.36, 0.52) * gl * (0.55 + 0.6 * stri);
  c += vec3f(0.26, 0.38, 0.55) * pow(fr, 2.5) * (0.35 + 1.6 * ridge);
  return c;
}
fn pointMotion(p: vec3f, k: f32, t: f32) -> vec3f { let h = h31(floor(p * 3.0)); return vec3f(sin(t * 0.5 + h * 6.0), sin(t * 0.4 + h * 9.0), cos(t * 0.45 + h * 4.0)) * 0.25; }
`,
  post: /*wgsl*/`
fn grade(c0: vec3f, bl: vec3f, uv: vec2f, px: vec2i, d0: f32) -> vec3f {
  var c = c0 + bl * 0.6;
  // soft shoulder above 0.8, so the glow rolls off to pink-white instead of clipping flat
  let k = vec3f(0.8);
  c = select(c, k + 0.2 * (vec3f(1.0) - exp(-(c - k) / 0.2)), c > k);
  // BG-N: a mild vignette (the corners are the darkest areas)
  let q = (uv - 0.5) * vec2f(1.0, 0.85);
  c *= 1.0 - 0.38 * smoothstep(0.08, 0.32, dot(q, q));
  return clamp(c, vec3f(0.0), vec3f(1.0));
}
`,
  build() {
    const R = bgRail(), L = R.len, FR = new Float64Array(9), T = [0, 0, 0];
    // ---- BG-W vessel: the field on a straightened (u, v, s) grid -> surface nets -> mapped through the rail frame
    const GV = 0.75, HU = 20.25, NU = Math.round(2 * HU / GV) + 1, S0 = 2, NS = Math.ceil((L - S0) / GV) + 1;
    const D = new Float32Array(NU * NU * NS);
    for (let k = 0; k < NS; k++) {
      const s = S0 + k * GV, R0 = bgR0(s);
      for (let j = 0; j < NU; j++) for (let i = 0; i < NU; i++) {
        const u = -HU + i * GV, v = -HU + j * GV, r = hypot(u, v);
        // skip the noise well away from the wall (the field there can't change sign)
        D[i + NU * (j + NU * k)] = r < R0 * 0.55 ? r - R0 * 0.75 : bgDensity(s, u, v);
      }
    }
    // closed behind the start; open into the light at the far end (the finale)
    for (let j = 0; j < NU * NU; j++) { D[j] = 1; D[j + NU * NU * (NS - 1)] = -1; D[j + NU * NU * (NS - 2)] = -1; }
    const sn = surfaceNets(D, NU, NU, NS), smp = sampler3(D, NU, NU, NS);
    // per-slice frames, interpolated for fractional s
    const FS = new Float64Array(NS * 12);
    for (let k = 0; k < NS; k++) { const s = S0 + k * GV; bgFrame(s, FR); R.at(s, T); FS.set([T[0], T[1], T[2], FR[0], FR[1], FR[2], FR[3], FR[4], FR[5], FR[6], FR[7], FR[8]], k * 12); }
    const nv = sn.nv, vb = new ArrayBuffer(nv * 16), vf = new Float32Array(vb), vs = new Int8Array(vb);
    for (let q = 0; q < nv; q++) {
      const gi = sn.pos[q * 3], gj = sn.pos[q * 3 + 1], gk = sn.pos[q * 3 + 2];
      const u = -HU + gi * GV, v = -HU + gj * GV, k0 = min(floor(gk), NS - 2), t = gk - k0, a = k0 * 12, b = a + 12;
      const F = (c) => FS[a + c] + (FS[b + c] - FS[a + c]) * t;
      const fx = F(3), fy = F(4), fz = F(5), rx = F(6), ry = F(7), rz = F(8), ux = F(9), uy = F(10), uz = F(11);
      vf[q * 4] = F(0) + rx * u + ux * v; vf[q * 4 + 1] = F(1) + ry * u + uy * v; vf[q * 4 + 2] = F(2) + rz * u + uz * v;
      // normal: minus the field gradient (tissue -> lumen), taken to world space through the frame
      const e = 0.8, gu = smp(gi + e, gj, gk) - smp(gi - e, gj, gk), gv = smp(gi, gj + e, gk) - smp(gi, gj - e, gk), gs = smp(gi, gj, gk + e) - smp(gi, gj, gk - e);
      let nx = -(gs * fx + gu * rx + gv * ux), ny = -(gs * fy + gu * ry + gv * uy), nz = -(gs * fz + gu * rz + gv * uz); const nl = hypot(nx, ny, nz) || 1;
      // aux: convexity from the field's Laplacian (negative on fold ridges that stand into the lumen)
      const h = 2, lap = smp(gi + h, gj, gk) + smp(gi - h, gj, gk) + smp(gi, gj + h, gk) + smp(gi, gj - h, gk) + smp(gi, gj, gk + h) + smp(gi, gj, gk - h) - 6 * smp(gi, gj, gk);
      vs[q * 16 + 12] = round(nx / nl * 127); vs[q * 16 + 13] = round(ny / nl * 127); vs[q * 16 + 14] = round(nz / nl * 127); vs[q * 16 + 15] = round(clamp(lap * 0.35, -1, 1) * 127);
    }
    const wall = { vb, ib: new Uint32Array(sn.idx), nv, inst: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0]) };
    // lumen test for placement: rail-frame coordinates of a world point near rail position sGuess
    const local = (x, y, z, s0, s1, o) => {
      let best = 1e18, bs = s0; const p = [0, 0, 0];
      for (let s = s0; s <= s1; s += 1) { R.at(s, p); const d = (x - p[0]) ** 2 + (y - p[1]) ** 2 + (z - p[2]) ** 2; if (d < best) { best = d; bs = s; } }
      for (let s = bs - 1; s <= bs + 1; s += 0.1) { R.at(s, p); const d = (x - p[0]) ** 2 + (y - p[1]) ** 2 + (z - p[2]) ** 2; if (d < best) { best = d; o[0] = s; } }
      R.at(o[0], p); bgFrame(o[0], FR); const dx = x - p[0], dy = y - p[1], dz = z - p[2];
      o[1] = dx * FR[3] + dy * FR[4] + dz * FR[5]; o[2] = dx * FR[6] + dy * FR[7] + dz * FR[8]; return o;
    };

    // ---- BG-V virus family V(n, len, ...): icosphere core + lathe spikes with analytic normals; aux 0 at the core -> 1 at the tips
    const virusMesh = (sub, nSpikes, len, prof, sides, seed) => {
      rseed(seed);
      const P = [], N = [], A = [], I = [];
      const core = icosphere(sub, (x, y, z) => { const r = 1 + 0.05 * (vnoise(x * 3 + seed, y * 3, z * 3) - 0.5); return [x * r, y * r, z * r]; });
      for (let k = 0; k < core.p.length / 3; k++) { const x = core.p[k * 3], y = core.p[k * 3 + 1], z = core.p[k * 3 + 2], l = hypot(x, y, z); P.push(x, y, z); N.push(x / l, y / l, z / l); A.push(0); }
      I.push(...core.i);
      const ga = PI * (3 - sqrt(5));
      for (let k = 0; k < nSpikes; k++) {
        const yy = 1 - 2 * (k + 0.5) / nSpikes, rr0 = sqrt(1 - yy * yy), a = k * ga + rr(-0.2, 0.2);
        let dx = cos(a) * rr0 + rr(-0.08, 0.08), dy = yy + rr(-0.08, 0.08), dz = sin(a) * rr0 + rr(-0.08, 0.08); const dl = hypot(dx, dy, dz); dx /= dl; dy /= dl; dz /= dl;
        // a perpendicular basis
        let ex = dy * 0 - dz * 1, ey = dz * 0 - dx * 0, ez = dx * 1 - dy * 0; if (hypot(ex, ey, ez) < 0.2) { ex = 0; ey = dz; ez = -dy; }
        const el = hypot(ex, ey, ez); ex /= el; ey /= el; ez /= el;
        const fx = dy * ez - dz * ey, fy = dz * ex - dx * ez, fz = dx * ey - dy * ex;
        const ln = len * rr(0.8, 1.2), base = P.length / 3, pr = prof(ln);
        for (let j = 0; j < pr.length; j++) {
          const [h, w] = pr[j], hp = pr[max(j - 1, 0)], hn = pr[min(j + 1, pr.length - 1)];
          const dh = hn[0] - hp[0], dw = hn[1] - hp[1];
          for (let si = 0; si < sides; si++) {
            const an = si / sides * TAU, c = cos(an), sn2 = sin(an);
            const rx = ex * c + fx * sn2, ry = ey * c + fy * sn2, rz = ez * c + fz * sn2;
            P.push(dx * h + rx * w, dy * h + ry * w, dz * h + rz * w);
            let nx = rx * dh - dx * dw, ny = ry * dh - dy * dw, nz = rz * dh - dz * dw; const nl = hypot(nx, ny, nz) || 1; N.push(nx / nl, ny / nl, nz / nl);
            A.push(clamp((h - 1) / ln, 0, 1));
          }
        }
        for (let j = 0; j < pr.length - 1; j++) for (let si = 0; si < sides; si++) {
          const s2 = (si + 1) % sides, a0 = base + j * sides + si, b0 = base + j * sides + s2, c0 = base + (j + 1) * sides + s2, d0 = base + (j + 1) * sides + si;
          I.push(a0, b0, c0, a0, c0, d0);
        }
      }
      const n = P.length / 3, vb = new ArrayBuffer(n * 16), f = new Float32Array(vb), s8 = new Int8Array(vb);
      for (let k = 0; k < n; k++) { f[k * 4] = P[k * 3]; f[k * 4 + 1] = P[k * 3 + 1]; f[k * 4 + 2] = P[k * 3 + 2]; s8[k * 16 + 12] = round(N[k * 3] * 127); s8[k * 16 + 13] = round(N[k * 3 + 1] * 127); s8[k * 16 + 14] = round(N[k * 3 + 2] * 127); s8[k * 16 + 15] = round(A[k] * 127); }
      return { vb, ib: new Uint32Array(I), nv: n };
    };
    // variant A (crown, BG-V / zoom-virus-B1): thin club-headed spikes
    const crown = (ln) => [[0.93, 0.05], [1.0, 0.035], [1 + ln * 0.7, 0.03], [1 + ln * 0.82, 0.065], [1 + ln * 0.96, 0.06], [1 + ln + 0.03, 0.0]];
    const VA = virusMesh(2, 96, 0.36, crown, 5, 11);
    // variant C: the same crown at low detail, for the far swarm
    const VC = virusMesh(1, 54, 0.40, (ln) => [[0.93, 0.06], [1 + ln * 0.75, 0.04], [1 + ln * 0.9, 0.075], [1 + ln + 0.04, 0.0]], 4, 12);
    // variant B (giant, BG-V01): thick hollow finger stalks with flared cup tips
    const VB = virusMesh(3, 80, 0.72, (ln) => [[0.9, 0.1], [1.0, 0.07], [1 + ln * 0.55, 0.058], [1 + ln * 0.85, 0.07], [1 + ln, 0.095], [1 + ln - 0.02, 0.07], [1 + ln - 0.07, 0.0]], 10, 13);

    // ---- hero camera basis (section 6): the same maths as the game's camera at the opening pose
    const H = BG_HERO, cam = [0, 0, 0];
    bgFrame(H.s, FR); R.at(H.s, T);
    for (let c = 0; c < 3; c++) cam[c] = T[c] + FR[3 + c] * H.camU + FR[6 + c] * H.camV;
    let lx = FR[0] + FR[3] * Math.tan(H.yaw) + FR[6] * Math.tan(H.pitch), ly = FR[1] + FR[4] * Math.tan(H.yaw) + FR[7] * Math.tan(H.pitch), lz = FR[2] + FR[5] * Math.tan(H.yaw) + FR[8] * Math.tan(H.pitch);
    const ll = hypot(lx, ly, lz); lx /= ll; ly /= ll; lz /= ll;
    const yaw = atan2(lx, lz), pit = Math.asin(ly), cy = cos(yaw), sy = sin(yaw), cp = cos(pit), sp = sin(pit);
    const hf = [sy * cp, sp, cy * cp], hr = [cy, 0, -sy], hu = [-sp * sy, cp, -sp * cy];
    const tH = Math.tan(H.fov / 2), asp = 1456 / 816;
    // back-project a source pixel at depth z (along the camera's forward axis)
    const unproject = (px, py, z) => { const nx = px / 728 - 1, ny = 1 - py / 408; return [0, 1, 2].map((c) => cam[c] + (hf[c] + hr[c] * nx * tH * asp + hu[c] * ny * tH) * z); };
    const LC = [0, 0, 0];
    const inside = (p, r) => { local(p[0], p[1], p[2], 0, 400, LC); return hypot(LC[1], LC[2]) < bgR0(LC[0]) * 0.86 - r * 1.1; };

    // ---- viruses. Instances: x y z r q(4) mat=1 seed bob flash. Lists keep their placements for the game.
    const viruses = []; // { x, y, z, r, v: 'A'|'B'|'C', id, s }
    const place = (id, px, py, rad, rw, variant) => {
      let z = rw * 728 / (rad * tH * asp), p = unproject(px, py, z);
      for (let it = 0; it < 30 && !inside(p, rw); it++) { z *= 0.93; rw *= 0.93; p = unproject(px, py, z); } // keep the screen position, come nearer
      local(p[0], p[1], p[2], 0, 400, LC);
      viruses.push({ x: p[0], y: p[1], z: p[2], r: rw, v: variant, id, s: LC[0] });
    };
    // BG-V01..V33 landmarks (landmarks.json: id, px, py, outer radius px). The outer radius includes the spikes (1 + len).
    const LM = [['V01', 190, 700, 290], ['V02', 62, 78, 82], ['V03', 112, 165, 48], ['V04', 302, 105, 58], ['V05', 237, 360, 62], ['V06', 300, 335, 42], ['V07', 430, 560, 48],
      ['V08', 532, 640, 52], ['V09', 527, 758, 40], ['V10', 763, 790, 52], ['V11', 1100, 180, 72], ['V12', 1385, 140, 92], ['V13', 1215, 38, 32], ['V14', 1065, 15, 22],
      ['V15', 1270, 460, 38], ['V16', 1270, 605, 38], ['V17', 1165, 540, 27], ['V18', 1060, 480, 20], ['V19', 985, 500, 16], ['V20', 1210, 140, 24], ['V21', 1130, 262, 22],
      ['V22', 1170, 262, 22], ['V23', 726, 82, 48], ['V24', 700, 8, 38], ['V25', 508, 48, 28], ['V26', 378, 295, 30], ['V27', 668, 470, 28], ['V28', 540, 505, 25],
      ['V29', 493, 240, 25], ['V30', 1005, 295, 18], ['V31', 966, 205, 25], ['V32', 1140, 425, 18], ['V33', 460, 38, 25]];
    for (const [id, px, py, rad] of LM) {
      if (id === 'V01') { place(id, px, py, rad / 1.78, 2.2, 'B'); continue; } // giant: body radius = outer / (1 + 0.62 + tip)
      const rw = rad >= 45 ? 0.95 : rad >= 25 ? 0.8 : 0.65;
      place(id, px, py, rad / 1.42, rw, rad >= 25 ? 'A' : 'C');
    }
    // BG-VS swarm: per-cell counts (section 3) at random pixels in each cell, small apparent sizes, far depths
    const CNT = { B1: 6, C1: 15, D1: 25, E1: 6, F1: 3, A2: 1, B2: 12, C2: 20, D2: 25, E2: 10, B3: 5, C3: 20, D3: 8, E3: 5, F3: 2, C4: 2, D4: 1 };
    rseed(21);
    for (const cell in CNT) {
      const c = 'ABCDEF'.indexOf(cell[0]), r = +cell[1] - 1;
      for (let k = 0; k < CNT[cell]; k++) {
        const px = rr(c * 242.7 + 10, (c + 1) * 242.7 - 10), py = rr(r * 204 + 10, (r + 1) * 204 - 10);
        // keep the ship (BG-K1) and the glow core (BG-G1, washed out in the source) clear
        if (px > 790 && px < 980 && py > 470 && py < 600) { k--; continue; }
        if (hypot(px - 614, py - 337) < 75) { k--; continue; } // the white core is washed clear (O)
        const rad = rr(7, 20) / 1.4;
        place('S-' + cell, px, py, rad, rr(0.45, 0.75), 'C');
      }
    }
    // the swarm continues down the vessel (game targets): clusters every ~38 m plus single wall-huggers (P)
    rseed(33);
    const p = [0, 0, 0];
    const nHero = viruses.length;
    for (let s = 110; s < L - 90; s += rr(30, 46)) {
      const n = (rnd() * 7 | 0) + 5, a0 = rr(0, TAU), d0 = rr(1.5, 6), cs = s + rr(-4, 4);
      for (let k = 0; k < n; k++) {
        const st = cs + rr(-7, 7); R.at(st, p); bgFrame(st, FR);
        const a = a0 + rr(-0.9, 0.9), d = clamp(d0 + rr(-2.2, 2.2), 0, 7.5), u = cos(a) * d, v = sin(a) * d;
        const big = rnd() < 0.12, rw = big ? rr(1.1, 1.5) : rr(0.4, 0.85);
        const x = p[0] + FR[3] * u + FR[6] * v, y = p[1] + FR[4] * u + FR[7] * v, z = p[2] + FR[5] * u + FR[8] * v;
        let ok = true; for (let i = nHero; ok && i < viruses.length; i++) { const q = viruses[i]; if (hypot(x - q.x, y - q.y, z - q.z) < rw + q.r + 0.6) ok = false; }
        if (ok) viruses.push({ x, y, z, r: rw, v: rw >= 0.85 ? 'A' : 'C', id: 'G', s: st });
      }
    }
    // finale: the mother virus at the centre of the chamber (variant B)
    { const st = L - 55; R.at(st, p); viruses.push({ x: p[0], y: p[1], z: p[2], r: 3.6, v: 'B', id: 'MOTHER', s: st }); }
    rseed(44);
    const meshes = [wall];
    const vmesh = { A: VA, B: VB, C: VC };
    for (const key of ['A', 'B', 'C']) {
      const list = viruses.filter((q) => q.v === key), inst = new Float32Array(list.length * 12);
      list.forEach((q, i) => { const k = qRand(); q.slot = i; inst.set([q.x, q.y, q.z, q.r, k[0], k[1], k[2], k[3], 1, rnd(), q.r < 1.5 ? 0.1 : 0, 0], i * 12); });
      meshes.push(Object.assign(vmesh[key], { inst, variant: key }));
    }

    // ---- BG-K1 ship: +z nose, +y up. Built from tubes, flattened; normals oriented away from each part's axis
    const shipParts = [];
    const HULL = [0.09, 0.07, 0.11], PANEL = [0.16, 0.14, 0.2], TRIM = [0.45, 1.1, 1.4];
    const part = (m, rgb, mat, cx, cy, sxy) => { const b = m.build((x, y, z, nx, ny, nz) => { const ox = (x - cx) / sxy[0], oy = (y - cy) / sxy[1]; return nx * ox + ny * oy < 0 ? [-nx, -ny, -nz] : [nx, ny, nz]; }); shipParts.push([b, rgb, mat]); };
    const squash = (m, cx, cy, sx, sy) => { for (let k = 0; k < m.p.length; k += 3) { m.p[k] = cx + (m.p[k] - cx) * sx; m.p[k + 1] = cy + (m.p[k + 1] - cy) * sy; } return m; };
    const SL = 3.0;
    { const m = new Mesh(); m.tube(Array.from({ length: 13 }, (_, i) => [0, 0, -SL / 2 + SL * i / 12]), (k) => 0.42 * Math.pow(Math.sin(PI * clamp(0.5 + k / 12 * 0.5, 0, 1)) * 0.85 + 0.15, 0.7) * (k < 2 ? 0.92 : 1), 12, true); part(squash(m, 0, 0, 1, 0.42), HULL, 3, 0, 0, [1, 0.42]); }
    { const m = new Mesh(); m.tube(Array.from({ length: 8 }, (_, i) => [0, 0.14, -1.1 + 1.6 * i / 7]), (k) => 0.2 * Math.sqrt(Math.sin(PI * clamp(0.1 + k / 7 * 0.85, 0, 1))), 10, true); part(squash(m, 0, 0.14, 1, 0.55), PANEL, 3, 0, 0.14, [1, 0.55]); }
    for (const sx of [-1, 1]) {
      const m = new Mesh(); m.tube(Array.from({ length: 7 }, (_, i) => [sx * 0.52, -0.06, -1.55 + 1.65 * i / 6]), (k) => 0.17 * (k === 6 ? 0.4 : k === 5 ? 0.8 : 1), 9, true); part(m, HULL, 3, sx * 0.52, -0.06, [1, 1]);
      const w = new Mesh(); w.sweep([[sx * 0.15, -0.05, -0.9], [sx * 0.5, -0.07, -1.05]], 0.9, 0.05, null, true); part(w, PANEL, 3, sx * 0.3, -0.06, [1, 1]);
      const f = new Mesh(); f.sweep([[sx * 0.52, 0.1, -1.35], [sx * 0.62, 0.32, -1.55]], 0.32, 0.04, null, true); part(f, PANEL, 3, sx * 0.55, 0.2, [1, 1]);
      for (const ny of [-0.1, 0.02]) { const e = new Mesh(); e.tube([[sx * 0.52, ny, -1.6], [sx * 0.52, ny, -1.52]], 0.07, 8, true); part(e, TRIM, 4, sx * 0.52, ny, [1, 1]); }
    }
    for (const sx of [-1, 1]) { const tr = new Mesh(); tr.sweep([[sx * 0.2, 0.1, 0.4], [sx * 0.08, 0.06, 1.2]], 0.03, 0.02, null, true); part(tr, TRIM, 4, 0, 0, [1, 1]); }
    for (const [b, rgb, mat] of shipParts) { b.shipPart = true; b.inst = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, mat, rgb[0], rgb[1], rgb[2]]); meshes.push(b); }
    // engine nozzle positions in ship space (four, two pairs: BG-K1) for the game's glows and trails (BG-T1)
    const engines = [[-0.52, -0.1, -1.62], [-0.52, 0.02, -1.62], [0.52, -0.1, -1.62], [0.52, 0.02, -1.62]];

    // ---- points: BG-M1 motes through the lumen (red, a few violet), drifting (kind 1)
    const pts = [];
    rseed(55);
    for (let i = 0; i < 4200; i++) {
      const st = i < 900 ? rr(H.s, H.s + 70) : rr(0, L), a = rr(0, TAU), d = Math.sqrt(rnd()) * bgR0(st) * 0.85; R.at(st, p); bgFrame(st, FR);
      const u = cos(a) * d, v = sin(a) * d, vio = rnd() < 0.08, b = rr(0.6, 1.6);
      pts.push(p[0] + FR[3] * u + FR[6] * v, p[1] + FR[4] * u + FR[7] * v, p[2] + FR[5] * u + FR[8] * v, rr(0.02, 0.05), vio ? 0.45 * b : 1.6 * b, vio ? 0.25 * b : 0.18 * b, vio ? 1.1 * b : 0.32 * b, 1);
    }
    // the glow direction for the static view: from the hero camera down the vessel
    R.at(H.s + 180, T); { const dx = T[0] - cam[0], dy = T[1] - cam[1], dz = T[2] - cam[2], l = hypot(dx, dy, dz); SCENE.p0[0] = dx / l; SCENE.p0[1] = dy / l; SCENE.p0[2] = dz / l; }
    return { meshes, points: new Float32Array(pts), viruses, engines, heroCam: { pos: cam, yaw, pitch: pit },
      poses: [[cam[0], cam[1], cam[2], yaw, pit, H.fov], [0, 0, 60, 0, 0, 1.1], [52, 4, 410, 0.4, 0, 1.1]] };
  },
};
