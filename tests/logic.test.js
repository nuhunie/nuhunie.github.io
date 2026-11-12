// 알고리즘(site/js/logic.js) 단위 테스트.  실행: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
global.window = global;
require('../site/js/data.js');
require('../site/js/logic.js');
const X = GO.logic;
const base = { price: 2000, qty: 1, kurs: 110, feeGo: { mode: 'pct', val: 10 }, feeCo: { mode: 'nom', val: 10000 }, tax: { mode: 'pct', val: 0, base: 'conv' }, extra: 0 };
const withv = patch => Object.assign({}, base, patch);

test('가격: 환산가 + 퍼센트 수수료 + 개당 수수료', () => {
  const r = X.calcPrice(base);
  assert.equal(r.conv, 220000);
  assert.equal(r.feeGo, 22000);
  assert.equal(r.feeCo, 10000);
  assert.equal(r.total, 252000);
});
test('가격: 수량이 늘면 환산가와 개당 수수료가 함께 는다', () => {
  const r = X.calcPrice(withv({ qty: 3 }));
  assert.equal(r.conv, 660000);
  assert.equal(r.feeCo, 30000);
  assert.equal(r.total, 660000 + 66000 + 30000);
  assert.equal(r.perPcs, Math.round(r.total / 3));
});
test('가격: 배수 방식은 환산가 × 값', () => {
  assert.equal(X.calcPrice(withv({ feeGo: { mode: 'mul', val: 0.2 } })).feeGo, 44000);
});
test('가격: 세금 기준이 환산가일 때와 환산가+수수료일 때가 다르다', () => {
  const a = X.calcPrice(withv({ tax: { mode: 'pct', val: 10, base: 'conv' } }));
  const b = X.calcPrice(withv({ tax: { mode: 'pct', val: 10, base: 'convfee' } }));
  assert.equal(a.tax, 22000);
  assert.equal(b.tax, 25200);
});
test('가격: 빈 값·0 수량은 0과 1개로 처리해 NaN이 나오지 않는다', () => {
  const r = X.calcPrice(withv({ price: '', qty: 0, extra: '' }));
  assert.equal(r.qty, 1);
  assert.equal(r.total, 10000);
  assert.ok(Number.isFinite(r.total));
});

test('고유 코드: 1~999 범위이고 같은 주문번호면 항상 같다', () => {
  for (let i = 0; i < 500; i++) {
    const id = 'NUH-' + (100000 + i * 37), c = X.uniqueCode(id);
    assert.ok(c >= 1 && c <= 999, id + ' → ' + c);
    assert.equal(c, X.uniqueCode(id));
  }
});

test('주문번호: 머리글자-8자리, 헷갈리는 글자가 없고, 예시 데이터끼리 겹치지 않는다', () => {
  const ids = GO.seed().orders.map(o => o.id);
  ids.forEach(id => assert.ok(X.isOrderId(id), id));
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(X.orderCode(5), X.orderCode(5));
  assert.ok(!X.isOrderId(GO.BRAND.orderPrefix + '-123456'));      // 예전 6자리 숫자
  assert.ok(!X.isOrderId(GO.BRAND.orderPrefix + '-ABCDEFG0'));    // 0은 쓰지 않는다
  assert.ok(!X.isOrderId('XX-ABCDEFGH'));
  const many = new Set();
  for (let i = 0; i < 5000; i++) many.add(X.orderCode(i));
  assert.equal(many.size, 5000);
});

test('고유 코드: 99개가 아니라 999개에 고르게 퍼진다 (같은 가격 주문끼리 금액이 덜 겹치도록)', () => {
  const seen = new Set();
  for (let i = 0; i < 20000; i++) seen.add(X.uniqueCode(GO.BRAND.orderPrefix + '-' + X.orderCode(i)));
  assert.ok(seen.size > 900, '서로 다른 코드가 ' + seen.size + '개뿐');
});
test('금액 겹침: 확인 대기 중인 주문끼리 결제 금액이 같으면 찾아낸다', () => {
  const orders = [
    { id: 'A', pay: 'pending', total: 285056 }, { id: 'B', pay: 'pending', total: 285056 },
    { id: 'C', pay: 'pending', total: 100001 }, { id: 'D', pay: 'paid', total: 100001 }, { id: 'E', pay: 'unpaid', total: 285056 }
  ];
  assert.deepEqual(X.duplicateTotals(orders), { 285056: 2 });   // 결제 완료·미결제는 세지 않는다
  assert.deepEqual(X.duplicateTotals([]), {});
});

test('공개 리캡: 고객이 직접 만든 주문은 승인된 뒤에만 들어간다', () => {
  const orders = [
    { id: 'A', item: 'Album', qty: 1, total: 1, pay: 'unpaid' },                  // 운영자가 넣은 주문: 결제 전에도 보인다
    { id: 'B', item: 'Tulisan iseng', qty: 9, total: 1, pay: 'pending', self: 1 },   // 고객이 적어 낸 주문: 승인 전에는 숨긴다
    { id: 'C', item: 'Keyring', qty: 2, total: 1, pay: 'paid', self: 1 }           // 승인되면 보인다
  ];
  assert.deepEqual(X.publicOrders(orders).map(o => o.id), ['A', 'C']);
});

