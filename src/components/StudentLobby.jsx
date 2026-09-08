import { rankTeam } from "../utils/teamRanking";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  get,
  onDisconnect,
  onValue,
  ref,
  runTransaction,
  serverTimestamp,
  set,
  update,
} from "firebase/database";
import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import {
  prepareStudentAuthPersistence,
  realtimeReady,
  studentAuth,
  studentRealtime,
} from "../realtime";
import studentLobbyBg from "../assets/game/student-lobby.webp";
import battleArenaBg from "../assets/game/battle-arena.webp";
import MathText from "./MathText";

const SESSION_KEY = "math-team-battle-student-session";
const TEAM_IDS = ["A", "B", "C", "D"];
const TEAM_META = {
  A: { label: "라벤더 팀", short: "라벤더" },
  B: { label: "민트 팀", short: "민트" },
  C: { label: "피치 팀", short: "피치" },
  D: { label: "스카이 팀", short: "스카이" },
};
const WRONG_LOCK_MS = 10_000;

function readSavedSession(initialRoomCode) {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY) || "null";
    const parsed = JSON.parse(raw);
    if (!parsed) return null;
    if (initialRoomCode && parsed.roomCode !== initialRoomCode) return null;
    return parsed;
  } catch {
    return null;
  }
}

function getConfiguredTeams(room) {
  const count = Math.max(2, Math.min(4, Number(room?.config?.teamCount || 2)));
  return TEAM_IDS.slice(0, count);
}

function getActiveTeams(room) {
  const teams = room?.activeMatch?.teams;
  return Array.isArray(teams) && teams.length === 2 ? teams : ["A", "B"];
}

function normalizeRoomCode(value) {
  return value.replace(/\D/g, "").slice(0, 4);
}

