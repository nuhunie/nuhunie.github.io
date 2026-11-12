/* API 한 파일 라우터 (Cloudflare Pages Functions).  /api/... 로 오는 모든 요청이 여기로 온다.
 *
 * 누구나
 *   GET  /api/public           서비스·배치·가린 주문 목록
 *   GET  /api/track?q=         주문번호 또는 아이디로 조회
 *   GET  /api/order?id=        주문 한 건 (결제 화면 불러오기)
 *   POST /api/voucher          쿠폰 확인
 *   POST /api/pay              결제 증빙 제출 → 확인 대기
 *   GET  /api/me               관리자 로그인 여부
 *   POST /api/login, /api/logout
 * 관리자만 (/api/admin/...)
 *   GET  state                 전체 상태
 *   POST batch · PATCH batch/:id · DELETE batch/:id
 *   POST order · PATCH order/:id · DELETE order/:id
 *   PUT  calc                  계산기 기본 수식
 *   POST reset                 예시 데이터로 초기화
 */
import { GO, X, V, PAY, json, fail, readJson, isAdmin, configured, passwordOk, sessionCookie, clearCookie, loadState, seed, toOrder } from '../../server/lib.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function onRequest({ request, env, params }) {
  const db = env.DB;
  if (!db) return fail('Database is not connected.', 500);
  const path = [].concat(params.path || []);
  const method = request.method;
  const route = method + ' /' + path.join('/');
  const url = new URL(request.url);

  try {
    /* ── 누구나 ── */
    if (route === 'GET /public') return json(await loadState(db, false));

    if (route === 'GET /me') return json({ admin: await isAdmin(request, env), configured: configured(env) });

    if (route === 'POST /login') {
      const b = await readJson(request);
      if (!configured(env)) return fail('Admin login is not set up yet.', 503);
      if (!b || !(await passwordOk(env, b.password))) { await sleep(400); return fail('Wrong password.', 401); }
      return json({ admin: true }, 200, { 'set-cookie': await sessionCookie(env, request) });
    }
    if (route === 'POST /logout') return json({ admin: false }, 200, { 'set-cookie': clearCookie });

    if (route === 'GET /track') {
      const q = (url.searchParams.get('q') || '').trim().toLowerCase().replace(/^@/, '');
      if (q.length < 2 || q.length > 40) return json({ orders: [] });
      // 주문번호는 일부만 맞아도, 아이디는 전체가 맞아야 찾는다 (logic.searchOrders와 같은 규칙)
      const rows = await db.prepare("SELECT * FROM orders WHERE instr(lower(id), ?1) > 0 OR lower(buyer) = ?1 ORDER BY created_at, id LIMIT 50").bind(q).all();
      return json({ orders: rows.results.map(toOrder).map(o => Object.assign(o, { buyer: X.maskName(o.buyer), proofName: '' })) });
    }

    if (route === 'GET /order') {
      const id = V.orderId(url.searchParams.get('id'));
      const row = id && await db.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first();
      if (!row) return fail('Order not found.', 404);
      const o = toOrder(row); o.proofName = '';
      return json({ order: o });
    }

    if (route === 'POST /voucher') {
      const b = await readJson(request), code = b && V.text(String(b.code || '').toUpperCase(), 30);
      const v = code && await db.prepare('SELECT * FROM vouchers WHERE code = ?').bind(code).first();
      return v ? json({ code: v.code, off: v.off }) : fail('Voucher not found.', 404);
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
      const payable = (base, id) => base - Math.min(off, base) + X.uniqueCode(id);

      if (b.orderId) {                               // 이미 있는 주문을 결제
        const id = V.orderId(b.orderId), row = id && await db.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first();
        if (!row) return fail('Order not found.', 404);
        if (row.pay !== 'unpaid' && row.pay !== 'rejected') return fail('This order has already been submitted.', 409);
        const total = payable(row.base, id);
        await db.prepare("UPDATE orders SET total = ?, pay = 'pending', method = ?, proof_name = ? WHERE id = ?").bind(total, methodName, proof, id).run();
        return json({ order: toOrder(Object.assign(row, { total, pay: 'pending', method: methodName, proof_name: proof })) });
      }
      // 새 주문. 고객이 QR로 낸 금액과 같아야 하므로 화면이 미리 정한 주문번호를 그대로 쓴다.
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
      return json({ order: { id, batchId: batch.id, buyer, item, qty, base, total, pay: 'pending', method: methodName, proofName: proof, createdAt: now } });
    }

    /* ── 관리자만 ── */
    if (path[0] === 'admin') {
      if (!(await isAdmin(request, env))) return fail('Admin sign-in required.', 401);
      const sub = method + ' /' + path.slice(1, 2).join('/'), id = path[2] ? decodeURIComponent(path[2]) : '';
      const b = method === 'GET' || method === 'DELETE' ? {} : await readJson(request);
      if (!b) return fail('Bad request.');

      if (sub === 'GET /state') return json(await loadState(db, true));

      if (sub === 'POST /reset') { await seed(db); return json(await loadState(db, true)); }

      if (sub === 'POST /batch') {
        const svc = V.text(b.svc, 20), no = V.int(b.no, 1, 9999), title = V.text(b.title, 80), month = V.month(b.month);
        const closeDate = V.date(b.closeDate), kurs = V.num(b.kurs, 0.0001, 1e6), note = V.optText(b.note, 300);
        if (!svc || no === null || !title || !month || closeDate === null || kurs === null || note === null) return fail('Check the batch fields.');
        if (!(await db.prepare('SELECT 1 FROM services WHERE id = ?').bind(svc).first())) return fail('Service not found.', 404);
        const bid = svc + '-' + no;
        if (await db.prepare('SELECT 1 FROM batches WHERE id = ?').bind(bid).first()) return fail('That batch number already exists.', 409);
        await db.prepare('INSERT INTO batches (id, svc, no, title, month, stage, close_date, kurs, note) VALUES (?,?,?,?,?,0,?,?,?)').bind(bid, svc, no, title, month, closeDate, kurs, note).run();
        return json({ id: bid });
      }
      if (sub === 'PATCH /batch') {
        const sets = [], vals = [];
        if ('stage' in b) { const v = V.int(b.stage, 0, GO.LAST_STAGE); if (v === null) return fail('Bad stage.'); sets.push('stage = ?'); vals.push(v); }
        if ('note' in b) { const v = V.optText(b.note, 300); if (v === null) return fail('Note is too long.'); sets.push('note = ?'); vals.push(v); }
        if (!sets.length) return fail('Nothing to change.');
        const r = await db.prepare('UPDATE batches SET ' + sets.join(', ') + ' WHERE id = ?').bind(...vals, id).run();
        return r.meta.changes ? json({ ok: true }) : fail('Batch not found.', 404);
      }
      if (sub === 'DELETE /batch') {
        await db.batch([db.prepare('DELETE FROM orders WHERE batch_id = ?').bind(id), db.prepare('DELETE FROM batches WHERE id = ?').bind(id)]);
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
        return json({ id: oid });
      }
      if (sub === 'PATCH /order') {
        const pay = V.oneOf(b.pay, PAY);
        if (!pay) return fail('Bad payment status.');
        const r = await db.prepare('UPDATE orders SET pay = ? WHERE id = ?').bind(pay, id).run();
        return r.meta.changes ? json({ ok: true }) : fail('Order not found.', 404);
      }
      if (sub === 'DELETE /order') {
        await db.prepare('DELETE FROM orders WHERE id = ?').bind(id).run();
        return json({ ok: true });
      }

      if (sub === 'PUT /calc') {
        const rule = r => r && V.oneOf(r.mode, ['pct', 'nom', 'mul']) && V.num(r.val, 0, 1e9) !== null;
        if (!V.oneOf(b.cur, Object.keys(GO.CURRENCIES)) || V.num(b.kurs, 0, 1e6) === null || !rule(b.feeGo) || !rule(b.feeCo) || !rule(b.tax) || !V.oneOf(b.tax.base, ['conv', 'convfee'])) return fail('Check the calculator fields.');
        const clean = { cur: b.cur, kurs: Number(b.kurs), price: Number(b.price) || 0, qty: Math.max(1, Number(b.qty) || 1),
          feeGo: { mode: b.feeGo.mode, val: Number(b.feeGo.val) }, feeCo: { mode: b.feeCo.mode, val: Number(b.feeCo.val) },
          tax: { mode: b.tax.mode, val: Number(b.tax.val), base: b.tax.base }, extra: Number(b.extra) || 0 };
        await db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind('calcDefaults', JSON.stringify(clean)).run();
        return json({ ok: true });
      }
    }

    return fail('Not found.', 404);
  } catch (e) {
    return fail('Server error.', 500);
  }
}
