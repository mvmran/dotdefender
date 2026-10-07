import { test } from 'node:test';
import assert from 'node:assert/strict';
import { voronoi, polygonArea, polygonCentroid, pointInPolygon, clipByHalfPlane } from '../src/geometry.js';
import { createRng } from '../src/rng.js';

const square = [
  { x: 0, y: 0, e: -1 },
  { x: 10, y: 0, e: -1 },
  { x: 10, y: 10, e: -1 },
  { x: 0, y: 10, e: -1 },
];

test('area and centroid of a square', () => {
  assert.equal(polygonArea(square), 100);
  assert.deepEqual(polygonCentroid(square), { x: 5, y: 5 });
});

test('pointInPolygon', () => {
  assert.ok(pointInPolygon(5, 5, square));
  assert.ok(!pointInPolygon(15, 5, square));
});

test('clipping a square in half labels the new edge', () => {
  const half = clipByHalfPlane(square, 1, 0, 5, 7); // keep x <= 5
  assert.equal(polygonArea(half), 50);
  assert.ok(half.some((p) => p.e === 7));
  assert.ok(half.every((p) => p.x <= 5));
});

test('voronoi cells tile the bounds and contain their site', () => {
  const rng = createRng(42);
  const sites = Array.from({ length: 60 }, () => ({ x: rng.range(0, 800), y: rng.range(0, 500) }));
  const cells = voronoi(sites, { x0: 0, y0: 0, x1: 800, y1: 500 });
  const total = cells.reduce((s, c) => s + polygonArea(c), 0);
  assert.ok(Math.abs(total - 800 * 500) < 1e-3, `area ${total}`);
  cells.forEach((c, i) => assert.ok(pointInPolygon(sites[i].x, sites[i].y, c)));
  // Edge labels are symmetric: if i borders j then j borders i.
  cells.forEach((c, i) => {
    for (const p of c) if (p.e >= 0) assert.ok(cells[p.e].some((q) => q.e === i), `${i} -> ${p.e}`);
  });
});
