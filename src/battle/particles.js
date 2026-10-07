// Small particle pool. Every particle is a square so the scene stays pixel-art.
export function createParticles(limit = 900) {
  const items = [];
  return {
    get count() { return items.length; },
    spawn(particle) {
      if (items.length >= limit) items.shift();
      items.push({ life: 1, decay: 1.6, gravity: 600, drag: 0.98, size: 3, shrink: true, ...particle });
    },
    burst({ x, y, count, speed, color, colors, size = 3, spread = Math.PI * 2, angle = -Math.PI / 2, gravity = 600, decay = 1.6, drag = 0.98 }) {
      for (let index = 0; index < count; index += 1) {
        const theta = angle + (Math.random() - 0.5) * spread;
        const velocity = speed * (0.35 + Math.random() * 0.85);
        this.spawn({
          x, y, vx: Math.cos(theta) * velocity, vy: Math.sin(theta) * velocity,
          color: colors ? colors[Math.floor(Math.random() * colors.length)] : color,
          size: size * (0.6 + Math.random() * 0.8), gravity, decay: decay * (0.7 + Math.random() * 0.6), drag,
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
        const size = Math.max(1, Math.round(p.shrink ? p.size * p.life : p.size));
        ctx.globalAlpha = Math.min(1, p.life * 1.4);
        ctx.fillStyle = p.color;
        ctx.fillRect(Math.round(p.x - size / 2), Math.round(p.y - size / 2), size, size);
      }
      ctx.globalAlpha = 1;
    },
    clear() { items.length = 0; },
  };
}
