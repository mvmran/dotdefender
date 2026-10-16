import { createRng } from './rng.js';
import { NEUTRAL, PERKS } from './game.js';
import { CELL_SIZE } from './map.js';

export const DIFFICULTY = {
  easy: {
    interval: 5.2, // seconds between decisions
    startDelay: 10, // seconds before the first move
    randomMove: 0.45, // chance a decision is a random move instead of a planned one
    margin: 0.35, // extra troops sent on top of the estimated defence (fraction)
    flat: 4, // extra troops sent on top of the estimated defence (absolute)
    noise: 0.5, // randomness in target choice
    maxSources: 2, // regions combined into one attack
    defendChance: 0.4,
    actions: 1, // orders per decision
    reserve: 3, // troops kept at home
    humanBias: 0.75, // >1 means it prefers attacking the human
    // How far troops travel (in cells, ~ one region across). A region next to
    // the sending base is always in reach.
    reach: 2.5,
    // Chance an attack is a strategic strike at an enemy base over 3 cells
    // from the AI's nearest base (with longShotRing, also at regions next to
    // enemy bases), drawing troops from any distance. It only goes ahead when
    // it's worth at least half the best nearby attack.
    longShot: 0,
    longShotRing: false,
    specialBias: 1.2, // how much more it values a special base
    specialDensity: 0.3, // share of the map that is special bases (more on easier levels)
    // Super perk timings (seconds); used by every player in the game.
    perks: { laser: { recharge: 30 }, regen: { duration: 10, recharge: 40 } },
  },
  normal: {
    interval: 2.3,
    startDelay: 3,
    randomMove: 0,
    margin: 0.2,
    flat: 3,
    noise: 0.35,
    maxSources: 3,
    defendChance: 0.7,
    actions: 1,
    reserve: 2,
    humanBias: 0.9,
    reach: 4,
    longShot: 0.4,
    longShotRing: false,
    specialBias: 1.5,
    specialDensity: 0.18,
    perks: { laser: { recharge: 45 }, regen: { duration: 10, recharge: 60 } },
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
    reach: Infinity,
    longShot: 0.4,
    longShotRing: true,
    specialBias: 1.8,
    specialDensity: 0.1,
    perks: { laser: { recharge: 60 }, regen: { duration: 10, recharge: 80 } },
  },
};

const dist = (a, b) => Math.hypot(a.cx - b.cx, a.cy - b.cy);
const FAR = 3 * CELL_SIZE; // a long shot's target is at least this far from the attacker

// Special base types that unlock a super perk once you hold every one.
const PERK_SPECIALS = new Set(Object.values(PERKS).map((p) => p.special));

// Super perk timings for a difficulty, in the shape Game's perkTimes expects.
export function perkTimesFor(difficulty) {
  const p = DIFFICULTY[difficulty] ?? DIFFICULTY.normal;
  return Object.fromEntries(Object.entries(p.perks).map(([perk, times]) => [perk, { ...times }]));
}

export class AIController {
  constructor(game, owner, difficulty = 'normal', seed = owner) {
    this.game = game;
    this.owner = owner;
    this.p = DIFFICULTY[difficulty] ?? DIFFICULTY.normal;
    this.rng = createRng(seed * 7919 + owner);
    this.timer = this.p.startDelay;
    this.reach = this.p.reach * CELL_SIZE;
  }

  // Whether troops from `src` will travel to `t`: within the level's reach,
  // or right next door.
  canReach(src, t, reach = this.reach) {
    return dist(src, t) <= reach || src.neighbors.includes(t.id);
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
    this.useLaser();
    // Built after the laser, which can destroy dots and orders.
    const incoming = g.incomingTable();
    // Only roll when the level has random moves, so other levels play as before.
    if (this.p.randomMove > 0 && this.rng.next() < this.p.randomMove) {
      this.useRegen(incoming, this.randomMove(mine));
      return;
    }

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

    let launched = 0; // troops this decision sends at regions we don't own
    while (actions > 0) {
      // Now and then a strategic strike across the map (see longShot), but
      // only if it is worth at least half the best nearby attack.
      const longShot = this.p.longShot > 0 && this.rng.next() < this.p.longShot;
      let plan = this.bestAttack(mine, incoming, avail);
      const far = longShot && this.bestAttack(mine, incoming, avail, true);
      if (far && (!plan || far.score >= plan.score * 0.5)) plan = far;
      if (!plan) break;
      launched += this.execute(plan, plan.target, avail);
      actions--;
    }

    if (actions > 0) this.consolidate(mine, avail);
    this.useRegen(incoming, launched);
  }

  useLaser() {
    if (!this.game.perkStatus(this.owner, 'laser').ready) return;
    const target = this.laserTarget();
    if (target) this.game.fireLaser(this.owner, target.id);
  }

