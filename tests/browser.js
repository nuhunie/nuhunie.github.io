// 화면 검사를 브라우저로 자동으로 돌린다 (2026-11-13: GitHub 검사에 화면 여정·휴대폰 모양을 넣음).
// usage: npm run test:screen   또는 node tests/browser.js [목업판 주소]
//   주소를 주지 않으면 저장소 폴더를 직접 띄워(빈 포트) 그 목업판에서 돈다.
//   1. 컴퓨터 너비(1280px)에서 runE2E: 손님·운영자가 누르는 순서 그대로
//   2. 휴대폰 너비(360·375·412px)에서 runLayout: 가로 넘침·숫자 가운데·겹침·단추 높이·잘린 글자
// 필요한 것: npm i --no-save playwright@1.49.1 && npx playwright install chromium
// 목업판(브라우저 저장)이라 서버·배포된 사이트는 건드리지 않는다.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');

const runs = [['runE2E', 1280, 900], ['runLayout', 360, 780], ['runLayout', 375, 812], ['runLayout', 412, 900]];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };

// 저장소 폴더를 그대로 내주는 작은 서버 (npm run mock 과 같은 역할)
function serveRepo() {
  const root = path.join(__dirname, '..');
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.normalize(path.join(root, p));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(ok => server.listen(0, '127.0.0.1', () => ok(server)));
}

(async () => {
  const server = process.argv[2] ? null : await serveRepo();
  const base = process.argv[2] || 'http://127.0.0.1:' + server.address().port + '/site/';
  const browser = await chromium.launch();
  let bad = 0;
  for (const [fn, width, height] of runs) {
    const phone = width < 768;
    const ctx = await browser.newContext({ viewport: { width, height }, isMobile: phone, hasTouch: phone, locale: 'id-ID' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(base);
    await page.waitForFunction(() => window.GO && GO.store && GO.render, null, { timeout: 15000 });
    await page.waitForTimeout(500);
    const r = await page.evaluate(async name => { await import('../tests/e2e.js'); return await window[name](); }, fn);
    console.log(fn + ' ' + width + 'px: ' + r.passed + '/' + r.total);
    r.failed.forEach(f => console.log('  ✖ ' + f.name + (f.detail ? ' — ' + f.detail : '')));
    errors.forEach(m => console.log('  ✖ 화면 오류: ' + m));
    bad += r.failed.length + errors.length;
    await ctx.close();
  }
  await browser.close();
  if (server) server.close();
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
