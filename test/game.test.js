import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, CONFIG, NEUTRAL, RULES, SPECIALS, resolveRules, isDefaultRules } from '../src/game.js';
import { generateMap, MAP_SIZES } from '../src/map.js';

// Three square regions in a row: 0 | 1 | 2, each 100 wide.
function lineMap() {
  const sq = (x) => [
    { x, y: 0 },
    { x: x + 100, y: 0 },
    { x: x + 100, y: 100 },
    { x, y: 100 },
  ];
  const regions = [0, 1, 2].map((i) => ({
    id: i,
    poly: sq(i * 100),
    cx: i * 100 + 50,
    cy: 50,
    area: 10000,
    neighbors: [i - 1, i + 1].filter((n) => n >= 0 && n <= 2),
    coast: true,
  }));
  return { seed: 1, width: 300, height: 100, bounds: { x0: 0, y0: 0, x1: 300, y1: 100 }, regions };
}

function setup(rules) {
  const game = new Game({ map: lineMap(), players: 2, humanId: 1, seed: 3, rules, specialDensity: 0 });
  const [a, b, c] = game.regions;
  Object.assign(a, { owner: 1, troops: 30, capital: true });
  Object.assign(b, { owner: NEUTRAL, troops: 10, capital: false });
  Object.assign(c, { owner: 2, troops: 5, capital: true });
  return game;
}

const run = (game, seconds) => {
  for (let t = 0; t < seconds; t += 1 / 60) game.step(1 / 60);
};

test('regionAt finds the region under a point', () => {
  const game = setup();
  assert.equal(game.regionAt(150, 50), 1);
  assert.equal(game.regionAt(250, 10), 2);
  assert.equal(game.regionAt(1000, 1000), null);
});

test('cannot send from a region you do not own', () => {
  const game = setup();
  assert.equal(game.send(1, [2], 1, 1), 0);
  assert.equal(game.send(1, [0], 0, 1), 0);
});

test('owned regions grow up to their cap, neutral ones do not', () => {
  const game = setup();
  game.regions[0].troops = 0;
  run(game, 2);
  assert.ok(game.regions[0].troops > 1);
  assert.equal(game.regions[1].troops, 10);
  run(game, 200);
  assert.equal(game.regions[0].troops, game.regions[0].cap);
});

test('a big enough attack captures a neutral region', () => {
  const game = setup();
  game.send(1, [0], 1, 1); // 30 vs 10
  run(game, 0.05);
  assert.ok(game.regions[0].troops < 30, 'troops leave the source');
  run(game, 4);
  const b = game.regions[1];
  assert.equal(b.owner, 1);
  assert.ok(b.troops >= 15 && b.troops <= 25, `troops ${b.troops}`);
  assert.ok(game.events.some((e) => e.type === 'capture' && e.region === 1 && e.to === 1));
});

test('a weak attack only wears the defender down', () => {
  const game = setup();
  game.regions[0].troops = 6;
  game.send(1, [0], 1, 1);
  run(game, 4);
  assert.equal(game.regions[1].owner, NEUTRAL);
  assert.equal(Math.round(game.regions[1].troops), 4);
});

test('ratio sends only part of the troops', () => {
  const game = setup();
  game.send(1, [0], 1, 0.5);
  assert.equal(game.orders.get(0).remaining, 15);
});

test('opposing dots annihilate in the field', () => {
  const game = setup();
  game.regions[1].owner = 1;
  game.regions[2].troops = 20;
  game.regions[1].troops = 20;
  game.sendCount(1, 1, 2, 20);
  game.sendCount(2, 2, 1, 20);
  run(game, 0.6);
  const before = game.dots.length;
  run(game, 1.5);
  // Most dots should have met head-on and destroyed each other.
  const landed = 40 - game.dots.length;
  assert.ok(before > 0);
  assert.ok(game.regions[1].owner === 1 && game.regions[2].owner === 2, 'nobody captured');
  assert.ok(landed > 30, `landed/destroyed ${landed}`);
});

test('reinforcing your own region adds troops', () => {
  const game = setup();
  game.regions[1].owner = 1;
  game.regions[1].troops = 5;
  game.sendCount(1, 0, 1, 10);
  run(game, 3);
  assert.ok(game.regions[1].troops >= 15);
});

