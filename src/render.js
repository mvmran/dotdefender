import { PALETTE, mix } from './palette.js';
import { ICONS, ICON_COLORS } from './icons.js';

const CAPTURE_FADE = 0.45;
const TAU = Math.PI * 2;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.view = { scale: 1, rotated: false, a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    this.insets = { top: 64, right: 16, bottom: 40, left: 16 };
    this.effects = [];
    this.game = null;
  }

  setGame(game) {
    this.game = game;
    this.effects = [];
    this.icons = Object.fromEntries(Object.entries(ICONS).map(([k, d]) => [k, new Path2D(d)]));
    this.paths = game.regions.map((r) => {
      const p = new Path2D();
      r.poly.forEach((v, i) => (i ? p.lineTo(v.x, v.y) : p.moveTo(v.x, v.y)));
      p.closePath();
      return p;
    });
    this.land = new Path2D();
    for (const p of this.paths) this.land.addPath(p);
    this.shownOwner = game.regions.map((r) => r.owner);
    this.prevOwner = game.regions.map((r) => r.owner);
    this.changedAt = game.regions.map(() => -Infinity);
    this.resize();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.dpr = dpr;
    this.cssW = w;
    this.cssH = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    if (!this.game) return;
    const b = this.game.map.bounds;
    const pad = 24;
    const { top, right, bottom, left } = this.insets;
    const availW = Math.max(50, w - left - right - pad * 2);
    const availH = Math.max(50, h - top - bottom - pad * 2);
    const bw = b.x1 - b.x0;
    const bh = b.y1 - b.y0;
    // On portrait screens a landscape map is turned 90° so it fills the space.
    const rotated = availH > availW * 1.15 && bw > bh;
    const scale = rotated ? Math.min(availW / bh, availH / bw) : Math.min(availW / bw, availH / bh);
    const x0 = left + pad + (availW - (rotated ? bh : bw) * scale) / 2;
    const y0 = top + pad + (availH - (rotated ? bw : bh) * scale) / 2;
    // screen = M * world, with M = [a c e; b d f] as in ctx.setTransform.
    this.view = rotated
      ? { scale, rotated, a: 0, b: scale, c: -scale, d: 0, e: x0 + b.y1 * scale, f: y0 - b.x0 * scale }
      : { scale, rotated, a: scale, b: 0, c: 0, d: scale, e: x0 - b.x0 * scale, f: y0 - b.y0 * scale };
  }

  screenToWorld(x, y) {
    const { scale, rotated, e, f } = this.view;
    return rotated ? { x: (y - f) / scale, y: (e - x) / scale } : { x: (x - e) / scale, y: (y - f) / scale };
  }

  worldToScreen(x, y) {
    const { a, b, c, d, e, f } = this.view;
    return { x: a * x + c * y + e, y: b * x + d * y + f };
  }

  consumeEvents(now) {
    const g = this.game;
    for (const e of g.events) {
      if (e.type === 'capture') {
        const r = g.regions[e.region];
        this.effects.push({ type: 'ring', x: r.cx, y: r.cy, r: r.radius, color: PALETTE[e.to].base, t0: now, life: 0.7 });
      } else if (e.type === 'clash') {
        this.effects.push({ type: 'spark', x: e.x, y: e.y, t0: now, life: 0.3 });
      }
    }
    g.events.length = 0;
    if (this.effects.length > 400) this.effects.splice(0, this.effects.length - 400);
  }

  // `now` is an animation clock in seconds. It is separate from game time so
  // effects still finish after the game ends.
  render(ui, now) {
    const g = this.game;
    const ctx = this.ctx;
    const { scale, rotated, a, b, c, d, e, f } = this.view;
    const dpr = this.dpr;
    this.consumeEvents(now);

    // Ocean
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const grad = ctx.createRadialGradient(this.cssW / 2, this.cssH / 2, 0, this.cssW / 2, this.cssH / 2, Math.max(this.cssW, this.cssH) * 0.75);
    grad.addColorStop(0, '#2b6c8f');
    grad.addColorStop(1, '#123349');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.cssW, this.cssH);

    ctx.setTransform(dpr * a, dpr * b, dpr * c, dpr * d, dpr * e, dpr * f);
    const px = 1 / scale; // one CSS pixel in world units

    // Coast: soft shadow, surf line and sand under the land.
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 24 * dpr;
    ctx.shadowOffsetY = 6 * dpr;
    ctx.fillStyle = '#e9dfc4';
    ctx.fill(this.land);
    ctx.restore();
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 14 * px;
    ctx.stroke(this.land);
    ctx.strokeStyle = '#e9dfc4';
    ctx.lineWidth = 6 * px;
    ctx.stroke(this.land);

    // Territories, cross-fading colour after a capture.
    g.regions.forEach((r, i) => {
      if (r.owner !== this.shownOwner[i]) {
        this.prevOwner[i] = this.shownOwner[i];
        this.shownOwner[i] = r.owner;
        this.changedAt[i] = now;
      }
      const k = Math.min(1, (now - this.changedAt[i]) / CAPTURE_FADE);
      const to = PALETTE[r.owner].fill;
      ctx.fillStyle = k < 1 ? mix(PALETTE[this.prevOwner[i]].fill, to, k) : to;
      ctx.fill(this.paths[i]);
    });

    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 2 * px;
    for (const p of this.paths) ctx.stroke(p);

    // Selection and target highlight.
    for (const id of ui.selection) {
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.fill(this.paths[id]);
      ctx.strokeStyle = PALETTE[g.regions[id].owner].base;
      ctx.lineWidth = 3.5 * px;
      ctx.stroke(this.paths[id]);
    }
    const targeting = ui.selection.size > 0 && ui.hoverId != null;
    if (targeting && !(ui.selection.has(ui.hoverId) && ui.selection.size === 1)) {
      ctx.save();
      ctx.setLineDash([8 * px, 6 * px]);
      ctx.lineDashOffset = -now * 30 * px;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3 * px;
      ctx.stroke(this.paths[ui.hoverId]);
      ctx.restore();
    } else if (ui.hoverId != null && g.regions[ui.hoverId].owner === g.humanId) {
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fill(this.paths[ui.hoverId]);
    }

    // Aim lines from each selected base.
    if (ui.selection.size && ui.pointer && ui.aiming) {
      const tgt = ui.hoverId != null ? g.regions[ui.hoverId] : null;
      const ex = tgt ? tgt.cx : ui.pointer.x;
      const ey = tgt ? tgt.cy : ui.pointer.y;
      for (const id of ui.selection) {
        if (tgt && id === tgt.id) continue;
        const r = g.regions[id];
        this.arrow(r.cx, r.cy, ex, ey, r.radius + 4 * px, tgt ? tgt.radius + 6 * px : 0, px);
      }
    }

    // Dots, batched per owner.
    const byOwner = PALETTE.map(() => []);
    for (const d of g.dots) byOwner[d.owner].push(d);
    const dotR = Math.max(3.2, 2.4 * px);
    byOwner.forEach((list, owner) => {
      if (!list.length) return;
      ctx.beginPath();
      for (const d of list) {
        ctx.moveTo(d.x + dotR, d.y);
        ctx.arc(d.x, d.y, dotR, 0, TAU);
      }
      ctx.fillStyle = PALETTE[owner].dot;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = dotR * 0.32;
      ctx.stroke();
    });

    // Effects
    this.effects = this.effects.filter((e) => now - e.t0 < e.life);
    for (const e of this.effects) {
      const t = (now - e.t0) / e.life;
      if (e.type === 'ring') {
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r * (1 + t * 2.2), 0, TAU);
        ctx.strokeStyle = e.color;
        ctx.globalAlpha = 1 - t;
        ctx.lineWidth = 4 * px * (1 - t) + px;
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else {
        ctx.beginPath();
        ctx.arc(e.x, e.y, 2 + t * 5, 0, TAU);
        ctx.fillStyle = `rgba(255,250,220,${0.8 * (1 - t)})`;
        ctx.fill();
      }
    }

    // Bases with troop counts and a ring showing how full they are.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const r of g.regions) {
      const pal = PALETTE[r.owner];
      ctx.beginPath();
      ctx.arc(r.cx, r.cy, r.radius, 0, TAU);
      ctx.fillStyle = pal.base;
      ctx.fill();
      ctx.lineWidth = 2.5 * px;
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.stroke();

      if (r.owner !== 0) {
        const frac = Math.min(1, r.troops / r.cap);
        ctx.beginPath();
        ctx.arc(r.cx, r.cy, r.radius + 4 * px, -Math.PI / 2, -Math.PI / 2 + frac * TAU);
        ctx.strokeStyle = r.troops >= r.cap ? '#fff4b8' : 'rgba(255,255,255,0.8)';
        ctx.lineWidth = 2.5 * px;
        ctx.stroke();
      }
      // "Up" on screen, in world space, so the star sits above the base.
      const off = r.radius + 9 * px;
      if (r.capital) this.star(r.cx + (rotated ? -off : 0), r.cy + (rotated ? 0 : -off), 5 * px, pal.base);
      if (r.special) {
        const boff = r.radius + 12 * px;
        this.badge(r.special, r.cx + (rotated ? -boff : 0), r.cy + (rotated ? 0 : -boff), 10 * px, rotated);
      }

      const label = String(Math.floor(r.troops));
      const fontPx = Math.max(10 * px, r.radius * (label.length > 2 ? 0.8 : 0.95));
      ctx.font = `700 ${fontPx}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      ctx.fillStyle = '#ffffff';
      if (rotated) {
        ctx.save();
        ctx.translate(r.cx, r.cy);
        ctx.rotate(-Math.PI / 2); // keep text upright
        ctx.fillText(label, 0, fontPx * 0.04);
        ctx.restore();
      } else {
        ctx.fillText(label, r.cx, r.cy + fontPx * 0.04);
      }
    }
  }

  arrow(x0, y0, x1, y1, startGap, endGap, px) {
    const ctx = this.ctx;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len < startGap + endGap + 4 * px) return;
    const ux = dx / len;
    const uy = dy / len;
    const sx = x0 + ux * startGap;
    const sy = y0 + uy * startGap;
    const ex = x1 - ux * endGap;
    const ey = y1 - uy * endGap;
    const head = 12 * px;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex - ux * head * 0.6, ey - uy * head * 0.6);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 4 * px;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - ux * head - uy * head * 0.55, ey - uy * head + ux * head * 0.55);
    ctx.lineTo(ex - ux * head + uy * head * 0.55, ey - uy * head - ux * head * 0.55);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.fill();
  }

  // White disc with the special base's icon, kept upright on rotated screens.
  badge(type, x, y, r, rotated) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = r * 0.2;
    ctx.strokeStyle = ICON_COLORS[type];
    ctx.stroke();
    ctx.save();
    ctx.translate(x, y);
    if (rotated) ctx.rotate(-Math.PI / 2);
    const k = (r * 1.3) / 24;
    ctx.scale(k, k);
    ctx.translate(-12, -12);
    ctx.fillStyle = ICON_COLORS[type];
    ctx.fill(this.icons[type], 'evenodd');
    ctx.restore();
  }

  star(x, y, r, color) {
    const ctx = this.ctx;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 ? r * 0.45 : r;
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = r * 0.3;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
  }
}
