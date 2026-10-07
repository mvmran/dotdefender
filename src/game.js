import { createRng } from './rng.js';
import { pointInPolygon } from './geometry.js';

export const NEUTRAL = 0;

export const CONFIG = {
  dotSpeed: 85, // world units per second
  releaseInterval: 0.09, // seconds between waves leaving a base
  releaseBatch: 4, // dots per wave
  laneSpacing: 4.5, // sideways spacing of dots within a wave
  collisionRadius: 5, // enemy dots closer than this annihilate
  growthBase: 0.85, // troops per second for an average-sized region
  capBase: 45, // max troops an average-sized region grows to
  overflowDecay: 0.6, // troops per second lost while above cap
  startTroops: 20,
  neutralTroops: [4, 12],
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Gameplay rules a player can change before a game (the cheat menu).
// They apply to every player, AIs included. Speeds are multipliers on CONFIG;
// populationLimit is the troop cap of an average-sized region.
export const RULES = {
  regenSpeed: { label: 'Regeneration speed', min: 0.25, max: 5, step: 0.25, default: 1 },
  moveSpeed: { label: 'Movement speed', min: 0.25, max: 4, step: 0.25, default: 1 },
  populationLimit: { label: 'Population limit', min: 10, max: 200, step: 5, default: CONFIG.capBase },
};

// Fills in defaults and clamps each rule to its allowed range.
export function resolveRules(overrides = {}) {
  const rules = {};
  for (const [key, spec] of Object.entries(RULES)) {
    const v = Number(overrides[key]);
    rules[key] = Number.isFinite(v) ? clamp(v, spec.min, spec.max) : spec.default;
  }
  return rules;
}

// Special neutral bases. Whoever holds one gets a bonus for all their bases;
// each extra base of the same type adds the bonus again.
export const SPECIALS = {
  biology: { name: 'Biology lab', bonus: 0.25, effect: 'regeneration speed' },
  engineering: { name: 'Engineering works', bonus: 0.25, effect: 'movement speed' },
  construction: { name: 'Construction yard', bonus: 0.25, effect: 'population limit' },
};
const SPECIAL_GARRISON = 1.5; // specials start better defended than plain neutrals

export const isDefaultRules = (rules) => Object.entries(RULES).every(([k, spec]) => rules[k] === spec.default);

// Picks spread-out start regions: the first is the one farthest from the
// middle of the map, each next one maximises distance to those already taken.
function pickStarts(regions, count, rng) {
  const mx = regions.reduce((s, r) => s + r.cx, 0) / regions.length;
  const my = regions.reduce((s, r) => s + r.cy, 0) / regions.length;
  const d2 = (a, x, y) => (a.cx - x) ** 2 + (a.cy - y) ** 2;
  // Prefer regions that are not tiny so starts are fair.
  const pool = regions.filter((r) => r.size >= 0.9);
  const candidates = pool.length >= count ? pool : regions;
  const sorted = [...candidates].sort((a, b) => d2(b, mx, my) - d2(a, mx, my));
  const starts = [sorted[rng.int(0, Math.min(2, sorted.length - 1))]];
  while (starts.length < count) {
    let best = null;
    let bestD = -1;
    for (const r of candidates) {
      if (starts.includes(r)) continue;
      const d = Math.min(...starts.map((s) => d2(r, s.cx, s.cy)));
      if (d > bestD) {
        bestD = d;
        best = r;
      }
    }
    starts.push(best);
  }
  // Shuffle so the human does not always get the same corner.
  for (let i = starts.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [starts[i], starts[j]] = [starts[j], starts[i]];
  }
  return starts;
}

export class Game {
  // players: number of non-neutral owners (ids 1..players).
  // humanId: owner id controlled by the mouse, or null for AI-only games.
  // rules: optional overrides, see RULES.
  // specialDensity: share of regions that become special bases (see SPECIALS).
  constructor({ map, players = 2, humanId = 1, seed = 1, rules = {}, specialDensity = 0.18 }) {
    this.map = map;
    this.rules = resolveRules(rules);
    this.dotSpeed = CONFIG.dotSpeed * this.rules.moveSpeed;
    this.rng = createRng(seed ^ 0x9e3779b9);
    this.playerCount = players + 1; // including neutral
    this.humanId = humanId;
    this.time = 0;
    this.status = 'playing';
    this.winner = null;
    this.dots = [];
    this.orders = new Map(); // sourceId -> pending release
    this.events = [];
    this.stats = Array.from({ length: this.playerCount }, () => ({ sent: 0, captured: 0, lost: 0, peak: 0 }));

    const meanArea = map.regions.reduce((s, r) => s + r.area, 0) / map.regions.length;
    this.regions = map.regions.map((r) => {
      const size = clamp(Math.sqrt(r.area / meanArea), 0.75, 1.35);
      return {
        ...r,
        size,
        baseCap: Math.max(1, Math.round(this.rules.populationLimit * size)),
        baseGrowth: CONFIG.growthBase * this.rules.regenSpeed * size,
        special: null,
        radius: 10 + 9 * size,
        owner: NEUTRAL,
        troops: Math.round(this.rng.range(...CONFIG.neutralTroops) * size),
      };
    });

    const starts = pickStarts(this.regions, players, this.rng);
    starts.forEach((r, i) => {
      r.owner = i + 1;
      r.capital = true;
    });
    this.placeSpecials(specialDensity);
    this.applyBonuses();
    for (const r of starts) r.troops = Math.min(CONFIG.startTroops, r.cap);
  }

  // Turns a few neutral regions into special bases, spread across the map
  // and never right next to a starting region.
  placeSpecials(density) {
    const types = Object.keys(SPECIALS);
    const perType = density > 0 ? Math.max(1, Math.round((this.regions.length * density) / types.length)) : 0;
    const nearStart = (r) => r.neighbors.some((n) => this.regions[n].capital);
    const pool = this.regions.filter((r) => r.owner === NEUTRAL && !nearStart(r));
    const chosen = [];
    const d2 = (a, b) => (a.cx - b.cx) ** 2 + (a.cy - b.cy) ** 2;
    for (let i = 0; i < perType * types.length && pool.length; i++) {
      // Best of a few random candidates: the one farthest from other specials.
      let best = null;
      let bestD = -1;
      for (let k = 0; k < 6; k++) {
        const c = pool[this.rng.int(0, pool.length - 1)];
        const d = chosen.length ? Math.min(...chosen.map((o) => d2(c, o))) : 0;
        if (d > bestD) {
          bestD = d;
          best = c;
        }
      }
      best.special = types[i % types.length];
      best.troops = Math.round(best.troops * SPECIAL_GARRISON);
      chosen.push(best);
      pool.splice(pool.indexOf(best), 1);
    }
  }

  // Multipliers an owner gets from the special bases they hold.
  bonusFor(owner) {
    const b = { biology: 1, engineering: 1, construction: 1 };
    if (owner === NEUTRAL) return b;
    for (const r of this.regions) if (r.owner === owner && r.special) b[r.special] += SPECIALS[r.special].bonus;
    return b;
  }

  // Effective dot speed for an owner, including engineering bonuses.
  speedFor(owner) {
    return this.dotSpeed * this.bonusFor(owner).engineering;
  }

  // Recomputes every region's cap and growth from its owner's bonuses.
  // Called whenever a region changes hands.
  applyBonuses() {
    const bonuses = Array.from({ length: this.playerCount }, (_, o) => this.bonusFor(o));
    for (const r of this.regions) {
      const b = bonuses[r.owner];
      r.cap = Math.max(1, Math.round(r.baseCap * b.construction));
      r.growth = r.baseGrowth * b.biology;
    }
  }

  regionAt(x, y) {
    for (const r of this.regions) {
      if (pointInPolygon(x, y, r.poly)) return r.id;
    }
    // Forgiving fallback for clicks just off the coast.
    let best = null;
    let bestD = Infinity;
    for (const r of this.regions) {
      const d = Math.hypot(r.cx - x, r.cy - y);
      if (d < r.radius + 14 && d < bestD) {
        bestD = d;
        best = r.id;
      }
    }
    return best;
  }

  // Queue `count` troops to stream from one source to a target.
  // A new order from the same source replaces the old one (redirect).
  sendCount(owner, sourceId, targetId, count) {
    const src = this.regions[sourceId];
    if (!src || !this.regions[targetId] || src.owner !== owner || sourceId === targetId) return false;
    const n = Math.min(Math.floor(count), Math.floor(src.troops));
    if (n < 1) return false;
    this.orders.set(sourceId, { owner, source: sourceId, target: targetId, remaining: n, timer: 0 });
    return true;
  }

  // Send a fraction of the troops from each source.
  send(owner, sourceIds, targetId, ratio = 1) {
    let sent = 0;
    for (const id of sourceIds) {
      const src = this.regions[id];
      if (!src) continue;
      if (this.sendCount(owner, id, targetId, Math.max(1, Math.floor(src.troops * ratio)))) sent++;
    }
    return sent;
  }

  // Troops already committed toward each region, per owner:
  // dots in flight plus troops still waiting to leave a base.
  incomingTable() {
    const table = this.regions.map(() => new Float64Array(this.playerCount));
    for (const d of this.dots) if (d.alive) table[d.target][d.owner] += 1;
    for (const o of this.orders.values()) table[o.target][o.owner] += o.remaining;
    return table;
  }

  step(dt) {
    if (this.status !== 'playing') return;
    this.time += dt;
    this.grow(dt);
    this.release(dt);
    this.moveDots(dt);
    this.collide();
    this.dots = this.dots.filter((d) => d.alive);
    this.checkStatus();
  }

  grow(dt) {
    for (const r of this.regions) {
      if (r.owner === NEUTRAL) continue;
      if (r.troops < r.cap) r.troops = Math.min(r.cap, r.troops + r.growth * dt);
      else if (r.troops > r.cap) r.troops = Math.max(r.cap, r.troops - CONFIG.overflowDecay * dt);
    }
  }

  release(dt) {
    for (const [id, o] of this.orders) {
      const src = this.regions[id];
      if (src.owner !== o.owner) {
        this.orders.delete(id);
        continue;
      }
      o.timer -= dt;
      if (o.timer > 0) continue;
      o.timer += CONFIG.releaseInterval;
      const n = Math.min(CONFIG.releaseBatch, o.remaining, Math.floor(src.troops));
      if (n > 0) {
        this.spawnWave(src, this.regions[o.target], o.owner, n);
        src.troops -= n;
        o.remaining -= n;
        this.stats[o.owner].sent += n;
      }
      if (n <= 0 || o.remaining <= 0) this.orders.delete(id);
    }
  }

  spawnWave(src, dst, owner, n) {
    const speed = this.speedFor(owner);
    const dx = dst.cx - src.cx;
    const dy = dst.cy - src.cy;
    const dist = Math.hypot(dx, dy) || 1;
    const ux = dx / dist;
    const uy = dy / dist;
    for (let k = 0; k < n; k++) {
      const offset = (k - (n - 1) / 2) * CONFIG.laneSpacing + this.rng.range(-1, 1);
      const d = {
        owner,
        target: dst.id,
        sx: src.cx,
        sy: src.cy,
        ux,
        uy,
        dist,
        offset,
        traveled: src.radius * 0.6,
        speed: speed * this.rng.range(0.95, 1.05),
        x: src.cx,
        y: src.cy,
        alive: true,
      };
      this.place(d);
      this.dots.push(d);
    }
  }

  place(d) {
    // Dots fan out after leaving a base and converge again on arrival.
    const taper = Math.max(0, Math.min(1, d.traveled / 25, (d.dist - d.traveled) / 35));
    const off = d.offset * taper;
    d.x = d.sx + d.ux * d.traveled - d.uy * off;
    d.y = d.sy + d.uy * d.traveled + d.ux * off;
  }

  moveDots(dt) {
    for (const d of this.dots) {
      if (!d.alive) continue;
      d.traveled += d.speed * dt;
      const target = this.regions[d.target];
      if (d.traveled >= d.dist - target.radius * 0.6) {
        d.alive = false;
        this.arrive(d, target);
      } else {
        this.place(d);
      }
    }
  }

  arrive(d, target) {
    if (target.owner === d.owner) {
      target.troops += 1;
      return;
    }
    target.troops -= 1;
    if (target.troops < 0) {
      const from = target.owner;
      target.owner = d.owner;
      target.troops = -target.troops;
      this.orders.delete(target.id);
      this.stats[d.owner].captured += 1;
      if (from !== NEUTRAL) this.stats[from].lost += 1;
      this.applyBonuses(); // the region now uses its new owner's bonuses
      this.events.push({ type: 'capture', region: target.id, from, to: d.owner, special: target.special, time: this.time });
    }
  }

  // Opposing dots that touch destroy each other one-for-one.
  collide() {
    const r = CONFIG.collisionRadius;
    const r2 = r * r;
    const cell = r * 2;
    const grid = new Map();
    const key = (gx, gy) => gx * 65536 + gy;
    let clashes = 0;
    for (const d of this.dots) {
      if (!d.alive) continue;
      const gx = Math.floor(d.x / cell);
      const gy = Math.floor(d.y / cell);
      let hit = null;
      for (let ox = -1; ox <= 1 && !hit; ox++) {
        for (let oy = -1; oy <= 1 && !hit; oy++) {
          const bucket = grid.get(key(gx + ox, gy + oy));
          if (!bucket) continue;
          for (const e of bucket) {
            if (e.alive && e.owner !== d.owner && (e.x - d.x) ** 2 + (e.y - d.y) ** 2 < r2) {
              hit = e;
              break;
            }
          }
        }
      }
      if (hit) {
        hit.alive = false;
        d.alive = false;
        if (clashes++ < 40) {
          this.events.push({ type: 'clash', x: (hit.x + d.x) / 2, y: (hit.y + d.y) / 2, time: this.time });
        }
      } else {
        const k = key(gx, gy);
        const bucket = grid.get(k);
        if (bucket) bucket.push(d);
        else grid.set(k, [d]);
      }
    }
  }

  // Owners that still have territory or troops in play.
  aliveOwners() {
    const alive = new Set();
    for (const r of this.regions) if (r.owner !== NEUTRAL) alive.add(r.owner);
    for (const d of this.dots) if (d.alive) alive.add(d.owner);
    return alive;
  }

  territory(owner) {
    return this.regions.reduce((n, r) => n + (r.owner === owner ? 1 : 0), 0);
  }

  troops(owner) {
    let t = 0;
    for (const r of this.regions) if (r.owner === owner) t += r.troops;
    for (const d of this.dots) if (d.alive && d.owner === owner) t += 1;
    return Math.floor(t);
  }

  checkStatus() {
    const alive = this.aliveOwners();
    for (const id of alive) {
      const s = this.stats[id];
      s.peak = Math.max(s.peak, this.territory(id));
    }
    if (this.humanId != null && !alive.has(this.humanId)) {
      this.status = 'over';
      this.winner = alive.size === 1 ? [...alive][0] : null;
    } else if (alive.size <= 1) {
      this.status = 'over';
      this.winner = alive.size === 1 ? [...alive][0] : null;
    }
  }
}
