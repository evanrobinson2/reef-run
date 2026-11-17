// ============================================================================
// fx2d.js: Castle Smash's hero hit effects, ported to a 2D overlay for the WebGPU rail games.
// Source: prototypes/ranch-atelier/dist/simulations/castle-smash/castle-vfx.mjs (AW-STUDY-0071). The flipbooks are the
// same drawings (wobbly blobs, inked stars, two-tone cel fills, the same colour ramps), drawn once into small canvases
// and then stamped on a full-screen 2D canvas at each effect's projected position, stepped "on twos" (12 fps).
// Differences from the Three.js original: there is no ground in space, so ground rings become screen-facing shockwave
// rings, debris and dust drift with drag instead of falling and bouncing, and the scorch decal is dropped.
//   FX.pow(x, y, z, {scale, text, color})   small hit: white-hot frame, starburst, speed streaks, chips, dust, comic word
//   FX.boom(x, y, z, {rad})                 dynamite: whiteout, layered fireballs, starbursts, shockwave rings, smoke,
//                                           dust ring, debris with trails, sparks, "BOOM!"
//   both return {hitStop, shake, slow, slowMs}; FX.timeScale and FX.shake carry them for the game.
//   FX.frame(dt, view) each frame (the shell calls it); FX.enabled, FX.words switch it.
// ============================================================================
const FX = (() => {
  const INK = '#3b2a1c', FPS = 12;
  const cl = (x, a, b) => Math.max(a, Math.min(b, x));
  const out3 = (x) => 1 - Math.pow(1 - cl(x, 0, 1), 3);
  const backOut = (x) => { x = cl(x, 0, 1) - 1; return 1 + 2.7 * x * x * x + 1.7 * x * x; };
  const lerp = (a, b, t) => a + (b - a) * t;
  const mixc = (c1, c2, t) => { const a = parseInt(c1.slice(1), 16), b = parseInt(c2.slice(1), 16); const ch = (s) => Math.round(lerp((a >> s) & 255, (b >> s) & 255, t)); return '#' + ((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1); };
  function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const rnd = Math.random, R = (a, b) => a + rnd() * (b - a);

  // ---------- flipbook drawing (unchanged from castle-vfx.mjs) ----------
  const texCache = new Map();
  function tex(key, w, h, draw) {
    let c = texCache.get(key); if (c) return c;
    c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.lineJoin = g.lineCap = 'round'; draw(g, w, h);
    texCache.set(key, c); return c;
  }
  const circle = (x, y, r) => (g) => { g.moveTo(x + r, y); g.arc(x, y, r, 0, Math.PI * 2); };
  function blob(cx, cy, r, count, seedN, wob) {
    const q = mulberry(seedN), p = []; for (let i = 0; i < count; i++) { const a = i / count * Math.PI * 2, rr = r * (1 - wob / 2 + q() * wob); p.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]); }
    return (g) => { const m = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], s = m(p[count - 1], p[0]); g.moveTo(s[0], s[1]); for (let i = 0; i < count; i++) { const e = m(p[i], p[(i + 1) % count]); g.quadraticCurveTo(p[i][0], p[i][1], e[0], e[1]); } g.closePath(); };
  }
  function star(cx, cy, ro, ri, count, seedN, jitter) {
    const q = mulberry(seedN);
    return (g) => { for (let i = 0; i < count * 2; i++) { const a = i * Math.PI / count + (q() - .5) * .1, rr = i % 2 ? ri * (1 - jitter * q()) : ro * (1 - jitter * q() * .6); g[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } g.closePath(); };
  }
  function cel(g, shapes, base, shade, ink = 12, lx = -9, ly = -12) {
    g.beginPath(); shapes.forEach((s) => s(g)); g.lineWidth = ink * 2; g.strokeStyle = INK; g.stroke();
    g.fillStyle = shade; g.fill(); g.save(); g.clip(); g.translate(lx, ly); g.fillStyle = base; g.fill(); g.restore();
  }
  const flat = (g, shapes, fill, ink = 8) => { g.beginPath(); shapes.forEach((s) => s(g)); if (ink) { g.lineWidth = ink * 2; g.strokeStyle = INK; g.stroke(); } g.fillStyle = fill; g.fill(); };
  const puffTex = (kind, i, N = 6) => tex('puff' + kind + i, 256, 256, (g) => {
    const q = mulberry(1000 + i * 31), t = i / (N - 1);
    const base = kind === 'dust' ? mixc('#f1e6c8', '#d8c9a6', t) : mixc('#e2b57a', '#a39b90', Math.min(1, t * 1.6)), shade = kind === 'dust' ? mixc('#cdbc96', '#b4a37e', t) : mixc('#a1673d', '#6d675f', Math.min(1, t * 1.6));
    const shapes = [circle(128, 136, 62 + q() * 8)]; for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2 + q(), d = 40 + q() * 22; shapes.push(circle(128 + Math.cos(a) * d, 136 + Math.sin(a) * d * .8, 30 + q() * 18)); }
    cel(g, shapes, base, shade, 7, -10, -14);
  });
  const fireTex = (i, N = 10) => tex('fire' + i, 256, 256, (g) => {
    const t = i / (N - 1), q = mulberry(77 + i * 13), ro = 96 - t * 14;
    const outer = mixc('#e8442a', '#5a3a2a', cl((t - .45) * 2, 0, 1)), mid = mixc('#ff9a1f', '#9a4a2a', cl((t - .4) * 2, 0, 1)), core = mixc('#ffd23d', '#d9742a', cl((t - .35) * 2, 0, 1));
    flat(g, [blob(128, 128, ro, 11, 5 + i, .42)], outer, 9);
    flat(g, [blob(120 + (q() - .5) * 8, 112, ro * .76, 9, 40 + i, .5)], mid, 0);
    flat(g, [blob(112 + (q() - .5) * 10, 100, ro * .5, 8, 90 + i, .5)], core, 0);
    if (t < .5) flat(g, [blob(106, 92, ro * .26 * (1 - t / .5), 7, 150 + i, .45)], '#fff6d8', 0);
  });
  const burstTex = (color, i, big = false) => tex('burst' + color + i + big, 256, 256, (g) => {
    const q = 5 + i * 17;
    flat(g, [star(128, 128, 120, big ? 62 : 54, big ? 18 : 14, q, big ? .45 : .6)], color, 10);
    flat(g, [star(128, 128, 84, 38, big ? 18 : 14, q + 3, .5)], mixc(color, '#ffffff', .55), 0);
  });
  const ringTex = (color) => tex('ring' + color, 256, 256, (g) => { g.beginPath(); g.arc(128, 128, 112, 0, Math.PI * 2); g.lineWidth = 30; g.strokeStyle = INK; g.stroke(); g.lineWidth = 14; g.strokeStyle = color; g.stroke(); });
  const chunkTex = (color) => tex('chunk' + color, 64, 64, (g) => { flat(g, [(g2) => { g2.moveTo(14, 18); g2.lineTo(48, 12); g2.lineTo(52, 46); g2.lineTo(18, 52); g2.closePath(); }], color, 5); g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(22, 18, 16, 6); });
  const splatTex = (color, v) => tex('splat' + color + v, 256, 256, (g) => {   // castle-vfx.mjs splatTex: blob, flung fingers, droplets, shine
    const q = mulberry(300 + v * 47), shapes = [blob(128, 128, 70, 13, 10 + v, .35)];
    for (let k = 0; k < 6; k++) {
      const a = k / 6 * Math.PI * 2 + q() * .6, len = 84 + q() * 30, w = 14 + q() * 9, tx = 128 + Math.cos(a) * len, ty = 128 + Math.sin(a) * len, nx = -Math.sin(a) * w, ny = Math.cos(a) * w;
      shapes.push((g2) => { g2.moveTo(128 + nx * 2.2, 128 + ny * 2.2); g2.lineTo(tx + nx * .6, ty + ny * .6); g2.lineTo(tx - nx * .6, ty - ny * .6); g2.lineTo(128 - nx * 2.2, 128 - ny * 2.2); g2.closePath(); }, circle(tx, ty, w * .85 + q() * 3));
    }
    for (let k = 0; k < 6; k++) { const a = q() * Math.PI * 2, d = 100 + q() * 22; shapes.push(circle(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, 5 + q() * 7)); }
    cel(g, shapes, color, mixc(color, '#7a5a3a', .35), 8, -8, -10);
    g.fillStyle = 'rgba(255,255,255,.7)'; g.beginPath(); g.ellipse(106, 100, 18, 9, -.6, 0, Math.PI * 2); g.fill(); g.beginPath(); g.arc(138, 88, 5, 0, Math.PI * 2); g.fill();
  });
  const dotTex = (color) => tex('dot' + color, 64, 64, (g) => { flat(g, [blob(32, 32, 20, 8, 3, .3)], color, 4); });
  const softTex = () => tex('soft', 128, 128, (g) => { const r = g.createRadialGradient(64, 64, 2, 64, 64, 62); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(.45, 'rgba(255,255,255,.6)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 128, 128); });

  // ---------- items ----------
  // kind: 'spr' (flipbook or texture, world size), 'word', 'streak', 'spark', 'flash' (whole screen)
  const items = [];
  let canvas = null, ctx = null, W = 0, H = 0, dpr = 1, trauma = 0, stopT = 0, slowT = 0, slowMs = 0;
  const P = [0, 0, 0], Q = [0, 0, 0];
  function add(o) { o.life = -(o.delay || 0); items.push(o); return o; }
  const stepK = (o) => (o.fps ? Math.floor(o.life * o.fps) / o.fps : o.life) / o.max;
  const frameOf = (k, N) => Math.min(N - 1, Math.floor(cl(k, 0, .999) * N));

  // pieces (positions are world metres; right/up offsets use the camera basis of the frame they start in)
  let view = null;
  const right = [1, 0, 0], up = [0, 1, 0];
  const off = (at, dr, du) => [at[0] + right[0] * dr + up[0] * du, at[1] + right[1] * dr + up[1] * du, at[2] + right[2] * dr + up[2] * du];
  const randDir = () => { const z = R(-1, 1), a = R(0, 6.283), s = Math.sqrt(1 - z * z); return [Math.cos(a) * s, z, Math.sin(a) * s]; };
  function flash(at, size, life = .07) { add({ kind: 'spr', at, img: softTex(), size0: size, size1: size * 1.4, max: life, fps: 30, add: true, alpha: (k) => (k < .5 ? 1 : .55), real: true }); }
  function starburst(at, color, size, { delay = 0, life = .42, big = false } = {}) {
    const frames = [0, 1, 2].map((i) => burstTex(color, i, big));
    add({ kind: 'spr', at, frames, delay, max: life, fps: FPS, rotStep: .35,
      sizeFn: (k) => size * (k < .4 ? lerp(.3, 1.22, out3(k / .4)) : k < .6 ? lerp(1.22, 1, (k - .4) / .2) : lerp(1, 0, out3((k - .6) / .4))) });
  }
  function word(at, text, color, size, { delay = 0, life = .9, tilt = (rnd() - .5) * .25, rise = .6, edge = [size * 1.4, size * 1.1], px = 40 } = {}) {
    if (!FX.words) return;
    add({ kind: 'word', at, text, color, delay, max: life, fps: 24, tilt, rise, edge, px });
  }
  function streaks(at, n, len, dist, colors, life = .24) {
    for (let i = 0; i < n; i++) add({ kind: 'streak', at, d: randDir(), len: len * R(.7, 1.3), dist: dist * R(.7, 1.2), color: colors[i % colors.length], max: life * R(.8, 1.2), fps: 24 });
  }
  function puff(at, kind, size0, size1, { delay = 0, life = 1, v = [0, 0, 0], fps = 8, N = 6, drag = 2.2, fadeFrom = .6, spin = 0 } = {}) {
    const frames = Array.from({ length: N }, (_, i) => puffTex(kind, i, N));
    add({ kind: 'spr', at: at.slice(), frames, delay, max: life, fps, v: v.slice(), drag, size0, size1, fadeFrom, rot: rnd() * 6, spin });
  }
  function debris(at, n, colors, speed, size, { trail = false, life = 1.3 } = {}) {
    for (let i = 0; i < n; i++) { const d = randDir(), sp = speed * Math.sqrt(rnd()); add({ kind: 'spr', at: at.slice(), img: chunkTex(colors[i % colors.length]), max: life * R(.8, 1.3), v: [d[0] * sp, d[1] * sp, d[2] * sp], drag: .8, size0: size * R(.6, 1.3), rot: rnd() * 6, spin: R(-9, 9), fadeFrom: .75, trail, tt: 0 }); }
  }
  function sparks(at, n, speed, colors, life = .8) {
    for (let i = 0; i < n; i++) { const d = randDir(), sp = speed * R(.4, 1); add({ kind: 'spark', at: at.slice(), v: [d[0] * sp, d[1] * sp, d[2] * sp], color: colors[i % colors.length], max: life * R(.6, 1.2) }); }
  }
  function ring(at, color, size, { delay = 0, life = .55 } = {}) {
    add({ kind: 'spr', at, img: ringTex(color), delay, max: life, sizeFn: (k) => size * (.15 + out3(k) * .85), alpha: (k) => (k < .5 ? 1 : 1 - (k - .5) / .5) });
  }
  function fireball(at, size0, size1, delay, life, rise) {
    const N = 10, frames = Array.from({ length: N }, (_, i) => fireTex(i, N)), p = at.slice();
    add({ kind: 'spr', at: p, base: at.slice(), frames, delay, max: life, fps: FPS, rotStep: .5, size0, size1, riseUp: rise, fadeFrom: .85 });
  }

  // ---------- POW: a small hit ----------
  function pow(x, y, z, { scale = 1, color = '#ffd23d', text, tilt } = {}) {
    if (!FX.enabled) return { hitStop: 0, shake: 0 };
    const S = scale, at = [x, y, z], hi = off(at, 0, 1.1 * S);
    flash(at, 2.4 * S);
    starburst(hi, color, 3.8 * S, { life: .4 });
    word(off(hi, 0, .2 * S), text || ['POW!', 'BAM!', 'WHAP!'][(rnd() * 3) | 0], '#fff6d8', S, { delay: .02, life: .55, tilt, rise: .5 * S, edge: [1.5 * S, 1.2 * S], px: 38 });
    streaks(at, 12, 1.5 * S, 2.8 * S, ['#fff6d8', color], .22);
    debris(at, 8, ['#dc7f5c', '#e2d3b4', '#cdbb96'], 5 * S, .36 * S, { life: .8 });
    puff(at, 'dust', .7 * S, 1.8 * S, { delay: .03, life: .42, N: 5, fps: 12, fadeFrom: .4 });
    trauma = Math.min(1, trauma + .3); stopT = Math.max(stopT, .05);
    return { hitStop: .05, shake: .3 };
  }

  // ---------- BOOM: the dynamite blast ----------
  function boom(x, y, z, { rad = 7 } = {}) {
    if (!FX.enabled) return { hitStop: 0, shake: 0 };
    const r = rad, at = [x, y, z], hi = off(at, 0, r * .5);
    flash(hi, r * 3.2); whiteT = .12;
    ring(at, '#fff6d8', r * 4.6, { life: .5 }); ring(at, '#ff9a3a', r * 3.4, { delay: .06, life: .6 });
    fireball(hi, r * 1.9, r * 4.2, 0, .95, r * .8);
    for (let i = 0; i < 6; i++) { const a = rnd() * 6.28, d = R(.4, 1.3) * r; fireball(off(at, Math.cos(a) * d, R(.1, 1.3) * r), r * .8, r * R(1.6, 2.4), R(.04, .22), R(.55, .8), r * R(.3, .9)); }
    starburst(off(hi, 0, r * .5), '#e8442a', r * 2.7, { life: .5, big: true }); starburst(off(hi, 0, r * .5), '#ffd23d', r * 2.1, { delay: .03, life: .45, big: true });
    word(off(hi, 0, r * .4), 'BOOM!', '#fff6d8', r * .72, { delay: .04, life: 1.1, rise: r * .5, tilt: -.13, edge: [r * 2.3, r * 2.5], px: 64 });
    for (let i = 0; i < 14; i++) { const a = rnd() * 6.28, d = R(0, .6) * r; const p = off(at, Math.cos(a) * d, r * R(.2, .6)); puff(p, 'smoke', r * .9, r * R(1.8, 2.8), { delay: .1 + i * .045, life: R(1.9, 2.6), v: [right[0] * Math.cos(a) * 1.2 + up[0] * R(3, 6), right[1] * Math.cos(a) * 1.2 + up[1] * R(3, 6), right[2] * Math.cos(a) * 1.2 + up[2] * R(3, 6)], fps: 6, N: 6, drag: .9, spin: R(-.5, .5), fadeFrom: .55 }); }
    for (let i = 0; i < 16; i++) { const a = i / 16 * 6.28 + R(-.2, .2), sp = R(7, 11); puff(at, 'dust', r * .45, r * R(1, 1.5), { delay: .05, life: 1.1, v: [(right[0] * Math.cos(a) + up[0] * Math.sin(a)) * sp, (right[1] * Math.cos(a) + up[1] * Math.sin(a)) * sp, (right[2] * Math.cos(a) + up[2] * Math.sin(a)) * sp], fps: 8, N: 6, drag: 2.4, fadeFrom: .4 }); }
    debris(at, 28, ['#d9c9a8', '#cdbb96', '#e2d3b4', '#a98a6a', '#dc7f5c'], r * 2.1, r * .075 * 2.2, { trail: true, life: 1.8 });
    sparks(hi, 38, r * 4, ['#ffe14a', '#fff6d8', '#ff9a1f'], 1);
    trauma = 1; stopT = Math.max(stopT, .12); slowT = .7; slowMs = .7;
    return { hitStop: .12, shake: 1, slow: .3, slowMs: 700 };
  }
  let whiteT = 0;

  // ---------- SPLAT: a wet impact (castle-vfx.mjs splat): the blob squashes in held frames, flung droplets, starburst, word
  function splat(x, y, z, { color = '#8fd14f', scale = 1, text = 'SPLAT!', wordColor } = {}) {
    if (!FX.enabled) return { hitStop: 0, shake: 0 };
    const S = scale, at = [x, y, z], v = (rnd() * 4) | 0;
    flash(at, 2.6 * S, .05);
    add({ kind: 'spr', at, img: splatTex(color, v), max: 1.1, fps: 24, rot: rnd() * 6, fadeFrom: .6,
      sizeFn: (k) => { const t = k * 1.1; return 3.4 * S * (t < .04 ? .3 : t < .08 ? .85 : t < .13 ? 1.18 : 1); } });
    for (let i = 0; i < 18; i++) { const d = randDir(), sp = R(2, 5.5) * S; add({ kind: 'spr', at: at.slice(), img: dotTex(color), max: R(.5, .9), v: [d[0] * sp, d[1] * sp, d[2] * sp], drag: 1.6, size0: R(.14, .3) * S * 2.2, fadeFrom: .6 }); }
    starburst(off(at, 0, .9 * S), color, 3.2 * S, { life: .36 });
    word(off(at, 0, .7 * S), text, wordColor || mixc(color, '#ffffff', .75), S * .95, { delay: .02, life: .6, rise: .4 * S, edge: [S * 1.7, S * 1.3], px: 40 });
    trauma = Math.min(1, trauma + .18); stopT = Math.max(stopT, .04);
    return { hitStop: .04, shake: .16 };
  }

  // ---------- frame ----------
  function ensure() {
    if (canvas) return;
    canvas = document.createElement('canvas'); canvas.id = 'fx2d';
    canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:4';
    document.body.appendChild(canvas); ctx = canvas.getContext('2d');
  }
  function resize() {
    const w = innerWidth, h = innerHeight, d = Math.min(2, devicePixelRatio || 1);
    if (w * d !== W || h * d !== H) { W = canvas.width = Math.round(w * d); H = canvas.height = Math.round(h * d); dpr = d; }
  }
  // split screen: view.mv > 1 and view.views[i] = { project, r, u, tan, x, y, w, h (fractions of the screen) }: the items step once,
  // then draw once per viewport with that view's camera, clipped to its rect. FX.mp (set by the game while split) turns the
  // slow-motion off and halves hit-stop, so four gunners' kills don't keep the whole game in slow motion.
  let RX = 0, RY = 0, RW = 0, RH = 0;
  function proj(p) { view.project(p[0], p[1], p[2], Q); return Q[2] > 0.3; }   // Q = ndcX, ndcY, depth
  const sx = () => RX + (Q[0] * .5 + .5) * RW, sy = () => RY + (.5 - Q[1] * .5) * RH;
  const pxPerM = () => RH / (2 * Q[2] * view.tan);
  function frame(dt, v) {
    ensure(); resize();
    const mv = v.mv > 1 ? v.mv : 0;
    trauma = Math.max(0, trauma - dt * 1.6); stopT = Math.max(0, stopT - dt);
    if (slowT > 0) slowT = Math.max(0, slowT - dt);
    if (FX.mp) { slowT = 0; stopT = Math.min(stopT, .03); }
    FX.timeScale = stopT > 0 ? .05 : slowT > 0 ? lerp(1, .3, slowT / slowMs) : 1;
    FX.shake = trauma * trauma * FX.shakeScale;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H);
    if (!FX.enabled) { items.length = 0; return; }
    const gdt = dt * FX.timeScale;
    for (let i = items.length - 1; i >= 0; i--) { // step
      const o = items[i], d = o.real ? dt : gdt; o.life += d;
      if (o.life < 0) continue;
      if (o.life >= o.max) { items.splice(i, 1); continue; }
      const k = stepK(o);
      if (o.v) { const dr = Math.exp(-(o.drag || 0) * d); o.v[0] *= dr; o.v[1] *= dr; o.v[2] *= dr; o.at[0] += o.v[0] * d; o.at[1] += o.v[1] * d; o.at[2] += o.v[2] * d; }
      if (o.trail && (o.tt += d) > .07 && k < .6) { o.tt = 0; puff(o.at, 'dust', o.size0 * .8, o.size0 * 2.2, { life: .5, fps: 8, N: 6, fadeFrom: .3 }); }
    }
    if (!mv) { view = v; RX = 0; RY = 0; RW = W; RH = H; draw(v); }
    else for (let j = 0; j < mv; j++) { const q = v.views[j]; view = q; RX = q.x * W; RY = q.y * H; RW = q.w * W; RH = q.h * H; ctx.save(); ctx.beginPath(); ctx.rect(RX, RY, RW, RH); ctx.clip(); draw(q); ctx.restore(); }
    if (whiteT > 0) { whiteT = Math.max(0, whiteT - dt); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = whiteT / .12 * .55; ctx.fillStyle = '#fff6e0'; ctx.fillRect(0, 0, W, H); }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
  function draw(v) {
    right[0] = v.r[0]; right[1] = v.r[1]; right[2] = v.r[2]; up[0] = v.u[0]; up[1] = v.u[1]; up[2] = v.u[2];
    for (let i = items.length - 1; i >= 0; i--) {
      const o = items[i];
      if (o.life < 0) continue;
      const k = stepK(o);
      if (o.kind === 'spr') {
        let p = o.at;
        if (o.base) { P[0] = o.base[0] + up[0] * o.riseUp * out3(k); P[1] = o.base[1] + up[1] * o.riseUp * out3(k); P[2] = o.base[2] + up[2] * o.riseUp * out3(k); p = P; }
        if (!proj(p)) continue;
        const sizeM = o.sizeFn ? o.sizeFn(k) : o.size1 ? lerp(o.size0, o.size1, out3(k)) : o.size0 * (k > .75 ? 1 - (k - .75) / .25 : 1);
        const s = sizeM * pxPerM(); if (s < 1) continue;
        // starbursts cycle their 3 frames on twos; fireballs and puffs play through their frames once
        const img = o.frames ? o.frames[o.frames.length === 3 ? (o.life * FPS | 0) % 3 : frameOf(k, o.frames.length)] : o.img;
        let a = o.alpha ? o.alpha(k) : o.fadeFrom && k > o.fadeFrom ? 1 - (k - o.fadeFrom) / (1 - o.fadeFrom) : 1;
        ctx.globalAlpha = cl(a, 0, 1); ctx.globalCompositeOperation = o.add ? 'lighter' : 'source-over';
        const rot = o.rotStep ? (o.life * FPS | 0) * o.rotStep : (o.rot || 0) + (o.spin || 0) * o.life;
        ctx.setTransform(Math.cos(rot), Math.sin(rot), -Math.sin(rot), Math.cos(rot), sx(), sy());
        ctx.drawImage(img, -s / 2, -s / 2, s, s);
      } else if (o.kind === 'streak') {
        const e = out3(k), D = o.dist * (.25 + e);
        P[0] = o.at[0] + o.d[0] * D; P[1] = o.at[1] + o.d[1] * D; P[2] = o.at[2] + o.d[2] * D; if (!proj(P)) continue;
        const x1 = sx(), y1 = sy(), L = o.len * (1 - k * k);
        P[0] -= o.d[0] * L; P[1] -= o.d[1] * L; P[2] -= o.d[2] * L; if (!proj(P)) continue;
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
        ctx.lineCap = 'round'; ctx.strokeStyle = o.color; ctx.lineWidth = Math.max(1.5, 4 * dpr * (1 - k)); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(sx(), sy()); ctx.stroke();
      } else if (o.kind === 'spark') {
        if (!proj(o.at)) continue; const x1 = sx(), y1 = sy();
        const sp = Math.hypot(o.v[0], o.v[1], o.v[2]) || 1, L = cl(sp * .045, .12, 1.6) * (1 - k * .6);
        P[0] = o.at[0] - o.v[0] / sp * L; P[1] = o.at[1] - o.v[1] / sp * L; P[2] = o.at[2] - o.v[2] / sp * L; if (!proj(P)) continue;
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = o.color; ctx.lineWidth = Math.max(1, 3 * dpr * (1 - k)); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(sx(), sy()); ctx.stroke();
      } else if (o.kind === 'word') {
        P[0] = o.at[0] + right[0] * o.edge[0] + up[0] * (o.edge[1] + o.rise * out3(k)); P[1] = o.at[1] + right[1] * o.edge[0] + up[1] * (o.edge[1] + o.rise * out3(k)); P[2] = o.at[2] + right[2] * o.edge[0] + up[2] * (o.edge[1] + o.rise * out3(k));
        if (!proj(P)) continue;
        const k0 = cl(RH / dpr / 720, .7, 1.6) * (RH < H ? .8 : 1), pop = backOut(k / .16), sc = (o.px / 70) * k0 * (k < .16 ? lerp(.5, 1, pop) : 1) * dpr, m = 60 * k0 * dpr;
        const cx = cl(sx(), RX + m * 1.6, RX + RW - m * 1.6), cy = cl(sy(), RY + m, RY + RH - m);
        ctx.setTransform(Math.cos(o.tilt) * sc, Math.sin(o.tilt) * sc, -Math.sin(o.tilt) * sc, Math.cos(o.tilt) * sc, cx, cy);
        ctx.globalAlpha = k > .75 ? 1 - (k - .75) / .25 : 1; ctx.globalCompositeOperation = 'source-over';
        ctx.font = '900 70px ui-rounded, "Arial Rounded MT Bold", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
        ctx.lineWidth = 18; ctx.strokeStyle = INK; ctx.fillStyle = INK;
        ctx.strokeText(o.text, 5, 7); ctx.fillText(o.text, 5, 7); ctx.strokeText(o.text, 0, 0); ctx.fillStyle = o.color; ctx.fillText(o.text, 0, 0);
      }
    }
  }
  // draw every flipbook once before play so the first blow does not hitch
  function warm() { for (let i = 0; i < 10; i++) fireTex(i, 10); for (let i = 0; i < 6; i++) { puffTex('dust', i); puffTex('smoke', i); } for (let i = 0; i < 3; i++) { burstTex('#ffd23d', i); burstTex('#e8442a', i, true); burstTex('#ffd23d', i, true); } ringTex('#fff6d8'); ringTex('#ff9a3a'); softTex(); }
  // kick: screen shake for an impact that draws nothing (a rescue, a bolt on a wall, a hull hit)
  const kick = (t) => { if (FX.enabled) trauma = Math.min(1, trauma + t); };
  const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  return { enabled: true, words: true, mp: false, timeScale: 1, shake: 0, shakeScale: reduced ? 0.3 : 1, pow, boom, splat, kick, frame, warm, clear() { items.length = 0; trauma = 0; stopT = slowT = 0; }, get count() { return items.length; } };
})();
