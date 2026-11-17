// ============================================================================
// pulse.js: the Reality Pulse (GAME_API.md "Reality Pulse"). carpetshark, 2026-11-16: “alt fire and then the reality pulse first..
// whatever it hits is where you should spread the new reality from”, “alt fire can be done as long as there is no active
// pulse or transition happening”, “show the shell glowing/crackling/pulsing”, “a wub-blub like time standing still”.
// A shot (an orb) flies down the aim ray; from what it hits, the next realm spreads inside a growing sphere. When the shell
// reaches the ship the realms swap (realms.js), time snaps back, and the shell's afterglow recedes. Parts:
//   game side   fire / step / poll / reset: the orb, the first-rock ray cast, the radius easing
//   shared      timeStop / timeGo / beat, cineStart / cineApply, the music's tape-slow and low-pass: the Z warp uses them too
//   composite   one engine G.final pass (engine.js "realm packs"): the next realm (G.realmAux) inside the sphere, by world
//               position from the main depth, and the shell on top; present() fills its params every frame
//   world       api.world: who supplies the next realm. In the game REALMS.pulse (realms.js); in the lab two stand-in packs
//   lab         PULSE.lab(scene): pulse-lab.html, the pulse spreading from a fixed rock on a loop
// Load-time allocation only: step, present and poll reuse preallocated arrays.
// ============================================================================
const PULSE = (() => {
  const TUNE = { dur: 2.0, sweepDur: 3.0, after: 0.7, sweep: 3.8, quick: 1.0, arc: 3.3, slow: 0.12, slowCalm: 0.5, slowBeat: 0.25, wub: 0.42, cheapDur: 1.1, cheapFade: 0.45, speed: 170, range: 150, near: 8, swallow: 0.6, burst: 0.3, far: 800, minD: 12, bonus: 250, orb: 0.55, tail: 9 };
  const PQ = typeof QS !== 'undefined' ? QS : new URLSearchParams(location.search), OPT = PQ.get('pulse') || '', OFFP = (PQ.get('off') || '').split(',').includes('pulse');
  const REDUCED = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------------------------------------------------------------- stand-in realms (Pulse Lab only: the game uses realms.js's packs)
  // The scene's own sky / fog / solid shading are kept under new names and wrapped, so the lab's scene gets two more looks.
  const STAND = [null, /*wgsl*/`
fn sky(rd: vec3f) -> vec3f { // Inside: a violet hollow with glowing cyan seams
  let n = fbm3(rd * 3.1 + vec3f(4.0, 1.0, u.cam.w * 0.006), 5); let w = fbm3(rd * 7.0 + vec3f(n * 2.0), 3);
  var c = mix(vec3f(0.012, 0.008, 0.045), vec3f(0.11, 0.045, 0.24), smoothstep(0.3, 0.8, n));
  c += vec3f(0.10, 0.75, 1.0) * pow(sat(1.0 - abs(w - 0.5) * 7.0), 5.0) * 0.4 * smoothstep(0.42, 0.7, n);
  c += vec3f(0.9, 0.3, 1.0) * pow(sat(dot(rd, u.sun.xyz)), 12.0) * 0.5;
  let g = rd * 240.0; let h = h31(floor(g)); if (h > 0.996) { c += vec3f(0.5, 1.0, 1.0) * sat(1.0 - length(fract(g) - 0.5) * 3.0) * fract(h * 61.0) * 1.6; }
  return c;
}
fn fogApply(c: vec3f, wp: vec3f, d: f32) -> vec3f { let e = exp(-max(d - 6.0, 0.0) * vec3f(0.011, 0.013, 0.008)); return c * e + vec3f(0.050, 0.030, 0.120) * (1.0 - e); }
fn shadeSolid(wp: vec3f, n: vec3f, aux: f32, prm: vec4f, lp: vec3f) -> vec3f {
  let l = dot(shadeSolid_A(wp, n, aux, prm, lp), vec3f(0.3, 0.6, 0.1));
  let v = pow(sat(1.0 - abs(fbm3(lp * 3.5 + vec3f(prm.y * 40.0), 3) - 0.5) * 9.0), 3.0);
  return vec3f(0.42, 0.30, 0.95) * l * 1.3 + vec3f(0.15, 1.3, 1.6) * v * (0.6 + 0.4 * sin(u.cam.w * 2.0 + prm.y * 40.0));
}`, /*wgsl*/`
fn sky(rd: vec3f) -> vec3f { // Body: warm crimson, with soft pale cells drifting
  let n = fbm3(rd * 2.2 + vec3f(9.0, 2.0, u.cam.w * 0.008), 5);
  var c = mix(vec3f(0.10, 0.008, 0.016), vec3f(0.50, 0.06, 0.08), smoothstep(0.25, 0.85, n));
  let cell = vn3(rd * 6.0 + vec3f(0.0, u.cam.w * 0.03, 3.0));
  c += vec3f(1.0, 0.42, 0.36) * smoothstep(0.62, 0.74, cell) * (1.0 - smoothstep(0.74, 0.9, cell) * 0.6) * 0.22;
  c += vec3f(1.0, 0.5, 0.3) * pow(sat(dot(rd, u.sun.xyz)), 8.0) * 0.5;
  return c;
}
fn fogApply(c: vec3f, wp: vec3f, d: f32) -> vec3f { let e = exp(-max(d - 6.0, 0.0) * vec3f(0.008, 0.014, 0.014)); return c * e + vec3f(0.22, 0.03, 0.05) * (1.0 - e); }
fn shadeSolid(wp: vec3f, n: vec3f, aux: f32, prm: vec4f, lp: vec3f) -> vec3f {
  let l = dot(shadeSolid_A(wp, n, aux, prm, lp), vec3f(0.3, 0.6, 0.1)); let v = normalize(u.cam.xyz - wp);
  return vec3f(1.0, 0.40, 0.44) * l * 1.4 + vec3f(1.0, 0.22, 0.18) * pow(1.0 - sat(dot(n, v)), 2.0) * 0.45;
}`];
  const standIn = (wgsl, k) => wgsl.replace('fn sky(', 'fn sky_A(').replace('fn fogApply(', 'fn fogApply_A(').replace('fn shadeSolid(', 'fn shadeSolid_A(') + STAND[k];

  // ---------------------------------------------------------------- the composite (an engine G.final pass over the graded frames)
  // The engine gives u (the main pack's uniforms), sL, tA (the main frame, graded), tB (the aux frame: the next realm, or tA
  // again when there is none) and tD (the main frame's depth, multisampled; reversed-Z: distance = 0.05 / depth along the view
  // axis, 0 = sky). fp, 27 vec4:
  //   0 mode (1 sphere, 2 ripple, 3 orb only), calm, time, strength · 1 centre, radius (m) · 2 progress, wash, seed, split views
  //   3 the old realm's glow · 4 the new realm's · 5 orb centre, radius · 6 its tail vector, brightness
  //   7 + 5v .. each split view's camera: eye + tan(fov / 2), forward + aspect, right, up, pixel rect (with no split: from u)
  // Per pixel (mode 1): the view ray against the sphere, and realm A's depth. Realm B shows where the ray enters the sphere
  // before reaching anything of realm A, and A's surface is inside it or A shows sky; realm A beyond the far wall melts into B
  // with distance. The shell: a hot band where the sphere cuts realm A's surfaces, veins of ridged noise that flicker in
  // patches and stretch the band into forks, a fresnel film on the sphere, a halo, bolts and three echo rings round the
  // silhouette, a lens and a shimmer in the sampling, and a flash as the wall passes the camera. The glow is laid over the
  // graded frame through a soft cap (lay), which tightens when the camera is at or inside the shell: bright, never white.
  // calm (reduced motion) keeps the glow only.
  const WGSL = /*wgsl*/`
struct PV { cam: vec3f, tn: f32, fwd: vec3f, asp: f32, right: vec3f, up: vec3f, org: vec2f, size: vec2f };
var<private> vw: PV;
fn viewAt(fc: vec2f) -> PV {
  var v: PV; let n = i32(fp[2].w);
  v.cam = u.cam.xyz; v.tn = u.fwd.w; v.fwd = u.fwd.xyz; v.asp = u.right.w; v.right = u.right.xyz; v.up = u.up.xyz; v.org = vec2f(0.0); v.size = u.res.xy;
  if (n > 0) {
    v.size = vec2f(0.0);
    for (var i = 0; i < n; i++) {
      let b = 7 + i * 5; let r = fp[b + 4];
      if (fc.x >= r.x && fc.y >= r.y && fc.x < r.x + r.z && fc.y < r.y + r.w) { v.cam = fp[b].xyz; v.tn = fp[b].w; v.fwd = fp[b + 1].xyz; v.asp = fp[b + 1].w; v.right = fp[b + 2].xyz; v.up = fp[b + 3].xyz; v.org = r.xy; v.size = r.zw; }
    }
  }
  return v;
}
fn ray(lp: vec2f) -> vec3f { let n = vec2f(lp.x / vw.size.x * 2.0 - 1.0, 1.0 - lp.y / vw.size.y * 2.0); return vw.fwd + vw.right * (n.x * vw.tn * vw.asp) + vw.up * (n.y * vw.tn); } // 1 along the view axis
fn pix(lp: vec2f) -> vec2i { return vec2i(clamp(lp, vec2f(0.0), vw.size - 1.0) + vw.org); }
fn uvOf(lp: vec2f) -> vec2f { return (clamp(lp, vec2f(0.5), vw.size - 0.5) + vw.org) * u.res.zw; }
fn distAt(lp: vec2f) -> f32 { let d = textureLoad(tD, pix(lp), 0); return select(1e9, 0.05 / d * length(ray(lp)), d > 0.0); }
fn lay(c: vec3f, g: vec3f, cap: f32) -> vec3f { let m = max(g.r, max(g.g, g.b)); return c + (vec3f(1.0) - c) * (vec3f(1.0) - exp(-g * (cap / max(cap, m)))); } // glow over a graded frame, capped
fn veins(p: vec3f, t: f32) -> f32 { // thin bright filaments: the ridges of warped noise, two sizes
  let w = vec3f(vn3(p * 2.9 + vec3f(t, 0.0, 0.0)), vn3(p * 2.9 + vec3f(11.0, -t, 0.0)), vn3(p * 2.9 + vec3f(23.0, 5.0, t))) - 0.5;
  let a = abs(vn3(p * 0.8 + w * 0.9) - 0.5); let b = abs(vn3(p * 2.1 + w * 1.3 + 7.0) - 0.5);
  return pow(sat(1.0 - a * 22.0), 3.0) + 0.5 * pow(sat(1.0 - b * 16.0), 3.0);
}
fn flick(n: vec3f, T: f32, seed: f32) -> f32 { // which patches of the shell are lit: re-drawn 14 times a second
  let k = floor(T * 14.0); let a = vn3(n * 2.2 + vec3f(k * 7.31 + seed)); let b = vn3(n * 2.2 + vec3f((k + 1.0) * 7.31 + seed));
  return smoothstep(0.5, 0.68, mix(a, b, smoothstep(0.6, 1.0, fract(T * 14.0))));
}
fn echo(dr: f32, gap: f32, w: f32, T: f32) -> f32 { // three rings running ahead of the shell, each fading as it goes
  var s = 0.0; let ph = fract(T * 1.3);
  for (var k = 0; k < 3; k++) { let x = f32(k) + ph; let d = (dr - x * gap) / (w * 0.55); s += exp(-d * d) * exp(-x * 0.85) * smoothstep(0.0, 0.35, x); }
  return s * 1.4;
}
// jagged bolts off a sphere's silhouette, outward and inward. e: from the centre to the ray's closest point; pw: a pixel there, in radii
fn bolts(e: vec3f, R: f32, T: f32, seed: f32, pw: f32) -> f32 {
  let rho = length(e) / R; let th = atan2(dot(e, vw.up), dot(e, vw.right)); var s = 0.0;
  for (var i = 0; i < 7; i++) {
    let fi = f32(i); let ph = T * (7.0 + fi * 0.9) + fi * 0.37; let tk = floor(ph);
    let h = vec3f(h31(vec3f(fi, tk, seed)), h31(vec3f(tk, seed + 3.0, fi)), h31(vec3f(seed + 9.0, fi, tk)));
    let out = h.y > 0.38; let len = (0.10 + 0.34 * h.z) * select(0.55, 1.0, out);
    let a = (rho - 1.0) * select(-1.0, 1.0, out) / len; // 0 at the shell, 1 at the tip
    if (a < 0.0 || a > 1.0) { continue; }
    let wob = (vn3(vec3f(a * 5.0, tk * 3.7 + fi, seed)) - 0.5) * 0.9 + (vn3(vec3f(a * 17.0, tk + fi * 5.0, seed + 1.0)) - 0.5) * 0.3;
    var d = th - (h.x * 6.2832 - 3.1416) - wob * sqrt(a) * len * 3.0;
    d = abs(d - 6.2832 * round(d / 6.2832)) * rho;
    let w = max(0.004 + 0.010 * (1.0 - a), pw * 1.2);
    s += pow(w / (d + w), 2.0) * (1.0 - a) * smoothstep(1.0, 0.7, fract(ph));
  }
  return s;
}
fn film(P: vec3f, R: f32, f: f32, T: f32, live: f32) -> vec3f { // the sphere's own surface: a fresnel film and the veins (live 0: the film alone)
  let n = P / R; var v = 0.0; if (live > 0.0) { v = veins(n * 5.0 + vec3f(fp[2].z), T * 0.5) * flick(n, T, fp[2].z) * live; }
  return mix(fp[4].rgb, fp[3].rgb, f) * (0.05 + 1.5 * pow(f, 2.5)) + ((fp[3].rgb + fp[4].rgb) * 0.5 + vec3f(0.45)) * v * (0.5 + 1.6 * f);
}
fn orbGlow(rd: vec3f, ts: f32, T: f32, live: f32) -> vec3f { // the shot: a hot core in a halo, small bolts, a tail
  if (fp[6].w <= 0.0) { return vec3f(0.0); }
  let cam = vw.cam; let O = fp[5].xyz; let r = fp[5].w; let v = fp[6].xyz; let w0 = cam - O;
  let th = max(dot(O - cam, rd), 0.0); if (th > ts) { return vec3f(0.0); }
  let eh = cam + rd * th - O; let dh = length(eh);
  let bq = dot(rd, v); let cq = max(dot(v, v), 1e-6); let den = cq - bq * bq;
  let sg = clamp(select(0.0, (dot(v, w0) - bq * dot(rd, w0)) / den, den > 1e-6), 0.0, 1.0);
  let Pt = O + v * sg; let tr = max(dot(Pt - cam, rd), 0.0); let dt = length(cam + rd * tr - Pt);
  let head = exp(-dh * dh / (r * r)) * 7.0 + pow(r / (dh + r), 3.0) * (1.3 + 0.3 * live * sin(T * 43.0));
  let trail = exp(-dt * dt / (r * r * 0.4)) * (1.0 - sg) * (1.0 - sg) * 2.5;
  let bz = bolts(eh, r * 2.4, T * 1.7, 5.0, th * vw.tn * 2.0 / vw.size.y / (r * 2.4)) * 2.0 * live;
  let mid = (fp[3].rgb + fp[4].rgb) * 0.5;
  return (mid * (head * 0.6 + trail) + (mid + vec3f(0.45)) * (head * 0.5 + bz)) * fp[6].w;
}
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  vw = viewAt(fc.xy);
  if (vw.size.x <= 0.0) { return vec4f(textureSampleLevel(tA, sL, fc.xy * u.res.zw, 0.0).rgb, 1.0); } // a split-screen divider
  let lp = fc.xy - vw.org; let mode = fp[0].x; let live = 1.0 - fp[0].y; let T = fp[0].z; let S = fp[0].w;
  let cam = vw.cam; let C = fp[1].xyz; let R = max(fp[1].w, 1e-3); let ca = fp[3].rgb; let cb = fp[4].rgb; let hot = (ca + cb) * 0.5 + vec3f(0.45);
  let rd = normalize(ray(lp));
  // the centre on screen (view-local pixels)
  let cv = C - cam; let cz = dot(cv, vw.fwd); let D = length(cv);
  let cs = (vec2f(dot(cv, vw.right) / (vw.tn * vw.asp), -dot(cv, vw.up) / vw.tn) / max(cz, 1e-3) * 0.5 + 0.5) * vw.size;
  let thr = 1.0 + live * (0.30 * sin(T * 11.0) + 0.12 * sin(T * 27.0 + 1.3)); // the throb
  if (mode > 2.5) { // the shot in flight: the frame as it is, plus the orb
    return vec4f(lay(textureSampleLevel(tA, sL, uvOf(lp), 0.0).rgb, orbGlow(rd, distAt(lp), T, live), 3.0), 1.0);
  }
  if (mode > 1.5) { // the cheap way: a ring of ripples from the impact's place on screen, then a wash that hides the swap
    let c2 = select(vw.size * 0.5, cs, cz > 0.0); let v2 = lp - c2; let d = length(v2); let far = length(max(c2, vw.size - c2));
    let x = (d - fp[2].x * far * 1.08) / (vw.size.y * 0.05); let wv = exp(-x * x);
    let off = (v2 / max(d, 1e-3)) * wv * sin(x * 2.6) * vw.size.y * 0.022 * (0.35 + 0.65 * live);
    var c = textureSampleLevel(tA, sL, uvOf(lp + off), 0.0).rgb;
    c = mix(c, c * (vec3f(0.6) + cb * 0.9), smoothstep(0.5, -0.5, x) * 0.35 * S);
    c = lay(c, (mix(cb, ca, sat(x * 0.5 + 0.5)) * 0.9 + hot * pow(wv, 4.0) * 0.7) * wv * S * thr + orbGlow(rd, distAt(lp), T, live), 2.2);
    return vec4f(mix(c, mix(hot, vec3f(1.0), 0.2) * 0.8, fp[2].y * 0.85), 1.0);
  }
  let oc = cam - C; let c0 = dot(oc, oc) - R * R; let inside = c0 < 0.0;
  // sampling offset: a lens across the disc and a shimmer at its rim (camera outside), a punch as the wall passes the camera
  var off = vec2f(0.0);
  let fl = exp(-pow((D - R) / (0.05 * R + 0.8), 2.0));
  if (!inside && cz > 0.0) {
    let b = dot(oc, rd); let rho = sqrt(max(dot(oc, oc) - b * b, 0.0)) / R;
    var dir2 = lp - cs; dir2 = dir2 / max(length(dir2), 1e-3);
    let mag = min(R / cz / vw.tn * vw.size.y * 0.11, vw.size.y * 0.03);
    off = -dir2 * mag * select(exp(-(rho - 1.0) * 14.0), pow(rho, 4.0), rho < 1.0) * S;
    off += (vec2f(vn3(vec3f(lp * 0.045, T * 5.0)), vn3(vec3f(lp * 0.045 + 31.0, T * 5.0))) - 0.5) * exp(-abs(rho - 1.0) * 9.0) * vw.size.y * 0.012 * live * S;
  }
  off += (lp - vw.size * 0.5) * (-0.06 * fl * live * S);
  let lp2 = lp + off; let rd2 = normalize(ray(lp2)); let ta = distAt(lp2);
  let b2 = dot(oc, rd2); let h2 = b2 * b2 - c0; let sq = sqrt(max(h2, 0.0)); let t0 = -b2 - sq; let t1 = -b2 + sq;
  let hit = h2 > 0.0 && t1 > 0.0; let through = hit && ta >= max(t0, 0.0);
  let uv = uvOf(lp2);
  var c = textureSampleLevel(tA, sL, uv, 0.0).rgb; let cB = textureSampleLevel(tB, sL, uv, 0.0).rgb;
  if (through) { c = mix(c, cB, select(1.0 - exp(-(ta - t1) / (0.5 * R + 12.0)), 1.0, ta < t1 || ta > 1e8)); }
  var g = vec3f(0.0);
  let w = (0.018 * R + 0.22) * (0.75 + 0.25 * thr); let gap = 0.085 * R + 0.9;
  let wane = select(1.0, exp(-(R - D) / (0.5 * D + 10.0)), inside); // once the wall has passed the camera its glow falls away
  if (ta < 1e8) { // where the shell cuts realm A's surfaces: the band, its forks along the surface, the echo rings
    let P = cam + rd2 * ta - C; let pr = length(P); let dr = pr - R;
    if (abs(dr) < gap * 4.0 + w * 40.0) {
      let n = P / max(pr, 1e-3);
      let v = veins(n * 5.0 + vec3f(fp[2].z), T * 0.5) * flick(n, T, fp[2].z) * live;
      let e1 = exp(-abs(dr) / w); let e2 = exp(-abs(dr) / (w * 7.0)); let reach = exp(-abs(dr) / (w * (1.5 + 22.0 * v)));
      g += (mix(cb, ca, sat(dr / w * 0.5 + 0.5)) * (e1 * 2.2 + e2 * 0.35) + hot * (pow(e1, 3.0) * 2.5 + v * reach * 5.0)) * thr;
      g += mix(ca, hot, 0.3) * echo(dr, gap, w, T) * live;
    }
  }
  if (hit) { // the sphere itself, where nothing of realm A is in front of it
    let f = 1.0 - sq / R;
    if (t0 > 0.0 && t0 < ta) { g += film(cam + rd2 * t0 - C, R, f, T, live) * thr; }
    if (t1 < ta) { g += film(cam + rd2 * t1 - C, R, f, T, select(0.0, live, inside)) * thr * select(0.25, 0.8 * wane, inside); } // seen from outside, the far wall is the film alone
  }
  if (!inside) { // round the silhouette: a halo, the echo rings, the bolts
    let tc = -b2; let e = oc + rd2 * tc; let x = length(e) - R;
    if (tc > 0.0 && tc < ta) {
      if (x > 0.0) { g += ca * exp(-x / (0.05 * R + 0.25)) * 0.9 * thr + ca * echo(x, gap, w, T) * 0.55 * live; }
      g += hot * bolts(e, R, T, fp[2].z, tc * vw.tn * 2.0 / vw.size.y / R) * 3.0 * live;
    }
  }
  g += hot * fl * (0.25 + 0.45 * live);
  // the cap: tighter while the camera is at the shell or inside it, so the swallow stays readable
  let near = exp(-pow((D - R) / (0.3 * R + 3.0), 2.0));
  let cap = min(2.4 * (1.0 - 0.6 * near), select(2.4, 0.35 + 0.75 * wane, inside));
  return vec4f(lay(lay(c, g * S, cap), orbGlow(rd2, ta, T, live), 3.0), 1.0);
}`;

  // ---------------------------------------------------------------- state
  const st = { on: 0, calm: 0, c: new Float32Array(3), r: 0, k: 0, wash: 0, seed: 0, strength: 0, ca: new Float32Array([0.16, 1.0, 0.82]), cb: new Float32Array([0.62, 0.30, 1.0]),
    time: 0, orb: new Float32Array(4), tail: new Float32Array(4) };
  let tsc = 1, tsT = 1, swallowed = true, seen = false, dur = 2, mRate = 1, mLp = 0, bars = null, beatT = 0, quiet = false, tSw = -1;
  const cine = { on: 0, t: 0, w: 0, fov: 0, roll: 0, push: 0, a0: 0, sgn: 1, fresh: false }; // on: 1 the first-time sweep, 2 the quick push-in
  let G = null, H = null, asked = false, phase = 0, pt = 0, flight = 0, D0 = 25, PW = 3, owner = 0, hitRock = false, shotN = 0, fdt = 1 / 60, gms = 0, BR = null;
  const OP = new Float64Array(3), IP = new Float64Array(3);
  // api.world: who supplies the next realm. ready(): its pack is resident (asks for it otherwise) · begin(aux): the spread starts
  // (aux: render it alongside, G.realmAux) · colours(ca, cb): the old and the new realm's glow · swallow(): the swap, with its
  // bookkeeping and the new track · cancel() · tape(rate, lp): the music's tape-slow and low-pass (optional)
  const api = { TUNE, state: st, cine, world: null, onImpact: null, onTime: null, blocked: null, attach, fire, step, present, poll, reset, busy, lab, standIn, skip, cineApply, timeStop, timeGo, beat, cineStart,
    get timeScale() { return tsc; }, get phase() { return phase; }, get cheap() { return cheap(); }, get handle() { return H; } };
  const cheap = () => OPT === 'cheap' || (OPT !== 'full' && OPT !== 'calm' && (gms > 15 || fdt > 0.024));
  const grow = (k) => { const x = k / TUNE.swallow; return TUNE.burst * (1 - exp(-k / 0.06)) + (1 - TUNE.burst) * pow(x, x < 1 ? 2.6 : PW); }; // a burst, then a swell that reaches the camera at k = swallow
  const far = (d) => { D0 = max(TUNE.minD, d); PW = Math.log(((D0 + TUNE.far) / D0 - TUNE.burst) / (1 - TUNE.burst)) / Math.log(1 / TUNE.swallow); };
  function spread(k, fade) { st.on = 1; st.k = k; st.r = D0 * grow(k); st.strength = min(1, k * 10) * (1 - fade); }
  function ripple(u) { // u: seconds since the impact. The ring, the wash, the swap behind the wash, the wash clearing
    const k = u / TUNE.cheapDur; st.on = 2; st.strength = min(1, k * 8);
    if (k < 1) { st.k = k; st.wash = sstep(0.6, 1, k); return false; }
    st.k = 2; st.wash = 1 - sstep(0, TUNE.cheapFade, u - TUNE.cheapDur); return true;
  }
  function orbAt(a, glow) { // a: 0..1 along the flight
    const dx = IP[0] - OP[0], dy = IP[1] - OP[1], dz = IP[2] - OP[2], L = hypot(dx, dy, dz) || 1, tl = -min(TUNE.tail, L * a) / L;
    st.orb[0] = OP[0] + dx * a; st.orb[1] = OP[1] + dy * a; st.orb[2] = OP[2] + dz * a; st.orb[3] = TUNE.orb * (0.7 + 0.3 * a);
    st.tail[0] = dx * tl; st.tail[1] = dy * tl; st.tail[2] = dz * tl; st.tail[3] = glow;
  }

  // ---------------------------------------------------------------- game side
  function attach(G_) {
    G = G_; st.calm = REDUCED || OPT === 'calm' ? 1 : 0;
    // bounding radius of each solid mesh (vertices: 16 bytes, position first), for the ray cast
    BR = new Float32Array(G.meshes.length);
    for (let m = 0; m < G.meshes.length; m++) { const f = new Float32Array(G.meshes[m].vb.buffer || G.meshes[m].vb); let r2 = 0; for (let i = 0; i + 2 < f.length; i += 4) r2 = max(r2, f[i] * f[i] + f[i + 1] * f[i + 1] + f[i + 2] * f[i + 2]); BR[m] = sqrt(r2) * 0.8; }
    addEventListener('keydown', (e) => { if ((e.code === 'KeyF' || e.code === 'Digit3' || e.code === 'Numpad3') && !e.repeat) tKey = performance.now(); /* key 3 too (carpetshark: 'can we just make #3 be the one that does it') */ });
    addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse' && e.button === 2) tKey = performance.now(); });
    if (PQ.has('debug')) { window.PULSE = api; api.grab = (n) => G.grab(n); } // tests: the state, and frames saved through serve.py
    if (typeof document !== 'undefined' && !bars) { // the sweep's letterbox bars; the HUD layers fade out under body.pcine
      const s = document.createElement('style');
      s.textContent = '.pbar{position:fixed;left:0;right:0;height:0;background:#000;z-index:9;pointer-events:none;transition:height .4s ease}body.pcine .pbar{height:9vh}' +
        '#sgh,#tthud,#rrcock,#rrchain,#rrnav,#rrholo,#rrsec,#cmbhud,#sgmp,#sgvis,#sgglass,#sgdashg,.stamp{transition:opacity .3s}' + ['#sgh', '#tthud', '#rrcock', '#rrchain', '#rrnav', '#rrholo', '#rrsec', '#cmbhud', '#sgvis', '#sgglass', '#sgdashg', '.stamp'].map((q) => 'body.pcine ' + q).join(',') + '{opacity:0!important}';
      document.head.appendChild(s); bars = [0, 1].map((i) => { const b = document.createElement('div'); b.className = 'pbar'; b.style[i ? 'bottom' : 'top'] = '0'; document.body.appendChild(b); return b; });
    }
    return api;
  }
  // first solid along a ray (bounding spheres of every instance; hidden ones have scale 0), from `near` to `range`
  function cast(ex, ey, ez, dx, dy, dz) {
    let best = TUNE.range;
    for (let m = 0; m < G.meshes.length; m++) {
      const I = G.meshes[m].inst, rad = BR[m];
      for (let k = 0; k < I.length; k += 12) {
        const R = I[k + 3] * rad; if (!(R > 0)) continue;
        const fx = ex - I[k], fy = ey - I[k + 1], fz = ez - I[k + 2], b = fx * dx + fy * dy + fz * dz; if (b > 0) continue;
        const h = b * b - (fx * fx + fy * fy + fz * fz - R * R); if (h < 0) continue;
        const t = -b - sqrt(h); if (t > TUNE.near && t < best) best = t;
      }
    }
    return best;
  }
  function busy() { return phase !== 0 || !H || !api.world || !api.world.ready() || !!(api.blocked && api.blocked()); }
  // p: the player; (x0, y0, z0): where the orb leaves the ship; (ex, ey, ez) + (dx, dy, dz): the aim ray (unit direction); np: players
  function fire(p, x0, y0, z0, ex, ey, ez, dx, dy, dz, np) {
    if (busy()) return false; nP = np || 1;
    const t = cast(ex, ey, ez, dx, dy, dz); hitRock = t < TUNE.range;
    IP[0] = ex + dx * t; IP[1] = ey + dy * t; IP[2] = ez + dz * t; OP[0] = x0; OP[1] = y0; OP[2] = z0;
    flight = max(0.12, hypot(IP[0] - x0, IP[1] - y0, IP[2] - z0) / TUNE.speed); phase = 1; pt = 0; owner = p; shotN++;
    api.world.colours(st.ca, st.cb); orbAt(0, 1); return true;
  }
  function step(dt, ex, ey, ez, gpuMs) {
    if (dt > 0) { fdt += (dt - fdt) * 0.05; if (gpuMs > 0) gms += (gpuMs - gms) * 0.05; }
    st.time += dt; timeStep(dt); cineStep(dt);
    if (!phase) return;
    pt += dt;
    if (phase === 1) {
      const a = min(1, pt / flight); orbAt(a, 1);
      if (a >= 1) {
        st.c[0] = IP[0]; st.c[1] = IP[1]; st.c[2] = IP[2]; far(hypot(ex - IP[0], ey - IP[1], ez - IP[2]));
        st.seed = (shotN * 7.13) % 50; phase = cheap() || nP > 2 ? 3 : 2; pt = 0; tSw = -1; // three or four views: the ripple (a second realm in every view costs too much)
        const sweep = phase === 2 && !st.calm && nP < 2 && (OPT === 'sweep' || (!seen && OPT !== 'quick')); seen = true; dur = sweep ? TUNE.sweepDur : TUNE.dur;
        api.world.begin(phase === 2); api.world.colours(st.ca, st.cb);
        quiet = false; timeStop(); if (!st.calm) cineStart(sweep ? 1 : 2);
        if (phase === 2) spread(0, 0); else ripple(0);
        if (api.onImpact) api.onImpact(IP[0], IP[1], IP[2], owner, hitRock);
      }
    } else if (phase === 2) {
      const k = min(1, pt / dur); st.tail[3] = max(0, 1 - pt * 5);
      spread(k, tSw < 0 ? 0 : sstep(0, TUNE.after, pt - tSw));
      if (tSw < 0 && (k >= 1 || st.r >= hypot(ex - st.c[0], ey - st.c[1], ez - st.c[2]))) { tSw = pt; api.world.swallow(); timeGo(); } // the bubble has the ship: the realms swap, time snaps back
      if (tSw >= 0 && pt - tSw >= TUNE.after) done();
    } else {
      st.tail[3] = max(0, 1 - pt * 5);
      if (ripple(pt) && tSw < 0) { tSw = pt; api.world.swallow(); timeGo(); } // swapped behind the wash
      if (pt >= TUNE.cheapDur + TUNE.cheapFade) done();
    }
  }
  function done() { st.on = 0; st.tail[3] = 0; st.wash = 0; phase = 0; timeGo(); api.world.ready(); } // and ask for the realm after this one
  function reset() { if (phase && api.world) api.world.cancel(); phase = 0; st.on = 0; st.tail[3] = 0; st.wash = 0; swallowed = true; beatT = 0; tsT = tsc = 1; music(); cineEnd(); }
  // every frame, paused or not (the game's post): hand the composite to the engine while there is something to draw
  function prep() { if (!asked && G.finalPrepare) { asked = true; G.finalPrepare(WGSL, 27).then((h) => { H = h; }).catch((e) => console.error('PULSE ' + e.message)); } } // the engine adds finalPrepare after the scene is built
  function present() {
    if (!H) { prep(); return; }
    const mode = OFFP ? 0 : st.on || (st.tail[3] > 0 ? 3 : 0);
    if (!mode) { if (H.on) H.on = false; return; }
    const P = H.params, V = G.views, n = V && V.n > 1 && !IS_SHOT ? min(4, V.n | 0) : 0;
    P[0] = mode; P[1] = st.calm; P[2] = st.time; P[3] = st.strength;
    P[4] = st.c[0]; P[5] = st.c[1]; P[6] = st.c[2]; P[7] = st.r;
    P[8] = st.k; P[9] = st.wash; P[10] = st.seed; P[11] = n;
    for (let i = 0; i < 3; i++) { P[12 + i] = st.ca[i]; P[16 + i] = st.cb[i]; }
    for (let i = 0; i < 4; i++) { P[20 + i] = st.orb[i]; P[24 + i] = st.tail[i]; }
    for (let v = 0; v < n; v++) {
      const o = 28 + v * 20, c = v * 6, b = v * 9, x = v * 4;
      P[o] = V.cam[c]; P[o + 1] = V.cam[c + 1]; P[o + 2] = V.cam[c + 2]; P[o + 3] = Math.tan(V.cam[c + 5] / 2);
      P[o + 4] = V.B[b]; P[o + 5] = V.B[b + 1]; P[o + 6] = V.B[b + 2]; P[o + 7] = V.aspect[v];
      P[o + 8] = V.B[b + 3]; P[o + 9] = V.B[b + 4]; P[o + 10] = V.B[b + 5]; P[o + 12] = V.B[b + 6]; P[o + 13] = V.B[b + 7]; P[o + 14] = V.B[b + 8];
      P[o + 16] = V.px[x]; P[o + 17] = V.px[x + 1]; P[o + 18] = V.px[x + 2]; P[o + 19] = V.px[x + 3];
    }
    H.on = true; G.final = H;
  }

  // ---------------------------------------------------------------- time-stop, the music's "wub-blub", the camera (shared: the Z warp calls beat())
  // timeStop(): the game's time scale (api.timeScale, which the game multiplies into its dt) falls to TUNE.slow in about 0.3 s,
  // and the music follows it down: api.world.tape(rate, lp) slows the track (pitch sagging) and closes a low-pass over it.
  // timeGo(): time snaps back, the music opens up again. api.onTime('timestop' | 'timego') tells the game (sounds, a kick).
  // beat(s): a brief time-stop of s seconds with the quick camera and no music processing (the Z warp keeps its own dub-out).
  // cineStart(1): the first-time sweep, TUNE.sweep s: the camera leaves the turret and arcs round the ship, looking past it at the
  // bubble, under letterbox bars with the HUD hidden; skip() eases back early. cineStart(2): the quick version, TUNE.quick s:
  // a push-in with the FOV pulling wide (a dolly-zoom) and a slight roll. The game applies them: cine.fov / cine.roll / cine.w
  // (how far the camera has left the player's view) and cineApply(F, ...) after it has placed its own camera.
  function timeStop(scale) { swallowed = false; tsT = scale || (st.calm ? TUNE.slowCalm : TUNE.slow); if (api.onTime) api.onTime('timestop'); }
  function timeGo() {
    if (swallowed) return; swallowed = true; beatT = 0; tsT = 1;
    if (!quiet && api.world && api.world.tape) { api.world.tape(1, 0); mRate = 1; mLp = 0; } quiet = true; // the music opens at once (the new track is already in), not along the ramp back
    if (api.onTime) api.onTime('timego');
  }
  function beat(s) { if (phase || !swallowed) return; quiet = true; beatT = s; timeStop(st.calm ? 0.6 : TUNE.slowBeat); if (!st.calm) cineStart(2); }
  function timeStep(dt) {
    if (beatT > 0 && (beatT -= dt) <= 0) timeGo();
    if (tsc === tsT) return; tsc += (tsT - tsc) * (1 - exp(-dt / (tsT < 1 ? 0.09 : 0.05))); if (abs(tsc - tsT) < 0.004) tsc = tsT; music();
  }
  function music() {
    if (quiet || !api.world || !api.world.tape) return;
    const k = clamp((1 - tsc) / (1 - TUNE.slow), 0, 1), r = round(mix(1, TUNE.wub, k) * 50) / 50, l = round(k * 25) / 25;
    if (r !== mRate || l !== mLp) { mRate = r; mLp = l; api.world.tape(r, l); }
  }
  function cineStart(kind) { cine.on = kind; cine.t = 0; cine.fresh = true; cine.sgn = shotN & 1 ? 1 : -1; if (kind === 1 && typeof document !== 'undefined') document.body.classList.add('pcine'); }
  function cineEnd() { cine.on = 0; cine.w = cine.fov = cine.roll = cine.push = 0; if (typeof document !== 'undefined') document.body.classList.remove('pcine'); }
  function skip() { if (cine.on === 1 && cine.t > 0.3 && cine.t < TUNE.sweep - 0.8) cine.t = TUNE.sweep - 0.8; }
  function cineStep(dt) {
    if (!cine.on) return; cine.t += dt;
    if (cine.on === 1) {
      const T = TUNE.sweep; cine.w = sstep(0, 0.6, cine.t) * (1 - sstep(T - 0.8, T, cine.t));
      if (cine.t > T - 0.8 && typeof document !== 'undefined') document.body.classList.remove('pcine');
      if (cine.t >= T) cineEnd();
    } else {
      const u = cine.t / TUNE.quick, b = sstep(0, 0.2, u) * (1 - sstep(0.3, 1, u));
      cine.fov = 0.26 * b; cine.push = 1.5 * b; cine.roll = 0.05 * b * cine.sgn; if (u >= 1) cineEnd();
    }
  }
  // F: the engine's camera as the game has just set it (0..2 eye, 3 yaw, 4 pitch, 11 fov); (sx, sy, sz): the ship; B: the look basis
  function cineApply(F, sx, sy, sz, B, collide) {
    if (cine.on === 2) { F[0] += B[0] * cine.push; F[1] += B[1] * cine.push; F[2] += B[2] * cine.push; return; }
    if (cine.fresh) { cine.fresh = false; cine.a0 = F[3]; }
    const w = cine.w; if (!(w > 0)) return;
    const u = sstep(0, 1, min(1, cine.t / (TUNE.sweep - 0.6))), a = cine.a0 + PI + cine.sgn * TUNE.arc * u, rad = 7.5 + 5 * sin(PI * u), h = 1.8 + 3.2 * u;
    const px = sx + sin(a) * rad, py = sy + h, pz = sz + cos(a) * rad;
    // look past the ship toward the bubble's centre
    let tx = st.c[0] - sx, ty = st.c[1] - sy, tz = st.c[2] - sz; const tl = min(1, 5 / (hypot(tx, ty, tz) || 1)); tx = sx + tx * tl - px; ty = sy + ty * tl - py; tz = sz + tz * tl - pz;
    const l1 = hypot(tx, ty, tz) || 1, cp = cos(F[4]);
    let dx = mix(sin(F[3]) * cp, tx / l1, w), dy = mix(sin(F[4]), ty / l1, w), dz = mix(cos(F[3]) * cp, tz / l1, w); const dl = hypot(dx, dy, dz) || 1;
    F[0] = mix(F[0], px, w); F[1] = mix(F[1], py, w); F[2] = mix(F[2], pz, w); F[3] = atan2(dx, dz); F[4] = Math.asin(clamp(dy / dl, -1, 1)); F[11] = mix(F[11], 0.95, w);
    if (collide) collide(F);
  }
  // alt-fire: F, the right mouse button, or a gamepad's left bumper. Returns the player who pressed it this frame, or -1.
  let tKey = -1e9, nP = 1; const PB = new Uint8Array(16), IS_SHOT = PQ.has('shot');
  function poll(input, mp, np) {
    let p = -1; const now = performance.now();
    if (now - tKey < 200) { tKey = -1e9; p = 0; if (mp) { p = -1; for (let s = 0; s < np; s++) if (input.mp.p[s].dev === 'kbm') p = s; } }
    const gp = navigator.getGamepads ? navigator.getGamepads() : null;
    if (gp) for (let i = 0; i < gp.length && i < 16; i++) {
      const q = gp[i], d = q && q.connected && q.buttons[4] && q.buttons[4].pressed ? 1 : 0;
      if (d && !PB[i] && p < 0) { if (!mp) p = 0; else for (let s = 0; s < np; s++) if (input.mp.p[s].dev === 'pad' && input.mp.p[s].pad === i) p = s; }
      PB[i] = d;
    }
    return p;
  }


  // ---------------------------------------------------------------- lab (pulse-lab.html): a fixed rock, on a loop
  // Each loop: the orb flies in (0.6 s), the next realm spreads until it has the camera, its afterglow recedes, the new realm
  // holds; three looks cycle (the scene's own and two stand-ins, as engine realm packs). Everything is a function of the time,
  // so ?shot=<pose>&t=<s> is a fixed frame. ?t= also freezes a live page at that moment (the crackle still runs); ?hold=<0..1>
  // holds the spread at that progress; ?n= picks the loop (the realm pair). ?pulse=calm (reduced motion) · cheap (the ripple).
  // Poses: 0 the concept camera, 1 wide, 2 close on the shell, 3 far.
  let labT = 0, labS = 0, labN = 0;
  const LAB = { fly: 0.6, hold: 2.0, glow: [[0.16, 1.0, 0.82], [0.62, 0.30, 1.0], [1.0, 0.20, 0.34]] };
  function lab(scene) {
    const base = scene.build;
    scene.build = () => {
      const g = base(); attach(g);
      const p = g.poses[0], cy = cos(p[3]), sy = sin(p[3]), cp = cos(p[4]), sp = sin(p[4]), t = Math.tan(p[5] / 2), nx = -0.02 * t * 1456 / 816, ny = -0.32 * t;
      let dx = sy * cp + cy * nx - sp * sy * ny, dy = sp + cp * ny, dz = cy * cp - sy * nx - sp * cy * ny; const dl = hypot(dx, dy, dz); dx /= dl; dy /= dl; dz /= dl;
      const d = cast(p[0], p[1], p[2], dx, dy, dz), cx = p[0] + dx * d, cyy = p[1] + dy * d, cz = p[2] + dz * d; // the centre rock of the concept view (NR-R4)
      const look = (x, y, z, fov) => { const ex = cx - x, ey = cyy - y, ez = cz - z; return [x, y, z, atan2(ex, ez), Math.asin(ey / hypot(ex, ey, ez)), fov]; };
      g.poses.length = 1; g.poses.push(look(cx - 16, cyy - 5, cz - 34, 1.0), look(cx + 2.2, cyy + 0.8, cz - 5.5, 1.05), look(cx + 30, cyy + 12, cz - 70, 0.9));
      const per = LAB.fly + TUNE.dur + LAB.hold, cheapLab = OPT === 'cheap', packs = [null, null, null]; let asked2 = false;
      g.shotHold = true; // a fixed frame waits for the stand-in packs and the composite
      g.post = (F) => {
        prep(); if (!asked2 && g.realmPack) { asked2 = true; packs[0] = g.realmInitial; for (let k = 1; k < 3; k++) g.realmPack(Object.assign({}, scene, { id: scene.id + '-b' + k, wgsl: standIn(scene.wgsl, k) })).then((q) => { packs[k] = q; }); }
        if (!H || !packs[1] || !packs[2]) return; g.shotHold = false;
        let T = PQ.has('t') ? +PQ.get('t') || 0 : F[8]; if (PQ.has('hold')) T = (+PQ.get('n') || 0) * per + LAB.fly + clamp(+PQ.get('hold') || 0, 0, 1) * (cheapLab ? TUNE.cheapDur + TUNE.cheapFade : TUNE.dur) - 1e-4;
        const n = floor(T / per), u = T - n * per - LAB.fly, a = ((n % 3) + 3) % 3, b = (a + 1) % 3, dist = hypot(F[0] - cx, F[1] - cyy, F[2] - cz);
        for (let i = 0; i < 3; i++) { st.ca[i] = LAB.glow[a][i]; st.cb[i] = LAB.glow[b][i]; } st.seed = (n * 7.13) % 50;
        st.c[0] = cx; st.c[1] = cyy; st.c[2] = cz; far(dist); st.time = F[8];
        OP[0] = p[0] + 1.2; OP[1] = p[1] - 1.0; OP[2] = p[2] + 0.5; IP[0] = cx; IP[1] = cyy; IP[2] = cz;
        st.on = 0; st.wash = 0; st.tail[3] = 0; let main = a, aux = -1;
        if (u < 0) orbAt(1 + u / LAB.fly, 1);
        else if (cheapLab) { orbAt(1, max(0, 1 - u * 5)); if (u < TUNE.cheapDur + TUNE.cheapFade) { if (ripple(u)) main = b; } else main = b; }
        else {
          orbAt(1, max(0, 1 - u * 5)); let ks = 0; while (ks < 1 && D0 * grow(ks) < dist) ks += 0.004; // when the shell reaches this camera
          const us = ks * TUNE.dur;
          if (u < us) { spread(u / TUNE.dur, 0); aux = b; } else { main = b; if (u < us + TUNE.after) spread(min(1, u / TUNE.dur), sstep(0, TUNE.after, u - us)); }
        }
        g.realmUse(packs[main]); g.realmAux = aux < 0 || OFFP ? null : packs[aux];
        present(); if (PQ.has('debug')) { const now = performance.now(); if (labT) { labS += now - labT; labN++; } labT = now; window.pulseLab = { ms: labS / max(1, labN), n: labN }; } // tests: the mean frame interval
      };
      return g;
    };
  }
  return api;
})();
