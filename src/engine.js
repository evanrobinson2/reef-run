// ============================================================================
// Space Garden engine: a small WebGPU renderer built on the Abyssal Garden methods
// (https://github.com/Noniv/abyssal-garden, MIT). What it does:
//   Portions are adapted from Abyssal Garden. Copyright (c) 2026 Maksymilian Dendura (Noniv), MIT License:
//   Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
//   documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
//   rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
//   persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice
//   and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS
//   PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
//   MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
//   HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
//   ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
//   - HDR rgba16float with 4x MSAA and a reversed-Z depth32float buffer (infinite far plane)
//   - instanced solids (Mesh vertex format from math.js) plus emissive points
//   - a sky pass, a bloom chain, and a post pass that tone-maps and applies the scene's grade
//   - two-way dynamic resolution from GPU timestamp queries (9.8 to 13.6 ms band)
//   - zero per-frame allocations: all per-frame state lives in F and preallocated arrays
//   - optional depth of field (SC.dof, live override G.dof): a half-resolution scatter-as-gather between the scene and the bloom
// A scene module supplies its WGSL (sky, solid shading, fog, grade) and its geometry.
// ============================================================================
const $ = (id) => document.getElementById(id);
const QS = new URLSearchParams(location.search);
const SHOT = QS.has('shot');
// ?bench=WxH: fixed resolution, no dynamic resolution, hero camera, average GPU time of 120 frames into the title.
// &off=sky,solids,points,bloom,dof skips passes to see what each costs. &dof=focus,range,near,far,maxBlur,bokeh gives any page a depth of field.
const BENCH = QS.get('bench'), OFF = new Set((QS.get('off') || '').split(',')); // ?shot=<pose index>&t=<time>: render one fixed frame at 1456x816 and upload it
const fail = (m) => { throw new Error(m, { cause: 1 }); };

