import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMap } from '../src/map.js';
import { Game } from '../src/game.js';
import { AIController } from '../src/ai.js';

function play(diffs, seed, maxTime = 900, rules) {
  const map = generateMap({ regionCount: 20, seed });
  const game = new Game({ map, players: diffs.length, humanId: null, seed, rules });
  const ais = diffs.map((d, i) => new AIController(game, i + 1, d, seed));
  while (game.status === 'playing' && game.time < maxTime) {
    game.step(1 / 60);
    for (const ai of ais) ai.update(1 / 60);
  }
  return game;
}

test('AI expands into neutral territory early on', () => {
  const game = play(['normal', 'normal'], 5, 30);
  assert.ok(game.territory(1) >= 3, `p1 ${game.territory(1)}`);
  assert.ok(game.territory(2) >= 3, `p2 ${game.territory(2)}`);
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
