import { createRng } from './rng.js';
import { NEUTRAL } from './game.js';

export const DIFFICULTY = {
  easy: {
    interval: 4.5, // seconds between decisions
    startDelay: 8, // seconds before the first move
    randomMove: 0.4, // chance a decision is a random move instead of a planned one
    margin: 0.35, // extra troops sent on top of the estimated defence (fraction)
    flat: 4, // extra troops sent on top of the estimated defence (absolute)
    noise: 0.5, // randomness in target choice
    maxSources: 2, // regions combined into one attack
    defendChance: 0.45,
    actions: 1, // orders per decision
    reserve: 3, // troops kept at home
    humanBias: 0.9, // >1 means it prefers attacking the human
    specialBias: 1.2, // how much more it values a special base
    specialDensity: 0.3, // share of the map that is special bases (more on easier levels)
  },
  normal: {
    interval: 1.6,
    startDelay: 1.5,
    randomMove: 0,
    margin: 0.2,
    flat: 3,
    noise: 0.2,
    maxSources: 3,
    defendChance: 0.85,
    actions: 1,
    reserve: 2,
    humanBias: 1,
    specialBias: 1.5,
    specialDensity: 0.18,
  },
  hard: {
    interval: 0.9,
    startDelay: 0.8,
    randomMove: 0,
    margin: 0.1,
    flat: 2,
    noise: 0.06,
    maxSources: 4,
    defendChance: 1,
    actions: 2,
    reserve: 1,
    humanBias: 1.15,
    specialBias: 1.8,
    specialDensity: 0.1,
  },
};

const dist = (a, b) => Math.hypot(a.cx - b.cx, a.cy - b.cy);

export class AIController {
  constructor(game, owner, difficulty = 'normal', seed = owner) {
    this.game = game;
    this.owner = owner;
    this.p = DIFFICULTY[difficulty] ?? DIFFICULTY.normal;
    this.rng = createRng(seed * 7919 + owner);
    this.timer = this.p.startDelay;
  }

  update(dt) {
    if (this.game.status !== 'playing') return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = this.p.interval * (0.75 + 0.5 * this.rng.next());
    this.think();
  }

  think() {
    const g = this.game;
    const me = this.owner;
    const mine = g.regions.filter((r) => r.owner === me);
    if (!mine.length) return;
    // Only roll when the level has random moves, so other levels play as before.
    if (this.p.randomMove > 0 && this.rng.next() < this.p.randomMove) {
      this.randomMove(mine);
      return;
    }

    const incoming = g.incomingTable();
    // net: troops a region will have once everything in flight lands.
    const net = new Map();
    const avail = new Map();
    for (const r of mine) {
      const row = incoming[r.id];
      let hostile = 0;
      for (let o = 1; o < row.length; o++) if (o !== me) hostile += row[o];
      const n = r.troops + row[me] - hostile;
      net.set(r.id, n);
      // A base already streaming troops out is left alone.
      const spare = g.orders.has(r.id) ? 0 : Math.floor(Math.min(r.troops, n) - this.p.reserve);
      avail.set(r.id, Math.max(0, spare));
    }

    let actions = this.p.actions;

    if (this.rng.next() < this.p.defendChance) {
      const endangered = mine.filter((r) => net.get(r.id) < 1).sort((a, b) => net.get(a.id) - net.get(b.id));
      for (const r of endangered) {
        if (actions <= 0) break;
        const need = Math.ceil(1 - net.get(r.id)) + 2;
        const plan = this.gather(r, need, mine, avail, 0.5);
        if (plan) {
          this.execute(plan, r, avail);
          actions--;
        }
      }
    }

    while (actions > 0) {
      const plan = this.bestAttack(mine, incoming, avail);
      if (!plan) break;
      this.execute(plan, plan.target, avail);
      actions--;
    }

    if (actions > 0) this.consolidate(mine, avail);
  }

  // An unplanned move: a random base sends a random share of its troops to a
  // random region, ignoring threats, odds and distance.
  randomMove(mine) {
    const g = this.game;
    const sources = mine.filter((r) => r.troops >= 2 && !g.orders.has(r.id));
    if (!sources.length) return false;
    const src = this.rng.pick(sources);
    const targets = g.regions.filter((r) => r.id !== src.id);
    const target = this.rng.pick(targets);
    return g.sendCount(this.owner, src.id, target.id, Math.max(1, Math.floor(src.troops * this.rng.range(0.3, 1))));
  }

  // Picks nearby sources until `need` troops are covered. Returns null when
  // they cannot cover at least `minFraction` of it.
  gather(target, need, mine, avail, minFraction = 1) {
    const sources = mine
      .filter((r) => r.id !== target.id && avail.get(r.id) > 0)
      .sort((a, b) => dist(a, target) - dist(b, target))
      .slice(0, this.p.maxSources);
    const parts = [];
    let total = 0;
    let maxDist = 0;
    for (const s of sources) {
      if (total >= need) break;
      const take = Math.min(avail.get(s.id), need - total);
      parts.push({ id: s.id, count: take });
      total += take;
      maxDist = Math.max(maxDist, dist(s, target));
    }
    if (!parts.length || total < need * minFraction) return null;
    return { parts, total, maxDist };
  }

  bestAttack(mine, incoming, avail) {
    const g = this.game;
    const me = this.owner;
    let best = null;
    for (const t of g.regions) {
      if (t.owner === me) continue;
      let nearest = Infinity;
      for (const r of mine) nearest = Math.min(nearest, dist(r, t));
      const travel = nearest / g.speedFor(me);

      let defence = t.troops - incoming[t.id][me];
      if (t.owner !== NEUTRAL) {
        defence += incoming[t.id][t.owner];
        defence += Math.max(0, Math.min(t.cap - t.troops, t.growth * travel));
      }
      const need = Math.ceil(defence * (1 + this.p.margin) + this.p.flat);
      if (need <= this.p.flat) continue; // enough is already on the way

      const plan = this.gather(t, need, mine, avail);
      if (!plan) continue;

      let value = t.size * (t.owner === NEUTRAL ? 1 : 1.35);
      if (t.owner === g.humanId) value *= this.p.humanBias;
      if (t.special) value *= this.p.specialBias;
      if (t.neighbors.some((n) => g.regions[n].owner === me)) value *= 1.4;
      const noise = 1 + (this.rng.next() * 2 - 1) * this.p.noise;
      const score = (value / (need + plan.maxDist * 0.06 + 5)) * noise;
      if (!best || score > best.score) best = { ...plan, target: t, score };
    }
    return best;
  }

  execute(plan, target, avail) {
    for (const part of plan.parts) {
      if (this.game.sendCount(this.owner, part.id, target.id, part.count)) avail.set(part.id, 0);
    }
  }

  // Moves idle troops from full interior regions toward the front line.
  consolidate(mine, avail) {
    const g = this.game;
    const frontier = mine.filter((r) => r.neighbors.some((n) => g.regions[n].owner !== this.owner));
    if (!frontier.length) return;
    for (const r of mine) {
      if (frontier.includes(r) || r.troops < r.cap * 0.9 || avail.get(r.id) < 5) continue;
      let target = frontier[0];
      for (const f of frontier) if (dist(r, f) < dist(r, target)) target = f;
      g.sendCount(this.owner, r.id, target.id, Math.floor(avail.get(r.id) * 0.8));
      avail.set(r.id, 0);
      return;
    }
  }
}
