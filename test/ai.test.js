import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMap } from '../src/map.js';
import { Game } from '../src/game.js';
import { AIController, DIFFICULTY } from '../src/ai.js';

function play(diffs, seed, maxTime = 900, rules) {
  const map = generateMap({ regionCount: 20, seed });
  const game = new Game({ map, players: diffs.length, humanId: null, seed, rules, specialDensity: DIFFICULTY.normal.specialDensity });
  const ais = diffs.map((d, i) => new AIController(game, i + 1, d, seed));
  while (game.status === 'playing' && game.time < maxTime) {
    game.step(1 / 60);
    for (const ai of ais) ai.update(1 / 60);
  }
  return game;
}

test('AI expands into neutral territory early on', () => {
  // Averaged over several maps so one awkward layout doesn't decide it.
  const seeds = [1, 2, 3, 4, 5, 6];
  const totals = [0, 0];
  for (const seed of seeds) {
    const game = play(['normal', 'normal'], seed, 30);
    totals[0] += game.territory(1);
    totals[1] += game.territory(2);
  }
  for (const t of totals) assert.ok(t / seeds.length >= 3.5, `average ${t / seeds.length} regions`);
});

test('hard AI reliably beats easy AI', () => {
  let hardWins = 0;
  for (let seed = 1; seed <= 6; seed++) if (play(['easy', 'hard'], seed).winner === 2) hardWins++;
  assert.ok(hardWins >= 5, `hard won ${hardWins}/6`);
});

test('AI never sends from regions it does not own', () => {
  const map = generateMap({ regionCount: 20, seed: 8 });
  const game = new Game({ map, players: 3, humanId: null, seed: 8 });
  const ais = [1, 2, 3].map((id) => new AIController(game, id, 'hard', 8));
  for (let i = 0; i < 60 * 60; i++) {
    game.step(1 / 60);
    for (const ai of ais) ai.update(1 / 60);
    for (const o of game.orders.values()) assert.equal(game.regions[o.source].owner, o.owner);
  }
});

test('AI still plays a full game under extreme rules', () => {
  for (const rules of [
    { regenSpeed: 5, moveSpeed: 4, populationLimit: 200 },
    { regenSpeed: 0.25, moveSpeed: 0.25, populationLimit: 10 },
  ]) {
    const game = play(['normal', 'normal'], 3, 120, rules);
    assert.ok(game.territory(1) + game.territory(2) >= 6, JSON.stringify(rules));
  }
});

test('AI goes after special bases', () => {
  let taken = 0;
  let total = 0;
  for (let seed = 1; seed <= 5; seed++) {
    const game = play(['normal', 'normal'], seed, 90);
    const specials = game.regions.filter((r) => r.special);
    total += specials.length;
    taken += specials.filter((r) => r.owner !== 0).length;
  }
  assert.ok(taken / total >= 0.6, `took ${taken}/${total} specials in 90s`);
});

// Counts an AI's decisions and how many were random, over `seconds` of play.
// opponent: difficulty for player 2, or null for one that never moves.
function watch(difficulty, seconds, seed = 2, opponent = 'normal') {
  const map = generateMap({ regionCount: 20, seed });
  const game = new Game({ map, players: 2, humanId: null, seed });
  const ai = new AIController(game, 1, difficulty, seed);
  const other = opponent ? new AIController(game, 2, opponent, seed) : null;
  const log = { thinks: [], random: 0, firstOrder: null };
  const think = ai.think.bind(ai);
  const randomMove = ai.randomMove.bind(ai);
  ai.think = () => {
    log.thinks.push(game.time);
    think();
  };
  ai.randomMove = (mine) => {
    log.random++;
    return randomMove(mine);
  };
  while (game.time < seconds && game.status === 'playing') {
    game.step(1 / 60);
    ai.update(1 / 60);
    other?.update(1 / 60);
    if (log.firstOrder === null && [...game.orders.values()].some((o) => o.owner === 1)) log.firstOrder = game.time;
  }
  return log;
}

test('easy AI waits longer before its first move', () => {
  const easy = watch('easy', 30);
  const normal = watch('normal', 30);
  assert.ok(easy.thinks[0] >= DIFFICULTY.easy.startDelay - 1e-9, `first decision at ${easy.thinks[0]}s`);
  assert.ok(easy.firstOrder >= DIFFICULTY.easy.startDelay - 1e-9);
  assert.ok(easy.thinks[0] > normal.thinks[0] * 3);
});

