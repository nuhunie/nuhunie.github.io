// 처음 한 번: 내 컴퓨터에서 서버를 돌릴 준비를 한다.   실행: npm run setup
//   1) .dev.vars 가 없으면 시험용 비밀값을 만들어 넣는다 (git에 올라가지 않는 파일)
//   2) 내 컴퓨터용 데이터베이스에 표를 만든다 (db/schema.sql)
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { execSync } = require('child_process');
const root = path.join(__dirname, '..');
const varsFile = path.join(root, '.dev.vars');

let vars = fs.existsSync(varsFile) ? fs.readFileSync(varsFile, 'utf8') : '# 내 컴퓨터에서 서버를 돌릴 때만 쓰는 시험용 값. git에 올리지 않는다.\n';
const need = {
  ADMIN_PASSWORD: () => crypto.randomBytes(9).toString('base64url'),
  SESSION_SECRET: () => crypto.randomBytes(32).toString('hex'),
  RATE_WINDOW_SEC: () => '6'                       // 횟수 제한 기간을 짧게 (검사가 빨리 끝나도록)
};
let added = [];
for (const key of Object.keys(need)) {
  if (new RegExp('^' + key + '=', 'm').test(vars)) continue;
  vars += (vars.endsWith('\n') ? '' : '\n') + key + '=' + need[key]() + '\n';
  added.push(key);
}
fs.writeFileSync(varsFile, vars);
console.log(added.length ? '.dev.vars 에 추가: ' + added.join(', ') : '.dev.vars 는 이미 준비되어 있습니다.');

execSync('npx --yes wrangler d1 execute nuhunie --local --file db/schema.sql', { cwd: root, stdio: 'inherit' });
console.log('준비 끝.  서버 실행: npm run dev');
