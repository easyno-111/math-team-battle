export default function RealtimeSetupNotice() {
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
          <span>3. database.rules.json 내용을 Realtime Database 규칙에 게시</span>
          <span>4. .env.local 저장 후 npm run dev를 다시 시작</span>
        </div>
      </div>
    </section>
  );
}
