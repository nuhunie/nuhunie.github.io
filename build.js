// 화면 파일만 dist/에 모은다. (테스트·서버 코드·설정 파일이 사이트에 올라가지 않게)
//   실행: node build.js
const fs = require('fs'), path = require('path');
const out = path.join(__dirname, 'dist');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);
for (const name of ['index.html', 'admin', 'css', 'js', 'assets']) fs.cpSync(path.join(__dirname, name), path.join(out, name), { recursive: true });
console.log('dist ready');
