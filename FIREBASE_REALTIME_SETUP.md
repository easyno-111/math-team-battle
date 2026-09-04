# v0.4.0 Realtime Database 연결

## 1. Realtime Database URL 연결
Firebase Console의 **Realtime Database** 화면에 표시되는 URL을 복사합니다.
프로젝트 루트에 `.env.local` 파일을 만들고 다음처럼 저장합니다.

```env
VITE_FIREBASE_DATABASE_URL=https://실제-주소.firebasedatabase.app
```

저장 후 개발 서버를 완전히 종료했다가 `npm run dev`로 다시 시작해야 Vite가 새 환경 변수를 읽습니다.

## 2. 학생 익명 로그인 켜기
Firebase Console → Authentication → 로그인 방법 → **익명(Anonymous)** → 사용 설정.

학생은 이메일/비밀번호를 만들지 않습니다. 브라우저가 학생 전용 익명 계정을 만들고, 교사용 로그인과는 별도의 Firebase App 인스턴스를 사용합니다.

## 3. Realtime Database 규칙
프로젝트에 포함된 `database.rules.json`의 `rules` 내용을 Realtime Database → **규칙**에 붙여넣고 게시합니다.

이 규칙은 현재 v0.4.0 범위에서:
- 이메일/비밀번호 로그인 교사는 방 생성/관리 가능
- 익명 로그인 학생은 열린 방에 자기 참가 정보만 생성/수정 가능
- 방 코드가 있어도 로그인되지 않은 접속은 읽기/쓰기가 불가능
하도록 구성되어 있습니다.
