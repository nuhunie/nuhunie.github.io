/* API 한 파일 라우터 (Cloudflare Pages Functions).  /api/... 로 오는 모든 요청이 여기로 온다.
 *
 * 누구나
 *   GET  /api/public           서비스·배치와 배치별 수량 (주문·이름·금액은 싣지 않는다). 60초 동안 저장해 두고 돌려준다
 *   GET  /api/batch-items?id=  배치 하나의 품목별 수량
 *   GET  /api/track?q=         주문번호로 내 주문 조회
 *   GET  /api/order?id=        주문 한 건 (결제 화면 불러오기)
 *   POST /api/voucher          쿠폰 확인
 *   POST /api/order            새 주문 접수(결제 전). 주문번호와 결제 금액을 서버가 정해 저장한다
 *   POST /api/proof/:id        결제 증빙 사진 올리기(본문이 그림 그대로). 결제 전·반려된 주문에만
 *   POST /api/pay              접수된 주문의 결제 증빙 제출 → 확인 대기
 *   GET  /api/push/key         웹 푸시 공개 열쇠 (비어 있으면 알림 기능이 꺼져 있다)
 *   POST /api/push/subscribe   이 기기가 이 주문의 알림을 받는다 { orderId, endpoint, keys: { p256dh, auth }, lang }
 *   POST /api/push/unsubscribe 알림 끄기 { endpoint, orderId? }
 *   GET  /api/me               관리자 로그인 여부
 *   POST /api/login, /api/logout
 * 관리자만 (/api/admin/...)
 *   GET  state                 전체 상태
 *   POST batch · PATCH batch/:id · DELETE batch/:id
 *   POST order · PATCH order/:id · DELETE order/:id
 *   POST voucher · POST voucher/bulk · PATCH voucher/:code · DELETE voucher/:code   쿠폰, 한 장짜리 쿠폰 여러 장, 메모
 *   POST service · PATCH service/:id · DELETE service/:id   서비스 종류
 *   GET  proof/:id             결제 증빙 사진 보기
 *   PUT  calc                  계산기 기본 수식
 *   POST reset                 예시 데이터로 초기화 (ALLOW_RESET=1 인 곳에서만. 배포판에는 꺼져 있다)
 *   GET  log                   활동 기록
 */
import { GO, X, V, PAY, json, fail, readJson, isAdmin, configured, passwordOk, startSession, endSession, clearCookie, loadState, seed, toOrder, overLimit, recordHit, logAct, canReset, weakPassword, ORDER_SELECT, PUBLIC_ORDERS, withDeadline, expired, purgeExpired, canUnpay, VOUCHER_SELECT, toService, reserveVoucher, VOUCHER_USED, VOUCHER_FULL_FOR, photoOk, toBase64, fromBase64 } from '../../server/lib.js';
import * as Push from '../../server/push.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const NO_VOUCHER = 'Voucher not found.';
const SVC_CLOSED = 'This service is not taking orders now.';
const VOUCHER_GONE_WHILE_REJECTED = 'The voucher on this order was used up while it was rejected.';
const PUBLIC_CACHE_SEC = 60;      // 서버 쪽에 저장해 두는 시간. 내용이 바뀌면 바로 지운다
const PUBLIC_BROWSER_SEC = 10;    // 고객 브라우저가 다시 묻지 않는 시간