function makeNonce() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatRemaining(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function useNow(active) {
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (!active) return undefined;
    const tick = () => setNow(Date.now());
    const initial = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 1000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [active]);

  return now;
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
  const [roomStatus, setRoomStatus] = useState("");
  const [roomMissing, setRoomMissing] = useState(false);
  const [selectedChoice, setSelectedChoice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const submittedNonceRef = useRef("");
  const lastQuestionIdRef = useRef("");

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(studentAuth, (firebaseUser) => {
      setStudentUser(firebaseUser);
      setAuthReady(true);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!session || !studentRealtime || !studentUser) return undefined;

    const roomRef = ref(studentRealtime, `rooms/${session.roomCode}`);
    const unsubscribe = onValue(
      roomRef,
      (snapshot) => {
        const value = snapshot.val();
        setRoom(value);
        setRoomStatus(value?.status || "");
        setRoomMissing(!value);

        const state = value?.playerStates?.[session.uid];
        const questionId = state?.currentQuestion?.id || "";
        if (questionId && lastQuestionIdRef.current !== questionId) {
          lastQuestionIdRef.current = questionId;
          setSelectedChoice("");
          setSubmitting(false);
          submittedNonceRef.current = "";
        }

        const result = state?.lastResult;
        if (result?.nonce && submittedNonceRef.current === result.nonce) {
          setSubmitting(false);
          setFeedback({
            correct: Boolean(result.correct),
            blocked: Boolean(result.blocked),
            attack: Number(result.attack || 0),
            combo: Number(result.combo || 0),
            comboBonus: Number(result.comboBonus || 0),
            attackType: String(result.attackType || ""),
            attackLabel: String(result.attackLabel || ""),
            comboBroken: Boolean(result.comboBroken),
            lockedUntil: Number(result.lockedUntil || 0),
          });
          submittedNonceRef.current = "";
          window.setTimeout(() => {
            setFeedback(null);
            setSelectedChoice("");
          }, result.correct ? 1500 : 1400);
        }
      },
      () => setError("대기실 정보를 불러오지 못했습니다.")
    );

    return unsubscribe;
  }, [session, studentUser]);

  // 경기 시작 신호는 방 전체 데이터와 별도로 작은 status 경로도 직접 구독한다.
  // 참가자가 많아 방 전체 스냅샷이 늦어지는 경우에도 waiting 화면에 남지 않도록 한다.
  useEffect(() => {
    if (!session || !studentRealtime || !studentUser) return undefined;

    const statusRef = ref(studentRealtime, `rooms/${session.roomCode}/status`);
    const unsubscribe = onValue(
      statusRef,
      (snapshot) => {
        const nextStatus = String(snapshot.val() || "");
        setRoomStatus(nextStatus);
        setRoom((current) => (
          current && nextStatus ? { ...current, status: nextStatus } : current
        ));
      },
      () => setError("경기 상태를 동기화하지 못했습니다.")
    );

    return unsubscribe;
  }, [session, studentUser]);

  useEffect(() => {
    if (!session || !studentUser || !studentRealtime) return undefined;
    if (session.uid !== studentUser.uid) return undefined;

    const participantRef = ref(studentRealtime, `rooms/${session.roomCode}/participants/${studentUser.uid}`);

    update(participantRef, {
      online: true,
      lastSeen: serverTimestamp(),
    }).catch(() => {});

    const disconnectHandle = onDisconnect(participantRef);
    disconnectHandle.update({ online: false, lastSeen: serverTimestamp() }).catch(() => {});

    return () => {
      disconnectHandle.cancel().catch(() => {});
    };
  }, [session, studentUser]);

  const participants = useMemo(() => {
    if (!room?.participants) return [];
    return Object.entries(room.participants).map(([id, participant]) => ({ id, ...participant }));
  }, [room]);

  const myParticipant = session
    ? participants.find((participant) => participant.id === session.uid)
    : null;
  const myState = session ? room?.playerStates?.[session.uid] || null : null;
  const effectiveStatus = roomStatus || room?.status || "";
  const configuredTeams = getConfiguredTeams(room);
  const participantsByTeam = Object.fromEntries(
    configuredTeams.map((team) => [team, participants.filter((participant) => participant.team === team)])
  );

  // 경기는 시작됐는데 내 문제가 누락된 경우 교사 화면에 자동 복구 요청을 남긴다.
  // 시작 순간 접속 지연이나 오래된 참가자 스냅샷 때문에 한 명만 대기 상태에 남는 상황을 복구한다.
  useEffect(() => {
    if (
      !session ||
      !studentRealtime ||
      effectiveStatus !== "playing" ||
      !getActiveTeams(room).includes(myParticipant?.team || session.team) ||
      myState?.currentQuestion
    ) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      update(
        ref(studentRealtime, `rooms/${session.roomCode}/participants/${session.uid}`),
        {
          needsSync: true,
          lastSeen: serverTimestamp(),
        }
      ).catch(() => {});
    }, 900);

    return () => window.clearTimeout(timer);
  }, [effectiveStatus, myParticipant?.team, myState?.currentQuestion, room, session]);

  const ensureAnonymousUser = async () => {
    // v0.5.0의 local persistence가 남아 있어도 먼저 탭 단위 persistence로 옮긴다.
    await prepareStudentAuthPersistence();
    if (studentAuth.currentUser) return studentAuth.currentUser;
    const credential = await signInAnonymously(studentAuth);
    return credential.user;
  };

  const joinRoom = async (event) => {
    event.preventDefault();
    setError("");

    if (!realtimeReady || !studentRealtime) {
      setError("아직 Realtime Database 연결이 완료되지 않았습니다.");
      return;
    }

    const cleanCode = normalizeRoomCode(roomCode);
    const cleanName = name.trim();

    if (cleanCode.length !== 4) {
      setError("4자리 방 코드를 입력해주세요.");
      return;
    }

    if (cleanName.length < 1) {
      setError("이름을 입력해주세요.");
      return;
    }

    if (cleanName.length > 12) {
      setError("이름은 12자 이내로 입력해주세요.");
      return;
    }

    try {
      setJoining(true);
      const firebaseUser = await ensureAnonymousUser();
      const roomRef = ref(studentRealtime, `rooms/${cleanCode}`);
      const roomSnapshot = await get(roomRef);
      const roomData = roomSnapshot.val();

      if (!roomData) {
        setError("해당 게임방을 찾을 수 없습니다.");
        return;
      }

      const participantRef = ref(studentRealtime, `rooms/${cleanCode}/participants/${firebaseUser.uid}`);
      const ownSnapshot = await get(participantRef);
      const existing = ownSnapshot.val();

      if (!existing && roomData.status !== "waiting") {
        setError("지금은 학생 입장이 마감된 방입니다.");
        return;
      }

      const duplicatedName = Object.entries(roomData.participants || {}).some(
        ([uid, participant]) =>
          uid !== firebaseUser.uid &&
          String(participant.name || "").trim().toLocaleLowerCase("ko") === cleanName.toLocaleLowerCase("ko")
      );

      if (duplicatedName) {
        setError("같은 이름으로 이미 입장한 학생이 있어요. 이름 뒤에 번호를 붙여주세요.");
        return;
      }

      let team = existing?.team;

      if (!team) {
        const counterRef = ref(studentRealtime, `rooms/${cleanCode}/joinCounter`);
        const counterResult = await runTransaction(
          counterRef,
          (current) => (typeof current === "number" ? current + 1 : 1),
          { applyLocally: false }
        );

        if (!counterResult.committed) throw new Error("team-assignment-failed");
        const roomTeams = getConfiguredTeams(roomData);
        const counterValue = Number(counterResult.snapshot.val() || 1);
        team = roomTeams[(counterValue - 1) % roomTeams.length] || "A";
      }

      await set(participantRef, {
        uid: firebaseUser.uid,
        name: cleanName,
        team,
        online: true,
        joinedAt: existing?.joinedAt || serverTimestamp(),
        lastSeen: serverTimestamp(),
      });

      const nextSession = {
        roomCode: cleanCode,
        uid: firebaseUser.uid,
        name: cleanName,
        team,
      };

      sessionStorage.setItem(SESSION_KEY, JSON.stringify(nextSession));
      localStorage.setItem(SESSION_KEY, JSON.stringify(nextSession));
      setSession(nextSession);
      setRoomCode(cleanCode);
      setName(cleanName);
    } catch (joinError) {
      console.error("학생 입장 오류:", joinError);
      const code = joinError?.code || "";

      if (code.includes("operation-not-allowed")) {
        setError("Firebase Authentication에서 익명 로그인을 활성화해주세요.");
      } else if (code.includes("permission-denied")) {
        setError("Realtime Database 규칙에서 학생 입장이 허용되지 않았습니다.");
      } else {
        setError("입장 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
      }
    } finally {
      setJoining(false);
    }
  };

  const submitChoice = async (choice) => {
    if (
      !session ||
      !studentRealtime ||
      effectiveStatus !== "playing" ||
      !myState?.currentQuestion ||
      submitting ||
      feedback ||
      Number(myState?.lockedUntil || 0) > Date.now()
    ) {
      return;
    }

    const offeredChoices = Array.isArray(myState.currentQuestion.choices)
      ? myState.currentQuestion.choices
      : [];
    const cleanChoice = String(choice || "").trim();

    if (!cleanChoice || !offeredChoices.includes(choice)) {
      setError("보기를 다시 선택해주세요.");
      return;
    }

    const nonce = makeNonce();
    try {
      setSelectedChoice(choice);
      setSubmitting(true);
      submittedNonceRef.current = nonce;
      setFeedback(null);
      setError("");

      await set(ref(studentRealtime, `roomSubmissions/${session.roomCode}/${session.uid}`), {
        uid: session.uid,
        questionId: myState.currentQuestion.id,
        choice: cleanChoice,
        nonce,
        submittedAt: serverTimestamp(),
      });
    } catch (submitError) {
      console.error("답안 제출 오류:", submitError);
      setSubmitting(false);
      setSelectedChoice("");
      submittedNonceRef.current = "";
      setError("답안을 보내지 못했습니다. 선생님 화면이 열려 있는지 확인해주세요.");
    }
  };

  const leaveRoom = async () => {
    if (session && studentRealtime) {
      try {
        await update(ref(studentRealtime, `rooms/${session.roomCode}/participants/${session.uid}`), {
          online: false,
          lastSeen: serverTimestamp(),
        });
      } catch {
        // 방이 이미 닫힌 경우에는 로컬 세션만 정리한다.
      }
    }

    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
    setRoom(null);
    setRoomStatus("");
    setRoomMissing(false);
    setError("");
    setName("");
  };

  if (!realtimeReady) {
    return (
      <main className="student-entry-shell" style={{ backgroundImage: `url(${studentLobbyBg})` }}>
        <div className="student-entry-card">
          <span className="student-mini-label">수학 팀 배틀</span>
          <h1>학생 입장 준비 중</h1>
          <p>선생님 화면에서 Realtime Database 주소를 먼저 연결해주세요.</p>
          <footer>{version}</footer>
        </div>
      </main>
    );
  }

  if (session) {
    const team = myParticipant?.team || session.team;
    const teamMeta = TEAM_META[team] || { label: `${team}팀`, short: team };
    const waitingOpen = effectiveStatus === "waiting";
    const activeTeams = getActiveTeams(room);
    const activePlayer = activeTeams.includes(team);

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

    if (effectiveStatus === "playing") {
      if (!activePlayer) {
        return (
          <TournamentWaiting
            room={room}
            session={session}
            team={team}
            version={version}
            message={`현재 ${activeTeams.join(" vs ")} 경기가 진행 중이에요. 우리 팀 차례까지 기다려주세요.`}
          />
        );
      }

      return (
        <StudentMatch
          room={room}
          roomCode={session.roomCode}
          session={session}
          team={team}
          myState={myState}
          selectedChoice={selectedChoice}
          submitChoice={submitChoice}
          submitting={submitting}
          feedback={feedback}
          error={error}
          version={version}
        />
      );
    }

    if (effectiveStatus === "betweenMatches") {
      const nextTeams = Array.isArray(room?.nextMatch?.teams) ? room.nextMatch.teams : [];
      const tiePending = Array.isArray(room?.tiePending) && room.tiePending.length === 2;
      return (
        <TournamentWaiting
          room={room}
          session={session}
          team={team}
          version={version}
          message={
            tiePending
              ? "무승부라서 선생님이 진출팀을 정하고 있어요."
              : nextTeams.includes(team)
                ? `다음 ${room.nextMatch?.label || "경기"}에 우리 팀이 출전해요!`
                : `다음 ${room.nextMatch?.label || "경기"}를 기다리고 있어요.`
          }
        />
      );
    }

    if (effectiveStatus === "finished") {
      const champion = room.tournament?.champion || room.winner;
      const myWon = champion === team;
      const draw = room.winner === "draw";
      const finalTeams = getActiveTeams(room);
      const [leftTeam, rightTeam] = finalTeams;
      const leftScore = Number(room.scores?.[leftTeam] || 0);
      const rightScore = Number(room.scores?.[rightTeam] || 0);

      return (
        <main className="student-match-shell" style={{ backgroundImage: `url(${battleArenaBg})` }}>
          <div className="student-match-shade" />
          <section className={`student-result-card student-team-${String(team).toLowerCase()}`}>
            <span className="student-mini-label">{Number(room.config?.teamCount || 2) >= 3 ? "토너먼트 종료" : "경기 종료"}</span>
            <h1>{draw ? "무승부!" : myWon ? "우리 팀 우승!" : `${TEAM_META[champion]?.label || "상대 팀"} 승리`}</h1>
            <div className="student-final-score">
              <div><span>{leftTeam}팀</span><strong>{leftScore}</strong></div>
              <b>:</b>
              <div><span>{rightTeam}팀</span><strong>{rightScore}</strong></div>
            </div>
            <p>{session.name} · {teamMeta.label} · 정답 {myState?.correctCount || 0}개 · 공격 {myState?.attackPower || 0}</p>
            <button type="button" onClick={leaveRoom}>대기실 나가기</button>
          </section>
          <div className="student-version">{version}</div>
        </main>
      );
    }

    return (
      <main className="student-lobby-shell" style={{ backgroundImage: `url(${studentLobbyBg})` }}>
        <div className="student-scene-shade" />

        <div className="student-lobby-top">
          <div className="student-room-chip">ROOM <strong>{session.roomCode}</strong></div>
          <div className={`student-status-chip ${waitingOpen ? "open" : "locked"}`}>
            {effectiveStatus === "starting" ? "경기 준비 중" : waitingOpen ? "입장 중" : "입장 마감"}
          </div>
        </div>

        <section className={`student-wait-card student-team-${String(team).toLowerCase()}`}>
          <div className="student-team-emblem">{team}</div>
          <span className="student-mini-label">{team} TEAM</span>
          <h1>{session.name}</h1>
          <p className="student-assignment-message">
            <strong>{teamMeta.label}</strong>으로 배정되었어요.
          </p>
          <div className="student-reconnect-note">이 기기에서는 새로고침하거나 다시 접속해도 현재 팀을 기억해요.</div>

          <div className="student-waiting-dots" aria-hidden="true"><span /><span /><span /></div>
          <p className="student-wait-copy">
            {effectiveStatus === "starting"
              ? "경기를 준비하고 있어요. 잠시만 기다려주세요."
              : Number(room?.config?.teamCount || 2) >= 3
                ? "토너먼트 대진을 준비하고 있어요. 선생님이 시작할 때까지 기다려주세요."
                : "선생님이 경기를 시작할 때까지 기다려주세요."}
          </p>

          <div className={`student-team-counts team-count-${configuredTeams.length}`}>
            {configuredTeams.map((teamId) => (
              <div key={teamId} className={`team-count-chip team-${teamId.toLowerCase()}`}>
                <span>{teamId}팀</span><strong>{participantsByTeam[teamId]?.length || 0}</strong>
              </div>
            ))}
          </div>

          <button type="button" className="student-leave-button" onClick={leaveRoom}>방 나가기</button>
        </section>

        <div className="student-version">{version}</div>
      </main>
    );
  }

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
            <div className="student-auto-room-code">
              <span>방 코드</span>
              <strong>{roomCode}</strong>
              <small>QR에서 자동으로 입력됐어요</small>
            </div>
          ) : (
            <label>
              방 코드
              <input
                className="student-code-input"
                inputMode="numeric"
                value={roomCode}
                onChange={(event) => setRoomCode(normalizeRoomCode(event.target.value))}
                placeholder="0000"
                autoFocus
              />
            </label>
          )}

          <label>
            이름
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="예: 김민수"
              maxLength={12}
              autoFocus={Boolean(initialRoomCode)}
            />
          </label>

          {error && <div className="student-entry-error">{error}</div>}

          <button type="submit" disabled={joining || !authReady}>
            {joining ? "입장 중..." : "입장하기"}
          </button>
        </form>

        <footer>{version}</footer>
      </section>
    </main>
  );
}

