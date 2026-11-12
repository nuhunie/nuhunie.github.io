/* 웹 푸시: 배치 단계가 바뀌면 그 배치에 주문한 고객의 휴대폰에 알림을 보낸다.
 *
 * 고객 아이디가 없으므로 "기기"에 보낸다. 고객이 주문 화면에서 "알림 받기"를 누르면 브라우저가 그 기기 전용 수신 주소(endpoint)와
 * 열쇠 두 개(p256dh, auth)를 만들어 준다. 서버는 이것을 주문번호와 짝지어 저장한다(push_subs, push_links). 이름·연락처는 받지 않는다.
 *
 * 보내는 법은 표준 두 가지를 그대로 따른다. 따로 설치하는 라이브러리 없이 Cloudflare 가 가진 WebCrypto 만 쓴다.
 *   RFC 8291  알림 내용 암호화 (aes128gcm). 알림 회사(구글·애플·모질라)는 내용을 읽지 못한다.
 *   RFC 8292  VAPID: 우리 서버가 보낸 알림임을 서명으로 밝힌다. 열쇠는 VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (scripts/vapid.js 로 만든다).
 *
 * 보낼 알림은 push_queue 에 넣고, 요청이 올 때 조금씩(DRAIN_MAX 건) 꺼내 보낸다. Cloudflare 무료 요금제의 요청 한 번 한도 때문이다.
 *   CPU 시간 10ms: 알림 1건의 암호화·서명이 약 0.6ms(내 컴퓨터에서 잰 값, 20건에 약 12ms). 8건이면 약 5ms 로 절반 아래.
 *   서브요청 50개: D1 읽기·쓰기도 센다. 단계 변경 요청은 D1·캐시 약 12개 + 알림 8건 = 약 20개.
 *   (응답 뒤에 하는 일(waitUntil)의 CPU 가 같은 한도에 드는지는 문서에 없다. 든다고 보고 정했다.) 꺼낼 때 지우면서 꺼내므로
 * (DELETE ... RETURNING) 같은 순간 두 요청이 같은 알림을 두 번 보내지 않는다. */
import '../site/js/i18n-en.js';

const GO = globalThis.GO, X = GO.logic;
export const DRAIN_MAX = 8;
const TTL_SEC = 3 * 86400;                         // 휴대폰이 꺼져 있으면 알림 회사가 이 시간 동안 들고 있다가 전한다
const MAX_ORDERS_PER_DEVICE = 20;

