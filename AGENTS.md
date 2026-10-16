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
test/            node:test suites (game, ai, map, geometry)
tools/serve.js   zero-dependency static dev server (`npm start`)
.github/workflows/pages.yml   test, then deploy to GitHub Pages
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
- **Super perks** (`PERKS` in `game.js`): holding *every* special base of a type
  unlocks a perk: `laser` (engineering) and `regen` (biology). Each `PERKS` entry
  holds the per-perk data (special type, names, HUD label, hotkey, default
  `recharge` and `duration`), and the shared plumbing (state, unlocking, the HUD
  loop, hotkeys, help timings) loops over it. The effects stay per perk
  (`fireLaser`, `activateRegen`, `usePerk` in `main.js`, the AI, render effects),
  and `index.html` needs a `#<perk>-btn` button for each perk.
  State lives in `game.perkState[owner][perk]` (`held`, `readyAt`, `activeUntil`,
  times in `game.time`). Only `applyBonuses()` updates `held`. Read state through
  `hasPerk`, `perkStatus(owner, perk)` and `perkActive(owner, perk)`. A newly
  unlocked perk charges once before first use, so an early grab can't win
  instantly (Hard maps have one base of each type). Losing the set ends a running
  effect at once, and its recharge counts from then.
  `fireLaser(owner, regionId)` makes any region neutral with 0 troops and kills
  dots inside it. `activateRegen(owner)` makes captures fill to `cap` while it
  lasts. Both start the recharge via `startPerk()`. Timings come from the
  `perkTimes` Game option (`{ laser: { recharge }, regen: { recharge, duration } }`),
  set per difficulty in `DIFFICULTY[level].perks` (use `perkTimesFor(level)`).
  `applyBonuses()` emits `perk` events on gain or loss. There are also `laser`
  and `regen` events, and capture events carry `regen`. The AI uses perks in
  `AIController.useLaser` / `laserTarget` and `useRegen`.
- **Computer opponent** (`AIController` in `ai.js`). Every `interval` seconds
  `think()` runs:
  1. `useLaser()` fires a ready laser via `laserTarget()`. Bases under 12
     troops aren't worth it unless they're special.
  2. Builds `incoming` once.
  3. On Easy it may make a `randomMove()` instead of planning.
  4. Otherwise it defends endangered bases, attacks via `bestAttack()`, then
     `consolidate()`s idle troops toward the front.
  5. Last, `useRegen(incoming, launched)` counts the troops this decision just
     sent.

  Targets are scored by `targetValue()`. Specials score higher, and more again
  if taking one would complete a perk set. A 0-troop neutral (for example one
  the laser left behind) is always worth attacking: don't skip a target as
  "enough on the way" unless something actually is on the way. The levels
  differ through `DIFFICULTY`:
  - Speed: `interval` and `startDelay`.
  - Mistakes: `randomMove`, `noise` and `defendChance`.
  - Commitment: `margin`, `flat`, `maxSources`, `actions` and `reserve`.
  - Preferences: `humanBias` and `specialBias`.
  - Distance: `reach`, the farthest troops travel to an ordinary target (a
    neighbouring region is always in reach). `longShot` is the chance of a
    strategic strike at distant enemy bases, plus the regions around them with
    `longShotRing`. A strike only goes ahead when it's worth at least half the
    best nearby attack.

  Easy reaches 2.5 cells with no strikes, Normal reaches 4 cells and sometimes
  strikes enemy bases, and Hard has unlimited reach and strikes most.
- Coordinates are world units. The average cell area is constant (`CELL_AREA` in
  `map.js`), so speeds and sizes feel the same on every map size. The renderer
  fits `map.bounds` to the screen and rotates 90° on portrait screens, so always
  convert with `renderer.screenToWorld` / `worldToScreen`, never by hand.

## Browser UI (`main.js`, `render.js`, `index.html`, `style.css`)

