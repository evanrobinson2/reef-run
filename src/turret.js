// ============================================================================
// turret.js: free-look turret maths for the rail games (GAME_API.md "Turret"). The ship flies the rail on autopilot; the
// player only looks and shoots. Yaw is unlimited (full circle, you can look backward), pitch is clamped (default ±85°),
// both relative to the rail frame, so "forward" stays forward as the rail turns. Aim = the camera's forward (screen centre).
// Also: input smoothing with a stick acceleration curve, an optional weak recentre after a few seconds without look input,
// the over-the-shoulder orbit, a screen-edge helper and a small DOM HUD (forward chevron, compass, off-screen threat arrows).
// Load-time allocation only: step(), aim(), orbit(), edge() and hud.draw() write into preallocated arrays.
// ============================================================================
const Turret = (() => {
  const PI = Math.PI, TAU = PI * 2;
  const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wrap = (a) => { a %= TAU; return a > PI ? a - TAU : a <= -PI ? a + TAU : a; };
  const clampN = (x, a, b) => (x < a ? a : x > b ? b : x);

  // create(opts) → a turret. opts (all optional): pitchMax (rad, 85°), worldPitchMax (rad, 86°: keeps the engine's yaw/pitch
  // camera from flipping over the pole), mouse (rad per CSS px at sens 1), stick (rad/s at full deflection), keys (rad/s),
  // accel (extra stick speed after holding full deflection), recentreDelay (s), recentreRate (1/s)
  function create(o = {}) {
    const T = {
      yaw: 0, pitch: 0, // rail-relative look angles (rad). yaw > 0 looks right, pitch > 0 looks up
      pitchMax: o.pitchMax ?? 85 * PI / 180, worldPitchMax: o.worldPitchMax ?? 86 * PI / 180,
      mouse: o.mouse ?? 0.0022, stick: o.stick ?? 2.6, keys: o.keys ?? 1.7, accel: o.accel ?? 0.9,
      recentreDelay: o.recentreDelay ?? 3, recentreRate: o.recentreRate ?? (reduced ? 0.25 : 0.45),
      idle: 0, vy: 0, vp: 0, hold: 0, active: false, recentring: false,
      dir: new Float64Array(3),  // world look direction (unit)
      Y: 0, P: 0,                // world yaw/pitch for the engine camera (F[3], F[4])
      B: new Float64Array(9),    // world look basis as the engine builds it: forward 0..2, right 3..5 (horizontal), up 6..8
      reset() { T.yaw = T.pitch = T.vy = T.vp = T.hold = T.idle = 0; T.active = T.recentring = false; },
      // step(dt, look): integrate one frame of look input. look = { dx, dy (CSS px, mouse or touch drag; dy > 0 is up),
      // sx, sy (stick, -1..1), kx, ky (keys, -1..1), sens (multiplier, default 1), recentre (bool) }
      step(dt, L) {
        if (!(dt > 0) || !L) return T;
        const sens = L.sens > 0 ? L.sens : 1;
        const dx = L.dx || 0, dy = L.dy || 0, sx = L.sx || 0, sy = L.sy || 0, kx = L.kx || 0, ky = L.ky || 0;
        // mouse / touch drag: direct, no smoothing (lag on a mouse feels like mud)
        T.yaw += dx * T.mouse * sens; T.pitch += dy * T.mouse * sens;
        // stick: squared response curve; holding near full deflection ramps the speed up by `accel` over 0.6 s
        const m = Math.min(1, Math.hypot(sx, sy));
        T.hold = m > 0.92 ? T.hold + dt : 0;
        const ramp = 1 + T.accel * Math.min(1, T.hold / 0.6); // the axis times m gives a speed of m² along the stick direction
        let ty = sx * m * T.stick * ramp * sens, tp = sy * m * T.stick * 0.8 * ramp * sens;
        ty += kx * T.keys * sens; tp += ky * T.keys * 0.8 * sens;
        const k = 1 - Math.exp(-dt * 12); // stick and keys ease in and out
        T.vy += (ty - T.vy) * k; T.vp += (tp - T.vp) * k;
        if (Math.abs(T.vy) < 1e-4 && !ty) T.vy = 0; if (Math.abs(T.vp) < 1e-4 && !tp) T.vp = 0;
        T.yaw += T.vy * dt; T.pitch += T.vp * dt;
        // recentre: weakly back toward forward after recentreDelay s with no look input (the short way round)
        T.active = dx !== 0 || dy !== 0 || m > 0.04 || kx !== 0 || ky !== 0;
        T.idle = T.active ? 0 : T.idle + dt;
        T.yaw = wrap(T.yaw);
        T.recentring = !!L.recentre && T.idle > T.recentreDelay && (Math.abs(T.yaw) > 1e-4 || Math.abs(T.pitch) > 1e-4);
        if (T.recentring) { const r = 1 - Math.exp(-dt * T.recentreRate * Math.min(1, (T.idle - T.recentreDelay) / 1.5)); T.yaw -= T.yaw * r; T.pitch -= T.pitch * r; }
        T.pitch = clampN(T.pitch, -T.pitchMax, T.pitchMax);
        return T;
      },
      // aim(FR): compose the rail frame FR (Float64Array(9): forward 0..2, right 3..5, up 6..8, as rail.frame) with yaw/pitch
      // into the world look direction dir, the engine's world yaw/pitch (Y, P) and basis B. With yaw = pitch = 0, dir is
      // exactly FR's forward.
      aim(FR) {
        const cy = Math.cos(T.yaw), sy = Math.sin(T.yaw), cp = Math.cos(T.pitch), sp = Math.sin(T.pitch), d = T.dir;
        d[0] = cp * (cy * FR[0] + sy * FR[3]) + sp * FR[6]; d[1] = cp * (cy * FR[1] + sy * FR[4]) + sp * FR[7]; d[2] = cp * (cy * FR[2] + sy * FR[5]) + sp * FR[8];
        let l = Math.hypot(d[0], d[1], d[2]) || 1; d[0] /= l; d[1] /= l; d[2] /= l;
        const lim = Math.sin(T.worldPitchMax);
        if (d[1] > lim || d[1] < -lim) { // never over the pole: the engine camera has no roll and would flip
          const h = Math.hypot(d[0], d[2]) || 1e-6, ny = d[1] > 0 ? lim : -lim, hc = Math.sqrt(1 - ny * ny) / h;
          d[0] *= hc; d[2] *= hc; d[1] = ny; if (h < 1e-5) { d[0] = FR[0]; d[2] = FR[2]; l = Math.hypot(d[0], d[2]) || 1; d[0] *= Math.sqrt(1 - ny * ny) / l; d[2] *= Math.sqrt(1 - ny * ny) / l; }
        }
        T.Y = Math.atan2(d[0], d[2]); T.P = Math.asin(clampN(d[1], -1, 1));
        basis(T.Y, T.P, T.B);
        return T;
      },
      // orbit(ship, back, up, right, blend, out): the shoulder camera around the look direction: `back` m behind the ship
      // along the look, `up` m above and `right` m to its right, all in the look basis B, scaled by blend (0 = cockpit)
      orbit(ship, back, up, right, blend, out) {
        const B = T.B, b = back * blend, u = up * blend, r = right * blend;
        out[0] = ship[0] - B[0] * b + B[3] * r + B[6] * u; out[1] = ship[1] - B[1] * b + B[4] * r + B[7] * u; out[2] = ship[2] - B[2] * b + B[5] * r + B[8] * u;
        return out;
      },
    };
    return T;
  }
  // the engine's camera basis for world yaw/pitch (engine.js; up.y = cos(pitch) >= 0)
  function basis(Y, P, B) {
    const cy = Math.cos(Y), sy = Math.sin(Y), cp = Math.cos(P), sp = Math.sin(P);
    B[0] = sy * cp; B[1] = sp; B[2] = cy * cp; B[3] = cy; B[4] = 0; B[5] = -sy; B[6] = -sp * sy; B[7] = cp; B[8] = -sp * cy;
    return B;
  }
  // edge(rx, ru, rf, tanH, aspect, margin, out): where a direction (in camera right/up/forward components) lands on screen.
  // out = [ndcX, ndcY, angle (rad, screen space, 0 = right, CCW), onScreen (1|0)]. Off-screen points (or behind) are pinned to
  // the screen edge inset by `margin` (ndc), pointing the shortest way to turn toward them.
  function edge(rx, ru, rf, tanH, aspect, margin, out) {
    let x, y;
    if (rf > 1e-3) { x = rx / (rf * tanH * aspect); y = ru / (rf * tanH); }
    else { x = rx; y = ru; if (Math.abs(x) + Math.abs(y) < 1e-6) y = -1; const s = 1e6; x *= s; y *= s; } // behind: push outward
    const on = rf > 1e-3 && Math.abs(x) <= 1 - margin && Math.abs(y) <= 1 - margin;
    out[2] = Math.atan2(y, x * aspect); out[3] = on ? 1 : 0;
    if (!on) { const lim = 1 - margin, t = Math.min(lim / (Math.abs(x) || 1e-9), lim / (Math.abs(y) || 1e-9)); x *= t; y *= t; }
    out[0] = x; out[1] = y; return out;
  }

  // hud(parent): a small SVG layer for turret games, coloured by the shell's palette variables (--h HUD, --d danger, --a goal).
  //   draw(st): st = { power (0..1), compass (bool), yaw (rail-relative look yaw, rad), fwd: [ndcX, ndcY, angle, onScreen],
  //   showFwd (bool), arrows: Float32Array [ndcX, ndcY, angle, kind, dist] × n, n, ticks: Float32Array [relYaw, kind] × nt, nt }
  //   kind 0 target, 1 goal, 2 danger. At most 5 arrows. Write-if-changed, so steady frames do no DOM writes.
  function hud(parent) {
    const NS = 'http://www.w3.org/2000/svg', D = document;
    const el = (t, a, p) => { const e = D.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); p.appendChild(e); return e; };
    const st = D.createElement('style');
    st.textContent = `#tthud{position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:6;overflow:visible}
#tthud .tk{stroke:var(--h);fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}#tthud .tf{fill:var(--h)}#tthud .td{fill:var(--d)}#tthud .ta{fill:var(--a)}
#tthud .tt{font:700 11px var(--fl,ui-monospace,Menlo,monospace);letter-spacing:.08em;fill:var(--h)}#tthud .ttd{fill:var(--d)}
#tthud .tw{filter:drop-shadow(0 0 3px rgba(0,0,0,.8))}`;
    D.head.appendChild(st);
    const svg = el('svg', { id: 'tthud', class: 'sgjolt', 'aria-hidden': 'true' }, parent || D.body); // sgjolt: rides the shell's HUD shake
    const root = el('g', { class: 'tw' }, svg);
    // forward chevron: a double chevron with an "FWD" label, pointing toward the rail direction
    const fwd = el('g', {}, root), fwdA = el('g', {}, fwd);
    el('path', { d: 'M-7 -12 L5 0 L-7 12 M-15 -12 L-3 0 L-15 12', class: 'tk', 'stroke-width': '2.6' }, fwdA);
    const fwdT = el('text', { class: 'tt', 'text-anchor': 'middle', y: '28' }, fwd); fwdT.textContent = 'FWD';
    // compass: a ±180° strip under the top of the screen; the centre notch is where you look, ticks show forward and threats
    const cmp = el('g', {}, root);
    el('rect', { x: '-150', y: '-1', width: '300', height: '2', class: 'tf', 'fill-opacity': '.35' }, cmp);
    for (let i = -4; i <= 4; i++) el('rect', { x: String(i * 37.5 - 0.75), y: i % 2 ? '-3' : '-5', width: '1.5', height: i % 2 ? '6' : '10', class: 'tf', 'fill-opacity': '.45' }, cmp);
    el('path', { d: 'M-6 -14 L0 -7 L6 -14', class: 'tk' }, cmp);
    const cF = el('g', {}, cmp); el('path', { d: 'M-6 14 L0 6 L6 14 Z', class: 'tf' }, cF); const cFT = el('text', { class: 'tt', 'text-anchor': 'middle', y: '27' }, cF); cFT.textContent = 'FWD';
    const TICKS = []; for (let i = 0; i < 8; i++) { const g = el('rect', { x: '-2', y: '-8', width: '4', height: '16', rx: '1.5', class: 'td' }, cmp); TICKS.push(g); }
    const ARR = [];
    for (let i = 0; i < 5; i++) { const g = el('g', {}, root), a = el('g', {}, g); const p = el('path', { d: 'M12 0 L-8 -10 L-3 0 L-8 10 Z', class: 'td' }, a); const t = el('text', { class: 'tt ttd', 'text-anchor': 'middle', y: '24' }, g); ARR.push({ g, a, p, t }); }
    const set = (e, k, v) => { if (e['_' + k] !== v) { e['_' + k] = v; e.setAttribute(k, v); } };
    const show = (e, v) => { if (e._vis !== v) { e._vis = v; e.style.display = v ? '' : 'none'; } };
    const txt = (e, v) => { if (e._t !== v) { e._t = v; e.textContent = v; } };
    const pos = (e, x, y, rot) => set(e, 'transform', rot === undefined ? `translate(${x.toFixed(0)} ${y.toFixed(0)})` : `translate(${x.toFixed(0)} ${y.toFixed(0)}) rotate(${rot.toFixed(0)})`);
    const H = {
      el: svg, top: 74, // compass y in CSS px (below the Canopy's top band)
      draw(s) {
        const W = innerWidth, Hh = innerHeight, p = s.power ?? 1;
        set(svg, 'opacity', p >= 1 ? '1' : (p * p).toFixed(2)); show(svg, p > 0.02);
        if (p <= 0.02) return;
        const toPx = (x, y) => { px = (x + 1) * 0.5 * W; py = (1 - y) * 0.5 * Hh; };
        let px = 0, py = 0;
        // forward chevron
        const f = s.fwd; show(fwd, !!s.showFwd);
        if (s.showFwd) { toPx(f[0], f[1]); pos(fwd, px, py); pos(fwdA, 0, 0, -f[2] * 180 / PI); }
        // compass strip
        show(cmp, !!s.compass);
        if (s.compass) {
          pos(cmp, W / 2, H.top);
          const fx = clampN(wrap(-s.yaw) / PI * 150, -150, 150); pos(cF, fx, 0); set(cF, 'opacity', Math.abs(wrap(s.yaw)) < 0.05 ? '0.45' : '1');
          const nt = Math.min(s.nt || 0, TICKS.length);
          for (let i = 0; i < TICKS.length; i++) { const on = i < nt; show(TICKS[i], on); if (on) { const a = wrap(s.ticks[i * 2]); set(TICKS[i], 'x', (clampN(a / PI * 150, -150, 150) - 2).toFixed(0)); set(TICKS[i], 'class', s.ticks[i * 2 + 1] === 2 ? 'td' : s.ticks[i * 2 + 1] === 1 ? 'ta' : 'tf'); } }
        }
        // off-screen arrows
        const n = Math.min(s.n || 0, ARR.length);
        for (let i = 0; i < ARR.length; i++) {
          const A = ARR[i], on = i < n; show(A.g, on); if (!on) continue;
          const o = i * 5; toPx(s.arrows[o], s.arrows[o + 1]); pos(A.g, px, py); pos(A.a, 0, 0, -s.arrows[o + 2] * 180 / PI);
          const k = s.arrows[o + 3]; set(A.p, 'class', k === 2 ? 'td' : k === 1 ? 'ta' : 'tf'); set(A.t, 'class', k === 2 ? 'tt ttd' : 'tt');
          const d = s.arrows[o + 4]; txt(A.t, d >= 0 ? Math.round(d) + 'm' : '');
        }
      },
      hide() { show(svg, false); },
    };
    return H;
  }
  return { create, basis, edge, hud, wrap, reduced };
})();
