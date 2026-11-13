# Nuhunie

구매대행(jastip) 주문·결제 확인 사이트.

| | 주소 | 설명 |
|---|---|---|
| 고객 사이트 | https://nuhunie.pages.dev | 서비스 → 월별 배치 → 리캡, 주문 조회, 결제 확인 |
| 관리자 사이트 | https://nuhunie.pages.dev/admin/ | 비밀번호로 로그인. 배치, 주문 입력, 결제 확인, 계산기, 활동 기록 가게 설정 탭에서 서비스·쿠폰을 관리하고 자료를 내려받는다. |
| 목업판 | https://nuhunie.github.io | 서버 없이 그 브라우저에만 저장되는 시연용 |

언어: 인도네시아어 · 영어 · 한국어

## 폴더

```
site/        화면. 이 폴더만 사이트로 올라간다
  index.html       고객 사이트
  admin/           관리자 사이트
  js/data.js       1층  데이터 모델, 상호(GO.BRAND), 예시 데이터
  js/logic.js      2층  가격 계산, 집계, 조회, 자동 분류, 주문번호 (서버도 이 파일을 쓴다)
  js/store.js      3층  읽고 쓰는 통로. /api 가 있으면 서버, 없으면 브라우저 저장소
  js/ui.js         4층  화면과 이벤트
  js/i18n-en.js    영어 문구
  js/vendor/       남이 만든 코드 (qrcode.js: QR 그리기, MIT 라이선스)
  css/app.css      스타일 (색과 글씨체는 맨 위 :root 에서 정한다)
  _headers         보안 헤더
functions/   API (Cloudflare Pages Functions).  /api/... 요청이 여기로 온다
server/      서버 공통 코드: 입력 검사, 로그인, 횟수 제한, DB 변환
db/          schema.sql  데이터베이스 표 구조 (Cloudflare D1)
tests/       검사: 로직, 서버 API, 공격, 여정
scripts/     setup.js  내 컴퓨터 준비
.github/     코드를 올리면 검사 → 통과하면 자동 배포
```

맨 위의 `index.html` 은 목업판 주소(nuhunie.github.io)에서 `site/` 로 넘겨 주는 안내판이다.

## 내 컴퓨터에서 돌리기

Node 22 이상이 필요하다. Windows PowerShell에서는 `npm` 대신 `npm.cmd` 를 쓴다.

```
npm run setup         처음 한 번: 시험용 비밀값(.dev.vars)과 내 컴퓨터용 DB 준비
npm run dev           서버판 실행  → http://localhost:8788  (관리자: /admin/)
npm run mock          목업판 실행  → http://localhost:4173/site/
```

## 검사

```
npm test              계산 로직
npm run test:server   서버 API + 공격 검사 (npm run dev 가 떠 있어야 한다. 데이터를 초기화한다)
npm run test:screen   화면 여정(컴퓨터 너비) + 휴대폰 모양(360·375·412px). 목업판을 직접 띄워 브라우저로 돈다
npm run check-live    올린 뒤: 실제 사이트가 이 커밋으로 바뀌었는지 기다렸다가 읽기만 하는 확인
```

`test:screen` 은 처음 한 번 `npm i --no-save playwright@1.49.1` 과 `npx playwright install chromium` 이 필요하다.

여정 검사(목업판): `npm run mock` 으로 띄운 `http://localhost:4173/site/` 의 브라우저 콘솔에서
`await import('../tests/e2e.js'); await runE2E()`

휴대폰 모양 검사(목업판): 브라우저 창을 360·375·412px 너비로 맞춘 뒤 같은 콘솔에서 `await runLayout()`.
손님 화면 7곳을 세 언어로 열어 가로 넘침, 숫자 가운데, 겹침, 단추 높이(40px), 잘린 글자를 본다.
알림 켜기 칸은 서버판에서만 나오므로 이 검사에 들어가지 않는다.

## 배포

`main` 에 올리면 GitHub Actions가 검사를 돌리고, 통과하면 Cloudflare에 자동으로 배포한다.
지금 올라가 있는 버전은 https://nuhunie.pages.dev/version.txt 에서 볼 수 있다.

비밀값은 저장소에 없다.

| 값 | 어디에 | 넣는 방법 |
|---|---|---|
| `ADMIN_PASSWORD`, `SESSION_SECRET` | Cloudflare | `npx wrangler pages secret put <이름> --project-name nuhunie` 후 다시 배포 |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | GitHub 저장소 Secrets | 저장소 Settings → Secrets and variables → Actions |

## 아직 없는 것

결제사 연결(QR·계좌는 예시), 증빙 이미지 저장(파일 이름만 저장), AI 자동 분류(규칙 기반),
주문번호 외의 본인 확인, 관리자 화면의 주문 나눠 불러오기.
