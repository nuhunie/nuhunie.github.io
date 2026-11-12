// 웹 푸시 열쇠(VAPID) 만들기.
//   node scripts/vapid.js           내 컴퓨터용: .dev.vars 에 시험용 열쇠가 없으면 넣는다 (npm run setup 이 부른다)
//   node scripts/vapid.js --deploy  배포판용: 새 열쇠를 만들어 Cloudflare 비밀값으로 바로 넣는다. 열쇠는 화면에 찍지 않는다.
//
// 배포판 열쇠는 한 번만 만든다. 다시 만들면 그동안 고객들이 켠 알림이 모두 끊긴다(고객이 다시 켜야 한다).
// 열쇠가 없으면 사이트는 그대로 돌고, 조회 화면에 "알림 받기"가 나오지 않을 뿐이다.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { execSync } = require('child_process');

function makeKeys() {
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = privateKey.export({ format: 'jwk' });
  const pub = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
  return { VAPID_PUBLIC_KEY: pub.toString('base64url'), VAPID_PRIVATE_KEY: jwk.d };
}

if (process.argv.includes('--deploy')) {
  const keys = makeKeys(), root = path.join(__dirname, '..');
  for (const name of ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY']) {
    execSync('npx --yes wrangler pages secret put ' + name + ' --project-name nuhunie', { cwd: root, input: keys[name] + '\n', stdio: ['pipe', 'inherit', 'inherit'] });
  }
  console.log('배포판 알림 열쇠를 넣었습니다. 다음 배포부터 조회 화면에 "알림 받기"가 나옵니다.');
} else {
  const file = path.join(__dirname, '..', '.dev.vars');
  let vars = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (/^VAPID_PRIVATE_KEY=/m.test(vars)) { console.log('.dev.vars 에 알림 열쇠가 이미 있습니다.'); process.exit(0); }
  const keys = makeKeys();
  vars += (vars && !vars.endsWith('\n') ? '\n' : '') + 'VAPID_PUBLIC_KEY=' + keys.VAPID_PUBLIC_KEY + '\nVAPID_PRIVATE_KEY=' + keys.VAPID_PRIVATE_KEY + '\n';
  fs.writeFileSync(file, vars);
  console.log('.dev.vars 에 시험용 알림 열쇠를 넣었습니다.');
}
