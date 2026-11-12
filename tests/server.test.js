// 서버 공통 코드(server/lib.js) 단위 검사. 서버를 띄우지 않고 함수만 부른다.   실행: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const req = ip => ({ headers: { get: k => (k === 'cf-connecting-ip' ? ip : null) } });

test('비밀번호가 8자보다 짧으면 로그인을 열지 않는다', async () => {
  const { configured, weakPassword } = await import('../server/lib.js');
  assert.equal(configured({ ADMIN_PASSWORD: '0219', SESSION_SECRET: 'x' }), false);
  assert.equal(weakPassword({ ADMIN_PASSWORD: '0219', SESSION_SECRET: 'x' }), true);
  assert.equal(configured({ ADMIN_PASSWORD: 'a'.repeat(7), SESSION_SECRET: 'x' }), false);
  assert.equal(configured({ ADMIN_PASSWORD: 'a'.repeat(8), SESSION_SECRET: 'x' }), true);
  assert.equal(weakPassword({ ADMIN_PASSWORD: 'a'.repeat(8), SESSION_SECRET: 'x' }), false);
  assert.equal(configured({ ADMIN_PASSWORD: 'a'.repeat(8) }), false);           // 세션 열쇠가 없어도 열지 않는다
  assert.equal(configured({}), false);
  assert.equal(weakPassword({}), false);                                         // 아예 없는 것은 "짧다"가 아니라 "미설정"
});
test('예시 데이터 초기화는 ALLOW_RESET=1 일 때만 허용한다', async () => {
  const { canReset } = await import('../server/lib.js');
  assert.equal(canReset({}), false);
  assert.equal(canReset({ ALLOW_RESET: '0' }), false);
  assert.equal(canReset({ ALLOW_RESET: 'true' }), false);
  assert.equal(canReset({ ALLOW_RESET: '1' }), true);
});
test('횟수 제한의 주소 단위: IPv4는 그대로, IPv6는 앞 64비트로 묶는다', async () => {
  const { ipKey } = await import('../server/lib.js');
  assert.equal(ipKey(req('203.0.113.7')), '203.0.113.7');
  assert.equal(ipKey(req(null)), 'local');
  const a = ipKey(req('2001:db8:abcd:12::1')), b = ipKey(req('2001:DB8:ABCD:0012:ffff:ffff:ffff:ffff')), c = ipKey(req('2001:db8:abcd:13::1'));
  assert.equal(a, b);              // 같은 /64
  assert.notEqual(a, c);           // 다른 /64
  assert.equal(ipKey(req('::1')), ipKey(req('0:0:0:0:0:0:0:2')));
});

