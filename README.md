# Nuhunie (mockup)

구매대행(jastip) 주문·결제 확인 사이트.

- 서버판: https://nuhunie.pages.dev (Cloudflare Pages + Functions + D1). 모든 기기가 같은 데이터를 보고, 관리자 화면은 로그인해야 열린다.
- 목업판: https://nuhunie.github.io (파일만 올린 것). `/api`가 없으면 자동으로 그 브라우저의 localStorage를 쓴다.

## 화면

- 서비스 → 월별 배치 → 배치 리캡
- 주문 조회 (주문번호·아이디)
- 결제 확인 → 영수증
- 관리자: 사용 안내, 배치, 주문 입력(자동 분류), 결제 확인, 가격 계산기, 주문 CSV 내려받기

언어: 인도네시아어 · 영어 · 한국어

## 구조

| 층 | 파일 | 역할 |
|---|---|---|
| 1 | `js/data.js` | 데이터 모델, 상호(`GO.BRAND`), 예시 데이터 |
| 2 | `js/logic.js` | 가격 계산, 집계, 조회, 자동 분류, CSV |
| 3 | `js/store.js` | 읽고 쓰는 통로. `/api`가 있으면 서버, 없으면 localStorage |
| 4 | `js/ui.js` | 화면과 이벤트 |
| – | `js/i18n-en.js` | 영어 문구 |
| – | `css/app.css` | 스타일과 배색 테마 |
| 서버 | `functions/api/[[path]].js` | API 라우터 (공개 조회, 결제 제출, 관리자) |
| 서버 | `server/lib.js` | 입력 검사, 관리자 세션, DB 변환. 계산은 `js/logic.js`를 그대로 쓴다 |
| 서버 | `schema.sql` | D1 테이블 구조 |

## 서버 실행과 배포

```
node build.js                                   # 화면 파일을 dist/에 모은다
npx wrangler pages dev dist --port 8788          # 내 컴퓨터에서 실행 (.dev.vars의 시험용 비밀값 사용)
npx wrangler pages deploy dist --project-name nuhunie --branch main   # 배포
```

비밀값은 저장소에 두지 않는다. 배포용은 `npx wrangler pages secret put ADMIN_PASSWORD --project-name nuhunie` 로 넣고(`SESSION_SECRET`도 같은 방법), 넣은 뒤 다시 배포해야 적용된다.

## 검사

- 계산 로직 단위 테스트: `node --test tests/logic.test.js`
- 서버 API 검사: 내 컴퓨터에서 서버를 띄운 뒤 `node --test tests/api.test.js` (데이터를 초기화하므로 배포된 사이트에는 돌리지 않는다)
- 공격 검사: 같은 방법으로 `node --test tests/abuse.test.js` (무차별 대입, 가짜 주문 도배, 주문번호 훑기, 동시 결제, 과대 입력, 보안 헤더). `.dev.vars`에 `RATE_WINDOW_SEC=6`이 있어야 한다
- 위 세 가지는 코드를 올릴 때마다 GitHub Actions(`.github/workflows/test.yml`)에서도 돈다
- 고객·운영자 여정 자동 실행(목업판): 사이트를 연 브라우저 콘솔에서 `await import('./tests/e2e.js'); await runE2E()` (저장된 데이터가 예시로 초기화된다)

## 아직 없는 것

결제사 연결(QR·계좌는 예시), 증빙 이미지 저장(파일 이름만 저장), AI 자동 분류(규칙 기반). 주문번호를 아는 사람은 그 주문을 조회·결제 제출할 수 있다(본인 확인 없음).
