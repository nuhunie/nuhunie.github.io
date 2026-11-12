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
