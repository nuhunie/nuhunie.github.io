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
// QRIS 예시: 실제 가게가 아닌 꾸며 낸 값으로 규격대로 조립한다
const tlv = (id, v) => id + String(v.length).padStart(2, '0') + v;
const qrisOf = parts => { const body = parts.map(p => tlv(p[0], p[1])).join('') + '6304'; return body + X.crc16(body); };
const SHOP = [['00', '01'], ['01', '11'], ['26', tlv('00', 'ID.CO.CONTOH.WWW') + tlv('01', '936000000000000001') + tlv('03', 'UMI')],
  ['52', '5999'], ['53', '360'], ['58', 'ID'], ['59', 'TOKO CONTOH'], ['60', 'JAKARTA'], ['61', '10110']];
test('QRIS 검사값: 규격 문서의 예제와 같은 값이 나온다', () => {
  assert.equal(X.crc16('123456789'), '29B1');
  // EMV QR 규격 문서에 실린 예시(중국어 포함). 맨 끝 4자리가 검사값이다.
  const doc = '00020101021229300012D156000000000510A93FO3230Q31280012D15600000001030812345678520441115802CN5914BEST TRANSPORT6007BEIJING64200002ZH0104最佳运输0202北京540523.7253031565502016233030412340603***0708A60086670902ME91320016A0112233449988770708123456786304A13A';
  assert.equal(X.qrisValid(doc), true);
  assert.equal(X.qrisValid(doc.replace('23.72', '99.72')), false, '금액만 바꾸고 검사값을 그대로 두면 틀린 것으로 본다');
});
test('QRIS 금액 넣기: 고정 QR에 주문 금액을 넣으면 금액 지정 QR이 되고 나머지는 그대로다', () => {
  const shop = qrisOf(SHOP);
  assert.equal(X.qrisValid(shop), true);
  const out = X.qrisWithAmount(shop, 285056);
  assert.equal(X.qrisValid(out), true);
  const get = (p, id) => (X.qrisParse(p).find(x => x.id === id) || {}).val;
  assert.equal(get(out, '01'), '12');
  assert.equal(get(out, '54'), '285056');
  for (const id of ['00', '26', '52', '53', '58', '59', '60', '61']) assert.equal(get(out, id), get(shop, id), id + '번이 바뀌었다');
  assert.deepEqual(X.qrisParse(out).map(x => x.id), ['00', '01', '26', '52', '53', '54', '58', '59', '60', '61', '63']);
  // 이미 금액이 든 QR에 다른 금액을 넣으면 금액이 하나만 남는다
  const again = X.qrisWithAmount(out, 100001);
  assert.equal(get(again, '54'), '100001');
  assert.equal(X.qrisParse(again).filter(x => x.id === '54').length, 1);
  assert.equal(X.qrisValid(again), true);
});
test('QRIS 금액 넣기: 원본이 잘못됐거나 금액이 없으면 아무것도 만들지 않는다', () => {
  const shop = qrisOf(SHOP);
  assert.equal(X.qrisWithAmount('', 1000), '');
  assert.equal(X.qrisWithAmount('bukan qris', 1000), '');
  assert.equal(X.qrisWithAmount(shop.slice(0, -1) + (shop.slice(-1) === '0' ? '1' : '0'), 1000), '');
  assert.equal(X.qrisWithAmount(shop, 0), '');
  assert.equal(X.qrisWithAmount(shop, -5), '');
  assert.equal(GO.BRAND.qris === '' || X.qrisValid(GO.BRAND.qris), true, '등록한 가게 QRIS가 규격에 맞지 않는다');
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
test('조회: 주문번호를 소문자·띄어쓰기·하이픈 없이 적어도 찾는다. 글자가 다르면 찾지 않는다', () => {
  const o = GO.seed().orders[0], code = o.id.split('-')[1], pre = GO.BRAND.orderPrefix;
  for (const q of [o.id, o.id.toLowerCase(), pre + code, pre + ' ' + code, ' ' + pre.toLowerCase() + ' - ' + code.toLowerCase() + ' ', pre + '-' + code.slice(0, 4) + ' ' + code.slice(4)])
    assert.equal(X.searchOrders(GO.seed().orders, q).length, 1, JSON.stringify(q));
  for (const q of [code, code.slice(0, 7), o.id + 'A', pre, '', 'XX-' + code, code.slice(0, 7) + (code[7] === 'A' ? 'B' : 'A')])
    assert.equal(X.searchOrders(GO.seed().orders, q).length, 0, JSON.stringify(q));
  assert.equal(X.normOrderId('nuh usmtqleg'), 'NUH-USMTQLEG');
});
test('CSV 날짜: 서버가 적은 시각은 자카르타 시간으로 바꾼다', () => {
  assert.equal(X.shopDate('2026-11-12T17:30:00.000Z'), '2026-11-13');   // 자카르타 00:30
  assert.equal(X.shopDate('2026-11-12T16:59:59.000Z'), '2026-11-12');   // 자카르타 23:59
  assert.equal(X.shopDate('2026-12-31T20:00:00Z'), '2027-01-01');
  assert.equal(X.shopDate('2026-11-03T21:22:00'), '2026-11-03');        // 시간대 표시가 없으면 적힌 날짜 그대로
  assert.equal(X.shopDate(''), '');
});
test('계산기: 음수 원가나 환율을 넣어도 음수 금액이 나오지 않는다', () => {
  assert.equal(X.calcPrice(withv({ price: -2000 })).total >= 0, true);
  assert.equal(X.calcPrice(withv({ price: -2000 })).conv, 0);
  assert.equal(X.calcPrice(withv({ kurs: -110 })).conv, 0);
  assert.equal(X.calcPrice(withv({ extra: -99999999 })).total, 0);
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
test('자동 분류: 소수 두 자리가 붙은 금액을 100배로 읽지 않는다', () => {
  for (const [line, want] of [['dinda / Album / Rp 25.000,00', 25000], ['dinda / Album / Rp25.000,00', 25000], ['dinda / Album / Rp 25,000.00', 25000],
    ['dinda / Album / IDR 1.250.000,00', 1250000], ['dinda / Album / Rp 25000,00', 25000], ['dinda / Album / Rp 25.000', 25000], ['dinda / Album / Rp 1.250.000', 1250000]])
    assert.equal(X.classifyLine(line).price, want, line);
});
test('결제 금액과 주문번호: 화면과 서버가 같은 규칙을 쓴다', () => {
  const id = X.orderIdFrom(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]));
  assert.equal(id, GO.BRAND.orderPrefix + '-ABCDEFGH');
  assert.equal(X.isOrderId(X.orderIdFrom(new Uint8Array([255, 31, 32, 99, 7, 200, 13, 64]))), true);
  assert.equal(X.payable(50000, 0, id), 50000 + X.uniqueCode(id));
  assert.equal(X.payable(50000, 5000, id), 45000 + X.uniqueCode(id));
  assert.equal(X.payable(3000, 5000, id), X.uniqueCode(id));       // 쿠폰이 금액보다 커도 0 아래로 내려가지 않는다
});
test('자동 분류: 가격이 없으면 빠진 칸으로 표시한다', () => {
  assert.deepEqual(X.classifyLine('halo kak').missing, ['price']);
});
test('자동 분류: "Batch N" 제목 줄은 주문이 아니고 아래 줄의 배치 번호가 된다', () => {
  const rows = X.classifyText('Batch 4\n\ndinda - album - 100k\nrara - keyring - 50k');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => r.batchNo), [4, 4]);
});