test('capturing the last enemy region wins the game', () => {
  const game = setup();
  game.regions[0].troops = 60;
  game.sendCount(1, 0, 2, 60);
  run(game, 8);
  assert.equal(game.status, 'over');
  assert.equal(game.winner, 1);
});

test('losing every region loses the game', () => {
  const game = setup();
  Object.assign(game.regions[0], { troops: 2 });
  Object.assign(game.regions[2], { troops: 40 });
  game.sendCount(2, 2, 0, 40);
  run(game, 10);
  assert.equal(game.status, 'over');
  assert.equal(game.winner, 2);
});

test('orders stop when the source is captured', () => {
  const game = setup();
  game.sendCount(1, 0, 2, 25);
  game.regions[0].owner = 2;
  run(game, 0.2);
  assert.equal(game.orders.size, 0);
  assert.equal(game.dots.filter((d) => d.owner === 1).length, 0);
  assert.ok(CONFIG.dotSpeed > 0);
});

test('resolveRules fills defaults and clamps out-of-range values', () => {
  const r = resolveRules({ regenSpeed: 99, moveSpeed: 'fast', populationLimit: 1 });
  assert.equal(r.regenSpeed, RULES.regenSpeed.max);
  assert.equal(r.moveSpeed, RULES.moveSpeed.default);
  assert.equal(r.populationLimit, RULES.populationLimit.min);
  assert.ok(isDefaultRules(resolveRules()));
  assert.ok(!isDefaultRules(r));
});

test('default rules match the base CONFIG', () => {
  const game = setup();
  assert.equal(game.dotSpeed, CONFIG.dotSpeed);
  assert.equal(game.regions[0].cap, CONFIG.capBase);
  assert.equal(game.regions[0].growth, CONFIG.growthBase);
});

test('regeneration speed scales troop growth', () => {
  const grown = (regenSpeed) => {
    const game = setup({ regenSpeed });
    game.regions[0].troops = 0;
    run(game, 5);
    return game.regions[0].troops;
  };
  const base = grown(1);
  assert.ok(Math.abs(grown(2) - base * 2) < 0.1, `${grown(2)} vs ${base * 2}`);
  assert.ok(Math.abs(grown(0.5) - base / 2) < 0.1);
});

test('movement speed scales how fast dots arrive', () => {
  const arrival = (moveSpeed) => {
    const game = setup({ moveSpeed });
    game.sendCount(1, 0, 1, 1);
    let t = 0;
    while (game.regions[1].troops === 10 && t < 10) {
      game.step(1 / 60);
      t += 1 / 60;
    }
    return t;
  };
  const slow = arrival(1);
  const fast = arrival(2);
  assert.ok(fast < slow * 0.6, `fast ${fast}s vs normal ${slow}s`);
});

test('population limit sets the cap bases grow to', () => {
  const game = setup({ populationLimit: 100 });
  game.regions[0].troops = 0;
  run(game, 200);
  assert.equal(game.regions[0].cap, 100);
  assert.equal(game.regions[0].troops, 100);
});

test('start troops never exceed a low population limit', () => {
  const map = lineMap();
  const game = new Game({ map, players: 2, humanId: 1, seed: 3, rules: { populationLimit: 10 } });
  for (const r of game.regions) if (r.owner !== NEUTRAL) assert.ok(r.troops <= r.cap);
});

// Multiplier from holding one special base.
const BOOST = 1 + SPECIALS.biology.bonus;

test('every special base gives a 50% boost', () => {
  for (const spec of Object.values(SPECIALS)) assert.equal(spec.bonus, 0.5);
});

// Region 1 (the middle one) becomes a special base of the given type.
function setupSpecial(type) {
  const game = setup();
  game.regions[1].special = type;
  game.applyBonuses();
  return game;
}

const capture = (game, regionId, owner) => {
  game.regions[0].troops = 60;
  game.sendCount(owner, 0, regionId, 60);
  run(game, 4);
  assert.equal(game.regions[regionId].owner, owner);
};

test('holding a biology lab speeds up regeneration by 50% on all your bases', () => {
  const game = setupSpecial('biology');
  const before = game.regions[0].growth;
  capture(game, 1, 1);
  assert.ok(Math.abs(game.regions[0].growth - before * BOOST) < 1e-9);
  assert.ok(Math.abs(game.regions[1].growth - game.regions[1].baseGrowth * BOOST) < 1e-9);
  assert.equal(game.regions[2].growth, game.regions[2].baseGrowth, 'enemy unaffected');
});

