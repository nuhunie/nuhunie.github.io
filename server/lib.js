/* 서버 공통 도구: 응답, 입력 검사, 관리자 세션, DB ↔ 화면 데이터 변환.
 * 계산 규칙은 새로 쓰지 않고 브라우저와 같은 js/data.js, js/logic.js를 그대로 불러 쓴다. */
import '../js/data.js';
import '../js/logic.js';

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
export const V = {
  text(v, max) { v = typeof v === 'string' ? v.trim() : ''; return v && v.length <= max ? v : null; },
  optText(v, max) { v = typeof v === 'string' ? v.trim() : ''; return v.length <= max ? v : null; },
  int(v, min, max) { v = Number(v); return Number.isInteger(v) && v >= min && v <= max ? v : null; },
  num(v, min, max) { v = Number(v); return Number.isFinite(v) && v >= min && v <= max ? v : null; },
  oneOf(v, list) { return list.indexOf(v) >= 0 ? v : null; },
  month(v) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : null; },
  date(v) { return v === '' || v == null ? '' : /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null; },
  orderId(v) { v = typeof v === 'string' ? v.trim().toUpperCase() : ''; return new RegExp('^' + GO.BRAND.orderPrefix + '-\\d{6}$').test(v) ? v : null; }
};
export const PAY = Object.keys(GO.PAY);

/* ── 관리자 세션: 서명한 쿠키. 서버에 세션을 저장하지 않는다 ──
 *   쿠키 값 = 만료시각.서명,  서명 = HMAC-SHA256(SESSION_SECRET, "admin." + 만료시각) */
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
export function configured(env) { return !!(env.ADMIN_PASSWORD && env.SESSION_SECRET); }
export async function passwordOk(env, given) {
  if (!configured(env) || typeof given !== 'string') return false;
  // 두 값을 같은 열쇠로 서명한 뒤 비교한다 (길이가 달라도 비교 시간이 같다)
  return sameText(await sign(env.SESSION_SECRET, 'pw.' + given), await sign(env.SESSION_SECRET, 'pw.' + env.ADMIN_PASSWORD));
}
export async function sessionCookie(env, request) {
  const exp = Date.now() + SESSION_HOURS * 3600 * 1000;
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return 'sid=' + exp + '.' + (await sign(env.SESSION_SECRET, 'admin.' + exp)) + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + SESSION_HOURS * 3600 + secure;
}
export const clearCookie = 'sid=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0';
export async function isAdmin(request, env) {
  if (!configured(env)) return false;
  const m = (request.headers.get('cookie') || '').match(/(?:^|;\s*)sid=(\d+)\.([0-9a-f]{64})/);
  if (!m || Number(m[1]) < Date.now()) return false;
  return sameText(m[2], await sign(env.SESSION_SECRET, 'admin.' + m[1]));
}

/* ── 횟수 제한: 같은 곳(ip)에서 같은 일을 너무 자주 하면 막는다 ──
 *   kind: [허용 횟수, 기간(초)].  RATE_WINDOW_SEC가 있으면 기간을 그 값으로 바꾼다(검사용). */
const LIMITS = { login: [5, 900], pay: [10, 3600], look: [60, 60] };
const ipOf = request => request.headers.get('cf-connecting-ip') || 'local';
export async function overLimit(db, env, request, kind) {
  const max = LIMITS[kind][0], windowMs = (Number(env.RATE_WINDOW_SEC) || LIMITS[kind][1]) * 1000;
  const row = await db.prepare('SELECT COUNT(*) AS n FROM hits WHERE kind = ? AND ip = ? AND at > ?').bind(kind, ipOf(request), Date.now() - windowMs).first();
  return row.n >= max;
}
export async function recordHit(db, request, kind) {
  const now = Date.now();
  await db.batch([
    db.prepare('INSERT INTO hits (kind, ip, at) VALUES (?,?,?)').bind(kind, ipOf(request), now),
    db.prepare('DELETE FROM hits WHERE at < ?').bind(now - 86400000)
  ]);
}

