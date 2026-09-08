> **v0.15.0 업그레이드:** 넌센스 검색·생성 경로가 확장됐습니다. 패치의 `functions` 폴더(특히 `question-quality.json` 포함)를 덮어쓴 후 `firebase deploy --only functions:generateAdvancedQuestions`를 실행하세요. 성공하면 `npm run build` 후 `firebase deploy --only hosting`을 실행합니다. 기존 비밀키와 환경변수는 유지합니다.

# v0.12.2 — OpenAI 고급 생성 연결

이 패치는 연결 기능을 제공합니다. 실제 계정 연결은 아래 초기 설정 후 완료됩니다.
ChatGPT Plus/Pro 구독료에는 OpenAI API 사용료가 포함되지 않습니다.
별도의 OpenAI API 결제 설정과 키가 필요합니다. 키를 채팅이나 소스 코드에 붙이지 마세요.

## 1. 준비

- 이 웹앱을 운영하는 Firebase 프로젝트: Functions 배포를 위해 Blaze 요금제가 필요합니다.
  앞서 Gemini 무료 전환을 위해 이 프로젝트의 결제 연결을 해제했다면, 고급 서버를 쓰려면 Blaze를 다시 연결해야 합니다.
  Gemini 전용 프로젝트의 무료/유료 설정은 별개입니다.
- OpenAI API 계정에서 API 결제를 설정하고 API 키를 만드세요: https://platform.openai.com/api-keys
- 명령어는 프로젝트 최상위 폴더에서 실행하세요. Node.js 22.12 이상을 권장합니다.
- `firebase use`로 현재 배포 프로젝트가 맞는지 먼저 확인하세요.

## 2. 패치 적용 및 패키지 설치

ZIP 안의 파일들을 기존 프로젝트 최상위에 덮어쓰세요. `functions` 폴더도 포함해야 합니다.
기존 `.env.local`과 학생/문제 데이터는 유지합니다.

```bash
npm install
npm --prefix functions install
```

Firebase CLI가 오래됐거나 설치되지 않았다면:

```bash
npm install -g firebase-tools
firebase login
```

`firebase init`은 실행하지 않아도 됩니다. 필요한 firebase.json 설정이 포함되어 있습니다.

## 3. 서버 설정 4개 입력

`functions/.env.example` 파일을 `functions/.env`로 복사한 뒤 값을 채우세요.
Windows에서는 메모장으로 저장할 때 `.env.txt`가 되지 않도록 주의하세요.

| 항목 | 어디서 가져오나요? |
| --- | --- |
| `AI_ADMIN_UIDS` | Firebase 콘솔 → Authentication → Users → 교사 로그인 계정의 UID. 여러 명이면 쉼표로 구분합니다. 학생 UID를 넣지 마세요. |
| `AUTH_WEB_API_KEY` | 기존 `src/firebase.js`의 firebaseConfig 안 `apiKey` 값. OpenAI 키가 아닙니다. |
| `OPENAI_MODEL` | 기본 `gpt-4.1`. 다른 모델로 바꾸려면 Responses API와 Structured Outputs를 지원하고 본인 API 프로젝트에서 사용 가능한 모델 ID를 입력합니다. 넌센스 검색에는 web_search 지원도 필요합니다. |

이 값들은 배포 때 Firebase CLI가 읽습니다. `.env` 파일은 버전 관리에서 제외됩니다.
`.env`를 만들지 않으면 처음 배포할 때 CLI에서 필요한 값을 질문합니다.

## 4. OpenAI 키를 Firebase Secret으로 등록

```bash
firebase functions:secrets:set OPENAI_API_KEY
```

위 명령 실행 후 나타나는 입력창에 OpenAI API 키를 붙여넣고 Enter를 누르세요.
키를 `VITE_OPENAI_API_KEY`로 만들거나, 브라우저 코드/DB에 저장하지 마세요.
이 앱의 OpenAI 키는 서버 함수에만 연결됩니다.

## 5. 배포

먼저 데이터베이스 규칙과 고급 AI 함수부터 배포하세요.

```bash
firebase deploy --only "database,functions:advanced-ai"
```

성공하면 화면을 빌드하고 배포하세요.

```bash
npm run build
firebase deploy --only hosting
```

화면에서 v0.12.2을 확인하세요. 이전 화면이 남으면 새로고침하세요.
다른 Functions가 있는 프로젝트에서 의도하지 않은 함수 삭제 확인이 나오면 진행하지 말고 codebase 설정을 확인하세요.