function TournamentWaiting({ room, session, team, version, message }) {
  const activeTeams = getActiveTeams(room);
  const nextTeams = Array.isArray(room?.nextMatch?.teams) ? room.nextMatch.teams : [];
  const teamMeta = TEAM_META[team] || { label: `${team}팀` };

  return (
    <main className="student-lobby-shell" style={{ backgroundImage: `url(${battleArenaBg})` }}>
      <div className="student-scene-shade" />
      <section className={`student-wait-card tournament-wait-card student-team-${String(team).toLowerCase()}`}>
        <div className="student-team-emblem">{team}</div>
        <span className="student-mini-label">TOURNAMENT</span>
        <h1>{session.name}</h1>
        <p className="student-assignment-message"><strong>{teamMeta.label}</strong></p>
        <div className="tournament-student-status">{message}</div>
        <div className="tournament-student-matchup">
          <span>현재 경기</span>
          <strong>{activeTeams.join(" VS ")}</strong>
          {room?.nextMatch && <small>다음 · {room.nextMatch.label} · {nextTeams.join(" VS ")}</small>}
        </div>
        <div className="student-waiting-dots" aria-hidden="true"><span /><span /><span /></div>
        <p className="student-wait-copy">경기 순서가 되면 자동으로 문제 화면으로 바뀝니다.</p>
      </section>
      <div className="student-version">{version}</div>
    </main>
  );
}

