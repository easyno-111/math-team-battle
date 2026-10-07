import { useMemo, useState } from "react";
import { teamLabel } from "../game/teams";
import { clampHpPerMember, DEFAULT_HP_PER_MEMBER, gourdMaxHp, HP_PER_MEMBER_RANGE, HP_PRESETS } from "../game/rules";
import { DURATION_OPTIONS } from "./roomUtils";
import teacherLobbyBg from "../assets/game/teacher-lobby.webp";

function sortedUnique(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));
}

function Chip({ selected, onClick, children }) {
  return (
    <button type="button" className={`choice-chip ${selected ? "selected" : ""}`} onClick={onClick}>
      <span className="choice-check">{selected ? "✓" : ""}</span>{children}
    </button>
  );
}

export default function RoomSetup({ questions, difficulties, categoryOf, unitOf, busy, message, onCreate, onGoQuestionBank }) {
  const categories = useMemo(() => sortedUnique(questions.map(categoryOf)), [questions, categoryOf]);
  const [title, setTitle] = useState("오늘의 팀 퀴즈");
  const [pickedCategories, setPickedCategories] = useState(null);
  const [pickedUnits, setPickedUnits] = useState(null);
  const [pickedDifficulties, setPickedDifficulties] = useState(difficulties);
  const [durationMinutes, setDurationMinutes] = useState(10);
  const [teamCount, setTeamCount] = useState(2);
  const [hpPerMember, setHpPerMember] = useState(DEFAULT_HP_PER_MEMBER);
  const [localMessage, setLocalMessage] = useState("");

  const selectedCategories = (pickedCategories ?? categories).filter((item) => categories.includes(item));
  const units = useMemo(() => sortedUnique(questions.filter((q) => selectedCategories.includes(categoryOf(q))).map(unitOf)), [questions, selectedCategories, categoryOf, unitOf]);
  const selectedUnits = (pickedUnits ?? units).filter((item) => units.includes(item));
  const eligible = useMemo(() => questions.filter((q) => selectedCategories.includes(categoryOf(q)) && selectedUnits.includes(unitOf(q)) && pickedDifficulties.includes(q.difficulty)).length, [questions, selectedCategories, selectedUnits, pickedDifficulties, categoryOf, unitOf]);

  const toggle = (list, setList, value) => setList(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);

  const create = () => {
    if (!selectedCategories.length) return setLocalMessage("사용할 분야/과목을 하나 이상 선택해주세요.");
    if (!selectedUnits.length) return setLocalMessage("사용할 주제/단원을 하나 이상 선택해주세요.");
    if (!pickedDifficulties.length) return setLocalMessage("사용할 난이도를 하나 이상 선택해주세요.");
    if (!eligible) return setLocalMessage("현재 선택으로 출제할 수 있는 문제가 없습니다.");
    setLocalMessage("");
    return onCreate({ title: title.trim() || "오늘의 팀 퀴즈", categories: selectedCategories, units: selectedUnits, difficulties: pickedDifficulties, durationMinutes, teamCount, gourdHpPerMember: clampHpPerMember(hpPerMember), questionCount: eligible });
  };

  return (
    <section className="room-setup-shell">
      <div className="room-setup-card">
        <div className="room-setup-heading">
          <div>
            <span className="section-pill mint">새 게임방</span>
            <h2>오늘 사용할 문제를 고르세요</h2>
            <p>방을 만든 뒤 QR을 띄우면 학생들이 바로 들어올 수 있어요.</p>
          </div>
          <div className="eligible-count-bubble"><strong>{eligible}</strong><span>사용 가능</span></div>
        </div>

        {!categories.length ? (
          <div className="room-empty-questions">
            <strong>게임에 사용할 객관식 문제가 아직 없어요.</strong>
            <p>문제은행에서 문제를 먼저 등록해주세요.</p>
            <button type="button" className="secondary-button" onClick={onGoQuestionBank}>문제은행으로 가기</button>
          </div>
        ) : (
          <>
            <label className="room-title-input">방 이름<input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={32} /></label>

            <div className="room-option-block">
              <div className="room-option-title"><strong>분야 / 과목</strong><button type="button" onClick={() => { setPickedCategories(categories); setPickedUnits(null); }}>전체 선택</button></div>
              <div className="option-chip-grid">{categories.map((item) => <Chip key={item} selected={selectedCategories.includes(item)} onClick={() => { toggle(selectedCategories, setPickedCategories, item); setPickedUnits(null); }}>{item}</Chip>)}</div>
            </div>

            <div className="room-option-block">
              <div className="room-option-title"><strong>주제 / 단원</strong><button type="button" onClick={() => setPickedUnits(units)}>전체 선택</button></div>
              <div className="option-chip-grid">{units.map((item) => <Chip key={item} selected={selectedUnits.includes(item)} onClick={() => toggle(selectedUnits, setPickedUnits, item)}>{item}</Chip>)}</div>
            </div>

            <div className="room-option-block">
              <div className="room-option-title"><strong>난이도</strong><span>여러 개 선택 가능</span></div>
              <div className="difficulty-choice-row">{difficulties.map((item) => (
                <button type="button" key={item} className={`difficulty-choice difficulty-choice-${item} ${pickedDifficulties.includes(item) ? "selected" : ""}`} onClick={() => toggle(pickedDifficulties, setPickedDifficulties, item)}>{item}</button>
              ))}</div>
            </div>

            <div className="room-option-block">
              <div className="room-option-title"><strong>팀 수</strong><span>모든 팀이 동시에 자기 박을 터뜨려요</span></div>
              <div className="team-count-row">{[2, 3, 4].map((count) => (
                <button type="button" key={count} className={teamCount === count ? "selected" : ""} onClick={() => setTeamCount(count)}>
                  <strong>{count}팀</strong><small>{["A", "B", "C", "D"].slice(0, count).map(teamLabel).map((label) => label.replace(" 팀", "")).join(" · ")}</small>
                </button>
              ))}</div>
            </div>

            <div className="room-option-block">
              <div className="room-option-title"><strong>박 체력</strong><span>학생 1명당 체력 · 팀 인원만큼 곱해져요 (5명 팀이면 {gourdMaxHp(5, hpPerMember)})</span></div>
              <div className="duration-row hp-preset-row">
                {HP_PRESETS.map((preset) => (
                  <button type="button" key={preset.value} className={Number(hpPerMember) === preset.value ? "selected" : ""} onClick={() => setHpPerMember(preset.value)}>{preset.label}<small>{preset.hint} · {preset.value}</small></button>
                ))}
                <label className="hp-custom-input">직접 입력
                  <input type="number" min={HP_PER_MEMBER_RANGE.min} max={HP_PER_MEMBER_RANGE.max} step={10} value={hpPerMember} onChange={(e) => setHpPerMember(e.target.value)} onBlur={() => setHpPerMember(clampHpPerMember(hpPerMember))} />
                </label>
              </div>
            </div>

            <div className="room-option-block">
              <div className="room-option-title"><strong>제한 시간</strong><span>박이 안 터지면 이 시간에 체력 비율로 순위를 정해요</span></div>
              <div className="duration-row">{DURATION_OPTIONS.map((minutes) => (
                <button type="button" key={minutes} className={durationMinutes === minutes ? "selected" : ""} onClick={() => setDurationMinutes(minutes)}>{minutes}분</button>
              ))}</div>
            </div>

            {(localMessage || message) && <div className="room-message">{localMessage || message}</div>}
            <button type="button" className="create-room-button" disabled={busy || !eligible} onClick={create}>{busy ? "게임방 만드는 중..." : "게임방 만들기"}</button>
          </>
        )}
      </div>

      <div className="room-preview-card" style={{ backgroundImage: `url(${teacherLobbyBg})` }}>
        <div className="preview-room-code">QR + 4자리 방 코드</div>
        {["A", "B", "C", "D"].slice(0, teamCount).map((team) => <div key={team} className={`preview-team preview-team-${team.toLowerCase()}`}>{team}팀</div>)}
        <div className="room-preview-bottom">
          <strong>{teamCount}팀 박 터뜨리기</strong>
          <span>정답을 맞히면 도트 용사가 소환되어 우리 팀 박을 공격해요. 먼저 터뜨리는 팀이 승리!</span>
        </div>
      </div>
    </section>
  );
}