- **No needless DOM writes per frame.** `updateHud()` runs every frame. It writes
  text through `setText()`, only when the text changed, and rebuilds the power
  bar and bonus chips only when their key changes. Keep it that way: blind
  per-frame writes restyle the HUD 60 times a second.
- **Layout.** A `ResizeObserver` on `#hud` calls `layout()`, which places the map
  (`renderer.insets.top`) and the `#toasts` stack below the HUD. Assigning
  `canvas.width/height` clears the canvas, even to the same value, so
  `renderer.resize()` only does it when the size really changes.
- **Help text reads the game.** `index.html` doesn't hard-code numbers.
  `[data-bonus]`, `[data-perk-recharge]` and `[data-perk-duration]` are filled
  from `SPECIALS` and `perkTimesFor(difficulty)` (`syncHelp()` re-runs when the
  menu changes). In flex rows such as `.legend`, wrap the text in one span, or
  the flex gap splits sentences into columns.
- **Messages** go through `toast(html)`. Toasts stack (up to 3) instead of
  replacing each other, because one frame can raise several.
- **Colours** for perks come from `ICON_COLORS` (`icons.js`). The renderer
  imports them, and CSS gets them through `--perk-color` on each perk button.
  Don't copy hex values.
- **Keys** only apply while a human game is playing or paused, and ignore
  auto-repeat. That way holding Space or L doesn't flicker pause or aiming.
  Laser aiming (`input.targeting`) is cancelled when the laser stops being
  usable, the game ends, or the player goes to the menu.

## Balancing

- Tunables live in `CONFIG` (`game.js`) and `DIFFICULTY` (`ai.js`).
  Player-facing rule ranges live in `RULES` (`game.js`). Distances in
  `DIFFICULTY` (`reach`) are in cells: `CELL_SIZE` in `map.js`, about one
  region across. A medium map is about 10 cells corner to corner.
- `test/ai.test.js` asserts:
  - Hard reliably beats Easy, and Normal usually does.
  - AIs expand early.
  - Easy keeps its handicaps: `startDelay`, `interval` and `randomMove` (only
    Easy has random moves).
  - Easy troops never travel more than 3 cells.
  - Long strikes at enemy bases go Easy (none) < Normal < Hard.
- Unit tests don't show how much stronger or weaker a change made a level. To
  measure that, export the old code (`git archive <commit> src | tar -x -C
  <dir>`) and play the old AI against the new one at the same level. Run
  headless 1v1 games on the same seeds, with both seats swapped:
  `new Game({ map, players: 2, humanId: null, seed, specialDensity, perkTimes })`,
  stepped at 1/60 s. A mirror match comes out near 50%. The last tuning
  targeted about 75–80% for the old AI when making a level easier. Also check
  the cross-level ordering (Hard > Normal > Easy) and that no game stalls
  until the time cap.

## Testing changes

- Unit tests live in `test/*.test.js` (`node:test` + `node:assert/strict`). Add tests
  for rule or AI changes. `test/game.test.js` builds a tiny 3-region map by hand,
  which is the easiest way to test a rule in isolation.
- For UI changes, run the game in a browser and actually play it. In the console,
  `window.dotdefender` exposes `game`, `renderer` and `input`. Headless browser
  checks can use it to find base positions:
  `renderer.worldToScreen(region.cx, region.cy)`.
- Check a desktop viewport, a portrait phone (the rotated map) and a landscape
  phone (the compact HUD). Fill the HUD (cheats on, every special base held, both
  perks) and make sure nothing is off-screen. The HUD wraps on smaller screens,
  so anything in it that changes width mid-game can re-wrap it and move the map.
  That's why perk buttons keep one width in every state. `layout()` in `main.js`
  also only moves the map down during a game, never back up.

## Deployment

`.github/workflows/pages.yml` runs the tests, then deploys to GitHub Pages on every
push to `main` (or on manual dispatch). Live site: https://mvmran.github.io/dotdefender/
