/**
 * Unit icons, drawn rather than shipped.
 *
 * Every nation picks its own colour, so a fixed sprite sheet would need one
 * image per (unit type × colour) — hundreds of files that would still be wrong
 * the moment someone picks a colour nobody anticipated. Instead each icon is
 * painted to a canvas on demand and handed to MapLibre as an image, which means
 * a symbol layer (with its collision handling, zoom scaling and GPU batching)
 * renders them rather than hundreds of DOM markers fighting the map for frames.
 *
 * Icons are cached by id, so the cost is paid once per combination in use.
 */

import { contrastInk, iconId, shade, type Domain, type EchelonMark } from './warGames';

/** Logical size of one icon. Everything below is expressed in these units. */
const W = 50;
const H = 46;
/** The frame sits under a strip reserved for the echelon mark. */
const FRAME = { x: 5, y: 13, w: 40, h: 28 };
const SCALE = 2;

export interface IconSpec {
  typeId: string;
  glyph: string;
  domain: Domain;
  color: string;
  mark: EchelonMark;
}

/* ------------------------------------------------------------------ */
/* Drawing primitives                                                  */
/* ------------------------------------------------------------------ */

interface Pen {
  ctx: CanvasRenderingContext2D;
  /** Frame interior the glyph may use. */
  x: number;
  y: number;
  w: number;
  h: number;
}

const line = (p: Pen, x1: number, y1: number, x2: number, y2: number) => {
  p.ctx.beginPath();
  p.ctx.moveTo(p.x + x1 * p.w, p.y + y1 * p.h);
  p.ctx.lineTo(p.x + x2 * p.w, p.y + y2 * p.h);
  p.ctx.stroke();
};

const poly = (p: Pen, pts: [number, number][], fill = false) => {
  p.ctx.beginPath();
  pts.forEach(([x, y], i) => {
    const px = p.x + x * p.w;
    const py = p.y + y * p.h;
    if (i === 0) p.ctx.moveTo(px, py);
    else p.ctx.lineTo(px, py);
  });
  if (fill) {
    p.ctx.closePath();
    p.ctx.fill();
  } else {
    p.ctx.stroke();
  }
};

const dot = (p: Pen, x: number, y: number, r: number, fill = true) => {
  p.ctx.beginPath();
  p.ctx.arc(p.x + x * p.w, p.y + y * p.h, r, 0, Math.PI * 2);
  if (fill) p.ctx.fill();
  else p.ctx.stroke();
};

const oval = (p: Pen, x: number, y: number, rx: number, ry: number, fill = false) => {
  p.ctx.beginPath();
  p.ctx.ellipse(p.x + x * p.w, p.y + y * p.h, rx * p.w, ry * p.h, 0, 0, Math.PI * 2);
  if (fill) p.ctx.fill();
  else p.ctx.stroke();
};

/** Arc opening downwards, i.e. a dome — the shape air defence and radar share. */
const dome = (p: Pen, x: number, y: number, rx: number, ry: number) => {
  p.ctx.beginPath();
  p.ctx.ellipse(p.x + x * p.w, p.y + y * p.h, rx * p.w, ry * p.h, 0, Math.PI, 0);
  p.ctx.stroke();
};

/** Hull profile shared by every surface ship, drawn from the given baseline. */
const hull = (p: Pen, baseline: number, width = 0.86) => {
  const half = width / 2;
  poly(
    p,
    [
      [0.5 - half, baseline - 0.16],
      [0.5 + half, baseline - 0.16],
      [0.5 + half - 0.1, baseline],
      [0.5 - half + 0.06, baseline],
    ],
    true
  );
};

