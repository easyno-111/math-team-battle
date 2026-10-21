# 수학 팀 배틀 (math-team-battle)

교사 화면과 학생 휴대폰으로 진행하는 수업용 퀴즈 앱입니다. React + Vite, Firebase(Firestore·Realtime Database·Auth)로 동작합니다.

## 기능

- **문제은행**: 4지선다 문제를 직접 만들거나, 엑셀/구글 시트에서 범위를 복사해 붙여넣어 한 번에 등록합니다(.xlsx 업로드도 가능). 빈 보기·중복 보기·정답번호·중복 문항을 저장 전에 검사합니다.
- **게임방 · 박 터뜨리기**: 2~4팀이 동시에 경기합니다. 정답을 맞히면 본인 이름이 표시된 도트 용사(전사·궁수·마법사·힐러·팔라딘)가 소환되고, 그 학생이 소환한 살아 있는 용사만 행동합니다. 개인당 최대 3명이며 네 번째 소환 때는 본인의 가장 오래된 용사를 교체합니다. 각 용사는 소환 후 45초가 지나면 퇴장하고, 새 소환이나 재접속으로 기존 용사의 시간이 늘어나지 않습니다. 회복·수호도 정답을 맞힌 학생의 용사만 발동합니다. 교사 전장과 학생 화면에서 소환자 이름과 남은 시간을 확인할 수 있습니다. 5연속 정답은 강화 용사, 10연속은 정예 용사를 소환합니다. 힐러는 가장 앞서가는 상대 박을 회복시키고 팔라딘은 상대 박을 한 번 수호합니다. 먼저 박을 터뜨린 팀이 승리하며, 시간이 끝나면 박 체력 비율로 순위를 정합니다. 박 체력은 방을 만들 때 짧게·보통·길게 또는 숫자로 정합니다(학생 1명당 체력 × 팀 인원).
- **퀴즈 모드**: 객관식·OX·단답형·슬라이더·순서 문제를 세트로 묶어 모두 함께 푸는 모드입니다.

연출은 교사 화면에서만 캔버스로 그리고, 학생 화면은 가벼운 상태만 받습니다.

## 폴더 구조

| 경로 | 내용 |
| --- | --- |
| `src/game/` | 규칙(`rules.js`), 채점(`grading.js`), 문제 선택(`questions.js`), 팀 상수(`teams.js`). 순수 함수라 테스트로 검증합니다. |
| `src/battle/` | 캔버스 전투 연출. `arena.js`(장면), `sprites.js`(픽셀 그림), `particles.js`, `assets.js`(선택 에셋 로더), `BattleArena.jsx`, `ArenaPreview.jsx` |
| `src/room/` | 교사 게임방: 방 만들기, 대기실, 경기 화면, 채점 루프 |
| `src/questions/` | 문제은행 화면과 편집기 |
| `src/components/` | 학생 화면, 문제 가져오기, 수식 표시, QR |
| `src/quiz/` | 퀴즈 모드 |
| `src/styles/` | 공통 · 문제은행 · 게임방 · 학생 화면 스타일 |
| `src/assets/battle/` | 박·현수막 같은 그림 에셋을 넣는 곳. 없으면 코드가 그린 픽셀 박을 씁니다. 안내는 폴더의 README 참고 |
| `tests/` | `node --test` 테스트 |

## 개발

```bash
npm install
cp .env.example .env.local   # VITE_FIREBASE_DATABASE_URL 입력
npm run dev
```

- `npm run lint` · `npm test` · `npm run build`
- 화면 미리보기: `http://localhost:5173/?mode=preview` 에서 전투 연출(arena), 방 만들기, 대기실, 경기, 종료, 학생 화면을 가짜 데이터로 볼 수 있습니다. `- 전투 연출만 보려면 `http://localhost:5173/?mode=preview` 를 엽니다. Firebase 없이 규칙 모듈만으로 돌아갑니다.teams=4` 로 팀 수를 바꿉니다. Firebase 없이 돌아갑니다.

## 배포

```bash
npm run build
firebase deploy --only hosting,database
```

Realtime Database 규칙은 `database.rules.json`을 그대로 게시하면 됩니다.

### v0.17.0으로 올릴 때

이 버전에서 AI 문제 생성과 Cloud Functions를 제거했습니다. 이전에 함수를 배포했다면 한 번만 삭제해 주세요.

```bash
firebase functions:delete generateAdvancedQuestions --region asia-northeast3
```

이후 Blaze 요금제를 유지할 이유가 없습니다. 브라우저에 저장돼 있던 Gemini 키는 더 이상 읽지 않습니다.


## 개인 용사 규칙 확인

- 같은 팀 학생 두 명이 각각 정답을 맞혔을 때, 정답을 맞힌 학생의 용사만 공격·회복·수호하는지 확인합니다.
- 한 학생이 네 번 정답을 맞히면 본인 용사만 최대 3명으로 유지되고, 같은 팀 다른 학생 용사는 남아 있어야 합니다.
- 추가 정답 없이 45초를 기다리거나 새로고침하면 만료된 용사는 사라져야 합니다. 남은 시간은 Firebase 서버 시각 보정값을 사용합니다.
- 오답은 소환과 행동을 발생시키지 않습니다. 기존 용사는 남은 수명 동안 유지됩니다.
- 이전 버전의 소환자·만료 시각 없는 용사는 퇴장 처리합니다. 만료 데이터는 화면·채점에서 즉시 제외하고 해당 팀의 다음 정답 때 저장된 명단에서도 정리합니다.
