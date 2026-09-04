import { useEffect, useMemo, useState } from "react";
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

const SESSION_KEY = "math-team-battle-student-session";

function readSavedSession(initialRoomCode) {
  try {
    const parsed = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    if (!parsed) return null;
    if (initialRoomCode && parsed.roomCode !== initialRoomCode) return null;
    return parsed;
  } catch {
    return null;
  }
}

function normalizeRoomCode(value) {
  return value.replace(/\D/g, "").slice(0, 4);
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
        setRoomMissing(!value);
      },
      () => setError("대기실 정보를 불러오지 못했습니다.")
    );

    return unsubscribe;
  }, [session, studentUser]);

  useEffect(() => {
    if (!session || !studentUser || !studentRealtime) return undefined;
    if (session.uid !== studentUser.uid) return undefined;

    const participantRef = ref(
      studentRealtime,
      `rooms/${session.roomCode}/participants/${studentUser.uid}`
    );

    update(participantRef, {
      online: true,
      lastSeen: serverTimestamp(),
    }).catch(() => {});

    const disconnectHandle = onDisconnect(participantRef);
    disconnectHandle
      .update({
        online: false,
        lastSeen: serverTimestamp(),
      })
      .catch(() => {});

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
  const teamA = participants.filter((participant) => participant.team === "A");
  const teamB = participants.filter((participant) => participant.team === "B");

  const ensureAnonymousUser = async () => {
    if (studentAuth.currentUser) return studentAuth.currentUser;
    await prepareStudentAuthPersistence();
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

      const participantRef = ref(
        studentRealtime,
        `rooms/${cleanCode}/participants/${firebaseUser.uid}`
      );
      const ownSnapshot = await get(participantRef);
      const existing = ownSnapshot.val();

      if (!existing && roomData.status !== "waiting") {
        setError("지금은 학생 입장이 마감된 방입니다.");
        return;
      }

      const duplicatedName = Object.entries(roomData.participants || {}).some(
        ([uid, participant]) =>
          uid !== firebaseUser.uid &&
          String(participant.name || "").trim().toLocaleLowerCase("ko") ===
            cleanName.toLocaleLowerCase("ko")
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

        if (!counterResult.committed) {
          throw new Error("team-assignment-failed");
        }

        team = counterResult.snapshot.val() % 2 === 1 ? "A" : "B";
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

  const leaveRoom = async () => {
    if (session && studentRealtime) {
      try {
        await update(
          ref(studentRealtime, `rooms/${session.roomCode}/participants/${session.uid}`),
          { online: false, lastSeen: serverTimestamp() }
        );
      } catch {
        // 방이 이미 닫힌 경우에는 로컬 세션만 정리한다.
      }
    }

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
    const waitingOpen = room?.status === "waiting";

    return (
      <main className="student-lobby-shell" style={{ backgroundImage: `url(${studentLobbyBg})` }}>
        <div className="student-scene-shade" />

        <div className="student-lobby-top">
          <div className="student-room-chip">
            ROOM <strong>{session.roomCode}</strong>
          </div>
          <div className={`student-status-chip ${waitingOpen ? "open" : "locked"}`}>
            {waitingOpen ? "입장 중" : "입장 마감"}
          </div>
        </div>

        {roomMissing ? (
          <section className="student-wait-card room-ended-card">
            <span className="student-mini-label">GAME ROOM CLOSED</span>
            <h1>게임방이 닫혔어요</h1>
            <p>선생님이 새 방을 만들면 다시 입장해주세요.</p>
            <button type="button" onClick={leaveRoom}>다른 방으로 가기</button>
          </section>
        ) : (
          <section className={`student-wait-card student-team-${String(team).toLowerCase()}`}>
            <div className="student-team-emblem">{team}</div>
            <span className="student-mini-label">{team === "A" ? "LAVENDER TEAM" : "MINT TEAM"}</span>
            <h1>{session.name}</h1>
            <p className="student-assignment-message">
              <strong>{team === "A" ? "라벤더 팀" : "민트 팀"}</strong>으로 배정되었어요.
            </p>

            <div className="student-waiting-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <p className="student-wait-copy">선생님이 경기를 시작할 때까지 기다려주세요.</p>

            <div className="student-team-counts">
              <div><span>A팀</span><strong>{teamA.length}</strong></div>
              <div><span>B팀</span><strong>{teamB.length}</strong></div>
            </div>

            <button type="button" className="student-leave-button" onClick={leaveRoom}>
              방 나가기
            </button>
          </section>
        )}

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
        <p>방 코드와 이름만 입력하면 바로 팀이 정해져요.</p>

        <form onSubmit={joinRoom}>
          <label>
            방 코드
            <input
              className="student-code-input"
              inputMode="numeric"
              value={roomCode}
              onChange={(event) => setRoomCode(normalizeRoomCode(event.target.value))}
              placeholder="0000"
              autoFocus={!initialRoomCode}
            />
          </label>

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
