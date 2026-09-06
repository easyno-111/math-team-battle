import { useEffect, useMemo, useRef, useState } from "react";
import {
  get,
  increment,
  onValue,
  push,
  ref,
  remove,
  runTransaction,
  serverTimestamp,
  update,
} from "firebase/database";
import { adminRealtime, realtimeReady } from "../realtime";
import { attackPowerForDifficulty } from "../utils/answerJudge";
import RoomQrCode from "./RoomQrCode";
import teacherLobbyBg from "../assets/game/teacher-lobby.webp";
import battleArenaBg from "../assets/game/battle-arena.webp";

const DIFFICULTIES = ["쉬움", "보통", "어려움", "도전"];
const TEAM_IDS = ["A", "B", "C", "D"];
const TEAM_META = {
  A: { label: "라벤더 팀", short: "라벤더" },
  B: { label: "민트 팀", short: "민트" },
  C: { label: "피치 팀", short: "피치" },
  D: { label: "스카이 팀", short: "스카이" },
};
const ROOM_STORAGE_PREFIX = "math-team-battle-active-room:";
const WRONG_LOCK_MS = 10_000;

function roomStorageKey(uid) {
  return `${ROOM_STORAGE_PREFIX}${uid}`;
}

function makeRoomCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function getPublicBaseUrl() {
  const configured = String(import.meta.env.VITE_PUBLIC_APP_URL || "").trim();
  if (configured) return configured;
  return window.location.href;
}

function buildJoinUrl(roomCode) {
  const url = new URL(getPublicBaseUrl(), window.location.href);
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

function shuffle(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }
  return copy;
}

function normalizeChoice(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .toLocaleLowerCase("ko");
}

function getQuestionCategory(question) {
  const value = String(question?.category || question?.subject || "").trim();
  return value || "기존 문제";
}

function isPlayableQuestion(question) {
  const choices = Array.isArray(question?.choices) ? question.choices : [];
  const correctOption = Number(question?.correctOption);

  return (
    question?.type === "multiple-choice" &&
    question?.enabled !== false &&
    choices.length === 4 &&
    choices.every((choice) => String(choice || "").trim()) &&
    new Set(choices.map(normalizeChoice)).size === 4 &&
    Number.isInteger(correctOption) &&
    correctOption >= 1 &&
    correctOption <= 4
  );
}

function shuffledChoices(choices) {
  return shuffle(choices.map((choice) => String(choice)));
}

function publicQuestion(question) {
  if (!question || !isPlayableQuestion(question)) return null;
  return {
    id: question.id,
    text: question.question,
    choices: shuffledChoices(question.choices),
    category: getQuestionCategory(question),
    unit: question.unit || "",
    difficulty: question.difficulty || "보통",
    attackPower: attackPowerForDifficulty(question.difficulty),
  };
}

