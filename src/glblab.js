// ============================================================================
// glblab.js: GLB Lab. A textured GLB model (glb.js + G.addMesh) spinning in the Nebula Reef scene, lit by the scene.
//   glb-lab.html                     the snow globe test asset (models/snow-globe.glb, copied by build.mjs)
//   glb-lab.html?glb=models/x.glb    any other model (fetched relative to the page)
//   glb-lab.html?shot=0&name=glb-lab one deterministic frame (?t= sets the spin time)
//   &forward=-z&up=+y&yaw=0.5        orientation fix-up, as G.addMesh's options; &size=1.4 sets the fitted height (m)
//   &light=neutral                   white key and grey ambient instead of the scene's (checks the texture's own colours)
// Debug: window.glbLab = { handle, model }.
// ============================================================================
const GLB_LAB = (() => {
  const url = QS.get('glb') || 'models/snow-globe.glb', SIZE = +QS.get('size') || 1.6, DIST = 3.4, SPIN = 0.6;
  let model = null, h = null;
  if (QS.get('light') === 'neutral') SCENE.meshLight = { key: [1.3, 1.3, 1.3], ambUp: [0.35, 0.35, 0.35], ambDown: [0.25, 0.25, 0.25], rim: [0, 0, 0], wrap: 0.3 };
  const build0 = SCENE.build;
  SCENE.build = function () {
    const G = build0.call(SCENE);
    G.onEngine = (G) => {
      h = G.addMesh(model, { center: true, forward: QS.get('forward') || '+z', up: QS.get('up') || '+y', yaw: +QS.get('yaw') || 0 });
      h.scale = SIZE / h.bounds.size[1]; // fit the height
      const p = G.poses[0], cp = cos(p[4]), sp = sin(p[4]); // in front of the concept camera, a little below the centre
      h.pos[0] = p[0] + sin(p[3]) * cp * DIST; h.pos[1] = p[1] + sp * DIST - 0.35; h.pos[2] = p[2] + cos(p[3]) * cp * DIST;
      window.glbLab = { handle: h, model };
      console.log(`GLB Lab: ${url}: ${model.prims.length} primitive(s), ${model.nTri} triangles, ${model.images.length} texture(s), size ${h.bounds.size.map((v) => v.toFixed(3)).join(' × ')}`);
    };
    G.post = (F) => { const a = (F[8] * SPIN + PI) * 0.5; h.q[1] = sin(a); h.q[3] = cos(a); }; // spin about up; at t = 0 the model's front (+Z after the fix-up) faces the camera
    return G;
  };
  return { async load() { model = await GLB.load(url); } };
})();
