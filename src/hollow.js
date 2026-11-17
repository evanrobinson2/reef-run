// ============================================================================
// Scene: Hollow Asteroid. Reconstructs SPC-3.2 (see experiments/space-garden/concept/hollow-asteroid/DECOMPOSITION.md).
// IDs in comments (HA-xx) refer to that record. The look is flat cel painting (section 1): toon bands, flat patches,
// ink edges, no photographic effects.
// ============================================================================
const H_FOV = 60 * PI / 180;
// key light: warm coral from the front-left, low, behind the camera (section 4)
// I: the warm key is a cone light just behind and left of the camera, aimed into the chamber: it lights the column's
// left face (D3), the A3 sponge and the floor ridge, while the right foreground walls fall outside the cone and stay purple
const H_LP = [-3.0, 2.5, 3.0];
const H_AIM = (() => { const d = [0.4, -2.8, 11], l = hypot(...d); return [d[0] / l, d[1] / l, d[2] / l, 0]; })(); // cone axis (I)
// cave grid
const GX = 128, GY = 80, GZ = 176, GV = 0.5, G0 = [-32, -18, -24];

// cavity distance (negative inside the open cave); the grammar of section 5
const sdCapsule = (px, py, pz, ax, ay, az, bx, by, bz, r) => {
  const pax = px - ax, pay = py - ay, paz = pz - az, bax = bx - ax, bay = by - ay, baz = bz - az;
  const h = clamp((pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz), 0, 1);
  return hypot(pax - bax * h, pay - bay * h, paz - baz * h) - r;
};
const smin = (a, b, k) => { const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1); return mix(b, a, h) - k * h * (1 - h); };
const ellip = (px, py, pz, cx, cy, cz, rx, ry, rz) => { const x = (px - cx) / rx, y = (py - cy) / ry, z = (pz - cz) / rz; return (hypot(x, y, z) - 1) * min(rx, ry, rz); };
function caveDensity(x, y, z) {
  // open spaces: the tunnel behind the camera, the main chamber, the exit to the bright void (HA-C3), the side hole (HA-C4)
  let c = sdCapsule(x, y, z, 0, 0.5, -24, 0, 0.5, 6, 5.2);
  c = smin(c, ellip(x, y, z, -3, 1.5, 17, 8.5, 8, 12), 3.5);
  c = smin(c, sdCapsule(x, y, z, -4.0, 5.0, 22, -7.5, 8.5, 90, 7.8), 3);
  c = smin(c, sdCapsule(x, y, z, -5, -0.5, 21, -15, -1.5, 60, 2.3), 2);      // HA-C4 second opening
  // the right rock mass (HA-C5, HA-C7): solid beyond x ~ 3.6 once past the tunnel; its left face is the column
  c = max(c, (x - 2.0 - max(12 - z, 0) * 0.55) * 0.8);
  c = smin(c, sdCapsule(x, y, z, 3.0, 4, 23, 9, 7, 80, 2.4), 1.5);           // sliver right of the column (C2/D2)
  // the arch across the top (HA-C2)
  const arch = sdCapsule(x, y, z, -12, 6.8, 19.5, 4.5, 10.5, 21, 1.9);
  c = max(c, -arch);
  // floor ridge (HA-C8) and left wall bulge (HA-C6); dark foreground boulder at the lower left (A4)
  c = max(c, -sdCapsule(x, y, z, -6.5, -4.6, 3.2, -3.4, -5.2, 5.5, 2.3));
  c = max(c, -sdCapsule(x, y, z, -9, -6.5, 4, 2, -4.6, 12, 2.4));
  // rock surface: lumpy, plus directional strokes running down-left (HA-C7)
  const n = fbm(x * 0.13, y * 0.13, z * 0.13, 4) - 0.5;
  const st = vnoise((x + y) * 0.9, (y - x) * 0.25, z * 0.9) - 0.5;
  return c + n * 3.2 + st * 0.35;
}

