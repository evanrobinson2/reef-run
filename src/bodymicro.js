// ============================================================================
// Scene: Body Defenders, Micro Mission. Reconstructs BD-3.0 (microscope look); see
// experiments/space-garden/concept/body/micro/DECOMPOSITION.md. IDs in comments (MC-xx, RBC-n, WBC-n, CRM-n, SB, BOK, K1)
// refer to that record. The look is a soft photographic macro render: translucent pastel cells, a fibrous pink membrane
// fold, a teal-grey plasma haze and a very shallow depth of field (section 1).
//
// Depth of field: the engine's DOF pass (SCENE.dof / G.dof) is the default. The single-pass gather in the post pass
// below is kept as a FALLBACK, used only with ?dof=fallback (then the engine pass is switched off so blur is not doubled).
// ============================================================================
const MICRO_DOF_FALLBACK = typeof QS !== 'undefined' && QS.get('dof') === 'fallback';
const M_FOV = 40 * PI / 180;                      // section 6: mild telephoto, macro look (I)
const M_TANV = Math.tan(M_FOV / 2), M_ASP = 1456 / 816, M_TANH = M_TANV * M_ASP;
const M_FOCUS = 10.5;                              // section 6: RBC-1, WBC-1, CRM-1, K1 and the crest are sharp
// hero-frame helper: source pixel (px, py) at depth z -> world point (camera at the origin, yaw 0, pitch 0)
const mPix = (px, py, z) => [(px / 728 - 1) * M_TANH * z, (1 - py / 408) * M_TANV * z, z];
// world radius of something that projects to rpx pixels at depth z
const mRad = (rpx, z) => rpx / 408 * M_TANV * z;

// ---- MC-FOLD: the membrane fold (I: a ridge joined to the lower-left wall, crest at the focus depth, tilted ~28°)
// The crest silhouette passes source pixels (0,290) .. (440,400) .. (1000,816). The axis sits one radius below and behind it.
const FOLD_R = 3.3;
const FOLD = (() => {
  // the crest is convex in the image (it bends down more steeply to the right), so the fold is a chain of capsules whose
  // axis runs one radius below each crest point (in the image plane) at about the focus depth
  const zc = M_FOCUS + 0.8;
  const crest = [[-420, 160], [0, 290], [440, 400], [700, 470], [900, 560], [1060, 816], [1200, 1080]];
  const S = crest.map(([px, py]) => mPix(px, py, zc));
  const axis = S.map((p, i) => {
    const a = S[max(i - 1, 0)], b = S[min(i + 1, S.length - 1)], tx = b[0] - a[0], ty = b[1] - a[1], tl = hypot(tx, ty);
    const nx = -ty / tl, ny = tx / tl; // left normal of a left-to-right, downward line points up-right
    return [p[0] - nx * FOLD_R * 0.94, p[1] - ny * FOLD_R * 0.94, zc + (i === 0 ? 2.5 : i === S.length - 1 ? -1 : 0)];
  });
  const d = [axis[3][0] - axis[2][0], axis[3][1] - axis[2][1], 0], l = hypot(...d);
  return { axis, u: [d[0] / l, d[1] / l, 0] };
})();
// the vessel (P/I): a wide, wavy tube along +z; straight through the hero stretch so the source view is exact
const V_R = 14;
const vW = (z) => sstep(26, 60, z);
const vR = (z) => V_R + 4 * (1 - sstep(20, 55, z)); // wider at the start: the walls stay deep in the haze (MC-BG, E4-F4)
const vCx = (z) => -2 + 7 * sin(max(z - 26, 0) * 0.017) * vW(z);
const vCy = (z) => 4 + 4 * sin(max(z - 26, 0) * 0.023) * vW(z);
const V_LEN = 262;
// later folds, the same family as MC-FOLD (grammar section 5), across the run: [ax, ay, az, bx, by, bz, r]
const FOLDS2 = [
  [vCx(95) + 16, vCy(95) + 8, 92, vCx(95) + 4, vCy(95) - 16, 98, 3.0],      // from the upper right wall down to the floor
  [vCx(158) - 16, vCy(158) + 10, 160, vCx(158) - 2, vCy(158) + 16, 152, 2.6], // across the upper left
  [vCx(212) + 15, vCy(212) - 9, 210, vCx(212) - 4, vCy(212) - 16, 216, 3.2], // lower right
];
const sdCap = (px, py, pz, ax, ay, az, bx, by, bz, r) => {
  const pax = px - ax, pay = py - ay, paz = pz - az, bax = bx - ax, bay = by - ay, baz = bz - az;
  const h = clamp((pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz), 0, 1);
  return hypot(pax - bax * h, pay - bay * h, paz - baz * h) - r;
};
const smaxk = (a, b, k) => { const h = clamp(0.5 - 0.5 * (b - a) / k, 0, 1); return mix(b, a, h) + k * h * (1 - h); };
function vesselDensity(x, y, z) { // > 0 is wall (tissue), < 0 is the open lumen (plasma); metres
  let c = hypot(x - vCx(z), y - vCy(z)) - vR(z);
  c = max(c, -z - 14); // closed behind the start (out of view)
  let fd = 1e9; const A = FOLD.axis; for (let i = 0; i < A.length - 1; i++) fd = min(fd, sdCap(x, y, z, A[i][0], A[i][1], A[i][2], A[i + 1][0], A[i + 1][1], A[i + 1][2], FOLD_R));
  c = smaxk(c, -fd, 2.2);
  for (const f of FOLDS2) c = smaxk(c, -sdCap(x, y, z, f[0], f[1], f[2], f[3], f[4], f[5], f[6]), 2.0);
  // a soft lumpy wall (cells packed under the membrane)
  const n = vnoise(x * 0.22, y * 0.22, z * 0.22) - 0.5;
  return c + n * 1.6;
}
const VG0 = [-24, -16, -16], VGV = 0.7, VGX = 66, VGY = 58, VGZ = Math.ceil((V_LEN + 30) / VGV);

