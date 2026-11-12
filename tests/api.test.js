// 서버 API 검사. 내 컴퓨터에서 띄운 서버를 대상으로 한다 (배포된 사이트에는 돌리지 않는다: 데이터를 초기화한다).
//   1) npm run setup   (처음 한 번)
//   2) npm run dev
//   3) npm run test:server
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
global.window = global;
require('../site/js/data.js');
require('../site/js/logic.js');
const X = GO.logic;

const BASE = process.env.BASE || 'http://localhost:8788';
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) throw new Error('이 검사는 내 컴퓨터의 서버에만 돌린다: ' + BASE);
// 시험용 관리자 비밀번호는 .dev.vars에서 읽는다 (내 컴퓨터 전용 값)
const vars = Object.fromEntries(fs.readFileSync(path.join(__dirname, '..', '.dev.vars'), 'utf8').split(/\r?\n/).filter(l => l && l[0] !== '#').map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));

let cookie = '';
async function call(method, p, body, withCookie) {
  const res = await fetch(BASE + '/api' + p, { method, headers: Object.assign(body ? { 'content-type': 'application/json' } : {}, withCookie && cookie ? { cookie } : {}), body: body ? JSON.stringify(body) : undefined });
  const set = res.headers.get('set-cookie');
  return { status: res.status, json: await res.json().catch(() => ({})), set };
}
const admin = (m, p, b) => call(m, p, b, true);

test('로그인 전에는 관리자 API가 모두 막혀 있다', async () => {
  for (const [m, p] of [['GET', '/admin/state'], ['POST', '/admin/reset'], ['POST', '/admin/batch'], ['PATCH', '/admin/batch/kr-5'], ['DELETE', '/admin/batch/kr-5'], ['POST', '/admin/order'], ['PATCH', '/admin/order/NUH-100101'], ['DELETE', '/admin/order/NUH-100101'], ['PUT', '/admin/calc'], ['GET', '/admin/log']]) {
    assert.equal((await call(m, p, m === 'GET' || m === 'DELETE' ? undefined : {})).status, 401, m + ' ' + p);
  }
  assert.equal((await call('GET', '/me')).json.admin, false);
});
test('틀린 비밀번호, 위조한 쿠키로는 들어갈 수 없다', async () => {
  assert.equal((await call('POST', '/login', { password: 'wrong' })).status, 401);
  assert.equal((await call('POST', '/login', {})).status, 401);
  cookie = 'sid=' + (Date.now() + 1e7) + '.' + 'a'.repeat(64);
  assert.equal((await admin('GET', '/admin/state')).status, 401);
  cookie = '';
});
test('맞는 비밀번호로 로그인하면 HttpOnly 쿠키를 받는다', async () => {
  const r = await call('POST', '/login', { password: vars.ADMIN_PASSWORD });
  assert.equal(r.status, 200);
  assert.match(r.set, /^sid=\d+\.[0-9a-f]{64};/);
  assert.match(r.set, /HttpOnly/); assert.match(r.set, /SameSite=Strict/);
  cookie = r.set.split(';')[0];
  assert.equal((await admin('GET', '/me')).json.admin, true);
});
test('초기화하면 예시 데이터와 같다', async () => {
  const r = await admin('POST', '/admin/reset'), seed = GO.seed();
  assert.equal(r.status, 200);
  assert.equal(r.json.orders.length, seed.orders.length);
  assert.equal(r.json.batches.length, seed.batches.length);
  assert.deepEqual(r.json.calcDefaults, seed.calcDefaults);
});

