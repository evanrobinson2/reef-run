// title-fx.html: the pick board for Reef Run's title text effects (titlefx.js, INTRO.md "Title FX"). Each style plays the date card
// slam and the 3-2-1-GO countdown over a still of Frame 0 (the live scene in the game), all on one Soaring Melody playhead that
// loops the song's first bars, exactly as a run started at song 0 plays them.
// ?strip=<style> renders a contact strip of that style instead (for the report shots); ?rm=1 previews reduced motion.
(() => {
  const FX = TITLEFX, QS = new URLSearchParams(location.search), D = document;
  const STY = FX.NAMES, PL = FX.plan(0, true), LOOP = FX.B(PL.k + 4);
  let rm = QS.get('rm') === '1' || FX.RM;
  const bg = new Image(); bg.src = 'music/title-fx-frame0.jpg';
  // one frame of the in-game start at song time t (Start at song 0): the slam on beats 2-4, then 3 2 1 and GO on beat 8
  function paint(g, w, h, style, t) {
    g.clearRect(0, 0, w, h);
    if (bg.complete && bg.naturalWidth) g.drawImage(bg, 0, 0, w, h); else { g.fillStyle = '#0d2a33'; g.fillRect(0, 0, w, h); }
    FX.slam(g, w, h, style, t - PL.slam, { rm });
    for (let n = FX.COUNT; n >= 0; n--) FX.count(g, w, h, style, n, t - FX.B(PL.k - n), { rm });
  }

  if (QS.has('strip')) { // contact strip: 10 moments, two rows
    const style = QS.get('strip'), B = FX.B, T = [[B(2) - 0.04, 'approach'], [B(2) + 0.0, 'REEF RUN hit'], [B(2) + 0.25, 'pump'], [B(3) + 0.02, 'date line hit'], [B(4) + 0.05, 'beat 3'],
      [B(4) + 0.33, 'exit'], [B(5) + 0.01, '3 (hit)'], [B(6) + 0.15, '2'], [B(8) + 0.01, 'GO! (hit)'], [B(8) + 0.4, 'GO!']];
    const fw = 480, fh = 270, pad = 10, top = 36, c = D.createElement('canvas'); c.width = 5 * fw + 6 * pad; c.height = top + 2 * (fh + 24) + pad * 2;
    D.body.style.cssText = 'margin:0;background:#111'; D.body.appendChild(c);
    const go = () => {
      const g = c.getContext('2d'), f = D.createElement('canvas'); f.width = fw; f.height = fh; const fg = f.getContext('2d');
      g.fillStyle = '#16161c'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = '#fff'; g.font = '700 20px system-ui'; g.fillText('Reef Run title FX · ' + (FX.styles[style] || {}).name + (rm ? ' · reduced motion' : '') + '  (song time, s)', pad, 25);
      T.forEach(([t, lab], i) => { const x = pad + (i % 5) * (fw + pad), y = top + Math.floor(i / 5) * (fh + 24); paint(fg, fw, fh, style, t); g.drawImage(f, x, y); g.fillStyle = '#c8d0d8'; g.font = '500 14px ui-monospace,Menlo,monospace'; g.fillText(t.toFixed(2) + ' s  ' + lab, x, y + fh + 17); });
      D.title = 'strip-ready';
    };
    Promise.all([FX.fonts(), new Promise((r) => { if (bg.complete) r(); bg.onload = bg.onerror = r; })]).then(() => setTimeout(go, 200));
    return;
  }

  const css = `:root{--bg:#0c0d12;--fg:#eef1f5;--mut:#9aa4b0;--line:#262a33;--acc:#ffe14d}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,-apple-system,sans-serif}
header{padding:16px 16px 8px;max-width:1500px;margin:0 auto}h1{margin:0 0 4px;font-size:22px}header p{margin:0;color:var(--mut);max-width:900px}
.bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px 16px;max-width:1500px;margin:0 auto;position:sticky;top:0;background:var(--bg);z-index:2;border-bottom:1px solid var(--line)}
button,label.t{font:600 14px system-ui;padding:8px 14px;border-radius:9px;border:1px solid #3a404c;background:#181b22;color:var(--fg);cursor:pointer}
button[aria-pressed=true]{background:var(--acc);color:#111;border-color:var(--acc)}#play{background:#ff3e8a;border-color:#ff3e8a;color:#fff;min-width:96px}
#clock{font:600 14px ui-monospace,Menlo,monospace;color:var(--mut);margin-left:auto}#pips{display:flex;gap:5px}#pips i{width:10px;height:10px;border-radius:50%;background:#333}#pips i.on{background:var(--acc)}
main{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,560px),1fr));gap:16px;padding:16px;max-width:1500px;margin:0 auto}
main.one{grid-template-columns:1fr}figure{margin:0;background:#14161c;border:1px solid var(--line);border-radius:12px;overflow:hidden}main.one figure:not(.sel){display:none}
canvas{display:block;width:100%;aspect-ratio:16/9;background:#000}figcaption{padding:10px 14px 14px}figcaption b{font-size:17px}figcaption p{margin:4px 0 8px;color:var(--mut)}
figcaption a{color:var(--acc);font-weight:600;margin-right:14px}code{font:13px ui-monospace,Menlo,monospace;background:#20242c;padding:2px 6px;border-radius:5px}`;
  D.head.appendChild(Object.assign(D.createElement('style'), { textContent: css }));
  D.body.innerHTML = `<header><h1>Reef Run · title FX board</h1><p>Each style plays the in-game start on the song (Soaring Melody, 138 BPM): the music hits, REEF RUN / THE ASTEROID BELT · 2189 slams in on beats 2 and 3, then 3 2 1 GO! one per beat, GO on the bar downbeat at 3.53 s, when control starts. Pick one: the game takes <code>?titlefx=name</code> or the command <code>titlefx name</code>. Press Play for sound.</p></header>
<div class="bar"><button id="play">▶ Play</button><button data-v="all" aria-pressed="true">All</button>${STY.map((s) => `<button data-v="${s}" aria-pressed="false">${FX.styles[s].name}</button>`).join('')}<label class="t"><input type="checkbox" id="rm"${rm ? ' checked' : ''}> Reduced motion</label><span id="pips"><i></i><i></i><i></i><i></i></span><span id="clock">0.00 s</span></div>
<main>${STY.map((s) => `<figure data-s="${s}"><canvas width="1280" height="720"></canvas><figcaption><b>${FX.styles[s].name}</b>${s === FX.DEFAULT ? ' <small>(game default)</small>' : ''}<p>${FX.styles[s].blurb}</p><a href="reef-run.html?titlefx=${s}&title=on">Play in game ›</a><code>titlefx ${s}</code></figcaption></figure>`).join('')}</main>`;
  const au = new Audio('music/soaring-melody.mp3'); au.preload = 'auto';
  const cvs = [...D.querySelectorAll('figure')].map((f) => ({ s: f.dataset.s, c: f.querySelector('canvas'), f })), main = D.querySelector('main'), clock = D.getElementById('clock'), pips = [...D.querySelectorAll('#pips i')];
  let wall = 0, last = performance.now(), view = 'all';
  D.getElementById('play').onclick = (e) => { if (au.paused) { au.play().catch(() => {}); e.target.textContent = '❚❚ Pause'; } else { au.pause(); e.target.textContent = '▶ Play'; } };
  D.getElementById('rm').onchange = (e) => { rm = e.target.checked; };
  for (const b of D.querySelectorAll('.bar [data-v]')) b.onclick = () => { view = b.dataset.v; for (const x of D.querySelectorAll('.bar [data-v]')) x.setAttribute('aria-pressed', String(x === b)); main.className = view === 'all' ? '' : 'one'; for (const v of cvs) v.f.classList.toggle('sel', v.s === view); };
  FX.fonts();
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    let t; if (!au.paused && au.readyState >= 2) { t = au.currentTime; if (t >= LOOP) { au.currentTime = 0; t = 0; } } else { wall = (wall + (au.paused ? dt : 0)) % LOOP; t = au.paused ? wall : au.currentTime; }
    if (!au.paused) wall = t;
    clock.textContent = t.toFixed(2) + ' s · beat ' + Math.max(0, Math.floor(FX.beatOf(t)));
    const bn = Math.floor(FX.beatOf(t)); pips.forEach((p, i) => p.classList.toggle('on', bn >= 0 && (bn & 3) === i));
    for (const v of cvs) { if (view !== 'all' && v.s !== view) continue; const r = v.c.getBoundingClientRect(); if (r.bottom < 0 || r.top > innerHeight) continue; paint(v.c.getContext('2d'), v.c.width, v.c.height, v.s, t); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  window.board = { paint, get t() { return au.currentTime; }, seek(t) { au.currentTime = t; wall = t; } };
})();