/** Fixed-wing silhouette: nose at `cx`, swept or straight by `sweep`. */
const plane = (p: Pen, cx: number, cy: number, span: number, sweep: number) => {
  poly(
    p,
    [
      [cx, cy - 0.3],
      [cx + 0.06, cy - 0.05],
      [cx + span, cy + 0.12 + sweep],
      [cx + span, cy + 0.24 + sweep],
      [cx + 0.06, cy + 0.16],
      [cx + 0.05, cy + 0.34],
      [cx + 0.16, cy + 0.42],
      [cx + 0.16, cy + 0.5],
      [cx, cy + 0.44],
      [cx - 0.16, cy + 0.5],
      [cx - 0.16, cy + 0.42],
      [cx - 0.05, cy + 0.34],
      [cx - 0.06, cy + 0.16],
      [cx - span, cy + 0.24 + sweep],
      [cx - span, cy + 0.12 + sweep],
      [cx - 0.06, cy - 0.05],
    ],
    true
  );
};

/** Rotary wing: a rotor disc over a stubby body. */
const rotor = (p: Pen, cy: number) => {
  line(p, 0.08, cy, 0.92, cy);
  dot(p, 0.5, cy, 1.6);
  poly(p, [[0.3, cy + 0.12], [0.66, cy + 0.12], [0.74, cy + 0.34], [0.26, cy + 0.34]], true);
  line(p, 0.74, cy + 0.23, 0.94, cy + 0.23);
};

/** Upward arrow — missiles, rockets and anything that leaves the ground fast. */
const arrowUp = (p: Pen, cx: number, top: number, bottom: number, wide = 0.16) => {
  poly(p, [[cx, top], [cx + wide, top + 0.2], [cx + wide * 0.42, top + 0.2], [cx + wide * 0.42, bottom], [cx - wide * 0.42, bottom], [cx - wide * 0.42, top + 0.2], [cx - wide, top + 0.2]], true);
};

const glyphText = (p: Pen, text: string, size = 11) => {
  p.ctx.save();
  p.ctx.font = `700 ${size}px ui-sans-serif, system-ui, sans-serif`;
  p.ctx.textAlign = 'center';
  p.ctx.textBaseline = 'middle';
  p.ctx.fillText(text, p.x + p.w * 0.5, p.y + p.h * 0.54);
  p.ctx.restore();
};

/* ------------------------------------------------------------------ */
/* Glyphs                                                              */
/* ------------------------------------------------------------------ */

