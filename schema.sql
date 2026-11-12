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
  id TEXT PRIMARY KEY,                      -- 'NUH-123456'
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
