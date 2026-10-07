// Turns one student submission into a Realtime Database multi-path update.
// Paths are relative to rooms/{code}; the caller prefixes them and clears the submission.
import { chooseNextQuestion, correctAnswerOf, normalizeChoice, publicQuestion } from "./questions.js";
import { BASE_DAMAGE, resolveVolley, summonUnit, WRONG_LOCK_MS } from "./rules.js";

export function initialPlayerState(question, random = Math.random) {
  return {
    currentQuestion: publicQuestion(question, random),
    seenQuestionIds: question ? { [question.id]: true } : {},
    correctCount: 0,
    wrongCount: 0,
    streak: 0,
    maxStreak: 0,
    damage: 0,
    lockedUntil: 0,
    lastResult: null,
  };
}

export function judgeSubmission({ room, teams, uid, submission, question, pool, now = Date.now(), random = Math.random }) {
  const participant = room?.participants?.[uid];
  const state = room?.playerStates?.[uid];
  const team = participant?.team;
  if (!participant || !state || !question || !teams?.[team] || state.currentQuestion?.id !== submission?.questionId) {
    return { kind: "discard", updates: {} };
  }

  const base = `playerStates/${uid}`;
  const lockedUntil = Number(state.lockedUntil || 0);
  if (lockedUntil > now) {
    return {
      kind: "blocked",
      updates: { [`${base}/lastResult`]: { nonce: submission.nonce, correct: false, blocked: true, lockedUntil, at: now } },
    };
  }

  const offered = Array.isArray(state.currentQuestion?.choices) ? state.currentQuestion.choices : [];
  const chosen = normalizeChoice(submission.choice);
  const correct = offered.some((choice) => normalizeChoice(choice) === chosen) && chosen === normalizeChoice(correctAnswerOf(question));
  const streakBefore = Number(state.streak || 0);

  if (!correct) {
    const nextLock = now + WRONG_LOCK_MS;
    return {
      kind: "wrong",
      updates: {
        [`${base}/wrongCount`]: Number(state.wrongCount || 0) + 1,
        [`${base}/streak`]: 0,
        [`${base}/lockedUntil`]: nextLock,
        [`${base}/lastResult`]: { nonce: submission.nonce, correct: false, blocked: false, streakBroken: streakBefore >= 2, lockedUntil: nextLock, at: now },
      },
    };
  }

  const streak = streakBefore + 1;
  const unit = summonUnit(streak, random);
  const difficulty = question.difficulty in BASE_DAMAGE ? question.difficulty : "보통";
  const volley = resolveVolley({ teams, teamId: team, difficulty, unit });
  const next = chooseNextQuestion(pool, state, random);
  const result = {
    nonce: submission.nonce,
    correct: true,
    unit,
    streak,
    damage: volley.damage,
    shieldUsed: volley.shieldUsed,
    heal: volley.heal,
    shieldGiven: volley.shieldGiven,
    burst: volley.burst,
    at: now,
  };
  const event = {
    at: now,
    team,
    attackerUid: uid,
    attackerName: participant.name || "학생",
    unit,
    streak,
    damage: volley.damage,
    shieldUsed: volley.shieldUsed,
    heal: volley.heal,
    shieldGiven: volley.shieldGiven,
    hpAfter: volley.hpAfter,
    burst: volley.burst,
  };
  const updates = {
    [`${base}/correctCount`]: Number(state.correctCount || 0) + 1,
    [`${base}/streak`]: streak,
    [`${base}/maxStreak`]: Math.max(Number(state.maxStreak || 0), streak),
    [`${base}/damage`]: Number(state.damage || 0) + volley.damage,
    [`${base}/lockedUntil`]: 0,
    [`${base}/lastResult`]: result,
    [`${base}/currentQuestion`]: publicQuestion(next.question, random),
    [`${base}/seenQuestionIds`]: next.seen,
  };
  for (const [id, teamState] of Object.entries(volley.teams)) {
    if (id === team || id === volley.heal?.team || id === volley.shieldGiven?.team) updates[`teams/${id}`] = teamState;
  }
  if (volley.burst) {
    updates.status = "finished";
    updates.winner = team;
    updates.finishedAt = now;
    updates.finishReason = "burst";
  }
  return { kind: "correct", updates, event, teams: volley.teams, burst: volley.burst };
}
