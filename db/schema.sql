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
