v0.12.2 Firebase 환경 변수 오류 긴급 수정

원인
Firebase Functions는 FIREBASE_로 시작하는 사용자 환경 변수 이름을 허용하지 않습니다.
v0.12.0~v0.12.1의 FIREBASE_WEB_API_KEY 이름이 잘못되었습니다.

적용
1. 이 ZIP의 파일을 기존 프로젝트 최상위에 덮어씁니다.
2. 기존 functions/.env를 메모장으로 엽니다.
3. 다음 줄의 이름만 바꿉니다.

기존: FIREBASE_WEB_API_KEY=실제값
수정: AUTH_WEB_API_KEY=같은실제값

4. AI_DATABASE_URL 줄은 삭제해도 됩니다. 서버가 Firebase의 기본 DB 주소를 자동 사용합니다.
5. 최종 functions/.env는 아래 세 줄 형태입니다.

AI_ADMIN_UIDS=교사계정UID
AUTH_WEB_API_KEY=src/firebase.js의 apiKey 값
OPENAI_MODEL=gpt-4.1

따옴표, 표의 | 기호, 설명 문장, Markdown 코드 기호는 넣지 마세요.
OPENAI_API_KEY는 이 파일에 넣지 않습니다. 이미 Secret 등록을 마쳤다면 그대로 유지됩니다.

다시 실행
firebase deploy --only "database,functions:advanced-ai"

배포가 성공하면
npm run build
firebase deploy --only hosting

참고: breaking changes 문구는 경고입니다. 실제 중단 원인은 예약된 환경 변수 이름이었습니다.
