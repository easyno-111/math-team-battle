v0.11.0 데이터베이스 규칙 긴급 수정 (rules-hotfix-1)

원인: Realtime Database 보안 규칙에서 지원하지 않는 numChildren() 사용.
수정: 0번 문제 존재 여부와 허용 인덱스 0~39 검증으로 1~40개 제한 유지.

적용 방법
1. ZIP 안의 database.rules.json을 프로젝트 최상위의 같은 파일에 덮어쓰세요.
2. 프로젝트 폴더에서 실행하세요:
   firebase deploy --only database

Firebase 콘솔에서 직접 수정한다면 Realtime Database > 규칙 탭에
이 database.rules.json 전체 내용을 붙여넣고 게시하세요.
화면 코드는 변경하지 않아 npm install / npm run build는 필요 없습니다.
앱 표시 버전은 v0.11.0 그대로입니다.

검증: Node 테스트 24개 통과. 실제 Firebase 서버 배포 및 에뮬레이터 컴파일은 이 환경에서 확인하지 못했습니다.
