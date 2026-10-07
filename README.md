# Dot Defender

A browser strategy game in the style of **State.io**. You play against the computer:
each territory on the map has a base that grows an army of little coloured dots.
Drag from your bases to send streams of dots to attack, capture, or reinforce
other regions. Take every enemy base to win.

No frameworks, no build step. It's plain HTML5 Canvas and vanilla JavaScript modules.

## Play

```sh
npm start            # serves the game at http://localhost:5173
```

Any static file server works too (`python3 -m http.server`, GitHub Pages, Netlify…).
Opening `index.html` straight from disk won't work, because browsers block ES modules on `file://`.

### Hosting on GitHub Pages

`.github/workflows/pages.yml` runs the tests and deploys the game on every push to `main`.
One-time setup: in the repo's **Settings → Pages**, set **Source** to **GitHub Actions**.
The game is then live at `https://<user>.github.io/dotdefender/`. To redeploy by hand,
use **Actions → Deploy to GitHub Pages → Run workflow**.

### Controls

| Action | Mouse / touch | Keyboard |
| --- | --- | --- |
| Attack / reinforce | Drag from your base to any region | |
| Attack with several bases | While dragging, sweep over more of your bases | |
| Select, then target | Click your base(s), then click a target | |
| Add to selection | Shift-click | **A** selects all your bases |
| Clear selection | Right-click, or click the sea | **Esc** |
| Troops to send | 25 / 50 / 75 / 100% buttons in the top bar | **1–4** |
| Pause | Pause button | **Space** / **P** |

### Rules

- Owned bases grow troops over time up to a cap (the ring around the base shows how full it is).
  Bigger regions grow faster and hold more. Neutral grey regions don't grow.
- Each dot that reaches an enemy or neutral base removes one defender. When the
  defenders drop below zero, the region is yours, and the leftover dots become its garrison.
- Dots sent to your own region add to its troops.
- Opposing dots that meet in the field destroy each other one for one.
- You lose when you have no regions and no dots left. You win when every opponent is gone.

Each game gets a freshly generated continent (Voronoi regions with a random coastline).
On portrait phone screens the map turns 90° to fill the display.

## Project layout

```
index.html, style.css   page shell, HUD and menus
src/main.js             wiring: menus, settings, game loop (fixed 60 Hz step)
src/game.js             simulation: growth, sending, dot movement, collisions, win/loss
src/ai.js               computer opponent (easy / normal / hard)
src/map.js              procedural map generation
src/geometry.js         Voronoi diagram and polygon helpers
src/render.js           canvas rendering and effects
src/input.js            mouse / touch controls
src/palette.js          player colours
src/rng.js              seeded random numbers
tools/serve.js          zero-dependency dev server
test/                   node:test unit tests
```

The simulation (`game.js`, `ai.js`, `map.js`) has no DOM dependencies, so it runs
headlessly in Node. That's how the tests pit AIs against each other.

## Tweaking

- Game balance (dot speed, growth, caps, collision radius) lives in `CONFIG` in `src/game.js`.
- AI behaviour per difficulty is in `DIFFICULTY` in `src/ai.js`.
- Map sizes are in `MAP_SIZES` in `src/map.js`. Colours are in `src/palette.js`.
- `window.dotdefender.game` in the browser console gives you the live game state.

## Tests

```sh
npm test
```

Requires Node 18+.

## License

GPL-3.0. See [LICENSE](LICENSE).