test('공개 목록에는 배치의 단계와 수량만 있다. 주문·이름·금액·결제 상태는 없다', async () => {
  const r = await call('GET', '/public'), seed = GO.seed();
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.json).sort(), ['batches', 'services']);
  const text = JSON.stringify(r.json);
  seed.orders.forEach(o => { assert.ok(!text.includes(o.id), o.id); assert.ok(!text.includes('"' + o.buyer + '"'), o.buyer); });
  assert.doesNotMatch(text, /total|paid|pending|unpaid|buyer|proof/i);
  r.json.batches.forEach(b => {
    assert.deepEqual(Object.keys(b.stats), ['pcs']);
    assert.equal(b.stats.pcs, X.batchRecap(b.id, seed.orders).pcs, b.id);
  });
  // 배치를 열면 품목별 수량만 온다
  const items = (await call('GET', '/batch-items?id=kr-4')).json.items, want = X.batchRecap('kr-4', seed.orders).items;
  assert.equal(items.length, want.length);
  for (const it of items) assert.deepEqual(Object.keys(it).sort(), ['item', 'qty']);
  assert.equal(items.reduce((s, i) => s + i.qty, 0), want.reduce((s, i) => s + i.qty, 0));
  assert.equal((await call('GET', '/batch-items?id=nope')).json.items.length, 0);
  assert.equal((await call('GET', '/batch-orders?id=kr-4')).status, 404);   // 주문 목록을 주던 예전 주소는 없어졌다
});
test('조회: 주문번호 전체로만 찾는다. 아이디로는 찾지 않는다', async () => {
  const first = GO.seed().orders[0];
  const byId = (await call('GET', '/track?q=' + first.id.toLowerCase())).json.orders;
  assert.equal(byId.length, 1); assert.equal(byId[0].id, first.id); assert.match(byId[0].buyer, /\*/);
  for (const q of [first.buyer, '@' + first.buyer, first.buyer.slice(0, 3), 'n', "' OR 1=1 --", first.id.slice(0, -1)])
    assert.equal((await call('GET', '/track?q=' + encodeURIComponent(q))).json.orders.length, 0, q);
});

test('결제: 있는 주문은 금액 = 주문 금액 − 쿠폰 + 고유 코드, 두 번 내도 금액이 불어나지 않는다', async () => {
  const o = GO.seed().orders[0];
  assert.equal((await call('GET', '/order?id=' + o.id)).json.order.total, o.total);
  assert.equal((await call('POST', '/pay', { orderId: o.id, method: 'QRIS' })).status, 400);                 // 증빙 없음
  assert.equal((await call('POST', '/pay', { orderId: o.id, method: 'QRIS', proofName: 'a.jpg', voucher: 'NOPE' })).status, 400);
  const r = await call('POST', '/pay', { orderId: o.id, method: 'QRIS', proofName: 'a.jpg', voucher: 'go5000' });
  assert.equal(r.status, 200);
  assert.equal(r.json.order.total, o.total - 5000 + X.uniqueCode(o.id));
  assert.equal(r.json.order.pay, 'pending');
  assert.equal((await call('POST', '/pay', { orderId: o.id, method: 'QRIS', proofName: 'b.jpg' })).status, 409);  // 이미 제출함
  await admin('PATCH', '/admin/order/' + o.id, { pay: 'rejected' });
  const again = await call('POST', '/pay', { orderId: o.id, method: 'Transfer bank', proofName: 'c.jpg' });
  assert.equal(again.json.order.total, o.total + X.uniqueCode(o.id));
});
test('결제: 새 주문은 서버가 금액을 계산하고, 잘못된 입력은 거절한다', async () => {
  const id = GO.BRAND.orderPrefix + '-' + X.orderCode(777001);
  const good = { id, batchId: 'kr-5', buyer: '@tester', item: 'Keyring uji', qty: 2, base: 50000, method: 'QRIS', proofName: 'p.jpg' };
  for (const bad of [{ base: 0 }, { base: -5 }, { qty: 0 }, { buyer: '' }, { item: '' }, { id: 'XX-1' }, { batchId: 'nope' }, { method: 'Cash' }, { total: 1 , base: 'abc' }]) {
    const r = await call('POST', '/pay', Object.assign({}, good, bad));
    assert.ok(r.status >= 400 && r.status < 500, JSON.stringify(bad) + ' → ' + r.status);
  }
  const r = await call('POST', '/pay', Object.assign({ total: 1, pay: 'paid' }, good));   // 고객이 보낸 total·pay는 무시된다
  assert.equal(r.status, 200);
  assert.equal(r.json.order.total, 50000 + X.uniqueCode(id));
  assert.equal(r.json.order.pay, 'pending');
  assert.equal(r.json.order.buyer, 'tester');   // 방금 만든 새 주문은 입력한 이름 그대로 돌려준다
  assert.equal((await call('POST', '/pay', good)).status, 409);                             // 같은 주문번호
  assert.equal((await call('POST', '/pay', Object.assign({}, good, { id: GO.BRAND.orderPrefix + '-' + X.orderCode(777002), batchId: 'kr-1' }))).status, 409);  // 완료된 배치
});