test('입력 검사: 숫자가 아닌 값을 숫자로 바꿔 받지 않는다', async () => {
  const { V } = await import('../server/lib.js');
  for (const bad of [true, false, null, undefined, [1000], {}, '1e3', '0x10', '', ' ', '12abc']) assert.equal(V.int(bad, 0, 1e9), null, JSON.stringify(bad));
  assert.equal(V.int(1000, 1, 1e9), 1000);
  assert.equal(V.int('1000', 1, 1e9), 1000);      // 화면의 입력 칸은 글자로 보내므로 숫자만 적힌 글자는 받는다
  assert.equal(V.int(2.5, 1, 9), null);
  assert.equal(V.num('11.5', 0, 100), 11.5);
  assert.equal(V.num(true, 0, 100), null);
  assert.equal(V.text(12345, 40), null);          // 글자 칸에 숫자·배열을 넣으면 받지 않는다
  assert.equal(V.text(['x'], 40), null);
});
test('입력 검사: 비워도 되는 글자 칸은 없으면 빈 글자, 글자가 아니면 거절한다', async () => {
  const { V } = await import('../server/lib.js');
  assert.equal(V.optText(undefined, 10), '');
  assert.equal(V.optText(null, 10), '');
  assert.equal(V.optText('  hai ', 10), 'hai');
  assert.equal(V.optText('x'.repeat(11), 10), null);
  for (const bad of [12345, 0, true, ['x'], { a: 1 }]) assert.equal(V.optText(bad, 10), null, JSON.stringify(bad));
});
test('증빙 사진: 형식은 파일 앞부분까지 확인하고, base64 로 바꿔도 그대로 돌아온다', async () => {
  const { photoOk, toBase64, fromBase64 } = await import('../server/lib.js');
  const png = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, 1, 2, 3]);
  const jpg = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0, 16, 74, 70, 73, 70, 0, 1]);
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1]);
  assert.equal(photoOk('image/png', png), true);
  assert.equal(photoOk('image/jpeg', jpg), true);
  assert.equal(photoOk('image/webp', webp), true);
  assert.equal(photoOk('image/png', jpg), false);                 // 형식 이름과 내용이 다르면 거절
  assert.equal(photoOk('image/gif', png), false);
  assert.equal(photoOk('text/html', new TextEncoder().encode('<html><script>x</script>')), false);
  assert.equal(photoOk('image/webp', new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45])), false);   // RIFF 지만 WAVE
  const big = new Uint8Array(300000).map((_, i) => (i * 7) & 255);
  assert.deepEqual(fromBase64(toBase64(big)), big);
});
test('입력 검사: 달력에 없는 날짜는 받지 않는다', async () => {
  const { V } = await import('../server/lib.js');
  for (const bad of ['2026-02-30', '9999-99-99', '2026-13-01', '2026-00-10', '2025-02-29', '2026-1-5', 20261130]) assert.equal(V.date(bad), null, String(bad));
  assert.equal(V.date('2026-11-30'), '2026-11-30');
  assert.equal(V.date('2028-02-29'), '2028-02-29');   // 윤년
  assert.equal(V.date(''), '');
});
// 실제 DB 대신, 어떤 SQL이 실행됐는지만 적어 두는 가짜 DB
function fakeDb() {
  const ran = [];
  const prepare = sql => ({ sql, bind() { return this; }, async all() { ran.push(sql); return { results: [] }; }, async first() { ran.push(sql); return null; }, async run() { ran.push(sql); return { meta: { changes: 1 } }; } });
  return { ran, prepare, async batch(list) { list.forEach(s => ran.push(s.sql)); } };
}
test('새 DB: 배포판에서는 서비스 종류만 넣고 예시 주문은 넣지 않는다', async () => {
  const { loadState } = await import('../server/lib.js');
  for (const env of [{}, { ALLOW_RESET: '0' }, undefined]) {
    const db = fakeDb();
    await loadState(db, false, env);
    assert.ok(db.ran.some(s => /INSERT OR IGNORE INTO services/.test(s)), '서비스는 넣어야 한다');
    assert.deepEqual(db.ran.filter(s => /INSERT INTO (orders|batches|vouchers)|DELETE FROM/.test(s)), [], '예시 주문·배치·쿠폰을 넣거나 무언가를 지우면 안 된다');
  }
  const local = fakeDb();
  await loadState(local, true, { ALLOW_RESET: '1' });
  assert.ok(local.ran.some(s => /INSERT INTO orders/.test(s)), '내 컴퓨터(초기화 허용)에서는 예시 주문까지 넣는다');
});

