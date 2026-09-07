v0.12.1 설치 오류 수정

원인: 배포되지 않은 eslint@^10.11.0 지정.
수정: 공식 배포된 eslint@10.10.0으로 정확히 고정했습니다.
https://eslint.org/blog/2026/09/eslint-v10.10.0-released/

1. 이 ZIP 안 파일을 기존 v0.12.0 프로젝트에 덮어쓰세요.
2. 프로젝트 폴더에서 npm install을 다시 실행하세요.
   npm이 변경된 package.json에 맞춰 기존 package-lock.json을 갱신합니다.
3. npm run build를 실행하세요.

동일한 버전 오류가 계속 나오면 기존 package-lock.json의 이름을
package-lock.before-fix.json으로 바꾸고 npm install을 다시 실행하세요.
오래된 lock 파일을 새로 덮어쓰지 마세요.

이 수정본에는 재생성하지 못한 package-lock.json을 넣지 않았습니다.
전체 프로젝트 ZIP에서도 잘못된 루트 lock 파일을 제거했습니다.
설치 성공 후 생기는 package-lock.json을 이후 버전 관리에 사용하세요.

OpenAI 최초 연결 과정 중이었다면 설치 성공 후 OPENAI_SETUP.md의
npm --prefix functions install 및 Secret/서버 배포 단계부터 이어가세요.
이미 서버 연결을 완료했다면 이번 수정으로 Functions 재배포는 필요 없습니다.

검증: ESLint 공식 배포 이력, package.json JSON/버전 확인.
현재 작업 환경에서 npm 저장소 접근이 403으로 차단되어 실제 재설치는 확인하지 못했습니다.
