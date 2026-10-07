// Colours per owner id. 0 is neutral, 1 is the human, the rest are AIs.
export const PALETTE = [
  { name: 'Neutral', base: '#8f8b83', fill: '#d9d4c8', dot: '#6b675f' },
  { name: 'You', base: '#2f6fed', fill: '#a3c2f8', dot: '#1a47b8' },
  { name: 'Crimson', base: '#e0464b', fill: '#f4b0b2', dot: '#a8232a' },
  { name: 'Amber', base: '#e8920f', fill: '#f6d39c', dot: '#a35f00' },
  { name: 'Jade', base: '#22a06b', fill: '#a3dcc1', dot: '#0f6e45' },
];

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function mix(a, b, t) {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const c = ca.map((v, i) => Math.round(v + (cb[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
