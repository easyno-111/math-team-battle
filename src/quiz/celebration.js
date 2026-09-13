export const REVEAL_EFFECT_MS = 3000;

export function revealCelebration(room, uid, host, now) {
  if (room?.phase !== 'reveal' || !room.roundId || !Number.isFinite(now)
    || now <= 0 || !Number.isFinite(room.revealedAt)) return null;
  const elapsed = now - room.revealedAt;
  if (elapsed < 0 || elapsed >= REVEAL_EFFECT_MS) return null;
  const correctIds = Object.keys(room.players || {}).filter(id => {
    const result = room.results?.[id];
    return result?.correct === true && result.submitted === true && result.roundId === room.roundId;
  });
  if (!correctIds.length || !host && !correctIds.includes(uid)) return null;
  return { elapsed, correctCount: correctIds.length, label: host ? `정답 ${correctIds.length}명!` : '정답!' };
}
