// ============================================================================
// Scene: Nebula Reef. Reconstructs SPC-1.3 (see experiments/space-garden/concept/nebula-reef/DECOMPOSITION.md).
// IDs in comments (NR-xx) refer to that record.
// ============================================================================
const HERO_FOV = 70 * PI / 180, HERO_PITCH = 0.42; // section 5: looking up ~24°, vertical FOV ~70°
// star direction: the flare centre sits at about (0.85, 0.10) of the frame from the hero camera (NR-S1)
const SUN = (() => {
  const t = Math.tan(HERO_FOV / 2), a = 1456 / 816, nx = 0.98, ny = 1.12, cp = cos(HERO_PITCH), sp = sin(HERO_PITCH);
  const d = [nx * t * a, sp + ny * t * cp, cp - ny * t * sp], l = hypot(...d); return d.map((v) => v / l);
})();

const SCENE = {
  id: 'nebula-reef',
  sun: SUN,
  p0: (() => { const t = Math.tan(HERO_FOV / 2), a = 1456 / 816, nx = 0.08, ny = -0.3, cp = cos(HERO_PITCH), sp = sin(HERO_PITCH); const d = [nx * t * a, sp + ny * t * cp, cp - ny * t * sp], l = hypot(...d); return [d[0] / l, d[1] / l, d[2] / l, 0]; })(), // NR-S2 brightest haze (C3-D3)
  wgsl: /*wgsl*/`
const FOGC = vec3f(0.058, 0.195, 0.19);   // NR-S2 mid haze (#367371 measured, slightly darker before tone map)
const AMBER = vec3f(1.00, 0.52, 0.20);     // NR-S1 flare (#e3b172 core)
const SUNC = vec3f(2.0, 1.45, 0.85);       // warm key light
fn phase(mu: f32) -> f32 { return 0.25 + 0.75 * pow(sat(mu), 6.0) + 2.0 * pow(sat(mu), 40.0); }
fn sky(rd: vec3f) -> vec3f {
  let s = u.sun.xyz; let mu = dot(rd, s);
  // nebula body: teal, darker and bluer away from the star (NR-S2: A1 #1a5557 vs C3 #338175)
  let n = fbm3(rd * 2.4 + vec3f(0.0, 0.0, u.cam.w * 0.004), 5);
  let n2 = fbm3(rd * 6.0 + vec3f(3.1, 1.7, 0.4), 4);
  var c = mix(vec3f(0.012, 0.07, 0.08), vec3f(0.055, 0.21, 0.20), smoothstep(0.25, 0.8, n * 0.75 + n2 * 0.25));
  c *= 0.6 + 0.45 * sat(mu * 0.5 + 0.55);
  // star glow and radial filaments (NR-S1): streaks around the star axis
  // filaments: flame-like streaks flowing from the star toward the haze (E1-F1 → D2), stretched along that axis
  let ax = normalize(u.p0.xyz - s * dot(u.p0.xyz, s)); let pr = normalize(cross(s, ax));
  let fx = dot(rd, pr); let fy = dot(rd, ax);
  let fil = fbm3(vec3f(fx * 16.0 + fy * 3.0, fy * 1.6 - u.cam.w * 0.02, 0.5), 5);
  let band = exp(-fx * fx / 0.035) * smoothstep(-0.25, 0.15, fy) * smoothstep(0.75, 0.2, fy);
  let glow = pow(sat(mu), 5.0);
  c += vec3f(1.0, 0.34, 0.05) * (glow * 0.16 + pow(sat(mu), 30.0) * 0.24);
  c += vec3f(1.0, 0.36, 0.06) * (0.2 + smoothstep(0.42, 0.9, fil) * 2.2) * band * pow(sat(mu * 1.3 - 0.1), 2.0) * 0.7;
  
  c += vec3f(0.07, 0.33, 0.28) * pow(sat(dot(rd, u.p0.xyz)), 9.0); // luminous teal haze behind the swarm (C3-D3)
  c *= mix(1.0, 0.72, smoothstep(0.55, 0.92, rd.y) * (1.0 - pow(sat(mu), 4.0))); // the upper sky is darker (A1, C1, D1)
  // smoky warm cloud bank between the swarm and the star (NR-S3)
  let cl = smoothstep(0.52, 0.72, fbm3(rd * 3.2 + vec3f(7.0, 2.0, 1.0), 5));
  c = mix(c, vec3f(0.035, 0.07, 0.07) + AMBER * glow * 0.3, cl * 0.9 * sat(mu * 2.2 + 0.1));
  // sparse blue-white specks (NR-S4)
  let g = rd * 380.0; let cell = floor(g); let h = h31(cell);
  if (h > 0.9975) { let f = fract(g) - 0.5; c += vec3f(0.55, 0.8, 1.0) * (1.5 * sat(1.0 - length(f) * 3.0)) * fract(h * 97.0); }
  return c;
}
fn fogApply(c: vec3f, wp: vec3f, d: f32) -> vec3f {
  let rd = (wp - u.cam.xyz) / max(d, 1e-3); let mu = dot(rd, u.sun.xyz);
  let ext = exp(-max(d - 6.0, 0.0) * vec3f(0.0150, 0.0100, 0.0095)); // warm light dies first (Abyssal-style per-channel extinction)
  let ins = FOGC * (0.85 + 0.3 * sat(mu)) + vec3f(1.0, 0.42, 0.12) * pow(sat(mu), 4.0) * 0.24;
  return c * ext + ins * (1.0 - ext);
}
fn shadeSolid(wp: vec3f, n: vec3f, aux: f32, prm: vec4f, lp: vec3f) -> vec3f {
  let s = u.sun.xyz; let v = normalize(u.cam.xyz - wp);
  let tex = fbm3(lp * 7.0 + vec3f(prm.y * 40.0), 4); let tex2 = vn3(lp * 31.0 + prm.y * 13.0);
  var alb = mix(vec3f(0.26, 0.17, 0.10), vec3f(0.55, 0.40, 0.24), tex) * (0.8 + 0.4 * tex2);
  // crumbly plates: bumped shading normal from object-space noise
  let bq = lp * 9.0 + vec3f(prm.y * 17.0);
  let nb = normalize(n + (vec3f(vn3(bq), vn3(bq + 5.2), vn3(bq + 9.7)) - 0.5) * 0.35 + (vec3f(vn3(bq * 3.1), vn3(bq * 3.1 + 2.0), vn3(bq * 3.1 + 7.0)) - 0.5) * 0.25); // NR-R1 tan/brown
  let cav = sat(aux * 0.5 + 0.5);                       // crevices are darker
  let nl = dot(nb, s);
  var dif = sat(nl) * smoothstep(0.05, 0.55, nl) * 1.4;
  // mat 1: rocks the source shows in shadow with only the upper rim catching the star (NR-R1, R3, R5)
  if (prm.x > 0.5) { dif *= smoothstep(0.4, 0.05, dot(nb, v)) * smoothstep(0.0, 0.5, nb.y) * 1.2; }
  let amb = mix(vec3f(0.006, 0.030, 0.028), vec3f(0.035, 0.13, 0.125), sat(nb.y * 0.5 + 0.5));   // teal nebula fill, darker below
  let rim = pow(1.0 - sat(dot(n, v)), 3.0) * sat(dot(-v, s) + 0.35) * 1.4;   // NR-R3 back-lit edges
  var c = alb * (SUNC * dif + amb * 2.0) * mix(0.3, 1.0, cav) + AMBER * rim * 0.3 * cav;
  return c;
}
fn pointMotion(p: vec3f, k: f32, t: f32) -> vec3f {
  let h = h31(floor(p * 7.0));
  if (k > 2.5) { // NR-S5 cyan streaks: fast, down-left along the flare filaments
    let dir = -normalize(u.sun.xyz + vec3f(0.0, 0.25, 0.0));
    return dir * (fract(t * 0.18 + h) * 60.0 - 30.0);
  }
  return vec3f(sin(t * 0.21 + h * 6.28), sin(t * 0.17 + h * 9.1), cos(t * 0.19 + h * 3.3)) * 0.6;
}
`,
  post: /*wgsl*/`
fn aces(x: vec3f) -> vec3f { return sat3((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14)); }
fn sat3(x: vec3f) -> vec3f { return clamp(x, vec3f(0.0), vec3f(1.0)); }
fn grade(c0: vec3f, bl: vec3f, uv: vec2f, px: vec2i, d0: f32) -> vec3f {
  var c = c0 + bl * 0.3;
  // star shafts: radial blur toward the star of the sky that is not covered by rocks
  let s = u.sun.xyz; let sz = dot(s, u.fwd.xyz);
  if (sz > 0.05) {
    let sp = vec2f(dot(s, u.right.xyz) / sz / (u.fwd.w * u.right.w), dot(s, u.up.xyz) / sz / u.fwd.w);
    let suv = vec2f(sp.x * 0.5 + 0.5, 0.5 - sp.y * 0.5);
    var acc = vec3f(0.0); var w = 1.0;
    for (var i = 0; i < 28; i++) {
      let p = mix(uv, suv, f32(i) / 28.0 * 0.92);
      let pp = vec2i(p * u.res.xy);
      if (depthAt(pp) == 0.0) { acc += max(hdrAt(p) - vec3f(0.45), vec3f(0.0)) * w; }
      w *= 0.94;
    }
    c += acc * 0.004 * AMBER;
  }
  c = aces(c * 0.62);
  let vg = 1.0 - 0.18 * dot(uv - 0.5, uv - 0.5) * 2.0;
  return pow(c * vg, vec3f(1.0 / 2.2));
}
`,
  build() {
    const t = Math.tan(HERO_FOV / 2), asp = 1456 / 816, cp = cos(HERO_PITCH), sp = sin(HERO_PITCH);
    // world position seen at frame point (x, y) of the hero camera, d metres along the view axis
    const at = (x, y, d) => { const nx = 2 * x - 1, ny = 1 - 2 * y; return [nx * t * asp * d, (sp + ny * t * cp) * d, (cp - ny * t * sp) * d]; };
    // ---- rock family R(flat, flake, elong): a noise-displaced icosphere with terraced plates (section 4)
    const rockMesh = (sub, seed, flat, flake, elong) => {
      rseed(seed); const o = [rr(0, 50), rr(0, 50), rr(0, 50)], steps = rr(7, 11);
      const m = icosphere(sub, (x, y, z) => {
        let r = 1 + 0.42 * (fbm(x * 1.1 + o[0], y * 1.1 + o[1], z * 1.1 + o[2], 3) - 0.5) * 2;
        r += 0.16 * (fbm(x * 4 + o[1], y * 4 + o[2], z * 4 + o[0], 3) - 0.5) + 0.07 * (fbm(x * 11 + o[2], y * 11, z * 11 + o[1], 2) - 0.5);
        let X = x * r * elong, Y = y * r * flat, Z = z * r;
        if (flake > 0) { const f = fbm(x * 2.6 + o[2], y * 2.6 + o[0], z * 2.6 + o[1], 3) * 5, k = floor(f) + sstep(0.8, 1, f - floor(f)); const s2 = 1 + flake * 0.07 * (k - 2.5); X *= s2; Y *= s2; Z *= s2; }
        return [X, Y, Z];
      });
      // aux: crevice factor from the radius relative to the local mean (1 = exposed, -1 = deep)
      for (let k = 0; k < m.p.length / 3; k++) { const X = m.p[k * 3], Y = m.p[k * 3 + 1] / flat, Z = m.p[k * 3 + 2] / elong; m.aux[k] = clamp((hypot(X, Y, Z) - 0.85) * 4, -1, 1); }
      const b = m.build(); b.m = m; return b;
    };
    const meshes = [], rocks = []; // rocks: [x,y,z,r] for collision
    const glints = [];
    const S = SUN;
    const place = (mesh, x, y, z, sc, q, seed, glintRate, mat = 0) => {
      mesh.inst.push(x, y, z, sc, q[0], q[1], q[2], q[3], mat, seed, 0, 0); rocks.push(x, y, z, sc * 1.05);
      // NR-G1 glints on lit, upward faces; 30% clumped
      const P = mesh.m.p, nv = P.length / 3, want = round(glintRate * sc * sc);
      const qx = q[0], qy = q[1], qz = q[2], qw = q[3];
      const rot = (vx, vy, vz) => { const tx = 2 * (qy * vz - qz * vy), ty = 2 * (qz * vx - qx * vz), tz = 2 * (qx * vy - qy * vx); return [vx + qw * tx + (qy * tz - qz * ty), vy + qw * ty + (qz * tx - qx * tz), vz + qw * tz + (qx * ty - qy * tx)]; };
      let made = 0, tries = 0;
      while (made < want && tries++ < want * 6) {
        const k = (rnd() * nv) | 0; const N = mesh.nrm; const n = rot(N[k * 3], N[k * 3 + 1], N[k * 3 + 2]);
        const lit = n[0] * S[0] + n[1] * S[1] + n[2] * S[2];
        if (lit < -0.9 + rnd() * 0.5) continue;
        const p = rot(P[k * 3] * sc, P[k * 3 + 1] * sc, P[k * 3 + 2] * sc);
        const clump = rnd() < 0.3 ? 3 + ((rnd() * 6) | 0) : 1;
        for (let c = 0; c < clump && made < want; c++, made++) {
          const j = 0.05 * sc * (c ? 1 : 0);
          const sz = rr(0.008, 0.02) * (1 + sc * 0.06), br = rr(5, 14) * (0.6 + 0.4 * sat(lit + 0.5));
          glints.push(x + p[0] + n[0] * 0.01 * sc + rr(-j, j), y + p[1] + n[1] * 0.01 * sc + rr(-j, j), z + p[2] + n[2] * 0.01 * sc + rr(-j, j), sz, 0.12 * br, 1.0 * br, 0.42 * br, 0);
        }
      }
    };
    const sat = (x) => clamp(x, 0, 1);
    const withNormals = (b) => { // per-vertex normals for glint placement
      const P = b.m.p, I = b.m.i, N = new Float32Array(P.length);
      for (let i = 0; i < I.length; i += 3) { const a = I[i] * 3, c = I[i + 1] * 3, d = I[i + 2] * 3; const ux = P[c] - P[a], uy = P[c + 1] - P[a + 1], uz = P[c + 2] - P[a + 2], vx = P[d] - P[a], vy = P[d + 1] - P[a + 1], vz = P[d + 2] - P[a + 2]; const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; for (const k of [a, c, d]) { N[k] += nx; N[k + 1] += ny; N[k + 2] += nz; } }
      for (let k = 0; k < N.length; k += 3) { const l = hypot(N[k], N[k + 1], N[k + 2]) || 1; N[k] /= l; N[k + 1] /= l; N[k + 2] /= l; }
      b.nrm = N; b.inst = []; return b;
    };
    // orientation helper: slab normal (local +y) turned to n, spun by a
    const orient = (n, a) => { const l = hypot(...n); return qMul(qFromY(n[0] / l, n[1] / l, n[2] / l), qAxis(0, 1, 0, a)); };

    // ---- hero rocks (section 2), each its own detailed mesh
    const hero = (seed, flat, flake, elong, fx, fy, d, sc, n, spin, gl, mat = 0) => {
      const b = withNormals(rockMesh(5, seed, flat, flake, elong)); meshes.push(b);
      const p = at(fx, fy, d); rseed(seed + 900); place(b, p[0], p[1], p[2], sc, orient(n, spin), rnd(), gl, mat);
    };
    hero(11, 1.0, 0.9, 1.3, 0.04, 0.84, 6.5, 3.3, [-0.5, 0.35, -0.8], 0.35, 45, 1); // NR-R1 lower-left hero rock
    hero(12, 0.40, 0.4, 2.1, 0.17, -0.02, 13, 2.0, [0.1, -0.6, -0.8], 2.2, 4);      // NR-R2 upper-left shard (seen from below)
    hero(13, 0.62, 0.5, 1.7, 0.86, 0.38, 22, 4.0, [0.25, 0.75, -0.6], 2.5, 22, 1);    // NR-R3 right slab against the flare
    hero(14, 0.80, 0.3, 1.1, 0.49, 0.66, 15, 1.35, [0.0, 0.3, -1], 0.3, 10);        // NR-R4 centre rock
    hero(15, 0.70, 0.5, 1.2, 0.78, 0.97, 7.5, 1.7, [-0.2, 0.7, -0.7], 1.2, 45, 1);    // NR-R5 lower-right rock
    hero(16, 0.45, 0.3, 2.0, 0.65, 0.65, 19, 1.3, [0.3, 0.5, -0.8], 0.9, 8);       // NR-R6 elongated mid rock
    hero(17, 0.75, 0.2, 1.0, 0.035, 0.39, 13, 1.1, [0, 1, -0.3], 0.2, 3);           // NR-R7 small near rocks
    hero(18, 0.70, 0.2, 1.3, 0.21, 0.32, 15, 0.7, [0, 1, -0.2], 1.3, 3);
    hero(19, 0.65, 0.1, 1.4, 0.60, 0.80, 80, 20, [0, 0.5, -1], 0.4, 0);             // NR-C4 distant giant mass in the haze

    // ---- swarm (NR-F1): six shared variants, power-law sizes, densest toward C2-D3 and along the view
    // each variant also gets a low-detail twin (icosphere sub 1, 80 triangles) for small or distant rocks: same seed, same shape
    const vars = [], varsLo = [];
    for (let v = 0; v < 6; v++) {
      const fl = rr(0.55, 0.95), el = rr(1, 1.6);
      const b = withNormals(rockMesh(3, 100 + v, fl, v % 2 ? 0.4 : 0, el)); meshes.push(b); vars.push(b);
      const lo = withNormals(rockMesh(1, 100 + v, fl, v % 2 ? 0.4 : 0, el)); meshes.push(lo); varsLo.push(lo);
    }
    const pick = (r, d) => (r / max(d, 1) < 0.02 ? varsLo : vars)[(rnd() * 6) | 0]; // under ~1.2° across: low detail
    rseed(7);
    const heroes = rocks.slice();
    const free = (x, y, z, r) => { for (let i = 0; i < heroes.length; i += 4) if (hypot(x - heroes[i], y - heroes[i + 1], z - heroes[i + 2]) < heroes[i + 3] * 1.1 + r) return false; return true; };
    const gauss = () => (rnd() + rnd() + rnd() - 1.5) * 1.15;
    let made = 0;
    for (let tries = 0; made < 1500 && tries < 20000; tries++) {
      const fx = 0.5 + gauss() * 0.3 + 0.02, fy = 0.5 + gauss() * 0.22, d = 22 * Math.pow(10, rnd() * 0.9);
      const r = clamp(0.08 * Math.pow(1 / max(rnd(), 0.02), 0.6), 0.08, 1.6) * (0.6 + d / 90);
      const p = at(fx, fy, d); if (!free(p[0], p[1], p[2], r)) continue;
      if (SCENE.corridor && SCENE.corridor(p[0], p[1], p[2], r)) continue; // a game's rail keeps its corridor clear
      place(pick(r, d), p[0], p[1], p[2], r, qRand(), rnd(), d < 40 ? 4 : 1.5); made++;
    }
    // a wider reef all around so you can fly anywhere (not visible from the hero camera)
    for (let i = 0; i < 2600; i++) {
      const a = rnd() * TAU, b = Math.acos(rr(-1, 1)), d = rr(25, 220);
      const x = d * sin(b) * cos(a), y = d * cos(b) * 0.6, z = d * sin(b) * sin(a);
      const p = at(0.5, 0.5, 1); if ((x * p[0] + y * p[1] + z * p[2]) / d > 0.55) continue; // keep the hero view as composed
      const r = clamp(0.2 * Math.pow(1 / max(rnd(), 0.02), 0.6), 0.2, 6);
      if (SCENE.corridor && SCENE.corridor(x, y, z, r)) continue;
      place(pick(r, d), x, y, z, r, qRand(), rnd(), 1.5);
    }
    // ---- motes and streaks (NR-S4, NR-S5)
    const pts = glints;
    for (let i = 0; i < 2500; i++) { const p = at(rnd(), rnd(), rr(4, 70)); const b = rr(0.6, 2.2); pts.push(p[0], p[1], p[2], rr(0.012, 0.03), 0.35 * b, 0.65 * b, 1.0 * b, 1); }
    for (let i = 0; i < 9; i++) { const p = at(rr(0.1, 0.5), rr(0.6, 1.0), rr(12, 30)); pts.push(p[0], p[1], p[2], rr(0.02, 0.04), 0.25, 0.9, 1.6, 3); }

    const RK = new Float32Array(rocks);
    const collide = (F) => { // push the camera out of rocks (bounding spheres)
      for (let i = 0; i < RK.length; i += 4) {
        const dx = F[0] - RK[i], dy = F[1] - RK[i + 1], dz = F[2] - RK[i + 2], r = RK[i + 3] * 0.8 + 0.6, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < r * r && d2 > 1e-6) { const d = sqrt(d2), k = (r - d) / d; F[0] += dx * k; F[1] += dy * k; F[2] += dz * k; }
      }
    };
    for (const m of meshes) m.inst = new Float32Array(m.inst);
    return {
      meshes, points: new Float32Array(pts), collide,
      poses: [[0, 0, 0, 0, HERO_PITCH, HERO_FOV], [-12, -6, -30, 0.25, 0.3, 1.1], [30, 26, 40, 0.6, 0.2, 1.1]],
    };
  },
};
