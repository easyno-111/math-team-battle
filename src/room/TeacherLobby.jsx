import { useState } from "react";
import { teamLabel } from "../game/teams";
import RoomQrCode from "../components/RoomQrCode";
import { buildJoinUrl } from "./roomUtils";
import teacherLobbyBg from "../assets/game/teacher-lobby.webp";

function TeamPanel({ team, participants, teamOptions, onMove }) {
  return (
    <div className={`teacher-team-panel team-${team.toLowerCase()}`}>
      <div className="teacher-team-heading">
        <div><span>{team} TEAM</span><strong>{teamLabel(team)}</strong></div>
        <b title="등록 학생 수">{participants.length}명</b>
      </div>
      <div className="teacher-participant-list" tabIndex={0} aria-label={`${teamLabel(team)} 학생 목록`}>
        {!participants.length ? <div className="team-empty-slot">학생을 기다리고 있어요</div> : participants.map((participant) => (
          <div className={`participant-chip ${participant.online === false ? "offline" : ""}`} key={participant.id}>
            <span className="participant-dot" />
            <div className="participant-chip-main"><strong>{participant.name}</strong><small>{participant.online === false ? "오프라인" : "접속 중"}</small></div>
            <select className="participant-team-select" value={participant.team} onChange={(e) => onMove(participant.id, e.target.value)} aria-label={`${participant.name} 팀 이동`}>
              {teamOptions.map((id) => <option value={id} key={id}>{id}팀</option>)}
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function TeacherLobby({ room, roomCode, teams, participants, byTeam, busy, message, onToggleLock, onMove, onStart, onClose, onNotify }) {
  const [qrLarge, setQrLarge] = useState("");
  const [closing, setClosing] = useState(false);
  const joinUrl = buildJoinUrl(roomCode);
  const isLocked = room.status === "locked";
  const isLocal = ["localhost", "127.0.0.1"].includes(new URL(joinUrl).hostname);
  const online = participants.filter((p) => p.online !== false).length;
  const canStart = !busy && teams.every((team) => byTeam[team]?.length > 0);

  const copyJoinUrl = async () => {
    try { await navigator.clipboard.writeText(joinUrl); onNotify("학생 입장 주소를 복사했어요.", 2200); }
    catch { onNotify("주소 복사가 막혀 있어요. 학생 화면 열기를 사용해주세요.", 2200); }
  };

  return (
    <section className="teacher-lobby" style={{ backgroundImage: `url(${teacherLobbyBg})` }}>
      <div className="lobby-vignette" />
      <div className="teacher-lobby-topbar">
        <div className="lobby-title-card"><span>{isLocked ? "입장 마감" : "학생 입장 중"}</span><strong>{room.title || "오늘의 수학 대결"}</strong></div>
        <div className="lobby-room-code-card"><span>방 코드</span><strong>{roomCode}</strong><button type="button" onClick={copyJoinUrl}>주소 복사</button></div>
        <div className="lobby-online-card"><span>현재 접속</span><strong>{online}명</strong><small>전체 등록 {participants.length}명</small></div>
      </div>

      <div className={`teacher-team-grid teacher-team-grid-with-qr team-count-${teams.length}`}>
        <div className="teacher-team-panels-wrap">
          {teams.map((team) => <TeamPanel key={team} team={team} participants={byTeam[team] || []} teamOptions={teams} onMove={onMove} />)}
        </div>
        <div className="lobby-center-spacer qr-center-column">
          <RoomQrCode joinUrl={joinUrl} roomCode={roomCode} onOpenLarge={setQrLarge} />
          <div className="rope-status-card">
            <span>준비 중</span>
            <strong>{teams.length} TEAM</strong>
            <small>{teams.map((team) => `${team} ${byTeam[team]?.length || 0}`).join(" · ")}</small>
          </div>
        </div>
      </div>

      <div className="teacher-lobby-controls">
        <div className="room-config-summary">
          <span>{room.config?.categories?.length || 1}개 분야</span>
          <span>{room.config?.units?.length || 0}개 주제</span>
          <span>{room.config?.difficulties?.join(" · ") || "난이도 전체"}</span>
          <span>{room.config?.durationMinutes || 10}분</span>
          <span>{teams.length}팀 박 터뜨리기</span>
          <span>문제 {room.config?.questionCountAtCreation || 0}개</span>
        </div>
        {isLocal && <div className="local-qr-warning">지금 주소가 localhost라서 다른 기기의 QR 접속은 되지 않아요. 배포 후 자동으로 해결되며, 필요하면 .env.local에 VITE_PUBLIC_APP_URL을 넣을 수 있어요.</div>}
        <div className="lobby-action-row">
          <button type="button" className="lobby-soft-button" onClick={() => window.open(joinUrl, "_blank", "noopener,noreferrer")}>학생 화면 열기</button>
          <button type="button" className="lobby-soft-button" onClick={onToggleLock}>{isLocked ? "입장 다시 받기" : "입장 마감"}</button>
          <button type="button" className="lobby-start-button" disabled={!canStart} onClick={onStart}>{busy ? "경기 준비 중..." : "경기 시작"}</button>
          {!closing ? (
            <button type="button" className="lobby-danger-button" onClick={() => setClosing(true)}>방 닫기</button>
          ) : (
            <div className="close-room-confirm"><span>정말 닫을까요?</span><button type="button" onClick={() => setClosing(false)}>취소</button><button type="button" onClick={onClose}>방 닫기</button></div>
          )}
        </div>
        {message && <div className="lobby-toast">{message}</div>}
        <div className="join-url-hint" title={joinUrl}>{joinUrl}</div>
      </div>

      {qrLarge && (
        <div className="qr-fullscreen-backdrop" role="presentation" onClick={() => setQrLarge("")}>
          <div className="qr-fullscreen-card" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <span>수학 팀 배틀 입장</span>
            <img src={qrLarge} alt={`방 코드 ${roomCode} QR 코드 크게 보기`} />
            <strong>방 코드 {roomCode}</strong>
            <p>QR을 찍고 이름만 입력하세요.</p>
            <button type="button" onClick={() => setQrLarge("")}>닫기</button>
          </div>
        </div>
      )}
    </section>
  );
}