const SCENE = {
  id: 'hollow-asteroid',
  sun: H_LP, // for this scene the 'sun' uniform carries the key light's position
  meshLight: { point: true, key: [0.85, 0.8, 0.72], ambUp: [0.26, 0.25, 0.27], ambDown: [0.18, 0.16, 0.2], wrap: 0.3, rim: [0.14, 0.2, 0.27], rimPow: 1.5, rimBack: 0 }, // textured GLB meshes (engine.js): a point key light and the flat painted ambient
  p1: H_AIM,
  p0: (() => { const d = [-0.12, 0.13, 1], l = hypot(...d); return [d[0] / l, d[1] / l, d[2] / l, 0]; })(), // direction of the opening
  wgsl: /*wgsl*/`
const OPEN = vec3f(0.55, 0.80, 0.88);     // HA-C3 bright cyan (#83bcd2 measured, brighter in the core)
const HAZE = vec3f(0.17, 0.19, 0.36);     // distant rock blue (#405783)
fn sky(rd: vec3f) -> vec3f {
  // the bright void seen through the openings: glowing cyan, brightest toward the exit
  let o = sat(dot(rd, u.p0.xyz));
  let n = fbm3(rd * 4.0, 3);
  return mix(vec3f(0.40, 0.62, 0.75), vec3f(0.72, 0.92, 0.97), pow(o, 6.0)) * (0.92 + 0.12 * n);
}
fn fogApply(c: vec3f, wp: vec3f, d: f32) -> vec3f {
  let rd = (wp - u.cam.xyz) / max(d, 1e-3);
  let o = pow(sat(dot(rd, u.p0.xyz)), 3.0);
  // distance to blue haze, stronger toward the opening; quantised so it stays flat like paint
  let f = 1.0 - exp(-max(d - 9.0, 0.0) * 0.035);
  return mix(c, mix(HAZE, OPEN * 0.85, o), f * (0.4 + 0.6 * o));
}
fn band3(x: f32) -> f32 { return floor(sat(x) * 3.0 + 0.5) / 3.0; }
// toon ramp: measured shadow-to-lit colours (section 4)
fn ramp(t: f32) -> vec3f {
  let a = vec3f(0.060, 0.035, 0.150); let b = vec3f(0.165, 0.095, 0.270); let c = vec3f(0.235, 0.190, 0.360);
  let d = vec3f(0.545, 0.300, 0.400); let e = vec3f(0.900, 0.440, 0.400); let f = vec3f(0.950, 0.600, 0.480);
  if (t < 0.2) { return a; } if (t < 0.4) { return b; } if (t < 0.55) { return c; } if (t < 0.7) { return d; } if (t < 0.88) { return e; } return f;
}
fn voro(p: vec3f) -> vec3f { // (F1, F2, id of the nearest cell)
  let i = floor(p); var b1 = 9.0; var b2 = 9.0; var id = 0.0;
  for (var z = -1; z <= 1; z++) { for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
    let g = i + vec3f(f32(x), f32(y), f32(z)); let o = vec3f(h31(g), h31(g + 11.3), h31(g + 27.1));
    let d = length(g + o - p); if (d < b1) { b2 = b1; b1 = d; id = h31(g + 5.7); } else if (d < b2) { b2 = d; }
  } } }
  return vec3f(b1, b2, id);
}
fn shadeSolid(wp: vec3f, n: vec3f, aux: f32, prm: vec4f, lp: vec3f) -> vec3f {
  let k = normalize(u.sun.xyz - wp); let v = normalize(u.cam.xyz - wp);
  let mat = prm.x;
  if (mat > 2.5) { // ship paint: colour in prm.yzw, two flat light bands and a cool rim
    let ls = dot(n, k) * 0.5 + 0.5;
    return prm.yzw * select(0.58, 1.0, ls > 0.42) + vec3f(0.15, 0.25, 0.35) * step(0.6, sat(dot(n, u.p0.xyz)));
  }
  // flat painted patches: object-space cells that shift the light a little (HA-C7 brush patches)
  let cell = voro(wp * vec3f(0.9, 0.35, 0.9) + vec3f(prm.y * 9.0)).z;
  // baked visibility of the key light: per vertex for the cave (aux), per instance for sponges (prm.w)
  let vis = select(sat(aux * 0.5 + 0.5), prm.w, mat > 0.5);
  // the cone's upper edge is cut (O: the ceiling and the upper column stay dark in the source)
  let spot = smoothstep(0.66, 0.88, dot(-k, u.p1.xyz)) * smoothstep(0.12, -0.1, -k.y);
  var l = 0.24 + 0.76 * sat(dot(n, k) * 1.3) * vis * spot;
  l = l * 0.86 + (cell - 0.5) * 0.14;
  // cool rim from the opening (section 4: back light)
  let rim = sat(dot(n, u.p0.xyz)) * pow(1.0 - sat(dot(n, v)), 1.5);
  var c = ramp(l);
  if (mat > 0.5 && mat < 1.5) { // HA-S1..S6 sponges: coral body with dark cavities
    let vv = voro(lp * 5.2 + vec3f(prm.y * 31.0));
    let hole = smoothstep(0.38, 0.30, vv.x);
    let body = select(select(vec3f(0.23, 0.05, 0.21), vec3f(0.42, 0.13, 0.30), l > 0.28), select(vec3f(0.70, 0.18, 0.33), vec3f(0.92, 0.45, 0.40), l > 0.75), l > 0.5);
    c = mix(body, vec3f(0.13, 0.04, 0.16) + body * 0.15, hole);
  }
  c += vec3f(0.30, 0.45, 0.60) * band3(rim) * 0.45;
  return c;
}
fn pointMotion(p: vec3f, k: f32, t: f32) -> vec3f { let h = h31(floor(p * 3.0)); return vec3f(sin(t * 0.6 + h * 6.0), sin(t * 0.5 + h * 9.0), 0.0) * 0.15; }
`,
  post: /*wgsl*/`
fn grade(c0: vec3f, bl: vec3f, uv: vec2f, px: vec2i, d0: f32) -> vec3f {
  var c = c0 + bl * 0.25;
  // ink edges from depth discontinuities (section 5: partial outlines)
  let i0 = 1.0 / max(d0, 1e-6);
  let rel = (abs(1.0 / max(depthAt(px + vec2i(1, 0)), 1e-6) - i0) + abs(1.0 / max(depthAt(px + vec2i(0, 1)), 1e-6) - i0)) / i0;
  let edge = smoothstep(0.05, 0.12, rel) * select(1.0, 0.0, d0 == 0.0);
  c = mix(c, vec3f(0.08, 0.035, 0.12), edge * 0.85);
  c = clamp(c, vec3f(0.0), vec3f(1.0));
  return c; // colours are authored in display (sRGB) values measured from the source
}
`,
  build() {
    // ---- the cave: density grid -> surface nets (like Abyssal's seabed), with per-vertex occlusion
    const D = new Float32Array(GX * GY * GZ);
    for (let z = 0; z < GZ; z++) for (let y = 0; y < GY; y++) for (let x = 0; x < GX; x++) D[x + GX * (y + GY * z)] = caveDensity(G0[0] + x * GV, G0[1] + y * GV, G0[2] + z * GV);
    // the far end of the grid is open space (beyond the asteroid shell, HA-C3)
    for (let z = GZ - 3; z < GZ; z++) for (let y = 0; y < GY; y++) for (let x = 0; x < GX; x++) D[x + GX * (y + GY * z)] = -1;
    const sn = surfaceNets(D, GX, GY, GZ), smp = sampler3(D, GX, GY, GZ);
    const DwB = (x, y, z) => smp((x - G0[0]) / GV, (y - G0[1]) / GV, (z - G0[2]) / GV);
    // baked key-light visibility: march toward the light through the cave field (soft over the last metres)
    const keyVis = (x, y, z) => { const dx = H_LP[0] - x, dy = H_LP[1] - y, dz = H_LP[2] - z, L = hypot(dx, dy, dz); let v = 1; for (let t = 0.75; t < L - 0.5; t += 0.6) { const d = DwB(x + dx / L * t, y + dy / L * t, z + dz / L * t); if (d > 0) { v = min(v, clamp(1 - d * 1.2, 0, 1)); if (v <= 0) return 0; } } return v; };
    const m = new Mesh();
    for (let k = 0; k < sn.nv; k++) {
      const x = sn.pos[k * 3], y = sn.pos[k * 3 + 1], z = sn.pos[k * 3 + 2];
      // occlusion: how much rock surrounds the point (sampled a few metres out along the normal)
      const e = 0.7, nx = smp(x - e, y, z) - smp(x + e, y, z), ny = smp(x, y - e, z) - smp(x, y + e, z), nz = smp(x, y, z - e) - smp(x, y, z + e), l = hypot(nx, ny, nz) || 1;
      m.v(G0[0] + x * GV, G0[1] + y * GV, G0[2] + z * GV, keyVis(G0[0] + x * GV + nx / l * 0.6, G0[1] + y * GV + ny / l * 0.6, G0[2] + z * GV + nz / l * 0.6) * 2 - 1);
    }
    for (let i = 0; i < sn.ni; i++) m.i.push(sn.idx[i]);
    const ter = m.build((x, y, z) => { const gx = (x - G0[0]) / GV, gy = (y - G0[1]) / GV, gz = (z - G0[2]) / GV, e = 0.7; return [smp(gx - e, gy, gz) - smp(gx + e, gy, gz), smp(gx, gy - e, gz) - smp(gx, gy + e, gz), smp(gx, gy, gz - e) - smp(gx, gy, gz + e)]; });
    ter.inst = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0.3, 0, 0]);

    // ---- sponge family S(r): an icosphere; holes are drawn in the shader (section 5)
    const sp = icosphere(3, (x, y, z) => { const r = 1 + 0.06 * (vnoise(x * 3, y * 3, z * 3) - 0.5); return [x * r, y * r, z * r]; }).build();
    const spInst = [];
    const sponge = (x, y, z, r, seed, lit) => { const dx = H_LP[0] - x, dy = H_LP[1] - y, dz = H_LP[2] - z, L = hypot(dx, dy, dz); spInst.push(x, y, z, r, 0, 0, 0, 1, 1, seed, 0, lit ?? keyVis(x + dx / L * r * 1.05, y + dy / L * r * 1.05, z + dz / L * r * 1.05)); };
    // hero sponges placed from the source (positions in the hero camera's frame are checked in the comparison)
    sponge(-8.8, 1.2, 10, 2.0, 0.11, 1);    // HA-S1 large left
    sponge(1.6, 7.9, 13.5, 1.7, 0.23, 1);    // HA-S2 top right of centre
    sponge(5.2, -1.0, 6.0, 2.6, 0.37, 0);    // HA-S3 huge right edge, in shadow
    sponge(-3.3, -2.6, 9.2, 1.45, 0.41, 1);  // HA-S4 floor, left of the ship
    sponge(-0.5, -4.6, 7.4, 1.5, 0.53, 1);   // HA-S4 floor, below
    // HA-S5 small sponges on the walls: snap to the cave surface near the tunnel
    rseed(5);
    const Dw = (x, y, z) => smp((x - G0[0]) / GV, (y - G0[1]) / GV, (z - G0[2]) / GV);
    let made = 0;
    for (let tries = 0; made < 90 && tries < 6000; tries++) {
      const k = (rnd() * sn.nv) | 0, gx = sn.pos[k * 3], gy = sn.pos[k * 3 + 1], gz = sn.pos[k * 3 + 2];
      const x = G0[0] + gx * GV, y = G0[1] + gy * GV, z = G0[2] + gz * GV;
      if (z < -10 || z > 45 || abs(x) > 16) continue;
      const e = 0.6, nx = Dw(x - e, y, z) - Dw(x + e, y, z), ny = Dw(x, y - e, z) - Dw(x, y + e, z), nz = Dw(x, y, z - e) - Dw(x, y, z + e), l = hypot(nx, ny, nz) || 1;
      const r = clamp(0.16 * Math.pow(1 / max(rnd(), 0.05), 0.5), 0.16, 0.8);
      sponge(x + nx / l * r * 0.55, y + ny / l * r * 0.55, z + nz / l * r * 0.55, r, rnd()); made++;
    }
    // a few sponges and boulders far out in the bright void, for its silhouettes (HA-C3)

    // ---- the ship (HA-K1): capsule fuselage, swept wings, orange engine ring with two nozzles, antennae
    const ship = new Mesh(), shipPaint = [];
    const part = (mesh, rgb) => shipPaint.push([mesh, rgb]);
    const WHITE = [0.93, 0.92, 0.90], ORANGE = [0.97, 0.56, 0.16], DARK = [0.10, 0.07, 0.14];
    const L = 2.4, R = 0.5;
    const body = new Mesh(); body.tube(Array.from({ length: 13 }, (_, i) => [0, 0, -L / 2 + L * i / 12]), (k) => R * Math.sqrt(Math.sin(Math.PI * clamp(0.08 + k / 12 * 0.95, 0, 1))) * (k > 9 ? 0.95 : 1), 14, true);
    part(body, WHITE);
    const ring = new Mesh(); ring.tube([[0, 0, -L / 2 - 0.02], [0, 0, -L / 2 + 0.35]], R * 1.02, 16, false); part(ring, ORANGE);
    for (const sx of [-0.2, 0.2]) { const nz = new Mesh(); nz.tube([[sx, 0, -L / 2 - 0.05], [sx, 0, -L / 2 + 0.2]], 0.15, 12, true); part(nz, DARK); }
    const nose = new Mesh(); nose.tube([[0, 0, L / 2 - 0.25], [0, 0, L / 2 + 0.1]], (k) => (k ? 0.12 : 0.32), 12, true); part(nose, ORANGE);
    for (const s of [-1, 1]) {
      const w = new Mesh(); w.sweep([[s * 0.4, -0.05, 0.2], [s * 1.05, -0.1, -0.3], [s * 1.8, -0.18, -0.8]], (k) => [1.0, 0.7, 0.38][k], 0.08, null, true); part(w, WHITE);
      const tip = new Mesh(); tip.sweep([[s * 1.5, -0.17, -0.7], [s * 1.85, -0.19, -0.9]], 0.34, 0.09, null, true); part(tip, ORANGE);
      const ant = new Mesh(); ant.tube([[s * 0.3, 0.3, -0.7], [s * 0.75, 0.75, -1.4]], 0.025, 5, true); part(ant, WHITE);
      const at = new Mesh(); at.tube([[s * 0.72, 0.72, -1.35], [s * 0.82, 0.82, -1.5]], 0.05, 6, true); part(at, ORANGE);
    }
    // ship pose: in the tunnel, heading into the chamber toward the opening, banked a little (HA-K1)
    const SHIP = [-0.5, -0.4, 12.5], shipQ = qMul(qAxis(0, 1, 0, 0.55), qMul(qAxis(1, 0, 0, -0.12), qAxis(0, 0, 1, -0.18)));
    const meshes = [ter, Object.assign(sp, { inst: new Float32Array(spInst) })];
    for (const [pm, rgb] of shipPaint) { const b = pm.build(); b.shipPart = true; b.inst = new Float32Array([SHIP[0], SHIP[1], SHIP[2], 1, shipQ[0], shipQ[1], shipQ[2], shipQ[3], 3, rgb[0], rgb[1], rgb[2]]); meshes.push(b); }

    // ---- HA-L1 cyan light orbs and a little dust
    const pts = [];
    pts.push(-0.6, -2.2, 12.5, 0.1, 0.5, 0.95, 1.0, 0, -3.3, 2.6, 17, 0.09, 0.5, 0.95, 1.0, 0);
    for (let i = 0; i < 300; i++) pts.push(rr(-8, 8), rr(-4, 8), rr(-6, 34), rr(0.02, 0.05), 0.4, 0.7, 0.9, 1);

    // ---- collision against the cave field (push out along the gradient)
    const CR = 0.7;
    const collide = (F) => {
      for (let it = 0; it < 2; it++) {
        const d = Dw(F[0], F[1], F[2]) + CR * 1.5; if (d <= 0) return;
        const e = 0.4, gx = Dw(F[0] + e, F[1], F[2]) - Dw(F[0] - e, F[1], F[2]), gy = Dw(F[0], F[1] + e, F[2]) - Dw(F[0], F[1] - e, F[2]), gz = Dw(F[0], F[1], F[2] + e) - Dw(F[0], F[1], F[2] - e), l = sqrt(gx * gx + gy * gy + gz * gz);
        if (l < 1e-4) return; F[0] -= gx / l * d * 0.5; F[1] -= gy / l * d * 0.5; F[2] -= gz / l * d * 0.5;
      }
    };
    return { meshes, points: new Float32Array(pts), collide, field: Dw, ship: { pos: SHIP, q: shipQ }, poses: [[0, 0.6, 0, -0.02, 0.0, H_FOV], [0, 1, -18, 0, 0.05, 1.1], [-1, 5, 30, 0.1, 0.1, 1.1]] };
  },
};