/* ── base64url ── */
export function b64u(bytes) {
  let s = ''; bytes = new Uint8Array(bytes);
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function unb64u(text) {
  if (typeof text !== 'string' || text.length > 2000 || !/^[A-Za-z0-9_-]*={0,2}$/.test(text)) return null;
  const t = text.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
  let s; try { s = atob(t + '='.repeat((4 - t.length % 4) % 4)); } catch (e) { return null; }
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
const enc = t => new TextEncoder().encode(t);
const concat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; parts.forEach(p => { out.set(p, o); o += p.length; }); return out; };

/* ── 받는 쪽 확인 ──
 * 서버가 이 주소로 직접 요청을 보내므로, 아무 주소나 받으면 우리 서버를 남의 서버를 두드리는 데 쓸 수 있다.
 * 브라우저들이 실제로 쓰는 알림 회사 주소만 받는다. 검사 환경(ALLOW_RESET=1)에서만 PUSH_TEST_ORIGIN 의 가짜 알림 서버를 더 받는다. */
// jmt17.google.com: 크롬이 일부 사용자에게 fcm.googleapis.com 대신 내준다고 알려진 구글 주소(확인은 못 했다. 구글 주소라 받아도 위험은 없다)
const PUSH_HOSTS = ['fcm.googleapis.com', 'jmt17.google.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'];
const PUSH_SUFFIX = ['.notify.windows.com', '.push.apple.com'];
export function endpointOk(endpoint, env) {
  if (typeof endpoint !== 'string' || endpoint.length > 1000) return false;
  let u; try { u = new URL(endpoint); } catch (e) { return false; }
  if (env && env.ALLOW_RESET === '1' && env.PUSH_TEST_ORIGIN && u.origin === env.PUSH_TEST_ORIGIN) return true;
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
  return PUSH_HOSTS.includes(u.hostname) || PUSH_SUFFIX.some(s => u.hostname.endsWith(s));
}
// 브라우저가 준 열쇠: p256dh 는 P-256 공개 열쇠(65바이트, 0x04로 시작), auth 는 16바이트
export function keysOk(p256dh, auth) {
  const p = unb64u(p256dh), a = unb64u(auth);
  return !!(p && a && p.length === 65 && p[0] === 4 && a.length === 16);
}
export const configured = env => !!(env && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);

/* ── RFC 8291 암호화 ──
 * 검사에서 RFC 부록 A의 값으로 같은 결과가 나오는지 확인할 수 있게, 서버 열쇠와 salt 를 밖에서 줄 수 있다(평소에는 새로 만든다). */
async function hkdf(salt, ikm, info, len) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8));
}
const jwkFrom = (pub, d) => ({ kty: 'EC', crv: 'P-256', x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), d: d ? b64u(d) : undefined, ext: true });
export async function encrypt(payload, uaPublicB64, authB64, fixed) {
  const uaPublic = unb64u(uaPublicB64), auth = unb64u(authB64);
  let asPublic, asPrivate;
  if (fixed) {
    asPublic = unb64u(fixed.asPublic);
    asPrivate = await crypto.subtle.importKey('jwk', jwkFrom(asPublic, unb64u(fixed.asPrivate)), { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  } else {
    const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey)); asPrivate = kp.privateKey;
  }
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asPrivate, 256));
  const ikm = await hkdf(auth, ecdh, concat(enc('WebPush: info'), new Uint8Array([0]), uaPublic, asPublic), 32);
  const salt = fixed ? unb64u(fixed.salt) : crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, concat(enc('Content-Encoding: aes128gcm'), new Uint8Array([0])), 16);
  const nonce = await hkdf(salt, ikm, concat(enc('Content-Encoding: nonce'), new Uint8Array([0])), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const body = concat(typeof payload === 'string' ? enc(payload) : payload, new Uint8Array([2]));   // 2 = 마지막 기록
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, body));
  const header = concat(salt, new Uint8Array([0, 0, 16, 0]), new Uint8Array([asPublic.length]), asPublic);   // rs = 4096
  return concat(header, cipher);
}

/* ── RFC 8292 VAPID ── 알림 회사(주소의 origin)마다 서명 하나를 만들어 같은 번에 다시 쓴다 */
export async function vapidAuth(endpoint, env, subject, now) {
  const pub = unb64u(env.VAPID_PUBLIC_KEY), d = unb64u(env.VAPID_PRIVATE_KEY);
  const key = await crypto.subtle.importKey('jwk', jwkFrom(pub, d), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = b64u(enc(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(enc(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor((now || Date.now()) / 1000) + 12 * 3600, sub: subject })));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc(head + '.' + claims)));   // r||s 64바이트 = JWS 형식
  return 'vapid t=' + head + '.' + claims + '.' + b64u(sig) + ', k=' + env.VAPID_PUBLIC_KEY;
}

/* ── 알림 문구 ── 고객이 "알림 받기"를 누를 때의 화면 언어로 보낸다. 이름·금액·품목은 넣지 않는다(주문번호를 아는 사람은 누구나 신청할 수 있다). */
export function pushText(batch, stage, lang) {
  const pick = (id, ko) => lang === 'ko' ? ko : lang === 'en' ? ((GO.EN && GO.EN[id]) || id) : id;
  const st = GO.STAGES[stage] || ['', ''];
  return {
    title: pick('Update pesanan', '주문 진행 알림') + ' · ' + GO.BRAND.name,
    // 배치 이름은 사이트와 같게 (ui.js 의 batchName: "Batch 4 · Handcarry Korea")
    body: 'Batch ' + batch.no + ' · ' + batch.title + ': ' + pick(st[0], st[1]) + '. ' + pick('Ketuk untuk lihat pesananmu.', '눌러서 내 주문을 확인하세요.')
  };
}

