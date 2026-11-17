// Builds one self-contained HTML page per scene into build/ (no dependencies, no minify).
//   node build.mjs                 GLB models stay separate files, fetched at run time (models/*.glb beside the pages)
//   node build.mjs --inline-glb    also inlines each page's `glb` models (base64, up to INLINE_MAX bytes each) when the file exists
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, copyFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), out = path.join(here, 'build');
mkdirSync(out, { recursive: true });
const INLINE = process.argv.includes('--inline-glb') || process.env.SG_INLINE_GLB === '1', INLINE_MAX = 1.5 * 1024 * 1024;
const src = (f) => readFileSync(path.join(here, 'src', f), 'utf8');
const tpl = readFileSync(path.join(here, 'template.html'), 'utf8');
const SCENES = [
  { file: 'nebula.js', page: 'nebula-reef.html', title: 'Nebula Reef', blurb: 'An asteroid reef inside a teal and amber nebula, rebuilt in code from concept SPC-1.3. No models or textures.', other: 'hollow-asteroid.html', otherName: 'Hollow Asteroid' },
  { file: 'hollow.js', page: 'hollow-asteroid.html', title: 'Hollow Asteroid', blurb: 'A cave inside a hollow asteroid with coral sponges and a little ship, rebuilt in code from concept SPC-3.2. No models or textures.', other: 'nebula-reef.html', otherName: 'Nebula Reef' },
];
SCENES.push(
  { files: ['nebula.js', 'rail.js', 'fx2d.js', 'turret.js', 'holo.js', 'shell.js', 'soundboard.js', 'combat.js', 'glb.js', 'whales.js', 'titlefx.js', 'music-map.js', 'music.js', 'warp.js', 'realm-underwater.js', 'realms.js', 'pulse.js', 'reefrun.js'], realms: true, glb: ['hull', 'turret_dome', 'turret_barrels', 'pod_near', 'pod_far', 'cannons_near', 'cannons_far'].map((f) => `models/reef-gunship/${f}.glb`), page: 'reef-run.html', title: 'Reef Run', blurb: 'Blast through the asteroid reef on rails. Mouse to aim, click or Space to fire, WASD to steer, Esc for settings.', other: 'cave-rescue.html', otherName: 'Cave Rescue', go: 'Start run' },
  { files: ['bodytoy.js', 'rail.js', 'fx2d.js', 'turret.js', 'shell.js', 'bodytoy-game.js'], page: 'body-toy.html', title: 'Body Defenders: Gooey Run', blurb: 'Fly a tiny toy ship down a gooey blood vessel and splat the grumpy germs. Built in code from concept BD-1.0.', other: 'body-glow.html', otherName: 'Glow Run', go: 'Start run' },
  { files: ['bodyglow.js', 'rail.js', 'fx2d.js', 'turret.js', 'shell.js', 'bodyglow-game.js'], page: 'body-glow.html', title: 'Body Defenders: Glow Run', blurb: 'Race a glowing vein and blast the virus swarm. Built in code from concept BD-2.2.', other: 'body-micro.html', otherName: 'Micro Mission', go: 'Start run' },
  { files: ['bodymicro.js', 'rail.js', 'fx2d.js', 'turret.js', 'shell.js', 'bodymicro-game.js'], page: 'body-micro.html', title: 'Body Defenders: Micro Mission', blurb: 'Glide a capillary and help the body’s cells. Built in code from concept BD-3.0.', other: 'body-heart.html', otherName: 'Heart Gate', go: 'Start run' },
  { files: ['bodyheart.js', 'rail.js', 'fx2d.js', 'turret.js', 'shell.js', 'bodyheart-game.js'], page: 'body-heart.html', title: 'Body Defenders: Heart Gate', blurb: 'Thread the heart’s valve gates on the beat. Built in code from concept BD-4.0.', other: 'body-toy.html', otherName: 'Gooey Run', go: 'Start run' },
  { files: ['nebula.js', 'glb.js', 'glblab.js'], glb: ['models/snow-globe.glb'], page: 'glb-lab.html', title: 'GLB Lab', blurb: 'A textured GLB model (a Tripo export) in the Nebula Reef scene, lit by the scene. Add ?glb=models/your.glb to load another.', other: 'reef-run.html', otherName: 'Reef Run', boot: 'await GLB_LAB.load(); await runScene(SCENE);' },
  { files: ['nebula.js', 'whales.js'], page: 'whale-lab.html', title: 'Whale Lab', blurb: 'A neon space whale and its fish school in the Nebula Reef, rebuilt in code from concept SW-5.3 at the concept\'s framing. Add ?pal=pink or ?pal=violet for the colour variants, ?t= for the swim time.', other: 'reef-run.html', otherName: 'Reef Run', boot: 'WHALES.lab(SCENE); await runScene(SCENE);' },
  { files: ['nebula.js', 'pulse.js'], page: 'pulse-lab.html', title: 'Pulse Lab', blurb: 'The Reality Pulse on a loop: a shot hits the centre rock and the next realm spreads from it inside a crackling shell. Add ?t= to freeze a moment, ?hold=0..1 to hold the spread, ?pulse=calm or ?pulse=cheap for the reduced-motion and slow-GPU versions.', other: 'reef-run.html', otherName: 'Reef Run', boot: 'PULSE.lab(SCENE); await runScene(SCENE);' },
  { files: ['rail.js', 'reefbay.js'], page: 'reef-bay.html', title: 'Reef Run: Launch Bay', blurb: 'The mothership launch trench and lit take-off pad that open Reef Run, rebuilt in code from concept RI-1.0. Add ?launch to watch the take-off.', other: 'reef-run.html', otherName: 'Reef Run', boot: 'const SCENE = REEF_BAY.scene; await runScene(SCENE);' },
  { files: ['hollow.js', 'rail.js', 'fx2d.js', 'turret.js', 'shell.js', 'caverescue.js'], page: 'cave-rescue.html', title: 'Cave Rescue', blurb: 'Fly the cave on rails and hit stranded explorers with your tractor shot to bring them home. Esc for settings.', other: 'reef-run.html', otherName: 'Reef Run', go: 'Start run' },
);
// Reef Run's body realm pack (realm-body.js, GAME_API.md "Body realm") loads just before realms.js
{ const rr = SCENES.find((x) => x.page === 'reef-run.html'); if (rr && !rr.files.includes('realm-body.js')) rr.files.splice(rr.files.indexOf('realms.js'), 0, 'realm-body.js'); }
for (const s of SCENES) {
  const files = s.files || [s.file];
  let parts; try { parts = files.map(src); } catch { continue; } // a game page builds once all its modules exist
  const boot = s.boot || (s.files ? 'Shell.boot(SCENE, GAME); await runScene(SCENE);' : 'await runScene(SCENE);');
  // optional build-time inlining of small models (off by default): GLB.load(url) reads GLB_INLINE[url] before fetching
  const inl = INLINE ? (s.glb || []).filter((u) => existsSync(path.join(out, u)) && statSync(path.join(out, u)).size <= INLINE_MAX) : [];
  const pre = inl.length ? `const GLB_INLINE = {${inl.map((u) => `${JSON.stringify(u)}: '${readFileSync(path.join(out, u)).toString('base64')}'`).join(', ')}};` : '';
  // the reality switch (realms.js): the other worlds' scene modules, each in its own scope (they all define SCENE), built on
  // first use; and the reality-switch models that exist (models/reality-switch/*.glb), so a missing one is never fetched
  let realm = '';
  if (s.realms) {
    const RS = { hollow: 'hollow.js', toy: 'bodytoy.js', glow: 'bodyglow.js', micro: 'bodymicro.js', heart: 'bodyheart.js' };
    realm = 'const REALM_SCENES = {\n' + Object.entries(RS).map(([k, f]) => `${k}: () => {\n${src(f)}\nreturn SCENE;\n}`).join(',\n') + '};';
    const md = path.join(out, 'models', 'reality-switch');
    const have = existsSync(md) ? readdirSync(md).filter((f) => f.endsWith('.glb')).map((f) => 'models/reality-switch/' + f) : [];
    realm += `\nconst REALITY_GLB = ${JSON.stringify(have)};`;
  }
  const js = [pre, src('math.js'), src('engine.js'), realm, ...parts, boot].filter(Boolean).join('\n');
  const wrap = `(async()=>{${js}\n})().catch(e=>{console.error(e);document.body.className='l e';document.getElementById('s').textContent=(e.cause?'':'Failed to start: ')+e.message});`;
  const html = tpl.replaceAll('/*TITLE*/', s.title).replace('/*BLURB*/', s.blurb).replace('/*OTHER*/', s.other).replace('/*OTHERNAME*/', s.otherName).replace('Fly in</button>', (s.go || 'Fly in') + '</button>').replace('/*SCRIPT*/', () => wrap);
  writeFileSync(path.join(out, s.page), html);
  console.log(`${s.page}: ${(html.length / 1024).toFixed(1)} kB`);
}
// title-fx.html: the pick board for Reef Run's title text effects (titlefx.js; INTRO.md "Title FX"). Plain 2D page, no engine.
{ const html = `<!doctype html>
<html lang=en>
<head>
<meta charset=utf-8>
<title>Reef Run Title FX</title>
<meta name=viewport content="width=device-width,initial-scale=1">
</head>
<body>
<script>
${src('titlefx.js')}
${src('titlefx-board.js')}
</script>
</body>
</html>
`;
  writeFileSync(path.join(out, 'title-fx.html'), html); console.log(`title-fx.html: ${(html.length / 1024).toFixed(1)} kB`); }
