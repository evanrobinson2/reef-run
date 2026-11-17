// ============================================================================
// rail.js: a smooth path through control points, parameterised by distance (metres along the rail).
// Shared by the rail games. Load-time allocation only; at() / tan() / frame() write into caller arrays.
// ============================================================================
function makeRail(ctrl, step = 0.5) {
  // centripetal Catmull-Rom through ctrl (array of [x,y,z]); ends are extended by reflection
  const P = [ctrl[0].map((v, i) => 2 * v - ctrl[1][i]), ...ctrl, ctrl[ctrl.length - 1].map((v, i) => 2 * v - ctrl[ctrl.length - 2][i])];
  const seg = (p0, p1, p2, p3, t) => {
    const d = (a, b) => Math.pow(hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1e-4, 0.5);
    const t0 = 0, t1 = t0 + d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3), u = mix(t1, t2, t);
    const L = (a, b, ta, tb) => a.map((v, i) => (tb - u) / (tb - ta) * v + (u - ta) / (tb - ta) * b[i]);
    const A1 = L(p0, p1, t0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3);
    const B1 = L(A1, A2, t0, t2), B2 = L(A2, A3, t1, t3);
    return L(B1, B2, t1, t2);
  };
  // dense polyline, then resample at equal arc length
  const dense = [];
  for (let i = 1; i < P.length - 2; i++) for (let k = 0; k < 40; k++) dense.push(seg(P[i - 1], P[i], P[i + 1], P[i + 2], k / 40));
  dense.push(ctrl[ctrl.length - 1].slice());
  const cum = [0];
  for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1], dense[i][2] - dense[i - 1][2]));
  const len = cum[cum.length - 1], n = Math.ceil(len / step) + 1, S = new Float32Array(n * 3);
  for (let k = 0, j = 0; k < n; k++) {
    const s = min(k * step, len);
    while (j < cum.length - 2 && cum[j + 1] < s) j++;
    const t = (s - cum[j]) / ((cum[j + 1] - cum[j]) || 1);
    for (let c = 0; c < 3; c++) S[k * 3 + c] = mix(dense[j][c], dense[j + 1][c], t);
  }
  const at = (s, o) => { s = clamp(s, 0, len); const f = s / step, k = min(floor(f), n - 2), t = f - k; for (let c = 0; c < 3; c++) o[c] = mix(S[k * 3 + c], S[k * 3 + 3 + c], t); return o; };
  const tan = (s, o) => { const k = clamp(floor(clamp(s, 0, len) / step), 0, n - 2); let x = S[k * 3 + 3] - S[k * 3], y = S[k * 3 + 4] - S[k * 3 + 1], z = S[k * 3 + 5] - S[k * 3 + 2]; const l = hypot(x, y, z) || 1; o[0] = x / l; o[1] = y / l; o[2] = z / l; return o; };
  // frame(s, o9): forward(0..2), right(3..5), up(6..8); right is horizontal (world up as reference), as the engine's camera
  const frame = (s, o) => {
    tan(s, o); const fx = o[0], fy = o[1], fz = o[2];
    let rx = fz, rz = -fx; const rl = hypot(rx, rz) || 1; rx /= rl; rz /= rl;
    o[3] = rx; o[4] = 0; o[5] = rz;
    // up = forward × right, which matches the engine's camera basis (up.y = cos(pitch) >= 0)
    o[6] = fy * rz; o[7] = fz * rx - fx * rz; o[8] = -fy * rx;
    return o;
  };
  // yaw/pitch for the engine camera looking along direction d
  const yawPitch = (dx, dy, dz, o) => { o[0] = Math.atan2(dx, dz); o[1] = Math.asin(clamp(dy, -1, 1)); return o; };
  // ghost rail points (engine point kind 4 + u, u = s / len): xyz, size, rgb, kind
  const ghost = (spacing, size, rgb) => {
    const out = [], p = [0, 0, 0];
    for (let s = 0; s <= len; s += spacing) { at(s, p); out.push(p[0], p[1], p[2], size, rgb[0], rgb[1], rgb[2], 4 + 0.999 * s / len); }
    return out;
  };
  return { len, step, samples: S, n, at, tan, frame, yawPitch, ghost };
}