/* 단계가 바뀐 배치의 알림을 줄에 넣는다. 받는 주문: 그 배치의 결제 완료·확인 대기 주문 중 마감 뒤 주문(따로 처리)이 아닌 것.
 * 한 기기가 같은 배치에 주문을 여럿 했으면 알림은 한 번만 간다. 돌려주는 값: 줄에 넣은 건수. */
export async function queueStage(db, batchId, stage) {
  if (!GO.PUSH_STAGES.includes(stage)) return 0;
  const batch = await db.prepare('SELECT id, title, no FROM batches WHERE id = ?').bind(batchId).first();
  if (!batch) return 0;
  const rows = (await db.prepare("SELECT s.endpoint AS endpoint, s.lang AS lang, MIN(l.order_id) AS order_id FROM push_links l JOIN push_subs s ON s.endpoint = l.endpoint " +
    "JOIN orders o ON o.id = l.order_id LEFT JOIN order_flags f ON f.order_id = o.id WHERE o.batch_id = ? AND o.pay IN ('paid', 'pending') AND IFNULL(f.late, 0) = 0 GROUP BY s.endpoint").bind(batchId).all()).results;
  if (!rows.length) return 0;
  const at = new Date().toISOString();
  await db.batch(rows.map(r => {
    const t = pushText(batch, stage, r.lang);
    const payload = JSON.stringify({ title: t.title, body: t.body, url: '/#/track/' + r.order_id, tag: 'nuh-' + batch.id });
    return db.prepare('INSERT INTO push_queue (endpoint, payload, created_at) VALUES (?, ?, ?)').bind(r.endpoint, payload, at);
  }));
  return rows.length;
}

/* 줄에서 DRAIN_MAX 건을 꺼내 보낸다. 알림 회사가 "없는 주소"(404·410)라고 하면 그 기기의 신청을 지운다.
 * 돌려주는 값: { sent, gone, failed } */
export async function drainQueue(db, env, origin, sendFetch) {
  const out = { sent: 0, gone: 0, failed: 0 };
  if (!configured(env)) return out;
  const rows = (await db.prepare('DELETE FROM push_queue WHERE id IN (SELECT id FROM push_queue ORDER BY id LIMIT ?) RETURNING id, endpoint, payload').bind(DRAIN_MAX).all()).results || [];
  if (!rows.length) return out;
  const subs = {};
  (await db.prepare('SELECT endpoint, p256dh, auth FROM push_subs WHERE endpoint IN (' + rows.map(() => '?').join(',') + ')').bind(...rows.map(r => r.endpoint)).all()).results.forEach(s => { subs[s.endpoint] = s; });
  // 보낸 곳 표시(sub)는 https 주소나 mailto 여야 한다. 애플(아이폰)은 아니면 알림을 거절한다. 내 컴퓨터(http)에서도 https 로 적는다.
  const subject = env.VAPID_SUBJECT || origin.replace(/^http:/, 'https:'), auths = {}, dead = [];
  await Promise.all(rows.map(async r => {
    const s = subs[r.endpoint];
    if (!s) return;                                   // 그 사이 알림을 끈 기기
    try {
      const aud = new URL(r.endpoint).origin;
      auths[aud] = auths[aud] || vapidAuth(r.endpoint, env, subject);
      const res = await (sendFetch || fetch)(r.endpoint, {
        method: 'POST',
        headers: { authorization: await auths[aud], 'content-encoding': 'aes128gcm', 'content-type': 'application/octet-stream', ttl: String(TTL_SEC), urgency: 'normal' },
        body: await encrypt(r.payload, s.p256dh, s.auth)
      });
      if (res.status === 404 || res.status === 410) { dead.push(r.endpoint); out.gone++; }
      else if (res.ok) out.sent++;
      else out.failed++;
    } catch (e) { out.failed++; }
  }));
  if (dead.length) await db.batch(dead.flatMap(ep => [db.prepare('DELETE FROM push_links WHERE endpoint = ?').bind(ep), db.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(ep)]));
  await db.prepare('INSERT INTO audit (at, ip, action, detail) VALUES (?,?,?,?)').bind(new Date().toISOString(), 'auto', 'push.send', 'sent ' + out.sent + (out.gone ? ' gone ' + out.gone : '') + (out.failed ? ' failed ' + out.failed : '')).run();
  return out;
}

