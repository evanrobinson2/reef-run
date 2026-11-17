# Reef Run

A WebGPU rail shooter: fly a gunship through an asteroid reef, blast rocks, meet neon space whales, and every so often warp reality into another world (deep space, a hollow asteroid, under the sea, inside the body).

**Play it:** https://asteroids.abbies.world (desktop Chrome or Edge with WebGPU).

Made by carpetshark as a non-commercial science project and a celebration of games.

## Built on Abyssal Garden

Reef Run started from [Abyssal Garden](https://github.com/Noniv/abyssal-garden) by Maksymilian Dendura (Noniv), a beautiful single-file WebGPU underwater world. `src/math.js` is copied from it and `src/engine.js` is built on its methods: one shared fog and absorption function for every surface, HDR with MSAA, reversed-Z depth, instancing, bloom and zero per-frame allocations. Its MIT notice is in [LICENSE-abyssal-garden.txt](LICENSE-abyssal-garden.txt) and [THIRD_PARTY.md](THIRD_PARTY.md). Thank you, Noniv.

## Build

No dependencies. Node 18 or later:

```
node build.mjs
```

This writes one self-contained HTML page per scene into `build/` (`reef-run.html` is the game). Serve the folder over HTTP, for example `npx serve build`, and open it in a WebGPU browser.

Music, sound effects and the gunship model are **not** in this repository: some are third-party files that may not be redistributed on their own. The live site has them; a local build runs without them (silent, with the built-in ship).

## Controls

- Mouse: aim (turret free look). Space or click: fire.
- 1 blaster, 2 mining laser. W/S throttle, Shift+W turbo, Shift+S brake.
- Every 10 seconds the next shot fires a Reality Pulse into a new world.
- Settings: difficulty (Super Easy to "Zeke's Finding Religion"), HUD styles, split screen for up to 4 players, sound board and credits.

## Licence

Non-commercial only. Code: PolyForm Noncommercial 1.0.0. Media made for the project: CC BY-NC 4.0. Abyssal Garden-derived parts stay MIT. See [LICENSE.md](LICENSE.md) and [THIRD_PARTY.md](THIRD_PARTY.md).
