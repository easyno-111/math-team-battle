import { useMemo, useState } from "react";
import { configuredTeams } from "../game/teams";
import { getParticipants, groupByTeam } from "../room/roomUtils";
import RoomSetup from "../room/RoomSetup";
import TeacherLobby from "../room/TeacherLobby";
import TeacherMatch from "../room/TeacherMatch";
import { StudentMatch } from "../components/StudentLobby";
import ArenaPreview from "./ArenaPreview";
import { mockRoom } from "./mockRoom";
import { DIFFICULTIES, questionCategory, questionUnit } from "../game/questions";
import "../styles/base.css";
import "../styles/questions.css";
import "../styles/room.css";
import "../styles/student.css";

const SCREENS = ["arena", "setup", "lobby", "match", "finished", "student"];
const noop = () => {};

// ?mode=preview&screen=lobby&teams=4 — every teacher/student screen with fake data, no Firebase.
export default function ScreenPreview() {
  const params = new URLSearchParams(window.location.search);
  const [screen, setScreen] = useState(SCREENS.includes(params.get("screen")) ? params.get("screen") : "arena");
  const teamCount = Math.max(2, Math.min(4, Number(params.get("teams")) || 2));
  const room = useMemo(() => mockRoom(teamCount, screen === "finished" ? "finished" : screen === "lobby" ? "waiting" : "playing"), [teamCount, screen]);
  const teams = configuredTeams(teamCount);
  const participants = getParticipants(room);
  const byTeam = groupByTeam(participants, teams);
  const questions = useMemo(() => Array.from({ length: 30 }, (_, i) => ({ id: `q${i}`, type: "multiple-choice", question: "Q", choices: ["1", "2", "3", "4"], correctOption: 1, category: i % 2 ? "공통수학2" : "상식퀴즈", unit: ["평면좌표", "직선의 방정식", "세계 상식"][i % 3], difficulty: DIFFICULTIES[i % 4] })), []);

  const nav = (
    <nav className="preview-nav">
      {SCREENS.map((item) => <button type="button" key={item} aria-pressed={screen === item} onClick={() => { setScreen(item); const url = new URL(window.location.href); url.searchParams.set("screen", item); window.history.replaceState(null, "", url); }}>{item}</button>)}
      <span>teams={teamCount} (주소의 &teams=2~4)</span>
    </nav>
  );

  if (screen === "arena") return <>{nav}<ArenaPreview /></>;
  if (screen === "setup") return <main className="admin-shell room-section-active">{nav}<RoomSetup questions={questions} difficulties={DIFFICULTIES} categoryOf={questionCategory} unitOf={questionUnit} busy={false} message="" onCreate={noop} onGoQuestionBank={noop} /></main>;
  if (screen === "lobby") return <main className="admin-shell room-section-active">{nav}<TeacherLobby room={room} roomCode={room.code} teams={teams} participants={participants} byTeam={byTeam} busy={false} message="" onToggleLock={noop} onMove={noop} onStart={noop} onClose={noop} onNotify={noop} /></main>;
  if (screen === "match" || screen === "finished") {
    const shown = screen === "finished" ? { ...room, winner: "A", finishReason: "burst" } : room;
    return <main className="admin-shell room-section-active">{nav}<TeacherMatch room={shown} roomCode={room.code} teams={teams} participants={participants} byTeam={byTeam} message="" onFinish={noop} onResolveTie={noop} onRestart={noop} onClose={noop} /></main>;
  }
  const session = { roomCode: room.code, uid: "s0", name: "김민수", team: "A" };
  return <>{nav}<StudentMatch room={room} roomCode={room.code} session={session} team="A" teams={teams} myState={room.playerStates.s0} selectedChoice="" submitChoice={noop} submitting={false} feedback={null} error="" version="preview" /></>;
}