test('관리자: 배치 추가·단계 변경이 공개 화면에 반영된다', async () => {
  const b = { svc: 'kr', no: 9, title: 'Uji Coba', month: '2026-11', closeDate: '2026-11-30', kurs: 11.5, note: 'Catatan uji' };
  assert.equal((await admin('POST', '/admin/batch', b)).status, 200);
  assert.equal((await admin('POST', '/admin/batch', b)).status, 409);
  assert.equal((await admin('POST', '/admin/batch', Object.assign({}, b, { no: 10, month: '2026-13' }))).status, 400);
  assert.equal((await admin('POST', '/admin/batch', Object.assign({}, b, { no: 10, svc: 'zz' }))).status, 404);
  assert.equal((await admin('PATCH', '/admin/batch/kr-9', { stage: 3, note: 'Sudah jalan' })).status, 200);
  assert.equal((await admin('PATCH', '/admin/batch/kr-9', { stage: 9 })).status, 400);
  const pub = (await call('GET', '/public')).json.batches.find(x => x.id === 'kr-9');
  assert.deepEqual([pub.stage, pub.note, pub.title, pub.closeDate], [3, 'Sudah jalan', 'Uji Coba', '2026-11-30']);
});
test('관리자: 주문 추가·결제 승인·삭제', async () => {
  const id = GO.BRAND.orderPrefix + '-' + X.orderCode(888001);
  assert.equal((await admin('POST', '/admin/order', { id, batchId: 'kr-9', buyer: 'dinda', item: 'Album', qty: 1, total: 285000 })).status, 200);
  assert.equal((await admin('POST', '/admin/order', { id, batchId: 'kr-9', buyer: 'dinda', item: 'Album', qty: 1, total: 285000 })).status, 409);
  assert.equal((await admin('PATCH', '/admin/order/' + id, { pay: 'bogus' })).status, 400);
  assert.equal((await admin('PATCH', '/admin/order/' + id, { pay: 'paid' })).status, 200);
  const st = (await admin('GET', '/admin/state')).json;
  assert.equal(st.orders.find(o => o.id === id).pay, 'paid');
  assert.equal(st.orders.find(o => o.id === id).buyer, 'dinda');          // 관리자는 전체 이름을 본다
  assert.equal((await admin('DELETE', '/admin/batch/kr-9')).status, 200); // 배치를 지우면 그 주문도 지워진다
  assert.equal((await admin('GET', '/admin/state')).json.orders.some(o => o.id === id), false);
});
test('관리자: 계산기 기본 수식 저장', async () => {
  const c = Object.assign(GO.seed().calcDefaults, { kurs: 123 });
  assert.equal((await admin('PUT', '/admin/calc', c)).status, 200);
  assert.equal((await admin('GET', '/admin/state')).json.calcDefaults.kurs, 123);
  assert.equal((await admin('PUT', '/admin/calc', Object.assign({}, c, { feeGo: { mode: 'x', val: 1 } }))).status, 400);
});
test('관리자: 한 일이 활동 기록에 남는다', async () => {
  const log = (await admin('GET', '/admin/log')).json.log;
  const actions = log.map(x => x.action);
  for (const a of ['login', 'reset', 'batch.add', 'batch.update', 'batch.delete', 'order.add', 'order.pay', 'calc']) assert.ok(actions.includes(a), a + ' 기록 없음');
  assert.ok(log[0].at && typeof log[0].ip === 'string');
  assert.ok(new Date(log[0].at) >= new Date(log[log.length - 1].at));   // 최근 것이 위
});
test('로그아웃하면 다시 막힌다. 끝으로 예시 데이터로 되돌린다', async () => {
  assert.equal((await admin('POST', '/admin/reset')).status, 200);
  const out = await admin('POST', '/logout');
  assert.match(out.set, /Max-Age=0/);
  cookie = '';
  assert.equal((await admin('GET', '/admin/state')).status, 401);
});
