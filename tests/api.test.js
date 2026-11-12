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

const STARTED = new Date().toISOString();
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
  cookie = 'sid=' + 'b'.repeat(32) + '.' + (Date.now() + 1e7) + '.' + 'a'.repeat(64);
  assert.equal((await admin('GET', '/admin/state')).status, 401);
  cookie = '';
});
test('맞는 비밀번호로 로그인하면 HttpOnly 쿠키를 받는다', async () => {
  const r = await call('POST', '/login', { password: vars.ADMIN_PASSWORD });
  assert.equal(r.status, 200);
  assert.match(r.set, /^sid=[0-9a-f]{32}\.\d+\.[0-9a-f]{64};/);
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

test('조회: 주문번호를 소문자·띄어쓰기·하이픈 없이 적어도 찾는다', async () => {
  const o = GO.seed().orders[1], code = o.id.split('-')[1];
  for (const q of [o.id.toLowerCase(), GO.BRAND.orderPrefix + code, GO.BRAND.orderPrefix + ' ' + code]) {
    assert.equal((await call('GET', '/track?q=' + encodeURIComponent(q))).json.orders.length, 1, q);
    assert.equal((await call('GET', '/order?id=' + encodeURIComponent(q))).json.order.id, o.id, q);
  }
});

test('결제: 있는 주문은 금액 = 주문 금액 − 쿠폰 + 고유 코드, 두 번 내도 금액이 불어나지 않는다', async () => {
  const o = GO.seed().orders[0];
  assert.equal((await call('GET', '/order?id=' + o.id)).json.order.total, o.total);
  assert.equal((await call('POST', '/pay', { orderId: o.id, method: 'QRIS' })).status, 400);                 // 증빙 없음
  assert.equal((await call('POST', '/pay', { orderId: o.id, method: 'QRIS', proofName: 'a.jpg', voucher: 'NOPE' })).status, 400);
  const r = await call('POST', '/pay', { orderId: o.id, method: 'QRIS', proofName: 'a.jpg', voucher: 'nuh5000', base: 1, total: 1, buyer: 'hacker' });
  assert.equal(r.status, 200);
  assert.equal(r.json.order.total, o.total - 5000 + X.uniqueCode(o.id));   // 고객이 보낸 base·total은 쓰지 않는다
  assert.equal(r.json.order.pay, 'pending');
  assert.match(r.json.order.buyer, /\*/);                                   // 응답에도 전체 이름을 싣지 않는다
  assert.notEqual(r.json.order.buyer, 'hacker');
  assert.equal((await call('POST', '/pay', { orderId: o.id, method: 'QRIS', proofName: 'b.jpg' })).status, 409);  // 이미 제출함
  await admin('PATCH', '/admin/order/' + o.id, { pay: 'rejected' });
  const again = await call('POST', '/pay', { orderId: o.id, method: 'Transfer bank', proofName: 'c.jpg' });
  assert.equal(again.json.order.total, o.total + X.uniqueCode(o.id));
});
const nap = ms => new Promise(r => setTimeout(r, ms));
const WINDOW_MS = (Number(vars.RATE_WINDOW_SEC) || 6) * 1000 + 500;      // 새 주문 횟수 제한이 풀리는 시간
test('주문 접수: 서버가 주문번호와 결제 금액을 정해 저장하고, 잘못된 입력은 거절한다', async () => {
  const good = { batchId: 'kr-5', buyer: '@tester', item: 'Keyring uji', qty: 2, base: 50000 };
  for (const bad of [{ base: 0 }, { base: -5 }, { qty: 0 }, { buyer: '' }, { item: '' }, { batchId: 'nope' }, { batchId: 5 }, { base: 'abc' }, { voucher: 'NOPE' },
    { base: '1e3' }, { base: true }, { base: [1000] }, { qty: null }, { buyer: 12345 }, { buyer: ['x'] }, { item: 99 }]) {
    const r = await call('POST', '/order', Object.assign({}, good, bad));
    assert.ok(r.status >= 400 && r.status < 500, JSON.stringify(bad) + ' → ' + r.status);
  }
  // 고객이 보낸 주문번호·금액·결제 상태는 쓰지 않는다
  const made = await call('POST', '/order', Object.assign({ id: GO.BRAND.orderPrefix + '-AAAAAAAA', total: 1, pay: 'paid' }, good));
  assert.equal(made.status, 200);
  const o = made.json.order, id = o.id;
  assert.ok(X.isOrderId(id) && id !== GO.BRAND.orderPrefix + '-AAAAAAAA', id);
  assert.equal(o.total, 50000 + X.uniqueCode(id));
  assert.equal(o.pay, 'unpaid');
  assert.equal(o.buyer, 'tester');   // 방금 만든 새 주문은 입력한 이름 그대로 돌려준다
  assert.equal(o.late, 0);           // 접수 중인 배치라 "마감 뒤 주문" 표시가 없다
  // 다시 읽어도(새로 고침, 은행 앱에 다녀옴, 다른 기기) 주문번호와 결제 금액이 그대로다
  for (let i = 0; i < 2; i++) {
    const again = (await call('GET', '/order?id=' + id)).json.order;
    assert.equal(again.total, o.total);
    assert.equal(again.pay, 'unpaid');
    assert.equal(again.self, 1);
  }
  // 주문번호 없이 결제만 보내면 받지 않는다 (새 주문은 먼저 접수해야 한다)
  assert.equal((await call('POST', '/pay', Object.assign({ method: 'QRIS', proofName: 'p.jpg' }, good))).status, 400);
  // 증빙을 내면 확인 대기가 되고, 금액은 접수 때와 같다. 이때 보낸 금액이나 쿠폰으로 바뀌지 않는다
  const paid = await call('POST', '/pay', { orderId: id, method: 'QRIS', proofName: 'p.jpg', voucher: 'NUH5000', total: 1, base: 1 });
  assert.equal(paid.status, 200);
  assert.equal(paid.json.order.total, o.total);
  assert.equal(paid.json.order.pay, 'pending');
  // 고객이 적어 낸 품목은 승인 전에는 공개 리캡에 나오지 않는다 (아무 글이나 공개 화면에 띄울 수 없게)
  const before = (await call('GET', '/public')).json.batches.find(x => x.id === 'kr-5').stats.pcs;
  assert.ok(!(await call('GET', '/batch-items?id=kr-5')).json.items.some(i => i.item === 'Keyring uji'));
  assert.equal((await admin('PATCH', '/admin/order/' + id, { pay: 'paid' })).status, 200);
  assert.ok((await call('GET', '/batch-items?id=kr-5')).json.items.some(i => i.item === 'Keyring uji'), '승인 뒤에는 나와야 한다');
  assert.equal((await call('GET', '/public')).json.batches.find(x => x.id === 'kr-5').stats.pcs, before + 2);
  // 주문이 마감된 배치(kr-4, 구매 완료 단계)에도 새 주문은 받지만 "마감 뒤 주문"으로 표시된다
  const late = await call('POST', '/order', Object.assign({}, good, { batchId: 'kr-4' }));
  assert.equal(late.status, 200);
  assert.equal(late.json.order.late, 2);
  assert.equal((await call('GET', '/track?q=' + late.json.order.id)).json.orders[0].late, 2);
  assert.equal((await admin('GET', '/admin/state')).json.orders.find(x => x.id === late.json.order.id).late, 2);
  assert.equal((await call('POST', '/order', Object.assign({}, good, { batchId: 'kr-1' }))).status, 409);  // 완료된 배치
});

test('주문 접수: 쿠폰은 접수할 때 적용되고, 금액보다 커도 음수가 되지 않는다', async () => {
  const small = (await call('POST', '/order', { batchId: 'kr-5', buyer: 'kecil', item: 'Stiker', qty: 1, base: 3000, voucher: 'nuh5000' })).json.order;
  assert.equal(small.total, X.uniqueCode(small.id));
  assert.ok(small.total >= 1);
  const big = (await call('POST', '/order', { batchId: 'kr-5', buyer: 'besar', item: 'Album', qty: 1, base: 20000, voucher: 'NUH5000' })).json.order;
  assert.equal(big.total, 15000 + X.uniqueCode(big.id));
  assert.equal((await call('GET', '/order?id=' + big.id)).json.order.total, big.total);
});

test('주문 접수: 같은 가격의 주문 여러 건이 서로 다른 결제 금액을 받는다', async () => {
  await nap(WINDOW_MS);
  const totals = [];
  for (let i = 0; i < 8; i++) {
    const r = await call('POST', '/order', { batchId: 'kr-5', buyer: 'sama' + i, item: 'Sama', qty: 1, base: 77000 });
    assert.equal(r.status, 200, i + '번째 → ' + r.status);
    totals.push(r.json.order.total);
  }
  assert.equal(new Set(totals).size, totals.length, totals.join(','));
  await nap(WINDOW_MS);
});

test('세션: 서명이 맞아도 만료 시각이 지난 쿠키는 거절한다', async () => {
  // 실제 쿠키(번호.만료.서명)에서 번호를 가져와, 만료만 과거로 바꾸고 올바르게 다시 서명한다
  const crypto = require('crypto');
  const [sid, exp] = cookie.replace(/^sid=/, '').split('.');
  const signed = e => 'sid=' + sid + '.' + e + '.' + crypto.createHmac('sha256', vars.SESSION_SECRET).update('admin.' + sid + '.' + e).digest('hex');
  const keep = cookie;
  cookie = signed(exp);
  assert.equal((await admin('GET', '/admin/state')).status, 200, '다시 서명한 쿠키가 통해야 이 검사가 의미가 있다');
  cookie = signed(Date.now() - 1000);
  assert.equal((await admin('GET', '/admin/state')).status, 401);
  cookie = keep;
});
test('잘못된 주소 형식은 서버 오류가 아니라 잘못된 요청으로 답한다', async () => {
  assert.equal((await admin('DELETE', '/admin/order/%E0%A4%A')).status, 400);
});

test('접수: 고객이 접수한 주문에는 입금 기한(24시간)이 붙고, 증빙을 내면 사라진다', async () => {
  const r = await call('POST', '/order', { batchId: 'kr-5', buyer: 'tenggat', item: 'Uji batas waktu', qty: 1, base: 40000 });
  assert.equal(r.status, 200);
  const left = Date.parse(r.json.order.payBy) - Date.now();
  assert.ok(left > 23.9 * 3600e3 && left <= 24 * 3600e3, 'payBy = ' + r.json.order.payBy);
  assert.equal((await call('GET', '/order?id=' + r.json.order.id)).json.order.payBy, r.json.order.payBy);
  assert.equal((await call('GET', '/track?q=' + r.json.order.id)).json.orders[0].payBy, r.json.order.payBy);
  const paid = await call('POST', '/pay', { orderId: r.json.order.id, method: 'QRIS', proofName: 'p.jpg' });
  assert.equal(paid.status, 200);
  assert.equal((await call('GET', '/order?id=' + r.json.order.id)).json.order.payBy, '');      // 증빙을 낸 주문에는 기한이 없다
  assert.equal((await call('GET', '/order?id=' + GO.seed().orders[0].id)).json.order.payBy, '');   // 운영자가 넣은 주문에도 없다
  // 증빙을 낸 주문을 운영자가 미결제로 되돌려도 기한이 다시 생기지 않는다 (기한이 생기면 접수 48시간 뒤 자동으로 지워진다)
  assert.equal((await admin('PATCH', '/admin/order/' + r.json.order.id, { pay: 'unpaid' })).status, 200);
  assert.equal((await call('GET', '/order?id=' + r.json.order.id)).json.order.payBy, '');
  assert.equal((await call('GET', '/track?q=' + r.json.order.id)).json.orders[0].payBy, '');
  assert.equal((await admin('GET', '/admin/state')).json.orders.find(o => o.id === r.json.order.id).payBy, '');
  assert.equal((await call('POST', '/order', { batchId: 'kr-5', buyer: 'x'.repeat(GO.LIMITS.buyer + 1), item: 'a', qty: 1, base: 1000 })).status, 400);   // 한도는 data.js 한 곳에서 온다
});
test('관리자: 배치 추가·단계 변경이 공개 화면에 반영된다', async () => {
  const b = { svc: 'kr', no: 9, title: 'Uji Coba', month: '2026-11', closeDate: '2026-11-30', kurs: 11.5, note: 'Catatan uji' };
  assert.equal((await admin('POST', '/admin/batch', b)).status, 200);
  assert.equal((await admin('POST', '/admin/batch', b)).status, 409);
  assert.equal((await admin('POST', '/admin/batch', Object.assign({}, b, { no: 10, month: '2026-13' }))).status, 400);
  assert.equal((await admin('POST', '/admin/batch', Object.assign({}, b, { no: 10, svc: 'zz' }))).status, 404);
  assert.equal((await admin('PATCH', '/admin/batch/kr-9', { stage: 3, note: 'Sudah jalan' })).status, 200);
  assert.equal((await admin('PATCH', '/admin/batch/kr-9', { stage: 9 })).status, 400);
  for (const bad of [true, null, [1], '1e0']) assert.equal((await admin('PATCH', '/admin/batch/kr-9', { stage: bad })).status, 400, 'stage ' + JSON.stringify(bad));
  for (const bad of ['2026-02-30', '9999-99-99']) assert.equal((await admin('POST', '/admin/batch', Object.assign({}, b, { no: 11, closeDate: bad }))).status, 400, bad);
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
  const id2 = GO.BRAND.orderPrefix + '-' + X.orderCode(888002);
  assert.equal((await admin('POST', '/admin/order', { id: id2, batchId: 'kr-9', buyer: 'rara', item: 'Keyring', qty: 1, total: 50000 })).status, 200);
  assert.equal((await admin('PATCH', '/admin/order/' + id2.toLowerCase(), { pay: 'unpaid' })).status, 200);   // 운영자가 소문자로 적어도 찾는다
  assert.equal((await admin('DELETE', '/admin/order/' + id2)).status, 200);
  assert.equal((await admin('DELETE', '/admin/order/' + id2)).status, 404);        // 이미 없는 주문
  assert.equal((await admin('DELETE', '/admin/batch/zz-99')).status, 404);         // 없는 배치
  assert.equal((await admin('GET', '/admin/log')).json.log.some(l => /zz-99/.test(JSON.stringify(l))), false, '없는 것을 지운 일은 기록하지 않는다');
  assert.equal((await admin('GET', '/admin/state')).json.orders.some(o => o.id === id2), false);
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
  // 이번 실행에서 남긴 기록만 본다 (예전 실행의 기록이 남아 있어 통과하는 일을 막는다)
  const log = (await admin('GET', '/admin/log')).json.log.filter(x => x.at >= STARTED);
  const actions = log.map(x => x.action);
  for (const a of ['login', 'reset', 'batch.add', 'batch.update', 'batch.delete', 'order.add', 'order.pay', 'order.delete', 'calc']) assert.ok(actions.includes(a), a + ' 기록 없음');
  assert.ok(log[0].at && typeof log[0].ip === 'string');
  assert.ok(new Date(log[0].at) >= new Date(log[log.length - 1].at));   // 최근 것이 위
});
test('로그아웃하면 같은 쿠키를 다시 써도 막힌다. 끝으로 예시 데이터로 되돌린다', async () => {
  assert.equal((await call('GET', '/me')).json.canReset, true);              // 내 컴퓨터에서만 초기화가 켜져 있다
  assert.equal((await admin('POST', '/admin/reset')).status, 200);
  const out = await admin('POST', '/logout');
  assert.match(out.set, /Max-Age=0/);
  // 쿠키를 지우지 않고 그대로 다시 보낸다: 서버가 그 로그인을 끊었어야 한다
  assert.equal((await admin('GET', '/admin/state')).status, 401);
  assert.equal((await admin('PATCH', '/admin/batch/kr-5', { stage: 1 })).status, 401);
  cookie = '';
});
