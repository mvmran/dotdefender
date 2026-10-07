import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMap, MAP_SIZES } from '../src/map.js';

for (const [name, count] of Object.entries(MAP_SIZES)) {
  test(`${name} map is connected with symmetric neighbours`, () => {
    for (let seed = 1; seed <= 15; seed++) {
      const map = generateMap({ regionCount: count, seed });
      const { regions } = map;
      assert.ok(regions.length >= count * 0.8 && regions.length <= count, `seed ${seed}: ${regions.length} regions`);
      for (const r of regions) {
        assert.ok(r.poly.length >= 3);
        assert.ok(r.neighbors.length >= 1);
        for (const n of r.neighbors) assert.ok(regions[n].neighbors.includes(r.id));
      }
      const seen = new Set([0]);
      const queue = [0];
      while (queue.length) for (const n of regions[queue.shift()].neighbors) if (!seen.has(n)) seen.add(n) && queue.push(n);
      assert.equal(seen.size, regions.length, `seed ${seed} disconnected`);
    }
  });
}

test('maps are deterministic per seed', () => {
  const a = generateMap({ seed: 99 });
  const b = generateMap({ seed: 99 });
  const c = generateMap({ seed: 100 });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});