test('CSV: 탭이나 공백 뒤에 숨긴 수식도 막는다', () => {
  for (const v of ['\t=1+1', ' =1+1', '\r=1+1', '\t@SUM(A1)', '  +1']) assert.equal(X.toCSV([[v]]).replace(/^"/, '')[0], "'", JSON.stringify(v));
  assert.equal(X.toCSV([['Album mini']]), 'Album mini');
});
test('CSV: 쉼표·따옴표·줄바꿈을 감싸고, 수식으로 시작하는 값은 막는다', () => {
  assert.equal(X.toCSV([['a', 'b,c', 'say "hi"'], ['=SUM(A1)', 5, 'x\ny']]), 'a,"b,c","say ""hi"""\r\n\'=SUM(A1),5,"x\ny"');
});

test('입금 기한: 고객이 접수한 결제 전 주문에만 있고, 접수 24시간 뒤다', () => {
  const o = { self: 1, pay: 'unpaid', createdAt: '2026-11-12T03:00:00.000Z' };
  assert.equal(X.payBy(o), '2026-11-13T03:00:00.000Z');
  assert.equal(X.payBy(Object.assign({}, o, { self: 0 })), '');            // 운영자가 넣은 주문
  assert.equal(X.payBy(Object.assign({}, o, { pay: 'pending' })), '');     // 증빙을 낸 주문
  assert.equal(X.payBy(Object.assign({}, o, { pay: 'rejected' })), '');    // 반려된 주문은 운영자가 다룬다
  const back = Object.assign({}, o, { id: 'NUH-AAAAAAAA', buyer: 'tamu', proofName: 'bukti.jpg' });   // 증빙을 낸 뒤 운영자가 미결제로 되돌린 주문
  assert.equal(X.payBy(back), '');
  assert.equal(X.payState(back, Date.parse(o.createdAt) + 100 * 3600000), 'none', '증빙을 낸 적 있는 주문은 지워지면 안 된다');
  const seen = X.searchOrders([back], back.id)[0];                         // 고객이 조회하면 증빙 이름은 가려지지만
  assert.equal(seen.proofName, '');
  assert.equal(seen.payBy, '', '가린 뒤에도 기한이 생기지 않는다');
  assert.equal(X.searchOrders([Object.assign({}, o, { id: 'NUH-BBBBBBBB', buyer: 'tamu' })], 'NUH-BBBBBBBB')[0].payBy, '2026-11-13T03:00:00.000Z');
  assert.equal(X.payBy(o, 1), '2026-11-12T04:00:00.000Z');                 // 시간을 바꿔 줄 수 있다(검사용)
  assert.equal(X.payBy(null), '');
});
test('입금 기한: 기한 안 → 기한 지남(유예) → 지울 때', () => {
  const at = '2026-11-12T03:00:00.000Z', t = Date.parse(at), h = 3600000, o = { self: 1, pay: 'unpaid', createdAt: at };
  assert.equal(X.payState(o, t + 23.9 * h), 'open');
  assert.equal(X.payState(o, t + 24 * h), 'overdue');
  assert.equal(X.payState(o, t + 47.9 * h), 'overdue');
  assert.equal(X.payState(o, t + 48 * h), 'gone');
  assert.equal(X.payState({ self: 0, pay: 'unpaid', createdAt: at }, t + 100 * h), 'none');
  assert.equal(X.payState({ self: 1, pay: 'paid', createdAt: at }, t + 100 * h), 'none');
  assert.equal(X.payState(o, t + 1.5 * h, 1, 2), 'overdue');               // 시간을 바꿔 줄 수 있다(검사용)
  assert.ok(GO.PURGE_HOURS > GO.PAY_HOURS, '지우는 시각은 기한보다 뒤여야 한다(유예)');
});
test('입력 한도는 한 곳(GO.LIMITS)에 있다', () => {
  assert.deepEqual(GO.LIMITS, { buyer: 40, item: 120, proof: 200, qty: 999, amount: 1e9 });
});
