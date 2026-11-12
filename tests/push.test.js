// 웹 푸시(server/push.js) 단위 검사. 서버를 띄우지 않는다.   실행: npm test
// 암호화는 표준 문서(RFC 8291) 부록 A의 예시 값을 그대로 넣어, 문서에 적힌 결과와 한 바이트도 다르지 않은지 본다.
const test = require('node:test');
const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');
const join = s => s.replace(/\s+/g, '');
const load = async () => { await import('../site/js/data.js'); await import('../site/js/logic.js'); return import('../server/push.js'); };

test('RFC 8291 부록 A: 같은 열쇠와 salt 로 암호화하면 문서의 결과와 같다', async () => {
  const P = await load();
  const plain = new TextDecoder().decode(P.unb64u('V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24'));
  assert.equal(plain, 'When I grow up, I want to be a watermelon');
  const fixed = {
    asPublic: join('BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIg Dll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8'),
    asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
    salt: 'DGv6ra1nlYgDCS1FRnbzlw'
  };
  const uaPublic = join('BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV- JvLexhqUzORcx aOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4');
  const out = await P.encrypt(plain, uaPublic, 'BTBZMqHH6r4Tts7J_aSIgg', fixed);
  const header = P.unb64u(join('DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z 9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml mlMoZIIgDll6e3vCYLocInmYWAmS6Tlz AC8wEqKK6PBru3jl7A8'));
  const cipher = P.unb64u(join('8pfeW0KbunFT06SuDKoJH9Ql87S1QUrd irN6GcG7sFz1y1sqLgVi1VhjVkHsUoEs bI_0LpXMuGvnzQ'));
  const body = P.unb64u(join(`DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml
    mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT
    pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN`));
  assert.equal(header.length, 86);
  assert.deepEqual([...out.slice(0, 86)], [...header], '머리(salt·기록 크기·서버 공개 열쇠)');
  assert.deepEqual([...out.slice(86)], [...cipher], '암호문');
  assert.deepEqual([...out], [...body], '5절의 완성된 본문');
});

test('RFC 8291: 열쇠를 새로 만들어 보내도 받는 쪽(브라우저 역할)이 풀 수 있다', async () => {
  const P = await load(), S = globalThis.crypto.subtle;
  const ua = await S.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const uaPub = new Uint8Array(await S.exportKey('raw', ua.publicKey)), auth = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const msg = JSON.stringify({ title: '주문 진행 알림', body: 'Batch 5731 sudah tiba di Indonesia.' });
  const a = await P.encrypt(msg, P.b64u(uaPub), P.b64u(auth)), b = await P.encrypt(msg, P.b64u(uaPub), P.b64u(auth));
  assert.notDeepEqual([...a.slice(0, 16)], [...b.slice(0, 16)], '보낼 때마다 salt 가 다르다');
  // 받는 쪽: 머리에서 salt·서버 공개 열쇠를 읽고 같은 계산을 거꾸로 한다
  const salt = a.slice(0, 16), asPub = a.slice(21, 86), te = t => new TextEncoder().encode(t);
  const hk = async (s, ikm, info, n) => new Uint8Array(await S.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: s, info }, await S.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), n * 8));
  const ecdh = new Uint8Array(await S.deriveBits({ name: 'ECDH', public: await S.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []) }, ua.privateKey, 256));
  const ikm = await hk(auth, ecdh, new Uint8Array([...te('WebPush: info'), 0, ...uaPub, ...asPub]), 32);
  const cek = await hk(salt, ikm, new Uint8Array([...te('Content-Encoding: aes128gcm'), 0]), 16), nonce = await hk(salt, ikm, new Uint8Array([...te('Content-Encoding: nonce'), 0]), 12);
  const plain = new Uint8Array(await S.decrypt({ name: 'AES-GCM', iv: nonce }, await S.importKey('raw', cek, 'AES-GCM', false, ['decrypt']), a.slice(86)));
  assert.equal(plain[plain.length - 1], 2);
  assert.equal(new TextDecoder().decode(plain.slice(0, -1)), msg);
});

