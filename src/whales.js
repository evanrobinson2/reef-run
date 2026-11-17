// ============================================================================
// whales.js: neon space whales for Reef Run, rebuilt in code from carpetshark's selected concept SW-5.3
// (concept/space-whales/SELECTION.md, DECOMPOSITION.md; IDs WH-xx refer to that record).
// A whale is glowing contour lines (dense additive points on the body surface), a faint translucent shell (sparse soft
// points), fins and flukes on their own bones, and its school: a pink orbit ring, a gold spiral, lantern orbs and motes.
// It swims with a slow travelling body wave (dorsoventral, as whales do), sweeping pectoral fins and beating flukes, and a
// pulse of light runs nose to tail along its lines. Reduced motion: slower, no pulse, little shimmer.
// Not a target: bolts pass through. Load-time allocation only; frame() writes into the game's point array in place.
// Pages: reef-run.html (hooked from reefrun.js: init, reset, writePools, command) and whale-lab.html (WHALES.lab).
// ============================================================================
const WHALES = (() => {
  const M = Math, PIm = M.PI, TAUm = 2 * M.PI, DEG = M.PI / 180;
  const cl = (x, a, b) => (x < a ? a : x > b ? b : x), lerp = (a, b, t) => a + (b - a) * t;
  const sst = (a, b, x) => { const t = cl((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const Q = typeof QS !== 'undefined' ? QS : new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
  // private PRNG (mulberry32): never touches the scene's shared rnd(), so nothing else's random stream moves
  let sd = 1; const R = () => { sd = (sd + 0x6D2B79F5) | 0; let t = M.imul(sd ^ (sd >>> 15), 1 | sd); t = (t + M.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const RR = (a, b) => a + (b - a) * R(), seed = (n) => { sd = n | 0; }, gs = () => (R() + R() + R() + R() - 2) * 0.866; // ~N(0, 0.58)

  // ---------------------------------------------------------------- grammar (DECOMPOSITION.md section 4). Units: whale length L = 1.
  // O = observed on SW-5.3, I = inferred, P = proposed for the game. Values marked "fit" come from fit-whale.mjs (section 5).
  const GR = {
    L: 34,                       // P: metres, snout to fluke notch (a space whale, about twice a humpback)
    // WH-P1 (O): centreline and half-depth measured on the source (landmarks.jpg), re-parameterised by arc length
    centre: [[212, 300], [260, 316], [350, 336], [450, 360], [550, 383], [650, 403], [750, 422], [850, 430], [950, 426], [1050, 391], [1120, 344], [1180, 277], [1210, 215]],
    half: [0, 0.038, 0.067, 0.095, 0.119, 0.129, 0.124, 0.113, 0.094, 0.083, 0.069, 0.047, 0.023],
    width: [[0, 0.8], [0.12, 1.0], [0.35, 1.0], [0.55, 0.92], [0.75, 0.72], [0.9, 0.42], [1, 0.3]], // I: half-width / half-depth (unseen from the side)
    depthK: 1.007,                   // fit: a uniform depth correction for the side-on perspective
    rest: 0.800,                   // P: share of the source's arch kept as the resting pose; the swim wave supplies the rest at the lab phase
    // WH-M1 swim (P, owner-directed "slow travelling body wave"): theta += amp(s) sin(w t - k s)
    wave: { amp: 0.250, hz: 0.11, k: 4.6, fluke: 0.32, flukeLag: 0.9, fin: 0.22 },
    // WH-P2 pectoral fin (O: long humpback blade, about 0.4 L in the source, tubercle stars on the leading edge)
    fin: { s: 0.552, alpha: -38 * DEG, len: 0.37, chord: 0.1, back: 84.3 * DEG, out: -4.6 * DEG, twist: 18 * DEG },
    // WH-P3 flukes (O: span about 0.32 L, swept, notched)
    fluke: { span: 0.17, chord: 0.09, sweep: 0.075 },
    // WH-P4 dorsal fin (O: a small hooked bump at about 0.78 L)
    dorsal: { s0: 0.73, s1: 0.81, h: 0.032 },
    // WH-L* contour families (O: counts and spacing from the crops; 10 bright pleats per 130 px on the visible side of the head)
    pleats: { n: 23, a0: -12 * DEG, a1: -168 * DEG, s1: 0.62 },
    flow: { n: 13, a0: 8 * DEG, a1: 172 * DEG },
    eye: { s: 0.405, alpha: 26 * DEG, r: 0.011 },
    rosettes: [[0.33, 24, 0.034, 3], [0.6, 16, 0.04, 3], [0.765, 19, 0.027, 2], [0.845, 47, 0.019, 2], [0.5, -6, 0.022, 2], [0.69, 52, 0.018, 2]], // s, alpha deg, radius, rings
    sp: 0.0042, spLine: 0.0043, lineR: 0.0036, fillR: 0.02, nFill: 1600,
    // WH-F* school (O: about 450 pink and 650 gold fish in the source; ring and spiral measured on landmarks.jpg)
    ring: { R: 0.525, Rx: 0.476, z: -0.011, y: 0.001, n: 440, spread: 0.024, h: 0.018, roll: 0.125, pitch: -0.048, period: 46, lines: 3,
      arcs: [2.3, 1.71, 1.19, 0.42, 5.97, 5.41, 5.1, 4.71, 4.4, 4.12, 3.04, 2.9, 2.69, 2.48], // pink: phases where the source shows the ring populated (fit); fish gather there
    },
    gold: { R: 0.764, Rx: 0.335, z: 0.263, y: -0.240, n: 900, spread: 0.055, h: 0.04, roll: -1.106, pitch: 0.117, gperiod: 30,
      arcs: [3.32, 3.42, 3.53, 3.67, 3.74, 4.4, 4.75, 5.1, 5.38, 5.76, 5.93, 6.04, 3, 3.07, 3.18], // gold: phases where the source shows the orbit populated (fit)
    }, // WH-F2: a second, steeper orbit (fit)
    orbs: 14, motes: 220, sparks: 30, inner: 60,
    river: { n: 680, len: 3.6, speed: 0.17 }, // P (owner-directed: "a fish river streaming past"), wonder whale only
  };
  // WH-C* colour variants (O: SW-5.3 teal lead; SW-5.0 pink, SW-5.1 violet as the rare treat). HDR linear, before the scene grade.
  const PAL = {
    teal:   { line: [0.17, 0.72, 0.5], hot: [0.42, 1.35, 0.98], fill: [0.022, 0.085, 0.052], ros: [0.24, 1.0, 0.75], eye: [1.4, 3.6, 3.2], spark: [7.5, 2.4, 0.3], gold: [5.0, 2.6, 0.7], pink: [3.0, 1.25, 3.4], ringLine: [0.55, 0.2, 0.62], vein: [3.0, 0.9, 0.5] },
    pink:   { line: [0.7, 0.4, 0.26], hot: [1.05, 0.66, 0.42], fill: [0.2, 0.05, 0.11], ros: [0.9, 0.5, 0.45], eye: [2.2, 1.6, 1.2], spark: [7.5, 2.4, 0.3], gold: [5.0, 2.0, 1.1], pink: [3.2, 1.1, 2.2], ringLine: [0.6, 0.25, 0.45], vein: [3.0, 1.2, 0.6] },
    violet: { line: [0.85, 0.2, 1.05], hot: [0.85, 0.45, 1.3], fill: [0.05, 0.02, 0.09], ros: [0.3, 0.85, 1.0], eye: [1.6, 2.4, 3.4], spark: [7.0, 2.4, 0.5], gold: [5.0, 2.6, 0.7], pink: [3.2, 0.9, 3.4], ringLine: [0.5, 0.2, 0.7], vein: [3.2, 1.0, 2.6] },
  };

  // ---------------------------------------------------------------- the resting body: arc-length spine, profiles
  const NS = 129, SMAX = 1.0; // spine nodes over s = 0..1 (flukes ride the last node)
  const cumS = [0]; for (let i = 1; i < GR.centre.length; i++) cumS.push(cumS[i - 1] + M.hypot(GR.centre[i][0] - GR.centre[i - 1][0], GR.centre[i][1] - GR.centre[i - 1][1]));
  const SRC_S = cumS.map((v) => v / cumS[cumS.length - 1]);
  const tab = (xs, ys, x) => { if (x <= xs[0]) return ys[0]; for (let i = 1; i < xs.length; i++) if (x <= xs[i]) return lerp(ys[i - 1], ys[i], (x - xs[i - 1]) / (xs[i] - xs[i - 1])); return ys[ys.length - 1]; };
  const halfD = (s) => tab(SRC_S, GR.half, cl(s, 0, 1)) * GR.depthK;
  const widthK = (s) => tab(GR.width.map((v) => v[0]), GR.width.map((v) => v[1]), s);
  const halfW = (s) => halfD(s) * widthK(s);
  // source arch: the centreline's angle (tail-ward direction, up positive) at each arc-length s
  const SRC_TH = []; for (let i = 0; i + 1 < GR.centre.length; i++) SRC_TH.push(M.atan2(-(GR.centre[i + 1][1] - GR.centre[i][1]), GR.centre[i + 1][0] - GR.centre[i][0]));
  const SRC_TS = SRC_TH.map((_, i) => (SRC_S[i] + SRC_S[i + 1]) / 2);
  const srcTheta = (s) => tab(SRC_TS, SRC_TH, s);
  const TH0 = new Float64Array(NS); const setRest = (k) => { GR.rest = k; for (let j = 0; j < NS; j++) TH0[j] = k * srcTheta(j / (NS - 1) * SMAX); }; setRest(GR.rest);
  const ANCHOR = 0.42; // the body pivots about its mass centre (I), so the wave doesn't swing the whale around

  // ---------------------------------------------------------------- template (unit L): every glowing point of one whale
  // bone 0 body (s, a lateral, b along the section's up normal), 1/2 pectoral fin right/left (u span, v chord, n), 3 flukes (a, d behind
  // the notch), 4 inner volume (s, a, b, no rim). Normals: body (na lateral, nb up-normal); fins and flukes use their plane.
  const T = { s: [], a: [], b: [], d: [], bone: [], size: [], r: [], g: [], bl: [], na: [], nb: [], pw: [], fam: [] };
  const FAM = { line: 0, hot: 1, fill: 2, ros: 3, eye: 4, spark: 5, vein: 6, inner: 7 };
  const push = (s, a, b, d, bone, size, col, na, nb, pw, fam) => { T.s.push(s); T.a.push(a); T.b.push(b); T.d.push(d); T.bone.push(bone); T.size.push(size); T.r.push(col[0]); T.g.push(col[1]); T.bl.push(col[2]); T.na.push(na); T.nb.push(nb); T.pw.push(pw); T.fam.push(fam); };
  // resting position of a body surface point (for spacing only)
  const restSpine = (() => { const z = new Float64Array(NS), y = new Float64Array(NS); for (let j = 1; j < NS; j++) { const ds = SMAX / (NS - 1), t = TH0[j - 1]; z[j] = z[j - 1] - M.cos(t) * ds; y[j] = y[j - 1] + M.sin(t) * ds; } return { z, y }; })();
  const restPos = (s, al, lift = 0, o = [0, 0, 0]) => {
    const f = cl(s / SMAX, 0, 1) * (NS - 1), j = M.min(NS - 2, f | 0), t = f - j, th = lerp(TH0[j], TH0[j + 1], t);
    const h = halfD(s) + lift, w = halfW(s) + lift, b = h * M.sin(al);
    o[0] = w * M.cos(al); o[1] = lerp(restSpine.y[j], restSpine.y[j + 1], t) + b * M.cos(th); o[2] = lerp(restSpine.z[j], restSpine.z[j + 1], t) + b * M.sin(th); return o;
  };
  const surf = (s, al, size, col, pw, fam, lift = 0) => { // a body surface point at (s, alpha); its normal from the ellipse section
    const h = halfD(s) + lift, w = halfW(s) + lift, ca = M.cos(al), sa = M.sin(al); let na = ca / M.max(w, 1e-3), nb = sa / M.max(h, 1e-3); const l = M.hypot(na, nb) || 1;
    const lit = fam <= FAM.hot ? (0.72 + 0.42 * M.max(0, sa)) * (0.15 + 0.85 * sst(0, 0.1, s)) : 1; // O: the back and upper head read brighter than the pleated throat; the lines' meeting point at the snout must not flare
    push(s, w * ca, h * sa, 0, 0, size, lit === 1 ? col : [col[0] * lit, col[1] * lit, col[2] * lit], na / l, nb / l, pw, fam);
  };
  // a line over t in [0,1] given (s, alpha) per t; points every sp of resting arc length
  const P0 = [0, 0, 0], P1 = [0, 0, 0];
  const bodyLine = (fn, sp, size, col, pw, fam, lift = 0, both = true) => {
    for (const side of both ? [1, -1] : [1]) {
      let acc = sp, prev = null;
      for (let i = 0; i <= 600; i++) {
        const q = fn(i / 600); if (!q) { prev = null; continue; }
        const al = side > 0 ? q[1] : PIm - q[1];
        restPos(q[0], al, lift, P1);
        if (prev) acc += M.hypot(P1[0] - P0[0], P1[1] - P0[1], P1[2] - P0[2]);
        P0[0] = P1[0]; P0[1] = P1[1]; P0[2] = P1[2]; prev = 1;
        if (acc >= sp) { acc = 0; surf(q[0], al, size * (q[2] || 1), col, pw, fam, lift); }
      }
    }
  };
  function buildTemplate(pal) {
    for (const k in T) T[k].length = 0;
    seed(5301);
    const C = PAL[pal], sp = GR.sp, lr = GR.lineR;
    // WH-L1 ventral pleats: parallel grooves from the jaw tip along the throat, converging on the belly midline at the navel
    const pl = GR.pleats;
    for (let i = 0; i < pl.n; i++) {
      const a0 = lerp(pl.a0, pl.a1, i / (pl.n - 1)), e = M.abs(a0 + PIm / 2) / (PIm / 2); // e: 0 at the belly midline, 1 at the sides
      const s0 = 0.012 + 0.03 * e * e, s1 = pl.s1 - 0.14 * e * e + RR(-0.03, 0.03);
      bodyLine((t) => { const s = lerp(s0, s1, t); return [s, lerp(a0, -PIm / 2, 0.55 * sst(s1 - 0.2, s1, s))]; }, GR.spLine, lr, C.line, 1, FAM.line);
    }
    // WH-L3 mouth line (brighter), from the snout tip back to below the eye
    bodyLine((t) => [lerp(0.004, 0.37, t), lerp(-6, -24, sst(0.6, 1, t)) * DEG, 1.25], sp * 0.8, lr, C.hot, 1, FAM.hot);
    // WH-L2 flank and back flow lines: long, gently wavering, some ending early in the swirls
    const fl = GR.flow;
    for (let i = 0; i < fl.n; i++) {
      const a0 = lerp(fl.a0, fl.a1, i / (fl.n - 1)), ph = RR(0, TAUm), s0 = 0.02 + RR(0, 0.05) + 0.03 * M.abs(M.cos(a0)), s1 = R() < 0.3 ? RR(0.55, 0.85) : RR(0.93, 0.99);
      bodyLine((t) => { const s = lerp(s0, s1, t); return [s, a0 + 9 * DEG * M.sin(TAUm * 1.4 * s + ph) * sst(0.15, 0.4, s)]; }, GR.spLine, lr, C.line, 1, FAM.line);
    }
    // WH-L4 dorsal ridge and keel midlines (the silhouette glow), brighter
    bodyLine((t) => [lerp(0.03, 0.98, t), PIm / 2, 1.1], sp, lr, C.hot, 1, FAM.hot, 0, false);
    bodyLine((t) => [lerp(0.6, 0.98, t), -PIm / 2, 1.1], sp, lr, C.hot, 1, FAM.hot, 0, false);
    // WH-L5 rosettes: concentric rings on the flank (both sides; I: bilateral)
    for (const [rs, ra, rr, rn] of GR.rosettes) { // O: swirls of 2-3 turns, slightly oval, not perfect circles
      const ph0 = RR(0, TAUm), ov = RR(0.75, 1.0);
      bodyLine((t) => { const ph = ph0 + t * TAUm * (rn - 0.4), rad = rr * (1 - 0.82 * t), h = halfD(rs) || 0.01; return [rs + rad * M.cos(ph), ra * DEG + ov * rad * M.sin(ph) / h]; }, sp * 0.7, lr * 0.9, C.ros, 1, FAM.ros, 0.001);
    }
    // WH-E eye: a bright ring with a hot core
    { const e = GR.eye; bodyLine((t) => { const ph = t * TAUm, h = halfD(e.s); return [e.s + e.r * M.cos(ph), e.alpha + e.r * M.sin(ph) / h]; }, sp * 0.5, lr, C.eye, 0.5, FAM.eye, 0.002);
      for (const side of [1, -1]) surf(e.s, side > 0 ? e.alpha : PIm - e.alpha, e.r * 0.8, C.eye, 0.3, FAM.eye, 0.002); }
    // WH-T head knobs (O: the bumpy upper outline of the rostrum, B2): small bright bumps either side of the midline
    for (let i = 0; i < 14; i++) { const s = 0.03 + i * 0.019 + RR(-0.004, 0.004); for (const sd of [1, -1]) surf(s, PIm / 2 - sd * RR(8, 22) * DEG, lr * RR(1.3, 1.9), C.hot, 1, FAM.hot, 0.003); }
    // WH-P4 dorsal fin: outline of a small hooked fin standing on the back
    { const d = GR.dorsal; for (let i = 0; i <= 40; i++) { const t = i / 40, s = lerp(d.s0, d.s1, t), hk = d.h * M.sin(PIm * M.pow(t, 0.6)) * (1 - 0.3 * t);
        push(s, 0, halfD(s) + hk, 0, 0, lr, C.hot, 0, 1, 1, FAM.hot); if (i % 2 === 0 && hk > 0.004) push(s, 0, halfD(s) + hk * 0.5, 0, 0, lr * 0.8, C.line, 0, 1, 1, FAM.line); } }
    // WH-B translucent shell: soft points over the surface, area-weighted, a little brighter on top (lit back)
    for (let i = 0; i < GR.nFill;) { const s = RR(0.01, 0.99); if (R() > (halfD(s) + halfW(s)) / 0.26) continue; const al = RR(-PIm, PIm), up = 0.75 + 0.5 * M.max(0, M.sin(al));
      surf(s, al, GR.fillR * RR(0.7, 1.3), [C.fill[0] * up, C.fill[1] * up, C.fill[2] * up], 0.25, FAM.fill, -M.min(GR.fillR * 0.9, halfD(s) * 0.4)); i++; }
    // WH-S1 orange sparkles on the skin; WH-S2 tiny gold motes inside the rear body
    for (let i = 0; i < GR.sparks; i++) { const s = RR(0.15, 0.88); surf(s, RR(-35, 70) * DEG * (R() < 0.5 ? 1 : -1) + (R() < 0.5 ? 0 : PIm), lr * RR(1.5, 2.8), C.spark, 0, FAM.spark, 0.002); }
    for (let i = 0; i < GR.inner; i++) { const s = RR(0.5, 0.95), al = RR(-PIm, PIm), k = RR(0.2, 0.85); push(s, halfW(s) * k * M.cos(al), halfD(s) * k * M.sin(al), 0, 4, lr * 0.8, C.gold, 0, 0, 0, FAM.inner); }
    // WH-P2 pectoral fins (bones 1, 2): outline with tubercle bumps on the leading edge, inner lines, a rosette, warm veins, stars
    const F = GR.fin;
    const chord = (u) => F.chord * (u < 0.25 ? lerp(0.8, 1, u / 0.25) : lerp(1, 0.22, M.pow((u - 0.25) / 0.75, 1.3)));
    const le = (u) => chord(u) * 0.38 + 0.0035 * M.max(0, M.sin(u * PIm * 11)) * sst(0.2, 0.4, u), te = (u) => -chord(u) * 0.62;
    for (const bone of [1, 2]) {
      const fp = (u, v, size, col, pw, fam) => push(u, v, 0, 0, bone, size, col, 0, 1, pw, fam);
      const edge = (fn, col, fam, k = 1) => { let acc = 1, pu = 0, pv = fn(0); for (let i = 0; i <= 400; i++) { const u = i / 400, v = fn(u); acc += M.hypot((u - pu) * F.len, v - pv); pu = u; pv = v; if (acc >= sp * k) { acc = 0; fp(u, v, lr, col, 1, fam); } } };
      const hotF = [C.hot[0] * 1.35, C.hot[1] * 1.35, C.hot[2] * 1.35]; edge(le, hotF, FAM.hot); edge(te, hotF, FAM.hot);
      for (let i = 0; i <= 8; i++) { const v = lerp(te(1), le(1), i / 8); fp(1, v, lr, C.hot, 1, FAM.hot); } // rounded tip
      for (const k of [0.22, 0.5, 0.75]) edge((u) => lerp(te(u), le(u), k) + 0.004 * M.sin(u * 9 + k * 7), C.line, FAM.line, 1.1);
      for (const [ru, rr] of [[0.28, 0.026], [0.28, 0.016], [0.52, 0.014]]) { const n = M.ceil(TAUm * rr / (sp * 0.7)); for (let i = 0; i < n; i++) { const ph = i / n * TAUm; fp(ru + rr * M.cos(ph) / F.len, lerp(te(ru), le(ru), 0.5) + rr * M.sin(ph), lr * 0.9, C.ros, 1, FAM.ros); } }
      for (let v = 0; v < 5; v++) { let u = RR(0.35, 0.6), w = RR(0.3, 0.7); for (let i = 0; i < 14; i++) { u += 0.02; w += RR(-0.06, 0.06); fp(u, lerp(te(u), le(u), w), lr * 0.6, C.vein, 0.5, FAM.vein); } }
      for (const u of [0.42, 0.58, 0.72, 0.85, 0.93]) fp(u, le(u) + 0.002, lr * 2.4, C.eye, 0.4, FAM.spark); // tubercle stars (O: star glints on the leading edge)
      for (let i = 0; i < 150; i++) { const u = RR(0.02, 0.98); fp(u, lerp(te(u), le(u), R()), GR.fillR * 0.7, C.fill, 0.25, FAM.fill); } // fin glass
    }
    // WH-P3 flukes (bone 3): two swept lobes from the peduncle; a = span, d = distance behind the notch
    const K = GR.fluke;
    const lead = (x) => -0.035 + K.sweep * M.pow(x, 1.25) + 0.012 - 0.025 * M.sin(PIm * M.min(1, x * 1.1)) * (K.chord / 0.09), trail = (x) => K.sweep * M.pow(x, 1.6) + 0.012 * M.sin(PIm * x) - 0.004 * (1 - x); // d along span x 0..1
    for (const side of [1, -1]) {
      const fpt = (x, d, size, col, pw, fam) => push(1, side * x * K.span, 0, d, 3, size, col, 0, 1, pw, fam);
      for (const fn of [lead, trail]) { let acc = 1, px = 0, pd = fn(0); for (let i = 0; i <= 300; i++) { const x = i / 300, d = fn(x); acc += M.hypot((x - px) * K.span, d - pd); px = x; pd = d; if (acc >= sp) { acc = 0; fpt(x, d, lr, C.hot, 1, FAM.hot); } } }
      for (const k of [0.35, 0.65]) for (let i = 0; i <= 50; i++) { const x = 0.08 + 0.85 * i / 50; fpt(x, lerp(lead(x), trail(x), k), lr * 0.9, C.line, 1, FAM.line); }
      { const n = 22; for (let i = 0; i < n; i++) { const ph = i / n * TAUm; fpt(0.45 + 0.09 * M.cos(ph), lerp(lead(0.45), trail(0.45), 0.5) + 0.008 * M.sin(ph), lr * 0.8, C.ros, 1, FAM.ros); } }
      for (let i = 0; i < 90; i++) { const x = RR(0, 0.95); fpt(x, lerp(lead(x), trail(x), R()), GR.fillR * 0.7, C.fill, 0.25, FAM.fill); }
    }
    const n = T.s.length, o = { n, famN: Object.fromEntries(Object.keys(FAM).map((k) => [k, T.fam.filter((f) => f === FAM[k]).length])), boneN: [0, 1, 2, 3, 4].map((b) => T.bone.filter((x) => x === b).length) };
    for (const k in T) o[k] = (k === 'bone' || k === 'fam') ? Int8Array.from(T[k]) : Float32Array.from(T[k]);
    // spine node index and fraction for bones 0 and 4
    o.j = new Int16Array(n); o.f = new Float32Array(n);
    for (let i = 0; i < n; i++) { const fj = cl(o.s[i] / SMAX, 0, 1) * (NS - 1), j = M.min(NS - 2, fj | 0); o.j[i] = j; o.f[i] = fj - j; }
    return o;
  }
  // ---------------------------------------------------------------- the school (fish), in the whale's unbent chord frame
  function buildSchool(pal) {
    seed(5302);
    const C = PAL[pal], rg = GR.ring, hx = GR.gold, rv = GR.river;
    const arcW = (arcs, ph) => { let w = 0; for (const a of arcs) { let d = M.abs(((ph - a) % TAUm + TAUm) % TAUm); d = M.min(d, TAUm - d); w += M.exp(-d * d / 0.09); } return M.min(1, w); }; // O: populated arcs
    const clump = (x, k) => 0.5 + 0.5 * (0.55 * M.sin(x * 1 + k) + 0.3 * M.sin(x * 3 + 2 * k) + 0.15 * M.sin(x * 7 + k * 3)); // patchy density
    // pink ring fish (WH-F1): phase, radius offset, height, speed jitter, shimmer phase
    const ring = new Float32Array(rg.n * 5); for (let i = 0; i < rg.n;) { const ph = RR(0, TAUm); if (R() > 0.08 + 0.92 * arcW(rg.arcs, ph) * (0.5 + 0.5 * clump(ph * 3, 0.4))) continue; const o = i * 5; ring[o] = ph; ring[o + 1] = gs() * rg.spread; ring[o + 2] = gs() * rg.h; ring[o + 3] = RR(0.85, 1.2); ring[o + 4] = RR(0, TAUm); i++; }
    // its thin orbit lines (WH-F1b): radius offset, height, brightness by phase (partial arcs, as in the source)
    const nl = 300, rline = new Float32Array(rg.lines * nl * 3); for (let l = 0; l < rg.lines; l++) { const dr = [-0.016, 0.012, 0.034][l], dh = [0.004, -0.006, 0.01][l], k = RR(0, TAUm); for (let i = 0; i < nl; i++) { const o = (l * nl + i) * 3; rline[o] = i / nl * TAUm; rline[o + 1] = dr; rline[o + 2] = (0.15 + 0.85 * arcW(rg.arcs, i / nl * TAUm)) * sst(0.1, 0.6, clump(i / nl * TAUm * 2, k)) * (0.5 + 0.5 * R()); } }
    // gold orbit fish (WH-F2): phase, radius offset, height, speed jitter, shimmer; denser, broader and patchier than the pink ring
    const hel = new Float32Array(hx.n * 5); for (let i = 0; i < hx.n;) { const ph = RR(0, TAUm); if (R() > 0.05 + 0.95 * arcW(hx.arcs, ph) * (0.4 + 0.6 * clump(ph * 4, 1.3))) continue; const o = i * 5; hel[o] = ph; hel[o + 1] = gs() * hx.spread; hel[o + 2] = gs() * hx.h; hel[o + 3] = RR(0.8, 1.25); hel[o + 4] = RR(0, TAUm); i++; }
    // lantern orbs (WH-F3) and motes (WH-F4): spherical-ish shell around the whale
    const orb = new Float32Array(GR.orbs * 4); for (let i = 0; i < GR.orbs; i++) { orb[i * 4] = RR(0, TAUm); orb[i * 4 + 1] = RR(0.45, 1.25); orb[i * 4 + 2] = RR(-0.5, 0.45); orb[i * 4 + 3] = RR(0.6, 1.4); }
    const mote = new Float32Array(GR.motes * 4); for (let i = 0; i < GR.motes; i++) { mote[i * 4] = RR(-1.3, 1.3); mote[i * 4 + 1] = RR(-0.7, 0.7); mote[i * 4 + 2] = RR(-1.2, 1.2); mote[i * 4 + 3] = RR(0, TAUm); }
    // river (WH-F5): u along the river, lateral and vertical offsets, colour (0 gold, 1 pink), shimmer
    const riv = new Float32Array(rv.n * 5); for (let i = 0; i < rv.n; i++) { const o = i * 5; riv[o] = R(); riv[o + 1] = gs(); riv[o + 2] = gs(); riv[o + 3] = R() < 0.3 ? 1 : 0; riv[o + 4] = RR(0, TAUm); }
    return { C, ring, rline, nl, hel, orb, mote, riv };
  }
  const TPL = {}, SCH = {};
  const tpl = (pal) => TPL[pal] || (TPL[pal] = buildTemplate(pal));
  const sch = (pal) => SCH[pal] || (SCH[pal] = buildSchool(pal));
  // points per whale slot: body template + ring fish ×2 (dash) + ring lines + spiral fish ×2 + orbs + motes + river ×2
  const NB = tpl('teal').n, NR = GR.ring.n * 3, NRL = GR.ring.lines * 300, NH = GR.gold.n * 2, NO = GR.orbs, NM = GR.motes, NV = GR.river.n * 2;
  const CAP = NB + NR + NRL + NH + NO + NM + NV;
  const NSLOT = 3;

  // ---------------------------------------------------------------- per-frame posing (no allocation)
  const SZ = new Float64Array(NS), SY = new Float64Array(NS), SCo = new Float64Array(NS), SSi = new Float64Array(NS), PU = new Float64Array(NS);
  const FB = new Float64Array(2 * 12); // per fin: root xyz, eu xyz, ev xyz, en xyz (whale local)
  const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let RM = Q.has('reduced') ? true : reduced; // reduced motion (?reduced forces it for testing)
  // pose: the bent spine at swim time t (whale local, unit L), then fins
  function bend(t, wamp) {
    const W = GR.wave, w = TAUm * W.hz * (RM ? 0.6 : 1);
    for (let j = 0; j < NS; j++) { const s = j / (NS - 1); SCo[j] = TH0[j] + wamp * W.amp * (0.12 + 0.88 * s * s) * M.sin(w * t - W.k * s); }
    // integrate from the anchor both ways so the mass centre stays put
    const ds = SMAX / (NS - 1), ja = M.round(ANCHOR * (NS - 1));
    SZ[ja] = 0; SY[ja] = 0;
    for (let j = ja + 1; j < NS; j++) { const a = (SCo[j - 1] + SCo[j]) / 2; SZ[j] = SZ[j - 1] - M.cos(a) * ds; SY[j] = SY[j - 1] + M.sin(a) * ds; }
    for (let j = ja - 1; j >= 0; j--) { const a = (SCo[j] + SCo[j + 1]) / 2; SZ[j] = SZ[j + 1] + M.cos(a) * ds; SY[j] = SY[j + 1] - M.sin(a) * ds; }
    // centre on the chord midpoint (nose to notch), so the whale sits on its path
    const cz = (SZ[0] + SZ[NS - 1]) / 2, cy = (SY[0] + SY[NS - 1]) / 2;
    for (let j = 0; j < NS; j++) { SZ[j] -= cz; SY[j] -= cy; const a = SCo[j]; SCo[j] = M.cos(a); SSi[j] = M.sin(a); }
    // pectoral fins: root on the bent body, then sweep (O for the rest pose; P for the motion)
    const F = GR.fin, fj = M.round(F.s * (NS - 1)), c = SCo[fj], sn = SSi[fj], h = halfD(F.s), wd = halfW(F.s);
    const sweep = wamp * W.fin * M.sin(w * t - W.k * F.s + PIm / 2);
    for (let side = 0; side < 2; side++) {
      const sg = side ? -1 : 1, o = side * 12, b = h * M.sin(F.alpha);
      FB[o] = sg * wd * M.cos(F.alpha) * 0.92; FB[o + 1] = SY[fj] + b * c; FB[o + 2] = SZ[fj] + b * sn;
      // span: down by `down`, back by `back`, out by `out`; the sweep swings it forward/back about the root
      const bk = F.back + sweep;
      const ux = sg * M.sin(F.out), uy = -M.cos(bk) * M.cos(F.out), uz = -M.sin(bk) * M.cos(F.out);
      // chord axis: forward, perpendicular to span, twisted down by `twist`
      let vx = 0, vy = M.sin(-F.twist), vz = M.cos(F.twist); const d = vx * ux + vy * uy + vz * uz; vx -= d * ux; vy -= d * uy; vz -= d * uz; const vl = M.hypot(vx, vy, vz); vx /= vl; vy /= vl; vz /= vl;
      FB[o + 3] = ux * F.len; FB[o + 4] = uy * F.len; FB[o + 5] = uz * F.len; FB[o + 6] = vx; FB[o + 7] = vy; FB[o + 8] = vz;
      FB[o + 9] = uy * vz - uz * vy; FB[o + 10] = uz * vx - ux * vz; FB[o + 11] = ux * vy - uy * vx;
    }
    return w;
  }
  // slots: each is one whale in the world
  const SL = []; for (let i = 0; i < NSLOT; i++) SL.push({ on: false, pal: 'teal', scale: 1, fade: 0, t: 0, tph: 0, C: new Float64Array(3), B: new Float64Array(9), wonder: 0, riverDrop: 0, riverSide: 0, path: null, d: 0, speed: 8, enc: -1, k: 0, delay: 0, off: new Float64Array(2), parked: true, first: 0, seen: false, lod: 1, dc: 0, tl: 0 });
  let PTS = null, FIRST = 0, DYN = null, DYN_BASE = 0, enabled = Q.get('whales') !== 'off', ctime = 0, realmOff = false; // realmOff: the reality device left Space Outside (realms.js), not persisted
  try { if (!Q.has('whales') && typeof localStorage !== 'undefined' && localStorage.getItem('reef-run:whales') === 'off') enabled = false; } catch {}
  const park = (slot) => { const o0 = (FIRST + slot * CAP) * 8; for (let i = 0; i < CAP; i++) { const o = o0 + i * 8; PTS[o] = 0; PTS[o + 1] = -5000; PTS[o + 2] = 0; PTS[o + 3] = 0; PTS[o + 4] = 0; PTS[o + 5] = 0; PTS[o + 6] = 0; PTS[o + 7] = 0; } SL[slot].parked = true; };
  // ---- school emitters (module level, so posing allocates nothing): EC holds the whale's frame, RC the two orbits' tilts
  const EC = new Float64Array(17), RC = new Float64Array(8); let EO = 0, qx = 0, qy = 0, qz = 0;
  function emit(lx, ly, lz, size, r, g, b) { // whale-local point → world, with the near-camera fade
    const L = EC[16], X = EC[0] + (EC[3] * lx + EC[6] * ly + EC[9] * lz) * L, Y = EC[1] + (EC[4] * lx + EC[7] * ly + EC[10] * lz) * L, Z = EC[2] + (EC[5] * lx + EC[8] * ly + EC[11] * lz) * L;
    const dx = X - EC[12], dy = Y - EC[13], dz = Z - EC[14], dd = M.sqrt(dx * dx + dy * dy + dz * dz), k = EC[15] * (dd < 6 ? sst(1.5, 6, dd) : 1), P = PTS, o = EO;
    P[o] = X; P[o + 1] = Y; P[o + 2] = Z; P[o + 3] = size; P[o + 4] = r * k; P[o + 5] = g * k; P[o + 6] = b * k; P[o + 7] = 0; EO += 8;
  }
  // a point on a tilted elliptical orbit at phase ph, radius rad, height h (pitch about x, then roll about z) → qx, qy, qz
  function orbitAt(g, c, ph, rad, h) {
    const x0 = rad * g.Rx / g.R * M.cos(ph), z0 = rad * M.sin(ph), y1 = h * RC[c + 2] - z0 * RC[c + 3], z1 = h * RC[c + 3] + z0 * RC[c + 2];
    qx = x0 * RC[c] - y1 * RC[c + 1]; qy = x0 * RC[c + 1] + y1 * RC[c] + g.y; qz = z1 + g.z;
  }
  // write one whale's points. C: centre (world), B: basis (right 0..2, up 3..5, fwd 6..8), L in metres, eye: camera
  function write(slot, eye) {
    const W = SL[slot], tp = tpl(W.pal), sc = sch(W.pal), Cc = sc.C, L = GR.L * W.scale, t = W.t, fade = W.fade;
    const B = W.B, cx = W.C[0], cy = W.C[1], cz = W.C[2];
    const rx = B[0], ry = B[1], rz = B[2], ux = B[3], uy = B[4], uz = B[5], fx = B[6], fy = B[7], fz = B[8];
    const ex = eye[0], ey = eye[1], ez = eye[2];
    const dc = M.hypot(cx - ex, cy - ey, cz - ez);
    // the reef's haze eats warm light first (nebula fogApply: about exp(-0.0095..0.015 per m)); give distant whales some of it back
    const comp = cl(M.exp(0.0062 * M.max(0, dc - 30)), 1, 3.6) * fade;
    const w = bend(t, 1);
    // light pulse running nose to tail (WH-M2), off with reduced motion
    const pp = (t / 4.2) % 1 * 1.5 - 0.25;
    for (let j = 0; j < NS; j++) { const x = (j / (NS - 1) - pp) / 0.07; PU[j] = RM ? 1 : 1 + 0.9 * M.exp(-x * x); }
    const ft = GR.wave.fluke * M.sin(w * t - GR.wave.k - GR.wave.flukeLag); // fluke beat (extra pitch at the notch)
    const jn = NS - 1, fc = M.cos(M.atan2(SSi[jn], SCo[jn]) + ft), fs = M.sin(M.atan2(SSi[jn], SCo[jn]) + ft);
    let o = (FIRST + slot * CAP) * 8; const P = PTS, n = tp.n;
    // level of detail: the whale's length on a 1080p screen at 70° (cockpit) decides how many contour points it needs
    const px = L / M.max(1, dc) * 771, st = px > 900 ? 1 : px > 380 ? 2 : 3, sk = 1 + 0.55 * (st - 1), ck = 1 + 0.25 * (st - 1);
    W.lod = st; W.dc = dc;
    for (let i = 0; i < n; i++, o += 8) {
      if (st > 1 && tp.fam[i] <= FAM.fill && i % st) { P[o + 3] = 0; continue; } // lines, edges and shell thin out with distance
      const bone = tp.bone[i]; let lx, ly, lz, nx, ny, nz, rimOn = 1, s = tp.s[i];
      if (bone === 0 || bone === 4) {
        const j = tp.j[i], f = tp.f[i], g = 1 - f;
        const zs = SZ[j] * g + SZ[j + 1] * f, ys = SY[j] * g + SY[j + 1] * f, c = SCo[j] * g + SCo[j + 1] * f, sn = SSi[j] * g + SSi[j + 1] * f, b = tp.b[i];
        lx = tp.a[i]; ly = ys + b * c; lz = zs + b * sn;
        nx = tp.na[i]; ny = tp.nb[i] * c; nz = tp.nb[i] * sn; if (bone === 4) rimOn = 0;
      } else if (bone === 3) {
        const d = tp.d[i]; lx = tp.a[i]; ly = SY[jn] + d * fs; lz = SZ[jn] - d * fc; nx = 0; ny = fc; nz = fs;
      } else {
        const q = (bone - 1) * 12, u = tp.s[i], v = tp.a[i];
        lx = FB[q] + FB[q + 3] * u + FB[q + 6] * v; ly = FB[q + 1] + FB[q + 4] * u + FB[q + 7] * v; lz = FB[q + 2] + FB[q + 5] * u + FB[q + 8] * v;
        nx = FB[q + 9]; ny = FB[q + 10]; nz = FB[q + 11]; s = GR.fin.s + 0.15 * u;
      }
      const X = cx + (rx * lx + ux * ly + fx * lz) * L, Y = cy + (ry * lx + uy * ly + fy * lz) * L, Z = cz + (rz * lx + uz * ly + fz * lz) * L;
      let k = comp;
      const vx = X - ex, vy = Y - ey, vz = Z - ez, dd = M.sqrt(vx * vx + vy * vy + vz * vz) || 1;
      if (rimOn) {
        const wx = rx * nx + ux * ny + fx * nz, wy = ry * nx + uy * ny + fy * nz, wz = rz * nx + uz * ny + fz * nz, nd = (wx * vx + wy * vy + wz * vz) / dd;
        const fam = tp.fam[i], two = bone !== 0; // fins and flukes are thin: both faces lit
        const face = two ? 1 : nd < 0 ? 1 : 0.22, rim = 1 - M.abs(nd);
        k *= fam === 2 ? face * (0.6 + 1.6 * rim * rim * rim) : face * (0.6 + 0.5 * rim * rim);
      }
      if (dd < 6) k *= sst(1.5, 6, dd); // never a blob on the canopy
      const pj = PU[M.min(NS - 1, M.round(s * (NS - 1)))], pk = 1 + (pj - 1) * tp.pw[i];
      k *= pk;
      const lk = tp.fam[i] <= FAM.fill ? 1 : 0; // thinned families grow and brighten a little to stay continuous
      P[o] = X; P[o + 1] = Y; P[o + 2] = Z; P[o + 3] = tp.size[i] * L * (lk ? sk : 1); k *= lk ? ck : 1; P[o + 4] = tp.r[i] * k; P[o + 5] = tp.g[i] * k; P[o + 6] = tp.bl[i] * k; P[o + 7] = 0;
    }
    // ---- school, in the chord frame (not bent): ring, its lines, spiral, orbs, motes
    const ct = W.tph, shim = RM ? 0.15 : 0.45, rg = GR.ring, hx = GR.gold;
    const fishSz = 0.002 * L, dash = 0.0042, tails = st < 3;
    EC[0] = cx; EC[1] = cy; EC[2] = cz; EC[3] = rx; EC[4] = ry; EC[5] = rz; EC[6] = ux; EC[7] = uy; EC[8] = uz; EC[9] = fx; EC[10] = fy; EC[11] = fz; EC[12] = ex; EC[13] = ey; EC[14] = ez; EC[15] = comp; EC[16] = L;
    RC[0] = M.cos(rg.roll); RC[1] = M.sin(rg.roll); RC[2] = M.cos(rg.pitch); RC[3] = M.sin(rg.pitch); RC[4] = M.cos(hx.roll); RC[5] = M.sin(hx.roll); RC[6] = M.cos(hx.pitch); RC[7] = M.sin(hx.pitch);
    EO = o;
    const wr = TAUm / rg.period * (RM ? 0.5 : 1), Cp = Cc.pink, Cg = Cc.gold;
    for (let i = 0; i < rg.n; i++) {
      const q = i * 5, ph = sc.ring[q] + wr * ct * sc.ring[q + 3], rad = rg.R + sc.ring[q + 1], h = sc.ring[q + 2], sh = 1 + shim * M.sin(ct * 6 + sc.ring[q + 4]);
      orbitAt(rg, 0, ph, rad, h); emit(qx, qy, qz, fishSz, Cp[0] * sh, Cp[1] * sh, Cp[2] * sh);
      if (!tails) { P[EO + 3] = 0; P[EO + 11] = 0; EO += 16; continue; } // far: single points
      orbitAt(rg, 0, ph - dash / rad, rad, h); emit(qx, qy, qz, fishSz * 0.85, Cp[0] * sh * 0.6, Cp[1] * sh * 0.6, Cp[2] * sh * 0.6);
      orbitAt(rg, 0, ph - dash * 2 / rad, rad, h); emit(qx, qy, qz, fishSz * 0.7, Cp[0] * sh * 0.3, Cp[1] * sh * 0.3, Cp[2] * sh * 0.3); // a dash, as drawn
    }
    const Cl = Cc.ringLine, rl = sc.rline;
    for (let i = 0; i < rg.lines * sc.nl; i++) { if (st > 1 && i % st) { P[EO + 3] = 0; EO += 8; continue; } const q = i * 3, a = rl[q + 2]; orbitAt(rg, 0, rl[q] + wr * ct * 0.25, rg.R + rl[q + 1], 0); emit(qx, qy, qz, a > 0.02 ? 0.0024 * L : 0, Cl[0] * a, Cl[1] * a, Cl[2] * a); }
    const wh = TAUm / hx.gperiod * (RM ? 0.5 : 1);
    for (let i = 0; i < hx.n; i++) {
      const q = i * 5, ph = sc.hel[q] + wh * ct * sc.hel[q + 3], rad = hx.R + sc.hel[q + 1], h = sc.hel[q + 2], sh = 1 + shim * M.sin(ct * 5 + sc.hel[q + 4]);
      orbitAt(hx, 4, ph, rad, h); emit(qx, qy, qz, fishSz * 1.35, Cg[0] * sh, Cg[1] * sh, Cg[2] * sh);
      if (!tails) { P[EO + 3] = 0; EO += 8; continue; }
      orbitAt(hx, 4, ph - dash * 1.4 / rad, rad, h); emit(qx, qy, qz, fishSz * 0.8, Cg[0] * sh * 0.45, Cg[1] * sh * 0.45, Cg[2] * sh * 0.45);
    }
    const Cs = Cc.spark;
    for (let i = 0; i < GR.orbs; i++) { const q = i * 4, ph = sc.orb[q] + ct * 0.05 * sc.orb[q + 3]; emit(sc.orb[q + 1] * M.cos(ph), sc.orb[q + 2], sc.orb[q + 1] * M.sin(ph), 0.011 * L * sc.orb[q + 3], Cs[0] * 0.55, Cs[1] * 0.5, Cs[2] * 0.4); }
    for (let i = 0; i < GR.motes; i++) { const q = i * 4, ph = sc.mote[q + 3] + ct * 0.3; emit(sc.mote[q] + 0.03 * M.sin(ph), sc.mote[q + 1] + 0.03 * M.cos(ph * 0.7), sc.mote[q + 2], 0.0028 * L, Cg[0] * 0.6, Cg[1] * 0.6, Cg[2] * 0.6); }
    // river (wonder whale): a stream of gold and pink fish pouring back and down from the belly past the ship
    const rv = GR.river;
    for (let i = 0; i < rv.n; i++) {
      if (!W.wonder) { for (let tail = 0; tail < 2; tail++) { P[EO + 3] = 0; P[EO + 4] = P[EO + 5] = P[EO + 6] = 0; P[EO + 1] = -5000; EO += 8; } continue; }
      const q = i * 5, sh = 1 + shim * M.sin(ct * 6 + sc.riv[q + 4]), pinkF = sc.riv[q + 3] > 0.5, Cf = pinkF ? Cp : Cg;
      for (let tail = 0; tail < 2; tail++) {
        const u = (sc.riv[q] + ct * rv.speed / rv.len * (0.8 + 0.4 * ((i * 0.618) % 1)) - tail * 0.0035) % 1, dist = u * rv.len;
        const drop = W.riverDrop * sst(0.04, 0.4, u), side = W.riverSide * sst(0.04, 0.4, u), spread = lerp(0.02, 0.12, sst(0, 0.5, u));
        const e = sst(0, 0.05, u) * sst(1, 0.85, u) * W.wonder, k = tail ? 0.45 : 1;
        emit(side + sc.riv[q + 1] * spread, -0.1 - drop + sc.riv[q + 2] * spread * 0.6, -0.15 - dist, fishSz * (tail ? 0.8 : 1.1), Cf[0] * sh * k * e, Cf[1] * sh * k * e, Cf[2] * sh * k * e);
      }
    }
    W.parked = false;
  }

  // ---------------------------------------------------------------- Reef Run: encounters along the rail (DECOMPOSITION.md section 6, P)
  // Each encounter is framed for the ship's position sView: path control points are [ahead, right, up] metres in the rail frame at sView,
  // and the whale reaches the middle of its path as the ship (at cruise speed CRUISE) gets there; sTrig is derived from that. The wonder
  // whale (follow) swims along the rail itself, offset [right, up] by its path fraction x, and the ship passes under it at sMeet.
  // Whales never enter the corridor: every path is checked against SCENE.corridor at load and pushed away until the whole body clears it.
  const CRUISE = 14; // reefrun.js SPEED
  const ENC = [
    { sView: 140, end: 120, whales: [{ pal: 'teal', scale: 1, speed: 11, path: [[230, -130, 55], [200, -40, 45], [190, 50, 40], [210, 140, 48]] }] },              // left to right ahead and above, ~200 m
    { sView: 300, end: 80, whales: [{ pal: 'teal', scale: 1, speed: 10, path: [[140, 150, -38], [115, 60, -32], [110, -40, -30], [125, -140, -34]] },             // a mother and calf passing under the reef, right to left
                           { pal: 'teal', scale: 0.55, speed: 10, delay: 1.2, off: [9, -7], path: null }] },
    { sMeet: 505, end: 115, wonder: true, whales: [{ pal: 'teal', scale: 1.05, speed: 7.5, follow: { gap: 210, len: 330, dir: -1, right: [[0, 14], [0.22, -6], [0.5, -40], [1, -120]], up: [[0, 38], [0.22, 24], [0.42, 40], [1, 120]] } }] }, // WONDER: head-on, over the ship, fish river
    { sView: 575, end: 120, whales: [{ pal: 'pink', scale: 0.9, speed: 9, path: [[40, 80, 15], [110, 85, 22], [180, 95, 30], [260, 140, 60]] },                  // the rare pink (SW-5.0) treat, alongside right
                           { pal: 'teal', scale: 1, speed: 9, delay: 2, off: [-14, 10], path: null }] },
    { sView: 705, end: 60, minTrig: 622, whales: [{ pal: 'teal', scale: 1.2, speed: 9, path: [[260, 130, 120], [250, 40, 130], [255, -50, 125], [275, -140, 110]] }] }, // a last giant crossing high over the gate
  ];
  let rail = null, corridor = null, railLen = 0, sStart = 0;
  const encT = new Float64Array(ENC.length).fill(-1); // time since each encounter began (-1: not yet)
  const FR9 = new Float64Array(9), TP = [0, 0, 0], TP2 = [0, 0, 0];
  function frameAt(s, o) { // rail frame (forward, right, up) at s, smoothed like reefrun's railFrame
    rail.at(M.min(s + 4, railLen), TP); rail.at(M.max(s - 2, 0), TP2);
    let fx = TP[0] - TP2[0], fy = TP[1] - TP2[1], fz = TP[2] - TP2[2]; const l = M.hypot(fx, fy, fz) || 1; fx /= l; fy /= l; fz /= l;
    let rx = fz, rz = -fx; const rl = M.hypot(rx, rz) || 1; rx /= rl; rz /= rl;
    o[0] = fx; o[1] = fy; o[2] = fz; o[3] = rx; o[4] = 0; o[5] = rz; o[6] = fy * rz; o[7] = fz * rx - fx * rz; o[8] = -fy * rx; return o;
  }
  // whale clears the corridor: its body (centre ± L/2 along the tangent) with a radius covering the fins
  function pathClear(p, L) {
    if (!corridor) return true;
    const q = [0, 0, 0], tq = [0, 0, 0];
    for (let d = 0; d <= p.len; d += 3) {
      p.at(d, q); p.tan(d, tq);
      for (let k = -4; k <= 4; k++) { const a = k / 8 * L; if (corridor(q[0] + tq[0] * a, q[1] + tq[1] * a, q[2] + tq[2] * a, 0.3 * L + 2)) return false; }
    }
    return true;
  }
  function buildPaths() {
    for (const e of ENC) {
      const sRef = e.wonder ? e.sMeet : e.sView;
      frameAt(sRef, FR9); const o = [0, 0, 0]; rail.at(sRef, o);
      for (const w of e.whales) {
        const L = GR.L * w.scale; let tries = 0;
        if (w.follow) {
          // the whale starts gap m ahead of the meeting point's rail position minus its own travel; the ship closes at CRUISE - speed
          const f = w.follow, dir = f.dir || 1, tm = f.gap / (CRUISE - dir * w.speed), s0 = e.sMeet - dir * tm * w.speed, pts = [], q = [0, 0, 0], fr = new Float64Array(9);
          e.sTrig = e.sMeet - tm * CRUISE; e.d0 = 0; e.sEnd = e.sMeet + e.end;
          const at = (tab, x) => { for (let i = 1; i < tab.length; i++) if (x <= tab[i][0]) return lerp(tab[i - 1][1], tab[i][1], sst(tab[i - 1][0], tab[i][0], x)); return tab[tab.length - 1][1]; };
          for (; tries < 40; tries++) {
            pts.length = 0; const lift = tries * 2;
            for (let x = 0; x <= 1.0001; x += 0.04) { const sg = cl(s0 + dir * x * f.len, 0, railLen); rail.at(sg, q); frameAt(sg, fr); const rt = at(f.right, x), up = at(f.up, x) + lift; pts.push([q[0] + fr[3] * rt + fr[6] * up, q[1] + fr[4] * rt + fr[7] * up, q[2] + fr[5] * rt + fr[8] * up]); }
            w.p = makeRail(pts, 1); if (pathClear(w.p, L)) break;
          }
        } else {
          const src = w.path || e.whales[0].path, off = w.off || [0, 0];
          for (; tries < 40; tries++) {
            const push = tries * 4, pts = src.map(([a, r, u]) => { const rr = r + off[0] + M.sign(r || 1) * push, uu = u + off[1] + push * 0.5; return [o[0] + FR9[0] * a + FR9[3] * rr + FR9[6] * uu, o[1] + FR9[1] * a + FR9[4] * rr + FR9[7] * uu, o[2] + FR9[2] * a + FR9[5] * rr + FR9[8] * uu]; });
            w.p = makeRail(pts, 1); if (pathClear(w.p, L)) break;
          }
          if (w === e.whales[0]) { const ideal = e.sView - CRUISE * (w.p.len / 2) / w.speed; e.sTrig = M.max(sStart + 20, e.minTrig || 0, ideal); e.d0 = (e.sTrig - ideal) / CRUISE * w.speed; e.sEnd = e.sView + e.end; }
        }
        w.pushed = tries; w.clear = pathClear(w.p, L);
      }
    }
  }
  function slotFor(ei, k) { for (let i = 0; i < NSLOT; i++) if (SL[i].on && SL[i].enc === ei && SL[i].k === k) return i; for (let i = 0; i < NSLOT; i++) if (!SL[i].on) return i; return -1; }
  const PQ = [0, 0, 0], PT = [0, 0, 0];
  // orient a slot along its path tangent (B: right, up, fwd), with a little bank into turns
  function orient(W, tx, ty, tz, bank) {
    const l = M.hypot(tx, ty, tz) || 1; tx /= l; ty /= l; tz /= l;
    let rxx = tz, ryy = 0, rzz = -tx; const rl = M.hypot(rxx, rzz) || 1; rxx /= rl; rzz /= rl; // right = up × fwd (left-handed engine)
    let uxx = ty * rzz - tz * ryy, uyy = tz * rxx - tx * rzz, uzz = tx * ryy - ty * rxx; // up = fwd × right
    const cb = M.cos(bank), sb = M.sin(bank), B = W.B;
    B[0] = rxx * cb + uxx * sb; B[1] = ryy * cb + uyy * sb; B[2] = rzz * cb + uzz * sb;
    B[3] = uxx * cb - rxx * sb; B[4] = uyy * cb - ryy * sb; B[5] = uzz * cb - rzz * sb;
    B[6] = tx; B[7] = ty; B[8] = tz;
  }
  // ---- engine-facing API
  let lastNeed = 0;
  function trim() { // upload only up to the last slot in use (plus one frame to clear a slot that just left)
    if (!DYN) return; let need = 0; for (let i = 0; i < NSLOT; i++) if (!SL[i].parked) need = i + 1;
    DYN[1] = DYN_BASE + M.max(need, lastNeed) * CAP; lastNeed = need;
  }
  let msAcc = 0, msN = 0, msAvg = 0, msMax = 0;
  function stepGame(dt, s, eye, live) {
    if (!PTS || !rail) return;
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    ctime += dt;
    for (let i = 0; i < NSLOT; i++) SL[i].seen = false;
    if (enabled && !realmOff && live) for (let ei = 0; ei < ENC.length; ei++) {
      const e = ENC[ei];
      if (encT[ei] < 0) { if (s >= e.sTrig && s < e.sEnd - 40) encT[ei] = 0; else continue; }
      if (s > e.sEnd) continue; // passed: the slot fades and frees
      encT[ei] += dt;
      for (let k = 0; k < e.whales.length; k++) {
        const w = e.whales[k], tl = encT[ei] - (w.delay || 0); if (tl < 0) continue;
        const d = e.d0 + tl * w.speed; if (d > w.p.len) continue;
        const si = slotFor(ei, k); if (si < 0) continue;
        const W = SL[si];
        if (!W.on) { W.on = true; W.enc = ei; W.k = k; W.pal = w.pal; W.scale = w.scale; W.wonder = e.wonder ? 1 : 0; W.tph = RR(0, 40); }
        W.seen = true; W.t = tl + 3.7 * ei + k * 1.3; W.tl = tl;
        W.tph += dt;
        w.p.at(d, PQ); w.p.tan(d, PT); w.p.tan(M.min(d + 6, w.p.len), TP);
        W.C[0] = PQ[0]; W.C[1] = PQ[1]; W.C[2] = PQ[2];
        const turn = (PT[0] * TP[2] - PT[2] * TP[0]); orient(W, PT[0], PT[1], PT[2], cl(-turn * 2.5, -0.35, 0.35));
        W.fade = sst(0, 3, tl) * sst(w.p.len, w.p.len - 3 * w.speed, d) * sst(e.sEnd, e.sEnd - 40, s);
        if (W.wonder) { // the river drops from the whale to just beside the rail behind it
          rail.at(M.max(0, s), TP2); const hy = (W.C[0] - eye[0]) * W.B[3] + (W.C[1] - eye[1]) * W.B[4] + (W.C[2] - eye[2]) * W.B[5];
          const hx = (W.C[0] - eye[0]) * W.B[0] + (W.C[1] - eye[1]) * W.B[1] + (W.C[2] - eye[2]) * W.B[2];
          const L = GR.L * W.scale; W.riverDrop += (cl(hy / L - 0.12, 0, 1.2) - W.riverDrop) * M.min(1, dt * 0.5 + (W.riverDrop === 0 ? 1 : 0)); W.riverSide += ((-hx + 4.5) / L - W.riverSide) * M.min(1, dt * 0.5 + (W.riverSide === 0 ? 1 : 0));
          W.wonder = sst(0, 4, tl) * sst(w.p.len, w.p.len - 60, d);
        }
      }
    }
    for (let i = 0; i < NSLOT; i++) {
      const W = SL[i];
      if (W.on && !W.seen) { W.on = false; W.enc = -1; W.riverDrop = W.riverSide = 0; }
      if (W.on && W.fade > 0) write(i, eye); else if (!W.parked) park(i);
    }
    trim();
    if (t0) { const ms = performance.now() - t0; msAcc += ms; msMax = M.max(msMax, ms); if (++msN === 60) { msAvg = msAcc / 60; msAcc = 0; msN = 0; } }
  }
  // the lab's whale axes in camera space (right, up, forward): nose toward screen left, turned by yaw (nose toward the camera),
  // pitched (nose up), rolled (back toward the camera). Shared with tools/fit-whale.mjs so the fitted pose is the rendered pose.
  function camBasis(yaw, pitch, roll) {
    const fwd = [-M.cos(yaw) * M.cos(pitch), M.sin(pitch), -M.sin(yaw) * M.cos(pitch)];
    let up = [0, 1, 0]; const d = fwd[1]; up = up.map((v, i) => v - d * fwd[i]); const ul = M.hypot(...up); up = up.map((v) => v / ul);
    const rt = [up[1] * fwd[2] - up[2] * fwd[1], up[2] * fwd[0] - up[0] * fwd[2], up[0] * fwd[1] - up[1] * fwd[0]];
    const c = M.cos(roll), s = M.sin(roll);
    return [rt.map((v, i) => v * c + up[i] * s), up.map((v, i) => v * c - rt[i] * s), fwd];
  }
  const API = {
    camBasis, tpl, setRest,
    GR, PAL, CAP, NSLOT, ENC,
    get count() { return CAP * NSLOT; },
    get enabled() { return enabled; },
    get realmOff() { return realmOff; }, set realmOff(v) { realmOff = !!v; },
    get reducedMotion() { return RM; }, set reducedMotion(v) { RM = !!v; },
    // Reef Run (reefrun.js init): P is the game's point array; first the index of the first point reserved for whales
    init(G, P, first, o) {
      PTS = P; FIRST = first; DYN = G.dynPts; DYN_BASE = first - DYN[0]; rail = o.rail; corridor = o.corridor || null; railLen = rail.len; sStart = o.sHero || 0;
      for (let i = 0; i < NSLOT; i++) park(i); trim();
      for (const e of ENC) for (const w of e.whales) { tpl(w.pal); sch(w.pal); } // no first-sight hitch
      buildPaths();
      if (Q.has('debug') && typeof window !== 'undefined') window.reefWhales = API; // tests: state, ENC, encounterAt
    },
    reset() { encT.fill(-1); for (let i = 0; i < NSLOT; i++) { SL[i].on = false; SL[i].enc = -1; SL[i].riverDrop = SL[i].riverSide = 0; } },
    frame(dt, s, eye, live) { stepGame(dt, s, eye, live); },
    command(a) {
      if (a[1] === 'on' || a[1] === 'off' || a[1] === 'toggle' || !a[1]) {
        enabled = a[1] === 'on' ? true : a[1] === 'off' ? false : !enabled;
        try { localStorage.setItem('reef-run:whales', enabled ? 'on' : 'off'); } catch {}
        return 'whales ' + (enabled ? 'on: neon space whales and their fish schools swim through the reef (SW-5.3)' : 'off');
      }
      if (a[1] === 'reduced') { RM = !RM; return 'whale reduced motion ' + (RM ? 'on' : 'off'); }
      return 'whales on|off|toggle';
    },
    help: '\n  whales on|off|toggle          the neon space whales (also ?whales=off)',
    // debug: encounter state and path checks
    get state() { return { ms: +msAvg.toFixed(2), msMax: +msMax.toFixed(2), enabled, reduced: RM, slots: SL.map((w) => ({ lod: w.lod, dc: +(w.dc || 0).toFixed(1), tl: +(w.tl || 0).toFixed(2), on: w.on, enc: w.enc, pal: w.pal, fade: +w.fade.toFixed(2), C: Array.from(w.C, (v) => +v.toFixed(1)), wonder: +w.wonder.toFixed(2) })), enc: Array.from(encT), dyn: DYN && DYN[1], paths: ENC.map((e) => ({ sTrig: +e.sTrig.toFixed(0), whales: e.whales.map((w) => ({ len: w.p && +w.p.len.toFixed(0), pushed: w.pushed, clear: w.clear })) })) }; },
    // where encounter ei's whale k is when the ship is at rail distance s (cruise speed sp): for tests and shots
    encounterAt(ei, k, t) { const w = ENC[ei].whales[k], q = [0, 0, 0]; w.p.at(M.max(0, t - (w.delay || 0)) * w.speed, q); return q; },
    // ---------------------------------------------------------------- whale lab (whale-lab.html): one whale at the concept's framing
    // ?pal=teal|pink|violet, ?t= swim time (with ?shot=0 it is the frame time), ?school=off, ?yaw= ?pitch= ?dist= overrides
    lab(SC) {
      const build = SC.build.bind(SC);
      SC.build = () => {
        const G = build(), base = G.points.length / 8, P = new Float32Array(G.points.length + CAP * 8); P.set(G.points);
        G.points = P; PTS = P; FIRST = base; DYN = G.dynPts = [base, CAP]; DYN_BASE = 0; park(0);
        const W = SL[0], cam = Q.has('cam') ? Q.get('cam').split(',').map(Number) : WLAB.cam, pal = Q.get('pal') || 'teal'; W.on = true; W.pal = PAL[pal] ? pal : 'teal'; W.scale = 1; W.fade = 1;
        const dist = +(Q.get('dist') || WLAB.dist), yaw = (Q.has('yaw') ? +Q.get('yaw') : WLAB.yaw) * DEG, pitch = (Q.has('pitch') ? +Q.get('pitch') : WLAB.pitch) * DEG, roll = (Q.has('roll') ? +Q.get('roll') : WLAB.roll) * DEG;
        // camera basis (engine): f = (sy cp, sp, cy cp), r = (cy, 0, -sy), u = (-sp sy, cp, -sp cy)
        const cy0 = M.cos(cam[3]), sy0 = M.sin(cam[3]), cp0 = M.cos(cam[4]), sp0 = M.sin(cam[4]);
        const cf = [sy0 * cp0, sp0, cy0 * cp0], cr = [cy0, 0, -sy0], cu = [-sp0 * sy0, cp0, -sp0 * cy0];
        const off = WLAB.off; // whale centre in camera space: [right, up, forward]·dist
        for (let c = 0; c < 3; c++) W.C[c] = cam[c] + (cr[c] * off[0] + cu[c] * off[1] + cf[c] * off[2]) * dist;
        const cb = camBasis(yaw, pitch, roll), toW = (v) => [0, 1, 2].map((c) => cr[c] * v[0] + cu[c] * v[1] + cf[c] * v[2]);
        const R3 = toW(cb[0]), U3 = toW(cb[1]), F3 = toW(cb[2]);
        for (let c = 0; c < 3; c++) { W.B[c] = R3[c]; W.B[3 + c] = U3[c]; W.B[6 + c] = F3[c]; }
        const school = Q.get('school') !== 'off' && Q.get('whale') !== 'off', t0 = +(Q.get('t') || WLAB.t);
        const eye = [cam[0], cam[1], cam[2]];
        G.poses = [[cam[0], cam[1], cam[2], cam[3], cam[4], WLAB.fov * DEG]].concat(G.poses.slice(1));
        G.update = (F, dt) => {
          F[0] = cam[0]; F[1] = cam[1]; F[2] = cam[2]; F[3] = cam[3]; F[4] = cam[4]; F[11] = WLAB.fov * DEG;
          W.t = t0 + (SHOT ? 0 : F[8]); W.tph = W.t; write(0, eye);
          if (!school) for (let i = tpl(W.pal).n; i < CAP; i++) PTS[(FIRST + i) * 8 + 3] = 0;
          if (Q.get('school') === 'only') for (let i = 0; i < tpl(W.pal).n; i++) PTS[(FIRST + i) * 8 + 3] = 0;
          if (Q.get('whale') === 'off') for (let i = 0; i < CAP; i++) PTS[(FIRST + i) * 8 + 3] = 0;
        };
        window.whaleLab = { W, GR, PAL, WLAB, get reduced() { return RM; }, set reduced(v) { RM = !!v; } };
        return G;
      };
    },
    // node fitting harness (tools/fit-whale.mjs): rest/bent model landmarks in whale-local units at swim time t
    landmarks(t) {
      bend(t, 1);
      const sp = (s) => { const f = s * (NS - 1), j = M.min(NS - 2, f | 0), g = f - j; return [0, SY[j] + (SY[j + 1] - SY[j]) * g, SZ[j] + (SZ[j + 1] - SZ[j]) * g, SCo[j], SSi[j]]; };
      const surfAt = (s, al) => { const p = sp(s), h = halfD(s), w = halfW(s), b = h * M.sin(al); return [w * M.cos(al), p[1] + b * p[3], p[2] + b * p[4]]; };
      const finTip = (side) => { const o = side * 12; return [FB[o] + FB[o + 3], FB[o + 1] + FB[o + 4], FB[o + 2] + FB[o + 5]]; };
      const jn = NS - 1, w = TAUm * GR.wave.hz, ft = GR.wave.fluke * M.sin(w * t - GR.wave.k - GR.wave.flukeLag), th = M.atan2(SSi[jn], SCo[jn]) + ft;
      const fl = (side) => { const d = GR.fluke.sweep + 0.012 - 0.03; return [side * GR.fluke.span, SY[jn] + d * M.sin(th), SZ[jn] - d * M.cos(th)]; };
      const d = GR.dorsal;
      return { snout: surfAt(0, 0), notch: [0, SY[jn], SZ[jn]], eye: surfAt(GR.eye.s, GR.eye.alpha), finRoot: [FB[0], FB[1], FB[2]], finTipR: finTip(0), finTipL: finTip(1), flukeR: fl(1), flukeL: fl(-1),
        dorsal: (() => { const s = lerp(d.s0, d.s1, 0.62), p = sp(s), h = halfD(s) + d.h * 0.92; return [0, p[1] + h * p[3], p[2] + h * p[4]]; })(),
        top: (s) => surfAt(s, PIm / 2), bottom: (s) => surfAt(s, -PIm / 2), surf: surfAt, spine: sp };
    },
  };
  return API;
})();
// the lab's concept framing (whale-lab.html; fitted by tools/fit-whale.mjs against SW-5.3's landmarks, DECOMPOSITION.md section 5)
const WLAB = { cam: [-20, 10, -10, -1.6, 0.05], fov: 52.67, dist: 1, off: [-0.23, 4.27, 24.80], yaw: 3.47, pitch: 1.27, roll: 19.31, t: -1.149 };
if (typeof module !== 'undefined') module.exports = { WHALES, WLAB };
