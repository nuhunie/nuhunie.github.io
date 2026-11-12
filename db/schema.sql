-- Nuhunie 데이터베이스 구조 (Cloudflare D1 / SQLite)
-- js/data.js 맨 위의 데이터 모델과 같은 모양이다.

CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  name_id TEXT NOT NULL, name_ko TEXT NOT NULL,
  desc_id TEXT NOT NULL, desc_ko TEXT NOT NULL,
  cur TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS batches (
  id TEXT PRIMARY KEY,                      -- 'kr-4' = 서비스-번호
  svc TEXT NOT NULL REFERENCES services(id),
  no INTEGER NOT NULL,
  title TEXT NOT NULL,
  month TEXT NOT NULL,                      -- 'YYYY-MM'
  stage INTEGER NOT NULL DEFAULT 0,         -- 0~5, GO.STAGES의 순서
  close_date TEXT NOT NULL DEFAULT '',
  kurs REAL NOT NULL DEFAULT 1,
  note TEXT NOT NULL DEFAULT '',
  UNIQUE (svc, no)
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,                      -- 'NUH-7K3M9Q2X' (머리글자-8자리)
  batch_id TEXT NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  buyer TEXT NOT NULL,
  item TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  base INTEGER NOT NULL,                    -- 주문 금액 (쿠폰·고유 코드 적용 전)
  total INTEGER NOT NULL,                   -- 실제 결제할 금액 = base − 쿠폰 + 고유 코드
  pay TEXT NOT NULL DEFAULT 'unpaid',       -- unpaid | pending | paid | rejected
  method TEXT NOT NULL DEFAULT '',
  proof_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS orders_batch ON orders (batch_id);
CREATE INDEX IF NOT EXISTS orders_buyer ON orders (buyer);

CREATE TABLE IF NOT EXISTS vouchers (
  code TEXT PRIMARY KEY,
  off INTEGER NOT NULL
);

-- 쿠폰 사용 한도. 없거나 0이면 한도 없음. (vouchers 표는 바꿀 수 없어 곁표로 둔다)
CREATE TABLE IF NOT EXISTS voucher_limits (
  code TEXT PRIMARY KEY,
  max_uses INTEGER NOT NULL DEFAULT 0
);
-- 어떤 주문이 어떤 쿠폰을 썼는지. 셀 때는 지워진 주문과 반려된 주문은 세지 않는다.
CREATE TABLE IF NOT EXISTS voucher_uses (
  order_id TEXT PRIMARY KEY,
  code TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS voucher_uses_code ON voucher_uses (code);
-- 쿠폰 메모: 한 장짜리 코드를 누구에게 줬는지 등 (운영자만 본다)
CREATE TABLE IF NOT EXISTS voucher_notes (
  code TEXT PRIMARY KEY,
  note TEXT NOT NULL DEFAULT ''
);
-- 입금자 이름: 운영자가 결제를 승인할 때 은행 기록을 보고 적는다. 같은 입금자가 같은 쿠폰을 또 쓰면 승인 화면이 알린다.
-- 개인정보이므로 고객 화면과 공개 API에는 내보내지 않는다.
CREATE TABLE IF NOT EXISTS order_payer (
  order_id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL                       -- JSON
);

-- 횟수 제한용 기록: 누가(ip) 무엇을(kind) 언제(at, ms) 했는지. 하루 지난 기록은 지운다.
--   login 틀린 비밀번호 · pay 새 주문 제출 · look 주문 조회
CREATE TABLE IF NOT EXISTS hits (
  kind TEXT NOT NULL,
  ip TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS hits_lookup ON hits (kind, ip, at);

-- 관리자 활동 기록: 언제(at) 어디서(ip) 무엇을(action) 했는지
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  ip TEXT NOT NULL,
  action TEXT NOT NULL,                     -- login, reset, batch.add, batch.update, batch.delete, order.add, order.pay, order.delete, calc
  detail TEXT NOT NULL DEFAULT ''
);

-- 관리자 로그인: 로그인할 때 넣고 로그아웃할 때 지운다. 쿠키의 번호가 여기 없으면 로그인으로 치지 않는다.
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  exp INTEGER NOT NULL                      -- 만료 시각 (ms)
);

-- 확인 대기 중인 주문을 결제 금액으로 빨리 찾기 위한 색인 (금액 겹침 확인용)
CREATE INDEX IF NOT EXISTS orders_pending_total ON orders (total) WHERE pay = 'pending';

-- 주문에 붙는 표시 (없으면 둘 다 0)
--   self  고객이 결제 화면에서 직접 만든 주문. 운영자가 승인하기 전에는 공개 리캡에 넣지 않는다
--   late  주문 마감 뒤에 들어온 주문이면 그때의 배치 단계(1~4). 배치와 같은 일정으로 처리할 수 없어 따로 표시한다
CREATE TABLE IF NOT EXISTS order_flags (
  order_id TEXT PRIMARY KEY,
  self INTEGER NOT NULL DEFAULT 0,
  late INTEGER NOT NULL DEFAULT 0
);

-- 결제 전 주문을 접수 시각으로 빨리 찾기 위한 색인 (기한이 지난 접수를 지울 때 쓴다)
CREATE INDEX IF NOT EXISTS orders_unpaid_created ON orders (created_at) WHERE pay = 'unpaid';
