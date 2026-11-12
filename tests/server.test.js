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