test('입금 기한: 서버는 data.js 의 시간을 쓰고, 검사용 환경값이 있으면 그 값으로 바꾼다', async () => {
  const { payHours, purgeHours, expired, withDeadline } = await import('../server/lib.js');
  assert.equal(payHours({}), 24); assert.equal(purgeHours({}), 48); assert.equal(payHours(undefined), 24);
  const T = { ALLOW_RESET: '1' };                                                  // 검사 환경: 초기화 스위치가 켜진 곳
  assert.equal(payHours(Object.assign({ PAY_WINDOW_SEC: '7200' }, T)), 2); assert.equal(purgeHours(Object.assign({ PURGE_SEC: '10800' }, T)), 3);
  assert.equal(payHours({ PAY_WINDOW_SEC: '7200' }), 24, '스위치가 없는 곳(배포판)에서는 검사용 값을 듣지 않는다');
  assert.equal(purgeHours({ PURGE_SEC: '60' }), 48, '배포 설정에 실수로 넣어도 접수가 일찍 지워지지 않는다');
  assert.equal(payHours(Object.assign({ PAY_WINDOW_SEC: '-60' }, T)), 24); assert.equal(purgeHours(Object.assign({ PURGE_SEC: 'abc' }, T)), 48);   // 0보다 큰 숫자만 받는다
  const now = Date.now(), o = h => ({ self: 1, pay: 'unpaid', createdAt: new Date(now - h * 3600000).toISOString() });
  assert.equal(expired(o(47), {}), false);
  assert.equal(expired(o(49), {}), true);
  assert.equal(expired(Object.assign(o(49), { pay: 'pending' }), {}), false);      // 증빙을 낸 주문은 지우지 않는다
  assert.equal(expired(Object.assign(o(49), { self: 0 }), {}), false);             // 운영자가 넣은 주문은 지우지 않는다
  assert.equal(expired(o(1), Object.assign({ PURGE_SEC: '1800' }, T)), true);
  assert.equal(expired(o(1), { PURGE_SEC: '1800' }), false);
  // 되돌리는 순간 지워질 접수(증빙 없이 승인했다가 접수 48시간 뒤에 되돌리는 경우)는 미결제로 되돌리지 않는다
  const { canUnpay } = await import('../server/lib.js');
  assert.equal(canUnpay(Object.assign(o(49), { pay: 'paid', proofName: '' }), {}), false);
  assert.equal(canUnpay(Object.assign(o(47), { pay: 'paid', proofName: '' }), {}), true);
  assert.equal(canUnpay(Object.assign(o(49), { pay: 'paid', proofName: 'bukti.jpg' }), {}), true);
  assert.equal(canUnpay(Object.assign(o(1), { pay: 'paid', proofName: '' }), Object.assign({ PURGE_SEC: '1800' }, T)), false);
  assert.equal(withDeadline(o(1), {}).payBy, new Date(now - 3600000 + 24 * 3600000).toISOString());
  assert.equal(withDeadline(Object.assign(o(1), { pay: 'paid' }), {}).payBy, '');
});
test('입금 기한: 지울 때가 된 접수만, 지우는 순간에도 결제 전일 때만 지우고, 활동 기록에 남긴다', async () => {
  const { purgeExpired } = await import('../server/lib.js');
  const ran = [], st = sql => ({ sql, bind: (...a) => ({ sql, a, all: async () => ({ results: /SELECT o\.id/.test(sql) ? [{ id: 'NUH-AAAAAAAA' }, { id: 'NUH-BBBBBBBB' }] : [] }), run: async () => { ran.push(sql); return { meta: { changes: 1 } }; } }) });
  const db = { prepare: st, batch: async list => { list.forEach(s => ran.push(s.sql)); return list.map(() => ({ meta: { changes: 1 } })); } };
  assert.deepEqual(await purgeExpired(db, {}), ['NUH-AAAAAAAA', 'NUH-BBBBBBBB']);
  assert.equal(ran.filter(s => /DELETE FROM orders WHERE id = \? AND pay = 'unpaid' AND proof_name = ''/.test(s)).length, 2);   // 증빙을 낸 적 있는 주문은 지우지 않는다
  assert.equal(ran.filter(s => /DELETE FROM order_flags WHERE order_id = \? AND NOT EXISTS/.test(s)).length, 2);
  assert.equal(ran.filter(s => /DELETE FROM voucher_uses WHERE order_id = \? AND NOT EXISTS/.test(s)).length, 2);   // 지워진 접수가 쓴 쿠폰을 돌려준다
  assert.equal(ran.filter(s => /DELETE FROM order_payer WHERE order_id = \? AND NOT EXISTS/.test(s)).length, 2);
  assert.equal(ran.filter(s => /DELETE FROM proof_images WHERE order_id = \? AND NOT EXISTS/.test(s)).length, 2);
  assert.ok(ran.some(s => /INSERT INTO audit/.test(s)));
  const empty = { prepare: sql => ({ bind: () => ({ all: async () => ({ results: [] }) }) }), batch: async () => { throw new Error('지울 것이 없으면 아무것도 쓰지 않는다'); } };
  assert.deepEqual(await purgeExpired(empty, {}), []);
  // 한꺼번에 30건을 지워도 주문번호가 활동 기록에 모두 남는다 (한 줄에 200자까지만 보이므로 나눠 적는다)
  const many = Array.from({ length: 30 }, (_, i) => ({ id: 'NUH-' + String(i).padStart(8, 'A') })), notes = [];
  const st2 = sql => ({ sql, bind: (...a) => ({ sql, a, all: async () => ({ results: /SELECT o\.id/.test(sql) ? many : [] }) }) });
  const db2 = { prepare: st2, batch: async list => { list.forEach(s => { if (/INSERT INTO audit/.test(s.sql)) notes.push(s.a[3]); }); return list.map(() => ({ meta: { changes: 1 } })); } };
  assert.equal((await purgeExpired(db2, {})).length, 30);
  assert.ok(notes.every(n => n.length <= 200), '한 줄이 200자를 넘지 않는다');
  assert.deepEqual(notes.join(' ').split(' ').sort(), many.map(r => r.id).sort());
  // 그 사이 증빙을 내서 지워지지 않은 주문은 기록에도, 돌려주는 목록에도 넣지 않는다
  const db3 = { prepare: st2, batch: async list => list.map((s, i) => ({ meta: { changes: /DELETE FROM orders/.test(s.sql) && i === 0 ? 0 : 1 } })) };
  assert.equal((await purgeExpired(db3, {})).includes(many[0].id), false);
});
