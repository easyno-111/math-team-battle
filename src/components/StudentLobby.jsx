import { useEffect, useMemo, useRef, useState } from "react";
import { get, onDisconnect, onValue, ref, runTransaction, serverTimestamp, set, update } from "firebase/database";
import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { prepareStudentAuthPersistence, realtimeReady, studentAuth, studentRealtime } from "../realtime";
import { configuredTeams, TEAM_META, teamLabel, teamShort } from "../game/teams";
import { hpRatio, nextTierGoal, normalizeTeams, rankTeams, TIER_LABELS, unitLabel, UNIT_META, WRONG_LOCK_MS } from "../game/rules";
import { CHOICE_LABELS } from "../game/questions";
import { formatRemaining, useNow } from "../hooks/useNow";
import { rankMembers } from "../room/roomUtils";
import studentLobbyBg from "../assets/game/student-lobby.webp";
import battleArenaBg from "../assets/game/battle-arena.webp";
import MathText from "./MathText";

const SESSION_KEY = "math-team-battle-student-session";

function readSavedSession(initialRoomCode) {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY) || "null");
    if (!parsed) return null;
    if (initialRoomCode && parsed.roomCode !== initialRoomCode) return null;
    return parsed;
  } catch {
    return null;
  }
}

function normalizeRoomCode(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 4);
}

