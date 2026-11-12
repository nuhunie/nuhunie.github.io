// 알고리즘(js/logic.js) 단위 테스트.  실행: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
global.window = global;
require('../js/data.js');
require('../js/logic.js');
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

test('고유 코드: 1~99 범위이고 같은 주문번호면 항상 같다', () => {
  for (let i = 0; i < 500; i++) {
    const id = 'NUH-' + (100000 + i * 37), c = X.uniqueCode(id);
    assert.ok(c >= 1 && c <= 99, id + ' → ' + c);
    assert.equal(c, X.uniqueCode(id));
  }
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

test('조회: 주문번호 전체 또는 아이디 전체로만 찾는다', () => {
  const db = GO.seed(), first = db.orders[0];
  const byId = X.searchOrders(db.orders, first.id.toLowerCase());
  assert.equal(byId.length, 1); assert.equal(byId[0].id, first.id); assert.equal(byId[0].buyer, X.maskName(first.buyer));
  const byName = X.searchOrders(db.orders, '@' + first.buyer);
  assert.equal(byName.length, db.orders.filter(o => o.buyer === first.buyer).length);
  byName.forEach(o => assert.equal(o.id, ''));                        // 아이디로 찾으면 주문번호는 나오지 않는다
  assert.equal(X.searchOrders(db.orders, GO.BRAND.orderPrefix).length, 0);   // 주문번호 일부로는 찾지 않는다
  assert.equal(X.searchOrders(db.orders, first.id.slice(0, -1)).length, 0);
  assert.equal(db.orders[0].id, first.id);                            // 원본은 바뀌지 않는다
  assert.equal(X.searchOrders(db.orders, first.buyer.slice(0, 3)).length, 0);   // 아이디 일부로는 남의 주문이 나오지 않는다
  assert.equal(X.searchOrders(db.orders, 'n').length, 0);
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
