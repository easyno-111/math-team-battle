export const QUIZ_INTRO_MS = 4000;
export const QUESTION_PREVIEW_MS = 3000;

// One shared timeline drives every screen. The existing database rules still
// reject answers before startAt, even while phase is already "answer".
export function scheduleRound(room, question, roundId, now) {
  const first = room.phase === 'waiting';
  const previewAt = now + (first ? QUIZ_INTRO_MS : 0);
  const startAt = previewAt + QUESTION_PREVIEW_MS;
  return {
    ...room, flowVersion: 2, phase: 'answer', index: Number(room.index) + 1,
    roundId, question, introAt: first ? now : null, previewAt,
    startAt, endAt: startAt + Number(question.duration) * 1000,
    results: null, reveal: null, correctLabel: null, revealedAt: null, finishedAt: null,
  };
}

export function canAdvanceRound(latest, expected) {
  return Boolean(latest && expected && ['waiting', 'reveal'].includes(latest.phase)
    && latest.phase === expected.phase && latest.index === expected.index
    && latest.hostUid === expected.hostUid
    && (latest.roundId || null) === (expected.roundId || null));
}

export function quizPhase(room, now) {
  if (room?.phase !== 'answer' || now >= room.startAt) return room?.phase;
  if (room.flowVersion === 2 && room.introAt != null && now < room.previewAt) return 'intro';
  return 'preview';
}

export function answerWindowOpen(room, now) {
  return Boolean(room?.phase === 'answer' && Number.isFinite(room.startAt)
    && Number.isFinite(room.endAt) && now >= room.startAt && now < room.endAt);
}

export function roundReadyToGrade(room, now) {
  // Submitting early never shortens the configured answering time.
  return Boolean(room?.phase === 'answer' && Number.isFinite(room.endAt) && now >= room.endAt);
}
