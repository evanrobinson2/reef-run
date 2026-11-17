// music-map.js: beat maps for the reality device's music (tools/music-map.py, from the mp3s in preview/space-garden/music/).
// bpm; t0: the first downbeat (s); entries: strong bar lines (s) a track may enter on (the first is the opening).
// Catalogue tracks have no map: they enter at 0 and blend on a half-second grid.
const MUSIC_MAP = {
  soaring: { url: 'music/soaring-melody.mp3', name: 'Soaring Melody', bpm: 139.65, t0: 0.819, dur: 263.65, entries: [16.286, 64.406, 129.712, 177.833, 225.953] },
  pulse: { url: 'music/pulse-circuit-a.mp3', name: 'Pulse Circuit A', bpm: 172.25, t0: 1.271, dur: 111.2, entries: [2.665, 22.171, 41.678, 66.758, 80.691] },
  reimagined: { url: 'music/abbies-world-reimagined-3.mp3', name: 'Abbie\u2019s World Reimagined', bpm: 134.2, t0: 0.534, dur: 232.76, entries: [2.323, 45.244, 61.339, 148.969, 202.621] },
  euphoric: { url: 'music/euphoric-defiance.mp3', name: 'Euphoric Defiance', bpm: 92.25, t0: 2.241, dur: 229.5, entries: [7.445, 41.266, 98.502, 142.729, 197.363] },
};