test('engineering works speed up the dots you send', () => {
  const game = setupSpecial('engineering');
  assert.equal(game.speedFor(1), game.dotSpeed);
  capture(game, 1, 1);
  assert.equal(game.speedFor(1), game.dotSpeed * BOOST);
  game.sendCount(1, 0, 2, 4);
  run(game, 0.05);
  const dot = game.dots.find((d) => d.owner === 1);
  assert.ok(dot.speed >= game.dotSpeed * BOOST * 0.95);
});

test('construction yards raise your population limit', () => {
  const game = setupSpecial('construction');
  const base = game.regions[0].cap;
  capture(game, 1, 1);
  assert.equal(game.regions[0].cap, Math.round(base * BOOST));
});

test('bonuses stack and move to whoever captures the base', () => {
  const game = setup();
  game.regions[1].special = 'biology';
  game.regions[2].special = 'biology';
  game.regions[2].owner = 1;
  game.regions[2].capital = false;
  game.regions[1].owner = 1;
  game.applyBonuses();
  assert.equal(game.bonusFor(1).biology, 1 + 2 * SPECIALS.biology.bonus);
  // Player 2 takes one of them back.
  game.regions[1].owner = 2;
  game.applyBonuses();
  assert.equal(game.bonusFor(1).biology, BOOST);
  assert.equal(game.bonusFor(2).biology, BOOST);
  assert.equal(game.bonusFor(NEUTRAL).biology, 1);
});

test('a plain region you capture inherits your bonuses', () => {
  const game = setup();
  game.regions[2].special = 'biology'; // owned by player 2
  game.applyBonuses();
  game.regions[2].troops = 60;
  game.sendCount(2, 2, 1, 60);
  run(game, 4);
  assert.equal(game.regions[1].owner, 2);
  assert.ok(Math.abs(game.regions[1].growth - game.regions[1].baseGrowth * BOOST) < 1e-9);
});

test('specials are neutral, spread out, never next to a start, and scale with density', () => {
  const count = (density, seed) => {
    const map = generateMap({ regionCount: MAP_SIZES.medium, seed });
    const game = new Game({ map, players: 2, humanId: 1, seed, specialDensity: density });
    const specials = game.regions.filter((r) => r.special);
    for (const r of specials) {
      assert.equal(r.owner, NEUTRAL);
      assert.ok(!r.neighbors.some((n) => game.regions[n].capital), 'next to a start');
      assert.ok(SPECIALS[r.special]);
    }
    for (const type of Object.keys(SPECIALS)) assert.ok(specials.some((r) => r.special === type), `no ${type}`);
    return specials.length;
  };
  for (let seed = 1; seed <= 5; seed++) {
    const easy = count(0.3, seed);
    const hard = count(0.1, seed);
    assert.ok(easy > hard, `seed ${seed}: easy ${easy} vs hard ${hard}`);
  }
  const map = generateMap({ regionCount: MAP_SIZES.medium, seed: 1 });
  const none = new Game({ map, players: 2, humanId: 1, seed: 1, specialDensity: 0 });
  assert.equal(none.regions.filter((r) => r.special).length, 0);
});

test('every team starts with identical stats', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const map = generateMap({ regionCount: MAP_SIZES.medium, seed });
    const game = new Game({ map, players: 4, humanId: 1, seed });
    const starts = game.regions.filter((r) => r.capital);
    assert.deepEqual(starts.map((r) => r.owner).sort(), [1, 2, 3, 4]);
    const [first, ...rest] = starts;
    for (const r of rest) {
      for (const key of ['troops', 'growth', 'cap', 'radius', 'size']) {
        assert.equal(r[key], first[key], `seed ${seed}: ${key} differs (${r[key]} vs ${first[key]})`);
      }
      assert.equal(r.special, null);
    }
    for (let o = 1; o <= 4; o++) assert.deepEqual(game.bonusFor(o), game.bonusFor(1));
    assert.equal(first.growth, CONFIG.growthBase * CONFIG.capitalSize);
    assert.equal(first.cap, Math.round(CONFIG.capBase * CONFIG.capitalSize));
  }
});