/* 주문 하나에 붙일 수 있는 기기 수를 넘었는가 (이미 붙어 있는 기기가 다시 신청하는 것은 세지 않는다).
 * 한도가 없으면 주문번호 하나로 가짜 기기를 얼마든지 붙여, 한 번에 8건씩 보내는 줄을 막을 수 있다(2026-11-13 QA). */
const MAX_DEVICES_PER_ORDER = 10;
export async function orderFull(db, orderId, endpoint) {
  const n = await db.prepare('SELECT COUNT(*) AS n FROM push_links WHERE order_id = ? AND endpoint != ?').bind(orderId, endpoint).first();
  return n.n >= MAX_DEVICES_PER_ORDER;
}
/* 신청: 이 기기(endpoint)가 이 주문의 알림을 받는다. 같은 기기는 주문 MAX_ORDERS_PER_DEVICE 개까지. */
export async function subscribe(db, endpoint, p256dh, auth, lang, orderId) {
  const at = new Date().toISOString();
  const n = await db.prepare('SELECT COUNT(*) AS n FROM push_links WHERE endpoint = ? AND order_id != ?').bind(endpoint, orderId).first();
  if (n.n >= MAX_ORDERS_PER_DEVICE) return false;
  await db.batch([
    db.prepare('INSERT INTO push_subs (endpoint, p256dh, auth, lang, created_at) VALUES (?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, lang = excluded.lang').bind(endpoint, p256dh, auth, lang, at),
    db.prepare('INSERT OR IGNORE INTO push_links (endpoint, order_id, created_at) VALUES (?,?,?)').bind(endpoint, orderId, at)
  ]);
  return true;
}
// 끄기: 주문번호를 주면 그 주문만, 안 주면 이 기기의 신청 전부. 남은 주문이 없으면 기기 기록도 지운다.
export async function unsubscribe(db, endpoint, orderId) {
  await db.batch([
    orderId ? db.prepare('DELETE FROM push_links WHERE endpoint = ? AND order_id = ?').bind(endpoint, orderId) : db.prepare('DELETE FROM push_links WHERE endpoint = ?').bind(endpoint),
    db.prepare('DELETE FROM push_subs WHERE endpoint = ? AND NOT EXISTS (SELECT 1 FROM push_links WHERE endpoint = ?)').bind(endpoint, endpoint),
    db.prepare('DELETE FROM push_queue WHERE endpoint = ? AND NOT EXISTS (SELECT 1 FROM push_subs WHERE endpoint = ?)').bind(endpoint, endpoint)
  ]);
}
// 주문을 지우는 모든 곳에서 함께 지운다: 그 주문의 신청 연결, 그리고 연결이 하나도 남지 않은 기기 기록
export const UNLINK_ORDER = 'DELETE FROM push_links WHERE order_id = ?';
export const UNLINK_BATCH = 'DELETE FROM push_links WHERE order_id IN (SELECT id FROM orders WHERE batch_id = ?)';
export const DROP_LONELY_SUBS = 'DELETE FROM push_subs WHERE NOT EXISTS (SELECT 1 FROM push_links l WHERE l.endpoint = push_subs.endpoint)';