## 6. 사용

- AI 문제 만들기 / 유사문제: AI 엔진에서 **고급 OpenAI** 선택.
- 퀴즈 모드 → 커스텀 → AI로 만들기: **고급 OpenAI** 선택.
- 문제 생성, 유사문제, 보기/해설 수정, 유형 재구성, 혼합 세트 생성, AI 검수마다 비밀번호 입력창이 뜹니다.
- **현재 관리자 로그인에 쓴 비밀번호**를 입력해야 요청이 실행됩니다.
- 틀린 비밀번호, 미등록 UID, 익명 학생 계정은 OpenAI를 호출하지 않습니다.
- 취소하면 OpenAI를 호출하지 않습니다. 생성된 문제는 직접 검토하고 저장하세요.
- 퀴즈 플레이·채점·저장된 문제 재사용에는 OpenAI 호출이 없습니다.

## 비용과 비밀번호 처리

- 비밀번호는 HTTPS callable 요청으로 서버에 전달하고, 서버가 같은 프로젝트의 Firebase Authentication에서 매번 검증합니다.
- 비밀번호, 로그인 토큰, API 키를 DB나 앱 로그에 기록하지 않습니다.
- 서버에서 관리자당 분당 3회, UTC 날짜 기준 하루 60회로 제한합니다. 틀린 비밀번호 시도도 제한 횟수에 포함됩니다.
- 같은 요청 ID 재실행과 계정별 동시 생성을 막습니다. 실패 후 다시 시도할 때도 비밀번호를 새로 입력해야 합니다.
- OpenAI 자동 재시도는 하지 않습니다. 응답 토큰 상한은 일반 생성 16,000, 검색 후보 5,000입니다.
- 넌센스 고급 생성은 검색 1단계 + 문제 생성 1단계이므로 일반 생성보다 비용이 높을 수 있습니다.
- 이 횟수 제한은 원화/달러 지출의 정확한 상한이 아닙니다. Functions, Secret Manager, OpenAI API는 각각 요금이 적용될 수 있습니다.

## 문제 해결

- **허용 관리자 UID에 등록되지 않은 계정**: `.env`의 AI_ADMIN_UIDS가 로그인한 계정 UID인지 확인하고 Functions를 다시 배포하세요.
- **비밀번호 또는 인증 설정 오류**: 관리자 로그인 비밀번호와 AUTH_WEB_API_KEY의 프로젝트 일치를 확인하세요. 웹 키가 HTTP 리퍼러 제한으로 서버 요청을 막는 경우 같은 프로젝트에서 서버 인증용 Google API 키를 별도로 구성하고 Identity Toolkit API로 사용 API를 제한하세요. 기존 브라우저 키 제한을 무작정 해제하지 마세요.
- **OpenAI 잔액/한도**: ChatGPT 구독 상태가 아니라 OpenAI API 프로젝트의 잔액·결제·모델 한도를 확인하세요.
- **서버 연결 실패 / not-found**: Firebase Functions 배포 성공 여부와 `generateAdvancedQuestions` 함수 존재를 확인하세요. 리전은 `asia-northeast3`입니다.
- **키 변경**: `firebase functions:secrets:set OPENAI_API_KEY` 후 `firebase deploy --only "functions:advanced-ai"`를 다시 실행하세요.
- **AI 응답이 끝나지 않음**: 문제 수를 줄여 새 요청으로 다시 생성하세요. 재시도도 사용량에 포함될 수 있습니다.

## 확인 범위

서버 인증/요청 제한/응답 형식은 모의 서버 테스트, 화면 수식과 숫자 카드는 실제 React 컴포넌트의 정적 렌더링으로 확인했습니다.
실제 API 키·Firebase 관리자 권한이 제공되지 않아 실계정 생성과 배포는 확인하지 못했습니다.
이 작업 환경의 npm 접근 제한 및 Vite Linux 네이티브 모듈 부재로 전체 production build는 완료하지 못했습니다.
수식 표시기는 일반적인 분수·루트·지수·아래첨자·기본 기호를 지원합니다. 전체 LaTeX 문서/행렬/복잡한 매크로 렌더러는 아닙니다.

참고: [Firebase Secrets](https://firebase.google.com/docs/functions/config-env), [Functions 시작](https://firebase.google.com/docs/functions/get-started), [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
