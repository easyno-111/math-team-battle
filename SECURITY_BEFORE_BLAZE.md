# math-team-battle · Blaze 전 보안 점검 메모 (v0.7.3)

이 문서는 **지금 당장 Blaze로 올리라는 안내가 아닙니다.**
현재 단계에서는 Spark를 유지하고, OpenAI 고급 연결은 잠가 둡니다.

## 이번 점검에서 확인한 핵심

### 1) Gemini 무료 연결
- 현재 Gemini 키는 관리자 브라우저 localStorage에만 저장됩니다.
- 이것은 **테스트/교사용 편의 방식**이며 완전한 서버 보안 방식은 아닙니다.
- v0.7.3에서는 실수로 생성 버튼을 반복 누르는 상황을 줄이기 위해 브라우저 단위로 `분당 5회 / 하루 60회` AI 요청 보호를 추가했습니다.
- 이 제한은 localStorage 기반이라 사용자가 개발자 도구를 쓰면 우회할 수 있습니다. **비용 보안용 하드캡이 아닙니다.**

### 2) OpenAI 고급 연결
- 화면에는 고급 엔진 자리를 미리 만들었지만 **비활성화 상태**입니다.
- OpenAI 유료 API 키를 React, Vite 환경변수, localStorage에 넣지 않습니다.
- 다음 단계에서 Firebase Cloud Functions 같은 서버를 준비한 뒤 Secret으로만 보관합니다.

### 3) 현재 Realtime Database 규칙에서 Blaze 전에 다시 손봐야 할 부분
최근 게임 패치(v0.6.2)에서 사용하던 규칙은 `rooms/$roomCode` 읽기에 대해 `auth != null`이면 허용하는 구조입니다.
학생이 Anonymous Auth로 로그인하는 현재 구조에서는, 인증된 사용자가 방 코드를 알면 방 전체를 읽을 수 있는 범위가 넓습니다.
4자리 방 코드는 경우의 수가 작기 때문에 Blaze 전에는 이 읽기 구조를 더 좁히는 편이 안전합니다.

현재 쓰기 쪽은 비교적 더 제한적입니다.
- 방 전체 쓰기: 비밀번호 로그인한 방장 UID 중심
- 참가자 쓰기: 자기 참가자 레코드 중심
- 제출 쓰기: 자기 UID + 현재 문제 ID 검사

하지만 **읽기 비용과 데이터 노출 범위까지 생각하면 현재 상태를 그대로 Blaze용 최종 규칙으로 보기는 어렵습니다.**

## Blaze 전 권장 순서

1. **Spark 유지**
2. 게임방 데이터 구조를 `입장 전 공개 정보`와 `입장 후 게임 정보`로 나누기
3. 학생 읽기를 `해당 방 참가자 또는 방장` 위주로 좁히기
4. Firebase App Check 적용
5. Firestore 배포 규칙을 Firebase Console에서 다시 확인
   - `questions`는 관리자만 쓰기/읽기하는 현재 정책 유지
   - `admins` 문서는 일반 사용자가 수정할 수 없게 유지
6. OpenAI용 Cloud Function 생성
   - Firebase Auth 확인
   - `admins/{uid}` 관리자 확인
   - App Check 확인
   - 요청당 최대 문제 수 제한
   - 사용자/관리자별 요청 횟수 제한
   - `maxInstances` 제한
7. OpenAI 프로젝트 자체 사용 한도도 낮게 설정
8. Firebase/Google Cloud 예산 알림과 Functions 지출 보호 설정
9. 위 테스트가 끝난 뒤 Blaze 전환

## 다음 보안 패치에서 권장하는 데이터 구조 예시

```text
roomPublic/{roomCode}
  status
  admissionOpen
  teamCount
  participantCount

rooms/{roomCode}
  hostUid
  participants
  playerStates
  scores
  battleEvents
  ...
```

입장 전에는 `roomPublic`의 최소 정보만 읽고,
입장 완료 뒤에는 본인이 참가자로 등록된 방의 `rooms/{roomCode}`를 읽는 구조로 바꾸면 현재보다 훨씬 안전하게 제한할 수 있습니다.

## v0.7.3에서 일부러 하지 않은 것

- Blaze 업그레이드
- Cloud Functions 생성
- OpenAI API 키 저장
- Realtime Database 규칙 강제 변경

게임이 실제 수업에서 이미 동작하는 상태이므로, 보안 규칙은 기능 패치와 섞어서 성급하게 바꾸지 않고 별도 안정화 버전에서 수정하는 것이 안전합니다.