async function runScene(SC) {
  const canvas = $('c'), body = document.body;
  const say = (m) => { $('s').textContent = m; };
  if (!navigator.gpu) fail('This scene needs WebGPU. Try a current Chrome or Edge, or Safari 26.');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) fail('No WebGPU adapter found.');
  const hasTS = adapter.features.has('timestamp-query');
  const device = await adapter.requestDevice({ requiredFeatures: hasTS ? ['timestamp-query'] : [] });
  device.addEventListener('uncapturederror', (e) => console.error('GPU: ' + e.error.message));
  const ctx = canvas.getContext('webgpu'), FMT = navigator.gpu.getPreferredCanvasFormat();
  const Q = device.queue, HDR = 'rgba16float', DEPTH = 'depth32float', AA = 4;
  const TU = GPUTextureUsage, BU = GPUBufferUsage;
  const buf = (data, usage) => { const b = device.createBuffer({ size: (data.byteLength + 3) & ~3, usage: usage | BU.COPY_DST }); Q.writeBuffer(b, 0, data.buffer || data, data.byteOffset || 0, data.byteLength); return b; };
  const tex = (w, h, format, usage, samples = 1) => device.createTexture({ size: [w, h], format, usage, sampleCount: samples });

  // ---------------------------------------------------------------- textured meshes (GLB models), CPU side
  // G.addMesh(model, opts) -> handle { visible, pos[3], q[4], scale, tint[3], emissive[3], emissiveCut, bounds, model }.
  // model: from GLB.load / GLB.parse (glb.js). The handle is read every frame (no allocation): edit its fields in place.
  // opts (all optional, baked into the vertices once): forward / up: the model's forward and up axes ('+x' '-x' '+y' '-y' '+z' '-z';
  // defaults '+z', '+y'), mapped to the engine's +Z forward and +Y up; yaw: extra turn about up (rad); center: true moves the
  // bounding-box centre to the origin, 'bottom' the centre of its floor; plus the initial handle fields. GPU upload happens on
  // the next frame. Pages that never call it run exactly the code they ran before (nothing is created, nothing is drawn).
  const meshList = [], meshNew = [];
  function addMesh(model, o = {}) {
    if (!model || !model.prims) fail('addMesh: expected a model from GLB.load');
    const AX = { '+x': [1, 0, 0], '-x': [-1, 0, 0], '+y': [0, 1, 0], '-y': [0, -1, 0], '+z': [0, 0, 1], '-z': [0, 0, -1] };
    const f = AX[o.forward || '+z'], up = AX[o.up || '+y'];
    if (!f || !up || f[0] * up[0] + f[1] * up[1] + f[2] * up[2] !== 0) fail(`addMesh: forward ${o.forward} and up ${o.up} must be two different axes`);
    const r = [up[1] * f[2] - up[2] * f[1], up[2] * f[0] - up[0] * f[2], up[0] * f[1] - up[1] * f[0]], cy = cos(o.yaw || 0), sy = sin(o.yaw || 0);
    const tf = (x, y, z, out, k) => { const a = x * r[0] + y * r[1] + z * r[2], b = x * up[0] + y * up[1] + z * up[2], c = x * f[0] + y * f[1] + z * f[2]; out[k] = a * cy + c * sy; out[k + 1] = b; out[k + 2] = c * cy - a * sy; };
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity], prims = [];
    for (const p of model.prims) {
      const n = p.pos.length / 3, P = new Float32Array(n * 3), N = new Float32Array(n * 3);
      for (let k = 0; k < n * 3; k += 3) { tf(p.pos[k], p.pos[k + 1], p.pos[k + 2], P, k); tf(p.nrm[k], p.nrm[k + 1], p.nrm[k + 2], N, k); for (let c = 0; c < 3; c++) { mn[c] = min(mn[c], P[k + c]); mx[c] = max(mx[c], P[k + c]); } }
      prims.push({ P, N, p });
    }
    const off = o.center === 'bottom' ? [(mn[0] + mx[0]) / 2, mn[1], (mn[2] + mx[2]) / 2] : o.center ? [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2] : [0, 0, 0];
    let nv = 0, ni = 0; for (const q of prims) { nv += q.P.length / 3; ni += q.p.idx.length; }
    const V = new Float32Array(nv * 8), I = new Uint32Array(ni), ranges = []; let v0 = 0, i0 = 0;
    for (const q of prims) { // interleave: position, normal, uv (32 bytes); one index buffer, one draw range per primitive
      const n = q.P.length / 3;
      for (let k = 0; k < n; k++) { const o8 = (v0 + k) * 8; V[o8] = q.P[k * 3] - off[0]; V[o8 + 1] = q.P[k * 3 + 1] - off[1]; V[o8 + 2] = q.P[k * 3 + 2] - off[2]; V[o8 + 3] = q.N[k * 3]; V[o8 + 4] = q.N[k * 3 + 1]; V[o8 + 5] = q.N[k * 3 + 2]; V[o8 + 6] = q.p.uv[k * 2]; V[o8 + 7] = q.p.uv[k * 2 + 1]; }
      for (let k = 0; k < q.p.idx.length; k++) I[i0 + k] = q.p.idx[k] + v0;
      ranges.push({ first: i0, count: q.p.idx.length, mat: q.p.mat, bg: null });
      v0 += n; i0 += q.p.idx.length;
    }
    const h = { visible: o.visible ?? true, pos: o.pos || [0, 0, 0], q: o.q || [0, 0, 0, 1], scale: o.scale ?? 1, tint: o.tint || [1, 1, 1], emissive: o.emissive || [0, 0, 0], emissiveCut: o.emissiveCut ?? 0.8,
      bounds: { min: mn.map((v, c) => v - off[c]), max: mx.map((v, c) => v - off[c]), size: mx.map((v, c) => v - mn[c]) }, model, nTri: ni / 3, gpu: { V, I, ranges, slot: meshList.length } };
    meshList.push(h); meshNew.push(h);
    return h;
  }

  // ---------------------------------------------------------------- build the scene's content (load time)
  say('Shaping the rocks…'); await new Promise((r) => setTimeout(r, 30));
  const G = SC.build(); // { meshes:[{vb,ib,nv, inst:Float32Array(12/inst)}], points:Float32Array(8/pt), poses:[[x,y,z,yaw,pitch,fovY]], collide?(F) }
  G.addMesh = addMesh; if (typeof GLB !== 'undefined') G.loadGLB = GLB.load; // textured models (glb.js); see "textured meshes" below
  // split screen (GAME_API.md "Split screen"): a game sets G.views.n (2..4), each view's rect (fractions of the frame: x, y, w, h,
  // y down) and camera (x, y, z, yaw, pitch, fovY). The engine renders the scene once per view in one pass (viewport + scissor),
  // and runs the bloom and the grade per view rect (sampling clamped to the rect, so nothing bleeds across the dividers).
  // n < 2 runs the single-view code exactly as before. Written back each frame for the HUD: px (pixel rects), B (bases), aspect.
  // scale: a render-resolution factor while split (the game's quality step); gap: black divider in px at 1080p.
  G.views = { n: 0, rect: new Float32Array(16), cam: new Float64Array(24), px: new Int32Array(16), B: new Float64Array(36), aspect: new Float64Array(4), gap: 4, scale: 1 };
  if (G.onEngine) G.onEngine(G);
  say('Lighting the scene…'); await new Promise((r) => setTimeout(r, 30));

  // ---------------------------------------------------------------- shared WGSL
  const COMMON = /*wgsl*/`
struct U { cam: vec4f, fwd: vec4f, right: vec4f, up: vec4f, sun: vec4f, res: vec4f, p0: vec4f, p1: vec4f };
@group(0) @binding(0) var<uniform> u: U;
fn toClip(p: vec3f) -> vec4f {
  let r = p - u.cam.xyz; let f = 1.0 / u.fwd.w;
  return vec4f(dot(r, u.right.xyz) * f / u.right.w, dot(r, u.up.xyz) * f, u.up.w, dot(r, u.fwd.xyz));
}
fn rayDir(ndc: vec2f) -> vec3f { return normalize(u.fwd.xyz + u.right.xyz * ndc.x * u.fwd.w * u.right.w + u.up.xyz * ndc.y * u.fwd.w); }
fn qrot(q: vec4f, v: vec3f) -> vec3f { let t = 2.0 * cross(q.xyz, v); return v + q.w * t + cross(q.xyz, t); }
fn h31(p: vec3f) -> f32 { var q = fract(p * 0.1031); q += dot(q, q.zyx + 31.32); return fract((q.x + q.y) * q.z); }
fn vn3(p: vec3f) -> f32 {
  let i = floor(p); var f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h31(i), h31(i + vec3f(1, 0, 0)), f.x), mix(h31(i + vec3f(0, 1, 0)), h31(i + vec3f(1, 1, 0)), f.x), f.y),
             mix(mix(h31(i + vec3f(0, 0, 1)), h31(i + vec3f(1, 0, 1)), f.x), mix(h31(i + vec3f(0, 1, 1)), h31(i + vec3f(1, 1, 1)), f.x), f.y), f.z);
}
fn fbm3(p0: vec3f, o: i32) -> f32 { var p = p0; var a = 0.5; var s = 0.0; for (var i = 0; i < o; i++) { s += a * vn3(p); p = p * 2.03 + vec3f(17.1, 31.7, 5.3); a *= 0.5; } return s / (1.0 - 2.0 * a); }
fn sat(x: f32) -> f32 { return clamp(x, 0.0, 1.0); }
`;
  let SCN = COMMON + SC.wgsl; // scene functions: sky(rd), shadeSolid(...), fogApply(col, wp, d), grade(...)

  const mod = (code) => { const m = device.createShaderModule({ code }); m.getCompilationInfo().then((i) => { for (const e of i.messages) if (e.type === 'error') console.error('WGSL ' + e.lineNum + ': ' + e.message + ' | ' + code.split('\n')[e.lineNum - 1]); }); return m; };
  const W_SKY = /*wgsl*/`
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u)); return vec4f(p * 2.0 - 1.0, 0.0, 1.0); }
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let ndc = vec2f(fc.x * u.res.z * 2.0 - 1.0, 1.0 - fc.y * u.res.w * 2.0);
  return vec4f(sky(rayDir(ndc)), 1.0);
}`;
  const mSky = mod(SCN + W_SKY);
  const W_SOLID = /*wgsl*/`
struct VO { @builtin(position) pos: vec4f, @location(0) wp: vec3f, @location(1) n: vec3f, @location(2) aux: f32, @location(3) @interpolate(flat) prm: vec4f, @location(4) lp: vec3f };
@vertex fn vs(@location(0) p: vec3f, @location(1) na: vec4f, @location(2) i0: vec4f, @location(3) i1: vec4f, @location(4) i2: vec4f) -> VO {
  var o: VO;
  var wp = i0.xyz + qrot(i1, p * i0.w);
  wp.y += sin(u.cam.w * 0.9 + i2.y * 6.28) * select(i2.z, 0.0, i2.x > 2.5); // gentle bob (not for painted parts, whose i2.yzw is a colour)
  o.wp = wp; o.n = qrot(i1, na.xyz); o.aux = na.w; o.prm = i2; o.lp = p; o.pos = toClip(wp); return o;
}
@fragment fn fs(i: VO) -> @location(0) vec4f {
  let n = normalize(i.n); // meshes carry outward normals (terrain: field gradient; others: outward winding)
  let c = shadeSolid(i.wp, n, i.aux, i.prm, i.lp);
  return vec4f(fogApply(c, i.wp, length(i.wp - u.cam.xyz)), 1.0);
}`;
  const mSolid = mod(SCN + W_SOLID);
  // realm packs only (G.realmPack): a scene that defines solidVertex(p, na, i0, i1, i2) -> SV { wp, n } places its own solid
  // vertices (wobble, tumble, a wall's heartbeat; realm-body.js). Start-up pipelines and every other pack use W_SOLID unchanged.
  // A mesh may also set nLive (instances to draw, from iFirst; realm-body.js windows its decor and wall chunks along the rail).
  const W_SOLID_V = W_SOLID.replace(/var wp = i0\.xyz[^\n]*\n[^\n]*\n  o\.wp = wp; o\.n = qrot\(i1, na\.xyz\);/, 'let sv = solidVertex(p, na, i0, i1, i2); let wp = sv.wp;\n  o.wp = wp; o.n = sv.n;');
  const W_PTS = /*wgsl*/`
struct P { a: vec4f, b: vec4f }; // a: xyz + size (m), b: rgb emission + motion kind
@group(0) @binding(1) var<storage, read> pts: array<P>;
struct VO { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) c: vec3f };
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VO {
  let q = pts[ii]; var o: VO;
  let cs = array<vec2f, 6>(vec2f(-1, -1), vec2f(1, -1), vec2f(1, 1), vec2f(-1, -1), vec2f(1, 1), vec2f(-1, 1));
  var c = cs[vi]; var wp = q.a.xyz; let t = u.cam.w; let k = q.b.w;
  var glow = 1.0;
  if (k > 3.5 && k < 5.0) { // ghost rail: pulses running forward along it; u.p1.w switches it on (0..1 fades it)
    glow = (0.18 + 0.82 * pow(fract((k - 4.0) * 80.0 - t * 1.2), 5.0)) * sat(u.p1.w);
  } else if (k > 0.5) { wp += pointMotion(wp, k, t); }
  var right = u.right.xyz; var up = u.up.xyz; var sz = vec2f(q.a.w);
  if (k > 2.5 && k < 3.5) { // streak: stretched along its motion
    let dir = normalize(pointMotion(wp, k, t + 0.05) - pointMotion(wp, k, t));
    right = dir; up = normalize(cross(dir, wp - u.cam.xyz)); sz = vec2f(q.a.w * 18.0, q.a.w * 0.6);
  }
  let d = length(wp - u.cam.xyz);
  let minS = d * u.fwd.w * 2.0 * u.res.w * 1.6; // at least ~1.6 px
  let s = max(sz, vec2f(minS));
  let fade = sat(sz.x / minS); // sub-pixel points dim instead of shrinking
  o.pos = toClip(wp + right * c.x * s.x + up * c.y * s.y); o.uv = c;
  o.c = (fogApply(q.b.rgb * fade, wp, d) - fogApply(vec3f(0.0), wp, d)) * glow;
  if (k > 3.5 && k < 5.0) { o.c *= smoothstep(1.5, 5.0, d) * (1.0 - smoothstep(50.0, 110.0, d)); }
  return o;
}
@fragment fn fs(i: VO) -> @location(0) vec4f { let r = 1.0 - dot(i.uv, i.uv); if (r <= 0.0) { discard; } return vec4f(i.c * r * r, 0.0); }`;
  const mPts = mod(SCN + W_PTS);
  const mBlit = mod(/*wgsl*/`
@group(0) @binding(0) var t: texture_2d<f32>; @group(0) @binding(1) var s: sampler;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u)); return vec4f(p * 2.0 - 1.0, 0.0, 1.0); }
@fragment fn down0(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let d = vec2f(textureDimensions(t)); let ts = 1.0 / d; let uv = fc.xy * 2.0 * ts;
  var c = (textureSample(t, s, uv + ts * vec2f(-1, -1)) + textureSample(t, s, uv + ts * vec2f(1, -1)) + textureSample(t, s, uv + ts * vec2f(-1, 1)) + textureSample(t, s, uv + ts * vec2f(1, 1))).rgb * 0.25;
  let l = dot(c, vec3f(0.2126, 0.7152, 0.0722)); c *= clamp((l - 1.0) / 2.0, 0.0, 1.0); // only the bright parts bloom
  return vec4f(min(c, vec3f(64.0)), 1.0);
}
@fragment fn down(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let d = vec2f(textureDimensions(t)); let ts = 1.0 / d; let uv = fc.xy * 2.0 * ts;
  return vec4f((textureSample(t, s, uv + ts * vec2f(-1, -1)) + textureSample(t, s, uv + ts * vec2f(1, -1)) + textureSample(t, s, uv + ts * vec2f(-1, 1)) + textureSample(t, s, uv + ts * vec2f(1, 1))).rgb * 0.25, 1.0);
}
@fragment fn up(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let d = vec2f(textureDimensions(t)); let ts = 1.0 / d; let uv = fc.xy * 0.5 * ts;
  var c = textureSample(t, s, uv).rgb * 4.0;
  c += (textureSample(t, s, uv + ts * vec2f(-1, 0)) + textureSample(t, s, uv + ts * vec2f(1, 0)) + textureSample(t, s, uv + ts * vec2f(0, -1)) + textureSample(t, s, uv + ts * vec2f(0, 1))).rgb * 2.0;
  c += (textureSample(t, s, uv + ts * vec2f(-1, -1)) + textureSample(t, s, uv + ts * vec2f(1, -1)) + textureSample(t, s, uv + ts * vec2f(-1, 1)) + textureSample(t, s, uv + ts * vec2f(1, 1))).rgb;
  return vec4f(c / 16.0, 1.0);
}`);
  const W_POSTH = /*wgsl*/`
@group(0) @binding(1) var sL: sampler; @group(0) @binding(2) var tRes: texture_2d<f32>; @group(0) @binding(3) var tBl: texture_2d<f32>;
@group(0) @binding(4) var tD: texture_depth_multisampled_2d;
fn depthAt(p: vec2i) -> f32 { let d = vec2i(textureDimensions(tD)) - 1; return textureLoad(tD, clamp(p, vec2i(0), d), 0); }
fn hdrAt(uv: vec2f) -> vec3f { return textureSampleLevel(tRes, sL, uv, 0.0).rgb; }
`, W_POSTT = /*wgsl*/`
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u)); return vec4f(p * 2.0 - 1.0, 0.0, 1.0); }
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = fc.xy * u.res.zw; let px = vec2i(fc.xy);
  var c = textureSampleLevel(tRes, sL, uv, 0.0).rgb;
  let bl = textureSampleLevel(tBl, sL, uv, 0.0).rgb;
  return vec4f(grade(c, bl, uv, px, depthAt(px)), 1.0);
}`;
  const mPost = mod(SCN + W_POSTH + SC.post + W_POSTT);

  // ---------------------------------------------------------------- pipelines
  device.pushErrorScope('validation');
  let ubo = device.createBuffer({ size: 128, usage: BU.UNIFORM | BU.COPY_DST }); const UB = new Float32Array(32);
  let ptsBuf = buf(G.points.length ? G.points : new Float32Array(8), BU.STORAGE), nPts = G.points.length / 8;
  const sL = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const depthW = { format: DEPTH, depthWriteEnabled: true, depthCompare: 'greater' };
  const depthR = { format: DEPTH, depthWriteEnabled: false, depthCompare: 'greater' };
  const ms = { count: AA };
  const add = { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } };
  // pipeline descriptors (shared by the start-up pipelines and the realm packs below, G.realmPack)
  const dSky = (m) => ({ layout: 'auto', vertex: { module: m, entryPoint: 'vs' }, fragment: { module: m, entryPoint: 'fs', targets: [{ format: HDR }] },
    depthStencil: { format: DEPTH, depthWriteEnabled: false, depthCompare: 'always' }, multisample: ms });
  const dSolid = (m) => ({ layout: 'auto',
    vertex: { module: m, entryPoint: 'vs', buffers: [
      { arrayStride: 16, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'snorm8x4' }] },
      { arrayStride: 48, stepMode: 'instance', attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x4' }, { shaderLocation: 3, offset: 16, format: 'float32x4' }, { shaderLocation: 4, offset: 32, format: 'float32x4' }] }] },
    fragment: { module: m, entryPoint: 'fs', targets: [{ format: HDR }] }, primitive: { cullMode: 'none' }, depthStencil: depthW, multisample: ms });
  const dPts = (m) => ({ layout: 'auto', vertex: { module: m, entryPoint: 'vs' }, fragment: { module: m, entryPoint: 'fs', targets: [{ format: HDR, blend: add }] }, depthStencil: depthR, multisample: ms });
  const dPost = (m) => ({ layout: 'auto', vertex: { module: m, entryPoint: 'vs' }, fragment: { module: m, entryPoint: 'fs', targets: [{ format: FMT }] } });
  let pSky = device.createRenderPipeline(dSky(mSky));
  let pSolid = device.createRenderPipeline(dSolid(mSolid));
  let pPts = device.createRenderPipeline(dPts(mPts));
  const blitP = (ep, blend) => device.createRenderPipeline({ layout: 'auto', vertex: { module: mBlit, entryPoint: 'vs' }, fragment: { module: mBlit, entryPoint: ep, targets: [{ format: HDR, blend }] } });
  const pDown0 = blitP('down0'), pDown = blitP('down'), pUp = blitP('up', add);
  let pPost = device.createRenderPipeline(dPost(mPost));

  { const err = await device.popErrorScope(); if (err) { console.error('PIPELINE ' + err.message); fail('Shader error: ' + err.message.slice(0, 300)); } }

  // ---------------------------------------------------------------- split screen (created on the first split frame only)
  // The single-view pipelines and WGSL above are untouched. Split views add one field to the uniform struct (vp: the view's
  // pixel origin and 1 / frame size), a sky and a grade that work in view-local pixels, and bloom passes that clamp every tap
  // to the view's rect. Solids, meshes and points reuse their pipelines with a per-view uniform buffer (res = the view's size).
  let MV = null;
  const UBV = new Float32Array(36 * 4), MVR = new Float32Array(4 * 4), mvPx = new Int32Array(16);
  const W_SKYV = /*wgsl*/`
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u)); return vec4f(p * 2.0 - 1.0, 0.0, 1.0); }
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let ndc = vec2f((fc.x - u.vp.x) * u.res.z * 2.0 - 1.0, 1.0 - (fc.y - u.vp.y) * u.res.w * 2.0);
  return vec4f(sky(rayDir(ndc)), 1.0);
}`;
  const W_POSTVH = /*wgsl*/`
@group(0) @binding(1) var sL: sampler; @group(0) @binding(2) var tRes: texture_2d<f32>; @group(0) @binding(3) var tBl: texture_2d<f32>;
@group(0) @binding(4) var tD: texture_depth_multisampled_2d;
fn depthAt(p: vec2i) -> f32 { return textureLoad(tD, clamp(p, vec2i(0), vec2i(u.res.xy) - 1) + vec2i(u.vp.xy), 0); } // view-local pixel
fn hdrAt(uv: vec2f) -> vec3f { return textureSampleLevel(tRes, sL, (clamp(uv * u.res.xy, vec2f(0.5), u.res.xy - 0.5) + u.vp.xy) * u.vp.zw, 0.0).rgb; } // view-local uv
`, W_POSTVT = /*wgsl*/`
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u)); return vec4f(p * 2.0 - 1.0, 0.0, 1.0); }
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let lp = fc.xy - u.vp.xy; let uv = lp * u.res.zw; let px = vec2i(lp);
  let c = hdrAt(uv);
  let bt = 2.0 * u.vp.zw; // one bloom texel (half resolution)
  let bl = textureSampleLevel(tBl, sL, clamp(fc.xy * u.vp.zw, u.vp.xy * u.vp.zw + bt, (u.vp.xy + u.res.xy) * u.vp.zw - bt), 0.0).rgb;
  return vec4f(grade(c, bl, uv, px, depthAt(px)), 1.0);
}`;
  const W_BLITV = /*wgsl*/`
@group(0) @binding(0) var t: texture_2d<f32>; @group(0) @binding(1) var s: sampler; @group(0) @binding(2) var<uniform> R: vec4f; // the view's rect in uv: x0 y0 x1 y1
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u)); return vec4f(p * 2.0 - 1.0, 0.0, 1.0); }
fn tap(uv: vec2f, ts: vec2f) -> vec3f { return textureSample(t, s, clamp(uv, R.xy + ts * 0.5, R.zw - ts * 0.5)).rgb; }
@fragment fn down0(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let d = vec2f(textureDimensions(t)); let ts = 1.0 / d; let uv = fc.xy * 2.0 * ts;
  var c = (tap(uv + ts * vec2f(-1, -1), ts) + tap(uv + ts * vec2f(1, -1), ts) + tap(uv + ts * vec2f(-1, 1), ts) + tap(uv + ts * vec2f(1, 1), ts)) * 0.25;
  let l = dot(c, vec3f(0.2126, 0.7152, 0.0722)); c *= clamp((l - 1.0) / 2.0, 0.0, 1.0);
  return vec4f(min(c, vec3f(64.0)), 1.0);
}
@fragment fn down(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let d = vec2f(textureDimensions(t)); let ts = 1.0 / d; let uv = fc.xy * 2.0 * ts;
  return vec4f((tap(uv + ts * vec2f(-1, -1), ts) + tap(uv + ts * vec2f(1, -1), ts) + tap(uv + ts * vec2f(-1, 1), ts) + tap(uv + ts * vec2f(1, 1), ts)) * 0.25, 1.0);
}
@fragment fn up(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let d = vec2f(textureDimensions(t)); let ts = 1.0 / d; let uv = fc.xy * 0.5 * ts;
  var c = tap(uv, ts) * 4.0;
  c += (tap(uv + ts * vec2f(-1, 0), ts) + tap(uv + ts * vec2f(1, 0), ts) + tap(uv + ts * vec2f(0, -1), ts) + tap(uv + ts * vec2f(0, 1), ts)) * 2.0;
  c += tap(uv + ts * vec2f(-1, -1), ts) + tap(uv + ts * vec2f(1, -1), ts) + tap(uv + ts * vec2f(-1, 1), ts) + tap(uv + ts * vec2f(1, 1), ts);
  return vec4f(c / 16.0, 1.0);
}`;
  const smv = (scn) => scn.replace('p1: vec4f };', 'p1: vec4f, vp: vec4f };');
  let MVB = null; // the split bloom pipelines (scene-independent, shared by every realm pack)
  const dBlitV = (m, ep, blend) => ({ layout: 'auto', vertex: { module: m, entryPoint: 'vs' }, fragment: { module: m, entryPoint: ep, targets: [{ format: HDR, blend }] } });
  function mvInit(pre) { // pre: a realm pack's precompiled split sky and post pipelines (G.realmPack), else they are compiled here
    device.pushErrorScope('validation');
    let pSkyV, pPostV;
    if (pre) { pSkyV = pre.pSky; pPostV = pre.pPost; } else {
      const SMV = smv(SCN);
      const mSkyV = mod(SMV + W_SKYV);
      const mPostV = mod(SMV + W_POSTVH + SC.post + W_POSTVT);
      pSkyV = device.createRenderPipeline(dSky(mSkyV));
      pPostV = device.createRenderPipeline(dPost(mPostV));
    }
    if (!MVB) { const mBlitV = mod(W_BLITV); MVB = { pDown0: device.createRenderPipeline(dBlitV(mBlitV, 'down0')), pDown: device.createRenderPipeline(dBlitV(mBlitV, 'down')), pUp: device.createRenderPipeline(dBlitV(mBlitV, 'up', add)) }; }
    MV = { pSky: pSkyV, pPost: pPostV, pDown0: MVB.pDown0, pDown: MVB.pDown, pUp: MVB.pUp, ubo: [], rb: [], bgSky: [], bgSolid: [], bgPts: [], bgMesh: [], bgPost: [], bgBloom: [], meshL: null };
    for (let v = 0; v < 4; v++) {
      const ub = device.createBuffer({ size: 144, usage: BU.UNIFORM | BU.COPY_DST }), rb = device.createBuffer({ size: 16, usage: BU.UNIFORM | BU.COPY_DST });
      MV.ubo.push(ub); MV.rb.push(rb);
      MV.bgSky.push(device.createBindGroup({ layout: pSkyV.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ub } }] }));
      MV.bgSolid.push(device.createBindGroup({ layout: pSolid.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ub } }] }));
      MV.bgPts.push(device.createBindGroup({ layout: pPts.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ub } }, { binding: 1, resource: { buffer: ptsBuf } }] }));
    }
    device.popErrorScope().then((err) => { if (err) console.error('SPLIT PIPELINE ' + err.message); });
    mvTargets();
  }
  function mvTargets() { // bind groups on the render targets (rebuilt on resize)
    if (!MV) return;
    MV.bgPost.length = 0; MV.bgBloom.length = 0;
    for (let v = 0; v < 4; v++) MV.bgPost.push(device.createBindGroup({ layout: MV.pPost.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: MV.ubo[v] } }, { binding: 1, resource: sL },
      { binding: 2, resource: vRes }, { binding: 3, resource: vBlS[0] }, { binding: 4, resource: vDp }] }));
    for (let k = 0; k < bloomLvl.length; k++) {
      const down = k < NB, p = down ? (k ? MV.pDown : MV.pDown0) : MV.pUp, src = down ? (k ? vBlS[k - 1] : vRes) : vBlS[bloomLvl[k] + 1], row = [];
      for (let v = 0; v < 4; v++) row.push(device.createBindGroup({ layout: p.getBindGroupLayout(0), entries: [{ binding: 0, resource: src }, { binding: 1, resource: sL }, { binding: 2, resource: { buffer: MV.rb[v] } }] }));
      MV.bgBloom.push(row);
    }
  }
  function mvMesh() { // per-view mesh bind groups, once the mesh pipeline exists
    if (!MG || MV.meshL === MG) return; MV.meshL = MG; MV.bgMesh.length = 0;
    for (let v = 0; v < 4; v++) MV.bgMesh.push(device.createBindGroup({ layout: MG.pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: MV.ubo[v] } }] }));
  }
  let bgSky = device.createBindGroup({ layout: pSky.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ubo } }] });
  let bgSolid = device.createBindGroup({ layout: pSolid.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ubo } }] });
  let bgPts = device.createBindGroup({ layout: pPts.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ubo } }, { binding: 1, resource: { buffer: ptsBuf } }] });
  // meshes: GPU buffers; instances are uploaded once (the scene is static apart from shader motion)
  let draws = G.meshes.filter((m) => m.inst.length).map((m) => ({ vb: buf(new Uint8Array(m.vb), BU.VERTEX), ib: buf(m.ib, BU.INDEX), n: m.ib.length, ibuf: buf(m.inst, BU.VERTEX), ni: m.inst.length / 12, m }));
  // realm packs share GPU buffers: geometry by its vertex data, instances by their owner mesh (a realm's skin { vb, ib, owner } draws
  // another geometry with the owner's live instances, so the game's per-frame instance edits show in every realm)
  const vbCache = new Map(), ibCache = new Map();
  for (const d of draws) { vbCache.set(d.m.vb, d); ibCache.set(d.m, d.ibuf); }
  const drawsFor = (list) => list.filter((m) => (m.owner || m).inst.length).map((m) => {
    const own = m.owner || m; let g = vbCache.get(m.vb), ib = ibCache.get(own);
    if (!g) { g = { vb: buf(new Uint8Array(m.vb.buffer || m.vb, m.vb.byteOffset || 0, m.vb.byteLength), BU.VERTEX), ib: buf(m.ib, BU.INDEX) }; vbCache.set(m.vb, g); }
    if (!ib) { ib = buf(own.inst, BU.VERTEX); ibCache.set(own, ib); }
    return { vb: g.vb, ib: g.ib, n: m.ib.length, ibuf: ib, ni: own.inst.length / 12, m: own };
  });

  // ---------------------------------------------------------------- textured meshes, GPU side (created on the first addMesh only)
  // Drawn in the scene pass after the solids, with the same camera (toClip), reversed-Z depth test and MSAA, so they sort
  // against solids and points. Lit by the scene: key light along u.sun (or from it, for scenes whose sun is a position),
  // hemisphere ambient, a rim, an optional emissive mask, then the scene's own fogApply. Lighting values: SCENE.meshLight.
  // Per-mesh data lives in one pooled uniform buffer (256-byte slots, dynamic offsets), staged in one Float32Array and
  // written with one writeBuffer a frame. Textures: rgba8unorm-srgb (the sampler returns linear colour), mipmapped on upload.
  const ML_DEF = { key: [2.0, 1.45, 0.85], point: false, ambUp: [0.07, 0.26, 0.25], ambDown: [0.012, 0.06, 0.056], wrap: 0.15, rim: [0.42, 0.22, 0.084], rimPow: 3, rimBack: 1 };
  let MG = null; // mesh GPU state
  const MESH_WGSL = /*wgsl*/`
struct MU { pos: vec4f, q: vec4f, tint: vec4f, emi: vec4f, key: vec4f, ambU: vec4f, ambD: vec4f, rim: vec4f };
struct MM { color: vec4f, emi: vec4f };
@group(1) @binding(0) var<uniform> m: MU;
@group(2) @binding(0) var<uniform> mat: MM;
@group(2) @binding(1) var tx: texture_2d<f32>;
@group(2) @binding(2) var sm: sampler;
struct MO { @builtin(position) pos: vec4f, @location(0) wp: vec3f, @location(1) n: vec3f, @location(2) uv: vec2f };
@vertex fn vs(@location(0) p: vec3f, @location(1) n: vec3f, @location(2) uv: vec2f) -> MO {
  var o: MO; let wp = m.pos.xyz + qrot(m.q, p * m.pos.w);
  o.wp = wp; o.n = qrot(m.q, n); o.uv = uv; o.pos = toClip(wp); return o;
}
@fragment fn fs(i: MO, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  var n = normalize(i.n); if (!ff) { n = -n; }
  let v = normalize(u.cam.xyz - i.wp);
  let s = select(u.sun.xyz, normalize(u.sun.xyz - i.wp), m.key.w > 0.5);
  let t = textureSample(tx, sm, i.uv).rgb; // linear (sRGB texture)
  let alb = t * mat.color.rgb * m.tint.rgb;
  let dif = sat((dot(n, s) + m.ambD.w) / (1.0 + m.ambD.w));
  let amb = mix(m.ambD.rgb, m.ambU.rgb, sat(n.y * 0.5 + 0.5));
  let rim = pow(1.0 - sat(dot(n, v)), m.rim.w) * mix(1.0, sat(dot(-v, s) + 0.35), m.tint.w) * m.rim.rgb;
  let mask = select(0.0, smoothstep(m.emi.w, min(m.emi.w + 0.12, 1.0), dot(t, vec3f(0.2126, 0.7152, 0.0722))), m.emi.w < 1.0);
  let c = alb * (m.key.rgb * dif + amb) + rim + m.emi.rgb * mask + mat.emi.rgb * t;
  return vec4f(fogApply(c, i.wp, length(i.wp - u.cam.xyz)), 1.0);
}`;
  const MIP_WGSL = /*wgsl*/`
@group(0) @binding(0) var t: texture_2d<f32>; @group(0) @binding(1) var s: sampler;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u)); return vec4f(p * 2.0 - 1.0, 0.0, 1.0); }
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f { return textureSampleLevel(t, s, fc.xy * 2.0 / vec2f(textureDimensions(t)), 0.0); } // a 2x2 box: the bilinear tap between four texels`;
  const dMesh = (m, pl) => ({ layout: pl,
    vertex: { module: m, entryPoint: 'vs', buffers: [{ arrayStride: 32, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' }, { shaderLocation: 2, offset: 24, format: 'float32x2' }] }] },
    fragment: { module: m, entryPoint: 'fs', targets: [{ format: HDR }] }, primitive: { cullMode: 'none' }, depthStencil: depthW, multisample: ms });
  function meshInit() {
    device.pushErrorScope('validation');
    const V = GPUShaderStage.VERTEX, FR = GPUShaderStage.FRAGMENT;
    const l0 = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: V | FR, buffer: { type: 'uniform' } }] });
    const l1 = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: V | FR, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 128 } }] });
    const l2 = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: FR, buffer: { type: 'uniform' } }, { binding: 1, visibility: FR, texture: {} }, { binding: 2, visibility: FR, sampler: {} }] });
    const m = mod(SCN + MESH_WGSL), mm = mod(MIP_WGSL);
    const pl = device.createPipelineLayout({ bindGroupLayouts: [l0, l1, l2] });
    const pipe = device.createRenderPipeline(dMesh(m, pl));
    const mip = device.createRenderPipeline({ layout: 'auto', vertex: { module: mm, entryPoint: 'vs' }, fragment: { module: mm, entryPoint: 'fs', targets: [{ format: 'rgba8unorm-srgb' }] } });
    const smp = device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat', maxAnisotropy: 8 });
    const white = device.createTexture({ size: [1, 1], format: 'rgba8unorm-srgb', usage: TU.TEXTURE_BINDING | TU.COPY_DST });
    Q.writeTexture({ texture: white }, new Uint8Array([255, 255, 255, 255]), { bytesPerRow: 4 }, [1, 1]);
    MG = { l0, pl, l1, l2, pipe, mip, smp, white: white.createView(), bg0: device.createBindGroup({ layout: l0, entries: [{ binding: 0, resource: { buffer: ubo } }] }), cap: 0, ubuf: null, bg1: null, stage: null, texCache: new Map() };
    device.popErrorScope().then((err) => { if (err) console.error('MESH PIPELINE ' + err.message); });
  }
  function meshTexture(img) { // sRGB texture with a full mip chain; the copy keeps the encoded bytes, so sampling decodes them once
    const nm = Math.floor(Math.log2(max(img.width, img.height))) + 1;
    const t = device.createTexture({ size: [img.width, img.height], format: 'rgba8unorm-srgb', mipLevelCount: nm, usage: TU.TEXTURE_BINDING | TU.COPY_DST | TU.RENDER_ATTACHMENT });
    Q.copyExternalImageToTexture({ source: img }, { texture: t }, [img.width, img.height]);
    const sl = device.createSampler({ magFilter: 'linear', minFilter: 'linear' }), e = device.createCommandEncoder();
    for (let i = 1; i < nm; i++) {
      const r = e.beginRenderPass({ colorAttachments: [{ view: t.createView({ baseMipLevel: i, mipLevelCount: 1 }), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
      r.setPipeline(MG.mip); r.setBindGroup(0, device.createBindGroup({ layout: MG.mip.getBindGroupLayout(0), entries: [{ binding: 0, resource: t.createView({ baseMipLevel: i - 1, mipLevelCount: 1 }) }, { binding: 1, resource: sl }] })); r.draw(3); r.end();
    }
    Q.submit([e.finish()]);
    return t.createView();
  }
  function meshUpload() { // load time: buffers, textures and bind groups for meshes added since the last frame
    if (!MG) meshInit();
    if (meshList.length > MG.cap) { // grow the uniform pool (load time only)
      MG.cap = max(8, meshList.length * 2); if (MG.ubuf) MG.ubuf.destroy();
      MG.ubuf = device.createBuffer({ size: MG.cap * 256, usage: BU.UNIFORM | BU.COPY_DST }); MG.stage = new Float32Array(MG.cap * 64);
      MG.bg1 = device.createBindGroup({ layout: MG.l1, entries: [{ binding: 0, resource: { buffer: MG.ubuf, size: 128 } }] });
    }
    for (const h of meshNew) {
      const g = h.gpu, imgs = h.model.images;
      g.vb = buf(g.V, BU.VERTEX); g.ib = buf(g.I, BU.INDEX); g.V = g.I = null;
      for (const rg of g.ranges) {
        const mt = rg.mat, img = mt.tex >= 0 ? imgs[mt.tex] : null;
        let view = MG.white;
        if (img) { view = MG.texCache.get(img); if (!view) { view = meshTexture(img); MG.texCache.set(img, view); } }
        const mu = buf(new Float32Array([...mt.color, ...mt.emissive, 0]), BU.UNIFORM);
        rg.bg = device.createBindGroup({ layout: MG.l2, entries: [{ binding: 0, resource: { buffer: mu } }, { binding: 1, resource: view }, { binding: 2, resource: MG.smp }] });
      }
    }
    meshNew.length = 0;
  }
  function meshFrame() { // stage every visible mesh's uniforms and write them once; returns how many slots are in use
    const L = SC.meshLight, S = MG.stage, gv = (k) => (L && L[k] != null ? L[k] : ML_DEF[k]);
    const key = gv('key'), au = gv('ambUp'), ad = gv('ambDown'), rim = gv('rim'), pt = gv('point') ? 1 : 0, wr = gv('wrap'), rp = gv('rimPow'), rb = gv('rimBack');
    let any = false;
    for (let i = 0; i < meshList.length; i++) {
      const h = meshList[i], o = i * 64; if (!h.visible || !(h.scale > 0)) continue; any = true;
      S[o] = h.pos[0]; S[o + 1] = h.pos[1]; S[o + 2] = h.pos[2]; S[o + 3] = h.scale;
      S[o + 4] = h.q[0]; S[o + 5] = h.q[1]; S[o + 6] = h.q[2]; S[o + 7] = h.q[3];
      S[o + 8] = h.tint[0]; S[o + 9] = h.tint[1]; S[o + 10] = h.tint[2]; S[o + 11] = rb;
      S[o + 12] = h.emissive[0]; S[o + 13] = h.emissive[1]; S[o + 14] = h.emissive[2]; S[o + 15] = h.emissiveCut;
      S[o + 16] = key[0]; S[o + 17] = key[1]; S[o + 18] = key[2]; S[o + 19] = pt;
      S[o + 20] = au[0]; S[o + 21] = au[1]; S[o + 22] = au[2]; S[o + 23] = 0;
      S[o + 24] = ad[0]; S[o + 25] = ad[1]; S[o + 26] = ad[2]; S[o + 27] = wr;
      S[o + 28] = rim[0]; S[o + 29] = rim[1]; S[o + 30] = rim[2]; S[o + 31] = rp;
    }
    if (any) Q.writeBuffer(MG.ubuf, 0, S.buffer, 0, meshList.length * 256);
    return any;
  }
  const dynOff = [0];

  // ---------------------------------------------------------------- glow lines (opt-in: G.lines; created on the first frame that has it)
  // G.lines = { data: Float32Array(cap * 16), n, ghost, scan, scanRate }. A game writes n segments into data each frame, 16 floats each:
  //   p0.xyz, half-width0 (m) · p1.xyz, half-width1 (m) · rgb0 (HDR), minimum half-width (px) · rgb1, profile
//   (profile 0: a line, a bright core in a soft glow, facing the camera; 1: a flat band in world space, half-width wide to
//   either side along the horizontal perpendicular (a floor), soft with no core, for translucent fills)
  // Each segment is a camera-facing strip with a soft profile across it, drawn additively in the scene pass after the points,
  // depth-tested against the solids and meshes (reversed-Z, no depth write) so rocks hide it; a second draw with the opposite
  // test adds the hidden parts at `ghost` × their brightness (0 = none), so the line still reads faintly through a rock.
  // Segments behind the camera are clipped; where the minimum pixel width wins, the line dims instead of thickening.
  // `scan` (0..1): screen-space scanline banding, which rolls at `scanRate` (0 = still). Uses the same per-view uniforms in
  // split screen. Pages without G.lines run exactly as before (nothing is created or drawn).
  let LN = null;
  const LNU = new Float32Array(4);
  const W_LINES = /*wgsl*/`
struct LS { a: vec4f, b: vec4f, c: vec4f, d: vec4f };
@group(0) @binding(1) var<storage, read> segs: array<LS>;
@group(0) @binding(2) var<uniform> lp: vec4f; // ghost, scan, scanRate, 0
struct LO { @builtin(position) pos: vec4f, @location(0) v: f32, @location(1) c: vec3f, @location(2) @interpolate(flat) k: f32 };
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> LO {
  let q = segs[ii]; var o: LO;
  let ends = array<f32, 6>(0, 0, 1, 0, 1, 1); let sides = array<f32, 6>(-1, 1, 1, -1, 1, -1);
  let e = ends[vi]; let sd = sides[vi];
  var A = toClip(q.a.xyz); var B = toClip(q.b.xyz); let zn = 0.06;
  o.v = sd; o.k = q.d.w; o.c = vec3f(0.0); o.pos = vec4f(0.0, 0.0, 0.5, 1.0);
  if (q.d.w > 0.5) { // flat band: the corners in world space, the hardware clips it
    let dv = q.b.xyz - q.a.xyz; let sv = normalize(vec3f(dv.z, 0.0, -dv.x) + vec3f(1e-6, 0.0, 0.0));
    o.pos = toClip(select(q.a.xyz, q.b.xyz, e > 0.5) + sv * sd * mix(q.a.w, q.b.w, e)); o.c = mix(q.c.rgb, q.d.rgb, e); return o;
  }
  if (A.w < zn && B.w < zn) { return o; }
  if (A.w < zn) { A = mix(A, B, (zn - A.w) / (B.w - A.w)); }
  if (B.w < zn) { B = mix(B, A, (zn - B.w) / (A.w - B.w)); }
  let half = u.res.xy * 0.5; let na = A.xy / A.w; let nb = B.xy / B.w;
  var d = (nb - na) * half; let L = length(d); d = select(vec2f(1.0, 0.0), d / max(L, 1e-5), L > 1e-4);
  let n = vec2f(-d.y, d.x);
  let P = select(A, B, e > 0.5);
  let hw = mix(q.a.w, q.b.w, e) * half.y / (u.fwd.w * P.w); // world half-width in pixels
  let mn = q.c.w; let w = max(hw, mn);
  let off = n * sd * w / half;
  o.pos = vec4f((P.xy / P.w + off) * P.w, P.z, P.w);
  o.c = mix(q.c.rgb, q.d.rgb, e) * sqrt(sat(hw / max(mn, 1e-3)));
  return o;
}
fn prof(i: LO) -> vec3f {
  let a = 1.0 - i.v * i.v;
  let sl = 1.0 - lp.y * (0.5 + 0.5 * sin(i.pos.y * 1.7 - u.cam.w * lp.z * 7.0));
  return i.c * mix(a * a * 0.75 + pow(a, 10.0) * 0.6, sqrt(a), i.k) * sl;
}
@fragment fn fs(i: LO) -> @location(0) vec4f { return vec4f(prof(i), 0.0); }
@fragment fn fsx(i: LO) -> @location(0) vec4f { return vec4f(prof(i) * lp.x, 0.0); }`;
  let LNL = null; // the lines bind group and pipeline layouts (shared by every realm pack)
  const lnLayout = () => {
    if (LNL) return LNL; const V = GPUShaderStage.VERTEX, FR = GPUShaderStage.FRAGMENT;
    const bl = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: V | FR, buffer: { type: 'uniform' } }, { binding: 1, visibility: V, buffer: { type: 'read-only-storage' } }, { binding: 2, visibility: FR, buffer: { type: 'uniform' } }] });
    return (LNL = { bl, layout: device.createPipelineLayout({ bindGroupLayouts: [bl] }) });
  };
  const dLine = (m, ep, cmp) => ({ layout: lnLayout().layout, vertex: { module: m, entryPoint: 'vs' }, fragment: { module: m, entryPoint: ep, targets: [{ format: HDR, blend: add }] },
    depthStencil: { format: DEPTH, depthWriteEnabled: false, depthCompare: cmp }, multisample: ms });
  function linesInit(pre) { // pre: a realm pack's precompiled line pipelines
    device.pushErrorScope('validation');
    const m = pre ? null : mod(SCN + W_LINES);
    const { bl } = lnLayout(), cap = max(1, G.lines.data.length >> 4);
    const sb = device.createBuffer({ size: cap * 64, usage: BU.STORAGE | BU.COPY_DST }), pb = device.createBuffer({ size: 16, usage: BU.UNIFORM | BU.COPY_DST });
    const bg = (ub) => device.createBindGroup({ layout: bl, entries: [{ binding: 0, resource: { buffer: ub } }, { binding: 1, resource: { buffer: sb } }, { binding: 2, resource: { buffer: pb } }] });
    LN = { pv: pre ? pre.pv : device.createRenderPipeline(dLine(m, 'fs', 'greater')), px: pre ? pre.px : device.createRenderPipeline(dLine(m, 'fsx', 'less')), sb, pb, cap, src: G.lines.data, bg: bg(ubo), bgV: [], bgFor: bg };
    device.popErrorScope().then((err) => { if (err) console.error('LINES PIPELINE ' + err.message); });
  }
  function linesFrame() { // upload this frame's segments; returns how many to draw
    const Lg = G.lines; if (!Lg || !Lg.data) return 0;
    if (!LN || LN.src !== Lg.data) linesInit(curPack && curPack.lnPre);
    const n = min(Lg.n | 0, LN.cap); if (n <= 0 || OFF.has('lines')) return 0;
    Q.writeBuffer(LN.sb, 0, Lg.data.buffer, Lg.data.byteOffset, n * 64);
    LNU[0] = Lg.ghost || 0; LNU[1] = Lg.scan || 0; LNU[2] = Lg.scanRate || 0; Q.writeBuffer(LN.pb, 0, LNU);
    return n;
  }
  function linesDraw(r, bg, n) { r.setBindGroup(0, bg); if (LNU[0] > 0) { r.setPipeline(LN.px); r.draw(6, n); } r.setPipeline(LN.pv); r.draw(6, n); }

  // ---------------------------------------------------------------- render targets (rebuilt on resize)
  const PIXMAX = 2560 * 1440, PIXMIN = 3e5;
  let W = 0, H = 0, DW = 0, DH = 0, pix = PIXMAX;
  let passScene, passPost, bloomPass = [], bloomBG = [], bgPost, targets = [], vRes, vDp;
  let tgtGen = 0, curPack = null; const FIN = { texA: null, texB: null, vA: null, vB: null, bg: null, bgN: null, h: null };
  let qs, qRes, qRead = [], tsW, dof = null, dofMs = 0, vBlS = [], bloomLvl = [], mvScale = 1;
  const NB = 6;
  function resize() {
    if (SHOT) { DW = 1456; DH = 816; } else if (BENCH) { [DW, DH] = BENCH.split('x').map(Number); } else { DW = max(2, round(canvas.clientWidth * devicePixelRatio)); DH = max(2, round(canvas.clientHeight * devicePixelRatio)); }
    let s = SHOT || BENCH ? 1 : min(1, sqrt(pix / (DW * DH)));
    if (mvScale !== 1) s *= mvScale; // split screen quality step (G.views.scale)
    const w = max(2, round(DW * s) & ~1), h = max(2, round(DH * s) & ~1);
    if (w === W && h === H) return;
    W = w; H = h; canvas.width = W; canvas.height = H;
    ctx.configure({ device, format: FMT, alphaMode: 'opaque', usage: TU.RENDER_ATTACHMENT | TU.COPY_SRC });
    for (const t of targets) t.destroy();
    const tMS = tex(W, H, HDR, TU.RENDER_ATTACHMENT, AA), tDp = tex(W, H, DEPTH, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING, AA);
    const tRes = tex(W, H, HDR, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING);
    targets = [tMS, tDp, tRes];
    const bl = [];
    for (let i = 0; i < NB; i++) { const t = tex(max(1, W >> (i + 1)), max(1, H >> (i + 1)), HDR, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING); bl.push(t); targets.push(t); }
    vRes = tRes.createView(); vDp = tDp.createView(); const vBl = bl.map((t) => t.createView());
    passScene = { colorAttachments: [{ view: tMS.createView(), resolveTarget: vRes, loadOp: 'clear', storeOp: 'discard', clearValue: [0, 0, 0, 1] }],
      depthStencilAttachment: { view: tDp.createView(), depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'store' } };
    passPost = { colorAttachments: [{ view: null, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] };
    const att = (v, clear) => ({ colorAttachments: [{ view: v, loadOp: clear ? 'clear' : 'load', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
    const blitBG = (p, v) => device.createBindGroup({ layout: p.getBindGroupLayout(0), entries: [{ binding: 0, resource: v }, { binding: 1, resource: sL }] });
    bloomPass = []; bloomBG = [];
    for (let i = 0; i < NB; i++) { bloomPass.push([att(vBl[i], true), i ? pDown : pDown0]); bloomBG.push(blitBG(i ? pDown : pDown0, i ? vBl[i - 1] : vRes)); }
    for (let i = NB - 1; i > 0; i--) { bloomPass.push([att(vBl[i - 1], false), pUp]); bloomBG.push(blitBG(pUp, vBl[i])); }
    vBlS = vBl; bloomLvl = []; for (let i = 0; i < NB; i++) bloomLvl.push(i); for (let i = NB - 1; i > 0; i--) bloomLvl.push(i - 1); // the level each bloom pass writes
    mvTargets(); tgtGen++; if (FIN.texA) finTargets();
    bgPost = device.createBindGroup({ layout: pPost.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ubo } }, { binding: 1, resource: sL },
      { binding: 2, resource: vRes }, { binding: 3, resource: vBl[0] }, { binding: 4, resource: vDp }] });
    if (dof) dofTargets();
  }
  resize();
  addEventListener('resize', resize);

  // ---------------------------------------------------------------- realm packs (opt-in; GAME_API.md "Realms")
  // A pack is one scene's whole GPU state: its WGSL pipelines (single view, split screen, textured meshes, glow lines), its
  // uniform buffer, its points buffer and its solid draws. G.realmPack(scene, { meshes, points }) compiles one asynchronously
  // (createRenderPipelineAsync, so the frame never waits on the shader compiler); G.realmUse(pack) makes it the scene the
  // engine renders (a swap is a handful of assignments and, after a resize, a few bind groups); G.realmAux = pack also renders
  // that pack into a second offscreen target every frame (scene, bloom and grade: FIN.texB), and G.final (from G.finalPrepare)
  // composites the frame from the main target and that one. Pages that never call these render exactly what they rendered.
  // Shared between packs: the render targets, the textured meshes and their per-mesh uniforms (meshLight is the main pack's
  // during an aux frame), and every instance buffer (keyed by its owner mesh, so the game's live edits show in every pack).
  curPack = { id: SC.id, initial: true, SC, SCN, pSky, pSolid, pPts, pPost, bgSky, bgSolid, bgPts, bgPost, ubo, ptsBuf, nPts, draws, MV, LN, gen: tgtGen, meshPipe: null, meshBg0: null, mvPre: null, lnPre: null, meshPre: null };
  function packSave() { const p = curPack; p.bgPost = bgPost; p.MV = MV; p.LN = LN; p.gen = tgtGen; if (MG) { p.meshPipe = MG.pipe; p.meshBg0 = MG.bg0; } }
  function packLoad(p) {
    SC = p.SC; SCN = p.SCN; pSky = p.pSky; pSolid = p.pSolid; pPts = p.pPts; pPost = p.pPost; bgSky = p.bgSky; bgSolid = p.bgSolid; bgPts = p.bgPts;
    ubo = p.ubo; ptsBuf = p.ptsBuf; nPts = p.nPts; draws = p.draws; MV = p.MV; LN = p.LN; curPack = p;
    if (MG) {
      if (!p.meshPipe) { p.meshPipe = p.meshPre || device.createRenderPipeline(dMesh(mod(SCN + MESH_WGSL), MG.pl)); p.meshBg0 = device.createBindGroup({ layout: MG.l0, entries: [{ binding: 0, resource: { buffer: ubo } }] }); }
      MG.pipe = p.meshPipe; MG.bg0 = p.meshBg0;
    }
    if (p.gen !== tgtGen) { // the render targets changed since this pack last drew: its post and split bind groups
      p.bgPost = device.createBindGroup({ layout: pPost.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ubo } }, { binding: 1, resource: sL },
        { binding: 2, resource: vRes }, { binding: 3, resource: vBlS[0] }, { binding: 4, resource: vDp }] });
      mvTargets(); p.gen = tgtGen;
    }
    bgPost = p.bgPost;
  }
  G.realmPack = async (S2, o = {}) => {
    const scn = COMMON + S2.wgsl, sm = smv(scn), A = (d) => device.createRenderPipelineAsync(d), mL = G.lines ? mod(scn + W_LINES) : null;
    const r = await Promise.all([A(dSky(mod(scn + W_SKY))), A(dSolid(mod(scn + (S2.wgsl.includes('fn solidVertex(') ? W_SOLID_V : W_SOLID)))), A(dPts(mod(scn + W_PTS))), A(dPost(mod(scn + W_POSTH + S2.post + W_POSTT))),
      o.split === false ? null : A(dSky(mod(sm + W_SKYV))), o.split === false ? null : A(dPost(mod(sm + W_POSTVH + S2.post + W_POSTVT))),
      MG ? A(dMesh(mod(scn + MESH_WGSL), MG.pl)) : null, mL ? A(dLine(mL, 'fs', 'greater')) : null, mL ? A(dLine(mL, 'fsx', 'less')) : null]);
    const ub = device.createBuffer({ size: 128, usage: BU.UNIFORM | BU.COPY_DST }), pts = o.points || G.points, pb = buf(pts.length ? pts : new Float32Array(8), BU.STORAGE);
    const p = { id: S2.id, SC: S2, SCN: scn, pSky: r[0], pSolid: r[1], pPts: r[2], pPost: r[3], ubo: ub, ptsBuf: pb, nPts: pts.length / 8, draws: drawsFor(o.meshes || G.meshes),
      MV: null, LN: null, gen: -1, bgPost: null, mvPre: r[4] ? { pSky: r[4], pPost: r[5] } : null, meshPre: r[6], meshPipe: null, meshBg0: null, lnPre: r[7] ? { pv: r[7], px: r[8] } : null };
    p.bgSky = device.createBindGroup({ layout: p.pSky.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ub } }] });
    p.bgSolid = device.createBindGroup({ layout: p.pSolid.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ub } }] });
    p.bgPts = device.createBindGroup({ layout: p.pPts.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ub } }, { binding: 1, resource: { buffer: pb } }] });
    return p;
  };
  G.realmUse = (p) => { if (p && p !== curPack) { packSave(); packLoad(p); } return curPack; };
  G.realmMeshes = (p, list) => { p.draws = drawsFor(list); if (p === curPack) draws = p.draws; }; // a pack's solids changed (load time)
  G.realmPoints = (p, pts) => { Q.writeBuffer(p.ptsBuf, 0, pts.buffer, pts.byteOffset, min(pts.byteLength, p.nPts * 32)); }; // rewrite a pack's whole points buffer
  G.realmInitial = curPack; G.realmAux = null; G.final = null;
  Object.defineProperty(G, 'realm', { get: () => curPack });
  // render the aux pack (same camera, its own scene uniforms) into FIN.texB, then restore the main pack
  const UBS = new Float32Array(16);
  function auxEncode(e, aux, mvN, meshOn, cur) {
    const main = curPack; packSave(); packLoad(aux);
    UBS.set(UB.subarray(16, 32));
    UB[16] = SC.sun[0]; UB[17] = SC.sun[1]; UB[18] = SC.sun[2]; UB[19] = 0;
    for (let k = 0; k < 4; k++) { UB[24 + k] = SC.p0 ? SC.p0[k] : 0; UB[28 + k] = SC.p1 ? SC.p1[k] : 0; }
    Q.writeBuffer(ubo, 0, UB); UB.set(UBS, 16);
    const n = G.lines ? linesFrame() : 0;
    if (mvN) { mvViews(G.views, mvN); mvEncode(e, mvN, meshOn, cur, n, FIN.vB, false); } else encodeSingle(e, meshOn, cur, n, FIN.vB, false);
    packSave(); packLoad(main); if (mvN) mvViews(G.views, mvN);
  }
  // the composite pass (opt-in): G.finalPrepare(wgsl) -> Promise<handle>; set G.final = handle and handle.on = true. The WGSL gets the
  // COMMON helpers, the main pack's uniforms u, and: sL (linear sampler), tA (the main frame, graded), tB (the aux frame, or tA again
  // when no aux), fp: array<vec4f, 4> (handle.params, written every frame) and tD (the main frame's depth, multisampled; 0 = sky).
  // It defines @fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f and draws a full-screen triangle into the canvas.
  const W_FINAL = /*wgsl*/`
@group(0) @binding(1) var sL: sampler; @group(0) @binding(2) var tA: texture_2d<f32>; @group(0) @binding(3) var tB: texture_2d<f32>;
@group(0) @binding(4) var<uniform> fp: array<vec4f, /*NFP*/4>; @group(0) @binding(5) var tD: texture_depth_multisampled_2d;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u)); return vec4f(p * 2.0 - 1.0, 0.0, 1.0); }
`;
  G.finalPrepare = async (wgsl, nfp = 4) => { // nfp: how many vec4 of params (fp) the pass takes (Reality Pulse: 27, with each split view's camera)
    const V = GPUShaderStage.VERTEX, FR = GPUShaderStage.FRAGMENT, l = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: V | FR, buffer: { type: 'uniform' } },
      { binding: 1, visibility: FR, sampler: {} }, { binding: 2, visibility: FR, texture: {} }, { binding: 3, visibility: FR, texture: {} }, { binding: 4, visibility: FR, buffer: { type: 'uniform' } },
      { binding: 5, visibility: FR, texture: { sampleType: 'depth', multisampled: true } }] }); // explicit, so a shader may leave any binding unused
    const pipe = await device.createRenderPipelineAsync({ ...dPost(mod(COMMON + W_FINAL.replace('/*NFP*/4', String(nfp)) + wgsl)), layout: device.createPipelineLayout({ bindGroupLayouts: [l] }) });
    return { pipe, layout: l, buf: device.createBuffer({ size: nfp * 16, usage: BU.UNIFORM | BU.COPY_DST }), params: new Float32Array(nfp * 4), on: false, bg: null, key: '' };
  };
  function finTargets() {
    if (FIN.texA) { FIN.texA.destroy(); FIN.texB.destroy(); }
    FIN.texA = tex(W, H, FMT, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING); FIN.texB = tex(W, H, FMT, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING);
    FIN.vA = FIN.texA.createView(); FIN.vB = FIN.texB.createView(); FIN.gen = (FIN.gen || 0) + 1;
  }
  const finPass = { colorAttachments: [{ view: null, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] };
  function finEncode(e, h, cur, withAux) {
    if (h.bgUbo !== ubo || h.bgGen !== FIN.gen || h.bgAux !== withAux || h.bgDp !== vDp) { // rebuilt only when a target or the pack changes
      h.bg = device.createBindGroup({ layout: h.layout, entries: [{ binding: 0, resource: { buffer: ubo } }, { binding: 1, resource: sL }, { binding: 2, resource: FIN.vA },
        { binding: 3, resource: withAux ? FIN.vB : FIN.vA }, { binding: 4, resource: { buffer: h.buf } }, { binding: 5, resource: vDp }] });
      h.bgUbo = ubo; h.bgGen = FIN.gen; h.bgAux = withAux; h.bgDp = vDp;
    }
    Q.writeBuffer(h.buf, 0, h.params);
    finPass.colorAttachments[0].view = cur.createView();
    const r = e.beginRenderPass(finPass); r.setPipeline(h.pipe); r.setBindGroup(0, h.bg); r.draw(3); r.end();
  }


  // ---------------------------------------------------------------- depth of field (opt-in; nothing here runs without SC.dof or G.dof)
  // SC.dof = { focus, range, near, far, maxBlur, bokeh }; G.dof overrides it field by field, every frame (rack focus). Missing fields: 10, 1, 1, 1, 0.025, 0.5.
  //   focus: focus distance (m). range: half-width of the sharp band (m), so zn = focus - range to zf = focus + range is sharp.
  //   near, far: blur scale in front of and behind the band. Blur radius = maxBlur * min(1, near * (zn - z) / z) in front (full at z = zn / 2 when near = 1)
  //     and maxBlur * min(1, far * (z - zf) / z) behind (the sky, infinitely far, gets maxBlur * min(1, far)). 0 switches that side off.
  //   maxBlur: largest blur radius as a fraction of the screen height (capped at 96 render pixels). 0 switches the effect off for the frame.
  //   bokeh: 0..1, how much bright spots win inside the blur (round highlights instead of a grey average).
  // Method: the Jimenez scatter-as-gather (Call of Duty: Advanced Warfare, SIGGRAPH 2014: half res, 49 + 9 taps, near field spread by tile max),
  // with the one-target near/far tap weights of Unity's post-processing version of it. Ten small passes between the scene resolve and the bloom:
  //   pre      full -> half res: colour + signed CoC (near < 0). The blurrier layer owns each texel. Then 3 mips by the same rule
  //   tmax     largest near CoC in each 8x8 tile; tdil spreads it to every tile that blur can reach, so sharp pixels beside a blurred foreground gather wide enough
  //   gather   37 taps on a disc (centre + rings of 6, 12, 18), from a mip that matches the tap spacing. Background taps count only up to the smaller of
  //            their CoC and the centre's (nothing bleeds onto sharper pixels); foreground taps count wherever their own CoC reaches, weighted by
  //            1 / CoC area, and their coverage becomes alpha
  //   fill     7 taps between the gather's taps (259 effective); soft: a 2x2 tent. Neither reads from a pixel sharper than the one it writes
  //   comp     blended into the resolved colour: by each pixel's own CoC, per MSAA sample (sharp edges keep their antialiasing), and by the near alpha
  // GPU time: F[12] = all ten passes (ms), F[13..22] = each pass; F[10] includes it, so the dynamic resolution accounts for it.
  const DOFU = new Float32Array(8), NDOF = 10;
  if (QS.has('dof') && !isNaN(parseFloat(QS.get('dof')))) { const v = QS.get('dof').split(','), k = ['focus', 'range', 'near', 'far', 'maxBlur', 'bokeh']; SC.dof = {}; for (let i = 0; i < 6; i++) if (v[i]) SC.dof[k[i]] = +v[i]; }
  const dofGet = (k, d) => { const a = G.dof, b = SC.dof; return a && a[k] != null ? a[k] : b && b[k] != null ? b[k] : d; };
  const mDofSrc = /*wgsl*/`
struct DU { a: vec4f, b: vec4f }; // a: near slope, near offset, far slope, far offset (CoC as a fraction of the largest, linear in depth). b: largest radius in half-res pixels, bokeh
@group(0) @binding(0) var<uniform> q: DU;
@group(0) @binding(1) var sL: sampler;
@group(0) @binding(2) var tC: texture_2d<f32>; // resolved scene colour
@group(0) @binding(3) var tD: texture_depth_multisampled_2d;
@group(0) @binding(4) var tH: texture_2d<f32>; // half res: colour, signed CoC
@group(0) @binding(5) var tT: texture_2d<f32>; // near-CoC tiles
@group(0) @binding(6) var tG: texture_2d<f32>; // gathered (then filled) half-res blur, alpha = near coverage
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u)); return vec4f(p * 2.0 - 1.0, 0.0, 1.0); }
fn sat(x: f32) -> f32 { return clamp(x, 0.0, 1.0); }
fn coc(d: f32) -> f32 { return sat(q.a.w - d * q.a.z) - sat(d * q.a.x - q.a.y); } // signed: -1 nearest .. 0 sharp .. 1 far (depth 0 = sky)
fn own(c: f32) -> f32 { return smoothstep(0.5, 2.5, abs(c) * q.b.x * 2.0); } // a pixel's own CoC -> how much of the blurred image replaces it (radius in full-res pixels)
fn kr(fc: vec2f, c: f32) -> f32 { return max(max(c, 0.0), textureSampleLevel(tT, sL, fc / (8.0 * vec2f(textureDimensions(tT))), 0.0).r) * q.b.x; } // gather radius, half-res pixels
@fragment fn pre(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let p = vec2i(fc.xy) * 2;
  let k = vec4f(coc(textureLoad(tD, p, 0)), coc(textureLoad(tD, p + vec2i(1, 0), 0)), coc(textureLoad(tD, p + vec2i(0, 1), 0)), coc(textureLoad(tD, p + vec2i(1, 1), 0)));
  let lo = min(min(k.x, k.y), min(k.z, k.w)); let hi = max(max(k.x, k.y), max(k.z, k.w));
  let c = select(hi, lo, -lo > hi); // the blurrier layer owns the texel, so a sharp edge never tints the blur around it
  let w = clamp(vec4f(1.0) - abs(k - vec4f(c)) * q.b.x, vec4f(0.0), vec4f(1.0));
  let col = (textureLoad(tC, p, 0).rgb * w.x + textureLoad(tC, p + vec2i(1, 0), 0).rgb * w.y + textureLoad(tC, p + vec2i(0, 1), 0).rgb * w.z + textureLoad(tC, p + vec2i(1, 1), 0).rgb * w.w) / (w.x + w.y + w.z + w.w);
  return vec4f(min(col, vec3f(64.0)), c);
}
@fragment fn mip(@builtin(position) fc: vec4f) -> @location(0) vec4f { // the next mip of the half-res image, by the same rule as pre
  let p = vec2i(fc.xy) * 2; let d = vec2i(textureDimensions(tH)) - 1;
  let a = textureLoad(tH, min(p, d), 0); let b = textureLoad(tH, min(p + vec2i(1, 0), d), 0); let e = textureLoad(tH, min(p + vec2i(0, 1), d), 0); let f = textureLoad(tH, min(p + vec2i(1, 1), d), 0);
  let k = vec4f(a.a, b.a, e.a, f.a); let lo = min(min(k.x, k.y), min(k.z, k.w)); let hi = max(max(k.x, k.y), max(k.z, k.w));
  let c = select(hi, lo, -lo > hi); let w = clamp(vec4f(1.0) - abs(k - vec4f(c)) * q.b.x, vec4f(0.0), vec4f(1.0));
  return vec4f((a.rgb * w.x + b.rgb * w.y + e.rgb * w.z + f.rgb * w.w) / (w.x + w.y + w.z + w.w), c);
}
@fragment fn tmax(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let b = vec2i(fc.xy) * 8; let d = vec2i(textureDimensions(tH)) - 1; var m = 0.0;
  for (var j = 0; j < 8; j++) { for (var i = 0; i < 8; i++) { m = max(m, -textureLoad(tH, min(b + vec2i(i, j), d), 0).a); } }
  return vec4f(m, 0.0, 0.0, 1.0);
}
@fragment fn tdil(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let t = vec2i(fc.xy); let d = vec2i(textureDimensions(tT)) - 1; let n = min(i32(ceil(q.b.x / 8.0)) + 1, 7); var m = 0.0;
  for (var j = -n; j <= n; j++) { for (var i = -n; i <= n; i++) {
    let v = textureLoad(tT, clamp(t + vec2i(i, j), vec2i(0), d), 0).r;
    if (v * q.b.x >= length(vec2f(f32(i), f32(j))) * 8.0 - 16.0) { m = max(m, v); } // only a blur wide enough to reach this tile
  } }
  return vec4f(m, 0.0, 0.0, 1.0);
}
@fragment fn gather(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let ts = 1.0 / vec2f(textureDimensions(tH)); let uv = fc.xy * ts;
  let c0 = textureSampleLevel(tH, sL, uv, 0.0); let R = kr(fc.xy, c0.a);
  if (R < 0.5) { return vec4f(c0.rgb, 0.0); }
  let Rh = q.b.x; let m = max(R * 0.15, 1.0); let nc = sat(-c0.a * Rh); // nc: the centre itself is foreground
  var bg = vec4f(0.0); var fg = vec4f(0.0); var cov = 0.0;
  let lod = max(log2(R * 0.095) + 1.0, 0.0); // a wide blur reads a coarser mip, so a small highlight cannot fall between taps
  let lod0 = max(log2(abs(c0.a) * Rh * 0.095 + 1e-4) + 1.0, 0.0); // the centre tap by its own CoC: a nearly sharp pixel beside a wide blur stays itself
  var dir = vec2f(1.0, 0.0); var rot = vec2f(1.0, 0.0); var rad = 0.0; // 37 taps: the centre and rings of 6, 12 and 18, each tap standing for the same area
  for (var j = 0; j < 37; j++) {
    if (j == 1) { rad = 0.2857; rot = vec2f(0.5, 0.866025); } else if (j == 7) { rad = 0.5714; rot = vec2f(0.866025, 0.5); dir = vec2f(0.965926, 0.258819); } else if (j == 19) { rad = 0.8571; rot = vec2f(0.939693, 0.342020); dir = vec2f(1.0, 0.0); }
    let d = rad * R; let s = textureSampleLevel(tH, sL, uv + dir * d * ts, select(lod, lod0, j == 0));
    dir = vec2f(dir.x * rot.x - dir.y * rot.y, dir.x * rot.y + dir.y * rot.x);
    let l = dot(s.rgb, vec3f(0.2126, 0.7152, 0.0722)); let hw = 1.0 + q.b.y * min(l * l, 64.0); // bright taps win: round highlights
    // background: a tap counts up to the smaller of its CoC and the centre's. Under a foreground centre nothing is known, so take whatever is not foreground
    let wb = mix(sat((max(min(c0.a, s.a), 0.0) * Rh - d + m) / m), sat(1.0 + s.a * Rh), nc);
    let cf = -s.a * Rh; let a = R / max(cf, 0.5);
    let wf = sat((cf - d + m) / m) * sat(cf - 0.25) * min(a * a, 37.0); // foreground: reaches as far as its own CoC, thinner the wider it is spread
    bg += vec4f(s.rgb, 1.0) * (wb * hw); fg += vec4f(s.rgb, 1.0) * (wf * hw); cov += wf;
  }
  let al = sat(cov * (1.5 / 37.0)); let sa = sqrt(al);
  let bh = mix(sa, 1.0, own(c0.a)); // the blend comp will apply; divide it out so the foreground ends at exactly al
  return vec4f(mix((bg.rgb + c0.rgb * 1e-4) / (bg.w + 1e-4), fg.rgb / max(fg.w, 1e-5), al / max(bh, 1e-4)), sa);
}
@fragment fn fill(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let ts = 1.0 / vec2f(textureDimensions(tG)); let uv = fc.xy * ts;
  let c0 = max(textureSampleLevel(tH, sL, uv, 0.0).a, 0.0); let R = kr(fc.xy, c0);
  var acc = textureSampleLevel(tG, sL, uv, 0.0);
  if (R < 0.5) { return acc; }
  var n = 1.0; var dir = vec2f(0.94491, -0.32733) * (R * 0.095); // 6 taps a third of a ring spacing out
  for (var j = 0; j < 6; j++) {
    let g = textureSampleLevel(tG, sL, uv + dir * ts, 0.0); let k = max(textureSampleLevel(tH, sL, uv + dir * ts, 0.0).a, 0.0);
    let w = max(sat(1.0 + (k - c0) * q.b.x * 0.5), g.a); // not from a pixel that is sharper than this one
    acc += g * w; n += w; dir = vec2f(dir.x * 0.5 - dir.y * 0.866025, dir.x * 0.866025 + dir.y * 0.5);
  }
  return acc / n;
}
@fragment fn soft(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let ts = 1.0 / vec2f(textureDimensions(tG)); let uv = fc.xy * ts;
  let c0 = max(textureSampleLevel(tH, sL, uv, 0.0).a, 0.0); let R = kr(fc.xy, c0);
  let o = max(min(R * 0.5, 0.5), R * 0.05) * ts; // a small tent (2x2 bilinear taps) that rounds off what is left of the lattice
  var acc = vec4f(0.0); var n = 0.0;
  for (var j = 0; j < 4; j++) {
    let d = vec2f(f32(j & 1) * 2.0 - 1.0, f32(j >> 1) * 2.0 - 1.0) * o;
    let g = textureSampleLevel(tG, sL, uv + d, 0.0); let k = max(textureSampleLevel(tH, sL, uv + d, 0.0).a, 0.0);
    let w = max(sat(1.0 + (k - c0) * q.b.x * 0.5), g.a) + 1e-4;
    acc += g * w; n += w;
  }
  return acc / n;
}
@fragment fn comp(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let p = vec2i(fc.xy); var f = 0.0;
  for (var i = 0; i < 4; i++) { f += own(coc(textureLoad(tD, p, i))); } // per MSAA sample, so sharp edges against a blur stay antialiased and blurred edges leave no sharp line
  f *= 0.25;
  let g = textureSampleLevel(tG, sL, fc.xy / vec2f(textureDimensions(tD)), 0.0);
  return vec4f(g.rgb, f + g.a - f * g.a);
}`;
  function dofInit() {
    device.pushErrorScope('validation');
    const m = mod(mDofSrc), over = { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } };
    const sM = device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    const P = (ep, format, blend) => device.createRenderPipeline({ layout: 'auto', vertex: { module: m, entryPoint: 'vs' }, fragment: { module: m, entryPoint: ep, targets: [{ format, blend }] } });
    dof = { sM, buf: device.createBuffer({ size: 32, usage: BU.UNIFORM | BU.COPY_DST }), p: [P('pre', HDR), P('mip', HDR), P('mip', HDR), P('mip', HDR), P('tmax', 'r16float'), P('tdil', 'r16float'), P('gather', HDR), P('fill', HDR), P('soft', HDR), P('comp', HDR, over)], pass: [], bg: [],
      ts: hasTS ? [...Array(NDOF)].map((_, i) => ({ querySet: qs, endOfPassWriteIndex: 2 + i })) : null };
    device.popErrorScope().then((err) => { if (err) console.error('DOF PIPELINE ' + err.message); });
    dofTargets();
  }
  function dofTargets() { // half-res targets, rebuilt with the others on resize
    const hw = max(8, W >> 1), hh = max(8, H >> 1), tw = Math.ceil(hw / 8), th = Math.ceil(hh / 8), use = TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING;
    const tH = device.createTexture({ size: [hw, hh], format: HDR, usage: use, mipLevelCount: 4 }), vm = [0, 1, 2, 3].map((i) => tH.createView({ baseMipLevel: i, mipLevelCount: 1 }));
    const t = [tH, tex(tw, th, 'r16float', use), tex(tw, th, 'r16float', use), tex(hw, hh, HDR, use), tex(hw, hh, HDR, use)], v = t.map((x) => x.createView());
    targets.push(...t);
    const U = { binding: 0, resource: { buffer: dof.buf } }, S = { binding: 1, resource: dof.sM }, b = (i, r) => ({ binding: i, resource: r });
    const E = [[U, b(2, vRes), b(3, vDp)], [U, b(4, vm[0])], [U, b(4, vm[1])], [U, b(4, vm[2])], [b(4, vm[0])], [U, b(5, v[1])], [U, S, b(4, v[0]), b(5, v[2])], [U, S, b(4, vm[0]), b(5, v[2]), b(6, v[3])], [U, S, b(4, vm[0]), b(5, v[2]), b(6, v[4])], [U, S, b(3, vDp), b(6, v[3])]];
    const out = [vm[0], vm[1], vm[2], vm[3], v[1], v[2], v[3], v[4], v[3], vRes];
    for (let i = 0; i < NDOF; i++) {
      dof.bg[i] = device.createBindGroup({ layout: dof.p[i].getBindGroupLayout(0), entries: E[i] });
      dof.pass[i] = { colorAttachments: [{ view: out[i], loadOp: i < NDOF - 1 ? 'clear' : 'load', storeOp: 'store', clearValue: [0, 0, 0, 1] }] };
    }
  }
  function dofSetup() { // true when this frame has a depth of field; writes its uniforms
    if (!(G.dof || SC.dof) || OFF.has('dof')) return false;
    const R = min(dofGet('maxBlur', 0.025) * H * 0.5, 48), nr = max(0, dofGet('near', 1)), fr = max(0, dofGet('far', 1));
    if (!(R >= 0.5) || !(nr + fr > 0)) return false;
    const fo = max(0.05, dofGet('focus', 10)), rg = max(0, dofGet('range', 1)), zn = max(0.05, fo - rg), zf = fo + rg;
    DOFU[0] = nr * zn / 0.05; DOFU[1] = nr; DOFU[2] = fr * zf / 0.05; DOFU[3] = fr; DOFU[4] = R; DOFU[5] = clamp(dofGet('bokeh', 0.5), 0, 1);
    if (!dof) dofInit();
    Q.writeBuffer(dof.buf, 0, DOFU); return true;
  }

  // ---------------------------------------------------------------- GPU timing
  const F = new Float64Array(32); // per-frame state, preallocated
  const [CX, CY, CZ, YAW, PIT, VX, VY, VZ, TIME, LAST, GPU, FOV] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  let dynT = 0, dynN = 0, dynG = 0, dynGN = 0;
  if (hasTS) {
    qs = device.createQuerySet({ type: 'timestamp', count: 2 + NDOF }); // 0, 1: the scene pass. Then the end of each depth-of-field pass: a tile-based GPU starts a pass's vertex stage long before its pixels, so each is timed from the end of the one before
    qRes = device.createBuffer({ size: 16 + 8 * NDOF, usage: BU.QUERY_RESOLVE | BU.COPY_SRC });
    for (let i = 0; i < 4; i++) {
      const b = device.createBuffer({ size: 16 + 8 * NDOF, usage: BU.MAP_READ | BU.COPY_DST }), o = { b, busy: false, dof: false };
      o.done = () => { const a = new BigInt64Array(b.getMappedRange()); let ms = Number(a[1] - a[0]) / 1e6, md = 0; if (o.dof) for (let i = 0; i < NDOF; i++) md += F[13 + i] = Number(a[2 + i] - a[1 + i]) / 1e6; b.unmap(); o.busy = false; if (ms > 0 && ms < 1e3) { if (md > 0 && md < 1e3) { ms += md; dofMs = F[12] = md; } F[GPU] = ms; dynG += ms; dynGN++; } };
      qRead.push(o);
    }
    tsW = { querySet: qs, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 };
  }

  // ---------------------------------------------------------------- camera + input
  const poses = G.poses;
  const setPose = (i) => { const p = poses[i]; F[CX] = p[0]; F[CY] = p[1]; F[CZ] = p[2]; F[YAW] = p[3]; F[PIT] = p[4]; F[FOV] = p[5]; F[VX] = F[VY] = F[VZ] = 0; };
  setPose(SHOT ? +QS.get('shot') || 0 : 0);
  if (SHOT) F[TIME] = +QS.get('t') || 0;
  const keys = new Uint8Array(256); let mdx = 0, mdy = 0, flying = false, hud = false;
  const KC = { KeyW: 1, KeyS: 2, KeyA: 3, KeyD: 4, KeyE: 5, KeyQ: 6, ShiftLeft: 7, ShiftRight: 7 };
  addEventListener('keydown', (e) => {
    if (KC[e.code]) keys[KC[e.code]] = 1;
    if (!G.update && e.code.startsWith('Digit')) { const i = +e.code.slice(5) - 1; if (i >= 0 && i < poses.length) setPose(i); }
    if (e.code === 'KeyH') { hud = !hud; $('i').hidden = !hud; }
  });
  addEventListener('keyup', (e) => { if (KC[e.code]) keys[KC[e.code]] = 0; });
  addEventListener('mousemove', (e) => { if (document.pointerLockElement === canvas) { mdx += e.movementX; mdy += e.movementY; } });
  const go = () => { body.className = 'g'; canvas.requestPointerLock?.(); flying = true; };
  $('go').onclick = G.start ? () => { body.className = 'g'; G.start(); } : go; canvas.onclick = () => { if (flying) canvas.requestPointerLock?.(); };
  document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement && flying) { body.className = 'm'; flying = false; } });

  // ---------------------------------------------------------------- frame
  const submitList = [null];
  let hudT = 0, hudN = 0, hudMs = 0;
  // shot mode renders on a timer, so it also works in a background tab
  const next = SHOT || BENCH || QS.has('timer') ? (f) => setTimeout(() => f(performance.now()), 16) : requestAnimationFrame; // ?timer: for testing in a hidden tab
  // split screen: pixel rects (a black gap at inner edges), bases and per-view uniforms, written before G.post so the HUD can use them
  function mvViews(VW, n) {
    const g = max(2, round((VW.gap || 4) * H / 1080)), g0 = g >> 1, g1 = g - g0;
    for (let v = 0; v < n; v++) {
      const R = VW.rect, o = v * 4;
      let x0 = round(R[o] * W), y0 = round(R[o + 1] * H), x1 = round((R[o] + R[o + 2]) * W), y1 = round((R[o + 1] + R[o + 3]) * H);
      if (x0 > 0) x0 += g1; if (y0 > 0) y0 += g1; if (x1 < W) x1 -= g0; if (y1 < H) y1 -= g0;
      x0 = clamp(x0, 0, W - 1); y0 = clamp(y0, 0, H - 1); x1 = clamp(x1, x0 + 1, W); y1 = clamp(y1, y0 + 1, H);
      const P = VW.px; P[o] = mvPx[o] = x0; P[o + 1] = mvPx[o + 1] = y0; P[o + 2] = mvPx[o + 2] = x1 - x0; P[o + 3] = mvPx[o + 3] = y1 - y0;
      MVR[o] = x0 / W; MVR[o + 1] = y0 / H; MVR[o + 2] = x1 / W; MVR[o + 3] = y1 / H;
      const c = VW.cam, k = v * 6, cy = cos(c[k + 3]), sy = sin(c[k + 3]), cp = cos(c[k + 4]), sp = sin(c[k + 4]), w = x1 - x0, h = y1 - y0, B = VW.B, b = v * 9;
      B[b] = sy * cp; B[b + 1] = sp; B[b + 2] = cy * cp; B[b + 3] = cy; B[b + 4] = 0; B[b + 5] = -sy; B[b + 6] = -sp * sy; B[b + 7] = cp; B[b + 8] = -sp * cy;
      VW.aspect[v] = w / h;
      const U = UBV, u = v * 36;
      U[u] = c[k]; U[u + 1] = c[k + 1]; U[u + 2] = c[k + 2]; U[u + 3] = F[TIME];
      U[u + 4] = B[b]; U[u + 5] = B[b + 1]; U[u + 6] = B[b + 2]; U[u + 7] = Math.tan(c[k + 5] / 2);
      U[u + 8] = B[b + 3]; U[u + 9] = 0; U[u + 10] = B[b + 5]; U[u + 11] = w / h;
      U[u + 12] = B[b + 6]; U[u + 13] = B[b + 7]; U[u + 14] = B[b + 8]; U[u + 15] = 0.05;
      U[u + 16] = SC.sun[0]; U[u + 17] = SC.sun[1]; U[u + 18] = SC.sun[2]; U[u + 19] = 0;
      U[u + 20] = w; U[u + 21] = h; U[u + 22] = 1 / w; U[u + 23] = 1 / h;
      if (SC.p0) { U[u + 24] = SC.p0[0]; U[u + 25] = SC.p0[1]; U[u + 26] = SC.p0[2]; U[u + 27] = SC.p0[3]; }
      if (SC.p1) { U[u + 28] = SC.p1[0]; U[u + 29] = SC.p1[1]; U[u + 30] = SC.p1[2]; U[u + 31] = SC.p1[3]; }
      U[u + 32] = x0; U[u + 33] = y0; U[u + 34] = 1 / W; U[u + 35] = 1 / H;
    }
  }
  function mvEncode(e, n, meshOn, cur, nLn, outV, timed = true) {
    if (!MV) mvInit(curPack && curPack.mvPre);
    if (meshOn) mvMesh();
    for (let v = 0; v < n; v++) { Q.writeBuffer(MV.ubo[v], 0, UBV.buffer, v * 144, 144); Q.writeBuffer(MV.rb[v], 0, MVR.buffer, v * 16, 16); }
    for (let i = 0; i < draws.length; i++) { const d = draws[i]; if (d.m.dirty) { Q.writeBuffer(d.ibuf, 0, d.m.inst); d.m.dirty = false; } }
    if (G.dynPts && G.dynPts[1]) Q.writeBuffer(ptsBuf, G.dynPts[0] * 32, G.points.buffer, G.points.byteOffset + G.dynPts[0] * 32, G.dynPts[1] * 32);
    if (hasTS) passScene.timestampWrites = timed ? tsW : undefined;
    let r = e.beginRenderPass(passScene); // one pass, every view (viewport + scissor); the depth buffer is shared (the rects never overlap)
    for (let v = 0; v < n; v++) {
      const o = v * 4; r.setViewport(mvPx[o], mvPx[o + 1], mvPx[o + 2], mvPx[o + 3], 0, 1); r.setScissorRect(mvPx[o], mvPx[o + 1], mvPx[o + 2], mvPx[o + 3]);
      if (!OFF.has('sky')) { r.setPipeline(MV.pSky); r.setBindGroup(0, MV.bgSky[v]); r.draw(3); }
      r.setPipeline(pSolid); r.setBindGroup(0, MV.bgSolid[v]);
      for (let i = 0; i < (OFF.has('solids') ? 0 : draws.length); i++) { const d = draws[i]; r.setVertexBuffer(0, d.vb); r.setVertexBuffer(1, d.ibuf); r.setIndexBuffer(d.ib, 'uint32'); if (d.m.nLive >= 0) { if (d.m.nLive > 0) r.drawIndexed(d.n, d.m.nLive, 0, 0, d.m.iFirst || 0); } else r.drawIndexed(d.n, d.ni); }
      if (meshOn) {
        r.setPipeline(MG.pipe); r.setBindGroup(0, MV.bgMesh[v]);
        for (let i = 0; i < meshList.length; i++) {
          const h = meshList[i], g = h.gpu; if (!h.visible || !(h.scale > 0)) continue;
          dynOff[0] = i * 256; r.setBindGroup(1, MG.bg1, dynOff); r.setVertexBuffer(0, g.vb); r.setIndexBuffer(g.ib, 'uint32');
          for (let k = 0; k < g.ranges.length; k++) { const rg = g.ranges[k]; r.setBindGroup(2, rg.bg); r.drawIndexed(rg.count, 1, rg.first); }
        }
      }
      if (nPts && !OFF.has('points')) { r.setPipeline(pPts); r.setBindGroup(0, MV.bgPts[v]); r.draw(6, nPts); }
      if (nLn) { if (!LN.bgV[v]) LN.bgV[v] = LN.bgFor(MV.ubo[v]); linesDraw(r, LN.bgV[v], nLn); }
    }
    r.end();
    // bloom per view: the same chain, each view's draw scissored to its rect at that level and every tap clamped inside it
    for (let k = 0; k < (OFF.has('bloom') ? 0 : bloomPass.length); k++) {
      const L = bloomLvl[k], lw = max(1, W >> (L + 1)), lh = max(1, H >> (L + 1));
      r = e.beginRenderPass(bloomPass[k][0]); r.setPipeline(k < NB ? (k ? MV.pDown : MV.pDown0) : MV.pUp);
      for (let v = 0; v < n; v++) {
        const o = v * 4, x0 = min(lw - 1, round(MVR[o] * lw)), y0 = min(lh - 1, round(MVR[o + 1] * lh)), x1 = max(x0 + 1, min(lw, round(MVR[o + 2] * lw))), y1 = max(y0 + 1, min(lh, round(MVR[o + 3] * lh)));
        r.setScissorRect(x0, y0, x1 - x0, y1 - y0); r.setBindGroup(0, MV.bgBloom[k][v]); r.draw(3);
      }
      r.end();
    }
    passPost.colorAttachments[0].view = outV || cur.createView();
    r = e.beginRenderPass(passPost); r.setPipeline(MV.pPost); // cleared to black: the gaps are the dividers
    for (let v = 0; v < n; v++) { const o = v * 4; r.setScissorRect(mvPx[o], mvPx[o + 1], mvPx[o + 2], mvPx[o + 3]); r.setBindGroup(0, MV.bgPost[v]); r.draw(3); }
    r.end();
  }
  function encodeSingle(e, meshOn, cur, nLn, outV, timed) { // the single-view scene, bloom and grade (outV: an offscreen target, else the canvas)
    if (hasTS) passScene.timestampWrites = timed ? tsW : undefined;
    let r = e.beginRenderPass(passScene);
    if (!OFF.has('sky')) { r.setPipeline(pSky); r.setBindGroup(0, bgSky); r.draw(3); }
    r.setPipeline(pSolid); r.setBindGroup(0, bgSolid);
    for (let i = 0; i < draws.length; i++) { const d = draws[i]; if (d.m.dirty) { Q.writeBuffer(d.ibuf, 0, d.m.inst); d.m.dirty = false; } }
    if (G.dynPts && G.dynPts[1]) Q.writeBuffer(ptsBuf, G.dynPts[0] * 32, G.points.buffer, G.points.byteOffset + G.dynPts[0] * 32, G.dynPts[1] * 32);
    for (let i = 0; i < (OFF.has('solids') ? 0 : draws.length); i++) { const d = draws[i]; r.setVertexBuffer(0, d.vb); r.setVertexBuffer(1, d.ibuf); r.setIndexBuffer(d.ib, 'uint32'); if (d.m.nLive >= 0) { if (d.m.nLive > 0) r.drawIndexed(d.n, d.m.nLive, 0, 0, d.m.iFirst || 0); } else r.drawIndexed(d.n, d.ni); }
    if (meshOn) {
      r.setPipeline(MG.pipe); r.setBindGroup(0, MG.bg0);
      for (let i = 0; i < meshList.length; i++) {
        const h = meshList[i], g = h.gpu; if (!h.visible || !(h.scale > 0)) continue;
        dynOff[0] = i * 256; r.setBindGroup(1, MG.bg1, dynOff); r.setVertexBuffer(0, g.vb); r.setIndexBuffer(g.ib, 'uint32');
        for (let k = 0; k < g.ranges.length; k++) { const rg = g.ranges[k]; r.setBindGroup(2, rg.bg); r.drawIndexed(rg.count, 1, rg.first); }
      }
    }
    if (nPts && !OFF.has('points')) { r.setPipeline(pPts); r.setBindGroup(0, bgPts); r.draw(6, nPts); }
    if (nLn) linesDraw(r, LN.bg, nLn);
    r.end();
    const dofOn = timed && dofSetup(); // before the bloom and the grade, so blurred highlights bloom and the grade lies on top
    if (dofOn) for (let i = 0; i < NDOF; i++) { if (hasTS) dof.pass[i].timestampWrites = dof.ts[i]; r = e.beginRenderPass(dof.pass[i]); r.setPipeline(dof.p[i]); r.setBindGroup(0, dof.bg[i]); r.draw(3); r.end(); }
    for (let i = 0; i < (OFF.has('bloom') ? 0 : bloomPass.length); i++) { r = e.beginRenderPass(bloomPass[i][0]); r.setPipeline(bloomPass[i][1]); r.setBindGroup(0, bloomBG[i]); r.draw(3); r.end(); }
    passPost.colorAttachments[0].view = outV || cur.createView();
    r = e.beginRenderPass(passPost); r.setPipeline(pPost); r.setBindGroup(0, bgPost); r.draw(3); r.end();
    return dofOn;
  }
  // G.grab(name): save the next displayed frame (any mode) through serve.py as compare/shots/<name>.png; G.grabOverlay(ctx2d, W, H)
  // composites the page's 2D layers (HUD, effects) over it. Resolves with the save status. For tests and documentation shots.
  let grabName = '', grabDone = null;
  G.grab = (name) => new Promise((res) => { grabName = name; grabDone = res; });
  function frame(now) {
    if (!SHOT || shotN < 12) next(frame);
    const dtr = now - F[LAST]; F[LAST] = now;
    let dt = dtr / 1000; if (dt > 0.1) dt = 0.1;
    if (SHOT) dt = 0;
    // dynamic resolution: once a second, keep GPU time between 9.8 and 13.6 ms (pixels only)
    if (!SHOT && !BENCH && dtr < 1e3 && (dynT += dtr) > 1000) {
      const g = dynGN ? dynG / dynGN : 0, a = dynT / max(1, dynN); let k = 1;
      if (g) { if (g > 13.6 || g < 9.8) k = 11.7 / g; } else if (a > 17.6) k = 15 / a; else if (a < 12.5) k = 1.1;
      k = clamp(k, 0.5, 1.7); pix = clamp(pix * k, PIXMIN, min(PIXMAX, DW * DH || PIXMAX));
      dynT = dynN = dynG = dynGN = 0; resize();
    }
    dynN++;
    F[TIME] += dt;
    // a game takes over the camera (rails); otherwise free flight
    if (G.update) G.update(F, dt);
    const VW = G.views, mvN = !SHOT && VW.n > 1 ? min(4, VW.n | 0) : 0;
    { const sc = mvN ? clamp(VW.scale || 1, 0.4, 1) : 1; if (sc !== mvScale) { mvScale = sc; resize(); } }
    if (mvN) mvViews(VW, mvN);
    const ls = 0.0022; F[YAW] += mdx * ls; F[PIT] = clamp(F[PIT] - mdy * ls, -1.5, 1.5); mdx = mdy = 0;
    const cy = cos(F[YAW]), sy = sin(F[YAW]), cp = cos(F[PIT]), sp = sin(F[PIT]);
    const fx = sy * cp, fy = sp, fz = cy * cp, rx = cy, rz = -sy; // right = (cos yaw, 0, -sin yaw)
    const ux = -sp * sy, uy = cp, uz = -sp * cy;
    if (G.update) { /* camera set by the game */ } else if (flying) {
      const sp2 = keys[7] ? 22 : 6, mf = keys[1] - keys[2], mr = keys[4] - keys[3], mu = keys[5] - keys[6];
      const ax = (fx * mf + rx * mr) * sp2, ay = (fy * mf + mu) * sp2, az = (fz * mf + rz * mr) * sp2, kk = 1 - Math.exp(-dt * 6);
      F[VX] += (ax - F[VX]) * kk; F[VY] += (ay - F[VY]) * kk; F[VZ] += (az - F[VZ]) * kk;
    } else { const kk = 1 - Math.exp(-dt * 4); F[VX] -= F[VX] * kk; F[VY] -= F[VY] * kk; F[VZ] -= F[VZ] * kk; }
    if (!G.update) { F[CX] += F[VX] * dt; F[CY] += F[VY] * dt; F[CZ] += F[VZ] * dt; }
    if (G.post) G.post(F, fx, fy, fz, rx, rz, ux, uy, uz, W, H);
    if (G.collide && !SHOT && !G.update) G.collide(F); // shots use the exact hero camera
    // uniforms
    UB[0] = F[CX]; UB[1] = F[CY]; UB[2] = F[CZ]; UB[3] = F[TIME];
    UB[4] = fx; UB[5] = fy; UB[6] = fz; UB[7] = Math.tan(F[FOV] / 2);
    UB[8] = rx; UB[9] = 0; UB[10] = rz; UB[11] = W / H;
    UB[12] = ux; UB[13] = uy; UB[14] = uz; UB[15] = 0.05;
    if (F[25]) { const cr = cos(F[25]), sr = sin(F[25]); UB[8] = rx * cr + ux * sr; UB[9] = uy * sr; UB[10] = rz * cr + uz * sr; UB[12] = ux * cr - rx * sr; UB[13] = uy * cr; UB[14] = uz * cr - rz * sr; } // F[25]: camera roll (rad; single view only), 0 unless a game sets it (Reality Pulse)
    UB[16] = SC.sun[0]; UB[17] = SC.sun[1]; UB[18] = SC.sun[2]; UB[19] = 0;
    UB[20] = W; UB[21] = H; UB[22] = 1 / W; UB[23] = 1 / H;
    if (SC.p0) { UB[24] = SC.p0[0]; UB[25] = SC.p0[1]; UB[26] = SC.p0[2]; UB[27] = SC.p0[3]; }
    if (SC.p1) { UB[28] = SC.p1[0]; UB[29] = SC.p1[1]; UB[30] = SC.p1[2]; UB[31] = SC.p1[3]; }
    Q.writeBuffer(ubo, 0, UB);

    if (meshNew.length) meshUpload();
    const meshOn = meshList.length && !OFF.has('meshes') ? meshFrame() : false; // pages without meshes skip all of this
    const e = device.createCommandEncoder();
    let dofOn = false; const cur = ctx.getCurrentTexture();
    const fin = G.final && G.final.on ? G.final : null, aux = G.realmAux && G.realmAux !== curPack ? G.realmAux : null;
    if ((fin || aux) && !FIN.texA) finTargets();
    if (aux) auxEncode(e, aux, mvN, meshOn, cur); // realm B into FIN.texB (G.realmAux): its scene, bloom and grade
    const nLn = G.lines ? linesFrame() : 0; // glow lines (G.lines): pages without them skip this
    const outV = fin ? FIN.vA : null;
    if (mvN) mvEncode(e, mvN, meshOn, cur, nLn, outV); // split screen
    else dofOn = encodeSingle(e, meshOn, cur, nLn, outV, true);
    if (fin) finEncode(e, fin, cur, !!aux);
    let slot = null;
    if (hasTS) { slot = qRead.find((o) => !o.busy) || null; if (slot) { slot.dof = dofOn; e.resolveQuerySet(qs, 0, dofOn ? 2 + NDOF : 2, qRes, 0); e.copyBufferToBuffer(qRes, 0, slot.b, 0, dofOn ? 16 + 8 * NDOF : 16); slot.busy = true; } }
    let shotBuf = null, bpr = 0;
    let grabBuf = null, gbpr = 0;
    if (grabName) { gbpr = (W * 4 + 255) & ~255; grabBuf = device.createBuffer({ size: gbpr * H, usage: BU.MAP_READ | BU.COPY_DST }); e.copyTextureToBuffer({ texture: cur }, { buffer: grabBuf, bytesPerRow: gbpr }, [W, H]); }
    // G.shotHold: a page still compiling what its fixed frame needs keeps rendering until it clears it (Pulse Lab)
    if (SHOT && !G.shotHold && ++shotN === 12) { bpr = (W * 4 + 255) & ~255; shotBuf = device.createBuffer({ size: bpr * H, usage: BU.MAP_READ | BU.COPY_DST }); e.copyTextureToBuffer({ texture: cur }, { buffer: shotBuf, bytesPerRow: bpr }, [W, H]); }
    submitList[0] = e.finish(); Q.submit(submitList);
    if (slot) slot.b.mapAsync(GPUMapMode.READ).then(slot.done);
    if (shotBuf) saveShot(shotBuf, bpr);
    if (grabBuf) { const d = grabDone, nm = grabName; grabName = ''; grabDone = null; saveShot(grabBuf, gbpr, nm, true).then(d); }
    if (BENCH && F[GPU] > 0 && ++benchN > 60 && benchN <= 180) { benchS += F[GPU]; benchD += dofMs; if (benchN === 180) document.title = `BENCH ${(benchS / 120).toFixed(2)} ms` + (benchD ? ` (dof ${(benchD / 120).toFixed(2)} ms)` : ''); }
    if (hud && (hudT += dtr) > 500) { $('i').textContent = `${(1000 * ++hudN / hudT).toFixed(0)} fps · GPU ${F[GPU].toFixed(1)} ms · ${W}×${H} · ${draws.reduce((a, d) => a + d.ni, 0)} solids · ${nPts} points · at ${F[CX].toFixed(1)}, ${F[CY].toFixed(1)}, ${F[CZ].toFixed(1)}`; hudT = hudN = 0; } else if (hud) hudN++;
  }
  let shotN = 0, benchN = 0, benchS = 0, benchD = 0;
  async function saveShot(b, bpr, grab = '', isGrab = false) {
    await b.mapAsync(GPUMapMode.READ); const src = new Uint8Array(b.getMappedRange()), img = new ImageData(W, H), d = img.data, bgra = FMT.startsWith('bgra');
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const s = y * bpr + x * 4, o = (y * W + x) * 4; d[o] = src[s + (bgra ? 2 : 0)]; d[o + 1] = src[s + 1]; d[o + 2] = src[s + (bgra ? 0 : 2)]; d[o + 3] = 255; }
    const c2 = new OffscreenCanvas(W, H); c2.getContext('2d').putImageData(img, 0, 0);
    if (isGrab) { if (G.grabOverlay) G.grabOverlay(c2.getContext('2d'), W, H); }
    else if (G.shotOverlay) G.shotOverlay(c2.getContext('2d'), W, H); // optional: a game composites its 2D cockpit overlay into the saved frame
    const blob = await c2.convertToBlob({ type: 'image/png' });
    const name = isGrab ? grab : QS.get('name') || `${SC.id}-pose${QS.get('shot')}`;
    if (isGrab) { const res = await fetch('/shots/' + name + '.png', { method: 'PUT', body: blob }).catch(() => null); b.destroy(); return res ? res.status : 0; }
    const res = await fetch('/shots/' + name + '.png', { method: 'PUT', body: blob }).catch(() => null);
    document.title = 'SHOT ' + (res && res.ok ? 'saved ' : 'failed ') + name;
  }
  body.className = SHOT ? 'g' : 'm';
  next((t) => { F[LAST] = t; frame(t); });
}
