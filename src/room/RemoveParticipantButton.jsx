import { useState } from "react";

export default function RemoveParticipantButton({ participant, busy, onRemove }) {
  const [confirming, setConfirming] = useState(false);
  if (!onRemove) return null;
  return (
    <div className="participant-remove-controls">
      {!confirming ? (
        <button type="button" className="participant-remove-button" disabled={busy} aria-label={`${participant.name} 강퇴`} onClick={() => setConfirming(true)}>강퇴</button>
      ) : (
        <div className="participant-remove-confirm" role="group" aria-label={`${participant.name} 강퇴 확인`}>
          <span>{participant.name} 학생의 참가 기록과 용사를 삭제할까요?</span>
          <button type="button" disabled={busy} onClick={() => setConfirming(false)}>취소</button>
          <button type="button" className="participant-remove-button" disabled={busy} onClick={() => onRemove(participant.id)}>{busy ? "처리 중…" : "강퇴 확인"}</button>
        </div>
      )}
    </div>
  );
}