test('RFC 8292 VAPID: 서명을 Node 의 별도 구현으로 검증할 수 있다', async () => {
  const P = await load();
  const { privateKey, publicKey } = nodeCrypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = privateKey.export({ format: 'jwk' }), pub = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
  const env = { VAPID_PUBLIC_KEY: pub.toString('base64url'), VAPID_PRIVATE_KEY: jwk.d };
  const h = await P.vapidAuth('https://fcm.googleapis.com/fcm/send/abc', env, 'https://nuhunie.pages.dev', Date.parse('2026-11-12T00:00:00Z'));
  const m = h.match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/);
  assert.ok(m, h);
  assert.equal(m[4], env.VAPID_PUBLIC_KEY);
  assert.deepEqual(JSON.parse(Buffer.from(m[1], 'base64url')), { typ: 'JWT', alg: 'ES256' });
  const claims = JSON.parse(Buffer.from(m[2], 'base64url'));
  assert.equal(claims.aud, 'https://fcm.googleapis.com');            // 알림 회사의 origin (주소 전체가 아니다)
  assert.equal(claims.sub, 'https://nuhunie.pages.dev');
  assert.equal(claims.exp, Date.parse('2026-11-12T12:00:00Z') / 1000); // 24시간을 넘으면 안 된다
  assert.ok(nodeCrypto.verify('sha256', Buffer.from(m[1] + '.' + m[2]), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(m[3], 'base64url')));
});

test('받는 주소: 알림 회사 주소만 받는다 (서버가 아무 곳에나 요청을 보내지 않게)', async () => {
  const P = await load();
  for (const ok of ['https://fcm.googleapis.com/fcm/send/x', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://web.push.apple.com/QK', 'https://db5p.notify.windows.com/w/?token=x'])
    assert.equal(P.endpointOk(ok, {}), true, ok);
  for (const bad of ['http://fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x', 'https://evil.com/fcm.googleapis.com', 'https://fcm.googleapis.com.evil.com/x', 'https://user@fcm.googleapis.com/x',
    'https://notify.windows.com.evil.com/x', 'http://localhost:8899/x', 'https://169.254.169.254/', 'javascript:alert(1)', '', null, 12, 'https://fcm.googleapis.com/' + 'a'.repeat(1000)])
    assert.equal(P.endpointOk(bad, {}), false, String(bad));
  // 검사용 가짜 알림 서버는 초기화 스위치가 켜진 곳에서만
  assert.equal(P.endpointOk('http://localhost:8899/x', { ALLOW_RESET: '1', PUSH_TEST_ORIGIN: 'http://localhost:8899' }), true);
  assert.equal(P.endpointOk('http://localhost:8899/x', { PUSH_TEST_ORIGIN: 'http://localhost:8899' }), false);
  const key = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString('base64url');
  assert.equal(P.keysOk(key, Buffer.alloc(16).toString('base64url')), true);
  assert.equal(P.keysOk(key, Buffer.alloc(15).toString('base64url')), false);
  assert.equal(P.keysOk(Buffer.alloc(65, 1).toString('base64url'), Buffer.alloc(16).toString('base64url')), false);
  assert.equal(P.keysOk('!!!', 'x'), false);
  assert.equal(P.unb64u('a'), null);                                   // 길이가 맞지 않는 글자
});

test('알림 문구: 고른 언어로, 배치와 단계만 넣는다', async () => {
  const P = await load(), b = { title: 'Handcarry Korea', no: 4 };
  assert.deepEqual(P.pushText(b, 3, 'id'), { title: 'Update pesanan · Nuhunie', body: 'Handcarry Korea #4: Dikirim ke Indonesia. Ketuk untuk lihat pesananmu.' });
  assert.equal(P.pushText(b, 3, 'ko').body, 'Handcarry Korea #4: 인도네시아로 배송 중. 눌러서 내 주문을 확인하세요.');
  const en = P.pushText(b, 3, 'en');
  assert.ok(!/pesanan|Ketuk/.test(en.title + en.body), '영어 문구가 다 있어야 한다: ' + JSON.stringify(en));
  assert.deepEqual(globalThis.GO.PUSH_STAGES.every(s => s > 0 && s <= globalThis.GO.LAST_STAGE), true);
});