/* ── DB 행 → 화면이 쓰는 모양 ── */
export const toService = r => ({ id: r.id, name: [r.name_id, r.name_ko], desc: [r.desc_id, r.desc_ko], cur: r.cur });
export const toBatch = r => ({ id: r.id, svc: r.svc, no: r.no, title: r.title, month: r.month, stage: r.stage, closeDate: r.close_date, kurs: r.kurs, note: r.note });
export const toOrder = r => ({ id: r.id, batchId: r.batch_id, buyer: r.buyer, item: r.item, qty: r.qty, base: r.base, total: r.total, pay: r.pay, method: r.method, proofName: r.proof_name, createdAt: r.created_at });
// 공개 화면용: 주문번호·증빙을 빼고 이름을 가린다
export const toPublicOrder = r => ({ batchId: r.batch_id, buyer: X.maskName(r.buyer), item: r.item, qty: r.qty, total: r.total, pay: r.pay });

/* ── 예시 데이터 넣기 (처음 실행할 때와 관리자의 "초기화") ── */
export async function seed(db) {
  const s = GO.seed();
  const stmts = [
    db.prepare('DELETE FROM orders'), db.prepare('DELETE FROM batches'), db.prepare('DELETE FROM services'),
    db.prepare('DELETE FROM vouchers'), db.prepare('DELETE FROM settings')
  ];
  s.services.forEach((v, i) => stmts.push(db.prepare('INSERT INTO services (id, name_id, name_ko, desc_id, desc_ko, cur, sort) VALUES (?,?,?,?,?,?,?)').bind(v.id, v.name[0], v.name[1], v.desc[0], v.desc[1], v.cur, i)));
  s.batches.forEach(b => stmts.push(db.prepare('INSERT INTO batches (id, svc, no, title, month, stage, close_date, kurs, note) VALUES (?,?,?,?,?,?,?,?,?)').bind(b.id, b.svc, b.no, b.title, b.month, b.stage, b.closeDate, b.kurs, b.note)));
  s.orders.forEach(o => stmts.push(db.prepare('INSERT INTO orders (id, batch_id, buyer, item, qty, base, total, pay, method, proof_name, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind(o.id, o.batchId, o.buyer, o.item, o.qty, o.total, o.total, o.pay, o.method, o.proofName, o.createdAt)));
  s.vouchers.forEach(v => stmts.push(db.prepare('INSERT INTO vouchers (code, off) VALUES (?,?)').bind(v.code, v.off)));
  stmts.push(db.prepare('INSERT INTO settings (key, value) VALUES (?,?)').bind('calcDefaults', JSON.stringify(s.calcDefaults)));
  await db.batch(stmts);
}

/* ── 화면 전체 상태 읽기. admin이 아니면 공개해도 되는 것만 담는다 ── */
export async function loadState(db, admin) {
  let services = (await db.prepare('SELECT * FROM services ORDER BY sort').all()).results;
  if (!services.length) { await seed(db); services = (await db.prepare('SELECT * FROM services ORDER BY sort').all()).results; }
  const [batches, orders] = await Promise.all([
    db.prepare('SELECT * FROM batches').all(),
    db.prepare('SELECT * FROM orders ORDER BY created_at, id').all()
  ]);
  const state = { services: services.map(toService), batches: batches.results.map(toBatch) };
  if (!admin) { state.orders = orders.results.map(toPublicOrder); return state; }
  const [vouchers, calc] = await Promise.all([
    db.prepare('SELECT * FROM vouchers').all(),
    db.prepare('SELECT value FROM settings WHERE key = ?').bind('calcDefaults').first()
  ]);
  state.orders = orders.results.map(toOrder);
  state.vouchers = vouchers.results;
  state.calcDefaults = calc ? JSON.parse(calc.value) : GO.seed().calcDefaults;
  return state;
}
