// Geometry helpers: polygon maths and a simple Voronoi diagram built by
// clipping a bounding rectangle with the perpendicular bisectors of every
// other site. O(n^2) but n is small (< 200 sites), and it lets us label each
// polygon edge with the neighbouring site that produced it.

export function polygonArea(poly) {
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

export function polygonCentroid(poly) {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    const cross = p.x * q.y - q.x * p.y;
    a += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  if (Math.abs(a) < 1e-9) {
    const sx = poly.reduce((s, p) => s + p.x, 0);
    const sy = poly.reduce((s, p) => s + p.y, 0);
    return { x: sx / poly.length, y: sy / poly.length };
  }
  a *= 0.5;
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

export function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

// Keeps the part of `poly` where nx*x + ny*y <= c (Sutherland–Hodgman).
// Each vertex carries `e`: the label of the edge from it to the next vertex.
// New edges created along the clip line get `label`.
export function clipByHalfPlane(poly, nx, ny, c, label) {
  const out = [];
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const da = nx * a.x + ny * a.y - c;
    const db = nx * b.x + ny * b.y - c;
    const aIn = da <= 0;
    const bIn = db <= 0;
    if (aIn) out.push(a);
    if (aIn !== bIn) {
      const t = da / (da - db);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, e: aIn ? label : a.e });
    }
  }
  return out;
}

function dedupe(poly, eps = 1e-6) {
  const out = [];
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    // Dropping p removes the zero-length edge p->q; q keeps its own label.
    if (Math.abs(p.x - q.x) > eps || Math.abs(p.y - q.y) > eps) out.push(p);
  }
  return out;
}

// Returns one polygon per site. Edge label -1 means the bounding box.
export function voronoi(sites, bounds) {
  const { x0, y0, x1, y1 } = bounds;
  return sites.map((s, i) => {
    let poly = [
      { x: x0, y: y0, e: -1 },
      { x: x1, y: y0, e: -1 },
      { x: x1, y: y1, e: -1 },
      { x: x0, y: y1, e: -1 },
    ];
    for (let j = 0; j < sites.length && poly.length; j++) {
      if (j === i) continue;
      const o = sites[j];
      const c = (o.x * o.x + o.y * o.y - s.x * s.x - s.y * s.y) / 2;
      poly = clipByHalfPlane(poly, o.x - s.x, o.y - s.y, c, j);
    }
    return dedupe(poly);
  });
}