export async function onRequest({ request, env, params, waitUntil }) {
  const db = env.DB;
  if (!db) return fail('Database is not connected.', 500);
  const path = [].concat(params.path || []);
  const method = request.method;
  const route = method + ' /' + path.join('/');
  const url = new URL(request.url);

  // 공개 목록은 잠깐 저장해 두고 돌려준다: 화면을 옮길 때마다, 또는 누가 일부러 계속 불러도 DB를 매번 읽지 않는다.
  // 내용이 바뀌는 요청(결제 제출, 관리자 변경) 뒤에는 저장해 둔 것을 지운다.
  const publicKey = new Request(url.origin + '/api/public');
  const dropPublicCache = () => caches.default.delete(publicKey).catch(() => {});
  // 응답을 먼저 돌려주고 뒤에서 하는 일(알림 보내기). 실패해도 요청은 성공으로 끝난다.
  const later = p => { const q = Promise.resolve(p).catch(e => console.error('push', e && e.message)); if (waitUntil) waitUntil(q); return q; };
  const sendPush = () => later(Push.drainQueue(db, env, url.origin));

  try {
    /* ── 누구나 ── */
    if (route === 'GET /public') {
      const hit = await caches.default.match(publicKey);
      if (hit) return hit;
      const res = json(await loadState(db, false, env), 200, { 'cache-control': 'public, max-age=' + PUBLIC_BROWSER_SEC + ', s-maxage=' + PUBLIC_CACHE_SEC });
      await caches.default.put(publicKey, res.clone()).catch(() => {});
      return res;
    }

    if (route === 'GET /batch-items') {
      const rows = await db.prepare('SELECT o.item AS item, SUM(o.qty) AS qty ' + PUBLIC_ORDERS + ' AND o.batch_id = ? GROUP BY o.item ORDER BY qty DESC, o.item LIMIT 500').bind(url.searchParams.get('id') || '').all();
      return json({ items: rows.results });
    }

    if (route === 'GET /me') return json({ admin: await isAdmin(request, env), configured: configured(env), weak: weakPassword(env), canReset: canReset(env) });

    if (route === 'POST /login') {
      const b = await readJson(request);
      if (!configured(env)) return fail('Admin login is not set up yet.', 503);
      // 한 곳에서 5번 틀리면 15분 잠긴다. 잠긴 동안은 그곳에서 보낸 맞는 비밀번호도 받지 않는다.
      if (await overLimit(db, env, request, 'login')) return fail('Too many attempts. Try again later.', 429);
      if (!b || !(await passwordOk(env, b.password))) { await recordHit(db, request, 'login'); await sleep(400); return fail('Wrong password.', 401); }
      await logAct(db, request, 'login', '');
      return json({ admin: true }, 200, { 'set-cookie': await startSession(db, env, request) });
    }
    if (route === 'POST /logout') {
      await endSession(db, request);          // 서버에서 그 로그인을 지운다: 같은 쿠키를 다시 보내도 통하지 않는다
      return json({ admin: false }, 200, { 'set-cookie': clearCookie });
    }

    // 조회는 "틀린 번호"만 센다. 맞는 번호로 자기 주문을 여러 번 보는 것은 막지 않고, 기록(DB 쓰기)도 남기지 않는다.
    if (route === 'GET /track') {
      // 주문번호 전체가 맞아야 찾는다. 아이디로는 찾지 않는다: 아이디는 공개된 값이라 남의 주문을 보게 된다.
      const id = V.orderId(url.searchParams.get('q'));
      if (!id) return json({ orders: [] });
      if (await overLimit(db, env, request, 'look')) return fail('Too many requests. Try again later.', 429);
      const row = await db.prepare(ORDER_SELECT + ' WHERE o.id = ?').bind(id).first();
      if (!row) { await recordHit(db, request, 'look'); return json({ orders: [] }); }
      // 기한이 한참 지나도록 결제 전인 접수는 지우고, 지워졌다고 알린다 (틀린 번호로 세지 않는다)
      if (expired(toOrder(row), env)) { await purgeExpired(db, env); return json({ orders: [], gone: true }); }
      // 기한은 증빙 이름을 가리기 전에 정한다: 증빙을 낸 적 있는 주문에는 기한이 없다
      return json({ orders: [Object.assign(withDeadline(toOrder(row), env), { buyer: X.maskName(row.buyer), proofName: '' })] });
    }

    if (route === 'GET /order') {
      const id = V.orderId(url.searchParams.get('id'));
      if (!id) return fail('Order not found.', 404);
      if (await overLimit(db, env, request, 'look')) return fail('Too many requests. Try again later.', 429);
      const row = await db.prepare(ORDER_SELECT + ' WHERE o.id = ?').bind(id).first();
      if (!row) { await recordHit(db, request, 'look'); return fail('Order not found.', 404); }
      const o = withDeadline(toOrder(row), env);   // 기한은 증빙 이름을 가리기 전에 정한다
      if (expired(o, env)) { await purgeExpired(db, env); return json({ error: 'This order has expired.', gone: true }, 410); }
      o.proofName = ''; o.buyer = X.maskName(o.buyer);
      return json({ order: o });
    }

    if (route === 'POST /voucher') {
      const b = await readJson(request), code = b && V.text(String(b.code || '').toUpperCase(), 30);
      if (await overLimit(db, env, request, 'coupon')) return fail('Too many requests. Try again later.', 429);
      const v = code && await voucherFor(code, '');
      if (!v || v.err === NO_VOUCHER) { await recordHit(db, request, 'coupon'); return fail(NO_VOUCHER, 404); }
      if (v.err) return fail(v.err, 409);                 // 한도까지 쓴 쿠폰 (틀린 코드로 세지 않는다)
      return json({ code: v.code, off: v.off });
    }

    // (쿠폰 확인 voucherFor 는 아래 함수 선언에 있다)

    if (route === 'POST /order') {
      // 고객이 새 주문을 접수한다(결제 전). 주문번호와 결제 금액을 서버가 정해 저장하므로,
      // 고객이 화면을 새로 고치거나 은행 앱에 다녀와도, 다른 기기에서 열어도 금액이 바뀌지 않는다.
      const b = await readJson(request);
      if (!b) return fail('Bad request.');
      if (await overLimit(db, env, request, 'pay')) return fail('Too many new orders from here. Try again later.', 429);
      const buyer = V.text(typeof b.buyer === 'string' ? b.buyer.trim().replace(/^@/, '') : null, GO.LIMITS.buyer), item = V.text(b.item, GO.LIMITS.item);
      const qty = V.int(b.qty, 1, GO.LIMITS.qty), base = V.int(b.base, 1, GO.LIMITS.amount);
      if (!buyer || !item || qty === null || base === null) return fail('Buyer, item, quantity and total are required.');
      const batch = await db.prepare('SELECT b.id AS id, b.stage AS stage, h.svc_id AS hidden FROM batches b LEFT JOIN service_hidden h ON h.svc_id = b.svc WHERE b.id = ?').bind(typeof b.batchId === 'string' ? b.batchId : '').first();
      if (!batch) return fail('Batch not found.', 404);
      if (batch.stage === GO.LAST_STAGE) return fail('This batch is already completed.', 409);
      if (batch.hidden) return fail(SVC_CLOSED, 409);     // 운영자가 고객 화면에서 내린 서비스는 새 주문을 받지 않는다
      const vr = await voucherFor(b.voucher, '');
      if (vr.err) return fail(vr.err, vr.err === NO_VOUCHER ? 400 : 409);
      const off = vr.off;
      // 금액이 같은 주문이 있으면 운영자가 입금을 구분할 수 없다. 결제 전·확인 대기 주문과 금액이 겹치지 않는
      // 주문번호가 나올 때까지 다시 뽑는다. 여덟 번 모두 겹치면 마지막 번호를 쓴다(관리자 화면이 겹침을 알린다).
      await purgeExpired(db, env);                 // 지울 때가 된 접수를 먼저 지워, 그 금액을 다시 쓸 수 있게 한다
      let id = '', total = 0;
      for (let i = 0; i < 8; i++) {
        id = X.orderIdFrom(crypto.getRandomValues(new Uint8Array(8)));
        total = X.payable(base, off, id);
        if (!(await db.prepare("SELECT 1 FROM orders WHERE id = ? OR (total = ? AND pay IN ('unpaid', 'pending')) LIMIT 1").bind(id, total).first())) break;
      }
      // 주문 마감 뒤(단계 1 이상)에 들어온 새 주문도 받는다. 다만 이미 진행 중인 배치와 같은 일정으로는 처리할 수 없으므로
      // "마감 뒤 주문"으로 표시해 고객과 운영자 모두에게 알린다.
      const late = batch.stage >= 1 ? batch.stage : 0, now = new Date().toISOString();
      if (vr.code && !(await reserveVoucher(db, vr.code, id, vr.max))) return fail('This voucher has been used up.', 409);
      try {
        await db.batch([
          db.prepare("INSERT INTO orders (id, batch_id, buyer, item, qty, base, total, pay, method, proof_name, created_at) VALUES (?,?,?,?,?,?,?,'unpaid','','',?)")
            .bind(id, batch.id, buyer, item, qty, base, total, now),
          db.prepare('INSERT INTO order_flags (order_id, self, late) VALUES (?, 1, ?)').bind(id, late)
        ]);
      } catch (e) {
        if (vr.code) await db.prepare('DELETE FROM voucher_uses WHERE order_id = ?').bind(id).run();   // 예약을 돌려준다
        throw e;
      }
      await recordHit(db, request, 'pay');
      return json({ order: withDeadline({ id, batchId: batch.id, buyer, item, qty, base, total, pay: 'unpaid', method: '', proofName: '', createdAt: now, self: 1, late }, env) });
    }

    if (method === 'POST' && path[0] === 'proof' && path.length === 2) {
      // 결제 증빙 사진. 주문번호를 아는 사람(그 주문의 고객)만 올릴 수 있고, 결제 전·반려된 주문에만 받는다.
      let raw = ''; try { raw = decodeURIComponent(path[1]); } catch (e) { return fail('Bad address.'); }
      const id = V.orderId(raw);
      if (!id) return fail('Order not found.', 404);
      if (await overLimit(db, env, request, 'proof')) return fail('Too many requests. Try again later.', 429);
      const mime = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (Number(request.headers.get('content-length') || 0) > GO.LIMITS.photo) return fail('The photo is too large.', 413);
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.length > GO.LIMITS.photo) return fail('The photo is too large.', 413);
      if (!photoOk(mime, bytes)) return fail('Upload a JPG, PNG or WebP image.');
      const row = await db.prepare('SELECT pay FROM orders WHERE id = ?').bind(id).first();
      if (!row) { await recordHit(db, request, 'look'); return fail('Order not found.', 404); }
      if (row.pay !== 'unpaid' && row.pay !== 'rejected') return fail('This order has already been submitted.', 409);
      await db.prepare('INSERT OR REPLACE INTO proof_images (order_id, mime, data, size, created_at) VALUES (?,?,?,?,?)').bind(id, mime, toBase64(bytes), bytes.length, new Date().toISOString()).run();
      await recordHit(db, request, 'proof');
      return json({ ok: true, size: bytes.length });
    }

    if (route === 'POST /pay') {
      const b = await readJson(request);
      if (!b) return fail('Bad request.');
      const methodName = V.oneOf(b.method, ['QRIS', 'Transfer bank']), proof = V.text(b.proofName, GO.LIMITS.proof);
      if (!methodName || !proof) return fail('Payment method and proof are required.');
      if (!b.orderId) return fail('Create the order first.');     // 새 주문은 POST /order 로 먼저 접수한다
      const id = V.orderId(b.orderId), row = id && await db.prepare(ORDER_SELECT + ' WHERE o.id = ?').bind(id).first();
      if (!row) return fail('Order not found.', 404);
      // 기한이 지난 접수도 유예 시간 동안은 증빙을 받는다(기한 직전에 입금한 고객). 지울 때가 됐으면 받지 않는다.
      if (expired(toOrder(row), env)) { await purgeExpired(db, env); return json({ error: 'This order has expired.', gone: true }, 410); }
      // 금액은 DB에 있는 값으로만 정한다 (고객이 보낸 금액은 쓰지 않는다).
      // 고객이 접수한 주문(self)은 접수할 때 금액이 정해졌다. 운영자가 넣은 주문은 여기서 쿠폰과 고유 코드를 붙인다.
      // 고객이 접수한 주문은 접수할 때 쿠폰이 이미 들어갔다. 이때 보낸 쿠폰은 보지 않는다.
      const vr = row.self ? { off: 0, code: '' } : await voucherFor(b.voucher, id);
      if (vr.err) return fail(vr.err, vr.err === NO_VOUCHER ? 400 : 409);
      const total = row.self ? row.total : X.payable(row.base, vr.off, id);
      // "아직 결제 전인 주문만"이라는 조건을 UPDATE 안에 둔다: 이미 제출된 주문이나 동시에 들어온 두 번째 요청은 바뀌는 줄이 0이다
      const OPEN = "pay IN ('unpaid', 'rejected')", STILL_OPEN = 'EXISTS (SELECT 1 FROM orders WHERE id = ? AND ' + OPEN + ')';
      const SUBMIT = "UPDATE orders SET total = ?, pay = 'pending', method = ?, proof_name = ? WHERE id = ? AND " + OPEN + " AND NOT (pay = 'rejected' AND " + VOUCHER_FULL_FOR + ')';
      let done, reserved = true;
      if (row.self) done = await db.prepare(SUBMIT).bind(total, methodName, proof, id, id).run();
      else {
        // 운영자가 넣은 주문: 쿠폰 기록을 바꾸는 것과 주문을 '확인 대기'로 바꾸는 것을 한 묶음(트랜잭션)으로 한다.
        // 따로 하면, 같은 제출이 동시에 두 번 왔을 때 진 쪽이 쿠폰 기록을 "되돌리다가" 이긴 쪽의 기록을 지웠다
        // (한 장짜리 쿠폰을 다른 주문이 또 쓸 수 있었다. 2026-11-13 QA). 두 문장 모두 아직 결제 전인 주문일 때만 바꾸므로 진 쪽은 아무것도 바꾸지 않는다.
        const LIMIT_OK = '(? = 0 OR (' + VOUCHER_USED + ') < ?)';
        const res = await db.batch(vr.code ? [
          db.prepare('INSERT OR REPLACE INTO voucher_uses (order_id, code) SELECT ?, ? WHERE ' + LIMIT_OK + ' AND ' + STILL_OPEN).bind(id, vr.code, vr.max, vr.code, id, vr.max, id),
          db.prepare(SUBMIT + ' AND ' + LIMIT_OK + ' AND EXISTS (SELECT 1 FROM voucher_uses WHERE order_id = ? AND code = ?)').bind(total, methodName, proof, id, id, vr.max, vr.code, id, vr.max, id, vr.code)
        ] : [
          db.prepare('DELETE FROM voucher_uses WHERE order_id = ? AND ' + STILL_OPEN).bind(id, id),
          db.prepare(SUBMIT + ' AND NOT EXISTS (SELECT 1 FROM voucher_uses WHERE order_id = ?)').bind(total, methodName, proof, id, id, id)
        ]);
        done = res[1]; reserved = !vr.code || !!res[0].meta.changes;
      }
      if (!done.meta.changes) {
        const now = await db.prepare('SELECT pay FROM orders WHERE id = ?').bind(id).first();
        if (now && (now.pay === 'unpaid' || now.pay === 'rejected')) {
          if (!reserved) return fail('This voucher has been used up.', 409);
          // 반려된 사이 이 주문의 쿠폰을 다른 주문이 다 썼다 (고객이 접수 때 쓴 쿠폰은 금액에 들어가 있어 다시 고를 수 없다)
          const full = now.pay === 'rejected' && await db.prepare('SELECT ' + VOUCHER_FULL_FOR + ' AS f').bind(id).first();
          if (full && full.f) return fail(VOUCHER_GONE_WHILE_REJECTED, 409);
        }
        return fail('This order has already been submitted.', 409);
      }
      await dropPublicCache();
      const saved = toOrder(Object.assign(row, { total, pay: 'pending', method: methodName, proof_name: proof }));
      saved.buyer = X.maskName(saved.buyer);
      return json({ order: saved });
    }

    /* ── 웹 푸시 알림 (server/push.js) ── */
    if (route === 'GET /push/key') return json({ key: Push.configured(env) ? env.VAPID_PUBLIC_KEY : '' });
    if (route === 'POST /push/subscribe') {
      const b = await readJson(request);
      if (!b) return fail('Bad request.');
      if (!Push.configured(env)) return fail('Notifications are not set up.', 503);
      if (await overLimit(db, env, request, 'push')) return fail('Too many requests. Try again later.', 429);
      const keys = b.keys && typeof b.keys === 'object' ? b.keys : {};
      if (!Push.endpointOk(b.endpoint, env) || !Push.keysOk(keys.p256dh, keys.auth)) return fail('Bad subscription.');
      const id = V.orderId(b.orderId), row = id && await db.prepare('SELECT 1 FROM orders WHERE id = ?').bind(id).first();
      if (!row) { await recordHit(db, request, 'look'); return fail('Order not found.', 404); }   // 틀린 번호는 조회처럼 센다
      await recordHit(db, request, 'push');
      if (await Push.orderFull(db, id, b.endpoint)) return fail('Too many devices on this order.', 409);
      if (!(await Push.subscribe(db, b.endpoint, keys.p256dh, keys.auth, V.oneOf(b.lang, ['id', 'en', 'ko']) || 'id', id))) return fail('Too many orders on this device.', 409);
      return json({ ok: true });
    }
    if (route === 'POST /push/unsubscribe') {
      const b = await readJson(request);
      if (!b || typeof b.endpoint !== 'string' || b.endpoint.length > 1000) return fail('Bad request.');
      const id = b.orderId == null || b.orderId === '' ? '' : V.orderId(b.orderId);
      if (id === null) return fail('Order not found.', 404);
      await Push.unsubscribe(db, b.endpoint, id);
      return json({ ok: true });
    }

    /* ── 관리자만 ── */
    if (path[0] === 'admin') {
      if (!(await isAdmin(request, env))) return fail('Admin sign-in required.', 401);
      const res = await adminRoute();
      if (method !== 'GET' && res.ok) await dropPublicCache();   // 관리자가 바꾼 내용이 고객 화면에 바로 보이도록
      return res;
    }

    return fail('Not found.', 404);
  } catch (e) {
    console.error(route, e && e.message);          // Cloudflare 로그에 남긴다
    if (/UNIQUE|constraint/i.test(String(e && e.message))) return fail('Already exists.', 409);
    return fail('Server error.', 500);
  }

  /* 쿠폰 코드 → { off, code } 또는 { err }. 코드를 안 적었으면 할인 0.
   * 한도가 있으면 지금까지 쓴 주문 수(지워진 주문·반려된 주문·이 주문 자신은 빼고)를 센다.
   * 같은 순간에 마지막 한 장을 두 주문이 쓰면 한도를 하나 넘길 수 있다(알려진 한계). */
  async function voucherFor(code, orderId) {
    if (code === '' || code == null) return { off: 0, code: '' };
    await purgeExpired(db, env);                   // 지울 때가 된 접수가 쓴 쿠폰을 먼저 돌려준다 (세기 전에)
    const c = typeof code === 'string' ? code.trim().toUpperCase() : '';
    const v = c && await db.prepare(VOUCHER_SELECT + ' WHERE v.code = ?').bind(orderId || '', c).first();
    if (!v) return { err: NO_VOUCHER };
    if (!X.voucherLeft(v, v.used)) return { err: 'This voucher has been used up.' };
    return { off: v.off, code: c, max: v.max };
  }

  async function adminRoute() {
    const sub = method + ' /' + path.slice(1, 2).join('/');
    let id = '';
    try { id = path[2] ? decodeURIComponent(path[2]) : ''; } catch (e) { return fail('Bad address.'); }   // 깨진 %형식
    if (path[1] === 'order' && id) id = V.orderId(id) || id;
    if (path[1] === 'voucher' && id) id = id.trim().toUpperCase();
    if (path[1] === 'proof' && id) id = V.orderId(id) || id;

    if (sub === 'GET /proof') {
      const p = await db.prepare('SELECT mime, data FROM proof_images WHERE order_id = ?').bind(id).first();
      if (!p) return fail('Not found.', 404);
      return new Response(fromBase64(p.data), { headers: { 'content-type': p.mime, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'content-disposition': 'inline' } });
    }                                               // 소문자로 적은 주문번호도 찾는다
    const b = method === 'GET' || method === 'DELETE' ? {} : await readJson(request);
    if (!b) return fail('Bad request.');

    if (sub === 'GET /state') { sendPush(); return json(await loadState(db, true, env)); }   // 남은 알림이 있으면 이어서 보낸다

    if (sub === 'POST /reset') {
      // 전체 주문을 지우는 기능이라, 켜 둔 곳(내 컴퓨터, 검사 환경)에서만 된다. 배포판에는 ALLOW_RESET 이 없다.
      if (!canReset(env)) return fail('Reset is disabled here.', 403);
      await seed(db); await logAct(db, request, 'reset', '');
      return json(await loadState(db, true, env));
    }

    if (sub === 'GET /log') {
      const rows = await db.prepare('SELECT at, ip, action, detail FROM audit ORDER BY id DESC LIMIT 200').all();
      return json({ log: rows.results });
    }

    if (sub === 'POST /batch') {
      const svc = V.text(b.svc, 20), no = V.int(b.no, 1, 9999), title = V.text(b.title, 80), month = V.month(b.month);
      const closeDate = V.date(b.closeDate), kurs = V.num(b.kurs, 0.0001, 1e6), note = V.optText(b.note, 300);
      if (!svc || no === null || !title || !month || closeDate === null || kurs === null || note === null) return fail('Check the batch fields.');
      if (!(await db.prepare('SELECT 1 FROM services WHERE id = ?').bind(svc).first())) return fail('Service not found.', 404);
      const bid = svc + '-' + no;
      if (await db.prepare('SELECT 1 FROM batches WHERE id = ?').bind(bid).first()) return fail('That batch number already exists.', 409);
      await db.prepare('INSERT INTO batches (id, svc, no, title, month, stage, close_date, kurs, note) VALUES (?,?,?,?,?,0,?,?,?)').bind(bid, svc, no, title, month, closeDate, kurs, note).run();
      await logAct(db, request, 'batch.add', bid + ' ' + title);
      return json({ id: bid });
    }
    if (sub === 'PATCH /batch') {
      const sets = [], vals = [];
      if ('stage' in b) { const v = V.int(b.stage, 0, GO.LAST_STAGE); if (v === null) return fail('Bad stage.'); sets.push('stage = ?'); vals.push(v); }
      if ('note' in b) { const v = V.optText(b.note, 300); if (v === null) return fail('Note is too long.'); sets.push('note = ?'); vals.push(v); }
      if (!sets.length) return fail('Nothing to change.');
      const old = 'stage' in b ? await db.prepare('SELECT stage FROM batches WHERE id = ?').bind(id).first() : null;
      const r = await db.prepare('UPDATE batches SET ' + sets.join(', ') + ' WHERE id = ?').bind(...vals, id).run();
      if (!r.meta.changes) return fail('Batch not found.', 404);
      await logAct(db, request, 'batch.update', id + ' ' + JSON.stringify(b));
      // 단계가 앞으로 나아갔을 때만 알린다 (잘못 눌러 뒤로 돌린 것은 알리지 않는다)
      let queued = 0;
      if (old && vals[0] > old.stage) { queued = await Push.queueStage(db, id, vals[0]); if (queued) sendPush(); }
      return json({ ok: true, notified: queued });
    }
    if (sub === 'DELETE /batch') {
      const gone = await db.batch([
        db.prepare(Push.UNLINK_BATCH).bind(id),                                                        // 알림 신청 연결 (주문보다 먼저)
        db.prepare('DELETE FROM order_flags WHERE order_id IN (SELECT id FROM orders WHERE batch_id = ?)').bind(id),
        db.prepare('DELETE FROM voucher_uses WHERE order_id IN (SELECT id FROM orders WHERE batch_id = ?)').bind(id),
        db.prepare('DELETE FROM order_payer WHERE order_id IN (SELECT id FROM orders WHERE batch_id = ?)').bind(id),
        db.prepare('DELETE FROM proof_images WHERE order_id IN (SELECT id FROM orders WHERE batch_id = ?)').bind(id),
        db.prepare('DELETE FROM orders WHERE batch_id = ?').bind(id),
        db.prepare('DELETE FROM batches WHERE id = ?').bind(id),
        db.prepare(Push.DROP_LONELY_SUBS)
      ]);
      if (!gone[6].meta.changes) return fail('Batch not found.', 404);     // 없는 배치: 지운 것이 없으니 기록하지 않는다
      await logAct(db, request, 'batch.delete', id);
      return json({ ok: true });
    }

    if (sub === 'POST /order') {
      const oid = V.orderId(b.id), buyer = V.text(typeof b.buyer === 'string' ? b.buyer.trim().replace(/^@/, '') : null, GO.LIMITS.buyer), item = V.text(b.item, GO.LIMITS.item);
      const qty = V.int(b.qty, 1, GO.LIMITS.qty), total = V.int(b.total, 1, GO.LIMITS.amount);
      if (!oid || !buyer || !item || qty === null || total === null) return fail('Check the order fields.');
      if (!(await db.prepare('SELECT 1 FROM batches WHERE id = ?').bind(String(b.batchId || '')).first())) return fail('Batch not found.', 404);
      if (await db.prepare('SELECT 1 FROM orders WHERE id = ?').bind(oid).first()) return fail('Order number is taken.', 409);
      await db.prepare("INSERT INTO orders (id, batch_id, buyer, item, qty, base, total, pay, method, proof_name, created_at) VALUES (?,?,?,?,?,?,?,'unpaid','','',?)")
        .bind(oid, b.batchId, buyer, item, qty, total, total, new Date().toISOString()).run();
      await logAct(db, request, 'order.add', oid + ' ' + b.batchId);
      return json({ id: oid });
    }
    if (sub === 'PATCH /order') {
      const pay = V.oneOf(b.pay, PAY);
      if (!pay) return fail('Bad payment status.');
      const payer = 'payer' in b ? V.optText(b.payer, GO.LIMITS.payer) : undefined;   // 승인할 때 운영자가 적는 입금자 이름
      if (payer === null) return fail('Check the order fields.');
      if (pay === 'unpaid') {
        // 증빙을 낸 적 없는 고객 접수가 지울 때를 넘겼으면 미결제로 되돌리지 않는다: 되돌리는 순간 자동으로 지워진다. 반려하거나 삭제하게 한다.
        const row = await db.prepare(ORDER_SELECT + ' WHERE o.id = ?').bind(id).first();
        if (row && !canUnpay(toOrder(row), env)) return fail('This order is past its payment deadline. Reject or delete it instead.', 409);
      }
      // 반려된 주문을 되살릴 때: 그 사이 쿠폰 한도가 찼으면 바꾸지 않는다 (확인과 변경을 한 문장으로)
      const r = await db.prepare("UPDATE orders SET pay = ? WHERE id = ? AND NOT (pay = 'rejected' AND ? != 'rejected' AND " + VOUCHER_FULL_FOR + ')').bind(pay, id, pay, id).run();
      if (!r.meta.changes) {
        if (await db.prepare('SELECT 1 FROM orders WHERE id = ?').bind(id).first()) return fail(VOUCHER_GONE_WHILE_REJECTED, 409);
        return fail('Order not found.', 404);
      }
      if (payer !== undefined) await (payer ? db.prepare('INSERT OR REPLACE INTO order_payer (order_id, name) VALUES (?, ?)').bind(id, payer) : db.prepare('DELETE FROM order_payer WHERE order_id = ?').bind(id)).run();
      await logAct(db, request, 'order.pay', id + ' ' + pay);
      return json({ ok: true });
    }
    if (sub === 'DELETE /order') {
      const gone = await db.batch([db.prepare('DELETE FROM order_flags WHERE order_id = ?').bind(id), db.prepare('DELETE FROM orders WHERE id = ?').bind(id),
        db.prepare('DELETE FROM voucher_uses WHERE order_id = ?').bind(id), db.prepare('DELETE FROM order_payer WHERE order_id = ?').bind(id),
        db.prepare('DELETE FROM proof_images WHERE order_id = ?').bind(id), db.prepare(Push.UNLINK_ORDER).bind(id), db.prepare(Push.DROP_LONELY_SUBS)]);   // 쓴 쿠폰을 돌려준다
      if (!gone[1].meta.changes) return fail('Order not found.', 404);     // 없는 주문
      await logAct(db, request, 'order.delete', id);
      return json({ ok: true });
    }

    if (sub === 'POST /voucher' && path[2] === 'bulk') {   // 주소 그대로 본다 (쿠폰 코드처럼 대문자로 바꾸기 전)
      // 한 장짜리 쿠폰 여러 장: 같은 할인액, 한 번만 쓸 수 있다. 코드는 서버가 뽑는다(운영자가 한 장씩 고객에게 건넨다).
      const off = V.int(b.off, 1, GO.LIMITS.amount), count = V.int(b.count, 1, GO.LIMITS.voucherBulk), note = V.optText(b.note, GO.LIMITS.note);
      if (off === null || count === null || note === null) return fail('Check the voucher fields.');
      const codes = [];
      for (let tries = 0; codes.length < count && tries < count * 5; tries++) {
        const c = X.voucherCodeFrom(crypto.getRandomValues(new Uint8Array(6)));
        if (codes.includes(c) || await db.prepare('SELECT 1 FROM vouchers WHERE code = ?').bind(c).first()) continue;
        codes.push(c);
      }
      const stmts = [];
      codes.forEach(c => stmts.push(
        db.prepare('INSERT INTO vouchers (code, off) VALUES (?, ?)').bind(c, off),
        db.prepare('INSERT OR REPLACE INTO voucher_limits (code, max_uses) VALUES (?, 1)').bind(c),
        db.prepare('INSERT OR REPLACE INTO voucher_notes (code, note) VALUES (?, ?)').bind(c, note),
        db.prepare('DELETE FROM voucher_uses WHERE code = ?').bind(c)
      ));
      await db.batch(stmts);
      await logAct(db, request, 'voucher.bulk', codes.length + ' x ' + off + (note ? ' ' + note : ''));
      return json({ codes });
    }
    if (sub === 'PATCH /voucher') {
      const note = V.optText(b.note, GO.LIMITS.note);
      if (note === null) return fail('Check the voucher fields.');
      if (!(await db.prepare('SELECT 1 FROM vouchers WHERE code = ?').bind(id).first())) return fail(NO_VOUCHER, 404);
      await db.prepare('INSERT OR REPLACE INTO voucher_notes (code, note) VALUES (?, ?)').bind(id, note).run();
      await logAct(db, request, 'voucher.note', id);
      return json({ ok: true });
    }
    if (sub === 'POST /voucher') {
      const code = V.voucherCode(b.code), off = V.int(b.off, 1, GO.LIMITS.amount), max = b.max === '' || b.max == null ? 0 : V.int(b.max, 0, GO.LIMITS.voucherUses);
      if (!code || off === null || max === null) return fail('Check the voucher fields.');
      if (await db.prepare('SELECT 1 FROM vouchers WHERE code = ?').bind(code).first()) return fail('That voucher code already exists.', 409);
      await db.batch([
        db.prepare('INSERT INTO vouchers (code, off) VALUES (?, ?)').bind(code, off),
        db.prepare('INSERT OR REPLACE INTO voucher_limits (code, max_uses) VALUES (?, ?)').bind(code, max),
        db.prepare('DELETE FROM voucher_uses WHERE code = ?').bind(code)        // 같은 코드를 다시 만들면 사용 횟수는 0부터
      ]);
      await logAct(db, request, 'voucher.add', code + ' ' + off + (max ? ' max ' + max : ''));
      return json({ code, off, max, used: 0 });
    }
    if (sub === 'DELETE /voucher') {
      const gone = await db.batch([
        db.prepare('DELETE FROM vouchers WHERE code = ?').bind(id),
        db.prepare('DELETE FROM voucher_limits WHERE code = ?').bind(id),
        db.prepare('DELETE FROM voucher_notes WHERE code = ?').bind(id),
        db.prepare('DELETE FROM voucher_uses WHERE code = ?').bind(id)        // 이미 쓴 주문의 할인은 그대로 남는다(금액에 들어가 있다)
      ]);
      if (!gone[0].meta.changes) return fail(NO_VOUCHER, 404);
      await logAct(db, request, 'voucher.delete', id);
      return json({ ok: true });
    }

    if (sub === 'POST /service' || sub === 'PATCH /service') {
      const sid = sub === 'POST /service' ? V.svcId(b.id) : id;
      const f = { nameId: V.text(b.nameId, GO.LIMITS.svcName), nameKo: V.text(b.nameKo, GO.LIMITS.svcName), descId: V.optText(b.descId, GO.LIMITS.svcDesc), descKo: V.optText(b.descKo, GO.LIMITS.svcDesc), cur: V.oneOf(b.cur, Object.keys(GO.CURRENCIES)) };
      if (!sid || !f.nameId || !f.nameKo || f.descId === null || f.descKo === null || !f.cur) return fail('Check the service fields.');
      if (sub === 'POST /service') {
        if (await db.prepare('SELECT 1 FROM services WHERE id = ?').bind(sid).first()) return fail('That service code already exists.', 409);
        const last = await db.prepare('SELECT IFNULL(MAX(sort), -1) AS m FROM services').first();
        await db.prepare('INSERT INTO services (id, name_id, name_ko, desc_id, desc_ko, cur, sort) VALUES (?,?,?,?,?,?,?)').bind(sid, f.nameId, f.nameKo, f.descId, f.descKo, f.cur, last.m + 1).run();
        await logAct(db, request, 'service.add', sid + ' ' + f.nameId);
      } else {
        const r = await db.prepare('UPDATE services SET name_id = ?, name_ko = ?, desc_id = ?, desc_ko = ?, cur = ? WHERE id = ?').bind(f.nameId, f.nameKo, f.descId, f.descKo, f.cur, sid).run();
        if (!r.meta.changes) return fail('Service not found.', 404);
        await logAct(db, request, 'service.update', sid + ' ' + f.nameId);
      }
      // 고객 화면에 보이기/숨기기 (보내지 않으면 그대로 둔다)
      let hidden = false;
      if (typeof b.hidden === 'boolean') {
        await db.prepare(b.hidden ? 'INSERT OR IGNORE INTO service_hidden (svc_id) VALUES (?)' : 'DELETE FROM service_hidden WHERE svc_id = ?').bind(sid).run();
        hidden = b.hidden;
        await logAct(db, request, 'service.' + (b.hidden ? 'hide' : 'show'), sid);
      } else hidden = !!(await db.prepare('SELECT 1 FROM service_hidden WHERE svc_id = ?').bind(sid).first());
      return json({ service: toService({ id: sid, name_id: f.nameId, name_ko: f.nameKo, desc_id: f.descId, desc_ko: f.descKo, cur: f.cur, hidden: hidden ? 1 : 0 }) });
    }
    if (sub === 'DELETE /service') {
      // 배치가 남아 있는 서비스는 지우지 않는다(배치와 그 주문이 갈 곳이 없어진다)
      if (await db.prepare('SELECT 1 FROM batches WHERE svc = ? LIMIT 1').bind(id).first()) return fail('This service still has batches.', 409);
      const r = (await db.batch([db.prepare('DELETE FROM services WHERE id = ?').bind(id), db.prepare('DELETE FROM service_hidden WHERE svc_id = ?').bind(id)]))[0];
      if (!r.meta.changes) return fail('Service not found.', 404);
      await logAct(db, request, 'service.delete', id);
      return json({ ok: true });
    }

    if (sub === 'PUT /calc') {
      const rule = r => r && V.oneOf(r.mode, ['pct', 'nom', 'mul']) && V.num(r.val, 0, 1e9) !== null;
      if (!V.oneOf(b.cur, Object.keys(GO.CURRENCIES)) || V.num(b.kurs, 0, 1e6) === null || !rule(b.feeGo) || !rule(b.feeCo) || !rule(b.tax) || !V.oneOf(b.tax.base, ['conv', 'convfee'])) return fail('Check the calculator fields.');
      const clean = { cur: b.cur, kurs: Number(b.kurs), price: Number(b.price) || 0, qty: Math.max(1, Number(b.qty) || 1),
        feeGo: { mode: b.feeGo.mode, val: Number(b.feeGo.val) }, feeCo: { mode: b.feeCo.mode, val: Number(b.feeCo.val) },
        tax: { mode: b.tax.mode, val: Number(b.tax.val), base: b.tax.base }, extra: Number(b.extra) || 0 };
      await db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind('calcDefaults', JSON.stringify(clean)).run();
      await logAct(db, request, 'calc', '');
      return json({ ok: true });
    }

    return fail('Not found.', 404);
  }
}
