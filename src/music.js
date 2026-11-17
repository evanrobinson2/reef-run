// ============================================================================
// music.js: the reality device's music blends (GAME_API.md "Realms" → Music). carpetshark: "a fabulous way to blend the music scores".
// One WebAudio graph, audio processing only (no synthesised sound, INVARIANTS.md §3):
//   deck (an <audio> element) → high-pass → low-pass → gain ─┬→ bus → [insert slot] → duck → master → destination
//                                                  └→ echo send → delay ⟲ feedback → echo gain → bus
// Two decks swap roles. Blends, quantised to the outgoing track's next bar line (music-map.js beat maps):
//   'bass' (C, change track): 2 bars. The incoming track starts on an entry point, high-passed, tempo-nudged (playbackRate,
//          at most ±6 %) toward the outgoing tempo; the outgoing one is low-passed down and faded; at the half-way bar line the
//          low end swaps (incoming high-pass opens, outgoing high-pass closes); the master ducks gently during the overlap.
//   'dub'  (Z, warp): the outgoing track gets a delay tail and a rising high-pass as the tunnel opens; the new realm's track
//          lands on an entry point at the tunnel exit.
//   'fade' (reduced motion): a plain 2-bar crossfade.
// The music volume setting is read every frame. MUSIC.insert(inNode, outNode) puts a processor (e.g. a time-stop pitch-drop
// and low-pass) between the bus and the duck; MUSIC.ctx, MUSIC.bus, MUSIC.decks are exposed for that.
// Catalogue tracks from another origin play through the graph only when that server sends CORS headers; otherwise they fade
// by element volume (the filters are skipped), so they are never silent.
// ============================================================================
const MUSIC = (() => {
  const MAP = typeof MUSIC_MAP !== 'undefined' ? MUSIC_MAP : {};
  const REDUCED = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let ctx = null, bus = null, duck = null, master = null, insIn = null, insOut = null, vol = 0.5;
  const decks = [], track = [null, null]; let live = 0, active = false, pending = null;
  const pos = {}; // where each track was left (s)
  function graph() {
    if (ctx) return true;
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return false; }
    bus = ctx.createGain(); duck = ctx.createGain(); master = ctx.createGain(); master.gain.value = vol;
    bus.connect(duck); duck.connect(master); master.connect(ctx.destination);
    for (let i = 0; i < 2; i++) {
      const el = new Audio(); el.preload = 'auto'; el.loop = true; el.crossOrigin = 'anonymous';
      const src = ctx.createMediaElementSource(el), hp = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
      hp.type = 'highpass'; hp.frequency.value = 10; hp.Q.value = 0.7; lp.type = 'lowpass'; lp.frequency.value = 20000; lp.Q.value = 0.7; g.gain.value = 0;
      const send = ctx.createGain(), dl = ctx.createDelay(2), fb = ctx.createGain(), wet = ctx.createGain(); send.gain.value = 0; fb.gain.value = 0.5; wet.gain.value = 0.7;
      src.connect(hp); hp.connect(lp); lp.connect(g); g.connect(bus); lp.connect(send); send.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(wet); wet.connect(bus);
      decks.push({ el, src, hp, lp, g, send, dl, fb, wet, id: '', graph: true });
    }
    const pe = new Audio(); pe.preload = 'auto'; pe.loop = true; decks.push({ el: pe, id: '', graph: false, v: 0 }); // deck 2: another origin's track, by element volume
    return true;
  }
  const info = (id) => MAP[id] || null;
  const now = () => ctx.currentTime;
  // the outgoing deck's next bar line (s from now), or a half-second grid without a beat map
  function nextBar(d) {
    const m = info(d.id), t = d.el.currentTime;
    if (!m || d.el.paused) return 0.05;
    const bar = 240 / m.bpm / (d.el.playbackRate || 1), ph = (t - m.t0) / (240 / m.bpm);
    let w = (Math.ceil(ph + 1e-3) - ph) * bar; if (w < 0.12) w += bar; return w;
  }
  const barLen = (id) => { const m = info(id); return m ? 240 / m.bpm : 2; };
  // where the incoming track enters: where it was left (snapped to a bar line) or its next entry point
  function entry(id, opt) {
    const m = info(id);
    if (!m) return pos[id] || 0;
    if (opt && opt.resume && pos[id] != null) { const bar = 240 / m.bpm; return m.t0 + Math.round((pos[id] - m.t0) / bar) * bar; }
    const E = m.entries, k = (entry.k = ((entry.k || 0) + 1) % E.length); return opt && opt.first ? E[0] : E[k];
  }
  const setP = (p, v, t) => { p.cancelScheduledValues(t); p.setValueAtTime(v, t); };
  const ramp = (p, v, t) => p.linearRampToValueAtTime(v, t);
  const xramp = (p, v, t) => p.exponentialRampToValueAtTime(Math.max(1e-4, v), t);
  const foreign = (url) => { try { return new URL(url, location.href).origin !== location.origin; } catch { return false; } };
  function fadeEl(d, to, dur, delay = 0) { // an element-volume fade for deck 2 (no allocation per step beyond the timer)
    const t0 = performance.now() + delay * 1000, from = d.v; clearInterval(d.timer);
    d.timer = setInterval(() => { const k = Math.min(1, Math.max(0, (performance.now() - t0) / (dur * 1000))); d.v = from + (to - from) * k; d.el.volume = Math.max(0, Math.min(1, d.v * vol)); if (k >= 1) clearInterval(d.timer); }, 40);
  }
  function load(d, id, url) {
    if (d.id === id && d.el.src) return;
    d.id = id; d.el.src = new URL(url, location.href).href; d.el.load();
  }
  const M = {
    REDUCED, get ctx() { return ctx; }, get bus() { return bus; }, get decks() { return decks; }, get active() { return active; },
    get current() { return decks[live] ? decks[live].id : ''; },
    // the playhead of the live deck (s), -1 when silent
    clock() { const d = decks[live]; return active && d && !d.el.paused ? d.el.currentTime : -1; },
    volume(v) { if (v === vol) return; vol = v; if (master) master.gain.setTargetAtTime(v, now(), 0.05); if (decks[2]) decks[2].el.volume = Math.max(0, Math.min(1, decks[2].v * v)); },
    // tape-slow the live deck (Reality Pulse time-stop): playbackRate with the pitch sagging; 1 restores it
    tape(rate) { const d = decks[live]; if (!d) return; try { d.el.preservesPitch = rate >= 1; d.el.playbackRate = Math.max(0.1, Math.min(1, rate)); } catch {} },
    // put a processor between the bus and the duck (null restores the direct path)
    insert(a, b) { if (!ctx) graph(); bus.disconnect(); if (insOut) insOut.disconnect(); insIn = a; insOut = b; if (a && b) { bus.connect(a); b.connect(duck); } else bus.connect(duck); },
    // take over from another player (the shell's own element): start `id` at time `at` straight away
    start(id, url, at, vol0) {
      if (!graph()) return false; if (vol0 != null) M.volume(vol0); if (ctx.state === 'suspended') ctx.resume();
      if (foreign(url)) live = 2; else if (live === 2) live = 0;
      const d = decks[live]; load(d, id, url); try { d.el.currentTime = at || 0; } catch {}
      d.el.playbackRate = 1;
      if (d.graph) { const t = now(); setP(d.g.gain, 1, t); setP(d.hp.frequency, 10, t); setP(d.lp.frequency, 20000, t); setP(d.send.gain, 0, t); } else { d.v = 1; d.el.volume = vol; }
      d.el.play().catch(() => {}); active = true; return true;
    },
    // blend to `id`: mode 'bass' | 'dub' | 'fade'; opt.resume (start where it was left), opt.land (dub: seconds until the drop)
    blend(id, url, mode, opt = {}) {
      if (!graph()) return 0; if (ctx.state === 'suspended') ctx.resume();
      if (REDUCED) mode = 'fade';
      const iIn = foreign(url) ? 2 : live === 0 ? 1 : 0, out = decks[live], inn = decks[iIn], mOut = info(out.id), mIn = info(id);
      if (!out.graph || !inn.graph) mode = 'plain';
      const wait = mode === 'dub' ? 0 : nextBar(out), t0 = now() + wait, bar = mOut ? 240 / mOut.bpm : barLen(id), T = 2 * bar;
      if (out.id) pos[out.id] = out.el.currentTime + wait;
      load(inn, id, url);
      const at = entry(id, opt), seek = () => { try { inn.el.currentTime = at; } catch {} }; seek();
      if (inn.el.readyState < 1) inn.el.addEventListener('loadedmetadata', seek, { once: true }); // a track loaded just now takes the seek once it knows its length
      const rate = mOut && mIn && mode === 'bass' ? Math.min(1.06, Math.max(0.94, mOut.bpm / mIn.bpm)) : 1;
      const tc = now();
      if (mode === 'plain') { // one side plays outside the graph: element volume or gain crossfades over 2 bars
        const dur = T, dly = wait;
        if (inn.graph) { setP(inn.g.gain, 0, tc); setP(inn.hp.frequency, 10, tc); setP(inn.lp.frequency, 20000, tc); setP(inn.send.gain, 0, tc); ramp(inn.g.gain, 0, t0); ramp(inn.g.gain, 1, t0 + dur); } else { inn.v = 0; inn.el.volume = 0; fadeEl(inn, 1, dur, dly); }
        if (out.graph) { setP(out.g.gain, out.g.gain.value, tc); ramp(out.g.gain, out.g.gain.value, t0); ramp(out.g.gain, 0, t0 + dur); } else fadeEl(out, 0, dur, dly);
        setTimeout(() => { inn.el.playbackRate = 1; inn.el.play().catch(() => {}); }, dly * 1000);
        const me = pending = { id }; setTimeout(() => { if (pending === me) { out.el.pause(); pending = null; } }, (dly + dur) * 1000 + 200);
        live = iIn; active = true; return wait;
      }
      for (const P of [inn.g.gain, inn.hp.frequency, inn.lp.frequency, inn.send.gain, out.g.gain, out.hp.frequency, out.lp.frequency, out.send.gain, duck.gain]) P.cancelScheduledValues(tc);
      setP(inn.g.gain, 0, tc); setP(inn.send.gain, 0, tc); setP(inn.lp.frequency, 20000, tc); setP(duck.gain, duck.gain.value, tc);
      setP(out.g.gain, out.g.gain.value, tc); setP(out.hp.frequency, out.hp.frequency.value, tc); setP(out.lp.frequency, out.lp.frequency.value, tc); setP(out.send.gain, out.send.gain.value, tc);
      let tIn = t0;
      if (mode === 'bass') {
        setP(inn.hp.frequency, 380, t0); // incoming: bass removed until the half-way bar line
        ramp(inn.g.gain, 0.9, t0 + bar * 0.75); xramp(inn.hp.frequency, 380, t0 + bar); xramp(inn.hp.frequency, 10, t0 + bar + 0.08); ramp(inn.g.gain, 1, t0 + T);
        xramp(out.lp.frequency, 20000, t0); xramp(out.lp.frequency, 1400, t0 + bar); xramp(out.hp.frequency, 10, t0 + bar); xramp(out.hp.frequency, 380, t0 + bar + 0.08); // the low end swaps
        xramp(out.lp.frequency, 300, t0 + T); ramp(out.g.gain, 0.8, t0 + bar); ramp(out.g.gain, 0, t0 + T);
        ramp(duck.gain, 1, t0); ramp(duck.gain, 0.82, t0 + bar * 0.5); ramp(duck.gain, 0.82, t0 + T - bar * 0.5); ramp(duck.gain, 1, t0 + T);
      } else if (mode === 'dub') { // echo tail and a rising high-pass as the tunnel opens, then the drop at the exit
        const land = opt.land || 1.4, beat = mOut ? 60 / mOut.bpm : 0.4;
        out.dl.delayTime.setValueAtTime(Math.min(1.9, beat * 0.75), tc); out.fb.gain.setValueAtTime(0.55, tc);
        ramp(out.send.gain, 0.9, tc + land * 0.5); xramp(out.hp.frequency, 1800, tc + land * 0.9); ramp(out.g.gain, 0.7, tc + land * 0.6); ramp(out.g.gain, 0, tc + land);
        ramp(out.send.gain, 0, tc + land + 0.05); // the tail rings out through the feedback after the send closes
        setP(inn.hp.frequency, 10, tc); tIn = tc + land; setP(inn.g.gain, 0, tIn); ramp(inn.g.gain, 1, tIn + 0.06);
        ramp(duck.gain, 1, tc); ramp(duck.gain, 0.9, tc + land); ramp(duck.gain, 1, tc + land + 1.5);
      } else { // a plain crossfade over 2 bars
        setP(inn.hp.frequency, 10, t0); ramp(inn.g.gain, 1, t0 + T); ramp(out.g.gain, 0, t0 + T);
      }
      // start the incoming element at its moment (setTimeout is close enough at bar scale), tempo-nudged during the overlap
      const startIn = () => { inn.el.playbackRate = rate; inn.el.play().catch(() => {}); };
      const dIn = Math.max(0, (tIn - now()) * 1000); if (dIn < 8) startIn(); else setTimeout(startIn, dIn);
      const end = (mode === 'dub' ? tIn + 3 : t0 + T) - now();
      const me = pending = { id };
      setTimeout(() => { if (pending !== me) return; out.el.pause(); inn.el.playbackRate = 1; const t = now(); setP(out.send.gain, 0, t); setP(out.g.gain, 0, t); pending = null; }, end * 1000 + 200);
      live = iIn; active = true;
      return wait;
    },
    stop() { for (const d of decks) { d.el.pause(); clearInterval(d.timer); if (d.graph && ctx) setP(d.g.gain, 0, now()); else d.v = 0; } active = false; pending = null; },
    forget() { for (const k in pos) delete pos[k]; entry.k = 0; },
    map: MAP,
  };
  return M;
})();
