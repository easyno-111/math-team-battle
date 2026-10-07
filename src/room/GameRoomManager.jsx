import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { get, onValue, push, ref, remove, runTransaction, serverTimestamp, update } from "firebase/database";
import { adminRealtime, realtimeReady } from "../realtime";
import { configuredTeams } from "../game/teams";
import { filterQuestionPool, questionCategory, questionUnit, isPlayableQuestion, chooseNextQuestion, publicQuestion, DIFFICULTIES } from "../game/questions";
import { clampHpPerMember, createTeamState, finishByTime, normalizeTeams } from "../game/rules";
import { initialPlayerState, judgeSubmission } from "../game/grading";
import { EVENT_HISTORY, getParticipants, groupByTeam, makeRoomCode, roomStorageKey } from "./roomUtils";
import RealtimeSetupNotice from "./RealtimeSetupNotice";
import RoomSetup from "./RoomSetup";
import TeacherLobby from "./TeacherLobby";
import TeacherMatch from "./TeacherMatch";

export default function GameRoomManager({ user, questions, onGoQuestionBank }) {
  const [activeRoomCode, setActiveRoomCode] = useState(() => localStorage.getItem(roomStorageKey(user.uid)) || "");
  const [room, setRoom] = useState(null);
  const [roomLoading, setRoomLoading] = useState(Boolean(activeRoomCode));
  const [submissions, setSubmissions] = useState(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const roomRef = useRef(null);
  const gradingQueue = useRef(Promise.resolve());
  const processed = useRef(new Set());
  const teamsMirror = useRef(null);
  const repairing = useRef(false);
  const finishing = useRef(false);

  const questionMap = useMemo(() => new Map(questions.map((question) => [question.id, question])), [questions]);
  const playable = useMemo(() => questions.filter(isPlayableQuestion), [questions]);
  const roomPool = useMemo(() => (room?.config ? filterQuestionPool(questions, room.config) : []), [questions, room?.config]);
  const participants = useMemo(() => getParticipants(room), [room]);
  const teams = useMemo(() => configuredTeams(room?.config?.teamCount), [room?.config?.teamCount]);
  const byTeam = useMemo(() => groupByTeam(participants, teams), [participants, teams]);

  const roomPath = `rooms/${activeRoomCode}`;
  const notify = useCallback((text, ms = 0) => {
    setMessage(text);
    if (ms) window.setTimeout(() => setMessage((current) => (current === text ? "" : current)), ms);
  }, []);

  const forgetRoom = useCallback(() => {
    localStorage.removeItem(roomStorageKey(user.uid));
    setActiveRoomCode("");
    setRoom(null);
    roomRef.current = null;
  }, [user.uid]);

  // Room snapshot. roomRef is updated synchronously so the grading queue never reads stale state.
  useEffect(() => {
    if (!realtimeReady || !adminRealtime || !activeRoomCode) return undefined;
    const unsubscribe = onValue(ref(adminRealtime, `rooms/${activeRoomCode}`), (snapshot) => {
      const value = snapshot.val();
      if (!value) { forgetRoom(); }
      else if (value.hostUid !== user.uid) { forgetRoom(); notify("이 방을 관리할 권한이 없습니다."); }
      else { roomRef.current = value; setRoom(value); }
      setRoomLoading(false);
    }, (error) => {
      console.error("게임방 불러오기 오류:", error);
      notify("게임방 정보를 불러오지 못했습니다. Realtime Database 규칙을 확인해주세요.");
      setRoomLoading(false);
    });
    return unsubscribe;
  }, [activeRoomCode, forgetRoom, notify, user.uid]);

  useEffect(() => {
    if (!realtimeReady || !adminRealtime || !activeRoomCode) return undefined;
    return onValue(ref(adminRealtime, `roomSubmissions/${activeRoomCode}`), (snapshot) => setSubmissions(snapshot.val()), (error) => {
      console.error("답안 수신 오류:", error);
      notify("학생 답안을 읽지 못했습니다. Realtime Database 규칙을 확인해주세요.");
    });
  }, [activeRoomCode, notify]);

  // Grading: one submission at a time, sharing a local mirror of team state so volleys never race.
  useEffect(() => {
    if (!submissions || !adminRealtime || !activeRoomCode) return;
    for (const [uid, submission] of Object.entries(submissions)) {
      if (!submission?.nonce) continue;
      const key = `${uid}:${submission.nonce}`;
      if (processed.current.has(key)) continue;
      processed.current.add(key);
      if (processed.current.size > 2000) processed.current = new Set([...processed.current].slice(-1000));
      gradingQueue.current = gradingQueue.current.then(() => gradeOne(uid, submission)).catch((error) => {
        console.error("정답 판정 오류:", error);
        notify("학생 답안을 판정하는 중 오류가 발생했습니다.");
      });
    }
    gradingQueue.current = gradingQueue.current.then(() => { teamsMirror.current = null; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submissions]);

  async function gradeOne(uid, submission) {
    const current = roomRef.current;
    const submissionPath = `roomSubmissions/${activeRoomCode}/${uid}`;
    if (!current || current.status !== "playing") { await remove(ref(adminRealtime, submissionPath)); return; }
    const teamsNow = teamsMirror.current || normalizeTeams(current.teams);
    const question = questionMap.get(submission.questionId);
    const pool = filterQuestionPool(questions, current.config);
    const result = judgeSubmission({ room: current, teams: teamsNow, uid, submission, question, pool });
    const updates = { [submissionPath]: null };
    for (const [path, value] of Object.entries(result.updates)) updates[`${roomPath}/${path}`] = value;
    if (result.kind === "correct") {
      teamsMirror.current = result.teams;
      const eventKey = push(ref(adminRealtime, `${roomPath}/battleEvents`)).key;
      updates[`${roomPath}/battleEvents/${eventKey}`] = result.event;
    }
    await update(ref(adminRealtime), updates);
  }

  // Keep only the most recent events; the arena replays only fresh ones anyway.
  useEffect(() => {
    if (!room?.battleEvents || !adminRealtime || !activeRoomCode) return;
    const ids = Object.entries(room.battleEvents).sort((a, b) => Number(a[1]?.at || 0) - Number(b[1]?.at || 0)).map(([id]) => id);
    if (ids.length <= EVENT_HISTORY + 8) return;
    const updates = Object.fromEntries(ids.slice(0, ids.length - EVENT_HISTORY).map((id) => [`battleEvents/${id}`, null]));
    update(ref(adminRealtime, roomPath), updates).catch(() => {});
  }, [activeRoomCode, room?.battleEvents, roomPath]);

  // A student who joined late or whose first question got lost asks for a repair via needsSync.
  useEffect(() => {
    if (!room || room.status !== "playing" || !adminRealtime || !roomPool.length || repairing.current) return;
    const targets = participants.filter((participant) => !room.playerStates?.[participant.id]?.currentQuestion || participant.needsSync === true);
    if (!targets.length) return;
    repairing.current = true;
    const updates = {};
    for (const participant of targets) {
      const state = room.playerStates?.[participant.id];
      if (!state?.currentQuestion) {
        const next = chooseNextQuestion(roomPool, state);
        updates[`playerStates/${participant.id}`] = { ...initialPlayerState(next.question), ...state, currentQuestion: publicQuestion(next.question), seenQuestionIds: next.seen, lastResult: state?.lastResult || null };
      }
      if (participant.needsSync === true) updates[`participants/${participant.id}/needsSync`] = false;
    }
    update(ref(adminRealtime, roomPath), updates)
      .catch((error) => { console.error("학생 경기 상태 복구 오류:", error); })
      .finally(() => { repairing.current = false; });
  }, [participants, room, roomPath, roomPool]);

  // Clock. The gourd burst ends the game earlier; this handles the time limit.
  useEffect(() => {
    if (!room || room.status !== "playing" || !room.scheduledEndAt) return undefined;
    const timer = window.setInterval(() => { if (Date.now() >= Number(room.scheduledEndAt)) finishMatch("time"); }, 1000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.status, room?.scheduledEndAt]);

  async function createRoom(config) {
    if (!realtimeReady || !adminRealtime) { notify("Realtime Database 주소를 먼저 연결해주세요."); return; }
    setBusy(true);
    try {
      let created = "";
      for (let attempt = 0; attempt < 30 && !created; attempt += 1) {
        const code = makeRoomCode();
        const result = await runTransaction(ref(adminRealtime, `rooms/${code}`), (current) => (current === null ? {
          code, title: config.title, hostUid: user.uid, status: "waiting", createdAt: serverTimestamp(), joinCounter: 0,
          config: { categories: config.categories, units: config.units, difficulties: config.difficulties, durationMinutes: config.durationMinutes, teamCount: config.teamCount, gourdHpPerMember: clampHpPerMember(config.gourdHpPerMember), questionCountAtCreation: config.questionCount },
        } : undefined), { applyLocally: false });
        if (result.committed) created = code;
      }
      if (!created) throw new Error("room-code-allocation-failed");
      localStorage.setItem(roomStorageKey(user.uid), created);
      setRoomLoading(true);
      setActiveRoomCode(created);
      setMessage("");
    } catch (error) {
      console.error("게임방 생성 오류:", error);
      notify("게임방을 만들지 못했습니다. Realtime Database 규칙과 주소를 확인해주세요.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleLock() {
    if (!room) return;
    await update(ref(adminRealtime, roomPath), { status: room.status === "waiting" ? "locked" : "waiting" }).catch(() => notify("입장 상태를 바꾸지 못했습니다."));
  }

  async function moveParticipant(participantId, team) {
    if (!teams.includes(team)) return;
    try {
      await update(ref(adminRealtime, `${roomPath}/participants/${participantId}`), { team, lastSeen: serverTimestamp() });
    } catch (error) {
      console.error("팀 이동 오류:", error);
      notify("학생의 팀을 바꾸지 못했습니다.");
    }
  }

  async function startMatch() {
    if (!room || !adminRealtime) return;
    if (!roomPool.length) { notify("선택한 조건에 맞는 객관식 문제가 없어 경기를 시작할 수 없어요."); return; }
    const previous = room.status === "locked" ? "locked" : "waiting";
    setBusy(true);
    try {
      await update(ref(adminRealtime, roomPath), { status: "starting", startingAt: serverTimestamp() });
      const latest = (await get(ref(adminRealtime, roomPath))).val();
      if (!latest) throw new Error("room-missing");
      const latestParticipants = getParticipants(latest);
      const grouped = groupByTeam(latestParticipants, teams);
      const empty = teams.find((team) => !grouped[team].length);
      if (empty) {
        await update(ref(adminRealtime, roomPath), { status: previous, startingAt: null });
        notify(`${teams.map((team) => `${team}팀`).join(" · ")} 모두에 학생이 한 명 이상 있어야 시작할 수 있어요.`);
        return;
      }
      const minutes = Number(latest.config?.durationMinutes || 10);
      const pool = [...roomPool];
      const playerStates = Object.fromEntries(latestParticipants.map((participant, index) => [participant.id, initialPlayerState(pool[index % pool.length])]));
      const hpPerMember = clampHpPerMember(latest.config?.gourdHpPerMember);
      const teamStates = Object.fromEntries(teams.map((team) => [team, createTeamState(grouped[team].length, hpPerMember)]));
      processed.current.clear();
      teamsMirror.current = null;
      finishing.current = false;
      await update(ref(adminRealtime, roomPath), {
        status: "playing", startingAt: null, startedAt: serverTimestamp(), scheduledEndAt: Date.now() + minutes * 60_000,
        finishedAt: null, winner: null, finishReason: null, tiedTeams: null, ranking: null,
        teams: teamStates, playerStates, battleEvents: null, matchId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      });
      await remove(ref(adminRealtime, `roomSubmissions/${activeRoomCode}`));
    } catch (error) {
      console.error("경기 시작 오류:", error);
      await update(ref(adminRealtime, roomPath), { status: previous, startingAt: null }).catch(() => {});
      notify("경기를 시작하지 못했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setBusy(false);
    }
  }

  async function finishMatch(reason = "teacher") {
    const current = roomRef.current;
    if (!current || current.status !== "playing" || finishing.current) return;
    finishing.current = true;
    try {
      await gradingQueue.current;
      const latest = roomRef.current;
      if (!latest || latest.status !== "playing") return;
      const outcome = finishByTime(latest.teams);
      await update(ref(adminRealtime, roomPath), {
        status: "finished", finishedAt: serverTimestamp(), finishReason: reason,
        winner: outcome.winner, tiedTeams: outcome.tied.length ? outcome.tied : null,
        ranking: outcome.ranking.map(({ team, rank, hp, maxHp }) => ({ team, rank, hp, maxHp })),
      });
    } catch (error) {
      console.error("경기 종료 오류:", error);
      notify("경기를 종료하지 못했습니다.");
    } finally {
      finishing.current = false;
    }
  }

  async function resolveTie(team) {
    await update(ref(adminRealtime, roomPath), { winner: team, tiedTeams: null, finishReason: "teacher" }).catch(() => notify("승리팀을 지정하지 못했습니다."));
  }

  async function restartLobby() {
    if (!room) return;
    try {
      await update(ref(adminRealtime, roomPath), { status: "waiting", teams: null, playerStates: null, battleEvents: null, winner: null, tiedTeams: null, ranking: null, finishReason: null, scheduledEndAt: null });
      await remove(ref(adminRealtime, `roomSubmissions/${activeRoomCode}`));
      await update(ref(adminRealtime, roomPath), Object.fromEntries(participants.map((p) => [`participants/${p.id}/needsSync`, null])));
    } catch (error) {
      console.error("대기실 복귀 오류:", error);
      notify("대기실로 돌아가지 못했습니다.");
    }
  }

  async function closeRoom() {
    if (!activeRoomCode) return;
    try {
      await update(ref(adminRealtime), { [roomPath]: null, [`roomSubmissions/${activeRoomCode}`]: null });
      forgetRoom();
      notify("게임방을 닫았습니다.", 2500);
    } catch (error) {
      console.error("게임방 삭제 오류:", error);
      notify("게임방을 닫지 못했습니다.");
    }
  }

  if (!realtimeReady) return <RealtimeSetupNotice />;
  if (roomLoading) {
    return <div className="room-loading-card"><span className="soft-spinner" /><strong>게임방을 불러오는 중이에요.</strong></div>;
  }
  if (!room) {
    return (
      <RoomSetup
        questions={playable}
        difficulties={DIFFICULTIES}
        categoryOf={questionCategory}
        unitOf={questionUnit}
        busy={busy}
        message={message}
        onCreate={createRoom}
        onGoQuestionBank={onGoQuestionBank}
      />
    );
  }
  if (["playing", "finished"].includes(room.status)) {
    return (
      <TeacherMatch
        room={room}
        roomCode={activeRoomCode}
        teams={teams}
        participants={participants}
        byTeam={byTeam}
        message={message}
        onFinish={() => finishMatch("teacher")}
        onResolveTie={resolveTie}
        onRestart={restartLobby}
        onClose={closeRoom}
      />
    );
  }
  return (
    <TeacherLobby
      room={room}
      roomCode={activeRoomCode}
      teams={teams}
      participants={participants}
      byTeam={byTeam}
      busy={busy}
      message={message}
      onToggleLock={toggleLock}
      onMove={moveParticipant}
      onStart={startMatch}
      onClose={closeRoom}
      onNotify={notify}
    />
  );
}
