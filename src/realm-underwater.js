// ============================================================================
// realm-underwater.js: Reef Run's fourth realm, Underwater (GAME_API.md "Underwater realm"). carpetshark: "and add back in the
// underwater", read as the Abyssal Garden this project grew out of. The look and most techniques are ported, after Abyssal
// Garden by Maksymilian Dendura (MIT), from docs/research/abyssal-garden-source (src/shaders.js, src/world.js, commit a596354):
// the per-channel absorption fog and its in-scatter (fogIn / fog), depth-attenuated sunlight (sunE), the ambient and side
// light (amb / side), the caustic function, the water surface seen from below (Snell's window, refraction, ripples), the
// raymarched light shafts, the tone map and grade, kelp columns of spiralling stems and blades with gold / green sparkle,
// barrel sponges (meshLathe profiles), branching coral (meshCoral), the sunken ship (meshShip), the stone whale fluke (its
// capsule chains), the manta (meshManta) and the fish school orbit. Decomposition and loss ledger:
// experiments/space-garden/concept/underwater/DECOMPOSITION.md (IDs UW-xx below refer to it).
//
// Like Space Inside and the body, the realm is a scene pack built ALONG REEF'S RAIL (realms.js meshesFor / pointsFor): a
// sandy canyon with rock walls and an open top, kelp walls, landmarks (the sunken ship, the stone whale tail, a purple
// grotto stretch), sponges, coral, ground cover, floating boulders, mantas, fish schools, bubbles and drifting motes. The
// game's targets are reskinned as sea urchins, spiky puffers and jelly blobs; gameplay is untouched.
// Registered with realms.js through REALM_EXT (this file loads first). Geometry is built once on first use; per frame only
// the mantas and the kelp sway write into preallocated instance arrays (no allocation).
// ============================================================================
const REALM_EXT = (() => {
  // ---------------------------------------------------------------- tables
  const SURF = 66; // world y of the water surface (the rail runs from y -22 to 52 below it)
  const DEPTH_K = 0.55; // world metres → upstream metres below the surface, so the rail spans upstream's -8 .. -48 m (I)
  const SUN = (() => { const v = [0.27, 1, -0.24], l = hypot(...v); return v.map((c) => c / l); })(); // upstream main.js SUN
  const AT = { ship: 0.2, fluke: 0.46, g0: 0.63, g1: 0.8 }; // landmark places as fractions of sHero..sGate (UW-L1..L3)
  const KELP = { step: [3.8, 5.8], u: [11.5, 15], back: 0.45, specks: 3 }; // kelp walls (UW-K1): spacing, offset, second row, glints
  // canyon cross-sections (u right, v up, metres from the rail): open water above, sand below, rock walls (UW-C1, UW-C2)
  const PROF = [[-19, 26], [-17.5, 12], [-16, 2], [-14, -6], [-9, -10.5], [0, -11.5], [9, -10.5], [14, -6], [16, 2], [17.5, 12], [19, 26]];
  const PROF_G = [[-6, 24], [-11, 17], [-15, 8], [-14.5, -3], [-10, -10], [0, -11.5], [10, -10], [14.5, -3], [15, 8], [11, 17], [6, 24]]; // grotto: overhangs, a slot of light (UW-L3)
  const NPROF = 44, DS = 1.5;

  const DBG = (typeof QS !== 'undefined' ? QS : new URLSearchParams(location.search)).get('uw') || ''; // cost probes: ?uw=nokelp,nocaus,norays,nosolids
  let A = null, LM = null, built = null;
  const C3 = [0, 0, 0], FRm = new Float64Array(9);
  const railAt = (s, u, v, o) => { A.rail.at(s, C3); A.rail.frame(s, FRm); o[0] = C3[0] + FRm[3] * u + FRm[6] * v; o[1] = C3[1] + FRm[4] * u + FRm[7] * v; o[2] = C3[2] + FRm[5] * u + FRm[8] * v; return o; };
  // landmark positions along the rail (depend only on the rail, so the WGSL and the geometry agree)
  function marks() {
    if (LM) return LM;
    const s0 = A.sHero, span = A.sGate - A.sHero, at = (f) => s0 + span * f;
    LM = { ship: at(AT.ship), fluke: at(AT.fluke), g0: at(AT.g0), g1: at(AT.g1), gz: [] };
    for (let i = 0; i < 5; i++) { const s = mix(LM.g0, LM.g1, (i + 0.5) / 5), p = railAt(s, 0, 0, [0, 0, 0]); LM.gz.push([p[0], p[1], p[2], (LM.g1 - LM.g0) / 5 * 0.9 + 6]); }
    return LM;
  }
  // the ship and the tail stand in bays cut into the right / left wall (UW-L1, UW-L2): how far that wall steps back at s
const bayR = (s) => 12 * sstep(LM.ship - 34, LM.ship - 14, s) * sstep(LM.ship + 34, LM.ship + 14, s), bayL = (s) => 11 * sstep(LM.fluke - 30, LM.fluke - 12, s) * sstep(LM.fluke + 30, LM.fluke + 12, s);
  const grottoW = (s) => sstep(LM.g0 - 25, LM.g0 + 8, s) * sstep(LM.g1 + 25, LM.g1 - 8, s);
  const f3 = (v) => v.toFixed(3);

  // ---------------------------------------------------------------- the scene (WGSL): upstream's light model in this engine's scene contract
  function scene(A_) {
    A = A_; marks();
    const gz = LM.gz.map((g) => `vec4f(${f3(g[0])}, ${f3(g[1])}, ${f3(g[2])}, ${f3(g[3])})`).join(', ');
    return {
      id: 'underwater', sun: SUN.slice(), p0: [0, 0, 0, 0], p1: [0, 0, 0, 0],
      meshLight: { key: [1.05, 1.08, 1.0], ambUp: [0.22, 0.48, 0.62], ambDown: [0.05, 0.13, 0.19], wrap: 0.4, rim: [0.2, 0.45, 0.55], rimPow: 2, rimBack: 0 },
      wgsl: /*wgsl*/`
// after Abyssal Garden by Maksymilian Dendura (MIT): constants of src/shaders.js S_G
const SIG = vec3f(0.058, 0.0235, 0.0195);
const KD = vec3f(0.056, 0.0245, 0.0170);
const KDZ = vec3f(0.034, 0.023, 0.018);
const KDF = vec3f(0.043, 0.045, 0.042);
const WCOL = vec3f(0.16, 0.58, 0.90);
const PCOL = vec3f(0.58, 0.66, 0.98);
const SUNC = vec3f(1.7, 1.6, 1.45);
const SURF = ${SURF.toFixed(1)};
const DK = ${DEPTH_K};
const GZ = array<vec4f, 5>(${gz});
fn ss(a: f32, b: f32, x: f32) -> f32 { let t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
fn dep(y: f32) -> f32 { return min((y - SURF) * DK, -0.5); } // upstream metres (negative below the surface)
fn zoneAt(p: vec3f) -> f32 { var z = 0.0; for (var i = 0; i < 5; i++) { let g = GZ[i]; z = max(z, ss(g.w * 1.6, g.w, distance(p, g.xyz))); } return z; } // UW-L3 purple grotto
fn kd(z: f32) -> vec3f { return mix(KD, KDZ, z); }
fn sg(z: f32) -> vec3f { return mix(SIG, vec3f(0.034, 0.026, 0.022), z); }
fn fogIn(roy: f32, rd: vec3f, d: f32, z: f32) -> vec3f {
  let k = mix(KD, KDF, z); let a = sg(z) - k * rd.y * DK; let I = (1.0 - exp(-a * d)) / a;
  let mu = max(dot(rd, u.sun.xyz), 0.0); let m2 = mu * mu;
  return mix(WCOL, PCOL, z) * sg(z) * exp(k * roy) * I * (1.22 + 0.3 * m2 * m2);
}
fn sunE(y: f32, z: f32) -> vec3f { let d = dep(y); return SUNC * exp(kd(z) * (d / u.sun.y)) * (0.5 + 0.5 * sat(-d / 30.0)); }
fn ambB(p: vec3f, z: f32, open: f32) -> vec3f { let d = dep(p.y); return mix(vec3f(0.22, 0.60, 0.80), vec3f(0.34, 0.56, 0.82), z) * exp(kd(z) * d * 1.2) * (0.3 + 0.7 * open) * 1.3 * (0.55 + 0.45 * sat(-d / 30.0)); }
fn ambN(b: vec3f, ny: f32) -> vec3f { let up = ny * 0.5 + 0.5; return b * (0.24 + 0.76 * up * up) + vec3f(0.003, 0.010, 0.016); } // the ambient's base is shared by its look-ups
fn amb(p: vec3f, n: vec3f, z: f32, open: f32) -> vec3f { return ambN(ambB(p, z, open), n.y); }
fn side(p: vec3f, n: vec3f, z: f32, open: f32) -> vec3f { return mix(WCOL, PCOL, z) * exp(kd(z) * dep(p.y)) * open * (1.0 - abs(n.y)) * 0.7; }
fn sky(rd: vec3f) -> vec3f {
  let z = u.p0.w; let y0 = dep(u.cam.y); var ds = 400.0; var c = vec3f(0.0);
  if (rd.y > 0.015 && !${DBG.includes('nosky')}) { // UW-S1 the surface from below: Snell's window, refraction, ripples (upstream W_SURF)
    ds = min((SURF - u.cam.y) / rd.y, 400.0);
    let sp = u.cam.xyz + rd * ds; let t = u.cam.w; let fl = ss(260.0, 60.0, ds);
    let s = (vec2f(vn3(vec3f(sp.xz / 3.2, t * 0.35)), vn3(vec3f(sp.zx / 3.2 + 5.0, t * 0.3))) - 0.5 + (vec2f(vn3(vec3f(sp.xz / 1.1, t * 0.6)), vn3(vec3f(sp.zx / 1.1 + 9.0, t * 0.55))) - 0.5) * 0.7) * fl * 0.8;
    let n = normalize(vec3f(-s.x * 0.8, -1.0, -s.y * 0.8));
    let ci = sat(dot(rd, -n)); let k = 1.0 - 1.769 * (1.0 - ci * ci); let win = ss(0.0, 0.22, k);
    let rr = refract(rd, n, 1.33); let sd = max(dot(rr, u.sun.xyz), 0.0); let fr = pow(1.0 - sqrt(max(k, 0.0)), 5.0);
    let top = (vec3f(0.30, 0.78, 1.0) * 1.3 * clamp(1.0 + 3.8 * (s.x * 0.6 - s.y * 0.8), 0.25, 3.0) + vec3f(1.0, 0.95, 0.85) * (pow(sd, 60.0) * 1.3 + pow(sd, 500.0) * 12.0)) * (1.0 - fr);
    let refl = fogIn(-0.5, reflect(rd, n), 300.0, z) * 1.15;
    c = mix(refl, top, win) * exp(-sg(z) * ds / DK);
  }
  return c + fogIn(y0, rd, ds / DK, z); // the light path to the surface at upstream depth (the rail runs shallower than it reads)
}
fn fogApply(c: vec3f, wp: vec3f, d: f32) -> vec3f {
  let rd = (wp - u.cam.xyz) / max(d, 1e-3); let z = u.p0.w; // the camera's grotto zone (a uniform: this runs for every fragment and point)
  return c * exp(-sg(z) * d) * ss(230.0, 185.0, d) + fogIn(dep(u.cam.y), rd, d, z);
}
// upstream W_WATER caus(): the caustic network, here evaluated in place of its baked texture
fn causF(uv: vec2f, t: f32) -> f32 {
  let p = uv * 6.2831853; var i = p; var c = 0.0;
  for (var n = 1; n <= 4; n++) {
    let tt = t * (1.0 - 3.5 / f32(n));
    i = p + vec2f(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    let s = sin(i.x + tt); let k = cos(i.y + tt);
    c += abs(s * k) / (1.25 * sqrt(s * s + k * k) + 1e-4);
  }
  c = 1.17 - pow(c / 4.0, 1.4); return pow(abs(c), 8.0);
}
fn caus(p: vec3f, d: f32) -> vec3f { // UW-F2 caustics: the sun's pattern projected down from the surface
  if (d > 100.0 || ${DBG.includes('nocaus')}) { return vec3f(0.33); }
  let q = p.xz - u.sun.xz * ((p.y - SURF) / u.sun.y); let t = u.cam.w * 0.45 + 23.0;
  let a = causF(q / 3.3, t); let b = vn3(vec3f(q.yx / 6.9, t * 0.1)); // upstream's second, slower caustic layer as cheap noise (cost)
  let c = min(pow(a, 2.3) * 5.0 * (0.45 + b * 1.3), 4.0);
  let cs = 0.33 + 0.42 * c; // the holes keep the far value (0.33), so the net reads as light, not as dark spots
  return mix(vec3f(cs * 0.9, cs, cs * 1.08), vec3f(0.33), ss(35.0, 100.0, d));
}
fn pal(h: f32) -> vec3f { if (h < 0.3) { return vec3f(1.0, 0.62, 0.08); } if (h < 0.6) { return vec3f(0.12, 1.0, 0.22); } if (h < 0.8) { return vec3f(0.2, 0.85, 1.0); } return vec3f(1.0, 0.3, 0.8); }
// upstream mat 0..5 lighting: sun (depth attenuated, through the caustics), ambient, side light, fluorescence, gloss
fn lightIt(wp: vec3f, n: vec3f, n0: vec3f, alb: vec3f, gloss: f32, open: f32, flu: f32, cau: bool, z: f32) -> vec3f {
  let L = u.sun.xyz; let V = normalize(u.cam.xyz - wp); let d = length(u.cam.xyz - wp);
  var ca = vec3f(0.33); if (cau) { ca = caus(wp, d); }
  let E = sunE(wp.y, z) * (0.25 + 0.75 * open); let ndl = sat(dot(n, L)); let ao = 0.55 + 0.45 * open;
  let ab = ambB(wp, z, open); let sb = mix(WCOL, PCOL, z) * exp(kd(z) * dep(wp.y)) * open * 0.7; let rv = reflect(-V, n);
  let am = (ambN(ab, n.y) + sb * (1.0 - abs(n.y))) * ao;
  let dl = E * ndl * (0.10 + mix(vec3f(0.33), ca, ss(0.1, 0.45, dot(n0, L))) * 2.5);
  var c = alb * (dl + am) + alb * flu * dot(dl + am, vec3f(0.1, 0.5, 0.5));
  let H = normalize(V + L);
  c += E * (0.25 + ca) * pow(sat(dot(n, H)), mix(10.0, 70.0, gloss)) * gloss * ndl * 1.8;
  c += (ambN(ab, rv.y) + sb * (1.0 - abs(rv.y))) * ao * (0.08 + gloss) * 0.6 * pow(1.0 - sat(dot(n, V)), 2.5);
  return c;
}
fn bumpN(n: vec3f, p: vec3f, k: f32) -> vec3f { return normalize(n + (vec3f(vn3(p), vn3(p + vec3f(7.1, 0.0, 0.0)), vn3(p + vec3f(0.0, 13.3, 0.0))) - 0.5) * k); }
fn rockAlb(wp: vec3f, n: vec3f, z: f32) -> vec3f { // upstream mat 0/1 layered rock: beds, encrustation, algae on top faces
  let a1 = fbm3(wp * 0.5, 3); let b1 = vn3(wp * 1.7); let big = vn3(wp * 0.06); let big2 = vn3(wp * 0.13 + vec3f(3.0));
  let st = wp.y * 0.55 + a1 * 1.6 + big * 5.0 + big2 * 3.0; let bed = h31(vec3f(floor(st))); let sf = fract(st);
  var alb = mix(vec3f(0.11, 0.12, 0.13), vec3f(0.33, 0.30, 0.25), sat(a1 * 1.5 - 0.25));
  alb = mix(alb, mix(vec3f(0.26, 0.19, 0.10), vec3f(0.20, 0.22, 0.14), bed), ss(0.42, 0.66, big) * 0.7);
  alb *= mix(0.84, 1.1, bed) * (1.0 - 0.35 * ss(0.12, 0.0, sf) * (1.0 - abs(n.y)));
  let enc = ss(0.46, 0.6, big2 * 0.6 + b1 * 0.5);
  alb = mix(alb, mix(vec3f(0.34, 0.07, 0.10), vec3f(0.40, 0.25, 0.07), ss(0.45, 0.6, a1)) * (0.5 + 0.8 * b1), enc * 0.6);
  alb = mix(alb, vec3f(0.035, 0.14, 0.07), ss(-0.1, 0.6, n.y) * ss(0.3, 0.52, b1 * 0.55 + big * 0.5) * 0.8);
  alb *= 0.45 + 0.9 * a1;
  return mix(alb, alb * vec3f(0.85, 0.8, 1.4) + vec3f(0.015, 0.0, 0.05), z * 0.8);
}
fn shadeSolid(wp: vec3f, n0: vec3f, aux: f32, prm: vec4f, lp: vec3f) -> vec3f {
  let v = normalize(u.cam.xyz - wp); var n = n0; if (dot(n, v) < 0.0) { n = -n; }
  let mat = prm.x; let z = zoneAt(wp); let t = u.cam.w; let fres = pow(1.0 - sat(dot(n, v)), 2.0);
  if (mat < 0.5) { // the game's targets: UW-T1 urchin (aux < -0.45), UW-T2 spiky puffer, UW-T3 jelly blob (aux > 0.45)
    if (aux < -0.45) {
      let tip = ss(-0.75, -1.0, aux); let tub = ss(0.6, 0.75, vn3(lp * 9.0 + vec3f(prm.y * 20.0)));
      var alb = mix(vec3f(0.16, 0.04, 0.20) * (0.7 + 0.5 * tub), mix(vec3f(0.22, 0.06, 0.30), vec3f(0.75, 0.42, 0.95), tip), ss(-0.62, -0.8, aux));
      return lightIt(wp, n, n0, alb, 0.6, 1.0, 0.3, false, z) + vec3f(0.5, 0.2, 0.7) * tip * 0.35 + vec3f(0.3, 0.2, 0.5) * fres * 0.4;
    }
    if (aux > 0.45) { // jelly: translucent bell glowing from inside, rim lit (blooms a little)
      let arm = ss(0.85, 0.98, aux); let pulse = 0.75 + 0.25 * sin(t * 2.2 + prm.y * 40.0);
      let core = vec3f(1.0, 0.35, 0.85) * (0.35 + 0.65 * pow(sat(dot(n, v)), 2.0)) * pulse;
      let alb = mix(vec3f(0.55, 0.25, 0.75), vec3f(0.9, 0.5, 0.95), arm);
      return lightIt(wp, n, n0, alb * 0.5, 0.8, 1.0, 0.8, false, z) + core * 0.9 + vec3f(1.2, 0.6, 1.6) * pow(fres, 1.5) * 1.4 * pulse;
    }
    // puffer: yellow-tan with brown spots, pale belly, dark eyes (aux < -0.2), spines (aux > 0.2)
    let eye = ss(-0.15, -0.25, aux); let spine = ss(0.15, 0.28, aux);
    let spot = ss(0.62, 0.7, vn3(lp * 5.5 + vec3f(prm.y * 13.0)));
    var alb = mix(vec3f(1.0, 0.66, 0.12), vec3f(0.42, 0.20, 0.06), spot);
    alb = mix(alb, vec3f(1.0, 0.92, 0.7), ss(-0.2, -0.6, lp.y));
    alb = mix(alb, vec3f(0.95, 0.85, 0.6), spine); alb = mix(alb, vec3f(0.01), eye);
    return lightIt(wp, n, n0, alb, mix(0.3, 1.0, eye), 1.0, 0.5, false, z) + alb * vec3f(0.12, 0.07, 0.02) * (1.0 - eye) + vec3f(0.25, 0.3, 0.3) * fres * 0.3;
  }
  if (${DBG.includes('flat')} && mat > 0.5) { return vec3f(0.1, 0.3, 0.4); }
  if (mat < 20.5) { // UW-C1/C2 the canyon: sand floor (aux ~ 1) and rock walls (aux → -1), caustics on both
    let open = mix(0.5, 1.0, abs(aux)); let sand = ss(0.3, 0.55, aux);
    var N = n; if (sand < 0.9) { N = bumpN(n, wp * 1.3, 0.55 * (1.0 - sand)); }
    let rip = 0.85 + 0.25 * sin(dot(wp.xz, vec2f(0.8, 0.35)) * 5.0 + vn3(wp * 0.7) * 9.0);
    var sa = vec3f(0.15, 0.16, 0.145) * (0.88 + 0.24 * vn3(wp * 2.2)) * rip;
    let mg = z * sand * ss(0.35, 0.6, vn3(wp * 0.4)); // magenta ground cover in the grotto
    sa = mix(sa, vec3f(0.20, 0.02, 0.12) * (0.4 + 0.9 * vn3(wp * 3.0)), mg * 0.85);
    var alb = sa; if (sand < 0.98) { alb = mix(rockAlb(wp, N, z), sa, sand); }
    return lightIt(wp, N, n, alb, mix(0.1, 0.05, sand), open, mg * 0.4, true, z);
  }
  if (mat < 21.5) { let N = bumpN(n, wp * 0.9, 0.5); return lightIt(wp, N, n, rockAlb(wp, N, z) * 0.9, 0.1, 1.0, 0.0, true, z); } // floating boulders
  if (mat < 22.5) { // UW-K1 kelp: stems (aux < 0) and blades (aux = (leaf bucket + 0.9 v) / 8), translucent, with sparkle
    let hf = sat(lp.y / max(prm.w, 1.0)); let open = mix(0.35, 1.0, hf);
    if (aux < 0.0) { return lightIt(wp, n, n0, vec3f(0.10, 0.11, 0.035), 0.1, open, 0.0, false, z); }
    let b = floor(aux * 8.0 + 0.004); let vv = sat(fract(aux * 8.0 + 0.004) / 0.9);
    let s1 = fract(b * 0.371 + prm.y * 7.13); let s2 = fract(b * 0.619 + prm.y * 3.31);
    var col = mix(vec3f(0.11, 0.125, 0.022), vec3f(0.04, 0.10, 0.04), s1); col = mix(col, vec3f(0.25, 0.17, 0.025), step(0.72, s2));
    let pcol = mix(mix(vec3f(0.02, 0.05, 0.065), vec3f(0.05, 0.03, 0.08), s1), vec3f(0.30, 0.25, 0.04), step(0.8, s2)); // grotto kelp (upstream type 3)
    col = mix(col, pcol, z);
    let alb = col * mix(0.5, 1.12, vv) * (0.75 + 0.5 * vn3(lp * vec3f(2.0, 0.3, 2.0) + vec3f(prm.y * 9.0)));
    let L = u.sun.xyz; let V = normalize(u.cam.xyz - wp); let E = sunE(wp.y, z) * open; let ndl = dot(n, L);
    let ndv = sat(dot(n, V)); let ir = 0.5 + 0.5 * cos(6.2831853 * (vec3f(0.0, 0.33, 0.67) + ndv * 1.1 + s1 * 0.22 + vv * 0.5 + 0.55));
    let alb2 = mix(alb, alb * 0.5 + ir * vec3f(0.15, 0.13, 0.30), z * 0.55 * (1.0 - ndv) * 0.8);
    let tr = (max(-ndl, 0.0) * 0.85 + 0.15) * 0.9; let trc = alb2 * vec3f(1.5, 1.4, 0.75);
    let ab = ambB(wp, z, open); let am = (ambN(ab, n.y) + ambN(ab, -n.y) * 0.5 * vec3f(1.1, 1.15, 0.7) + mix(WCOL, PCOL, z) * exp(kd(z) * dep(wp.y)) * open * 0.42 * (1.0 - abs(n.y))) * (0.3 + 0.7 * open);
    var c = E * (0.06 + 0.5) * (alb2 * max(ndl, 0.0) + trc * tr) + alb2 * am;
    let H = normalize(V + L);
    c += E * (pow(sat(dot(n, H)), 40.0) * 0.45 + pow(sat(dot(n, H)), 9.0) * 0.07);
    c += E * trc * 0.9 * pow(sat(dot(-V, L)), 3.0) * 1.2;
    let spk = step(fract(b * 0.731 + prm.y * 5.1), mix(0.24, 0.3, z)); // whole-leaf glints that twinkle slowly
    let tw = pow(0.5 + 0.5 * sin(t * (0.5 + s2 * 1.4) + s1 * 90.0 + lp.y * 0.7), 5.0);
    let m = ss(0.2, 0.0, abs(vv - (0.35 + 0.45 * s2)));
    c += mix(pal(s2 * 0.72), mix(vec3f(0.5, 0.35, 1.0), vec3f(0.2, 1.0, 0.7), step(0.6, s1)), z) * spk * (0.1 + tw) * m * (0.35 + E.g * 1.2) * 0.9;
    return c;
  }
  if (mat < 23.5) { // UW-L1 ship timbers (upstream mat 3)
    let w = vn3(vec3f(lp.x * 0.15, lp.y * 3.0, lp.z * 3.0)); let N = bumpN(n, wp * 2.0, 0.3);
    var alb = mix(vec3f(0.13, 0.085, 0.05), vec3f(0.36, 0.25, 0.14), w) * (0.6 + 0.5 * vn3(wp * 1.1));
    let pk = fract(atan2(lp.z, 2.0 - lp.y) * 7.0); alb *= 0.35 + 0.65 * ss(0.0, 0.12, min(pk, 1.0 - pk));
    alb = mix(alb, vec3f(0.08, 0.22, 0.16), ss(0.5, 0.7, vn3(wp * 0.5)) * 0.6);
    return lightIt(wp, N, n, alb, 0.2, 1.0, 0.0, true, z);
  }
  if (mat < 24.5) { // UW-L2 stone whale fluke: smooth pale stone with dark streaks along its length (upstream mat 2)
    let sk = vn3(vec3f((lp.x + lp.z) * 0.33, lp.y * 0.035, 0.0) * 8.0); let sk2 = vn3(vec3f((lp.x - lp.z) * 1.1, lp.y * 0.11, 3.0) * 4.0);
    var alb = mix(vec3f(0.42, 0.47, 0.48), vec3f(0.10, 0.13, 0.15), ss(0.40, 0.62, sk * 0.6 + sk2 * 0.5)) * (0.75 + 0.3 * vn3(wp * 1.7));
    alb = mix(alb, vec3f(0.60, 0.64, 0.62), ss(0.62, 0.75, sk2) * 0.5);
    return lightIt(wp, bumpN(n, wp * 1.5, 0.15), n, alb, 0.9, 1.0, 0.0, true, z);
  }
  if (mat < 25.5) { // the Ring Gate as a coral-crusted stone arch
    let cr = ss(0.45, 0.7, vn3(wp * 1.4)); let alb = mix(rockAlb(wp, n, z), mix(vec3f(0.6, 0.17, 0.08), vec3f(0.85, 0.25, 0.45), vn3(wp * 0.7)), cr * 0.8);
    return lightIt(wp, bumpN(n, wp * 2.0, 0.5), n, alb, 0.2, 1.0, cr * 0.6, true, z);
  }
  if (mat < 26.5) { // UW-P1 barrel sponges (upstream mat 4); aux = the lathe profile's occlusion
    let hue = fract(prm.y * 7.31); var alb = mix(vec3f(0.60, 0.17, 0.08), vec3f(0.64, 0.35, 0.10), fract(hue * 3.0));
    if (hue > 0.72) { alb = vec3f(0.30, 0.26, 0.55); } if (hue > 0.9) { alb = vec3f(0.44, 0.18, 0.42); }
    alb *= (0.45 + 0.75 * vn3(wp * 4.0)) * (0.7 + 0.3 * vn3(wp * 1.3));
    return lightIt(wp, bumpN(n, wp * 5.0, 0.6), n, alb * (0.25 + 0.75 * aux * aux), 0.2, 1.0, 0.55, true, z);
  }
  if (mat < 27.5) { // UW-P2 branching coral (upstream mat 5..9)
    let hue = fract(prm.y * 5.73); var alb = mix(vec3f(0.80, 0.08, 0.10), vec3f(0.90, 0.22, 0.40), fract(hue * 4.0));
    if (hue > 0.7) { alb = vec3f(0.88, 0.42, 0.10); } if (hue > 0.9) { alb = vec3f(0.55, 0.22, 0.75); }
    alb *= (0.4 + 0.8 * vn3(wp * 3.0)) * (0.5 + 0.9 * aux * aux); alb = mix(alb, vec3f(1.0, 0.75, 0.6), ss(0.8, 1.0, aux) * 0.35);
    return lightIt(wp, n, n0, alb, 0.25, 1.0, 0.75, true, z) + alb * 0.01;
  }
  if (mat < 28.5) { // UW-M1 manta: dark back, pale belly with gills, a blue-violet sheen (upstream fsManta)
    let top = ss(-0.2, 0.25, n0.y); let au = abs(lp.x);
    let gill = ss(0.25, 0.0, abs(au - 0.13) * 8.0) * ss(0.04, 0.12, lp.z) * ss(0.34, 0.26, lp.z) * ss(0.2, 0.8, sin(lp.z * 110.0));
    let tx = vn3(vec3f(lp.xz * 6.0, prm.y * 9.0));
    var belly = vec3f(0.13, 0.17, 0.21) * (0.6 + 0.6 * tx) * (1.0 - 0.7 * gill);
    belly = mix(belly, vec3f(0.05, 0.08, 0.11), sat(ss(0.45, 0.9, au + tx * 0.35)));
    var back = vec3f(0.04, 0.065, 0.10) + vec3f(0.10, 0.16, 0.2) * ss(0.5, 0.75, tx);
    back = mix(back, vec3f(0.36, 0.46, 0.52), ss(0.25, 0.0, abs(au - 0.26) * 3.5 + abs(lp.z - 0.12) * 5.0) * 0.8);
    let alb = mix(belly, back, top); let ir = 0.5 + 0.5 * cos(6.2831853 * (vec3f(0.0, 0.33, 0.67) + sat(dot(n, v)) * 1.1 + tx * 1.5 + 0.55));
    return lightIt(wp, n, n0, alb, 0.3, 1.0, 0.0, true, z) + ir * vec3f(0.35, 0.16, 0.6) * 0.08;
  }
  if (mat < 29.5) { // UW-P3 ground cover tufts: magenta in the grotto, teal elsewhere, a little emissive (upstream leaf types 5 / 7)
    let s1 = h31(floor(wp * 0.5) + vec3f(prm.y)); let tipk = sat(lp.y / 0.6);
    var alb = mix(vec3f(0.05, 0.40, 0.36), vec3f(0.10, 0.52, 0.58), s1);
    alb = mix(alb, mix(vec3f(0.85, 0.05, 0.40), vec3f(0.60, 0.10, 0.80), step(0.7, s1)), max(z, prm.z));
    alb *= 0.7 + 0.7 * tipk;
    return lightIt(wp, n, n0, alb, 0.2, 1.0, 0.8, false, z) + alb * mix(0.12, 0.3, max(z, prm.z)) * (0.6 + 0.4 * tipk);
  }
  return lightIt(wp, n, n0, rockAlb(wp, n, z), 0.1, 1.0, 0.0, false, z); // anything else (another module's meshes)
}
// points: kind 1 motes and specks drift; kind 2 + H/100 bubbles rise H m; kind 3 + R/100 fish school orbits of radius R (streaks)
fn pointMotion(p: vec3f, k: f32, t: f32) -> vec3f {
  if (k > 2.5) { // UW-F3 a fish school: the whole school orbits (upstream vsFish), so the streak's direction is its heading
    let R = (k - 3.0) * 100.0; let dir = select(-1.0, 1.0, fract(R * 0.5) > 0.5);
    let ta = t * dir * 1.9 / R + R * 1.7; let ph = R * 3.1;
    return vec3f(R * cos(ta) - R, 2.2 * sin(3.0 * ta + ph), R * 0.6 * sin(ta));
  }
  let h = h31(floor(p * 7.0));
  if (k > 1.5) { // UW-B1 bubbles rise from a vent and start again
    let H = (k - 2.0) * 100.0; let r = fract(t * (0.035 + 0.03 * h) + h) * H; let wob = 0.06 + r * 0.012;
    return vec3f(sin(t * 1.7 + h * 50.0 + r * 0.6) * wob, r, cos(t * 1.3 + h * 33.0 + r * 0.5) * wob);
  }
  return vec3f(sin(t * 0.3 + h * 6.28), sin(t * 0.23 + h * 9.1) * 0.6, cos(t * 0.27 + h * 3.3)) * 0.5; // UW-B2 drifting motes
}
`,
      post: /*wgsl*/`
fn ss2(a: f32, b: f32, x: f32) -> f32 { let t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
fn ign(p: vec2f) -> f32 { return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715)))); }
fn tmap(x: vec3f) -> vec3f { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0)); }
// after Abyssal Garden (MIT): W_RAYS light shafts, marched here at full resolution with a dither, without the shadow map,
// then W_POST's exposure, vignette, ACES curve, contrast and gamma
fn grade(c0: vec3f, bl: vec3f, uv: vec2f, px: vec2i, d0: f32) -> vec3f {
  let nd = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let rv = u.fwd.xyz + u.right.xyz * (nd.x * u.fwd.w * u.right.w) + u.up.xyz * (nd.y * u.fwd.w);
  let rl = length(rv); let rd = rv / rl;
  var tm = 120.0; if (d0 > 0.0) { tm = min(u.up.w / d0 * rl, 120.0); }
  if (rd.y > 1e-3) { tm = min(tm, (SURF - u.cam.y) / rd.y); }
  let z = u.p0.w; let k = kd(z); let sgz = sg(z); let sx = u.sun.xyz;
  let dt = tm / 8.0; let j = ign(vec2f(px)); var acc = vec3f(0.0);
  for (var n = 0; n < ${DBG.includes('norays') ? 0 : 8}; n++) {
    let t = (f32(n) + j) * dt; let p = u.cam.xyz + rd * t;
    let q = p.xz - sx.xz * ((p.y - SURF) / sx.y);
    let pat = ss2(0.45, 0.8, vn3(vec3f(q.x * 0.12, q.y * 0.21, u.cam.w * 0.05)));
    acc += exp(-sgz * t + k * (dep(p.y) / sx.y)) * (0.004 + pat * 9.0);
  }
  let mu = max(dot(rd, sx), 0.0); let ph = mix(0.2 + 2.0 * mu * mu * mu, 0.8, z);
  let wc = mix(WCOL + vec3f(0.04, 0.07, 0.05), PCOL + vec3f(0.28, 0.16, 0.12), z);
  var c = c0 + min(acc * dt * sgz * wc * SUNC * ph * 0.42 * (1.0 - 0.55 * z), vec3f(20.0));
  c += bl * 0.22;
  c *= 0.62;
  let q = uv - 0.5; c *= 1.0 - dot(q, q) * 0.55;
  c = tmap(c);
  let l0 = dot(c, vec3f(0.2126, 0.7152, 0.0722)); let l = mix(l0, l0 * l0 * (3.0 - 2.0 * l0), 0.55);
  c *= l / max(l0, 1e-4); c = mix(c, vec3f(l), ss2(0.55, 1.0, l) * 0.1); c = mix(vec3f(l), c, 0.93) + vec3f(0.008, 0.002, 0.0);
  c = pow(max(c, vec3f(0.0)), vec3f(1.0 / 2.2));
  return c + (ign(vec2f(px)) + ign(vec2f(px) + 37.0) - 1.0) / 255.0;
}
`,
    };
  }

  // ---------------------------------------------------------------- meshes (upstream world.js, ported; Mesh / icosphere are its math.js)
  // upstream meshLathe (barrel sponges)
  function meshLathe(prof, seg, lump, ribs = 0) {
    const m = new Mesh(), rings = [];
    for (const [r, h, ao] of prof) { const ring = []; for (let s = 0; s < seg; s++) { const a = s / seg * TAU, rl = r * (1 + lump * (fbm(cos(a) * 1.5 + h * 2, h * 3, sin(a) * 1.5, 2) - 0.5) + 0.07 * cos(ribs * a + h * 1.5)); ring.push(m.v(cos(a) * rl, h, sin(a) * rl, ao)); } rings.push(ring); }
    for (let k = 0; k < rings.length - 1; k++) for (let s = 0; s < seg; s++) { const s2 = (s + 1) % seg; m.quad(rings[k][s], rings[k + 1][s], rings[k + 1][s2], rings[k][s2]); }
    return m;
  }
  // upstream meshCoral (fan or bush), aux = the branch's depth for the tip highlight
  function meshCoral(fan) {
    rseed(200 + fan); const m = new Mesh(); const nrm = (v) => { const l = hypot(...v) || 1; return v.map((c) => c / l); };
    const br = (p, d, r, len, depth) => {
      const pts = [p]; let q = p;
      for (let i = 0; i < 3; i++) { d = nrm([d[0] + rr(-0.3, 0.3), d[1] + rr(-0.1, 0.3), d[2] + (fan ? rr(-0.05, 0.05) : rr(-0.3, 0.3))]); q = [q[0] + d[0] * len / 3, q[1] + d[1] * len / 3, q[2] + d[2] * len / 3]; pts.push(q); }
      if (!depth) pts.push([q[0] + d[0] * r * 1.6, q[1] + d[1] * r * 1.6, q[2] + d[2] * r * 1.6]);
      m.tube(pts, (k) => k > 3 ? r * 0.36 : r * (1 - 0.22 * k / 3), fan ? 5 : 6, true, (k) => clamp(1 - (depth + 1 - k / 3) / 5, 0, 1));
      if (depth > 0) { const n = 2 + (rnd() < 0.5); for (let i = 0; i < n; i++) br(q, nrm([d[0] + rr(-0.8, 0.8), d[1] + rr(-0.1, 0.5), d[2] + (fan ? rr(-0.08, 0.08) : rr(-0.8, 0.8))]), r * 0.78, len * 0.8, depth - 1); }
    };
    const n0 = fan ? 1 : 2 + (rnd() * 2 | 0);
    for (let i = 0; i < n0; i++) br([rr(-0.08, 0.08), 0, rr(-0.08, 0.08)], nrm([rr(-0.5, 0.5), 1, fan ? 0 : rr(-0.5, 0.5)]), fan ? 0.06 : 0.08, fan ? 0.5 : 0.45, 3);
    return m;
  }
  // upstream meshFluke's capsule chains (stem, two flukes; z squashed), built as tubes rather than its 3M-voxel surface net (cost)
  function meshFluke() {
    const m = new Mesh();
    const chain = (pts, zs) => { const k0 = m.p.length; m.tube(pts.map((p) => [p[0], p[1], p[2]]), (k) => pts[k][3], 14, true, () => 1); for (let i = k0; i < m.p.length; i += 3) m.p[i + 2] *= zs; };
    const sub = (P) => { const o = []; for (let i = 0; i < P.length - 1; i++) for (let k = 0; k < 4; k++) { const t = k / 4, a = P[i], b = P[i + 1]; o.push([mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t), mix(a[3], b[3], t)]); } o.push(P[P.length - 1]); return o; };
    chain(sub([[0, -1.6, 3.7, 1.2], [0, 1.8, 2.35, 0.98], [0, 4.6, 1.0, 0.76], [0, 6.9, 0.1, 0.6]]), 0.8);
    chain(sub([[0, 6.6, 0.1, 0.72], [1.9, 7.9, 0, 0.98], [3.9, 8.8, -0.1, 0.9], [5.7, 9.8, -0.25, 0.64], [7.0, 11.2, -0.4, 0.38], [7.7, 12.8, -0.55, 0.2], [7.9, 14.1, -0.65, 0.1]]), 0.18 / 0.6);
    chain(sub([[0, 6.6, 0.1, 0.72], [-1.7, 8.3, 0.05, 0.96], [-3.3, 9.7, -0.05, 0.88], [-4.7, 11.2, -0.2, 0.64], [-5.6, 12.9, -0.4, 0.38], [-6.0, 14.6, -0.5, 0.2], [-5.9, 15.9, -0.6, 0.1]]), 0.18 / 0.6);
    return m;
  }
  // upstream meshShip: keel, ribs, planking with breaches, stern castle, transom, deck beams and planks, masts, yards, bowsprit
  function meshShip() {
    rseed(220);
    const m = new Mesh(), Lh = 17, B = 5.6, Dp = 7.6;
    const hb = (x) => B * pow(max(1 - pow(abs(x / Lh), x < 0 ? 3.6 : 2.6), 0), 0.5);
    const dp = (x) => Dp * (1 - 0.36 * pow(abs(x / Lh), 2.5));
    const sheer = (x) => 0.5 + (x > 0 ? 3.0 : 3.8) * pow(abs(x / Lh), 2.2);
    const pt = (x, ph, off = 0) => { const b = hb(x) + off, d = dp(x) + off, s = sheer(x); return [x, s - (d + s) * pow(max(cos(ph), 0), 0.66), b * Math.sign(ph) * pow(abs(sin(ph)), 0.8)]; };
    const out = (p) => { const l = hypot(p[1] + 0.5, p[2] * 1.3) || 1; return [0, (p[1] + 0.5) / l, p[2] * 1.3 / l]; };
    const up = () => [0, 1, 0];
    const keel = [];
    for (let i = 0; i <= 44; i++) { const x = mix(-Lh - 1.0, Lh + 2.4, i / 44), e = max(abs(x) / Lh - 0.78, 0) * 4.2; keel.push([x, -dp(clamp(x, -Lh, Lh)) - 0.3 + e * e * e * 4.2, 0]); }
    m.sweep(keel, 0.55, 0.95, up);
    for (let x = -Lh + 0.7; x < Lh - 0.3; x += 0.8) { const a0 = rnd() < 0.1 ? rr(-0.9, -0.2) : -PI / 2, a1 = rnd() < 0.1 ? rr(0.2, 0.9) : PI / 2, pts = []; for (let i = 0; i <= 16; i++) pts.push(pt(x, mix(a0, a1, i / 16))); m.sweep(pts, 0.24, 0.3, out); }
    const holeX = rr(-6, 2), holeS = rnd() < 0.5 ? 1 : -1;
    const BR = [[holeX, holeS * 0.8, 3.2, 0.42], [7, -holeS * 0.95, 2.4, 0.34], [12, holeS * 0.5, 1.7, 0.28], [-11, -holeS * 0.55, 2.1, 0.3]];
    const holed = (x, ph) => { for (const h of BR) { const a = (x - h[0]) / h[2], b = (ph - h[1]) / h[3]; if (a * a + b * b < 1 + 0.45 * sin(x * 3.1 + ph * 9)) return true; } return false; };
    const NS = 14, xs = []; for (let x = -Lh + 0.35; x <= Lh - 0.3; x += 0.85) xs.push(x);
    for (let j = 0; j < NS; j++) {
      const p0 = mix(-1.5, 1.5, j / NS), p1 = mix(-1.5, 1.5, (j + 1) / NS), sg = p0 + p1 < 0 ? -1 : 1, lo = sg < 0 ? p1 : p0, hi = sg < 0 ? p0 : p1;
      let pv = null;
      for (const x of xs) {
        const cu = [m.v(...pt(x, lo, 0.27)), m.v(...pt(x, hi, 0.14)), m.v(...pt(x, lo, 0.1)), m.v(...pt(x, hi, 0.1))];
        if (pv && !holed(x - 0.42, (p0 + p1) / 2)) { if (sg > 0) { m.quad(pv[0], pv[1], cu[1], cu[0]); m.quad(pv[2], cu[2], cu[3], pv[3]); } else { m.quad(pv[0], cu[0], cu[1], pv[1]); m.quad(pv[2], pv[3], cu[3], cu[2]); } }
        pv = cu;
      }
    }
    for (const sgn of [-1, 1]) {
      let pts = []; for (let x = -Lh + 0.6; x <= Lh - 0.6; x += 1) pts.push(pt(x, sgn * PI / 2, 0.2)); m.sweep(pts, 0.3, 0.28, up);
      for (let j = 0; j < 3; j++) { pts = []; for (let x = -Lh + 0.4; x <= -Lh + 8.5 - j; x += 0.9) pts.push([x, sheer(x) + 0.55 + j * 0.86, sgn * (max(hb(x), 2.6) + 0.15)]); m.sweep(pts, 0.82, 0.09, () => [0, 0, sgn]); }
    }
    for (let y = -3; y < sheer(-Lh) + 3; y += 0.86) { const w = max(1.2, 2.9 * sstep(-4.5, 1.5, y)); if (rnd() < 0.9) m.sweep([[-Lh + 0.35, y, -w], [-Lh + 0.35, y, w]], 0.82, 0.1, () => [1, 0, 0]); }
    for (let x = -Lh + 2; x < Lh - 2; x += rr(1.8, 3.2)) m.sweep([[x, sheer(x) - 0.25, -hb(x)], [x, sheer(x) - 0.2, 0], [x, sheer(x) - 0.25, hb(x)]], 0.26, 0.26, up);
    for (let z = -3.9; z <= 3.9; z += 0.62) { let x = -Lh + rr(1, 5); while (x < Lh - 4) { const x1 = min(x + rr(3, 9), Lh - 3.5); if (rnd() < 0.6) { const pts = []; for (let xx = x; xx <= x1; xx += 1) if (hb(xx) > abs(z) + 0.3) pts.push([xx, sheer(xx) - 0.05, z]); if (pts.length > 1) m.sweep(pts, 0.56, 0.07, up); } x = x1 + rr(0.5, 3); } }
    m.sweep([[7, -Dp + 0.6, 0], [7.1, 1, 0], [7.4, 8, 0.3], [7.8, 15, 0.8]], (k) => 0.62 - k * 0.1, (k) => 0.62 - k * 0.1, () => [1, 0, 0]);
    m.sweep([[7.5, 9.5, -5.2], [7.5, 9.6, 0.3], [7.5, 9.2, 5.6]], 0.26, 0.26, up);
    m.sweep([[7.7, 13.2, -3.2], [7.7, 13.3, 3.6]], 0.2, 0.2, up);
    m.sweep([[-3, -Dp + 0.6, 0], [-3.2, 1, 0.2], [-3.9, 6, 1.0], [-5.2, 9.5, 2.6]], (k) => 0.74 - k * 0.1, (k) => 0.74 - k * 0.1, () => [1, 0, 0]);
    m.sweep([[Lh + 1.4, 2.6, 0], [Lh + 8, 5.2, 0.2]], 0.34, 0.34, up);
    return m;
  }
  // upstream meshManta: span along x (half span 1), nose +z, tail and cephalic fins (fewer rings: it is seen from below, far)
  function meshManta() {
    const m = new Mesh(), NU = 48, M = 14, rings = [];
    for (let j = 0; j <= NU; j++) {
      const u = j / NU * 2 - 1, au = abs(u);
      let zl = 0.52 - 0.74 * pow(au, 1.35) + 0.07 * exp(-pow((au - 0.13) / 0.05, 2)) - 0.05 * exp(-pow(au / 0.05, 2)) - 0.08 * pow(au, 5);
      const zt = -0.5 + 0.3 * pow(au, 0.8) + 0.02 - 0.08 * pow(au, 5); if (zl < zt + 0.004) zl = zt + 0.004;
      const th = 0.08 * pow(1 - au, 1.15) + 0.004 + 0.12 * exp(-pow(u / 0.2, 2)), ring = [];
      for (let k = 0; k < M; k++) { const a = k / M * TAU; ring.push(m.v(u, th * sin(a) * (0.62 + 0.38 * cos(a)), mix(zt, zl, 0.5 + 0.5 * cos(a)), u)); }
      rings.push(ring);
    }
    for (let j = 0; j < NU; j++) for (let k = 0; k < M; k++) { const k2 = (k + 1) % M; m.quad(rings[j][k], rings[j + 1][k], rings[j + 1][k2], rings[j][k2]); }
    const tail = []; for (let i = 0; i <= 8; i++) tail.push([0, 0, -0.42 - i * 0.19]);
    m.tube(tail, (k) => 0.016 * (1 - k / 9), 4, true);
    for (const sx of [-1, 1]) m.tube([[sx * 0.12, -0.02, 0.48], [sx * 0.135, -0.05, 0.6], [sx * 0.115, -0.09, 0.69], [sx * 0.085, -0.125, 0.74]], (k) => 0.045 * (1 - k / 4.4), 6, true);
    return m;
  }
  // upstream meshChunk: a lumpy rock cut by a few planes (floating boulders)
  function meshChunk(sd) {
    rseed(100 + sd); const pl = [];
    for (let i = 0; i < 4; i++) { const q = qRand(), l = hypot(q[0], q[1], q[2]) || 1; pl.push([q[0] / l, q[1] / l, q[2] / l, rr(0.8, 0.98)]); }
    return icosphere(2, (x, y, z) => { const r = 1 + (fbm(x * 1.6 + sd, y * 1.6, z * 1.6, 2) - 0.5) * 0.9; let px = x * r, py = y * r * 0.8, pz = z * r; for (const p of pl) { const d = px * p[0] + py * p[1] + pz * p[2] - p[3]; if (d > 0) { px -= p[0] * d; py -= p[1] * d; pz -= p[2] * d; } } return [px, py, pz]; });
  }
  // UW-K1 a kelp column after upstream column(): 2-4 spiralling stems, blades along them (bent, tilted, tapering), H m tall
  function meshKelp(seed, H) {
    rseed(seed); const m = new Mesh();
    const strands = 3, ph = rnd() * TAU, tw = rr(0.1, 0.28), sr = rr(0.2, 0.5), sc = rr(0.85, 1.15), la = rnd() * TAU, lm = rr(0, 0.09);
    const stem = (s, h) => { const a = ph + s * TAU / strands + h * tw, r = sr * (1 - 0.6 * h / H), ln = lm * h * h / H; return [cos(a) * r + cos(la) * ln, sin(a) * r + sin(la) * ln]; };
    for (let s = 0; s < strands; s++) { const pts = []; for (let h = 0; h <= H; h += 1.5) { const p = stem(s, h); pts.push([p[0], h, p[1]]); } m.tube(pts, 0.05, 4, true, () => -1); }
    const n = floor(H * 9);
    for (let i = 0; i < n; i++) {
      const t = pow(rnd(), 0.9), h = t * H, p = stem((rnd() * strands) | 0, h);
      const Lf = ((0.55 + 0.75 * rnd() * rnd()) * (1 - 0.5 * t * t) * sc + 0.25) * 1.6, tilt = mix(rr(0.4, 1.0), rr(0.15, 0.45), t), yaw = rnd() * TAU;
      const W = Lf * rr(0.2, 0.28) + 0.04, k = rr(-0.3, 0.9), bucket = (rnd() * 8) | 0;
      const st = sin(tilt), ct = cos(tilt), cy = cos(yaw), sy = sin(yaw), d = [st * cy, ct, st * sy], pe = [ct * cy, -st, ct * sy], sd = [-sy, 0, cy];
      let prev = null;
      for (let r = 0; r <= 3; r++) {
        const v = r / 3, bend = k * v * v * 0.5, w = W * 0.5 * pow(max(sin(PI * pow(max(v, 0.02), 0.6)), 0), 0.7) + (r === 3 ? 0 : 0.004);
        const cx = p[0] + Lf * (d[0] * v + pe[0] * bend), cy2 = h + Lf * (d[1] * v + pe[1] * bend), cz = p[1] + Lf * (d[2] * v + pe[2] * bend), ax = (bucket + v * 0.9) / 8;
        const a = m.v(cx - sd[0] * w, cy2, cz - sd[2] * w, ax), b = m.v(cx + sd[0] * w, cy2, cz + sd[2] * w, ax);
        if (prev) m.quad(prev[0], prev[1], b, a); prev = [a, b];
      }
    }
    return m;
  }
  // UW-T1..T3 target skins (unit radius; one per Reef target variant): urchin, spiky puffer, jelly blob. aux carries the part.
  function skinUrchin() {
    rseed(931); const body = icosphere(2, (x, y, z) => { const r = 0.72 * (1 + 0.05 * (vnoise(x * 4, y * 4, z * 4) - 0.5)); return [x * r, y * r * 0.85, z * r]; }); for (let i = 0; i < body.aux.length; i++) body.aux[i] = -0.55;
    const NSP = 54;
    for (let i = 0; i < NSP; i++) { const yy = 1 - 2 * (i + 0.5) / NSP, r0 = sqrt(1 - yy * yy), a = i * 2.39996, nx = cos(a) * r0, ny = yy * 0.85, nz = sin(a) * r0, L = rr(1.25, 1.5);
      body.tube([[nx * 0.65, ny * 0.65, nz * 0.65], [nx * (0.65 + L) / 2, ny * (0.65 + L) / 2, nz * (0.65 + L) / 2], [nx * L, ny * L, nz * L]], (k) => [0.06, 0.03, 0.006][k], 5, true, (k) => [-0.7, -0.85, -1][k]); }
    return body;
  }
  function skinPuffer() {
    rseed(932); const m = icosphere(3, (x, y, z) => { const r = 0.88 * (1 + 0.03 * (vnoise(x * 3, y * 3, z * 3) - 0.5)); return [x * r * 1.05, y * r * 0.95, z * r]; }); for (let i = 0; i < m.aux.length; i++) m.aux[i] = 0;
    const NSP = 70;
    for (let i = 0; i < NSP; i++) { const yy = 1 - 2 * (i + 0.5) / NSP, r0 = sqrt(1 - yy * yy), a = i * 2.39996, nx = cos(a) * r0, ny = yy, nz = sin(a) * r0;
      if (nz > 0.75 && abs(ny) < 0.45 && abs(nx) > 0.12) continue; // keep the face clear around the eyes
      m.tube([[nx * 0.84, ny * 0.84, nz * 0.84], [nx * 1.18, ny * 1.18, nz * 1.18]], (k) => [0.05, 0.004][k], 4, true, (k) => [0.18, 0.3][k]); }
    for (const sx of [-1, 1]) { const e = icosphere(1, (x, y, z) => [sx * 0.34 + x * 0.14, 0.18 + y * 0.14, 0.82 + z * 0.1]); const o = m.p.length / 3; m.p.push(...e.p); for (let i = 0; i < e.aux.length; i++) m.aux.push(-0.3); for (const t of e.i) m.i.push(t + o); }
    m.sweep([[0, 0, -0.85], [0, 0, -1.25]], (k) => [0.05, 0.05][k], (k) => [0.25, 0.55][k], () => [1, 0, 0]); // tail fin
    for (let i = 0; i < m.aux.length; i++) if (m.aux[i] === 1) m.aux[i] = 0.1;
    return m;
  }
  function skinJelly() {
    rseed(933); const m = icosphere(3, (x, y, z) => { const fr = 1 + 0.06 * sin(atan2(z, x) * 9) * sstep(0.3, -0.2, y); const yy = y > 0 ? y * 0.85 : y * 0.45; return [x * 0.95 * fr, yy + 0.15, z * 0.95 * fr]; });
    for (let i = 0; i < m.aux.length; i++) m.aux[i] = 0.6;
    for (let i = 0; i < 9; i++) { const a = i / 9 * TAU, r = i % 3 === 0 ? 0.25 : 0.62, pts = []; for (let k = 0; k <= 5; k++) pts.push([cos(a) * r * (1 - k * 0.08) + sin(k * 1.3 + i) * 0.08, -0.15 - k * 0.2, sin(a) * r * (1 - k * 0.08) + cos(k * 1.1 + i) * 0.08]);
      m.tube(pts, (k) => (i % 3 === 0 ? 0.09 : 0.035) * (1 - k / 6), 5, true, () => 1); }
    return m;
  }

  // ---------------------------------------------------------------- the world along Reef's rail
  // the canyon: rings of the cross-section (normal ↔ grotto by the grotto weight), displaced by noise; normals face the rail
  function canyon() {
    const R = A.rail, Lr = R.len, nr = Math.ceil(Lr / DS) + 1, NP = NPROF, nv = nr * (NP + 1);
    const P = new Float32Array(nv * 3), AX = new Float32Array(nv), Cn = new Float32Array(nr * 3);
    const prof = (t, g, o, br, bl) => { const f = t * (PROF.length - 1), i = min(floor(f), PROF.length - 2), w = f - i; o[0] = mix(mix(PROF[i][0], PROF[i + 1][0], w), mix(PROF_G[i][0], PROF_G[i + 1][0], w), g) + br * sstep(0.56, 0.72, t) - bl * sstep(0.44, 0.28, t); o[1] = mix(mix(PROF[i][1], PROF[i + 1][1], w), mix(PROF_G[i][1], PROF_G[i + 1][1], w), g); return o; };
    const a = [0, 0], b = [0, 0], c = [0, 0];
    for (let k = 0; k < nr; k++) {
      const s = min(k * DS, Lr), g = grottoW(s), br = bayR(s), bl = bayL(s); R.at(s, C3); R.frame(s, FRm); Cn[k * 3] = C3[0] + FRm[6] * 3; Cn[k * 3 + 1] = C3[1] + FRm[7] * 3; Cn[k * 3 + 2] = C3[2] + FRm[8] * 3;
      for (let j = 0; j <= NP; j++) {
        const t = j / NP; prof(t, g, a, br, bl); prof(max(t - 0.01, 0), g, b, br, bl); prof(min(t + 0.01, 1), g, c, br, bl);
        let nu = c[1] - b[1], nvv = -(c[0] - b[0]); const nl = hypot(nu, nvv) || 1; nu /= nl; nvv /= nl; if (nu * a[0] + nvv * a[1] > 0) { nu = -nu; nvv = -nvv; } // inward
        const x0 = C3[0] + FRm[3] * a[0] + FRm[6] * a[1], y0 = C3[1] + FRm[4] * a[0] + FRm[7] * a[1], z0 = C3[2] + FRm[5] * a[0] + FRm[8] * a[1];
        const flo = sstep(0.28, 0.4, t) * sstep(0.72, 0.6, t), amp = mix(3.2, 0.35, flo);
        const dsp = amp * ((fbm(x0 * 0.07, y0 * 0.07, z0 * 0.07, 4) - 0.5) * 2 + 0.35 * (vnoise(x0 * 0.3, y0 * 0.3, z0 * 0.3) - 0.5)) + flo * 0.18 * sin(s * 0.9 + a[0] * 0.35 + 6 * fbm(x0 * 0.05, 0, z0 * 0.05, 2));
        const du = nu * dsp, dv = nvv * dsp, o = (k * (NP + 1) + j) * 3;
        P[o] = x0 + FRm[3] * du + FRm[6] * dv; P[o + 1] = y0 + FRm[4] * du + FRm[7] * dv; P[o + 2] = z0 + FRm[5] * du + FRm[8] * dv;
        AX[k * (NP + 1) + j] = clamp(1 - abs(t - 0.5) * 2.6, -1, 1);
      }
    }
    const I = new Uint32Array((nr - 1) * NP * 6); let q = 0;
    for (let k = 0; k < nr - 1; k++) for (let j = 0; j < NP; j++) { const i0 = k * (NP + 1) + j, i1 = i0 + 1, i2 = i0 + NP + 1, i3 = i2 + 1; I[q++] = i0; I[q++] = i2; I[q++] = i1; I[q++] = i1; I[q++] = i2; I[q++] = i3; }
    const N = new Float32Array(nv * 3);
    for (let t = 0; t < I.length; t += 3) {
      const a0 = I[t] * 3, b0 = I[t + 1] * 3, c0 = I[t + 2] * 3, ux = P[b0] - P[a0], uy = P[b0 + 1] - P[a0 + 1], uz = P[b0 + 2] - P[a0 + 2], vx = P[c0] - P[a0], vy = P[c0 + 1] - P[a0 + 1], vz = P[c0 + 2] - P[a0 + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; N[a0] += nx; N[a0 + 1] += ny; N[a0 + 2] += nz; N[b0] += nx; N[b0 + 1] += ny; N[b0 + 2] += nz; N[c0] += nx; N[c0 + 1] += ny; N[c0 + 2] += nz;
    }
    const vb = new ArrayBuffer(nv * 16), f = new Float32Array(vb), sb = new Int8Array(vb);
    for (let i = 0; i < nv; i++) {
      const k = (i / (NP + 1)) | 0; let nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2];
      if (nx * (Cn[k * 3] - P[i * 3]) + ny * (Cn[k * 3 + 1] - P[i * 3 + 1]) + nz * (Cn[k * 3 + 2] - P[i * 3 + 2]) < 0) { nx = -nx; ny = -ny; nz = -nz; }
      const l = hypot(nx, ny, nz) || 1;
      f[i * 4] = P[i * 3]; f[i * 4 + 1] = P[i * 3 + 1]; f[i * 4 + 2] = P[i * 3 + 2];
      sb[i * 16 + 12] = round(nx / l * 127); sb[i * 16 + 13] = round(ny / l * 127); sb[i * 16 + 14] = round(nz / l * 127); sb[i * 16 + 15] = round(clamp(AX[i], -1, 1) * 127);
    }
    return { vb, ib: I, nv, inst: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 20, 0, 0, 0]), realmPart: 'walls' };
  }
  // the floor height (v) at offset u, from the cross-section
  const floorV = (u, g, s) => { const au = max(0, abs(u) - (s == null ? 0 : u > 0 ? bayR(s) : bayL(s)) * sstep(9, 14, abs(u))); const lo = (P) => { for (let i = 5; i < P.length - 1; i++) if (P[i + 1][0] >= au) return mix(P[i][1], P[i + 1][1], (au - P[i][0]) / (P[i + 1][0] - P[i][0])); return P[P.length - 1][1]; }; return mix(lo(PROF), lo(PROF_G), g); };
  const floorAt = (s, u, o) => railAt(s, u, floorV(u, grottoW(s), s) - 0.4, o);
  // a quaternion whose local +y is the rail frame's up at s, turned by yaw about it
  const upQ = (s, yaw) => { A.rail.frame(s, FRm); return qMul(qFromY(FRm[6], FRm[7], FRm[8]), qAxis(0, 1, 0, yaw)); };
  // a quaternion from an orthonormal basis (columns x, y, z), written into o (no allocation)
  function qBasis(xx, xy, xz, yx, yy, yz, zx, zy, zz, o) {
    const tr = xx + yy + zz; let w, x, y, z;
    if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; w = 0.25 * s; x = (yz - zy) / s; y = (zx - xz) / s; z = (xy - yx) / s; }
    else if (xx > yy && xx > zz) { const s = Math.sqrt(1 + xx - yy - zz) * 2; w = (yz - zy) / s; x = 0.25 * s; y = (yx + xy) / s; z = (zx + xz) / s; }
    else if (yy > zz) { const s = Math.sqrt(1 + yy - xx - zz) * 2; w = (zx - xz) / s; x = (yx + xy) / s; y = 0.25 * s; z = (zy + yz) / s; }
    else { const s = Math.sqrt(1 + zz - xx - yy) * 2; w = (xy - yx) / s; x = (zx + xz) / s; y = (zy + yz) / s; z = 0.25 * s; }
    o[0] = x; o[1] = y; o[2] = z; o[3] = w; return o;
  }
  const inst = (list) => new Float32Array(list);

  let kelpV = null, mantaM = null;
  const MAN = { n: 0, d: null }; // manta orbits: cx, cy, cz, R, speed, phase, size, bank sign
  function build(A_, H) {
    A = A_; marks(); if (built) return built;
    const t0 = performance.now(), R = A.rail, P3 = [0, 0, 0], solids = [];
    const walls = canyon(); if (!DBG.includes('nocanyon')) solids.push(walls);
    const span0 = A.sHero - 20, Lr = R.len;
    // ---- UW-K1 kelp walls: three column variants, instanced on both sides (fewer and purple in the grotto), swaying
    const KH = [22, 28, 34], km = KH.map((h, i) => { const m = meshKelp(300 + i, h).build(); m.realmPart = 'decor'; m.kelpH = h; return m; });
    const kl = [[], [], []], specks = [];
    rseed(310);
    for (let s = span0; s < Lr - 4; s += rr(KELP.step[0], KELP.step[1])) for (const sd of [-1, 1]) {
      const g = grottoW(s);
      if (sd > 0 && abs(s - LM.ship) < 26) continue; if (sd < 0 && abs(s - LM.fluke) < 22) continue; if (rnd() < g * 0.45) continue;
      for (let row = 0; row < (rnd() < KELP.back ? 2 : 1); row++) {
        const u = sd * (row ? rr(15.5, 18) : rr(KELP.u[0], KELP.u[1])), v = row ? 0 : rr(0, 1), b = floorAt(s + rr(-1, 1), u, P3), vi = (rnd() * 3) | 0, sc = rr(0.75, 1.1), yaw = rnd() * TAU;
        kl[vi].push(b[0], b[1] - v, b[2], sc, 0, sin(yaw / 2), 0, cos(yaw / 2), 22, rnd(), 0, KH[vi], yaw, rr(0, TAU), rr(0, TAU), rr(0.6, 1.4)); // + sway: yaw, axis phase, time phase, amount
        for (let i = 0; i < KELP.specks; i++) { const h = rr(1.5, KH[vi] * sc), a = rnd() * TAU, r = rr(0.2, 0.9); specks.push(b[0] + cos(a) * r, b[1] + h, b[2] + sin(a) * r, g); }
      }
    }
    kelpV = km.map((m, i) => { const src = kl[i], n = src.length / 16, I = new Float32Array(n * 12), S = new Float32Array(n * 4); for (let k = 0; k < n; k++) { for (let c = 0; c < 12; c++) I[k * 12 + c] = src[k * 16 + c]; for (let c = 0; c < 4; c++) S[k * 4 + c] = src[k * 16 + 12 + c]; } m.inst = I; m.sway = S; return m; });
    if (!DBG.includes('nokelp')) for (const m of kelpV) solids.push(m);
    // ---- UW-L1 the sunken ship: on the right wall, bow along the rail, heeled and pitched up on the rocks (upstream set piece)
    { const ship = meshShip().build(); ship.realmPart = 'decor'; railAt(LM.ship, 24, 0.5, P3); R.frame(LM.ship, FRm);
      const yaw = Math.atan2(-FRm[2], FRm[0]), q = qMul(qAxis(0, 1, 0, yaw), qMul(qAxis(0, 0, 1, 0.2), qAxis(1, 0, 0, 0.32)));
      ship.inst = inst([P3[0], P3[1], P3[2], 1, ...q, 23, 0.5, 0, 1]); solids.push(ship); LM.shipP = P3.slice(); }
    // ---- UW-L2 the stone whale tail: on the left side, its broad face to the corridor, leaning a little (upstream roll 0.16, pitch -0.3)
    { // its broad face turned toward the oncoming ship
      const fl = meshFluke().build(); fl.realmPart = 'decor'; floorAt(LM.fluke, -20, P3); R.frame(LM.fluke, FRm);
      const yaw = Math.atan2(FRm[3] - FRm[0] * 0.8, FRm[5] - FRm[2] * 0.8), q = qMul(qAxis(0, 1, 0, yaw), qMul(qAxis(0, 0, 1, 0.16), qAxis(1, 0, 0, -0.22)));
      fl.inst = inst([P3[0], P3[1] - 1.5, P3[2], 1.65, ...q, 24, 0.3, 0, 1]); solids.push(fl); LM.flukeP = P3.slice(); }
    // ---- UW-P1 barrel sponges (upstream main.js lathe profiles), UW-P2 coral, UW-P3 tufts: gardens at the fluke and in the grotto, a scatter elsewhere
    const LATHE = [meshLathe([[0, 0, 0.5], [0.34, 0, 0.6], [0.5, 0.2, 0.85], [0.6, 0.6, 1], [0.55, 0.95, 1], [0.47, 1.08, 1], [0.38, 1.1, 0.9], [0.3, 1.0, 0.45], [0.26, 0.6, 0.15], [0, 0.35, 0.05]], 18, 0.3, 9),
      meshLathe([[0, 0, 0.5], [0.2, 0, 0.6], [0.26, 0.5, 0.85], [0.4, 1.25, 1], [0.4, 1.42, 1], [0.33, 1.48, 0.9], [0.26, 1.38, 0.4], [0.18, 0.8, 0.12], [0, 0.5, 0.05]], 16, 0.35, 8),
      meshLathe([[0, 0, 0.5], [0.5, 0, 0.7], [0.72, 0.18, 1], [0.74, 0.38, 1], [0.62, 0.5, 0.9], [0.48, 0.42, 0.45], [0.4, 0.2, 0.15], [0, 0.14, 0.06]], 18, 0.25, 10)].map((m) => m.build());
    const CORAL = [meshCoral(1).build(), meshCoral(0).build()];
    const TUFT = (() => { rseed(330); const m = new Mesh(); for (let i = 0; i < 7; i++) { const a = i / 7 * TAU + rr(-0.3, 0.3), l = rr(0.35, 0.6), w = 0.05, lean = rr(0.2, 0.5), cx = cos(a), cz = sin(a), s0 = m.v(-cz * w, 0, cx * w), s1 = m.v(cz * w, 0, -cx * w), tp = m.v(cx * lean * l, l, cz * lean * l); m.tri(s0, s1, tp); } return m.build(); })();
    const pl = { lathe: [[], [], []], coral: [[], []], tuft: [] };
    const plant = (s, u, kind, scl, wild) => { const b = floorAt(s, u, P3), q = upQ(s, rnd() * TAU); if (kind === 'lathe') pl.lathe[(rnd() * 3) | 0].push(b[0], b[1] + 0.25, b[2], scl, ...q, 26, rnd(), 0, 0); else if (kind === 'coral') pl.coral[(rnd() * 2) | 0].push(b[0], b[1] + 0.3, b[2], scl, ...q, 27, rnd(), 0, 0); else pl.tuft.push(b[0], b[1] + 0.35, b[2], scl, ...q, 29, rnd(), wild, 0); };
    rseed(320);
    for (let i = 0; i < 70; i++) plant(LM.fluke + rr(-28, 30), rr(-12, 9), rnd() < 0.62 ? 'lathe' : 'coral', rr(0.9, 1.9), 0); // the sponge garden at the tail (sponge-garden / whale-fluke shots)
    for (let i = 0; i < 110; i++) plant(rr(LM.g0, LM.g1), rr(-12, 12), rnd() < 0.45 ? 'lathe' : 'coral', rr(0.7, 1.6), 0);
    for (let i = 0; i < 120; i++) plant(rr(span0 + 30, Lr - 10), rr(-12, 12) , rnd() < 0.5 ? 'lathe' : 'coral', rr(0.6, 1.4), 0);
    for (let i = 0; i < 900; i++) plant(rr(LM.g0 - 10, LM.g1 + 10), rr(-12.5, 12.5), 'tuft', rr(0.8, 1.6), 1);
    for (let i = 0; i < 260; i++) { const s = rr(span0, Lr - 5); plant(s, rr(-13, 13), 'tuft', rr(0.7, 1.4), rnd() < 0.25 ? 1 : 0); }
    LATHE.forEach((m, i) => { m.inst = inst(pl.lathe[i]); m.realmPart = 'decor'; solids.push(m); });
    CORAL.forEach((m, i) => { m.inst = inst(pl.coral[i]); m.realmPart = 'decor'; solids.push(m); });
    TUFT.inst = inst(pl.tuft); TUFT.realmPart = 'decor'; solids.push(TUFT);
    // ---- floating boulders above the canyon (upstream BOULD clusters; silhouettes against the light)
    { const bm = [meshChunk(3).build(), meshChunk(5).build()], bl = [[], []]; rseed(340);
      for (let c = 0; c < 14; c++) { const s = rr(span0 + 40, Lr - 20), u0 = rr(-14, 14), v0 = rr(20, 32), n = 3 + (rnd() * 6) | 0;
        for (let i = 0; i < n; i++) { const p = railAt(s + rr(-8, 8), u0 + rr(-6, 6), v0 + rr(-3, 4), P3), sc = i ? rr(0.5, 2.2) : rr(2.5, 4.5); bl[i % 2].push(p[0], p[1], p[2], sc, ...qRand(), 21, rnd(), 0, 1); } }
      bm.forEach((m, i) => { m.inst = inst(bl[i]); m.realmPart = 'decor'; solids.push(m); }); }
    // ---- UW-M1 mantas (stand in for the whales): orbiting overhead at the ship, the tail and in the open stretches
    mantaM = meshManta().build(); mantaM.realmPart = 'decor';
    { const at = [[LM.ship + 6, 4, 15, 16, 4.6], [LM.fluke - 4, -2, 13, 12, 3.8], [A.sHero + 90, 0, 16, 22, 5.2], [mix(LM.fluke, LM.g0, 0.5), 3, 17, 26, 4.4], [LM.g1 + 60, -3, 15, 18, 4.0]];
      MAN.n = at.length; MAN.d = new Float32Array(MAN.n * 8); mantaM.inst = new Float32Array(MAN.n * 12); rseed(350);
      at.forEach((m, i) => { const p = railAt(min(m[0], Lr - 5), m[1], m[2], P3); MAN.d.set([p[0], p[1], p[2], m[3], (rnd() < 0.5 ? -1 : 1) * rr(0.05, 0.08), rnd() * TAU, m[4], rnd() * TAU], i * 8); mantaM.inst.set([p[0], p[1], p[2], m[4], 0, 0, 0, 1, 28, rnd(), 0, 1], i * 12); }); }
    solids.push(mantaM);
    // ---- target skins
    const skins = [skinUrchin().build(), skinPuffer().build(), skinJelly().build()];
    // ---- points: kelp glints, fish schools, bubbles, motes, grotto glow
    let nPts = 0;
    const pts = H.pointsFor((put0, R2) => { const put = (x, y, z, sz, r, g, b, k) => { nPts++; put0(x, y, z, sz, r, g, b, k); };
      for (let i = 0; i < specks.length; i += 4) { const g = specks[i + 3], hs = rnd(), c = g > 0.5 ? (rnd() < 0.6 ? [0.5, 0.35, 1.0] : [0.2, 1.0, 0.7]) : hs < 0.42 ? [1.0, 0.62, 0.08] : hs < 0.84 ? [0.12, 1.0, 0.22] : [0.2, 0.85, 1.0], b = rr(1.2, 3.2); put(specks[i], specks[i + 1], specks[i + 2], rr(0.025, 0.05), c[0] * b, c[1] * b, c[2] * b, 1); }
      rseed(360); // UW-F3 fish schools
      const SCH = [[LM.ship - 6, 8, 10, 7, 170], [LM.fluke + 4, -4, 8, 9, 170], [A.sHero + 40, 4, 9, 6, 120], [mix(LM.ship, LM.fluke, 0.5), -6, 10, 11, 150], [LM.g0 + 30, 2, 12, 6, 120], [LM.g1 + 25, 5, 8, 8, 140], [Lr * 0.9, -3, 10, 10, 140]];
      for (const sc of SCH) { const c = railAt(min(sc[0], Lr - 5), sc[1], sc[2], [0, 0, 0]), Rk = sc[3] + rr(0, 0.9); for (let i = 0; i < sc[4]; i++) { const b = rr(0.35, 0.75), gold = rnd() < 0.12; put(c[0] + Rk + rr(-2.6, 2.6) + rr(-1, 1), c[1] + rr(-1.3, 1.3), c[2] + rr(-2.6, 2.6), rr(0.011, 0.016), (gold ? 0.95 : 0.5) * b, (gold ? 0.8 : 0.68) * b, (gold ? 0.3 : 0.8) * b, 3 + Rk / 100); } }
      rseed(370); // UW-B1 bubble vents on the floor
      for (let v = 0; v < 26; v++) { const s = rr(span0 + 20, Lr - 10), b = floorAt(s, rr(-11, 11), [0, 0, 0]), Hh = rr(24, 36), n = 26 + (rnd() * 12 | 0); for (let i = 0; i < n; i++) { const big = rnd() < 0.24, l = rr(0.25, 0.55); put(b[0] + rr(-0.3, 0.3), b[1] + rr(0, 0.3), b[2] + rr(-0.3, 0.3), big ? rr(0.07, 0.13) : rr(0.03, 0.06), 0.45 * l, 0.75 * l, 0.85 * l, 2 + Hh / 100); } }
      rseed(380); // UW-B2 drifting motes
      for (let i = 0; i < 800; i++) { const s = rr(0, R2.len), p = railAt(s, rr(-14, 14), rr(-10, 18), [0, 0, 0]), b = rr(0.25, 0.8); put(p[0], p[1], p[2], rr(0.015, 0.04), 0.55 * b, 0.8 * b, 0.85 * b, 1); }
      rseed(390); // UW-L3 grotto glow on the floor
      for (let i = 0; i < 300; i++) { const p = floorAt(rr(LM.g0, LM.g1), rr(-12, 12), [0, 0, 0]), b = rr(0.8, 2.0); put(p[0], p[1] + 0.4, p[2], rr(0.03, 0.06), 1.0 * b, 0.3 * b, 0.8 * b, 0); }
    });
    built = { solids, skins, pts, gateMat: 25, ms: performance.now() - t0, nPts, cap: A.nScenePts, kelp: kelpV.map((m) => m.inst.length / 12), tris: solids.reduce((a, m) => a + m.ib.length / 3 * max(1, m.inst.length / 12), 0) };
    return built;
  }

  // ---------------------------------------------------------------- per frame (no allocation): the mantas swim, the kelp sways
  const QB = new Float64Array(4);
  function uniforms(S, s, t) {
    if (!built) return;
    let zc = 0; for (let i = 0; i < LM.gz.length; i++) { const g = LM.gz[i], d = hypot(A.cam[0] - g[0], A.cam[1] - g[1], A.cam[2] - g[2]); zc = max(zc, sstep(g[3] * 1.6, g[3], d)); } S.p0[3] = zc; // the camera's grotto zone
    const D = MAN.d, I = mantaM.inst;
    for (let i = 0; i < MAN.n; i++) { // upstream vsManta's orbit: P = c + (R cos a, 2.5 sin(2a + ph), 0.75 R sin a), banked into the turn
      const o = i * 8, Rr = D[o + 3], sp = D[o + 4], ph = D[o + 5], ta = t * sp + ph;
      const x = D[o] + Rr * cos(ta), y = D[o + 1] + 2.5 * sin(2 * ta + D[o + 7]), z = D[o + 2] + Rr * 0.75 * sin(ta);
      let tx = -Rr * sin(ta) * Math.sign(sp), tz = Rr * 0.75 * cos(ta) * Math.sign(sp); const ty = 0, tl = hypot(tx, tz) || 1; tx /= tl; tz /= tl; // level heading
      let sx = tz, sz = -tx; const sl = hypot(sx, sz) || 1; sx /= sl; sz /= sl; // side = up × T
      let ux = ty * sz, uy = tz * sx - tx * sz, uz = -ty * sx; // up = T × side
      const bank = -0.28 * Math.sign(sp), cb = cos(bank), sb = sin(bank), Sx = sx * cb + ux * sb, Sy = uy * sb, Sz = sz * cb + uz * sb; ux = ux * cb - sx * sb; uy = uy * cb; uz = uz * cb - sz * sb;
      qBasis(Sx, Sy, Sz, ux, uy, uz, tx, ty, tz, QB);
      const k = i * 12; I[k] = x; I[k + 1] = y; I[k + 2] = z; I[k + 4] = QB[0]; I[k + 5] = QB[1]; I[k + 6] = QB[2]; I[k + 7] = QB[3];
    }
    mantaM.dirty = true;
    for (let v = 0; v < kelpV.length; v++) { // rigid sway about the column's foot (upstream sways each blade in its vertex shader)
      const m = kelpV[v], K = m.inst, W = m.sway, n = W.length / 4;
      for (let i = 0; i < n; i++) {
        const yaw = W[i * 4], ap = W[i * 4 + 1], tp = W[i * 4 + 2], amt = W[i * 4 + 3];
        const ang = (0.022 * sin(t * 0.5 + tp) + 0.008 * sin(t * 1.3 + tp * 2.1)) * amt, h = ang * 0.5, sh = sin(h);
        const a0 = cos(ap) * sh, a2 = sin(ap) * sh, a3 = cos(h), b1 = sin(yaw * 0.5), b3 = cos(yaw * 0.5), o = i * 12;
        K[o + 4] = a0 * b3 - a2 * b1; K[o + 5] = a3 * b1; K[o + 6] = a0 * b1 + a2 * b3; K[o + 7] = a3 * b3;
      }
      m.dirty = true;
    }
  }

  const underwater = {
    name: 'Underwater', short: 'UNDERWATER', dial: 'SEA', pal: [0.18, 0.62, 0.9], fx: [0, 2, 4], label: 'Critter',
    // the caustic-light grade facet (STYLE rolls it only here): a moving caustic net laid over the frame, brighter on lit surfaces
    grades: [{ id: 'caustic', name: 'Caustic light', realm: 'underwater', w: 'let cq2 = uv * vec2f(u.res.x / max(u.res.y, 1.0), 1.0) * 6.0; let cg = pow(1.0 - abs(vn3(vec3f(cq2, u.cam.w * 0.45)) * 2.0 - 1.0), 7.0) * pow(1.0 - abs(vn3(vec3f(cq2 * 1.7 + 3.1, u.cam.w * 0.6)) * 2.0 - 1.0), 3.0); let lg = dot(c, vec3f(0.2126, 0.7152, 0.0722)); c = c * vec3f(0.93, 1.0, 1.03) + vec3f(0.55, 0.95, 1.0) * cg * (0.2 + 0.7 * lg) * select(0.45, 1.0, d0 > 0.0);' }],
    scene, build, uniforms,
    get marks() { return LM; },
    // test aid: the rail position `back` m before a landmark and the rail-relative look (yaw, pitch) at a point dy m above it
    aim(name, back = 30, dy = 6) { const P = { ship: LM.shipP, fluke: LM.flukeP }[name]; const s = LM[name] - back, c = A.rail.at(s, [0, 0, 0]); A.rail.frame(s, FRm);
      let dx = P[0] - c[0], ddy = P[1] + dy - c[1], dz = P[2] - c[2]; const l = hypot(dx, ddy, dz); dx /= l; ddy /= l; dz /= l;
      const f = dx * FRm[0] + ddy * FRm[1] + dz * FRm[2], r = dx * FRm[3] + ddy * FRm[4] + dz * FRm[5], u = dx * FRm[6] + ddy * FRm[7] + dz * FRm[8];
      return { s, yaw: Math.atan2(r, f), pitch: Math.asin(clamp(u, -1, 1)), dist: l }; }, get stats() { return built && { ms: +built.ms.toFixed(1), pts: built.nPts, cap: built.cap, kelp: built.kelp, tris: built.tris }; },
  };
  return { underwater };
})();