const SCENE = {
  id: 'body-micro',
  sun: [-0.45, 0.72, -0.53],                       // key light direction (section 4: soft, upper left, a little in front)
  p0: [...FOLD.u, 0],                              // fibre direction of the hero fold (MC-FIBRE)
  p1: [M_FOCUS, MICRO_DOF_FALLBACK ? 30 : 0, 0, 1], // x: focus (m), y: fallback DOF strength (px at 816 high), z: haze scale (0 = concept), w: ghost rail
  // the engine's DOF pass (when it lands) reads this; values from DECOMPOSITION.md section 6
  dof: MICRO_DOF_FALLBACK ? undefined : { focus: M_FOCUS, range: 1.6, near: 1.0, far: 0.4, maxBlur: 0.075, bokeh: 0.35 },
  wgsl: /*wgsl*/`
const AMB = vec3f(0.56, 0.62, 0.67);           // plasma ambient (MC-BG)
fn sky(rd: vec3f) -> vec3f {
  // MC-BG: cool teal-grey; lighter and a little pink toward the upper centre (D1-D2 #b6b4bc), darker low right (#738390)
  let t = sat(rd.y * 1.4 + 0.55);
  var c = mix(vec3f(0.50, 0.58, 0.63), vec3f(0.69, 0.75, 0.79), t);
  let g = pow(sat(dot(rd, normalize(vec3f(0.18, 0.32, 1.0)))), 6.0);
  c = mix(c, vec3f(0.76, 0.75, 0.78), g * 0.6);
  let lf = pow(sat(dot(rd, normalize(vec3f(-0.6, 0.0, 1.0)))), 4.0);
  c = mix(c, vec3f(0.50, 0.58, 0.62), lf * 0.4);
  // MC-RW: the right side of the frame is mauve (F1 #927a84, F3 #74596e), darker low right
  c = mix(c, vec3f(0.52, 0.42, 0.50) - vec3f(0.06) * sat(-rd.y * 2.0), smoothstep(0.15, 0.55, rd.x) * 0.75);
  return c;
}
fn fogApply(c: vec3f, wp: vec3f, d: f32) -> vec3f {
  let rd = (wp - u.cam.xyz) / max(d, 1e-3);
  // light haze for the mid distance (the bokeh stays saturated, O), heavy for the far walls
  let fs = select(1.0, u.p1.z, u.p1.z > 0.0); // p1.z: haze scale (the game thins it for readability; 0 = the concept's haze)
  let f = 1.0 - exp(-max(d - 11.0, 0.0) * 0.05 * fs) * exp(-max(d - 30.0, 0.0) * 0.06 * fs);
  return mix(c, sky(rd), f);
}
fn bumpN(n: vec3f, p: vec3f, amp: f32) -> vec3f {
  let e = 0.08;
  let g = vec3f(vn3(p + vec3f(e, 0.0, 0.0)) - vn3(p - vec3f(e, 0.0, 0.0)), vn3(p + vec3f(0.0, e, 0.0)) - vn3(p - vec3f(0.0, e, 0.0)), vn3(p + vec3f(0.0, 0.0, e)) - vn3(p - vec3f(0.0, 0.0, e))) / (2.0 * e);
  return normalize(n - (g - n * dot(g, n)) * amp);
}
fn shadeSolid(wp: vec3f, n0: vec3f, aux: f32, prm: vec4f, lp: vec3f) -> vec3f {
  let K = normalize(u.sun.xyz); let v = normalize(u.cam.xyz - wp);
  let mat = prm.x;
  var n = n0; if (dot(n, v) < 0.0 && mat > 0.5) { n = -n; }
  let fres = pow(1.0 - sat(dot(n, v)), 2.5);
  if (mat < 0.5) {
    // MC-FOLD / vessel wall: fibrous pink-white sheet (MC-FIBRE), fibres along the hero fold's axis near the start
    let w = 1.0 - smoothstep(22.0, 34.0, wp.z);
    var T = normalize(mix(vec3f(0.0, 0.0, 1.0), u.p0.xyz, w));
    T = normalize(T - n * dot(T, n) + vec3f(1e-4));
    let B = cross(n, T);
    let wq = vn3(wp * 0.7) * 1.2;
    let q = vec3f(dot(wp, T) * 0.35, dot(wp, B) * 3.2 + wq, dot(wp, n) * 1.5);
    let s = fbm3(q, 3);
    let fine = vn3(vec3f(dot(wp, T) * 0.9, dot(wp, B) * 11.0 + wq * 2.0, 3.0));
    let str = smoothstep(0.5, 0.8, s) * 0.85 + smoothstep(0.55, 0.85, fine) * 0.5;
    var base = mix(vec3f(0.74, 0.36, 0.54), vec3f(0.90, 0.64, 0.72), s);
    base = mix(base, vec3f(0.98, 0.92, 0.92), sat(str * 1.2)); // white fibre web over pink-magenta gaps (D3-D4)
    // rare hot-magenta strands (C3-D3 #e5499e)
    let mg = smoothstep(0.82, 0.9, vn3(vec3f(dot(wp, T) * 0.6, dot(wp, B) * 3.0, dot(wp, n) * 3.0 + 7.0)));
    base = mix(base, vec3f(0.90, 0.29, 0.62), mg * 0.8);
    // the near face of the hero fold (left, below the crest, facing the camera) is in shade (A2-A3)
    let nearShade = smoothstep(0.45, 0.9, dot(n, v)) * 0.45 * w;
    let ao = sat(aux * 0.5 + 0.5) * (1.0 - nearShade);
    let dif = sat(dot(n, K) * 0.55 + 0.45);
    var c = base * (AMB * 0.45 + vec3f(0.74, 0.64, 0.64) * dif) * mix(0.55, 1.0, ao);
    let hh = normalize(K + v);
    c += vec3f(0.9, 0.85, 0.85) * pow(sat(dot(n, hh)), 24.0) * (0.15 + 0.6 * str) * ao; // wet glints along the fibres
    c += vec3f(0.95, 0.88, 0.90) * (fres * 0.6 + str * 0.12) * ao;           // crest sheen (back-lit membrane)
    return c;
  }
  if (mat > 3.5 && mat < 4.5) {
    // RBC family: biconcave disc; rim #a93a4b, face #ca4859, thin dimple centre #ed6373 (lighter: light passes through)
    let rho = length(lp.xz);
    var col = mix(vec3f(0.79, 0.28, 0.35), vec3f(0.93, 0.40, 0.45), smoothstep(0.6, 0.05, rho));
    col = mix(col, vec3f(0.68, 0.23, 0.30), smoothstep(0.75, 0.98, rho));
    col = mix(col, vec3f(0.62, 0.55, 0.62), prm.z);            // game: a germ made it sick (greyed, no gore)
    let dif = sat(dot(n, K) * 0.5 + 0.5);
    let h = normalize(K + v);
    let gl = pow(sat(dot(n, h)), 30.0) * 0.18;
    var c = col * (AMB * 0.62 + vec3f(0.70, 0.62, 0.62) * dif) + vec3f(gl) + vec3f(0.85, 0.75, 0.80) * fres * 0.12;
    c += vec3f(0.6, 0.9, 1.0) * prm.w;                         // game highlight (tractor)
    return c;
  }
  if (mat > 4.5 && mat < 5.5) {
    // WBC family: lumpy (mulberry) sphere; shadow #39132c, mid #4d1a38, lit #692e63; pink variant #a84984 (prm.y > 0.5)
    let nb = bumpN(n, lp * 7.0 + vec3f(prm.y * 13.0), 0.5);
    let cav = vn3(lp * 7.0 + vec3f(prm.y * 13.0));
    let dif = sat(dot(nb, K) * 0.5 + 0.5);
    let pink = step(0.5, prm.y);
    let lo = mix(vec3f(0.21, 0.07, 0.17), vec3f(0.42, 0.14, 0.32), pink);
    let hi = mix(vec3f(0.45, 0.20, 0.42), vec3f(0.72, 0.34, 0.58), pink);
    var c = mix(lo, hi, dif * dif) * mix(0.75, 1.1, cav);
    c += vec3f(0.70, 0.55, 0.72) * pow(1.0 - sat(dot(nb, v)), 3.0) * 0.45;   // pale rim
    c += vec3f(0.5, 0.9, 0.7) * prm.w;                          // game: hunting glow
    return c;
  }
  if (mat > 5.5 && mat < 6.5) {
    // CRM family: translucent cream cell (#e6b48e top, #eaa568 body, glowing lower-left #f4c083)
    let nb = bumpN(n, lp * 9.0 + vec3f(prm.y * 7.0), 0.28);
    let thru = sat(dot(nb, -K) * 0.5 + 0.5);
    let dif = sat(dot(nb, K) * 0.5 + 0.5);
    var col = mix(vec3f(0.86, 0.60, 0.40), vec3f(0.97, 0.77, 0.53), thru * 0.8);
    col = mix(col, vec3f(0.91, 0.72, 0.58), smoothstep(0.6, 1.0, dif) * 0.6);
    col = mix(col, vec3f(0.98, 0.70, 0.72), prm.z);            // game: fed -> rosy
    var c = col * (0.72 + 0.32 * dif) + vec3f(0.96, 0.90, 0.85) * fres * 0.35;
    c += vec3f(1.0, 0.8, 0.5) * prm.w;                          // game: hungry pulse
    return c;
  }
  if (mat > 6.5 && mat < 7.5) {
    // SB small beads / platelets: smooth cream-white #f4cda7
    let dif = sat(dot(n, K) * 0.5 + 0.5);
    let h = normalize(K + v);
    var c = vec3f(0.95, 0.80, 0.65) * (0.62 + 0.42 * dif) + vec3f(pow(sat(dot(n, h)), 40.0) * 0.35) + vec3f(0.9, 0.85, 0.85) * fres * 0.25;
    c += vec3f(0.6, 0.9, 1.0) * prm.w;
    return c;
  }
  // mat 3: painted parts (K1 ship, MC-TUBE fibre strand, game germs and props): colour in prm.yzw
  let dif = sat(dot(n, K) * 0.55 + 0.45);
  return prm.yzw * (AMB * 0.35 + vec3f(0.72, 0.68, 0.70) * dif) + vec3f(0.85, 0.85, 0.9) * fres * 0.22;
}
fn pointMotion(p: vec3f, k: f32, t: f32) -> vec3f { let h = h31(floor(p * 3.0)); return vec3f(sin(t * 0.4 + h * 6.0), sin(t * 0.33 + h * 9.0), sin(t * 0.27 + h * 4.0)) * 0.25; }
`,
  post: /*wgsl*/`
fn mViewZ(d: f32) -> f32 { return select(1e4, u.up.w / d, d > 0.0); }
// thin-lens circle of confusion in pixels (section 1 and 6): sharp band +-range around the focus, near blur heavier than far
fn mCoc(z: f32, k: f32) -> f32 {
  let f = u.p1.x;
  let x = 1.0 - f / z;                     // < 0 in front of the focus, > 0 behind
  let band = 1.6 / f;
  let c = select(max(x - band, 0.0) * 0.8, max(-x - band, 0.0) * 1.0, x < 0.0);
  return min(c * k, 64.0 * u.res.y / 816.0);
}
fn grade(c0: vec3f, bl: vec3f, uv: vec2f, px: vec2i, d0: f32) -> vec3f {
  var c = c0;
  let k = u.p1.y * u.res.y / 816.0 * 2.0;
  if (k > 0.0) {
    // DOF fallback gather (scatter-as-gather with near-field bleed), 72 taps on a jittered spiral
    let z0 = mViewZ(d0); let s0 = mCoc(z0, k);
    let maxR = 64.0 * u.res.y / 816.0;
    let N = 72.0;
    let jit = h31(vec3f(f32(px.x), f32(px.y), 3.1)) * 6.2832;
    var col = c0; var tot = 1.0;
    let w = maxR / sqrt(N) * 0.9;
    for (var i = 0.0; i < N; i += 1.0) {
      let r = maxR * sqrt((i + 0.5) / N);
      let a = i * 2.39996 + jit;
      let o = vec2f(cos(a), sin(a)) * r;
      let q = vec2i(vec2f(px) + o);
      let zs = mViewZ(depthAt(q));
      var ss = mCoc(zs, k);
      if (zs > z0) { ss = min(ss, s0 * 2.0); }
      let m = smoothstep(r - w, r + w * 0.5, ss);
      col += mix(col / tot, hdrAt(uv + o * u.res.zw), m);
      tot += 1.0;
    }
    c = col / tot;
  }
  c += bl * 0.2;
  // a light film haze and a faint lens vignette (section 1)
  let vg = 1.0 - 0.10 * pow(length(uv - 0.5) * 1.3, 2.5);
  c = c * vg;
  return clamp(c, vec3f(0.0), vec3f(1.0)); // colours authored in display (sRGB) values measured from the source
}
`,
  build() {
    // ---- the vessel and MC-FOLD: density grid -> surface nets, with per-vertex openness (aux) for the creases
    const D = new Float32Array(VGX * VGY * VGZ);
    for (let z = 0; z < VGZ; z++) { const wz = VG0[2] + z * VGV; for (let y = 0; y < VGY; y++) for (let x = 0; x < VGX; x++) D[x + VGX * (y + VGY * z)] = vesselDensity(VG0[0] + x * VGV, VG0[1] + y * VGV, wz); }
    for (let z = VGZ - 2; z < VGZ; z++) for (let y = 0; y < VGY; y++) for (let x = 0; x < VGX; x++) D[x + VGX * (y + VGY * z)] = 1; // closed far end (beyond the finale)
    const sn = surfaceNets(D, VGX, VGY, VGZ), smp = sampler3(D, VGX, VGY, VGZ);
    const Dw = (x, y, z) => smp((x - VG0[0]) / VGV, (y - VG0[1]) / VGV, (z - VG0[2]) / VGV);
    const m = new Mesh();
    for (let k = 0; k < sn.nv; k++) {
      const gx = sn.pos[k * 3], gy = sn.pos[k * 3 + 1], gz = sn.pos[k * 3 + 2], e = 0.7;
      const nx = smp(gx - e, gy, gz) - smp(gx + e, gy, gz), ny = smp(gx, gy - e, gz) - smp(gx, gy + e, gz), nz = smp(gx, gy, gz - e) - smp(gx, gy, gz + e), l = hypot(nx, ny, nz) || 1;
      const x = VG0[0] + gx * VGV, y = VG0[1] + gy * VGV, z = VG0[2] + gz * VGV;
      // openness: average field 1.5 m and 3 m out along the normal (creases and the fold's foot read darker)
      let o = 0; for (const t of [1.2, 2.5, 4]) o += clamp(-Dw(x + nx / l * t, y + ny / l * t, z + nz / l * t) / t, -1, 1);
      m.v(x, y, z, clamp(o / 3 * 1.6 - 0.2, -1, 1));
    }
    for (let i = 0; i < sn.ni; i++) m.i.push(sn.idx[i]);
    const wall = m.build((x, y, z) => { const gx = (x - VG0[0]) / VGV, gy = (y - VG0[1]) / VGV, gz = (z - VG0[2]) / VGV, e = 0.7; return [smp(gx - e, gy, gz) - smp(gx + e, gy, gz), smp(gx, gy - e, gz) - smp(gx, gy + e, gz), smp(gx, gy, gz - e) - smp(gx, gy, gz + e)]; });
    wall.inst = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0]);

    // ---- cell families (grammar section 5); unit size, instanced
    const geo = microGeo();
    const inst = { rbc: [], wbc: [], crm: [], sb: [] };
    const put = (fam, mat, x, y, z, r, q, seed, a = 0, b = 0) => inst[fam].push(x, y, z, r, q[0], q[1], q[2], q[3], mat, seed, a, b);
    const Q0 = [0, 0, 0, 1];
    // place by source pixel and chosen depth; radius derived from the projected size (section 3 and 6)
    const at = (fam, mat, px, py, rpx, z, q = Q0, seed = 0) => { const p = mPix(px, py, z); put(fam, mat, p[0], p[1], p[2], mRad(rpx, z), q, seed); };
    // resting on the membrane: find where the ray through (px, py) meets the fold, sit the cell just in front of it
    const atS = (fam, mat, px, py, rpx, q = Q0, seed = 0) => {
      let z = 10.5; for (let t = 6; t < 24; t += 0.05) { const p = mPix(px, py, t); if (Dw(p[0], p[1], p[2]) > 0) { z = t; break; } }
      const r = mRad(rpx, z); z -= r * 0.35; const p = mPix(px, py, z); put(fam, mat, p[0], p[1], p[2], mRad(rpx, z), q, seed);
    };
    const faceOn = (tilt, spin) => qMul(qAxis(0, 0, 1, spin), qAxis(1, 0, 0, PI / 2 + tilt)); // disc axis (local y) toward the camera
    // red cells
    at('rbc', 4, 543, 218, 85, 10.5, faceOn(-0.15, 0.3));      // RBC-1 sharp, almost face-on
    at('rbc', 4, 1175, 295, 135, 6.6, faceOn(0.22, -0.4));     // RBC-2 nearer, slightly soft
    at('rbc', 4, 648, 328, 42, 12.0, faceOn(0.35, 0.8));       // RBC-3
    atS('rbc', 4, 810, 565, 50, faceOn(0.5, 0.2));        // RBC-4 on the membrane
    at('rbc', 4, 1380, 670, 65, 17.0, faceOn(0.3, 0.5));       // RBC-5 blurred, behind
    at('rbc', 4, 1205, 20, 110, 6.0, faceOn(-0.9, 0.2));       // RBC-6 top right, tilted (I)
    at('crm', 6, 1185, 18, 60, 5.6, Q0, 0.93);                // RBC-6's cream-lit face (O: a cream disc inside the red rim)
    at('rbc', 4, 18, 28, 100, 4.0, faceOn(0.6, 0.9));          // RBC-7 A1 corner sliver
    at('rbc', 4, 1165, 150, 25, 28, faceOn(0.2, 0));           // RBC-b red bokeh
    at('rbc', 4, 1310, 350, 30, 26, faceOn(0.4, 1));
    at('rbc', 4, 600, 445, 22, 14, faceOn(0.6, 2));
    for (const [px, py, r, z, tl] of [[655, 440, 30, 10.4, 0.9], [775, 545, 40, 10.6, 0.6], [840, 575, 34, 10.5, 1.1], [610, 470, 26, 10.3, 0.3], [930, 640, 30, 10.7, 0.8]]) atS('rbc', 4, px, py, r, faceOn(tl, px)); // red cells resting on the crest (C3-D4)
    // purple (white) cells
    at('wbc', 5, 1030, 578, 100, 10.5, Q0, 0.11);              // WBC-1 sharp
    at('wbc', 5, 715, 370, 55, 12.0, Q0, 0.21);                // WBC-2
    at('wbc', 5, 552, 422, 48, 11.0, Q0, 0.71);                // WBC-3 pinker
    at('wbc', 5, 1430, 430, 150, 8.0, Q0, 0.31);               // WBC-4 right edge
    at('wbc', 5, 1280, 480, 40, 10.0, Q0, 0.81);               // WBC-5 magenta-red
    at('wbc', 5, 262, 335, 35, 10.3, Q0, 0.41);                // WBC-6 on the crest left of the ship
    at('wbc', 5, 60, 690, 300, 3.0, Q0, 0.05);                // WBC-f foreground A3-A4
    at('wbc', 5, 680, 720, 130, 4.5, Q0, 0.15);                // WBC-f C4/D4
    at('wbc', 5, 470, 650, 90, 5.0, Q0, 0.62);                // WBC-f magenta B3/C3
    at('wbc', 5, 225, 40, 140, 3.8, Q0, 0.25);                 // MC-TL top-left
    // cream cells
    at('crm', 6, 885, 425, 80, 10.2, Q0, 0.13);                // CRM-1 sharp
    at('crm', 6, 115, 245, 55, 6.0, Q0, 0.37);                 // CRM-2 blurred
    at('crm', 6, 490, 800, 150, 3.6, Q0, 0.58);                // CRM-3 huge foreground peach
    atS('crm', 6, 895, 595, 40, Q0, 0.77);                // D4 cream mid
    for (const [px, py, r, z] of [[770, 470, 45, 14], [960, 520, 40, 15], [700, 580, 38, 13.5], [990, 430, 30, 16]]) at('rbc', 4, px, py, r, z, faceOn(0.7, px)); // pink-red cells behind CRM-1 (D3 #dea49c)
    // small beads on the membrane (SB) and far cream bokeh (BOK)
    for (const [px, py, r, z] of [[680, 490, 28, 10.5], [805, 610, 28, 11], [720, 530, 20, 10.8], [930, 690, 22, 10.5], [760, 545, 18, 10.9], [855, 520, 22, 10.6], [650, 470, 16, 10.6], [960, 720, 18, 10.8], [990, 760, 20, 10.9],
      [700, 470, 24, 10.4], [745, 505, 20, 10.6], [830, 545, 24, 10.6], [870, 640, 30, 10.6], [845, 585, 18, 10.8], [905, 650, 16, 10.8], [780, 620, 22, 11], [620, 455, 18, 10.4], [935, 740, 24, 10.8], [880, 760, 20, 11], [585, 505, 16, 10.2], [960, 650, 14, 11]]) atS('sb', 7, px, py, r);
    for (const [px, py, r] of [[405, 188, 20], [895, 150, 25], [1055, 155, 28], [800, 225, 30], [925, 310, 28], [1060, 750, 25], [770, 180, 22], [1250, 230, 22], [930, 60, 26], [1000, 230, 20], [1110, 40, 24], [860, 300, 22], [990, 330, 26], [1120, 360, 20]]) at('crm', 6, px, py, r, 24, Q0, px * 0.001);
    for (const [px, py, r] of [[960, 180, 26], [1060, 260, 30], [870, 90, 20], [1170, 330, 24]]) at('rbc', 4, px, py, r, 22, faceOn(0.3, py)); // pink bokeh in D1-E2
    // MC-RW: the right background mass, a crowd of cells near the far right wall (I)
    rseed(31);
    for (let i = 0; i < 110; i++) {
      const up = i >= 70, z = up ? rr(26, 40) : rr(20, 46), px = up ? rr(820, 1300) : rr(1080, 1500), py = up ? rr(-40, 420) : rr(-40, 760), p = mPix(px, py, z), fam = rnd();
      const r = rr(0.5, 1.3);
      if (fam < 0.45) put('wbc', 5, p[0], p[1], p[2], r, Q0, rnd()); else if (fam < 0.75) put('crm', 6, p[0], p[1], p[2], r * 0.8, Q0, rnd()); else put('rbc', 4, p[0], p[1], p[2], r, qRand(), rnd());
    }
    // behind the crest (C3-D4): a packed band of blurred cells, pink, red, cream and violet (O: the source never shows bare teal there)
    for (let i = 0; i < 26; i++) { const z = rr(13, 19), p = mPix(rr(520, 1000), rr(420, 760), z), f = rnd(); if (f < 0.35) put('rbc', 4, p[0], p[1], p[2], rr(0.45, 0.7), qRand(), rnd()); else if (f < 0.6) put('crm', 6, p[0], p[1], p[2], rr(0.3, 0.55), Q0, rnd()); else if (f < 0.8) put('wbc', 5, p[0], p[1], p[2], rr(0.35, 0.6), Q0, 0.55 + rnd() * 0.4); else put('sb', 7, p[0], p[1], p[2], rr(0.2, 0.3), Q0, 0); }
    // E4-F4: the lower right of the mass is darker (O #797081, #785f70): violet and red cells low on the right
    for (let i = 0; i < 18; i++) { const z = rr(16, 30), p = mPix(rr(1150, 1500), rr(560, 860), z); if (rnd() < 0.65) put('wbc', 5, p[0], p[1], p[2], rr(0.6, 1.2), Q0, rr(0, 0.45)); else put('rbc', 4, p[0], p[1], p[2], rr(0.7, 1.0), qRand(), rnd()); }
    // the rest of the vessel: cells drifting in the plasma and resting on the walls (I, the same families)
    rseed(32);
    for (let i = 0; i < 260; i++) {
      const z = rr(30, V_LEN - 6), a = rr(0, TAU), onWall = rnd() < 0.55, rad = onWall ? V_R - rr(0.6, 2.2) : rr(4, V_R - 3);
      const x = vCx(z) + cos(a) * rad, y = vCy(z) + sin(a) * rad, f = rnd();
      if (f < 0.4) put('rbc', 4, x, y, z, rr(0.7, 0.9), qRand(), rnd()); else if (f < 0.62) put('wbc', 5, x, y, z, rr(0.6, 1.2), Q0, rnd());
      else if (f < 0.82) put('crm', 6, x, y, z, rr(0.5, 1.0), Q0, rnd()); else put('sb', 7, x, y, z, rr(0.2, 0.32), Q0, 0);
    }
    const meshes = [wall];
    for (const [fam, g] of [['rbc', geo.rbc], ['wbc', geo.lumpy], ['crm', geo.lumpy], ['sb', geo.bead]]) { const b = Object.assign({}, g); b.inst = new Float32Array(inst[fam]); b.family = fam; meshes.push(b); }

    // ---- MC-TUBE: the soft pink fibre strand at the top left (A1-B2), and MC-FIBRE magenta hairs on the fold crest
    const strand = new Mesh(); { const a = mPix(-60, 190, 5), b = mPix(120, 172, 5), c = mPix(250, 166, 5); strand.tube([a, [mix(a[0], b[0], 0.5), mix(a[1], b[1], 0.5) + 0.03, 5], b, c], (k) => [0.09, 0.09, 0.085, 0.07][k], 10, true); }
    const hairs = new Mesh(); rseed(33);
    // short curled strands rooted on the fold surface in the in-focus band (C3-D4), raised a little along the normal
    for (let tries = 0, made = 0; made < 40 && tries < 20000; tries++) {
      const k = (rnd() * sn.nv) | 0, x = VG0[0] + sn.pos[k * 3] * VGV, y = VG0[1] + sn.pos[k * 3 + 1] * VGV, z = VG0[2] + sn.pos[k * 3 + 2] * VGV;
      if (z < 7 || z > 13) continue;
      const px = (x / (M_TANH * z) + 1) * 728, py = (1 - y / (M_TANV * z)) * 408;
      if (px < 500 || px > 1000 || py < 430 || py > 800) continue;
      const e = 0.5, nx = Dw(x - e, y, z) - Dw(x + e, y, z), ny = Dw(x, y - e, z) - Dw(x, y + e, z), nz = Dw(x, y, z - e) - Dw(x, y, z + e), l = hypot(nx, ny, nz) || 1;
      if (nz / l > 0.3) continue; // must face the camera or the lumen
      const a = [nx / l, ny / l, nz / l], t = [rr(-1, 1), rr(-1, 1), rr(-1, 1)], L = rr(0.25, 0.5);
      const pts = []; for (let j = 0; j <= 4; j++) { const u = j / 4; pts.push([x + a[0] * (0.05 + u * L * 0.6) + t[0] * u * L * 0.5, y + a[1] * (0.05 + u * L * 0.6) + t[1] * u * L * 0.5 + Math.sin(u * 3) * 0.05, z + a[2] * (0.05 + u * L * 0.6) + t[2] * u * L * 0.5]); }
      hairs.tube(pts, 0.03, 5, true); made++;
    }
    const paint = (mesh, rgb, extra) => { const b = mesh.build(); b.inst = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 3, rgb[0], rgb[1], rgb[2]]); Object.assign(b, extra || {}); return b; };
    meshes.push(paint(strand, [0.89, 0.60, 0.73]));            // #e29bb9
    meshes.push(paint(hairs, [0.95, 0.30, 0.64]));             // #e5499e

    // ---- K1: the ship, resting on the crest at B2, nose down the slope (section 3)
    const SHIP = mPix(400, 352, 10.4);
    const shipQ = qMul(qAxis(0, 0, 1, -0.56), qMul(qAxis(1, 0, 0, -0.42), qAxis(0, 1, 0, -0.25)));
    const shipParts = microShip();
    for (const [pm, rgb] of shipParts) { const b = paint(pm, rgb, { shipPart: true }); b.inst[0] = SHIP[0]; b.inst[1] = SHIP[1]; b.inst[2] = SHIP[2]; b.inst[4] = shipQ[0]; b.inst[5] = shipQ[1]; b.inst[6] = shipQ[2]; b.inst[7] = shipQ[3]; meshes.push(b); }

    // ---- MC-DUST: small bright specks and pale motes
    const pts = []; rseed(34);
    for (let i = 0; i < 360; i++) { const z = rr(-4, V_LEN), a = rr(0, TAU), r = rr(0, V_R - 1); pts.push(vCx(z) + cos(a) * r, vCy(z) + sin(a) * r, z, rr(0.015, 0.04), 0.35, 0.33, 0.33, 1); }
    for (const [px, py] of [[742, 120], [850, 40], [1290, 150], [1120, 100], [1240, 540], [1050, 600], [985, 105]]) { const p = mPix(px, py, 10.5); pts.push(p[0], p[1], p[2], 0.03, 0.4, 0.38, 0.38, 0); }

    // ---- collision (free flight): push out of the wall
    const collide = (F) => {
      for (let it = 0; it < 2; it++) {
        const d = Dw(F[0], F[1], F[2]) + 1.0; if (d <= 0) return;
        const e = 0.4, gx = Dw(F[0] + e, F[1], F[2]) - Dw(F[0] - e, F[1], F[2]), gy = Dw(F[0], F[1] + e, F[2]) - Dw(F[0], F[1] - e, F[2]), gz = Dw(F[0], F[1], F[2] + e) - Dw(F[0], F[1], F[2] - e), l = sqrt(gx * gx + gy * gy + gz * gz);
        if (l < 1e-4) return; F[0] -= gx / l * d * 0.5; F[1] -= gy / l * d * 0.5; F[2] -= gz / l * d * 0.5;
      }
    };
    const centre = (z, o) => { o[0] = vCx(z); o[1] = vCy(z); o[2] = z; return o; };
    return { meshes, points: new Float32Array(pts), collide, field: Dw, geo, centre, vesselLen: V_LEN, fold: FOLD, ship: { pos: SHIP, q: shipQ },
      poses: [[0, 0, 0, 0, 0, M_FOV], [vCx(60), vCy(60), 40, 0, 0, 1.0], [vCx(150), vCy(150), 130, 0, 0, 1.0]] };
  },
};

