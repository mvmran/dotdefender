import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, CONFIG, NEUTRAL } from '../src/game.js';

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

function setup() {
  const game = new Game({ map: lineMap(), players: 2, humanId: 1, seed: 3 });
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
