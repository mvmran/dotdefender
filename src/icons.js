// Icons for special bases as SVG path data in a 24x24 box. The same strings
// draw on the canvas (via Path2D) and in the DOM (inline <svg>).

function gearPath(teeth = 8, outer = 10.5, inner = 7.6, hole = 3.2) {
  const pts = [];
  for (let i = 0; i < teeth * 2; i++) {
    const r = i % 2 ? inner : outer;
    // Each tooth and gap spans two points so teeth have flat tops.
    for (const k of [-0.32, 0.32]) {
      const a = ((i + 0.5 + k) / (teeth * 2)) * Math.PI * 2;
      pts.push(`${(12 + Math.cos(a) * r).toFixed(2)} ${(12 + Math.sin(a) * r).toFixed(2)}`);
    }
  }
  // Even-odd fill punches the centre hole.
  return `M${pts.join('L')}Z M${12 + hole} 12 A${hole} ${hole} 0 1 0 ${12 - hole} 12 A${hole} ${hole} 0 1 0 ${12 + hole} 12Z`;
}

export const ICONS = {
  // Lab flask
  biology: 'M8.5 2h7v2h-1.2v5.1l5.9 9.6c.9 1.5-.2 3.3-1.9 3.3H5.7c-1.7 0-2.8-1.8-1.9-3.3l5.9-9.6V4H8.5z M8.2 15l-2.3 3.8c-.2.4 0 .7.4.7h11.4c.4 0 .6-.3.4-.7L15.8 15z',
  // Gear
  engineering: gearPath(),
  // House
  construction: 'M12 2.5 1.5 11.2l1.6 1.9L4.5 12V21.5h6v-6h3v6h6V12l1.4 1.1 1.6-1.9z',
};

export const ICON_COLORS = {
  biology: '#169a4f',
  engineering: '#7c3aed',
  construction: '#b45309',
};

export function iconSvg(type, size = 16) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path fill="${ICON_COLORS[type]}" fill-rule="evenodd" d="${ICONS[type]}"/></svg>`;
}
