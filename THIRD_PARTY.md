# Third-party material in Reef Run / Space Garden

These parts keep their own terms. They are not covered by the non-commercial licences in [LICENSE.md](LICENSE.md).

This is not legal advice. If it matters, have a lawyer confirm it.

## Abyssal Garden: MIT

- **What:** Abyssal Garden by Maksymilian Dendura (Noniv), https://github.com/Noniv/abyssal-garden.
- **Used here:** `src/math.js` is copied from it (commit a596354, with the world-grid constants removed). `src/engine.js` is built on its methods.
- **Terms:** MIT. The full copyright and permission notice must stay with any portions derived from it. MIT allows those portions to be combined into a work distributed under non-commercial terms, as long as his notice is kept. His code itself stays MIT: anyone may use those portions under MIT.
- **Where the notice is kept:** below; the credits page (https://asteroids.abbies.world/credits/); and a comment in the deployed `index.html`.

```
MIT License

Copyright (c) 2026 Maksymilian Dendura

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Sound effects: Sonniss GDC Game Audio Bundle

- **What:** the Abbie's World sound catalogue (loaded from abbies.world), and the three rock-burst takes in `sfx/rock-burst-*.mp3` on the live site (not in this repo). Their sound-board names match the catalogue's Sonniss entries `explosion-small`, `ice-crack` and `avalanche`.
- **Terms:** Sonniss's own royalty-free terms (https://sonniss.com/gdc-bundle-license/; summary in `tools/sound-engineer/LICENSE.md`). They may be used in the game, but not passed on as sound effects or used for AI training. They are not covered by CC BY-NC, and nobody may take them from this project.

## Blaster zap: Pixabay

- **What:** `sfx/blaster-zap.mp3` on the live site (not in this repo), trimmed from `ahmed_abdulaal-laser-312360.mp3`. The download record points to cdn.pixabay.com.
- **Terms:** most likely the Pixabay Content License (https://pixabay.com/service/license-summary/). Attribution is not required. The sound may not be sold or redistributed on its own as a standalone file.

## Midjourney and Tripo outputs

- **What:** the concept art (Midjourney), and the gunship model in `models/reef-gunship/` on the live site (not in this repo) (Tripo, generated from carpetshark's Midjourney concept).
- **Terms:** those services' terms at the time of generation. carpetshark's CC BY-NC 4.0 grant covers these only to the extent carpetshark holds rights in them.

## Fonts

Chakra Petch and IBM Plex are loaded from Google Fonts under the SIL Open Font License 1.1.