function makeNonce() {
  return window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function StudentLobby({ initialRoomCode = "", version }) {
  const [roomCode, setRoomCode] = useState(normalizeRoomCode(initialRoomCode));
  const [name, setName] = useState("");
  const [studentUser, setStudentUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");
  const [session, setSession] = useState(() => readSavedSession(initialRoomCode));
  const [room, setRoom] = useState(null);
  const [roomMissing, setRoomMissing] = useState(false);
  const [selectedChoice, setSelectedChoice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const submittedNonce = useRef("");
  const lastQuestionId = useRef("");
  const feedbackTimer = useRef(0);

  useEffect(() => onAuthStateChanged(studentAuth, (firebaseUser) => { setStudentUser(firebaseUser); setAuthReady(true); }), []);
  useEffect(() => () => window.clearTimeout(feedbackTimer.current), []);

  useEffect(() => {
    if (!session || !studentRealtime || !studentUser) return undefined;
    return onValue(ref(studentRealtime, `rooms/${session.roomCode}`), (snapshot) => {
      const value = snapshot.val();
      setRoom(value);
      setRoomMissing(!value);
      const state = value?.playerStates?.[session.uid];
      const questionId = state?.currentQuestion?.id || "";
      if (questionId && lastQuestionId.current !== questionId) {
        lastQuestionId.current = questionId;
        setSelectedChoice("");
        setSubmitting(false);
        submittedNonce.current = "";
      }
      const result = state?.lastResult;
      if (result?.nonce && submittedNonce.current === result.nonce) {
        setSubmitting(false);
        setFeedback(result);
        submittedNonce.current = "";
        window.clearTimeout(feedbackTimer.current);
        feedbackTimer.current = window.setTimeout(() => { setFeedback(null); setSelectedChoice(""); }, result.correct ? 2200 : 1400);
      }
    }, () => setError("대기실 정보를 불러오지 못했습니다."));
  }, [session, studentUser]);

  // Presence: mark online now and offline when the connection drops.
  useEffect(() => {
    if (!session || !studentUser || !studentRealtime || session.uid !== studentUser.uid) return undefined;
    const participantRef = ref(studentRealtime, `rooms/${session.roomCode}/participants/${studentUser.uid}`);
    update(participantRef, { online: true, lastSeen: serverTimestamp() }).catch(() => {});
    const handle = onDisconnect(participantRef);
    handle.update({ online: false, lastSeen: serverTimestamp() }).catch(() => {});
    return () => { handle.cancel().catch(() => {}); };
  }, [session, studentUser]);

  const participants = useMemo(() => Object.entries(room?.participants || {}).map(([id, p]) => ({ id, ...p })), [room?.participants]);
  const me = session ? participants.find((p) => p.id === session.uid) : null;
  const myState = session ? room?.playerStates?.[session.uid] || null : null;
  const status = room?.status || "";
  const teams = configuredTeams(room?.config?.teamCount);
  const team = me?.team || session?.team;

  // The match started but my first question is missing: ask the teacher screen for a repair.
  useEffect(() => {
    if (!session || !studentRealtime || status !== "playing" || myState?.currentQuestion) return undefined;
    const timer = window.setTimeout(() => {
      update(ref(studentRealtime, `rooms/${session.roomCode}/participants/${session.uid}`), { needsSync: true, lastSeen: serverTimestamp() }).catch(() => {});
    }, 900);
    return () => window.clearTimeout(timer);
  }, [status, myState?.currentQuestion, session]);

  const joinRoom = async (event) => {
    event.preventDefault();
    setError("");
    if (!realtimeReady || !studentRealtime) return setError("아직 Realtime Database 연결이 완료되지 않았습니다.");
    const cleanCode = normalizeRoomCode(roomCode);
    const cleanName = name.trim();
    if (cleanCode.length !== 4) return setError("4자리 방 코드를 입력해주세요.");
    if (!cleanName) return setError("이름을 입력해주세요.");
    if (cleanName.length > 12) return setError("이름은 12자 이내로 입력해주세요.");
    setJoining(true);
    try {
      await prepareStudentAuthPersistence();
      const firebaseUser = studentAuth.currentUser || (await signInAnonymously(studentAuth)).user;
      const roomData = (await get(ref(studentRealtime, `rooms/${cleanCode}`))).val();
      if (!roomData) return setError("해당 게임방을 찾을 수 없습니다.");
      const participantRef = ref(studentRealtime, `rooms/${cleanCode}/participants/${firebaseUser.uid}`);
      const existing = (await get(participantRef)).val();
      if (!existing && roomData.status !== "waiting") return setError("지금은 학생 입장이 마감된 방입니다.");
      const duplicated = Object.entries(roomData.participants || {}).some(([uid, p]) => uid !== firebaseUser.uid && String(p.name || "").trim().toLocaleLowerCase("ko") === cleanName.toLocaleLowerCase("ko"));
      if (duplicated) return setError("같은 이름으로 이미 입장한 학생이 있어요. 이름 뒤에 번호를 붙여주세요.");
      let assigned = existing?.team;
      if (!assigned) {
        const counter = await runTransaction(ref(studentRealtime, `rooms/${cleanCode}/joinCounter`), (current) => (typeof current === "number" ? current + 1 : 1), { applyLocally: false });
        if (!counter.committed) throw new Error("team-assignment-failed");
        const roomTeams = configuredTeams(roomData.config?.teamCount);
        assigned = roomTeams[(Number(counter.snapshot.val() || 1) - 1) % roomTeams.length];
      }
      await set(participantRef, { uid: firebaseUser.uid, name: cleanName, team: assigned, online: true, joinedAt: existing?.joinedAt || serverTimestamp(), lastSeen: serverTimestamp() });
      const next = { roomCode: cleanCode, uid: firebaseUser.uid, name: cleanName, team: assigned };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(next));
      localStorage.setItem(SESSION_KEY, JSON.stringify(next));
      setSession(next);
      setRoomCode(cleanCode);
      setName(cleanName);
      return undefined;
    } catch (joinError) {
      console.error("학생 입장 오류:", joinError);
      const code = joinError?.code || "";
      if (code.includes("operation-not-allowed")) setError("Firebase Authentication에서 익명 로그인을 활성화해주세요.");
      else if (code.includes("permission-denied")) setError("Realtime Database 규칙에서 학생 입장이 허용되지 않았습니다.");
      else setError("입장 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
      return undefined;
    } finally {
      setJoining(false);
    }
  };

  const submitChoice = async (choice) => {
    if (!session || !studentRealtime || status !== "playing" || !myState?.currentQuestion || submitting || feedback) return;
    if (Number(myState.lockedUntil || 0) > Date.now()) return;
    const offered = Array.isArray(myState.currentQuestion.choices) ? myState.currentQuestion.choices : [];
    if (!offered.includes(choice)) return setError("보기를 다시 선택해주세요.");
    const nonce = makeNonce();
    try {
      setSelectedChoice(choice);
      setSubmitting(true);
      submittedNonce.current = nonce;
      setError("");
      await set(ref(studentRealtime, `roomSubmissions/${session.roomCode}/${session.uid}`), { uid: session.uid, questionId: myState.currentQuestion.id, choice: String(choice).trim(), nonce, submittedAt: serverTimestamp() });
    } catch (submitError) {
      console.error("답안 제출 오류:", submitError);
      setSubmitting(false);
      setSelectedChoice("");
      submittedNonce.current = "";
      setError("답안을 보내지 못했습니다. 선생님 화면이 열려 있는지 확인해주세요.");
    }
    return undefined;
  };

  const leaveRoom = async () => {
    if (session && studentRealtime) {
      await update(ref(studentRealtime, `rooms/${session.roomCode}/participants/${session.uid}`), { online: false, lastSeen: serverTimestamp() }).catch(() => {});
    }
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
    setRoom(null);
    setRoomMissing(false);
    setError("");
    setName("");
  };

  if (!realtimeReady) {
    return (
      <main className="student-entry-shell" style={{ backgroundImage: `url(${studentLobbyBg})` }}>
        <div className="student-entry-card"><span className="student-mini-label">수학 팀 배틀</span><h1>학생 입장 준비 중</h1><p>선생님 화면에서 Realtime Database 주소를 먼저 연결해주세요.</p><footer>{version}</footer></div>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="student-entry-shell" style={{ backgroundImage: `url(${studentLobbyBg})` }}>
        <div className="student-entry-shade" />
        <section className="student-entry-card">
          <div className="student-entry-icon">∑</div>
          <span className="student-mini-label">수학 팀 배틀</span>
          <h1>게임방 입장</h1>
          <p>{initialRoomCode ? "QR 입장 완료! 이름만 입력하면 돼요." : "방 코드와 이름만 입력하면 바로 팀이 정해져요."}</p>
          <form onSubmit={joinRoom}>
            {initialRoomCode ? (
              <div className="student-auto-room-code"><span>방 코드</span><strong>{roomCode}</strong><small>QR에서 자동으로 입력됐어요</small></div>
            ) : (
              <label>방 코드<input className="student-code-input" inputMode="numeric" value={roomCode} onChange={(e) => setRoomCode(normalizeRoomCode(e.target.value))} placeholder="0000" autoFocus /></label>
            )}
            <label>이름<input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 김민수" maxLength={12} autoFocus={Boolean(initialRoomCode)} /></label>
            {error && <div className="student-entry-error">{error}</div>}
            <button type="submit" disabled={joining || !authReady}>{joining ? "입장 중..." : "입장하기"}</button>
          </form>
          <footer>{version}</footer>
        </section>
      </main>
    );
  }

  if (roomMissing) {
    return (
      <main className="student-lobby-shell" style={{ backgroundImage: `url(${studentLobbyBg})` }}>
        <div className="student-scene-shade" />
        <section className="student-wait-card room-ended-card">
          <span className="student-mini-label">GAME ROOM CLOSED</span>
          <h1>게임방이 닫혔어요</h1>
          <p>선생님이 새 방을 만들면 다시 입장해주세요.</p>
          <button type="button" onClick={leaveRoom}>다른 방으로 가기</button>
        </section>
      </main>
    );
  }

  if (status === "playing" && room) {
    return <StudentMatch room={room} roomCode={session.roomCode} session={session} team={team} teams={teams} myState={myState} selectedChoice={selectedChoice} submitChoice={submitChoice} submitting={submitting} feedback={feedback} error={error} version={version} />;
  }

  if (status === "finished" && room) {
    const won = room.winner === team;
    const teamStates = normalizeTeams(room.teams);
    return (
      <main className="student-match-shell" style={{ backgroundImage: `url(${battleArenaBg})` }}>
        <div className="student-match-shade" />
        <section className={`student-result-card student-team-${String(team).toLowerCase()}`}>
          <span className="student-mini-label">{room.finishReason === "burst" ? "박이 터졌어요!" : "경기 종료"}</span>
          <h1>{room.winner ? (won ? "우리 팀 승리!" : `${teamLabel(room.winner)} 승리`) : "동점이에요!"}</h1>
          <div className="student-team-hp-list">
            {rankTeams(teamStates).map((row) => (
              <div key={row.team} className={`student-team-hp team-${row.team.toLowerCase()} ${row.team === team ? "mine" : ""}`}>
                <span>{row.rank}위 {teamShort(row.team)}</span>
                <div className="student-hp-bar"><i style={{ width: `${Math.round(row.ratio * 100)}%` }} /></div>
                <b>{Math.round(row.hp)}</b>
              </div>
            ))}
          </div>
          <p>{session.name} · {teamLabel(team)} · 정답 {myState?.correctCount || 0}개 · 최고 {myState?.maxStreak || 0}연속 · 피해 {myState?.damage || 0}</p>
          <button type="button" onClick={leaveRoom}>대기실 나가기</button>
        </section>
        <div className="student-version">{version}</div>
      </main>
    );
  }

  const waitingOpen = status === "waiting";
  return (
    <main className="student-lobby-shell" style={{ backgroundImage: `url(${studentLobbyBg})` }}>
      <div className="student-scene-shade" />
      <div className="student-lobby-top">
        <div className="student-room-chip">ROOM <strong>{session.roomCode}</strong></div>
        <div className={`student-status-chip ${waitingOpen ? "open" : "locked"}`}>{status === "starting" ? "경기 준비 중" : waitingOpen ? "입장 중" : "입장 마감"}</div>
      </div>
      <section className={`student-wait-card student-team-${String(team).toLowerCase()}`}>
        <div className="student-team-emblem">{team}</div>
        <span className="student-mini-label">{team} TEAM</span>
        <h1>{session.name}</h1>
        <p className="student-assignment-message"><strong>{teamLabel(team)}</strong>으로 배정되었어요.</p>
        <div className="student-reconnect-note">이 기기에서는 새로고침하거나 다시 접속해도 현재 팀을 기억해요.</div>
        <div className="student-waiting-dots" aria-hidden="true"><span /><span /><span /></div>
        <p className="student-wait-copy">{status === "starting" ? "경기를 준비하고 있어요. 잠시만 기다려주세요." : "선생님이 경기를 시작할 때까지 기다려주세요. 정답을 맞히면 우리 팀 박을 때릴 용사가 소환돼요!"}</p>
        <div className={`student-team-counts team-count-${teams.length}`}>
          {teams.map((id) => <div key={id} className={`team-count-chip team-${id.toLowerCase()}`}><span>{id}팀</span><strong>{participants.filter((p) => p.team === id).length}</strong></div>)}
        </div>
        <button type="button" className="student-leave-button" onClick={leaveRoom}>방 나가기</button>
      </section>
      <div className="student-version">{version}</div>
    </main>
  );
}

export function StudentMatch({ room, roomCode, session, team, teams, myState, selectedChoice, submitChoice, submitting, feedback, error, version }) {
  const now = useNow(true);
  const remaining = Number(room.scheduledEndAt || now) - now;
  const teamStates = normalizeTeams(room.teams);
  const teamRanks = rankMembers(Object.entries(room.participants || {}).map(([id, p]) => ({ id, ...p })).filter((p) => p.team === team), room.playerStates || {});
  const myRank = teamRanks.find((p) => p.id === session.uid);
  const streak = Number(myState?.streak || 0);
  const goal = nextTierGoal(streak);
  const current = myState?.currentQuestion;
  const lockedUntil = Number(myState?.lockedUntil || 0);
  const lockRemaining = now > 0 ? Math.max(0, Math.ceil((lockedUntil - now) / 1000)) : 0;
  const locked = lockRemaining > 0;
  const mySquad = teamStates[team]?.squad || [];

  return (
    <main className="student-match-shell" style={{ backgroundImage: `url(${battleArenaBg})` }}>
      <div className="student-match-shade" />
      <header className="student-match-topbar">
        <div className={`student-match-team-chip team-${String(team).toLowerCase()}`}><span>{team}팀</span><strong>{session.name}</strong></div>
        <div className="student-match-timer"><span>남은 시간</span><strong>{now ? formatRemaining(remaining) : "--:--"}</strong></div>
        <div className="student-match-room-chip">ROOM {roomCode}</div>
      </header>

      <div className={`student-team-hp-list compact team-count-${teams.length}`}>
        {teams.map((id) => {
          const state = teamStates[id];
          const ratio = state ? hpRatio(state) : 1;
          return (
            <div key={id} className={`student-team-hp team-${id.toLowerCase()} ${id === team ? "mine" : ""}`} style={{ "--team-color": TEAM_META[id].color }}>
              <span>{teamShort(id)}{id === team ? " (우리)" : ""}</span>
              <div className="student-hp-bar"><i style={{ width: `${Math.round(ratio * 100)}%` }} /></div>
              <b>{Math.round(ratio * 100)}%</b>
            </div>
          );
        })}
      </div>

      <section className={`student-question-card student-team-${String(team).toLowerCase()}`}>
        {current ? (
          <>
            <div className="student-question-meta">
              <span>{current.category ? `${current.category} · ${current.unit || "주제"}` : current.unit || "문제"}</span>
              <span>{current.difficulty}</span>
              <strong>정답이면 용사 소환!</strong>
            </div>
            <div className="student-question-text"><MathText text={current.text} /></div>
            <div className="student-choice-grid" aria-label="객관식 보기">
              {(current.choices || []).map((choice, index) => (
                <button type="button" key={`${current.id}-${index}`} className={`student-choice-button ${selectedChoice === choice ? "selected" : ""}`} onClick={() => submitChoice(choice)} disabled={submitting || Boolean(feedback) || locked}>
                  <span className="student-choice-number">{CHOICE_LABELS[index]}</span>
                  <span className="student-choice-text"><MathText text={choice} /></span>
                </button>
              ))}
            </div>
            <p className="student-choice-hint">{locked ? `오답 대기 중 · ${lockRemaining}초 후 다시 선택할 수 있어요.` : "보기 하나를 누르면 바로 제출돼요."}</p>
            {locked && (
              <div className="student-guess-lock" role="status" aria-live="polite">
                <span>찍기 방지</span><strong>{lockRemaining}</strong><small>초 후 다시 선택 가능</small>
                <i style={{ "--lock-progress": `${Math.min(100, (lockRemaining / (WRONG_LOCK_MS / 1000)) * 100)}%` }} />
              </div>
            )}
            {submitting && <div className="student-choice-submitting">정답을 확인하고 있어요...</div>}
            {error && <div className="student-answer-error">{error}</div>}
            <div className="student-combo-goal">
              {goal ? (
                <><span>{goal.streak}연속 정답이면 {TIER_LABELS[goal.tier]} 용사 · {goal.streak - streak}문제 남음</span><progress aria-label="다음 강화 용사까지 진행도" value={streak} max={goal.streak} /></>
              ) : <strong>정예 용사 소환 중! 연속 정답을 이어가세요.</strong>}
            </div>
            <div className="student-personal-stats">
              <span className="student-team-rank">팀 내 {myRank?.tied ? "공동 " : ""}<strong>{myRank?.rank || "-"}위</strong> / {teamRanks.length}명</span>
              <span>정답 <strong>{myState?.correctCount || 0}</strong></span>
              <span>피해 <strong>{myState?.damage || 0}</strong></span>
              <span className={`student-combo-stat ${streak >= 2 ? "active" : ""}`}>연속 <strong>{streak}</strong></span>
            </div>
            <div className="student-squad-line">우리 팀 출전 용사 {mySquad.length}명 · {Object.keys(UNIT_META).map((cls) => { const n = mySquad.filter((u) => u.cls === cls).length; return n ? `${UNIT_META[cls].label} ${n}` : null; }).filter(Boolean).join(" · ") || "아직 없음"}</div>
          </>
        ) : (
          <div className="student-question-loading"><span className="soft-spinner" /><strong>첫 문제를 준비하고 있어요.</strong></div>
        )}
      </section>

      {feedback && (
        <div className={`student-answer-feedback ${feedback.correct ? "correct" : "wrong"} ${feedback.unit?.tier >= 2 ? "combo-burst" : ""}`}>
          <strong>{feedback.correct ? `${unitLabel(feedback.unit)} 소환!` : feedback.blocked ? "잠시 기다려요!" : feedback.streakBroken ? "연속 정답 끊김!" : "오답!"}</strong>
          <span>
            {feedback.correct
              ? `${feedback.streak >= 2 ? `${feedback.streak}연속 · ` : ""}우리 박에 일제 사격 -${feedback.damage}${feedback.shieldUsed ? " (상대 수호에 막힘)" : ""}${feedback.heal ? ` · ${teamShort(feedback.heal.team)} 박 회복 +${feedback.heal.amount}` : ""}${feedback.shieldGiven ? ` · ${teamShort(feedback.shieldGiven.team)} 박 수호` : ""}${feedback.burst ? " · 박이 터졌어요!" : ""}`
              : feedback.blocked ? "아직 대기 시간이 남아 있어요." : "찍기 방지를 위해 10초 동안 보기를 선택할 수 없어요."}
          </span>
        </div>
      )}
      <div className="student-version">{version}</div>
    </main>
  );
}
