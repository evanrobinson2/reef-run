// ============================================================================
// warp.js: the reality-switch transition (GAME_API.md "Realms"). A composite pass over the finished frame (engine G.final):
// a hyperspace tunnel with radial streaks, a barrel bend, a zoom blur and a colour shift from the old realm's palette to the
// new one. While the new realm's pack is resident the engine also renders it (G.realmAux), and the tunnel blends the two
// frames, so the scene swap at the peak is invisible. Reduced motion: a plain crossfade (no streaks, bend or blur).
// Kinds: 'world' (1.5 s, full tunnel), 'style' (0.7 s, a lighter mini-warp with a chromatic glitch), 'fade' (reduced motion).
// No per-frame allocation: params live in the handle's Float32Array(16).
// ============================================================================
const WARP = (() => {
  const REDUCED = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const KINDS = { world: { dur: 1.5, k: 1, peak: 0.5 }, style: { dur: 0.7, k: 0.42, peak: 0.5 }, fade: { dur: 0.9, k: 0, peak: 0.5 } };
  // fp[0] = (k: tunnel strength 0..1, t: seconds, mode: 0 tunnel / 1 glitch / 2 crossfade, mixB: 0..1 how much of tB)
  // fp[1] = old palette rgb, phase (0..1)   fp[2] = new palette rgb, seed   fp[3] = gate ring (ndc x, y, radius, alpha)
  const WGSL = /*wgsl*/`
fn wh(x: f32) -> f32 { return fract(sin(x * 127.1 + 311.7) * 43758.5453); }
fn scene(uv: vec2f, mb: f32) -> vec3f { let q = clamp(uv, vec2f(0.001), vec2f(0.999)); return mix(textureSampleLevel(tA, sL, q, 0.0).rgb, textureSampleLevel(tB, sL, q, 0.0).rgb, mb); }
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = fc.xy * u.res.zw; let k = fp[0].x; let t = fp[0].y; let mode = fp[0].z; let mb = fp[0].w; let ph = fp[1].w;
  if (mode > 1.5 || k <= 0.001) { return vec4f(scene(uv, mb), 1.0); } // reduced motion: a crossfade
  let asp = u.right.w; let c = (uv - 0.5) * vec2f(asp, 1.0); let r = length(c); let a = atan2(c.y, c.x);
  // barrel bend: the frame bulges toward the viewer and is pulled down the tunnel
  let bend = 1.0 - k * 0.32 * (1.0 - min(r * r * 1.6, 1.0));
  let suv = 0.5 + (uv - 0.5) * bend;
  // zoom blur toward the centre (stronger with k), with a chromatic glitch in the style mini-warp
  var acc = vec3f(0.0);
  let gl = select(0.0, k * 0.012 * (0.5 + 0.5 * sin(t * 37.0)), mode > 0.5);
  for (var i = 0; i < 10; i++) {
    let s = 1.0 - k * 0.2 * f32(i) / 9.0; let q = 0.5 + (suv - 0.5) * s;
    acc += vec3f(scene(q + vec2f(gl, 0.0), mb).r, scene(q, mb).g, scene(q - vec2f(gl, 0.0), mb).b);
  }
  var col = acc / 10.0;
  // the palette shift: the old realm's colour while leaving, the new one's arriving
  let pal = mix(fp[1].rgb, fp[2].rgb, smoothstep(0.3, 0.7, ph));
  // tunnel: rings rushing outward and radial streaks (each angle bucket a star line with its own speed)
  let z = 1.0 / max(r, 0.02);
  let rings = pow(0.5 + 0.5 * sin(z * 2.2 - t * 26.0), 8.0) * smoothstep(0.05, 0.5, r);
  let bucket = floor((a / 6.2831853 + 0.5) * 220.0); let h = wh(bucket + fp[2].w * 13.0);
  let run = fract(h * 7.3 + t * (0.9 + 2.4 * h) - r * 0.6);
  let streak = step(0.72, h) * smoothstep(0.0, 0.25, run) * smoothstep(0.6, 0.25, run) * smoothstep(0.08, 0.7, r);
  let wall = smoothstep(0.15, 0.9, r) * (0.55 + 0.45 * sin(a * 6.0 + z * 1.4 - t * 9.0));
  let tunnel = pal * (wall * 0.45 + rings * 0.8) + mix(pal, vec3f(1.0), 0.3) * streak * 1.1;
  col = mix(col, col * 0.35 + tunnel, k * smoothstep(0.0, 0.35, r + 0.25 * k));
  // the flash at the swap and the bright core of the tunnel
  let core = exp(-r * r * 26.0) * k;
  col += mix(pal, vec3f(1.0), 0.35) * (core * 0.7 + k * k * 0.2 * exp(-pow((ph - 0.5) * 9.0, 2.0)));
  // the gate ring (the Tripo reality-switch ring, or its placeholder) as a glowing screen-space halo when no model shows it
  if (fp[3].w > 0.0) { let d = length((uv - 0.5) * vec2f(asp, 1.0) - fp[3].xy * vec2f(asp * 0.5, -0.5)) - fp[3].z; col += pal * fp[3].w * exp(-d * d * 1800.0) * 1.6; }
  return vec4f(clamp(col, vec3f(0.0), vec3f(1.0)), 1.0);
}`;
  let G = null, H = null, ready = null, kind = 'world', t = 0, run = false, peaked = false, onPeak = null, canPeak = null, T0 = 0;
  const fromC = new Float32Array(3), toC = new Float32Array(3);
  const W = {
    REDUCED, KINDS, get active() { return run; }, get phase() { return run ? Math.min(1, t / KINDS[kind].dur) : 0; }, get kind() { return kind; }, get handle() { return H; },
    // compile the composite pass once (async; nothing else waits on it)
    prepare(G_) { G = G_; if (!ready && G.finalPrepare) ready = G.finalPrepare(WGSL).then((h) => { H = h; return h; }).catch((e) => { console.error('WARP ' + e.message); return null; }); return ready; },
    // start a transition: from / to are palette colours (rgb 0..1); peak() runs the swap once canPeak() says the new realm is ready
    // (the tunnel holds at its peak until then); kinds as above. Reduced motion always fades.
    start(k, from, to, peak, can) {
      kind = REDUCED ? 'fade' : k; t = 0; run = true; peaked = false; onPeak = peak; canPeak = can || null; T0 = 0;
      for (let i = 0; i < 3; i++) { fromC[i] = from[i]; toC[i] = to[i]; }
      if (H) H.params[11] = Math.random() * 10;
    },
    // advance (dt s); mixB: how much of the aux frame shows (the caller sets G.realmAux while the new pack is resident)
    step(dt, auxOn, time) {
      if (!run) { if (H && H.on) { H.on = false; } return; }
      const K = KINDS[kind], pk = K.dur * K.peak;
      if (!peaked && t + dt >= pk && canPeak && !canPeak()) t = pk; // hold the peak until the new realm is resident
      else t += dt;
      if (!peaked && t >= pk) { peaked = true; if (onPeak) onPeak(); }
      const ph = Math.min(1, t / K.dur), e = ph < K.peak ? ph / K.peak : (1 - ph) / (1 - K.peak), env = e * e * (3 - 2 * e);
      if (H) {
        const P = H.params; P[0] = K.k * env; P[1] = time; P[2] = kind === 'fade' ? 2 : kind === 'style' ? 1 : 0;
        // before the peak the new realm fades in over the old (when resident); after it the main frame is the new realm
        P[3] = peaked ? 0 : auxOn ? sstep(K.peak * 0.45, K.peak, ph) : 0;
        P[4] = fromC[0]; P[5] = fromC[1]; P[6] = fromC[2]; P[7] = ph; P[8] = toC[0]; P[9] = toC[1]; P[10] = toC[2];
        H.on = true; if (G) G.final = H;
      }
      if (ph >= 1) { run = false; if (H) { H.on = false; H.params[0] = 0; H.params[3] = 0; } }
    },
    gate(nx, ny, rad, a) { if (H) { H.params[12] = nx; H.params[13] = ny; H.params[14] = rad; H.params[15] = a; } },
  };
  return W;
})();
