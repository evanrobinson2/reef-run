// ============================================================================
// reefrun.js: Reef Run. A rail shooter through Nebula Reef (GAME_API.md). Blast target rocks with a heat-limited,
// levelling blaster, crack the big ones, collect crystals and fly out through the Ring Gate.
// Rail: concept camera (origin, yaw 0, pitch 0.42) → the dense swarm → a loop through the wider reef past the
// Spine arches → the Ring Gate. Load-time allocation only; update() and post() reuse preallocated typed arrays.
// Hit effects come from FX (fx2d.js, Castle Smash's pow and boom) when it is loaded; this module adds only sparks.
// ============================================================================
const GAME = (() => {
  // ---------------------------------------------------------------- tuning
  const SPEED = 14, BOOST_ADD = 10, BOX_X = 6, BOX_Y = 4, LOOK_AIM = 0.15, CORRIDOR = 7;
  const BOLT_SPEED = 170, BOLT_LIFE = 0.85, LOCK_RANGE = 170, RADAR_RANGE = 300;
  // view (VIEW.md): cockpit = the camera is the ship; shoulder = camera SH_BACK behind, SH_UP above, SH_RIGHT right of it
  const SH_BACK = 5, SH_UP = 1.15, SH_RIGHT = 0.9, BLEND_T = 0.35;
  // optional GLB ship (GAME_API.md "Textured meshes"): when models/reef-ship.glb exists (or ?shipglb=<url> is given) it replaces
  // the procedural shoulder-view ship: same placement, banking and view blend, scaled so its forward extent is SHIP_GLB.length m.
  // Missing file: today's ship. SHIP_FIX: the model's own axes per file (G.addMesh's forward / up, plus a yaw offset in rad),
  // so its nose ends up on +Z and its top on +Y; '*' is the default. ?shipfwd= ?shipup= ?shipyaw= override it for a quick test.
  const SHIP_GLB = { url: 'models/reef-ship.glb', length: 2.4, tint: [1, 1, 1], emissive: [0, 0, 0], emissiveCut: 1 };
  const SHIP_FIX = {
    '*': { forward: '+z', up: '+y', yaw: 0, mirror: true }, // Tripo exports normalised like the seasonal decor: +Y up, front on +Z.
    // mirror: glTF is right-handed (a ship's right is -X when +Z is forward) but the engine is left-handed (right = +X), so x is negated
  };
  // ---- the articulated gunship (GAME_API.md "Articulated ship"; carpetshark: "get the shup fully done, and articulated and animated", "it needs
  // a turret bro"). Tripo parts from assets/reef-gunship (parts.json), each its own mesh handle, posed every frame as
  // ship · T(pivot) · R(axis, angle) · T(-pivot), parents first. Asset space: metres, +Z forward, +Y up, ship right = -X, underside at
  // y = 0; ship space here: x negated (right = +X), y - y0 (origin at the bounding-box centre), already 2.4 m long. Points below are in
  // ASSET space (as parts.json and the notes give them); the loader converts them. If any part fails, `whole` is the fallback.
  const GUN = {
    dir: 'models/reef-gunship/', whole: 'whole.glb', y0: 0.6557,
    files: ['hull.glb', 'turret_dome.glb', 'turret_barrels.glb', 'pod_near.glb', 'pod_far.glb', 'cannons_near.glb', 'cannons_far.glb'],
    turret: [-0.0051, 0.8184, -0.4795], trunnion: [-0.0005, 1.0331, -0.2121], // yaw ring centre; barrel pitch axis (parts.json)
    podR: [-0.6094, 0.3749, -0.2747], podL: [0.5757, 0.3038, -0.2496],         // pod tilt pivots (inboard face)
    tubeZ: -0.09,                    // barrel triangles wholly forward of this z are the two tubes (split by side for alternating recoil)
    canMount: [[-0.82, 0.23, 0.21], [0.815, 0.22, 0.21]], // cannon pair yaw mounts (rear centre), right then left pod
    canTip: [[-0.745, 0.21, 1.2], [-0.895, 0.21, 1.2], [0.71, 0.21, 1.1], [0.92, 0.21, 1.1]], // muzzles: right pod pair, left pod pair
    glow: [[0.17, 0.57, -1.23, 0.15, 0], [-0.17, 0.57, -1.23, 0.15, 0], [-0.94, 0.36, -0.88, 0.17, 1], [0.93, 0.39, -0.93, 0.17, 2]], // engine glows: x y z size part(0 hull, 1 pod R, 2 pod L)
    eye: [0, 1.40, -0.4795],         // the gunner's eye: on the turret's yaw axis, just over the dome (cockpit view, split P1; `barrels off`)
    // the gunner's seat (cockpit view, barrels on; carpetshark: "change camera position so turrets are visible, make them functional"): the eye sits
    // `back` m behind the yaw axis and `up` m above the barrels' trunnion, in the LOOK frame, so the twin barrels run up from the bottom
    // of the screen toward the reticle and stay framed as you look around. kick: m the eye jolts back per blaster shot (×0.35 reduced motion)
    seat: { back: -0.05, up: 0.11, kick: 0.045, mantlet: false }, // mantlet: also draw the mantlet and cradle block (it fills the lower screen from this seat, so off: the twin tubes run up from the bottom corners toward the reticle)
    yawRate: 2 * PI, pitchRate: 1.6 * PI, lag: 14, // rad/s rate limits and the 1/s ease that gives the turret its mechanical lag
    pitchMin: -10 * PI / 180, pitchMax: 70 * PI / 180, recoil: 0.25, recoilT: 0.12,
    podTilt: 20 * PI / 180, podBank: 0.45, podBoost: 8 * PI / 180, podRate: 5, // pods: lean into turns (differential) and tip forward on boost
    canOut: 60 * PI / 180, canIn: 18 * PI / 180, // split P2/P3 cannon pairs: yaw toward the gunner's aim, 60° outboard, 18° inboard (more clips the nose)
    bob: 0.028, bobHz: 0.55, flashT: 0.07, tint: [1, 1, 1],
    // lighting for Reef Run's meshes (SCENE.meshLight is game-scoped: set in prepare; Nebula Reef itself has no meshes). Matched against
    // the concept at its angle (compare/shots/reef-gunship-light.png): Nebula's default (warm key 2.0/1.45/0.85, strong teal ambient)
    // turns the off-white hull mint-green; this keeps the amber key's direction and warmth but neutralises it a little, evens the
    // teal ambient, and trims the amber rim, so the hull reads off-white with teal panels and the canopy stays dark teal glass.
    light: { key: [1.62, 1.36, 1.04], ambUp: [0.17, 0.31, 0.3], ambDown: [0.045, 0.08, 0.078], wrap: 0.28, rim: [0.25, 0.16, 0.08], rimPow: 3, rimBack: 1 },
  };
  // turret control (GAME_API.md "Turret", turret.js): the ship flies the rail; the player looks freely and shoots. Drifters are
  // extra rocks that come in from the sides and behind (turret only): passers miss by DR_MISS m, rammers home on the ship.
  const NDRIFT = 24, NDRIFT_X = 24, DR_MISS = [3.5, 7], ARROW_RANGE = 160, NBEST_TURRET = 4;
  const GATE_R = 14, GATE_BONUS = 1000;
  // split screen (GAME_API.md "Split screen"; carpetshark: "a multiplayer splitscreen mode - up to 4 players blasting .. wild"): one ship on
  // autopilot, up to four turret gunners. Each gunner sits at a hardpoint (ship model space: x right, y up, z forward): P1 top,
  // P2 belly, P3 left, P4 right, and has their own turret, viewport, reticle, brackets, blaster heat and level, score and chain.
  // Hull and difficulty are shared. PBOLT: each player's bolt colour (HDR; P1 is the 1-player amber). BOT: ?fakepads bots.
  // Gunship hardpoints (ship space, set from GUN at load): P1 the top turret (eye over the dome), P2 the right cannon pod, P3 the left
  // cannon pod, P4 a belly hardpoint (no mesh); in shoulder view every camera orbits the ship instead.
  const HPTS = [[0, 0.744, -0.48], [0.94, 0.14, 0.05], [-0.93, 0.07, 0.05], [0, -0.75, 0.2]];
  const PBOLT = [[6, 2.6, 0.7], [0.8, 3.8, 6.2], [6, 0.9, 5.2], [3, 6.2, 0.9]];
  const BOT = { range: 120, turn: 6, cone: 0.06, hold: 0.35 };
  // 4-player quality step: render at 0.85 × resolution (72 % of the pixels). Bench, 1920×1080, 4 bot gunners: median 10.2 → 8.5 ms
  // scene GPU time; drawing fewer points saved nothing measurable (GAME_API.md "Split screen"). ?q4=<scale> overrides it for testing.
  const MP_Q4 = { scale: 0.85 };
  if (typeof QS !== 'undefined' && QS.get('q4')) MP_Q4.scale = +QS.get('q4') || 1;
  // ---- difficulty (carpetshark, 2026-11-16: "allow user to pick difficulty, easy, medium, hard, and \"Zeke's Finding Religion\"").
  // One table. hull: hull points · dodge: turret autopilot strength (0 = off; scales AUTO's look, margin and rate) · drift:
  // drifters flown (of the NDRIFT + NDRIFT_X pool, spread evenly along the run) · ram: how many of them home in · homeAdd: m/s
  // a homer flies faster than the ship · homeTurn: homing turn rate (1/s) · rock: hull lost flying into a rock · chainDecay: s
  // per chain step once the window lapses · heat: × blaster heat per shot · score: × every point (kills, crystals, gate, tally
  // bonuses). Applied at each run start; Frame 0 never depends on it (drifters are hidden there and the pool is always built).
  const DIFF = {
    // Super Easy (combat.js; for kids): Easy's can't-lose rules plus AI aim assist: the turret eases onto the best target and the player only fires
    supereasy: { label: 'Super Easy', hull: 5, dodge: 1.4, drift: 12, ram: 2, homeAdd: 3, homeTurn: 0.8, rock: 1, chainDecay: 1.2, heat: 0.7, score: 0.5, safe: true, regen: 5, hitCost: 50, assist: true },
    easy:   { label: 'Easy',   hull: 5, dodge: 1.4,  drift: 16, ram: 4,  homeAdd: 4,  homeTurn: 1.0, rock: 1, chainDecay: 0.9,  heat: 0.8,  score: 0.75,
              safe: true, regen: 6, hitCost: 100 }, // carpetshark: "easy you can't lose": hull never drops below 1, refills one point per `regen` s without a hit; a hit costs hitCost points (never below 0) and the chain
    medium: { label: 'Medium', hull: 3, dodge: 1,    drift: 24, ram: 8,  homeAdd: 6,  homeTurn: 1.4, rock: 1, chainDecay: 0.5,  heat: 1,    score: 1 },
    hard:   { label: 'Hard',   hull: 2, dodge: 0.45, drift: 34, ram: 16, homeAdd: 9,  homeTurn: 1.8, rock: 1, chainDecay: 0.4,  heat: 1.15, score: 1.5 },
    zeke:   { label: "Zeke's Finding Religion", hull: 1, dodge: 0, drift: 48, ram: 34, homeAdd: 11, homeTurn: 2.2, rock: 1, chainDecay: 0.3, heat: 1.4, score: 3, callout: true },
  };
  const DIFF_KEYS = Object.keys(DIFF), DIFF_STORE = 'reef-run:difficulty';
  let diffKey = 'medium';
  try { const v = localStorage.getItem(DIFF_STORE); if (DIFF[v]) diffKey = v; } catch {}
  if (typeof QS !== 'undefined' && DIFF[QS.get('difficulty')]) diffKey = QS.get('difficulty');
  let DF = DIFF[diffKey], HULL_MAX = DF.hull;
  // turret autopilot dodge: the ship steers gently around rocks on its line (inside the pilot box), never around drifters,
  // so the homing rammers stay the real threat. look: seconds ahead; margin: m of clearance past the hull radius;
  // rate: 1/s steering ease; box: fraction of BOX_X / BOX_Y the autopilot may use.
  const AUTO = { on: true, look: 1.7, margin: 1.2, rate: 2.4, box: 0.8 };
  // ---- arcade scoring (carpetshark, 2026-11-16: "accumulating scores and make it arcade-y"). One table, so it can be retuned.
  const ARCADE = {
    pts: { small: 100, medium: 250, large: 500, ram: 150 }, // per kill by rock radius (< 1.1 m small, < 1.9 m medium, else large); rammers add `ram`
    sizeM: 1.1, sizeL: 1.9,
    look: { side: 1.5, behind: 2 },     // free-look bonus: the kill was more than 60° (side) or 120° (behind) off the ship's heading
    chainMax: 8, chainWindow: 2.2,      // kills within the window climb the chain ×1 → ×8; a hull hit resets it to ×1
    chainDecay: 0.5,                    // once the window lapses the chain falls one step per this many seconds (per difficulty: DIFF.chainDecay)
    extra: [10000, 25000, 50000, 100000, 200000], // score thresholds: +1 hull (up to the max) or, at full hull, a one-hit shield
    accuracy: 3000,                     // tally: bonus = accuracy (0..1) × this
    chain: 400,                         // tally: bonus = best chain × this
    timePer: 100, parPad: 6,            // tally (through the gate): (par - time) × timePer; par = rail run at cruise speed + parPad s
    noDamage: 5000,                     // tally (through the gate, no hull hits)
    table: 10, initials: 3,             // local high-score table
  };
  const COMBO_MAX = ARCADE.chainMax, COMBO_TIME = ARCADE.chainWindow;
  // Blaster levels. Data, so a shop or upgrade screen can edit or extend it later (BACKLOG row 6).
  // rate: shots/s · bolts per shot · spread: rad between spread bolts · heat per shot · cool: heat/s · size: bolt radius (m) · dmg per bolt
  const WEAPONS = [
    { xp: 0, name: 'Ember blaster', rate: 5.0, bolts: 1, spread: 0, heat: 0.12, cool: 0.40, size: 0.09, dmg: 1.0 },
    { xp: 300, name: 'Ember Mk II', rate: 6.0, bolts: 1, spread: 0, heat: 0.10, cool: 0.45, size: 0.11, dmg: 1.5 },
    { xp: 800, name: 'Twin Ember', rate: 6.5, bolts: 2, spread: 0, heat: 0.10, cool: 0.50, size: 0.12, dmg: 1.5 },
    { xp: 1500, name: 'Twin Flare', rate: 7.5, bolts: 2, spread: 0, heat: 0.09, cool: 0.56, size: 0.14, dmg: 2.0 },
    { xp: 2500, name: 'Nova spread', rate: 8.0, bolts: 3, spread: 0.035, heat: 0.085, cool: 0.62, size: 0.16, dmg: 2.5 },
  ];
  const fxOn = () => typeof FX !== 'undefined';
  const CMB = typeof COMBAT !== 'undefined' ? COMBAT : null, SBD = typeof SOUNDBOARD !== 'undefined' ? SOUNDBOARD : null; // HOOK: throttle, laser, proximity, aim assist (combat.js); the sound board (soundboard.js)
  const PU = typeof PULSE !== 'undefined' ? PULSE : null; // HOOK (pulse.js, GAME_API.md "Reality Pulse"): alt-fire spreads the next realm from what it hits
  const WH = typeof WHALES !== 'undefined' ? WHALES : null; // neon space whales (whales.js, GAME_API.md "Space whales"): scenery, never targets

  // ---------------------------------------------------------------- start sequence (INTRO.md). One timing table, in seconds from Frame 0, so
  // it can be retimed to the owner's animation sting, which ends on Frame 0. Frame 0 is pixel-identical every run: rail position sHero,
  // the concept camera, scene clock INTRO.time0, empty pools, open cockpit (no blast shield), no HUD (?frame0 holds it; ?shot=0&frame0
  // saves it). The cracks follow the selected concept RI-4.0 (concept/reef-intro/DECOMPOSITION.md).
  const INTRO = {
    pre: [],           // HOOK, deliberately empty: a future ship-bay launch would go here as segments { dur, step(t, F) } that play
                       // BEFORE Frame 0 and end on it (step may set the camera in F after the rail camera is placed). Not built:
                       // the bay and launch pad wait for owner-approved concept art.
    time0: 0,          // scene clock F[8] at Frame 0 (drift points, ghost-rail pulses, gate beacons all read it)
    shield: false,     // HOOK, disabled: carpetshark removed the blast shield ("remove the black mask and the silly tiled overlay thing",
    shieldStart: 0.35, // 2026-11-16). With shield: true and a drawShield(g, w, h, amount) the timings below would apply again;
    shieldEnd: 1.55,   // nothing draws it now, so Frame 0 is the open cockpit view.
    lead: 0.3,         // the first beat-synced event (the title slam or the count) comes at least this long after Frame 0
    hudStart: 0.2,     // the HUD boot (layers power on in turn, with flicker and scanlines) never starts before this; it runs from
    hudLead: 1,        // this many beats before the first number to half a beat before GO
    goHold: 1.3,       // GO stays up this long after control is handed over (control and the run timer start ON GO)
    speed0: 0.3,       // ship speed at Frame 0 (x SPEED), easing up to full speed at control
    skipAfter: 0.1,    // a fresh fire press, Esc or Enter skips the intro once this much has played
  };
  // ---- title slam and countdown style (titlefx.js, INTRO.md "Title FX"). carpetshark, 2026-11-16: "remove the MP4 all together, it was fun,
  // but it's not the sauce" and "let's get to the sauce immediately": Start plays Soaring Melody from 0 and the run opens on Frame 0
  // with a beat-synced title slam, then 3 2 1 GO (start sequence below). `titlefx <style>` / ?titlefx= pick the look.
  const TFX = typeof TITLEFX !== 'undefined' ? TITLEFX : null;
  const title = { on: true, done: false }; // on: the slam before the first run of a page visit (`title on|off`, ?title=off)
  try { if (localStorage.getItem('reef-run:title') === 'off') title.on = false; } catch {}
  if (typeof QS !== 'undefined' && (QS.get('title') === 'off' || QS.get('title') === 'on')) title.on = QS.get('title') === 'on';
  if (typeof QS !== 'undefined' && (QS.has('shot') || QS.has('frame0') || QS.has('bench'))) title.on = false; // fixed frames and benchmarks never show it
  let fxStyle = TFX ? TFX.DEFAULT : 'slam', fxPick = 'random'; // carpetshark: "randomly toggle" - a different look each run unless one is chosen
  try { const v = localStorage.getItem('reef-run:titlefx'); if (TFX && (TFX.NAMES.includes(v) || v === 'random')) fxPick = v; } catch {}
  if (typeof QS !== 'undefined' && TFX && (TFX.NAMES.includes(QS.get('titlefx')) || QS.get('titlefx') === 'random')) fxPick = QS.get('titlefx');
  function fxRoll() { if (!TFX) return; if (fxPick !== 'random') { fxStyle = fxPick; return; } const o = TFX.NAMES.filter((k) => k !== fxStyle); fxStyle = o[(Math.random() * o.length) | 0]; }
  const FRAME0 = typeof QS !== 'undefined' && QS.has('frame0'), FRAME0_BARE = FRAME0 && QS.get('frame0') === 'bare', IS_SHOT = typeof SHOT !== 'undefined' && SHOT;
  const intro = { on: true, active: false, frozen: false, t: 0, shown0: false, fireHeld: true, skipped: false, shield: 0, power: 1, phase: 'off' };
  try { const v = localStorage.getItem('reef-run:intro'); if (v === 'off') intro.on = false; } catch {}
  if (typeof QS !== 'undefined' && (QS.get('intro') === 'off' || QS.get('intro') === 'on')) intro.on = QS.get('intro') === 'on';
  const TICK3 = [INTRO.hudStart, (INTRO.hudStart + INTRO.hudEnd) / 2, INTRO.hudEnd]; // sound-board countdown ticks during the HUD boot
  const preDur = () => { let d = 0; for (const g of INTRO.pre) d += g.dur; return d; };
  const smooth = (x, a, b) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  // ---------------------------------------------------------------- state
  let rail = null, len = 0, sHero = 0, sGate = 0, G = null, hud = null, F = null;
  let tanH = Math.tan(HERO_FOV / 2), aspect = 16 / 9;
  const stats = { score: 0, combo: 1, hull: HULL_MAX, hullMax: HULL_MAX, level: 1, xp: 0, xpNext: WEAPONS[1].xp, heat: 0, overheated: false,
    counterLabel: 'Rocks', counterValue: 0, counterMax: 0, kills: 0, weaponName: WEAPONS[0].name, speed: SPEED, boost: 0 };
  let s = 0, ox = 0, oy = 0, spd = SPEED, runT = 0, started = false, ended = false;
  let score = 0, combo = 1, comboT = 0, bestCombo = 1, hull = HULL_MAX, xp = 0, level = 1, heat = 0, overheated = false, fireCD = 0;
  let boost = 0, surge = 0, shake = 0, killed = 0, crystalsGot = 0;
  // cam is the ship (the pilot position: hull hits, crystals, radar, bolt origin); eye is the rendered camera, which
  // equals cam in cockpit view and sits behind the ship in shoulder view. CB is the shared look basis f(0..2) r(3..5) u(6..8).
  const cam = new Float64Array(3), eye = new Float64Array(3), CB = new Float64Array(9);
  let shell = null, vb = 0, ve = 0, shipX = -SH_RIGHT, bank = 0, oxPrev = 0, shipMesh = null, SH0 = 0;
  let shipH = null, shipFit = 1; // the GLB ship's mesh handle (G.addMesh) and its scale to SHIP_GLB.length, once loaded
  // the gunship rig: GH = the 9 mesh handles (hull, dome, mantlet, tube A, tube B, pod R, pod L, cannons R, cannons L); XQ/XT each
  // part's ship-space transform this frame (quaternion, translation); QSH/SPOS the ship's world pose; GP the pivots and points in ship space
  const GH_HULL = 0, GH_DOME = 1, GH_MANT = 2, GH_TA = 3, GH_TB = 4, GH_PR = 5, GH_PL = 6, GH_CR = 7, GH_CL = 8, NGH = 9;
  let SCN = null, GH = null, gunEyeK = 0, barrelsOn = true, barrelNext = 0, gunT = 0;
  try { if (localStorage.getItem('reef-run:barrels') === 'off') barrelsOn = false; } catch {}
  if (typeof QS !== 'undefined' && (QS.get('barrels') === 'on' || QS.get('barrels') === 'off')) barrelsOn = QS.get('barrels') === 'on';
  const XQ = new Float64Array(NGH * 4), XT = new Float64Array(NGH * 3), QSH = new Float64Array([0, 0, 0, 1]), SPOS = new Float64Array(3);
  const RQ = new Float64Array(8), RV = new Float64Array(6);
  const GP = { turret: new Float64Array(3), trunnion: new Float64Array(3), podR: new Float64Array(3), podL: new Float64Array(3), eye: new Float64Array(3),
    canMount: new Float64Array(6), canTip: new Float64Array(12), muzzle: new Float64Array(6), glow: new Float64Array(GUN.glow.length * 5) };
  // animated state: turret yaw/pitch (rad, ship-relative), recoil clock per tube, pod tilts, cannon yaws, muzzle flashes (2 tubes + 4 cannons)
  const GA = { yaw: 0, pitch: 0, podR: 0, podL: 0, canR: 0, canL: 0, aimYaw: 0, aimPitch: 0 };
  const RT = new Float64Array([9, 9]), MF = new Float64Array(6), MZW = new Float64Array(18), TBW = new Float64Array(6), GLW = new Float64Array(GUN.glow.length * 3);
  const NGP = GUN.glow.length + 6; // gunship points: engine glows, then muzzle flashes
  const L = new Float64Array(3); // smoothed look direction
  const T1 = new Float64Array(3), T2 = new Float64Array(3), T3 = new Float64Array(3), PJ = new Float64Array(3), YP = new Float64Array(2);
  const aim = new Float64Array(2);
  // turret: look state (shared module), this frame's mode, the ship's own rail basis (the ship flies the rail while you look)
  const TT = typeof Turret !== 'undefined' ? Turret.create() : null, SB = new Float64Array(9), FR2 = new Float64Array(9), ED = new Float64Array(4);
  let turret = false, TH = null, driftKilled = 0;
  let roll = 0, chainDec = 0, shield = 0, extraNext = 0, shots = 0, boltHits = 0; // arcade: rolling HUD score, chain decay clock, shield, next extra threshold, accuracy
  const ARW = new Float32Array(5 * 5), ARD = new Float32Array(5), ARB = new Float32Array(5), TCK = new Float32Array(8 * 2), BI = new Int32Array(4), BE = new Float64Array(4);
  const thState = { power: 1, compass: true, yaw: 0, fwd: new Float64Array(4), showFwd: false, arrows: ARW, n: 0, ticks: TCK, nt: 0 };

  // targets (filled in init)
  let DORD = null, DUSE = null, THP0 = null; // drifters in spawn order; this run's use (0 off, 1 passer, 2 homer); base hit points
  let TOU = null, TOV = null, TSA = null; const ATH = new Int16Array(64); // autopilot: each rock's rail-frame offset (u, v) and rail distance
  let nT = 0, nPrim = 0, nD0 = 0, TX0, TY0, TZ0, TVX, TVY, TVZ, TV0, DST, DAGE, DLIFE, DRAM, TX, TY, TZ, TR, THP, THPM, TAL, TKID, TNK, TVAR, TSLOT, TPTS, TFL, TSP;
  const vars = []; const baseInst = [];
  // points
  let P = null, GP0 = 0, GL0 = 0, BO0 = 0, SP0 = 0, CR0 = 0, BC0 = 0, GBASE = null;
  // ship lights (model space x right, y up, z forward; size; HDR rgb): amber engines and leading-edge paint, warm-white canopy and tips
  const SHIP_PTS = [
    [-0.18, 0, -1.32, 0.13, 4.0, 1.7, 0.4], [0.18, 0, -1.32, 0.13, 4.0, 1.7, 0.4], [0, 0, -1.5, 0.26, 1.6, 0.66, 0.16],
    [-1.45, -0.13, -0.22, 0.08, 3.0, 2.6, 2.0], [1.45, -0.13, -0.22, 0.08, 3.0, 2.6, 2.0], [0, 0.42, 0.3, 0.16, 1.5, 1.3, 1.0], [0, 0, 1.33, 0.07, 3.5, 1.5, 0.35],
    [-0.55, -0.02, 0.18, 0.05, 2.6, 1.15, 0.28], [-0.85, -0.06, -0.06, 0.05, 2.6, 1.15, 0.28], [-1.15, -0.1, -0.32, 0.05, 2.6, 1.15, 0.28],
    [0.55, -0.02, 0.18, 0.05, 2.6, 1.15, 0.28], [0.85, -0.06, -0.06, 0.05, 2.6, 1.15, 0.28], [1.15, -0.1, -0.32, 0.05, 2.6, 1.15, 0.28]];
  const NSHP = SHIP_PTS.length;
  const NG = 4, NBOLT = 96, NSPARK = 420, NCRY = 60, NBEACON = 24;
  const BX = new Float32Array(NBOLT * 3), BV = new Float32Array(NBOLT * 3), BL = new Float32Array(NBOLT), BD = new Float32Array(NBOLT), BS = new Float32Array(NBOLT);
  const SX = new Float32Array(NSPARK * 3), SV = new Float32Array(NSPARK * 3), SL = new Float32Array(NSPARK), SL0 = new Float32Array(NSPARK), SS = new Float32Array(NSPARK);
  const CX = new Float32Array(NCRY * 3), CV = new Float32Array(NCRY * 3), CL = new Float32Array(NCRY);
  let sparkNext = 0, boltNext = 0, cryNext = 0;
  const gate = new Float64Array(3), gateN = new Float64Array(3), BCP = new Float32Array(NBEACON * 3);
  let MK = null, BLP = null;
  // split screen state. Per-player run state lives in PL; the game's single-player variables hold the player being processed
  // (use(p) swaps them), so the 1-player code paths are unchanged and never swap.
  let NP = 1, mpRun = false, cur = 0, mpBoot = 1, mpWant = 1;
  const TTS = TT ? [TT, Turret.create(), Turret.create(), Turret.create()] : [], PK = new Float64Array(4), EYE = new Float64Array(12), CBP = new Float64Array(36), HPW = new Float64Array(12);
  const TANP = new Float64Array(4), ASPP = new Float64Array(4), BOW = new Uint8Array(NBOLT), CO = new Uint8Array(NCRY), BOTT = new Int32Array(4), BOTH = new Float64Array(4), BOTF = new Uint8Array(4), MPF = new Float64Array(3);
  let fullAsp = 16 / 9, lastInput = null;
  const PL = [0, 1, 2, 3].map(() => ({ score: 0, combo: 1, comboT: 0, bestCombo: 1, roll: 0, chainDec: 0, shots: 0, boltHits: 0, xp: 0, level: 1, heat: 0, overheated: false, fireCD: 0, killed: 0, driftKilled: 0, fireHeld: false }));
  const MPH = { n: 0, players: [0, 1, 2, 3].map(() => ({ score: 0, chain: 1, chainT: 0, heat: 0, overheated: false, level: 1, xp: 0, kills: 0, shield: 0, marks: new Float32Array(6 * 6), nm: 0, arrows: new Float32Array(3 * 5), na: 0, fwd: new Float64Array(4), showFwd: false })) };
  const plSave = (q) => { q.score = score; q.combo = combo; q.comboT = comboT; q.bestCombo = bestCombo; q.roll = roll; q.chainDec = chainDec; q.shots = shots; q.boltHits = boltHits; q.xp = xp; q.level = level; q.heat = heat; q.overheated = overheated; q.fireCD = fireCD; q.killed = killed; q.driftKilled = driftKilled; };
  const plLoad = (q) => { score = q.score; combo = q.combo; comboT = q.comboT; bestCombo = q.bestCombo; roll = q.roll; chainDec = q.chainDec; shots = q.shots; boltHits = q.boltHits; xp = q.xp; level = q.level; heat = q.heat; overheated = q.overheated; fireCD = q.fireCD; killed = q.killed; driftKilled = q.driftKilled; };
  function use(p) { // make player p the current one: their run state, camera (eye, CB, tanH, aspect) and popup viewport
    if (p !== cur) { plSave(PL[cur]); plLoad(PL[p]); cur = p; }
    if (mpRun) { for (let j = 0; j < 3; j++) eye[j] = EYE[p * 3 + j]; for (let j = 0; j < 9; j++) CB[j] = CBP[p * 9 + j]; tanH = TANP[p]; aspect = ASPP[p]; if (hud) hud.player = p; }
  }
  const teamScore = () => { let t = score; for (let p = 0; p < NP; p++) if (p !== cur) t += PL[p].score; return t; };
  // ---------------------------------------------------------------- small helpers (no allocation)
  const setPt = (i, x, y, z, sz, r, g, b, k) => { const o = i * 8; P[o] = x; P[o + 1] = y; P[o + 2] = z; P[o + 3] = sz; P[o + 4] = r; P[o + 5] = g; P[o + 6] = b; P[o + 7] = k; };
  const project = (x, y, z, o) => { // with the camera basis written this frame (same maths as the engine)
    const dx = x - eye[0], dy = y - eye[1], dz = z - eye[2], d = dx * CB[0] + dy * CB[1] + dz * CB[2], q = d > 1e-3 ? d : 1e-3;
    o[0] = (dx * CB[3] + dz * CB[5]) / (q * tanH * aspect); o[1] = (dx * CB[6] + dy * CB[7] + dz * CB[8]) / (q * tanH); o[2] = d; return o;
  };
  const randDir = (o) => { const z = rnd() * 2 - 1, a = rnd() * TAU, r = sqrt(1 - z * z); o[0] = r * cos(a); o[1] = r * sin(a); o[2] = z; return o; };
  const weapon = () => WEAPONS[level - 1];
  // smooth rail frame at s: tangent from a 6 m chord, horizontal right, up = forward × right (as the engine's camera)
  const railFrame = (s0, o) => {
    rail.at(min(s0 + 4, len), T1); rail.at(max(s0 - 2, 0), T2);
    let fx = T1[0] - T2[0], fy = T1[1] - T2[1], fz = T1[2] - T2[2]; const l = hypot(fx, fy, fz) || 1; fx /= l; fy /= l; fz /= l;
    let rx = fz, rz = -fx; const rl = hypot(rx, rz) || 1; rx /= rl; rz /= rl;
    o[0] = fx; o[1] = fy; o[2] = fz; o[3] = rx; o[4] = 0; o[5] = rz; o[6] = fy * rz; o[7] = fz * rx - fx * rz; o[8] = -fy * rx; return o;
  };
  const FR = new Float64Array(9);

  // ---------------------------------------------------------------- prepare: rail + corridor (before the scene builds)
  function prepare(SC) {
    const sp = sin(HERO_PITCH), cp = cos(HERO_PITCH), A = (d) => [0, sp * d, cp * d];
    // the first four points are collinear on the concept camera's axis, so the rail is straight through the origin
    rail = makeRail([A(-6), [0, 0, 0], A(16), A(40), A(70), [4, 41, 92], [22, 50, 122], [60, 52, 142], [105, 38, 130], [138, 18, 85],
      [145, 0, 25], [120, -14, -35], [70, -22, -80], [5, -18, -105], [-60, -8, -95], [-105, 2, -50], [-120, 8, 10], [-112, 10, 55]], 0.5);
    len = rail.len;
    let best = 1e9; const p = [0, 0, 0];
    for (let q = 0; q < 20; q += 0.02) { rail.at(q, p); const d = p[0] * p[0] + p[1] * p[1] + p[2] * p[2]; if (d < best) { best = d; sHero = q; } }
    sGate = len - 30;
    // decorative rocks stay CORRIDOR m (plus their radius) clear of the rail; coarse 2 m samples, +1 m for the chord error
    const n = Math.ceil(len / 2) + 1, CS = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { rail.at(i * 2, p); CS[i * 3] = p[0]; CS[i * 3 + 1] = p[1]; CS[i * 3 + 2] = p[2]; }
    SC.corridor = (x, y, z, r) => {
      const lim = (CORRIDOR + r + 1) ** 2;
      for (let i = 0; i < n; i++) { const dx = x - CS[i * 3], dy = y - CS[i * 3 + 1], dz = z - CS[i * 3 + 2]; if (dx * dx + dy * dy + dz * dz < lim) return true; }
      return false;
    };
    SC.p1 = SC.p1 || [0, 0, 0, 1];
    SC.meshLight = GUN.light; SCN = SC; // Reef Run's meshes only (the gunship); Nebula Reef and GLB Lab keep their own
    if (typeof HOLO !== 'undefined') HOLO.prepare(SC); // holo.js: the ship's-computer route projection
  }

  // ---------------------------------------------------------------- init: meshes, targets, points
  function init(G_, Shell_) {
    const nScene0 = G_.meshes.length, nScenePts0 = G_.points.length / 8; // the scene's own meshes and points (realms.js swaps them per realm)
    // test hook (?debug): window.reefRun lets a tester jump along the rail and survive, to inspect the late set pieces
    if (typeof QS !== 'undefined' && QS.has('debug')) window.reefRun = { jump(v) { s = v; }, get realms() { return typeof REALMS !== 'undefined' ? REALMS.debug : null; }, god() { hull = 99; }, setHull(n) { hull = n; },
      get state() { return { s, sGate, len, hull, score, ended, view: shell ? shell.view : 'cockpit', blend: vb, cracks: nCrack, hits, low: lowHP(), intro: intro.phase,
        control: turret ? 'turret' : 'pilot', yaw: TT ? TT.yaw : 0, pitch: TT ? TT.pitch : 0, idle: TT ? TT.idle : 0, worldYaw: YP[0], worldPitch: YP[1], ox, oy, driftKilled, arrows: thState.n, showFwd: thState.showFwd,
        chain: combo, best: bestCombo, chainT: comboT, shown: round(roll), shield, shots, boltHits, tally: tally.phase, ship: GH ? 'gunship' : shipH ? 'glb' : 'procedural', barrels: barrelsOn, eyeK: gunEyeK, players: NP, split: mpRun }; },
      // split screen: each gunner's run state and look; bots(on): the ?fakepads bot drives every gunner (P1 too) while on
      get mp() { if (mpRun) plSave(PL[cur]); return { n: NP, run: mpRun, players: PL.slice(0, NP).map((q, p) => ({ p: p + 1, score: q.score, chain: q.combo, best: q.bestCombo, level: q.level, heat: +q.heat.toFixed(2), kills: q.killed + q.driftKilled, shots: q.shots, hits: q.boltHits, yaw: +TTS[p].yaw.toFixed(3), pitch: +TTS[p].pitch.toFixed(3), target: BOTT[p] })), views: G.views.n, scale: G.views.scale }; },
      get shipGLB() { return shipH; },
      // the articulated gunship: its handles and animation state (rad, m); fireP(p) fires gunner p once (tests recoil / flashes)
      get gunship() { return GH && { handles: GH, yaw: GA.yaw, pitch: GA.pitch, aimYaw: GA.aimYaw, aimPitch: GA.aimPitch, podR: GA.podR, podL: GA.podL, canR: GA.canR, canL: GA.canL,
        recoil: [GUN.recoil * (1 - smooth(RT[0], 0, GUN.recoilT)), GUN.recoil * (1 - smooth(RT[1], 0, GUN.recoilT))], flash: Array.from(MF), muzzles: Array.from(MZW), eye: Array.from(eye) }; },
      light(o) { if (o === 'default') SCN.meshLight = null; else { SCN.meshLight = GUN.light; Object.assign(GUN.light, o || {}); } return SCN.meshLight; }, // tune the meshes' light live
      seat(b, u, m) { if (b != null) GUN.seat.back = b; if (u != null) GUN.seat.up = u; if (m != null) GUN.seat.mantlet = !!m; return GUN.seat; }, // tune the cockpit gunner's seat live
      fireP(p = 0) { if (mpRun) use(p); fire(); if (mpRun) use(0); },
      finish(g = true) { if (!ended) finish(g); }, addScore(n) { addScore(n); }, scores() { return loadScores(); }, clearScores() { try { localStorage.removeItem(SCORE_KEY); } catch {} },
      shield() { shield = 1; },
      aimNearest(maxD = 120) { // test aid: point the turret at the nearest live target (any direction)
        let bi = -1, bd = maxD; for (let i = 0; i < nT; i++) { if (!TAL[i]) continue; const d = hypot(TX[i] - cam[0], TY[i] - cam[1], TZ[i] - cam[2]); if (d < bd && d > 3) { bd = d; bi = i; } }
        if (bi < 0 || !TT) return -1; const dx = (TX[bi] - cam[0]) / bd, dy = (TY[bi] - cam[1]) / bd, dz = (TZ[bi] - cam[2]) / bd;
        const f = dx * FR[0] + dy * FR[1] + dz * FR[2], r = dx * FR[3] + dy * FR[4] + dz * FR[5], u = dx * FR[6] + dy * FR[7] + dz * FR[8];
        TT.yaw = Math.atan2(r, f); TT.pitch = Math.asin(clamp(u, -1, 1)); TT.idle = 0; return bi; },
      // turret tests: set the look (rad, rail-relative), list the drifters, park a target straight behind the ship
      look(yaw, pitch = 0) { if (TT) { TT.yaw = yaw; TT.pitch = pitch; TT.idle = 0; } },
      lookP(p, yaw, pitch = 0) { const T = TTS[p]; if (T) { T.yaw = yaw; T.pitch = pitch; T.idle = 0; } }, // split: gunner p (0-3)
      get turret() { return TT; },
      grab(name) { return G.grab(name); }, // save the next frame with its 2D layers (HUD, effects, glass) as compare/shots/<name>.png
      drifters() { const o = []; for (let i = nD0; i < nT; i++) o.push({ i, state: DST[i], alive: TAL[i], ram: DRAM[i], s: TSP[i], x: TX[i], y: TY[i], z: TZ[i] }); return o; },
      behind(d = 40) { for (let i = nD0; i < nT; i++) if (DST[i] === 0) { railFrame(s, FR2); DST[i] = 1; DAGE[i] = 0; DLIFE[i] = 30; DRAM[i] = 0;
        TX[i] = cam[0] - FR2[0] * d; TY[i] = cam[1] - FR2[1] * d; TZ[i] = cam[2] - FR2[2] * d; TVX[i] = FR2[0] * spd; TVY[i] = FR2[1] * spd; TVZ[i] = FR2[2] * spd; showTarget(i, true); return i; } return -1; },
      onLine() { let n = 0; const q = [0, 0, 0]; for (let i = 0; i < nD0; i++) { if (i >= nPrim) continue; rail.at(TSP[i], q); let best = 1e9; for (let ds = -12; ds <= 12; ds += 0.5) { rail.at(TSP[i] + ds, q); best = min(best, hypot(TX[i] - q[0], TY[i] - q[1], TZ[i] - q[2])); } if (best < TR[i] * 0.7 + 0.4) n++; } return n; }, // primaries the autopilot line runs into
      target(i) { return { alive: TAL[i], hp: THP[i], x: TX[i], y: TY[i], z: TZ[i] }; },
      // autopilot tests: dodge on/off, and a headless unattended turret run (no shooting, no look) at a fixed 60 Hz step
      boomAt(nx = 0, ny = -0.5, d = 30, rad = 4) { // test aid: an FX boom d m out along the screen ray (nx, ny)
        const ax = nx * tanH * aspect, ay = ny * tanH; const x = eye[0] + (CB[0] + CB[3] * ax + CB[6] * ay) * d, y = eye[1] + (CB[1] + CB[7] * ay) * d, z = eye[2] + (CB[2] + CB[5] * ax + CB[8] * ay) * d;
        if (fxOn()) FX.boom(x, y, z, { rad }); return [x, y, z]; },
      get title() { return { on: title.on, done: title.done, style: fxStyle, slamOn: cd.slamOn, plan: { slam: cd.slam, count: cd.count, go: cd.go, hud0: cd.hud0, hud1: cd.hud1 }, anchored: cd.anc, songAtFrame0: cd.a, mp: cd.mp, mpT: cd.t, n: cd.n, post: cd.post, music: shell && shell.musicClock ? shell.musicClock() : -1 }; },
      titleSkip() { if (intro.active) introEnd(true); }, titleReplay() { title.done = false; GAME.reset(); },
      // test aid: n windshield cracks (as hits 1..n), fully spread, painted alone at w×h and saved through serve.py as shots/<name>.png;
      // at: optional [[nx, ny], ...] to pin impact points (screen units -1..1)
      async crackShot(n = 1, name = 'reef-cracks', at = null, w = 1456, h = 816) {
        const s0 = { nCrack, crackNext, hits }; nCrack = crackNext = 0;
        for (let k = 1; k <= n; k++) { hullFeedback(0, 0, k * 7919 + 13); const c = k - 1; if (at && at[c]) { CCX[c] = at[c][0]; CCY[c] = at[c][1]; } CAGE[c] = 1; }
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h; drawCracks(cv.getContext('2d'), w, h);
        nCrack = s0.nCrack; crackNext = s0.crackNext; hits = s0.hits; ovDirty = true; hitPulse = glitchT = 0;
        const b = await new Promise((r) => cv.toBlob(r, 'image/png')); const res = await fetch('/shots/' + name + '.png', { method: 'PUT', body: b }); return res.status; },
      dodge(on = true) { AUTO.on = !!on; return AUTO; },
      autorun(dodge = AUTO.on, maxT = 600) {
        const was = AUTO.on; AUTO.on = !!dodge; reset(); if (intro.active) introEnd(true);
        const inp = { control: 'turret', players: 1, pilot: { x: 0, y: 0 }, gunner: { x: 0, y: 0, fire: false, alt: false }, look: { dx: 0, dy: 0, sx: 0, sy: 0, kx: 0, ky: 0, sens: 1, recentre: true, locked: false } };
        const log = []; let t = 0, h = hull;
        while (!ended && t < maxT) { if (fxOn()) FX.timeScale = 1; update(1 / 60, inp); t += 1 / 60; if (hull < h) { log.push({ t: +t.toFixed(2), d: +(s - sHero).toFixed(1), what: lastHit >= nD0 ? (DRAM[lastHit] ? 'rammer' : 'passer') : 'rock' }); h = hull; } }
        AUTO.on = was; return { dodge: !!dodge, distance: +(s - sHero).toFixed(1), of: +(sGate - sHero).toFixed(1), time: +t.toFixed(1), hull, gate: s >= sGate, hits: log };
      },
      // start sequence: timeline state, and controls for testing
      get intro() { return { phase: intro.phase, t: intro.t, active: intro.active, frozen: intro.frozen, skipped: intro.skipped, enabled: intro.on, shield: intro.shield, hudPower: intro.power, preDur: preDur(), table: INTRO }; },
      introPlay() { intro.frozen = false; }, introSeek(t) { if (intro.active) { intro.t = t; intro.frozen = true; intro.shown0 = true; } }, /* seek holds there; introPlay resumes */ introSkip() { if (intro.active) introEnd(true); }, introRestart() { GAME.reset(); },
      hit(nx = 0, ny = 0) { hits++; hull = max(DF.safe ? 1 : 0, hull - 1); regenT = 0; hullFeedback(nx, ny, hits * 7919 + 13); if (hull <= 0 && !ended) finish(false); } }; // a hull hit from screen direction (nx, ny)
    G = G_; hud = Shell_.hud; shell = Shell_;
    // ?shot=…&frame0: the engine composites this 2D cockpit layer into the saved frame (empty at Frame 0 now the shield is gone)
    G.shotOverlay = (g, w, h) => { if (FRAME0 && !FRAME0_BARE) paintOverlay(g, w, h, ve < 0.5); };
    hud.labels = ['Rock', 'Ring Gate', 'Drifter'];
    // existing rocks (hero, swarm, reef) as spheres, so targets don't overlap them
    const occ = [];
    for (const m of G.meshes) { const I = m.inst; for (let i = 0; i < I.length; i += 12) if (I[i + 3] > 0) occ.push(I[i], I[i + 1], I[i + 2], I[i + 3] * 1.1); }

    // ---- rock variants: noise-displaced icospheres (sub 2), like nebula.js's rockMesh
    const rockVar = (seed, flat, elong, sub = 2) => {
      rseed(seed); const o = [rr(0, 50), rr(0, 50), rr(0, 50)];
      const m = icosphere(sub, (x, y, z) => {
        const r = 1 + 0.36 * (fbm(x * 1.1 + o[0], y * 1.1 + o[1], z * 1.1 + o[2], 3) - 0.5) * 2 + 0.18 * (fbm(x * 4 + o[1], y * 4 + o[2], z * 4 + o[0], 3) - 0.5);
        return [x * r * elong, y * r * flat, z * r];
      });
      for (let k = 0; k < m.p.length / 3; k++) { const X = m.p[k * 3] / elong, Y = m.p[k * 3 + 1] / flat, Z = m.p[k * 3 + 2]; m.aux[k] = clamp((hypot(X, Y, Z) - 0.85) * 4, -1, 1); }
      const b = m.build(); b.P = m.p; return b;
    };
    vars.push(rockVar(301, 0.8, 1.25), rockVar(302, 0.65, 1.5), rockVar(303, 0.95, 1.05));

    // ---- Spine arches: rock arches over the rail in the loop (built at 1/4 scale so the rock texture matches)
    const arches = [0.47, 0.53, 0.59].map((f) => f * len);
    rseed(77);
    for (const sa of arches) {
      const c = rail.at(sa, [0, 0, 0]); railFrame(sa, FR); const R = 11, pts = [], o = rr(0, 40);
      const P3 = (a, rad, drop) => [(FR[3] * cos(a) * rad + FR[6] * (sin(a) * rad - drop)) / 4, (FR[4] * cos(a) * rad + FR[7] * (sin(a) * rad - drop)) / 4, (FR[5] * cos(a) * rad + FR[8] * (sin(a) * rad - drop)) / 4];
      for (let k = 6; k >= 1; k--) pts.push(P3(-0.3, R + k * 0.5, k * 1.4));
      for (let k = 0; k <= 30; k++) { const a = -0.3 + (PI + 0.6) * k / 30; pts.push(P3(a, R + (fbm(k * 0.3 + o, 0, 0, 3) - 0.5) * 2, 0)); }
      for (let k = 1; k <= 6; k++) pts.push(P3(PI + 0.3, R + k * 0.5, k * 1.4));
      const m = new Mesh(); m.tube(pts, (k) => (0.5 + 0.28 * fbm(k * 0.4, o, 1, 3)) * (k < 3 || k > pts.length - 4 ? 1.3 : 1), 9, true, (k) => 0.3 + 0.6 * fbm(k * 0.7, o + 3, 2, 2));
      const b = m.build(); b.inst = new Float32Array([c[0], c[1], c[2], 4, 0, 0, 0, 1, 0, rnd(), 0, 0]); b.realm = 'arch'; G.meshes.push(b);
    }

    // ---- reef band: decorative low-detail rocks 11-70 m out from the rail where the run leaves the scene's swarm
    // (coordinator, after the merge: the loop past the Spine was flying through empty dark space)
    {
      const band = [rockVar(311, 0.75, 1.3, 1), rockVar(312, 0.6, 1.6, 1), rockVar(313, 0.9, 1.1, 1)].map((b) => { b.inst = []; return b; });
      rseed(909); const q = [0, 0, 0];
      for (let i = 0; i < 1400; i++) {
        const st = rr(sHero + 150, min(len, sGate + 40)); rail.at(st, q); railFrame(st, FR);
        const a = rr(0, TAU), d = 11 + Math.pow(rnd(), 1.6) * 60, u = cos(a) * d, v = sin(a) * d * 0.8, ahead = rr(-6, 6);
        const r = clamp(0.35 * Math.pow(1 / max(rnd(), 0.03), 0.55), 0.35, 4.5) * (0.7 + d / 70);
        const x = q[0] + FR[3] * u + FR[6] * v + FR[0] * ahead, y = q[1] + FR[4] * u + FR[7] * v + FR[1] * ahead, z = q[2] + FR[5] * u + FR[8] * v + FR[2] * ahead;
        const k = qRand(); band[i % 3].inst.push(x, y, z, r, k[0], k[1], k[2], k[3], 0, rnd(), 0, 0);
      }
      for (const b of band) { b.inst = new Float32Array(b.inst); b.realm = 'band'; G.meshes.push(b); }
    }

    // ---- targets: primaries along the rail inside the steering box and a little beyond; big ones crack into 2-3 children
    rseed(4242);
    const prim = [], p = [0, 0, 0];
    const tryPlace = (s0, s1, want) => {
      for (let tries = 0, made = 0; made < want && tries < want * 60; tries++) {
        const st = rr(s0, s1); rail.at(st, p); railFrame(st, FR);
        const big = rnd() < 0.2, r = big ? rr(2.0, 3.0) : clamp(0.6 * Math.pow(1 / max(rnd(), 0.05), 0.45), 0.6, 1.8);
        const cen = st > sHero + 50 && rnd() < 0.1, u = cen ? rr(-3, 3) : rr(-9, 9), v = cen ? rr(-2.5, 2.5) : rr(-6.5, 6.5);
        if (!cen && hypot(u, v) < r + 1.5) continue; // the centre lane holds only the deliberate threats
        const x = p[0] + FR[3] * u + FR[6] * v, y = p[1] + FR[4] * u + FR[7] * v, z = p[2] + FR[5] * u + FR[8] * v;
        let ok = true;
        for (const sa of arches) if (abs(st - sa) < 5 && hypot(u, v) + r > 8) ok = false;
        for (let i = 0; ok && i < prim.length; i++) { const q = prim[i]; if (hypot(x - q.x, y - q.y, z - q.z) < r + q.r + 1.5) ok = false; }
        for (let i = 0; ok && i < occ.length; i += 4) { const dx = x - occ[i], dy = y - occ[i + 1], dz = z - occ[i + 2], m = occ[i + 3] + r + 0.8; if (dx * dx + dy * dy + dz * dz < m * m) ok = false; }
        if (!ok) continue;
        prim.push({ x, y, z, r, s: st, big }); made++;
      }
    };
    tryPlace(sHero + 24, sHero + 190, 70);  // the dense swarm along the concept view
    tryPlace(sHero + 190, sGate - 25, 100); // the wider reef and the Spine
    const kids = [];
    for (let i = 0; i < prim.length; i++) {
      const q = prim[i]; q.kid0 = -1; q.nk = 0; if (!q.big) continue;
      const nk = rnd() < 0.5 ? 2 : 3; q.nk = nk;
      for (let k = 0; k < nk; k++) { randDir(T1); const r = q.r * rr(0.42, 0.55), d = q.r * 0.6; kids.push({ x: q.x + T1[0] * d, y: q.y + T1[1] * d, z: q.z + T1[2] * d, r, s: q.s, parent: i }); }
    }
    // ---- drifters (turret only): deterministic (own seed), spread along the run. Each starts beside or behind where the ship
    // will be at its spawn distance and flies a straight line to a point DR_MISS m off the rail where the ship will be Tc s
    // later (passers), or homes on the ship (rammers, every DR_RAM_EVERY-th). Appended after the cracked-rock children, so
    // the existing targets, instances and glints (and Frame 0) are unchanged.
    const drift = [];
    {
      rseed(5151); const q = [0, 0, 0], d0 = sHero + 70, d1 = sGate - 60;
      for (let k = 0; k < NDRIFT; k++) {
        const sp = d0 + (d1 - d0) * (k + rr(0.15, 0.85)) / NDRIFT, ram = k % 3 === 1, behind = rnd() < 0.3;
        rail.at(sp, p); railFrame(sp, FR);
        const side = (rnd() < 0.5 ? -1 : 1) * (behind ? rr(4, 12) : rr(20, 38)), along = behind ? rr(-55, -38) : rr(-30, 8), vert = rr(-12, 12);
        const x = p[0] + FR[0] * along + FR[3] * side + FR[6] * vert, y = p[1] + FR[1] * along + FR[4] * side + FR[7] * vert, z = p[2] + FR[2] * along + FR[5] * side + FR[8] * vert;
        const Tc = rr(4.5, 6.5); rail.at(sp + SPEED * Tc, q); railFrame(sp + SPEED * Tc, FR2);
        const ma = rr(0, TAU), md = ram ? 0 : rr(DR_MISS[0], DR_MISS[1]), mx = cos(ma) * md, my = sin(ma) * md;
        const cx = q[0] + FR2[3] * mx + FR2[6] * my, cy = q[1] + FR2[4] * mx + FR2[7] * my, cz = q[2] + FR2[5] * mx + FR2[8] * my;
        drift.push({ x, y, z, r: ram ? rr(0.9, 1.3) : rr(0.8, 1.9), s: sp, vx: (cx - x) / Tc, vy: (cy - y) / Tc, vz: (cz - z) / Tc, ram, life: Tc + 5 });
      }
      // the extra pool for the harder levels (own seed, so the 24 above are unchanged): more from behind, above and below
      rseed(5252);
      for (let k = 0; k < NDRIFT_X; k++) {
        const sp = d0 + (d1 - d0) * (k + rr(0.15, 0.85)) / NDRIFT_X, behind = rnd() < 0.5;
        rail.at(sp, p); railFrame(sp, FR);
        const side = (rnd() < 0.5 ? -1 : 1) * (behind ? rr(3, 14) : rr(16, 38)), along = behind ? rr(-60, -36) : rr(-30, 10), vert = rr(-20, 20);
        const x = p[0] + FR[0] * along + FR[3] * side + FR[6] * vert, y = p[1] + FR[1] * along + FR[4] * side + FR[7] * vert, z = p[2] + FR[2] * along + FR[5] * side + FR[8] * vert;
        const Tc = rr(4, 6); rail.at(sp + SPEED * Tc, q); railFrame(sp + SPEED * Tc, FR2);
        const ma = rr(0, TAU), md = rr(DR_MISS[0], DR_MISS[1]), mx = cos(ma) * md, my = sin(ma) * md;
        const cx = q[0] + FR2[3] * mx + FR2[6] * my, cy = q[1] + FR2[4] * mx + FR2[7] * my, cz = q[2] + FR2[5] * mx + FR2[8] * my;
        drift.push({ x, y, z, r: rr(0.85, 1.5), s: sp, vx: (cx - x) / Tc, vy: (cy - y) / Tc, vz: (cz - z) / Tc, ram: false, life: Tc + 5 });
      }
      // spawn order along the run: difficulty picks every n-th of these (DIFF.drift) and every m-th of those homes (DIFF.ram)
      DORD = drift.map((d, k) => [d.s, k]).sort((a, b) => a[0] - b[0]).map((e) => e[1]);
    }
    nPrim = prim.length; nD0 = nPrim + kids.length; nT = nD0 + drift.length;
    TX = new Float32Array(nT); TY = new Float32Array(nT); TZ = new Float32Array(nT); TR = new Float32Array(nT); THP = new Float32Array(nT); THPM = new Float32Array(nT);
    TAL = new Uint8Array(nT); TKID = new Int16Array(nT); TNK = new Uint8Array(nT); TVAR = new Uint8Array(nT); TSLOT = new Uint16Array(nT); TPTS = new Uint16Array(nT);
    TFL = new Float32Array(nT); TSP = new Float32Array(nT);
    TX0 = new Float32Array(nT); TY0 = new Float32Array(nT); TZ0 = new Float32Array(nT); TVX = new Float32Array(nT); TVY = new Float32Array(nT); TVZ = new Float32Array(nT);
    TV0 = new Float32Array(nT * 3); DST = new Uint8Array(nT); DAGE = new Float32Array(nT); DLIFE = new Float32Array(nT); DRAM = new Uint8Array(nT);
    const all = prim.concat(kids, drift), counts = [0, 0, 0];
    for (let i = 0; i < nT; i++) {
      const q = all[i]; TX[i] = TX0[i] = q.x; TY[i] = TY0[i] = q.y; TZ[i] = TZ0[i] = q.z; TR[i] = q.r; TSP[i] = q.s;
      THPM[i] = round(1 + q.r * 0.9); TPTS[i] = (q.r < ARCADE.sizeM ? ARCADE.pts.small : q.r < ARCADE.sizeL ? ARCADE.pts.medium : ARCADE.pts.large) + (q.ram ? ARCADE.pts.ram : 0);
      if (i >= nD0) { TV0[i * 3] = q.vx; TV0[i * 3 + 1] = q.vy; TV0[i * 3 + 2] = q.vz; DLIFE[i] = q.life; DRAM[i] = q.ram ? 1 : 0; if (q.ram) THPM[i] = 2; }
      TPTS[i] = q.r < ARCADE.sizeM ? ARCADE.pts.small : q.r < ARCADE.sizeL ? ARCADE.pts.medium : ARCADE.pts.large; // the homer bonus is added per run (applyDiff)
      TKID[i] = -1; TVAR[i] = i % 3; TSLOT[i] = counts[i % 3]++;
    }
    THP0 = THPM.slice(); DUSE = new Uint8Array(drift.length);
    for (let k = 0; k < kids.length; k++) { const par = kids[k].parent; if (TKID[par] < 0) TKID[par] = nPrim + k; TNK[par]++; }
    // autopilot: where each rock (primaries and cracked children; drifters move, so not them) sits in the rail frame
    TOU = new Float32Array(nD0); TOV = new Float32Array(nD0); TSA = new Float32Array(nD0);
    for (let i = 0; i < nD0; i++) {
      rail.at(TSP[i], p); railFrame(TSP[i], FR); const dx = TX[i] - p[0], dy = TY[i] - p[1], dz = TZ[i] - p[2];
      TOU[i] = dx * FR[3] + dy * FR[4] + dz * FR[5]; TOV[i] = dx * FR[6] + dy * FR[7] + dz * FR[8]; TSA[i] = TSP[i] + dx * FR[0] + dy * FR[1] + dz * FR[2];
    }
    rseed(4343);
    for (let v = 0; v < 3; v++) vars[v].inst = new Float32Array(counts[v] * 12);
    const Q = new Float32Array(nT * 4);
    for (let i = 0; i < nT; i++) {
      const q = qRand(), I = vars[TVAR[i]].inst, o = TSLOT[i] * 12; Q.set(q, i * 4);
      I[o] = TX[i]; I[o + 1] = TY[i]; I[o + 2] = TZ[i]; I[o + 3] = TR[i]; I[o + 4] = q[0]; I[o + 5] = q[1]; I[o + 6] = q[2]; I[o + 7] = q[3]; I[o + 8] = 0; I[o + 9] = rnd(); I[o + 10] = 0; I[o + 11] = 0;
    }
    for (let v = 0; v < 3; v++) { vars[v].realm = 'target'; vars[v].realmVar = v; G.meshes.push(vars[v]); baseInst.push(vars[v].inst.slice()); } // realm tags: realms.js reskins targets, restyles the gate, drops the arches and band

    // ---- Ring Gate: a broken ring of rock-cut segments, radius GATE_R, square to the rail; built at 1/4 scale
    rail.at(sGate, p); gate[0] = p[0]; gate[1] = p[1]; gate[2] = p[2]; railFrame(sGate, FR); gateN[0] = FR[0]; gateN[1] = FR[1]; gateN[2] = FR[2];
    if (typeof HOLO !== 'undefined') HOLO.init(G, Shell_, { rail, sGate, gate, gateN });
    const gq = qFromY(FR[0], FR[1], FR[2]);
    const qrot = (q, v) => { const tx = 2 * (q[1] * v[2] - q[2] * v[1]), ty = 2 * (q[2] * v[0] - q[0] * v[2]), tz = 2 * (q[0] * v[1] - q[1] * v[0]); return [v[0] + q[3] * tx + (q[1] * tz - q[2] * ty), v[1] + q[3] * ty + (q[2] * tx - q[0] * tz), v[2] + q[3] * tz + (q[0] * ty - q[1] * tx)]; };
    {
      const m = new Mesh(), Rl = GATE_R / 4, g0 = 0.55, g1 = TAU - 0.55, arc = [];
      for (let k = 0; k <= 72; k++) { const a = mix(g0, g1, k / 72); arc.push([cos(a) * Rl, 0, sin(a) * Rl]); }
      m.tube(arc, 0.2, 12, true, () => 0.85);
      for (let k = 0; k <= 16; k++) {
        const a = mix(g0, g1, k / 16), e = k === 0 || k === 16, w = e ? 0.55 : 0.32, r0 = Rl - (e ? 0.55 : 0.36), r1 = Rl + (e ? 0.55 : 0.36);
        m.sweep([[cos(a) * r0, 0, sin(a) * r0], [cos(a) * r1, 0, sin(a) * r1]], w, e ? 0.9 : 0.6, null, true);
      }
      const b = m.build(); b.inst = new Float32Array([gate[0], gate[1], gate[2], 4, gq[0], gq[1], gq[2], gq[3], 0, 0.5, 0, 0]); b.realm = 'gate'; G.meshes.push(b);
      for (let i = 0; i < NBEACON; i++) {
        const a = mix(g0, g1, (i + 0.5) / NBEACON), w = qrot(gq, [cos(a) * (GATE_R - 1.6), -1.0, sin(a) * (GATE_R - 1.6)]);
        BCP[i * 3] = gate[0] + w[0]; BCP[i * 3 + 1] = gate[1] + w[1]; BCP[i * 3 + 2] = gate[2] + w[2];
      }
    }

    // ---- the player's ship, for the shoulder view: a compact fighter 2.4 m long, built like hollow.js's ship (capsule
    // fuselage, canopy, swept wings with tip pods, a fin, engine ring and two nozzles). Nebula's shadeSolid has no painted
    // material (prm.x picks rock or rim-lit rock, prm.y seeds the texture, prm.zw are unused), so the hull is lit rock
    // (mat 0, crevice darkening off); the warm-white and amber come from emissive ship lights in the point pool (SHIP_PTS).
    {
      const m = new Mesh(), Ls = 2.4, R = 0.42, A1 = () => 1;
      m.tube(Array.from({ length: 13 }, (_, i) => [0, 0, -Ls / 2 + Ls * i / 12]), (k) => R * Math.sqrt(Math.sin(PI * clamp(0.08 + k / 12 * 0.95, 0, 1))) * (k > 9 ? 0.95 : 1), 14, true, A1);
      m.tube([[0, 0.2, -0.15], [0, 0.3, 0.25], [0, 0.25, 0.62]], (k) => [0.17, 0.22, 0.08][k], 10, true, A1); // canopy
      m.tube([[0, 0, -Ls / 2 - 0.02], [0, 0, -Ls / 2 + 0.3]], R * 1.04, 16, false, A1); // engine ring
      for (const sx of [-0.18, 0.18]) m.tube([[sx, 0, -Ls / 2 - 0.08], [sx, 0, -Ls / 2 + 0.2]], 0.13, 10, true, A1);
      m.tube([[0, 0, Ls / 2 - 0.22], [0, 0, Ls / 2 + 0.1]], (k) => (k ? 0.1 : 0.27), 12, true, A1); // nose
      for (const sg of [-1, 1]) {
        m.sweep([[sg * 0.32, -0.04, 0.15], [sg * 0.9, -0.08, -0.25], [sg * 1.4, -0.13, -0.6]], (k) => [0.9, 0.62, 0.34][k], 0.07, null, true);
        m.tube([[sg * 1.45, -0.13, -0.95], [sg * 1.45, -0.13, -0.25]], 0.07, 8, true, A1); // tip pod
      }
      m.sweep([[0, 0.3, -0.75], [0, 0.62, -1.08]], (k) => [0.42, 0.24][k], 0.05, () => [1, 0, 0], true); // fin
      shipMesh = m.build(); shipMesh.inst = new Float32Array([0, 0, 0, 0, 0, 0, 0, 1, 0, 0.37, 0, 0]); G.meshes.push(shipMesh);
    }
    if (typeof QS !== 'undefined' && QS.has('shipglb')) loadShipGLB(QS.get('shipglb')); else loadGunship();

    // ---- points: ghost rail (static), then one dynamic range: glints, bolts, sparks, crystals, beacons
    const ghost = rail.ghost(1.6, 0.07, [0.3, 1.4, 2.0]);
    const old = G.points, base = old.length / 8, nGhost = ghost.length / 8;
    const dyn0 = base + nGhost, nDyn = nT * NG + NBOLT * 3 + NSPARK + NCRY + NBEACON + NSHP + NGP;
    const WHN = WH ? WH.count : 0; // whale points sit after the game's own dynamic range; whales.js trims the upload to the whales in view
    P = new Float32Array(old.length + ghost.length + (nDyn + WHN) * 8); P.set(old); P.set(ghost, old.length);
    GL0 = dyn0; BO0 = GL0 + nT * NG; SP0 = BO0 + NBOLT * 3; CR0 = SP0 + NSPARK; BC0 = CR0 + NCRY; SH0 = BC0 + NBEACON; GP0 = SH0 + NSHP;
    // glints: amber ore veins on each target's surface, facing the way you approach it
    rseed(4444);
    GBASE = new Float32Array(nT * NG * 8);
    const tv = [0, 0, 0];
    for (let i = 0; i < nT; i++) {
      rail.tan(TSP[i], tv); const vb = vars[TVAR[i]], VP = vb.P, nv = VP.length / 3, q = [Q[i * 4], Q[i * 4 + 1], Q[i * 4 + 2], Q[i * 4 + 3]];
      for (let g = 0, tries = 0; g < NG; tries++) {
        const k = (rnd() * nv) | 0, w = qrot(q, [VP[k * 3], VP[k * 3 + 1], VP[k * 3 + 2]]), l = hypot(...w) || 1;
        if (tries < 40 && (w[0] * tv[0] + w[1] * tv[1] + w[2] * tv[2]) / l > -0.25) continue;
        const sc = TR[i] * 1.03, br = rr(0.8, 1.6), red = i < nPrim && TNK[i] ? 0.6 : 1, o = (i * NG + g) * 8;
        GBASE[o] = TX[i] + w[0] * sc; GBASE[o + 1] = TY[i] + w[1] * sc; GBASE[o + 2] = TZ[i] + w[2] * sc; GBASE[o + 3] = rr(0.05, 0.1) * (0.6 + 0.4 * TR[i]);
        GBASE[o + 4] = 3.2 * br; GBASE[o + 5] = 1.4 * br * red; GBASE[o + 6] = 0.32 * br * red; GBASE[o + 7] = 0; g++;
      }
    }
    G.points = P; G.dynPts = [dyn0, nDyn];
    if (WH) WH.init(G, P, dyn0 + nDyn, { rail, corridor: SCN && SCN.corridor, sHero });
    MK = new Float32Array(8 * 6); BLP = new Float32Array((nT + 1) * 4);
    stats.counterMax = nPrim;
    if (PU) { PU.attach(G); PU.onImpact = pulseImpact; PU.onTime = pulseTime; if (typeof REALMS !== 'undefined') { PU.world = REALMS.pulse; PU.blocked = () => WARP.active; } } // HOOK (pulse.js): the next realm comes from realms.js
    // HOOK (combat.js, GAME_API.md "Combat"): the run as combat.js sees it (references and getters; nothing allocated per frame)
    if (CMB) CMB.init(G, Shell_, { get nT() { return nT; }, get nD0() { return nD0; }, TX, TY, TZ, TR, TAL, TVX, TVY, TVZ, DST, DRAM, cam, eye, CB, FR, MZW, MF, HPW, EYE, TTS, TT, aim, SPEED, bolt: BOLT_SPEED,
      get spd() { return spd; }, get boost() { return boost; }, spendBoost(d) { boost = max(0, boost - d); }, get turret() { return turret; }, get mpRun() { return mpRun; }, get NP() { return NP; }, get level() { return level; }, get DF() { return DF; }, get tanH() { return tanH; }, get aspect() { return aspect; },
      get gun() { return !!GH; }, TBW, get tubes() { return GH && GH[GH_TA].visible ? GH[GH_TA].scale : 0; }, get GH() { return GH; }, get heat() { return heat; }, get overheated() { return overheated; }, get live() { return started && !ended && !intro.active && !title.active; }, sparks, destroy: (i) => destroy(i, true), flash: (i, v) => { TFL[i] = max(TFL[i], v); }, count: (n, h) => { shots += n; boltHits += h; } });
    if (typeof REALMS !== 'undefined') REALMS.init(G, Shell_, { // the reality switch (realms.js, GAME_API.md "Realms"): one rail, the world swapped around it
      scene: SCN, rail, sHero, sGate, nScene: nScene0, nScenePts: nScenePts0, points: P, cam, QSH,
      get s() { return s; }, get view() { return ve; }, get started() { return started; }, get ended() { return ended; }, get mp() { return mpRun ? NP : 0; } });
    reset();
  }

  // ---------------------------------------------------------------- targets
  const showTarget = (i, on) => {
    TAL[i] = on ? 1 : 0; const I = vars[TVAR[i]].inst; I[TSLOT[i] * 12 + 3] = on ? TR[i] : 0; vars[TVAR[i]].dirty = true;
    for (let g = 0; g < NG; g++) { const j = i * NG + g, o = (GL0 + j) * 8; for (let c = 0; c < 8; c++) P[o + c] = GBASE[j * 8 + c]; if (!on) P[o + 3] = 0; }
  };
  const sparks = (x, y, z, n, sp, hot) => {
    for (let k = 0; k < n; k++) {
      const i = sparkNext; sparkNext = (sparkNext + 1) % NSPARK; randDir(T3); const v = sp * rr(0.3, 1);
      SX[i * 3] = x; SX[i * 3 + 1] = y; SX[i * 3 + 2] = z; SV[i * 3] = T3[0] * v; SV[i * 3 + 1] = T3[1] * v; SV[i * 3 + 2] = T3[2] * v;
      SL[i] = SL0[i] = rr(0.35, 0.9); SS[i] = rr(0.05, 0.12) * hot;
    }
  };
  const addXP = (n) => {
    xp += n;
    while (level < WEAPONS.length && xp >= WEAPONS[level].xp) { level++; hud.event('levelup'); hud.popup('LEVEL ' + level + ' · ' + WEAPONS[level - 1].name, 0, 0.35, 'info'); }
  };
  const destroy = (i, byPlayer) => {
    showTarget(i, false);
    const r = TR[i];
    sparks(TX[i], TY[i], TZ[i], byPlayer ? 26 + (r * 8 | 0) : 14, 7 + r * 3, 1 + r * 0.3);
    if (fxOn()) FX.boom(TX[i], TY[i], TZ[i], { rad: r * 1.5 });
    if (TKID[i] >= 0) { for (let k = 0; k < TNK[i]; k++) showTarget(TKID[i] + k, true); }
    if (!byPlayer) return;
    killed += i < nPrim ? 1 : 0; driftKilled += i >= nD0 ? 1 : 0;
    // chain: a kill inside the window (or while it is still decaying) climbs one step
    const prev = combo; combo = min(combo + (comboT > 0 || combo > 1 ? 1 : 0), COMBO_MAX); comboT = COMBO_TIME; chainDec = 0; if (combo > bestCombo) bestCombo = combo;
    // free-look bonus: how far off the ship's heading (the rail) the rock was
    const ex = TX[i] - cam[0], ey = TY[i] - cam[1], ez = TZ[i] - cam[2], c = (ex * FR[0] + ey * FR[1] + ez * FR[2]) / (hypot(ex, ey, ez) || 1);
    const lm = c < -0.5 ? ARCADE.look.behind : c < 0.5 ? ARCADE.look.side : 1;
    const pts = round(TPTS[i] * lm) * combo; addScore(pts);
    project(TX[i], TY[i], TZ[i], PJ);
    if (PJ[2] > 0) {
      hud.popup('+' + pts, PJ[0], PJ[1], 'big');
      if (lm > 1) hud.popup(lm >= ARCADE.look.behind ? 'BEHIND ×' + lm : 'SIDE ×' + lm, PJ[0], PJ[1] + 0.11, 'chain');
      if (combo > prev && combo > 1) hud.popup('×' + combo + ' CHAIN', PJ[0], PJ[1] - 0.12, 'chain');
    } else if (combo > prev && combo > 1) hud.popup('×' + combo + ' CHAIN · +' + pts, 0, 0.42, 'chain'); // killed off-screen
    if (combo > prev && (combo === 4 || combo === COMBO_MAX)) hud.event('cooled'); // power-up sting at ×4 and ×8
    hud.event('destroy');
    addXP(20 + (r * 15 | 0));
    const nc = 1 + (r * 1.2 | 0);
    for (let k = 0; k < nc; k++) {
      const c = cryNext; cryNext = (cryNext + 1) % NCRY; randDir(T3); CO[c] = cur; // the crystals' score goes to the killer
      CX[c * 3] = TX[i]; CX[c * 3 + 1] = TY[i]; CX[c * 3 + 2] = TZ[i]; CV[c * 3] = T3[0] * 2.5; CV[c * 3 + 1] = T3[1] * 2.5; CV[c * 3 + 2] = T3[2] * 2.5; CL[c] = 14;
    }
  };
  const damage = (i, dmg, x, y, z) => {
    THP[i] -= dmg; TFL[i] = 0.12;
    if (THP[i] <= 0) { if (fxOn() && TKID[i] >= 0) FX.pow(TX[i], TY[i], TZ[i], { scale: TR[i] / 1.5, text: 'CRACK!' }); destroy(i, true); return; }
    sparks(x, y, z, 7, 5, 0.8); hud.event('hit'); addXP(2);
    if (fxOn()) FX.pow(x, y, z, { scale: TR[i] / 1.5 });
  };

  // ---------------------------------------------------------------- run control
  // difficulty for this run: hull, which drifters fly and which of them home in (spread evenly along the run)
  function applyDiff() {
    DF = DIFF[diffKey]; HULL_MAX = DF.hull; stats.hullMax = HULL_MAX;
    if (!DUSE) return;
    const M = DUSE.length, N = min(DF.drift, M); let j = 0;
    for (let o = 0; o < M; o++) {
      const k = DORD[o], i = nD0 + k, on = Math.floor((o + 1) * N / M) > Math.floor(o * N / M);
      let ram = false; if (on) { ram = Math.floor((j + 1) * DF.ram / N) > Math.floor(j * DF.ram / N); j++; }
      DUSE[k] = on ? (ram ? 2 : 1) : 0; DRAM[i] = ram ? 1 : 0; THPM[i] = ram ? 2 : THP0[i];
      TPTS[i] = (TR[i] < ARCADE.sizeM ? ARCADE.pts.small : TR[i] < ARCADE.sizeL ? ARCADE.pts.medium : ARCADE.pts.large) + (ram ? ARCADE.pts.ram : 0);
    }
  }
  function setDifficulty(k, persist = true) {
    if (!DIFF[k]) return false; diffKey = k;
    if (persist) try { localStorage.setItem(DIFF_STORE, k); } catch {}
    syncDiffUI(); if (!started || ended) { if (shell && shell.state === 'menu') reset(); }
    return true;
  }
  const WARP_EVERY = 10; let warpT = 0, warpCue = false, warpFire = 0; // the timed Reality Pulse (pulseStep)
  function reset() {
    warpT = 0; warpCue = false; warpFire = 0;
    if (typeof REALMS !== 'undefined') REALMS.reset(); // every run starts in Space Outside
    applyDiff();
    try { netFetch(); } catch {} // the world high-score table for this difficulty (NET is declared further down)
    for (let v = 0; v < 3; v++) { vars[v].inst.set(baseInst[v]); vars[v].dirty = true; }
    for (let i = nD0; i < nT; i++) { TX[i] = TX0[i]; TY[i] = TY0[i]; TZ[i] = TZ0[i]; TVX[i] = TV0[i * 3]; TVY[i] = TV0[i * 3 + 1]; TVZ[i] = TV0[i * 3 + 2]; DST[i] = 0; DAGE[i] = 0; }
    for (let i = 0; i < nT; i++) { THP[i] = THPM[i]; TFL[i] = 0; showTarget(i, i < nPrim); }
    if (TT) TT.reset(); driftKilled = 0;
    BL.fill(0); SL.fill(0); CL.fill(0); if (fxOn()) FX.clear?.();
    s = sHero; ox = oy = 0; spd = SPEED; runT = 0; started = false; ended = false;
    regenT = 0; score = 0; combo = 1; comboT = 0; bestCombo = 1; roll = 0; chainDec = 0; shield = 0; extraNext = 0; shots = 0; boltHits = 0; tallyReset(); hull = HULL_MAX; xp = 0; level = 1; heat = 0; overheated = false; fireCD = 0;
    boost = 0; surge = 0; shake = 0; killed = 0; crystalsGot = 0;
    vb = ve = 0; shipX = -SH_RIGHT; bank = 0; oxPrev = 0; gunEyeK = 0; gunReset();
    nCrack = crackNext = hits = 0; hitPulse = glitchT = 0; ovDirty = true;
    introBegin();
    if (TFX) TFX.fonts(); // the title slam and countdown faces (Google Fonts, with heavy system fallbacks)
    cur = 0; for (const q of PL) plSave(q); PK.fill(0); BOTT.fill(-1); BOTF.fill(0); BOW.fill(0); mpBoot = 1;
    if (NP > 1) mpSetup(NP);
    if (WH) WH.reset(); if (PU) PU.reset(); // HOOK (pulse.js)
    if (CMB) CMB.reset(); // HOOK (combat.js)
    placeShip(); writePools(0);
  }
  function finish(throughGate) {
    ended = true; if (mpRun) { use(0); hud.player = -1; }
    if (throughGate) { addScore(GATE_BONUS); hud.popup('GATE +' + GATE_BONUS, 0, 0.3, 'big'); hud.event('gate'); if (fxOn()) FX.boom(gate[0], gate[1], gate[2], { rad: GATE_R * 0.8 }); }
    tallyStart(throughGate); // the arcade tally, initials and the high-score table; it ends in hud.results (see showResults)
  }

  // ---------------------------------------------------------------- camera
  function placeCamera(dt, input) {
    railFrame(s, FR); rail.at(s, T2);
    let jx = 0, jy = 0;
    const fs = fxOn() ? FX.shake || 0 : 0, sh = shake * (fxOn() ? FX.shakeScale ?? 1 : 1) + fs * (mpRun ? 0.1 : 0.4); // FX.shake already carries shakeScale (reduced motion); split: hull hits shake everyone, kills barely
    if (sh > 0 && dt > 0) { jx = (rnd() * 2 - 1) * sh; jy = (rnd() * 2 - 1) * sh; }
    const u = ox + jx, v = oy + jy;
    cam[0] = T2[0] + FR[3] * u + FR[6] * v; cam[1] = T2[1] + FR[4] * u + FR[7] * v; cam[2] = T2[2] + FR[5] * u + FR[8] * v;
    // look: the rail tangent blended LOOK_AIM toward the aim (not before the run starts, so it opens on the concept view)
    let lx = FR[0], ly = FR[1], lz = FR[2];
    if (started && turret) { TT.aim(FR); lx = TT.dir[0]; ly = TT.dir[1]; lz = TT.dir[2]; } // free look, rail-relative (turret.js)
    else if (started) {
      const ax = aim[0] * tanH * aspect, ay = aim[1] * tanH;
      let dx = FR[0] + FR[3] * ax + FR[6] * ay, dy = FR[1] + FR[4] * ax + FR[7] * ay, dz = FR[2] + FR[5] * ax + FR[8] * ay; const dl = hypot(dx, dy, dz);
      lx = mix(lx, dx / dl, LOOK_AIM); ly = mix(ly, dy / dl, LOOK_AIM); lz = mix(lz, dz / dl, LOOK_AIM);
    }
    const k = started && dt > 0 && !turret ? 1 - exp(-dt * 6) : 1; // the turret look is direct (no lag)
    L[0] += (lx - L[0]) * k; L[1] += (ly - L[1]) * k; L[2] += (lz - L[2]) * k; const ll = hypot(L[0], L[1], L[2]);
    rail.yawPitch(L[0] / ll, L[1] / ll, L[2] / ll, YP);
    if (F) {
      F[0] = cam[0]; F[1] = cam[1]; F[2] = cam[2]; F[3] = YP[0]; F[4] = YP[1]; F[11] = HERO_FOV + 0.1 * clamp((spd - SPEED) / BOOST_ADD, 0, 1) + (PU ? PU.cine.fov : 0); F[25] = PU && !mpRun ? PU.cine.roll : 0; // HOOK (pulse.js): the quick dolly-zoom and roll
      if (started && G.collide) { G.collide(F); cam[0] = F[0]; cam[1] = F[1]; cam[2] = F[2]; } // decorative rocks push the ship aside
    }
    const cy = cos(YP[0]), sy = sin(YP[0]), cp = cos(YP[1]), sp = sin(YP[1]);
    CB[0] = sy * cp; CB[1] = sp; CB[2] = cy * cp; CB[3] = cy; CB[4] = 0; CB[5] = -sy; CB[6] = -sp * sy; CB[7] = cp; CB[8] = -sp * cy;
    // view blend (VIEW.md): vb runs 0 (cockpit) → 1 (shoulder) in BLEND_T, eased; the menu's concept view is always cockpit
    if (!started) vb = intro.active && !FRAME0 && intro.shown0 && shell && shell.view === 'shoulder' ? 1 : 0; // the intro opens straight in shoulder view there
    else if (dt > 0) vb = shell && shell.view === 'shoulder' ? min(1, vb + dt / BLEND_T) : max(0, vb - dt / BLEND_T);
    if (PU && PU.cine.w > vb) vb = PU.cine.w; // HOOK (pulse.js), first pulse: the camera leaves the turret, so the ship shows
    ve = vb * vb * (3 - 2 * vb);
    if (dt > 0) {
      // keep the ship off the reticle: when the reticle drops toward the ship's height, slide the ship further left of it
      const rx = aim[0] * SH_BACK * tanH * aspect, ry = aim[1] * SH_BACK * tanH, w = turret ? 0 : clamp((0.1 - ry) / 0.5, 0, 1); // turret: the reticle is centred, the ship sits lower left
      const side = turret ? SH_RIGHT + 0.8 * abs(sin(TT.yaw)) * cos(TT.pitch) : 0; // turret: seen broadside the ship is longer on screen, so it slides further left
      shipX += ((turret ? -side : mix(-SH_RIGHT, min(-SH_RIGHT, rx - 2.6), w)) - shipX) * (1 - exp(-dt * 10));
      const vx = (ox - oxPrev) / dt; oxPrev = ox;
      bank += (clamp(-vx * 0.07, -0.6, 0.6) - bank) * (1 - exp(-dt * 6));
    }
    const bk = ve * SH_BACK, up = ve * SH_UP, rt = -ve * shipX;
    if (started && turret) TT.orbit(cam, SH_BACK, SH_UP, -shipX, ve, eye); // turret: the camera orbits the ship around the look direction
    else { eye[0] = cam[0] - CB[0] * bk + CB[3] * rt + CB[6] * up; eye[1] = cam[1] - CB[1] * bk + CB[7] * up; eye[2] = cam[2] - CB[2] * bk + CB[5] * rt + CB[8] * up; }
    shipPose();
    // the gunship's cockpit eye is the turret: over the dome on its yaw axis. It eases in after control is handed over, so Frame 0
    // and the start sequence keep the pilot position
    if (GH && dt > 0) gunEyeK = started ? min(1, gunEyeK + dt / 0.6) : 0;
    if (GH && !mpRun && gunEyeK > 0 && ve < 1) { const k = gunEyeK * (1 - ve);
      if (barrelsOn) { // the gunner's seat (GUN.seat): behind and above the trunnion along the look, plus the blaster's recoil kick
        qRotTo(QSH, 0, GP.turret[0], GP.trunnion[1], GP.turret[2], RV, 0);
        const kk = GUN.seat.kick * (Turret.reduced ? 0.35 : 1) * max(1 - smooth(RT[0], 0, 0.16), 1 - smooth(RT[1], 0, 0.16)), b = GUN.seat.back + kk, u = GUN.seat.up;
        RV[0] += -CB[0] * b + CB[6] * u; RV[1] += -CB[1] * b + CB[7] * u; RV[2] += -CB[2] * b + CB[8] * u;
      } else qRotTo(QSH, 0, GP.eye[0], GP.eye[1], GP.eye[2], RV, 0);
      eye[0] += RV[0] * k; eye[1] += RV[1] * k; eye[2] += RV[2] * k; }
    if (F) {
      F[0] = eye[0]; F[1] = eye[1]; F[2] = eye[2];
      if (ve > 0 && G.collide) { G.collide(F); eye[0] = F[0]; eye[1] = F[1]; eye[2] = F[2]; } // the camera never sits inside a rock either
      if (PU && PU.cine.on && !mpRun) PU.cineApply(F, cam[0], cam[1], cam[2], CB, G.collide); // HOOK (pulse.js): the sweep round the ship, or the quick push-in (F only: the aim stays the player's)
    }
    if (mpRun) mpCameras(dt);
    placeShip(dt);
  }
  // split screen: each gunner's camera at their hardpoint on the ship (the shoulder view orbits the hardpoint), their own turret
  // look, a small kick when they fire; P1 is also the engine's main camera F. Wide views (3 players: P1 on top) narrow the
  // vertical FOV a little so the horizontal one stays sane.
  function mpCameras(dt) {
    const V = G.views, t0 = Math.tan((F ? F[11] : HERO_FOV) / 2);
    shell.mp.layout(NP, V.rect); V.n = NP; V.scale = NP >= 4 ? MP_Q4.scale : 1;
    for (let p = 0; p < NP; p++) {
      const T = TTS[p], h = HPTS[p], o = p * 3; T.aim(FR);
      qRotTo(QSH, 0, h[0], h[1], h[2], RV, 0); // the hardpoint rides the ship (rail frame plus bank)
      let x = cam[0] + RV[0], y = cam[1] + RV[1], z = cam[2] + RV[2];
      HPW[o] = x; HPW[o + 1] = y; HPW[o + 2] = z;
      const kj = PK[p] * 0.045; if (kj > 1e-3 && dt > 0) { const a = (rnd() * 2 - 1) * kj, b = (rnd() * 2 - 1) * kj; x += T.B[3] * a + T.B[6] * b; y += T.B[7] * b; z += T.B[5] * a + T.B[8] * b; }
      MPF[0] = x; MPF[1] = y; MPF[2] = z;
      if (ve > 0) { // shoulder: like one player, orbit the ship itself (not the hardpoint), the ship lower left and clear of the reticle
        const side = SH_RIGHT + 0.8 * abs(sin(T.yaw)) * cos(T.pitch); T.orbit(cam, SH_BACK, SH_UP, side, ve, T3);
        MPF[0] += (T3[0] - MPF[0]) * ve; MPF[1] += (T3[1] - MPF[1]) * ve; MPF[2] += (T3[2] - MPF[2]) * ve; if (G.collide) G.collide(MPF); }
      EYE[o] = MPF[0]; EYE[o + 1] = MPF[1]; EYE[o + 2] = MPF[2]; for (let j = 0; j < 9; j++) CBP[p * 9 + j] = T.B[j];
      const asp = V.aspect[p] > 0 ? V.aspect[p] : V.rect[p * 4 + 2] / V.rect[p * 4 + 3] * fullAsp;
      const tn = asp > 1.78 ? t0 * max(0.62, Math.pow(1.7778 / asp, 0.6)) : t0;
      TANP[p] = tn; ASPP[p] = asp;
      const c = V.cam, k = p * 6; c[k] = MPF[0]; c[k + 1] = MPF[1]; c[k + 2] = MPF[2]; c[k + 3] = T.Y; c[k + 4] = clamp(T.P + PK[p] * 0.012, -1.5, 1.5); c[k + 5] = 2 * Math.atan(tn);
    }
    if (F) { F[0] = EYE[0]; F[1] = EYE[1]; F[2] = EYE[2]; F[3] = TTS[0].Y; F[4] = TTS[0].P; }
    use(0); for (let j = 0; j < 3; j++) eye[j] = EYE[j]; for (let j = 0; j < 9; j++) CB[j] = CBP[j]; tanH = TANP[0]; aspect = ASPP[0];
  }
  // split screen: look input per gunner (?fakepads bots aim at the nearest rock on their side of the ship and fire when on it)
  function mpLook(dt, input) {
    for (let p = 0; p < NP; p++) { const q = input.mp.p[p]; PK[p] *= exp(-dt * 10); if (q.bot) botStep(p, dt); else TTS[p].step(dt, q.look); }
  }
  function botStep(p, dt) {
    const T = TTS[p], o = p * 3, h = HPTS[p], hx = HPW[o], hy = HPW[o + 1], hz = HPW[o + 2];
    const pr = h[0] * 0.5, pu = h[1] * 0.6, pn = hypot(1, pr, pu); let bi = BOTT[p];
    if ((BOTH[p] -= dt) <= 0 || bi < 0 || !TAL[bi]) { // pick: the nearest live rock in range, favouring this gunner's side, not another bot's pick
      let bs = 1e9; bi = -1;
      for (let i = 0; i < nT; i++) { if (!TAL[i]) continue;
        const dx = TX[i] - hx, dy = TY[i] - hy, dz = TZ[i] - hz, d = hypot(dx, dy, dz); if (d < 5 || d > BOT.range) continue;
        const al = (dx * FR[0] + dy * FR[1] + dz * FR[2] + (dx * FR[3] + dy * FR[4] + dz * FR[5]) * pr + (dx * FR[6] + dy * FR[7] + dz * FR[8]) * pu) / (d * pn);
        let sc = d * (1.8 - al); for (let q = 0; q < NP; q++) if (q !== p && BOTT[q] === i) sc *= 2;
        if (sc < bs) { bs = sc; bi = i; } }
      BOTT[p] = bi; BOTH[p] = BOT.hold;
    }
    BOTF[p] = 0; const k = 1 - exp(-dt * BOT.turn);
    if (bi < 0) { T.yaw -= T.yaw * k * 0.3; T.pitch -= T.pitch * k * 0.3; return; }
    const d0 = hypot(TX[bi] - hx, TY[bi] - hy, TZ[bi] - hz), tl = d0 / BOLT_SPEED; // lead: the bolt carries the ship's velocity
    const dx = TX[bi] + (TVX[bi] * (bi >= nD0) - FR[0] * spd) * tl - hx, dy = TY[bi] + (TVY[bi] * (bi >= nD0) - FR[1] * spd) * tl - hy, dz = TZ[bi] + (TVZ[bi] * (bi >= nD0) - FR[2] * spd) * tl - hz, d = hypot(dx, dy, dz) || 1;
    const f = (dx * FR[0] + dy * FR[1] + dz * FR[2]) / d, r = (dx * FR[3] + dy * FR[4] + dz * FR[5]) / d, u = (dx * FR[6] + dy * FR[7] + dz * FR[8]) / d;
    const wy = atan2(r, f), wp = Math.asin(clamp(u, -1, 1)), ey = Turret.wrap(wy - T.yaw), ep = wp - T.pitch;
    T.yaw = Turret.wrap(T.yaw + ey * k); T.pitch = clamp(T.pitch + ep * k, -T.pitchMax, T.pitchMax); T.idle = 0;
    BOTF[p] = hypot(ey, ep) < BOT.cone && d0 < BOT.range ? 1 : 0;
  }
  function mpSetup(n) { // the player count for the next run (applied before a run starts)
    NP = n; if (G && G.views) G.views.n = 0; ovDirty = true;
    if (n > 1) { // split: no Frame 0 or title slam; the HUD boots through 3 2 1 and play starts on GO (mpCount)
      intro.active = false; intro.phase = 'run'; mpBoot = 0; if (hud) { hud.power = 0; hud.clock = false; hud.glitch = 0; } spd = SPEED; for (const T of TTS) T.reset(); BOTT.fill(-1);
      cd.mp = true; cd.t = 0; cd.slamOn = false; cd.anc = false; cd.a = 0; cd.n = -1; cd.post = -1; cd.skip = false; cd.fireHeld = true; cdPlan(0); cdClear();
    }
    else introBegin();
  }

  // the GLB ship (one mesh: ?shipglb=<url>, or the gunship's whole.glb fallback): load in the background; until it arrives (or when
  // there is none) the procedural ship flies
  function loadShipGLB(url, fix) {
    const q = typeof QS !== 'undefined' ? QS : new URLSearchParams();
    if (typeof GLB === 'undefined') return;
    GLB.load(url).then((model) => {
      if (!G.addMesh) return;
      const fx = fix || SHIP_FIX[url] || SHIP_FIX['*'];
      shipH = G.addMesh(fx.mirror ? mirrorX(model, 0) : model, { center: true, visible: false, scale: 0, forward: q.get('shipfwd') || fx.forward, up: q.get('shipup') || fx.up, yaw: q.has('shipyaw') ? +q.get('shipyaw') : fx.yaw || 0,
        tint: SHIP_GLB.tint, emissive: SHIP_GLB.emissive, emissiveCut: SHIP_GLB.emissiveCut });
      shipFit = SHIP_GLB.length / (shipH.bounds.size[2] || 1);
      placeShip();
    }).catch((e) => console.warn('Reef Run: GLB ship not used: ' + e.message));
  }
  // glTF (right-handed) to the engine's left-handed ship space: negate x (positions and normals) and shift y by -y0. The index order is
  // kept on purpose: the engine's front-face test is also left-handed, so an UNmirrored glTF draws with front_facing inverted (normals
  // flipped: the rim term floods every face, the washed-out cream look); the mirror puts both right. Load time only.
  function mirrorX(m, y0) {
    return { images: m.images, url: m.url, nTri: m.nTri, bounds: m.bounds, prims: m.prims.map((p) => {
      const n = p.pos.length, pos = new Float32Array(n), nrm = new Float32Array(n);
      for (let k = 0; k < n; k += 3) { pos[k] = -p.pos[k]; pos[k + 1] = p.pos[k + 1] - y0; pos[k + 2] = p.pos[k + 2]; nrm[k] = -p.nrm[k]; nrm[k + 1] = p.nrm[k + 1]; nrm[k + 2] = p.nrm[k + 2]; }
      
      return { pos, nrm, uv: p.uv, idx: p.idx, mat: p.mat };
    }) };
  }
  // the barrels mesh as three: the mantlet and cradle (pitch only), and the two tubes (pitch + their own recoil). A tube triangle lies
  // wholly forward of GUN.tubeZ; its side is the sign of x. Each tube's muzzle = the centre of its foremost 2 cm (ship space).
  function splitTubes(m) {
    const out = [[], [], []], tip = [[0, 0, 0, 0, -9], [0, 0, 0, 0, -9]];
    for (const p of m.prims) {
      const P = p.pos, I = p.idx, L = [[], [], []];
      for (let k = 0; k < I.length; k += 3) {
        const a = I[k] * 3, b = I[k + 1] * 3, c = I[k + 2] * 3;
        const fwd = P[a + 2] > GUN.tubeZ && P[b + 2] > GUN.tubeZ && P[c + 2] > GUN.tubeZ, side = P[a] + P[b] + P[c] < 0 ? 1 : 2;
        const l = fwd ? L[side] : L[0]; l.push(I[k], I[k + 1], I[k + 2]);
        if (fwd) { const t = tip[side - 1]; for (const v of [a, b, c]) t[4] = max(t[4], P[v + 2]); }
      }
      for (let j = 0; j < 3; j++) if (L[j].length) out[j].push({ pos: p.pos, nrm: p.nrm, uv: p.uv, idx: Uint32Array.from(L[j]), mat: p.mat });
      for (let j = 1; j < 3; j++) for (const i of L[j]) { const t = tip[j - 1]; if (P[i * 3 + 2] > t[4] - 0.02) { t[0] += P[i * 3]; t[1] += P[i * 3 + 1]; t[2] += P[i * 3 + 2]; t[3]++; } }
    }
    for (let j = 0; j < 2; j++) { const t = tip[j], n = t[3] || 1; GP.muzzle[j * 3] = t[0] / n; GP.muzzle[j * 3 + 1] = t[1] / n; GP.muzzle[j * 3 + 2] = t[2] / n; }
    return out.map((prims) => ({ images: m.images, url: m.url, prims }));
  }
  // the gunship: every part file must load, or it falls back to whole.glb (one rigid mesh, no turret motion)
  function loadGunship() {
    if (typeof GLB === 'undefined') return;
    const E = (a, o, k) => { o[k] = -a[0]; o[k + 1] = a[1] - GUN.y0; o[k + 2] = a[2]; }; // asset → ship space
    E(GUN.turret, GP.turret, 0); E(GUN.trunnion, GP.trunnion, 0); E(GUN.podR, GP.podR, 0); E(GUN.podL, GP.podL, 0); E(GUN.eye, GP.eye, 0);
    GUN.canMount.forEach((a, i) => E(a, GP.canMount, i * 3)); GUN.canTip.forEach((a, i) => E(a, GP.canTip, i * 3));
    GUN.glow.forEach((a, i) => { E(a, GP.glow, i * 5); GP.glow[i * 5 + 3] = a[3]; GP.glow[i * 5 + 4] = a[4]; });
    Promise.all(GUN.files.map((f) => GLB.load(GUN.dir + f))).then((ms) => {
      if (!G.addMesh) return;
      const sh = ms.map((m) => mirrorX(m, GUN.y0)), [man, ta, tb] = splitTubes(sh[2]);
      if (!man.prims.length || !ta.prims.length || !tb.prims.length) throw new Error('could not split the barrels into mantlet and two tubes');
      GH = [sh[0], sh[1], man, ta, tb, sh[3], sh[4], sh[5], sh[6]].map((m) => G.addMesh(m, { visible: false, scale: 0, tint: GUN.tint, emissive: [0, 0, 0], emissiveCut: 1 }));
      placeShip();
    }).catch((e) => { GH = null; console.warn('Reef Run: gunship parts not used (' + e.message + '); using ' + GUN.whole); loadShipGLB(GUN.dir + GUN.whole, { forward: '+z', up: '+y', yaw: 0, mirror: true }); });
  }
  function gunReset() { GA.yaw = GA.pitch = GA.podR = GA.podL = GA.canR = GA.canL = GA.aimYaw = GA.aimPitch = 0; RT.fill(9); MF.fill(0); barrelNext = 0; ALT.fill(0); }
  // quaternion helpers for the rig, [x, y, z, w] at an offset (no allocation)
  const qSet = (o, k, ax, ay, az, a) => { const s0 = sin(a * 0.5); o[k] = ax * s0; o[k + 1] = ay * s0; o[k + 2] = az * s0; o[k + 3] = cos(a * 0.5); };
  const qMulTo = (a, ka, b, kb, o, ko) => { const ax = a[ka], ay = a[ka + 1], az = a[ka + 2], aw = a[ka + 3], bx = b[kb], by = b[kb + 1], bz = b[kb + 2], bw = b[kb + 3];
    o[ko] = aw * bx + ax * bw + ay * bz - az * by; o[ko + 1] = aw * by - ax * bz + ay * bw + az * bx; o[ko + 2] = aw * bz + ax * by - ay * bx + az * bw; o[ko + 3] = aw * bw - ax * bx - ay * by - az * bz; };
  const qRotTo = (q, k, x, y, z, o, ko) => { const qx = q[k], qy = q[k + 1], qz = q[k + 2], qw = q[k + 3], tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
    o[ko] = x + qw * tx + (qy * tz - qz * ty); o[ko + 1] = y + qw * ty + (qz * tx - qx * tz); o[ko + 2] = z + qw * tz + (qx * ty - qy * tx); };
  // part i = parent ∘ T(p) · R(axis, ang) · T(-p) · T(0, 0, -slide) (slide: recoil along the part's own -Z, before its rotation)
  function rigPart(i, par, ax, ay, az, ang, Pv, k, slide) {
    qSet(RQ, 0, ax, ay, az, ang); const px = Pv[k], py = Pv[k + 1], pz = Pv[k + 2], qi = i * 4, ti = i * 3;
    qRotTo(RQ, 0, -px, -py, -slide - pz, RV, 0); RV[0] += px; RV[1] += py; RV[2] += pz;
    if (par < 0) { for (let j = 0; j < 4; j++) XQ[qi + j] = RQ[j]; XT[ti] = RV[0]; XT[ti + 1] = RV[1]; XT[ti + 2] = RV[2]; return; }
    const qp = par * 4, tp = par * 3;
    qMulTo(XQ, qp, RQ, 0, XQ, qi); qRotTo(XQ, qp, RV[0], RV[1], RV[2], XT, ti); XT[ti] += XT[tp]; XT[ti + 1] += XT[tp + 1]; XT[ti + 2] += XT[tp + 2];
  }
  // a ship-space point on part i, at ship scale s (plus the hover bob), to world: out[ko..]
  let gunBob = 0;
  function ptW(i, x, y, z, s, out, ko) {
    qRotTo(XQ, i * 4, x, y, z, RV, 3); qRotTo(QSH, 0, RV[3] + XT[i * 3], RV[4] + XT[i * 3 + 1] + gunBob, RV[5] + XT[i * 3 + 2], RV, 3);
    out[ko] = cam[0] + RV[3] * s; out[ko + 1] = cam[1] + RV[4] * s; out[ko + 2] = cam[2] + RV[5] * s;
  }
  // gunner p's aim point: 90 m out along the ray through their reticle (fire() converges the bolts there)
  const AP = new Float64Array(3), ALT = new Uint8Array(4);
  function aimPoint(p) {
    if (mpRun) { const o = p * 3, b = p * 9; AP[0] = EYE[o] + CBP[b] * 90; AP[1] = EYE[o + 1] + CBP[b + 1] * 90; AP[2] = EYE[o + 2] + CBP[b + 2] * 90; return; }
    const ax = aim[0] * tanH * aspect, ay = aim[1] * tanH, dx = CB[0] + CB[3] * ax + CB[6] * ay, dy = CB[1] + CB[4] * ax + CB[7] * ay, dz = CB[2] + CB[5] * ax + CB[8] * ay, l = hypot(dx, dy, dz) || 1;
    AP[0] = eye[0] + dx / l * 90; AP[1] = eye[1] + dy / l * 90; AP[2] = eye[2] + dz / l * 90;
  }
  // the aim point AP seen from ship-space point (x, y, z): ship-relative yaw (> 0 right) and pitch (> 0 up) into GA.aimYaw / aimPitch
  function gunAim(x, y, z) {
    qRotTo(QSH, 0, x, y, z, RV, 0); const dx = AP[0] - cam[0] - RV[0], dy = AP[1] - cam[1] - RV[1], dz = AP[2] - cam[2] - RV[2];
    RQ[4] = -QSH[0]; RQ[5] = -QSH[1]; RQ[6] = -QSH[2]; RQ[7] = QSH[3]; qRotTo(RQ, 4, dx, dy, dz, RV, 3);
    GA.aimYaw = Math.atan2(RV[3], RV[5]); GA.aimPitch = Math.atan2(RV[4], hypot(RV[3], RV[5]));
  }
  const easeTo = (c, t, rate, dt, k) => c + clamp((t - c) * (1 - exp(-dt * k)), -rate * dt, rate * dt);
  // pose every part for this frame and write the mesh handles. sc: the ship's view-blend scale; sBar: the barrels' (cockpit barrel tips); ck: cockpit tips (smaller flash)
  function gunPlace(dt, sc, sBar, ck) {
    gunT = F ? F[8] : 0;
    gunBob = GUN.bob * (sin(gunT * TAU * GUN.bobHz) * 0.8 + sin(gunT * TAU * GUN.bobHz * 2.3 + 1.3) * 0.2);
    if (dt > 0) {
      // the top turret follows P1 (the only gunner with one player): yaw rate-limited with a slight lag, pitch clamped -10°..+70°
      aimPoint(0); gunAim(GP.turret[0], GP.trunnion[1], GP.turret[2]);
      GA.yaw = Turret.wrap(GA.yaw + clamp(Turret.wrap(GA.aimYaw - GA.yaw) * (1 - exp(-dt * GUN.lag)), -GUN.yawRate * dt, GUN.yawRate * dt));
      GA.pitch = easeTo(GA.pitch, clamp(GA.aimPitch, GUN.pitchMin, GUN.pitchMax), GUN.pitchRate, dt, GUN.lag);
      // pods: lean into turns (the inside pod noses up, the outside one down), tip forward on boost; split P2 / P3 lean them toward their aim
      const bk = clamp((spd - SPEED) / BOOST_ADD, 0, 1), base = GUN.podBoost * bk, lim = GUN.podTilt;
      let tR = clamp(base + GUN.podBank * bank, -lim, lim), tL = clamp(base - GUN.podBank * bank, -lim, lim), cR = 0, cL = 0;
      if (mpRun && NP > 1) { aimPoint(1); gunAim(GP.canMount[0], GP.canMount[1], GP.canMount[2]); tR = clamp(base - GA.aimPitch * 0.6, -lim, lim); cR = clamp(GA.aimYaw, -GUN.canIn, GUN.canOut); }
      if (mpRun && NP > 2) { aimPoint(2); gunAim(GP.canMount[3], GP.canMount[4], GP.canMount[5]); tL = clamp(base - GA.aimPitch * 0.6, -lim, lim); cL = clamp(GA.aimYaw, -GUN.canOut, GUN.canIn); }
      GA.podR = easeTo(GA.podR, tR, 1.5, dt, GUN.podRate); GA.podL = easeTo(GA.podL, tL, 1.5, dt, GUN.podRate);
      GA.canR = easeTo(GA.canR, cR, GUN.yawRate, dt, GUN.lag * 0.6); GA.canL = easeTo(GA.canL, cL, GUN.yawRate, dt, GUN.lag * 0.6);
      RT[0] += dt; RT[1] += dt; for (let j = 0; j < 6; j++) MF[j] = max(0, MF[j] - dt / GUN.flashT);
    }
    const rec = (b) => GUN.recoil * (1 - smooth(RT[b], 0, GUN.recoilT)); // kick back at once, ease home over recoilT
    for (let j = 0; j < 4; j++) XQ[j] = j === 3 ? 1 : 0; XT[0] = XT[1] = XT[2] = 0; // hull
    rigPart(GH_DOME, GH_HULL, 0, 1, 0, GA.yaw, GP.turret, 0, 0);
    rigPart(GH_MANT, GH_DOME, 1, 0, 0, -GA.pitch, GP.trunnion, 0, 0); // about +X, negative = up
    rigPart(GH_TA, GH_DOME, 1, 0, 0, -GA.pitch, GP.trunnion, 0, rec(0));
    rigPart(GH_TB, GH_DOME, 1, 0, 0, -GA.pitch, GP.trunnion, 0, rec(1));
    rigPart(GH_PR, GH_HULL, 1, 0, 0, GA.podR, GP.podR, 0, 0); // positive = nose down
    rigPart(GH_PL, GH_HULL, 1, 0, 0, GA.podL, GP.podL, 0, 0);
    rigPart(GH_CR, GH_PR, 0, 1, 0, GA.canR, GP.canMount, 0, 0);
    rigPart(GH_CL, GH_PL, 0, 1, 0, GA.canL, GP.canMount, 3, 0);
    for (let i = 0; i < NGH; i++) {
      const h = GH[i], s0 = i === GH_TA || i === GH_TB || (i === GH_MANT && (GUN.seat.mantlet || sc > 0)) ? sBar : sc;
      h.visible = s0 > 0; h.scale = s0; if (!(s0 > 0)) continue;
      qMulTo(QSH, 0, XQ, i * 4, h.q, 0); qRotTo(QSH, 0, XT[i * 3], XT[i * 3 + 1] + gunBob, XT[i * 3 + 2], RV, 0);
      h.pos[0] = cam[0] + RV[0] * s0; h.pos[1] = cam[1] + RV[1] * s0; h.pos[2] = cam[2] + RV[2] * s0;
    }
    // muzzles (full size, where the bolts start): the two tubes, then the right and left cannon pairs
    ptW(GH_TA, GP.muzzle[0], GP.muzzle[1], GP.muzzle[2], 1, MZW, 0); ptW(GH_TB, GP.muzzle[3], GP.muzzle[4], GP.muzzle[5], 1, MZW, 3);
    for (let j = 0; j < 4; j++) ptW(j < 2 ? GH_CR : GH_CL, GP.canTip[j * 3], GP.canTip[j * 3 + 1], GP.canTip[j * 3 + 2], 1, MZW, 6 + j * 3);
    ptW(GH_TA, GP.muzzle[0], GP.muzzle[1], GP.trunnion[2] + 0.15, 1, TBW, 0); ptW(GH_TB, GP.muzzle[3], GP.muzzle[4], GP.trunnion[2] + 0.15, 1, TBW, 3); // tube roots (combat.js: barrel heat glow)
    if (!P) return;
    // engine glows (hull nozzles, pod rears) pulse with speed and boost; muzzle flashes in the gunner's colour
    const bk = clamp((spd - SPEED) / BOOST_ADD, 0, 1), sk = clamp(spd / SPEED, 0, 2), NGL = GUN.glow.length;
    for (let g = 0; g < NGL; g++) {
      const o = g * 5, part = GP.glow[o + 4] === 0 ? GH_HULL : GP.glow[o + 4] === 1 ? GH_PR : GH_PL; ptW(part, GP.glow[o], GP.glow[o + 1], GP.glow[o + 2], sc, GLW, g * 3);
      const fl = 0.86 + 0.14 * sin(gunT * 37 + g * 2.1), k = (0.45 + 0.4 * sk + 0.7 * bk) * fl;
      setPt(GP0 + g, GLW[g * 3], GLW[g * 3 + 1], GLW[g * 3 + 2], sc > 0 ? GP.glow[o + 3] * (0.85 + 0.5 * bk) * sc : 0, 3.6 * k, 1.7 * k, 0.45 * k, 0);
    }
    for (let j = 0; j < 6; j++) {
      const f = MF[j], vis = j < 2 ? sBar : sc, c = PBOLT[j < 2 ? 0 : j < 4 ? 1 : 2];
      setPt(GP0 + NGL + j, MZW[j * 3], MZW[j * 3 + 1], MZW[j * 3 + 2], f > 0 && vis > 0 ? (0.07 + 0.13 * f) * (j < 2 && ck ? 0.4 : 1) : 0, c[0] * f, c[1] * f, c[2] * f, 0);
    }
  }
  // the ship's world orientation this frame: yaw · pitch · bank (pilot: it faces the look; turret: it flies the rail)
  let shY = 0, shP = 0;
  function shipPose() {
    let Y0 = YP[0], P0 = YP[1];
    if (started && turret) { Y0 = Math.atan2(FR[0], FR[2]); P0 = Math.asin(clamp(FR[1], -1, 1)); }
    shY = Y0; shP = P0;
    const hy = Y0 * 0.5, hp = -P0 * 0.5, hb = bank * 0.5, ys = sin(hy), yc = cos(hy), xs = sin(hp), xc = cos(hp), zs = sin(hb), zc = cos(hb);
    const a0 = yc * xs, a1 = ys * xc, a2 = -ys * xs, a3 = yc * xc; // q = yaw(Y) · pitch(X) · bank(Z), as qMul
    QSH[0] = a0 * zc + a1 * zs; QSH[1] = a1 * zc - a0 * zs; QSH[2] = a2 * zc + a3 * zs; QSH[3] = a3 * zc - a2 * zs;
  }
  // the player's ship at the pilot position (hidden in cockpit view), banking with the steering. The gunship is articulated (gunPlace);
  // in cockpit view only its barrel tips may show (`barrels on|off`), once control is handed over, so Frame 0 stays shipless.
  function placeShip(dt = 0) {
    if (!shipMesh) return;
    shipPose();
    const vis = mpRun ? 1 : clamp((ve - 0.2) / 0.5, 0, 1), sc = vis * vis * (3 - 2 * vis), I = shipMesh.inst; // split: the gunners ride on it, so it always shows
    const Bs = typeof Turret !== 'undefined' ? Turret.basis(shY, shP, SB) : CB;
    I[0] = cam[0]; I[1] = cam[1]; I[2] = cam[2]; I[3] = sc; I[4] = QSH[0]; I[5] = QSH[1]; I[6] = QSH[2]; I[7] = QSH[3];
    // cockpit barrel tips: only once the eye sits in the turret, and not while the look is below the barrels' -10° stop (they would
    // swing up into the middle of the view)
    const tips = !mpRun && barrelsOn && gunEyeK >= 1 && started && GA.aimPitch > GUN.pitchMin - 0.05;
    if (GH) { I[3] = 0; gunPlace(dt, sc, tips ? 1 : sc, tips && sc < 1); }
    else if (shipH) { // a single-mesh GLB ship takes the same pose; the procedural one and its lights stay hidden
      shipH.pos[0] = cam[0]; shipH.pos[1] = cam[1]; shipH.pos[2] = cam[2]; shipH.q[0] = I[4]; shipH.q[1] = I[5]; shipH.q[2] = I[6]; shipH.q[3] = I[7];
      shipH.scale = sc * shipFit; shipH.visible = sc > 0; I[3] = 0;
    }
    shipMesh.dirty = true;
    if (!P) return;
    const cb = cos(bank), sb = sin(bank);
    const Rx = Bs[3] * cb + Bs[6] * sb, Ry = Bs[7] * sb, Rz = Bs[5] * cb + Bs[8] * sb, Ux = Bs[6] * cb - Bs[3] * sb, Uy = Bs[7] * cb, Uz = Bs[8] * cb - Bs[5] * sb;
    for (let i = 0; i < NSHP; i++) {
      const q = SHIP_PTS[i], x = q[0], y = q[1], z = q[2];
      setPt(SH0 + i, cam[0] + Rx * x + Ux * y + Bs[0] * z, cam[1] + Ry * x + Uy * y + Bs[1] * z, cam[2] + Rz * x + Uz * y + Bs[2] * z, shipH || GH ? 0 : q[3] * sc, q[4], q[5], q[6], 0);
    }
  }
  // where gunner p's bolt b (of n) starts on the gunship: P1 alternates the turret tubes (kick + flash), P2 / P3 their cannon pair's
  // muzzles; -1 for P4 (the belly hardpoint has no mesh) or without the gunship
  function gunMuzzle(p, b, n) {
    if (!GH || p > 2) return -1;
    const k = (ALT[p] + b) & 1; if (b === n - 1 && n !== 2) ALT[p] ^= 1;
    if (p === 0) { RT[k] = 0; MF[k] = 1; return k * 3; }
    const j = 2 + (p - 1) * 2 + k; MF[j] = 1; return j * 3;
  }
  // ---------------------------------------------------------------- frame
  function fire() {
    const w = weapon(), ax = aim[0] * tanH * aspect, ay = aim[1] * tanH;
    let dx = CB[0] + CB[3] * ax + CB[6] * ay, dy = CB[1] + CB[4] * ax + CB[7] * ay, dz = CB[2] + CB[5] * ax + CB[8] * ay; const dl = hypot(dx, dy, dz);
    const tx = eye[0] + dx / dl * 90, ty = eye[1] + dy / dl * 90, tz = eye[2] + dz / dl * 90; // the bolts converge on the aim ray 90 m out
    for (let b = 0; b < w.bolts; b++) {
      const side = w.bolts === 1 ? 0 : w.bolts === 2 ? (b ? 0.8 : -0.8) : (b - 1) * 0.8, ang = w.bolts === 3 ? (b - 1) * w.spread : 0;
      // from the ship: just below the eye in cockpit view, from the nose in shoulder view (the procedural ship)
      const dn = 1 - ve, fw = ve * 1.3;
      const hp = cur * 3, ox = mpRun ? HPW[hp] - cam[0] + CB[0] * 0.6 + CB[6] * 0.2 : 0, oy = mpRun ? HPW[hp + 1] - cam[1] + CB[1] * 0.6 + CB[7] * 0.2 : 0, oz = mpRun ? HPW[hp + 2] - cam[2] + CB[2] * 0.6 + CB[8] * 0.2 : 0; // split: from the gunner's hardpoint
      let x0 = cam[0] - CB[6] * 0.55 * dn + CB[0] * fw + CB[3] * side + ox, y0 = cam[1] - CB[7] * 0.55 * dn + CB[1] * fw + oy, z0 = cam[2] - CB[8] * 0.55 * dn + CB[2] * fw + CB[5] * side + oz;
      const mz = gunMuzzle(mpRun ? cur : 0, b, w.bolts); if (mz >= 0) { x0 = MZW[mz]; y0 = MZW[mz + 1]; z0 = MZW[mz + 2]; } // the gunship: from the muzzles (both views)
      let vx = tx - x0 + CB[3] * ang * 90, vy = ty - y0, vz = tz - z0 + CB[5] * ang * 90; const vl = hypot(vx, vy, vz);
      const i = boltNext; boltNext = (boltNext + 1) % NBOLT;
      BX[i * 3] = x0; BX[i * 3 + 1] = y0; BX[i * 3 + 2] = z0;
      BV[i * 3] = vx / vl * BOLT_SPEED + FR[0] * spd; BV[i * 3 + 1] = vy / vl * BOLT_SPEED + FR[1] * spd; BV[i * 3 + 2] = vz / vl * BOLT_SPEED + FR[2] * spd;
      BL[i] = BOLT_LIFE; BD[i] = w.dmg; BS[i] = w.size; BOW[i] = cur;
    }
    shots += w.bolts; hud.event('fire'); if (mpRun) PK[cur] = min(1, PK[cur] + 0.3); // split: this gunner's view kicks
  }

  // HOOK (pulse.js): alt-fire (F, right mouse, left bumper) while no pulse or warp is running sends the orb down this gunner's aim ray
  // carpetshark: "just make it a timed effect. every 10 seconds the next shot fires the effect". The warp charges for 10 s (while no pulse
  // or warp runs); once charged, the next shot also fires the Reality Pulse from that gunner's turret. 3 / F / right-click only in dev mode.
  function pulseStep(dt, input) {
    let p = PU.poll(input, mpRun, NP); if (!(typeof REALMS !== 'undefined' && REALMS.dev)) p = -1;
    let f = 0; if (mpRun) { for (let q = 0; q < NP; q++) if (input.mp.p[q].fire && !(warpFire >> q & 1)) { f |= 1 << q; if (p < 0) p = warpT >= WARP_EVERY ? q : p; } warpFire = 0; for (let q = 0; q < NP; q++) if (input.mp.p[q].fire) warpFire |= 1 << q; }
    else { f = input.gunner.fire && !warpFire ? 1 : 0; warpFire = input.gunner.fire ? 1 : 0; if (p < 0 && f && warpT >= WARP_EVERY) p = 0; }
    if (started && !ended && !intro.active && !PU.busy()) warpT += dt;
    if (warpT >= WARP_EVERY && !warpCue) { warpCue = true; hud.popup('WARP READY · NEXT SHOT', 0, 0.3, 'info'); }
    if (p >= 0 && !PU.busy()) { warpT = 0; warpCue = false; }
    if (p >= 0 && !PU.busy()) {
      if (mpRun) use(p);
      const ax = aim[0] * tanH * aspect, ay = aim[1] * tanH;
      let dx = CB[0] + CB[3] * ax + CB[6] * ay, dy = CB[1] + CB[4] * ax + CB[7] * ay, dz = CB[2] + CB[5] * ax + CB[8] * ay; const dl = hypot(dx, dy, dz); dx /= dl; dy /= dl; dz /= dl;
      let x0 = eye[0] + dx * 1.2 - CB[6] * 0.5, y0 = eye[1] + dy * 1.2 - CB[7] * 0.5, z0 = eye[2] + dz * 1.2 - CB[8] * 0.5;
      const mz = gunMuzzle(mpRun ? p : 0, 0, 1); if (mz >= 0) { x0 = MZW[mz]; y0 = MZW[mz + 1]; z0 = MZW[mz + 2]; } // from a turret barrel, with its recoil and flash
      if (PU.fire(p, x0, y0, z0, eye[0], eye[1], eye[2], dx, dy, dz, mpRun ? NP : 1)) { hud.event('pulse'); if (mpRun) PK[p] = min(1, PK[p] + 0.6); }
      if (mpRun) use(0);
    }
    if (input.gunner.fire) PU.skip(); // fire skips the first-time camera sweep
    PU.step(dt, eye[0], eye[1], eye[2], F ? F[10] : 0);
    if (F && PU.timeScale < 1) F[8] -= dt * (1 - PU.timeScale); // the scene's shader motion (bobbing rocks, motes) slows with it
  }
  function pulseTime(ev) { hud.event(ev); if (ev === 'timego') { shake = max(shake, 0.3); if (fxOn()) FX.kick(0.25); } } // time snaps back with a small kick
  function pulseImpact(x, y, z, p) { // the orb has landed: a bonus if a live target is there (it is not harmed: the new realm spreads from it)
    hud.event('spread'); if (mpRun) use(p);
    let hit = false; for (let i = 0; i < nT && !hit; i++) { if (!TAL[i]) continue; const R = TR[i] * 1.3 + 0.6; hit = (x - TX[i]) * (x - TX[i]) + (y - TY[i]) * (y - TY[i]) + (z - TZ[i]) * (z - TZ[i]) < R * R; }
    project(x, y, z, PJ);
    if (hit) { addScore(PU.TUNE.bonus); hud.popup('REALITY PULSE +' + round(PU.TUNE.bonus * DF.score), PJ[2] > 0 ? PJ[0] : 0, PJ[2] > 0 ? PJ[1] : 0.3, 'big'); }
    else hud.popup('REALITY PULSE', PJ[2] > 0 ? PJ[0] : 0, PJ[2] > 0 ? PJ[1] : 0.3, 'info');
    if (mpRun) { use(0); hud.player = -1; }
  }
  const BENCHRUN = typeof QS !== 'undefined' && QS.has('bench') && QS.has('players'); // ?bench&players=N: bench a live run, not the menu
  function update(dt, input) {
    lastInput = input;
    // split screen: the player count applies before a run starts (the menu, Play again); never in fixed frames (?shot, ?frame0)
    mpWant = !IS_SHOT && !FRAME0 && shell && shell.mp && shell.mp.on && input.mp ? input.mp.n : 1;
    if (!started && mpWant !== NP) mpSetup(mpWant);
    mpRun = NP > 1 && !!shell && shell.state !== 'menu';
    if (!mpRun && G && G.views && G.views.n) G.views.n = 0;
    if (fxOn()) FX.mp = mpRun;
    if (BENCHRUN && shell && shell.state === 'menu' && G && G.start) { document.body.className = 'g'; G.start(); }
    turret = !!TT && (input.control === 'turret' || mpRun);
    aim[0] = turret ? 0 : clamp(input.gunner.x, -1, 1); aim[1] = turret ? 0 : clamp(input.gunner.y, -1, 1);
    if (CMB) CMB.input(dt, input); // HOOK (combat.js): throttle (W / S, Shift turbo / brake), weapons 1 / 2; turret W / S stop looking
    fdt = dt;
    if (FRAME0 && !IS_SHOT && shell && shell.state === 'menu' && G && G.start) { document.body.className = 'g'; G.start(); } // ?frame0: straight into the held Frame 0
    if (intro.active && (dt > 0 || intro.shown0 || FRAME0)) { introStep(dt, input); return; }
    if (cd.post >= 0 && dt > 0) { cd.post += dt; if (cd.post > INTRO.goHold) { cd.post = -1; cdClear(); } else cdPaint(cd.go + cd.post); } // GO! stays up into play
    if (cd.mp && mpRun && !started && dt > 0 && mpCount(dt, input)) { placeCamera(0, input); writePools(0); return; } // split: 3 2 1 GO
    const pdt = dt; // HOOK (pulse.js): the pulse itself runs on real time
    if (fxOn() && dt > 0) dt *= FX.timeScale ?? 1;
    if (PU && dt > 0) dt *= PU.timeScale; // HOOK (pulse.js): time all but stands still while the bubble spreads (and briefly in the Z warp)
    if (ended && dt > 0) { tallyStep(dt, input); for (let p = 0; p < (mpRun ? NP : 1); p++) { if (mpRun) use(p); roll = min(score, roll + max((score - roll) * (1 - exp(-dt * 5)), 900 * dt)); } if (mpRun) use(0); }
    if (ended || dt <= 0) { placeCamera(0, input); writePools(0); return; }
    if (!started) { zekeCallout(-1); hud.event('go'); } started = true; runT += dt; // 'go': the sound board's GO (off by default)
    if (mpRun && mpBoot < 1) { mpBoot = min(1, mpBoot + dt); hud.power = mpBoot; } // split: straight into play while the HUD boots
    // speed: each crystal gives a short surge. The crystal charge itself is spent by combat.js's turbo (Shift+W), which uses it before
    // its own meter; alt-fire (F, right mouse) is the Reality Pulse alone
    surge = max(0, surge - dt);
    const boosting = surge > 0;
    spd += (SPEED * (CMB ? CMB.thr : 1) + (boosting ? BOOST_ADD : 0) - spd) * (1 - exp(-dt * 3)); // HOOK (combat.js): the throttle scales cruise
    s += spd * dt;
    const k = 1 - exp(-dt * 3.2);
    if (turret) { autoDodge(dt); if (mpRun) mpLook(dt, input); else TT.step(dt, input.look); } // autopilot: the line, easing around rocks on it; look input only after control
    else { ox += (clamp(input.pilot.x, -1, 1) * BOX_X - ox) * k; oy += (clamp(input.pilot.y, -1, 1) * BOX_Y - oy) * k; }
    if (CMB) CMB.assist(dt, input); // HOOK (combat.js): Super Easy aim assist (after the manual look), rocks cooling off the laser
    shake = max(0, shake - dt * 1.2);
    placeCamera(dt, input);

    // weapon: heat, overheat lock, rate cooldown (split screen: each gunner's own blaster, chain and rolling score)
    for (let p = 0; p < (mpRun ? NP : 1); p++) {
      if (mpRun) use(p);
      const fireIn = mpRun ? (input.mp.p[p].bot ? !!BOTF[p] : input.mp.p[p].fire) : input.gunner.fire;
      const w = weapon();
      heat = max(0, heat - w.cool * dt); if (overheated && heat < 0.35) overheated = false;
      fireCD = max(-0.05, fireCD - dt);
      if (CMB && CMB.laserOn(p)) CMB.beam(p, dt, fireIn); // HOOK (combat.js): key 2, the mining laser replaces the blaster for this gunner
      else if (fireIn && !overheated && fireCD <= 0) {
        fire(); fireCD += 1 / w.rate; heat += w.heat * DF.heat;
        if (heat >= 1) { heat = 1; overheated = true; hud.event('overheat'); hud.popup('OVERHEAT', 0, -0.15, 'bad'); }
      }
      // chain: past the window it decays a step at a time instead of dropping to ×1
      comboT -= dt; if (comboT <= 0) { comboT = 0; if (combo > 1 && (chainDec += dt) >= DF.chainDecay) { chainDec = 0; combo--; } }
      roll = min(score, roll + max((score - roll) * (1 - exp(-dt * 5)), 900 * dt)); // the HUD score rolls up
    }
    if (mpRun) use(0);
    if (PU) pulseStep(pdt, input); // HOOK (pulse.js)

    // bolts: segment-vs-sphere against live targets
    for (let b = 0; b < NBOLT; b++) {
      if (BL[b] <= 0) continue;
      const x0 = BX[b * 3], y0 = BX[b * 3 + 1], z0 = BX[b * 3 + 2], mx = BV[b * 3] * dt, my = BV[b * 3 + 1] * dt, mz = BV[b * 3 + 2] * dt, mm = mx * mx + my * my + mz * mz;
      BX[b * 3] += mx; BX[b * 3 + 1] += my; BX[b * 3 + 2] += mz; BL[b] -= dt;
      for (let i = 0; i < nT; i++) {
        if (!TAL[i]) continue;
        const fx = x0 - TX[i], fy = y0 - TY[i], fz = z0 - TZ[i], R = TR[i] * 1.05 + BS[b];
        if (fx * fx + fy * fy + fz * fz > (R + 4) * (R + 4) + mm * 4) continue;
        const t = clamp(-(fx * mx + fy * my + fz * mz) / (mm || 1), 0, 1), cx = fx + mx * t, cy = fy + my * t, cz = fz + mz * t;
        if (cx * cx + cy * cy + cz * cz < R * R) { if (mpRun) use(BOW[b]); BL[b] = 0; boltHits++; damage(i, BD[b], x0 + mx * t, y0 + my * t, z0 + mz * t); break; }
      }
    }
    if (mpRun) { use(0); hud.player = -1; } // shared events (hull, shield, regen) show in every viewport
    if (turret || DST.indexOf(1, nD0) >= 0) stepDrifters(dt);
    // hull: flying into a live target
    for (let i = 0; i < nT; i++) {
      if (!TAL[i]) continue;
      const dx = cam[0] - TX[i], dy = cam[1] - TY[i], dz = cam[2] - TZ[i], R = TR[i] * 0.7 + 0.4;
      if (dx * dx + dy * dy + dz * dz < R * R) {
        if (shield) { shield = 0; destroy(i, false); shake = 0.4; if (fxOn()) FX.kick(0.3); hud.event('zap'); hud.popup('SHIELD ABSORBED', 0, -0.3, 'info'); continue; } // the arcade shield takes one hit
        hull -= i >= nD0 ? 1 : DF.rock; hull = max(DF.safe ? 1 : 0, hull); hits++; lastHit = i; regenT = 0;
        if (DF.safe) { if (mpRun) mpEach(() => { score = max(0, score - DF.hitCost); roll = min(roll, score); }); else { score = max(0, score - DF.hitCost); roll = min(roll, score); } }
        { const dx = TX[i] - cam[0], dy = TY[i] - cam[1], dz = TZ[i] - cam[2], hr = dx * CB[3] + dz * CB[5], hu = dx * CB[6] + dy * CB[7] + dz * CB[8], hl = hypot(hr, hu) || 1;
          hullFeedback(hr / hl * 0.7, hu / hl * 0.7, hits * 7919 + i * 31 + 1); } // the crack lands on the side the rock came from
        destroy(i, false); shake = 0.6; if (mpRun) mpEach(() => { combo = 1; comboT = 0; chainDec = 0; }); else { combo = 1; comboT = 0; chainDec = 0; } // the shared hull: a hit breaks every gunner's chain
        hud.event('damage'); hud.popup(DF.safe ? 'BUMP! · CHAIN LOST' : 'HULL −1 · CHAIN LOST', 0, -0.3, 'bad');
        if (hull <= 0) { finish(false); break; }
      }
    }
    // Easy: the hull refills (and the newest crack is patched) one point per DF.regen s without a hit
    if (DF.safe && hull < HULL_MAX && (regenT += dt) >= DF.regen) { regenT = 0; hull++; if (nCrack > 0 && nCrack < MAXC) { nCrack--; crackNext = nCrack; ovDirty = true; } hud.popup('SHIELDS RECHARGED', 0, -0.3, 'good'); }
    // crystals: drift, home in when near, collect for boost and score
    for (let c = 0; c < NCRY; c++) {
      if (CL[c] <= 0) continue;
      CL[c] -= dt; const dx = cam[0] - CX[c * 3], dy = cam[1] - CX[c * 3 + 1], dz = cam[2] - CX[c * 3 + 2], d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < 4.8) { if (mpRun) use(CO[c]); CL[c] = 0; crystalsGot++; hud.event('pickup'); boost = min(1, boost + 0.15); surge = max(surge, 0.5); addScore(50); addXP(5); project(CX[c * 3], CX[c * 3 + 1], CX[c * 3 + 2], PJ); hud.popup('+50 boost', PJ[0], PJ[1] - 0.05, 'info'); continue; }
      const damp = exp(-dt * 0.8);
      if (d2 < 81) { const d = sqrt(d2); CV[c * 3] += dx / d * 30 * dt; CV[c * 3 + 1] += dy / d * 30 * dt; CV[c * 3 + 2] += dz / d * 30 * dt; }
      else { CV[c * 3] *= damp; CV[c * 3 + 1] *= damp; CV[c * 3 + 2] *= damp; }
      CX[c * 3] += CV[c * 3] * dt; CX[c * 3 + 1] += CV[c * 3 + 1] * dt; CX[c * 3 + 2] += CV[c * 3 + 2] * dt;
    }
    if (mpRun) use(0);
    // sparks
    const drag = exp(-dt * 2.5);
    for (let i = 0; i < NSPARK; i++) { if (SL[i] <= 0) continue; SL[i] -= dt; SX[i * 3] += SV[i * 3] * dt; SX[i * 3 + 1] += SV[i * 3 + 1] * dt; SX[i * 3 + 2] += SV[i * 3 + 2] * dt; SV[i * 3] *= drag; SV[i * 3 + 1] *= drag; SV[i * 3 + 2] *= drag; }
    for (let i = 0; i < nT; i++) if (TFL[i] > 0) TFL[i] = max(0, TFL[i] - dt);

    if (!ended && s >= sGate) finish(true);
    if (!ended && s >= len) finish(true);
    writePools(dt);
  }

  function mpEach(fn) { for (let p = 0; p < NP; p++) { use(p); fn(); } use(0); hud.player = -1; }
  // turret autopilot (AUTO): the target offset is the line (0, 0) unless live rocks ahead (within AUTO.look s) would touch the hull
  // there. Candidates: the line, and 8 points around each such rock at its clearance; the smallest offset (nudged toward where
  // the ship already is) that clears every threat wins, clamped to the box. Drifters are ignored on purpose. No allocation.
  function autoDodge(dt) {
    let tx = 0, ty = 0;
    const dg = DF.dodge;
    if (AUTO.on && dg > 0) {
      const ahead = max(spd, SPEED) * AUTO.look * (0.4 + 0.6 * min(1, dg)), mg = AUTO.margin * dg, bx = BOX_X * AUTO.box, by = BOX_Y * AUTO.box; let n = 0;
      for (let i = 0; i < nD0 && n < ATH.length; i++) { if (!TAL[i]) continue; const da = TSA[i] - s; if (da > -1.5 && da < ahead) ATH[n++] = i; }
      if (n) {
        let bestS = 1e9, worst = -1e9, wx = 0, wy = 0;
        for (let c = -1; c < n * 8; c++) {
          let cx = 0, cy = 0;
          if (c >= 0) { const j = ATH[c >> 3], a = (c & 7) * PI / 4, cl = TR[j] * 0.7 + 0.4 + mg; cx = clamp(TOU[j] + cos(a) * cl, -bx, bx); cy = clamp(TOV[j] + sin(a) * cl, -by, by); }
          let minC = 1e9; // worst clearance of this candidate over all threats (≥ 0 clears)
          for (let q = 0; q < n; q++) { const j = ATH[q]; minC = min(minC, hypot(cx - TOU[j], cy - TOV[j]) - (TR[j] * 0.7 + 0.4 + mg * 0.85)); }
          if (minC >= 0) { const sc = hypot(cx, cy) + 0.35 * hypot(cx - ox, cy - oy); if (sc < bestS) { bestS = sc; tx = cx; ty = cy; } }
          else if (bestS === 1e9 && minC > worst) { worst = minC; wx = cx; wy = cy; }
          if (c === -1 && minC >= 0) break; // the line itself is clear
        }
        if (bestS === 1e9) { tx = wx; ty = wy; } // boxed in: the least-bad spot
      }
    }
    const k = 1 - exp(-dt * (AUTO.on && dg > 0 ? AUTO.rate * min(1.3, dg) : 3.2));
    ox += (tx - ox) * k; oy += (ty - oy) * k;
  }

  // drifters: spawn when the ship reaches their rail distance (turret only), fly (rammers steer toward the ship), expire
  function stepDrifters(dt) {
    for (let i = nD0; i < nT; i++) {
      if (DST[i] === 0) { if (turret && !ended && DUSE[i - nD0] && s >= TSP[i] && s < TSP[i] + 30) { DST[i] = 1; DAGE[i] = 0; showTarget(i, true); } continue; }
      if (DST[i] !== 1) continue;
      if (!TAL[i] || (DAGE[i] += dt) > DLIFE[i]) { if (TAL[i]) showTarget(i, false); DST[i] = 2; continue; }
      if (DRAM[i]) { // homing: turn the velocity toward the ship at the same speed
        const dx = cam[0] - TX[i], dy = cam[1] - TY[i], dz = cam[2] - TZ[i], dl = hypot(dx, dy, dz) || 1, v = max(hypot(TVX[i], TVY[i], TVZ[i]), spd + DF.homeAdd), kk = 1 - exp(-dt * DF.homeTurn);
        TVX[i] += (dx / dl * v - TVX[i]) * kk; TVY[i] += (dy / dl * v - TVY[i]) * kk; TVZ[i] += (dz / dl * v - TVZ[i]) * kk;
      }
      TX[i] += TVX[i] * dt; TY[i] += TVY[i] * dt; TZ[i] += TVZ[i] * dt;
      const I = vars[TVAR[i]].inst, o = TSLOT[i] * 12; I[o] = TX[i]; I[o + 1] = TY[i]; I[o + 2] = TZ[i]; vars[TVAR[i]].dirty = true;
    }
  }

  function writePools(dt) {
    if (!P) return;
    if (WH) WH.frame(dt, s, eye, started && !intro.active);
    // glint flash on hit (drifters carry their glints along)
    for (let i = 0; i < nT; i++) {
      if (!TAL[i]) continue; const f = 1 + TFL[i] * 30;
      for (let g = 0; g < NG; g++) { const j = i * NG + g, o = (GL0 + j) * 8; P[o + 4] = GBASE[j * 8 + 4] * f; P[o + 5] = GBASE[j * 8 + 5] * f; P[o + 6] = GBASE[j * 8 + 6] * f;
        if (i >= nD0) { P[o] = GBASE[j * 8] + TX[i] - TX0[i]; P[o + 1] = GBASE[j * 8 + 1] + TY[i] - TY0[i]; P[o + 2] = GBASE[j * 8 + 2] + TZ[i] - TZ0[i]; } }
    }
    // bolts: a short bright streak of three points trailing back along the motion
    for (let b = 0; b < NBOLT; b++) {
      const on = BL[b] > 0, vl = hypot(BV[b * 3], BV[b * 3 + 1], BV[b * 3 + 2]) || 1;
      for (let k = 0; k < 3; k++) {
        const back = k * 0.7 / vl, sz = on ? BS[b] * (1 - k * 0.25) : 0;
        const pc = BOW[b], q = PBOLT[pc], fk = 1 - k * 0.17; // each player's bolts in their colour (P1: the 1-player amber, unchanged)
        if (pc === 0) setPt(BO0 + b * 3 + k, BX[b * 3] - BV[b * 3] * back, BX[b * 3 + 1] - BV[b * 3 + 1] * back, BX[b * 3 + 2] - BV[b * 3 + 2] * back, sz, 6 - k, 2.6 - k * 0.6, 0.7, 0);
        else setPt(BO0 + b * 3 + k, BX[b * 3] - BV[b * 3] * back, BX[b * 3 + 1] - BV[b * 3 + 1] * back, BX[b * 3 + 2] - BV[b * 3 + 2] * back, sz, q[0] * fk, q[1] * fk, q[2] * fk, 0);
      }
    }
    for (let i = 0; i < NSPARK; i++) {
      const c = SL[i] > 0 ? SL[i] / SL0[i] : 0;
      setPt(SP0 + i, SX[i * 3], SX[i * 3 + 1], SX[i * 3 + 2], c > 0 ? SS[i] * (0.4 + 0.6 * c) : 0, (4.5 * c + 0.4) * c, (1.9 * c * c + 0.1) * c, 0.5 * c * c * c, 0);
    }
    for (let c = 0; c < NCRY; c++) {
      const a = CL[c] > 0 ? min(1, CL[c] / 1.5) : 0;
      setPt(CR0 + c, CX[c * 3], CX[c * 3 + 1], CX[c * 3 + 2], a > 0 ? 0.22 : 0, 0.5 * a, 3.2 * a, 1.4 * a, 1);
    }
    // Ring Gate beacons: a chase that quickens as you approach
    const dg = hypot(gate[0] - cam[0], gate[1] - cam[1], gate[2] - cam[2]), rate = 0.6 + 3.5 * (1 - clamp(dg / 250, 0, 1)), t = F ? F[8] : 0;
    for (let i = 0; i < NBEACON; i++) {
      const ph = (t * rate - i / NBEACON) % 1, on = (ph < 0 ? ph + 1 : ph) < 0.22 ? 1 : 0.12;
      setPt(BC0 + i, BCP[i * 3], BCP[i * 3 + 1], BCP[i * 3 + 2], 0.35, 5 * on, 2.2 * on, 0.4 * on, 0);
    }
  }

  // ---------------------------------------------------------------- start sequence (INTRO table above; INTRO.md)
  // Frame 0 at intro.t = 0, then on Soaring Melody's beat grid (titlefx.js): the title slam (first run of a visit, `title on`), the
  // HUD booting through 3 2 1, and GO on a bar downbeat, when control and the run timer start. Start plays the song from 0, so GO
  // lands on beat 8 (3.53 s). The clock is the song's playhead (Shell.musicClock); off the music (blocked, a Settings track, music
  // off) the same plan runs on wall time. hud.event('countdown') per number and hud.event('go') feed the sound board (silent by
  // default: GAME.sfxOnly). A fresh fire press, Enter or Esc skips straight to GO.
  const BEAT = TFX ? TFX.P : 60 / 138.04;
  // times on the intro clock in s from Frame 0; a = the song time at clock 0 (0 until anchored to the playhead)
  const cd = { t: 0, a: 0, anc: false, slamOn: false, slam: -1, count: 0, go: 0, hud0: 0, hud1: 1, n: -1, post: -1, mp: false, skip: false, fireHeld: true, cv: null, g: null, dirty: false };
  function cdPlan(pd) { // pd: the clock time at Frame 0 (the INTRO.pre hook's length)
    const off = cd.a + pd, p = TFX ? TFX.plan(off, cd.slamOn, INTRO.lead) : null;
    if (p) { cd.slam = p.slam >= 0 ? p.slam - off : -1; cd.count = p.count - off; cd.go = p.go - off; }
    else { cd.slam = -1; cd.count = INTRO.lead + BEAT; cd.go = cd.count + 3 * BEAT; }
    cd.hud0 = max(INTRO.hudStart, cd.count - BEAT * INTRO.hudLead); cd.hud1 = max(cd.hud0 + 0.3, cd.go - BEAT * 0.5);
  }
  function cdClock(t, dt, pd) { // advances an intro clock on the song; it anchors to the playhead once, if the music runs before anything shows
    const mc = shell && shell.musicClock ? shell.musicClock() : -1;
    if (!cd.anc && mc >= 0 && t - pd < (cd.slam >= 0 ? cd.slam : cd.count) - 0.2) { cd.anc = true; cd.a = mc - t; cdPlan(pd); }
    if (cd.anc && mc >= 0 && mc - cd.a > t - 0.05 && mc - cd.a < t + 30) return max(t, mc - cd.a); // catches up after stalled frames; a loop or seek falls back to wall time
    return t + dt;
  }
  function cdCanvas() {
    if (cd.cv || typeof document === 'undefined') return !!cd.cv;
    const c = document.createElement('canvas'); c.id = 'rrcount'; c.setAttribute('aria-hidden', 'true');
    c.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:8;pointer-events:none;display:none;filter:none;opacity:1;transition:none';
    document.body.appendChild(c); cd.cv = c; cd.g = c.getContext('2d'); return true;
  }
  function cdPaint(tl) { // the slam, the numbers and GO at tl s after Frame 0, over the live view (and the HUD)
    if (!TFX || !cdCanvas()) return;
    const c = cd.cv, dpr = min(2, devicePixelRatio || 1), w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    cd.g.clearRect(0, 0, w, h); c.style.display = ''; cd.dirty = true;
    if (cd.slam >= 0) TFX.slam(cd.g, w, h, fxStyle, tl - cd.slam);
    for (let n = 3; n >= 0; n--) TFX.count(cd.g, w, h, fxStyle, n, tl - (cd.go - n * BEAT));
  }
  function cdClear() { if (cd.cv && cd.dirty) { cd.g.clearRect(0, 0, cd.cv.width, cd.cv.height); cd.cv.style.display = 'none'; cd.dirty = false; } }
  function cdEvents(tl) { // the sound-board hooks, once each: 'countdown' on 3, 2 and 1, 'go' on GO
    const i = tl < cd.count - 1e-3 ? -1 : min(3, Math.floor((tl - cd.count) / BEAT + 1e-6));
    while (cd.n < i) { cd.n++; hud.event(cd.n < 3 ? 'countdown' : 'go'); }
  }
  function introBegin() {
    fxRoll();
    intro.active = intro.on || FRAME0; intro.frozen = FRAME0; intro.t = 0; intro.shown0 = false; intro.fireHeld = true; intro.skipped = false;
    intro.shield = 0; intro.power = intro.active ? 0 : 1; intro.phase = intro.active ? 'frame0' : 'run';
    if (hud) { hud.power = intro.power; hud.clock = !intro.active; hud.glitch = 0; }
    if (intro.active) spd = SPEED * INTRO.speed0;
    cd.slamOn = title.on && !title.done && !FRAME0 && !IS_SHOT; cd.anc = false; cd.a = 0; cd.n = -1; cd.post = -1; cd.mp = false; cd.skip = false;
    cdPlan(preDur()); cdClear();
  }
  function introEnd(skipped) { // control: on GO, or a skip straight to GO
    intro.active = false; intro.skipped = skipped; intro.shield = 0; intro.power = 1; intro.phase = 'run';
    hud.power = 1; hud.clock = true; if (skipped) spd = SPEED;
    const c = document.getElementById('c'); if (c) c.style.transition = '';
    if (skipped) { cd.go = intro.t - preDur(); cd.slam = -1; } // GO! plays from now
    if (cd.n < 3) { cd.n = 3; hud.event('go'); }
    cd.post = TFX && !FRAME0 ? 0 : -1; if (cd.post < 0) cdClear(); else cdPaint(cd.go);
  }
  function introStep(dt, input) {
    const pd = preDur();
    if (!intro.frozen) { if (!intro.shown0) intro.shown0 = true; else { intro.t = cdClock(intro.t, dt, pd); if (cd.slamOn) title.done = true; } } // the run's first frame is Frame 0 at t = 0
    if (intro.t === 0 && typeof document !== 'undefined') { const c = document.getElementById('c'); if (c) c.style.transition = 'none'; } // no menu un-blur behind Frame 0
    else intro.shown0 = true;
    const f = !!input.gunner.fire;
    if (!intro.frozen && f && !intro.fireHeld && intro.t >= INTRO.skipAfter) { intro.fireHeld = f; introEnd(true); placeCamera(0, input); writePools(0); return; }
    intro.fireHeld = f;
    const tl = intro.t - pd, cockpit = FRAME0 || !shell || shell.view !== 'shoulder';
    intro.shield = INTRO.shield && cockpit ? 1 - smooth(tl, INTRO.shieldStart, INTRO.shieldEnd) : 0; // disabled hook (always 0)
    intro.power = clamp((tl - cd.hud0) / (cd.hud1 - cd.hud0), 0, 1);
    intro.phase = tl < 0 ? 'pre' : tl < (cd.slam >= 0 ? cd.slam : cd.count) - 0.1 ? 'frame0' : cd.slam >= 0 && tl < cd.count - 0.1 ? 'title' : 'count';
    hud.power = intro.power; hud.clock = false; hud.glitch = 0;
    // the ship eases up to cruise speed by GO (Frame 0 itself never moves)
    if (tl > 0 && dt > 0) { spd = SPEED * mix(INTRO.speed0, 1, smooth(tl, 0, cd.go)); s += spd * dt; }
    if (F) F[8] = INTRO.time0 + max(0, tl); // the scene clock is part of Frame 0 (and runs on from it)
    placeCamera(tl > 0 ? dt : 0, input);
    if (tl < 0) { let a = 0; for (const g of INTRO.pre) { if (intro.t < a + g.dur) { g.step(intro.t - a, F); break; } a += g.dur; } } // HOOK (empty)
    writePools(0);
    if (tl > 0) { if (!intro.frozen) cdEvents(tl); cdPaint(tl); } // nothing is drawn over Frame 0 itself
    if (!intro.frozen && tl >= cd.go) introEnd(false);
  }
  // split screen: no Frame 0 or slam; the HUD boots through 3 2 1 on the beat and play starts on GO (any gunner's fire skips to GO)
  function mpCount(dt, input) {
    cd.t = cdClock(cd.t, dt, 0);
    let f = false; for (let p = 0; p < NP; p++) { const q = input.mp.p[p]; f = f || (!q.bot && !!q.fire); }
    const skip = cd.skip || (f && !cd.fireHeld && cd.t >= INTRO.skipAfter); cd.fireHeld = f;
    mpBoot = clamp((cd.t - cd.hud0) / (cd.hud1 - cd.hud0), 0, 1); hud.power = mpBoot; hud.clock = false;
    if (skip || cd.t >= cd.go) {
      if (cd.t < cd.go) cd.go = cd.t;
      cd.mp = false; cd.skip = false; mpBoot = 1; hud.power = 1; hud.clock = true;
      if (cd.n < 3) { cd.n = 3; hud.event('go'); }
      cd.post = TFX ? 0 : -1; if (cd.post >= 0) cdPaint(cd.go); return false;
    }
    if (cd.t > 0) { cdEvents(cd.t); cdPaint(cd.t); }
    return true;
  }

  // ---------------------------------------------------------------- cockpit overlay: windshield cracks (RI-4.0), pain vignette
  // A 2D canvas between the 3D view (and FX) and the HUD. Cracks are on the glass, so they show in cockpit view only (they fade
  // with the view blend); the red vignette, HUD glitch and low-hull warning show in both views.
  const MAXC = 6, MAXS = 960, NCHP = 26, CHP = new Float32Array(MAXC * NCHP * 4), CSG = new Float32Array(MAXC * MAXS * 6), CN = new Int16Array(MAXC), CCX = new Float32Array(MAXC), CCY = new Float32Array(MAXC);
  const CAGE = new Float32Array(MAXC), CRAD = new Float32Array(MAXC);
  let regenT = 0, lastHit = -1, nCrack = 0, crackNext = 0, hits = 0, hitPulse = 0, glitchT = 0, fdt = 0;
  let ov = null, ovc = null, vigHit = null, vigLow = null, warn = null, ovW = 0, ovH = 0, ovDirty = true, ovShown = false, ovShield = -1, ovOp = -1, vigO = -1, lowOn = false;
  let rs = 1; // mulberry32: cracks and shutter detail get their own seeded stream, so they never disturb the game's rnd()
  const r32 = () => { rs = (rs + 0x6D2B79F5) | 0; let t = Math.imul(rs ^ (rs >>> 15), 1 | rs); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const lowHP = () => !ended && HULL_MAX > 1 && hull > 0 && hull <= 1;

  // a hull hit: crack at a point biased toward the hit direction (nx, ny in -1..1 screen units), red pulse, kick and HUD glitch
  function hullFeedback(nx, ny, seed) {
    rs = seed >>> 0;
    const c = crackNext; crackNext = (crackNext + 1) % MAXC; nCrack = min(MAXC, nCrack + 1); // past six, the oldest crack is replaced
    CCX[c] = clamp(nx * 0.65 + (r32() - 0.5) * 0.55, -0.85, 0.85); CCY[c] = clamp(ny * 0.65 + (r32() - 0.5) * 0.5, -0.8, 0.8);
    CRAD[c] = genCrack(c); CAGE[c] = 0; ovDirty = true;
    hitPulse = 1; glitchT = 0.45;
    if (fxOn()) FX.kick(0.5);
  }
  // one impact star (deterministic from rs), drawn to the RI-4.0 rules (concept/reef-intro/DECOMPOSITION.md, C-rules):
  // a small white glint over a frosted, dense shattered core of short jagged shards and dark chips; 24-32 fine, wandering radial
  // cracks whose lengths fall in four classes (a few run long, mostly toward one side); sparse shallow forks; a few doubled
  // lines; no rings. Segments: x0 y0 x1 y1 in screen-height units around the impact, distance from the core (for the spread),
  // weight (0..1 taper; +2 marks a glint segment that catches the light).
  function genCrack(c) {
    const o0 = c * MAXS; let n = 0, far = 0.05;
    const seg = (x0, y0, x1, y1, w) => { if (n >= MAXS) return; const o = (o0 + n++) * 6; CSG[o] = x0; CSG[o + 1] = y0; CSG[o + 2] = x1; CSG[o + 3] = y1; CSG[o + 4] = hypot(x0, y0); CSG[o + 5] = w; far = max(far, hypot(x1, y1)); };
    for (let k = 0; k < 40; k++) { // the shattered core: short jagged two-part shards in every direction
      const a = r32() * TAU, r0 = 0.003 + r32() * 0.014, r1 = 0.014 + r32() * r32() * 0.06, rm = (r0 + r1) * 0.5, b = a + (r32() - 0.5) * 0.5, e = a + (r32() - 0.5) * 0.3, w = 0.2 + r32() * 0.45;
      seg(cos(a) * r0, sin(a) * r0, cos(b) * rm, sin(b) * rm, w + (r32() < 0.12 ? 2 : 0)); seg(cos(b) * rm, sin(b) * rm, cos(e) * r1, sin(e) * r1, w * 0.7); }
    for (let k = 0; k < NCHP; k++) { const o = (c * NCHP + k) * 4; CHP[o] = r32() * TAU; CHP[o + 1] = 0.004 + r32() * 0.014; CHP[o + 2] = 0.02 + r32() * 0.05; CHP[o + 3] = 0.03 + r32() * 0.1; } // glass slivers (odd: dark chips, even: refracting light): angle, r0, r1, half-width (rad)
    const rays = 24 + ((r32() * 9) | 0), bias = r32() * TAU;
    for (let k = 0; k < rays; k++) {
      let a = ((k + (r32() - 0.5) * 0.7) / rays) * TAU; const r0 = 0.004 + r32() * 0.016; let x = cos(a) * r0, y = sin(a) * r0; // rays start at the edge of the core, not all at one point
      const fav = 0.5 + 0.5 * cos(a - bias), u = r32();
      const L = u < 0.45 ? 0.05 + r32() * 0.06 : u < 0.8 ? 0.12 + r32() * 0.1 : u < 1 - 0.12 * fav ? 0.25 + r32() * 0.15 : 0.5 + r32() * 0.3;
      const steps = clamp(Math.round(L / 0.026), 3, 22), st = L / steps, fork = L > 0.12 && r32() < 0.4 ? 1 + ((r32() * (steps - 1)) | 0) : -1, dbl = L > 0.1 && r32() < 0.25;
      for (let j = 0; j < steps; j++) {
        a += (r32() - 0.5) * 0.2 + (r32() < 0.14 ? (r32() - 0.5) * 0.6 : 0); // a little wander, and the odd kink
        const l = st * (0.8 + r32() * 0.4), nx = x + cos(a) * l, ny = y + sin(a) * l, w = (1 - j / steps) * (0.35 + 0.65 * r32()); // brightness varies along the crack
        seg(x, y, nx, ny, w + (r32() < 0.12 ? 2 : 0));
        if (dbl && j < steps * 0.5) { const px = -sin(a) * 0.0035, py = cos(a) * 0.0035; seg(x + px, y + py, nx + px, ny + py, w * 0.5); }
        if (j === fork) {
          let b = a + (r32() < 0.5 ? -1 : 1) * (0.17 + r32() * 0.23), bx = nx, by = ny; const bl = (L - st * (j + 1)) * (0.3 + r32() * 0.2), bs = max(1, Math.round(bl / 0.035));
          for (let q = 0; q < bs; q++) { b += (r32() - 0.5) * 0.1; const ex = bx + cos(b) * bl / bs, ey = by + sin(b) * bl / bs; seg(bx, by, ex, ey, w * 0.6 * (1 - q / bs)); bx = ex; by = ey; }
        }
        x = nx; y = ny;
      }
    }
    CN[c] = n; return far;
  }
  function drawCracks(g, w, h) {
    const k = h / 816;
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (let i = 0; i < nCrack; i++) {
      const X = (CCX[i] * 0.5 + 0.5) * w, Y = (0.5 - CCY[i] * 0.5) * h, sp = min(1, CAGE[i] / 0.16), rev = sp * CRAD[i] + 1e-4, o0 = i * MAXS;
      // dark chips in the shattered core
      // frosted core, then dark chips in it
      let gr = g.createRadialGradient(X, Y, 0, X, Y, 0.055 * h * sp + 1); gr.addColorStop(0, 'rgba(210,245,238,0.22)'); gr.addColorStop(0.6, 'rgba(190,235,228,0.08)'); gr.addColorStop(1, 'rgba(190,235,228,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(X, Y, 0.055 * h * sp + 1, 0, TAU); g.fill();
      for (let q = 0; q < NCHP; q++) { const o = (i * NCHP + q) * 4, a = CHP[o], r0 = CHP[o + 1] * h, r1 = CHP[o + 2] * h * sp, hw = CHP[o + 3];
        g.fillStyle = q & 1 ? 'rgba(6,26,28,0.3)' : q % 4 ? 'rgba(170,236,226,0.4)' : 'rgba(225,255,250,0.5)'; g.beginPath(); g.moveTo(X + cos(a - hw) * r0, Y - sin(a - hw) * r0); g.lineTo(X + cos(a) * r1, Y - sin(a) * r1); g.lineTo(X + cos(a + hw) * r0, Y - sin(a + hw) * r0); g.fill(); }
      // pass 0: the dark refraction edge, offset a hair; pass 1: the bright cyan-white line, in three weight buckets
      for (let pass = 0; pass < 2; pass++) {
        const dx = pass ? 0 : 0.8 * k;
        for (let b = 0; b < 3; b++) {
          g.strokeStyle = pass ? (b === 2 ? 'rgba(226,255,250,0.78)' : b === 1 ? 'rgba(184,242,234,0.62)' : 'rgba(140,222,214,0.5)') : 'rgba(0,22,24,0.34)';
          g.lineWidth = (pass ? 0.45 + b * 0.35 : 0.8 + b * 0.4) * k; g.beginPath();
          for (let q = 0; q < CN[i]; q++) {
            const o = (o0 + q) * 6, wt = CSG[o + 5] % 2, wb = wt > 0.66 ? 2 : wt > 0.33 ? 1 : 0;
            if (wb !== b || CSG[o + 4] > rev) continue;
            g.moveTo(X + CSG[o] * h + dx, Y - CSG[o + 1] * h + dx); g.lineTo(X + CSG[o + 2] * h + dx, Y - CSG[o + 3] * h + dx);
          }
          g.stroke();
        }
      }
      // glints: a few segments catch the light
      g.globalCompositeOperation = 'lighter'; g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 1.8 * k; g.beginPath();
      for (let q = 0; q < CN[i]; q++) { const o = (o0 + q) * 6; if (CSG[o + 5] < 2 || CSG[o + 4] > rev) continue; g.moveTo(X + CSG[o] * h, Y - CSG[o + 1] * h); g.lineTo(X + CSG[o + 2] * h, Y - CSG[o + 3] * h); }
      g.stroke();
      // the impact glint: a white point with a soft cyan halo
      gr = g.createRadialGradient(X, Y, 0, X, Y, 0.018 * h); gr.addColorStop(0, 'rgba(255,255,255,0.8)'); gr.addColorStop(0.2, 'rgba(225,255,248,0.35)'); gr.addColorStop(1, 'rgba(160,240,230,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(X, Y, 0.018 * h, 0, TAU); g.fill(); g.globalCompositeOperation = 'source-over';
    }
  }
  // paints the overlay for one frame into g (w × h): the windshield cracks (the blast shield is gone; INTRO.shield hook)
  function paintOverlay(g, w, h, cracks) {
    if (!(cracks && nCrack)) return;
    if (mpRun && G.views.n > 1 && shell && shell.mp) { // split screen: every gunner's glass cracks, each clipped to its viewport
      for (let v = 0; v < G.views.n; v++) { const m = shell.mp.views[v], x = m.x * w, y = m.y * h, rw = m.w * w, rh = m.h * h; g.save(); g.beginPath(); g.rect(x, y, rw, rh); g.clip(); g.translate(x, y); drawCracks(g, rw, rh); g.restore(); }
      return;
    }
    drawCracks(g, w, h);
  }
  function buildOverlay() {
    const st = document.createElement('style');
    st.textContent = `#rrcock,#rrvh,#rrvl{position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:5;filter:none;transition:none}
#rrvh,#rrvl{opacity:0;background:radial-gradient(ellipse at center,rgba(255,30,20,0) 52%,rgba(255,30,20,.35) 82%,rgba(200,0,0,.75) 100%)}
#rrvl{display:none;animation:rrlow 1.1s ease-in-out infinite}@keyframes rrlow{0%,100%{opacity:.2}50%{opacity:.42}}
#rrwarn{position:fixed;left:0;right:0;top:15%;z-index:7;display:none;text-align:center;pointer-events:none;font:700 18px ui-monospace,Menlo,monospace;letter-spacing:.3em;color:#ff5a4f;text-shadow:0 0 10px rgba(255,40,30,.7),0 1px 2px #000;animation:rrblink 1.1s steps(2,jump-none) infinite}
@keyframes rrblink{50%{opacity:.25}}
#rrwarn.calm{color:#8fe9ff;text-shadow:0 0 10px rgba(80,200,255,.6),0 1px 2px #000;animation:none}`;
    document.head.appendChild(st);
    ov = document.createElement('canvas'); ov.id = 'rrcock'; document.body.appendChild(ov); ovc = ov.getContext('2d');
    vigHit = document.createElement('div'); vigHit.id = 'rrvh'; document.body.appendChild(vigHit);
    vigLow = document.createElement('div'); vigLow.id = 'rrvl'; document.body.appendChild(vigLow);
    warn = document.createElement('div'); warn.id = 'rrwarn'; warn.textContent = 'HULL CRITICAL'; document.body.appendChild(warn);
  }
  function cockpitFrame(view) {
    if (!ov) buildOverlay();
    const dt = fdt;
    // damage: crack spread, red pulse, HUD glitch, low-hull state
    let anim = false;
    for (let i = 0; i < nCrack; i++) if (CAGE[i] < 0.2) { CAGE[i] += dt; anim = true; }
    hitPulse = max(0, hitPulse - dt / 0.7); glitchT = max(0, glitchT - dt);
    if (!intro.active) hud.glitch = glitchT / 0.45;
    const vo = Math.round(hitPulse * hitPulse * 85) / 100; if (vo !== vigO) { vigO = vo; vigHit.style.opacity = vo; }
    const low = lowHP() && !intro.active; if (low !== lowOn) { lowOn = low; // Easy: no scare, a gentle "Shields holding!" and no red pulse
      warn.textContent = DF.safe ? 'SHIELDS HOLDING!' : 'HULL CRITICAL'; warn.className = DF.safe ? 'calm' : '';
      warn.style.display = low ? 'block' : 'none'; vigLow.style.display = low && !DF.safe ? 'block' : 'none'; }
    // the glass layer fades with the view blend (cockpit only)
    const op = Math.round((1 - ve) * 100) / 100; if (op !== ovOp) { ovOp = op; ov.style.opacity = op; }
    const dpr = min(2, devicePixelRatio || 1), w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
    if (w !== ovW || h !== ovH) { ov.width = ovW = w; ov.height = ovH = h; ovDirty = true; ovShown = false; }
    const want = (intro.shield > 0 || nCrack > 0) && !FRAME0_BARE;
    if (!want) { if (ovShown) { ovc.clearRect(0, 0, w, h); ovShown = false; } ovShield = -1; return; }
    if (!ovDirty && !anim && intro.shield === ovShield) return;
    ovDirty = false; ovShield = intro.shield; ovShown = true;
    ovc.setTransform(1, 0, 0, 1, 0, 0); ovc.clearRect(0, 0, w, h); paintOverlay(ovc, w, h, true);
    void view;
  }

  // ---------------------------------------------------------------- arcade: score, extra hull / shield, chain HUD, tally, high scores
  function addScore(n) {
    score += round(n * DF.score);
    const team = mpRun ? teamScore() : score, hp = hud.player; // split screen: extra hull and shield come from the team total
    while (extraNext < ARCADE.extra.length && team >= ARCADE.extra[extraNext]) {
      extraNext++; if (mpRun) hud.player = -1;
      if (hull < HULL_MAX && !ended) { // an extra life: +1 hull, and the newest windshield crack is patched
        hull++; if (nCrack > 0 && nCrack < MAXC) { nCrack--; crackNext = nCrack; ovDirty = true; }
        hud.popup('EXTRA HULL!', 0, 0.22, 'big'); hud.event('levelup');
      } else if (!shield && !ended) { shield = 1; hud.popup('SHIELD UP!', 0, 0.22, 'big'); hud.event('rescue'); }
      hud.player = hp;
    }
  }
  // the chain, big, right of centre: ×N, a draining window bar, and the shield badge. Write-if-changed (no per-frame DOM churn).
  let chEl = null, chN = null, chBar = null, chSh = null, chLast = -1, chW = -1, chO = '', chShOn = -1;
  function chainHud() {
    if (!chEl) {
      const st = document.createElement('style');
      st.textContent = `#rrchain{position:fixed;right:max(16px,7vw);top:30%;z-index:6;pointer-events:none;text-align:right;font:800 15px var(--fd,ui-monospace,Menlo,monospace);letter-spacing:.14em;color:var(--h);text-shadow:0 0 12px rgba(0,0,0,.8),0 1px 2px #000}
#rrchain b{display:block;font-size:64px;line-height:1;letter-spacing:0;color:var(--s);transform-origin:100% 50%}#rrchain b.up{animation:rrpop .32s ease-out}
#rrchain i{display:block;height:5px;margin-top:6px;background:var(--h);transform-origin:100% 50%;box-shadow:0 0 8px var(--h)}#rrchain em{display:block;margin-top:8px;font-style:normal;color:var(--a)}
@keyframes rrpop{0%{transform:scale(1.6)}100%{transform:scale(1)}}@media (prefers-reduced-motion:reduce){#rrchain b.up{animation:none}}`;
      document.head.appendChild(st);
      chEl = document.createElement('div'); chEl.id = 'rrchain'; chEl.className = 'sgjolt'; chEl.innerHTML = '<b>×1</b>CHAIN<i></i><em>SHIELD</em>';
      (document.getElementById('sgr') || document.body).appendChild(chEl);
      chN = chEl.firstChild; chBar = chEl.querySelector('i'); chSh = chEl.querySelector('em');
    }
    const on = started && !ended && shell && shell.state === 'run' && shell.settings.layers.score && !mpRun, p = hud.power ?? 1; // split screen: each viewport shows its own chain
    const o = !on ? '0' : ((combo > 1 ? 1 : 0.35) * p * p).toFixed(2);
    if (o !== chO) { chO = o; chEl.style.opacity = o; }
    if (!on) return;
    if (combo !== chLast) { chN.textContent = '×' + combo; if (combo > chLast && combo > 1) { chN.classList.remove('up'); void chN.offsetWidth; chN.classList.add('up'); } chLast = combo; }
    const w = combo > 1 ? Math.round((comboT > 0 ? comboT / COMBO_TIME : 0) * 50) / 50 : 0; if (w !== chW) { chW = w; chBar.style.transform = `scaleX(${w})`; }
    if (shield !== chShOn) { chShOn = shield; chSh.style.display = shield ? '' : 'none'; }
  }

  // ---- end of run: rows count up one at a time (a coin tick per step), then NEW HIGH SCORE + initials, then the table,
  // then the shell's results screen (Play again). Fire / Enter / Esc fast-forwards the count; keys or a pad enter initials.
  const SCORE_BASE = 'sg-shell:reef-run:scores'; // medium keeps the original table; the other levels each have their own
  let SCORE_KEY = SCORE_BASE; const scoreKey = () => (SCORE_KEY = diffKey === 'medium' ? SCORE_BASE : SCORE_BASE + ':' + diffKey);
  const tally = { active: false, phase: 'off', gate: false, row: 0, t: 0, tick: 0, rows: [], total: 0, rank: -1, slot: 0, ini: [0, 0, 0], fireHeld: true, rep: 0, repDir: 0, wait: 0, table: null };
  let tEl = null, tRows = null, tHi = null, tIni = null, tTab = null, tFoot = null, tTitle = null;
  // shared high scores (carpetshark: "make high scores persistent"): on the site, /api/scores keeps one world table per
  // difficulty (site/api/scores.js). The game shows the world table merged with this browser's own; offline, or when the
  // page is opened anywhere without that API, it is the local table only, as before.
  const NET = { on: location.protocol.startsWith('http'), top: {}, busy: {} };
  function netFetch(d = diffKey) {
    if (!NET.on || NET.busy[d]) return; NET.busy[d] = true;
    fetch('api/scores?d=' + d, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (j && Array.isArray(j.top)) NET.top[d] = j.top; })
      .catch(() => {}).finally(() => { NET.busy[d] = false; });
  }
  function netPost(n, s) {
    if (!NET.on || !(s >= 1)) return; const d = diffKey;
    fetch('api/scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ d, n, s: Math.round(s) }) })
      .then((r) => (r.ok ? r.json() : null)).then((j) => { if (j && Array.isArray(j.top)) NET.top[d] = j.top; }).catch(() => {});
  }
  netFetch();
  const okRow = (e) => e && typeof e.s === 'number' && typeof e.n === 'string';
  function localScores() { scoreKey(); try { const a = JSON.parse(localStorage.getItem(SCORE_KEY) || '[]'); return Array.isArray(a) ? a.filter(okRow) : []; } catch { return []; } }
  function loadScores() {
    const seen = new Set(), out = [];
    for (const e of [...localScores(), ...(NET.top[diffKey] || []).filter(okRow)]) { const k = e.n + '|' + Math.round(e.s); if (!seen.has(k)) { seen.add(k); out.push({ n: e.n, s: e.s, t: e.t || 0 }); } }
    return out.sort((a, b) => b.s - a.s).slice(0, ARCADE.table);
  }
  function saveScores(a) { scoreKey(); try { localStorage.setItem(SCORE_KEY, JSON.stringify(a.slice(0, ARCADE.table))); } catch {} }
  const fmt = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  function tallyBuild() {
    const st = document.createElement('style');
    st.textContent = `#rrtally{position:fixed;inset:0;z-index:21;display:none;place-items:center;padding:16px;pointer-events:none;font:600 16px var(--fn,ui-monospace,Menlo,monospace);color:#eef4f8}
#rrtally>div{min-width:min(400px,100%);max-width:480px;max-height:100%;overflow:auto;box-sizing:border-box;background:rgba(6,10,16,.9);border:2px solid var(--h);border-radius:14px;padding:16px 20px;box-shadow:0 0 50px rgba(0,0,0,.65)}
#rrtally h2{margin:0 0 10px;font:800 24px var(--fd,ui-monospace,Menlo,monospace);color:var(--h);letter-spacing:.06em;text-transform:uppercase}
#rrtally .r{display:flex;gap:10px;align-items:baseline;padding:3px 0;opacity:.18}#rrtally .r.on{opacity:1}#rrtally .r span{flex:1;color:#9fb2c0}#rrtally .r b{min-width:5ch;text-align:right}#rrtally .r em{min-width:8ch;text-align:right;font-style:normal;color:var(--a)}
#rrtally .r.tot{margin-top:6px;padding-top:8px;border-top:1px solid #2a3b4a;font-size:22px}#rrtally .r.tot b{color:var(--h)}
#rrtally .hi{display:none;margin:12px 0 4px;text-align:center;font:800 26px var(--fd,ui-monospace,Menlo,monospace);color:var(--s);letter-spacing:.1em;animation:rrhi .5s steps(2,jump-none) infinite}@keyframes rrhi{50%{color:var(--h);opacity:.55}}
#rrtally .ini{display:none;justify-content:center;gap:10px;margin:6px 0}#rrtally .ini i{font:800 34px var(--fd,ui-monospace,Menlo,monospace);font-style:normal;width:1.4em;text-align:center;border-bottom:3px solid #2a3b4a}#rrtally .ini i.c{border-color:var(--h);color:var(--h)}
#rrtally ol{display:none;margin:10px 0 0;padding:0;list-style:none;font-size:14px}#rrtally li{display:flex;gap:10px;padding:1px 0}#rrtally li span{width:3ch;color:#9fb2c0}#rrtally li b{width:4ch}#rrtally li em{flex:1;text-align:right;font-style:normal}#rrtally li.me{color:var(--h)}
#rrtally.wide>div{max-width:min(760px,100%);min-width:min(560px,100%)}#rrtally table{width:100%;border-collapse:collapse;font-size:14px}#rrtally th,#rrtally td{padding:3px 6px;text-align:right;white-space:nowrap}#rrtally th:first-child,#rrtally td:first-child{text-align:left;color:#9fb2c0;font-weight:500}
#rrtally th{font:800 15px var(--fd,ui-monospace,Menlo,monospace)}#rrtally tr.tot td{border-top:1px solid #2a3b4a;font-size:18px;padding-top:7px}#rrtally td.tm{color:var(--h)}#rrtally .top{font:900 30px var(--fd,ui-monospace,Menlo,monospace);text-align:center;margin:12px 0 2px;letter-spacing:.08em}
#rrtally p{margin:10px 0 0;font-size:12px;color:#9fb2c0;text-align:center}@media (prefers-reduced-motion:reduce){#rrtally .hi{animation:none}}`;
    document.head.appendChild(st);
    tEl = document.createElement('div'); tEl.id = 'rrtally';
    tEl.innerHTML = '<div><h2></h2><div data-r></div><div class="hi">NEW HIGH SCORE!</div><div class="ini"><i></i><i></i><i></i></div><ol></ol><p></p></div>';
    (document.getElementById('sgr') || document.body).appendChild(tEl);
    tTitle = tEl.querySelector('h2'); tRows = tEl.querySelector('[data-r]'); tHi = tEl.querySelector('.hi'); tIni = tEl.querySelector('.ini'); tTab = tEl.querySelector('ol'); tFoot = tEl.querySelector('p');
  }
  function tallyReset() { tally.active = false; tally.phase = 'off'; tally.mp = null; if (tEl) tEl.style.display = 'none'; }
  const teamKey = () => SCORE_BASE + ':team' + (diffKey === 'medium' ? '' : ':' + diffKey); // split-screen team totals: [{n: '3P', s, t}]
  function loadTeam() { try { const a = JSON.parse(localStorage.getItem(teamKey()) || '[]'); return Array.isArray(a) ? a.filter((e) => e && typeof e.s === 'number').slice(0, ARCADE.table) : []; } catch { return []; } }
  const PCOL = ['#ffb547', '#5ee6ff', '#ff5ad8', '#a6ff4d'];
  // split screen tally: a column per gunner (run score, kills, accuracy, best chain, their accuracy + chain bonus, total), the team
  // column (sums, plus the shared time and no-damage bonuses), the TOP GUN callout, then each human gunner's high-score initials in turn
  function mpTallyStart(gate) {
    use(0); plSave(PL[0]);
    const m = DF.score, par = (sGate - sHero) / SPEED + ARCADE.parPad, clean = gate && hits === 0;
    const bTime = gate ? (CMB ? CMB.timeBonus(par, runT, m) : max(0, round((par - runT) * ARCADE.timePer * m))) : 0, bClean = clean ? round(ARCADE.noDamage * m) : 0, cols = [];
    let team = bTime + bClean, top = -1, topV = -1, tie = false;
    for (let p = 0; p < NP; p++) {
      const q = PL[p], acc = q.shots ? min(1, q.boltHits / q.shots) : 0, bonus = round(acc * ARCADE.accuracy * m) + round(q.bestCombo * ARCADE.chain * m), total = q.score + bonus;
      cols.push({ p, score: q.score, kills: q.killed + q.driftKilled, acc: round(acc * 100), chain: q.bestCombo, bonus, total, bot: !!(lastInput && lastInput.mp && lastInput.mp.p[p].bot) });
      team += total; if (total > topV) { topV = total; top = p; tie = false; } else if (total === topV) tie = true;
    }
    const M = tally.mp = { cols, team, bTime, bClean, top: tie ? -1 : top, cells: [], me: [], queue: [], teamRank: -1 };
    tally.total = team; tally.gate = gate; tally.active = true; tally.phase = 'count'; netFetch(); tally.t = 0; tally.tick = 0; tally.fireHeld = true; tally.wait = 0.6; tally.rank = -1; tally.row = 0; tally.rows = [];
    tTitle.textContent = (gate ? 'Through the Ring Gate' : 'Hull breached') + ' · ' + NP + ' gunners · ' + DF.label + (DF.score !== 1 ? ' ×' + DF.score : '');
    const tb = document.createElement('table'), row = (label, cls) => { const tr = tb.insertRow(); if (cls) tr.className = cls; tr.insertCell().textContent = label; return tr; };
    const hd = tb.createTHead().insertRow(); hd.appendChild(document.createElement('th'));
    for (const c of cols) { const th = document.createElement('th'); th.textContent = 'P' + (c.p + 1) + (c.bot ? '·bot' : ''); th.style.color = PCOL[c.p]; hd.appendChild(th); }
    { const th = document.createElement('th'); th.textContent = 'Team'; hd.appendChild(th); }
    const cell = (tr, v, kind, cls) => { const td = tr.insertCell(); if (cls) td.className = cls; M.cells.push([td, v, kind]); };
    const sum = (k) => cols.reduce((a, c) => a + c[k], 0);
    for (const [label, k, kind] of [['Run score', 'score', 'n'], ['Kills', 'kills', 'k'], ['Accuracy', 'acc', '%'], ['Best chain', 'chain', 'x'], ['Acc + chain bonus', 'bonus', 'b']]) {
      const tr = row(label); for (const c of cols) cell(tr, c[k], kind);
      if (k === 'chain') cell(tr, max(...cols.map((c) => c.chain)), 'x', 'tm'); else if (k === 'acc') { const sh = cols.reduce((a, c) => a + PL[c.p].shots, 0), bh = cols.reduce((a, c) => a + PL[c.p].boltHits, 0); cell(tr, sh ? round(min(1, bh / sh) * 100) : 0, '%', 'tm'); } else cell(tr, sum(k), kind, 'tm');
    }
    { const tr = row(gate ? 'Time + no-damage (team)' : 'No-damage (team)'); for (let i = 0; i < cols.length; i++) tr.insertCell().textContent = ''; cell(tr, bTime + bClean, 'b', 'tm'); }
    { const tr = row('Total', 'tot'); for (const c of cols) cell(tr, c.total, 'n'); cell(tr, team, 'n', 'tm'); }
    tRows.textContent = ''; tRows.appendChild(tb);
    tHi.style.display = 'none'; tIni.style.display = 'none'; tTab.style.display = 'none'; tFoot.textContent = 'Fire · Enter: skip';
    tEl.className = 'wide'; tEl.style.display = 'grid';
  }
  function mpTallyRow(f) { for (const [td, v, k] of tally.mp.cells) td.textContent = k === 'n' ? fmt(v * f) : k === 'k' ? String(round(v * f)) : k === '%' ? round(v * f) + '%' : k === 'x' ? '×' + max(1, round(v * f)) : '+' + fmt(v * f); }
  function mpAfterCount() {
    const M = tally.mp; tally.phase = 'done'; hud.event(tally.gate ? 'win' : 'lose');
    tHi.style.display = 'block'; tHi.style.animation = 'none'; tHi.className = 'hi top';
    tHi.textContent = M.top >= 0 ? 'P' + (M.top + 1) + ' TOP GUN!' : 'DEAD HEAT!'; tHi.style.color = M.top >= 0 ? PCOL[M.top] : '';
    // the team total goes into the team table automatically; each human gunner's total may enter the player table (initials)
    if (M.team > 0) { const a = loadTeam(); let r = a.length < ARCADE.table ? a.length : -1; for (let i = 0; i < a.length; i++) if (M.team > a[i].s) { r = i; break; }
      if (r >= 0) { a.splice(r, 0, { n: NP + 'P', s: M.team, t: Date.now() }); try { localStorage.setItem(teamKey(), JSON.stringify(a.slice(0, ARCADE.table))); } catch {} } M.teamRank = r; }
    M.queue = M.cols.filter((c) => !c.bot && c.total > 0).sort((a, b) => b.total - a.total);
    tally.wait = 2.2; tally.fireHeld = true; tally.phase = 'topgun';
  }
  function mpNextInitials() {
    const M = tally.mp;
    while (M.queue.length) {
      const c = M.queue.shift(), a = loadScores(); let r = a.length < ARCADE.table ? a.length : -1;
      for (let i = 0; i < a.length; i++) if (c.total > a[i].s) { r = i; break; }
      if (r < 0) continue;
      tally.phase = 'initials'; tally.rank = r; tally.table = a; tally.total = c.total; tally.who = c.p; tally.slot = 0;
      tHi.className = 'hi'; tHi.style.animation = ''; tHi.style.color = PCOL[c.p]; tHi.textContent = 'P' + (c.p + 1) + ' · NEW HIGH SCORE!'; tIni.style.display = 'flex'; hud.event('levelup');
      try { const last = localStorage.getItem(SCORE_BASE + ':last'); if (last && /^[A-Z]{3}$/.test(last)) for (let k = 0; k < 3; k++) tally.ini[k] = last.charCodeAt(k) - 65; } catch {}
      tFoot.textContent = 'P' + (c.p + 1) + ': type or ↑↓ / stick to pick · → or Fire next · Enter to save'; drawIni(); tally.wait = 0.35; tally.fireHeld = true; return;
    }
    tIni.style.display = 'none'; tally.total = M.team; tallyTable(M.me);
  }
  function tallyStart(gate) {
    if (!tEl) tallyBuild();
    tHi.className = 'hi'; tHi.style.color = ''; tHi.style.animation = ''; tHi.textContent = 'NEW HIGH SCORE!';
    tally.mp = null; tEl.className = ''; if (mpRun) { mpTallyStart(gate); return; }
    hud.clock = false;
    const acc = shots ? min(1, boltHits / shots) : 0, par = (sGate - sHero) / SPEED + ARCADE.parPad, clean = gate && hits === 0;
    const m = DF.score, bAcc = round(acc * ARCADE.accuracy * m), bChain = round(bestCombo * ARCADE.chain * m), bTime = gate ? (CMB ? CMB.timeBonus(par, runT, m) : max(0, round((par - runT) * ARCADE.timePer * m))) : 0, bClean = clean ? round(ARCADE.noDamage * m) : 0;
    const kills = killed + driftKilled;
    tally.rows = [ // [label, counted value, value formatter kind, bonus]
      ['Run score', score, 'n', 0], ['Kills', kills, 'k', 0], ['Accuracy', round(acc * 100), '%', bAcc], ['Best chain', bestCombo, 'x', bChain],
      ['Time bonus', gate ? runT : 0, gate ? 't' : '-', bTime], ['No-damage bonus', clean ? 1 : 0, 'c', bClean]];
    tally.total = score + bAcc + bChain + bTime + bClean;
    tally.gate = gate; tally.active = true; tally.phase = 'count'; netFetch(); tally.row = 0; tally.t = 0; tally.tick = 0; tally.fireHeld = true; tally.wait = 0.6; tally.rank = -1;
    tTitle.textContent = (gate ? 'Through the Ring Gate' : 'Hull breached') + ' · ' + DF.label + (DF.score !== 1 ? ' ×' + DF.score : '');
    tRows.textContent = '';
    for (const r of tally.rows.concat([['Total', tally.total, 'n', 0]])) {
      const d = document.createElement('div'); d.className = 'r' + (r[0] === 'Total' ? ' tot' : ''); d.innerHTML = '<span></span><b></b><em></em>'; d.firstChild.textContent = r[0]; tRows.appendChild(d);
    }
    tHi.style.display = 'none'; tIni.style.display = 'none'; tTab.style.display = 'none'; tFoot.textContent = 'Fire · Enter: skip';
    tEl.style.display = 'grid';
  }
  const rowText = (r, f) => { // f = 0..1 of the count
    const v = r[1] * f, k = r[2];
    return k === 'n' ? fmt(v) : k === 'k' ? String(round(v)) : k === '%' ? round(v) + '%' : k === 'x' ? '×' + max(1, round(v)) : k === 't' ? v.toFixed(1) + ' s' : k === 'c' ? (r[1] ? 'CLEAN' : '—') : '—';
  };
  function tallyRow(i, f) {
    const el = tRows.children[i]; if (!el) return;
    el.className = el.className.replace(' on', '') + ' on';
    if (i < tally.rows.length) { const r = tally.rows[i]; el.children[1].textContent = rowText(r, f); el.children[2].textContent = r[3] ? '+' + fmt(r[3] * f) : ''; }
    else { const base = tally.rows[0][1]; el.children[1].textContent = fmt(base + (tally.total - base) * f); }
  }
  function tallySkip() { if (tally.mp) { mpTallyRow(1); mpAfterCount(); return; } for (let i = 0; i <= tally.rows.length; i++) tallyRow(i, 1); tallyAfterCount(); }
  function tallyAfterCount() {
    tally.phase = 'done'; hud.event(tally.gate ? 'win' : 'lose');
    const a = loadScores(); let rank = a.length < ARCADE.table ? a.length : -1;
    for (let i = 0; i < a.length; i++) if (tally.total > a[i].s) { rank = i; break; }
    tally.rank = tally.total > 0 ? rank : -1; tally.table = a;
    if (tally.rank >= 0) { // NEW HIGH SCORE: initials
      tally.phase = 'initials'; tally.slot = 0; tHi.style.display = 'block'; tIni.style.display = 'flex'; hud.event('levelup');
      try { const last = localStorage.getItem(SCORE_BASE + ':last'); if (last && /^[A-Z]{3}$/.test(last)) for (let k = 0; k < 3; k++) tally.ini[k] = last.charCodeAt(k) - 65; } catch {}
      tFoot.textContent = 'Type or ↑↓ / stick to pick · → or Fire next · Enter to save'; drawIni();
    } else tallyTable(-1);
    tally.wait = 0.35; tally.fireHeld = true;
  }
  function drawIni() { for (let k = 0; k < ARCADE.initials; k++) { const e = tIni.children[k]; e.textContent = String.fromCharCode(65 + tally.ini[k]); e.className = k === tally.slot ? 'c' : ''; } }
  function tallySave() {
    const n = String.fromCharCode(...tally.ini.map((c) => 65 + c)), a = tally.table.slice();
    a.splice(tally.rank, 0, { n, s: tally.total, t: Date.now() }); saveScores(a); netPost(n, tally.total);
    if (NET.top[diffKey]) NET.top[diffKey] = [{ n, s: tally.total, t: Date.now() }, ...NET.top[diffKey]].sort((x, y) => y.s - x.s).slice(0, ARCADE.table);
    try { localStorage.setItem(SCORE_BASE + ':last', n); } catch {}
    hud.event('coin'); tIni.style.display = 'none';
    if (tally.mp) { for (let i = 0; i < tally.mp.me.length; i++) if (tally.mp.me[i] >= tally.rank) tally.mp.me[i]++; tally.mp.me.push(tally.rank); mpNextInitials(); return; }
    tallyTable(tally.rank, a);
  }
  function tallyTable(me, a = loadScores()) {
    tally.phase = 'table'; tally.wait = 0.35; tally.fireHeld = true;
    tTab.textContent = '';
    for (let i = 0; i < min(a.length, ARCADE.table); i++) {
      const li = document.createElement('li'); if (Array.isArray(me) ? me.includes(i) : i === me) li.className = 'me';
      li.innerHTML = '<span></span><b></b><em></em>'; li.children[0].textContent = (i + 1) + '.'; li.children[1].textContent = a[i].n; li.children[2].textContent = fmt(a[i].s); tTab.appendChild(li);
    }
    if (!a.length) { const li = document.createElement('li'); li.textContent = 'No scores yet'; tTab.appendChild(li); }
    if (tally.mp) { const t = loadTeam(), li = document.createElement('li'); li.className = tally.mp.teamRank === 0 ? 'me' : ''; li.style.marginTop = '8px';
      li.textContent = 'Team record: ' + (t.length ? t[0].n + ' ' + fmt(t[0].s) : '—') + (tally.mp.teamRank >= 0 ? ' · this team #' + (tally.mp.teamRank + 1) : ''); tTab.appendChild(li); }
    tTab.style.display = 'block'; tFoot.textContent = 'Fire · Enter: continue';
  }
  function showResults() {
    tally.active = false; tally.phase = 'off'; tEl.style.display = 'none';
    if (tally.mp) { const M = tally.mp, t = loadTeam();
      hud.results({ title: (tally.gate ? 'Through the Ring Gate' : 'Hull breached') + ' · ' + NP + ' gunners', lines: [['Team total', fmt(M.team)], ['Top gun', M.top >= 0 ? 'P' + (M.top + 1) + ' · ' + fmt(M.cols[M.top].total) : 'Dead heat'],
        ...M.cols.map((c) => ['P' + (c.p + 1) + (c.bot ? ' (bot)' : ''), fmt(c.total) + ' · ' + c.kills + ' kills · ' + c.acc + '%']), ['Team record', t.length ? t[0].n + ' ' + fmt(t[0].s) : '—'],
        ['Difficulty', DF.label + (DF.score !== 1 ? ' (×' + DF.score + ' score)' : '')], ['Hull', hull + ' / ' + HULL_MAX], ['Time', runT.toFixed(1) + ' s']] }, () => GAME.reset());
      return; }
    const R = tally.rows, a = loadScores(), rk = tally.rank;
    hud.results({ title: tally.gate ? 'Through the Ring Gate' : 'Hull breached', lines: [
      ['Difficulty', DF.label + (DF.score !== 1 ? ' (×' + DF.score + ' score)' : '')], ['Total', fmt(tally.total)], ['High score', a.length ? a[0].n + ' ' + fmt(a[0].s) : '—'], ...(rk >= 0 ? [['Rank', '#' + (rk + 1) + ' of ' + ARCADE.table]] : []),
      ['Kills', R[1][1] + (turret ? ' (' + driftKilled + ' drifters)' : '')], ['Accuracy', R[2][1] + '%'], ['Best chain', '×' + bestCombo],
      ['Blaster', 'L' + level + ' · ' + weapon().name], ['Hull', hull + ' / ' + HULL_MAX], ['Time', runT.toFixed(1) + ' s']] }, () => GAME.reset());
  }
  // keyboard (via GAME.intercept while the tally is up)
  function tallyKey(code) {
    const go = code === 'Enter' || code === 'NumpadEnter' || code === 'Space', esc = code === 'Escape';
    if (tally.phase === 'count') { if (go || esc) { tallySkip(); return true; } return code === 'Space'; }
    if (tally.phase === 'topgun') { if (go || esc) { mpNextInitials(); return true; } return code === 'Space'; }
    if (tally.phase === 'initials') {
      if (/^Key[A-Z]$/.test(code)) { tally.ini[tally.slot] = code.charCodeAt(3) - 65; tally.slot = min(ARCADE.initials - 1, tally.slot + 1); drawIni(); hud.event('pickup'); return true; }
      if (code === 'ArrowUp' || code === 'ArrowDown') { tally.ini[tally.slot] = (tally.ini[tally.slot] + (code === 'ArrowUp' ? 1 : 25)) % 26; drawIni(); hud.event('pickup'); return true; }
      if (code === 'ArrowLeft' || code === 'Backspace') { tally.slot = max(0, tally.slot - 1); drawIni(); return true; }
      if (code === 'ArrowRight' || code === 'Tab') { tally.slot = min(ARCADE.initials - 1, tally.slot + 1); drawIni(); return true; }
      if (go) { tallySave(); return true; }
      return esc ? false : true; // Esc still opens settings
    }
    if (tally.phase === 'table' && (go || esc) && tally.wait <= 0) { showResults(); return true; }
    return go;
  }
  // per frame while the tally is up: the count, fire to skip / advance, and the pad for initials
  function tallyStep(dt, input) {
    if (!tally.active) return;
    const f = !!input.gunner.fire, press = f && !tally.fireHeld; tally.fireHeld = f;
    tally.wait = max(0, tally.wait - dt);
    if (tally.phase === 'count' && tally.mp) { // split: every cell counts up together
      if (press) { tallySkip(); return; }
      if (tally.wait > 0) return;
      tally.t += dt; const u = min(1, tally.t / 2.2); mpTallyRow(u);
      if ((tally.tick -= dt) <= 0 && u < 1) { tally.tick = 0.07; hud.event('coin'); }
      if (u >= 1) mpAfterCount();
      return;
    }
    if (tally.phase === 'topgun') { if ((press && tally.wait < 1.7) || tally.wait <= 0) mpNextInitials(); return; }
    if (tally.phase === 'count') {
      if (press) { tallySkip(); return; }
      if (tally.wait > 0) return;
      const n = tally.rows.length, dur = tally.row === n ? 1.1 : 0.55;
      tally.t += dt; const u = min(1, tally.t / dur);
      tallyRow(tally.row, u);
      if ((tally.tick -= dt) <= 0 && u < 1) { tally.tick = 0.07; hud.event('coin'); } // an arcade tick per count step
      if (u >= 1) { tally.row++; tally.t = 0; tally.tick = 0; tally.wait = 0.22; if (tally.row > n) tallyAfterCount(); }
      return;
    }
    if (tally.phase === 'initials') {
      const L = input.look, sy = L.sy, sx = L.sx, dir = sy > 0.55 ? 1 : sy < -0.55 ? -1 : 0, hx = sx > 0.6 ? 1 : sx < -0.6 ? -1 : 0, d = dir || hx * 2;
      if (d !== tally.repDir) { tally.repDir = d; tally.rep = 0.4; if (d) padIni(d); }
      else if (d && (tally.rep -= dt) <= 0) { tally.rep = 0.16; if (dir) padIni(d); }
      if (press && tally.wait <= 0) { if (tally.slot < ARCADE.initials - 1) { tally.slot++; drawIni(); hud.event('pickup'); } else tallySave(); }
      return;
    }
    if (tally.phase === 'table' && press && tally.wait <= 0) showResults();
  }
  function padIni(d) {
    if (d === 1 || d === -1) { tally.ini[tally.slot] = (tally.ini[tally.slot] + (d === 1 ? 1 : 25)) % 26; hud.event('pickup'); }
    else tally.slot = clamp(tally.slot + (d > 0 ? 1 : -1), 0, ARCADE.initials - 1);
    drawIni();
  }
  // ---------------------------------------------------------------- HUD feed
  function post(view) {
    F = view.F; fullAsp = view.aspect; if (!mpRun) { tanH = view.tan; aspect = view.aspect; } else use(0);
    if (!dMenu) diffMenu(); zekeCallout(started && !ended ? fdt : 0);
    const w = weapon();
    stats.score = round(roll); stats.combo = combo; stats.hull = hull; stats.level = level; stats.xp = xp;
    stats.xpNext = level < WEAPONS.length ? WEAPONS[level].xp : WEAPONS[WEAPONS.length - 1].xp; stats.heat = heat; stats.overheated = overheated;
    stats.counterValue = killed; stats.kills = killed + driftKilled; stats.weaponName = w.name; stats.speed = spd; stats.boost = boost;
    if (mpRun) { plSave(PL[0]); let t = 0, k = 0; for (let p = 0; p < NP; p++) { t += PL[p].roll; k += PL[p].killed + PL[p].driftKilled; } stats.score = round(t); stats.kills = k; } // the team
    hud.set(stats); hud.mp = mpRun ? MPH : null;
    cockpitFrame(view);
    chainHud();
    if (typeof HOLO !== 'undefined') HOLO.frame(view, s, cam, FR, hud.power ?? 1, ended, mpRun ? NP : 0, EYE, CBP, TANP, ASPP); // the projected route (holo.js)
    if (CMB) CMB.post(view, stats); // HOOK (combat.js): beam, heated rocks, speed lines (G.lines after the route), its HUD canvas, laser heat in the weapon panel
    if (PU) PU.present(); // HOOK (pulse.js): the bubble composite, every frame it has something to draw
    if (typeof REALMS !== 'undefined') REALMS.post(view); // the reality switch: warp, realm uniforms, SECTOR dial (realms.js)
    if (!MK) return;
    if (mpRun) { mpPost(); turretHud(view, 0); return; }
    const fx = view.f[0], fy = view.f[1], fz = view.f[2], rx = view.r[0], rz = view.r[2], ux = view.u[0], uy = view.u[1], uz = view.u[2], cx = F[0], cy = F[1], cz = F[2];
    // marks: lock brackets on the live targets nearest the aim (two in pilot, four in turret: the shell shows at most 5), plus the gate
    const nbest = turret ? NBEST_TURRET : 2, er = turret ? 0.6 * 0.6 : 0.35 * 0.35;
    for (let k = 0; k < nbest; k++) { BI[k] = -1; BE[k] = er; }
    const ax = aim[0], ay = aim[1], ta = view.tan * view.aspect, tv = view.tan;
    let nb = 0, na = 0;
    for (let i = 0; i < nT; i++) {
      if (!TAL[i]) continue;
      const dx = TX[i] - cx, dy = TY[i] - cy, dz = TZ[i] - cz, z = dx * fx + dy * fy + dz * fz;
      const rR = dx * rx + dz * rz, rU = dx * ux + dy * uy + dz * uz;
      if (z > 0.5 && z < LOCK_RANGE) {
        const nx = rR / (z * ta) - ax, ny = rU / (z * tv) - ay, e = nx * nx + ny * ny;
        if (e < BE[nbest - 1]) { let k = nbest - 1; while (k > 0 && e < BE[k - 1]) { BE[k] = BE[k - 1]; BI[k] = BI[k - 1]; k--; } BE[k] = e; BI[k] = i; }
      }
      // radar: relative to the ship (cam), not the camera, so it reads the same in both views
      const sx = TX[i] - cam[0], sy = TY[i] - cam[1], sz = TZ[i] - cam[2], d2 = sx * sx + sy * sy + sz * sz;
      // danger: on the ship's path. Pilot: along the look; turret: along the rail (the way the ship actually flies); rammers always
      let dang = false;
      if (turret) { const pF = sx * FR[0] + sy * FR[1] + sz * FR[2], lx = sx - FR[0] * pF, ly = sy - FR[1] * pF, lz = sz - FR[2] * pF; dang = (pF > 0 && pF < 90 && lx * lx + ly * ly + lz * lz < (TR[i] + 1.5) * (TR[i] + 1.5)) || (i >= nD0 && DRAM[i] === 1); }
      if (nb < nT && d2 < RADAR_RANGE * RADAR_RANGE) {
        const sR = sx * rx + sz * rz, sU = sx * ux + sy * uy + sz * uz, sF = sx * fx + sy * fy + sz * fz, o = nb * 4; BLP[o] = sR; BLP[o + 1] = sU; BLP[o + 2] = sF;
        BLP[o + 3] = turret ? (dang ? 2 : 0) : sF > 0 && sF < 90 && sR * sR + sU * sU < (TR[i] + 1.5) * (TR[i] + 1.5) ? 2 : 0; nb++;
      }
      // turret: off-screen threats (drifters in flight, and rocks on the ship's path) for the edge arrows, nearest 5
      if (turret && (dang || i >= nD0) && d2 < ARROW_RANGE * ARROW_RANGE) {
        Turret.edge(rR, rU, z, tv, view.aspect, 0.08, ED);
        if (!ED[3]) {
          const dd = sqrt(d2);
          if (na < 5 || dd < ARD[na - 1]) {
            let k = na < 5 ? na++ : 4; while (k > 0 && dd < ARD[k - 1]) { ARD[k] = ARD[k - 1]; ARB[k] = ARB[k - 1]; for (let c = 0; c < 5; c++) ARW[k * 5 + c] = ARW[(k - 1) * 5 + c]; k--; }
            ARD[k] = dd; ARB[k] = atan2(rR, z); ARW[k * 5] = ED[0]; ARW[k * 5 + 1] = ED[1]; ARW[k * 5 + 2] = ED[2]; ARW[k * 5 + 3] = dang ? 2 : 0; ARW[k * 5 + 4] = dd;
          }
        }
      }
    }
    let nm = 0;
    const mark = (x, y, z, kind, label) => {
      const dx = x - cx, dy = y - cy, dz = z - cz, d = dx * fx + dy * fy + dz * fz; if (d <= 0.5) return;
      const o = nm * 6; MK[o] = (dx * rx + dz * rz) / (d * ta); MK[o + 1] = (dx * ux + dy * uy + dz * uz) / (d * tv); MK[o + 2] = d; MK[o + 3] = kind; MK[o + 4] = hypot(dx, dy, dz); MK[o + 5] = label; nm++;
    };
    for (let k = 0; k < nbest; k++) if (BI[k] >= 0) mark(TX[BI[k]], TY[BI[k]], TZ[BI[k]], 0, BI[k] >= nD0 ? 2 : 0);
    mark(gate[0], gate[1], gate[2], 1, 1);
    { const dx = gate[0] - cam[0], dy = gate[1] - cam[1], dz = gate[2] - cam[2], o = nb * 4; BLP[o] = dx * rx + dz * rz; BLP[o + 1] = dx * ux + dy * uy + dz * uz; BLP[o + 2] = dx * fx + dy * fy + dz * fz; BLP[o + 3] = 1; nb++; }
    hud.marks(MK, nm); hud.blips(BLP, nb);
    turretHud(view, na);
  }
  // split screen: per-gunner HUD data for the shell (MPH): score, chain, blaster, lock brackets (4 nearest the reticle, + the gate),
  // off-screen threat arrows (3 nearest) and the forward chevron, each from that gunner's own camera
  function mpPost() {
    MPH.n = NP;
    for (let p = 0; p < NP; p++) {
      use(p); const H = MPH.players[p], T = TTS[p];
      H.score = round(roll); H.chain = combo; H.chainT = combo > 1 && comboT > 0 ? comboT / COMBO_TIME : 0; H.heat = heat; H.overheated = overheated; H.level = level; if (CMB) CMB.mpHud(p, H);
      H.xp = level < WEAPONS.length ? clamp((xp - WEAPONS[level - 1].xp) / (WEAPONS[level].xp - WEAPONS[level - 1].xp), 0, 1) : 1; H.kills = killed + driftKilled; H.shield = shield;
      const fx = CB[0], fy = CB[1], fz = CB[2], rx = CB[3], rz = CB[5], ux = CB[6], uy = CB[7], uz = CB[8], cx = eye[0], cy = eye[1], cz = eye[2], ta = tanH * aspect, tv = tanH;
      for (let k = 0; k < NBEST_TURRET; k++) { BI[k] = -1; BE[k] = 0.36; }
      let na = 0;
      for (let i = 0; i < nT; i++) {
        if (!TAL[i]) continue;
        const dx = TX[i] - cx, dy = TY[i] - cy, dz = TZ[i] - cz, z = dx * fx + dy * fy + dz * fz, rR = dx * rx + dz * rz, rU = dx * ux + dy * uy + dz * uz;
        if (z > 0.5 && z < LOCK_RANGE) { const nx = rR / (z * ta), ny = rU / (z * tv), e = nx * nx + ny * ny;
          if (e < BE[NBEST_TURRET - 1]) { let k = NBEST_TURRET - 1; while (k > 0 && e < BE[k - 1]) { BE[k] = BE[k - 1]; BI[k] = BI[k - 1]; k--; } BE[k] = e; BI[k] = i; } }
        const sx = TX[i] - cam[0], sy = TY[i] - cam[1], sz = TZ[i] - cam[2], d2 = sx * sx + sy * sy + sz * sz;
        const pF = sx * FR[0] + sy * FR[1] + sz * FR[2], lx = sx - FR[0] * pF, ly = sy - FR[1] * pF, lz = sz - FR[2] * pF;
        const dang = (pF > 0 && pF < 90 && lx * lx + ly * ly + lz * lz < (TR[i] + 1.5) * (TR[i] + 1.5)) || (i >= nD0 && DRAM[i] === 1);
        if ((dang || i >= nD0) && d2 < ARROW_RANGE * ARROW_RANGE) {
          Turret.edge(rR, rU, z, tv, aspect, 0.1, ED);
          if (!ED[3]) { const dd = sqrt(d2);
            if (na < 3 || dd < ARD[na - 1]) { let k = na < 3 ? na++ : 2; while (k > 0 && dd < ARD[k - 1]) { ARD[k] = ARD[k - 1]; for (let c = 0; c < 5; c++) H.arrows[k * 5 + c] = H.arrows[(k - 1) * 5 + c]; k--; }
              ARD[k] = dd; H.arrows[k * 5] = ED[0]; H.arrows[k * 5 + 1] = ED[1]; H.arrows[k * 5 + 2] = ED[2]; H.arrows[k * 5 + 3] = dang ? 2 : 0; H.arrows[k * 5 + 4] = dd; } }
        }
      }
      H.na = na; let nm = 0;
      const mark = (x, y, z, kind) => { const dx = x - cx, dy = y - cy, dz = z - cz, d = dx * fx + dy * fy + dz * fz; if (d <= 0.5) return; const o = nm * 6, M = H.marks;
        M[o] = (dx * rx + dz * rz) / (d * ta); M[o + 1] = (dx * ux + dy * uy + dz * uz) / (d * tv); M[o + 2] = d; M[o + 3] = kind; M[o + 4] = hypot(dx, dy, dz); M[o + 5] = 0; nm++; };
      for (let k = 0; k < NBEST_TURRET; k++) if (BI[k] >= 0) mark(TX[BI[k]], TY[BI[k]], TZ[BI[k]], BI[k] >= nD0 ? 2 : 0);
      mark(gate[0], gate[1], gate[2], 1); H.nm = nm;
      Turret.edge(FR[0] * rx + FR[2] * rz, FR[0] * ux + FR[1] * uy + FR[2] * uz, FR[0] * fx + FR[1] * fy + FR[2] * fz, tv, aspect, 0.12, H.fwd);
      H.showFwd = abs(T.yaw) > 0.3 || abs(T.pitch) > 0.3;
    }
    use(0); hud.player = -1;
  }
  // turret HUD (turret.js): forward chevron when looking away from the rail direction, compass strip, off-screen threat arrows
  function turretHud(view, na) {
    const live = turret && started && !ended && shell && shell.state === 'run' && !mpRun; // split screen: each viewport has its own (shell)
    if (!live) { if (TH) TH.hide(); return; }
    if (!TH) TH = Turret.hud(document.getElementById('sgr'));
    const L = shell.settings.layers, fx = view.f[0], fy = view.f[1], fz = view.f[2], rx = view.r[0], rz = view.r[2], ux = view.u[0], uy = view.u[1], uz = view.u[2];
    const F0 = FR[0], F1 = FR[1], F2 = FR[2];
    Turret.edge(F0 * rx + F2 * rz, F0 * ux + F1 * uy + F2 * uz, F0 * fx + F1 * fy + F2 * fz, view.tan, view.aspect, 0.1, thState.fwd);
    const off = abs(TT.yaw) > 0.3 || abs(TT.pitch) > 0.3;
    thState.showFwd = !!L.marks && off; thState.compass = !!(L.frame || L.marks); // the compass is a light strip, so it stays with the marks when the frame is off thState.yaw = TT.yaw; thState.power = hud.power ?? 1;
    thState.n = L.marks ? na : 0;
    // compass ticks: the off-screen threats' bearings around the look direction
    for (let k = 0; k < na; k++) { TCK[k * 2] = ARB[k]; TCK[k * 2 + 1] = ARW[k * 5 + 3]; }
    thState.nt = L.frame || L.marks ? na : 0;
    TH.draw(thState);
  }

  // shell hooks: Esc / Enter skip the intro (fire skips it in update); the 'intro on|off|toggle' command (also ?intro=off)
  function intercept(code) {
    if (tally.active) return tallyKey(code);
    const k = code === 'Escape' || code === 'Enter' || code === 'NumpadEnter';
    if (cd.mp && mpRun && !started) { if (k && cd.t >= INTRO.skipAfter) { cd.skip = true; return true; } return false; } // split: skip to GO
    if (!intro.active && typeof REALMS !== 'undefined' && REALMS.key(code)) return true; // developer mode: Z world, X style, C music (realms.js)
    if (!intro.active || intro.frozen || !intro.shown0 || intro.t < INTRO.skipAfter) return false;
    if (k) { introEnd(true); return true; } // straight to GO
    return false;
  }
  // ---- difficulty UI: a picker on the start menu, a Settings segment (shell GAME.settingsHTML), the command, ?difficulty=
  const diffBlurb = { supereasy: "auto-aim: just press fire · can't lose", easy: "can't lose · 5 hull that refills", medium: '3 hull', hard: '2 hull · more, faster homers', zeke: '1 hull · no dodge · swarms · ×3 score' };
  let dMenu = null, dNote = null;
  function diffMenu() {
    if (dMenu || typeof document === 'undefined') return; const go = document.getElementById('go'); if (!go) return;
    const st = document.createElement('style');
    st.textContent = `#rrdiff{display:flex;flex-wrap:wrap;justify-content:center;gap:6px;margin:12px auto 0;max-width:560px}#rrdiff b{width:100%;font:600 12px ui-monospace,Menlo,monospace;letter-spacing:.14em;color:#9fc3d1}
#rrdiff button{flex:1 1 110px;padding:8px 10px;border-radius:10px;border:1.5px solid #3d6b78;background:rgba(6,18,28,.6);color:#d8eef5;font:700 14px system-ui;cursor:pointer}
#rrdiff button[aria-pressed=true]{background:#7fe0d0;color:#04222b;border-color:#7fe0d0}#rrdiff button[data-d=zeke][aria-pressed=true]{background:#ff5a4f;border-color:#ff5a4f;color:#200}
#rrdiff i{width:100%;font:500 13px system-ui;color:#c9dde6;font-style:normal}body.l #rrdiff{display:none}
#rrzeke{position:fixed;left:0;right:0;top:22%;z-index:8;text-align:center;pointer-events:none;font:900 clamp(20px,4.4vw,40px) system-ui;letter-spacing:.06em;color:#ff4d40;text-shadow:0 0 18px rgba(255,40,20,.8),0 2px 3px #000;opacity:0;transition:opacity .4s}
#rrzeke small{display:block;font:700 clamp(12px,2vw,16px) ui-monospace,Menlo,monospace;letter-spacing:.2em;color:#ffd0c8}`;
    document.head.appendChild(st);
    dMenu = document.createElement('div'); dMenu.id = 'rrdiff'; dMenu.innerHTML = '<b>DIFFICULTY</b>' + DIFF_KEYS.map((k) => `<button type="button" data-d="${k}" aria-pressed="false">${DIFF[k].label}</button>`).join('') + '<i></i>';
    go.parentNode.insertBefore(dMenu, go); dNote = dMenu.querySelector('i');
    if (PU) { const h = document.createElement('p'); h.className = 'keys'; h.textContent = 'Every 10 s your next shot warps reality'; (document.querySelector('#menu .keys') || go).after(h); } // HOOK (pulse.js): the start menu hint
    dMenu.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setDifficulty(b.dataset.d); });
    syncDiffUI();
  }
  function syncDiffUI() {
    if (dMenu) { for (const b of dMenu.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.d === diffKey)); dNote.textContent = diffBlurb[diffKey]; }
    if (typeof document !== 'undefined') for (const b of document.querySelectorAll('#sgset [data-game^="difficulty "]')) b.setAttribute('aria-pressed', String(b.dataset.game === 'difficulty ' + diffKey));
  }
  let zEl = null, zT = 0; // Zeke's Finding Religion: a red title-card line at the start of each run
  function zekeCallout(dt) {
    if (!DF.callout) { if (zEl && zT > 0) { zT = 0; zEl.style.opacity = '0'; } return; }
    if (!zEl) { zEl = document.createElement('div'); zEl.id = 'rrzeke'; zEl.innerHTML = "Zeke's Finding Religion<small>NO DODGE · SWARMS FROM ALL SIDES · ×3 SCORE</small>"; document.body.appendChild(zEl); }
    if (dt < 0) { zT = 3.2; } else if (zT > 0) zT = max(0, zT - dt);
    zEl.style.opacity = zT > 0.4 ? '1' : zT > 0 ? (zT / 0.4).toFixed(2) : '0';
  }
  function command(a) {
    if (typeof REALMS !== 'undefined') { const r = REALMS.command(a); if (r != null) return r; }
    if (a[0] === 'rail' && typeof HOLO !== 'undefined') return HOLO.command(a); // rail holo|classic (on/off/toggle: the shell's layer)
    if (a[0] === 'whales' && WH) return WH.command(a);
    { const r = (CMB && CMB.command(a)) ?? (SBD && SBD.command(a)); if (r != null) return r; } // HOOK: weapon, throttle, proximity (combat.js); sound (soundboard.js)
    if (a[0] === 'difficulty' || a[0] === 'diff') {
      const k = a[1] === "zeke's" || a[1] === 'religion' ? 'zeke' : a[1] === 'super' || a[1] === 'super-easy' ? 'supereasy' : a[1];
      if (!k) return 'difficulty ' + diffKey + ' (' + DIFF[diffKey].label + '). Choose: ' + DIFF_KEYS.join(' | ');
      if (!setDifficulty(k)) return 'difficulty ' + DIFF_KEYS.join(' | ');
      return 'difficulty: ' + DIFF[k].label + ' (' + diffBlurb[k] + ')' + (started && !ended ? ', from the next run' : '');
    }
    if (a[0] === 'title') {
      title.on = a[1] === 'on' ? true : a[1] === 'off' ? false : a[1] === 'toggle' || !a[1] ? !title.on : title.on;
      try { localStorage.setItem('reef-run:title', title.on ? 'on' : 'off'); } catch {}
      return 'title ' + (title.on ? 'on: the beat-synced title slam before the first run of a visit' : 'off: straight into 3 2 1 GO');
    }
    if (a[0] === 'titlefx') {
      if (!TFX) return 'titlefx: unavailable';
      if (!a[1]) return 'titlefx ' + fxStyle + ' (' + TFX.styles[fxStyle].name + '). Choose: ' + TFX.NAMES.join(' | ') + ' · board: title-fx.html';
      if (!TFX.NAMES.includes(a[1]) && a[1] !== 'random') return 'titlefx random | ' + TFX.NAMES.join(' | ');
      fxPick = a[1]; try { localStorage.setItem('reef-run:titlefx', fxPick); } catch {}
      if (fxPick === 'random') return 'titlefx: random (a different look each run)';
      fxStyle = fxPick; return 'titlefx: ' + TFX.styles[fxStyle].name + ' (the title slam and countdown)';
    }
    if (a[0] === 'barrels') {
      barrelsOn = a[1] === 'on' ? true : a[1] === 'off' ? false : a[1] === 'toggle' || !a[1] ? !barrelsOn : barrelsOn;
      try { localStorage.setItem('reef-run:barrels', barrelsOn ? 'on' : 'off'); } catch {}
      return 'barrels ' + (barrelsOn ? 'on: the turret\'s barrel tips show at the bottom of the cockpit view' : 'off: a clean cockpit view');
    }
    if (a[0] !== 'intro') return null;
    intro.on = a[1] === 'on' ? true : a[1] === 'off' ? false : a[1] === 'toggle' || !a[1] ? !intro.on : intro.on;
    try { localStorage.setItem('reef-run:intro', intro.on ? 'on' : 'off'); } catch {}
    return 'intro ' + (intro.on ? 'on: Frame 0, then the HUD boot and 3 2 1 GO on the beat at each run start' : 'off: runs start straight away');
  }
  // Settings: credits, GitHub and share links (carpetshark: "add a link to github and social in settings page", "be sure you credit og author")
  function SHARE_HTML() {
    const u = encodeURIComponent(location.origin + '/'), t = encodeURIComponent('Reef Run: a WebGPU space shooter, a non-commercial science project and celebration');
    const a = (href, label) => `<a href=${JSON.stringify(href)} target="_blank" rel="noopener" style="display:inline-block;margin:0 10px 6px 0;color:inherit">${label}</a>`;
    return '<h4>Credits &amp; share</h4><p style="margin:0 0 8px;font-size:13px;line-height:1.45">Inspired by and built on <b>Abyssal Garden</b> by <b>Maksymilian Dendura (Noniv)</b>, MIT licence. '
      + a('https://github.com/Noniv/abyssal-garden', 'github.com/Noniv/abyssal-garden') + '</p>'
      + '<p style="margin:0 0 8px;font-size:13px">Made by <b>carpetshark</b>. Reef Run is a non-commercial science project and celebration. ' + a('/credits', 'Full credits &amp; licences') + '</p>'
      + '<div style="font-size:13px">' + a('https://twitter.com/intent/tweet?url=' + u + '&text=' + t, 'Share on X') + a('https://bsky.app/intent/compose?text=' + t + '%20' + u, 'Bluesky') + a('https://www.reddit.com/submit?url=' + u + '&title=' + t, 'Reddit') + a('https://www.facebook.com/sharer/sharer.php?u=' + u, 'Facebook') + '</div>';
  }
  return { id: 'reef-run', title: 'Reef Run', skin: 'canopy', ownMusic: [{ id: 'own-soaring', url: 'music/soaring-melody.mp3', name: 'Soaring Melody' }, { id: 'own-euphoric', url: 'music/euphoric-defiance.mp3', name: 'Euphoric Defiance' }, { id: 'own-pulse', url: 'music/pulse-circuit-a.mp3', name: 'Pulse Circuit A' }, { id: 'own-reimagined', url: 'music/abbies-world-reimagined-3.mp3', name: 'Abbie\u2019s World Reimagined' }] /* carpetshark: no Abbie's World catalogue music in Reef Run ("too toybox") */, localSounds: { 'blaster-zap': { url: 'sfx/blaster-zap.mp3', name: 'Blaster zap (carpetshark)', tags: ['laser', 'zap', 'blaster', 'phaser'] }, 'rock-burst-1': { url: 'sfx/rock-burst-1.mp3', name: 'Rock burst 1 (small explosion, cut)', tags: ['explosion', 'rock'] }, 'rock-burst-2': { url: 'sfx/rock-burst-2.mp3', name: 'Rock burst 2 (ice crack)', tags: ['rock', 'crack'] }, 'rock-burst-3': { url: 'sfx/rock-burst-3.mp3', name: 'Rock burst 3 (avalanche, cut)', tags: ['rock', 'avalanche'] } } /* carpetshark's laser, trimmed to 0.36 s */, sfx: (n, e) => (SBD ? SBD.sfx(n, e) : n === 'damage' ? e : null) /* the sound board (soundboard.js) replaces sfxOnly; default: only the crash (carpetshark) */, extraLayers: ['proximity'] /* combat.js */, comboPanel: { label: 'Kills', field: 'kills' } /* the chain has its own big readout */, layers: { frame: false } /* carpetshark: the dark canopy frame hid the effects */, hudFloat: true, hudLayout: { radar: 'right' } /* the radar sits above the right panel, clear of the gunner's barrels (shell.js hook) */, controls: { turret: 'Turret · look freely', pilot: 'Pilot · steer' }, palette: 'Amber Night', weapons: WEAPONS, prepare, init, update, post, reset, intercept, command, intro: INTRO,
    music: { url: 'music/soaring-melody.mp3', name: 'Soaring Melody' }, // GAME.music: played from 0 on Start unless a track is picked in Settings
    help: '  title on|off|toggle           the title slam before the first run of a visit (also ?title=off)\n  titlefx random|slam|comic|speed|sticker   the title slam and countdown look (also ?titlefx=; board: title-fx.html)\n  intro on|off|toggle           start sequence (Frame 0, HUD boot, 3 2 1 GO)\n  difficulty supereasy|easy|medium|hard|zeke   (also ?difficulty=); applies from the next run\n  barrels on|off|toggle         the turret barrel tips in the cockpit view (also ?barrels=)' + (PU ? '\n  F / right mouse / pad LB       Reality Pulse: the next world spreads from what the shot hits (also ?pulse=cheap|calm|sweep|quick)' : '') + (typeof HOLO !== 'undefined' ? HOLO.help : '') + (WH ? WH.help : '') + (typeof REALMS !== 'undefined' ? REALMS.help : '') + (CMB ? CMB.help : '') + (SBD ? SBD.help : ''),
    commandFirst: (a) => (typeof REALMS !== 'undefined' ? REALMS.commandFirst(a) : null), onMusic: () => { if (typeof REALMS !== 'undefined') REALMS.onMusic(); },
    settingsHTML: () => SHARE_HTML() + '<h4>Difficulty</h4><div class="seg">' + DIFF_KEYS.map((k) => `<button type="button" data-game="difficulty ${k}" aria-pressed="false">${DIFF[k].label}</button>`).join('') + '</div>' + (typeof HOLO !== 'undefined' ? HOLO.settingsHTML() : '') + (CMB ? CMB.settingsHTML() : '') + (typeof REALMS !== 'undefined' ? REALMS.settingsHTML() : '') + (SBD ? SBD.settingsHTML() : ''),
    syncSettings: (el) => { syncDiffUI(); if (typeof HOLO !== 'undefined') HOLO.sync(); if (CMB) CMB.sync(el); if (SBD) SBD.sync(el); if (typeof REALMS !== 'undefined') REALMS.sync(); },
    get rail() { return rail; }, get debug() { return { s, sHero, sGate, len, nT, nPrim, killed, hull, level, xp, heat, overheated, score, ended, cam, eye, view: shell ? shell.view : 'cockpit', blend: vb }; } };
})();
