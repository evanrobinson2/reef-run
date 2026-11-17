// ============================================================================
// realm-body.js: Inside the Body, Reef Run's body realm pack (GAME_API.md "Body realm"). carpetshark: "give an upgrade to the inside
// the body stuff". The four looks are rebuilt along Reef's rail from the selected concepts (concept/body/SELECTION.md:
// BD-1.0 Gooey, BD-2.2 Glow, BD-3.0 Microscope, BD-4.0 Heart) and their decompositions (concept/body/<look>/DECOMPOSITION.md;
// IDs such as BT-R, BG-V, MC-FOLD, HG-P cite them). The gap list and the comparisons are in concept/body/REALM_UPGRADE.md.
//
// What realms.js gets from here (one call each; realms.js keeps the warp, facets, music, dial and Reef's targets):
//   wgsl(look)            the realm's shadeSolid (wrapping the look's own shadeSolid_base, so the standalone materials are
//                         reused as they are) and solidVertex (engine hook, realm packs only): target wobble and faces, tumbling
//                         cells, the walls' heartbeat throb
//   post(look) / pre(look) the post-pass extras (Glow: membrane light shafts)
//   tune(S, look)         per-look scene settings (Gooey: its own DOF gather, mild; Microscope: the engine's DOF)
//   build(look, h)        world geometry along the rail: wall chunks, decor, the blood-cell river pools, target skins, points
//   frame(dt, ...)        per frame: the beat, the wall/decor windows along the rail, the river (no allocation)
//   uniforms(S, s, t)     the beat (u.p0.w) and the look's light/focus uniforms
//   enter(look)           the entry moment: the INSIDE THE BODY card and a whoosh of cells
// Everything heavy is built once per look, on first use, outside the frame.
// ============================================================================
const BODY_REALM = (() => {
  const LOOKS = ['toy', 'glow', 'micro', 'heart'];
  const REDUCED = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  // ---------------------------------------------------------------- tables (data, so they can be retuned)
  // the heartbeat: from the live track's beat map (music-map.js; Pulse Circuit A 172.25 bpm is the body's own), one lub-dub
  // every two beats above 120 bpm (86 per minute at Pulse Circuit A), every beat below; the dub 0.17 s after the lub
  const BEAT = { bpm: 172.25, t0: 1.271, dub: 0.17, lubK: 13, dubK: 15, dubA: 0.6, surge: 0.8 };
  const WIN = { back: 30, ahead: 330 }; // what is drawn along the rail around the ship (m): walls, pipes, decor
  const RIVER = { ahead: 175, back: 14, near: 42 }; // the river pool's reach and its high-detail radius (m)
  const LOOK = {
    // BD-1.0: concentric twisting ribbon folds (BT-C2), red nubbed gummy cells (BT-R), grumpy green germs with faces (BT-V)
    toy: { R: 15, ds: 0.8, sides: 72, throb: 0.32, river: { n: 300, v: 5, lanes: 3, rho: [8.5, 13.2] }, tumble: 0.8,
      card: { sub: 'GOOEY · BLAST THE GRUMPY GERMS', col: '#ffb0a8' }, pts: { n: 1500, c: [[1.9, 1.1, 0.45], [1.6, 0.6, 0.55]] } },
    // BD-2.2: dark maroon membrane with cool rims (BG-W), club-spiked glowing viruses (BG-V), red motes (BG-M1), light shafts
    glow: { R: 15, ds: 1.0, sides: 64, throb: 0.22, river: { n: 240, v: 6, lanes: 4, rho: [9, 13] }, tumble: 1.1,
      card: { sub: 'GLOW · VIRUS SWARM AHEAD', col: '#ff6fb4' }, pts: { n: 2400, c: [[2.4, 0.55, 0.9], [0.9, 0.8, 2.2]] } },
    // BD-3.0: fibrous pink membrane (MC-FOLD, MC-FIBRE), red discs, purple and cream cells, beads (RBC, WBC, CRM, SB), DOF
    micro: { R: 15, ds: 1.2, sides: 56, throb: 0.18, river: { n: 340, v: 4, lanes: 3, rho: [8.5, 13] }, tumble: 0.5,
      card: { sub: 'MICROSCOPE · ZAP THE BACTERIA', col: '#f4c8e8' }, pts: { n: 1400, c: [[1.3, 1.25, 1.2], [1.5, 1.2, 0.9]] },
      dof: { focus: 24, range: 13, near: 0.9, far: 0.32, maxBlur: 0.032, bokeh: 0.4 } },
    // BD-4.0: teal-grey wall with radial strokes (HG-W1), pink pipes with collars (HG-P), heart-shaped glowing rings (HG-H),
    // teal machinery drums (HG-M1), lumpy crimson cells (HG-R), clots
    heart: { R: 15, ds: 1.2, sides: 56, throb: 0.4, river: { n: 340, v: 6, lanes: 4, rho: [8, 11.2] }, tumble: 0.7,
      card: { sub: 'HEART · CLEAR THE CLOTS', col: '#ff7a86' }, pts: { n: 1800, c: [[2.3, 0.55, 0.65], [2.0, 0.9, 0.8]] },
      rings: 150 },
  };

  // ---------------------------------------------------------------- WGSL
  // shared: the vertex hook. Negative instance scale = tumble about a per-instance axis. mat 0 (Reef's targets): jelly wobble,
  // and in Gooey the face turns to the camera (eyes blink). mat 10 (walls): the vessel dilates on the beat.
  const vertexW = (look) => `
struct SV { wp: vec3f, n: vec3f };
fn rQmul(a: vec4f, b: vec4f) -> vec4f { return vec4f(a.w * b.xyz + b.w * a.xyz + cross(a.xyz, b.xyz), a.w * b.w - dot(a.xyz, b.xyz)); }
fn solidVertex(p: vec3f, na: vec4f, i0: vec4f, i1: vec4f, i2: vec4f) -> SV {
  let t = u.cam.w; let mat = i2.x; let n = na.xyz;
  if (mat > 9.5 && mat < 10.5) { return SV(p - n * u.p0.w * ${LOOK[look].throb.toFixed(3)}, n); } // walls (identity instance)
  var q = i1; var lp = p; let sc = abs(i0.w);
  if (i0.w < 0.0) { // tumbling cells
    let h = fract(vec3f(i2.y * 7.31, i2.y * 13.7, i2.y * 3.97) + 0.17) * 2.0 - 1.0; let ax = normalize(h + vec3f(1e-3));
    let a = t * (0.3 + 0.9 * fract(i2.y * 5.3)) * ${LOOK[look].tumble.toFixed(2)} + i2.y * 6.0;
    q = rQmul(q, vec4f(ax * sin(a * 0.5), cos(a * 0.5)));
  }
  if (mat < 0.5) { // targets: squash and stretch, a ripple over the skin
    let ph = t * 2.4 + i2.y * 31.0;
    lp = p * vec3f(1.0 + 0.07 * sin(ph), 1.0 + 0.07 * sin(ph + 2.09), 1.0 + 0.07 * sin(ph + 4.19));
    lp += n * 0.035 * sin(dot(p, vec3f(4.1, 3.3, 2.7)) + t * 4.0 + i2.y * 17.0) * step(0.3, na.w);
${look === 'toy' ? `    if (na.w < -0.3) { let bl = step(0.965, fract(t * 0.23 + i2.y * 3.7)); lp.y = mix(lp.y, 0.16 + (lp.y - 0.16) * 0.15, bl * step(-0.9, na.w) * step(na.w, -0.7)); } // eyes blink
    // the face looks at the camera (personality), with a little head tilt
    let f = normalize(u.cam.xyz - i0.xyz); let r0 = normalize(cross(vec3f(0.0, 1.0, 0.0), f) + vec3f(1e-4, 0.0, 0.0)); let up0 = cross(f, r0);
    let tl = 0.25 * sin(t * 1.3 + i2.y * 9.0); let r = r0 * cos(tl) + up0 * sin(tl); let up = up0 * cos(tl) - r0 * sin(tl);
    return SV(i0.xyz + (r * lp.x + up * lp.y + f * lp.z) * sc, r * n.x + up * n.y + f * n.z);` : ''}
  }
  var wp = i0.xyz + qrot(q, lp * sc);
  wp.y += sin(t * 0.9 + i2.y * 6.28) * select(i2.z, 0.0, i2.x > 2.5);
  return SV(wp, qrot(q, n));
}
`;
  // per look: the fragment side. shadeSolid_base is the look's own (bodytoy.js etc.), reused for its materials.
  const fragW = {
    toy: `
fn bLit(n: vec3f, l: vec3f, w: f32) -> f32 { return sat((dot(n, l) + w) / (1.0 + w)); }
fn bodyTarget(wp: vec3f, n0: vec3f, aux: f32, prm: vec4f, lp: vec3f) -> vec3f {
  // BT-V germs: pastel green lumpy bodies, stalks with blob tips, salmon spots, dark glossy eyes, grumpy mouths
  let v = normalize(u.cam.xyz - wp); var n = n0; if (dot(n, v) < 0.0) { n = -n; }
  let k = fract(prm.y * 7.13);
  let col = mix(mix(vec3f(0.86, 0.94, 0.70), vec3f(0.74, 0.82, 0.60), smoothstep(0.3, 0.7, k)), vec3f(0.76, 0.98, 0.68), smoothstep(0.75, 0.95, k)); // BT-V2 mint / BT-V1 sage, lifted (the look's pink ambient browns them)
  if (aux > 0.3) {
    var c = shadeSolid_base(wp, n0, aux, vec4f(4.0, col * select(1.12, 1.0, aux > 0.9)), lp);
    let sp = smoothstep(0.64, 0.74, vn3(lp * 4.2 + vec3f(prm.y * 19.0))) * step(0.9, aux) * step(lp.z, 0.55);
    return mix(c, c * vec3f(1.25, 0.85, 0.75) + vec3f(0.12, 0.03, 0.02), sp * 0.8); // salmon spots (BT-V1)
  }
  let L = normalize(u.sun.xyz); let h = pow(sat(dot(n, normalize(L + v))), 50.0) + pow(sat(dot(n, normalize(rLamp(wp) + v))), 70.0);
  if (aux < -0.3) { return vec3f(0.19, 0.04, 0.05) * (0.7 + 0.5 * bLit(n, L, 0.5)) + vec3f(0.9) * h; } // eyes, brows, mouth line
  return vec3f(0.80, 0.36, 0.40) * (0.6 + 0.4 * bLit(n, L, 0.5));                                         // open mouth
}
fn bodyWall(wp: vec3f, n0: vec3f, aux: f32, prm: vec4f, lp: vec3f) -> vec3f {
  // BT-C2 ribbon folds: the fold profile is baked per vertex (aux: -1 crevice .. 1 crest) by the geometry along the rail
  let v = normalize(u.cam.xyz - wp); var n = n0; if (dot(n, v) < 0.0) { n = -n; }
  let L = normalize(u.sun.xyz); let fres = pow(1.0 - sat(dot(n, v)), 2.0); let beat = u.p0.w;
  let f = sat(aux * 0.5 + 0.5);
  let fib = vn3(wp * 0.9) * 0.45 + vn3(wp * vec3f(2.3, 2.3, 2.3) + vec3f(4.0)) * 0.35 + vn3(wp * 5.1) * 0.2;
  let lit = sat(bLit(n, L, 0.6) * 0.75 + 0.25 * sat(dot(n, v)) + 0.2 * sat(n.y));
  let crest = vec3f(0.94, 0.58, 0.53); let mid = vec3f(0.87, 0.33, 0.37); let crev = vec3f(0.74, 0.19, 0.25);
  let d = length(wp - u.cam.xyz);
  let cv = sat(dot(n, v) * 2.5) * (1.0 - smoothstep(18.0, 75.0, d)); // crevice lines fade where they would alias
  var c = mix(crev, mid, 1.0 - (1.0 - smoothstep(0.0, 0.3, f) * (0.6 + 0.4 * fib)) * 0.8 * cv);
  c = mix(c, crest, smoothstep(0.5, 1.0, f) * lit * (0.5 + 0.5 * fib));
  c *= (0.8 + 0.3 * lit) * (0.84 + 0.3 * fib);
  let hk = pow(sat(dot(n, normalize(L + v))), 36.0) * 0.16 + pow(sat(dot(n, normalize(rLamp(wp) + v))), 64.0) * 0.3;
  c += vec3f(1.0, 0.86, 0.82) * hk * (0.35 + 0.65 * f);                       // wet sheen on the crests
  let core = pow(sat(dot(normalize(wp - u.cam.xyz), u.p0.xyz)), 5.0);
  c += vec3f(0.55, 0.16, 0.14) * fres * (0.3 + 0.7 * core);                   // subsurface: crests glow toward the core
  c += vec3f(0.32, 0.02, 0.05) * (1.0 - f) * beat;                            // the crevices flush on the beat
  return c * (1.0 + 0.05 * beat);
}
fn bodyPart(wp: vec3f, n0: vec3f, aux: f32, prm: vec4f, lp: vec3f) -> vec3f {
  // BT-R gummy cells (ball + nubs by aux), marshmallow white cells (kind 1), gummy platelets (kind 2)
  if (prm.z > 1.5) { return shadeSolid_base(wp, n0, aux, vec4f(2.0, prm.y, 0.0, prm.w), lp); }
  if (prm.z > 0.5) { return shadeSolid_base(wp, n0, aux, vec4f(3.3, 0.93, 0.84, 0.77), lp); }
  return shadeSolid_base(wp, n0, aux, vec4f(select(2.0, 1.0, aux > 0.5), prm.y, 0.0, prm.w), lp);
}
`,
    glow: `
fn bodyTarget(wp: vec3f, n0: vec3f, aux: f32, prm: vec4f, lp: vec3f) -> vec3f {
  // BG-V: dark core, glowing silhouette and club tips; the tips flare on the beat
  let c = shadeSolid_base(wp, n0, aux, vec4f(1.0, prm.y, 0.0, 0.0), lp);
  return c + vec3f(1.1, 0.25, 0.45) * sat(aux) * sat(aux) * u.p0.w * 0.7;
}
fn bodyWall(wp: vec3f, n0: vec3f, aux: f32, prm: vec4f, lp: vec3f) -> vec3f {
  // BG-W tissue (the look's own shading; aux: fold-ridge convexity) plus a few glowing veins that pulse with the heartbeat
  var c = shadeSolid_base(wp, n0, aux, vec4f(0.0), lp);
  let beat = u.p0.w;
  let vp = smoothstep(0.022, 0.0, abs(vn3(wp * vec3f(0.09, 0.09, 0.09) + vec3f(3.0)) - 0.5));
  let vc = smoothstep(0.018, 0.0, abs(vn3(wp * vec3f(0.13, 0.13, 0.13) + vec3f(11.0)) - 0.5));
  c += vec3f(0.95, 0.22, 0.50) * vp * (0.22 + 0.8 * beat) + vec3f(0.22, 0.48, 0.85) * vc * (0.18 + 0.3 * beat);
  return c;
}
fn bodyPart(wp: vec3f, n0: vec3f, aux: f32, prm: vec4f, lp: vec3f) -> vec3f {
  let v = normalize(u.cam.xyz - wp); let fr = 1.0 - abs(dot(n0, v)); let gl = glowLight(wp, n0);
  if (prm.z > 2.5) { // red cells in the glow medium: dark crimson discs with pink rims
    return vec3f(0.24, 0.03, 0.07) * (0.6 + 0.5 * vn3(lp * 4.0)) + vec3f(0.95, 0.25, 0.42) * pow(fr, 2.2) * 0.9 + vec3f(0.8, 0.25, 0.4) * gl * 0.7;
  }
  if (prm.z > 1.5) { return vec3f(0.55, 0.95, 1.1) * (0.35 + 0.9 * fr); } // platelets: small cyan-white glints
  // white cells: translucent blue-violet blobs with the cool L2 rim
  return vec3f(0.08, 0.08, 0.17) * (0.6 + 0.6 * vn3(lp * 5.0 + vec3f(prm.y * 9.0))) + vec3f(0.30, 0.52, 0.85) * pow(fr, 2.4) * 1.2 + vec3f(0.8, 0.3, 0.5) * gl * 0.5;
}
`,
    micro: `
fn bodyTarget(wp: vec3f, n0: vec3f, aux: f32, prm: vec4f, lp: vec3f) -> vec3f {
  // the micro game's germs: soft lime-green rods with flagella, pale green spiky viruses (kid-friendly colours)
  let v = normalize(u.cam.xyz - wp); let fr = pow(1.0 - abs(dot(n0, v)), 2.0);
  var col = vec3f(0.45, 0.80, 0.42);
  if (aux < 0.75) { col = vec3f(0.36, 0.62, 0.34); }
  if (aux < -0.5) { col = vec3f(0.55, 0.82, 0.62); }
  let dots = smoothstep(0.66, 0.76, vn3(lp * 6.0 + vec3f(prm.y * 23.0))) * step(0.75, aux);
  var c = shadeSolid_base(wp, n0, aux, vec4f(3.0, col * (1.0 - 0.25 * dots)), lp);
  return c + vec3f(0.55, 1.0, 0.5) * fr * 0.3;
}
fn bodyWall(wp: vec3f, n0: vec3f, aux: f32, prm: vec4f, lp: vec3f) -> vec3f {
  // MC-FOLD membrane (the look's own fibres); its fine fibres alias on a tunnel wall seen at speed, so they settle into the
  // sheet's mean colour with distance and at grazing angles (a hand-made mip)
  var c = shadeSolid_base(wp, n0, aux, vec4f(0.0), lp);
  let v = normalize(u.cam.xyz - wp); let d = length(wp - u.cam.xyz);
  let K = normalize(u.sun.xyz); let m = vec3f(0.84, 0.62, 0.70) * (0.62 + 0.38 * sat(dot(n0, K) * 0.5 + 0.5)) * mix(0.7, 1.0, sat(aux * 0.5 + 0.5));
  c = mix(c, m, sat(0.3 + smoothstep(3.0, 24.0, d) * 0.6 + (1.0 - sat(abs(dot(n0, v)) * 2.5)) * 0.6));
  return c * (1.0 + 0.06 * u.p0.w) + vec3f(0.10, 0.0, 0.05) * u.p0.w;
}
fn bodyPart(wp: vec3f, n0: vec3f, aux: f32, prm: vec4f, lp: vec3f) -> vec3f { return shadeSolid_base(wp, n0, aux, prm, lp); }
`,
    heart: `
fn hLight(wp: vec3f, n: vec3f) -> vec2f { let ld = u.sun.xyz - wp; let dist = length(ld); return vec2f(sat(dot(n, ld / dist) * 0.55 + 0.45), 1.7 * exp(-dist / 20.0) * (1.0 + 0.3 * u.p0.w) + 0.06); }
fn bodyTarget(wp: vec3f, n0: vec3f, aux: f32, prm: vec4f, lp: vec3f) -> vec3f {
  if (aux > 0.3) { return shadeSolid_base(wp, n0, aux, vec4f(6.0, 0.0, prm.y, 0.0), lp); } // clots: glossy dark goo
  let v = normalize(u.cam.xyz - wp); var n = n0; if (dot(n, v) < 0.0) { n = -n; }
  let l = hLight(wp, n); return vec3f(0.85, 0.62, 0.66) * (0.35 + 0.65 * l.x * min(l.y + 0.3, 1.0));   // fibrin strands
}
fn bodyWall(wp: vec3f, n0: vec3f, aux: f32, prm: vec4f, lp: vec3f) -> vec3f { return shadeSolid_base(wp, n0, aux, vec4f(0.0), lp); } // HG-W1
fn bodyPart(wp: vec3f, n0: vec3f, aux: f32, prm: vec4f, lp: vec3f) -> vec3f {
  let v = normalize(u.cam.xyz - wp); var n = n0; if (dot(n, v) < 0.0) { n = -n; }
  let l = hLight(wp, n); let rim = pow(1.0 - sat(dot(n, v)), 2.2);
  if (prm.z > 1.5) { return vec3f(0.98, 0.62, 0.62) * (0.3 + 0.7 * l.x * min(l.y + 0.25, 1.0)) + vec3f(0.9, 0.4, 0.5) * rim * 0.3; } // platelets
  let b = vn3(lp * 6.0 + vec3f(prm.y * 11.0));                                                           // white cells
  return vec3f(0.62, 0.50, 0.55) * (0.3 + 0.7 * l.x * min(l.y + 0.3, 1.0)) * (0.8 + 0.3 * b) + vec3f(0.28, 0.32, 0.36) * rim * 0.5 + vec3f(0.9, 0.3, 0.4) * rim * l.y * 0.25;
}
`,
  };
  const GATE = { toy: '1.4, 0.9, 0.8', glow: '2.4, 1.0, 2.0', micro: '1.2, 1.2, 1.5', heart: '2.0, 0.8, 0.8' };
  function wgsl(look) {
    return `
fn rLamp(wp: vec3f) -> vec3f { return normalize(u.cam.xyz + u.up.xyz * 4.0 - u.fwd.xyz * 3.0 - wp); } // the ship's lamp
${vertexW(look)}${fragW[look]}
fn shadeSolid(wp: vec3f, n0: vec3f, aux: f32, prm: vec4f, lp: vec3f) -> vec3f {
  let mat = prm.x;
  if (mat < 0.5) { return bodyTarget(wp, n0, aux, prm, lp); }       // Reef's live targets in this look's skin
  if (mat > 9.5 && mat < 10.5) { return bodyWall(wp, n0, aux, prm, lp); }
  if (mat > 10.5 && mat < 11.5) { return bodyPart(wp, n0, aux, prm, lp); } // this module's friendly cells
  if (mat > 11.5 && mat < 12.5) { // the Ring Gate as a glowing membrane ring, throbbing on the beat
    let v = normalize(u.cam.xyz - wp); let fres = pow(1.0 - abs(dot(n0, v)), 2.0); let G = vec3f(${GATE[look]});
    return G * (0.4 + 0.25 * u.p0.w) + G * fres * (0.6 + 0.4 * u.p0.w);
  }
  return shadeSolid_base(wp, n0, aux, prm, lp);                      // the look's own materials (cells, pipes, rings, drums)
}
`;
  }
  // post-pass extras (grade wrapper): Glow's membrane light shafts toward the core (BG-G1 and the brief's "light shafts")
  const post = (look) => look !== 'glow' ? '' : `
fn bodyShafts(uv: vec2f) -> vec3f {
  let cp = toClip(u.cam.xyz + u.p0.xyz * 200.0);
  if (cp.w <= 0.0) { return vec3f(0.0); }
  let sc = vec2f(cp.x / cp.w * 0.5 + 0.5, 0.5 - cp.y / cp.w * 0.5);
  let dv = (uv - sc) * vec2f(u.res.x * u.res.w, 1.0); let r = length(dv);
  var acc = 0.0;
  for (var i = 1; i <= 6; i++) { let h = hdrAt(mix(uv, sc, f32(i) / 7.0)); acc += sat(dot(h, vec3f(0.3, 0.4, 0.3)) - 0.5); }
  let a = atan2(dv.y, dv.x);
  let rays = smoothstep(0.42, 0.9, vn3(vec3f(cos(a) * 5.0, sin(a) * 5.0, u.cam.w * 0.07))) * (0.6 + 0.4 * vn3(vec3f(cos(a) * 17.0, sin(a) * 17.0, 3.0)));
  return vec3f(0.95, 0.40, 0.62) * (acc * 0.3 + 0.06) * rays * exp(-r * 2.0) * smoothstep(0.015, 0.1, r) * (1.0 + 0.5 * u.p0.w);
}
`;
  const pre = (look) => look !== 'glow' ? '' : '  c1 += bodyShafts(u2);\n';
  // per-look scene settings on the realm's scene object
  function tune(S, look) {
    const L = LOOK[look];
    if (look === 'toy') { S.p1[0] = 0.4; S.p1[1] = 11; } // the look's own DOF gather, mild: only cells passing close to the camera blur (BT style)
    if (L.dof) S.dof = Object.assign({}, L.dof);    // engine DOF (single view; split screen and the aux frame skip it)
  }

  // ---------------------------------------------------------------- geometry
  let A = null; const C3 = [0, 0, 0], FR = new Float64Array(9);
  const fold3 = (x) => { const c = 0.5 + 0.5 * cos(x); return c * c * c; };
  // the wall radius and aux per look, at rail distance s and angle th (rail frame: right·cos th + up·sin th)
  const WALL = {
    toy(s, th, o) { // BT-C2: |sin(pi phi)|^0.6 folds, two fold periods per turn, warped; scaled from the standalone (R 4.7 -> 15)
      const ph = s / 5.2 + 2 * th / TAU + 0.34 * sin(th * 3 + s * 0.034) + 0.22 * sin(th * 5 - s * 0.022 + 1.3) + 0.15 * sin(th * 2 + s * 0.072 + 0.7);
      const f = Math.pow(abs(sin(PI * ph)), 0.6);
      o[0] = 15 + 1.0 * sin(s * 0.03 + th * 2 + 1) - 1.35 * (0.7 + 0.3 * sin(th * 2 + s * 0.016)) * f - 1.5 * sstep(30, 0, s); o[1] = f * 2 - 1;
    },
    glow(s, th, o) { // BG-W: 7 helical folds per turn twisting along s, minor folds, bulges, membrane flaps (bgDensity, R 11 -> 15)
      const tw = s * 0.081 + 1.2 * (fbm(s * 0.009, 3.1, 0.7, 2) - 0.5), F = fold3(th * 7 + tw);
      o[0] = 15 * (1 - 0.15 * F - 0.04 * fold3(th * 15 - s * 0.05)) + 3.0 * (fbm(s * 0.013, cos(th) * 0.9 + 4, sin(th) * 0.9, 3) - 0.5) + 3.2 * (fbm(cos(th) * 1.6 + 7, sin(th) * 1.6, s * 0.045, 3) - 0.5) - 1.5 * sstep(30, 0, s);
      o[1] = -clamp(F * 0.75, 0, 1);
    },
    micro(s, th, o) { // a lumpy wall, and MC-FOLD ridges: a fold rising from one side every ~90 m; aux: crease AO
      const k = Math.round(s / 90), sc = k * 90 + 25 * sin(k * 7.1), ta = k * 2.4 + 0.6, da = Math.atan2(sin(th - ta), cos(th - ta));
      const ridge = 4.2 * Math.exp(-(((s - sc) / 9) ** 2)) * Math.exp(-((da / 0.9) ** 2));
      const lump = fbm(cos(th) * 2.2 + 3, sin(th) * 2.2, s * 0.09, 3), cr = 1 - abs(2 * vnoise(cos(th) * 5 + 1, sin(th) * 5, s * 0.21) - 1);
      o[0] = 15 + 2.2 * (lump - 0.5) - ridge - 1.5 * sstep(30, 0, s); o[1] = clamp(1.1 - 1.6 * cr * cr - 0.6 * (0.5 - lump), -1, 1);
    },
    heart(s, th, o) { o[0] = 15 + 1.2 * (fbm(cos(th) * 1.4 + 2, sin(th) * 1.4, s / 9, 3) - 0.5) - 1.5 * sstep(30, 0, s); o[1] = 1; }, // HG-W1
  };
  // a run of rings [s0, s1] around the rail, rad(s, th, out) -> [radius, aux]; normals face the rail; one identity instance
  function tubeChunk(s0, s1, look, mat) {
    const R = A.rail, L = LOOK[look], ds = L.ds, NS = L.sides, nr = Math.max(2, Math.round((s1 - s0) / ds) + 1), nv = nr * (NS + 1), o = [0, 0];
    const P = new Float32Array(nv * 3), Cn = new Float32Array(nr * 3), AX = new Float32Array(nv);
    for (let k = 0; k < nr; k++) {
      const s = s0 + (s1 - s0) * k / (nr - 1); R.at(s, C3); R.frame(s, FR); Cn.set(C3, k * 3);
      for (let j = 0; j <= NS; j++) {
        const th = (j % NS) / NS * TAU, cx = cos(th), cy = sin(th), dx = FR[3] * cx + FR[6] * cy, dy = FR[4] * cx + FR[7] * cy, dz = FR[5] * cx + FR[8] * cy;
        WALL[look](s, th, o); const i = k * (NS + 1) + j;
        P[i * 3] = C3[0] + dx * o[0]; P[i * 3 + 1] = C3[1] + dy * o[0]; P[i * 3 + 2] = C3[2] + dz * o[0]; AX[i] = o[1];
      }
    }
    const I = new Uint32Array((nr - 1) * NS * 6); let q = 0;
    for (let k = 0; k < nr - 1; k++) for (let j = 0; j < NS; j++) { const a = k * (NS + 1) + j, b = a + 1, c = a + NS + 1, d = c + 1; I[q++] = a; I[q++] = c; I[q++] = b; I[q++] = b; I[q++] = c; I[q++] = d; }
    const N = new Float32Array(nv * 3);
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3, ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; for (const k of [a, b, c]) { N[k] += nx; N[k + 1] += ny; N[k + 2] += nz; }
    }
    // the seam column (j = NS) repeats j = 0: share its normal so the seam does not show
    for (let k = 0; k < nr; k++) { const a = k * (NS + 1) * 3, b = (k * (NS + 1) + NS) * 3; for (let c = 0; c < 3; c++) { const v = N[a + c] + N[b + c]; N[a + c] = N[b + c] = v; } }
    const vb = new ArrayBuffer(nv * 16), f = new Float32Array(vb), sb = new Int8Array(vb);
    for (let i = 0; i < nv; i++) {
      const k = (i / (NS + 1)) | 0; let nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2];
      if (nx * (Cn[k * 3] - P[i * 3]) + ny * (Cn[k * 3 + 1] - P[i * 3 + 1]) + nz * (Cn[k * 3 + 2] - P[i * 3 + 2]) < 0) { nx = -nx; ny = -ny; nz = -nz; }
      const l = hypot(nx, ny, nz) || 1;
      f[i * 4] = P[i * 3]; f[i * 4 + 1] = P[i * 3 + 1]; f[i * 4 + 2] = P[i * 3 + 2];
      sb[i * 16 + 12] = round(nx / l * 127); sb[i * 16 + 13] = round(ny / l * 127); sb[i * 16 + 14] = round(nz / l * 127); sb[i * 16 + 15] = round(clamp(AX[i], -1, 1) * 127);
    }
    return { vb, ib: I, nv, inst: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, mat, 0, 0, 0]), s0, s1, realmPart: 'walls' };
  }
  // mesh helpers: parts carry an aux tag (the shaders pick the material by it)
  const tag = (m, a) => { for (let i = 0; i < m.aux.length; i++) m.aux[i] = a; return m; };
  const merge = (ms) => { const m = new Mesh(); for (const a of ms) { const o = m.p.length / 3; for (const v of a.p) m.p.push(v); for (const v of a.aux) m.aux.push(v); for (const t of a.i) m.i.push(t + o); } return m; };
  const lumpy = (sub, seed, amp, sx = 1, sy = 1, sz = 1) => { rseed(seed); const o = [rr(0, 50), rr(0, 50), rr(0, 50)]; return icosphere(sub, (x, y, z) => { const r = 1 + amp * (fbm(x * 1.6 + o[0], y * 1.6 + o[1], z * 1.6 + o[2], 3) - 0.5) * 2; return [x * r * sx, y * r * sy, z * r * sz]; }); };
  const ball = (sub, cx, cy, cz, r, sy = 1) => icosphere(sub, (x, y, z) => [cx + x * r, cy + y * r * sy, cz + z * r]);
  // red blood cell: a biconcave disc in the xz plane, radius 1 (Evans-Fung profile; MC RBC grammar)
  function disc(nr, ns) {
    const m = new Mesh(), H = (r) => 0.5 * Math.sqrt(Math.max(0, 1 - r * r)) * (0.207 + 2.003 * r * r - 1.123 * r ** 4) * 0.9, rows = [];
    for (let side = 0; side < 2; side++) for (let i = 0; i <= nr; i++) {
      const rr0 = side ? 1 - i / nr : i / nr, r = Math.sin(rr0 * PI / 2), y = (side ? -1 : 1) * Math.max(H(r), 0.012), row = [];
      for (let j = 0; j < ns; j++) { const a = j / ns * TAU; row.push(m.v(cos(a) * r, y, sin(a) * r)); }
      rows.push(row);
    }
    for (let k = 0; k < rows.length - 1; k++) for (let j = 0; j < ns; j++) { const j2 = (j + 1) % ns; m.quad(rows[k][j], rows[k][j2], rows[k + 1][j2], rows[k + 1][j]); }
    return m;
  }
  // BT-R: raspberry ball (aux 1) with rounded nubs and flat dots (aux 0)
  function gummy(sub, nNub) {
    const b = tag(lumpy(sub, 1201, 0.05), 1), m = new Mesh(); rseed(1203);
    for (let k = 0; k < nNub; k++) {
      const yy = 1 - 2 * (k + 0.5) / nNub, r0 = Math.sqrt(1 - yy * yy), a = k * 2.39996 + rr(-0.3, 0.3), nx = cos(a) * r0, nz = sin(a) * r0, L = k % 3 === 2 ? 0.04 : rr(0.14, 0.28);
      if (L > 0.05) m.tube([[nx * 0.92, yy * 0.92, nz * 0.92], [nx * (1 + L * 0.6), yy * (1 + L * 0.6), nz * (1 + L * 0.6)], [nx * (1 + L), yy * (1 + L), nz * (1 + L)]], (i) => [0.085, 0.08, 0.06][i], 6, true, () => 0);
      else { const d = ball(1, nx, yy, nz, 0.09, 0.5); tag(d, 0); const o = m.p.length / 3; for (const v of d.p) m.p.push(v); for (const v of d.aux) m.aux.push(v); for (const t of d.i) m.i.push(t + o); }
    }
    return merge([b, m]).build();
  }
  // BG-V virus family (copied from bodyglow.js virusMesh): core + club spikes; aux 0 at the core -> 1 at the tips
  function virusMesh(sub, nSpikes, len, prof, sides, seed) {
    rseed(seed); const P = [], N = [], A2 = [], I = [];
    const core = icosphere(sub, (x, y, z) => { const r = 1 + 0.05 * (vnoise(x * 3 + seed, y * 3, z * 3) - 0.5); return [x * r, y * r, z * r]; });
    for (let k = 0; k < core.p.length / 3; k++) { const x = core.p[k * 3], y = core.p[k * 3 + 1], z = core.p[k * 3 + 2], l = hypot(x, y, z); P.push(x, y, z); N.push(x / l, y / l, z / l); A2.push(0); }
    I.push(...core.i);
    for (let k = 0; k < nSpikes; k++) {
      const yy = 1 - 2 * (k + 0.5) / nSpikes, r0 = Math.sqrt(1 - yy * yy), a = k * 2.39996 + rr(-0.2, 0.2);
      let dx = cos(a) * r0 + rr(-0.08, 0.08), dy = yy + rr(-0.08, 0.08), dz = sin(a) * r0 + rr(-0.08, 0.08); const dl = hypot(dx, dy, dz); dx /= dl; dy /= dl; dz /= dl;
      let ex = -dz, ey = 0, ez = dx; if (hypot(ex, ey, ez) < 0.2) { ex = 0; ey = dz; ez = -dy; }
      const el = hypot(ex, ey, ez); ex /= el; ey /= el; ez /= el;
      const fx = dy * ez - dz * ey, fy = dz * ex - dx * ez, fz = dx * ey - dy * ex, ln = len * rr(0.8, 1.2), base = P.length / 3, pr = prof(ln);
      for (let j = 0; j < pr.length; j++) {
        const [h, w] = pr[j], hp = pr[max(j - 1, 0)], hn = pr[min(j + 1, pr.length - 1)], dh = hn[0] - hp[0], dw = hn[1] - hp[1];
        for (let si = 0; si < sides; si++) {
          const an = si / sides * TAU, c = cos(an), s2 = sin(an), rx = ex * c + fx * s2, ry = ey * c + fy * s2, rz = ez * c + fz * s2;
          P.push(dx * h + rx * w, dy * h + ry * w, dz * h + rz * w);
          let nx = rx * dh - dx * dw, ny = ry * dh - dy * dw, nz = rz * dh - dz * dw; const nl = hypot(nx, ny, nz) || 1; N.push(nx / nl, ny / nl, nz / nl); A2.push(clamp((h - 1) / ln, 0, 1));
        }
      }
      for (let j = 0; j < pr.length - 1; j++) for (let si = 0; si < sides; si++) { const s2 = (si + 1) % sides, a0 = base + j * sides + si, b0 = base + j * sides + s2, c0 = base + (j + 1) * sides + s2, d0 = base + (j + 1) * sides + si; I.push(a0, b0, c0, a0, c0, d0); }
    }
    const n = P.length / 3, vb = new ArrayBuffer(n * 16), f = new Float32Array(vb), s8 = new Int8Array(vb);
    for (let k = 0; k < n; k++) { f[k * 4] = P[k * 3]; f[k * 4 + 1] = P[k * 3 + 1]; f[k * 4 + 2] = P[k * 3 + 2]; s8[k * 16 + 12] = round(N[k * 3] * 127); s8[k * 16 + 13] = round(N[k * 3 + 1] * 127); s8[k * 16 + 14] = round(N[k * 3 + 2] * 127); s8[k * 16 + 15] = round(A2[k] * 127); }
    return { vb, ib: new Uint32Array(I), nv: n };
  }
  const crown = (ln) => [[0.93, 0.05], [1.0, 0.04], [1 + ln * 0.7, 0.034], [1 + ln * 0.82, 0.075], [1 + ln * 0.96, 0.068], [1 + ln + 0.03, 0.0]];
  // Reef's three target variants in each look's enemy family (unit radius)
  function skins(look) {
    if (look === 'glow') return [virusMesh(1, 56, 0.38, crown, 4, 21), virusMesh(1, 48, 0.42, crown, 4, 22), virusMesh(2, 40, 0.62, (ln) => [[0.9, 0.09], [1.0, 0.065], [1 + ln * 0.55, 0.055], [1 + ln * 0.85, 0.07], [1 + ln, 0.09], [1 + ln - 0.07, 0.0]], 6, 23)];
    if (look === 'micro') return [0, 1, 2].map((v) => {
      if (v === 2) { const b = tag(lumpy(2, 1301, 0.05), -1), m = new Mesh(); for (let k = 0; k < 18; k++) { const yy = 1 - 2 * (k + 0.5) / 18, r0 = Math.sqrt(1 - yy * yy), a = k * 2.39996, x = cos(a) * r0, z = sin(a) * r0; m.tube([[x * 0.9, yy * 0.9, z * 0.9], [x * 1.3, yy * 1.3, z * 1.3]], (i) => [0.09, 0.03][i], 5, true, () => -1); const t = tag(ball(0, x * 1.34, yy * 1.34, z * 1.34, 0.09), -1); const o = m.p.length / 3; for (const q of t.p) m.p.push(q); for (const q of t.aux) m.aux.push(q); for (const q of t.i) m.i.push(q + o); } return merge([b, m]).build(); }
      const b = tag(lumpy(2, 1310 + v, 0.04, 0.55, 0.55, 1.15 + 0.2 * v), 1), m = new Mesh(); rseed(1320 + v); // a rod with wavy flagella
      for (let k = 0; k < 4 + v * 2; k++) { const a = rr(0, TAU), z0 = rr(-0.9, 0.9) * (1.1 + 0.2 * v), pts = []; for (let i = 0; i <= 6; i++) { const e = i / 6, w = 0.12 * sin(e * 9 + k); pts.push([cos(a) * (0.5 + e * 0.9) + w, sin(a) * (0.5 + e * 0.9) - w, z0 + e * 0.3 * Math.sign(z0)]); } m.tube(pts, (i) => 0.035 * (1 - i / 8), 4, true, () => 0.5); }
      return merge([b, m]).build();
    });
    if (look === 'heart') return [0, 1, 2].map((v) => { // clots: lumpy goo with pale fibrin strands wrapped over it
      const b = tag(lumpy(3, 1401 + v, 0.3, 1.05, 0.85, 1.1), 1), m = new Mesh(); rseed(1410 + v);
      for (let k = 0; k < 3; k++) { const ax = rr(0, TAU), tl = rr(-0.8, 0.8), pts = []; for (let i = 0; i <= 14; i++) { const a = i / 14 * TAU * 0.8; const x = cos(a), y = sin(a) * cos(tl), z = sin(a) * sin(tl); pts.push([(x * cos(ax) - z * sin(ax)) * 1.08, y * 0.92, (x * sin(ax) + z * cos(ax)) * 1.12]); } m.tube(pts, 0.035, 4, true, () => -1); }
      return merge([b, m]).build();
    });
    return [0, 1, 2].map((v) => { // toy (BT-V): lumpy body, ball-tipped stalks, a face on +z (eyes, grumpy brows or mouth)
      const b = tag(lumpy(2, 1501 + v, 0.08), 1), st = new Mesh(), face = new Mesh(); rseed(1510 + v);
      for (let k = 0; k < 14; k++) {
        const yy = 1 - 2 * (k + 0.5) / 14, r0 = Math.sqrt(1 - yy * yy), a = k * 2.39996 + v, nx = cos(a) * r0, nz = sin(a) * r0;
        if (nz > 0.72 && Math.abs(yy) < 0.5) continue; // keep the face clear
        st.tube([[nx * 0.9, yy * 0.9, nz * 0.9], [nx * 1.2, yy * 1.2, nz * 1.2], [nx * 1.34, yy * 1.34, nz * 1.34]], (i) => [0.075, 0.055, 0.05][i], 6, false, () => 0.7);
        const t = tag(ball(1, nx * 1.42, yy * 1.42, nz * 1.42, 0.13), 0.45); const o = st.p.length / 3; for (const q of t.p) st.p.push(q); for (const q of t.aux) st.aux.push(q); for (const q of t.i) st.i.push(q + o);
      }
      const add = (m, a) => { tag(m, a); const o = face.p.length / 3; for (const q of m.p) face.p.push(q); for (const q of m.aux) face.aux.push(q); for (const q of m.i) face.i.push(q + o); };
      for (const sx of [-1, 1]) add(ball(1, sx * 0.3, 0.16, 0.93, 0.13, 1.25), -0.8);                              // eyes (aux -0.8: they blink)
      if (v !== 2) for (const sx of [-1, 1]) { const m = new Mesh(); m.tube([[sx * 0.46, 0.42 - (v ? 0.02 : 0), 0.86], [sx * 0.15, 0.32, 0.98]], 0.04, 5, true); add(m, -0.95); } // grumpy brows
      const mouth = new Mesh(), mp = []; for (let i = 0; i <= 8; i++) { const e = i / 8 - 0.5; mp.push([e * 0.42, -0.24 + (v === 2 ? -0.1 : 0.1) * (1 - 4 * e * e) * (v === 2 ? -1 : 1) - (v === 2 ? 0.08 : 0), 0.97 - e * e * 0.2]); }
      mouth.tube(mp, 0.035, 5, true); add(mouth, -0.95);
      if (v === 1) add(ball(1, 0, -0.27, 0.9, 0.12, 0.6), -0.2);                                                    // an open, shouting mouth
      return merge([b, st, face]).build();
    });
  }
  // scatter instances along the rail, sorted by s (so a window along the rail is a contiguous instance range)
  function scatter(n, seed, opt) {
    rseed(seed); const R = A.rail, L = R.len, rows = [], o = [0, 0];
    for (let i = 0; i < n; i++) {
      const s = rr(opt.s0 || 8, L - 4), th = opt.th ? opt.th() : rr(0, TAU), r = opt.r(); let rho;
      if (opt.wall) { WALL[opt.look](s, th, o); rho = o[0] - r * opt.wall; } else rho = opt.rho();
      R.at(s, C3); R.frame(s, FR); const cx = cos(th) * rho, cy = sin(th) * rho, q = qRand();
      rows.push([s, C3[0] + FR[3] * cx + FR[6] * cy, C3[1] + FR[4] * cx + FR[7] * cy, C3[2] + FR[5] * cx + FR[8] * cy, r * (opt.tumble ? -1 : 1), q[0], q[1], q[2], q[3], opt.mat, opt.p1 ? opt.p1() : rnd(), opt.p2 ? opt.p2() : 0, opt.p3 ? opt.p3() : 0]);
    }
    rows.sort((a, b) => a[0] - b[0]);
    const I = new Float32Array(n * 12), S = new Float32Array(n); rows.forEach((w, i) => { S[i] = w[0]; for (let c = 0; c < 12; c++) I[i * 12 + c] = w[c + 1]; });
    return { I, S };
  }
  const deco = (mesh, sc) => { const m = Object.assign({}, mesh); m.inst = sc.I; m.S = sc.S; m.realmPart = 'decor'; return m; };
  // a rotation (quaternion) whose x, y, z axes are the rail frame's right, up, forward at s
  function frameQ(s, o) {
    A.rail.frame(s, FR); const m00 = FR[3], m10 = FR[4], m20 = FR[5], m01 = FR[6], m11 = FR[7], m21 = FR[8], m02 = FR[0], m12 = FR[1], m22 = FR[2], tr = m00 + m11 + m22;
    if (tr > 0) { const k = 0.5 / Math.sqrt(tr + 1); o[3] = 0.25 / k; o[0] = (m21 - m12) * k; o[1] = (m02 - m20) * k; o[2] = (m10 - m01) * k; }
    else if (m00 > m11 && m00 > m22) { const k = 2 * Math.sqrt(1 + m00 - m11 - m22); o[3] = (m21 - m12) / k; o[0] = 0.25 * k; o[1] = (m01 + m10) / k; o[2] = (m02 + m20) / k; }
    else if (m11 > m22) { const k = 2 * Math.sqrt(1 + m11 - m00 - m22); o[3] = (m02 - m20) / k; o[0] = (m01 + m10) / k; o[1] = 0.25 * k; o[2] = (m12 + m21) / k; }
    else { const k = 2 * Math.sqrt(1 + m22 - m00 - m11); o[3] = (m10 - m01) / k; o[0] = (m02 + m20) / k; o[1] = (m12 + m21) / k; o[2] = 0.25 * k; }
    return o;
  }
  // HG-H2: a heart-shaped ridged ring plate (aux: 0 at the opening .. 1 at the rim, as bodyheart.js mat 5), skirt to the wall
  function heartRing() {
    const m = new Mesh(), NP = 96, W = 9.6, steps = [[1.0, 1.6], [1.07, 1.2], [1.15, 0.8], [1.25, 0.4], [1.38, 0.0]], rows = [];
    const hp = (t) => { const x = 16 * sin(t) ** 3, y = 13 * cos(t) - 5 * cos(2 * t) - 2 * cos(3 * t) - cos(4 * t) + 2.5; return [x / 16 * W, y / 16 * W * 0.92]; };
    steps.forEach(([k, z], si) => { const row = []; for (let i = 0; i < NP; i++) { const [x, y] = hp(i / NP * TAU); row.push(m.v(x * k, y * k, z, (si / (steps.length - 1)) * 1.6 - 1)); } rows.push(row); });
    const sk = []; for (let i = 0; i < NP; i++) { const [x, y] = hp(i / NP * TAU), a = Math.atan2(y, x); sk.push(m.v(cos(a) * 16.5, sin(a) * 16.5, -0.6, 1)); } rows.push(sk);
    for (let r = 0; r < rows.length - 1; r++) for (let i = 0; i < NP; i++) { const i2 = (i + 1) % NP; m.quad(rows[r][i], rows[r][i2], rows[r + 1][i2], rows[r + 1][i]); }
    return m.build();
  }
  // HG-P pipes parallel to the rail, two layers, collars and rounded caps; built per wall chunk (mat 1, the look's own)
  function pipesChunk(s0, s1, seed) {
    const R = A.rail, m = new Mesh(); rseed(seed); const ring = (s, th, rho, out) => { R.at(s, C3); R.frame(s, FR); const cx = cos(th) * rho, cy = sin(th) * rho; out.push([C3[0] + FR[3] * cx + FR[6] * cy, C3[1] + FR[4] * cx + FR[7] * cy, C3[2] + FR[5] * cx + FR[8] * cy]); return out; };
    for (let layer = 0; layer < 2; layer++) {
      const n = layer ? 9 : 11, rho = layer ? 13.4 : 11.9;
      for (let k = 0; k < n; k++) {
        const th = (k + rr(-0.2, 0.2) + layer * 0.5) / n * TAU, r = layer ? rr(0.45, 0.75) : rr(0.55, 0.95);
        for (let s = s0 + rr(0, 6); s < s1 - 4;) {
          const len = min(rr(10, 40), s1 - s), pts = [], rad = [];
          ring(s - 0.35 * r, th, rho, pts); rad.push(r * 0.35); ring(s - 0.12 * r, th, rho, pts); rad.push(r * 0.85);
          for (let e = 0; e <= len; e += 2.5) { ring(s + e, th, rho, pts); rad.push(r); }
          ring(s + len + 0.12 * r, th, rho, pts); rad.push(r * 0.85); ring(s + len + 0.35 * r, th, rho, pts); rad.push(r * 0.35);
          m.tube(pts, (i) => rad[i], 9, true);
          for (let c = s + rr(2, 5); c < s + len - 1; c += rr(3, 8)) { const cp = []; ring(c, th, rho, cp); ring(c + 0.35, th, rho, cp); m.tube(cp, r * 1.13, 9, true); } // collars
          s += len + rr(2, 7);
        }
      }
    }
    const b = m.build(); b.inst = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 1, 0.37, 0, 0]); b.s0 = s0; b.s1 = s1; b.realmPart = 'walls'; return b;
  }
  // HG-M1 machinery drum: a cylinder about local y (bodyheart.js mat 9 draws its cyan windows around that axis)
  function drum() { const m = new Mesh(), pts = [[0, -0.6, 0], [0, 0.6, 0]]; m.tube(pts, 1, 18, true); return m.build(); }

  const geo = {};
  // h: { A (the rail and points api), pointsFor }
  function build(look, h) {
    if (geo[look]) return geo[look];
    A = h.A; const R = A.rail, L = R.len, Lk = LOOK[look], solids = [], chunks = [], decor = [], q = [0, 0, 0, 1];
    const CH = 40; // wall chunk length (m)
    for (let s0 = 0; s0 < L; s0 += CH) { const c = tubeChunk(s0, min(s0 + CH, L), look, 10); chunks.push(c); solids.push(c); if (look === 'heart') { const p = pipesChunk(s0, min(s0 + CH, L), 1600 + s0); chunks.push(p); solids.push(p); } }
    const add = (m) => { decor.push(m); solids.push(m); return m; };
    const wallOpt = (look2, extra) => Object.assign({ look: look2 }, extra);
    if (look === 'toy') {
      const g = gummy(2, 32), g0 = gummy(1, 20);
      add(deco(g, scatter(70, 1701, wallOpt('toy', { wall: 0.35, r: () => rr(0.9, 2.3), mat: 11, p3: () => (rnd() < 0.2 ? rr(0.2, 0.7) : rr(-0.1, 0.1)) })))); // BT-R9: half-domes on the wall
      add(deco(g, scatter(80, 1702, { rho: () => rr(5, 12.5), r: () => rr(0.8, 2.0), mat: 11, tumble: true, p3: () => (rnd() < 0.2 ? 0.5 : 0) })));                 // floating gummy cells
      add(deco(tag(lumpy(2, 1703, 0.12), 1).build(), scatter(26, 1704, { rho: () => rr(5, 12), r: () => rr(0.6, 1.1), mat: 11, p2: () => 1, tumble: true })));      // marshmallow white cells
      add(deco(tag(lumpy(1, 1705, 0.2, 1, 0.55, 1), 0).build(), scatter(110, 1706, { rho: () => rr(3, 12.5), r: () => rr(0.14, 0.3), mat: 11, p2: () => 2, tumble: true }))); // gummy platelets
      geo.toyRiver = geo.toyRiver || { hi: g, lo: g0 };
    }
    if (look === 'glow') {
      const vc = virusMesh(1, 34, 0.42, (ln) => [[0.93, 0.06], [1 + ln * 0.75, 0.04], [1 + ln * 0.9, 0.08], [1 + ln + 0.04, 0.0]], 4, 24);
      add(deco(vc, scatter(80, 1801, wallOpt('glow', { wall: 0.5, r: () => rr(0.35, 0.9), mat: 1 }))));                                          // BG-V swarm clinging to the walls
      add(deco(tag(lumpy(2, 1802, 0.1), 1).build(), scatter(28, 1803, { rho: () => rr(5, 12), r: () => rr(0.6, 1.2), mat: 11, p2: () => 1, tumble: true })));       // white cells
      add(deco(tag(ball(1, 0, 0, 0, 1, 0.4), 1).build(), scatter(150, 1804, { rho: () => rr(3, 12.5), r: () => rr(0.1, 0.22), mat: 11, p2: () => 2, tumble: true }))); // platelets
    }
    if (look === 'micro') {
      const wbc = tag(lumpy(2, 1901, 0.06), 1).build(), crm = tag(lumpy(2, 1902, 0.04), 1).build(), bead = icosphere(1).build(), rbc = disc(5, 18).build();
      add(deco(wbc, scatter(55, 1903, wallOpt('micro', { wall: 0.4, r: () => rr(0.8, 2.2), mat: 5 }))));             // MC-RW: cells crowding the walls
      add(deco(crm, scatter(40, 1904, wallOpt('micro', { wall: 0.4, r: () => rr(0.8, 1.9), mat: 6 }))));
      add(deco(rbc, scatter(50, 1905, wallOpt('micro', { wall: 0.2, r: () => rr(0.8, 1.5), mat: 4 }))));
      add(deco(wbc, scatter(34, 1906, { rho: () => rr(5, 12), r: () => rr(0.6, 1.3), mat: 5, tumble: true })));      // WBC drifting
      add(deco(crm, scatter(24, 1907, { rho: () => rr(5, 12), r: () => rr(0.6, 1.2), mat: 6, tumble: true })));      // CRM drifting
      add(deco(bead, scatter(170, 1908, { rho: () => rr(3, 12.5), r: () => rr(0.12, 0.3), mat: 7, tumble: true }))); // SB platelets
      geo.microRiver = geo.microRiver || { hi: rbc, lo: disc(2, 9).build() };
    }
    if (look === 'heart') {
      const cell = tag(lumpy(2, 2001, 0.14, 1, 0.82, 1), 1).build();
      add(deco(cell, scatter(80, 2002, { rho: () => rr(5, 12.5), r: () => rr(0.3, 1.3), mat: 2, tumble: true, p3: () => rr(-0.5, 0.5) }))); // HG-R cells drifting
      add(deco(cell, scatter(70, 2003, wallOpt('heart', { wall: 0.3, r: () => rr(0.8, 2.4), mat: 2, p3: () => rr(-0.8, 0.2) }))));
      add(deco(tag(lumpy(2, 2004, 0.1), 1).build(), scatter(24, 2005, { rho: () => rr(5, 11), r: () => rr(0.6, 1.1), mat: 11, p2: () => 1, tumble: true })));   // white cells
      add(deco(tag(ball(1, 0, 0, 0, 1, 0.45), 1).build(), scatter(120, 2006, { rho: () => rr(3, 12.5), r: () => rr(0.12, 0.26), mat: 11, p2: () => 2, tumble: true }))); // platelets
      // heart rings every LOOK.heart.rings m, each with two machinery drums hanging over the notch
      const ringS = []; for (let s = A.sHero + 70; s < (A.sGate || L) - 40; s += Lk.rings) ringS.push(s);
      const RI = new Float32Array(ringS.length * 12), DI = new Float32Array(ringS.length * 24), RS = new Float32Array(ringS.length);
      ringS.forEach((s, i) => { R.at(s, C3); frameQ(s, q); RS[i] = s; RI.set([C3[0], C3[1], C3[2], 1, q[0], q[1], q[2], q[3], 5, 0, 0, 0], i * 12);
        for (let d = 0; d < 2; d++) { const y = 10.6 + d * 2.0; DI.set([C3[0] + FR[6] * y, C3[1] + FR[7] * y, C3[2] + FR[8] * y, 1.5, q[0], q[1], q[2], q[3], 9, 0, 0, 0], (i * 2 + d) * 12); } });
      geo.heartRingS = RS;
      const hr = heartRing(); hr.inst = RI; hr.S = RS; hr.realmPart = 'decor'; add(hr);
      const dm = drum(); dm.inst = DI; dm.S = new Float32Array(ringS.flatMap((s) => [s, s])); dm.realmPart = 'decor'; add(dm);
      geo.heartRiver = geo.heartRiver || { hi: cell, lo: tag(lumpy(1, 2007, 0.14, 1, 0.82, 1), 1).build() };
    }
    if (look === 'glow') geo.glowRiver = geo.glowRiver || { hi: disc(4, 16).build(), lo: disc(2, 8).build() };
    // the river: two pools (near, high detail; far, low) whose live counts and instances are written each frame
    const rv = geo[look + 'River'], N = Lk.river.n, mk = (g) => { const m = Object.assign({}, g); m.inst = new Float32Array(N * 12); m.nLive = 0; m.realmPart = 'river'; return m; };
    const flow = { look, N, hi: mk(rv.hi), lo: mk(rv.lo), s: new Float32Array(N), th: new Float32Array(N), rho: new Float32Array(N), r: new Float32Array(N), v: new Float32Array(N), q: new Float32Array(N * 4), seed: new Float32Array(N), lane: new Uint8Array(N), camS: -1e9, whoosh: 0 };
    rseed(2100 + LOOKS.indexOf(look)); for (let i = 0; i < N; i++) { const qq = qRand(); flow.q.set(qq, i * 4); flow.seed[i] = rnd(); flow.lane[i] = i % Lk.river.lanes; }
    solids.push(flow.hi, flow.lo);
    // static glowing motes (the body's drifting specks), in the look's colours
    const pc = Lk.pts.c, pts = h.pointsFor((put, R2) => { rseed(2200 + LOOKS.indexOf(look)); for (let i = 0; i < Lk.pts.n; i++) { const s = rr(0, R2.len), th = rr(0, TAU), rho = Math.sqrt(rnd()) * 13, b = rr(0.35, 1.2), c = pc[rnd() < 0.8 ? 0 : 1]; R2.at(s, C3); R2.frame(s, FR);
      put(C3[0] + FR[3] * cos(th) * rho + FR[6] * sin(th) * rho, C3[1] + FR[4] * cos(th) * rho + FR[7] * sin(th) * rho, C3[2] + FR[5] * cos(th) * rho + FR[8] * sin(th) * rho, rr(0.03, 0.08), c[0] * b, c[1] * b, c[2] * b, 1); } });
    return (geo[look] = { solids, chunks, decor, flow, skins: skins(look), pts });
  }

  // ---------------------------------------------------------------- per frame
  let beat = 0, beatT = 0, ema = 1 / 60, dofCut = false;
  const rng = (() => { let x = 0x9e3779b9; return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296; }; })();
  // the heartbeat envelope from the music clock (the live track's beat map), else from the scene time
  function beatAt(t, mz) {
    let bpm = BEAT.bpm, t0 = BEAT.t0, c = t;
    if (mz && mz.active && mz.clock && typeof MUSIC_MAP !== 'undefined') { const m = MUSIC_MAP[mz.current], k = mz.clock(); if (m && k >= 0) { bpm = m.bpm; t0 = m.t0; c = k; } }
    const per = 60 / bpm * (bpm > 120 ? 2 : 1), tb = ((c - t0) % per + per) % per;
    beatT = tb; return REDUCED ? 0.25 * Math.exp(-tb * BEAT.lubK) : Math.exp(-tb * BEAT.lubK) + (tb > BEAT.dub ? BEAT.dubA * Math.exp(-(tb - BEAT.dub) * BEAT.dubK) : 0);
  }
  const lower = (S, v) => { let a = 0, b = S.length; while (a < b) { const m = (a + b) >> 1; if (S[m] < v) a = m + 1; else b = m; } return a; };
  function windowed(W, camS) {
    const lo = camS - WIN.back, hi = camS + WIN.ahead;
    for (let i = 0; i < W.chunks.length; i++) { const c = W.chunks[i]; c.nLive = c.s1 > lo && c.s0 < hi ? 1 : 0; }
    for (let i = 0; i < W.decor.length; i++) { const d = W.decor[i], a = lower(d.S, lo - 3), b = lower(d.S, hi); d.iFirst = a; d.nLive = b - a; }
  }
  // the river: cells in a few lanes along the walls drift down the vessel (the ship overtakes them), surging on the beat;
  // those behind the ship respawn at the far end. The entry whoosh streams a burst through the lumen past the camera.
  function respawn(F, i, camS, far, Lk, burst) {
    const R = Lk.river, s0 = camS + (far ? RIVER.ahead - rng() * 25 : -RIVER.back + rng() * (RIVER.ahead + RIVER.back));
    F.s[i] = burst ? camS + 4 + rng() * 70 : s0; F.r[i] = (burst ? 0.5 : 0.35) + rng() * 0.6;
    if (burst) { F.th[i] = rng() * TAU; F.rho[i] = 2.5 + rng() * 9; F.v[i] = -(22 + rng() * 18); return; }
    const ln = F.lane[i], spread = rng() - 0.5 + (rng() - 0.5);
    F.th[i] = ln / R.lanes * TAU + 0.35 + spread * 0.55; F.rho[i] = R.rho[0] + rng() * (R.rho[1] - R.rho[0]); F.v[i] = R.v * (0.7 + 0.6 * rng());
  }
  function river(F, camS, dt) {
    const Lk = LOOK[F.look], R = A.rail, L = R.len, jump = Math.abs(camS - F.camS) > 40;
    if (jump) for (let i = 0; i < F.N; i++) respawn(F, i, camS, false, Lk, false);
    if (F.whoosh > 0) { // the entry burst: most of the pool rushes past the camera through the lumen
      if (F.whooshNew) { F.whooshNew = false; for (let i = 0; i < F.N; i++) if (i % 5 !== 0) respawn(F, i, camS, false, Lk, true); }
      F.whoosh -= dt;
    }
    F.camS = camS;
    const surge = 1 + BEAT.surge * beat, H = F.hi.inst, Lo = F.lo.inst; let nh = 0, nl = 0;
    for (let i = 0; i < F.N; i++) {
      let s = F.s[i] + F.v[i] * (F.v[i] > 0 ? surge : 1) * dt;
      if (s < camS - RIVER.back || s > camS + RIVER.ahead + 30 || s > L - 2) { respawn(F, i, camS, true, Lk, false); s = F.s[i]; }
      F.s[i] = s;
      const tw = F.th[i] + s * 0.004; R.at(s, C3); R.frame(s, FR);
      const cx = cos(tw) * F.rho[i], cy = sin(tw) * F.rho[i], d = s - camS, near = d < RIVER.near && d > -RIVER.back;
      const I = near ? H : Lo, o = (near ? nh++ : nl++) * 12;
      I[o] = C3[0] + FR[3] * cx + FR[6] * cy; I[o + 1] = C3[1] + FR[4] * cx + FR[7] * cy; I[o + 2] = C3[2] + FR[5] * cx + FR[8] * cy;
      I[o + 3] = -F.r[i] * (F.v[i] < 0 ? 1.4 : 1); I[o + 4] = F.q[i * 4]; I[o + 5] = F.q[i * 4 + 1]; I[o + 6] = F.q[i * 4 + 2]; I[o + 7] = F.q[i * 4 + 3];
      const lk = F.look; I[o + 8] = lk === 'micro' ? 4 : lk === 'heart' ? 2 : 11; I[o + 9] = F.seed[i]; I[o + 10] = lk === 'glow' ? 3 : 0; I[o + 11] = lk === 'toy' ? (F.seed[i] > 0.85 ? 0.5 : 0) : lk === 'heart' ? F.seed[i] - 0.5 : 0;
    }
    F.hi.nLive = nh; F.lo.nLive = nl; F.hi.dirty = true; F.lo.dirty = true;
  }
  // looks: the live look and (during a warp or pulse) the incoming one; camS: the ship's rail distance
  const PERF = { ms: 0 };
  function frame(dt, looks, camS, t, mz) {
    const t0 = performance.now();
    if (dt > 0) ema += (min(dt, 0.1) - ema) * 0.05;
    beat = beatAt(t, mz);
    const ts = typeof PULSE !== 'undefined' && PULSE.timeScale != null ? PULSE.timeScale : 1;
    for (let k = 0; k < looks.length; k++) { const W = geo[looks[k]]; if (!W) continue; windowed(W, camS); river(W.flow, camS, dt * ts); }
    PERF.ms = performance.now() - t0;
  }
  // the scene uniforms for a body look (after realms.js has set the core direction in p0.xyz)
  const RP = [0, 0, 0];
  function uniforms(S, s) {
    S.p0[3] = beat;
    // Microscope's engine DOF costs about 4-5 ms at 1080p: it is dropped for the run when frames run slow (over 24 ms smoothed)
    if (S.dof && ema > 0.024) { S.dof = null; dofCut = true; }
    if (S.look === 'heart') { // the glow sits in the next heart ring's opening (HG-H1), else far ahead
      const RS = geo.heartRingS; let sr = s + 140; if (RS) for (let i = 0; i < RS.length; i++) if (RS[i] > s + 8) { sr = min(RS[i], s + 200); break; }
      A.rail.at(sr, RP); S.p1[0] = RP[0]; S.p1[1] = RP[1]; S.p1[2] = RP[2];
    }
  }

  // ---------------------------------------------------------------- the entry moment: INSIDE THE BODY
  let cardEl = null;
  const CSS = `#bdcard{position:fixed;inset:0;z-index:29;display:grid;place-items:center;pointer-events:none;opacity:0}
#bdcard .c{text-align:center;padding:0 16px}#bdcard h2{margin:0;font:900 clamp(30px,7.2vw,96px)/1 var(--fd,ui-monospace,Menlo,monospace);letter-spacing:.07em;color:#fff;text-shadow:0 0 16px var(--bc),0 0 44px var(--bc),0 3px 4px #000}
#bdcard .ln{height:3px;width:min(70vw,720px);margin:14px auto 10px;background:linear-gradient(90deg,transparent,var(--bc),#fff,var(--bc),transparent);border-radius:2px}
#bdcard small{display:block;font:800 clamp(11px,1.6vw,19px) var(--fl,ui-monospace,Menlo,monospace);letter-spacing:.3em;color:var(--bc);text-shadow:0 1px 3px #000}
#bdcard.on{animation:bdFade 2.8s ease-out forwards}#bdcard.on .c{animation:bdZoom 2.8s cubic-bezier(.2,.9,.25,1) forwards}#bdcard.on .ln{animation:bdLine 2.8s ease-out forwards}
@keyframes bdFade{0%{opacity:0}9%{opacity:1}72%{opacity:1}100%{opacity:0}}@keyframes bdZoom{0%{transform:scale(1.45);filter:blur(6px)}14%{transform:scale(1);filter:blur(0)}100%{transform:scale(.97)}}
@keyframes bdLine{0%{transform:scaleX(0)}22%{transform:scaleX(1)}100%{transform:scaleX(1.06)}}
@media (prefers-reduced-motion:reduce){#bdcard.on .c,#bdcard.on .ln{animation:none}}`;
  function enter(look) {
    ema = 1 / 60;
    const W = geo[look]; if (W) { W.flow.whoosh = REDUCED ? 0 : 1.6; W.flow.whooshNew = !REDUCED; }
    if (typeof document === 'undefined') return;
    if (!cardEl) {
      const s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s);
      cardEl = document.createElement('div'); cardEl.id = 'bdcard'; cardEl.setAttribute('aria-live', 'polite');
      cardEl.innerHTML = '<div class="c"><h2>INSIDE THE BODY</h2><div class="ln"></div><small></small></div>';
      (document.getElementById('sgr') || document.body).appendChild(cardEl);
    }
    const C = LOOK[look].card; cardEl.style.setProperty('--bc', C.col); cardEl.querySelector('small').textContent = C.sub;
    cardEl.classList.remove('on'); void cardEl.offsetWidth; cardEl.classList.add('on');
  }
  const debug = { get rings() { return geo.heartRingS ? Array.from(geo.heartRingS, (v) => +v.toFixed(1)) : []; }, get beat() { return +beat.toFixed(3); }, get beatT() { return +beatT.toFixed(3); }, get ms() { return +PERF.ms.toFixed(3); }, get dofCut() { return dofCut; }, get frameMs() { return +(ema * 1000).toFixed(1); },
    flow(look) { const W = geo[look]; return W ? { hi: W.flow.hi.nLive, lo: W.flow.lo.nLive, whoosh: +W.flow.whoosh.toFixed(2), chunks: W.chunks.filter((c) => c.nLive).length, decor: W.decor.map((d) => d.nLive) } : null; },
    tris(look) { const W = geo[look]; return W ? W.solids.reduce((a, m) => a + m.ib.length / 3, 0) : 0; } };
  return { LOOKS, LOOK, wgsl, post, pre, tune, build, frame, uniforms, enter, debug };
})();
