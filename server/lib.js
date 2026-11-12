/* 서버 공통 도구: 응답, 입력 검사, 관리자 세션, DB ↔ 화면 데이터 변환.
 * 계산 규칙은 새로 쓰지 않고 브라우저와 같은 site/js/data.js, site/js/logic.js를 그대로 불러 쓴다. */
import '../site/js/data.js';
import '../site/js/logic.js';

export const GO = globalThis.GO;
export const X = GO.logic;

/* ── 응답 ── */
export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers }
  });
}
export const fail = (message, status = 400) => json({ error: message }, status);
const MAX_BODY = 20000;
export async function readJson(request) {
  // 본문이 없는 요청(초기화, 로그아웃)은 빈 객체로 본다. 형식이 깨진 본문만 null.
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) return null;            // 지나치게 큰 본문은 받지 않는다
    if (!text.trim()) return {};
    const b = JSON.parse(text);
    return b && typeof b === 'object' && !Array.isArray(b) ? b : null;
  } catch (e) { return null; }
}

/* ── 입력 검사: 값이 맞으면 정리된 값을, 아니면 null을 돌려준다 ── */
// 숫자로 받는 값: 진짜 숫자이거나 숫자만 적힌 글자여야 한다. true, null, "1e3", [1000] 은 숫자로 바꾸지 않는다.
const toNum = v => typeof v === 'number' ? v : (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : NaN);
export const V = {
  text(v, max) { v = typeof v === 'string' ? v.trim() : ''; return v && v.length <= max ? v : null; },
  optText(v, max) { v = typeof v === 'string' ? v.trim() : ''; return v.length <= max ? v : null; },
  int(v, min, max) { v = toNum(v); return Number.isInteger(v) && v >= min && v <= max ? v : null; },
  num(v, min, max) { v = toNum(v); return Number.isFinite(v) && v >= min && v <= max ? v : null; },
  oneOf(v, list) { return list.indexOf(v) >= 0 ? v : null; },
  month(v) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : null; },
  date(v) {                                     // 모양뿐 아니라 달력에 있는 날짜인지도 본다 (2026-02-30 은 거절)
    if (v === '' || v == null) return '';
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
    const d = new Date(v + 'T00:00:00Z');
    return !isNaN(d) && d.toISOString().slice(0, 10) === v ? v : null;
  },
  orderId(v) { v = typeof v === 'string' ? v.trim().toUpperCase() : ''; return X.isOrderId(v) ? v : null; }
};
export const PAY = Object.keys(GO.PAY);

/* ── 관리자 로그인 ──
 * 로그인하면 무작위 번호를 sessions 표에 넣고, 쿠키에는 "번호.만료시각.서명"을 담는다.
 *   서명 = HMAC-SHA256(SESSION_SECRET, "admin." + 번호 + "." + 만료시각)
 * 요청마다 ① 서명이 맞는지 ② 만료 시각이 지나지 않았는지 ③ 그 번호가 표에 남아 있는지를 본다.
 * 로그아웃하면 표에서 지우므로, 같은 쿠키를 다시 보내도 통하지 않는다. */
const SESSION_HOURS = 12;
async function sign(secret, message) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function sameText(a, b) {            // 길이와 내용을 끝까지 비교해 걸린 시간으로 값을 추측하지 못하게 한다
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
// 비밀번호가 너무 짧으면 로그인 자체를 열지 않는다: 횟수 제한으로는 짧은 비밀번호를 지킬 수 없다.
export const MIN_PASSWORD = 8;
export function weakPassword(env) { return !!env.ADMIN_PASSWORD && String(env.ADMIN_PASSWORD).length < MIN_PASSWORD; }
export function configured(env) { return !!(env.ADMIN_PASSWORD && env.SESSION_SECRET) && !weakPassword(env); }
// 예시 데이터 초기화는 켜 둔 곳(내 컴퓨터, 검사 환경)에서만 된다
export function canReset(env) { return !!env && env.ALLOW_RESET === '1'; }   // env를 빠뜨리고 부르면 허용하지 않는다
export async function passwordOk(env, given) {
  if (!configured(env) || typeof given !== 'string') return false;
  // 두 값을 같은 열쇠로 서명한 뒤 비교한다 (길이가 달라도 비교 시간이 같다)
  return sameText(await sign(env.SESSION_SECRET, 'pw.' + given), await sign(env.SESSION_SECRET, 'pw.' + env.ADMIN_PASSWORD));
}
function readSession(request) {
  const m = (request.headers.get('cookie') || '').match(/(?:^|;\s*)sid=([0-9a-f]{32})\.(\d+)\.([0-9a-f]{64})/);
  return m ? { id: m[1], exp: Number(m[2]), sig: m[3] } : null;
}
export async function startSession(db, env, request) {
  const now = Date.now(), exp = now + SESSION_HOURS * 3600 * 1000;
  const id = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE exp < ?').bind(now),             // 지난 로그인 정리
    db.prepare('INSERT INTO sessions (id, exp) VALUES (?, ?)').bind(id, exp)
  ]);
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return 'sid=' + id + '.' + exp + '.' + (await sign(env.SESSION_SECRET, 'admin.' + id + '.' + exp)) + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + SESSION_HOURS * 3600 + secure;
}
export async function endSession(db, request) {
  const s = readSession(request);
  if (s) await db.prepare('DELETE FROM sessions WHERE id = ?').bind(s.id).run();
}
export const clearCookie = 'sid=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0';
export async function isAdmin(request, env) {
  if (!configured(env)) return false;
  const s = readSession(request);
  if (!s || s.exp < Date.now()) return false;                                                              // ② 만료
  if (!sameText(s.sig, await sign(env.SESSION_SECRET, 'admin.' + s.id + '.' + s.exp))) return false;       // ① 서명
  return !!(await env.DB.prepare('SELECT 1 FROM sessions WHERE id = ? AND exp > ?').bind(s.id, Date.now()).first());   // ③ 아직 살아 있는 로그인인지
}

