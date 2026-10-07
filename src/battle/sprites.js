// Tiny pixel figures drawn from text grids. One letter per pixel; "." is empty.
// Palette letters: s skin, h hair, b body (team tint), l legs, w weapon, a accent, o outline-ish dark.
// Figures are 7 wide and 10 tall so a head, two hands and two feet read at small sizes.

const BASE = [
  "..hhh..",
  ".hsssh.",
  ".ssoss.",
  "..sss..",
  ".sbbbs.",
  "sbbbbbs",
  ".bbbbb.",
  "..lll..",
  "..l.l..",
  ".ol.lo.",
];

// Per class: a few pixels on top of the base body plus a weapon drawn beside it.
const CLASS_LAYERS = {
  warrior: ["..hhh..", ".hsssh.", ".ssoss.", "..sss..", ".sbbbsw", "sbbbbbw", ".bbbbbw", "..lll..", "..l.l..", ".ol.lo."],
  archer: ["..aaa..", ".asssa.", ".ssoss.", "..sss..", "wsbbbs.", "wbbbbbs", "wbbbbb.", "..lll..", "..l.l..", ".ol.lo."],
  mage: ["...a...", "..aaa..", ".aaaaa.", ".ssoss.", ".sbbbsw", "sbbbbbw", ".bbbbbw", ".bbbbb.", "..l.l..", ".ol.lo."],
  healer: ["..hhh..", ".hsssh.", ".ssoss.", "..sss..", ".sbabs.", "sbaaabs", ".bbabb.", "..lll..", "..l.l..", ".ol.lo."],
  paladin: ["..ooo..", ".osaso.", ".ooooo.", "..sss..", "wsbbbs.", "wbbbbbs", "wbbbbb.", "..lll..", "..l.l..", ".ol.lo."],
};

export const SPRITE_W = 7;
export const SPRITE_H = 10;

const CLASS_PALETTES = {
  warrior: { w: "#cfd6e0", a: "#f2c94c" },
  archer: { w: "#8b5a2b", a: "#4e7d3a" },
  mage: { w: "#f2c94c", a: "#5a4fcf" },
  healer: { w: "#ffffff", a: "#f4f4f4" },
  paladin: { w: "#f2c94c", a: "#cfd6e0" },
};

const TIER_SKIN = ["#f1c9a5", "#f1c9a5", "#f7d8b5", "#ffe6c7"];
const TIER_HAIR = ["#4b3a3a", "#4b3a3a", "#2d2d3a", "#6b1f1f"];

export function unitPalette(cls, tier, teamColor, teamDark) {
  const classPalette = CLASS_PALETTES[cls] || CLASS_PALETTES.warrior;
  return {
    s: TIER_SKIN[tier] || TIER_SKIN[1],
    h: TIER_HAIR[tier] || TIER_HAIR[1],
    b: tier >= 3 ? "#ffd166" : tier === 2 ? teamDark : teamColor,
    l: tier >= 2 ? "#2c2c3a" : "#3f3f52",
    o: "#2c2430",
    w: classPalette.w,
    a: tier >= 3 ? "#ff7b54" : classPalette.a,
  };
}

export function spriteGrid(cls) {
  return CLASS_LAYERS[cls] || BASE;
}

// Draws one figure with its feet at (x, y) using pixel size px. flip mirrors horizontally.
export function drawUnit(ctx, { cls, x, y, px = 3, palette, flip = false, alpha = 1 }) {
  const grid = spriteGrid(cls);
  ctx.save();
  ctx.globalAlpha = alpha;
  const originX = x - (SPRITE_W * px) / 2;
  const originY = y - SPRITE_H * px;
  for (let row = 0; row < grid.length; row += 1) {
    const line = grid[row];
    for (let col = 0; col < line.length; col += 1) {
      const key = line[col];
      if (key === ".") continue;
      const color = palette[key];
      if (!color) continue;
      ctx.fillStyle = color;
      const drawCol = flip ? SPRITE_W - 1 - col : col;
      ctx.fillRect(Math.round(originX + drawCol * px), Math.round(originY + row * px), px, px);
    }
  }
  ctx.restore();
}

// A crown for elite units and a small halo for reinforced ones.
export function drawTierMark(ctx, { tier, x, y, px = 3 }) {
  if (tier < 2) return;
  const top = y - SPRITE_H * px - px * 2;
  ctx.fillStyle = tier >= 3 ? "#ffd166" : "#c9f0ff";
  if (tier >= 3) {
    [[-2, 1], [-1, 0], [0, 1], [1, 0], [2, 1], [-2, 2], [-1, 2], [0, 2], [1, 2], [2, 2]].forEach(([dx, dy]) => {
      ctx.fillRect(Math.round(x + dx * px - px / 2), Math.round(top + dy * px - px), px, px);
    });
  } else {
    [[-1, 0], [0, 0], [1, 0]].forEach(([dx, dy]) => ctx.fillRect(Math.round(x + dx * px - px / 2), Math.round(top + dy * px), px, px));
  }
}

// Procedural gourd used until a drawn asset is provided. Damage stage 0..3 adds cracks.
export function drawGourd(ctx, { x, y, size, color, dark, light, stage = 0, shield = 0, squash = 1 }) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1 / squash, squash);
  const px = Math.max(2, Math.round(size / 24));
  const radius = size / 2;
  // body as stacked pixel rows
  for (let row = -radius; row < radius; row += px) {
    const t = row / radius;
    const half = Math.sqrt(Math.max(0, 1 - t * t)) * radius;
    const left = Math.round(-half / px) * px;
    const width = Math.round((half * 2) / px) * px;
    ctx.fillStyle = t < -0.55 ? light : t > 0.55 ? dark : color;
    ctx.fillRect(left, Math.round(row / px) * px, width, px);
  }
  // seam band and stem
  ctx.fillStyle = dark;
  ctx.fillRect(-px, -radius - px * 3, px * 2, px * 3);
  ctx.fillStyle = "#fff7e6";
  for (let row = -radius + px * 2; row < radius - px * 2; row += px * 4) ctx.fillRect(-px, Math.round(row / px) * px, px * 2, px * 2);
  // cracks
  ctx.fillStyle = "#2c2430";
  const cracks = [
    [[-0.5, -0.3], [-0.35, -0.1], [-0.45, 0.15], [-0.25, 0.35]],
    [[0.45, -0.4], [0.3, -0.2], [0.5, 0.0], [0.35, 0.25], [0.5, 0.45]],
    [[-0.1, -0.7], [0.05, -0.45], [-0.1, -0.2], [0.1, 0.05]],
  ];
  for (let index = 0; index < Math.min(stage, cracks.length); index += 1) {
    cracks[index].forEach(([cx, cy]) => ctx.fillRect(Math.round((cx * radius) / px) * px, Math.round((cy * radius) / px) * px, px, px * 2));
  }
  ctx.restore();
  if (shield > 0) {
    ctx.save();
    ctx.strokeStyle = "rgba(255, 221, 102, 0.9)";
    ctx.lineWidth = Math.max(2, px);
    ctx.setLineDash([px * 2, px * 2]);
    ctx.beginPath();
    ctx.arc(x, y, radius + px * 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

// Shell fragments after a burst: a few chunky pixel pieces.
export function drawShard(ctx, { x, y, size, color, dark, rotation }) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.fillStyle = color;
  ctx.fillRect(-size / 2, -size / 2, size, size);
  ctx.fillStyle = dark;
  ctx.fillRect(-size / 2, size / 4, size, size / 4);
  ctx.restore();
}
