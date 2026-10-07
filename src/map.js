import { createRng } from './rng.js';
import { voronoi, polygonArea, polygonCentroid } from './geometry.js';

// Average world-space area of one Voronoi cell. Keeping this constant means
// dot speed and base sizes feel the same on every map size.
const CELL_AREA = 15000;

export const MAP_SIZES = {
  small: 16,
  medium: 26,
  large: 40,
};

// Builds a random continent of `regionCount` territories.
// Extra "water" sites are scattered around the land so the coastline is
// irregular; only land cells are returned.
export function generateMap({ regionCount = MAP_SIZES.medium, seed = 1 } = {}) {
  const rng = createRng(seed);
  const total = Math.ceil(regionCount * 2.4 + 6 * Math.sqrt(regionCount));
  const width = Math.sqrt(total * CELL_AREA * 1.6);
  const height = width / 1.6;

  // Best-candidate sampling gives evenly spread, organic-looking sites.
  const sites = [];
  for (let i = 0; i < total; i++) {
    let best = null;
    let bestD = -1;
    for (let k = 0; k < 14; k++) {
      const c = { x: rng.range(0, width), y: rng.range(0, height) };
      let d = Infinity;
      for (const s of sites) d = Math.min(d, (s.x - c.x) ** 2 + (s.y - c.y) ** 2);
      if (d > bestD) {
        bestD = d;
        best = c;
      }
    }
    sites.push(best);
  }

  // Two rounds of Lloyd relaxation round off the cells.
  const bounds = { x0: 0, y0: 0, x1: width, y1: height };
  let cells = voronoi(sites, bounds);
  for (let it = 0; it < 2; it++) {
    cells.forEach((poly, i) => {
      if (poly.length >= 3) sites[i] = polygonCentroid(poly);
    });
    cells = voronoi(sites, bounds);
  }

  // A wobbly radial falloff decides which cells become land.
  const waves = Array.from({ length: 5 }, () => ({
    fx: rng.range(0.8, 3.2),
    fy: rng.range(0.8, 3.2),
    p: rng.range(0, Math.PI * 2),
    a: rng.range(0.04, 0.13),
  }));
  const shape = (x, y) => {
    const nx = (x / width) * 2 - 1;
    const ny = (y / height) * 2 - 1;
    let v = Math.hypot(nx, ny);
    for (const w of waves) {
      v += w.a * Math.sin(w.fx * nx * Math.PI + w.p) * Math.cos(w.fy * ny * Math.PI + w.p * 0.7);
    }
    return v;
  };

  const touchesBounds = (poly) => poly.some((p) => p.e === -1);
  const candidates = cells
    .map((poly, i) => ({ i, poly, v: shape(sites[i].x, sites[i].y) }))
    .filter((c) => c.poly.length >= 3 && !touchesBounds(c.poly))
    .sort((a, b) => a.v - b.v)
    .slice(0, regionCount);

  // Keep only the largest connected landmass.
  const landSet = new Set(candidates.map((c) => c.i));
  const neighborsOf = (i) => [...new Set(cells[i].map((p) => p.e).filter((e) => e >= 0 && landSet.has(e)))];
  const reached = new Set([candidates[0].i]);
  const queue = [candidates[0].i];
  while (queue.length) {
    for (const n of neighborsOf(queue.shift())) {
      if (!reached.has(n)) {
        reached.add(n);
        queue.push(n);
      }
    }
  }
  const land = candidates.filter((c) => reached.has(c.i));

  const idOf = new Map(land.map((c, id) => [c.i, id]));
  const regions = land.map((c, id) => {
    const poly = c.poly.map((p) => ({ x: p.x, y: p.y }));
    const center = polygonCentroid(poly);
    const neighbors = [];
    let coast = false;
    for (const p of c.poly) {
      if (idOf.has(p.e)) {
        const n = idOf.get(p.e);
        if (!neighbors.includes(n)) neighbors.push(n);
      } else {
        coast = true;
      }
    }
    return { id, poly, cx: center.x, cy: center.y, area: polygonArea(poly), neighbors, coast };
  });

  // Make adjacency symmetric (guards against floating point edge cases).
  for (const r of regions) {
    for (const n of r.neighbors) {
      if (!regions[n].neighbors.includes(r.id)) regions[n].neighbors.push(r.id);
    }
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of regions) {
    for (const p of r.poly) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }

  return {
    seed,
    width,
    height,
    bounds: { x0: minX, y0: minY, x1: maxX, y1: maxY },
    regions,
  };
}
