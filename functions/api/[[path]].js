/* API 한 파일 라우터 (Cloudflare Pages Functions).  /api/... 로 오는 모든 요청이 여기로 온다.
 *
 * 누구나
 *   GET  /api/public           서비스·배치와 배치별 수량 (주문·이름·금액은 싣지 않는다). 10초 동안 저장해 두고 돌려준다
 *   GET  /api/batch-items?id=  배치 하나의 품목별 수량
 *   GET  /api/track?q=         주문번호로 내 주문 조회
 *   GET  /api/order?id=        주문 한 건 (결제 화면 불러오기)
 *   POST /api/voucher          쿠폰 확인
 *   POST /api/amount-check     이 결제 금액을 확인 대기 중인 다른 주문이 쓰고 있는지
 *   POST /api/pay              결제 증빙 제출 → 확인 대기
 *   GET  /api/me               관리자 로그인 여부
 *   POST /api/login, /api/logout
 * 관리자만 (/api/admin/...)
 *   GET  state                 전체 상태
 *   POST batch · PATCH batch/:id · DELETE batch/:id
 *   POST order · PATCH order/:id · DELETE order/:id
 *   PUT  calc                  계산기 기본 수식
 *   POST reset                 예시 데이터로 초기화 (ALLOW_RESET=1 인 곳에서만. 배포판에는 꺼져 있다)
 *   GET  log                   활동 기록
 */
import { GO, X, V, PAY, json, fail, readJson, isAdmin, configured, passwordOk, startSession, endSession, clearCookie, loadState, seed, toOrder, overLimit, recordHit, logAct } from '../../server/lib.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const PUBLIC_CACHE_SEC = 10;

