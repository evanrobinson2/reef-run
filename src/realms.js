// ============================================================================
// realms.js: Reef Run's reality switch (GAME_API.md "Realms"). carpetshark: "auto-switch to one of the other simulations mid-flight ..
// same mission, same idea, just different theme", "space (outside, inside) and inside the boody -> 3 ways", "3. is the reality
// bending switcheroo", "switcheroo can change those facets", then "primary -> switch game mode and secondary -> switch shader ..
// and tertiary -> switch music", "ZXC", and "that's in developer mode".
//
// One gameplay rail (Reef Run's) carries the targets, collisions, drifters, gunship and holo route in every realm. A realm is a
// scene pack (engine G.realmPack): another scene's WGSL (hollow.js or one of the four body looks, wrapped with this module's
// facet and material code) plus world geometry built ALONG REEF'S RAIL: a cave tunnel or a blood vessel, wall decor, drifting
// motes, and target skins (germs, viruses, clots) that draw the game's own live target instances. So score, chain, hull,
// weapons, difficulty, players and split screen, rail progress and run length all carry over untouched.
//   Z  WORLD  Space Outside → Space Inside → Inside the Body → …   (the warp tunnel hides the swap; warp.js)
//   X  STYLE  reroll the facets in place: grade/palette variant, sky tint, one effect (heat shimmer, underwater wobble,
//             heartbeat pulse, chromatic split), with a quick mini-warp
//   C  MUSIC  the realm's own track, Soaring Melody, Pulse Circuit A, then the catalogue (crossfades on the beat)
// Player controls are developer-mode only (?dev, `dev on`, Settings → Developer). Without it the run is Space Outside as before.
// No per-frame allocation in post(); geometry, packs and WGSL are built at load or on first use, outside the frame.
// ============================================================================
const REALMS = (() => {
  const Q = typeof QS !== 'undefined' ? QS : new URLSearchParams(location.search);
  const REDUCED = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const IS_FIXED = Q.has('shot') || Q.has('frame0') || Q.has('bench');
  const SRC = typeof REALM_SCENES !== 'undefined' ? REALM_SCENES : {};
  const STORE = 'reef-run:realms';
  // ---------------------------------------------------------------- tables (data, so they can be retuned)
  const EXT = typeof REALM_EXT !== 'undefined' ? REALM_EXT : {}; // extra realms in their own modules (realm-underwater.js): scene, build, uniforms, tables
  const ORDER = ['outside', 'inside', ...Object.keys(EXT), 'body']; // Outside → Inside → Underwater → Body → …
  const LOOKS = ['toy', 'glow', 'micro', 'heart'];
  const NAME = { outside: 'Space Outside', inside: 'Space Inside', body: 'Inside the Body' };
  const SHORT = { outside: 'OUTSIDE', inside: 'INSIDE', body: 'BODY' };
  const LOOK_NAME = { toy: 'Gooey', glow: 'Glow', micro: 'Microscope', heart: 'Heart' };
  // the realm's dominant colours for the tunnel's palette shift (display rgb)
  const PAL = { outside: [0.2, 0.75, 0.68], inside: [0.55, 0.42, 0.95], toy: [1.0, 0.5, 0.55], glow: [1.0, 0.35, 0.75], micro: [0.75, 0.8, 0.95], heart: [1.0, 0.28, 0.35] };
  // facets (carpetshark: "switcheroo can change those facets"): compile-time constants, so a reroll compiles a new pack (async) and
  // swaps it at the mini-warp's peak. Index 0 is the realm's native look.
  const GRADES = [
    { id: 'native', name: 'Native' },
    { id: 'ember', name: 'Ember', w: 'c = c * vec3f(1.08, 0.97, 0.84) + vec3f(0.025, 0.008, 0.0);' },
    { id: 'glacier', name: 'Glacier', w: 'c = c * vec3f(0.88, 1.0, 1.1) + vec3f(0.0, 0.01, 0.03);' },
    { id: 'neon', name: 'Neon pop', w: 'let l = dot(c, vec3f(0.2126, 0.7152, 0.0722)); c = mix(vec3f(l), c, 1.35); c = (c - 0.5) * 1.08 + 0.5;' },
    { id: 'dusk', name: 'Dusk split', w: 'let l = dot(c, vec3f(0.2126, 0.7152, 0.0722)); c = mix(vec3f(l), c, 0.85) + mix(vec3f(0.0, 0.05, 0.07), vec3f(0.08, 0.03, -0.03), smoothstep(0.2, 0.8, l));' },
    { id: 'vapor', name: 'Vapor', w: 'let l = dot(c, vec3f(0.2126, 0.7152, 0.0722)); c = mix(c, mix(vec3f(0.18, 0.12, 0.42), vec3f(1.0, 0.62, 0.86), l) * (0.6 + 0.6 * l), 0.35);' },
  ];
  const SKIES = [
    { id: 'native', name: 'Native' },
    { id: 'rose', name: 'Rose', t: 'vec3f(1.0, 0.45, 0.62)' },
    { id: 'violet', name: 'Ultraviolet', t: 'vec3f(0.55, 0.35, 1.0)' },
    { id: 'gold', name: 'Gold', t: 'vec3f(1.0, 0.72, 0.3)' },
    { id: 'emerald', name: 'Emerald', t: 'vec3f(0.3, 1.0, 0.62)' },
  ];
  const EFFECTS = [
    { id: 'none', name: 'None' },
    { id: 'shimmer', name: 'Heat shimmer' },
    { id: 'wobble', name: 'Underwater wobble' },
    { id: 'pulse', name: 'Heartbeat pulse' },
    { id: 'chroma', name: 'Chromatic split' },
  ];
  // which effects suit which realm (tasteful, readable combos)
  const FX_OK = { outside: [0, 1, 4], inside: [0, 1, 2, 4], body: [0, 2, 3, 4] };
  // music (carpetshark: "and it switches the music too"). bpm and the first downbeat (s) for crossfades on the beat (measured offline
  // with an onset autocorrelation); catalogue tracks without a tempo fade on the next half second.
  const TRACKS = {
    soaring: { url: 'music/soaring-melody.mp3', name: 'Soaring Melody', bpm: 139.8, t0: 0 },
    pulse: { url: 'music/pulse-circuit-a.mp3', name: 'Pulse Circuit A', bpm: 172.3, t0: 0.215 },
    euphoric: { url: 'music/euphoric-defiance.mp3', name: 'Euphoric Defiance', bpm: 92.25, t0: 2.241 },
    reimagined: { url: 'music/abbies-world-reimagined-3.mp3', name: 'Abbie\u2019s World Reimagined', bpm: 134.2, t0: 0.534 },
  };
  // the realm's own track: Space Inside takes a catalogue track for now (carpetshark will supply one): INSIDE_TRACK names one by id or
  // name fragment, else the first catalogue track
  const REALM_TRACK = { outside: 'soaring', inside: 'euphoric', body: 'pulse' }; // carpetshark: no Abbie's World catalogue music here ("too toybox")
  const INSIDE_TRACK = '';
  const TARGET_LABEL = { outside: 'Rock', inside: 'Rock', toy: 'Germ', glow: 'Virus', micro: 'Bacterium', heart: 'Clot' }; // the lock-on label
  const DIAL = { outside: 'OUT', inside: 'IN', body: 'BODY' };
  for (const k in EXT) { const X = EXT[k]; NAME[k] = X.name; SHORT[k] = X.short; PAL[k] = X.pal; FX_OK[k] = X.fx; TARGET_LABEL[k] = X.label; DIAL[k] = X.dial; if (X.grades) GRADES.push(...X.grades); }
  const AUTO_OPTS = [0, 60, 90]; // the SECTOR dial's auto-warp countdown (s); 0 = off
  const COOLDOWN = 4; // s between world warps
  const TUBE = { inside: 16, body: 15, ds: 1.5, sides: 40 }; // world tunnel radius (m) around Reef's rail, ring spacing, ring sides
  const DEVICE = { dir: 'models/reality-switch/', device: 'device.glb', gate: 'gate.glb', hard: [0.0, 0.62, -0.95], size: 0.55, gateR: 9, gateAhead: 34 };

  // ---------------------------------------------------------------- state
  let G = null, shell = null, A = null, hud = null, SCN0 = null, ready = false, inited = false;
  const st = { realm: 'outside', look: 'toy', lookPick: 'random', grade: 0, sky: 0, fx: 0, auto: 0, dev: false, trackPick: '', overlaySeen: false };
  try { const o = JSON.parse(localStorage.getItem(STORE) || '{}'); if (o && typeof o === 'object') { if (o.lookPick) st.lookPick = o.lookPick; if (AUTO_OPTS.includes(o.auto)) st.auto = o.auto; st.dev = !!o.dev; } } catch {}
  if (Q.has('dev')) st.dev = Q.get('dev') !== 'off' && Q.get('dev') !== '0';
  if (IS_FIXED) st.dev = false;
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify({ lookPick: st.lookPick, auto: st.auto, dev: st.dev })); } catch {} };
  let wasStarted = false, packs = new Map(), pending = new Map(), want = null, wantKey = '', cool = 0, autoT = 0, lastT = 0, warpT0 = 0, stall = { last: 0, max: 0, n: 0 };
  const geo = {}; // built world geometry per realm kind
  let T = null; // the live realm's scene object (its per-frame uniforms are written here)

  // ---------------------------------------------------------------- WGSL: wrap a scene with the facets and this module's materials
  const once = (s, a, b) => { const i = s.indexOf(a); if (i < 0 || s.indexOf(a, i + 1) >= 0) return null; return s.slice(0, i) + b + s.slice(i + a.length); };
  function skyWrap(F) {
    const S = SKIES[F.sky];
    if (!S.t) return 'fn sky(rd: vec3f) -> vec3f { return sky_base(rd); }\nfn fogApply(c: vec3f, wp: vec3f, d: f32) -> vec3f { return fogApply_base(c, wp, d); }\n';
    // the tint reaches the haze too (a tunnel hides most of the sky): fog = attenuated colour + in-scatter, and only the
    // in-scatter (fogApply of black) is tinted, so emissive points (which subtract it) are unchanged
    return `fn sky(rd: vec3f) -> vec3f { let c = sky_base(rd); let l = dot(c, vec3f(0.2126, 0.7152, 0.0722));
  let g = 0.75 + 0.5 * smoothstep(-0.4, 0.9, rd.y); return mix(c, ${S.t} * l * 1.7 * g, 0.55); }
fn fogApply(c: vec3f, wp: vec3f, d: f32) -> vec3f { let ins = fogApply_base(vec3f(0.0), wp, d); let l = dot(ins, vec3f(0.2126, 0.7152, 0.0722));
  return fogApply_base(c, wp, d) - ins + mix(ins, ${S.t} * l * 1.5, 0.45); }\n`;
  }
  function gradeWrap(F, kind, look) {
    const E = EFFECTS[F.fx].id, Gd = GRADES[F.grade];
    let pre = 'var u2 = uv; var c1 = c0;\n';
    if (E === 'shimmer') pre += '  let hw = smoothstep(0.35, 1.0, uv.y); u2 = uv + vec2f(sin(uv.y * 95.0 + u.cam.w * 7.0) * 0.0016, cos(uv.x * 70.0 - u.cam.w * 9.0) * 0.0022) * (0.35 + 0.65 * hw); c1 = hdrAt(u2);\n';
    if (E === 'wobble') pre += '  u2 = uv + vec2f(sin(uv.y * 16.0 + u.cam.w * 1.7), sin(uv.x * 12.0 + u.cam.w * 1.3)) * 0.0045; c1 = hdrAt(u2);\n';
    if (E === 'pulse') pre += '  let bt = fract(u.cam.w * 1.25); let beat = exp(-bt * 9.0) + 0.6 * exp(-max(bt - 0.18, 0.0) * 11.0) * step(0.18, bt); u2 = 0.5 + (uv - 0.5) * (1.0 - 0.012 * beat); c1 = hdrAt(u2);\n';
    if (E === 'chroma') pre += '  let co = (uv - 0.5) * (0.006 + 0.002 * sin(u.cam.w * 1.1)); c1 = vec3f(hdrAt(uv + co).r, c0.g, hdrAt(uv - co).b);\n';
    if (kind === 'body') pre += BODY_REALM.pre(look);
    let postFx = '';
    if (E === 'wobble') postFx += '  let ca = vn3(vec3f(uv * vec2f(9.0, 6.0), u.cam.w * 0.6)); c += vec3f(0.0, 0.05, 0.06) * smoothstep(0.55, 0.85, ca) + vec3f(-0.02, 0.01, 0.025);\n';
    if (E === 'pulse') postFx += '  let q = uv - 0.5; c = c * (1.0 + 0.07 * beat) - vec3f(0.0, 0.12, 0.1) * beat * smoothstep(0.08, 0.3, dot(q, q));\n';
    if (E === 'shimmer') postFx += '  c += vec3f(0.02, 0.008, -0.01) * hw;\n';
    return `fn grade(c0: vec3f, bl: vec3f, uv: vec2f, px: vec2i, d0: f32) -> vec3f {
  ${pre}  var c = grade_base(c1, bl, u2, px, d0);
  ${Gd.w || ''}
${postFx}  return clamp(c, vec3f(0.0), vec3f(1.0));
}\n`;
  }
  // body materials, geometry, river, beat and entry card: realm-body.js (BODY_REALM; GAME_API.md "Body realm")
  // build the realm's scene object: the base scene's WGSL with the facets (and, in the body, these materials)
  function sceneFor(kind, look, F) {
    let base = SCN0, id = 'outside';
    if (kind === 'inside') { base = srcScene('hollow'); id = 'inside'; }
    if (kind === 'body') { base = srcScene(look); id = 'body-' + look; }
    if (EXT[kind]) { base = EXT[kind].scene(A); id = kind; }
    if (!base) return null;
    let w = once(base.wgsl, 'fn sky(', 'fn sky_base(');
    if (w) w = once(w, 'fn fogApply(', 'fn fogApply_base(');
    if (w && kind === 'body') w = once(w, 'fn shadeSolid(', 'fn shadeSolid_base(');
    let p = once(base.post, 'fn grade(', 'fn grade_base(');
    if (!w || !p) { console.warn('realms: cannot wrap ' + id); return null; }
    w += skyWrap(F) + (kind === 'body' ? BODY_REALM.wgsl(look) : '');
    p += (kind === 'body' ? BODY_REALM.post(look) : '') + gradeWrap(F, kind, look);
    const S = { id: id + '/' + F.grade + '.' + F.sky + '.' + F.fx, realm: kind, look, wgsl: w, post: p, sun: (base.sun || [0, 1, 0]).slice(), p0: (base.p0 || [0, 0, 1, 0]).slice(), p1: (base.p1 || [0, 0, 0, 1]).slice() };
    if (kind === 'outside') { S.sun = SCN0.sun; S.p0 = SCN0.p0; S.p1 = SCN0.p1; S.meshLight = SCN0.meshLight; S.corridor = SCN0.corridor; }
    if (EXT[kind]) S.meshLight = base.meshLight;
    if (kind === 'inside') S.meshLight = { point: true, key: [1.1, 1.0, 0.9], ambUp: [0.3, 0.28, 0.36], ambDown: [0.18, 0.15, 0.22], wrap: 0.35, rim: [0.18, 0.26, 0.34], rimPow: 1.5, rimBack: 0 };
    if (kind === 'body') {
      S.sun = look === 'heart' ? [0, 0, 0] : [-0.35, 0.82, -0.45];
      S.meshLight = look === 'heart' ? { point: true, key: [1.3, 0.9, 0.85], ambUp: [0.3, 0.12, 0.15], ambDown: [0.12, 0.03, 0.05], wrap: 0.4, rim: [0.4, 0.15, 0.18], rimPow: 2, rimBack: 0 }
        : look === 'glow' ? { key: [0.7, 0.45, 0.6], ambUp: [0.22, 0.06, 0.14], ambDown: [0.08, 0.02, 0.05], wrap: 0.4, rim: [0.8, 0.3, 0.6], rimPow: 2.5, rimBack: 0 }
        : look === 'micro' ? { key: [1.1, 1.05, 1.1], ambUp: [0.4, 0.4, 0.45], ambDown: [0.25, 0.24, 0.28], wrap: 0.4, rim: [0.25, 0.25, 0.3], rimPow: 2, rimBack: 0 }
        : { key: [1.3, 1.0, 0.95], ambUp: [0.4, 0.22, 0.22], ambDown: [0.2, 0.08, 0.1], wrap: 0.5, rim: [0.35, 0.15, 0.15], rimPow: 2, rimBack: 0 };
      if (look === 'micro') { S.p1[1] = 0; S.p1[2] = 0.45; } // its fallback blur off; thinner haze
      BODY_REALM.tune(S, look);
    }
    return S;
  }
  const srcCache = {};
  function srcScene(k) { if (!(k in srcCache)) { try { srcCache[k] = SRC[k] ? SRC[k]() : null; } catch (e) { console.error('realms: scene ' + k + ': ' + e.message); srcCache[k] = null; } } return srcCache[k]; }

  // ---------------------------------------------------------------- world geometry along Reef's rail (built once per kind, on first use)
  const FRm = new Float64Array(9), C3 = [0, 0, 0];
  // a tube of rings around the rail: rad(s, th, x, y, z) -> radius (m); normals face the rail (the open space); aux per vertex
  function tube(rad, aux) {
    const R = A.rail, L = R.len, ds = TUBE.ds, NS = TUBE.sides, nr = Math.ceil(L / ds) + 1, nv = nr * (NS + 1);
    const P = new Float32Array(nv * 3), Cn = new Float32Array(nr * 3), AX = new Float32Array(nv);
    for (let k = 0; k < nr; k++) {
      const s = min(k * ds, L); R.at(s, C3); R.frame(s, FRm); Cn[k * 3] = C3[0]; Cn[k * 3 + 1] = C3[1]; Cn[k * 3 + 2] = C3[2];
      for (let j = 0; j <= NS; j++) {
        const th = (j % NS) / NS * TAU, cx = cos(th), cy = sin(th);
        const dx = FRm[3] * cx + FRm[6] * cy, dy = FRm[4] * cx + FRm[7] * cy, dz = FRm[5] * cx + FRm[8] * cy;
        const r = rad(s, th, C3[0] + dx * 14, C3[1] + dy * 14, C3[2] + dz * 14), o = (k * (NS + 1) + j) * 3;
        P[o] = C3[0] + dx * r; P[o + 1] = C3[1] + dy * r; P[o + 2] = C3[2] + dz * r; AX[k * (NS + 1) + j] = aux ? aux(s, th) : 1;
      }
    }
    const I = new Uint32Array((nr - 1) * NS * 6); let q = 0;
    for (let k = 0; k < nr - 1; k++) for (let j = 0; j < NS; j++) { const a = k * (NS + 1) + j, b = a + 1, c = a + NS + 1, d = c + 1; I[q++] = a; I[q++] = c; I[q++] = b; I[q++] = b; I[q++] = c; I[q++] = d; }
    const N = new Float32Array(nv * 3);
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3, ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; for (const k of [a, b, c]) { N[k] += nx; N[k + 1] += ny; N[k + 2] += nz; }
    }
    const vb = new ArrayBuffer(nv * 16), f = new Float32Array(vb), sb = new Int8Array(vb);
    for (let i = 0; i < nv; i++) {
      const k = (i / (NS + 1)) | 0; let nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2];
      const ix = Cn[k * 3] - P[i * 3], iy = Cn[k * 3 + 1] - P[i * 3 + 1], iz = Cn[k * 3 + 2] - P[i * 3 + 2]; // toward the rail
      if (nx * ix + ny * iy + nz * iz < 0) { nx = -nx; ny = -ny; nz = -nz; }
      const l = hypot(nx, ny, nz) || 1;
      f[i * 4] = P[i * 3]; f[i * 4 + 1] = P[i * 3 + 1]; f[i * 4 + 2] = P[i * 3 + 2];
      sb[i * 16 + 12] = round(nx / l * 127); sb[i * 16 + 13] = round(ny / l * 127); sb[i * 16 + 14] = round(nz / l * 127); sb[i * 16 + 15] = round(clamp(AX[i], -1, 1) * 127);
    }
    return { vb, ib: I, nv };
  }
  // scattered decor instances in the tunnel: n of them, rho(s) m from the rail; returns an instance array (12 floats each)
  function scatter(n, seed, rhoFn, radFn, mat, p1, p2, p3) {
    rseed(seed); const R = A.rail, I = new Float32Array(n * 12), lo = A.sHero + 20, hi = R.len - 5;
    for (let i = 0; i < n; i++) {
      const s = rr(lo, hi), th = rr(0, TAU), rho = rhoFn(s, th), r = radFn(); R.at(s, C3); R.frame(s, FRm);
      const cx = cos(th) * rho, cy = sin(th) * rho, q = qRand(), o = i * 12;
      I[o] = C3[0] + FRm[3] * cx + FRm[6] * cy; I[o + 1] = C3[1] + FRm[4] * cx + FRm[7] * cy; I[o + 2] = C3[2] + FRm[5] * cx + FRm[8] * cy; I[o + 3] = r;
      I[o + 4] = q[0]; I[o + 5] = q[1]; I[o + 6] = q[2]; I[o + 7] = q[3]; I[o + 8] = mat; I[o + 9] = p1 == null ? rnd() : p1; I[o + 10] = p2 == null ? 0 : p2; I[o + 11] = p3 == null ? 0 : p3;
    }
    return I;
  }
  // static points for a realm: the game's whole points layout with the scene's own region (0..nScenePts) replaced
  function pointsFor(fill) {
    const P = new Float32Array(A.points.length); P.set(A.points); P.fill(0, 0, A.nScenePts * 8);
    const n = A.nScenePts, R = A.rail; let k = 0;
    const put = (x, y, z, sz, r, g, b, kind) => { if (k >= n) return; const o = k * 8; P[o] = x; P[o + 1] = y; P[o + 2] = z; P[o + 3] = sz; P[o + 4] = r; P[o + 5] = g; P[o + 6] = b; P[o + 7] = kind; k++; };
    fill(put, R);
    return P;
  }
  const lumpy = (sub, seed, amp, sx = 1, sy = 1, sz = 1) => { rseed(seed); const o = [rr(0, 50), rr(0, 50), rr(0, 50)]; return icosphere(sub, (x, y, z) => { const r = 1 + amp * (fbm(x * 1.6 + o[0], y * 1.6 + o[1], z * 1.6 + o[2], 3) - 0.5) * 2; return [x * r * sx, y * r * sy, z * r * sz]; }); };
  const merge = (meshes) => { const m = new Mesh(); for (const a of meshes) { const o = m.p.length / 3; m.p.push(...a.p); m.aux.push(...a.aux); for (const t of a.i) m.i.push(t + o); } return m; };
  function buildInside() {
    if (geo.inside) return geo.inside;
    const R0 = TUBE.inside;
    const walls = tube((s, th, x, y, z) => R0 + 3.4 * (fbm(x * 0.055, y * 0.055, z * 0.055, 4) - 0.5) * 2 + 0.9 * (vnoise((x + y) * 0.18, (y - x) * 0.05, z * 0.18) - 0.5) - 1.2 * sstep(30, 0, s));
    walls.inst = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0.3, 0, 0]); walls.realmPart = 'walls';
    // coral sponges on the walls (hollow.js mat 1: prm.y seed, prm.w the baked light visibility)
    const sp = lumpy(2, 780, 0.25).build(); sp.inst = scatter(160, 781, () => R0 - 1.6, () => rr(0.7, 2.2), 1, null, 0, 1); sp.realmPart = 'decor';
    const rk = lumpy(1, 790, 0.35).build(); rk.inst = scatter(220, 791, () => R0 - 0.8, () => rr(0.8, 2.6), 0, null, 0, 0); rk.realmPart = 'decor';
    const pts = pointsFor((put, R) => { rseed(795); for (let i = 0; i < 1800; i++) { const s = rr(0, R.len), th = rr(0, TAU), rho = Math.sqrt(rnd()) * (R0 - 3); R.at(s, C3); R.frame(s, FRm); const b = rr(0.4, 1.1);
      put(C3[0] + FRm[3] * cos(th) * rho + FRm[6] * sin(th) * rho, C3[1] + FRm[4] * cos(th) * rho + FRm[7] * sin(th) * rho, C3[2] + FRm[5] * cos(th) * rho + FRm[8] * sin(th) * rho, rr(0.02, 0.05), 0.5 * b, 0.75 * b, 0.9 * b, 1); } });
    return (geo.inside = { solids: [walls, sp, rk], pts });
  }
  const buildBody = (look) => BODY_REALM.build(look, { A, pointsFor });
  // the mesh list a realm pack draws: the realm's world, then the game's own meshes (targets reskinned, the gate restyled,
  // the Spine arches and the reef band left out, anything else, such as another module's meshes, as it is)
  function meshesFor(kind, look) {
    if (kind === 'outside') return G.meshes;
    const W = EXT[kind] ? EXT[kind].build(A, { pointsFor }) : kind === 'inside' ? buildInside() : buildBody(look), out = W.solids.slice();
    for (let i = A.nScene; i < G.meshes.length; i++) {
      const m = G.meshes[i], tag = m.realm;
      if (tag === 'arch' || tag === 'band') continue;
      if (tag === 'target' && EXT[kind] && W.skins) { out.push({ vb: W.skins[m.realmVar % 3].vb, ib: W.skins[m.realmVar % 3].ib, owner: m }); continue; }
      if (tag === 'gate' && EXT[kind] && W.gateMat) { const g = 'realmGate' + W.gateMat; if (!m[g]) { m[g] = { vb: m.vb, ib: m.ib, inst: m.inst.slice() }; m[g].inst[8] = W.gateMat; } out.push(m[g]); continue; }
      if (tag === 'target' && kind === 'body') { out.push({ vb: W.skins[m.realmVar % 3].vb, ib: W.skins[m.realmVar % 3].ib, owner: m }); continue; }
      if (tag === 'gate' && kind === 'body') { if (!m.realmGate) { m.realmGate = { vb: m.vb, ib: m.ib, inst: m.inst.slice() }; m.realmGate.inst[8] = 12; } out.push(m.realmGate); continue; }
      out.push(m);
    }
    return out;
  }
  const pointsOf = (kind, look) => kind === 'outside' ? null : (EXT[kind] ? EXT[kind].build(A, { pointsFor }) : kind === 'inside' ? buildInside() : buildBody(look)).pts;

  // ---------------------------------------------------------------- packs
  const facetKey = (F) => F.grade + '.' + F.sky + '.' + F.fx;
  const keyOf = (kind, look, F) => (kind === 'body' ? 'body-' + look : kind) + '/' + facetKey(F);
  // a pack for (realm, look, facets): resident when built; built asynchronously on request (the pipelines compile off the frame)
  function request(kind, look, F) {
    const key = keyOf(kind, look, F);
    if (packs.has(key) || pending.has(key)) return key;
    if (kind === 'outside' && F.grade === 0 && F.sky === 0 && F.fx === 0) { packs.set(key, { pack: G.realmInitial, scene: SCN0 }); return key; }
    const S = sceneFor(kind, look, F); if (!S) return null;
    const t0 = performance.now();
    const meshes = meshesFor(kind, look), pts = pointsOf(kind, look), tGeo = performance.now() - t0;
    const pr = G.realmPack(S, { meshes, points: pts || undefined }).then((pack) => { pending.delete(key); packs.set(key, { pack, scene: S, ms: performance.now() - t0, geoMs: tGeo }); return key; })
      .catch((e) => { pending.delete(key); console.error('realms: pack ' + key + ': ' + e.message); return null; });
    pending.set(key, pr);
    return key;
  }
  // build every realm's base pack (native facets) in the background, one at a time, after the run starts (dev mode)
  let preloadQ = null;
  function preload() {
    if (preloadQ) return preloadQ;
    const list = [['inside', st.look], ...Object.keys(EXT).map((k) => [k, st.look]), ...LOOKS.map((l) => ['body', l])], F0 = { grade: 0, sky: 0, fx: 0 };
    preloadQ = (async () => { for (const [k, l] of list) { await new Promise((r) => setTimeout(r, 120)); const key = request(k, l, F0); if (pending.has(key)) await pending.get(key); } return [...packs.keys()]; })();
    return preloadQ;
  }

  // ---------------------------------------------------------------- per-frame scene uniforms for the live realm (and the aux one)
  const RF = new Float64Array(9), RP = new Float64Array(3), RQ = new Float64Array(3);
  function sceneUniforms(S, s, cam, t) {
    if (!S || S.realm === 'outside') return;
    S.p1[3] = SCN0.p1[3]; // the holo route / ghost rail switch follows the game's (shell layer `rail`, holo.js)
    if (EXT[S.realm]) { EXT[S.realm].uniforms(S, s, t); return; }
    const R = A.rail; R.frame(min(s + 6, R.len), RF);
    if (S.realm === 'inside') { // the ship's lamp: a point light behind and above the ship, aimed down the tunnel
      R.at(max(s - 14, 0), RP); S.sun[0] = RP[0] + RF[6] * 4; S.sun[1] = RP[1] + RF[7] * 4; S.sun[2] = RP[2] + RF[8] * 4;
      R.at(min(s + 40, R.len), RQ); let dx = RQ[0] - S.sun[0], dy = RQ[1] - S.sun[1], dz = RQ[2] - S.sun[2]; const l = hypot(dx, dy, dz) || 1;
      S.p1[0] = dx / l; S.p1[1] = dy / l; S.p1[2] = dz / l;
      R.frame(min(s + 60, R.len), RF); S.p0[0] = RF[0]; S.p0[1] = RF[1]; S.p0[2] = RF[2]; // the haze glows toward the way ahead
      return;
    }
    S.p0[0] = RF[0]; S.p0[1] = RF[1]; S.p0[2] = RF[2]; // body: the core glow down the vessel
    if (S.look === 'heart') { R.at(min(s + 30, R.len), RP); S.sun[0] = RP[0]; S.sun[1] = RP[1] + 2; S.sun[2] = RP[2]; }
    BODY_REALM.uniforms(S, s); // the heartbeat (u.p0.w, on the music's beat) and the heart glow in the next heart ring
    if (S.look === 'micro') { S.p1[0] = 12; }
  }

  // ---------------------------------------------------------------- warps
  let warpTo = null, warpKind = '', auxKey = '';
  const curF = () => ({ grade: st.grade, sky: st.sky, fx: st.fx });
  function nextRealm() { return ORDER[(ORDER.indexOf(st.realm) + 1) % ORDER.length]; }
  function pickLook() { return st.lookPick !== 'random' && LOOKS.includes(st.lookPick) ? st.lookPick : LOOKS[(Math.random() * LOOKS.length) | 0]; }
  const palOf = (kind, look) => PAL[kind === 'body' ? look : kind];
  function canWarp() { return inited && G && G.realmPack && !WARP.active && !pulseOn && !(typeof PULSE !== 'undefined' && PULSE.phase) && A.started && !A.ended; }
  // the WORLD action: warp to `kind` (default: the next realm)
  function world(kind) {
    if (!canWarp() || cool > 0) return false;
    kind = kind || nextRealm(); const look = kind === 'body' ? pickLook() : st.look, F = { grade: 0, sky: 0, fx: 0 }; // a new world opens in its native look
    go(kind, look, F, 'world'); cool = COOLDOWN; autoT = 0; return true;
  }
  // the STYLE action: reroll the facets in place (never the same combo twice running; at least one facet changes from native)
  function style(F) {
    if (!canWarp()) return false;
    if (!F) {
      const ok = FX_OK[st.realm]; let g, s, e, tries = 0;
      do { g = (Math.random() * GRADES.length) | 0; s = (Math.random() * SKIES.length) | 0; e = ok[(Math.random() * ok.length) | 0]; tries++; }
      while (tries < 40 && ((g === st.grade && s === st.sky && e === st.fx) || (g === 0 && s === 0 && e === 0) || (g >= 3 && e === 4) || (GRADES[g].realm && GRADES[g].realm !== st.realm)));
      F = { grade: g, sky: s, fx: e };
    }
    go(st.realm, st.look, F, 'style'); return true;
  }
  function go(kind, look, F, how) {
    const key = request(kind, look, F); if (!key) return;
    warpTo = { kind, look, F, key }; warpKind = how; warpT0 = performance.now();
    WARP.start(how, palOf(st.realm, st.look), palOf(kind, look), swap, () => packs.has(key));
    if (how === 'world') music(kind, true);
    if (how === 'world' && typeof PULSE !== 'undefined') PULSE.beat(WARP.KINDS.world.dur * WARP.KINDS.world.peak); // the Reality Pulse's brief time-stop and quick camera beat, until the tunnel's peak (pulse.js)
  }
  function swap() { // at the tunnel's peak: the new realm becomes the scene (a few assignments; measured as the stall)
    if (!warpTo) return;
    const t0 = performance.now(), P = packs.get(warpTo.key);
    if (!P) return;
    if (warpTo.kind === 'body' && st.realm !== 'body') BODY_REALM.enter(warpTo.look); // the INSIDE THE BODY card and a whoosh of cells
    G.realmAux = null; G.realmUse(P.pack); T = P.scene;
    st.realm = warpTo.kind; st.look = warpTo.look; st.grade = warpTo.F.grade; st.sky = warpTo.F.sky; st.fx = warpTo.F.fx;
    if (typeof WHALES !== 'undefined') WHALES.realmOff = st.realm !== 'outside'; // the whales swim only in Space Outside
    if (hud.labels && hud.labels.length) hud.labels[0] = TARGET_LABEL[st.realm === 'body' ? st.look : st.realm];
    const ms = performance.now() - t0; stall.last = ms; stall.max = max(stall.max, ms); stall.n++;
    warpTo = null; dialDirty = true; toast(warpKind === 'style' ? styleText() : NAME[st.realm] + (st.realm === 'body' ? ' · ' + LOOK_NAME[st.look] : ''), warpKind === 'style' ? 'STYLE' : 'WORLD');
  }
  const styleText = () => [st.grade ? GRADES[st.grade].name : '', st.sky ? SKIES[st.sky].name + ' sky' : '', st.fx ? EFFECTS[st.fx].name : ''].filter(Boolean).join(' · ') || 'Native';
  const facetText = () => GRADES[st.grade].name + ' · ' + SKIES[st.sky].name + ' sky · ' + EFFECTS[st.fx].name;
  // back to Space Outside at once (a new run starts there; Frame 0 is unchanged)
  function home() {
    if (!G || !G.realmUse) return;
    G.realmAux = null; if (G.final) G.final.on = false; warpTo = null;
    G.realmUse(G.realmInitial); T = SCN0; st.realm = 'outside'; st.grade = st.sky = st.fx = 0; cool = 0; autoT = 0;
    if (typeof WHALES !== 'undefined') WHALES.realmOff = false;
    if (hud.labels && hud.labels.length) hud.labels[0] = TARGET_LABEL.outside;
    dialDirty = true;
  }

  // ---------------------------------------------------------------- music (carpetshark: "and it switches the music too"; "the third changes the MUSIC";
  // "a fabulous way to blend the music scores"). The blends live in music.js (one WebAudio graph); this decides what plays.
  // The device takes the music over from the shell on its first use in a run (Soaring Melody, or the Settings pick, carries on
  // from the same playhead) and hands it back at the next run start.
  let curTrack = 'soaring';
  const MZ = typeof MUSIC !== 'undefined' ? MUSIC : null;
  function trackList() {
    const out = []; const add = (id) => { if (id && !out.includes(id)) out.push(id); };
    add('soaring'); add('euphoric'); add('pulse'); add('reimagined'); // only the game's own tracks (carpetshark: the catalogue music is "too toybox")
    return out;
  }
  // carpetshark: "make the music choices random" - each world change picks one of the game's own tracks at random (never the one playing)
  const POOL = ['soaring', 'euphoric', 'pulse', 'reimagined'];
  function trackFor(kind) { const o = POOL.filter((t) => t !== curTrack); return o[(Math.random() * o.length) | 0]; }

  function trackInfo(id) {
    if (MZ && MZ.map[id]) return MZ.map[id];
    const cat = shell && shell.musicTracks ? shell.musicTracks() : [], m = cat.find((x) => 'cat:' + x.id === id);
    return m ? { url: m.url, name: m.name } : null;
  }
  // take the music over from the shell's player (once per run); false when no music is playing and none was asked for
  function takeover(force) {
    if (!MZ || !shell || !shell.musicPause) return false;
    if (MZ.active) return true;
    const was = shell.musicPause(); // { playing, t, game, id }
    if (!was.playing && !force) return false;
    curTrack = was.game || !was.id ? 'soaring' : 'cat:' + was.id; if (!was.game && was.id) st.trackPick = curTrack; // a Settings pick is the player's pick
    const ti = trackInfo(curTrack); if (!ti) return false;
    MZ.start(curTrack, ti.url, was.playing ? was.t : 0, shell.settings ? shell.settings.musicVol : 0.5);
    return true;
  }
  function playTrack(id, mode, land) {
    const to = trackInfo(id); if (!to || !takeover(mode === 'bass')) return;
    curTrack = id; MZ.blend(id, to.url, mode, { resume: id === 'soaring', land });
    toast(to.name, 'NOW PLAYING'); dialDirty = true;
  }
  // a world switch moves to that world's default track (a dub-out into a drop at the tunnel exit) unless the player picked one
  function music(kind, fromWorld, land) { if (fromWorld && st.trackPick) return; const id = trackFor(kind); if (id !== curTrack) playTrack(id, fromWorld ? 'dub' : 'bass', land || WARP.KINDS.world.dur - 0.1); }
  function cycleMusic() { const L = trackList(), i = L.indexOf(curTrack), id = L[(i + 1) % L.length]; st.trackPick = id; playTrack(id, 'bass'); }
  function musicStep() { if (MZ && MZ.active && shell && shell.settings) MZ.volume(shell.settings.musicVol); }

  // ---------------------------------------------------------------- the device (carpetshark's Tripo model): models/reality-switch/*.glb
  // device.glb: shown in shoulder view at a gunship hardpoint (DEVICE.hard, ship space: x right, y up, z forward), DEVICE.size m.
  // gate.glb: a ring that appears DEVICE.gateAhead m ahead on the rail during a world warp (DEVICE.gateR m radius). Missing files:
  // a placeholder (a small glowing ring device; the warp shader's screen-space gate halo). The build lists the files that exist
  // (REALITY_GLB), so a missing model never fetches.
  let devH = null, gateH = null, devModel = 'none', gateModel = 'none';
  const DQ = new Float64Array(4);
  function torus(R, r, nu, nv, col, emi) {
    const n = (nu + 1) * (nv + 1), pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), uv = new Float32Array(n * 2), idx = new Uint32Array(nu * nv * 6); let k = 0, q = 0;
    for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) { const a = i / nu * TAU, b = j / nv * TAU, cx = cos(a), cz = sin(a), cb = cos(b), sb = sin(b);
      pos[k * 3] = (R + r * cb) * cx; pos[k * 3 + 1] = r * sb; pos[k * 3 + 2] = (R + r * cb) * cz; nrm[k * 3] = cb * cx; nrm[k * 3 + 1] = sb; nrm[k * 3 + 2] = cb * cz; uv[k * 2] = i / nu; uv[k * 2 + 1] = j / nv; k++; }
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const a = i * (nv + 1) + j, b = a + nv + 1; idx[q++] = a; idx[q++] = b; idx[q++] = a + 1; idx[q++] = a + 1; idx[q++] = b; idx[q++] = b + 1; }
    return { prims: [{ pos, nrm, uv, idx, mat: { color: [...col, 1], tex: -1, emissive: emi, name: 'placeholder' } }], images: [] };
  }
  // glTF is right-handed, the engine left-handed (GAME_API.md "Textured meshes", Handedness): negate x and flip the winding once
  function mirror(m) { for (const p of m.prims) { for (let k = 0; k < p.pos.length; k += 3) { p.pos[k] = -p.pos[k]; p.nrm[k] = -p.nrm[k]; } for (let k = 0; k < p.idx.length; k += 3) { const t = p.idx[k + 1]; p.idx[k + 1] = p.idx[k + 2]; p.idx[k + 2] = t; } } return m; }
  function loadDevice() {
    const have = typeof REALITY_GLB !== 'undefined' ? REALITY_GLB : [];
    const load = (f, fallback, opts, setH, setName) => {
      if (have.includes(DEVICE.dir + f) && G.loadGLB) G.loadGLB(DEVICE.dir + f).then((m) => { setH(G.addMesh(mirror(m), { center: true, visible: false, ...opts })); setName(f); }).catch(() => { setH(G.addMesh(fallback, { visible: false, ...opts })); setName('placeholder'); });
      else { setH(G.addMesh(fallback, { visible: false, ...opts })); setName('placeholder'); }
    };
    load(DEVICE.device, torus(0.5, 0.12, 32, 10, [0.85, 0.9, 1.0], [0.2, 1.2, 1.4]), { emissiveCut: 1 }, (h) => { devH = h; }, (n) => { devModel = n; });
    load(DEVICE.gate, torus(1, 0.06, 72, 10, [0.9, 0.95, 1.0], [0.6, 1.6, 1.8]), { emissiveCut: 1 }, (h) => { gateH = h; }, (n) => { gateModel = n; });
  }
  function devicePlace(view) {
    const shoulder = A.view > 0.5 && !A.mp;
    if (devH) {
      const on = st.dev && shoulder && A.started && !A.ended;
      devH.visible = on;
      if (on) { // ship space → world with the ship pose quaternion QSH, at the ship position (the pilot position, A.cam)
        const q = A.QSH, h = DEVICE.hard, x = h[0], y = h[1], z = h[2], tx = 2 * (q[1] * z - q[2] * y), ty = 2 * (q[2] * x - q[0] * z), tz = 2 * (q[0] * y - q[1] * x);
        devH.pos[0] = A.cam[0] + x + q[3] * tx + (q[1] * tz - q[2] * ty); devH.pos[1] = A.cam[1] + y + q[3] * ty + (q[2] * tx - q[0] * tz); devH.pos[2] = A.cam[2] + z + q[3] * tz + (q[0] * ty - q[1] * tx);
        const sp = performance.now() * 0.0012; DQ[0] = 0; DQ[1] = sin(sp); DQ[2] = 0; DQ[3] = cos(sp); // spin about its up axis
        devH.q[0] = q[3] * DQ[0] + q[0] * DQ[3] + q[1] * DQ[2] - q[2] * DQ[1]; devH.q[1] = q[3] * DQ[1] - q[0] * DQ[2] + q[1] * DQ[3] + q[2] * DQ[0];
        devH.q[2] = q[3] * DQ[2] + q[0] * DQ[1] - q[1] * DQ[0] + q[2] * DQ[3]; devH.q[3] = q[3] * DQ[3] - q[0] * DQ[0] - q[1] * DQ[1] - q[2] * DQ[2];
        devH.scale = DEVICE.size / max(1e-3, devH.bounds.size[0], devH.bounds.size[2]);
      }
    }
    if (gateH) { // the gate ring ahead on the rail during a world warp, square to the rail (ring model axis: its +Y)
      const ph = WARP.active && WARP.kind !== 'style' ? WARP.phase : 0, on = ph > 0 && ph < 0.55;
      gateH.visible = on;
      if (on) {
        const sa = min(A.s + DEVICE.gateAhead * (1 - ph * 1.6), A.rail.len); A.rail.at(sa, RP); A.rail.frame(sa, RF);
        gateH.pos[0] = RP[0]; gateH.pos[1] = RP[1]; gateH.pos[2] = RP[2];
        const qx = RF[2], qz = -RF[0], qw = 1 + RF[1], ql = Math.sqrt(qx * qx + qz * qz + qw * qw) || 1; gateH.q[0] = qx / ql; gateH.q[1] = 0; gateH.q[2] = qz / ql; gateH.q[3] = qw / ql; // qFromY, without allocating
        gateH.scale = DEVICE.gateR * 2 / max(1e-3, gateH.bounds.size[0]) * (0.6 + ph * 1.2);
      }
      WARP.gate(0, 0, 0, 0);
    }
  }

  // ---------------------------------------------------------------- HUD: SECTOR dial, DEV tag, key overlay, NOW PLAYING toast
  let dialEl = null, dialSvg = null, dEl = {}, devTag = null, keysEl = null, toastEl = null, toastT = 0, keysT = 0, keysForce = false, dialDirty = true, padPrev = 0;
  const CSS = `#rrsec{position:fixed;left:max(14px,env(safe-area-inset-left));bottom:max(285px,calc(env(safe-area-inset-bottom) + 285px));z-index:21;width:196px;pointer-events:none;font:600 11px var(--fl,ui-monospace,Menlo,monospace);color:var(--s,#cfe);text-shadow:0 1px 2px #000;opacity:.95}
#rrsec svg{display:block;width:148px;height:148px;overflow:visible}#rrsec .t{font-family:var(--fd,ui-monospace,Menlo,monospace);letter-spacing:.12em}
#rrsec dl{margin:4px 0 0;display:grid;grid-template-columns:auto 1fr;gap:1px 8px;font-size:10.5px;letter-spacing:.06em}#rrsec dt{color:var(--h,#7fe0d0)}#rrsec dd{margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#e6f0f4}
#rrdev{position:fixed;right:max(12px,env(safe-area-inset-right));top:max(64px,env(safe-area-inset-top));z-index:26;pointer-events:none;font:800 11px ui-monospace,Menlo,monospace;letter-spacing:.2em;color:#ffcf5a;border:1.5px solid #ffcf5a;border-radius:5px;padding:1px 6px;background:rgba(20,12,0,.55)}
#rrkeys{position:fixed;left:calc(max(14px,env(safe-area-inset-left)) + 160px);bottom:max(300px,calc(env(safe-area-inset-bottom) + 300px));z-index:27;pointer-events:none;display:flex;flex-direction:column;align-items:center;gap:6px;opacity:0;transition:opacity .35s;font-family:var(--fl,ui-monospace,Menlo,monospace)}
#rrkeys .row{display:flex;gap:6px;padding:8px 10px;border-radius:12px;background:rgba(6,12,18,.55);border:1px solid rgba(255,255,255,.14)}
#rrkeys .k{width:40px;height:40px;border-radius:8px;display:grid;place-items:center;font:700 15px var(--fd,ui-monospace,Menlo,monospace);color:rgba(220,235,240,.32);border:1px solid rgba(220,235,240,.18);background:rgba(255,255,255,.03)}
#rrkeys .k.on{color:#081218;background:var(--h,#7fe0d0);border-color:var(--h,#7fe0d0);box-shadow:0 0 14px var(--h,#7fe0d0)}
#rrkeys .lab{display:flex;gap:6px;padding:0 11px}#rrkeys .lab span{width:40px;text-align:center;font:700 9.5px var(--fl,ui-monospace,Menlo,monospace);letter-spacing:.08em;color:var(--h,#7fe0d0);text-shadow:0 1px 2px #000}
#rrkeys .lab span.x{color:transparent}#rrkeys .pad{font:600 11px var(--fl,ui-monospace,Menlo,monospace);color:#d8e8ee;text-shadow:0 1px 2px #000;letter-spacing:.05em}#rrkeys .hd{font:700 10px var(--fl,ui-monospace,Menlo,monospace);letter-spacing:.24em;color:#ffcf5a}
#rrtoast{position:fixed;left:50%;top:15%;z-index:27;transform:translateX(-50%);pointer-events:none;text-align:center;opacity:0;transition:opacity .4s;font:800 clamp(15px,2.4vw,22px) var(--fd,ui-monospace,Menlo,monospace);letter-spacing:.06em;color:#eef7fa;text-shadow:0 0 12px var(--h,#7fe0d0),0 2px 3px #000}
#rrtoast small{display:block;font:700 11px var(--fl,ui-monospace,Menlo,monospace);letter-spacing:.3em;color:var(--h,#7fe0d0)}
@media (prefers-reduced-motion:reduce){#rrkeys,#rrtoast{transition:none}}`;
  function hudBuild() {
    if (dialEl || typeof document === 'undefined') return;
    const root = document.getElementById('sgr') || document.body, s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s);
    dialEl = document.createElement('div'); dialEl.id = 'rrsec'; dialEl.style.display = 'none';
    // the dial: three sectors (OUTSIDE, INSIDE, BODY), the live one lit, the next one marked; outer ring: the auto-warp countdown;
    // inner ring: the warp cooldown (or the warp in progress)
    const seg = (i) => { const w = 360 / ORDER.length, a0 = -90 + i * w + 4, a1 = a0 + w - 8, r = 58, p = (a) => [74 + r * Math.cos(a * PI / 180), 74 + r * Math.sin(a * PI / 180)], [x0, y0] = p(a0), [x1, y1] = p(a1); return `M${x0.toFixed(1)} ${y0.toFixed(1)}A${r} ${r} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`; };
    const lab = (i, t) => { const a = (-90 + i * 360 / ORDER.length + 180 / ORDER.length) * PI / 180; return `<text class="t" x="${(74 + 42 * Math.cos(a)).toFixed(1)}" y="${(77 + 42 * Math.sin(a)).toFixed(1)}" text-anchor="middle" font-size="8.5" data-l="${i}">${t}</text>`; };
    dialEl.innerHTML = `<svg viewBox="0 0 148 148" aria-hidden="true">
<circle cx="74" cy="74" r="70" fill="rgba(6,12,18,.42)" stroke="var(--h,#7fe0d0)" stroke-opacity=".35"/>
${ORDER.map((_, i) => `<path d="${seg(i)}" fill="none" stroke-width="7" stroke-linecap="round" data-s="${i}"/>`).join('')}
${ORDER.map((k, i) => lab(i, DIAL[k])).join('')}
<circle cx="74" cy="74" r="67" fill="none" stroke="#ffcf5a" stroke-width="2.5" stroke-dasharray="0 999" transform="rotate(-90 74 74)" data-auto/>
<circle cx="74" cy="74" r="24" fill="none" stroke="var(--h,#7fe0d0)" stroke-width="3" stroke-dasharray="0 999" transform="rotate(-90 74 74)" data-cool/>
<text class="t" x="74" y="71" text-anchor="middle" font-size="9" fill="var(--h,#7fe0d0)">SECTOR</text><text class="t" x="74" y="84" text-anchor="middle" font-size="11" fill="#fff" data-c>OUT</text>
</svg><dl><dt>Z WORLD</dt><dd data-w></dd><dt>X STYLE</dt><dd data-st></dd><dt>C MUSIC</dt><dd data-m></dd></dl>`;
    root.appendChild(dialEl); dialSvg = dialEl.querySelector('svg');
    dEl.seg = ORDER.map((_, i) => dialEl.querySelector(`[data-s="${i}"]`)); dEl.lab = ORDER.map((_, i) => dialEl.querySelector(`[data-l="${i}"]`));
    dEl.auto = dialEl.querySelector('[data-auto]'); dEl.cool = dialEl.querySelector('[data-cool]'); dEl.c = dialEl.querySelector('[data-c]');
    dEl.w = dialEl.querySelector('[data-w]'); dEl.st = dialEl.querySelector('[data-st]'); dEl.m = dialEl.querySelector('[data-m]');
    devTag = document.createElement('div'); devTag.id = 'rrdev'; devTag.textContent = 'DEV'; devTag.style.display = 'none'; root.appendChild(devTag);
    keysEl = document.createElement('div'); keysEl.id = 'rrkeys'; keysEl.setAttribute('aria-hidden', 'true');
    keysEl.innerHTML = `<div class="hd">REALITY DEVICE</div><div class="row">${['A', 'S', 'D', 'F'].map(() => '').join('')}${['Z', 'X', 'C', 'V', 'B'].map((k) => `<div class="k${'ZXC'.includes(k) ? ' on' : ''}">${k}</div>`).join('')}</div>
<div class="lab"><span>WORLD</span><span>STYLE</span><span>MUSIC</span><span class="x">.</span><span class="x">.</span></div><div class="pad" data-pad></div>`;
    root.appendChild(keysEl); dEl.pad = keysEl.querySelector('[data-pad]');
    toastEl = document.createElement('div'); toastEl.id = 'rrtoast'; root.appendChild(toastEl);
  }
  function toast(text, head) { if (!toastEl || !st.dev) return; toastEl.innerHTML = `<small>${head}</small>` + text.replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;')); toastEl.style.opacity = '1'; toastT = 2.6; }
  const CIRC_A = 2 * PI * 67, CIRC_C = 2 * PI * 24; let ringA = -1, ringC = -1; const shown = { dial: null, dev: null, keys: null };
  function hudFrame(dt) {
    if (!dialEl) return;
    const live = st.dev && A.started && !A.ended && !(shell && shell.state === 'menu');
    if (live !== shown.dial) { shown.dial = live; dialEl.style.display = live ? '' : 'none'; dialDirty = true; } if (st.dev !== shown.dev) { shown.dev = st.dev; devTag.style.display = st.dev ? '' : 'none'; }
    if (toastT > 0) { toastT -= dt; if (toastT <= 0) toastEl.style.opacity = '0'; }
    // the key overlay: the first run after the HUD boots (a few seconds), whenever the device shows (shoulder view), and on ? / H
    const devView = live && devH && devH.visible;
    if (keysT > 0) keysT -= dt;
    const showKeys = live && (keysT > 0 || keysForce || devView);
    if (showKeys !== shown.keys) { shown.keys = showKeys; keysEl.style.opacity = showKeys ? '1' : '0'; }
    if (!live) return;
    if (dialDirty) {
      dialDirty = false;
      const ci = ORDER.indexOf(st.realm), ni = ORDER.indexOf(warpTo ? warpTo.kind : nextRealm());
      for (let i = 0; i < ORDER.length; i++) { dEl.seg[i].setAttribute('stroke', i === ci ? 'var(--h,#7fe0d0)' : i === ni ? '#ffffff' : 'rgba(220,235,240,.18)'); dEl.seg[i].setAttribute('stroke-opacity', i === ci ? '1' : i === ni ? '.55' : '1'); dEl.seg[i].setAttribute('stroke-dasharray', i === ni ? '2 6' : 'none'); dEl.lab[i].setAttribute('fill', i === ci ? '#fff' : i === ni ? '#e6f0f4' : 'rgba(220,235,240,.4)'); }
      dEl.c.textContent = SHORT[st.realm];
      dEl.w.textContent = (st.realm === 'body' ? LOOK_NAME[st.look] + ' body' : NAME[st.realm]) + ' → ' + SHORT[nextRealm()].toLowerCase();
      dEl.st.textContent = styleText();
      const ti = trackInfo(curTrack); dEl.m.textContent = (ti ? ti.name : '—') + (st.trackPick ? ' ·' : '');
      const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? [...navigator.getGamepads()].some((p) => p && p.connected) : false;
      dEl.pad.textContent = pads ? 'Gamepad: D-pad ◀ WORLD · ▲ STYLE · ▶ MUSIC' : '';
    }
    // the rings: a DOM write only when a ring moves a whole pixel (no string per frame otherwise)
    const ap = st.auto ? Math.round(CIRC_A * min(1, autoT / st.auto)) : 0, cw = WARP.active ? WARP.phase : cool > 0 ? 1 - cool / COOLDOWN : 0, cp = Math.round(CIRC_C * cw);
    if (ap !== ringA) { ringA = ap; dEl.auto.setAttribute('stroke-dasharray', ap + ' 999'); }
    if (cp !== ringC) { ringC = cp; dEl.cool.setAttribute('stroke-dasharray', cp + ' 999'); }
  }

  // ---------------------------------------------------------------- input (developer mode only)
  function key(code) {
    if (!st.dev || !inited) return false;
    if (code === 'KeyZ') { if (!world()) hud.event('overheat'); return true; }
    if (code === 'KeyX') { style(); return true; }
    if (code === 'KeyC') { cycleMusic(); return true; }
    if (code === 'Slash' || code === 'KeyH') { keysForce = !keysForce; if (keysForce) keysT = 0; return code === 'Slash'; } // H also toggles the engine's stats line; ? opens the overlay
    return false;
  }
  function padPoll() { // d-pad left / up / right = WORLD / STYLE / MUSIC (buttons 14, 12, 15 in the standard mapping), edge-triggered
    if (!st.dev || typeof navigator === 'undefined' || !navigator.getGamepads) return;
    const gp = navigator.getGamepads(); let b = 0;
    for (let i = 0; i < gp.length; i++) { const p = gp[i]; if (!p || !p.connected || p.mapping !== 'standard') continue; const B = p.buttons; if (B[14] && B[14].pressed) b |= 1; if (B[12] && B[12].pressed) b |= 2; if (B[15] && B[15].pressed) b |= 4; }
    const e = b & ~padPrev; padPrev = b;
    if (e & 1) world(); if (e & 2) style(); if (e & 4) cycleMusic();
  }

  // ---------------------------------------------------------------- frame (called from GAME.post every frame)
  function post(view) {
    if (!ready && G) setup();
    if (!inited) return;
    if (A.started && !wasStarted) runStart(); wasStarted = A.started;
    const now = performance.now(), dt = lastT ? min(0.1, (now - lastT) / 1000) : 0; lastT = now;
    const paused = shell && shell.open;
    if (!paused) {
      if (cool > 0) cool = max(0, cool - dt);
      if (st.dev && st.auto && A.started && !A.ended && !WARP.active) { autoT += dt; if (autoT >= st.auto) { autoT = 0; world(); } }
      padPoll();
      musicStep();
    }
    // the new realm renders alongside while the tunnel blends to it (once its pack is resident)
    if (warpTo && WARP.active && !G.realmAux && packs.has(warpTo.key) && (!A.mp || A.mp <= 2)) { const P = packs.get(warpTo.key); if (P.pack !== G.realm) { G.realmAux = P.pack; auxKey = warpTo.key; } }
    const t = view && view.F ? view.F[8] : 0;
    { const lk = bodyLooks(); if (lk.length) BODY_REALM.frame(paused ? 0 : dt, lk, A.s, t, MZ); }
    sceneUniforms(T, A.s, A.cam, t);
    if (G.realmAux && warpTo) sceneUniforms(packs.get(warpTo.key).scene, A.s, A.cam, t);
    WARP.step(paused ? 0 : dt, !!G.realmAux, t);
    if (!WARP.active && !pulseOn && G.realmAux) G.realmAux = null;
    devicePlace(view);
    hudFrame(dt);
  }

  const BL = [], bodyLooks = () => { BL.length = 0; if (st.realm === 'body') BL.push(st.look); if (warpTo && warpTo.kind === 'body' && warpTo.look !== st.look) BL.push(warpTo.look); return BL; };

  // ---------------------------------------------------------------- commands, settings
  const help = `
  world [outside|inside|body|next] [toy|glow|micro|heart]   (dev) warp to a realm (Z); also: world look random|<look>
  style reroll | style facets <grade> <sky> <fx>   (dev) reroll the shader facets in place (X); grades ${GRADES.map((g) => g.id).join('|')}, skies ${SKIES.map((g) => g.id).join('|')}, fx ${EFFECTS.map((g) => g.id).join('|')}
  music cycle | music realm   (dev) next track in the device's cycle (C), or back to the realm's own track
  sector auto off|60|90   (dev) auto-warp countdown on the SECTOR dial
  dev on|off|toggle   developer mode (the reality device: Z/X/C, the SECTOR dial, key overlay; also ?dev)`;
  function command(a) {
    if (a[0] === 'dev') {
      st.dev = a[1] === 'on' ? true : a[1] === 'off' ? false : !st.dev; save(); dialDirty = true;
      if (st.dev) { keysT = 4; if (A && A.started) preload(); } else if (inited) { keysForce = false; }
      sync(); return 'developer mode ' + (st.dev ? 'on: Z WORLD · X STYLE · C MUSIC, the SECTOR dial (and ?dev)' : 'off');
    }
    if (a[0] === 'world' || a[0] === 'realm') {
      if (!st.dev) return 'world: developer mode only (dev on)';
      if (a[1] === 'look') { const k = a[2]; if (k !== 'random' && !LOOKS.includes(k)) return 'world look random|' + LOOKS.join('|'); st.lookPick = k; save(); sync(); return 'body look: ' + (k === 'random' ? 'random per warp' : LOOK_NAME[k]); }
      if (!a[1]) return 'world: ' + NAME[st.realm] + (st.realm === 'body' ? ' (' + LOOK_NAME[st.look] + ')' : '') + ' · next ' + NAME[nextRealm()] + ' · ' + facetText();
      let k = a[1] === 'next' ? nextRealm() : a[1]; if (k === 'out') k = 'outside'; if (k === 'in') k = 'inside'; if (k === 'under' || k === 'sea') k = 'underwater';
      if (!ORDER.includes(k)) return 'world ' + ORDER.join('|') + '|next';
      if (k === 'body' && LOOKS.includes(a[2])) { const was = st.lookPick; st.lookPick = a[2]; const ok = world(k); st.lookPick = was; return ok ? 'warping to ' + NAME[k] + ' (' + LOOK_NAME[a[2]] + ')' : 'not now (run not started, warp in progress or cooling down)'; }
      return world(k) ? 'warping to ' + NAME[k] : 'not now (run not started, warp in progress or cooling down)';
    }
    if (a[0] === 'sector') {
      if (a[1] !== 'auto') return 'sector auto off|60|90';
      const v = a[2] === 'off' ? 0 : +a[2]; if (!AUTO_OPTS.includes(v)) return 'sector auto off|60|90';
      st.auto = v; autoT = 0; save(); sync(); return 'auto-warp ' + (v ? 'every ' + v + ' s' : 'off');
    }
    return null;
  }
  // commands the shell would otherwise take for its own (style <hud style>, music <track>): only these sub-commands
  function commandFirst(a) {
    if (a[0] === 'style' && (a[1] === 'reroll' || a[1] === 'facets' || a[1] === 'native')) {
      if (!st.dev) return 'style reroll: developer mode only (dev on)';
      if (a[1] === 'reroll') return style() ? 'restyling: a new facet roll' : 'not now';
      const pick = (L, v) => { const i = L.findIndex((x) => x.id === v); return i < 0 ? 0 : i; };
      const F = a[1] === 'native' ? { grade: 0, sky: 0, fx: 0 } : { grade: pick(GRADES, a[2]), sky: pick(SKIES, a[3]), fx: pick(EFFECTS, a[4]) };
      return style(F) ? 'style: ' + GRADES[F.grade].name + ' · ' + SKIES[F.sky].name + ' sky · ' + EFFECTS[F.fx].name : 'not now';
    }
    if (a[0] === 'music' && (a[1] === 'cycle' || a[1] === 'realm')) {
      if (!st.dev) return 'music cycle: developer mode only (dev on)';
      if (a[1] === 'cycle') { cycleMusic(); return 'music: ' + (trackInfo(curTrack) || {}).name; }
      st.trackPick = ''; music(st.realm, false); return 'music: the realm\'s own track';
    }
    return null;
  }
  const settingsHTML = () => `<h4>Reality device (developer)</h4><div data-rrdevonly><div class="seg"><button type="button" data-game="world outside" aria-pressed="false">Outside</button><button type="button" data-game="world inside" aria-pressed="false">Inside</button>${Object.keys(EXT).map((k) => `<button type="button" data-game="world ${k}" aria-pressed="false">${EXT[k].name}</button>`).join('')}<button type="button" data-game="world body" aria-pressed="false">Body</button></div>
<p class="note">Body look</p><div class="seg">${['random', ...LOOKS].map((k) => `<button type="button" data-game="world look ${k}" aria-pressed="false">${k === 'random' ? 'Random' : LOOK_NAME[k]}</button>`).join('')}</div>
<p class="note">Auto-warp (SECTOR dial)</p><div class="seg">${AUTO_OPTS.map((v) => `<button type="button" data-game="sector auto ${v || 'off'}" aria-pressed="false">${v ? v + ' s' : 'Off'}</button>`).join('')}</div>
<p class="note">Z world · X style · C music · ? keys</p></div>
<h4>Developer</h4><div class="seg"><button type="button" data-game="dev on" aria-pressed="false">On</button><button type="button" data-game="dev off" aria-pressed="false">Off</button></div>`;
  function sync() {
    if (typeof document === 'undefined') return;
    for (const b of document.querySelectorAll('#sgset [data-game^="dev "]')) b.setAttribute('aria-pressed', String(b.dataset.game === (st.dev ? 'dev on' : 'dev off')));
    for (const b of document.querySelectorAll('#sgset [data-game^="world look "]')) b.setAttribute('aria-pressed', String(b.dataset.game === 'world look ' + st.lookPick));
    for (const b of document.querySelectorAll('#sgset [data-game^="sector auto "]')) b.setAttribute('aria-pressed', String(b.dataset.game === 'sector auto ' + (st.auto || 'off')));
    for (const b of document.querySelectorAll('#sgset [data-game^="world "]:not([data-game^="world look"])')) b.setAttribute('aria-pressed', String(b.dataset.game === 'world ' + st.realm));
    for (const e of document.querySelectorAll('#sgset [data-rrdevonly]')) e.style.display = st.dev ? '' : 'none';
  }

  // ---------------------------------------------------------------- lifecycle (Reef Run calls these)
  // api: { scene, rail, sHero, sGate, nScene, nScenePts, points, cam, QSH, s, view, started, ended, mp } (getters for the live values)
  function init(G_, Shell_, api) {
    G = G_; shell = Shell_; hud = Shell_.hud; A = api; SCN0 = api.scene; T = SCN0;
  }
  // on the first frame (the engine's realm API exists once its pipelines do); never in fixed frames (?shot, ?frame0, ?bench)
  function setup() {
    ready = true; if (IS_FIXED || !G || !G.realmPack) return;
    inited = true; hudBuild(); WARP.prepare(G); loadDevice();
  }
  // a run starts (control handed over): developer mode shows the key overlay for a few seconds and preloads the realms
  function runStart() {
    if (!inited) return;
    if (st.dev) { if (!st.overlaySeen) { keysT = 5; st.overlaySeen = true; } preload(); }
    pulse.ready(); // the Reality Pulse works without dev mode: the next realm's pack is built in the background
    dialDirty = true;
  }
  function reset() { if (!inited) return; pulseOn = false; pulseNext = null; home(); if (MZ) { MZ.tape(1); MZ.stop(); MZ.forget(); } curTrack = 'soaring'; st.trackPick = ''; }
  // ---------------------------------------------------------------- for the Reality Pulse (pulse.js `api.world`; GAME_API.md "Reality Pulse")
  // The pulse spreads the next realm of the WORLD cycle from where its shot lands. It asks for that realm's pack ahead (ready),
  // renders it alongside while the bubble grows (begin: G.realmAux), and at the swallow runs the same swap() as a warp, so the
  // realm state, the SECTOR dial, the labels and the whales follow; the new realm's track punches in on an entry point (a
  // dub-out with a 60 ms landing; a C pick stays, Soaring Melody resumes where it was left). tape(): the time-stop's tape-slow
  // (MUSIC.tape) and a low-pass in the music graph's insert slot. Works without dev mode.
  let pulseOn = false, pulseNext = null, tapeF = null;
  const F0 = { grade: 0, sky: 0, fx: 0 };
  const pulse = {
    ready() {
      if (!inited || !G || !G.realmPack || WARP.active) return false;
      const kind = nextRealm(); if (!pulseNext || pulseNext.kind !== kind) { const look = kind === 'body' ? pickLook() : st.look; pulseNext = { kind, look, F: F0, key: request(kind, look, F0) }; }
      return !!pulseNext.key && packs.has(pulseNext.key);
    },
    begin(aux) { warpTo = pulseNext; warpKind = 'world'; warpT0 = performance.now(); pulseOn = true; const P = packs.get(warpTo.key); if (aux && P.pack !== G.realm) { G.realmAux = P.pack; auxKey = warpTo.key; } },
    colours(a, b) { const f = palOf(st.realm, st.look), t = pulseNext ? palOf(pulseNext.kind, pulseNext.look) : f; for (let i = 0; i < 3; i++) { a[i] = f[i]; b[i] = t[i]; } },
    swallow() { if (!warpTo) return; const kind = warpTo.kind; swap(); pulseOn = false; pulseNext = null; cool = max(cool, 1.5); autoT = 0; if (MZ && MZ.active) MZ.tape(1); music(kind, true, 0.06); },
    cancel() { pulseOn = false; pulseNext = null; warpTo = null; if (G) G.realmAux = null; },
    tape(rate, lp) {
      if (!MZ) return; if (rate < 1 && !takeover(false)) return; if (!MZ.active || !MZ.ctx) return;
      MZ.tape(rate);
      if (!tapeF) { tapeF = MZ.ctx.createBiquadFilter(); tapeF.type = 'lowpass'; tapeF.Q.value = 0.9; tapeF.frequency.value = 20000; MZ.insert(tapeF, tapeF); }
      tapeF.frequency.setTargetAtTime(20000 * Math.pow(0.012, lp), MZ.ctx.currentTime, 0.03);
    },
  };
  const debug = {
    get state() { return { realm: st.realm, look: st.look, facets: { grade: GRADES[st.grade].id, sky: SKIES[st.sky].id, fx: EFFECTS[st.fx].id }, dev: st.dev, auto: st.auto, cool, warp: WARP.active ? { kind: WARP.kind, phase: +WARP.phase.toFixed(3) } : null, packs: [...packs.keys()], pending: [...pending.keys()], track: curTrack, trackPick: st.trackPick, musicClock: MZ ? +MZ.clock().toFixed(2) : -1, musicDeck: MZ ? MZ.current : '', stall, device: devModel, gate: gateModel, aux: !!(G && G.realmAux) }; },
    packTimes() { const o = {}; for (const [k, v] of packs) o[k] = { ms: v.ms ? +v.ms.toFixed(1) : 0, geoMs: v.geoMs ? +v.geoMs.toFixed(1) : 0 }; return o; },
    get music() { return MZ; }, get warp() { return WARP; }, get body() { return BODY_REALM.debug; }, ext: EXT,
    world(k, l) { cool = 0; if (l) { const w = st.lookPick; st.lookPick = l; const r = world(k); st.lookPick = w; return r; } return world(k); }, style(F) { return style(F); }, home, preload, cycleMusic, request: (k, l, F) => request(k, l, F || { grade: 0, sky: 0, fx: 0 }), keys(on = true) { keysForce = on; },
  };
  const onMusic = () => { if (MZ && MZ.active) MZ.stop(); }; // the shell's own player started again (a Settings pick, a new run)
  return { init, runStart, reset, post, onMusic, key, command, commandFirst, help, settingsHTML, sync, debug, pulse, get dev() { return st.dev; }, get realm() { return st.realm; } };
})();
