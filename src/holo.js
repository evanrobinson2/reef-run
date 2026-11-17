// ============================================================================
// holo.js: the ship's-computer route projection for Reef Run (GAME_API.md "Holo route").
// carpetshark, 2026-11-16: "and your "rail" should instead be an animated 3 dimensional holographic overlay -> ship's computer showing
// our projected route". It replaces the dotted ghost rail while the HUD 'rail' layer is on ('rail classic' brings the dots back).
//   - In world space along the rail, the next CFG.range m: a floor ribbon (two edges, rungs every CFG.rung m), chevrons that
//     flow forward, range frames (dashed hexagons the ship flies through) at 50/100/150/200 m with their distance, and the
//     Ring Gate (the end of the run) as a turning hologram ring with a finish bar and its distance.
//   - Drawn by the engine's glow lines (G.lines, engine.js): HDR and additive, so it blooms a little; depth-tested, so rocks
//     hide it, and ghosted through them at CFG.ghost; faded in near the ship and out with distance.
//   - Animated: the HUD boot plots it outward from the ship, and every CFG.sweepEvery s the computer re-plots it (a bright front
//     runs out and redraws it); scanline shimmer, a slight flicker. Reduced motion: no flicker and no sweep (the boot fades it
//     in), the chevrons hold still on the rail, the scanlines stay put.
//   - Colour: the HUD palette's goal accent (--a), or its HUD colour (--h) when the accent is warm, so it stays cool and holographic.
//   - A small NAV panel left of the radar: an isometric wireframe of the next CFG.nav m from above and behind, turning gently,
//     with the ship as a triangle (one player; with the 'minimap' layer).
// Frame 0 stays pixel-identical: until the HUD powers on the classic ghost rail shows exactly as before and nothing of this is
// drawn; as the HUD boots the dots fade while the projection plots in. Split screen: the lines draw in every viewport (the
// engine does that) and the labels are drawn per viewport. No per-frame allocation (strings are prebuilt).
// ============================================================================
const HOLO = (() => {
  const CFG = {
    range: 240, step: 2,          // projected route: metres ahead, sample spacing (m)
    near0: 7, near1: 22,          // fades in between these distances from the ship (so it never fills the screen)
    far0: 150,                    // fades out from here to `range`
    hw: 2.0, floor: -2.0,         // floor ribbon: half-width and height (m) relative to the rail (the ship flies the rail)
    rung: 7, chev: 12, chevRate: 18, // rung spacing (m, fixed on the rail), chevron spacing (m) and flow speed (m/s)
    ticks: [50, 100, 150, 200], hexR: 3.4, // range frames: distances ahead (m) and hexagon radius
    width: 0.045, minPx: 1.0,     // line half-width (m) and minimum half-width (px)
    navLeft: true,                  // NAV panel: left column (true) or bottom centre left of the radar (false)
    sweepEvery: 7, sweepSpeed: 200, // re-plot: period (s), front speed (m/s)
    gateR: 5.5, gateRange: 520,   // Ring Gate hologram: ring radius (m), shown within this many m
    gain: 2.2, ghost: 0.2, scan: 0.18, fill: 0.07, // brightness (HDR), through-rock ghosting, scanline depth
    nav: 400,                     // NAV panel: metres of route shown
  };
  const NS = CFG.range / CFG.step + 1, CAP = 900;
  const SA = new Float64Array(NS * 12); // per sample: position, forward, right, up
  const Q = new Float64Array(12), T0 = new Float64Array(3), T1 = new Float64Array(3);
  const C = new Float64Array(3), CW = new Float64Array(3); // route colour (linear, max channel 1) and a whiter tint
  const ANC = new Float64Array(8 * 5), LP = new Float64Array(16); // label anchors: x, y, z, alpha, string index; their screen spots
  const NV = new Float64Array(41 * 3); // NAV: route in the ship's frame
  const DIST = []; for (let d = 0; d <= 1200; d++) DIST.push(d + ' m'); // prebuilt labels
  const TICKL = CFG.ticks.map((d) => d + ' m');
  const REDUCED = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let hs = 0x9e3779b9; const hr = () => { hs = (Math.imul(hs, 1664525) + 1013904223) >>> 0; return hs / 4294967296; }; // own stream: the game's rnd() stays untouched
  let mode = 'holo';
  try { if (localStorage.getItem('reef-run:rail') === 'classic') mode = 'classic'; } catch {}
  if (typeof QS !== 'undefined' && (QS.get('rail') === 'classic' || QS.get('rail') === 'holo')) mode = QS.get('rail');
  let SC = null, G = null, shell = null, rail = null, sGate = 0, len = 0, gate = null, gateN = null, L = null;
  let t = -1, tPrev = -1, sweepT = 0, flick = 1, flickT = 0, na = 0, plot = 0, vis = 0, wrapped = false;
  let navX = 0, navY = 0, navK = 0, navCX = 0, navCY = 0, navDt = 0, cv = null, cx = null, nav = null, nx = null, palKey = '', colHex = '#7fe4ff', fnt = '', fntS = '', fntL = '', K = 1, cvShown = false;

  // ---------------------------------------------------------------- set-up (load time)
  function prepare(SC_) { SC = SC_; }
  function init(G_, shell_, o) {
    G = G_; shell = shell_; rail = o.rail; sGate = o.sGate; len = o.rail.len; gate = o.gate; gateN = o.gateN;
    if (typeof QS !== 'undefined' && QS.has('debug')) window.reefHolo = HOLO; // test hook: reefHolo.state, .cfg, .command(['rail', 'classic'])
    L = G.lines = { data: new Float32Array(CAP * 16), n: 0, ghost: CFG.ghost, scan: CFG.scan, scanRate: REDUCED ? 0 : 1 };
    if (typeof document === 'undefined') return;
    const st = document.createElement('style');
    st.textContent = '#rrholo,#rrnav{position:fixed;left:0;top:0;pointer-events:none;z-index:5;display:none}#rrholo{width:100%;height:100%}';
    document.head.appendChild(st);
    cv = document.createElement('canvas'); cv.id = 'rrholo'; document.body.appendChild(cv); cx = cv.getContext('2d');
    nav = document.createElement('canvas'); nav.id = 'rrnav'; document.body.appendChild(nav); nx = nav.getContext('2d');
  }

  // ---------------------------------------------------------------- rail sampling
  function frameAt(s, o, k) { // position + smooth frame (forward from a chord, horizontal right, up = forward × right), as reefrun's railFrame
    rail.at(s, T0); o[k] = T0[0]; o[k + 1] = T0[1]; o[k + 2] = T0[2];
    rail.at(min(s + 4, len), T0); rail.at(max(s - 2, 0), T1);
    let fx = T0[0] - T1[0], fy = T0[1] - T1[1], fz = T0[2] - T1[2]; const l = hypot(fx, fy, fz) || 1; fx /= l; fy /= l; fz /= l;
    let rx = fz, rz = -fx; const rl = hypot(rx, rz) || 1; rx /= rl; rz /= rl;
    o[k + 3] = fx; o[k + 4] = fy; o[k + 5] = fz; o[k + 6] = rx; o[k + 7] = 0; o[k + 8] = rz; o[k + 9] = fy * rz; o[k + 10] = fz * rx - fx * rz; o[k + 11] = -fy * rx;
  }
  function at(d, o) { // interpolated sample d m ahead (0..range)
    const f = clamp(d / CFG.step, 0, NS - 1.001), k = floor(f), u = f - k, a = k * 12, b = a + 12;
    for (let c = 0; c < 12; c++) o[c] = SA[a + c] + (SA[b + c] - SA[a + c]) * u;
    return o;
  }

  // ---------------------------------------------------------------- segments
  let n = 0, front = 1e9, boot = false, dEnd = 0;
  function inten(d) { // brightness by distance ahead: near and far fades, the plot front, the flicker
    let i = sstep(CFG.near0, CFG.near1, d) * (1 - sstep(CFG.far0, CFG.range, d)) * flick * vis;
    if (d > front) i *= boot ? 0 : 0.3;
    else if (front < 1e8) i *= 1 + 2.4 * exp(-((d - front) * (d - front)) / 30); // the re-plot front glows
    return i;
  }
  function seg(ax, ay, az, bx, by, bz, ia, ib, gain, white, w = CFG.width, fill = 0) {
    if (n >= CAP || (ia <= 0.004 && ib <= 0.004)) return;
    const D = L.data, o = n * 16, g = gain * CFG.gain;
    const r = C[0] + (CW[0] - C[0]) * white, gg = C[1] + (CW[1] - C[1]) * white, b = C[2] + (CW[2] - C[2]) * white;
    D[o] = ax; D[o + 1] = ay; D[o + 2] = az; D[o + 3] = w; D[o + 4] = bx; D[o + 5] = by; D[o + 6] = bz; D[o + 7] = w;
    D[o + 8] = r * ia * g; D[o + 9] = gg * ia * g; D[o + 10] = b * ia * g; D[o + 11] = CFG.minPx;
    D[o + 12] = r * ib * g; D[o + 13] = gg * ib * g; D[o + 14] = b * ib * g; D[o + 15] = fill;
    n++;
  }
  // a point in the local frame q (at distance d): x right, y up, z forward (m)
  const lx = (q, x, y, z) => q[0] + q[6] * x + q[9] * y + q[3] * z, ly = (q, x, y, z) => q[1] + q[7] * x + q[10] * y + q[4] * z, lz = (q, x, y, z) => q[2] + q[8] * x + q[11] * y + q[5] * z;
  function anchor(x, y, z, a, si) { if (na >= 8 || a < 0.03) return; const o = na * 5; ANC[o] = x; ANC[o + 1] = y; ANC[o + 2] = z; ANC[o + 3] = a; ANC[o + 4] = si; na++; }

  function build(s) {
    dEnd = min(CFG.range, sGate - s, len - s);
    if (dEnd <= CFG.near0) return;
    const ns = min(NS - 1, Math.ceil(dEnd / CFG.step));
    for (let k = 0; k <= ns; k++) frameAt(s + k * CFG.step, SA, k * 12);
    const H = CFG.hw, Y = CFG.floor;
    // floor edges
    for (let k = 0; k < ns; k++) {
      const d0 = k * CFG.step, d1 = min(dEnd, d0 + CFG.step), i0 = inten(d0), i1 = inten(d1); if (i0 + i1 <= 0.01) continue;
      const a = k * 12, b = a + 12;
      seg(SA[a] + SA[a + 9] * Y, SA[a + 1] + SA[a + 10] * Y, SA[a + 2] + SA[a + 11] * Y, SA[b] + SA[b + 9] * Y, SA[b + 1] + SA[b + 10] * Y, SA[b + 2] + SA[b + 11] * Y, i0 * CFG.fill * (1 - sstep(35, 80, d0)), i1 * CFG.fill * (1 - sstep(35, 80, d1)), 1, 0, H, 1); // translucent floor (near only: far away it stacks up edge-on)
      for (let side = -1; side <= 1; side += 2) {
        const x = side * H;
        seg(SA[a] + SA[a + 6] * x + SA[a + 9] * Y, SA[a + 1] + SA[a + 7] * x + SA[a + 10] * Y, SA[a + 2] + SA[a + 8] * x + SA[a + 11] * Y,
          SA[b] + SA[b + 6] * x + SA[b + 9] * Y, SA[b + 1] + SA[b + 7] * x + SA[b + 10] * Y, SA[b + 2] + SA[b + 8] * x + SA[b + 11] * Y, i0, i1, 1, 0);
      }
    }
    // rungs, fixed on the rail (they stream past as the ship flies)
    for (let w = Math.ceil((s + CFG.near0) / CFG.rung) * CFG.rung; w - s < dEnd; w += CFG.rung) {
      const d = w - s, i = inten(d) * 0.4; at(d, Q);
      seg(lx(Q, -H, Y, 0), ly(Q, -H, Y, 0), lz(Q, -H, Y, 0), lx(Q, H, Y, 0), ly(Q, H, Y, 0), lz(Q, H, Y, 0), i, i, 1, 0);
    }
    // chevrons flowing forward (reduced motion: they stay where they are on the rail)
    const ph = REDUCED ? 0 : (t * CFG.chevRate) % CFG.chev;
    for (let w = Math.ceil((s + CFG.near0 - ph) / CFG.chev) * CFG.chev + ph; w - s < dEnd - 1; w += CFG.chev) {
      const d = w - s, i = inten(d) * 1.5; at(d, Q); const y = Y + 0.02;
      const tx = lx(Q, 0, y, 1.1), ty = ly(Q, 0, y, 1.1), tz = lz(Q, 0, y, 1.1);
      seg(lx(Q, -1.3, y, -0.5), ly(Q, -1.3, y, -0.5), lz(Q, -1.3, y, -0.5), tx, ty, tz, i * 0.45, i, 1, 0.3, 0.06);
      seg(tx, ty, tz, lx(Q, 1.3, y, -0.5), ly(Q, 1.3, y, -0.5), lz(Q, 1.3, y, -0.5), i, i * 0.45, 1, 0.3, 0.06);
    }
    // range frames: dashed hexagons around the rail at fixed distances ahead, with their distance
    const R = CFG.hexR;
    for (let j = 0; j < CFG.ticks.length; j++) {
      const d = CFG.ticks[j]; if (d >= dEnd) break;
      const i = inten(d) * 0.9; if (i <= 0.01) continue; at(d, Q);
      for (let e = 0; e < 6; e++) {
        const a0 = e * TAU / 6, a1 = a0 + TAU / 6, x0 = cos(a0) * R, y0 = sin(a0) * R, x1 = cos(a1) * R, y1 = sin(a1) * R;
        const p = 0.16, qx0 = x0 + (x1 - x0) * p, qy0 = y0 + (y1 - y0) * p, qx1 = x1 + (x0 - x1) * p, qy1 = y1 + (y0 - y1) * p;
        seg(lx(Q, qx0, qy0, 0), ly(Q, qx0, qy0, 0), lz(Q, qx0, qy0, 0), lx(Q, qx1, qy1, 0), ly(Q, qx1, qy1, 0), lz(Q, qx1, qy1, 0), i, i, 1, 0.1);
      }
      seg(lx(Q, R, 0, 0), ly(Q, R, 0, 0), lz(Q, R, 0, 0), lx(Q, R + 0.8, 0, 0), ly(Q, R + 0.8, 0, 0), lz(Q, R + 0.8, 0, 0), i, i, 1.4, 0.3); // label tick
      anchor(lx(Q, R + 1.0, 0, 0), ly(Q, R + 1.0, 0, 0), lz(Q, R + 1.0, 0, 0), i, -1 - j);
    }
    // the re-plot front: a bright bar across the floor where the computer is drawing
    if (front < dEnd && front > CFG.near0) { const i = inten(front) * 0.9; at(front, Q); seg(lx(Q, -H - 0.4, Y, 0), ly(Q, -H - 0.4, Y, 0), lz(Q, -H - 0.4, Y, 0), lx(Q, H + 0.4, Y, 0), ly(Q, H + 0.4, Y, 0), lz(Q, H + 0.4, Y, 0), i, i, 1.2, 0.5); }
  }
  // the Ring Gate (the end of the run): a hologram ring at the gate, turning, with a finish bar on the route's floor
  function buildGate(s) {
    const dg = sGate - s; if (dg < 2 || dg > CFG.gateRange) return;
    let i = sstep(6, 20, dg) * (1 - sstep(CFG.gateRange - 140, CFG.gateRange, dg)) * flick * vis;
    if (dg > front) i *= boot ? 0 : 0.3; if (i <= 0.01) return;
    frameAt(sGate, Q, 0); // gate frame (its normal is the rail forward there)
    const R = CFG.gateR, rot = REDUCED ? 0.4 : t * 0.5;
    for (let k = 0; k < 40; k++) { if (k % 10 === 9) continue; // four arcs
      const a0 = rot + k * TAU / 40, a1 = a0 + TAU / 40;
      seg(lx(Q, cos(a0) * R, sin(a0) * R, 0), ly(Q, cos(a0) * R, sin(a0) * R, 0), lz(Q, cos(a0) * R, sin(a0) * R, 0), lx(Q, cos(a1) * R, sin(a1) * R, 0), ly(Q, cos(a1) * R, sin(a1) * R, 0), lz(Q, cos(a1) * R, sin(a1) * R, 0), i, i, 2.0, 0.35, 0.06);
    }
    const r2 = R * 0.78;
    for (let k = 0; k < 24; k += 2) { const a0 = -rot * 1.6 + k * TAU / 24, a1 = a0 + TAU / 24;
      seg(lx(Q, cos(a0) * r2, sin(a0) * r2, 0), ly(Q, cos(a0) * r2, sin(a0) * r2, 0), lz(Q, cos(a0) * r2, sin(a0) * r2, 0), lx(Q, cos(a1) * r2, sin(a1) * r2, 0), ly(Q, cos(a1) * r2, sin(a1) * r2, 0), lz(Q, cos(a1) * r2, sin(a1) * r2, 0), i * 0.7, i * 0.7, 1.4, 0.2); }
    for (let k = 0; k < 4; k++) { const a = rot + k * TAU / 4 + TAU / 80, c = cos(a), sn = sin(a); // ticks pointing in
      seg(lx(Q, c * R * 1.12, sn * R * 1.12, 0), ly(Q, c * R * 1.12, sn * R * 1.12, 0), lz(Q, c * R * 1.12, sn * R * 1.12, 0), lx(Q, c * R * 0.9, sn * R * 0.9, 0), ly(Q, c * R * 0.9, sn * R * 0.9, 0), lz(Q, c * R * 0.9, sn * R * 0.9, 0), i, i, 2.2, 0.5, 0.06); }
    // finish bar: two rails across the floor and a chequer of short ticks between them
    const H = CFG.hw + 0.5, Y = CFG.floor;
    for (let z = -0.5; z <= 0.5; z += 1) seg(lx(Q, -H, Y, z), ly(Q, -H, Y, z), lz(Q, -H, Y, z), lx(Q, H, Y, z), ly(Q, H, Y, z), lz(Q, H, Y, z), i, i, 1.6, 0.4);
    for (let k = 0; k < 10; k++) { const x0 = -H + (k + 0.15) * (2 * H / 10), x1 = x0 + 0.7 * (2 * H / 10), z = k % 2 ? 0.25 : -0.25;
      seg(lx(Q, x0, Y, z), ly(Q, x0, Y, z), lz(Q, x0, Y, z), lx(Q, x1, Y, z), ly(Q, x1, Y, z), lz(Q, x1, Y, z), i, i, 1.3, 0.4, 0.12); }
    anchor(lx(Q, 0, R * 1.3, 0), ly(Q, 0, R * 1.3, 0), lz(Q, 0, R * 1.3, 0), i, round(dg)); // RING GATE + distance
    anchor(lx(Q, 0, Y - 0.6, 0), ly(Q, 0, Y - 0.6, 0), lz(Q, 0, Y - 0.6, 0), i, -10); // END
  }

  // ---------------------------------------------------------------- colour and fonts (re-read when the palette or style changes)
  function readStyle() {
    const set = shell && shell.settings; const key = set ? set.scheme + '|' + set.style + '|' + set.font + '|' + set.hudScale : '';
    if (key === palKey) return; palKey = key; // (runs only when one of those changes)
    const root = document.getElementById('sgr'), gv = (k, d) => (root && root.style.getPropertyValue(k).trim()) || d;
    const hex = (h) => { h = h.replace('#', ''); if (h.length === 3) h = h.replace(/./g, '$&$&'); const v = parseInt(h, 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
    let a = gv('--a', '#7fe4ff'), c = hex(a); if (c[2] < c[0]) { a = gv('--h', '#7fe4ff'); c = hex(a); if (c[2] < c[0]) { a = '#7fe4ff'; c = hex(a); } } // stay cool
    colHex = a; const lin = c.map((v) => Math.pow(v / 255, 2.2)), m = max(lin[0], lin[1], lin[2]) || 1;
    for (let k = 0; k < 3; k++) { C[k] = lin[k] / m; CW[k] = mix(C[k], 1, 0.75); }
    fnt = gv('--fn', 'ui-monospace,Menlo,monospace'); const wt = gv('--wt', '600'), fl = gv('--fl', fnt);
    K = clamp(min(innerWidth / 1180, innerHeight / 700), 0.42, 1.25) * ({ s: 0.85, m: 1, l: 1.18 }[set && set.hudScale] || 1);
    fntS = `${wt} ${round(14 * K)}px ${fnt}`; fntL = `${wt} ${round(12 * K)}px ${fl}`;
  }

  // ---------------------------------------------------------------- per frame (reefrun.js post)
  // st: s (rail distance), cam (ship position), power (HUD boot 0..1), ended, np (split-screen players, 0 = one view),
  // EYE / CBP / TANP / ASPP (the split views' cameras), FR (the ship's rail frame)
  function frame(view, s, cam, FR, power, ended, np, EYE, CBP, TANP, ASPP) {
    if (!L || !SC) return;
    const F = view.F, tt = F[8]; let dt = tPrev < 0 ? 0 : clamp(tt - tPrev, 0, 0.1); tPrev = tt; t += dt; if (t < 0) t = 0;
    const lay = shell.settings.layers, railOn = !!lay.rail, holo = railOn && mode === 'holo';
    const live = holo && shell.state !== 'menu' && !ended && power > 0;
    // the classic dots: as before when classic (or at Frame 0 / on the menu); in holo mode they fade out while the route plots in
    const pw = clamp(power, 0, 1);
    plot = REDUCED ? pw : sstep(0.05, 1, pw);
    SC.p1[3] = !railOn ? 0 : !holo || !live ? (holo && ended ? 0 : 1) : 1 - sstep(0, 0.6, plot);
    vis = live ? (REDUCED ? plot : 1) : 0;
    L.n = 0;
    if (!live) { hide(); return; }
    readStyle();
    // the plot front: the boot sweeps it out once; then the computer re-plots every sweepEvery s
    boot = pw < 1 && !REDUCED;
    if (boot) { front = plot * (CFG.range + 40); sweepT = 0; }
    else if (REDUCED) front = 1e9;
    else { sweepT += dt; const f = (sweepT - CFG.sweepEvery) * CFG.sweepSpeed; front = f > 0 && f < CFG.range + 60 ? f : 1e9; if (f >= CFG.range + 60) sweepT = 0; }
    // flicker: mostly steady, the odd dip (none with reduced motion)
    if (!REDUCED && (flickT -= dt) <= 0) { flickT = 0.06 + hr() * 0.1; flick = hr() < 0.04 ? 0.55 : 0.93 + 0.07 * hr(); } else if (REDUCED) flick = 1;
    n = 0; na = 0; buildGate(s); build(s); // the gate's labels first: they win over a range label in the same spot
    L.n = n;
    labels(view, np, EYE, CBP, TANP, ASPP);
    navDt = dt; navDraw(s, FR, np, power);
    if (!wrapped && G.grabOverlay) { // G.grab composites the shell's 2D layers; add this one
      wrapped = true; const g0 = G.grabOverlay;
      G.grabOverlay = (g, w, h) => { g0(g, w, h); if (cv && cvShown) g.drawImage(cv, 0, 0, w, h); if (nav && nav.style.display !== 'none') { const r = nav.getBoundingClientRect(), sx = w / innerWidth; g.drawImage(nav, r.left * sx, r.top * sx, r.width * sx, r.height * sx); } };
    }
  }
  function hide() { if (cvShown) { cvShown = false; cv.style.display = 'none'; nav.style.display = 'none'; } }

  // labels: distance ticks, the gate, END, projected per viewport in the HUD's number font
  function labels(view, np, EYE, CBP, TANP, ASPP) {
    if (!cv) return;
    const dpr = min(2, devicePixelRatio || 1), w = round(innerWidth * dpr), h = round(innerHeight * dpr);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; palKey = ''; readStyle(); }
    if (!cvShown) { cvShown = true; cv.style.display = 'block'; }
    const g = cx; g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, w, h);
    if (!na) return;
    g.textBaseline = 'middle'; g.fillStyle = colHex; g.shadowColor = colHex; g.shadowBlur = 6 * dpr;
    const nv = np > 1 ? np : 1, V = G.views, sc = w / (view.W || w), marks = !!shell.settings.layers.marks;
    for (let v = 0; v < nv; v++) {
      let ex, ey, ez, fx, fy, fz, rx, rz, ux, uy, uz, tn, as, x0 = 0, y0 = 0, vw = w, vh = h;
      if (np > 1) { const b = v * 9; ex = EYE[v * 3]; ey = EYE[v * 3 + 1]; ez = EYE[v * 3 + 2]; fx = CBP[b]; fy = CBP[b + 1]; fz = CBP[b + 2]; rx = CBP[b + 3]; rz = CBP[b + 5]; ux = CBP[b + 6]; uy = CBP[b + 7]; uz = CBP[b + 8]; tn = TANP[v]; as = ASPP[v];
        x0 = V.px[v * 4] * sc; y0 = V.px[v * 4 + 1] * sc; vw = V.px[v * 4 + 2] * sc; vh = V.px[v * 4 + 3] * sc; g.save(); g.beginPath(); g.rect(x0, y0, vw, vh); g.clip(); }
      else { const F = view.F; ex = F[0]; ey = F[1]; ez = F[2]; fx = view.f[0]; fy = view.f[1]; fz = view.f[2]; rx = view.r[0]; rz = view.r[2]; ux = view.u[0]; uy = view.u[1]; uz = view.u[2]; tn = view.tan; as = view.aspect; }
      const ks = np > 1 ? clamp(vh / h * 1.6, 0.62, 1) : 1;
      for (let k = 0; k < na; k++) {
        LP[k * 2] = -1e9; const o = k * 5, dx = ANC[o] - ex, dy = ANC[o + 1] - ey, dz = ANC[o + 2] - ez, z = dx * fx + dy * fy + dz * fz; if (z < 1) continue;
        const px = x0 + (1 + (dx * rx + dz * rz) / (z * tn * as)) * 0.5 * vw, py = y0 + (1 - (dx * ux + dy * uy + dz * uz) / (z * tn)) * 0.5 * vh;
        if (px < x0 - 40 || px > x0 + vw + 40 || py < y0 - 20 || py > y0 + vh + 20) continue;
        let ov = false; for (let j = 0; j < k; j++) if (LP[j * 2] > -1e8 && abs(LP[j * 2] - px) < 70 * dpr && abs(LP[j * 2 + 1] - py) < 22 * dpr) ov = true; // a nearer label is already there
        LP[k * 2] = ov ? -1e9 : px; LP[k * 2 + 1] = py; if (ov) continue;
        const cxv = px - (x0 + vw / 2), cyv = py - (y0 + vh / 2), rc = sqrt(cxv * cxv + cyv * cyv) / (90 * dpr * ks); // keep clear of the reticle
        const si = ANC[o + 4]; g.globalAlpha = clamp(ANC[o + 3], 0, 1) * 0.95 * clamp(rc - 0.6, 0, 1);
        if (si <= -10) { g.font = fntL; g.textAlign = 'center'; g.fillText('END OF RUN', px, py + 4 * dpr * ks); }
        else if (si < 0) { g.font = fntS; g.textAlign = 'left'; g.fillText(TICKL[-1 - si], px, py); }
        else { g.textAlign = 'center'; if (!marks) { g.font = fntL; g.fillText('RING GATE', px, py - 9 * dpr * K * ks); } g.font = fntS; g.fillText(DIST[min(si, 1200)], px, py + (marks ? 0 : 7 * dpr * K * ks)); } // with the marks layer on, the shell's gate bracket names it
      }
      if (np > 1) g.restore();
    }
    g.globalAlpha = 1; g.shadowBlur = 0;
  }

  // NAV: an isometric wireframe of the next CFG.nav m from above and behind, turning gently; the ship is the triangle
  function navDraw(s, FR, np, power) {
    if (!nav) return;
    const on = np <= 1 && shell.settings.layers.minimap;
    if (!on) { if (nav.style.display !== 'none') nav.style.display = 'none'; return; }
    const W = innerWidth, H = innerHeight, cw = 224 * K, ch = 150 * K, xl = max(W / 2 - 468 * K, 126 * K) + 124 * K, xr = W / 2 - 106 * K;
    if (!CFG.navLeft && xr - xl < cw * 0.8) { if (nav.style.display !== 'none') nav.style.display = 'none'; return; }
    const dpr = min(2, devicePixelRatio || 1), bw = round(cw * dpr), bh = round(ch * dpr);
    if (nav.width !== bw || nav.height !== bh) { nav.width = bw; nav.height = bh; nav.style.width = cw + 'px'; nav.style.height = ch + 'px'; }
    // navLeft: the left column above the weapon panel, so the bottom centre stays clear for the gunner's barrels (carpetshark: "change camera position so turrets are visible")
    const tx = CFG.navLeft ? round(max(8, max(W / 2 - 468 * K, 126 * K) - 118 * K)) : round((xl + xr) / 2 - cw / 2), ty = CFG.navLeft ? round(H - 250 * K - ch) : round(H - 14 * K - ch); if (tx !== navX || ty !== navY) { navX = tx; navY = ty; nav.style.transform = `translate(${tx}px,${ty}px)`; } // (only when it moves)
    if (nav.style.display !== 'block') nav.style.display = 'block';
    const g = nx, u = dpr * K; g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, bw, bh);
    g.globalAlpha = clamp(power, 0, 1) * flick;
    // panel: a faint backing and a corner-cut frame
    g.setTransform(u, 0, 0, u, 0, 0);
    g.fillStyle = 'rgba(4,14,20,0.32)'; g.strokeStyle = colHex; g.lineWidth = 1;
    g.beginPath(); g.moveTo(10, 0); g.lineTo(224, 0); g.lineTo(224, 140); g.lineTo(214, 150); g.lineTo(0, 150); g.lineTo(0, 10); g.closePath(); g.fill();
    const ga = g.globalAlpha; g.globalAlpha = ga * 0.45; g.stroke(); g.globalAlpha = ga;
    g.fillStyle = colHex; g.font = fntL; g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillText('NAV', 8, 15);
    g.textAlign = 'right'; g.font = fntL; g.fillText(DIST[CFG.nav], 216, 15);
    // projection: ship frame (x right, y up, z forward), turned by az about up, seen from above/behind at el; it fits itself to
    // the route (scale and centre ease toward the route's bounds, so a loop that swings back still fills the panel)
    rail.at(s, T1); const dn = min(CFG.nav, len - s); let m = 0;
    for (let d = 0; d <= dn && m < 41; d += 10, m++) {
      rail.at(s + d, T0); const dx = T0[0] - T1[0], dy = T0[1] - T1[1], dz = T0[2] - T1[2];
      NV[m * 3] = dx * FR[3] + dy * FR[4] + dz * FR[5]; NV[m * 3 + 1] = dx * FR[6] + dy * FR[7] + dz * FR[8]; NV[m * 3 + 2] = dx * FR[0] + dy * FR[1] + dz * FR[2];
    }
    const az = REDUCED ? 0.25 : 0.32 * sin(t * 0.21), ca = cos(az), sa = sin(az), el = 0.62, ce = cos(el), se = sin(el);
    const UX = (x, z) => x * ca - z * sa, UY = (x, y, z) => -((x * sa + z * ca) * se + y * ce);
    let x0 = -20, x1 = 20, y0 = -20, y1 = 20;
    for (let k = 0; k < m; k++) { const ux = UX(NV[k * 3], NV[k * 3 + 2]), uy = UY(NV[k * 3], NV[k * 3 + 1], NV[k * 3 + 2]); if (ux < x0) x0 = ux; if (ux > x1) x1 = ux; if (uy < y0) y0 = uy; if (uy > y1) y1 = uy; }
    const kw = min(196 / (x1 - x0), 112 / (y1 - y0)), ke = navK ? 1 - exp(-navDt * 2.5) : 1;
    navK += (kw - navK) * ke; navCX += ((x0 + x1) / 2 - navCX) * ke; navCY += ((y0 + y1) / 2 - navCY) * ke;
    const kz = navK, ox = 112 - navCX * kz, oy = 84 - navCY * kz;
    const PX = (x, z) => ox + UX(x, z) * kz, PY = (x, y, z) => oy + UY(x, y, z) * kz;
    g.save(); g.beginPath(); g.rect(2, 20, 220, 128); g.clip();
    // floor rings every 100 m around the ship (circles seen at el)
    g.lineWidth = 1;
    for (let r = 100; r <= CFG.nav; r += 100) { g.globalAlpha = ga * (r === CFG.nav ? 0.3 : 0.16); g.beginPath(); g.ellipse(ox, oy, r * kz, r * kz * se, 0, 0, TAU); g.stroke(); }
    const pf = boot ? clamp(front / CFG.range, 0, 1) : 1, mm = max(2, round(m * pf));
    g.globalAlpha = ga * 0.4; g.beginPath(); // height stems every 50 m, down to the ship's level
    for (let k = 5; k < mm; k += 5) { const x = NV[k * 3], y = NV[k * 3 + 1], z = NV[k * 3 + 2]; g.moveTo(PX(x, z), PY(x, 0, z)); g.lineTo(PX(x, z), PY(x, y, z)); g.moveTo(PX(x, z) - 2, PY(x, 0, z)); g.lineTo(PX(x, z) + 2, PY(x, 0, z)); }
    g.stroke();
    g.globalAlpha = ga; g.lineWidth = 2; g.shadowColor = colHex; g.shadowBlur = 5 * u; g.beginPath();
    for (let k = 0; k < mm; k++) { const x = NV[k * 3], y = NV[k * 3 + 1], z = NV[k * 3 + 2]; if (k) g.lineTo(PX(x, z), PY(x, y, z)); else g.moveTo(PX(x, z), PY(x, y, z)); }
    g.stroke(); g.shadowBlur = 0;
    // a pulse running along it (the computer tracing the route); none with reduced motion
    if (!REDUCED) { const k = floor((t * 9) % mm), x = NV[k * 3], y = NV[k * 3 + 1], z = NV[k * 3 + 2]; g.beginPath(); g.arc(PX(x, z), PY(x, y, z), 2.4, 0, TAU); g.fill(); }
    // the Ring Gate, if it is within range
    const dg = sGate - s;
    if (dg > 0 && dg < CFG.nav * pf) { rail.at(sGate, T0); const dx = T0[0] - T1[0], dy = T0[1] - T1[1], dz = T0[2] - T1[2];
      const x = dx * FR[3] + dy * FR[4] + dz * FR[5], y = dx * FR[6] + dy * FR[7] + dz * FR[8], z = dx * FR[0] + dy * FR[1] + dz * FR[2], gx = PX(x, z), gy = PY(x, y, z);
      g.lineWidth = 1.6; g.beginPath(); g.ellipse(gx, gy, 3.4, 7.5, 0, 0, TAU); g.stroke();
      g.font = fntL; g.textAlign = gx > 150 ? 'right' : 'left'; g.fillText('GATE', gx + (gx > 150 ? -9 : 9), gy - 6); }
    // the ship: a triangle at the origin, pointing along its heading
    g.globalAlpha = clamp(power, 0, 1); g.fillStyle = '#ffffff'; g.beginPath();
    g.moveTo(PX(0, 9 / kz), PY(0, 0, 9 / kz)); g.lineTo(PX(-5 / kz, -5 / kz), PY(-5 / kz, 0, -5 / kz)); g.lineTo(PX(0, -2 / kz), PY(0, 0, -2 / kz)); g.lineTo(PX(5 / kz, -5 / kz), PY(5 / kz, 0, -5 / kz)); g.closePath(); g.fill();
    g.restore(); g.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- commands: rail holo | classic (on / off / toggle stay the shell's)
  function command(a) {
    if (a[1] !== 'holo' && a[1] !== 'classic') return null;
    mode = a[1]; try { localStorage.setItem('reef-run:rail', mode); } catch {}
    if (shell && !shell.settings.layers.rail && shell.command) shell.command('rail on');
    sync();
    return mode === 'holo' ? 'rail holo: the ship\'s computer projects the route (rail classic: the dotted ghost rail)' : 'rail classic: the dotted ghost rail (rail holo: the projected route)';
  }
  const settingsHTML = () => '<h4>Route</h4><div class="seg"><button type="button" data-game="rail holo" aria-pressed="false">Hologram</button><button type="button" data-game="rail classic" aria-pressed="false">Classic dots</button></div>';
  function sync() { if (typeof document !== 'undefined') for (const b of document.querySelectorAll('#sgset [data-game^="rail "]')) b.setAttribute('aria-pressed', String(b.dataset.game === 'rail ' + mode)); }
  return { prepare, init, frame, command, settingsHTML, sync, cfg: CFG, get mode() { return mode; },
    help: '\n  rail holo|classic             the projected route (hologram) or the dotted ghost rail (also ?rail=)',
    get state() { return { mode, n: L ? L.n : 0, front, plot, vis, boot, labels: na, dEnd, ghost: SC && SC.p1 ? SC.p1[3] : -1 }; } };
})();