const GLYPHS: Record<string, (p: Pen) => void> = {
  /* ground */
  infantry: (p) => {
    line(p, 0.1, 0.12, 0.9, 0.88);
    line(p, 0.9, 0.12, 0.1, 0.88);
  },
  mech: (p) => {
    line(p, 0.1, 0.12, 0.9, 0.88);
    line(p, 0.9, 0.12, 0.1, 0.88);
    oval(p, 0.5, 0.5, 0.3, 0.22);
  },
  armour: (p) => oval(p, 0.5, 0.5, 0.36, 0.28),
  recon: (p) => line(p, 0.12, 0.88, 0.88, 0.12),
  airborne: (p) => {
    dome(p, 0.5, 0.62, 0.34, 0.36);
    line(p, 0.16, 0.62, 0.84, 0.62);
  },
  marines: (p) => {
    oval(p, 0.5, 0.5, 0.34, 0.26);
    line(p, 0.16, 0.16, 0.84, 0.84);
  },
  sf: (p) => {
    poly(p, [[0.5, 0.08], [0.6, 0.4], [0.92, 0.4], [0.66, 0.6], [0.76, 0.92], [0.5, 0.72], [0.24, 0.92], [0.34, 0.6], [0.08, 0.4], [0.4, 0.4]], true);
  },
  artillery: (p) => dot(p, 0.5, 0.5, 5),
  rocket: (p) => {
    dot(p, 0.5, 0.72, 4);
    arrowUp(p, 0.5, 0.06, 0.5);
  },
  missile: (p) => arrowUp(p, 0.5, 0.08, 0.92, 0.22),
  airdefence: (p) => {
    dome(p, 0.5, 0.86, 0.4, 0.62);
    dot(p, 0.5, 0.8, 3.4);
  },
  engineer: (p) => {
    line(p, 0.12, 0.72, 0.88, 0.72);
    line(p, 0.12, 0.72, 0.12, 0.3);
    line(p, 0.88, 0.72, 0.88, 0.3);
    line(p, 0.12, 0.3, 0.88, 0.3);
  },
  ew: (p) => {
    line(p, 0.5, 0.94, 0.5, 0.4);
    dome(p, 0.5, 0.44, 0.2, 0.2);
    dome(p, 0.5, 0.5, 0.38, 0.36);
  },
  logistics: (p) => {
    poly(p, [[0.12, 0.34], [0.62, 0.34], [0.62, 0.7], [0.12, 0.7]], true);
    poly(p, [[0.66, 0.46], [0.86, 0.46], [0.92, 0.7], [0.66, 0.7]], true);
    dot(p, 0.28, 0.78, 2.2);
    dot(p, 0.78, 0.78, 2.2);
  },
  medical: (p) => {
    poly(p, [[0.4, 0.1], [0.6, 0.1], [0.6, 0.4], [0.9, 0.4], [0.9, 0.6], [0.6, 0.6], [0.6, 0.9], [0.4, 0.9], [0.4, 0.6], [0.1, 0.6], [0.1, 0.4], [0.4, 0.4]], true);
  },
  hq: (p) => {
    line(p, 0.22, 0.94, 0.22, 0.1);
    poly(p, [[0.22, 0.12], [0.84, 0.26], [0.22, 0.44]], true);
  },

  /* air */
  fighter: (p) => plane(p, 0.5, 0.28, 0.4, 0.1),
  strike: (p) => {
    plane(p, 0.5, 0.2, 0.38, 0.1);
    dot(p, 0.32, 0.9, 2);
    dot(p, 0.68, 0.9, 2);
  },
  bomber: (p) => {
    plane(p, 0.5, 0.24, 0.46, 0);
    line(p, 0.3, 0.94, 0.7, 0.94);
  },
  awacs: (p) => {
    plane(p, 0.5, 0.34, 0.42, 0);
    oval(p, 0.5, 0.2, 0.26, 0.1, true);
  },
  tanker: (p) => {
    plane(p, 0.42, 0.3, 0.36, 0);
    line(p, 0.6, 0.72, 0.94, 0.94);
  },
  airlift: (p) => {
    plane(p, 0.5, 0.24, 0.44, 0);
    poly(p, [[0.36, 0.84], [0.64, 0.84], [0.64, 1], [0.36, 1]], true);
  },
  mpa: (p) => {
    plane(p, 0.5, 0.18, 0.42, 0);
    line(p, 0.14, 0.9, 0.86, 0.9);
  },
  uav: (p) => {
    plane(p, 0.5, 0.28, 0.46, -0.04);
    dot(p, 0.5, 0.94, 2.2);
  },
  attackheli: (p) => {
    rotor(p, 0.24);
    arrowUp(p, 0.5, 0.62, 0.98, 0.1);
  },
  heli: (p) => rotor(p, 0.3),

  /* naval */
  carrier: (p) => {
    hull(p, 0.9);
    poly(p, [[0.06, 0.5], [0.94, 0.5], [0.94, 0.62], [0.06, 0.62]], true);
    plane(p, 0.5, 0.02, 0.2, 0.04);
  },
  amphib: (p) => {
    hull(p, 0.86);
    poly(p, [[0.16, 0.44], [0.62, 0.44], [0.62, 0.66], [0.16, 0.66]], true);
    arrowUp(p, 0.8, 0.16, 0.66, 0.12);
  },
  cruiser: (p) => {
    hull(p, 0.88);
    poly(p, [[0.2, 0.44], [0.6, 0.44], [0.6, 0.68], [0.2, 0.68]], true);
    line(p, 0.72, 0.68, 0.72, 0.24);
    line(p, 0.34, 0.44, 0.34, 0.14);
  },
  destroyer: (p) => {
    hull(p, 0.88);
    poly(p, [[0.26, 0.48], [0.6, 0.48], [0.6, 0.68], [0.26, 0.68]], true);
    line(p, 0.42, 0.48, 0.42, 0.18);
  },
  frigate: (p) => {
    hull(p, 0.88, 0.74);
    poly(p, [[0.34, 0.52], [0.62, 0.52], [0.62, 0.68], [0.34, 0.68]], true);
    line(p, 0.48, 0.52, 0.48, 0.26);
  },
  corvette: (p) => {
    hull(p, 0.86, 0.62);
    poly(p, [[0.4, 0.56], [0.62, 0.56], [0.62, 0.68], [0.4, 0.68]], true);
  },
  patrol: (p) => {
    hull(p, 0.8, 0.56);
    line(p, 0.1, 0.9, 0.44, 0.9);
    line(p, 0.56, 0.9, 0.9, 0.9);
  },
  mine: (p) => {
    hull(p, 0.82, 0.7);
    dot(p, 0.5, 0.34, 3.4, false);
    line(p, 0.5, 0.06, 0.5, 0.18);
    line(p, 0.28, 0.34, 0.36, 0.34);
    line(p, 0.64, 0.34, 0.72, 0.34);
  },
  oiler: (p) => {
    hull(p, 0.88, 0.82);
    poly(p, [[0.24, 0.46], [0.76, 0.46], [0.76, 0.68], [0.24, 0.68]], true);
    poly(p, [[0.5, 0.06], [0.62, 0.28], [0.38, 0.28]], true);
  },
  support: (p) => {
    hull(p, 0.88, 0.8);
    poly(p, [[0.42, 0.16], [0.58, 0.16], [0.58, 0.42], [0.84, 0.42], [0.84, 0.58], [0.42, 0.58]], true);
  },
  intel: (p) => {
    hull(p, 0.88, 0.78);
    line(p, 0.5, 0.68, 0.5, 0.28);
    dome(p, 0.5, 0.3, 0.24, 0.2);
    dome(p, 0.5, 0.36, 0.42, 0.34);
  },

  /* subsurface */
  sub: (p) => {
    oval(p, 0.5, 0.62, 0.42, 0.2, true);
    poly(p, [[0.4, 0.42], [0.6, 0.42], [0.6, 0.56], [0.4, 0.56]], true);
    line(p, 0.5, 0.42, 0.5, 0.22);
  },
  ssbn: (p) => {
    oval(p, 0.5, 0.72, 0.42, 0.18, true);
    poly(p, [[0.4, 0.54], [0.58, 0.54], [0.58, 0.66], [0.4, 0.66]], true);
    arrowUp(p, 0.5, 0.06, 0.5, 0.14);
  },
  midget: (p) => {
    oval(p, 0.5, 0.6, 0.3, 0.16, true);
    dot(p, 0.5, 0.32, 2.6);
  },

  /* installations */
  radar: (p) => {
    line(p, 0.5, 0.96, 0.5, 0.56);
    dome(p, 0.5, 0.58, 0.26, 0.24);
    dome(p, 0.5, 0.54, 0.42, 0.4);
    dot(p, 0.5, 0.54, 2);
  },
  sam: (p) => {
    dome(p, 0.5, 0.94, 0.44, 0.66);
    arrowUp(p, 0.5, 0.34, 0.9, 0.12);
  },
  silo: (p) => {
    poly(p, [[0.14, 0.72], [0.86, 0.72], [0.86, 0.96], [0.14, 0.96]], true);
    arrowUp(p, 0.5, 0.06, 0.68, 0.16);
  },
  airbase: (p) => {
    poly(p, [[0.1, 0.86], [0.9, 0.62], [0.9, 0.78], [0.1, 1]], true);
    plane(p, 0.5, 0.02, 0.28, 0.06);
  },
  navalbase: (p) => {
    line(p, 0.5, 0.18, 0.5, 0.86);
    line(p, 0.28, 0.32, 0.72, 0.32);
    dot(p, 0.5, 0.12, 2.6, false);
    p.ctx.beginPath();
    p.ctx.arc(p.x + 0.5 * p.w, p.y + 0.66 * p.h, 0.3 * p.w, Math.PI * 0.1, Math.PI * 0.9);
    p.ctx.stroke();
  },
  command: (p) => {
    line(p, 0.2, 0.96, 0.2, 0.14);
    poly(p, [[0.2, 0.16], [0.8, 0.3], [0.2, 0.46]], true);
    line(p, 0.6, 0.96, 0.86, 0.62);
  },
  depot: (p) => {
    poly(p, [[0.14, 0.32], [0.86, 0.32], [0.86, 0.9], [0.14, 0.9]], true);
    p.ctx.save();
    p.ctx.globalCompositeOperation = 'destination-out';
    line(p, 0.14, 0.9, 0.86, 0.32);
    p.ctx.restore();
  },
};

