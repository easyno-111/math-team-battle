# v0.6.2 Realtime Database 규칙 적용

이번 버전은 3/4팀(C팀, D팀)과 교사의 수동 팀 이동을 지원하므로 Realtime Database 규칙 변경이 필요합니다.

1. Firebase Console → Realtime Database → 규칙
2. 패치 ZIP의 `database.rules.json` 내용을 전체 복사
3. 게시

또는 Firebase CLI를 사용한다면 프로젝트 루트에서:

```cmd
npm run build
firebase deploy --only hosting,database
```

기존 `.env.local`의 `VITE_FIREBASE_DATABASE_URL`과 `VITE_PUBLIC_APP_URL`은 그대로 사용하면 됩니다.
