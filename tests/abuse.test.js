// 공격 검사: 나쁜 의도를 가진 방문자가 할 만한 일을 내 컴퓨터의 서버에 실제로 해 본다.
//   서버를 띄운 뒤(npm run dev):  npm run test:server   (.dev.vars에 RATE_WINDOW_SEC=6 필요, npm run setup이 넣어 준다)
// 데이터를 더럽히고 마지막에 초기화하므로 배포된 사이트에는 돌리지 않는다.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
global.window = global;
require('../site/js/data.js');
require('../site/js/logic.js');

const BASE = process.env.BASE || 'http://localhost:8788';
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) throw new Error('이 검사는 내 컴퓨터의 서버에만 돌린다: ' + BASE);
const vars = Object.fromEntries(fs.readFileSync(path.join(__dirname, '..', '.dev.vars'), 'utf8').split(/\r?\n/).filter(l => l && l[0] !== '#').map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const WINDOW = (Number(vars.RATE_WINDOW_SEC) || 6) * 1000 + 700;   // 제한이 풀릴 때까지 기다리는 시간
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PFX = GO.BRAND.orderPrefix, X = GO.logic;
const seed = GO.seed();

let cookie = '';
async function call(method, p, body, opt) {
  const res = await fetch(BASE + (opt && opt.raw ? '' : '/api') + p, {
    method, headers: Object.assign(body ? { 'content-type': 'application/json' } : {}, cookie ? { cookie } : {}),
    body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined
  });
  return { status: res.status, headers: res.headers, json: await res.clone().json().catch(() => ({})), set: res.headers.get('set-cookie') };
}
async function login() {
  const r = await call('POST', '/login', { password: vars.ADMIN_PASSWORD });
  if (r.status === 200) cookie = r.set.split(';')[0];
  return r.status;
}

test('준비: 앞선 검사의 제한이 풀리기를 기다린 뒤 예시 데이터로 초기화', async () => {
  await sleep(WINDOW);
  assert.equal(await login(), 200);
  assert.equal((await call('POST', '/admin/reset')).status, 200);
  cookie = '';
});

test('주문 훑기: 주문번호 일부만으로는 주문 목록을 뽑을 수 없다', async () => {
  for (const q of [PFX.toLowerCase(), PFX + '-', PFX + '-A', seed.orders[0].id.slice(0, -1), seed.orders[0].id.slice(4)]) {
    const r = await call('GET', '/track?q=' + encodeURIComponent(q));
    assert.equal(r.json.orders.length, 0, '"' + q + '" → ' + r.json.orders.length + '건');
  }
});
test('주문 훑기: 아이디로는 남의 주문을 볼 수 없다', async () => {
  for (const q of [seed.orders[0].buyer, '@' + seed.orders[0].buyer]) {
    const r = await call('GET', '/track?q=' + encodeURIComponent(q));
    assert.equal(r.json.orders.length, 0, q);
  }
});
test('주문 훑기: 주문번호로 한 건을 불러와도 전체 이름은 나오지 않는다', async () => {
  const r = await call('GET', '/order?id=' + seed.orders[0].id);
  assert.equal(r.status, 200);
  assert.match(r.json.order.buyer, /\*/);
  assert.equal(r.json.order.proofName, '');
});
test('주문 훑기: 주문번호를 빠르게 연달아 넣어 보면 막힌다', async () => {
  let blocked = 0;
  for (let i = 0; i < 80; i++) if ((await call('GET', '/order?id=' + PFX + '-' + X.orderCode(500000 + i))).status === 429) blocked++;
  assert.ok(blocked > 0, '80번 연속 조회가 한 번도 막히지 않았다');
  await sleep(WINDOW);
});

test('무차별 대입: 틀린 비밀번호가 이어지면 잠기고, 잠긴 동안은 맞는 비밀번호도 거절된다', async () => {
  const codes = [];
  for (let i = 0; i < 8; i++) codes.push((await call('POST', '/login', { password: 'guess-' + i })).status);
  assert.ok(codes.includes(429), '8번 틀려도 잠기지 않았다: ' + codes.join(','));
  assert.equal(await login(), 429);
  await sleep(WINDOW);
  assert.equal(await login(), 200, '기다린 뒤에는 다시 로그인된다');
  cookie = '';
});

test('가짜 주문 도배: 같은 곳에서 새 주문을 계속 넣으면 막힌다', async () => {
  const codes = [];
  for (let i = 0; i < 20; i++) codes.push((await call('POST', '/pay', { id: PFX + '-' + X.orderCode(910000 + i), batchId: 'kr-5', buyer: 'spam', item: 'Spam', qty: 1, base: 1000, method: 'QRIS', proofName: 'x.jpg' })).status);
  assert.ok(codes.includes(429), '20건을 넣어도 막히지 않았다: ' + codes.join(','));
  assert.ok(codes.filter(c => c === 200).length <= 10);
  await sleep(WINDOW);
});

test('동시 결제: 같은 주문에 결제가 동시에 두 번 들어오면 하나만 받는다', async () => {
  const id = seed.orders.find(o => o.pay === 'unpaid' && o.id !== seed.orders[0].id).id;
  const body = { orderId: id, method: 'QRIS', proofName: 'a.jpg' };
  const got = (await Promise.all([1, 2, 3, 4].map(() => call('POST', '/pay', body)))).map(r => r.status).sort();
  assert.deepEqual(got, [200, 409, 409, 409]);
});

test('과대 입력: 지나치게 긴 값과 큰 본문은 거절한다', async () => {
  const base = { id: PFX + '-' + X.orderCode(920001), batchId: 'kr-5', buyer: 'big', item: 'x', qty: 1, base: 1000, method: 'QRIS', proofName: 'x.jpg' };
  for (const bad of [{ item: 'x'.repeat(5000) }, { buyer: 'b'.repeat(500) }, { proofName: 'p'.repeat(5000) }, { qty: 1e9 }, { base: 1e15 }]) {
    const r = await call('POST', '/pay', Object.assign({}, base, bad));
    assert.ok(r.status === 400 || r.status === 413, JSON.stringify(Object.keys(bad)) + ' → ' + r.status);
  }
  const huge = await call('POST', '/pay', JSON.stringify(Object.assign({}, base, { note: 'n'.repeat(300000) })));
  assert.ok(huge.status === 400 || huge.status === 413, '300KB 본문 → ' + huge.status);
  assert.equal((await call('POST', '/pay', '{not json')).status, 400);
});

test('심는 글: 스크립트가 든 값은 글자 그대로 저장되고 JSON으로만 나간다', async () => {
  assert.equal(await login(), 200);
  const evil = '<img src=x onerror="window.__pwned=1">';
  assert.equal((await call('POST', '/admin/order', { id: PFX + '-' + X.orderCode(930001), batchId: 'kr-5', buyer: 'evil', item: evil, qty: 1, total: 1000 })).status, 200);
  const pub = await call('GET', '/batch-items?id=kr-5');
  assert.match(pub.headers.get('content-type'), /application\/json/);
  assert.equal(pub.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(pub.json.items.some(o => o.item === evil));
});

test('보안 헤더: 화면과 API 응답에 붙어 있다', async () => {
  const page = await call('GET', '/', null, { raw: true });
  const csp = page.headers.get('content-security-policy') || '';
  assert.match(csp, /script-src 'self'/, 'CSP: ' + csp);
  assert.doesNotMatch(csp.match(/script-src[^;]*/)[0], /unsafe-inline/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(page.headers.get('referrer-policy'));
  const admin = await call('GET', '/admin/', null, { raw: true });
  assert.match(admin.headers.get('content-security-policy') || '', /script-src 'self'/);
});

test('정리: 예시 데이터로 되돌린다', async () => {
  assert.equal((await call('POST', '/admin/reset')).status, 200);
});