  // The enemy base the AI would most like to wipe out, or null when none is
  // worth a shot.
  laserTarget() {
    const g = this.game;
    const me = this.owner;
    const enemies = g.regions.filter((r) => r.owner !== me && r.owner !== NEUTRAL);
    if (!enemies.length) return null;
    if (this.p.randomMove > 0 && this.rng.next() < this.p.randomMove) return this.rng.pick(enemies);
    let target = null;
    let best = -1;
    for (const r of enemies) {
      // Don't waste a shot on a nearly empty base.
      if (r.troops < 12 && !r.special) continue;
      let score = r.troops + (r.special ? 25 : 0) + (r.capital ? 10 : 0);
      if (r.owner === g.humanId) score *= this.p.humanBias;
      if (score > best) {
        best = score;
        target = r;
      }
    }
    return target;
  }

  // Super regeneration is worth it only while troops are heading into regions
  // we don't own: those already under way (`incoming`, from before this
  // decision) plus `launched`, the troops this decision just sent.
  useRegen(incoming, launched) {
    const g = this.game;
    const me = this.owner;
    if (!g.perkStatus(me, 'regen').ready) return;
    let attacking = launched;
    for (const r of g.regions) if (r.owner !== me) attacking += incoming[r.id][me];
    if (attacking >= 6) g.activateRegen(me);
  }

  // An unplanned move: a random base sends a random share of its troops to a
  // random region, ignoring threats, odds and distance. Returns the troops
  // sent if the target isn't ours, otherwise 0.
  randomMove(mine) {
    const g = this.game;
    const sources = mine.filter((r) => r.troops >= 2 && !g.orders.has(r.id));
    if (!sources.length) return 0;
    const src = this.rng.pick(sources);
    const targets = g.regions.filter((r) => r.id !== src.id && this.canReach(src, r));
    const target = this.rng.pick(targets);
    const count = Math.max(1, Math.floor(src.troops * this.rng.range(0.3, 1)));
    if (!g.sendCount(this.owner, src.id, target.id, count) || target.owner === this.owner) return 0;
    return count;
  }

  // Picks nearby sources (within `reach`) until `need` troops are covered.
  // Returns null when they cannot cover at least `minFraction` of it.
  gather(target, need, mine, avail, minFraction = 1, reach = this.reach) {
    const sources = mine
      .filter((r) => r.id !== target.id && avail.get(r.id) > 0 && this.canReach(r, target, reach))
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

  // The best target to attack, or null. With `longShot`, only far enemy
  // targets count, and troops may come from any distance.
  bestAttack(mine, incoming, avail, longShot = false) {
    const g = this.game;
    const me = this.owner;
    let best = null;
    for (const t of g.regions) {
      if (t.owner === me) continue;
      let nearest = Infinity;
      for (const r of mine) nearest = Math.min(nearest, dist(r, t));
      if (longShot && !(nearest > FAR && this.isLongShotTarget(t))) continue;
      const travel = nearest / g.speedFor(me);

      let defence = t.troops - incoming[t.id][me];
      if (t.owner !== NEUTRAL) {
        defence += incoming[t.id][t.owner];
        defence += Math.max(0, Math.min(t.cap - t.troops, t.growth * travel));
      }
      const need = Math.ceil(defence * (1 + this.p.margin) + this.p.flat);
      // Enough is already on the way. (A 0-troop neutral, e.g. one the laser
      // left behind, also needs only `flat`, but nothing is on its way there.)
      if (need <= this.p.flat && incoming[t.id][me] > 0) continue;

      const plan = this.gather(t, need, mine, avail, 1, longShot ? Infinity : this.reach);
      if (!plan) continue;

      const noise = 1 + (this.rng.next() * 2 - 1) * this.p.noise;
      const score = (this.targetValue(t) / (need + plan.maxDist * 0.06 + 5)) * noise;
      if (!best || score > best.score) best = { ...plan, target: t, score };
    }
    return best;
  }

  // Enemy territory, or (with longShotRing) a region next to it.
  isLongShotTarget(t) {
    const enemy = (r) => r.owner !== NEUTRAL && r.owner !== this.owner;
    return enemy(t) || (this.p.longShotRing && t.neighbors.some((n) => enemy(this.game.regions[n])));
  }

  // How much the AI wants region `t`, before cost, distance and noise.
  targetValue(t) {
    const g = this.game;
    const me = this.owner;
    let value = t.size * (t.owner === NEUTRAL ? 1 : 1.35);
    if (t.owner === g.humanId) value *= this.p.humanBias;
    if (t.special) {
      value *= this.p.specialBias;
      // Extra pull when this base would complete a set and unlock a super perk.
      const others = g.regions.filter((r) => r.special === t.special && r.id !== t.id);
      if (PERK_SPECIALS.has(t.special) && others.every((r) => r.owner === me)) value *= 1.5;
    }
    if (t.neighbors.some((n) => g.regions[n].owner === me)) value *= 1.4;
    return value;
  }

  // Sends each part of a plan. Returns the troops actually sent.
  execute(plan, target, avail) {
    let sent = 0;
    for (const part of plan.parts) {
      if (this.game.sendCount(this.owner, part.id, target.id, part.count)) {
        avail.set(part.id, 0);
        sent += part.count;
      }
    }
    return sent;
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
