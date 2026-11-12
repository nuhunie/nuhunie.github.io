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
  var lang = 'id';
  try { lang = localStorage.getItem('go-lang') || 'id'; } catch (e) {}

  // 배색 후보: [이름, 견본색, 표시 이름]. 실제 색 값은 css/app.css의 [data-theme]에 있다.
  var THEMES = [
    ['pink', '#d6336c', ['Pink', '핑크']], ['blossom', '#f3acd0', ['Pink pastel', '파스텔 핑크']], ['sky', '#0b76b8', ['Biru langit', '스카이블루']], ['mint', '#0b7f63', ['Mint', '민트']],
    ['violet', '#6d45c4', ['Ungu', '바이올렛']], ['mono', '#111', ['Hitam putih', '흑백']]
  ];

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
    return '<form class="search" data-form="track"><input name="q" value="' + esc(q || '') + '" placeholder="' + L('Nomor pesanan atau username', '주문번호 또는 아이디') + '" aria-label="' + L('Cari pesanan', '주문 검색') + '"><button class="btn">' + L('Cari', '조회') + '</button></form>';
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
    return '<section class="hero"><img src="' + GO.BRAND.mark + '" alt="" width="72" height="72"><div><h1>' + esc(GO.BRAND.name) + '</h1><p>' + esc(LL(GO.BRAND.tagline)) + '</p></div></section>' +
      '<section><h2>' + L('Layanan', '서비스') + '</h2><p class="lead">' + L('Pilih layanan untuk melihat batch bulan ini dan rekapnya.', '서비스를 고르면 이번 달 배치와 집계를 볼 수 있습니다.') + '</p><div class="svc-grid">' + cards + '</div></section>' +
      '<section><h2>' + L('Lacak pesanan', '주문 조회') + '</h2>' + searchForm('') + '</section>' +
      '<section><h2>' + L('Cara order', '이용 방법') + '</h2><ol class="how">' + how + '</ol></section>';
  }

  /* ── 서비스 → 월별 배치 ── */
  function vService(svcId, month) {
    var s = S.service(svcId);
    if (!s) return empty(L('Layanan tidak ditemukan.', '서비스를 찾을 수 없습니다.'));
    var months = S.monthsOf(svcId);
    if (!month || months.indexOf(month) < 0) month = months[0];
    var tabs = months.map(function (m) { return '<a class="' + (m === month ? 'on' : '') + '" href="#/s/' + svcId + '/' + m + '">' + esc(monthLabel(m)) + '</a>'; }).join('');
    var list = month ? S.batchesOf(svcId, month) : [];
    var r = X.monthRecap(list, S.db.orders);
    var rows = list.map(function (b) {
      var br = X.batchRecap(b.id, S.db.orders);
      return '<a class="row" href="#/b/' + b.id + '"><div><b>' + esc(batchName(b)) + '</b><small>' + L('Tutup order', '주문 마감') + ' ' + esc(dateLabel(b.closeDate)) + '</small></div>' +
        stageBadge(b) + '<span class="num">' + br.count + ' ' + L('pesanan', '건') + '</span><span class="num">' + rp(br.total) + '</span><span class="arrow">→</span></a>';
    }).join('');
    return crumbs([[L('Layanan', '서비스'), '#/'], [LL(s.name)]]) +
      '<h1>' + esc(LL(s.name)) + '</h1><p class="lead">' + esc(LL(s.desc)) + '</p>' +
      (months.length ? '<div class="tabs">' + tabs + '</div>' +
        '<h2 class="sub">' + L('Rekap bulan ini', '월 집계') + ' · ' + esc(monthLabel(month)) + '</h2>' +
        '<div class="stats">' + stat(L('Batch', '배치'), r.batches) + stat(L('Sedang berjalan', '진행 중'), r.ongoing) + stat(L('Pesanan', '주문'), r.count) + stat(L('Jumlah pcs', '수량'), r.pcs) + stat(L('Total', '합계'), rp(r.total)) + '</div>' +
        '<h2 class="sub">' + L('Daftar batch', '배치 목록') + '</h2><div class="rows">' + rows + '</div>'
        : empty(L('Belum ada batch.', '아직 배치가 없습니다.')));
  }

  /* ── 배치 상세 + 리캡 ── */
  function vBatch(id) {
    var b = S.batch(id);
    if (!b) return empty(L('Batch tidak ditemukan.', '배치를 찾을 수 없습니다.'));
    var s = S.service(b.svc), r = X.batchRecap(id, S.db.orders), orders = S.ordersOf(id);
    var items = r.items.map(function (it) { return '<tr><td>' + esc(it.item) + '</td><td class="r">' + it.qty + '</td><td class="r">' + rp(it.total) + '</td></tr>'; }).join('');
    var ords = orders.map(function (o) {
      return '<tr><td><a href="#/track/' + o.id + '">' + o.id + '</a></td><td>' + esc(X.maskName(o.buyer)) + '</td><td>' + esc(o.item) + '</td><td class="r">' + o.qty + '</td><td class="r">' + rp(o.total) + '</td><td>' + payBadge(o.pay) + '</td></tr>';
    }).join('');
    return crumbs([[L('Layanan', '서비스'), '#/'], [LL(s.name), '#/s/' + s.id + '/' + b.month], [batchName(b)]]) +
      '<div class="head"><div><h1>' + esc(batchName(b)) + '</h1><p class="lead">' + esc(monthLabel(b.month)) + ' · ' + L('Tutup order', '주문 마감') + ' ' + esc(dateLabel(b.closeDate)) + '</p></div>' +
      '<a class="btn" href="#/pay/' + b.id + '">' + L('Konfirmasi pembayaran', '결제 확인하기') + '</a></div>' +
      stepper(GO.STAGES.map(LL), b.stage, b.stage === GO.LAST_STAGE) +
      (b.note ? '<p class="note"><b>' + L('Info', '안내') + '</b> ' + esc(b.note) + '</p>' : '') +
      '<h2 class="sub">' + L('Rekap batch', '배치 집계') + '</h2>' +
      '<div class="stats">' + stat(L('Pesanan', '주문'), r.count) + stat(L('Jumlah pcs', '수량'), r.pcs) + stat(L('Total', '합계'), rp(r.total)) + stat(L('Lunas', '결제 완료'), r.paid + ' / ' + r.count) + stat(L('Menunggu verifikasi', '확인 대기'), r.pending) + '</div>' +
      (r.count ? '<h2 class="sub">' + L('Rekap per item', '품목별 집계') + '</h2><div class="tbl"><table><thead><tr><th>Item</th><th class="r">' + L('Jumlah', '수량') + '</th><th class="r">' + L('Total', '합계') + '</th></tr></thead><tbody>' + items + '</tbody></table></div>' +
        '<h2 class="sub">' + L('Daftar pesanan', '주문 목록') + '</h2><div class="tbl"><table><thead><tr><th>' + L('No. pesanan', '주문번호') + '</th><th>' + L('Pembeli', '구매자') + '</th><th>Item</th><th class="r">' + L('Jumlah', '수량') + '</th><th class="r">' + L('Total', '합계') + '</th><th>' + L('Pembayaran', '결제') + '</th></tr></thead><tbody>' + ords + '</tbody></table></div>'
        : empty(L('Belum ada pesanan di batch ini.', '이 배치에는 아직 주문이 없습니다.')));
  }

  /* ── 주문 조회 ── */
  function vTrack(q) {
    var found = q ? X.searchOrders(S.db.orders, q) : [];
    var labels = [L('Pembayaran', '결제')].concat(GO.STAGES.slice(1).map(LL));
    var cards = found.map(function (o) {
      var b = S.batch(o.batchId), s = S.service(b.svc), p = X.orderProgress(o, b);
      return '<article class="card"><div class="head"><div><small>' + o.id + ' · ' + esc(dateLabel(o.createdAt)) + '</small><h3>' + esc(o.item) + '</h3>' +
        '<p class="lead">' + esc(X.maskName(o.buyer)) + ' · ' + o.qty + ' pcs · ' + rp(o.total) + '</p></div><div class="right">' + payBadge(o.pay) + '</div></div>' +
        stepper(labels, p.cur, p.finished) +
        '<p class="where">' + L('Posisi sekarang', '현재 위치') + ': <b>' + esc(o.pay === 'paid' ? LL(GO.STAGES[b.stage]) : LL(GO.PAY[o.pay])) + '</b> · <a href="#/b/' + b.id + '">' + esc(LL(s.name) + ' / ' + batchName(b)) + '</a></p>' +
        (b.note ? '<p class="note"><b>' + L('Info', '안내') + '</b> ' + esc(b.note) + '</p>' : '') +
        (o.pay === 'unpaid' || o.pay === 'rejected' ? '<a class="btn" href="#/pay/' + b.id + '/' + o.id + '">' + L('Bayar pesanan ini', '이 주문 결제하기') + '</a>' : '') + '</article>';
    }).join('');
    return '<h1>' + L('Lacak pesanan', '주문 조회') + '</h1><p class="lead">' + L('Masukkan nomor pesanan atau username untuk melihat posisi dan status pesanan.', '주문번호나 아이디를 입력하면 주문 위치와 상태를 볼 수 있습니다.') + '</p>' + searchForm(q) +
      (q ? (found.length ? '<p class="count">' + found.length + ' ' + L('pesanan ditemukan', '건 찾음') + '</p>' + cards : empty(L('Pesanan tidak ditemukan. Periksa lagi nomor pesanan atau username.', '주문을 찾지 못했습니다. 주문번호나 아이디를 다시 확인해 주세요.')))
        : '<p class="hint">' + L('Contoh', '예시') + ': ' + S.db.orders[0].id + ', ' + esc(S.db.orders[0].buyer) + '</p>');
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
    return '<div class="head"><div><h1>' + L('Kalkulator harga', '가격 계산기') + '</h1><p class="lead">' + L('Atur cara hitung tiap biaya: persen, nominal per pcs, atau pengali.', '수수료마다 퍼센트·개당 금액·배수 중에서 고를 수 있습니다.') + '</p></div>' +
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
    var o = orderId ? S.order(orderId) : null, b = S.batch(o ? o.batchId : batchId) || S.db.batches[0];
    P = { svc: b.svc, batchId: b.id, orderId: o ? o.id : '', id: o ? o.id : S.newOrderId(), buyer: o ? o.buyer : '', item: o ? o.item : '', qty: o ? o.qty : 1, base: o ? o.total : '', voucher: '', off: 0, method: 'QRIS', fileName: '', err: '' };
  }
  function payAmount() {
    var base = Number(P.base) || 0;
    if (!base) return { base: 0, off: 0, code: 0, total: 0 };
    var code = X.uniqueCode(P.id), off = Math.min(P.off, base);
    return { base: base, off: off, code: code, total: base - off + code };
  }
  function vPay() {
    var svcs = S.db.services.map(function (s) { return '<button type="button" class="' + (s.id === P.svc ? 'on' : '') + '" data-act="pay-svc" data-id="' + s.id + '"' + (P.orderId ? ' disabled' : '') + '>' + esc(LL(s.name)) + '</button>'; }).join('');
    var bs = S.batchesOf(P.svc).map(function (b) { return '<option value="' + b.id + '"' + (b.id === P.batchId ? ' selected' : '') + '>' + esc(batchName(b)) + ' (' + esc(monthLabel(b.month)) + ')</option>'; }).join('');
    var lock = P.orderId ? ' readonly' : '';
    return '<h1>' + L('Konfirmasi pembayaran', '결제 확인') + '</h1><p class="lead">' + L('Isi data pesanan, bayar lewat QR, lalu unggah bukti pembayaran.', '주문 정보를 입력하고 QR로 결제한 뒤 증빙을 올려 주세요.') + '</p>' +
      '<form class="two" data-form="pay"><div class="panel"><h2>' + L('Data pesanan', '주문 정보') + '</h2>' +
      (P.orderId ? '<p class="note">' + L('Pesanan', '주문') + ' <b>' + P.orderId + '</b></p>' : '') +
      '<div class="field"><label>' + L('Pilih layanan', '서비스 선택') + ' *</label><div class="seg wide">' + svcs + '</div></div>' +
      '<div class="field"><label>' + L('Nomor batch', '배치 번호') + ' *</label><select data-pay="batchId"' + (P.orderId ? ' disabled' : '') + '>' + bs + '</select></div>' +
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
  }
  function submitPay() {
    var a = payAmount();
    if (!P.buyer.trim() || !P.item.trim() || !a.total) { P.err = L('Lengkapi nama pembeli, item, dan total harga.', '구매자, 품목, 총 금액을 입력해 주세요.'); }
    else if (!P.fileName) { P.err = L('Unggah bukti pembayaran terlebih dahulu.', '결제 증빙을 먼저 올려 주세요.'); }
    else P.err = '';
    if (P.err) { $('#payErr').textContent = P.err; return; }
    var patch = { batchId: P.batchId, buyer: P.buyer.trim().replace(/^@/, ''), item: P.item.trim(), qty: Math.max(1, Number(P.qty) || 1), total: a.total, pay: 'pending', method: P.method, proofName: P.fileName };
    var o = P.orderId ? S.updateOrder(P.orderId, patch) : S.addOrder(Object.assign({ id: P.id }, patch));
    P = null;
    go('#/track/' + o.id);
    showReceipt(o.id);
  }

  /* ── 영수증 ── */
  function showReceipt(orderId) {
    var o = S.order(orderId); if (!o) return;
    var b = S.batch(o.batchId), s = S.service(b.svc);
    var when = new Date(o.createdAt).toLocaleString(loc(), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    var m = document.createElement('div');
    m.className = 'modal'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
    m.innerHTML = '<div class="receipt"><button class="x" data-act="modal-close" aria-label="' + L('Tutup', '닫기') + '">×</button>' +
      '<div class="r-head"><b>' + esc(GO.BRAND.name) + '</b><small>' + L('Bukti pesanan', '주문 영수증') + '</small></div>' +
      '<dl><dt>No.</dt><dd>' + o.id + '</dd><dt>' + L('Tanggal', '일시') + '</dt><dd>' + esc(when) + '</dd><dt>' + L('Pembeli', '구매자') + '</dt><dd>' + esc(o.buyer) + '</dd><dt>' + L('Metode', '결제 수단') + '</dt><dd>' + esc(o.method || '-') + '</dd><dt>Status</dt><dd>' + esc(LL(GO.PAY[o.pay])) + '</dd></dl>' +
      '<div class="r-item"><div><b>' + esc(o.item) + '</b><small>' + esc(batchName(b) + ' (' + LL(s.name) + ')') + ' · ' + o.qty + ' pcs</small></div></div>' +
      '<div class="total"><span>TOTAL</span><b>' + rp(o.total) + '</b></div>' +
      '<p class="thanks">' + L('Terima kasih sudah order.', '주문해 주셔서 감사합니다.') + '</p>' +
      '<button class="btn block" data-act="receipt-save" data-id="' + o.id + '">' + L('Simpan gambar', '이미지로 저장') + '</button></div>';
    document.body.appendChild(m);
    m.querySelector('.x').focus();
  }
  function saveReceipt(orderId) {
    var o = S.order(orderId), b = S.batch(o.batchId), s = S.service(b.svc);
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
  var A = { batchId: '', text: '', rows: null, engine: '' };
  function vAdmin(tab) {
    tab = tab || 'guide';
    var tabs = [['guide', L('Panduan', '사용 안내')], ['batch', L('Batch', '배치')], ['order', L('Input pesanan', '주문 입력')], ['pay', L('Verifikasi pembayaran', '결제 확인')]];
    var pendingN = S.db.orders.filter(function (o) { return o.pay === 'pending'; }).length;
    return '<div class="head"><div><h1>' + L('Admin', '관리자') + '</h1><p class="lead">' + L('Data yang diisi di sini langsung tampil di halaman pelanggan.', '여기서 입력한 내용이 고객 화면에 바로 나타납니다.') + '</p></div><div class="btns"><button class="btn" data-act="export">' + L('Unduh CSV pesanan', '주문 CSV 내려받기') + '</button><button class="btn line" data-act="reset">' + L('Reset data contoh', '예시 데이터로 초기화') + '</button></div></div>' +
      '<p class="note">' + L('Mockup: belum ada login admin dan data hanya tersimpan di browser ini.', '목업: 관리자 로그인이 아직 없고, 데이터는 이 브라우저에만 저장됩니다.') + '</p>' +
      '<div class="tabs">' + tabs.map(function (t) { return '<a class="' + (t[0] === tab ? 'on' : '') + '" href="#/admin/' + t[0] + '">' + esc(t[1]) + (t[0] === 'pay' && pendingN ? ' <i class="dot">' + pendingN + '</i>' : '') + '</a>'; }).join('') + '</div>' +
      ({ guide: aGuide, batch: aBatch, order: aOrder, pay: aPay }[tab] || aGuide)();
  }
  function aGuide() {
    var g = [
      [L('Buat batch', '배치 만들기'), L('Tab Batch → isi layanan, nomor, nama, bulan, tanggal tutup, kurs. Batch langsung muncul di halaman layanan.', '배치 탭에서 서비스·번호·이름·월·마감일·환율을 입력합니다. 서비스 화면에 바로 나타납니다.'), 'batch'],
      [L('Masukkan pesanan', '주문 넣기'), L('Tab Input pesanan → tempel daftar order dari chat. Sistem memisahkan pembeli, item, jumlah, dan harga secara otomatis. Periksa lalu simpan.', '주문 입력 탭에 채팅의 주문 목록을 붙여 넣으면 구매자·품목·수량·가격을 자동으로 나눕니다. 확인 후 저장합니다.'), 'order'],
      [L('Verifikasi pembayaran', '결제 확인'), L('Tab Verifikasi → setujui atau tolak bukti yang dikirim pelanggan.', '결제 확인 탭에서 고객이 보낸 증빙을 승인하거나 반려합니다.'), 'pay'],
      [L('Perbarui status batch', '배치 상태 갱신'), L('Tab Batch → ubah tahap (dibeli, dikirim, tiba, selesai) dan tulis info. Pelanggan melihatnya saat melacak pesanan.', '배치 탭에서 단계(구매·배송·도착·완료)를 바꾸고 안내를 적습니다. 고객이 주문 조회에서 봅니다.'), 'batch'],
      [L('Hitung harga', '가격 계산'), L('Menu Kalkulator → simpan rumus fee sebagai default. Harga mata uang asing di Input pesanan dihitung dengan rumus ini.', '계산기 메뉴에서 수수료 수식을 기본값으로 저장합니다. 주문 입력의 외화 가격은 이 수식으로 환산됩니다.'), null]
    ];
    return '<ol class="how">' + g.map(function (x, i) {
      return '<li><em>' + (i + 1) + '</em><div><b>' + esc(x[0]) + '</b><p>' + esc(x[1]) + '</p>' + (x[2] ? '<a href="#/admin/' + x[2] + '">' + L('Buka', '열기') + ' →</a>' : '<a href="#/calc">' + L('Buka', '열기') + ' →</a>') + '</div></li>';
    }).join('') + '</ol><p class="hint">' + L('Voucher contoh', '예시 쿠폰') + ': ' + S.db.vouchers.map(function (v) { return v.code + ' (−' + rp(v.off) + ')'; }).join(', ') + '</p>';
  }
  function svcOptions(sel) { return S.db.services.map(function (s) { return '<option value="' + s.id + '"' + (s.id === sel ? ' selected' : '') + '>' + esc(LL(s.name)) + '</option>'; }).join(''); }
  function batchOptions(sel) { return S.db.batches.slice().sort(function (a, b) { return a.month < b.month ? 1 : a.month > b.month ? -1 : b.no - a.no; }).map(function (b) { return '<option value="' + b.id + '"' + (b.id === sel ? ' selected' : '') + '>' + esc(LL(S.service(b.svc).name) + ' / ' + batchName(b) + ' (' + b.month + ')') + '</option>'; }).join(''); }
  function aBatch() {
    var rows = S.db.batches.slice().sort(function (a, b) { return a.month < b.month ? 1 : a.month > b.month ? -1 : a.svc < b.svc ? -1 : a.svc > b.svc ? 1 : b.no - a.no; }).map(function (b) {
      return '<tr><td>' + b.month + '</td><td>' + esc(LL(S.service(b.svc).name)) + '</td><td><a href="#/b/' + b.id + '">' + esc(batchName(b)) + '</a></td>' +
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
      '<h2 class="sub">' + L('Semua batch', '전체 배치') + '</h2><div class="tbl"><table class="edit"><thead><tr><th>' + L('Bulan', '월') + '</th><th>' + L('Layanan', '서비스') + '</th><th>Batch</th><th>' + L('Tahap', '단계') + '</th><th>Info</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }
  function aOrder() {
    if (!S.batch(A.batchId)) A.batchId = (S.db.batches.filter(function (b) { return b.stage === 0; })[0] || S.db.batches[0] || {}).id || '';
    var sample = 'Batch 4\n@nadya / Photocard random 1 pc / 2pcs / Rp 25.000\ndinda - album mini - 285k\n3. rara, acrylic stand, x1, ¥2000\ntiara lightstick strap 135rb';
    var prev = '';
    if (A.rows) {
      prev = '<h2 class="sub">' + L('Hasil pemisahan', '분류 결과') + ' <small>(' + (A.engine === 'ai' ? 'AI' : L('aturan otomatis', '규칙 기반 자동 분류')) + ')</small></h2>' +
        (A.rows.length ? '<div class="tbl"><table class="edit"><thead><tr><th>' + L('Pembeli', '구매자') + '</th><th>Item</th><th>' + L('Jumlah', '수량') + '</th><th>' + L('Harga asli', '원래 가격') + '</th><th>Total (Rp)</th><th></th></tr></thead><tbody>' +
          A.rows.map(function (r, i) {
            function cell(f, type) { return '<td class="' + (r.missing.indexOf(f) >= 0 || (f === 'total' && !r.total) ? 'miss' : '') + '"><input ' + (type ? 'type="number" ' : '') + 'data-row="' + i + '" data-f="' + f + '" value="' + esc(r[f] == null ? '' : r[f]) + '" aria-label="' + f + '"></td>'; }
            return '<tr>' + cell('buyer') + cell('item') + cell('qty', 1) + '<td class="src">' + (r.price != null ? esc((GO.CURRENCIES[r.cur] || {}).sym + ' ' + r.price.toLocaleString('id-ID')) : '-') + '</td>' + cell('total', 1) + '<td><button class="link" data-act="row-del" data-id="' + i + '">' + L('Hapus', '삭제') + '</button></td></tr>';
          }).join('') + '</tbody></table></div>' +
          '<p class="hint">' + L('Kolom bertanda merah belum terbaca. Isi dulu sebelum menyimpan. Harga mata uang asing dihitung dengan kurs batch dan rumus default kalkulator.', '빨간 칸은 읽지 못한 항목입니다. 채운 뒤 저장하세요. 외화 가격은 배치 환율과 계산기 기본 수식으로 환산했습니다.') + '</p>' +
          '<p class="err" id="rowErr" role="alert"></p><button class="btn" data-act="rows-save">' + L('Simpan', '저장') + ' ' + A.rows.length + ' ' + L('pesanan', '건') + '</button>'
          : empty(L('Tidak ada baris yang bisa dibaca.', '읽을 수 있는 줄이 없습니다.')));
    }
    var list = S.ordersOf(A.batchId).map(function (o) {
      return '<tr><td>' + o.id + '</td><td>' + esc(o.buyer) + '</td><td>' + esc(o.item) + '</td><td class="r">' + o.qty + '</td><td class="r">' + rp(o.total) + '</td>' +
        '<td><select data-opay="' + o.id + '" aria-label="' + L('Pembayaran', '결제') + '">' + Object.keys(GO.PAY).map(function (k) { return '<option value="' + k + '"' + (k === o.pay ? ' selected' : '') + '>' + esc(LL(GO.PAY[k])) + '</option>'; }).join('') + '</select></td>' +
        '<td><button class="link" data-act="order-del" data-id="' + o.id + '">' + L('Hapus', '삭제') + '</button></td></tr>';
    }).join('');
    return '<div class="panel"><h2>' + L('Tempel daftar order', '주문 목록 붙여 넣기') + '</h2>' +
      '<p class="lead">' + L('Satu baris = satu pesanan. Urutan bebas: sistem mengenali pembeli, item, jumlah, dan harga.', '한 줄에 주문 하나. 순서는 자유이며 구매자·품목·수량·가격을 알아서 구분합니다.') + '</p>' +
      '<div class="field"><label>' + L('Masuk ke batch', '넣을 배치') + '</label><select data-admin="batchId">' + batchOptions(A.batchId) + '</select></div>' +
      '<div class="field"><label>' + L('Teks order', '주문 글') + '</label><textarea rows="7" data-admin="text" placeholder="' + esc(sample) + '">' + esc(A.text) + '</textarea></div>' +
      '<div class="btns"><button class="btn" data-act="classify">' + L('Pisahkan otomatis', '자동으로 분류') + '</button><button class="btn line" data-act="sample">' + L('Isi contoh', '예시 채우기') + '</button></div></div>' + prev +
      '<h2 class="sub">' + L('Pesanan di batch ini', '이 배치의 주문') + '</h2>' + (list ? '<div class="tbl"><table class="edit"><thead><tr><th>' + L('No. pesanan', '주문번호') + '</th><th>' + L('Pembeli', '구매자') + '</th><th>Item</th><th class="r">' + L('Jumlah', '수량') + '</th><th class="r">Total</th><th>' + L('Pembayaran', '결제') + '</th><th></th></tr></thead><tbody>' + list + '</tbody></table></div>' : empty(L('Belum ada pesanan.', '아직 주문이 없습니다.')));
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
    return list.length ? '<div class="tbl"><table><thead><tr><th>' + L('No. pesanan', '주문번호') + '</th><th>Batch</th><th>' + L('Pembeli', '구매자') + '</th><th>Item</th><th class="r">Total</th><th>' + L('Metode', '수단') + '</th><th>' + L('Bukti', '증빙') + '</th><th></th></tr></thead><tbody>' +
      list.map(function (o) {
        var b = S.batch(o.batchId);
        return '<tr><td>' + o.id + '</td><td>' + esc(batchName(b)) + '</td><td>' + esc(o.buyer) + '</td><td>' + esc(o.item) + '</td><td class="r">' + rp(o.total) + '</td><td>' + esc(o.method) + '</td><td>' + esc(o.proofName || '-') + '</td>' +
          '<td class="acts"><button class="btn sm" data-act="pay-ok" data-id="' + o.id + '">' + L('Setujui', '승인') + '</button><button class="btn line sm" data-act="pay-no" data-id="' + o.id + '">' + L('Tolak', '반려') + '</button></td></tr>';
      }).join('') + '</tbody></table></div><p class="hint">' + L('Mockup hanya menyimpan nama file bukti, bukan gambarnya.', '목업에서는 증빙 이미지가 아니라 파일 이름만 저장합니다.') + '</p>'
      : empty(L('Tidak ada pembayaran yang menunggu verifikasi.', '확인을 기다리는 결제가 없습니다.'));
  }

  // 전체 주문을 스프레드시트용 CSV 파일로 내려받는다 (Excel·Google Sheets에서 열림)
  function exportOrders() {
    var rows = [['order_no', 'date', 'service', 'month', 'batch', 'batch_stage', 'buyer', 'item', 'qty', 'total_idr', 'payment', 'method']];
    S.db.orders.forEach(function (o) {
      var b = S.batch(o.batchId), s = S.service(b.svc);
      rows.push([o.id, o.createdAt.slice(0, 10), LL(s.name), b.month, batchName(b), LL(GO.STAGES[b.stage]), o.buyer, o.item, o.qty, o.total, LL(GO.PAY[o.pay]), o.method]);
    });
    var blob = new Blob(['﻿' + X.toCSV(rows)], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = GO.BRAND.name.toLowerCase() + '-orders.csv'; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  // 화면이 짧아 스크롤할 것이 없으면 이동 버튼을 숨긴다
  function showJump() { $('#jump').hidden = document.documentElement.scrollHeight < window.innerHeight + 300; }
  window.addEventListener('resize', showJump);

  /* ── 라우터 ── */
  function route() { return location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent); }
  function render() {
    var r = route(), html, page = r[0] || 'home';
    var payKey = (r[1] || '') + '/' + (r[2] || '');
    if (page === 'pay' && (!P || P._key !== payKey)) { initPay(r[1], r[2]); P._key = payKey; }
    if (page !== 'pay') P = null;
    if (page === 's') html = vService(r[1], r[2]);
    else if (page === 'b') html = vBatch(r[1]);
    else if (page === 'track') html = vTrack(r[1] || '');
    else if (page === 'calc') html = vCalc();
    else if (page === 'pay') html = vPay();
    else if (page === 'admin') html = vAdmin(r[1]);
    else { page = 'home'; html = vHome(); }
    $('#app').innerHTML = html;
    var navKey = page === 's' || page === 'b' ? 'home' : page;
    $('#nav').innerHTML = [['home', '#/', L('Layanan', '서비스')], ['track', '#/track', L('Lacak pesanan', '주문 조회')], ['calc', '#/calc', L('Kalkulator', '계산기')], ['pay', '#/pay', L('Konfirmasi pembayaran', '결제 확인')], ['admin', '#/admin', L('Admin', '관리자')]]
      .map(function (n) { return '<a href="' + n[1] + '"' + (n[0] === navKey ? ' class="on" aria-current="page"' : '') + '>' + n[2] + '</a>'; }).join('');
    $('#langs').innerHTML = [['id', 'ID', 'Bahasa Indonesia'], ['en', 'EN', 'English'], ['ko', 'KO', '한국어']].map(function (l) { return '<button type="button" class="link' + (l[0] === lang ? ' on' : '') + '" data-act="lang" data-id="' + l[0] + '" title="' + l[2] + '" aria-label="' + l[2] + '" aria-pressed="' + (l[0] === lang) + '">' + l[1] + '</button>'; }).join('');
    $('#jumpTop').setAttribute('aria-label', L('Ke atas', '맨 위로')); $('#jumpTop').title = L('Ke atas', '맨 위로');
    $('#jumpBottom').setAttribute('aria-label', L('Ke bawah', '맨 아래로')); $('#jumpBottom').title = L('Ke bawah', '맨 아래로');
    showJump();
    document.documentElement.lang = lang;
    document.title = GO.BRAND.name; $('#logo').innerHTML = '<img src="' + GO.BRAND.mark + '" alt="" width="26" height="26">' + esc(GO.BRAND.name); $('#foot').textContent = GO.BRAND.name + ' · mockup';
    var theme = document.documentElement.dataset.theme || 'pink';
    $('#themes').innerHTML = THEMES.map(function (t) {
      return '<button type="button" data-act="theme" data-id="' + t[0] + '" class="' + (t[0] === theme ? 'on' : '') + '" style="background:' + t[1] + '" title="' + LL(t[2]) + '" aria-label="' + LL(t[2]) + '" aria-pressed="' + (t[0] === theme) + '"></button>';
    }).join('');
    if (page === 'calc') drawCalc();
    if (page === 'pay') drawPay();
  }

  /* ── 이벤트 ── */
  document.addEventListener('submit', function (e) {
    var f = e.target.getAttribute('data-form'); if (!f) return;
    e.preventDefault();
    if (f === 'track') go('#/track/' + encodeURIComponent(e.target.q.value.trim()));
    else if (f === 'pay') submitPay();
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
    else if (act === 'theme') { document.documentElement.dataset.theme = id; try { localStorage.setItem('go-theme', id); } catch (x) {} render(); }
    else if (act === 'calc-reset') { C = null; render(); }
    else if (act === 'calc-save') { S.setCalcDefaults(C); t.textContent = L('Tersimpan', '저장됨'); }
    else if (act === 'pay-svc') { P.svc = id; P.batchId = (S.batchesOf(id)[0] || {}).id; render(); }
    else if (act === 'pay-method') { P.method = id; render(); }
    else if (act === 'pay-voucher') {
      var v = S.voucher(P.voucher); P.off = v ? v.off : 0;
      $('#vMsg').textContent = v ? L('Voucher aktif', '쿠폰 적용됨') + ': −' + rp(v.off) : L('Kode voucher tidak ditemukan.', '쿠폰 코드를 찾을 수 없습니다.');
      drawPay();
    }
    else if (act === 'modal-close') t.closest('.modal').remove();
    else if (act === 'receipt-save') saveReceipt(id);
    else if (act === 'export') exportOrders();
    else if (act === 'reset') { if (confirm(L('Semua data kembali ke contoh awal. Lanjutkan?', '모든 데이터가 처음 예시로 돌아갑니다. 계속할까요?'))) { S.reset(); A.rows = null; C = null; render(); } }
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
      if (k === 'batchId') return;
      if (k === 'voucher') { P.off = 0; }
      drawPay();
    } else if ((k = t.getAttribute('data-admin'))) {
      A[k] = t.value;
      if (k === 'batchId') { A.rows = null; render(); }
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
  window.addEventListener('hashchange', function () { render(); window.scrollTo(0, 0); });
  render();
})(window.GO);
