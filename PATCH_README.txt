수학 팀 배틀 v0.4.0 - 게임방/학생 대기실 패치

[덮어쓰기]
이 ZIP의 파일을 기존 math-team-battle 프로젝트 루트에 그대로 덮어쓰세요.
node_modules는 포함되어 있지 않습니다.

[이번 버전]
- 관리자 상단 메뉴: 문제은행 / 게임방
- 저장된 문제의 단원/난이도 기반 게임방 설정
- 4자리 게임방 코드 자동 생성
- 학생 공개 입장 화면 (?mode=student / ?join=1234)
- 학생 익명 Firebase Auth 사용 (교사 로그인과 분리된 Firebase App)
- 학생 A/B팀 번갈아 자동 배정
- 교사 대기실에서 실시간 학생 목록/접속 상태 확인
- 학생 대기실에서 본인 팀과 양 팀 인원 확인
- 입장 마감 / 다시 받기
- 방 닫기 2단계 확인
- 학생 화면 새 탭 열기 / 입장 주소 복사
- 교사/학생 대기실용 파스텔 도트 체육관 이미지 포함
- 웹 화면 버전 v0.4.0 표시

[중요: 최초 1회 Firebase 설정]
1) Firebase Console > Realtime Database에서 데이터베이스를 생성합니다.
2) Realtime Database 화면에 표시되는 데이터베이스 URL을 복사합니다.
3) 프로젝트 루트에 .env.local 파일을 만들고 아래 한 줄을 넣습니다.
   VITE_FIREBASE_DATABASE_URL=https://실제-데이터베이스-주소
4) Firebase Console > Authentication > 로그인 방법에서 '익명(Anonymous)'을 활성화합니다.
5) Firebase Console > Realtime Database > 규칙에서 database.rules.json 내용을 붙여넣고 게시합니다.
6) 개발 서버가 켜져 있었다면 Ctrl+C 후 npm run dev로 다시 시작합니다.

[주의]
- src/firebase.js는 이 패치에서 수정하지 않습니다. 기존 Firebase 설정이 유지됩니다.
- v0.4.0은 '방 구성/대기실' 단계입니다. 경기 시작 버튼은 화면 구성 확인용으로 비활성 상태입니다.
- 실제 문제 출제/정답 판정/줄 이동은 다음 v0.5.0부터 연결할 예정입니다.