// ---- shared geometry for the cell families (also used by the game for its pools)
function microGeo() {
  // RBC: biconcave disc, axis local y. Half-thickness from the Evans-Fung shape (I: textbook proportions)
  const rbcM = new Mesh(), NR = 18, NA = 36, top = [], bot = [];
  const ht = (r) => 0.5 * Math.sqrt(max(0, 1 - r * r)) * (0.207 + 2.003 * r * r - 1.123 * r * r * r * r) * 1.1;
  for (let i = 0; i <= NR; i++) {
    const r = Math.sin(i / NR * PI / 2) * 0.999, h = max(ht(r), i === NR ? 0 : 0.02), rt = [], rb = [];
    for (let j = 0; j < NA; j++) { const a = j / NA * TAU; rt.push(rbcM.v(cos(a) * r, h, sin(a) * r)); rb.push(rbcM.v(cos(a) * r, -h, sin(a) * r)); }
    top.push(rt); bot.push(rb);
  }
  for (let i = 0; i < NR; i++) for (let j = 0; j < NA; j++) {
    const j2 = (j + 1) % NA;
    rbcM.quad(top[i][j], top[i][j2], top[i + 1][j2], top[i + 1][j]);
    rbcM.quad(bot[i][j], bot[i + 1][j], bot[i + 1][j2], bot[i][j2]);
  }
  const outward = (x, y, z, nx, ny, nz) => (nx * x + ny * y * 4 + nz * z < 0 ? [-nx, -ny, -nz] : [nx, ny, nz]);
  const rbc = rbcM.build(outward);
  // lumpy sphere (WBC and CRM): mulberry lumps; the shader adds finer bumps
  const lumpy = icosphere(4, (x, y, z) => { const r = 1 + 0.07 * (vnoise(x * 4.5 + 9, y * 4.5, z * 4.5) - 0.5) + 0.035 * (vnoise(x * 10, y * 10 + 3, z * 10) - 0.5); return [x * r, y * r, z * r]; }).build(outward);
  const bead = icosphere(2).build(outward);
  // germs (game additions, P): a rod bacterium (capsule along local y) and a spiky virus
  const rodM = new Mesh(); rodM.tube(Array.from({ length: 11 }, (_, k) => [0, -1 + k / 5, 0]), (k) => 0.42 * Math.sqrt(Math.sin(PI * clamp(0.04 + k / 10 * 0.92, 0, 1))), 14, true);
  const rod = rodM.build();
  const virM = icosphere(2, (x, y, z) => [x * 0.75, y * 0.75, z * 0.75]);
  { const ico = icosphere(1); for (let k = 0; k < ico.p.length; k += 3) { const x = ico.p[k], y = ico.p[k + 1], z = ico.p[k + 2]; virM.tube([[x * 0.7, y * 0.7, z * 0.7], [x * 1.05, y * 1.05, z * 1.05]], (i) => (i ? 0.07 : 0.05), 5, false); const ball = icosphere(0, (a, b, c) => [x * 1.1 + a * 0.11, y * 1.1 + b * 0.11, z * 1.1 + c * 0.11]); const o = virM.p.length / 3; virM.p.push(...ball.p); virM.aux.push(...ball.aux); for (const t of ball.i) virM.i.push(t + o); } }
  const virus = virM.build(outward);
  return { rbc, lumpy, bead, rod, virus };
}
// K1 ship parts (section 3/5): plank hull, delta fin, cabins, mast with crossed rotor, two curled hook legs. Local +x is the nose.
function microShip() {
  const parts = [];
  const HULL = [0.95, 0.66, 0.74], DECK = [1.0, 0.98, 0.97], UNDER = [0.70, 0.28, 0.40], FIN = [0.68, 0.52, 0.68], DARK = [0.35, 0.22, 0.30];
  const L = 1.9;
  const hull = new Mesh(); hull.sweep([[-L / 2, 0, 0], [L / 2 - 0.15, 0, 0], [L / 2, 0, 0]], (k) => [0.42, 0.42, 0.2][k], 0.07, null, true); parts.push([hull, HULL]);
  const under = new Mesh(); under.sweep([[-L / 2 + 0.05, -0.05, 0], [L / 2 - 0.1, -0.05, 0]], 0.36, 0.04, null, true); parts.push([under, UNDER]);
  const fin = new Mesh(); fin.sweep([[-L / 2 - 0.2, 0.05, 0], [-L / 2 + 0.25, 0.05, 0]], (k) => [0.62, 0.14][k], 0.03, null, true); parts.push([fin, FIN]);
  const fin2 = new Mesh(); fin2.sweep([[-L / 2 - 0.05, 0.05, 0], [-L / 2 + 0.05, 0.3, 0]], 0.03, 0.18, null, true); parts.push([fin2, FIN]);
  const cab = new Mesh();
  for (const [x, w, h] of [[-0.35, 0.22, 0.18], [-0.08, 0.26, 0.24], [0.22, 0.2, 0.15], [0.45, 0.14, 0.1]]) cab.sweep([[x - w / 2, 0.035 + h / 2, 0], [x + w / 2, 0.035 + h / 2, 0]], 0.24, h, null, true);
  parts.push([cab, DECK]);
  const mast = new Mesh(); mast.tube([[0.12, 0.05, 0], [0.12, 0.62, 0]], 0.022, 6, true);
  mast.tube([[0.12, 0.62, 0], [0.12, 0.72, 0]], 0.04, 6, true);
  parts.push([mast, DECK]);
  const rotor = new Mesh(); rotor.sweep([[-0.28, 0.46, -0.25], [0.52, 0.46, 0.25]], 0.06, 0.012, null, true); rotor.sweep([[-0.18, 0.6, 0.3], [0.42, 0.6, -0.3]], 0.05, 0.012, null, true); parts.push([rotor, HULL]);
  const legs = new Mesh();
  for (const [x, z] of [[-0.45, 0.1], [0.4, -0.05]]) { const pts = []; for (let k = 0; k <= 8; k++) { const a = k / 8 * PI * 1.4; pts.push([x - 0.06 * Math.sin(a), -0.05 - 0.12 * k / 8 - 0.04 * (1 - Math.cos(a)), z + 0.06 * Math.sin(a * 0.7)]); } legs.tube(pts, 0.02, 5, true); }
  parts.push([legs, DARK]);
  return parts;
}
