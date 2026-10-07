// Mouse / touch controls:
//  - Drag from one of your regions to any region to send troops.
//  - While dragging, sweep over more of your regions to add them as sources.
//  - Or click your region(s) to select them, then click a target.
//  - Shift-click toggles a region in the selection; right-click or a click
//    on the sea clears it.
const DRAG_THRESHOLD = 6; // CSS pixels

export class InputController {
  constructor(canvas, renderer, { getGame, onSend }) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.getGame = getGame;
    this.onSend = onSend;
    this.enabled = false;
    this.reset();

    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointercancel', () => this.cancelGesture());
    canvas.addEventListener('pointerleave', () => {
      if (!this.mode) this.hoverId = null;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  reset() {
    this.selection = new Set();
    this.hoverId = null;
    this.pointer = null;
    this.cancelGesture();
  }

  cancelGesture() {
    this.mode = null; // 'drag' | 'maybeSend' | null
    this.dragActive = false;
    this.downAt = null;
    this.pressed = null;
  }

  // What the renderer needs to draw selection, hover and aim lines.
  get ui() {
    return {
      selection: this.selection,
      hoverId: this.hoverId,
      pointer: this.pointer,
      aiming: this.dragActive || (this.selection.size > 0 && this.mode === null),
    };
  }

  locate(e) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const w = this.renderer.screenToWorld(sx, sy);
    const game = this.getGame();
    return { sx, sy, w, id: game.regionAt(w.x, w.y), game };
  }

  isMine(game, id) {
    return id != null && game.regions[id].owner === game.humanId;
  }

  commit(targetId) {
    const sources = [...this.selection].filter((id) => id !== targetId);
    if (sources.length) this.onSend(sources, targetId);
    this.selection.clear();
  }

  pruneSelection(game) {
    for (const id of this.selection) if (!this.isMine(game, id)) this.selection.delete(id);
  }

  down(e) {
    if (!this.enabled) return;
    const { sx, sy, w, id, game } = this.locate(e);
    this.pruneSelection(game);
    this.pointer = w;
    this.hoverId = id;
    if (e.button === 2) {
      this.selection.clear();
      return;
    }
    if (e.button !== 0) return;
    this.canvas.setPointerCapture?.(e.pointerId);
    this.downAt = { x: sx, y: sy };
    this.pressed = id;

    if (id == null) {
      this.selection.clear();
      return;
    }
    if (this.isMine(game, id)) {
      if (e.shiftKey) {
        if (this.selection.has(id)) this.selection.delete(id);
        else this.selection.add(id);
        return;
      }
      if (this.selection.size && !this.selection.has(id)) {
        // Could be "send selection here" (click) or a fresh drag from here.
        this.mode = 'maybeSend';
      } else {
        this.wasSelected = this.selection.has(id) && this.selection.size === 1;
        if (!this.selection.has(id)) this.selection = new Set([id]);
        this.mode = 'drag';
      }
      return;
    }
    // Clicked a neutral or enemy region with something selected.
    if (this.selection.size) this.commit(id);
  }

  move(e) {
    if (!this.enabled) return;
    const { sx, sy, w, id, game } = this.locate(e);
    this.pointer = w;
    this.hoverId = id;
    if (!this.mode || !this.downAt) return;
    const moved = Math.hypot(sx - this.downAt.x, sy - this.downAt.y) > DRAG_THRESHOLD;
    if (this.mode === 'maybeSend' && moved) {
      this.selection = new Set([this.pressed]);
      this.mode = 'drag';
    }
    if (this.mode === 'drag' && moved) this.dragActive = true;
    if (this.dragActive && this.isMine(game, id)) this.selection.add(id);
  }

  up(e) {
    if (!this.enabled || e.button !== 0) return;
    const { id, game } = this.locate(e);
    this.hoverId = id;
    this.pruneSelection(game);
    if (this.mode === 'maybeSend') {
      this.commit(this.pressed);
    } else if (this.mode === 'drag') {
      if (this.dragActive) {
        if (id != null) this.commit(id);
        else this.selection.clear();
      } else if (this.wasSelected) {
        this.selection.clear(); // second click on a lone selected region deselects
      }
    }
    this.cancelGesture();
  }

  selectAll() {
    const game = this.getGame();
    this.selection = new Set(game.regions.filter((r) => r.owner === game.humanId).map((r) => r.id));
  }
}