/* ── 횟수 제한: 같은 곳에서 같은 일을 너무 자주 하면 막는다 ──
 *   kind: [허용 횟수, 기간(초)].  RATE_WINDOW_SEC가 있으면 기간을 그 값으로 바꾼다(검사용).
 *   login   한 곳에서 틀린 비밀번호
 *   pay     한 곳에서 새 주문 제출
 *   look    한 곳에서 틀린 주문 조회 (없는 주문번호). 맞는 조회는 세지 않는다
 *   coupon  한 곳에서 틀린 쿠폰 코드
 * "어디서든 합친 로그인 실패 상한"은 두지 않는다: 누군가 일부러 틀리게 넣어 운영자의 로그인을 계속 막을 수 있어서다.
 * 주소를 바꿔 가며 하는 시도는 긴 비밀번호(MIN_PASSWORD)로 막는다. */
const LIMITS = { login: [5, 900], pay: [10, 3600], look: [20, 600], coupon: [20, 600] };
const ipOf = request => (request.headers.get('cf-connecting-ip') || 'local').trim().toLowerCase();
// 세는 단위. IPv6는 한 사람이 /64 대역을 통째로 받아 끝자리를 마음대로 바꿀 수 있으므로 앞 64비트로 묶는다.
export function ipKey(request) {
  const ip = ipOf(request);
  if (ip.indexOf(':') < 0) return ip;
  const halves = ip.split('::');
  let head = halves[0] ? halves[0].split(':') : [];
  if (halves.length > 1) {
    const tail = halves[1] ? halves[1].split(':') : [];
    head = head.concat(Array(Math.max(0, 8 - head.length - tail.length)).fill('0'), tail);
  }
  return head.slice(0, 4).map(h => h.replace(/^0+(?=.)/, '')).join(':') + '::/64';
}
export async function overLimit(db, env, request, kind) {
  const max = LIMITS[kind][0], since = Date.now() - (Number(env.RATE_WINDOW_SEC) || LIMITS[kind][1]) * 1000;
  const row = await db.prepare('SELECT COUNT(*) AS n FROM hits WHERE kind = ? AND ip = ? AND at > ?').bind(kind, ipKey(request), since).first();
  return row.n >= max;
}
export async function recordHit(db, request, kind) {
  const now = Date.now();
  await db.batch([
    db.prepare('INSERT INTO hits (kind, ip, at) VALUES (?,?,?)').bind(kind, ipKey(request), now),
    db.prepare('DELETE FROM hits WHERE at < ?').bind(now - 86400000)
  ]);
}

/* ── DB 행 → 화면이 쓰는 모양 ── */
export const toService = r => ({ id: r.id, name: [r.name_id, r.name_ko], desc: [r.desc_id, r.desc_ko], cur: r.cur });
export const toBatch = r => ({ id: r.id, svc: r.svc, no: r.no, title: r.title, month: r.month, stage: r.stage, closeDate: r.close_date, kurs: r.kurs, note: r.note });
export const toOrder = r => ({ id: r.id, batchId: r.batch_id, buyer: r.buyer, item: r.item, qty: r.qty, base: r.base, total: r.total, pay: r.pay, method: r.method, proofName: r.proof_name, createdAt: r.created_at, self: r.self ? 1 : 0, late: r.late || 0 });
// 주문을 읽을 때는 표시(order_flags)를 함께 읽는다
export const ORDER_SELECT = 'SELECT o.*, f.self AS self, f.late AS late FROM orders o LEFT JOIN order_flags f ON f.order_id = o.id';
// 공개 리캡에 넣는 주문: 고객이 직접 만든 주문은 승인(결제 완료)된 뒤에만. 아무나 적은 글이 공개 화면에 바로 뜨지 않게 한다.
export const PUBLIC_ORDERS = "FROM orders o LEFT JOIN order_flags f ON f.order_id = o.id WHERE NOT (IFNULL(f.self, 0) = 1 AND o.pay != 'paid')";