test('easy AI decides less often', () => {
  const easy = watch('easy', 120);
  const normal = watch('normal', 120);
  const gaps = easy.thinks.slice(1).map((t, i) => t - easy.thinks[i]);
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  assert.ok(Math.abs(mean - DIFFICULTY.easy.interval) < 0.6, `mean gap ${mean}s`);
  assert.ok(easy.thinks.length < normal.thinks.length / 2, `${easy.thinks.length} vs ${normal.thinks.length}`);
});

test('a share of easy AI moves are random; harder levels never are', () => {
  // Pool several games against a passive opponent for a fair sample.
  let thinks = 0;
  let random = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const log = watch('easy', 400, seed, null);
    thinks += log.thinks.length;
    random += log.random;
  }
  assert.ok(thinks >= 80, `only ${thinks} decisions`);
  const share = random / thinks;
  assert.ok(share > 0.25 && share < 0.55, `random share ${share}`);
  assert.equal(watch('normal', 120).random, 0);
  assert.equal(watch('hard', 120).random, 0);
});

test('random moves are always legal orders', () => {
  const map = generateMap({ regionCount: 20, seed: 4 });
  const game = new Game({ map, players: 2, humanId: null, seed: 4 });
  const ai = new AIController(game, 1, 'easy', 4);
  for (let i = 0; i < 200; i++) {
    run(game);
    ai.randomMove(game.regions.filter((r) => r.owner === 1));
    for (const o of game.orders.values()) {
      assert.equal(game.regions[o.source].owner, o.owner);
      assert.notEqual(o.source, o.target);
      assert.ok(o.remaining >= 1);
    }
  }
  function run(g) {
    for (let k = 0; k < 30; k++) g.step(1 / 60);
  }
});

test('normal AI usually beats easy AI', () => {
  let normalWins = 0;
  for (let seed = 1; seed <= 6; seed++) if (play(['easy', 'normal'], seed).winner === 2) normalWins++;
  assert.ok(normalWins >= 5, `normal won ${normalWins}/6`);
});

// Hands every base of `type` to player 1 at the start of a 2-player game.
function giveSet(type, seed = 3) {
  const map = generateMap({ regionCount: 26, seed });
  const game = new Game({ map, players: 2, humanId: null, seed, specialDensity: 0.3, perkTimes: { laserRecharge: 10, regenRecharge: 10 } });
  for (const r of game.regions) if (r.special === type) Object.assign(r, { owner: 1, troops: 20 });
  // A well-stocked enemy base, so there's something worth shooting.
  for (const r of game.regions) if (r.owner === 2) r.troops = 60;
  game.applyBonuses();
  return game;
}

test('AI fires its laser at an enemy once it is charged', () => {
  for (const level of ['easy', 'normal', 'hard']) {
    const game = giveSet('engineering');
    const ais = [new AIController(game, 1, level, 3), new AIController(game, 2, 'normal', 3)];
    let shot = null;
    while (!shot && game.time < 40 && game.status === 'playing') {
      game.step(1 / 60);
      ais.forEach((a) => a.update(1 / 60));
      shot = game.events.find((e) => e.type === 'laser');
      if (!shot) game.events.length = 0;
    }
    assert.ok(shot, `${level} AI never fired`);
    assert.ok(shot.time >= 10, 'not before the first charge');
    assert.equal(shot.owner, 1);
    assert.equal(shot.from, 2, `${level} AI should shoot the enemy`);
  }
});

test('AI uses super regeneration while it is attacking', () => {
  const game = giveSet('biology');
  const ais = [new AIController(game, 1, 'normal', 3), new AIController(game, 2, 'normal', 3)];
  let used = null;
  while (!used && game.time < 60 && game.status === 'playing') {
    game.step(1 / 60);
    ais.forEach((a) => a.update(1 / 60));
    used = game.events.find((e) => e.type === 'regen' && e.owner === 1);
    if (!used) game.events.length = 0;
  }
  assert.ok(used, 'never activated');
  const incoming = game.incomingTable();
  const attacking = game.regions.filter((r) => r.owner !== 1).reduce((n, r) => n + incoming[r.id][1], 0);
  assert.ok(attacking > 0, 'activated with no attack under way');
});
