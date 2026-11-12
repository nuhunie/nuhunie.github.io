/* 4층: 화면 — 주소(#/...)를 보고 어느 화면을 그릴지 정하고, 클릭·입력을 받아
 * 저장소(store)와 알고리즘(logic)을 호출한다. 계산은 여기서 하지 않는다.
 *
 *  #/                    홈: 서비스 목록 + 주문 조회
 *  #/s/:svc/:month       서비스 → 월별 배치 목록 + 월 집계
 *  #/b/:batchId          배치 상세: 진행 단계 + 리캡
 *  #/track/:query        주문 조회 결과
 *  #/calc                계산기
 *  #/pay/:batchId/:order 결제 확인(입금 증빙 제출) → 영수증
 *  #/admin/:tab          관리자: guide | batch | order | pay
 */
(function (GO) {
  var S = GO.store, X = GO.logic;
  // 한 벌의 코드로 두 사이트를 그린다. 어느 쪽인지는 그 페이지의 <html data-app> 가 정한다.
  //   site   고객 사이트 (/)        관리자 화면이 아예 없다
  //   admin  관리자 사이트 (/admin/)  관리자 화면만 있다
  GO.app = document.documentElement.getAttribute('data-app') || 'site';
  var ROOT = GO.app === 'admin' ? '../' : '';   // 관리자 페이지에서 본 사이트 뿌리
  var lang = 'id';
  try { lang = localStorage.getItem('go-lang') || 'id'; } catch (e) {}

  /* ── 공통 도구 ── */
  function L(id, ko) { return lang === 'ko' ? ko : lang === 'en' ? (GO.EN[id] || id) : id; }
  function LL(pair) { return L(pair[0], pair[1]); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function rp(n) { return 'Rp' + Math.round(n || 0).toLocaleString('id-ID'); }
  function loc() { return { ko: 'ko-KR', en: 'en-GB' }[lang] || 'id-ID'; }
  function monthLabel(m) { return new Date(m + '-01T00:00:00').toLocaleDateString(loc(), { year: 'numeric', month: 'long' }); }
  function dateLabel(d) { return d ? new Date(d.length > 10 ? d : d + 'T00:00:00').toLocaleDateString(loc(), { day: 'numeric', month: 'short', year: 'numeric' }) : '-'; }
  function $(sel) { return document.querySelector(sel); }
  function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }
  function batchName(b) { return 'Batch ' + b.no + ' · ' + b.title; }
  function stageBadge(b) {
    var cls = b.stage === GO.LAST_STAGE ? 'done' : b.stage === 0 ? 'open' : 'run';
    return '<span class="badge ' + cls + '">' + esc(LL(GO.STAGES[b.stage])) + '</span>';
  }
  function payBadge(p) { return '<span class="badge pay-' + p + '">' + esc(LL(GO.PAY[p])) + '</span>'; }
  function crumbs(list) {
    return '<nav class="crumbs">' + list.map(function (c) { return c[1] ? '<a href="' + c[1] + '">' + esc(c[0]) + '</a>' : '<span>' + esc(c[0]) + '</span>'; }).join('<i>/</i>') + '</nav>';
  }
  function stat(label, value) { return '<div class="stat"><span>' + esc(label) + '</span><b>' + esc(value) + '</b></div>'; }
  function stepper(labels, cur, finished) {
    return '<ol class="steps">' + labels.map(function (l, i) {
      var cls = finished || i < cur ? 'done' : i === cur ? 'cur' : '';
      return '<li class="' + cls + '"><em>' + (i + 1) + '</em><span>' + esc(l) + '</span></li>';
    }).join('') + '</ol>';
  }
  function empty(msg) { return '<p class="empty">' + esc(msg) + '</p>'; }
  function searchForm(q) {
    return '<form class="search" data-form="track"><input name="q" value="' + esc(q || '') + '" placeholder="' + L('Nomor pesanan', '주문번호') + '" aria-label="' + L('Cari pesanan', '주문 검색') + '"><button class="btn">' + L('Cari', '조회') + '</button></form>';
  }

  /* ── 홈 ── */
  function vHome() {
    var cards = S.db.services.map(function (s) {
      var ongoing = S.batchesOf(s.id).filter(function (b) { return b.stage < GO.LAST_STAGE; }).length;
      return '<a class="svc" href="#/s/' + s.id + '"><h3>' + esc(LL(s.name)) + '</h3><p>' + esc(LL(s.desc)) + '</p>' +
        '<span class="meta">' + L('Batch berjalan', '진행 중 배치') + ' <b>' + ongoing + '</b></span><span class="more">' + L('Lihat batch', '배치 보기') + ' →</span></a>';
    }).join('');
    var how = [
      [L('Pilih layanan dan batch', '서비스와 배치 선택'), L('Cek batch yang sedang open order di bulan ini.', '이번 달 접수 중인 배치를 확인합니다.')],
      [L('Bayar dan kirim bukti', '결제 후 증빙 제출'), L('Scan QR dengan nominal otomatis, lalu unggah bukti.', '금액이 자동 입력된 QR로 결제하고 증빙을 올립니다.')],
      [L('Lacak pesanan', '주문 조회'), L('Cek posisi pesanan kapan saja dengan nomor pesanan.', '주문번호로 언제든 진행 상황을 확인합니다.')]
    ].map(function (h, i) { return '<li><em>' + (i + 1) + '</em><div><b>' + esc(h[0]) + '</b><p>' + esc(h[1]) + '</p></div></li>'; }).join('');
    var ongoing = S.db.batches.filter(function (b) { return b.stage < GO.LAST_STAGE; })
      .sort(function (a, b) { return a.stage - b.stage || (a.closeDate < b.closeDate ? -1 : 1); })
      .map(function (b) { return batchRow(b, true); }).join('');
    return '<section class="hero"><img src="' + GO.BRAND.mark + '" alt="" width="72" height="72"><div><h1>' + esc(GO.BRAND.name) + '</h1><p>' + esc(LL(GO.BRAND.tagline)) + '</p>' + searchForm('') + '</div></section>' +
      '<section><h2>' + L('Layanan', '서비스') + '</h2><p class="lead">' + L('Pilih layanan untuk melihat batch bulan ini dan rekapnya.', '서비스를 고르면 이번 달 배치와 집계를 볼 수 있습니다.') + '</p><div class="svc-grid">' + cards + '</div></section>' +
      '<section><h2>' + L('Batch yang sedang berjalan', '진행 중인 배치') + '</h2>' + (ongoing ? '<div class="rows">' + ongoing + '</div>' : empty(L('Belum ada batch.', '아직 배치가 없습니다.'))) + '</section>' +
      '<section><h2>' + L('Cara order', '이용 방법') + '</h2><ol class="how">' + how + '</ol></section>';
  }

  // 배치 목록의 한 줄. withSvc가 참이면 서비스 이름을 함께 적는다(홈의 진행 중 목록용).
  function batchRow(b, withSvc) {
    return '<a class="row plain" href="#/b/' + b.id + '"><div><b>' + esc((withSvc ? LL(S.service(b.svc).name) + ' · ' : '') + batchName(b)) + '</b><small>' + L('Tutup order', '주문 마감') + ' ' + esc(dateLabel(b.closeDate)) + '</small></div>' +
      stageBadge(b) + '<span class="arrow" aria-hidden="true">→</span></a>';
  }

  /* ── 서비스 → 월별 배치 ── */
  function vService(svcId, month) {
    var s = S.service(svcId);
    if (!s) return empty(L('Layanan tidak ditemukan.', '서비스를 찾을 수 없습니다.'));
    var months = S.monthsOf(svcId);
    if (!month || months.indexOf(month) < 0) month = months[0];
    var tabs = months.map(function (m) { return '<a class="' + (m === month ? 'on' : '') + '" href="#/s/' + svcId + '/' + m + '">' + esc(monthLabel(m)) + '</a>'; }).join('');
    var list = month ? S.batchesOf(svcId, month) : [];
    var r = S.monthRecap(list);
    var rows = list.map(function (b) { return batchRow(b, false); }).join('');
    return crumbs([[L('Layanan', '서비스'), '#/'], [LL(s.name)]]) +
      '<h1>' + esc(LL(s.name)) + '</h1><p class="lead">' + esc(LL(s.desc)) + '</p>' +
      (months.length ? '<div class="tabs">' + tabs + '</div>' +
        '<h2 class="sub">' + L('Rekap bulan ini', '월 집계') + ' · ' + esc(monthLabel(month)) + '</h2>' +
        '<div class="stats three">' + stat(L('Batch', '배치'), r.batches) + stat(L('Sedang berjalan', '진행 중'), r.ongoing) + stat(L('Jumlah pcs', '수량'), r.pcs) + '</div>' +
        '<h2 class="sub">' + L('Daftar batch', '배치 목록') + '</h2><div class="rows">' + rows + '</div>'
        : empty(L('Belum ada batch.', '아직 배치가 없습니다.')));
  }

  /* ── 배치 상세 + 리캡 ── */
  function vBatch(id) {
    var b = S.batch(id);
    if (!b) return empty(L('Batch tidak ditemukan.', '배치를 찾을 수 없습니다.'));
    var s = S.service(b.svc), r = S.recap(id);
    return crumbs([[L('Layanan', '서비스'), '#/'], [LL(s.name), '#/s/' + s.id + '/' + b.month], [batchName(b)]]) +
      '<div class="head"><div><h1>' + esc(batchName(b)) + '</h1><p class="lead">' + esc(monthLabel(b.month)) + ' · ' + L('Tutup order', '주문 마감') + ' ' + esc(dateLabel(b.closeDate)) + '</p></div>' +
      '<a class="btn" href="#/pay/' + b.id + '">' + L('Konfirmasi pembayaran', '결제 확인하기') + '</a></div>' +
      stepper(GO.STAGES.map(LL), b.stage, b.stage === GO.LAST_STAGE) +
      (b.note ? '<p class="note"><b>' + L('Info', '안내') + '</b> ' + esc(b.note) + '</p>' : '') +
      '<div id="batchOut">' + (r.pcs ? '<p class="hint">' + L('Memuat…', '불러오는 중…') + '</p>' : empty(L('Belum ada pesanan di batch ini.', '이 배치에는 아직 주문이 없습니다.'))) + '</div>';
  }
  // 품목별 수량만 보여 준다. 누가 무엇을 샀는지, 금액, 결제 여부는 고객 화면에 내보내지 않는다.
  function drawBatch(id) {
    var b = S.batch(id);
    if (!b || !S.recap(id).pcs) return;
    S.batchItems(id).then(function (items) {
      var out = $('#batchOut');
      if (!out || route()[1] !== id) return;
      var total = items.reduce(function (s, it) { return s + it.qty; }, 0);
      out.innerHTML = '<h2 class="sub">' + L('Rekap per item', '품목별 집계') + '</h2><div class="tbl"><table><thead><tr><th>Item</th><th class="r">' + L('Jumlah', '수량') + '</th></tr></thead><tbody>' +
        items.map(function (it) { return '<tr><td>' + esc(it.item) + '</td><td class="r">' + it.qty + '</td></tr>'; }).join('') +
        '<tr class="sum"><td>' + L('Total', '합계') + '</td><td class="r">' + total + '</td></tr></tbody></table></div>' +
        '<p class="hint">' + L('Untuk melihat pesanan Anda sendiri, buka Lacak pesanan dan masukkan nomor pesanan.', '내 주문은 주문 조회에서 주문번호로 확인하세요.') + '</p>';
    }, function () { var out = $('#batchOut'); if (out) out.innerHTML = empty(L('Gagal memuat. Coba lagi.', '불러오지 못했습니다. 다시 시도해 주세요.')); });
  }

  /* ── 주문 조회 ── */
  /* 이 기기에서 결제했거나 주문번호로 조회한 주문을 기억해 둔다 (주문번호를 잊었을 때를 위해).
   * 브라우저에만 저장하고 서버에는 보내지 않는다. */
  var MY_KEY = 'nuh-my-orders';
  function myOrders() {
    try { return (JSON.parse(localStorage.getItem(MY_KEY)) || []).filter(function (x) { return x && X.isOrderId(x.id); }); } catch (e) { return []; }
  }
  function rememberOrder(o) {
    if (!o || !X.isOrderId(o.id)) return;
    var list = myOrders().filter(function (x) { return x.id !== o.id; });
    list.unshift({ id: o.id, item: String(o.item || '').slice(0, 80) });
    try { localStorage.setItem(MY_KEY, JSON.stringify(list.slice(0, 10))); } catch (e) {}
  }
  function myOrdersHtml() {
    var list = myOrders();
    if (!list.length) return '';
    return '<section class="mine"><h2 class="sub">' + L('Pesanan di perangkat ini', '이 기기에서 본 주문') + '</h2><div class="rows">' +
      list.map(function (x) { return '<a class="row two-col" href="#/track/' + x.id + '"><div><b>' + x.id + '</b><small>' + esc(x.item) + '</small></div><span class="arrow" aria-hidden="true">→</span></a>'; }).join('') +
      '</div><p class="hint">' + L('Daftar ini hanya tersimpan di perangkat ini.', '이 목록은 이 기기에만 저장됩니다.') + ' <button type="button" class="link" data-act="my-clear">' + L('Hapus daftar', '목록 지우기') + '</button></p></section>';
  }
  var receipts = {};   // 영수증으로 보여 줄 주문: 조회 결과와 방금 결제한 주문
  function trackCards(found) {
    var labels = [L('Pembayaran', '결제')].concat(GO.STAGES.slice(1).map(LL));
    return found.map(function (o) {
      var b = S.batch(o.batchId), s = S.service(b.svc), p = X.orderProgress(o, b);
      if (o.id) receipts[o.id] = o;
      return '<article class="card"><div class="head"><div><small>' + (o.id ? o.id + ' · ' : '') + esc(dateLabel(o.createdAt)) + '</small><h2>' + esc(o.item) + '</h2>' +
        '<p class="lead">' + esc(o.buyer) + ' · ' + o.qty + ' pcs · ' + rp(o.total) + '</p></div><div class="right">' + payBadge(o.pay) + '</div></div>' +
        (o.late ? '<p class="note warn">' + L('Pesanan ini masuk setelah tutup order, jadi diproses terpisah dari batch. Admin akan mengabari jadwalnya.', '이 주문은 마감 뒤에 들어와 배치와 따로 처리됩니다. 일정은 운영자가 알려 드립니다.') + '</p>' : stepper(labels, p.cur, p.finished)) +
        '<p class="where">' + L('Posisi sekarang', '현재 위치') + ': <b>' + esc(o.late ? LL(GO.PAY[o.pay]) + ' · ' + L('diproses terpisah', '별도 처리') : o.pay === 'paid' ? LL(GO.STAGES[b.stage]) : LL(GO.PAY[o.pay])) + '</b> · <a href="#/b/' + b.id + '">' + esc(LL(s.name) + ' / ' + batchName(b)) + '</a></p>' +
        (b.note ? '<p class="note"><b>' + L('Info', '안내') + '</b> ' + esc(b.note) + '</p>' : '') +
        (o.pay === 'unpaid' || o.pay === 'rejected' ? '<a class="btn" href="#/pay/' + b.id + '/' + o.id + '">' + L('Bayar pesanan ini', '이 주문 결제하기') + '</a>'
          : '<button type="button" class="btn line" data-act="receipt" data-id="' + o.id + '">' + L('Lihat bukti pesanan', '영수증 보기') + '</button>') + '</article>';
    }).join('');
  }
  function vTrack(q) {
    var first = S.db.orders[0];
    return '<h1>' + L('Lacak pesanan', '주문 조회') + '</h1><p class="lead">' + L('Masukkan nomor pesanan untuk melihat posisi dan status pesanan Anda.', '주문번호를 입력하면 내 주문의 위치와 상태를 볼 수 있습니다.') + '</p>' + searchForm(q) +
      '<div id="trackOut" aria-live="polite">' + (!q && S.mode === 'local' && first && first.id ? '<p class="hint">' + L('Contoh', '예시') + ': ' + first.id + '</p>' : '') + '</div>' + (q ? '' : myOrdersHtml()) +
      '<p class="hint">' + L('Lupa nomor pesanan? Buka halaman ini di perangkat yang dipakai saat order, atau hubungi admin.', '주문번호를 잊었다면 주문할 때 쓴 기기에서 이 화면을 열거나 운영자에게 문의하세요.') + '</p>';
  }
  // 조회 결과는 저장소에 물어본 뒤 채운다 (서버에서는 주문번호·아이디가 맞는 주문만 돌려준다)
  function drawTrack(q) {
    if (!q) return;
    S.track(q).then(function (found) {
      var out = $('#trackOut');
      if (!out || (route()[1] || '') !== q) return;
      found.forEach(rememberOrder);                 // 주문번호로 찾은 주문은 이 기기에 기억해 둔다
      out.innerHTML = found.length ? '<p class="count">' + found.length + ' ' + L('pesanan ditemukan', '건 찾음') + '</p>' + trackCards(found)
        : empty(L('Pesanan tidak ditemukan. Periksa lagi nomor pesanan.', '주문을 찾지 못했습니다. 주문번호를 다시 확인해 주세요.'));
    }, function () {
      var out = $('#trackOut');
      if (out) out.innerHTML = empty(L('Gagal memuat. Coba lagi.', '불러오지 못했습니다. 다시 시도해 주세요.'));
    });
  }

  /* ── 계산기 ── */
  var C = null;
  function seg(name, mode) {
    // 칸이 좁아도 들어가도록 기호만 보여 주고, 뜻은 title과 아래 설명 줄에 둔다
    return '<div class="seg mini" data-seg="' + name + '">' + [['pct', '%', L('Persen', '퍼센트')], ['nom', 'Rp', L('Nominal per pcs', '개당 금액')], ['mul', '×', L('Pengali', '배수')]].map(function (m) {
      return '<button type="button" class="' + (mode === m[0] ? 'on' : '') + '" data-mode="' + m[0] + '" title="' + m[2] + '" aria-label="' + m[2] + '" aria-pressed="' + (mode === m[0]) + '">' + m[1] + '</button>';
    }).join('') + '</div>';
  }
  function modeHint(mode) {
    return mode === 'pct' ? L('persen dari harga konversi', '환산가의 입력값%') : mode === 'nom' ? L('nominal × jumlah pcs', '입력값 × 수량') : L('harga konversi × nilai', '환산가 × 입력값');
  }
  function vCalc() {
    if (!C) C = JSON.parse(JSON.stringify(S.db.calcDefaults));
    var cur = GO.CURRENCIES[C.cur];
    function fee(key, label) {
      return '<div class="field"><div class="lab"><label>' + label + '</label>' + seg(key, C[key].mode) + '</div><input type="number" step="any" data-calc="' + key + '.val" value="' + C[key].val + '" aria-label="' + label + '"><small>' + modeHint(C[key].mode) + '</small></div>';
    }
    return '<div class="head sub-head"><div><h2>' + L('Kalkulator harga', '가격 계산기') + '</h2><p class="lead">' + L('Atur cara hitung tiap biaya: persen, nominal per pcs, atau pengali.', '수수료마다 퍼센트·개당 금액·배수 중에서 고를 수 있습니다.') + '</p></div>' +
      '<div class="btns"><button class="btn line" data-act="calc-reset">' + L('Muat default', '기본값 불러오기') + '</button><button class="btn" data-act="calc-save">' + L('Simpan sebagai default', '기본값으로 저장') + '</button></div></div>' +
      '<div class="two"><div class="panel"><h2>' + L('Data harga', '계산 입력') + '</h2><div class="grid2">' +
      '<div class="field"><label>' + L('Mata uang', '통화') + '</label><select data-calc="cur">' + Object.keys(GO.CURRENCIES).map(function (k) { return '<option value="' + k + '"' + (k === C.cur ? ' selected' : '') + '>' + GO.CURRENCIES[k].label + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label>' + L('Kurs manual', '환율 직접 입력') + ' (1 ' + C.cur + ' = ? IDR)</label><input type="number" step="any" data-calc="kurs" value="' + C.kurs + '"></div>' +
      '<div class="field"><label>' + L('Harga asli per pcs', '개당 원가') + ' (' + cur.sym + ')</label><input type="number" step="any" data-calc="price" value="' + C.price + '"></div>' +
      '<div class="field"><label>' + L('Jumlah (pcs)', '수량') + '</label><input type="number" min="1" data-calc="qty" value="' + C.qty + '"></div>' +
      fee('feeGo', 'Fee jastip') + fee('feeCo', 'Fee CO') + fee('tax', L('Pajak', '세금')) +
      '<div class="field"><div class="lab"><label>' + L('Dasar pajak', '세금 기준') + '</label></div><select data-calc="tax.base"><option value="conv"' + (C.tax.base === 'conv' ? ' selected' : '') + '>' + L('Dari harga konversi', '환산가 기준') + '</option><option value="convfee"' + (C.tax.base === 'convfee' ? ' selected' : '') + '>' + L('Dari harga konversi + fee', '환산가 + 수수료 기준') + '</option></select></div>' +
      '<div class="field span2"><label>' + L('Biaya tambahan lain (IDR)', '기타 추가 비용 (IDR)') + '</label><input type="number" data-calc="extra" value="' + C.extra + '"><small>' + L('Contoh: ongkir internasional, packing (total)', '국제 배송비, 포장비 등 (합계)') + '</small></div>' +
      '</div></div><div class="panel"><h2>' + L('Rincian biaya', '자동 계산 내역') + '</h2><div id="calcOut"></div></div></div>';
  }
  function feeDesc(rule) {
    return rule.mode === 'pct' ? rule.val + '% × ' + L('harga konversi', '환산가') : rule.mode === 'nom' ? rp(rule.val) + ' × ' + C.qty + ' pcs' : L('harga konversi', '환산가') + ' × ' + rule.val;
  }
  function drawCalc() {
    var out = $('#calcOut'); if (!out) return;
    var r = X.calcPrice(C), cur = GO.CURRENCIES[C.cur];
    function line(label, desc, v) { return '<div class="brk"><div><b>' + label + '</b><small>' + esc(desc) + '</small></div><span>' + rp(v) + '</span></div>'; }
    out.innerHTML = line(L('Harga konversi', '환산가'), cur.sym + Number(C.price || 0).toLocaleString('id-ID') + ' × ' + r.qty + ' pcs × kurs ' + C.kurs, r.conv) +
      line('Fee jastip', feeDesc(C.feeGo), r.feeGo) + line('Fee CO', feeDesc(C.feeCo), r.feeCo) +
      line(L('Pajak', '세금'), feeDesc(C.tax), r.tax) + line(L('Biaya tambahan', '추가 비용'), L('total', '합계'), r.extra) +
      '<div class="total"><span>' + L('Total harga', '최종 금액') + '</span><b>' + rp(r.total) + '</b></div>' +
      '<p class="hint">' + L('Per pcs', '개당') + ' ' + rp(r.perPcs) + '</p>';
  }
  function setPath(obj, path, v) { var p = path.split('.'); if (p.length === 2) obj[p[0]][p[1]] = v; else obj[p[0]] = v; }

  /* ── 결제 확인 ── */
  var P = null;
  function initPay(batchId, orderId) {
    var b = S.batch(batchId);
    if (!b || b.stage === GO.LAST_STAGE) b = S.db.batches.filter(function (x) { return x.stage < GO.LAST_STAGE; })[0] || S.db.batches[0];
    P = { svc: b.svc, batchId: b.id, orderId: '', id: S.newOrderId(), buyer: '', item: '', qty: 1, base: '', voucher: '', off: 0, method: 'QRIS', fileName: '', err: '' };
    if (!orderId) return;
    var mine = P;
    S.fetchOrder(orderId).then(function (o) {
      if (!o || P !== mine) return;
      var ob = S.batch(o.batchId) || b;
      Object.assign(P, { svc: ob.svc, batchId: ob.id, orderId: o.id, id: o.id, buyer: o.buyer, item: o.item, qty: o.qty, base: o.base || o.total });
      render();
    });
  }
  function payAmount() {
    var base = Number(P.base) || 0;
    if (!base) return { base: 0, off: 0, code: 0, total: 0 };
    var code = X.uniqueCode(P.id), off = Math.min(P.off, base);
    return { base: base, off: off, code: code, total: base - off + code };
  }
  function vPay() {
    var svcs = S.db.services.map(function (s) { return '<button type="button" class="' + (s.id === P.svc ? 'on' : '') + '" data-act="pay-svc" data-id="' + s.id + '"' + (P.orderId ? ' disabled' : '') + '>' + esc(LL(s.name)) + '</button>'; }).join('');
    var bs = S.batchesOf(P.svc).filter(function (b) { return b.stage < GO.LAST_STAGE || (P.orderId && b.id === P.batchId); }).map(function (b) { return '<option value="' + b.id + '"' + (b.id === P.batchId ? ' selected' : '') + '>' + esc(batchName(b)) + ' (' + esc(monthLabel(b.month)) + ')</option>'; }).join('');
    var lock = P.orderId ? ' readonly' : '';
    return '<h1>' + L('Konfirmasi pembayaran', '결제 확인') + '</h1><p class="lead">' + L('Isi data pesanan, bayar lewat QR, lalu unggah bukti pembayaran.', '주문 정보를 입력하고 QR로 결제한 뒤 증빙을 올려 주세요.') + '</p>' +
      '<form class="two" data-form="pay"><div class="panel"><h2>' + L('Data pesanan', '주문 정보') + '</h2>' +
      (P.orderId ? '<p class="note">' + L('Pesanan', '주문') + ' <b>' + P.orderId + '</b> · <a href="#/pay">' + L('Isi manual', '직접 입력하기') + '</a></p>'
        : '<div class="field"><label>' + L('Sudah punya nomor pesanan?', '주문번호가 있나요?') + '</label><div class="inline"><input id="payLookup" placeholder="' + GO.BRAND.orderPrefix + '-7K3M9Q2X" autocomplete="off"><button type="button" class="btn line" data-act="pay-lookup">' + L('Muat', '불러오기') + '</button></div><small id="lookupMsg">' + L('Data pesanan terisi otomatis.', '주문 정보가 자동으로 채워집니다.') + '</small></div>') +
      '<div class="field"><label>' + L('Pilih layanan', '서비스 선택') + ' *</label><div class="seg wide">' + svcs + '</div></div>' +
      '<div class="field"><label>' + L('Nomor batch', '배치 번호') + ' *</label><select data-pay="batchId"' + (P.orderId ? ' disabled' : '') + '>' + bs + '</select></div>' + lateNotice() +
      '<div class="grid2"><div class="field"><label>' + L('Nama / username pembeli', '구매자 이름·아이디') + ' *</label><input data-pay="buyer" value="' + esc(P.buyer) + '"' + lock + '></div>' +
      '<div class="field"><label>' + L('Jumlah (pcs)', '수량') + '</label><input type="number" min="1" data-pay="qty" value="' + P.qty + '"' + lock + '></div></div>' +
      '<div class="field"><label>Item *</label><input data-pay="item" value="' + esc(P.item) + '" placeholder="Photocard random 1 pc"' + lock + '></div>' +
      '<div class="field"><label>' + L('Total harga (Rp)', '총 금액 (Rp)') + ' *</label><input type="number" data-pay="base" value="' + P.base + '"' + lock + '></div>' +
      '<div class="field"><label>' + L('Voucher diskon', '할인 쿠폰') + '</label><div class="inline"><input data-pay="voucher" value="' + esc(P.voucher) + '" placeholder="' + L('Kode voucher', '쿠폰 코드') + '"><button type="button" class="btn line" data-act="pay-voucher">' + L('Pakai', '적용') + '</button></div><small id="vMsg">' + (P.off ? L('Voucher aktif', '쿠폰 적용됨') + ': −' + rp(P.off) : L('Tidak ada voucher dipakai', '적용된 쿠폰 없음')) + '</small></div>' +
      '</div><div class="panel"><h2>' + L('Pembayaran', '결제') + '</h2>' +
      '<div class="field"><label>' + L('Metode pembayaran', '결제 수단') + '</label><div class="seg wide">' + ['QRIS', 'Transfer bank'].map(function (m) { return '<button type="button" class="' + (P.method === m ? 'on' : '') + '" data-act="pay-method" data-id="' + m + '">' + (m === 'QRIS' ? m : L('Transfer bank', '계좌 이체')) + '</button>'; }).join('') + '</div></div>' +
      '<div id="payOut"></div>' +
      '<div class="field"><label>' + L('Bukti pembayaran', '결제 증빙') + ' *</label><div class="file"><input type="file" id="proofFile" class="sr" accept="image/*" data-pay="file"><label for="proofFile" class="btn line">' + L('Pilih file', '파일 선택') + '</label><span id="fileName">' + esc(P.fileName || L('Belum ada file dipilih', '선택된 파일 없음')) + '</span></div><small>' + L('Screenshot atau foto bukti transfer.', '이체 화면 캡처나 사진.') + '</small></div>' +
      '<p class="err" id="payErr" role="alert">' + esc(P.err) + '</p>' +
      '<button class="btn block">' + L('Kirim bukti pembayaran', '결제 증빙 제출') + '</button></div></form>';
  }
  // 주문이 마감된 배치에 새 주문을 넣으려 할 때의 안내. 이미 진행 중인 배치와 같은 처리를 해 줄 수 없다는 점을 결제 전에 알린다.
  function lateNotice() {
    var b = S.batch(P.batchId);
    if (P.orderId || !b || b.stage < 1) return '';
    return '<p class="note warn"><b>' + L('Perhatian', '주의') + '</b> ' + L('Batch ini sudah tutup order. Pesanan baru tetap diterima, tetapi diproses terpisah dari batch ini dan bisa ikut pengiriman berikutnya.', '이 배치는 주문이 마감됐습니다. 새 주문은 받지만 이 배치와 따로 처리되며 다음 배송에 포함될 수 있습니다.') +
      ' (' + L('Tahap sekarang', '현재 단계') + ': ' + esc(LL(GO.STAGES[b.stage])) + ')</p>';
  }
  // 관리자 화면에서 마감 뒤 주문을 알아보게 하는 표시
  function lateBadge(o) { return o.late ? ' <span class="badge run">' + L('Setelah tutup order', '마감 뒤 주문') + '</span>' : ''; }
  function drawQR(canvas, seedStr) {
    var n = 25, c = canvas.getContext('2d'), px = canvas.width / n, h = 7;
    for (var i = 0; i < seedStr.length; i++) h = (h * 31 + seedStr.charCodeAt(i)) >>> 0;
    function rnd() { h ^= h << 13; h >>>= 0; h ^= h >> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; }
    c.fillStyle = '#fff'; c.fillRect(0, 0, canvas.width, canvas.width); c.fillStyle = '#111';
    for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) if (rnd() > 0.5) c.fillRect(x * px, y * px, px, px);
    [[0, 0], [n - 7, 0], [0, n - 7]].forEach(function (p) {
      c.fillStyle = '#fff'; c.fillRect(p[0] * px - px, p[1] * px - px, 9 * px, 9 * px);
      c.fillStyle = '#111'; c.fillRect(p[0] * px, p[1] * px, 7 * px, 7 * px);
      c.fillStyle = '#fff'; c.fillRect((p[0] + 1) * px, (p[1] + 1) * px, 5 * px, 5 * px);
      c.fillStyle = '#111'; c.fillRect((p[0] + 2) * px, (p[1] + 2) * px, 3 * px, 3 * px);
    });
    drawMark(canvas);
  }
  // QR 가운데에 흰 바탕을 깔고 상호 마크를 얹는다. 실제 QR에서는 오류 복원 수준을 높여야 가운데를 가려도 읽힌다.
  var markImg = null;
  function drawMark(canvas) {
    if (!GO.BRAND.mark) return;
    if (!markImg) { markImg = new Image(); markImg.src = GO.BRAND.mark; }
    function paint() {
      if (!canvas.isConnected) return;
      var c = canvas.getContext('2d'), s = Math.round(canvas.width * 0.3), o = Math.round((canvas.width - s) / 2), pad = Math.round(s * 0.08);
      c.fillStyle = '#fff'; c.fillRect(o, o, s, s);
      c.drawImage(markImg, o + pad, o + pad, s - pad * 2, s - pad * 2);
    }
    if (markImg.complete && markImg.naturalWidth) paint(); else markImg.addEventListener('load', paint, { once: true });
  }
  function drawPay() {
    var out = $('#payOut'); if (!out) return;
    var a = payAmount();
    if (!a.total) { out.innerHTML = '<p class="hint box">' + L('Isi total harga untuk menampilkan nominal pembayaran.', '총 금액을 입력하면 결제 금액이 표시됩니다.') + '</p>'; return; }
    out.innerHTML = '<div class="amount">' +
      '<div class="brk"><div><b>' + L('Total harga', '총 금액') + '</b></div><span>' + rp(a.base) + '</span></div>' +
      (a.off ? '<div class="brk"><div><b>Voucher</b></div><span>−' + rp(a.off) + '</span></div>' : '') +
      '<div class="brk"><div><b>' + L('Kode unik', '고유 코드') + '</b><small>' + L('untuk mencocokkan pembayaran otomatis', '입금 자동 대조용') + '</small></div><span>+' + rp(a.code) + '</span></div>' +
      '<div class="total"><span>' + L('Nominal yang dibayar', '결제할 금액') + '</span><b>' + rp(a.total) + '</b></div></div>' +
      (P.method === 'QRIS'
        ? '<div class="qr"><canvas width="400" height="400" id="qrC"></canvas><div><b>' + L('QRIS dinamis', '동적 QRIS') + '</b><p>' + L('Nominal terisi otomatis saat di-scan, tidak perlu ketik harga.', '스캔하면 금액이 자동 입력되어 직접 칠 필요가 없습니다.') + '</p><small>' + L('QR contoh untuk mockup, belum terhubung ke penyedia pembayaran.', '목업용 예시 QR이며 결제사와 연결되어 있지 않습니다.') + '</small></div></div>'
        : '<p class="note"><b>BCA 000-000-0000</b> a.n. ' + esc(GO.BRAND.name) + '<br>' + L('Transfer tepat sesuai nominal di atas.', '위 금액과 정확히 같게 이체해 주세요.') + ' <small>(' + L('rekening contoh', '예시 계좌') + ')</small></p>');
    var q = $('#qrC'); if (q) drawQR(q, P.id + a.total);
    ensureFreeAmount(a.total);
  }
  // 새 주문이면, 지금 보여 주는 결제 금액을 확인 대기 중인 다른 주문이 쓰고 있는지 묻는다.
  // 쓰고 있으면 주문번호를 새로 뽑아 고유 코드를 바꾼다: 금액이 같으면 운영자가 입금을 구분할 수 없다.
  // (이미 있는 주문은 번호가 정해져 있어 바꿀 수 없다. 그 경우는 관리자 화면이 겹침을 알려 준다.)
  var amountTimer = null;
  function ensureFreeAmount(total) {
    if (!P || P.orderId || P._checked === total) return;
    clearTimeout(amountTimer);
    var mine = P;
    amountTimer = setTimeout(function () {
      if (P !== mine) return;
      mine._checked = total;
      S.amountFree(total).then(function (free) {
        if (free || P !== mine || (mine._retries || 0) >= 5) return;
        mine._retries = (mine._retries || 0) + 1;
        mine.id = S.newOrderId(); mine._checked = null;
        drawPay();
      });
    }, 400);
  }
  function submitPay() {
    var a = payAmount();
    if (!P.buyer.trim() || !P.item.trim() || !a.total) { P.err = L('Lengkapi nama pembeli, item, dan total harga.', '구매자, 품목, 총 금액을 입력해 주세요.'); }
    else if (!P.fileName) { P.err = L('Unggah bukti pembayaran terlebih dahulu.', '결제 증빙을 먼저 올려 주세요.'); }
    else P.err = '';
    if (P.err) { $('#payErr').textContent = P.err; return; }
    var payload = { orderId: P.orderId, id: P.id, batchId: P.batchId, buyer: P.buyer, item: P.item, qty: P.qty, base: a.base, voucher: P.off ? P.voucher : '', method: P.method, proofName: P.fileName };
    var btn = $('form[data-form=pay] .btn.block');
    btn.disabled = true;
    S.submitPayment(payload).then(function (o) {
      P = null; receipts[o.id] = o; rememberOrder(o);
      go('#/track/' + o.id);
      showReceipt(o.id);
    }, function (e) {
      btn.disabled = false;
      $('#payErr').textContent = L('Gagal mengirim. Coba lagi.', '제출하지 못했습니다. 다시 시도해 주세요.') + ' (' + e.message + ')';
    });
  }

  /* ── 영수증 ── */
  function showReceipt(orderId) {
    var o = receipts[orderId] || S.order(orderId); if (!o) return;
    var b = S.batch(o.batchId), s = S.service(b.svc);
    var when = new Date(o.createdAt).toLocaleString(loc(), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    var m = document.createElement('div');
    m.className = 'modal'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
    m.innerHTML = '<div class="receipt"><button class="x" data-act="modal-close" aria-label="' + L('Tutup', '닫기') + '">×</button>' +
      '<div class="r-head"><b>' + esc(GO.BRAND.name) + '</b><small>' + L('Bukti pesanan', '주문 영수증') + '</small></div>' +
      '<dl><dt>No.</dt><dd>' + o.id + '</dd><dt>' + L('Tanggal', '일시') + '</dt><dd>' + esc(when) + '</dd><dt>' + L('Pembeli', '구매자') + '</dt><dd>' + esc(o.buyer) + '</dd><dt>' + L('Metode', '결제 수단') + '</dt><dd>' + esc(o.method || '-') + '</dd><dt>Status</dt><dd>' + esc(LL(GO.PAY[o.pay])) + '</dd></dl>' +
      '<div class="r-item"><div><b>' + esc(o.item) + '</b><small>' + esc(batchName(b) + ' (' + LL(s.name) + ')') + ' · ' + o.qty + ' pcs</small></div></div>' +
      '<div class="total"><span>TOTAL</span><b>' + rp(o.total) + '</b></div>' +
      '<p class="thanks">' + L('Simpan nomor pesanan ini untuk melacak pesanan.', '이 주문번호를 보관해 두세요. 조회할 때 필요합니다.') + '<br>' + L('Terima kasih sudah order.', '주문해 주셔서 감사합니다.') + '</p>' +
      '<button class="btn block" data-act="receipt-save" data-id="' + o.id + '">' + L('Simpan gambar', '이미지로 저장') + '</button></div>';
    document.body.appendChild(m);
    m.querySelector('.x').focus();
  }
  function saveReceipt(orderId) {
    var o = receipts[orderId] || S.order(orderId), b = S.batch(o.batchId), s = S.service(b.svc);
    var cv = document.createElement('canvas'), W = 720, H = 760; cv.width = W; cv.height = H;
    var c = cv.getContext('2d');
    c.fillStyle = '#fff'; c.fillRect(0, 0, W, H);
    c.strokeStyle = '#e0e0e0'; c.strokeRect(20.5, 20.5, W - 41, H - 41);
    c.fillStyle = '#111'; c.textAlign = 'center'; c.font = 'bold 34px sans-serif'; c.fillText(GO.BRAND.name, W / 2, 96);
    c.fillStyle = '#767676'; c.font = '20px sans-serif'; c.fillText(L('Bukti pesanan', '주문 영수증'), W / 2, 130);
    var y = 200;
    function row(k, v, bold) {
      c.textAlign = 'left'; c.fillStyle = '#767676'; c.font = '22px sans-serif'; c.fillText(k, 60, y);
      c.textAlign = 'right'; c.fillStyle = '#111'; c.font = (bold ? 'bold 30px' : '22px') + ' sans-serif'; c.fillText(v, W - 60, y); y += 46;
    }
    function rule() { c.strokeStyle = '#e0e0e0'; c.beginPath(); c.moveTo(60, y - 20); c.lineTo(W - 60, y - 20); c.stroke(); y += 16; }
    row('No.', o.id); row(L('Tanggal', '일시'), new Date(o.createdAt).toLocaleString(loc()));
    row(L('Pembeli', '구매자'), o.buyer); row(L('Metode', '결제 수단'), o.method || '-'); row('Status', LL(GO.PAY[o.pay]));
    rule(); row('Item', o.item.length > 34 ? o.item.slice(0, 33) + '…' : o.item); row('Batch', batchName(b) + ' (' + LL(s.name) + ')'); row(L('Jumlah', '수량'), o.qty + ' pcs');
    rule(); row('TOTAL', rp(o.total), true);
    c.textAlign = 'center'; c.fillStyle = '#767676'; c.font = '20px sans-serif'; c.fillText(L('Terima kasih sudah order.', '주문해 주셔서 감사합니다.'), W / 2, H - 70);
    var a = document.createElement('a'); a.download = o.id + '.png'; a.href = cv.toDataURL('image/png'); a.click();
  }

  /* ── 관리자 ── */
  var A = { batchId: '', text: '', rows: null, engine: '', q: '' };
  function vAdmin(tab) {
    if (!S.isAdmin) return vLogin();
    tab = tab || 'guide';
    var tabs = [['guide', L('Panduan', '사용 안내')], ['batch', L('Batch', '배치')], ['order', L('Input pesanan', '주문 입력')], ['pay', L('Verifikasi pembayaran', '결제 확인')], ['calc', L('Kalkulator', '계산기')], ['log', L('Riwayat', '활동 기록')]];
    var pendingN = S.db.orders.filter(function (o) { return o.pay === 'pending'; }).length;
    return '<div class="head"><div><h1>' + L('Admin', '관리자') + '</h1><p class="lead">' + L('Data yang diisi di sini langsung tampil di halaman pelanggan.', '여기서 입력한 내용이 고객 화면에 바로 나타납니다.') + '</p></div><div class="btns"><button class="btn" data-act="export">' + L('Unduh CSV pesanan', '주문 CSV 내려받기') + '</button>' + (S.canReset ? '<button class="btn line" data-act="reset">' + L('Reset data contoh', '예시 데이터로 초기화') + '</button>' : '') + (S.mode === 'server' ? '<button class="btn line" data-act="logout">' + L('Keluar', '로그아웃') + '</button>' : '') + '</div></div>' +
      '<p class="note">' + (S.mode === 'server' ? L('Masuk sebagai admin. Perubahan tersimpan di server dan terlihat di semua perangkat.', '관리자로 로그인했습니다. 변경 내용은 서버에 저장되어 모든 기기에서 보입니다.') : L('Mockup: belum ada login admin dan data hanya tersimpan di browser ini.', '목업: 관리자 로그인이 아직 없고, 데이터는 이 브라우저에만 저장됩니다.')) + '</p>' +
      '<div class="tabs">' + tabs.map(function (t) { return '<a class="' + (t[0] === tab ? 'on' : '') + '" href="#/admin/' + t[0] + '">' + esc(t[1]) + (t[0] === 'pay' && pendingN ? ' <i class="dot">' + pendingN + '</i>' : '') + '</a>'; }).join('') + '</div>' +
      ({ guide: aGuide, batch: aBatch, order: aOrder, pay: aPay, calc: vCalc, log: aLog }[tab] || aGuide)();
  }
  function vLogin() {
    return '<div class="login"><h1>' + L('Admin', '관리자') + '</h1><p class="lead">' + L('Masuk untuk mengelola batch, pesanan, dan pembayaran.', '배치·주문·결제를 관리하려면 로그인하세요.') + '</p>' +
      (S.loginReady
        ? '<form data-form="login"><div class="field"><label>' + L('Kata sandi admin', '관리자 비밀번호') + '</label><input type="password" name="password" autocomplete="current-password" required></div><p class="err" id="loginErr" role="alert"></p><button class="btn block">' + L('Masuk', '로그인') + '</button></form>'
        : '<p class="note">' + (S.loginWeak ? L('Login admin dimatikan karena kata sandi di server terlalu pendek (minimal 8 karakter).', '서버의 관리자 비밀번호가 너무 짧아(8자 미만) 로그인이 꺼져 있습니다.') : L('Login admin belum diatur di server.', '서버에 관리자 로그인이 아직 설정되지 않았습니다.')) + '</p>') + '</div>';
  }
  function aGuide() {
    var g = [
      [L('Buat batch', '배치 만들기'), L('Tab Batch → isi layanan, nomor, nama, bulan, tanggal tutup, kurs. Batch langsung muncul di halaman layanan.', '배치 탭에서 서비스·번호·이름·월·마감일·환율을 입력합니다. 서비스 화면에 바로 나타납니다.'), 'batch'],
      [L('Masukkan pesanan', '주문 넣기'), L('Tab Input pesanan → tempel daftar order dari chat. Sistem memisahkan pembeli, item, jumlah, dan harga secara otomatis. Periksa lalu simpan.', '주문 입력 탭에 채팅의 주문 목록을 붙여 넣으면 구매자·품목·수량·가격을 자동으로 나눕니다. 확인 후 저장합니다.'), 'order'],
      [L('Verifikasi pembayaran', '결제 확인'), L('Tab Verifikasi → setujui atau tolak bukti yang dikirim pelanggan.', '결제 확인 탭에서 고객이 보낸 증빙을 승인하거나 반려합니다.'), 'pay'],
      [L('Perbarui status batch', '배치 상태 갱신'), L('Tab Batch → ubah tahap (dibeli, dikirim, tiba, selesai) dan tulis info. Pelanggan melihatnya saat melacak pesanan.', '배치 탭에서 단계(구매·배송·도착·완료)를 바꾸고 안내를 적습니다. 고객이 주문 조회에서 봅니다.'), 'batch'],
      [L('Hitung harga', '가격 계산'), L('Tab Kalkulator → simpan rumus fee sebagai default. Harga mata uang asing di Input pesanan dihitung dengan rumus ini.', '계산기 탭에서 수수료 수식을 기본값으로 저장합니다. 주문 입력의 외화 가격은 이 수식으로 환산됩니다.'), null]
    ];
    return '<ol class="how">' + g.map(function (x, i) {
      return '<li><em>' + (i + 1) + '</em><div><b>' + esc(x[0]) + '</b><p>' + esc(x[1]) + '</p>' + (x[2] ? '<a href="#/admin/' + x[2] + '">' + L('Buka', '열기') + ' →</a>' : '<a href="#/admin/calc">' + L('Buka', '열기') + ' →</a>') + '</div></li>';
    }).join('') + '</ol><p class="hint">' + L('Voucher contoh', '예시 쿠폰') + ': ' + S.db.vouchers.map(function (v) { return v.code + ' (−' + rp(v.off) + ')'; }).join(', ') + '</p>';
  }
  function svcOptions(sel) { return S.db.services.map(function (s) { return '<option value="' + s.id + '"' + (s.id === sel ? ' selected' : '') + '>' + esc(LL(s.name)) + '</option>'; }).join(''); }
  function batchOptions(sel) { return S.db.batches.slice().sort(function (a, b) { return a.month < b.month ? 1 : a.month > b.month ? -1 : b.no - a.no; }).map(function (b) { return '<option value="' + b.id + '"' + (b.id === sel ? ' selected' : '') + '>' + esc(LL(S.service(b.svc).name) + ' / ' + batchName(b) + ' (' + b.month + ')') + '</option>'; }).join(''); }
  function aBatch() {
    var rows = S.db.batches.slice().sort(function (a, b) { return a.month < b.month ? 1 : a.month > b.month ? -1 : a.svc < b.svc ? -1 : a.svc > b.svc ? 1 : b.no - a.no; }).map(function (b) {
      var br = X.batchRecap(b.id, S.db.orders);
      return '<tr><td>' + b.month + '</td><td>' + esc(LL(S.service(b.svc).name)) + '</td><td><a href="' + ROOT + '#/b/' + b.id + '">' + esc(batchName(b)) + '</a></td>' +
        '<td class="r">' + br.count + '</td><td class="r btotal">' + rp(br.total) + '</td><td class="r">' + rp(br.paidTotal) + '</td>' +
        '<td><select data-bstage="' + b.id + '" aria-label="' + L('Tahap', '단계') + '">' + GO.STAGES.map(function (st, i) { return '<option value="' + i + '"' + (i === b.stage ? ' selected' : '') + '>' + esc(LL(st)) + '</option>'; }).join('') + '</select></td>' +
        '<td><input data-bnote="' + b.id + '" value="' + esc(b.note) + '" placeholder="' + L('Info untuk pelanggan', '고객 안내 문구') + '" aria-label="Info"></td>' +
        '<td><button class="link" data-act="batch-del" data-id="' + b.id + '">' + L('Hapus', '삭제') + '</button></td></tr>';
    }).join('');
    return '<div class="panel"><h2>' + L('Tambah batch', '배치 추가') + '</h2><form data-form="batch" class="grid3">' +
      '<div class="field"><label>' + L('Layanan', '서비스') + '</label><select name="svc">' + svcOptions() + '</select></div>' +
      '<div class="field"><label>' + L('Nomor batch', '배치 번호') + '</label><input name="no" type="number" min="1" required></div>' +
      '<div class="field"><label>' + L('Nama batch', '배치 이름') + '</label><input name="title" placeholder="Handcarry Korea" required></div>' +
      '<div class="field"><label>' + L('Bulan', '월') + '</label><input name="month" type="month" value="2026-11" required></div>' +
      '<div class="field"><label>' + L('Tutup order', '주문 마감일') + '</label><input name="closeDate" type="date"></div>' +
      '<div class="field"><label>' + L('Kurs', '환율') + '</label><input name="kurs" type="number" step="any" value="11.5"></div>' +
      '<div class="field span"><label>' + L('Info untuk pelanggan', '고객 안내 문구') + '</label><input name="note"></div>' +
      '<div class="field"><label>&nbsp;</label><button class="btn">' + L('Tambah', '추가') + '</button></div></form><p class="err" id="batchErr" role="alert"></p></div>' +
      '<h2 class="sub">' + L('Rekap semua batch', '전체 집계') + '</h2>' + adminTotals() +
      '<h2 class="sub">' + L('Semua batch', '전체 배치') + '</h2><div class="tbl"><table class="edit"><thead><tr><th>' + L('Bulan', '월') + '</th><th>' + L('Layanan', '서비스') + '</th><th>Batch</th><th class="r">' + L('Pesanan', '주문') + '</th><th class="r">' + L('Total pesanan', '주문 금액') + '</th><th class="r">' + L('Sudah dibayar', '결제 완료 금액') + '</th><th>' + L('Tahap', '단계') + '</th><th>Info</th><th><span class="sr">' + L('Aksi', '동작') + '</span></th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }
  // 금액·결제 현황 집계는 관리자에게만 보인다
  function adminTotals() {
    var t = { count: 0, total: 0, paidTotal: 0, pending: 0 };
    S.db.batches.forEach(function (b) { var r = X.batchRecap(b.id, S.db.orders); t.count += r.count; t.total += r.total; t.paidTotal += r.paidTotal; t.pending += r.pending; });
    return '<div class="stats">' + stat(L('Batch', '배치'), S.db.batches.length) + stat(L('Pesanan', '주문'), t.count) + stat(L('Total pesanan', '주문 금액'), rp(t.total)) + stat(L('Sudah dibayar', '결제 완료 금액'), rp(t.paidTotal)) + stat(L('Menunggu verifikasi', '확인 대기'), t.pending) + '</div>';
  }
  function aOrder() {
    if (!S.batch(A.batchId)) A.batchId = (S.db.batches.filter(function (b) { return b.stage === 0; })[0] || S.db.batches[0] || {}).id || '';
    var sample = 'Batch 4\n@nadya / Photocard random 1 pc / 2pcs / Rp 25.000\ndinda - album mini - 285k\n3. rara, acrylic stand, x1, ¥2000\ntiara lightstick strap 135rb';
    var prev = '';
    if (A.rows) {
      prev = '<h2 class="sub">' + L('Hasil pemisahan', '분류 결과') + ' <small>(' + (A.engine === 'ai' ? 'AI' : L('aturan otomatis', '규칙 기반 자동 분류')) + ')</small></h2>' +
        (A.rows.length ? '<div class="tbl"><table class="edit"><thead><tr><th>' + L('Pembeli', '구매자') + '</th><th>Item</th><th>' + L('Jumlah', '수량') + '</th><th>' + L('Harga asli', '원래 가격') + '</th><th>Total (Rp)</th><th><span class="sr">' + L('Aksi', '동작') + '</span></th></tr></thead><tbody>' +
          A.rows.map(function (r, i) {
            function cell(f, type) { return '<td class="' + (r.missing.indexOf(f) >= 0 || (f === 'total' && !r.total) ? 'miss' : '') + '"><input ' + (type ? 'type="number" ' : '') + 'data-row="' + i + '" data-f="' + f + '" value="' + esc(r[f] == null ? '' : r[f]) + '" aria-label="' + f + '"></td>'; }
            return '<tr>' + cell('buyer') + cell('item') + cell('qty', 1) + '<td class="src">' + (r.price != null ? esc((GO.CURRENCIES[r.cur] || {}).sym + ' ' + r.price.toLocaleString('id-ID')) : '-') + '</td>' + cell('total', 1) + '<td><button class="link" data-act="row-del" data-id="' + i + '">' + L('Hapus', '삭제') + '</button></td></tr>';
          }).join('') + '</tbody></table></div>' +
          '<p class="hint">' + L('Kolom bertanda merah belum terbaca. Isi dulu sebelum menyimpan. Harga mata uang asing dihitung dengan kurs batch dan rumus default kalkulator.', '빨간 칸은 읽지 못한 항목입니다. 채운 뒤 저장하세요. 외화 가격은 배치 환율과 계산기 기본 수식으로 환산했습니다.') + '</p>' +
          '<p class="err" id="rowErr" role="alert"></p><button class="btn" data-act="rows-save">' + L('Simpan', '저장') + ' ' + A.rows.length + ' ' + L('pesanan', '건') + '</button>'
          : empty(L('Tidak ada baris yang bisa dibaca.', '읽을 수 있는 줄이 없습니다.')));
    }
    var list = S.ordersOf(A.batchId).map(function (o) {
      return '<tr><td>' + o.id + lateBadge(o) + '</td><td>' + esc(o.buyer) + '</td><td>' + esc(o.item) + '</td><td class="r">' + o.qty + '</td><td class="r">' + rp(o.total) + '</td>' +
        '<td><select data-opay="' + o.id + '" aria-label="' + L('Pembayaran', '결제') + '">' + Object.keys(GO.PAY).map(function (k) { return '<option value="' + k + '"' + (k === o.pay ? ' selected' : '') + '>' + esc(LL(GO.PAY[k])) + '</option>'; }).join('') + '</select></td>' +
        '<td><button class="link" data-act="order-del" data-id="' + o.id + '">' + L('Hapus', '삭제') + '</button></td></tr>';
    }).join('');
    return '<div class="panel find"><h2>' + L('Cari pesanan', '주문 찾기') + '</h2><p class="lead">' + L('Untuk pelanggan yang lupa nomor pesanan: cari dengan nama atau sebagian nomor.', '주문번호를 잊은 고객을 위해: 이름이나 번호 일부로 찾습니다.') + '</p>' +
      '<div class="field"><label>' + L('Nama atau nomor pesanan', '이름 또는 주문번호') + '</label><input data-admin="q" value="' + esc(A.q) + '" autocomplete="off"></div><div id="adminFind"></div></div>' +
      '<div class="panel"><h2>' + L('Tempel daftar order', '주문 목록 붙여 넣기') + '</h2>' +
      '<p class="lead">' + L('Satu baris = satu pesanan. Urutan bebas: sistem mengenali pembeli, item, jumlah, dan harga.', '한 줄에 주문 하나. 순서는 자유이며 구매자·품목·수량·가격을 알아서 구분합니다.') + '</p>' +
      '<div class="field"><label>' + L('Masuk ke batch', '넣을 배치') + '</label><select data-admin="batchId">' + batchOptions(A.batchId) + '</select></div>' +
      '<div class="field"><label>' + L('Teks order', '주문 글') + '</label><textarea rows="7" data-admin="text" placeholder="' + esc(sample) + '">' + esc(A.text) + '</textarea></div>' +
      '<div class="btns"><button class="btn" data-act="classify">' + L('Pisahkan otomatis', '자동으로 분류') + '</button><button class="btn line" data-act="sample">' + L('Isi contoh', '예시 채우기') + '</button></div></div>' + prev +
      '<h2 class="sub">' + L('Pesanan di batch ini', '이 배치의 주문') + '</h2>' + (list ? '<div class="tbl"><table class="edit"><thead><tr><th>' + L('No. pesanan', '주문번호') + '</th><th>' + L('Pembeli', '구매자') + '</th><th>Item</th><th class="r">' + L('Jumlah', '수량') + '</th><th class="r">Total</th><th>' + L('Pembayaran', '결제') + '</th><th><span class="sr">' + L('Aksi', '동작') + '</span></th></tr></thead><tbody>' + list + '</tbody></table></div>' : empty(L('Belum ada pesanan.', '아직 주문이 없습니다.')));
  }
  // 관리자용 주문 찾기: 이름이나 번호 일부로 전체 배치에서 찾는다 (고객 화면과 달리 일부만 맞아도 된다)
  function drawFind() {
    var out = $('#adminFind'); if (!out) return;
    var q = A.q.trim().toLowerCase().replace(/^@/, '');
    if (q.length < 2) { out.innerHTML = ''; return; }
    var hits = S.db.orders.filter(function (o) { return o.id.toLowerCase().indexOf(q) >= 0 || o.buyer.toLowerCase().indexOf(q) >= 0; }).slice(0, 30);
    out.innerHTML = hits.length ? '<div class="tbl"><table><thead><tr><th>' + L('No. pesanan', '주문번호') + '</th><th>Batch</th><th>' + L('Pembeli', '구매자') + '</th><th>Item</th><th class="r">Total</th><th>' + L('Pembayaran', '결제') + '</th></tr></thead><tbody>' +
      hits.map(function (o) { var b = S.batch(o.batchId); return '<tr><td><b>' + o.id + '</b></td><td>' + esc(b ? batchName(b) : '-') + lateBadge(o) + '</td><td>' + esc(o.buyer) + '</td><td>' + esc(o.item) + '</td><td class="r">' + rp(o.total) + '</td><td>' + payBadge(o.pay) + '</td></tr>'; }).join('') + '</tbody></table></div>'
      : '<p class="hint">' + L('Pesanan tidak ditemukan.', '주문을 찾지 못했습니다.') + '</p>';
  }
  // 활동 기록 탭
  var ACTIONS = {
    login: ['Masuk', '로그인'], reset: ['Reset data', '데이터 초기화'],
    'batch.add': ['Tambah batch', '배치 추가'], 'batch.update': ['Ubah batch', '배치 변경'], 'batch.delete': ['Hapus batch', '배치 삭제'],
    'order.add': ['Tambah pesanan', '주문 추가'], 'order.pay': ['Ubah status bayar', '결제 상태 변경'], 'order.delete': ['Hapus pesanan', '주문 삭제'],
    calc: ['Simpan rumus kalkulator', '계산기 수식 저장']
  };
  function aLog() { return '<div id="logOut"><p class="hint">' + L('Memuat…', '불러오는 중…') + '</p></div>'; }
  function drawLog() {
    S.fetchLog().then(function (log) {
      var out = $('#logOut'); if (!out) return;
      if (log === null) { out.innerHTML = '<p class="note">' + L('Riwayat hanya tersedia di versi server.', '활동 기록은 서버판에서만 볼 수 있습니다.') + '</p>'; return; }
      out.innerHTML = log.length ? '<div class="tbl"><table><thead><tr><th>' + L('Waktu', '시각') + '</th><th>' + L('Kegiatan', '한 일') + '</th><th>' + L('Rincian', '내용') + '</th><th>' + L('Alamat', '접속 주소') + '</th></tr></thead><tbody>' +
        log.map(function (x) { return '<tr><td>' + esc(new Date(x.at).toLocaleString(loc())) + '</td><td>' + esc(ACTIONS[x.action] ? LL(ACTIONS[x.action]) : x.action) + '</td><td>' + esc(x.detail) + '</td><td>' + esc(x.ip) + '</td></tr>'; }).join('') + '</tbody></table></div>'
        : empty(L('Belum ada riwayat.', '아직 기록이 없습니다.'));
    }, function () { var out = $('#logOut'); if (out) out.innerHTML = empty(L('Gagal memuat. Coba lagi.', '불러오지 못했습니다. 다시 시도해 주세요.')); });
  }
  function rowTotal(r, batch) {
    if (r.price == null) return '';
    if (r.cur === 'IDR') return r.price * r.qty;
    var d = S.db.calcDefaults;
    // 배치의 통화와 같으면 배치 환율, 다르면 그 통화의 기본 환율
    var kurs = S.service(batch.svc).cur === r.cur ? batch.kurs : GO.CURRENCIES[r.cur].kurs;
    return X.calcPrice({ price: r.price, qty: r.qty, kurs: kurs, feeGo: d.feeGo, feeCo: d.feeCo, tax: d.tax, extra: 0 }).total;
  }
  function aPay() {
    var list = S.db.orders.filter(function (o) { return o.pay === 'pending'; });
    var dup = X.duplicateTotals(S.db.orders);
    return list.length ? (Object.keys(dup).length ? '<p class="note warn"><b>' + L('Perhatian', '주의') + '</b> ' + L('Ada pesanan dengan nominal yang sama. Cocokkan dengan bukti dan nama sebelum menyetujui.', '결제 금액이 같은 주문이 있습니다. 승인하기 전에 증빙과 이름을 대조하세요.') + '</p>' : '') + '<div class="tbl"><table><thead><tr><th>' + L('No. pesanan', '주문번호') + '</th><th>Batch</th><th>' + L('Pembeli', '구매자') + '</th><th>Item</th><th class="r">Total</th><th>' + L('Metode', '수단') + '</th><th>' + L('Bukti', '증빙') + '</th><th><span class="sr">' + L('Aksi', '동작') + '</span></th></tr></thead><tbody>' +
      list.map(function (o) {
        var b = S.batch(o.batchId);
        return '<tr><td>' + o.id + '</td><td>' + esc(batchName(b)) + lateBadge(o) + '</td><td>' + esc(o.buyer) + '</td><td>' + esc(o.item) + '</td><td class="r">' + rp(o.total) + (dup[o.total] ? ' <span class="badge pay-rejected">' + L('Nominal sama', '금액 같음') + '</span>' : '') + '</td><td>' + esc(o.method) + '</td><td>' + esc(o.proofName || '-') + '</td>' +
          '<td class="acts"><button class="btn sm" data-act="pay-ok" data-id="' + o.id + '">' + L('Setujui', '승인') + '</button><button class="btn line sm" data-act="pay-no" data-id="' + o.id + '">' + L('Tolak', '반려') + '</button></td></tr>';
      }).join('') + '</tbody></table></div><p class="hint">' + L('Mockup hanya menyimpan nama file bukti, bukan gambarnya.', '목업에서는 증빙 이미지가 아니라 파일 이름만 저장합니다.') + '</p>'
      : empty(L('Tidak ada pembayaran yang menunggu verifikasi.', '확인을 기다리는 결제가 없습니다.'));
  }

  // 전체 주문을 스프레드시트용 CSV 파일로 내려받는다 (Excel·Google Sheets에서 열림)
  function exportOrders() {
    var rows = [['order_no', 'date', 'service', 'month', 'batch', 'batch_stage', 'buyer', 'item', 'qty', 'total_idr', 'payment', 'method', 'after_close']];
    S.db.orders.forEach(function (o) {
      var b = S.batch(o.batchId), s = S.service(b.svc);
      rows.push([o.id, o.createdAt.slice(0, 10), LL(s.name), b.month, batchName(b), LL(GO.STAGES[b.stage]), o.buyer, o.item, o.qty, o.total, LL(GO.PAY[o.pay]), o.method, o.late ? 'yes' : '']);
    });
    var blob = new Blob(['﻿' + X.toCSV(rows)], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = GO.BRAND.name.toLowerCase() + '-orders.csv'; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  // 화면이 짧아 스크롤할 것이 없으면 이동 버튼을 숨긴다
  function showJump() { $('#jump').hidden = document.documentElement.scrollHeight < window.innerHeight + 300; }
  window.addEventListener('resize', showJump);

  // 접근성: 화면을 그린 뒤 각 입력칸을 그 위의 제목(label)과 연결한다
  var labelSeq = 0;
  function linkLabels() {
    document.querySelectorAll('#app .field').forEach(function (f) {
      var label = f.querySelector('label'), ctrl = f.querySelector('input, select, textarea');
      if (!label || !ctrl || label.htmlFor) return;
      if (!ctrl.id) ctrl.id = 'f' + (++labelSeq);
      label.htmlFor = ctrl.id;
    });
  }

  /* ── 라우터 ── */
  function route() { return location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent); }
  function render() {
    if (!S.db) return;                       // 저장소가 아직 준비되지 않았다
    var r = route(), html, page = r[0] || 'home';
    var payKey = (r[1] || '') + '/' + (r[2] || '');
    if (page === 'pay' && (!P || P._key !== payKey)) { initPay(r[1], r[2]); P._key = payKey; }
    if (page !== 'pay') P = null;
    if (GO.app === 'admin') { if (page !== 'admin') { r[1] = page === 'calc' ? 'calc' : ''; page = 'admin'; } }   // 관리자 사이트에는 관리자 화면만
    else if (page === 'admin' || page === 'calc') page = 'home';                                                // 고객 사이트에는 관리자 화면이 없다
    if (page === 's') html = vService(r[1], r[2]);
    else if (page === 'b') html = vBatch(r[1]);
    else if (page === 'track') html = vTrack(r[1] || '');
    else if (page === 'pay') html = vPay();
    else if (page === 'admin') html = vAdmin(r[1]);
    else { page = 'home'; html = vHome(); }
    $('#app').innerHTML = html;
    linkLabels();
    var navKey = page === 's' || page === 'b' ? 'home' : page;
    $('#nav').innerHTML = (GO.app === 'admin'
      // 고객 사이트 보기는 새 탭으로 연다: 관리자 사이트가 그대로 남아 있어 돌아오기 쉽다
      ? [['site', ROOT, L('Lihat situs pelanggan', '고객 사이트 보기') + ' ↗', true]]
      : [['home', '#/', L('Layanan', '서비스')], ['track', '#/track', L('Lacak pesanan', '주문 조회')], ['pay', '#/pay', L('Konfirmasi pembayaran', '결제 확인')]]
          // 로그인한 운영자에게만 관리자 사이트로 돌아가는 길을 보여 준다 (고객에게는 보이지 않는다)
          .concat(S.mode === 'server' && S.isAdmin ? [['admin', 'admin/', L('Kembali ke admin', '관리자로 돌아가기')]] : []))
      .map(function (n) { return '<a href="' + n[1] + '"' + (n[3] ? ' target="_blank" rel="noopener"' : '') + (n[0] === navKey ? ' class="on" aria-current="page"' : '') + '>' + n[2] + '</a>'; }).join('');
    $('#langs').innerHTML = [['id', 'ID', 'Bahasa Indonesia'], ['en', 'EN', 'English'], ['ko', 'KO', '한국어']].map(function (l) { return '<button type="button" class="link' + (l[0] === lang ? ' on' : '') + '" data-act="lang" data-id="' + l[0] + '" title="' + l[2] + '" aria-label="' + l[2] + '" aria-pressed="' + (l[0] === lang) + '">' + l[1] + '</button>'; }).join('');
    $('#jumpTop').setAttribute('aria-label', L('Ke atas', '맨 위로')); $('#jumpTop').title = L('Ke atas', '맨 위로');
    $('#jumpBottom').setAttribute('aria-label', L('Ke bawah', '맨 아래로')); $('#jumpBottom').title = L('Ke bawah', '맨 아래로');
    showJump();
    document.documentElement.lang = lang;
    document.title = GO.BRAND.name + (GO.app === 'admin' ? ' Admin' : ''); $('#logo').innerHTML = '<img src="' + ROOT + GO.BRAND.mark + '" alt="" width="26" height="26">' + esc(GO.BRAND.name) + (GO.app === 'admin' ? ' <small>Admin</small>' : ''); $('#foot').textContent = GO.BRAND.name + (S.mode === 'local' ? ' · mockup' : '');   // 서버 없이 도는 목업판에만 표시
    if (page === 'admin' && r[1] === 'calc' && S.isAdmin) drawCalc();
    if (page === 'track') drawTrack(r[1] || '');
    if (page === 'b') drawBatch(r[1]);
    if (page === 'admin' && S.isAdmin) { if (r[1] === 'order') drawFind(); if (r[1] === 'log') drawLog(); }
    if (page === 'pay') drawPay();
  }

  /* ── 이벤트 ── */
  document.addEventListener('submit', function (e) {
    var f = e.target.getAttribute('data-form'); if (!f) return;
    e.preventDefault();
    if (f === 'track') go('#/track/' + encodeURIComponent(e.target.q.value.trim()));
    else if (f === 'pay') submitPay();
    else if (f === 'login') {
      S.login(e.target.password.value).then(render, function (err) {
        $('#loginErr').textContent = err.status === 401 ? L('Kata sandi salah.', '비밀번호가 맞지 않습니다.') : L('Gagal masuk. Coba lagi.', '로그인하지 못했습니다. 다시 시도해 주세요.');
      });
    }
    else if (f === 'batch') {
      var d = e.target, b = S.addBatch({ svc: d.svc.value, no: +d.no.value, title: d.title.value.trim(), month: d.month.value, stage: 0, closeDate: d.closeDate.value, kurs: +d.kurs.value || 1, note: d.note.value.trim() });
      if (!b) $('#batchErr').textContent = L('Nomor batch itu sudah ada di layanan ini.', '이 서비스에 같은 번호의 배치가 이미 있습니다.'); else render();
    }
  });

  document.addEventListener('click', function (e) {
    var seg = e.target.closest('[data-seg] button');
    if (seg) { C[seg.parentNode.getAttribute('data-seg')].mode = seg.getAttribute('data-mode'); render(); return; }
    var t = e.target.closest('[data-act]');
    if (e.target.classList.contains('modal')) { e.target.remove(); return; }
    if (!t) return;
    var act = t.getAttribute('data-act'), id = t.getAttribute('data-id');
    if (act === 'top') window.scrollTo({ top: 0, behavior: 'smooth' });
    else if (act === 'bottom') window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
    else if (act === 'lang') { lang = id; try { localStorage.setItem('go-lang', lang); } catch (x) {} render(); }
    else if (act === 'calc-reset') { C = null; render(); }
    else if (act === 'calc-save') { S.setCalcDefaults(C); t.textContent = L('Tersimpan', '저장됨'); }
    else if (act === 'pay-svc') { P.svc = id; P.batchId = (S.batchesOf(id).filter(function (b) { return b.stage < GO.LAST_STAGE; })[0] || {}).id; render(); }
    else if (act === 'pay-method') { P.method = id; render(); }
    else if (act === 'pay-lookup') {
      S.fetchOrder($('#payLookup').value).then(function (found) {
        if (found) go('#/pay/' + found.batchId + '/' + found.id);
        else { $('#lookupMsg').textContent = L('Nomor pesanan tidak ditemukan.', '주문번호를 찾을 수 없습니다.'); $('#lookupMsg').className = 'err'; }
      });
    }
    else if (act === 'pay-voucher') {
      S.checkVoucher(P.voucher).then(function (v) {
        if (!P) return;
        P.off = v ? v.off : 0;
        $('#vMsg').textContent = v ? L('Voucher aktif', '쿠폰 적용됨') + ': −' + rp(v.off) : L('Kode voucher tidak ditemukan.', '쿠폰 코드를 찾을 수 없습니다.');
        drawPay();
      });
    }
    else if (act === 'receipt') showReceipt(id);
    else if (act === 'my-clear') { try { localStorage.removeItem(MY_KEY); } catch (x) {} render(); }
    else if (act === 'modal-close') t.closest('.modal').remove();
    else if (act === 'receipt-save') saveReceipt(id);
    else if (act === 'export') exportOrders();
    else if (act === 'reset') { if (confirm(L('Semua data kembali ke contoh awal. Lanjutkan?', '모든 데이터가 처음 예시로 돌아갑니다. 계속할까요?'))) { S.reset().then(function () { A.rows = null; C = null; render(); }); } }
    else if (act === 'logout') S.logout().then(render);
    else if (act === 'batch-del') { if (confirm(L('Hapus batch ini beserta pesanannya?', '이 배치와 그 안의 주문을 삭제할까요?'))) { S.removeBatch(id); render(); } }
    else if (act === 'order-del') { if (confirm(L('Hapus pesanan ini?', '이 주문을 삭제할까요?'))) { S.removeOrder(id); render(); } }
    else if (act === 'pay-ok') { S.updateOrder(id, { pay: 'paid' }); render(); }
    else if (act === 'pay-no') { S.updateOrder(id, { pay: 'rejected' }); render(); }
    else if (act === 'sample') { A.text = $('[data-admin="text"]').getAttribute('placeholder'); A.rows = null; render(); }
    else if (act === 'classify') {
      var batch = S.batch(A.batchId);
      GO.ai.classify(A.text).then(function (res) {
        A.engine = res.engine;
        A.rows = res.rows.map(function (r) { r.total = rowTotal(r, batch); return r; });
        render();
      });
    }
    else if (act === 'row-del') { A.rows.splice(+id, 1); render(); }
    else if (act === 'rows-save') {
      var bad = A.rows.filter(function (r) { return !String(r.buyer).trim() || !String(r.item).trim() || !(Number(r.total) > 0); }).length;
      if (bad) { $('#rowErr').textContent = bad + ' ' + L('baris belum lengkap (pembeli, item, total).', '줄이 비어 있습니다 (구매자·품목·합계).'); return; }
      A.rows.forEach(function (r) { S.addOrder({ batchId: A.batchId, buyer: String(r.buyer).trim().replace(/^@/, ''), item: String(r.item).trim(), qty: Math.max(1, Number(r.qty) || 1), total: Math.round(Number(r.total)), method: '', proofName: '' }); });
      A.rows = null; A.text = ''; render();
    }
  });

  document.addEventListener('input', function (e) {
    var t = e.target, k;
    if ((k = t.getAttribute('data-calc'))) {
      if (k === 'cur') { C.cur = t.value; C.kurs = GO.CURRENCIES[t.value].kurs; render(); return; }
      setPath(C, k, k === 'tax.base' ? t.value : t.value === '' ? 0 : Number(t.value));
      drawCalc();
    } else if ((k = t.getAttribute('data-pay'))) {
      if (k === 'file') { P.fileName = t.files[0] ? t.files[0].name : ''; $('#fileName').textContent = P.fileName || L('Belum ada file dipilih', '선택된 파일 없음'); return; }
      P[k] = t.value;
      if (k === 'batchId') { render(); return; }   // 마감 안내가 배치에 따라 달라진다
      if (k === 'voucher') { P.off = 0; }
      drawPay();
    } else if ((k = t.getAttribute('data-admin'))) {
      A[k] = t.value;
      if (k === 'batchId') { A.rows = null; render(); }
      if (k === 'q') drawFind();
    } else if (t.hasAttribute('data-row')) {
      var r = A.rows[+t.getAttribute('data-row')], f = t.getAttribute('data-f');
      r[f] = t.value; r.missing = r.missing.filter(function (m) { return m !== f; });
      t.parentNode.classList.toggle('miss', !String(t.value).trim());
    }
  });
  document.addEventListener('change', function (e) {
    var t = e.target, k;
    if ((k = t.getAttribute('data-bstage'))) S.updateBatch(k, { stage: +t.value });
    else if ((k = t.getAttribute('data-bnote'))) S.updateBatch(k, { note: t.value.trim() });
    else if ((k = t.getAttribute('data-opay'))) S.updateOrder(k, { pay: t.value });
  });
  document.addEventListener('keydown', function (e) { var m = $('.modal'); if (e.key === 'Escape' && m) m.remove(); });
  // 화면을 옮길 때마다 서버 내용을 다시 읽는다. 무언가 입력하는 중이면 화면을 다시 그리지 않는다.
  function typing() { var a = document.activeElement; return !!(a && a.closest && a.closest('#app') && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)); }
  window.addEventListener('hashchange', function () {
    render(); window.scrollTo(0, 0);
    S.refresh().then(function (changed) { if (changed && !typing()) render(); });
  });
  GO.onStoreError = function (e) { render(); alert(L('Perubahan tidak tersimpan: ', '변경 내용이 저장되지 않았습니다: ') + e.message); };
  GO.render = render;
  S.init().then(render);
})(window.GO);
