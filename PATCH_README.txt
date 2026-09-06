math-team-battle v0.8.0 · 배틀 애니메이션 리워크

적용 대상: v0.7.4

주요 변경
- 공격 6단계 흐름 재조정: 준비동작 → 발사 → 포물선 → 충돌 → 피격 → 줄 탄성
- 공격 학생 바로 위에 공격력/콤보 팝업 표시
- 포탄/로켓/연속포격/TEAM FEVER별 발사 타이밍 강화
- 명중 순간 충격파 + 8방향 스파크 추가
- 피격 학생이 날아갔다 바닥에 튕긴 뒤 복귀
- 줄/매듭/캐릭터 줄 전체가 명중 순간 탄성 반응
- 10콤보 TEAM FEVER 시 같은 팀 학생들도 함께 점프
- 점수판 공격팀 점수 펀치 애니메이션
- 경기 종료 시 FINISH → 승리 카드 → 색종이 → 승리팀 점프
- 3/4팀 토너먼트(C/D) 캐릭터 공격/피격 애니메이션 정상화
- 메인 버전 표시 v0.8.0

추가 npm 설치: 없음
Firebase Rules 변경: 없음
Blaze 필요: 없음

적용 후
1) npm run build
2) firebase deploy --only hosting

검수
- npm run lint 통과
- 이 작업 환경의 Vite build는 Rolldown 네이티브 바인딩(OS 의존 모듈) 문제로 실행 불가.
  사용자 Windows 프로젝트에서는 기존처럼 npm run build로 확인.
