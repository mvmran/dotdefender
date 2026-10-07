# AGENTS.md

Guidance for AI coding agents (and humans) working on Dot Defender, a State.io-style
browser strategy game. See `README.md` for gameplay and controls.

## Commands

```sh
npm test     # node:test suite (Node 18+); must pass before every commit
npm start    # dev server at http://localhost:5173 (PORT env var overrides)
```

There is no build step, linter or bundler. Don't open `index.html` from disk:
browsers block ES modules on `file://`.

## Ground rules

- **No dependencies.** Plain HTML5 Canvas and vanilla ES modules. Don't add npm
  packages, frameworks, TypeScript or a bundler without asking first.
- **Keep asset paths relative** (`style.css`, `src/main.js`, `./game.js`). The game is
  served from a subpath on GitHub Pages (`/dotdefender/`), so absolute paths break it.
- **New runtime files must ship.** The Pages workflow copies only `index.html`,
  `style.css` and `src/`. If you add a top-level asset folder, add it to the
  `cp` line in `.github/workflows/pages.yml`.
- Match the existing style: 2-space indent, single quotes, semicolons, `const` by
  default, short comments that explain *why*.

## Architecture

```
src/main.js      wiring: menus, settings (localStorage), HUD, fixed-step game loop
src/game.js      simulation: growth, send orders, dot movement, collisions, win/loss
src/ai.js        computer opponent; DIFFICULTY presets (easy/normal/hard)
src/map.js       procedural continent: Voronoi cells, Lloyd relaxation, land mask
src/geometry.js  Voronoi via half-plane clipping, polygon helpers
src/render.js    canvas drawing, effects, world<->screen transform
src/input.js     pointer (mouse/touch) gestures -> send commands
src/palette.js   colours per owner id
src/icons.js     special-base icons as SVG path strings (canvas Path2D + inline SVG)
src/rng.js       seeded PRNG (mulberry32)
```

Key boundaries:

- **The simulation is DOM-free.** `game.js`, `ai.js`, `map.js`, `geometry.js` and
  `rng.js` must not touch `window`, `document` or canvas, so they run in Node tests.
  Rendering and input only read game state and call `game.send()` / `game.sendCount()`.
- **Determinism.** All randomness in the simulation goes through `createRng(seed)`.
  Never call `Math.random()` there; only `randomSeed()` picks a fresh seed for a new game.
- **Fixed timestep.** `main.js` steps the game at 1/60 s. `game.step(dt)` and
  `ai.update(dt)` must stay correct for that step size.
- **Two clocks.** `game.time` is simulation time and freezes when a game ends.
  The renderer's effects and colour fades use the separate `animTime` passed to
  `renderer.render(ui, now)`. Don't time visuals off `game.time`.

## Domain model

- Owner ids: `0` = neutral (`NEUTRAL`), `1` = the human (`humanId`), `2..` = AIs.
  `humanId` is `null` for AI-only games (the menu backdrop and the tests).
  `PALETTE` has 5 entries, which caps games at 4 players.
- A region has `poly`, centre `cx/cy`, `neighbors`, `size` (area factor 0.75–1.35)
  and derived `cap`, `growth` and `radius` (set together by `game.setSize`), plus live `owner` and `troops` (a float;
  display with `Math.floor`).
- **Fair starts:** every starting base (`region.capital`) gets `CONFIG.capitalSize`
  rather than its own area, so all teams begin with identical troops, growth, cap
  and radius. `test/game.test.js` enforces this.
- Sending creates an *order* (`game.orders`, keyed by source id) that releases dots
  in waves. A new order from the same source replaces the old one. Orders cancel
  when the source changes owner.
- Each dot is one troop. Landing on your own region adds 1. Landing on another
  removes 1, and below 0 the region flips owner. Opposing dots within
  `collisionRadius` annihilate 1:1.
- `game.incomingTable()` gives per-region, per-owner troops already committed
  (dots in flight plus unreleased orders). The AI relies on it to avoid
  over-sending.
- **Rules** (`RULES` / `resolveRules` in `game.js`) are per-game overrides set from
  the cheat menu: `regenSpeed` and `moveSpeed` multiply `CONFIG.growthBase` and
  `CONFIG.dotSpeed`, and `populationLimit` replaces `CONFIG.capBase`. They apply
  to all players. Read `game.speedFor(owner)`, `region.growth` and `region.cap`, never
  `CONFIG` directly, so the rules and special-base bonuses take effect (the AI
  does this too). To add a
  rule, add it to `RULES` and to `RULE_TEXT` in `main.js`. The menu builds its
  sliders from `RULES`.
- **Special bases** (`SPECIALS` in `game.js`): some neutral regions get
  `region.special` = `biology` | `engineering` | `construction`. Holding one gives
  the owner +50% regeneration, dot speed or population limit on all their bases,
  stacking per base held. Regions keep `baseCap` / `baseGrowth`, and
  `applyBonuses()` recomputes `cap` / `growth` from the owner's bonuses after
  every capture. Dot speed per owner is `game.speedFor(owner)`, fixed when a dot
  is spawned. How many specials a map gets is `specialDensity` (a Game option),
  set per difficulty in `DIFFICULTY`. Easier levels get more. Capture events
  carry `special`, which `main.js` uses for its toast messages.
- Coordinates are world units. The average cell area is constant (`CELL_AREA` in
  `map.js`), so speeds and sizes feel the same on every map size. The renderer
  fits `map.bounds` to the screen and rotates 90° on portrait screens, so always
  convert with `renderer.screenToWorld` / `worldToScreen`, never by hand.

## Balancing

Tunables live in `CONFIG` (`game.js`) and `DIFFICULTY` (`ai.js`). Player-facing
rule ranges live in `RULES` (`game.js`). After changing
them, run `npm test`. `test/ai.test.js` asserts that hard reliably beats easy,
normal usually beats easy, AIs expand early, and that easy keeps its handicaps
(`startDelay`, `interval` and `randomMove`, the share of decisions that are
random moves; only easy has it above 0). For a broader check, simulate many seeded AI-vs-AI games
headlessly with `new Game({ map, players, humanId: null, seed })` and step them in a loop.

## Testing changes

- Unit tests live in `test/*.test.js` (`node:test` + `node:assert/strict`). Add tests
  for rule or AI changes. `test/game.test.js` builds a tiny 3-region map by hand,
  which is the easiest way to test a rule in isolation.
- For UI changes, run the game in a browser and actually play it. In the console,
  `window.dotdefender` exposes `game`, `renderer` and `input`. Headless browser
  checks can use it to find base positions:
  `renderer.worldToScreen(region.cx, region.cy)`.
- Check both a desktop viewport and a portrait phone viewport (the rotated layout).

## Deployment

`.github/workflows/pages.yml` runs the tests, then deploys to GitHub Pages on every
push to `main` (or on manual dispatch). Live site: https://mvmran.github.io/dotdefender/
