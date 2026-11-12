/* 여정 자동 실행: 고객과 운영자가 실제로 누르는 순서대로 화면을 조작하고 결과를 확인한다.
 * 사용법: 사이트를 연 브라우저 콘솔에서
 *   await import('./tests/e2e.js'); await runE2E()
 * 예시 데이터로 초기화한 뒤 실행하고, 끝나면 다시 초기화한다. (브라우저에 저장된 데이터가 지워진다) */
window.runE2E = async function () {
  const S = GO.store, X = GO.logic, out = [];
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const go = async h => { location.hash = h; await wait(80); };
  const type = (sel, v, ev) => { const e = typeof sel === 'string' ? $(sel) : sel; e.value = v; e.dispatchEvent(new Event(ev || 'input', { bubbles: true })); };
  const check = (name, ok, detail) => out.push({ name, ok: !!ok, detail: ok ? '' : String(detail) });
  const num = t => Number(String(t).replace(/[^\d]/g, ''));
  const attach = () => { const dt = new DataTransfer(); dt.items.add(new File(['x'], 'bukti.jpg', { type: 'image/jpeg' })); $('#proofFile').files = dt.files; $('#proofFile').dispatchEvent(new Event('input', { bubbles: true })); };
  const total = () => S.db.orders.reduce((s, o) => s + o.total, 0);

  S.reset(); $('.modal') && $('.modal').remove();
  $('[data-act=lang][data-id=id]').click();

  /* ── 고객 여정 ── */
  await go('#/');
  check('홈: 맨 위에 주문 조회 창이 있다', $('.hero form[data-form=track] input'));
  check('홈: 서비스 3개', $$('.svc').length === 3, $$('.svc').length);
  const ongoing = S.db.batches.filter(b => b.stage < GO.LAST_STAGE).length;
  check('홈: 진행 중 배치 목록이 저장소와 같다', $$('#app .rows .row').length === ongoing, $$('#app .rows .row').length + ' vs ' + ongoing);
  check('메뉴: 고객 메뉴에 계산기가 없다', !$$('#nav a').some(a => a.getAttribute('href') === '#/calc'));

  $('.svc[href="#/s/kr"]').click(); await wait(80);
  const nov = S.batchesOf('kr', '2026-11'), rec = X.monthRecap(nov, S.db.orders);
  check('서비스: 월 탭과 배치 목록이 나온다', $$('.tabs a').length === 2 && $$('.rows .row').length === nov.length);
  check('서비스: 월 집계의 주문 금액이 저장소 합과 같다', num($$('.stat b')[3].textContent) === rec.total, $$('.stat b')[3].textContent);
  check('서비스: 결제 완료 금액이 따로 나온다', num($$('.stat b')[4].textContent) === rec.paidTotal, $$('.stat b')[4].textContent);

  $('.row[href="#/b/kr-5"]').click(); await wait(80);
  check('배치: 단계 표시 6칸, 현재 칸 1개', $$('.steps li').length === 6 && $$('.steps li.cur').length === 1);
  check('배치: 주문번호가 공개 화면에 보이지 않는다', !S.ordersOf('kr-5').some(o => $('#app').innerText.includes(o.id)));

  $('#app a.btn[href="#/pay/kr-5"]').click(); await wait(80);
  check('결제: 배치가 미리 선택되어 있다', $('[data-pay=batchId]').value === 'kr-5');
  const o1 = S.db.orders[0], base1 = o1.total;
  type('#payLookup', 'TIDAK-ADA'); $('[data-act=pay-lookup]').click(); await wait(60);
  check('결제: 없는 주문번호는 안내가 나온다', $('#lookupMsg').className === 'err');
  type('#payLookup', o1.id.toLowerCase()); $('[data-act=pay-lookup]').click(); await wait(100);
  check('결제: 주문번호로 불러오면 내용이 채워지고 잠긴다', $('[data-pay=buyer]').value === o1.buyer && $('[data-pay=buyer]').readOnly && num($('[data-pay=base]').value) === base1);
  check('결제: QR과 결제 금액이 나온다', $('#qrC') && num($('#payOut .total b').textContent) === base1 + X.uniqueCode(o1.id), $('#payOut') && $('#payOut').innerText);
  $('form[data-form=pay] .btn.block').click(); await wait(60);
  check('결제: 증빙 없이 내면 막고 이유를 알려 준다', $('#payErr').textContent.length > 0 && S.order(o1.id).pay === 'unpaid');
  attach(); $('form[data-form=pay] .btn.block').click(); await wait(120);
  check('결제: 제출하면 확인 대기가 된다', S.order(o1.id).pay === 'pending' && S.order(o1.id).total === base1 + X.uniqueCode(o1.id), JSON.stringify(S.order(o1.id)));
  check('영수증: 주문번호와 금액이 맞다', $('.modal .receipt') && $('.modal').innerText.includes(o1.id) && num($('.modal .total b').textContent) === S.order(o1.id).total);
  $('.modal [data-act=modal-close]').click();
  check('조회: 제출 후 내 주문 1건으로 이동한다', location.hash === '#/track/' + o1.id && $$('.card').length === 1);
  check('조회: 결제 확인 전에는 결제 칸에 있다', $$('.card .steps li')[0].classList.contains('cur'));
  $('.card [data-act=receipt]').click(); await wait(40);
  check('조회: 영수증을 다시 볼 수 있다', !!$('.modal .receipt')); $('.modal') && $('.modal').remove();

  await go('#/pay/kr-5');
  const before = S.db.orders.length;
  type('[data-pay=buyer]', '@tester'); type('[data-pay=item]', 'Keyring uji'); type('[data-pay=base]', '50000');
  type('[data-pay=voucher]', 'go5000'); $('[data-act=pay-voucher]').click(); await wait(40);
  const shown = num($('#payOut .total b').textContent);
  attach(); $('form[data-form=pay] .btn.block').click(); await wait(120);
  const o2 = S.db.orders[S.db.orders.length - 1];
  check('결제: 새 주문은 금액 − 쿠폰 + 고유 코드', S.db.orders.length === before + 1 && o2.total === 50000 - 5000 + X.uniqueCode(o2.id) && shown === o2.total && o2.buyer === 'tester', JSON.stringify(o2) + ' shown ' + shown);
  $('.modal') && $('.modal').remove();

  /* ── 운영자 여정 ── */
  await go('#/admin/batch');
  const f = $('form[data-form=batch]');
  f.svc.value = 'kr'; f.no.value = '9'; f.title.value = 'Uji Coba'; f.month.value = '2026-11'; f.closeDate.value = '2026-11-30'; f.kurs.value = '11.5'; f.note.value = 'Catatan uji';
  f.querySelector('button').click(); await wait(80);
  check('관리자: 배치를 추가하면 저장된다', !!S.batch('kr-9'));
  f.isConnected || 1; const f2 = $('form[data-form=batch]');
  f2.svc.value = 'kr'; f2.no.value = '9'; f2.title.value = 'Dobel'; f2.querySelector('button').click(); await wait(60);
  check('관리자: 같은 번호의 배치는 막는다', $('#batchErr').textContent.length > 0 && S.db.batches.filter(b => b.id === 'kr-9').length === 1);
  await go('#/s/kr/2026-11');
  check('고객 화면: 새 배치가 바로 보인다', !!$('.row[href="#/b/kr-9"]'));
  await go('#/b/kr-9');
  check('고객 화면: 안내 문구가 보인다', $('#app').innerText.includes('Catatan uji'));

  await go('#/admin/order');
  type('[data-admin=batchId]', 'kr-9'); await wait(60);
  type('[data-admin=text]', '@nadya / Photocard random 1 pc / 2pcs / Rp 25.000\ndinda - album mini - 285k\nrara, acrylic stand, x1, ¥2000\nbaris tanpa harga');
  $('[data-act=classify]').click(); await wait(120);
  check('주문 입력: 4줄이 4행으로 나뉜다', $$('table.edit tbody tr').length >= 4 && $$('[data-row]').length === 16, $$('[data-row]').length);
  check('주문 입력: 못 읽은 칸이 표시된다', $$('td.miss').length >= 1);
  $('[data-act=rows-save]').click(); await wait(60);
  check('주문 입력: 빈 칸이 있으면 저장을 막는다', S.ordersOf('kr-9').length === 0 && $('#rowErr').textContent.length > 0);
  $$('[data-act=row-del]')[3].click(); await wait(60);
  $('[data-act=rows-save]').click(); await wait(80);
  const saved = S.ordersOf('kr-9');
  check('주문 입력: 3건이 저장되고 루피아 금액은 가격 × 수량', saved.length === 3 && saved[0].total === 50000 && saved[1].total === 285000, JSON.stringify(saved.map(o => o.total)));
  const d = S.db.calcDefaults, wantJpy = X.calcPrice({ price: 2000, qty: 1, kurs: GO.CURRENCIES.JPY.kurs, feeGo: d.feeGo, feeCo: d.feeCo, tax: d.tax, extra: 0 }).total;
  check('주문 입력: 엔화 가격은 계산기 기본 수식으로 환산된다', saved[2] && saved[2].total === wantJpy, (saved[2] && saved[2].total) + ' vs ' + wantJpy);

  await go('#/admin/pay');
  const okBtn = $('[data-act=pay-ok][data-id="' + o1.id + '"]');
  check('결제 확인: 고객이 낸 증빙이 대기 목록에 있다', !!okBtn);
  okBtn && okBtn.click(); await wait(60);
  check('결제 확인: 승인하면 결제 완료가 된다', S.order(o1.id).pay === 'paid');
  const noBtn = $('[data-act=pay-no][data-id="' + o2.id + '"]'); noBtn && noBtn.click(); await wait(60);
  check('결제 확인: 반려하면 반려 상태가 된다', S.order(o2.id).pay === 'rejected');
  await go('#/track/' + o2.id);
  check('조회: 반려된 주문은 다시 결제할 수 있다', !!$('.card a.btn[href^="#/pay/"]'));

  await go('#/admin/batch');
  type('[data-bstage="kr-5"]', '3', 'change'); await wait(40);
  await go('#/track/' + o1.id);
  const lis = $$('.card .steps li');
  check('조회: 단계를 바꾸면 고객 화면의 현재 칸이 따라 바뀐다', S.batch('kr-5').stage === 3 && lis[3].classList.contains('cur') && lis[2].classList.contains('done') && $('.where b').textContent === GO.STAGES[3][0], $('.where b').textContent);

  await go('#/calc');
  check('계산기: 관리자 탭 안에서 열린다', $('.tabs a.on') && $('.tabs a.on').getAttribute('href') === '#/admin/calc' && !!$('#calcOut .total'));
  type('[data-calc=price]', '2000'); type('[data-calc=qty]', '3'); await wait(40);
  check('계산기: 화면 금액이 계산 함수와 같다', num($('#calcOut .total b').textContent) === X.calcPrice(Object.assign({}, d, { price: 2000, qty: 3 })).total, $('#calcOut .total b').textContent);

  /* ── 경리 대조: 화면 합계 = CSV 합계 = 저장소 합계 ── */
  await go('#/admin/guide');
  let blob = null; const oc = URL.createObjectURL, ac = HTMLAnchorElement.prototype.click;
  URL.createObjectURL = b => { blob = b; return oc.call(URL, b); }; HTMLAnchorElement.prototype.click = function () {};
  $('[data-act=export]').click();
  URL.createObjectURL = oc; HTMLAnchorElement.prototype.click = ac;
  const csv = (await blob.text()).replace(/^﻿/, '').split('\r\n'), col = csv[0].split(',').indexOf('total_idr');
  const csvSum = csv.slice(1).reduce((s, l) => s + Number(l.split(',')[col]), 0);
  check('CSV: 행 수와 금액 합이 저장소와 같다', csv.length === S.db.orders.length + 1 && csvSum === total(), csvSum + ' vs ' + total());
  let screenSum = 0;
  for (const s of S.db.services) for (const m of S.monthsOf(s.id)) { await go('#/s/' + s.id + '/' + m); screenSum += num($$('.stat b')[3].textContent); }
  check('화면: 모든 월 집계의 합이 CSV 합과 같다', screenSum === csvSum, screenSum + ' vs ' + csvSum);

  S.reset(); await go('#/');
  const failed = out.filter(r => !r.ok);
  return { total: out.length, passed: out.length - failed.length, failed };
};