/* ------------------------------------------------------------------ */
/* Frames                                                              */
/* ------------------------------------------------------------------ */

function framePath(ctx: CanvasRenderingContext2D, domain: Domain) {
  const { x, y, w, h } = FRAME;
  const r = 3;
  ctx.beginPath();
  switch (domain) {
    case 'air':
      // Arch: the classic "in the air" frame, rounded over the top.
      ctx.moveTo(x, y + h);
      ctx.lineTo(x, y + h * 0.45);
      ctx.quadraticCurveTo(x, y, x + w * 0.5, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + h * 0.45);
      ctx.lineTo(x + w, y + h);
      ctx.closePath();
      break;
    case 'sub':
      // The same arch inverted — below the surface.
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + h * 0.55);
      ctx.quadraticCurveTo(x, y + h, x + w * 0.5, y + h);
      ctx.quadraticCurveTo(x + w, y + h, x + w, y + h * 0.55);
      ctx.lineTo(x + w, y);
      ctx.closePath();
      break;
    case 'sea':
      // Hull-like: bow and stern points, so ships read as ships at a glance.
      ctx.moveTo(x, y + h * 0.5);
      ctx.lineTo(x + w * 0.16, y);
      ctx.lineTo(x + w * 0.84, y);
      ctx.lineTo(x + w, y + h * 0.5);
      ctx.lineTo(x + w * 0.84, y + h);
      ctx.lineTo(x + w * 0.16, y + h);
      ctx.closePath();
      break;
    case 'site':
      // Clipped corners: a fixed installation, not something that manoeuvres.
      ctx.moveTo(x + 7, y);
      ctx.lineTo(x + w - 7, y);
      ctx.lineTo(x + w, y + 7);
      ctx.lineTo(x + w, y + h - 7);
      ctx.lineTo(x + w - 7, y + h);
      ctx.lineTo(x + 7, y + h);
      ctx.lineTo(x, y + h - 7);
      ctx.lineTo(x, y + 7);
      ctx.closePath();
      break;
    default:
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
  }
}