export async function onRequest({ request, env, params }) {
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

  try {
    /* ── 누구나 ── */
    if (route === 'GET /public') {
      const hit = await caches.default.match(publicKey);
      if (hit) return hit;
      const res = json(await loadState(db, false), 200, { 'cache-control': 'public, max-age=' + PUBLIC_CACHE_SEC });
      await caches.default.put(publicKey, res.clone()).catch(() => {});
      return res;
    }

    if (route === 'GET /batch-items') {
      const rows = await db.prepare('SELECT item, SUM(qty) AS qty FROM orders WHERE batch_id = ? GROUP BY item ORDER BY qty DESC, item LIMIT 500').bind(url.searchParams.get('id') || '').all();
      return json({ items: rows.results });
    }

    if (route === 'GET /me') return json({ admin: await isAdmin(request, env), configured: configured(env), canReset: env.ALLOW_RESET === '1' });

    if (route === 'POST /login') {
      const b = await readJson(request);
      if (!configured(env)) return fail('Admin login is not set up yet.', 503);
      // 잠긴 동안은 맞는 비밀번호도 받지 않는다. 한 곳에서 5번, 또는 어디서든 합쳐 40번 틀리면 잠긴다.
      if (await overLimit(db, env, request, 'login') || await overLimit(db, env, request, 'loginAll')) return fail('Too many attempts. Try again later.', 429);
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
      const row = await db.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first();
      if (!row) { await recordHit(db, request, 'look'); return json({ orders: [] }); }
      return json({ orders: [Object.assign(toOrder(row), { buyer: X.maskName(row.buyer), proofName: '' })] });
    }

    if (route === 'GET /order') {
      const id = V.orderId(url.searchParams.get('id'));
      if (!id) return fail('Order not found.', 404);
      if (await overLimit(db, env, request, 'look')) return fail('Too many requests. Try again later.', 429);
      const row = await db.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first();
      if (!row) { await recordHit(db, request, 'look'); return fail('Order not found.', 404); }
      const o = toOrder(row); o.proofName = ''; o.buyer = X.maskName(o.buyer);
      return json({ order: o });
    }

    if (route === 'POST /voucher') {
      const b = await readJson(request), code = b && V.text(String(b.code || '').toUpperCase(), 30);
      if (await overLimit(db, env, request, 'look')) return fail('Too many requests. Try again later.', 429);
      const v = code && await db.prepare('SELECT * FROM vouchers WHERE code = ?').bind(code).first();
      if (!v) { await recordHit(db, request, 'look'); return fail('Voucher not found.', 404); }
      return json({ code: v.code, off: v.off });
    }

    if (route === 'POST /amount-check') {
      // 결제 금액이 같으면 운영자가 입금을 구분할 수 없다. 화면은 금액을 보여 주기 전에 여기에 묻고,
      // 이미 쓰이는 금액이면 주문번호를 새로 뽑아 고유 코드를 바꾼다.
      const b = await readJson(request), total = b && V.int(b.total, 1, 2e9);
      if (total === null || !b) return fail('Bad request.');
      const taken = await db.prepare("SELECT 1 FROM orders WHERE pay = 'pending' AND total = ? LIMIT 1").bind(total).first();
      return json({ free: !taken });
    }

    if (route === 'POST /pay') {
      const b = await readJson(request);
      if (!b) return fail('Bad request.');
      const methodName = V.oneOf(b.method, ['QRIS', 'Transfer bank']), proof = V.text(b.proofName, 200);
      if (!methodName || !proof) return fail('Payment method and proof are required.');
      let off = 0;
      if (b.voucher) {
        const v = await db.prepare('SELECT off FROM vouchers WHERE code = ?').bind(String(b.voucher).trim().toUpperCase()).first();
        if (!v) return fail('Voucher not found.');
        off = v.off;
      }
      const payable = (base, id) => base - Math.min(off, base) + X.uniqueCode(id);   // 쿠폰이 금액보다 커도 0 아래로 내려가지 않는다

      if (b.orderId) {                               // 이미 있는 주문을 결제
        const id = V.orderId(b.orderId), row = id && await db.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first();
        if (!row) return fail('Order not found.', 404);
        const total = payable(row.base, id);         // 금액은 DB에 있는 주문 금액으로만 계산한다 (고객이 보낸 값은 쓰지 않는다)
        // "아직 결제 전인 주문만"이라는 조건을 UPDATE 안에 둔다: 이미 제출된 주문이나 동시에 들어온 두 번째 요청은 바뀌는 줄이 0이다
        const done = await db.prepare("UPDATE orders SET total = ?, pay = 'pending', method = ?, proof_name = ? WHERE id = ? AND pay IN ('unpaid', 'rejected')").bind(total, methodName, proof, id).run();
        if (!done.meta.changes) return fail('This order has already been submitted.', 409);
        await dropPublicCache();
        const saved = toOrder(Object.assign(row, { total, pay: 'pending', method: methodName, proof_name: proof }));
        saved.buyer = X.maskName(saved.buyer);
        return json({ order: saved });
      }
      // 새 주문. 고객이 QR로 낸 금액과 같아야 하므로 화면이 미리 정한 주문번호를 그대로 쓴다.
      if (await overLimit(db, env, request, 'pay')) return fail('Too many new orders from here. Try again later.', 429);
      const id = V.orderId(b.id), buyer = V.text(String(b.buyer || '').replace(/^@/, ''), 40), item = V.text(b.item, 120);
      const qty = V.int(b.qty, 1, 999), base = V.int(b.base, 1, 1e9);
      if (!id || !buyer || !item || qty === null || base === null) return fail('Buyer, item, quantity and total are required.');
      const batch = await db.prepare('SELECT id, stage FROM batches WHERE id = ?').bind(String(b.batchId || '')).first();
      if (!batch) return fail('Batch not found.', 404);
      if (batch.stage === GO.LAST_STAGE) return fail('This batch is already completed.', 409);
      if (await db.prepare('SELECT 1 FROM orders WHERE id = ?').bind(id).first()) return fail('Order number is taken. Reload and try again.', 409);
      const total = payable(base, id), now = new Date().toISOString();
      await db.prepare("INSERT INTO orders (id, batch_id, buyer, item, qty, base, total, pay, method, proof_name, created_at) VALUES (?,?,?,?,?,?,?,'pending',?,?,?)")
        .bind(id, batch.id, buyer, item, qty, base, total, methodName, proof, now).run();
      await recordHit(db, request, 'pay');
      await dropPublicCache();
      return json({ order: { id, batchId: batch.id, buyer, item, qty, base, total, pay: 'pending', method: methodName, proofName: proof, createdAt: now } });
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

  async function adminRoute() {
    const sub = method + ' /' + path.slice(1, 2).join('/');
    let id = '';
    try { id = path[2] ? decodeURIComponent(path[2]) : ''; } catch (e) { return fail('Bad address.'); }   // 깨진 %형식
    const b = method === 'GET' || method === 'DELETE' ? {} : await readJson(request);
    if (!b) return fail('Bad request.');

    if (sub === 'GET /state') return json(await loadState(db, true));

    if (sub === 'POST /reset') {
      // 전체 주문을 지우는 기능이라, 켜 둔 곳(내 컴퓨터, 검사 환경)에서만 된다. 배포판에는 ALLOW_RESET 이 없다.
      if (env.ALLOW_RESET !== '1') return fail('Reset is disabled here.', 403);
      await seed(db); await logAct(db, request, 'reset', '');
      return json(await loadState(db, true));
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
      const r = await db.prepare('UPDATE batches SET ' + sets.join(', ') + ' WHERE id = ?').bind(...vals, id).run();
      if (!r.meta.changes) return fail('Batch not found.', 404);
      await logAct(db, request, 'batch.update', id + ' ' + JSON.stringify(b));
      return json({ ok: true });
    }
    if (sub === 'DELETE /batch') {
      await db.batch([db.prepare('DELETE FROM orders WHERE batch_id = ?').bind(id), db.prepare('DELETE FROM batches WHERE id = ?').bind(id)]);
      await logAct(db, request, 'batch.delete', id);
      return json({ ok: true });
    }

    if (sub === 'POST /order') {
      const oid = V.orderId(b.id), buyer = V.text(String(b.buyer || '').replace(/^@/, ''), 40), item = V.text(b.item, 120);
      const qty = V.int(b.qty, 1, 999), total = V.int(b.total, 1, 1e9);
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
      const r = await db.prepare('UPDATE orders SET pay = ? WHERE id = ?').bind(pay, id).run();
      if (!r.meta.changes) return fail('Order not found.', 404);
      await logAct(db, request, 'order.pay', id + ' ' + pay);
      return json({ ok: true });
    }
    if (sub === 'DELETE /order') {
      await db.prepare('DELETE FROM orders WHERE id = ?').bind(id).run();
      await logAct(db, request, 'order.delete', id);
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
