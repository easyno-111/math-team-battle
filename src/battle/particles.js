// Small particle pool. Squares with a dark outline so they stay visible on the pale arena;
// sparks are drawn as short streaks along their velocity.
const OUTLINE = "#2c2430";

export function createParticles(limit = 2200) {
  const items = [];
  return {
    get count() { return items.length; },
    spawn(particle) {
      if (items.length >= limit) items.shift();
      items.push({ life: 1, decay: 1.6, gravity: 600, drag: 0.98, size: 3, shrink: true, outline: true, streak: 0, ...particle });
    },
    burst({ x, y, count, speed, color, colors, size = 3, spread = Math.PI * 2, angle = -Math.PI / 2, gravity = 600, decay = 1.6, drag = 0.98, streak = 0, outline = true, shrink = true }) {
      for (let index = 0; index < count; index += 1) {
        const theta = angle + (Math.random() - 0.5) * spread;
        const velocity = speed * (0.35 + Math.random() * 0.85);
        this.spawn({
          x, y, vx: Math.cos(theta) * velocity, vy: Math.sin(theta) * velocity,
          color: colors ? colors[Math.floor(Math.random() * colors.length)] : color,
          size: size * (0.6 + Math.random() * 0.8), gravity, decay: decay * (0.7 + Math.random() * 0.6), drag, streak, outline, shrink,
        });
      }
    },
    update(dt) {
      for (let index = items.length - 1; index >= 0; index -= 1) {
        const p = items[index];
        p.life -= p.decay * dt;
        if (p.life <= 0) { items.splice(index, 1); continue; }
        p.vy += p.gravity * dt;
        p.vx *= p.drag;
        p.vy *= p.drag;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
    },
    draw(ctx) {
      for (const p of items) {
        const size = Math.max(1, Math.round(p.shrink ? p.size * (0.4 + p.life * 0.6) : p.size));
        ctx.globalAlpha = Math.min(1, p.life * 1.6);
        const x = Math.round(p.x - size / 2), y = Math.round(p.y - size / 2);
        if (p.streak) {
          const length = Math.min(p.streak, Math.hypot(p.vx, p.vy) * 0.035);
          const nx = p.vx / (Math.hypot(p.vx, p.vy) || 1), ny = p.vy / (Math.hypot(p.vx, p.vy) || 1);
          ctx.strokeStyle = OUTLINE; ctx.lineWidth = size + 2;
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - nx * length, p.y - ny * length); ctx.stroke();
          ctx.strokeStyle = p.color; ctx.lineWidth = size;
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - nx * length, p.y - ny * length); ctx.stroke();
          continue;
        }
        if (p.outline && size >= 3) { ctx.fillStyle = OUTLINE; ctx.fillRect(x - 1, y - 1, size + 2, size + 2); }
        ctx.fillStyle = p.color;
        ctx.fillRect(x, y, size, size);
      }
      ctx.globalAlpha = 1;
    },
    clear() { items.length = 0; },
  };
}
