v0.13.0 패치 — 학생 수식 표시 수정 + 퀴즈 모드 칠판 테마

기존 v0.12.2 프로젝트에 덮어쓰는 화면 패치입니다.

적용 방법
1. 실행 중인 개발 서버를 종료하고 기존 프로젝트 폴더를 백업합니다.
2. 이 ZIP 안의 src 폴더와 파일들을 math-team-battle 폴더에 덮어씁니다.
   package.json이 있는 위치에 덮어쓰면 됩니다.
3. 프로젝트 폴더의 터미널에서 실행합니다.

   npm run build
   firebase deploy --only hosting

이번 패치는 새 패키지를 추가하지 않습니다. 기존에 설치를 완료한 프로젝트라면
npm install을 다시 할 필요가 없습니다. 전체 프로젝트를 새로 설치할 때는 먼저
npm install을 실행하세요.
.env나 OpenAI Secret을 다시 설정할 필요가 없습니다.
Functions와 데이터베이스 규칙 배포도 이번 화면 패치에는 필요하지 않습니다.
배포한 뒤 교사·학생 브라우저를 새로고침하고 v0.13.0 표시를 확인하세요.
Windows에서 이전 화면이 보이면 Ctrl+F5로 다시 불러오세요.

무엇이 바뀌었나요?
- 학생 배틀 화면이 혼자 쓰던 구형 수식 표시기를 제거했습니다.
  문제와 보기 모두 교사·퀴즈 화면과 동일한 수식 표시기를 사용합니다.
- sqrt(2), sqrt{2}, \sqrt{2}, 공백이 있는 \sqrt (2), \sqrt[3]{8},
  루트 안의 루트·분수를 표시합니다. 미완성 수식은 원문을 보존합니다.
- 문제 제작, 교사 진행, 학생 입장·답변, 정답 공개·순위를 칠판 테마로 개선했습니다.
- 글씨 없는 칠판 배경을 제작해 문제, 입장 화면, 제작 미리보기에 적용했습니다.
- 객관식은 A/B/C/D 배지와 답 내용을 분리하고 선택 표시를 추가했습니다.
  OX, 직접 입력, 숫자 바, 순서 카드도 같은 테마로 다듬었습니다.
- 학생의 내 순위·점수, 남은 시간, 교사의 제출 현황을 분리해 표시합니다.
- 참가자 명단과 순위 목록은 정해진 높이 안에서 스크롤됩니다.
- 미리보기와 QR 확대 창은 키보드 포커스를 유지하며 Esc로 닫을 수 있습니다.
- 휴대폰·태블릿 화면 대응과 동작 줄이기 설정을 지원합니다.

미리보기
quiz-preview.html을 브라우저에서 열면 별도 설치 없이 새 디자인을 볼 수 있습니다.
학생 화면 / 교사 문제 화면 / 문제 제작 화면을 선택할 수 있습니다.
학생 화면에서 문제 유형을 고르고 ‘3초 뒤 답변 시작’을 누르면 직접 풀 수 있습니다.
‘휴대폰 폭 / 넓게’로 좁은 화면도 비교할 수 있습니다.
이 파일의 학생·점수는 예시이며 실제 수업 방이나 AI 호출에 연결되지 않습니다.
실제 서비스 화면은 npm run build로 다시 빌드해 배포해야 합니다.

확인한 항목
- 기존 채점·AI 권한·데이터 규칙·배틀·순위 테스트 37개 통과.
- 실제 React 컴포넌트로 수식, 학생 배틀 문제·보기, 교사·학생 진행 상태,
  문제 숨김 설정, 제출 완료, 5가지 답 입력 등 32개 검증 통과.
- 변경 소스 ESLint, JSX 변환, 로컬 import 연결과 CSS 구문 검사 통과.
- 미리보기 JavaScript 구문 검사 통과.
- 이 작업 환경은 업로드된 Windows 의존성을 사용하여 Linux용 Rolldown
  네이티브 모듈이 없습니다. 따라서 여기서 Vite 전체 빌드는 완료하지 못했습니다.
  실제 브라우저의 레이아웃·실시간 Firebase 수업 연결은 별도 확인이 필요합니다.

배경 파일
src/assets/game/quiz-chalkboard.png
1536 × 1024 PNG, 약 2.6 MiB. 앱에 포함된 정적 이미지입니다.
여러 문제에서 같은 파일을 재사용하며 실행 중 이미지 생성 요청을 보내지 않습니다.
색상·크기·문제 영역 스타일은 src/quiz/quiz.css에서 수정할 수 있습니다.

배경 제작 기록
제작: 내장 Imagegen 도구
사용한 최종 프롬프트:
Create a production background image asset for a Korean classroom math quiz web app.
This is only a background texture, NOT a screenshot, UI layout or mockup.
Landscape 1536x1024. A beautiful straight-on deep forest green school chalkboard,
matte slate surface, delicate natural chalk grain and faint softly erased chalk
clouds, calm premium classroom atmosphere. The center 85% must be blank dark
low-contrast green with ample empty space for white mathematical text overlaid
later in code. Extremely subtle chalk arcs, one tiny hand-drawn triangle and a few
scattered chalk dust specks only at the far outer corners. Soft diffuse light,
subtle vignette, tactile but quiet, cohesive muted emerald palette. Absolutely
NO text, NO letters, NO numbers, NO equations, NO logos, NO watermark, NO UI,
NO people, NO perspective, NO wooden frame, NO border. Fill the entire canvas with
the chalkboard texture. It should stay readable and attractive when used
responsively behind quiz questions.
