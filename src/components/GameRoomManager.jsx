import { useEffect, useMemo, useState } from "react";
import {
  onValue,
  ref,
  remove,
  runTransaction,
  serverTimestamp,
  update,
} from "firebase/database";
import { adminRealtime, realtimeReady } from "../realtime";
import teacherLobbyBg from "../assets/game/teacher-lobby.webp";
import battleArenaBg from "../assets/game/battle-arena.webp";

const DIFFICULTIES = ["쉬움", "보통", "어려움", "도전"];
const ROOM_STORAGE_PREFIX = "math-team-battle-active-room:";

function roomStorageKey(uid) {
  return `${ROOM_STORAGE_PREFIX}${uid}`;
}

function makeRoomCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function buildJoinUrl(roomCode) {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("join", roomCode);
  return url.toString();
}

function getParticipants(room) {
  if (!room?.participants) return [];

  return Object.entries(room.participants)
    .map(([id, participant]) => ({ id, ...participant }))
    .sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
}

export default function GameRoomManager({ user, questions, onGoQuestionBank }) {
  const units = useMemo(() => {
    return [...new Set(
      questions
        .filter((item) => item.enabled !== false)
        .map((item) => (item.unit || "").trim())
        .filter(Boolean)
    )].sort((a, b) => a.localeCompare(b, "ko"));
  }, [questions]);

  const [selectedUnits, setSelectedUnits] = useState(null);
  const [selectedDifficulties, setSelectedDifficulties] = useState(DIFFICULTIES);
  const [durationMinutes, setDurationMinutes] = useState(10);
  const [roomTitle, setRoomTitle] = useState("오늘의 수학 대결");
  const [roomMessage, setRoomMessage] = useState("");
  const [creating, setCreating] = useState(false);
  const [activeRoomCode, setActiveRoomCode] = useState(() =>
    localStorage.getItem(roomStorageKey(user.uid)) || ""
  );
  const [room, setRoom] = useState(null);
  const [roomLoading, setRoomLoading] = useState(Boolean(activeRoomCode));
  const [copyMessage, setCopyMessage] = useState("");
  const [closingConfirm, setClosingConfirm] = useState(false);

  useEffect(() => {
    if (!realtimeReady || !adminRealtime || !activeRoomCode) return undefined;

    const roomRef = ref(adminRealtime, `rooms/${activeRoomCode}`);

    const unsubscribe = onValue(
      roomRef,
      (snapshot) => {
        const value = snapshot.val();

        if (!value) {
          setRoom(null);
          setActiveRoomCode("");
          localStorage.removeItem(roomStorageKey(user.uid));
        } else if (value.hostUid !== user.uid) {
          setRoom(null);
          setRoomMessage("이 방을 관리할 권한이 없습니다.");
          setActiveRoomCode("");
          localStorage.removeItem(roomStorageKey(user.uid));
        } else {
          setRoom(value);
        }

        setRoomLoading(false);
      },
      (error) => {
        console.error("게임방 불러오기 오류:", error);
        setRoomMessage("게임방 정보를 불러오지 못했습니다. Realtime Database 규칙을 확인해주세요.");
        setRoomLoading(false);
      }
    );

    return unsubscribe;
  }, [activeRoomCode, user.uid]);

  const resolvedSelectedUnits = useMemo(() => {
    const source = selectedUnits === null ? units : selectedUnits;
    return source.filter((unit) => units.includes(unit));
  }, [selectedUnits, units]);

  const eligibleQuestionCount = useMemo(() => {
    return questions.filter((item) => {
      const itemUnit = (item.unit || "").trim();
      return (
        item.enabled !== false &&
        resolvedSelectedUnits.includes(itemUnit) &&
        selectedDifficulties.includes(item.difficulty)
      );
    }).length;
  }, [questions, resolvedSelectedUnits, selectedDifficulties]);

  const participants = useMemo(() => getParticipants(room), [room]);
  const teamA = participants.filter((participant) => participant.team === "A");
  const teamB = participants.filter((participant) => participant.team === "B");
  const onlineCount = participants.filter((participant) => participant.online !== false).length;

  const toggleUnit = (unit) => {
    setSelectedUnits(
      resolvedSelectedUnits.includes(unit)
        ? resolvedSelectedUnits.filter((value) => value !== unit)
        : [...resolvedSelectedUnits, unit]
    );
  };

  const toggleDifficulty = (difficulty) => {
    setSelectedDifficulties((current) =>
      current.includes(difficulty)
        ? current.filter((value) => value !== difficulty)
        : [...current, difficulty]
    );
  };

  const createRoom = async () => {
    if (!realtimeReady || !adminRealtime) {
      setRoomMessage("Realtime Database 주소를 먼저 연결해주세요.");
      return;
    }

    if (resolvedSelectedUnits.length === 0) {
      setRoomMessage("사용할 단원을 하나 이상 선택해주세요.");
      return;
    }

    if (selectedDifficulties.length === 0) {
      setRoomMessage("사용할 난이도를 하나 이상 선택해주세요.");
      return;
    }

    if (eligibleQuestionCount === 0) {
      setRoomMessage("현재 선택으로 출제할 수 있는 문제가 없습니다.");
      return;
    }

    try {
      setCreating(true);
      setRoomMessage("");

      let createdCode = "";

      for (let attempt = 0; attempt < 30; attempt += 1) {
        const roomCode = makeRoomCode();
        const roomRef = ref(adminRealtime, `rooms/${roomCode}`);

        const result = await runTransaction(
          roomRef,
          (current) => {
            if (current !== null) return;

            return {
              code: roomCode,
              title: roomTitle.trim() || "오늘의 수학 대결",
              hostUid: user.uid,
              status: "waiting",
              createdAt: serverTimestamp(),
              joinCounter: 0,
              config: {
                units: resolvedSelectedUnits,
                difficulties: selectedDifficulties,
                durationMinutes,
                teamCount: 2,
                questionCountAtCreation: eligibleQuestionCount,
              },
            };
          },
          { applyLocally: false }
        );

        if (result.committed) {
          createdCode = roomCode;
          break;
        }
      }

      if (!createdCode) {
        throw new Error("room-code-allocation-failed");
      }

      localStorage.setItem(roomStorageKey(user.uid), createdCode);
      setRoomLoading(true);
      setActiveRoomCode(createdCode);
      setRoomMessage("");
    } catch (error) {
      console.error("게임방 생성 오류:", error);
      setRoomMessage(
        "게임방을 만들지 못했습니다. Anonymous 로그인과 Realtime Database 규칙/주소를 확인해주세요."
      );
    } finally {
      setCreating(false);
    }
  };

  const toggleRoomLock = async () => {
    if (!room || !adminRealtime || !activeRoomCode) return;

    try {
      await update(ref(adminRealtime, `rooms/${activeRoomCode}`), {
        status: room.status === "waiting" ? "locked" : "waiting",
      });
    } catch (error) {
      console.error("입장 상태 변경 오류:", error);
      setRoomMessage("입장 상태를 바꾸지 못했습니다.");
    }
  };

  const closeRoom = async () => {
    if (!adminRealtime || !activeRoomCode) return;

    try {
      await remove(ref(adminRealtime, `rooms/${activeRoomCode}`));
      localStorage.removeItem(roomStorageKey(user.uid));
      setActiveRoomCode("");
      setRoom(null);
      setClosingConfirm(false);
      setRoomMessage("게임방을 닫았습니다.");
    } catch (error) {
      console.error("게임방 삭제 오류:", error);
      setRoomMessage("게임방을 닫지 못했습니다.");
    }
  };

  const copyJoinUrl = async () => {
    if (!activeRoomCode) return;

    try {
      await navigator.clipboard.writeText(buildJoinUrl(activeRoomCode));
      setCopyMessage("학생 입장 주소를 복사했어요.");
    } catch {
      setCopyMessage("주소 복사가 막혀 있어요. 학생 화면 열기를 사용해주세요.");
    }

    window.setTimeout(() => setCopyMessage(""), 2200);
  };

  const openStudentView = () => {
    if (!activeRoomCode) return;
    window.open(buildJoinUrl(activeRoomCode), "_blank", "noopener,noreferrer");
  };

  if (!realtimeReady) {
    return (
      <section className="room-setup-shell">
        <div className="room-setup-card realtime-setup-card">
          <span className="section-pill peach">게임방 준비</span>
          <h2>Realtime Database 주소만 연결하면 돼요</h2>
          <p>
            문제은행은 그대로 두고, 학생 입장과 대기실 정보만 Realtime Database에 저장합니다.
          </p>

          <div className="setup-code-card">
            <strong>프로젝트 루트에 .env.local 파일 만들기</strong>
            <code>VITE_FIREBASE_DATABASE_URL=https://...firebasedatabase.app</code>
          </div>

          <div className="setup-check-list">
            <span>1. Firebase Console → Realtime Database에서 데이터베이스 생성</span>
            <span>2. Authentication에서 익명(Anonymous) 로그인 활성화</span>
            <span>3. 패치에 포함된 database.rules.json 내용을 Realtime Database 규칙에 게시</span>
            <span>4. .env.local 저장 후 npm run dev를 다시 시작</span>
          </div>
        </div>

        <div className="room-preview-card" style={{ backgroundImage: `url(${battleArenaBg})` }}>
          <div className="room-preview-overlay">
            <span>v0.4.0</span>
            <strong>파스텔 도트 체육관 대기실</strong>
            <p>연결이 끝나면 이 화면에서 바로 방을 만들 수 있어요.</p>
          </div>
        </div>
      </section>
    );
  }

  if (roomLoading) {
    return (
      <div className="room-loading-card">
        <span className="soft-spinner" />
        <strong>게임방을 불러오는 중이에요.</strong>
      </div>
    );
  }

  if (!room) {
    return (
      <section className="room-setup-shell">
        <div className="room-setup-card">
          <div className="room-setup-heading">
            <div>
              <span className="section-pill mint">새 게임방</span>
              <h2>오늘 사용할 문제를 고르세요</h2>
              <p>이 단계에서는 방과 팀만 구성하고, 실제 문제 출제는 다음 버전에서 연결합니다.</p>
            </div>
            <div className="eligible-count-bubble">
              <strong>{eligibleQuestionCount}</strong>
              <span>사용 가능</span>
            </div>
          </div>

          {units.length === 0 ? (
            <div className="room-empty-questions">
              <strong>단원이 있는 문제가 아직 없어요.</strong>
              <p>문제은행에서 문제를 먼저 등록해주세요.</p>
              <button type="button" className="secondary-button" onClick={onGoQuestionBank}>
                문제은행으로 가기
              </button>
            </div>
          ) : (
            <>
              <label className="room-title-input">
                방 이름
                <input
                  value={roomTitle}
                  onChange={(event) => setRoomTitle(event.target.value)}
                  maxLength={32}
                />
              </label>

              <div className="room-option-block">
                <div className="room-option-title">
                  <strong>단원</strong>
                  <button type="button" onClick={() => setSelectedUnits(units)}>
                    전체 선택
                  </button>
                </div>
                <div className="option-chip-grid">
                  {units.map((unit) => (
                    <button
                      type="button"
                      key={unit}
                      className={`choice-chip ${resolvedSelectedUnits.includes(unit) ? "selected" : ""}`}
                      onClick={() => toggleUnit(unit)}
                    >
                      <span className="choice-check">{resolvedSelectedUnits.includes(unit) ? "✓" : ""}</span>
                      {unit}
                    </button>
                  ))}
                </div>
              </div>

              <div className="room-option-block">
                <div className="room-option-title">
                  <strong>난이도</strong>
                  <span>여러 개 선택 가능</span>
                </div>
                <div className="difficulty-choice-row">
                  {DIFFICULTIES.map((difficulty) => (
                    <button
                      type="button"
                      key={difficulty}
                      className={`difficulty-choice difficulty-choice-${difficulty} ${
                        selectedDifficulties.includes(difficulty) ? "selected" : ""
                      }`}
                      onClick={() => toggleDifficulty(difficulty)}
                    >
                      {difficulty}
                    </button>
                  ))}
                </div>
              </div>

              <div className="room-option-block">
                <div className="room-option-title">
                  <strong>경기 시간</strong>
                  <span>본 게임에서 사용할 설정</span>
                </div>
                <div className="duration-row">
                  {[5, 7, 10, 15].map((minutes) => (
                    <button
                      type="button"
                      key={minutes}
                      className={durationMinutes === minutes ? "selected" : ""}
                      onClick={() => setDurationMinutes(minutes)}
                    >
                      {minutes}분
                    </button>
                  ))}
                </div>
              </div>

              {roomMessage && <div className="room-message">{roomMessage}</div>}

              <button
                type="button"
                className="create-room-button"
                disabled={creating || eligibleQuestionCount === 0}
                onClick={createRoom}
              >
                {creating ? "게임방 만드는 중..." : "게임방 만들기"}
              </button>
            </>
          )}
        </div>

        <div className="room-preview-card" style={{ backgroundImage: `url(${teacherLobbyBg})` }}>
          <div className="preview-room-code">4자리 방 코드</div>
          <div className="preview-team preview-team-a">A팀</div>
          <div className="preview-team preview-team-b">B팀</div>
          <div className="room-preview-bottom">
            <strong>학생들이 들어오면</strong>
            <span>양쪽 팀에 자동으로 번갈아 배정돼요.</span>
          </div>
        </div>
      </section>
    );
  }

  const joinUrl = buildJoinUrl(activeRoomCode);
  const isLocked = room.status === "locked";

  return (
    <section className="teacher-lobby" style={{ backgroundImage: `url(${teacherLobbyBg})` }}>
      <div className="lobby-vignette" />

      <div className="teacher-lobby-topbar">
        <div className="lobby-title-card">
          <span>{isLocked ? "입장 마감" : "학생 입장 중"}</span>
          <strong>{room.title || "오늘의 수학 대결"}</strong>
        </div>

        <div className="lobby-room-code-card">
          <span>방 코드</span>
          <strong>{activeRoomCode}</strong>
          <button type="button" onClick={copyJoinUrl}>주소 복사</button>
        </div>

        <div className="lobby-online-card">
          <span>현재 접속</span>
          <strong>{onlineCount}명</strong>
          <small>전체 등록 {participants.length}명</small>
        </div>
      </div>

      <div className="teacher-team-grid">
        <TeamPanel team="A" label="라벤더 팀" participants={teamA} />
        <div className="lobby-center-spacer">
          <div className="rope-status-card">
            <span>준비 중</span>
            <strong>VS</strong>
            <small>{teamA.length} : {teamB.length}</small>
          </div>
        </div>
        <TeamPanel team="B" label="민트 팀" participants={teamB} />
      </div>

      <div className="teacher-lobby-controls">
        <div className="room-config-summary">
          <span>{room.config?.units?.length || 0}개 단원</span>
          <span>{room.config?.difficulties?.join(" · ") || "난이도 전체"}</span>
          <span>{room.config?.durationMinutes || 10}분</span>
          <span>문제 {room.config?.questionCountAtCreation || 0}개</span>
        </div>

        <div className="lobby-action-row">
          <button type="button" className="lobby-soft-button" onClick={openStudentView}>
            학생 화면 열기
          </button>
          <button type="button" className="lobby-soft-button" onClick={toggleRoomLock}>
            {isLocked ? "입장 다시 받기" : "입장 마감"}
          </button>
          <button type="button" className="lobby-start-button" disabled>
            경기 시작 · 다음 단계
          </button>

          {!closingConfirm ? (
            <button
              type="button"
              className="lobby-danger-button"
              onClick={() => setClosingConfirm(true)}
            >
              방 닫기
            </button>
          ) : (
            <div className="close-room-confirm">
              <span>정말 닫을까요?</span>
              <button type="button" onClick={() => setClosingConfirm(false)}>취소</button>
              <button type="button" onClick={closeRoom}>방 닫기</button>
            </div>
          )}
        </div>

        {(copyMessage || roomMessage) && (
          <div className="lobby-toast">{copyMessage || roomMessage}</div>
        )}
        <div className="join-url-hint" title={joinUrl}>{joinUrl}</div>
      </div>
    </section>
  );
}

function TeamPanel({ team, label, participants }) {
  return (
    <div className={`teacher-team-panel team-${team.toLowerCase()}`}>
      <div className="teacher-team-heading">
        <div>
          <span>{team} TEAM</span>
          <strong>{label}</strong>
        </div>
        <b>{participants.length}</b>
      </div>

      <div className="teacher-player-list">
        {participants.length === 0 ? (
          <div className="teacher-team-empty">
            <span>+</span>
            <p>학생을 기다리는 중</p>
          </div>
        ) : (
          participants.map((participant) => (
            <div className={`teacher-player-chip ${participant.online === false ? "offline" : ""}`} key={participant.id}>
              <span className="player-dot" />
              <strong>{participant.name}</strong>
              <small>{participant.online === false ? "오프라인" : "접속"}</small>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
