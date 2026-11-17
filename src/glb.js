// ============================================================================
// glb.js: a minimal glTF 2.0 binary (.glb) loader for the Space Garden engine. No dependencies.
//   GLB.load(url) -> Promise<model>          fetch (relative to the page) + parse; GLB_INLINE[url] (build-time base64) wins if present
//   GLB.parse(arrayBuffer, baseUrl) -> Promise<model>
// model = { prims: [{ pos: Float32Array(3n), nrm: Float32Array(3n), uv: Float32Array(2n), idx: Uint32Array, mat }],
//           images: [ImageBitmap|null], bounds: { min: [3], max: [3] }, nTri, url }
//   mat = { color: [r,g,b,a] (linear baseColorFactor), tex: image index or -1 (baseColor, sRGB), emissive: [r,g,b], name }
// What it reads: the JSON and BIN chunks; accessors of float32 or (KHR_mesh_quantization) normalized/unnormalized
// int8/uint8/int16/uint16, interleaved or not; uint8/16/32 indices; the default scene's node tree (TRS or matrix),
// baked into the vertices, so every primitive comes out in model space; triangle lists; one baseColor texture per
// material (PNG, JPEG or EXT_texture_webp; embedded, data: or a URL beside the .glb). Images are decoded with
// createImageBitmap and left gamma-encoded: the engine uploads them to rgba8unorm-srgb so sampling returns linear.
// Ignored on purpose (PBR is off): metallic-roughness, normal, occlusion and emissive textures, samplers, cameras,
// skins, morph targets and animations. Anything else that would change the geometry fails with a clear message:
// Draco or meshopt compression, sparse accessors, non-triangle modes, other required extensions.
// ============================================================================
const GLB = (() => {
  const SUPPORTED_EXT = new Set(['EXT_texture_webp', 'KHR_mesh_quantization', 'KHR_materials_emissive_strength', 'KHR_materials_unlit', 'KHR_texture_transform']);
  const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
  const CT = { 5120: [Int8Array, 1, 127], 5121: [Uint8Array, 1, 255], 5122: [Int16Array, 2, 32767], 5123: [Uint16Array, 2, 65535], 5125: [Uint32Array, 4, 0], 5126: [Float32Array, 4, 0] };
  const bad = (url, m) => { throw new Error(`GLB ${url || ''}: ${m}`); };

  // ---- 4x4 column-major helpers (load time only)
  const mIdent = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const mMul = (a, b) => { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; };
  const mTRS = (t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]) => {
    const [x, y, z, w] = q, xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
    return [(1 - 2 * (yy + zz)) * s[0], 2 * (xy + wz) * s[0], 2 * (xz - wy) * s[0], 0,
      2 * (xy - wz) * s[1], (1 - 2 * (xx + zz)) * s[1], 2 * (yz + wx) * s[1], 0,
      2 * (xz + wy) * s[2], 2 * (yz - wx) * s[2], (1 - 2 * (xx + yy)) * s[2], 0, t[0], t[1], t[2], 1];
  };

  function parseChunks(ab, url) {
    const dv = new DataView(ab);
    if (ab.byteLength < 20 || dv.getUint32(0, true) !== 0x46546c67) bad(url, 'not a binary glTF (.glb) file');
    if (dv.getUint32(4, true) !== 2) bad(url, `glTF version ${dv.getUint32(4, true)} (only 2 is supported)`);
    let off = 12, json = null, bin = null;
    while (off + 8 <= ab.byteLength) {
      const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
      if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(ab, off + 8, len)));
      else if (type === 0x004e4942 && !bin) bin = new Uint8Array(ab, off + 8, len);
      off += 8 + len;
    }
    if (!json) bad(url, 'no JSON chunk');
    return { json, bin };
  }

  // read an accessor as a float array (normalized integers mapped to -1..1 or 0..1), or as Uint32 for indices
  function readAccessor(j, bin, i, asIndex, url) {
    const a = j.accessors[i];
    if (!a) bad(url, `accessor ${i} is missing`);
    if (a.sparse) bad(url, 'sparse accessors are not supported');
    const nc = NCOMP[a.type], ct = CT[a.componentType];
    if (!nc || !ct) bad(url, `accessor ${i}: unsupported type ${a.type}/${a.componentType}`);
    const n = a.count, out = asIndex ? new Uint32Array(n * nc) : new Float32Array(n * nc);
    if (a.bufferView == null) return out; // all zeros by spec
    const bv = j.bufferViews[a.bufferView];
    if ((bv.buffer || 0) !== 0 || !bin) bad(url, 'only the embedded BIN buffer is supported');
    const [T, size, maxv] = ct, stride = bv.byteStride || nc * size, base = bin.byteOffset + (bv.byteOffset || 0) + (a.byteOffset || 0);
    const dv = new DataView(bin.buffer), norm = !asIndex && a.normalized && maxv;
    const get = { 5120: (o) => dv.getInt8(o), 5121: (o) => dv.getUint8(o), 5122: (o) => dv.getInt16(o, true), 5123: (o) => dv.getUint16(o, true), 5125: (o) => dv.getUint32(o, true), 5126: (o) => dv.getFloat32(o, true) }[a.componentType];
    void T;
    for (let k = 0; k < n; k++) for (let c = 0; c < nc; c++) {
      const v = get(base + k * stride + c * size);
      out[k * nc + c] = norm ? Math.max(v / maxv, -1) : v;
    }
    return out;
  }

  async function decodeImage(j, bin, i, baseUrl, url) {
    const im = j.images[i];
    let blob;
    if (im.bufferView != null) {
      const bv = j.bufferViews[im.bufferView];
      blob = new Blob([new Uint8Array(bin.buffer, bin.byteOffset + (bv.byteOffset || 0), bv.byteLength)], { type: im.mimeType || '' });
    } else if (im.uri) {
      const r = await fetch(new URL(im.uri, baseUrl)); if (!r.ok) bad(url, `image ${im.uri}: HTTP ${r.status}`); blob = await r.blob();
    } else bad(url, `image ${i} has no data`);
    try { return await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }); }
    catch (e) { bad(url, `image ${i} (${im.mimeType || im.uri}) could not be decoded: ${e.message}`); }
  }

  async function parse(ab, baseUrl = location.href, url = '') {
    const { json: j, bin } = parseChunks(ab, url);
    for (const e of j.extensionsRequired || []) if (!SUPPORTED_EXT.has(e)) bad(url, `required extension ${e} is not supported (re-export without it, e.g. no Draco/meshopt compression)`);
    if (!j.meshes || !j.meshes.length) bad(url, 'no meshes');
    // materials -> { color, tex (image index), emissive }
    const imgUsed = new Map();
    const texImage = (ti) => { if (ti == null) return -1; const t = j.textures[ti.index]; if (!t) return -1; const s = t.extensions?.EXT_texture_webp?.source ?? t.source; if (s == null) return -1; if (!imgUsed.has(s)) imgUsed.set(s, imgUsed.size); return imgUsed.get(s); };
    const mats = (j.materials || []).map((m) => { const p = m.pbrMetallicRoughness || {}; return { name: m.name || '', color: p.baseColorFactor || [1, 1, 1, 1], tex: texImage(p.baseColorTexture), emissive: (m.emissiveFactor || [0, 0, 0]).map((v) => v * (m.extensions?.KHR_materials_emissive_strength?.emissiveStrength || 1)) }; });
    const defMat = { name: '', color: [1, 1, 1, 1], tex: -1, emissive: [0, 0, 0] };
    // walk the default scene (or every root node), baking each node's world matrix into its mesh's vertices
    const prims = [], min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    const nodes = j.nodes || [];
    let roots = j.scenes?.[j.scene ?? 0]?.nodes;
    if (!roots) { const child = new Set(nodes.flatMap((n) => n.children || [])); roots = nodes.map((_, i) => i).filter((i) => !child.has(i)); }
    const visit = (ni, parent, depth) => {
      if (depth > 64) bad(url, 'node tree too deep (cycle?)');
      const nd = nodes[ni]; if (!nd) bad(url, `node ${ni} is missing`);
      const M = mMul(parent, nd.matrix || mTRS(nd.translation, nd.rotation, nd.scale));
      if (nd.mesh != null) for (const pr of j.meshes[nd.mesh].primitives) prims.push(bake(pr, M));
      for (const c of nd.children || []) visit(c, M, depth + 1);
    };
    const bake = (pr, M) => {
      if ((pr.mode ?? 4) !== 4) bad(url, `primitive mode ${pr.mode} (only triangle lists are supported)`);
      if (pr.extensions?.KHR_draco_mesh_compression) bad(url, 'Draco-compressed primitives are not supported');
      const at = pr.attributes; if (at.POSITION == null) bad(url, 'primitive without POSITION');
      const P = readAccessor(j, bin, at.POSITION, false, url), n = P.length / 3;
      let N = at.NORMAL != null ? readAccessor(j, bin, at.NORMAL, false, url) : null;
      const UV = at.TEXCOORD_0 != null ? readAccessor(j, bin, at.TEXCOORD_0, false, url) : new Float32Array(n * 2);
      let I = pr.indices != null ? readAccessor(j, bin, pr.indices, true, url) : Uint32Array.from({ length: n }, (_, i) => i);
      // normal matrix: the inverse transpose of M's 3x3 (cofactors); a mirrored node flips the winding
      const a = M, c00 = a[5] * a[10] - a[6] * a[9], c01 = a[6] * a[8] - a[4] * a[10], c02 = a[4] * a[9] - a[5] * a[8];
      const c10 = a[2] * a[9] - a[1] * a[10], c11 = a[0] * a[10] - a[2] * a[8], c12 = a[1] * a[8] - a[0] * a[9];
      const c20 = a[1] * a[6] - a[2] * a[5], c21 = a[2] * a[4] - a[0] * a[6], c22 = a[0] * a[5] - a[1] * a[4];
      const det = a[0] * c00 + a[1] * c01 + a[2] * c02;
      const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3);
      for (let k = 0; k < n; k++) {
        const x = P[k * 3], y = P[k * 3 + 1], z = P[k * 3 + 2];
        const X = a[0] * x + a[4] * y + a[8] * z + a[12], Y = a[1] * x + a[5] * y + a[9] * z + a[13], Z = a[2] * x + a[6] * y + a[10] * z + a[14];
        pos[k * 3] = X; pos[k * 3 + 1] = Y; pos[k * 3 + 2] = Z;
        if (X < min[0]) min[0] = X; if (Y < min[1]) min[1] = Y; if (Z < min[2]) min[2] = Z;
        if (X > max[0]) max[0] = X; if (Y > max[1]) max[1] = Y; if (Z > max[2]) max[2] = Z;
      }
      if (!N) { // no normals: area-weighted vertex normals from the faces
        N = new Float32Array(n * 3);
        for (let k = 0; k < I.length; k += 3) {
          const i0 = I[k] * 3, i1 = I[k + 1] * 3, i2 = I[k + 2] * 3;
          const ux = P[i1] - P[i0], uy = P[i1 + 1] - P[i0 + 1], uz = P[i1 + 2] - P[i0 + 2], vx = P[i2] - P[i0], vy = P[i2 + 1] - P[i0 + 1], vz = P[i2 + 2] - P[i0 + 2];
          const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
          for (const q of [i0, i1, i2]) { N[q] += nx; N[q + 1] += ny; N[q + 2] += nz; }
        }
      }
      if (det < 0) { I = I.slice(); for (let k = 0; k < I.length; k += 3) { const t = I[k + 1]; I[k + 1] = I[k + 2]; I[k + 2] = t; } }
      const sg = det < 0 ? -1 : 1; // the cofactor matrix is det × the inverse transpose
      for (let k = 0; k < n; k++) {
        const x = N[k * 3], y = N[k * 3 + 1], z = N[k * 3 + 2];
        const X = c00 * x + c10 * y + c20 * z, Y = c01 * x + c11 * y + c21 * z, Z = c02 * x + c12 * y + c22 * z, l = (Math.hypot(X, Y, Z) || 1) * sg;
        nrm[k * 3] = X / l; nrm[k * 3 + 1] = Y / l; nrm[k * 3 + 2] = Z / l;
      }
      for (let k = 0; k < I.length; k++) if (I[k] >= n) bad(url, `index ${I[k]} out of range (${n} vertices)`);
      return { pos, nrm, uv: UV, idx: I, mat: pr.material != null ? mats[pr.material] : defMat };
    };
    for (const r of roots) visit(r, mIdent(), 0);
    if (!prims.length) bad(url, 'the scene has no mesh nodes');
    // decode only the images a baseColor texture uses, remapped to 0..k-1
    const order = [...imgUsed.entries()].sort((x, y) => x[1] - y[1]).map((e) => e[0]);
    const images = await Promise.all(order.map((i) => decodeImage(j, bin, i, baseUrl, url)));
    return { prims, images, bounds: { min, max }, nTri: prims.reduce((s, p) => s + p.idx.length / 3, 0), url };
  }

  async function load(url) {
    const inl = typeof GLB_INLINE !== 'undefined' && GLB_INLINE[url];
    let ab;
    if (inl) { const s = atob(inl); const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); ab = b.buffer; }
    else { const r = await fetch(url); if (!r.ok) bad(url, `HTTP ${r.status}`); ab = await r.arrayBuffer(); }
    return parse(ab, new URL(url, location.href).href, url);
  }
  return { load, parse };
})();
const loadGLB = GLB.load;