function chooseNextQuestion(pool, state) {
  if (pool.length === 0) return { question: null, seen: {} };

  const seen = state?.seenQuestionIds || {};
  const unseen = pool.filter((question) => !seen[question.id]);
  const source = unseen.length > 0 ? unseen : pool;
  const currentId = state?.currentQuestion?.id;
  const withoutCurrent = source.filter((question) => question.id !== currentId);
  const candidates = withoutCurrent.length > 0 ? withoutCurrent : source;
  const question = candidates[Math.floor(Math.random() * candidates.length)];

  return {
    question,
    seen: unseen.length > 0 ? { ...seen, [question.id]: true } : { [question.id]: true },
  };
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

function comboBonusForStreak(combo) {
  if (combo >= 10) return 3;
  if (combo >= 5) return 2;
  if (combo >= 2) return 1;
  return 0;
}

function comboAttackProfile(combo) {
  if (combo >= 10) {
    return {
      type: "fever",
      tier: "fever",
      label: "TEAM FEVER",
      projectileCount: 3,
      duration: 1920,
    };
  }
  if (combo >= 7) {
    return {
      type: "barrage",
      tier: "super",
      label: "집중 포격",
      projectileCount: 5,
      duration: 1800,
    };
  }
  if (combo >= 5) {
    return {
      type: "rocket",
      tier: "super",
      label: "POWER ROCKET",
      projectileCount: 1,
      duration: 1620,
    };
  }
  if (combo >= 3) {
    return {
      type: "double",
      tier: "combo",
      label: "DOUBLE SHOT",
      projectileCount: 2,
      duration: 1460,
    };
  }
  if (combo >= 2) {
    return {
      type: "power",
      tier: "combo",
      label: "POWER SHOT",
      projectileCount: 1,
      duration: 1360,
    };
  }
  return {
    type: "normal",
    tier: "normal",
    label: "BASIC SHOT",
    projectileCount: 1,
    duration: 1320,
  };
}

function attackPlaybackDuration(event) {
  if (Number(event?.duration || 0) > 0) return Number(event.duration);
  return comboAttackProfile(Number(event?.combo || 0)).duration;
}

function attackMotionTiming(type, projectileCount = 1) {
  const profiles = {
    normal: { windup: 220, flight: 650, stagger: 0 },
    power: { windup: 240, flight: 680, stagger: 0 },
    double: { windup: 240, flight: 690, stagger: 105 },
    rocket: { windup: 290, flight: 790, stagger: 0 },
    barrage: { windup: 250, flight: 620, stagger: 92 },
    fever: { windup: 330, flight: 820, stagger: 115 },
  };

  const profile = profiles[type] || profiles.normal;
  const finalLaunchDelay = Math.max(0, Number(projectileCount || 1) - 1) * profile.stagger;
  const impact = profile.windup + finalLaunchDelay + Math.round(profile.flight * 0.86);

  return {
    ...profile,
    impact,
    attackerMotion: Math.max(660, profile.windup + 430),
  };
}

function getBattleEvents(room) {
  if (!room?.battleEvents) return [];
  return Object.entries(room.battleEvents)
    .map(([id, event]) => ({ id, ...event }))
    .filter((event) => event?.attackerUid)
    .sort((a, b) => Number(a.at || 0) - Number(b.at || 0));
}

function pickAttackTarget(participants, attackerTeam, previousTargetUid, activeTeams = ["A", "B"]) {
  const opponentTeam = activeTeams.find((team) => team !== attackerTeam);
  const opponents = participants.filter((participant) => participant.team === opponentTeam);
  if (opponents.length === 0) return null;

  const online = opponents.filter((participant) => participant.online !== false);
  const source = online.length > 0 ? online : opponents;
  const fresh = source.filter((participant) => participant.id !== previousTargetUid);
  const candidates = fresh.length > 0 ? fresh : source;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function getConfiguredTeams(teamCount = 2) {
  const safeCount = Math.max(2, Math.min(4, Number(teamCount) || 2));
  return TEAM_IDS.slice(0, safeCount);
}

function getActiveTeams(room) {
  const teams = room?.activeMatch?.teams;
  return Array.isArray(teams) && teams.length === 2 ? teams : ["A", "B"];
}

function buildInitialTournament(teamCount) {
  if (teamCount <= 2) {
    return {
      teamCount: 2,
      format: "direct",
      currentIndex: 0,
      semi1Winner: null,
      semi2Winner: null,
      champion: null,
    };
  }

  if (teamCount === 3) {
    return {
      teamCount: 3,
      format: "tournament",
      currentIndex: 0,
      byeTeam: "C",
      semi1Winner: null,
      champion: null,
    };
  }

  return {
    teamCount: 4,
    format: "tournament",
    currentIndex: 0,
    semi1Winner: null,
    semi2Winner: null,
    champion: null,
  };
}

function getInitialMatch(teamCount) {
  if (teamCount <= 2) return { index: 0, label: "결승", teams: ["A", "B"] };
  return { index: 0, label: teamCount === 3 ? "준결승" : "준결승 1", teams: ["A", "B"] };
}

function buildNextTournamentState(room, winnerTeam) {
  const teamCount = Number(room?.config?.teamCount || 2);
  const currentIndex = Number(room?.activeMatch?.index || 0);
  const tournament = { ...(room?.tournament || buildInitialTournament(teamCount)) };

  if (teamCount <= 2) {
    return { finished: true, champion: winnerTeam, tournament: { ...tournament, champion: winnerTeam } };
  }

  if (teamCount === 3) {
    if (currentIndex === 0) {
      const nextTournament = { ...tournament, currentIndex: 1, semi1Winner: winnerTeam };
      return {
        finished: false,
        tournament: nextTournament,
        nextMatch: { index: 1, label: "결승", teams: [winnerTeam, tournament.byeTeam || "C"] },
      };
    }

    return {
      finished: true,
      champion: winnerTeam,
      tournament: { ...tournament, currentIndex, champion: winnerTeam },
    };
  }

  if (currentIndex === 0) {
    return {
      finished: false,
      tournament: { ...tournament, currentIndex: 1, semi1Winner: winnerTeam },
      nextMatch: { index: 1, label: "준결승 2", teams: ["C", "D"] },
    };
  }

  if (currentIndex === 1) {
    const semi1Winner = tournament.semi1Winner || "A";
    return {
      finished: false,
      tournament: { ...tournament, currentIndex: 2, semi2Winner: winnerTeam },
      nextMatch: { index: 2, label: "결승", teams: [semi1Winner, winnerTeam] },
    };
  }

  return {
    finished: true,
    champion: winnerTeam,
    tournament: { ...tournament, currentIndex, champion: winnerTeam },
  };
}

function getRopeShift(scoreA, scoreB) {
  const total = Math.max(8, scoreA + scoreB);
  const ratio = (scoreB - scoreA) / Math.max(8, total * 0.58);
  return Math.max(-7.5, Math.min(7.5, ratio * 7.5));
}

function getCharacterPosition(side, index, count) {
  const safeCount = Math.max(1, count);
  const spread = safeCount <= 1 ? 0 : 34 / Math.max(1, safeCount - 1);
  const x = side === "left"
    ? (safeCount <= 1 ? 37 : 8 + spread * index)
    : (safeCount <= 1 ? 63 : 58 + spread * index);
  const y = 54 + (index % 3) * 3.2;
  return { x, y };
}

function useBattlePlayback(matchId, battleEvents) {
  const [activeEvent, setActiveEvent] = useState(null);
  const seen = useRef(new Set());
  const queue = useRef([]);
  const playbackTimer = useRef(null);
  const initializedMatch = useRef("");

  useEffect(() => {
    if (initializedMatch.current === matchId) return undefined;
    initializedMatch.current = matchId || "";
    seen.current = new Set();
    queue.current = [];
    if (playbackTimer.current) window.clearTimeout(playbackTimer.current);
    playbackTimer.current = null;
    setActiveEvent(null);
    return () => {
      if (playbackTimer.current) window.clearTimeout(playbackTimer.current);
      playbackTimer.current = null;
    };
  }, [matchId]);

  useEffect(() => {
    const events = getBattleEvents({ battleEvents });
    if (events.length === 0) return undefined;

    const newEvents = events.filter((event) => !seen.current.has(event.id));
    if (newEvents.length === 0) return undefined;
    newEvents.forEach((event) => seen.current.add(event.id));

    const cutoff = Date.now() - 3500;
    const recentEvents = newEvents.filter((event) => Number(event.at || 0) >= cutoff);
    if (recentEvents.length === 0) return undefined;
    queue.current.push(...recentEvents);
    queue.current = queue.current.slice(-16);

    if (playbackTimer.current) return undefined;

    const playNext = () => {
      const next = queue.current.shift();
      if (!next) {
        playbackTimer.current = null;
        setActiveEvent(null);
        return;
      }

      setActiveEvent(next);
      const duration = attackPlaybackDuration(next);
      playbackTimer.current = window.setTimeout(() => {
        setActiveEvent(null);
        playbackTimer.current = window.setTimeout(playNext, 90);
      }, duration);
    };

    playbackTimer.current = window.setTimeout(playNext, 0);
    return undefined;
  }, [battleEvents]);

  useEffect(() => () => {
    if (playbackTimer.current) window.clearTimeout(playbackTimer.current);
  }, []);

  return activeEvent;
}

export default function GameRoomManager({ user, questions, onGoQuestionBank }) {
  const categories = useMemo(() => {
    return [...new Set(
      questions
        .filter(isPlayableQuestion)
        .map((item) => getQuestionCategory(item))
        .filter(Boolean)
    )].sort((a, b) => a.localeCompare(b, "ko"));
  }, [questions]);

  const questionMap = useMemo(
    () => new Map(questions.map((question) => [question.id, question])),
    [questions]
  );

  const [selectedCategories, setSelectedCategories] = useState(null);
  const [selectedUnits, setSelectedUnits] = useState(null);
  const [selectedDifficulties, setSelectedDifficulties] = useState(DIFFICULTIES);
  const [durationMinutes, setDurationMinutes] = useState(10);
  const [teamCount, setTeamCount] = useState(2);
  const [roomTitle, setRoomTitle] = useState("오늘의 팀 퀴즈");
  const [roomMessage, setRoomMessage] = useState("");
  const [creating, setCreating] = useState(false);
  const [starting, setStarting] = useState(false);
  const [activeRoomCode, setActiveRoomCode] = useState(() =>
    localStorage.getItem(roomStorageKey(user.uid)) || ""
  );
  const [room, setRoom] = useState(null);
  const [roomLoading, setRoomLoading] = useState(Boolean(activeRoomCode));
  const [copyMessage, setCopyMessage] = useState("");
  const [closingConfirm, setClosingConfirm] = useState(false);
  const [qrLarge, setQrLarge] = useState("");
  const [submissions, setSubmissions] = useState(null);
  const processingSubmissions = useRef(new Set());
  const repairingPlayers = useRef(false);

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

  useEffect(() => {
    if (!realtimeReady || !adminRealtime || !activeRoomCode) {
      return undefined;
    }

    const submissionsRef = ref(adminRealtime, `roomSubmissions/${activeRoomCode}`);
    const unsubscribe = onValue(
      submissionsRef,
      (snapshot) => setSubmissions(snapshot.val()),
      (error) => {
        console.error("답안 수신 오류:", error);
        setRoomMessage("학생 답안을 읽지 못했습니다. Realtime Database 규칙을 확인해주세요.");
      }
    );

    return unsubscribe;
  }, [activeRoomCode]);

  const resolvedSelectedCategories = useMemo(() => {
    const source = selectedCategories === null ? categories : selectedCategories;
    return source.filter((category) => categories.includes(category));
  }, [categories, selectedCategories]);

  const units = useMemo(() => {
    return [...new Set(
      questions
        .filter((item) => isPlayableQuestion(item) && resolvedSelectedCategories.includes(getQuestionCategory(item)))
        .map((item) => (item.unit || "").trim())
        .filter(Boolean)
    )].sort((a, b) => a.localeCompare(b, "ko"));
  }, [questions, resolvedSelectedCategories]);

  const resolvedSelectedUnits = useMemo(() => {
    const source = selectedUnits === null ? units : selectedUnits;
    return source.filter((unit) => units.includes(unit));
  }, [selectedUnits, units]);

  const eligibleQuestionCount = useMemo(() => {
    return questions.filter((item) => {
      const itemCategory = getQuestionCategory(item);
      const itemUnit = (item.unit || "").trim();
      return (
        isPlayableQuestion(item) &&
        resolvedSelectedCategories.includes(itemCategory) &&
        resolvedSelectedUnits.includes(itemUnit) &&
        selectedDifficulties.includes(item.difficulty)
      );
    }).length;
  }, [questions, resolvedSelectedCategories, resolvedSelectedUnits, selectedDifficulties]);

  const roomQuestionPool = useMemo(() => {
    if (!room?.config) return [];
    const roomCategories = Array.isArray(room.config.categories) ? room.config.categories : [];
    const roomUnits = room.config.units || [];
    const roomDifficulties = room.config.difficulties || [];
    return questions.filter((item) => (
      isPlayableQuestion(item) &&
      (roomCategories.length === 0 || roomCategories.includes(getQuestionCategory(item))) &&
      roomUnits.includes((item.unit || "").trim()) &&
      roomDifficulties.includes(item.difficulty)
    ));
  }, [questions, room?.config]);

  const participants = useMemo(() => getParticipants(room), [room]);
  const configuredTeams = useMemo(
    () => getConfiguredTeams(room?.config?.teamCount || teamCount),
    [room?.config?.teamCount, teamCount]
  );
  const participantsByTeam = useMemo(() => Object.fromEntries(
    configuredTeams.map((team) => [team, participants.filter((participant) => participant.team === team)])
  ), [configuredTeams, participants]);
  const onlineCount = participants.filter((participant) => participant.online !== false).length;

  const toggleCategory = (category) => {
    setSelectedCategories(
      resolvedSelectedCategories.includes(category)
        ? resolvedSelectedCategories.filter((value) => value !== category)
        : [...resolvedSelectedCategories, category]
    );
    setSelectedUnits(null);
  };

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

    if (resolvedSelectedCategories.length === 0) {
      setRoomMessage("사용할 분야/과목을 하나 이상 선택해주세요.");
      return;
    }

    if (resolvedSelectedUnits.length === 0) {
      setRoomMessage("사용할 주제/단원을 하나 이상 선택해주세요.");
      return;
    }

    if (selectedDifficulties.length === 0) {
      setRoomMessage("사용할 난이도를 하나 이상 선택해주세요.");
      return;
    }

    if (eligibleQuestionCount === 0) {
      setRoomMessage("현재 선택으로 출제할 수 있는 4지선다 문제가 없습니다.");
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
              title: roomTitle.trim() || "오늘의 팀 퀴즈",
              hostUid: user.uid,
              status: "waiting",
              createdAt: serverTimestamp(),
              joinCounter: 0,
              config: {
                categories: resolvedSelectedCategories,
                units: resolvedSelectedUnits,
                difficulties: selectedDifficulties,
                durationMinutes,
                teamCount,
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

      if (!createdCode) throw new Error("room-code-allocation-failed");

      localStorage.setItem(roomStorageKey(user.uid), createdCode);
      setRoomLoading(true);
      setActiveRoomCode(createdCode);
      setRoomMessage("");
    } catch (error) {
      console.error("게임방 생성 오류:", error);
      setRoomMessage("게임방을 만들지 못했습니다. Realtime Database 규칙/주소를 확인해주세요.");
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

  const moveParticipant = async (participantId, nextTeam) => {
    if (!adminRealtime || !activeRoomCode || !room) return;
    if (!configuredTeams.includes(nextTeam)) return;

    try {
      await update(ref(adminRealtime, `rooms/${activeRoomCode}/participants/${participantId}`), {
        team: nextTeam,
        lastSeen: serverTimestamp(),
      });
      setRoomMessage(`${TEAM_META[nextTeam]?.label || `${nextTeam}팀`}으로 이동했어요.`);
      window.setTimeout(() => setRoomMessage(""), 1500);
    } catch (error) {
      console.error("팀 이동 오류:", error);
      setRoomMessage("학생의 팀을 바꾸지 못했습니다. Database 규칙을 확인해주세요.");
    }
  };

  const startBattleForMatch = async ({ baseRoom, match, tournamentState }) => {
    const latestParticipants = getParticipants(baseRoom);
    const activeTeams = match.teams || [];
    const activeParticipants = latestParticipants.filter((participant) => activeTeams.includes(participant.team));

    if (
      activeTeams.length !== 2 ||
      activeTeams.some((team) => !activeParticipants.some((participant) => participant.team === team))
    ) {
      throw new Error("active-team-empty");
    }

    const shuffled = shuffle(roomQuestionPool);
    const playerStates = {};

    activeParticipants.forEach((participant, index) => {
      const question = shuffled[index % shuffled.length];
      playerStates[participant.id] = {
        currentQuestion: publicQuestion(question),
        seenQuestionIds: { [question.id]: true },
        correctCount: 0,
        wrongCount: 0,
        attackPower: 0,
        currentCombo: 0,
        maxCombo: 0,
        lockedUntil: 0,
        lastResult: null,
      };
    });

    const freshScores = Object.fromEntries(activeTeams.map((team) => [team, 0]));

    await update(ref(adminRealtime, `rooms/${activeRoomCode}`), {
      status: "playing",
      startingAt: null,
      startedAt: serverTimestamp(),
      scheduledEndAt:
        Date.now() + (baseRoom.config?.durationMinutes || 10) * 60 * 1000,
      finishedAt: null,
      winner: null,
      scores: freshScores,
      battleEvents: null,
      lastTargetUid: null,
      playerStates,
      activeMatch: match,
      nextMatch: null,
      tiePending: null,
      tournament: tournamentState,
      matchId: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    });

    await remove(ref(adminRealtime, `roomSubmissions/${activeRoomCode}`));
  };

  const startMatch = async () => {
    if (!adminRealtime || !room || !activeRoomCode) return;

    if (roomQuestionPool.length === 0) {
      setRoomMessage("선택한 조건에 맞는 4지선다 문제가 없어 경기를 시작할 수 없어요.");
      return;
    }

    const roomRef = ref(adminRealtime, `rooms/${activeRoomCode}`);
    const previousStatus = room.status === "locked" ? "locked" : "waiting";

    try {
      setStarting(true);
      setRoomMessage("");

      await update(roomRef, {
        status: "starting",
        startingAt: serverTimestamp(),
      });

      const latestSnapshot = await get(roomRef);
      const latestRoom = latestSnapshot.val();

      if (!latestRoom) throw new Error("room-missing-before-start");

      const latestParticipants = getParticipants(latestRoom);
      const selectedTeamCount = Number(latestRoom.config?.teamCount || 2);
      const requiredTeams = getConfiguredTeams(selectedTeamCount);
      const missingTeam = requiredTeams.find(
        (team) => !latestParticipants.some((participant) => participant.team === team)
      );

      if (latestParticipants.length < selectedTeamCount || missingTeam) {
        await update(roomRef, { status: previousStatus, startingAt: null });
        setRoomMessage(`${requiredTeams.map((team) => `${team}팀`).join(" · ")}에 학생이 한 명 이상 있어야 시작할 수 있어요.`);
        return;
      }

      const tournamentState = buildInitialTournament(selectedTeamCount);
      const firstMatch = getInitialMatch(selectedTeamCount);
      await startBattleForMatch({ baseRoom: latestRoom, match: firstMatch, tournamentState });
    } catch (error) {
      console.error("경기 시작 오류:", error);

      try {
        await update(roomRef, { status: previousStatus, startingAt: null });
      } catch {
        // 다음 실시간 스냅샷에서 상태를 다시 확인한다.
      }

      setRoomMessage(
        error?.message === "active-team-empty"
          ? "이번 대진의 두 팀 모두 학생이 한 명 이상 있어야 해요."
          : "경기를 시작하지 못했습니다. 잠시 후 다시 시도하거나 Realtime Database 연결을 확인해주세요."
      );
    } finally {
      setStarting(false);
    }
  };

  const advanceTournament = async (winnerTeam, extra = {}) => {
    if (!adminRealtime || !room || !activeRoomCode) return;

    const currentTeams = getActiveTeams(room);
    if (!currentTeams.includes(winnerTeam)) return;

    const [leftTeam, rightTeam] = currentTeams;
    const scoreLeft = Number(room.scores?.[leftTeam] || 0);
    const scoreRight = Number(room.scores?.[rightTeam] || 0);
    const advance = buildNextTournamentState(room, winnerTeam);
    const historyKey = `match-${Number(room.activeMatch?.index || 0)}`;
    const history = {
      label: room.activeMatch?.label || "경기",
      teams: currentTeams,
      scores: { [leftTeam]: scoreLeft, [rightTeam]: scoreRight },
      winner: winnerTeam,
      resolvedTie: Boolean(extra.resolvedTie),
      finishedAt: Date.now(),
    };

    if (advance.finished) {
      await update(ref(adminRealtime, `rooms/${activeRoomCode}`), {
        status: "finished",
        finishedAt: serverTimestamp(),
        winner: winnerTeam,
        tournament: advance.tournament,
        nextMatch: null,
        tiePending: null,
        [`matchHistory/${historyKey}`]: history,
      });
      return;
    }

    await update(ref(adminRealtime, `rooms/${activeRoomCode}`), {
      status: "betweenMatches",
      finishedAt: serverTimestamp(),
      winner: winnerTeam,
      tournament: advance.tournament,
      nextMatch: advance.nextMatch,
      tiePending: null,
      [`matchHistory/${historyKey}`]: history,
    });
  };

  const finishMatch = async () => {
    if (!adminRealtime || !room || !activeRoomCode || room.status !== "playing") return;
    const activeTeams = getActiveTeams(room);
    const [leftTeam, rightTeam] = activeTeams;
    const scoreLeft = Number(room.scores?.[leftTeam] || 0);
    const scoreRight = Number(room.scores?.[rightTeam] || 0);

    try {
      if (scoreLeft === scoreRight) {
        if (Number(room.config?.teamCount || 2) <= 2) {
          await update(ref(adminRealtime, `rooms/${activeRoomCode}`), {
            status: "finished",
            finishedAt: serverTimestamp(),
            winner: "draw",
          });
          return;
        }

        await update(ref(adminRealtime, `rooms/${activeRoomCode}`), {
          status: "betweenMatches",
          finishedAt: serverTimestamp(),
          winner: "draw",
          tiePending: activeTeams,
          nextMatch: null,
        });
        return;
      }

      const winner = scoreLeft > scoreRight ? leftTeam : rightTeam;
      await advanceTournament(winner);
    } catch (error) {
      console.error("경기 종료 오류:", error);
      setRoomMessage("경기를 종료하지 못했습니다.");
    }
  };

  const resolveTournamentTie = async (winnerTeam) => {
    try {
      await advanceTournament(winnerTeam, { resolvedTie: true });
    } catch (error) {
      console.error("무승부 승리팀 지정 오류:", error);
      setRoomMessage("승리팀을 지정하지 못했습니다.");
    }
  };

  const startNextTournamentMatch = async () => {
    if (!adminRealtime || !room || !activeRoomCode || !room.nextMatch) return;

    try {
      setStarting(true);
      setRoomMessage("");
      await update(ref(adminRealtime, `rooms/${activeRoomCode}`), {
        status: "starting",
        startingAt: serverTimestamp(),
      });
      const snapshot = await get(ref(adminRealtime, `rooms/${activeRoomCode}`));
      const latestRoom = snapshot.val();
      if (!latestRoom) throw new Error("room-missing-before-next-match");
      await startBattleForMatch({
        baseRoom: latestRoom,
        match: latestRoom.nextMatch,
        tournamentState: latestRoom.tournament,
      });
    } catch (error) {
      console.error("다음 경기 시작 오류:", error);
      await update(ref(adminRealtime, `rooms/${activeRoomCode}`), {
        status: "betweenMatches",
        startingAt: null,
      }).catch(() => {});
      setRoomMessage(
        error?.message === "active-team-empty"
          ? "다음 대진의 두 팀에 학생이 한 명 이상 있어야 해요."
          : "다음 경기를 시작하지 못했습니다."
      );
    } finally {
      setStarting(false);
    }
  };

  const closeRoom = async () => {
    if (!adminRealtime || !activeRoomCode) return;

    try {
      await update(ref(adminRealtime), {
        [`rooms/${activeRoomCode}`]: null,
        [`roomSubmissions/${activeRoomCode}`]: null,
      });
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

  // playing 상태인데 특정 학생의 첫 문제가 누락된 경우 자동 복구한다.
  // 학생 화면도 needsSync를 남기므로, 네트워크가 잠깐 늦어도 교사 화면이 다시 문제를 배정한다.
  useEffect(() => {
    if (
      !room ||
      room.status !== "playing" ||
      !adminRealtime ||
      !activeRoomCode ||
      roomQuestionPool.length === 0 ||
      repairingPlayers.current
    ) {
      return;
    }

    const activeTeams = getActiveTeams(room);
    const targets = participants.filter((participant) => {
      if (!activeTeams.includes(participant.team)) return false;
      const state = room.playerStates?.[participant.id];
      return !state?.currentQuestion || participant.needsSync === true;
    });

    if (targets.length === 0) return;

    repairingPlayers.current = true;

    const repair = async () => {
      try {
        const updates = {};

        targets.forEach((participant) => {
          const state = room.playerStates?.[participant.id] || null;

          if (!state?.currentQuestion) {
            const next = chooseNextQuestion(roomQuestionPool, state);
            updates[`playerStates/${participant.id}`] = {
              currentQuestion: publicQuestion(next.question),
              seenQuestionIds: next.seen,
              correctCount: Number(state?.correctCount || 0),
              wrongCount: Number(state?.wrongCount || 0),
              attackPower: Number(state?.attackPower || 0),
              currentCombo: Number(state?.currentCombo || 0),
              maxCombo: Number(state?.maxCombo || 0),
              lockedUntil: Number(state?.lockedUntil || 0),
              lastResult: state?.lastResult || null,
            };
          }

          if (participant.needsSync === true) {
            updates[`participants/${participant.id}/needsSync`] = false;
          }
        });

        if (Object.keys(updates).length > 0) {
          await update(ref(adminRealtime, `rooms/${activeRoomCode}`), updates);
        }
      } catch (error) {
        console.error("학생 경기 상태 자동 복구 오류:", error);
        setRoomMessage("일부 학생의 경기 화면을 다시 동기화하고 있습니다.");
      } finally {
        repairingPlayers.current = false;
      }
    };

    repair();
  }, [
    activeRoomCode,
    participants,
    room,
    roomQuestionPool,
  ]);

  useEffect(() => {
    if (!room || room.status !== "playing" || !submissions || !adminRealtime) return;

    Object.entries(submissions).forEach(([uid, submission]) => {
      if (!submission?.nonce) return;
      const key = `${uid}:${submission.nonce}`;
      if (processingSubmissions.current.has(key)) return;
      processingSubmissions.current.add(key);

      const processSubmission = async () => {
        try {
          const participant = room.participants?.[uid];
          const state = room.playerStates?.[uid];
          const question = questionMap.get(submission.questionId);

          if (!participant || !state || !question || state.currentQuestion?.id !== submission.questionId) {
            await remove(ref(adminRealtime, `roomSubmissions/${activeRoomCode}/${uid}`));
            return;
          }

          const activeLockUntil = Number(state.lockedUntil || 0);
          if (activeLockUntil > Date.now()) {
            await update(ref(adminRealtime), {
              [`rooms/${activeRoomCode}/playerStates/${uid}/lastResult`]: {
                nonce: submission.nonce,
                correct: false,
                blocked: true,
                attack: 0,
                combo: Number(state.currentCombo || 0),
                comboBroken: false,
                lockedUntil: activeLockUntil,
                at: serverTimestamp(),
              },
              [`roomSubmissions/${activeRoomCode}/${uid}`]: null,
            });
            return;
          }

          const selectedChoice = String(submission.choice ?? submission.answer ?? "").trim();
          const offeredChoices = Array.isArray(state.currentQuestion?.choices)
            ? state.currentQuestion.choices
            : [];
          const validSelection = offeredChoices.some(
            (choice) => normalizeChoice(choice) === normalizeChoice(selectedChoice)
          );
          const correctAnswer = question.choices?.[Number(question.correctOption) - 1] || "";
          const correct =
            validSelection &&
            normalizeChoice(selectedChoice) === normalizeChoice(correctAnswer);
          const resultAt = serverTimestamp();

          if (!correct) {
            const brokenCombo = Number(state.currentCombo || 0);
            const lockedUntil = Date.now() + WRONG_LOCK_MS;
            await update(ref(adminRealtime), {
              [`rooms/${activeRoomCode}/playerStates/${uid}/wrongCount`]: Number(state.wrongCount || 0) + 1,
              [`rooms/${activeRoomCode}/playerStates/${uid}/currentCombo`]: 0,
              [`rooms/${activeRoomCode}/playerStates/${uid}/lockedUntil`]: lockedUntil,
              [`rooms/${activeRoomCode}/playerStates/${uid}/lastResult`]: {
                nonce: submission.nonce,
                correct: false,
                attack: 0,
                combo: 0,
                comboBroken: brokenCombo >= 2,
                lockedUntil,
                at: resultAt,
              },
              [`roomSubmissions/${activeRoomCode}/${uid}`]: null,
            });
            return;
          }

          const baseAttack = attackPowerForDifficulty(question.difficulty);
          const combo = Number(state.currentCombo || 0) + 1;
          const comboBonus = comboBonusForStreak(combo);
          const attack = baseAttack + comboBonus;
          const attackProfile = comboAttackProfile(combo);
          const next = chooseNextQuestion(roomQuestionPool, state);
          const activeTeams = getActiveTeams(room);
          const team = participant.team;
          if (!activeTeams.includes(team)) {
            await remove(ref(adminRealtime, `roomSubmissions/${activeRoomCode}/${uid}`));
            return;
          }
          const target = pickAttackTarget(participants, team, room.lastTargetUid || "", activeTeams);
          const eventRef = push(ref(adminRealtime, `rooms/${activeRoomCode}/battleEvents`));
          const eventId = eventRef.key || `${Date.now()}-${uid}`;
          const attackEvent = {
            nonce: submission.nonce,
            attackerUid: uid,
            attackerName: participant.name || "학생",
            attackerTeam: team,
            targetUid: target?.id || "",
            targetName: target?.name || "",
            targetTeam: target?.team || activeTeams.find((value) => value !== team) || "",
            combo,
            tier: attackProfile.tier,
            attackType: attackProfile.type,
            attackLabel: attackProfile.label,
            projectileCount: attackProfile.projectileCount,
            duration: attackProfile.duration,
            baseAttack,
            comboBonus,
            attack,
            at: Date.now(),
          };

          await update(ref(adminRealtime), {
            [`rooms/${activeRoomCode}/playerStates/${uid}/correctCount`]: Number(state.correctCount || 0) + 1,
            [`rooms/${activeRoomCode}/playerStates/${uid}/attackPower`]: Number(state.attackPower || 0) + attack,
            [`rooms/${activeRoomCode}/playerStates/${uid}/currentCombo`]: combo,
            [`rooms/${activeRoomCode}/playerStates/${uid}/maxCombo`]: Math.max(Number(state.maxCombo || 0), combo),
            [`rooms/${activeRoomCode}/playerStates/${uid}/lockedUntil`]: 0,
            [`rooms/${activeRoomCode}/playerStates/${uid}/lastResult`]: {
              nonce: submission.nonce,
              correct: true,
              attack,
              baseAttack,
              comboBonus,
              combo,
              attackType: attackProfile.type,
              attackLabel: attackProfile.label,
              at: resultAt,
            },
            [`rooms/${activeRoomCode}/playerStates/${uid}/currentQuestion`]: publicQuestion(next.question),
            [`rooms/${activeRoomCode}/playerStates/${uid}/seenQuestionIds`]: next.seen,
            [`rooms/${activeRoomCode}/scores/${team}`]: increment(attack),
            [`rooms/${activeRoomCode}/battleEvents/${eventId}`]: attackEvent,
            [`rooms/${activeRoomCode}/lastTargetUid`]: target?.id || null,
            [`roomSubmissions/${activeRoomCode}/${uid}`]: null,
          });
        } catch (error) {
          console.error("정답 판정 오류:", error);
          setRoomMessage("학생 답안을 판정하는 중 오류가 발생했습니다.");
        } finally {
          processingSubmissions.current.delete(key);
        }
      };

      processSubmission();
    });
  }, [activeRoomCode, participants, questionMap, room, roomQuestionPool, submissions]);

  useEffect(() => {
    if (!room?.battleEvents || !adminRealtime || !activeRoomCode) return;
    const events = getBattleEvents(room);
    if (events.length <= 36) return;

    const updates = {};
    events.slice(0, events.length - 28).forEach((event) => {
      updates[`battleEvents/${event.id}`] = null;
    });
    update(ref(adminRealtime, `rooms/${activeRoomCode}`), updates).catch(() => {});
  }, [activeRoomCode, room]);

  useEffect(() => {
    if (!room || room.status !== "playing" || !room.scheduledEndAt) return undefined;

    const timer = window.setInterval(() => {
      if (Date.now() >= Number(room.scheduledEndAt)) {
        finishMatch();
      }
    }, 1000);

    return () => window.clearInterval(timer);
    // finishMatch는 room의 최신 점수를 사용해야 하므로 room 변경 때마다 타이머를 새로 잡는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.status, room?.scheduledEndAt, room?.scores]);

  if (!realtimeReady) {
    return (
      <section className="room-setup-shell">
        <div className="room-setup-card realtime-setup-card">
          <span className="section-pill peach">게임방 준비</span>
          <h2>Realtime Database 주소만 연결하면 돼요</h2>
          <p>문제은행은 그대로 두고, 학생 입장과 경기 정보만 Realtime Database에 저장합니다.</p>

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
            <span>v0.6.3</span>
            <strong>줄다리기 공격과 콤보 연출 연결</strong>
            <p>정답을 맞히면 캐릭터에서 공격이 날아가고 줄이 실시간으로 움직여요.</p>
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
              <p>방을 만든 뒤 QR을 띄우면 학생들이 바로 들어올 수 있어요.</p>
            </div>
            <div className="eligible-count-bubble">
              <strong>{eligibleQuestionCount}</strong>
              <span>사용 가능</span>
            </div>
          </div>

          {categories.length === 0 ? (
            <div className="room-empty-questions">
              <strong>게임에 사용할 객관식 문제가 아직 없어요.</strong>
              <p>문제은행에서 문제를 먼저 등록해주세요.</p>
              <button type="button" className="secondary-button" onClick={onGoQuestionBank}>
                문제은행으로 가기
              </button>
            </div>
          ) : (
            <>
              <label className="room-title-input">
                방 이름
                <input value={roomTitle} onChange={(event) => setRoomTitle(event.target.value)} maxLength={32} />
              </label>

              <div className="room-option-block">
                <div className="room-option-title">
                  <strong>분야 / 과목</strong>
                  <button type="button" onClick={() => { setSelectedCategories(categories); setSelectedUnits(null); }}>전체 선택</button>
                </div>
                <div className="option-chip-grid category-chip-grid">
                  {categories.map((category) => (
                    <button
                      type="button"
                      key={category}
                      className={`choice-chip category-choice-chip ${resolvedSelectedCategories.includes(category) ? "selected" : ""}`}
                      onClick={() => toggleCategory(category)}
                    >
                      <span className="choice-check">{resolvedSelectedCategories.includes(category) ? "✓" : ""}</span>
                      {category}
                    </button>
                  ))}
                </div>
              </div>

              <div className="room-option-block">
                <div className="room-option-title">
                  <strong>주제 / 단원</strong>
                  <button type="button" onClick={() => setSelectedUnits(units)}>전체 선택</button>
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
                      className={`difficulty-choice difficulty-choice-${difficulty} ${selectedDifficulties.includes(difficulty) ? "selected" : ""}`}
                      onClick={() => toggleDifficulty(difficulty)}
                    >
                      {difficulty}
                    </button>
                  ))}
                </div>
              </div>

              <div className="room-option-block">
                <div className="room-option-title">
                  <strong>팀 수</strong>
                  <span>3팀 이상은 토너먼트로 진행</span>
                </div>
                <div className="team-count-row">
                  {[2, 3, 4].map((count) => (
                    <button
                      type="button"
                      key={count}
                      className={teamCount === count ? "selected" : ""}
                      onClick={() => setTeamCount(count)}
                    >
                      <strong>{count}팀</strong>
                      <small>{count === 2 ? "한 경기" : count === 3 ? "준결승 + 결승" : "준결승 2경기 + 결승"}</small>
                    </button>
                  ))}
                </div>
                {teamCount >= 3 && (
                  <div className="tournament-setup-note">
                    {teamCount === 3
                      ? "A팀과 B팀이 먼저 경기하고, C팀은 부전승으로 결승에 올라갑니다."
                      : "A vs B, C vs D 준결승 후 승리한 두 팀이 결승에서 만납니다."}
                  </div>
                )}
              </div>

              <div className="room-option-block">
                <div className="room-option-title">
                  <strong>경기 시간</strong>
                  <span>시간이 끝나면 자동으로 경기 종료</span>
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
          <div className="preview-room-code">QR + 4자리 방 코드</div>
          <div className="preview-team preview-team-a">A팀</div>
          <div className="preview-team preview-team-b">B팀</div>
          {teamCount >= 3 && <div className="preview-team preview-team-c">C팀</div>}
          {teamCount >= 4 && <div className="preview-team preview-team-d">D팀</div>}
          <div className="room-preview-bottom">
            <strong>{teamCount}팀 자동 배정</strong>
            <span>{teamCount === 2 ? "한 경기로 바로 승부해요." : "팀별로 배정한 뒤 토너먼트로 진행해요."}</span>
          </div>
        </div>
      </section>
    );
  }

  const joinUrl = buildJoinUrl(activeRoomCode);

  if (["playing", "betweenMatches", "finished"].includes(room.status)) {
    return (
      <TeacherMatchView
        room={room}
        roomCode={activeRoomCode}
        participants={participants}
        onFinish={finishMatch}
        onStartNext={startNextTournamentMatch}
        onResolveTie={resolveTournamentTie}
        starting={starting}
        onCloseRoom={() => setClosingConfirm(true)}
        closingConfirm={closingConfirm}
        setClosingConfirm={setClosingConfirm}
        closeRoom={closeRoom}
        roomMessage={roomMessage}
      />
    );
  }

  const isLocked = room.status === "locked";
  const isLocalJoinUrl = ["localhost", "127.0.0.1"].includes(new URL(joinUrl).hostname);

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

      <div className={`teacher-team-grid teacher-team-grid-with-qr team-count-${configuredTeams.length}`}>
        <div className="teacher-team-panels-wrap">
          {configuredTeams.map((team) => (
            <TeamPanel
              key={team}
              team={team}
              label={TEAM_META[team]?.label || `${team}팀`}
              participants={participantsByTeam[team] || []}
              teamOptions={configuredTeams}
              onMoveTeam={moveParticipant}
            />
          ))}
        </div>

        <div className="lobby-center-spacer qr-center-column">
          <RoomQrCode joinUrl={joinUrl} roomCode={activeRoomCode} onOpenLarge={setQrLarge} />
          <div className="rope-status-card">
            <span>{configuredTeams.length >= 3 ? "토너먼트 준비" : "준비 중"}</span>
            <strong>{configuredTeams.length >= 3 ? `${configuredTeams.length} TEAM` : "VS"}</strong>
            <small>{configuredTeams.map((team) => `${team} ${participantsByTeam[team]?.length || 0}`).join(" · ")}</small>
          </div>
        </div>
      </div>

      <div className="teacher-lobby-controls">
        <div className="room-config-summary">
          <span>{room.config?.categories?.length || 1}개 분야</span>
          <span>{room.config?.units?.length || 0}개 주제</span>
          <span>{room.config?.difficulties?.join(" · ") || "난이도 전체"}</span>
          <span>{room.config?.durationMinutes || 10}분</span>
          <span>{room.config?.teamCount || 2}팀 {Number(room.config?.teamCount || 2) >= 3 ? "토너먼트" : "대결"}</span>
          <span>문제 {room.config?.questionCountAtCreation || 0}개</span>
        </div>

        {isLocalJoinUrl && (
          <div className="local-qr-warning">
            지금 주소가 localhost라서 다른 기기의 QR 접속은 되지 않아요. 배포 후 자동으로 해결되며,
            필요하면 .env.local에 VITE_PUBLIC_APP_URL을 넣을 수 있어요.
          </div>
        )}

        <div className="lobby-action-row">
          <button type="button" className="lobby-soft-button" onClick={openStudentView}>학생 화면 열기</button>
          <button type="button" className="lobby-soft-button" onClick={toggleRoomLock}>
            {isLocked ? "입장 다시 받기" : "입장 마감"}
          </button>
          <button
            type="button"
            className="lobby-start-button"
            disabled={
              starting ||
              participants.length < configuredTeams.length ||
              configuredTeams.some((team) => (participantsByTeam[team] || []).length === 0)
            }
            onClick={startMatch}
          >
            {starting ? "경기 준비 중..." : "경기 시작"}
          </button>

          {!closingConfirm ? (
            <button type="button" className="lobby-danger-button" onClick={() => setClosingConfirm(true)}>
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

        {(copyMessage || roomMessage) && <div className="lobby-toast">{copyMessage || roomMessage}</div>}
        <div className="join-url-hint" title={joinUrl}>{joinUrl}</div>
      </div>

      {qrLarge && (
        <div className="qr-fullscreen-backdrop" role="presentation" onClick={() => setQrLarge("")}>
          <div className="qr-fullscreen-card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <span>수학 팀 배틀 입장</span>
            <img src={qrLarge} alt={`방 코드 ${activeRoomCode} QR 코드 크게 보기`} />
            <strong>방 코드 {activeRoomCode}</strong>
            <p>QR을 찍고 이름만 입력하세요.</p>
            <button type="button" onClick={() => setQrLarge("")}>닫기</button>
          </div>
        </div>
      )}
    </section>
  );
}

function TeamPanel({ team, label, participants, teamOptions, onMoveTeam }) {
  return (
    <div className={`teacher-team-panel team-${team.toLowerCase()}`}>
      <div className="teacher-team-heading">
        <div>
          <span>{team} TEAM</span>
          <strong>{label}</strong>
        </div>
        <b>{participants.length}</b>
      </div>

      <div className="teacher-participant-list">
        {participants.length === 0 ? (
          <div className="team-empty-slot">학생을 기다리고 있어요</div>
        ) : (
          participants.map((participant) => (
            <div className={`participant-chip ${participant.online === false ? "offline" : ""}`} key={participant.id}>
              <span className="participant-dot" />
              <div className="participant-chip-main">
                <strong>{participant.name}</strong>
                <small>{participant.online === false ? "오프라인" : "접속"}</small>
              </div>
              <select
                className="participant-team-select"
                value={participant.team}
                onChange={(event) => onMoveTeam?.(participant.id, event.target.value)}
                aria-label={`${participant.name} 팀 이동`}
              >
                {teamOptions.map((teamId) => (
                  <option value={teamId} key={teamId}>{teamId}팀</option>
                ))}
              </select>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function TeacherMatchView({
  room,
  roomCode,
  participants,
  onFinish,
  onStartNext,
  onResolveTie,
  starting,
  closingConfirm,
  setClosingConfirm,
  closeRoom,
  roomMessage,
}) {
  const playing = room.status === "playing";
  const betweenMatches = room.status === "betweenMatches";
  const finished = room.status === "finished";
  const now = useNow(playing);
  const remaining = playing ? Number(room.scheduledEndAt || now) - now : 0;
  const [leftTeam, rightTeam] = getActiveTeams(room);
  const scoreLeft = Number(room.scores?.[leftTeam] || 0);
  const scoreRight = Number(room.scores?.[rightTeam] || 0);
  const playerStates = room.playerStates || {};
  const leftParticipants = participants.filter((participant) => participant.team === leftTeam);
  const rightParticipants = participants.filter((participant) => participant.team === rightTeam);
  const activeAttack = useBattlePlayback(room.matchId, room.battleEvents);
  const ropeShift = getRopeShift(scoreLeft, scoreRight);
  const teamCount = Number(room.config?.teamCount || 2);
  const winnerLabel = room.winner && room.winner !== "draw"
    ? TEAM_META[room.winner]?.label || `${room.winner}팀`
    : "무승부";

  return (
    <section className="teacher-match-shell" style={{ backgroundImage: `url(${battleArenaBg})` }}>
      <div className="match-scene-shade" />

      <header className="teacher-match-scoreboard">
        <div
          key={`score-left-${activeAttack?.id || "idle"}`}
          className={`match-score team-${leftTeam.toLowerCase()}-score ${activeAttack?.attackerTeam === leftTeam ? "is-scoring" : ""}`}
        >
          <span>{TEAM_META[leftTeam]?.short || leftTeam}</span>
          <strong>{scoreLeft}</strong>
        </div>
        <div className="match-center-info">
          <span>{room.activeMatch?.label || (teamCount >= 3 ? "토너먼트" : `ROOM ${roomCode}`)}</span>
          <strong>{playing ? (now ? formatRemaining(remaining) : "--:--") : betweenMatches ? "NEXT" : "FINISH"}</strong>
          <small>ROOM {roomCode} · {room.title}</small>
        </div>
        <div
          key={`score-right-${activeAttack?.id || "idle"}`}
          className={`match-score team-${rightTeam.toLowerCase()}-score ${activeAttack?.attackerTeam === rightTeam ? "is-scoring" : ""}`}
        >
          <span>{TEAM_META[rightTeam]?.short || rightTeam}</span>
          <strong>{scoreRight}</strong>
        </div>
      </header>

      {betweenMatches && (
        <div className="tournament-break-banner">
          <span>{room.activeMatch?.label || "경기"} 종료</span>
          <strong>{room.winner === "draw" ? "무승부" : `${winnerLabel} 승리`}</strong>
          <p>{TEAM_META[leftTeam]?.short || leftTeam} {scoreLeft} : {scoreRight} {TEAM_META[rightTeam]?.short || rightTeam}</p>

          {Array.isArray(room.tiePending) && room.tiePending.length === 2 ? (
            <div className="tournament-tie-actions">
              <small>토너먼트 진출팀을 선택해주세요.</small>
              {room.tiePending.map((team) => (
                <button type="button" key={team} onClick={() => onResolveTie(team)}>
                  {TEAM_META[team]?.label || `${team}팀`} 진출
                </button>
              ))}
            </div>
          ) : room.nextMatch ? (
            <div className="tournament-next-match-card">
              <small>다음 경기 · {room.nextMatch.label}</small>
              <b>{TEAM_META[room.nextMatch.teams?.[0]]?.label || room.nextMatch.teams?.[0]} VS {TEAM_META[room.nextMatch.teams?.[1]]?.label || room.nextMatch.teams?.[1]}</b>
              <button type="button" disabled={starting} onClick={onStartNext}>
                {starting ? "다음 경기 준비 중..." : "다음 경기 시작"}
              </button>
            </div>
          ) : null}
        </div>
      )}

      {finished && (
        <div className="match-result-banner">
          <span>{teamCount >= 3 ? "토너먼트 종료" : "경기 종료"}</span>
          <strong>{room.winner === "draw" ? "무승부" : `${winnerLabel} 승리`}</strong>
          {teamCount >= 3 && room.tournament?.champion && <p>최종 우승 · {TEAM_META[room.tournament.champion]?.label}</p>}
          {teamCount <= 2 && <p>{scoreLeft} : {scoreRight}</p>}
        </div>
      )}

      <BattleStage
        leftTeam={leftTeam}
        rightTeam={rightTeam}
        leftParticipants={leftParticipants}
        rightParticipants={rightParticipants}
        playerStates={playerStates}
        activeAttack={activeAttack}
        ropeShift={ropeShift}
        scoreLeft={scoreLeft}
        scoreRight={scoreRight}
        celebrating={betweenMatches || finished}
        winnerTeam={room.winner}
      />

      <div className="match-roster-grid">
        <MatchTeamList team={leftTeam} participants={leftParticipants} playerStates={playerStates} />
        <div className="match-live-hint">
          <span>{teamCount >= 3 ? room.activeMatch?.label || "토너먼트" : "실시간 줄다리기"}</span>
          <strong>{
            scoreLeft === scoreRight
              ? "가운데에서 팽팽합니다"
              : scoreLeft > scoreRight
                ? `${TEAM_META[leftTeam]?.label || leftTeam}이 당기는 중`
                : `${TEAM_META[rightTeam]?.label || rightTeam}이 당기는 중`
          }</strong>
          <small>밝은 중앙선은 기준점, 큰 매듭은 현재 줄 위치예요.</small>
        </div>
        <MatchTeamList team={rightTeam} participants={rightParticipants} playerStates={playerStates} />
      </div>

      <div className="teacher-match-controls">
        {playing && <button type="button" className="match-finish-button" onClick={onFinish}>지금 경기 종료</button>}

        {!closingConfirm ? (
          <button type="button" className="match-close-button" onClick={() => setClosingConfirm(true)}>방 닫기</button>
        ) : (
          <div className="close-room-confirm match-close-confirm">
            <span>게임방까지 삭제할까요?</span>
            <button type="button" onClick={() => setClosingConfirm(false)}>취소</button>
            <button type="button" onClick={closeRoom}>방 닫기</button>
          </div>
        )}
        {roomMessage && <div className="lobby-toast">{roomMessage}</div>}
      </div>
    </section>
  );
}

function BattleStage({
  leftTeam,
  rightTeam,
  leftParticipants,
  rightParticipants,
  playerStates,
  activeAttack,
  ropeShift,
  scoreLeft,
  scoreRight,
  celebrating,
  winnerTeam,
}) {
  const allCharacters = [
    ...leftParticipants.map((participant, index) => ({
      ...participant,
      team: leftTeam,
      side: "left",
      state: playerStates[participant.id] || {},
      position: getCharacterPosition("left", index, leftParticipants.length),
      index,
    })),
    ...rightParticipants.map((participant, index) => ({
      ...participant,
      team: rightTeam,
      side: "right",
      state: playerStates[participant.id] || {},
      position: getCharacterPosition("right", index, rightParticipants.length),
      index,
    })),
  ];

  const attacker = allCharacters.find((character) => character.id === activeAttack?.attackerUid);
  const target = allCharacters.find((character) => character.id === activeAttack?.targetUid);
  const attackerOnRight = activeAttack?.attackerTeam === rightTeam;
  const attackerPosition = attacker?.position || { x: attackerOnRight ? 72 : 28, y: 56 };
  const targetPosition = target?.position || { x: attackerOnRight ? 28 : 72, y: 56 };
  const midX = (attackerPosition.x + targetPosition.x) / 2;
  const attackProfile = comboAttackProfile(Number(activeAttack?.combo || 0));
  const attackTier = activeAttack?.tier || attackProfile.tier;
  const attackType = activeAttack?.attackType || attackProfile.type;
  const attackLabel = activeAttack?.attackLabel || attackProfile.label;
  const projectileCount = Number(activeAttack?.projectileCount || attackProfile.projectileCount || 1);
  const motionTiming = attackMotionTiming(attackType, projectileCount);
  const pullClass = scoreLeft === scoreRight ? "center" : scoreLeft > scoreRight ? "pull-a" : "pull-b";
  const characterCount = allCharacters.length;
  const densityClass = characterCount >= 34
    ? "very-crowded"
    : characterCount >= 24
      ? "crowded"
      : "";

  return (
    <div
      className={`battle-stage ${pullClass} ${densityClass} ${activeAttack ? `attack-active attack-${attackType}` : ""} ${celebrating ? `match-celebration winner-${String(winnerTeam || "draw").toLowerCase()}` : ""}`.trim()}
      style={{
        "--rope-shift": `${ropeShift}%`,
        "--character-shift": `${ropeShift * 0.62}%`,
        "--windup-duration": `${motionTiming.windup / 1000}s`,
        "--attacker-motion-duration": `${motionTiming.attackerMotion / 1000}s`,
        "--impact-delay": `${motionTiming.impact / 1000}s`,
        "--impact-nudge": `${attackerOnRight ? 10 : -10}px`,
        "--impact-rebound": `${attackerOnRight ? -3 : 3}px`,
        "--character-impact-nudge": `${attackerOnRight ? 5 : -5}px`,
        "--character-impact-rebound": `${attackerOnRight ? -2 : 2}px`,
      }}
    >
      <div className={`battle-stage-team-label battle-stage-team-a team-theme-${leftTeam.toLowerCase()}`}>{leftTeam} TEAM</div>
      <div className={`battle-stage-team-label battle-stage-team-b team-theme-${rightTeam.toLowerCase()}`}>{rightTeam} TEAM</div>

      <div className="battle-center-line" />
      <div className="battle-center-beacon"><span>CENTER</span><i /></div>
      <div className="battle-rope-shadow" />
      <div className="battle-rope">
        <span className="battle-rope-fiber" />
        <span className="battle-rope-knot"><i /><b>현재 줄</b></span>
      </div>

      <div className="battle-character-layer">
        {allCharacters.map((character) => {
          const combo = Number(character.state.currentCombo || 0);
          const isAttacker = activeAttack?.attackerUid === character.id;
          const isHit = activeAttack?.targetUid === character.id;
          const isFeverSupport = attackType === "fever" && activeAttack?.attackerTeam === character.team && !isAttacker;
          const sideCount = character.side === "left" ? leftParticipants.length : rightParticipants.length;
          const compactScale = Math.max(0.64, 1 - Math.max(0, sideCount - 8) * 0.028);
          const idlePaused = sideCount > 12 && character.index % (sideCount > 18 ? 4 : 3) !== 0;

          return (
            <div
              className={`rope-student rope-student-${character.team.toLowerCase()} rope-side-${character.side} ${idlePaused ? "idle-paused" : ""} ${combo >= 10 ? "combo-fever-ready" : combo >= 5 ? "combo-hot" : combo >= 2 ? "combo-ready" : ""} ${isAttacker ? "is-attacking" : ""} ${isHit ? "is-hit" : ""} ${isFeverSupport ? "fever-support" : ""}`}
              style={{
                left: `${character.position.x}%`,
                top: `${character.position.y}%`,
                "--char-delay": `${(character.index % 7) * -0.13}s`,
                "--char-scale": compactScale,
              }}
              key={character.id}
            >
              <div className="rope-student-name">
                <strong>{character.name}</strong>
                {combo >= 2 && <span>{combo} COMBO</span>}
              </div>
              {isAttacker && (
                <div className={`rope-student-action action-${attackTier}`}>
                  <strong>+{Number(activeAttack?.attack || 0)}</strong>
                  <span>{Number(activeAttack?.combo || 0) >= 2 ? `${activeAttack.combo} COMBO` : "정답!"}</span>
                </div>
              )}
              <div className="pixel-person">
                <span className="pixel-head"><i /></span>
                <span className="pixel-body" />
                <span className="pixel-arm pixel-arm-front" />
                <span className="pixel-arm pixel-arm-back" />
                <span className="pixel-leg pixel-leg-front" />
                <span className="pixel-leg pixel-leg-back" />
              </div>
            </div>
          );
        })}
      </div>

      {activeAttack && (
        <>
          <div
            className={`attack-charge attack-charge-${attackType}`}
            style={{ left: `${attackerPosition.x}%`, top: `${attackerPosition.y - 4}%` }}
          >
            <span />
            <i />
          </div>

          {Array.from({ length: projectileCount }).map((_, projectileIndex) => {
            const fanOffset = projectileCount <= 1
              ? 0
              : (projectileIndex - (projectileCount - 1) / 2) * (attackType === "barrage" ? 3.6 : 2.2);
            const arcLift = attackType === "rocket" || attackType === "fever" ? 5 : 0;

            return (
              <div
                key={`${activeAttack.id}-projectile-${projectileIndex}`}
                className={`battle-projectile projectile-${activeAttack.attackerTeam?.toLowerCase()} projectile-${attackTier} attack-style-${attackType}`}
                style={{
                  "--attack-start-x": `${attackerPosition.x}%`,
                  "--attack-mid-x": `${midX + fanOffset * 0.35}%`,
                  "--attack-end-x": `${targetPosition.x + fanOffset}%`,
                  "--attack-start-y": `${attackerPosition.y - 5}%`,
                  "--attack-peak-y": `${Math.max(10, 21 - arcLift - Math.abs(fanOffset) * 0.4)}%`,
                  "--attack-end-y": `${targetPosition.y - 5 + Math.abs(fanOffset) * 0.25}%`,
                  "--projectile-delay": `${(motionTiming.windup + projectileIndex * motionTiming.stagger) / 1000}s`,
                  "--projectile-duration": `${motionTiming.flight / 1000}s`,
                  "--projectile-index": projectileIndex,
                }}
              >
                <span className="projectile-tail" />
                <span className="projectile-core">
                  {attackType === "rocket" || attackType === "fever" ? "Σ" : attackType === "double" ? "×2" : "×"}
                </span>
                {(attackType === "rocket" || attackType === "fever") && <span className="projectile-fins" />}
              </div>
            );
          })}

          <div
            key={`${activeAttack.id}-impact`}
            className={`battle-impact impact-${activeAttack.targetTeam?.toLowerCase()} impact-style-${attackType}`}
            style={{ left: `${targetPosition.x}%`, top: `${targetPosition.y - 3}%` }}
          >
            <span />
            <i />
            {(attackType === "rocket" || attackType === "barrage" || attackType === "fever") && <b />}
            <div className="battle-impact-sparks">
              {Array.from({ length: 8 }).map((_, sparkIndex) => (
                <em
                  key={`${activeAttack.id}-spark-${sparkIndex}`}
                  style={{
                    "--spark-angle": `${sparkIndex * 45}deg`,
                    "--spark-distance": `${32 + (sparkIndex % 3) * 8}px`,
                    "--spark-delay": `${motionTiming.impact / 1000}s`,
                  }}
                />
              ))}
            </div>
          </div>

          {(attackType === "rocket" || attackType === "barrage" || attackType === "fever") && (
            <div
              className={`battle-shockwave shockwave-${attackType}`}
              style={{ left: `${targetPosition.x}%`, top: `${targetPosition.y - 3}%` }}
            />
          )}

          {attackType === "fever" && (
            <div className={`team-fever-flash team-fever-${activeAttack.attackerTeam?.toLowerCase()}`}>
              <span>{activeAttack.attackerTeam} TEAM</span>
              <strong>FEVER</strong>
            </div>
          )}

          <div className={`battle-attack-callout callout-${attackTier} callout-style-${attackType}`} key={`${activeAttack.id}-callout`}>
            <span>{activeAttack.attackerName}</span>
            <strong>{Number(activeAttack.combo || 0) >= 2 ? `${activeAttack.combo} COMBO!` : "정답!"}</strong>
            <em>{attackLabel}</em>
            <small>공격 +{activeAttack.attack}</small>
          </div>
        </>
      )}

      {celebrating && winnerTeam && winnerTeam !== "draw" && (
        <div className={`battle-victory-overlay victory-${String(winnerTeam).toLowerCase()}`}>
          <span className="battle-finish-word">FINISH!</span>
          <div className="battle-victory-card">
            <small>{TEAM_META[winnerTeam]?.label || `${winnerTeam}팀`}</small>
            <strong>승리!</strong>
          </div>
          <div className="battle-confetti" aria-hidden="true">
            {Array.from({ length: 18 }).map((_, confettiIndex) => (
              <i
                key={`confetti-${confettiIndex}`}
                style={{
                  "--confetti-x": `${8 + (confettiIndex * 17) % 84}%`,
                  "--confetti-delay": `${(confettiIndex % 7) * 0.07}s`,
                  "--confetti-rotate": `${(confettiIndex * 47) % 180}deg`,
                }}
              />
            ))}
          </div>
        </div>
      )}

      <div className="battle-pull-indicator">
        <span>{leftTeam}</span>
        <div className="battle-pull-track">
          <em />
          <i style={{ left: `calc(50% + ${ropeShift}%)` }} />
        </div>
        <span>{rightTeam}</span>
      </div>
    </div>
  );
}

function MatchTeamList({ team, participants, playerStates }) {
  return (
    <div className={`match-team-list match-team-${team.toLowerCase()}`}>
      <div className="match-team-list-title">
        <span>{team} TEAM</span>
        <strong>{TEAM_META[team]?.label || `${team}팀`}</strong>
      </div>
      <div className="match-student-list">
        {participants.map((participant) => {
          const state = playerStates[participant.id] || {};
          const combo = Number(state.currentCombo || 0);
          return (
            <div className="match-student-row" key={participant.id}>
              <div>
                <strong>{participant.name}</strong>
                <span>{combo >= 2 ? `${combo} COMBO` : state.currentQuestion ? `${state.currentQuestion.category || "기존 문제"} · ${state.currentQuestion.unit || "주제"}` : "문제 준비 중"}</span>
              </div>
              <div className="match-student-stats">
                <b>{state.correctCount || 0}정답</b>
                <small>공격 {state.attackPower || 0}</small>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