function StudentMatch({
  room,
  roomCode,
  session,
  team,
  myState,
  selectedChoice,
  submitChoice,
  submitting,
  feedback,
  error,
  version,
}) {
  const teamRanks = rankTeam(Object.entries(room.participants || {}).map(([id, person]) => ({ id, ...person })).filter(person => person.team === team), room.playerStates || {});
  const myRank = teamRanks.find(person => person.id === session.uid);
  const comboNow = Number(myState?.currentCombo || 0);
  const comboGoal = [[2, '강화탄'], [3, '쌍발탄'], [5, '대형 로켓'], [7, '집중포격'], [10, '피버 · 메테오']].find(([count]) => count > comboNow);
  const now = useNow(true);
  const remaining = Number(room.scheduledEndAt || now) - now;
  const [leftTeam, rightTeam] = getActiveTeams(room);
  const scoreLeft = Number(room.scores?.[leftTeam] || 0);
  const scoreRight = Number(room.scores?.[rightTeam] || 0);
  const current = myState?.currentQuestion;
  const lockedUntil = Number(myState?.lockedUntil || 0);
  const lockRemaining = now > 0
    ? Math.max(0, Math.ceil((lockedUntil - now) / 1000))
    : 0;
  const choiceLocked = lockRemaining > 0;

  return (
    <main className="student-match-shell" style={{ backgroundImage: `url(${battleArenaBg})` }}>
      <div className="student-match-shade" />

      <header className="student-match-topbar">
        <div className={`student-match-team-chip team-${String(team).toLowerCase()}`}>
          <span>{team}팀</span>
          <strong>{session.name}</strong>
        </div>
        <div className="student-match-timer">
          <span>남은 시간</span>
          <strong>{now ? formatRemaining(remaining) : "--:--"}</strong>
        </div>
        <div className="student-match-room-chip">ROOM {roomCode}</div>
      </header>

      <div className="student-live-score">
        <div className={`team-${leftTeam.toLowerCase()}`}><span>{TEAM_META[leftTeam]?.short || leftTeam}</span><strong>{scoreLeft}</strong></div>
        <b>VS</b>
        <div className={`team-${rightTeam.toLowerCase()}`}><span>{TEAM_META[rightTeam]?.short || rightTeam}</span><strong>{scoreRight}</strong></div>
      </div>

      <section className={`student-question-card student-team-${String(team).toLowerCase()}`}>
        {current ? (
          <>
            <div className="student-question-meta">
              <span>{current.category ? `${current.category} · ${current.unit || "주제"}` : current.unit || "문제"}</span>
              <span>{current.difficulty}</span>
              <strong>정답 시 공격 +{current.attackPower || 1}</strong>
            </div>

            <div className="student-question-text"><MathText text={current.text} /></div>

            {Array.isArray(current.choices) && current.choices.length === 4 ? (
              <>
                <div className="student-choice-grid" aria-label="객관식 보기">
                  {current.choices.map((choice, index) => (
                    <button
                      type="button"
                      key={`${current.id}-choice-${index}`}
                      className={`student-choice-button ${selectedChoice === choice ? "selected" : ""}`}
                      onClick={() => submitChoice(choice)}
                      disabled={submitting || Boolean(feedback) || choiceLocked}
                    >
                      <span className="student-choice-number">{["①", "②", "③", "④"][index]}</span>
                      <span className="student-choice-text"><MathText text={choice} /></span>
                    </button>
                  ))}
                </div>
                <p className="student-choice-hint">
                  {choiceLocked
                    ? `오답 대기 중 · ${lockRemaining}초 후 다시 선택할 수 있어요.`
                    : "보기 하나를 누르면 바로 제출돼요."}
                </p>
                {choiceLocked && (
                  <div className="student-guess-lock" role="status" aria-live="polite">
                    <span>찍기 방지</span>
                    <strong>{lockRemaining}</strong>
                    <small>초 후 다시 선택 가능</small>
                    <i style={{ "--lock-progress": `${Math.min(100, Math.max(0, (lockRemaining / (WRONG_LOCK_MS / 1000)) * 100))}%` }} />
                  </div>
                )}
              </>
            ) : (
              <div className="student-answer-error">이 문제는 이전 단답형 형식이에요. 선생님이 새 객관식 문제로 방을 다시 만들어주세요.</div>
            )}

            {submitting && <div className="student-choice-submitting">정답을 확인하고 있어요...</div>}
            {error && <div className="student-answer-error">{error}</div>}

            <div className="student-combo-goal">{comboGoal ? <><span>다음 공격: {comboGoal[1]} · {comboGoal[0] - comboNow}문제 연속 정답 남음</span><progress aria-label="다음 콤보 공격까지 진행도" value={comboNow} max={comboGoal[0]} /></> : <strong>피버 발동 중! 연속 정답을 이어가세요.</strong>}</div>
            <div className="student-personal-stats">
              <span className="student-team-rank">팀 내 {myRank?.tied ? "공동 " : ""}<strong>{myRank?.rank || "-"}위</strong> / {teamRanks.length}명</span>
              <span>정답 <strong>{myState?.correctCount || 0}</strong></span>
              <span>오답 <strong>{myState?.wrongCount || 0}</strong></span>
              <span>내 공격 <strong>{myState?.attackPower || 0}</strong></span>
              <span className={`student-combo-stat ${Number(myState?.currentCombo || 0) >= 2 ? "active" : ""}`}>
                콤보 <strong>{myState?.currentCombo || 0}</strong>
              </span>
            </div>
          </>
        ) : (
          <div className="student-question-loading">
            <span className="soft-spinner" />
            <strong>첫 문제를 준비하고 있어요.</strong>
          </div>
        )}
      </section>

      {feedback && (
        <div className={`student-answer-feedback ${feedback.correct ? "correct" : "wrong"} ${feedback.combo >= 5 ? "combo-burst" : ""}`}>
          <strong>
            {feedback.correct
              ? feedback.combo >= 2
                ? `${feedback.combo} COMBO!`
                : "정답!"
              : feedback.blocked
                ? "잠시 기다려요!"
                : feedback.comboBroken
                  ? "콤보 종료!"
                  : "오답!"}
          </strong>
          <span>
            {feedback.correct
              ? `${feedback.attackLabel ? `${feedback.attackLabel} · ` : ""}우리 팀 공격 +${feedback.attack}${feedback.comboBonus ? ` · 콤보 보너스 +${feedback.comboBonus}` : ""}`
              : feedback.blocked
                ? "아직 대기 시간이 남아 있어요."
                : "찍기 방지를 위해 10초 동안 보기를 선택할 수 없어요."}
          </span>
        </div>
      )}

      <div className="student-version">{version}</div>
    </main>
  );
}
