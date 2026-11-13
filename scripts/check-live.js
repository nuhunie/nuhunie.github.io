// 배포 확인 (2026-11-13): main 에 올린 뒤 실제 사이트가 그 커밋으로 바뀌었는지 기다렸다가, 읽기만 하는 확인을 한다.
// usage: npm run check-live            (지금 내 컴퓨터의 커밋을 기다린다)
//        node scripts/check-live.js 1a66937   (그 커밋을 기다린다)
// 배포된 사이트의 데이터는 바꾸지 않는다(CLAUDE.md: 배포 주소는 읽기만 확인).
const { execSync } = require('child_process');

const SITE = 'https://nuhunie.pages.dev';
const want = (process.argv[2] || execSync('git rev-parse HEAD').toString()).trim();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = async p => { const r = await fetch(SITE + p + (p.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' }); return { status: r.status, text: await r.text() }; };

(async () => {
  const start = Date.now();
  let seen = '';
  while (Date.now() - start < 8 * 60 * 1000) {
    seen = (await get('/version.txt').catch(() => ({ text: '' }))).text.trim();
    if (seen.startsWith(want.slice(0, 7))) break;
    process.stdout.write('.');
    await sleep(10000);
  }
  console.log('');
  if (!seen.startsWith(want.slice(0, 7))) { console.log('✖ 아직 배포되지 않음: 사이트 ' + (seen.slice(0, 7) || '?') + ', 기다린 커밋 ' + want.slice(0, 7) + ' (GitHub Actions 를 확인)'); process.exit(1); }
  console.log('✔ 배포됨 ' + seen.slice(0, 7) + ' (' + Math.round((Date.now() - start) / 1000) + '초)');
  const checks = [
    ['손님 사이트', '/', r => r.status === 200 && r.text.includes('og:image')],
    ['관리자 사이트', '/admin/', r => r.status === 200],
    ['공개 목록', '/api/public', r => r.status === 200 && Array.isArray(JSON.parse(r.text).services)],
    ['알림 열쇠', '/api/push/key', r => r.status === 200 && JSON.parse(r.text).key.length > 20],
    ['링크 미리보기 그림', '/assets/og.png', r => r.status === 200],
    ['알림 받기 파일', '/sw.js', r => r.status === 200]
  ];
  let bad = 0;
  for (const [name, p, ok] of checks) {
    let r; try { r = await get(p); } catch (e) { r = { status: 0, text: '' }; }
    let pass = false; try { pass = ok(r); } catch (e) {}
    console.log((pass ? '✔ ' : '✖ ') + name + ' ' + p + ' (' + r.status + ')');
    if (!pass) bad++;
  }
  process.exit(bad ? 1 : 0);
})();