test('집계: 예시 데이터의 Korea 11월 합계', () => {
  const db = GO.seed();
  const nov = db.batches.filter(b => b.svc === 'kr' && b.month === '2026-11');
  const r = X.monthRecap(nov, db.orders);
  assert.deepEqual([r.batches, r.ongoing, r.count, r.pcs, r.total], [3, 3, 8, 12, 1734000]);
  const paid = db.orders.filter(o => nov.some(b => b.id === o.batchId) && o.pay === 'paid').reduce((s, o) => s + o.total, 0);
  assert.equal(r.paidTotal, paid);
});
test('집계: 배치 합계 = 품목별 합계의 합 = 주문 합계', () => {
  const db = GO.seed();
  db.batches.forEach(b => {
    const r = X.batchRecap(b.id, db.orders);
    assert.equal(r.items.reduce((s, i) => s + i.total, 0), r.total, b.id);
    assert.equal(r.items.reduce((s, i) => s + i.qty, 0), r.pcs, b.id);
    assert.equal(r.paid + r.pending + r.unpaid, r.count, b.id);
  });
});

test('조회: 주문번호 전체로만 찾는다. 아이디로는 찾지 않는다', () => {
  const db = GO.seed(), first = db.orders[0];
  const byId = X.searchOrders(db.orders, first.id.toLowerCase());
  assert.equal(byId.length, 1); assert.equal(byId[0].id, first.id); assert.equal(byId[0].buyer, X.maskName(first.buyer));
  for (const q of [first.buyer, '@' + first.buyer, GO.BRAND.orderPrefix, first.id.slice(0, -1), 'n', ''])
    assert.equal(X.searchOrders(db.orders, q).length, 0, q);
  assert.equal(db.orders[0].buyer, first.buyer);   // 원본은 바뀌지 않는다
});
test('진행 단계: 결제 전에는 결제 칸, 결제 후에는 배치 단계 칸', () => {
  assert.deepEqual(X.orderProgress({ pay: 'unpaid' }, { stage: 3 }), { cur: 0, finished: false });
  assert.deepEqual(X.orderProgress({ pay: 'pending' }, { stage: 3 }), { cur: 0, finished: false });
  assert.deepEqual(X.orderProgress({ pay: 'paid' }, { stage: 2 }), { cur: 2, finished: false });
  assert.deepEqual(X.orderProgress({ pay: 'paid' }, { stage: GO.LAST_STAGE }), { cur: GO.LAST_STAGE, finished: true });
});
test('이름 가리기', () => {
  assert.equal(X.maskName('nadya'), 'na***');
  assert.equal(X.maskName('ab'), 'a*');
});

const cases = [
  ['@nadya / Photocard random 1 pc / 2pcs / Rp 25.000', { buyer: 'nadya', item: 'Photocard random 1 pc', qty: 2, price: 25000, cur: 'IDR' }],
  ['dinda - album mini - 285k', { buyer: 'dinda', item: 'album mini', qty: 1, price: 285000, cur: 'IDR' }],
  ['3. rara, acrylic stand, x1, ¥2000', { buyer: 'rara', item: 'acrylic stand', qty: 1, price: 2000, cur: 'JPY' }],
  ['tiara lightstick strap 135rb', { buyer: 'tiara', item: 'lightstick strap', qty: 1, price: 135000, cur: 'IDR' }],
  ['sasa 2pcs keyring 75.000', { buyer: 'sasa', item: 'keyring', qty: 2, price: 75000, cur: 'IDR' }],
  ['bima | album | 3 | 310000', { buyer: 'bima', item: 'album', qty: 3, price: 310000, cur: 'IDR' }],
  ['ayu / tote bag / 1,5jt', { buyer: 'ayu', item: 'tote bag', qty: 1, price: 1500000, cur: 'IDR' }],
  ['kiki / album / 15000 won', { buyer: 'kiki', item: 'album', qty: 1, price: 15000, cur: 'KRW' }]
];
cases.forEach(([line, want]) => test('자동 분류: ' + line, () => {
  const r = X.classifyLine(line);
  assert.deepEqual({ buyer: r.buyer, item: r.item, qty: r.qty, price: r.price, cur: r.cur }, want);
  assert.deepEqual(r.missing, []);
}));
test('자동 분류: 가격이 없으면 빠진 칸으로 표시한다', () => {
  assert.deepEqual(X.classifyLine('halo kak').missing, ['price']);
});
test('자동 분류: "Batch N" 제목 줄은 주문이 아니고 아래 줄의 배치 번호가 된다', () => {
  const rows = X.classifyText('Batch 4\n\ndinda - album - 100k\nrara - keyring - 50k');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => r.batchNo), [4, 4]);
});

test('CSV: 쉼표·따옴표·줄바꿈을 감싸고, 수식으로 시작하는 값은 막는다', () => {
  assert.equal(X.toCSV([['a', 'b,c', 'say "hi"'], ['=SUM(A1)', 5, 'x\ny']]), 'a,"b,c","say ""hi"""\r\n\'=SUM(A1),5,"x\ny"');
});