/** Size mark above the frame — dots, bars, Xs or a short word. */
function drawMark(ctx: CanvasRenderingContext2D, mark: EchelonMark, color: string) {
  if (mark.kind === 'none') return;
  const cx = W / 2;
  const baseline = FRAME.y - 3;
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';

  if (mark.kind === 'dots') {
    const gap = 6;
    const start = cx - ((mark.n - 1) * gap) / 2;
    for (let i = 0; i < mark.n; i++) {
      ctx.beginPath();
      ctx.arc(start + i * gap, baseline - 3, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (mark.kind === 'bars') {
    const gap = 5;
    const start = cx - ((mark.n - 1) * gap) / 2;
    for (let i = 0; i < mark.n; i++) {
      ctx.beginPath();
      ctx.moveTo(start + i * gap, baseline - 8);
      ctx.lineTo(start + i * gap, baseline);
      ctx.stroke();
    }
  } else if (mark.kind === 'x') {
    const gap = 9;
    const start = cx - ((mark.n - 1) * gap) / 2;
    for (let i = 0; i < mark.n; i++) {
      const x = start + i * gap;
      ctx.beginPath();
      ctx.moveTo(x - 3.2, baseline - 8);
      ctx.lineTo(x + 3.2, baseline);
      ctx.moveTo(x + 3.2, baseline - 8);
      ctx.lineTo(x - 3.2, baseline);
      ctx.stroke();
    }
  } else {
    ctx.font = '700 9px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(mark.text, cx, baseline);
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* Icon factory                                                        */
/* ------------------------------------------------------------------ */

function paint(canvas: HTMLCanvasElement, spec: IconSpec) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.scale(SCALE, SCALE);

  const ink = contrastInk(spec.color);
  const edge = shade(spec.color, luminanceEdge(spec.color));

  // A dark outer rim keeps the chip readable over bright terrain and light
  // basemaps, where a saturated fill alone would dissolve into the background.
  ctx.lineJoin = 'round';
  framePath(ctx, spec.domain);
  ctx.strokeStyle = 'rgba(6, 12, 18, 0.85)';
  ctx.lineWidth = 5;
  ctx.stroke();

  framePath(ctx, spec.domain);
  ctx.fillStyle = spec.color;
  ctx.fill();
  ctx.strokeStyle = edge;
  ctx.lineWidth = 2;
  ctx.stroke();

  drawMark(ctx, spec.mark, spec.color);

  const inset = 7;
  const pen: Pen = {
    ctx,
    x: FRAME.x + inset,
    y: FRAME.y + inset * 0.6,
    w: FRAME.w - inset * 2,
    h: FRAME.h - inset * 1.2,
  };
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const draw = GLYPHS[spec.glyph];
  if (draw) draw(pen);
  else glyphText(pen, spec.glyph.slice(0, 3).toUpperCase());

  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/** Dark colours need a lighter edge than light ones to stay visible. */
function luminanceEdge(color: string): number {
  return contrastInk(color) === '#FFFFFF' ? 0.3 : -0.4;
}

/**
 * Adds every icon the board currently needs to the map, skipping the ones
 * already there. Returns the ids it added, so a caller can tell whether a
 * repaint is warranted.
 */
export function ensureIcons(
  map: { hasImage: (id: string) => boolean; addImage: (id: string, image: ImageData, opts?: { pixelRatio?: number }) => void },
  specs: IconSpec[]
): string[] {
  if (typeof document === 'undefined') return [];
  const canvas = document.createElement('canvas');
  const added: string[] = [];

  for (const spec of specs) {
    const id = iconId(`${spec.typeId}:${markKey(spec.mark)}`, spec.color);
    if (map.hasImage(id)) continue;
    const image = paint(canvas, spec);
    if (!image) continue;
    map.addImage(id, image, { pixelRatio: SCALE });
    added.push(id);
  }
  return added;
}

/** Echelon marks change the icon, so they belong in its identity. */
export function markKey(mark: EchelonMark): string {
  switch (mark.kind) {
    case 'none':
      return 'n';
    case 'text':
      return `t${mark.text}`;
    default:
      return `${mark.kind[0]}${mark.n}`;
  }
}

/** The image id for a unit — must match what `ensureIcons` registered. */
export function unitIconId(typeId: string, mark: EchelonMark, color: string): string {
  return iconId(`${typeId}:${markKey(mark)}`, color);
}

/**
 * A standalone data URL of one icon, for the palette buttons in the panel.
 * The panel is HTML, not canvas, so it needs an <img> rather than a map image.
 */
export function iconDataUrl(spec: IconSpec): string {
  if (typeof document === 'undefined') return '';
  const canvas = document.createElement('canvas');
  paint(canvas, spec);
  return canvas.toDataURL();
}
