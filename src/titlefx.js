// Reef Run title text effects (INTRO.md "Title FX"). carpetshark, 2026-11-16: "can you find a better set of text art effects for the title
// screen? .. something more hi fi rush inspired", then "let's get to the sauce immediately". Original comic-book / rhythm-action
// designs (no logos, fonts, characters or assets from that game): outlined display type that slams in on the beat with squash and
// stretch, halftone dot fields, speed lines, action bursts, colour-block panel flashes and misregistered print shadows. Drawn on a
// 2D canvas over the live game and keyed to Soaring Melody's beat grid (measured offline: 138.04 BPM, first beat 0.056 s), so the
// same code drives the game (reefrun.js) and the pick board (title-fx.html). Reduced motion: no squash, shake, flashes or strobing.
const TITLEFX = (() => {
  const BPM = 138.04, P = 60 / BPM, T0 = 0.056;
  const B = (k) => T0 + k * P, beatOf = (t) => (t - T0) / P;
  // The start on the song clock (beat k at B(k)): the title slam takes 3 beats ("REEF RUN" on its first beat, the date line on the
  // next, out by the third), then 3 2 1 one per beat and GO on a bar downbeat. From a Start at song 0: slam on beats 2-4
  // (0.92 s), 3 2 1 on beats 5-7, GO on beat 8 (3.53 s, a strong downbeat).
  const SLAM_BEATS = 3, COUNT = 3;
  const RM = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const TAU = Math.PI * 2;
  const cl = (x, a, b) => (x < a ? a : x > b ? b : x);
  const sm = (x, a, b) => { const t = cl((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const eo = (x) => 1 - Math.pow(1 - cl(x, 0, 1), 3); // ease out cubic
  const eb = (x) => { x = cl(x, 0, 1); const c = 1.9; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); }; // ease out back
  function rng(seed) { let s = (seed >>> 0) || 1; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  // ---- fonts (Google Fonts, lazily; the fallbacks are heavy system faces)
  const FAM = { slam: '"Dela Gothic One"', comic: 'Bangers', speed: '"Russo One"', sticker: '"Lilita One"' };
  const FB = ', Impact, "Arial Black", "Helvetica Neue", system-ui, sans-serif';
  const GF = 'https://fonts.googleapis.com/css2?family=Bangers&family=Dela+Gothic+One&family=Lilita+One&family=Russo+One&display=swap';
  let fontP = null;
  function fonts() {
    if (fontP || typeof document === 'undefined') return fontP || Promise.resolve();
    fontP = new Promise((res) => {
      const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = GF;
      const done = () => { if (!document.fonts) return res(); Promise.all(['slam', 'comic', 'speed', 'sticker'].map((k) => document.fonts.load('64px ' + FAM[k], 'THE ASTEROID BELT 2189 GO!54321').catch(() => {}))).then(() => res(), () => res()); };
      l.onload = done; l.onerror = () => res(); document.head.appendChild(l); setTimeout(res, 4000);
    });
    return fontP;
  }

  // ---- drawing helpers
  // impact transform u s after a hit (u < 0: the approach): stretched tall on the way in, squashed flat on impact, then a damped
  // wobble. Reduced motion: a plain fade, no scale.
  function hit(u, rm, big = 1) {
    if (rm) return { a: sm(u, -0.12, 0.22), s: 1, sx: 1, sy: 1 };
    const A = 0.09;
    if (u < -A) return { a: 0, s: 1, sx: 1, sy: 1 };
    if (u < 0) { const k = -u / A; return { a: 1 - k * k, s: 1 + 1.5 * big * k * k, sx: 1 - 0.2 * k, sy: 1 + 0.35 * k }; }
    const w = Math.exp(-u * 11) * Math.cos(u * 42);
    return { a: 1, s: 1 + 0.06 * Math.exp(-u * 8), sx: 1 + 0.3 * w * big, sy: 1 - 0.3 * w * big };
  }
  // beat pump: 1 on each beat of the slam (u: s since its first beat), decaying through the beat (0 under reduced motion)
  function pump(u, rm) { if (rm || u < 0) return 0; const b = u / P; return Math.exp(-(b - Math.floor(b)) * P * 10); }
  function setFont(g, px, fam, ls) { g.font = `${px.toFixed(1)}px ${fam}${FB}`; if ('letterSpacing' in g) g.letterSpacing = (ls || 0).toFixed(1) + 'px'; }
  function fit(g, s, px, fam, maxW, ls) { g.save(); setFont(g, px, fam, ls); const w = g.measureText(s).width; g.restore(); return w > maxW ? px * maxW / w : px; }
  // outlined display text: optional misregistered colour plates (mis: [dx, dy, c1, c2]), a hard offset shadow (sh: [dx, dy, c]),
  // stroke, fill; skew, rotation and squash/stretch about its centre
  function text(g, s, x, y, px, fam, o) {
    g.save(); g.translate(x, y); if (o.rot) g.rotate(o.rot); if (o.skew) g.transform(1, 0, o.skew, 1, 0, 0); g.scale((o.sx || 1) * (o.s || 1), (o.sy || 1) * (o.s || 1));
    if (o.a != null) g.globalAlpha *= cl(o.a, 0, 1);
    setFont(g, px, fam, o.ls); g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round'; g.miterLimit = 2;
    const lw = o.lw || 0, plate = (c, dx, dy) => { g.fillStyle = c; g.strokeStyle = c; g.lineWidth = lw; if (lw) g.strokeText(s, dx, dy); g.fillText(s, dx, dy); };
    if (o.sh) plate(o.sh[2], o.sh[0], o.sh[1]);
    if (o.mis) { plate(o.mis[2], -o.mis[0], -o.mis[1]); plate(o.mis[3], o.mis[0], o.mis[1]); }
    if (lw) { g.strokeStyle = o.stroke || '#000'; g.lineWidth = lw; g.strokeText(s, 0, 0); }
    if (o.fill) { g.fillStyle = o.fill; g.fillText(s, 0, 0); }
    if (o.inner) { g.strokeStyle = o.inner; g.lineWidth = o.ilw || 2; g.strokeText(s, 0, 0); }
    g.restore();
  }
  // halftone dot field (cached per size): dot radius falls off left to right ('lr'), top to bottom ('tb') or from the centre ('rad')
  const HT = new Map();
  function halftone(w, h, cell, col, mode) {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h)); cell = Math.max(3, Math.round(cell));
    const key = w + ',' + h + ',' + cell + ',' + col + ',' + mode; let c = HT.get(key); if (c) return c;
    if (HT.size > 40) HT.clear();
    c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.fillStyle = col; x.beginPath();
    const D = Math.hypot(w / 2, h / 2);
    for (let j = 0, y = 0; y < h + cell; y += cell * 0.866, j++) for (let X = (j & 1) * cell / 2; X < w + cell; X += cell) {
      const f = mode === 'lr' ? 1 - X / w : mode === 'rl' ? X / w : mode === 'tb' ? 1 - y / h : mode === 'rad' ? 1 - Math.hypot(X - w / 2, y - h / 2) / D : mode === 'ring' ? Math.hypot(X - w / 2, y - h / 2) / D : 0.55;
      const r = cell * 0.52 * cl(f, 0, 1); if (r < 0.4) continue; x.moveTo(X + r, y); x.arc(X, y, r, 0, TAU);
    }
    x.fill(); HT.set(key, c); return c;
  }
  function poly(g, pts) { g.beginPath(); for (let i = 0; i < pts.length; i += 2) i ? g.lineTo(pts[i], pts[i + 1]) : g.moveTo(pts[i], pts[i + 1]); g.closePath(); }
  // a filled shape (the current path) with an optional halftone image clipped inside it and an ink outline
  function shade(g, fill, ht, stroke, lw) {
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (ht) { g.save(); g.clip(); g.globalAlpha *= ht.a ?? 1; g.drawImage(ht.c, ht.x || 0, ht.y || 0); g.restore(); }
    if (stroke && lw) { g.strokeStyle = stroke; g.lineWidth = lw; g.lineJoin = 'round'; g.stroke(); }
  }
  // radial speed lines: thin wedges from r0 to r1 around (cx, cy)
  function rays(g, cx, cy, r0, r1, n, seed, col, a, wd) {
    if (a <= 0.003) return; const R = rng(seed); g.save(); g.globalAlpha *= a; g.fillStyle = col; g.beginPath();
    for (let i = 0; i < n; i++) {
      const an = R() * TAU, hw = (0.25 + R()) * wd, ri = r0 * (0.75 + R() * 0.6), ro = r1 * (0.75 + R() * 0.5), c = Math.cos(an), s = Math.sin(an);
      g.moveTo(cx + c * ri, cy + s * ri); g.lineTo(cx + c * ro - s * hw, cy + s * ro + c * hw); g.lineTo(cx + c * ro + s * hw, cy + s * ro - c * hw); g.closePath();
    }
    g.fill(); g.restore();
  }
  // horizontal speed streaks streaming left (t: time, v: px/s)
  function streaks(g, w, y0, y1, n, seed, col, a, t, v, th) {
    if (a <= 0.003) return; const R = rng(seed); g.save(); g.globalAlpha *= a; g.fillStyle = col;
    for (let i = 0; i < n; i++) { const y = y0 + R() * (y1 - y0), L = (0.08 + R() * 0.35) * w, sp = (0.5 + R()) * v, span = w + L, x = (((R() * span - t * sp) % span) + span) % span - L; g.fillRect(x, y, L, th * (0.35 + R())); }
    g.restore();
  }
  // a jagged action burst (n spikes)
  function burstPath(g, cx, cy, r, n, jag, seed, rot) {
    const R = rng(seed); g.beginPath();
    for (let i = 0; i < n * 2; i++) { const an = rot + (i + (R() - 0.5) * 0.35) / (n * 2) * TAU, rr = i & 1 ? r * (1 - jag * (0.7 + 0.3 * R())) : r * (0.88 + 0.22 * R()); i ? g.lineTo(cx + Math.cos(an) * rr, cy + Math.sin(an) * rr) : g.moveTo(cx + Math.cos(an) * rr, cy + Math.sin(an) * rr); }
    g.closePath();
  }
  function rrect(g, x, y, w, h, r) { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h); }
  // short ink motion strokes around a centre (the comic "shake" marks)
  function marks(g, cx, cy, r, n, seed, col, lw, a) {
    if (a <= 0.003) return; const R = rng(seed); g.save(); g.globalAlpha *= a; g.strokeStyle = col; g.lineWidth = lw; g.lineCap = 'round'; g.beginPath();
    for (let i = 0; i < n; i++) { const an = (i + R() * 0.5) / n * TAU, r0 = r * (1 + R() * 0.15), r1 = r0 + r * (0.12 + R() * 0.18); g.moveTo(cx + Math.cos(an) * r0, cy + Math.sin(an) * r0); g.lineTo(cx + Math.cos(an) * r1, cy + Math.sin(an) * r1); }
    g.stroke(); g.restore();
  }


  // ---------------------------------------------------------------- styles
  // Each style has slam(g, w, h, u, U, rm): the title slam u s after its first beat ("REEF RUN" at 0, the date line at one beat,
  // out over the third beat), and count(g, w, h, n, u, U, rm): n = 3, 2, 1 or 0 for GO, u s after its beat. U: 1 at 1456 x 816.
  const INK = '#0b0b12', L1 = 'REEF RUN', L2 = 'THE ASTEROID BELT · 2189';
  const outOf = (u) => sm(u, 2.05 * P, 2.75 * P); // the slam leaves before the first number's approach
  const countOut = (n, u) => (n ? sm(u, P * 0.7, P) : sm(u, 0.85, 1.3));
  const STY = {
    // A. Beat Slam: heavy gothic type over yellow and magenta colour-block bands slashing in, halftone, CMY misprint plates, bursts
    slam: {
      name: 'Beat Slam', col: '#2de2e6',
      blurb: 'Heavy outlined type slams in on the beat over slashing colour-block bands, with halftone dots, cyan and magenta misprint plates and a burst behind every number.',
      slam(g, w, h, u, U, rm) {
        const f = FAM.slam, cx = w / 2, cy = h * 0.44, u2 = u - P, out = outOf(u), pk = pump(u, rm);
        const e1 = rm ? 1 : eo(u / 0.14), e2 = rm ? 1 : eo(u2 / 0.14), slide = rm ? 0 : out * out * w * 1.3, fade = rm ? 1 - out : 1; // reduced motion: the bands fade in whole
        const yB = cy - 20 * U, yS = cy + 150 * U, sk = 46 * U;
        g.save(); g.globalAlpha = fade;
        if (u > -0.02) { // yellow band from the right behind REEF RUN, burst and speed lines on the hit
          const x2 = w + 60 - (w + 120) * e1 - slide; if (rm) g.globalAlpha = fade * sm(u, -0.12, 0.22);
          if (!rm && u >= 0 && u < 0.5) { const k = Math.exp(-u * 6); rays(g, cx, yB, 140 * U, Math.max(w, h) * 0.8, 50, 216, '#ffffff', 0.75 * k, 10 * U); }
          poly(g, [w + 60 - slide, yB - 120 * U, x2 - sk, yB - 120 * U, x2 + sk, yB + 120 * U, w + 60 - slide, yB + 120 * U]);
          shade(g, '#ffe14d', { c: halftone(w, 244 * U, 15 * U, '#ff3e8a', 'rl'), y: yB - 122 * U, a: 0.35 }, INK, 6 * U);
          if (!rm && u >= 0 && u < 0.45) { const k = Math.exp(-u * 6); burstPath(g, cx, yB, 330 * U * (0.85 + 0.15 * k), 14, 0.35, 99, 0.2); g.globalAlpha = fade * k; shade(g, '#2de2e6', null, INK, 6 * U); g.globalAlpha = fade; }
        }
        if (u2 > -0.02) { // magenta band from the left under the date line
          const x1 = -60 + (w + 120) * e2 + slide; if (rm) g.globalAlpha = fade * sm(u2, -0.12, 0.22); poly(g, [-60 + slide, yS - 52 * U, x1 + sk, yS - 52 * U, x1 - sk, yS + 52 * U, -60 + slide, yS + 52 * U]);
          shade(g, '#ff3e8a', { c: halftone(w, 108 * U, 12 * U, INK, 'lr'), y: yS - 54 * U, a: 0.3 }, INK, 5 * U);
        }
        g.restore();
        const sq = rm ? { sx: 1, sy: 1 } : { sx: 1 + 0.6 * out, sy: 1 - 0.95 * out }, h1 = hit(u, rm, 1.2), h2 = hit(u2, rm), pb = 1 + 0.05 * pk;
        text(g, L1, cx - slide * 0.2, yB + 8 * U, fit(g, L1, 210 * U, f, w * 0.9, 6 * U), f, { fill: '#ffe14d', stroke: INK, lw: 17 * U, mis: [9 * U, 6 * U, '#2de2e6', '#ff3e8a'], sh: [15 * U, 15 * U, INK], skew: -0.1, s: h1.s * pb, sx: h1.sx * sq.sx, sy: h1.sy * sq.sy, a: h1.a * fade, ls: 6 * U });
        if (u2 > -0.1) text(g, L2, cx + slide * 0.2, yS + 2 * U, fit(g, L2, 64 * U, f, w * 0.86, 3 * U), f, { fill: '#ffffff', stroke: INK, lw: 9 * U, mis: [4 * U, 3 * U, '#2de2e6', '#ffe14d'], sh: [7 * U, 7 * U, INK], skew: -0.1, s: h2.s, sx: h2.sx * sq.sx, sy: h2.sy * sq.sy, a: h2.a * fade, ls: 3 * U });
      },
      count(g, w, h, n, u, U, rm) {
        const f = FAM.slam, cx = w / 2, cy = h * 0.46, go = !n, out = countOut(n, u), hx = hit(u, rm, go ? 1.3 : 1), a = hx.a * (1 - out);
        if (a <= 0.003) return;
        const c = go ? '#ff3e8a' : ['', '#ffe14d', '#2de2e6', '#ff3e8a'][n];
        g.save(); g.globalAlpha = a;
        if (!rm && u >= 0) { // colour-block panel flash on the hit
          const k = Math.exp(-u * 9) * (go ? 0.75 : 0.45); g.globalAlpha = a * k; poly(g, [w * 0.18, 0, w * 0.62, 0, w * 0.82, h, w * 0.38, h]); shade(g, c, { c: halftone(w, h, 16 * U, INK, 'rad'), a: 0.35 }, null, 0); g.globalAlpha = a;
          rays(g, cx, cy, 150 * U, Math.max(w, h) * 0.8, go ? 70 : 40, 31 + n, '#ffffff', 0.75 * Math.exp(-u * 4), (go ? 12 : 8) * U);
        }
        const R = (go ? 340 : 215) * U * (rm ? 1 : hx.s * (1 - 0.25 * out));
        burstPath(g, cx, cy, R, go ? 18 : 12, go ? 0.42 : 0.3, 7 * n + 3, n * 0.4); shade(g, c, { c: halftone(R * 2, R * 2, 14 * U, INK, 'ring'), x: cx - R, y: cy - R, a: 0.4 }, INK, 8 * U);
        g.restore();
        const sq = rm ? 1 : 1 - 0.3 * out;
        text(g, go ? 'GO!' : String(n), cx, cy + 8 * U, (go ? 230 : 290) * U, f, { fill: go ? '#ffe14d' : '#ffffff', stroke: INK, lw: 18 * U, mis: [9 * U, 7 * U, '#2de2e6', go ? '#ffffff' : '#ff3e8a'], sh: [16 * U, 16 * U, INK], skew: -0.1, s: hx.s * sq, sx: hx.sx, sy: hx.sy, a });
      },
    },
    // B. Comic Panel: a tilted comic panel with the title in a red action burst, a caption box, Ben-Day dots and a GO!! sound effect
    comic: {
      name: 'Comic Panel', col: '#ffd23f',
      blurb: 'A tilted comic panel punches in with the title on a red action burst full of Ben-Day dots and a yellow caption box; the numbers hit like sound effects, ending on GO!!',
      slam(g, w, h, u, U, rm) {
        const f = FAM.comic, cx = w / 2, cy = h * 0.45, u2 = u - P, out = outOf(u), pk = pump(u, rm);
        const h1 = hit(u, rm, 0.7), h2 = hit(u2, rm, 0.8), drop = rm ? 0 : out * out * h * 1.1, fade = rm ? 1 - out : 1;
        const PW = Math.min(w * 0.86, 1150 * U), PH = Math.min(h * 0.62, 470 * U);
        if (h1.a <= 0.003) return;
        g.save(); g.globalAlpha = fade * h1.a; g.translate(cx, cy + drop); g.rotate(-0.035 + (rm ? 0 : out * 0.3)); g.scale(h1.s, h1.s);
        rrect(g, -PW / 2, -PH / 2, PW, PH, 6 * U); shade(g, '#10306a', { c: halftone(PW, PH, 16 * U, '#2a63d8', 'rad'), x: -PW / 2, y: -PH / 2, a: 1 }, '#fff4d6', 10 * U);
        g.lineWidth = 4 * U; g.strokeStyle = INK; g.stroke();
        if (!rm) rays(g, 0, -20 * U, 200 * U, PW * 0.6, 40, 12, '#fff4d6', 0.25 + 0.3 * pk, 5 * U);
        const R = 230 * U * (1 + 0.05 * pk); g.save(); g.scale(1.9, 1);
        burstPath(g, 0, -24 * U, R * 1.04, 18, 0.28, 1621, 0.1); shade(g, '#fff4d6', null, INK, 3 * U);
        burstPath(g, 0, -24 * U, R * 0.86, 15, 0.26, 2189, 0.25); shade(g, '#e8332a', { c: halftone(R * 2, R * 2, 12 * U, '#a3121c', 'rad'), x: -R, y: -R - 24 * U, a: 1 }, INK, 3 * U);
        g.restore();
        text(g, L1, 0, -18 * U, fit(g, L1, 190 * U, f, PW * 0.8, 8 * U), f, { fill: '#ffffff', stroke: INK, lw: 14 * U, sh: [11 * U, 11 * U, '#1f6fe0'], skew: -0.12, sx: h1.sx, sy: h1.sy, ls: 8 * U });
        if (u2 > -0.1) { // caption box (bottom right)
          const cpx = fit(g, L2, 56 * U, f, PW * 0.7, 3 * U); g.save(); setFont(g, cpx, f, 3 * U); const cw = g.measureText(L2).width + 44 * U; g.restore();
          g.save(); g.globalAlpha *= h2.a; g.translate(PW / 2 - cw / 2 - 18 * U, PH / 2 - 12 * U); g.rotate(-0.025); g.scale(h2.s * h2.sx, h2.s * h2.sy);
          rrect(g, -cw / 2 + 9 * U, -38 * U + 9 * U, cw, 76 * U, 3 * U); g.fillStyle = INK; g.fill();
          rrect(g, -cw / 2, -38 * U, cw, 76 * U, 3 * U); shade(g, '#ffd23f', null, INK, 5 * U);
          text(g, L2, 0, 3 * U, cpx, f, { fill: INK, ls: 3 * U }); g.restore();
        }
        g.restore();
      },
      count(g, w, h, n, u, U, rm) {
        const f = FAM.comic, cx = w / 2, cy = h * 0.46, go = !n, out = countOut(n, u), hx = hit(u, rm, go ? 1.2 : 0.9), a = hx.a * (1 - out);
        if (a <= 0.003) return;
        g.save(); g.globalAlpha = a; g.translate(cx, cy); g.scale(hx.s, hx.s);
        if (go) {
          if (!rm) rays(g, 0, 0, 260 * U, Math.max(w, h), 60, 404, INK, 0.5 * Math.exp(-Math.max(0, u) * 2.5), 7 * U);
          burstPath(g, 0, 0, 330 * U, 18, 0.38, 77, 0); shade(g, '#fff4d6', { c: halftone(660 * U, 660 * U, 15 * U, '#e8332a', 'ring'), x: -330 * U, y: -330 * U, a: 0.8 }, INK, 7 * U);
          text(g, 'GO!!', 0, 10 * U, 250 * U, f, { fill: '#ffd23f', stroke: INK, lw: 16 * U, sh: [14 * U, 14 * U, '#e8332a'], skew: -0.18, rot: -0.06, sx: hx.sx, sy: hx.sy, ls: 6 * U });
        } else {
          const c = n & 1 ? '#e8332a' : '#1f6fe0', dk = n & 1 ? '#a3121c' : '#0e3f9a', R = 190 * U;
          burstPath(g, 0, 0, R * 1.12, 12, 0.3, 50 + n, n * 0.5); shade(g, '#fff4d6', null, INK, 5 * U);
          burstPath(g, 0, 0, R * 0.9, 10, 0.26, 60 + n, n * 0.5 + 0.2); shade(g, c, { c: halftone(R * 2, R * 2, 13 * U, dk, 'rad'), x: -R, y: -R, a: 1 }, INK, 5 * U);
          if (!rm) marks(g, 0, 0, R * 1.18, 12, n, INK, 6 * U, Math.exp(-Math.max(0, u) * 5));
          text(g, String(n), 0, 8 * U, 260 * U, f, { fill: '#ffffff', stroke: INK, lw: 14 * U, sh: [12 * U, 12 * U, '#ffd23f'], skew: -0.12, sx: hx.sx, sy: hx.sy });
        }
        g.restore();
      },
    },
    // C. Speed Rush: raked italic type that rockets in from the side, smeared and stretched, in the reef's teal and amber
    speed: {
      name: 'Speed Rush', col: '#2de2c8',
      blurb: 'Raked italic type rockets in from the side, stretched and smeared with teal and amber trails over streaming speed lines; the numbers zoom out of the vanishing point.',
      slam(g, w, h, u, U, rm) {
        const f = FAM.speed, cx = w / 2, cy = h * 0.44, u2 = u - P, out = outOf(u), pk = pump(u, rm), fade = rm ? 1 - out : 1, zip = rm ? 0 : out * out * w * 1.4;
        const zk = rm ? 0 : out;
        if (!rm && u > -0.1) streaks(g, w, cy - 200 * U, cy + 220 * U, 46, 5, '#d8fff8', (0.25 + 0.35 * pk) * fade * sm(u, -0.1, 0.1), u, 2600 * U, 3 * U);
        const yB = cy - 10 * U, yS = cy + 150 * U;
        const run = (u, from, y, s, px, o) => { // arrive from one side with an overshoot just after the beat, smeared while moving
          if (u < -0.13) return; const v = u + 0.13;
          const e = rm ? 1 : eb(v / 0.2), d = (1 - e) * w * 0.9 * from, sx = rm ? 1 : 1 + 2.4 * cl(1 - v / 0.13, 0, 1) - 0.15 * Math.exp(-Math.max(0, v - 0.13) * 9) * Math.cos((v - 0.13) * 30) * (v > 0.13);
          const a = (rm ? sm(u, -0.1, 0.25) : sm(v, 0, 0.06)) * fade, x = cx + d - zip;
          if (!rm && u < 0.3) for (let i = 3; i >= 1; i--) text(g, s, x + from * i * 34 * U * (1 - sm(v, 0, 0.4)), y, px, f, { ...o, fill: i & 1 ? '#2de2c8' : '#ffb547', lw: 0, sh: null, mis: null, sx: sx * (1 + 0.6 * zk), a: a * 0.35 / i });
          text(g, s, x, y, px, f, { ...o, sx: sx * (1 + 1.2 * zk), a });
        };
        const slab = (uu, y, sw, th, c, dx) => { if (uu < -0.1) return; const e = rm ? 1 : eo((uu - 0.04) / 0.2); sw *= e; g.save(); g.globalAlpha = fade * (rm ? sm(uu, -0.12, 0.22) : 1); poly(g, [cx - sw / 2 - zip + dx, y, cx + sw / 2 - zip + dx, y, cx + sw / 2 - zip, y + th, cx - sw / 2 - zip, y + th]); shade(g, c, null, null, 0); g.restore(); };
        slab(u, yB + 100 * U, Math.min(w * 0.9, 1100 * U), 30 * U, '#ffb547', 60 * U);
        slab(u2, yS + 34 * U, Math.min(w * 0.8, 960 * U), 16 * U, '#ff6a3d', 30 * U);
        run(u, 1, yB, L1, fit(g, L1, 230 * U, f, w * 0.88, 8 * U), { fill: '#ffffff', stroke: '#06131c', lw: 12 * U, mis: [12 * U, 0, '#2de2c8', '#ff6a3d'], sh: [10 * U, 10 * U, '#06131c'], skew: -0.32, ls: 8 * U, s: 1 + 0.04 * pk });
        run(u2, -1, yS, L2, fit(g, L2, 60 * U, f, w * 0.84, 3 * U), { fill: '#ffffff', stroke: '#06131c', lw: 7 * U, mis: [6 * U, 0, '#2de2c8', '#ff6a3d'], skew: -0.32, ls: 3 * U });
      },
      count(g, w, h, n, u, U, rm) {
        const f = FAM.speed, cx = w / 2, cy = h * 0.46, go = !n, out = countOut(n, u);
        const z = rm ? 1 : u < 0 ? 0.15 + 0.85 * Math.pow(1 - cl(-u / 0.09, 0, 1), 2) : 1 + 0.12 * Math.exp(-u * 9) * Math.cos(u * 30), a = (rm ? sm(u, -0.12, 0.22) : sm(u, -0.09, -0.02)) * (1 - out);
        if (a <= 0.003) return;
        const c = go ? '#ff6a3d' : n & 1 ? '#2de2c8' : '#ffb547';
        if (!rm) rays(g, cx, cy, 90 * U, Math.max(w, h) * 0.85, go ? 80 : 50, 900 + n, '#e8fffb', a * (go ? 0.7 : 0.5) * Math.exp(-Math.max(0, u) * 3), (go ? 6 : 4) * U);
        if (go) {
          if (!rm) streaks(g, w, cy - 160 * U, cy + 160 * U, 40, 77, '#ffffff', a * 0.5, u, 3000 * U, 4 * U);
          g.save(); g.globalAlpha = a; const sw = Math.min(w * 0.8, 900 * U); poly(g, [cx - sw / 2 + 40 * U, cy + 96 * U, cx + sw / 2 + 40 * U, cy + 96 * U, cx + sw / 2, cy + 130 * U, cx - sw / 2, cy + 130 * U]); shade(g, '#ff6a3d', null, null, 0); g.restore();
          if (!rm && u < 0.3) for (let i = 3; i >= 1; i--) text(g, 'GO!', cx - i * 50 * U * (1 - sm(u, 0, 0.3)), cy, 270 * U, f, { fill: i & 1 ? '#2de2c8' : '#ffb547', skew: -0.32, sx: 1.4, a: a * 0.3 / i });
          text(g, 'GO!', cx, cy, 270 * U, f, { fill: '#ffffff', stroke: '#06131c', lw: 14 * U, mis: [14 * U, 0, '#2de2c8', '#ff6a3d'], sh: [12 * U, 12 * U, '#06131c'], skew: -0.32, s: z, sx: rm ? 1 : 1 + 0.5 * Math.exp(-Math.max(0, u) * 8), a });
          return;
        }
        if (!rm) for (let i = 4; i >= 1; i--) text(g, String(n), cx, cy, 300 * U, f, { fill: c, skew: -0.3, s: z * (1 - i * 0.09), a: a * 0.22 });
        text(g, String(n), cx, cy, 300 * U, f, { fill: '#ffffff', stroke: '#06131c', lw: 14 * U, mis: [12 * U, 0, '#2de2c8', '#ff6a3d'], sh: [12 * U, 12 * U, c], skew: -0.3, s: z, a });
      },
    },
    // D. Sticker Riff: every title letter is its own cut-out sticker tile, popping on 32nd notes, over a four-pip beat meter
    sticker: {
      name: 'Sticker Riff', col: '#ff5da2',
      blurb: 'Each title letter is a cut-out sticker tile that pops in a quick roll and hops on the beat over a four-pip beat meter; the numbers are big bouncing stickers.',
      slam(g, w, h, u, U, rm) {
        const f = FAM.sticker, cx = w / 2, cy = h * 0.44, u2 = u - P, out = rm ? 0 : outOf(u), fade = rm ? 1 - outOf(u) : 1, pk = pump(u, rm);
        const TC = ['#ffde59', '#ff5da2', '#45d0ff', '#9bff6b', '#ffffff'], R = rng(3), chars = [...L1];
        const px0 = 150 * U, gap0 = px0 * 1.14, sp0 = px0 * 0.5; let W = 0; for (const ch of chars) W += ch === ' ' ? sp0 : gap0;
        const sc = Math.min(1, (w * 0.92) / W), gp = gap0 * sc, ps = px0 * sc; let x = cx - W * sc / 2 + gp / 2, li = 0;
        for (const ch of chars) {
          if (ch === ' ') { x += sp0 * sc; continue; }
          const rot = (R() - 0.5) * 0.36, uu = u - li * P / 8, hx = hit(uu, rm, 0.8), hop = -16 * U * pk * (li & 1 ? 1 : 0.6);
          const fall = out > 0 ? Math.pow(cl(out * 1.6 - li * 0.06, 0, 1), 2) * h * 0.9 : 0;
          if (hx.a > 0.003) {
            const pop = rm ? 1 : 1 + 0.25 * Math.exp(-Math.max(0, uu) * 14);
            g.save(); g.globalAlpha = hx.a * fade; g.translate(x, cy + hop + fall); g.rotate(rot + fall / h * (R() - 0.5) * 2); g.scale(hx.s * hx.sx * pop, hx.s * hx.sy * pop);
            const T = ps * 1.08; rrect(g, -T / 2 + 8 * U, -T / 2 + 9 * U, T, T, T * 0.18); g.fillStyle = INK; g.fill();
            rrect(g, -T / 2, -T / 2, T, T, T * 0.18); shade(g, TC[li % TC.length], null, '#ffffff', Math.max(2, 7 * U * sc));
            text(g, ch, 0, ps * 0.04, ps * 0.86, f, { fill: INK }); g.restore();
          } else R();
          x += gp; li++;
        }
        if (u2 > -0.1) { // the date line: one long sticker label
          const hx = hit(u2, rm, 0.7), px = fit(g, L2, 52 * U, f, w * 0.78, 3 * U); g.save(); setFont(g, px, f, 3 * U); const lw = g.measureText(L2).width + 50 * U; g.restore();
          const fall = out > 0 ? Math.pow(cl(out * 1.3, 0, 1), 2) * h : 0;
          g.save(); g.globalAlpha = hx.a * fade; g.translate(cx, cy + 150 * U + fall); g.rotate(0.02); g.scale(hx.s * hx.sx, hx.s * hx.sy);
          rrect(g, -lw / 2 + 7 * U, -40 * U + 8 * U, lw, 80 * U, 40 * U); g.fillStyle = INK; g.fill(); rrect(g, -lw / 2, -40 * U, lw, 80 * U, 40 * U); shade(g, '#ff5da2', null, '#ffffff', 6 * U);
          text(g, L2, 0, 3 * U, px, f, { fill: '#ffffff', stroke: INK, lw: 6 * U, ls: 3 * U }); g.restore();
        }
        const a = sm(u, 0, 0.15) * fade * (1 - out); if (a > 0.003) { // beat meter: four pips, the current beat lit
          const b = Math.max(0, u) / P, n = Math.floor(b);
          g.save(); g.globalAlpha = a; for (let i = 0; i < 4; i++) { const on = (n & 3) === i, r = (i === 0 ? 15 : 11) * U * (on ? 1 + 0.5 * pk : 1), px = cx + (i - 1.5) * 52 * U, y = cy + 250 * U;
            g.beginPath(); g.arc(px + 4 * U, y + 5 * U, r, 0, TAU); g.fillStyle = INK; g.fill(); g.beginPath(); g.arc(px, y, r, 0, TAU); shade(g, on ? TC[i] : 'rgba(255,255,255,0.25)', null, '#ffffff', 3 * U); }
          g.restore();
        }
      },
      count(g, w, h, n, u, U, rm) {
        const f = FAM.sticker, cx = w / 2, cy = h * 0.46, go = !n, out = countOut(n, u), TC = ['#ffffff', '#9bff6b', '#45d0ff', '#ff5da2'];
        if (go) {
          ['G', 'O', '!'].forEach((ch, i) => {
            const v = u - i * P / 8, hx = hit(v, rm, 1), a = hx.a * (1 - out); if (a <= 0.003) return;
            const x = cx + (i - 1) * 190 * U, T = 200 * U, bob = rm ? 0 : -14 * U * Math.abs(Math.sin(Math.max(0, v) * Math.PI / P)) * Math.exp(-Math.max(0, v) * 1.5);
            g.save(); g.globalAlpha = a; g.translate(x, cy + bob); g.rotate([-0.12, 0.06, 0.16][i]); g.scale(hx.s * hx.sx, hx.s * hx.sy);
            rrect(g, -T / 2 + 9 * U, -T / 2 + 10 * U, T, T, T * 0.2); g.fillStyle = INK; g.fill(); rrect(g, -T / 2, -T / 2, T, T, T * 0.2); shade(g, ['#ffde59', '#ff5da2', '#45d0ff'][i], null, '#ffffff', 8 * U);
            text(g, ch, 0, 8 * U, 170 * U, f, { fill: INK }); g.restore();
          });
          return;
        }
        const hx = hit(u, rm, 1), a = hx.a * (1 - out); if (a <= 0.003) return;
        const R = 165 * U, sp = rm ? 0 : 0.25 * Math.exp(-Math.max(0, u) * 7) * (n & 1 ? 1 : -1);
        g.save(); g.globalAlpha = a; g.translate(cx, cy); g.rotate(sp); g.scale(hx.s * hx.sx, hx.s * hx.sy);
        g.beginPath(); g.arc(10 * U, 12 * U, R, 0, TAU); g.fillStyle = INK; g.fill();
        g.beginPath(); g.arc(0, 0, R, 0, TAU); shade(g, TC[n], { c: halftone(R * 2, R * 2, 14 * U, 'rgba(0,0,0,0.18)', 'ring'), x: -R, y: -R, a: 1 }, '#ffffff', 12 * U);
        text(g, String(n), 0, 10 * U, 250 * U, f, { fill: INK }); g.restore();
      },
    },
  };
  const NAMES = ['slam', 'comic', 'speed', 'sticker'], DEFAULT = 'slam';
  const unit = (w, h) => Math.min(w / 1456, h / 816);
  // the title slam, u s after its first beat (visible from -0.1 s to 3 beats); the caller clears the canvas
  function slam(g, w, h, style, u, o = {}) {
    if (u < -0.12 || u > SLAM_BEATS * P) return;
    (STY[style] || STY[DEFAULT]).slam(g, w, h, u, unit(w, h), o.rm ?? RM);
  }
  // one countdown item: n = 3, 2, 1, or 0 for GO; u = s since its beat (from -0.09 s for the approach). A number lasts one beat,
  // GO about 1.3 s.
  function count(g, w, h, style, n, u, o = {}) {
    if (u < -0.12 || u > (n ? P : 1.35)) return;
    (STY[style] || STY[DEFAULT]).count(g, w, h, n, u, unit(w, h), o.rm ?? RM);
  }
  // the plan for a start whose song time is t0 at Frame 0: GO on the first bar downbeat (beat k, k % 4 == 0) that leaves room for
  // the slam (if any) and the count after t0 + lead. Returns song times.
  function plan(t0, withSlam, lead = 0.3) {
    let k = Math.ceil(beatOf(t0 + lead) - 1e-6) + COUNT + (withSlam ? SLAM_BEATS : 0); while (k % 4) k++;
    return { k, go: B(k), count: B(k - COUNT), slam: withSlam ? B(k - COUNT - SLAM_BEATS) : -1 };
  }
  return { BPM, P, T0, B, beatOf, SLAM_BEATS, COUNT, NAMES, DEFAULT, styles: STY, RM, fonts, slam, count, plan };
})();