/* ── 예시 데이터 넣기 (처음 실행할 때와 관리자의 "초기화") ── */
export async function seed(db) {
  const s = GO.seed();
  const stmts = [
    db.prepare('DELETE FROM order_flags'), db.prepare('DELETE FROM orders'), db.prepare('DELETE FROM batches'), db.prepare('DELETE FROM services'),
    db.prepare('DELETE FROM vouchers'), db.prepare('DELETE FROM settings')
  ];
  s.services.forEach((v, i) => stmts.push(db.prepare('INSERT INTO services (id, name_id, name_ko, desc_id, desc_ko, cur, sort) VALUES (?,?,?,?,?,?,?)').bind(v.id, v.name[0], v.name[1], v.desc[0], v.desc[1], v.cur, i)));
  s.batches.forEach(b => stmts.push(db.prepare('INSERT INTO batches (id, svc, no, title, month, stage, close_date, kurs, note) VALUES (?,?,?,?,?,?,?,?,?)').bind(b.id, b.svc, b.no, b.title, b.month, b.stage, b.closeDate, b.kurs, b.note)));
  s.orders.forEach(o => stmts.push(db.prepare('INSERT INTO orders (id, batch_id, buyer, item, qty, base, total, pay, method, proof_name, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind(o.id, o.batchId, o.buyer, o.item, o.qty, o.total, o.total, o.pay, o.method, o.proofName, o.createdAt)));
  s.vouchers.forEach(v => stmts.push(db.prepare('INSERT INTO vouchers (code, off) VALUES (?,?)').bind(v.code, v.off)));
  stmts.push(db.prepare('INSERT INTO settings (key, value) VALUES (?,?)').bind('calcDefaults', JSON.stringify(s.calcDefaults)));
  await db.batch(stmts);
}

// 서비스 종류(한국·일본·티켓)만 넣는다. 배치·주문·쿠폰 같은 예시는 넣지 않는다.
export async function seedServices(db) {
  await db.batch(GO.seed().services.map((v, i) => db.prepare('INSERT OR IGNORE INTO services (id, name_id, name_ko, desc_id, desc_ko, cur, sort) VALUES (?,?,?,?,?,?,?)').bind(v.id, v.name[0], v.name[1], v.desc[0], v.desc[1], v.cur, i)));
}

/* ── 화면 전체 상태 읽기. admin이 아니면 공개해도 되는 것만 담는다 ──
 * 서비스 표가 비어 있으면(새 DB) 채운다. 예시 주문까지 넣는 것은 초기화가 허용된 곳(내 컴퓨터, GitHub 검사)뿐이고,
 * 배포판에서는 서비스 종류만 넣는다: 예시 주문번호는 공개된 코드로 계산할 수 있어 실제 사이트에 다시 생기면 안 된다. */
export async function loadState(db, admin, env) {
  let services = (await db.prepare('SELECT * FROM services ORDER BY sort').all()).results;
  if (!services.length) { await (canReset(env) ? seed(db) : seedServices(db)); services = (await db.prepare('SELECT * FROM services ORDER BY sort').all()).results; }
  const batches = (await db.prepare('SELECT * FROM batches').all()).results;
  const state = { services: services.map(toService) };

  if (!admin) {
    // 공개 화면에는 배치의 단계와 수량만 보낸다. 주문, 이름, 금액, 결제 상태는 싣지 않는다.
    // 품목별 수량은 고객이 배치를 열 때 /api/batch-items 로 받아 간다. 자기 주문은 주문번호로만 본다.
    const pcs = {};
    (await db.prepare('SELECT o.batch_id AS batch_id, SUM(o.qty) AS pcs ' + PUBLIC_ORDERS + ' GROUP BY o.batch_id').all()).results.forEach(r => { pcs[r.batch_id] = r.pcs; });
    state.batches = batches.map(r => Object.assign(toBatch(r), { stats: { pcs: pcs[r.id] || 0 } }));
    return state;
  }

  const [orders, vouchers, calc] = await Promise.all([
    db.prepare(ORDER_SELECT + ' ORDER BY o.created_at, o.id').all(),
    db.prepare('SELECT * FROM vouchers').all(),
    db.prepare('SELECT value FROM settings WHERE key = ?').bind('calcDefaults').first()
  ]);
  state.batches = batches.map(toBatch);
  state.orders = orders.results.map(toOrder);
  state.vouchers = vouchers.results;
  state.calcDefaults = calc ? JSON.parse(calc.value) : GO.seed().calcDefaults;
  return state;
}

/* ── 관리자 활동 기록: 누가(접속 주소) 언제 무엇을 했는지 ── */
export async function logAct(db, request, action, detail) {
  await db.prepare('INSERT INTO audit (at, ip, action, detail) VALUES (?,?,?,?)')
    .bind(new Date().toISOString(), ipOf(request), action, String(detail || '').slice(0, 200)).run();
}
