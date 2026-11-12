/* 4층: 화면 — 주소(#/...)를 보고 어느 화면을 그릴지 정하고, 클릭·입력을 받아
 * 저장소(store)와 알고리즘(logic)을 호출한다. 계산은 여기서 하지 않는다.
 *
 *  #/                    홈: 서비스 목록 + 주문 조회
 *  #/s/:svc/:month       서비스 → 월별 배치 목록 + 월 집계
 *  #/b/:batchId          배치 상세: 진행 단계 + 리캡
 *  #/track/:query        주문 조회 결과
 *  #/calc                계산기
 *  #/pay/:batchId        주문하기: 그 배치가 골라진 접수 양식 (처음 주문하는 사람)
 *  #/pay/:batchId/:order 접수된 주문의 결제(금액·QR·입금 증빙 제출) → 영수증
 *  #/confirm             결제 확인하기: 주문번호를 넣어 그 주문의 결제 화면으로 (이미 주문한 사람)
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
  /* 서버는 오류를 영어 문장으로 보낸다. 화면 언어에 맞춰 바꿔 보여 준다: [인도네시아어, 한국어].
   * 영어는 다른 문구와 같이 i18n-en.js 에서 찾는다. 표에 없는 문장은 상태 번호로 고르고, 그것도 없으면 서버 문장을 그대로 보여 준다. */
  var MANY = ['Terlalu banyak percobaan. Coba lagi nanti.', '시도가 너무 많습니다. 잠시 뒤 다시 시도해 주세요.'];
  var SERVER_MSG = {
    'Too many new orders from here. Try again later.': ['Terlalu banyak pesanan baru dari sini. Coba lagi nanti.', '여기서 새 주문을 너무 많이 넣었습니다. 잠시 뒤 다시 시도해 주세요.'],
    'Too many requests. Try again later.': MANY,
    'Too many attempts. Try again later.': MANY,
    'Voucher not found.': ['Kode voucher tidak ditemukan.', '쿠폰 코드를 찾을 수 없습니다.'],
    'This voucher has been used up.': ['Voucher ini sudah habis dipakai.', '이 쿠폰은 사용 한도를 다 썼습니다.'],
    'The photo is too large.': ['Foto terlalu besar. Pakai screenshot atau foto yang lebih kecil.', '사진이 너무 큽니다. 화면 캡처나 더 작은 사진을 올려 주세요.'],
    'Upload a JPG, PNG or WebP image.': ['Foto tidak bisa dibaca. Unggah screenshot JPG atau PNG.', '사진을 읽지 못했습니다. JPG나 PNG 화면 캡처를 올려 주세요.'],
    'The voucher on this order was used up while it was rejected.': ['Selama pesanan ini ditolak, voucher-nya sudah habis dipakai pesanan lain, jadi pesanan ini tidak bisa diaktifkan lagi. Buat pesanan baru atau hubungi admin.', '이 주문이 반려된 사이 쿠폰을 다른 주문이 다 써서 되살릴 수 없습니다. 새로 주문하거나 운영자에게 문의해 주세요.'],
    'That voucher code already exists.': ['Kode voucher itu sudah ada.', '같은 쿠폰 코드가 이미 있습니다.'],
    'Check the voucher fields.': ['Periksa kembali data voucher.', '쿠폰 내용을 다시 확인해 주세요.'],
    'That service code already exists.': ['Kode layanan itu sudah ada.', '같은 서비스 코드가 이미 있습니다.'],
    'Check the service fields.': ['Periksa kembali data layanan.', '서비스 내용을 다시 확인해 주세요.'],
    'This service still has batches.': ['Layanan ini masih punya batch. Hapus batch-nya dulu.', '이 서비스에 배치가 남아 있습니다. 배치를 먼저 지워 주세요.'],
    'Order not found.': ['Nomor pesanan tidak ditemukan.', '주문번호를 찾을 수 없습니다.'],
    'Batch not found.': ['Batch tidak ditemukan.', '배치를 찾을 수 없습니다.'],
    'Service not found.': ['Layanan tidak ditemukan.', '서비스를 찾을 수 없습니다.'],
    'This batch is already completed.': ['Batch ini sudah selesai.', '이 배치는 이미 완료됐습니다.'],
    'This order has already been submitted.': ['Bukti pembayaran untuk pesanan ini sudah dikirim.', '이 주문은 결제 증빙을 이미 제출했습니다.'],
    'Buyer, item, quantity and total are required.': ['Lengkapi nama pembeli, item, jumlah, dan total harga.', '구매자, 품목, 수량, 총 금액을 확인해 주세요.'],
    'Check the order fields.': ['Periksa kembali data pesanan.', '주문 내용을 다시 확인해 주세요.'],
    'Payment method and proof are required.': ['Pilih metode pembayaran dan unggah bukti.', '결제 수단을 고르고 증빙을 올려 주세요.'],
    'Create the order first.': ['Buat pesanan terlebih dahulu.', '먼저 주문을 접수해 주세요.'],
    'Check the batch fields.': ['Periksa kembali data batch.', '배치 내용을 다시 확인해 주세요.'],
    'That batch number already exists.': ['Nomor batch itu sudah ada.', '그 배치 번호는 이미 있습니다.'],
    'Note is too long.': ['Info terlalu panjang.', '안내문이 너무 깁니다.'],
    'Bad stage.': ['Tahap tidak valid.', '단계 값이 올바르지 않습니다.'],
    'Bad payment status.': ['Status pembayaran tidak valid.', '결제 상태 값이 올바르지 않습니다.'],
    'Order number is taken.': ['Nomor pesanan sudah dipakai.', '이미 쓰인 주문번호입니다.'],
    'Already exists.': ['Sudah ada.', '이미 있습니다.'],
    'Admin sign-in required.': ['Sesi admin berakhir. Silakan masuk lagi.', '관리자 로그인이 끝났습니다. 다시 로그인해 주세요.'],
    'Reset is disabled here.': ['Reset dimatikan di sini.', '여기서는 초기화가 꺼져 있습니다.'],
    'This order has expired.': ['Pesanan ini dibatalkan otomatis karena belum dibayar sampai batas waktu. Silakan buat pesanan baru.', '이 접수는 기한까지 결제되지 않아 자동으로 취소되었습니다. 새로 접수해 주세요.'],
    'This order is past its payment deadline. Reject or delete it instead.': ['Batas bayar pesanan ini sudah lewat, jadi tidak bisa dikembalikan ke "Belum bayar". Tolak atau hapus pesanan ini.', '입금 기한이 지난 접수라 미결제로 되돌릴 수 없습니다. 반려하거나 삭제해 주세요.'],
    'Server error.': ['Terjadi kesalahan di server. Coba lagi.', '서버에 문제가 생겼습니다. 다시 시도해 주세요.']
  };
  var STATUS_MSG = { 404: ['Tidak ditemukan.', '찾을 수 없습니다.'], 409: ['Sudah berubah. Muat ulang halaman.', '내용이 이미 바뀌었습니다. 새로 고쳐 주세요.'], 429: MANY, 500: SERVER_MSG['Server error.'] };
  function errText(e) {
    if (!e) return '';
    var p = SERVER_MSG[e.message] || STATUS_MSG[e.status >= 500 ? 500 : e.status];
    return p ? LL(p) : String(e.message || '');
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function rp(n) { return 'Rp' + Math.round(n || 0).toLocaleString('id-ID'); }
  function loc() { return { ko: 'ko-KR', en: 'en-GB' }[lang] || 'id-ID'; }
  function monthLabel(m) { return new Date(m + '-01T00:00:00').toLocaleDateString(loc(), { year: 'numeric', month: 'long' }); }
  function dateLabel(d) { return d ? new Date(d.length > 10 ? d : d + 'T00:00:00').toLocaleDateString(loc(), { day: 'numeric', month: 'short', year: 'numeric' }) : '-'; }
  function $(sel) { return document.querySelector(sel); }
  function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }
  function batchName(b) { return 'Batch ' + b.no + ' · ' + b.title; }
  // 영수증에 적는 배치 줄. 이 브라우저가 아직 모르는 배치(방금 만든 배치)면 '-'
  function batchLine(b) { return b ? batchName(b) + ' (' + LL(S.service(b.svc).name) + ')' : '-'; }
  function stageBadge(b) {
    var cls = b.stage === GO.LAST_STAGE ? 'done' : b.stage === 0 ? 'open' : 'run';
    return '<span class="badge ' + cls + '">' + esc(LL(GO.STAGES[b.stage])) + '</span>';
  }
  function payBadge(p) { return '<span class="badge pay-' + p + '">' + esc(LL(GO.PAY[p])) + '</span>'; }
  /* 입금 기한: 고객이 접수하고 증빙을 낸 적 없는 결제 전 주문에만 있다. 서버나 저장소가 payBy 를 붙여 줬으면 빈 값이어도 그대로 믿는다
   * (고객에게 온 주문은 증빙 이름이 가려져 있어, 여기서 다시 계산하면 기한 없는 주문에 기한이 생긴다). 없을 때만 같은 규칙(logic.js)으로 계산한다. */
  function payBy(o) { return o && typeof o.payBy === 'string' ? o.payBy : X.payBy(o); }
  function overdue(o) { var by = payBy(o); return !!by && Date.now() >= Date.parse(by); }
  function whenLabel(iso) { return new Date(iso).toLocaleString(loc(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  function leftLabel(iso) {
    var h = Math.max(0, (Date.parse(iso) - Date.now()) / 3600000);
    return h >= 1 ? Math.floor(h) + ' ' + L('jam', '시간') : Math.max(1, Math.round(h * 60)) + ' ' + L('menit', '분');
  }
  /* 기한까지 결제되지 않아 지워진 접수는 이 기기의 목록에 "취소됨"(pay: 'gone')으로 남긴다.
   * 서버에서는 이미 지워져 "없는 번호"로만 나오므로, 고객에게 "취소되었습니다"라고 알려 줄 근거가 이 기록뿐이다. */
  var goneSeen = {};
  function markGone(id) {
    goneSeen[id] = 1;
    try { localStorage.setItem(MY_KEY, JSON.stringify(myOrders().map(function (x) { if (x.id === id) x.pay = 'gone'; return x; }))); } catch (e) {}
  }
  function isGone(id) { return !!goneSeen[id] || myOrders().some(function (x) { return x.id === id && x.pay === 'gone'; }); }
  function goneText() { return LL(SERVER_MSG['This order has expired.']); }
  // 조회 카드·결제 화면·알림 창에 넣는 기한 안내
  function deadlineNote(o) {
    var by = payBy(o);
    if (!by) return '';
    return overdue(o)
      ? '<p class="note warn" data-deadline="overdue"><b>' + L('Batas waktu pembayaran sudah lewat.', '입금 기한이 지났습니다.') + '</b> ' + L('Jika sudah membayar, segera unggah bukti. Jika belum, pesanan ini akan dibatalkan otomatis; silakan buat pesanan baru.', '이미 입금했다면 지금 증빙을 올려 주세요. 입금하지 않았다면 이 접수는 자동으로 취소되니 새로 접수해 주세요.') + '</p>'
      : '<p class="note warn" data-deadline="open"><b>' + L('Belum dibayar.', '아직 결제하지 않았습니다.') + '</b> ' + L('Bayar dan unggah bukti sebelum', '다음 시각까지 입금하고 증빙을 올려 주세요') + ': <b>' + esc(whenLabel(by)) + '</b> (' + L('sisa waktu', '남은 시간') + ': ' + esc(leftLabel(by)) + '). ' + L('Setelah itu pesanan dibatalkan otomatis.', '그 뒤에는 접수가 자동으로 취소됩니다.') + '</p>';
  }
  // 관리자 표에서 결제 전 접수의 남은 시간을 알아보게 하는 표시
  function deadlineBadge(o) {
    var by = payBy(o);
    if (!by) return '';
    return overdue(o) ? ' <span class="badge pay-rejected">' + L('Lewat batas bayar', '입금 기한 지남') + '</span>'
      : ' <span class="badge run">' + L('Sisa waktu bayar', '입금까지') + ' ' + esc(leftLabel(by)) + '</span>';
  }
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
      [L('Bayar dan kirim bukti', '결제 후 증빙 제출'), L('Transfer tepat sesuai nominal, lalu unggah foto bukti.', '안내된 금액을 그대로 이체하고 증빙 사진을 올립니다.')],
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
    // 달 탭은 가장 최근 달부터 열리므로, 다른 달에 있는 접수 중 배치를 놓치지 않게 맨 위에 모아 보여 준다
    var open = S.batchesOf(svcId).filter(function (b) { return b.stage === 0; });
    return crumbs([[L('Layanan', '서비스'), '#/'], [LL(s.name)]]) +
      '<h1>' + esc(LL(s.name)) + '</h1><p class="lead">' + esc(LL(s.desc)) + '</p>' +
      (open.length ? '<h2 class="sub">' + L('Sedang menerima order', '지금 주문 받는 배치') + '</h2><div class="rows" id="openBatches">' + open.map(function (b) { return batchRow(b, false); }).join('') + '</div>' : '') +
      (months.length ? '<div class="tabs">' + tabs + '</div>' +
        '<h2 class="sub">' + L('Rekap bulan ini', '월 집계') + ' · ' + esc(monthLabel(month)) + '</h2>' +
        '<div class="stats three">' + stat(L('Batch', '배치'), r.batches) + stat(L('Sedang berjalan', '진행 중'), r.ongoing) + stat(L('Jumlah pcs', '수량'), r.pcs) + '</div>' +
        '<h2 class="sub">' + L('Daftar batch', '배치 목록') + '</h2><div class="rows">' + rows + '</div>'
        : empty(L('Belum ada batch.', '아직 배치가 없습니다.')));
  }

  /* ── 배치 상세 + 리캡 ── */
  /* 배치 화면의 "주문하기" 단추. 처음 주문하는 사람이 들어가는 문이다.
   * 마감된 배치(단계 1 이상)는 새 주문을 받되 따로 처리되므로 단추에 그 말을 넣는다. 완료된 배치는 새 주문을 받지 않아 단추가 없다. */
  function orderButton(b) {
    if (b.stage === GO.LAST_STAGE) return '';
    return '<a class="btn" href="#/pay/' + b.id + '">' + (b.stage >= 1 ? L('Pesan untuk pengiriman berikutnya', '다음 배송으로 주문하기') : L('Pesan sekarang', '주문하기')) + '</a>';
  }
  /* 결제 확인하기: 이미 주문한 사람이 주문번호를 넣어 그 주문의 결제 화면으로 간다. 결제 화면은 주문하기와 같은 화면이다. */
  function vConfirm() {
    var open = openOrder();
    return '<h1>' + L('Konfirmasi pembayaran', '결제 확인') + '</h1><p class="lead">' + L('Sudah memesan? Masukkan nomor pesanan untuk melihat nominal dan cara bayar, lalu unggah bukti pembayaran.', '이미 주문하셨나요? 주문번호를 넣으면 결제 금액과 결제 방법이 나오고, 증빙을 올릴 수 있습니다.') + '</p>' +
      (open ? '<p class="note">' + L('Ada pesanan yang belum selesai dibayar', '결제를 마치지 않은 주문이 있습니다') + ': <b>' + open.id + '</b> · <a href="#/pay/' + encodeURIComponent(open.batchId || '-') + '/' + open.id + '">' + L('Lanjutkan pembayaran', '이어서 결제하기') + '</a></p>' : '') +
      '<form class="panel" data-form="confirm"><div class="field"><label for="confirmId">' + L('Nomor pesanan', '주문번호') + '</label><div class="inline"><input id="confirmId" name="q" placeholder="' + GO.BRAND.orderPrefix + '-7K3M9Q2X" autocomplete="off" required><button class="btn">' + L('Muat', '불러오기') + '</button></div>' +
      '<small id="confirmMsg" role="status">' + L('Nomor pesanan ada di bukti pesanan (struk).', '주문번호는 주문 영수증에 있습니다.') + '</small></div></form>' +
      '<p class="hint">' + L('Belum punya pesanan?', '아직 주문하지 않으셨나요?') + ' <a href="#/pay">' + L('Pesan sekarang', '주문하기') + ' →</a></p>';
  }
  function vBatch(id) {
    var b = S.batch(id);
    if (!b) return empty(L('Batch tidak ditemukan.', '배치를 찾을 수 없습니다.'));
    var s = S.service(b.svc), r = S.recap(id);
    return crumbs([[L('Layanan', '서비스'), '#/'], [LL(s.name), '#/s/' + s.id + '/' + b.month], [batchName(b)]]) +
      '<div class="head"><div><h1>' + esc(batchName(b)) + '</h1><p class="lead">' + esc(monthLabel(b.month)) + ' · ' + L('Tutup order', '주문 마감') + ' ' + esc(dateLabel(b.closeDate)) + '</p></div>' +
      '<div class="btns">' + orderButton(b) + '<a class="btn line" href="#/confirm">' + L('Konfirmasi pembayaran', '결제 확인하기') + '</a></div></div>' +
      stepper(GO.STAGES.map(LL), b.stage, b.stage === GO.LAST_STAGE) +
      (b && b.note ? '<p class="note"><b>' + L('Info', '안내') + '</b> ' + esc(b.note) + '</p>' : '') +
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
    list.unshift({ id: o.id, item: String(o.item || '').slice(0, 80), batchId: o.batchId, pay: o.pay, total: o.total });   // pay: 결제 알림 창이 볼 값
    try { localStorage.setItem(MY_KEY, JSON.stringify(list.slice(0, 10))); } catch (e) {}
  }
  function forgetOrder(id) {
    try { localStorage.setItem(MY_KEY, JSON.stringify(myOrders().filter(function (x) { return x.id !== id; }))); } catch (e) {}
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
      // 배치를 이 브라우저가 아직 모를 수 있다(방금 만든 배치). 그때는 배치 정보 없이 주문만 보여 준다.
      var b = S.batch(o.batchId), s = b && S.service(b.svc), p = b ? X.orderProgress(o, b) : null;
      if (o.id) receipts[o.id] = o;
      return '<article class="card"><div class="head"><div><small>' + (o.id ? o.id + ' · ' : '') + esc(dateLabel(o.createdAt)) + '</small><h2>' + esc(o.item) + '</h2>' +
        '<p class="lead">' + esc(o.buyer) + ' · ' + o.qty + ' pcs · ' + rp(o.total) + '</p></div><div class="right">' + payBadge(o.pay) + '</div></div>' +
        (o.late ? '<p class="note warn">' + L('Pesanan ini masuk setelah tutup order, jadi diproses terpisah dari batch. Admin akan mengabari jadwalnya.', '이 주문은 마감 뒤에 들어와 배치와 따로 처리됩니다. 일정은 운영자가 알려 드립니다.') + '</p>' : p ? stepper(labels, p.cur, p.finished) : '') + deadlineNote(o) +
        '<p class="where">' + L('Posisi sekarang', '현재 위치') + ': <b>' + esc(o.late ? LL(GO.PAY[o.pay]) + ' · ' + L('diproses terpisah', '별도 처리') : o.pay === 'paid' && b ? LL(GO.STAGES[b.stage]) : LL(GO.PAY[o.pay])) + '</b>' + (b ? ' · <a href="#/b/' + b.id + '">' + esc(LL(s.name) + ' / ' + batchName(b)) + '</a>' : '') + '</p>' +
        (b && b.note ? '<p class="note"><b>' + L('Info', '안내') + '</b> ' + esc(b.note) + '</p>' : '') +
        (o.pay === 'unpaid' || o.pay === 'rejected' ? '<a class="btn" href="#/pay/' + encodeURIComponent(o.batchId) + '/' + o.id + '">' + L('Bayar pesanan ini', '이 주문 결제하기') + '</a>'
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
      if (found.gone) markGone(X.normOrderId(q));   // 다시 조회해도 "취소되었습니다"라고 알려 줄 수 있게 적어 둔다
      // 배치를 모르는 주문이 있으면 목록을 바로 다시 읽어 온다 (평소에는 15초에 한 번만 읽는다)
      if (found.some(function (o) { return !S.batch(o.batchId); })) S.refresh(true).then(function (changed) { if (changed && (route()[1] || '') === q) drawTrack(q); });
      found.forEach(rememberOrder);                 // 주문번호로 찾은 주문은 이 기기에 기억해 둔다
      out.innerHTML = found.length ? '<p class="count">' + found.length + ' ' + L('pesanan ditemukan', '건 찾음') + '</p>' + trackCards(found)
        : empty(found.gone || isGone(X.normOrderId(q)) ? goneText() : L('Pesanan tidak ditemukan. Periksa lagi nomor pesanan.', '주문을 찾지 못했습니다. 주문번호를 다시 확인해 주세요.'));
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
      '<div class="field"><label>' + L('Kurs manual', '환율 직접 입력') + ' (1 ' + C.cur + ' = ? IDR)</label><input type="number" step="any" min="0" data-calc="kurs" value="' + C.kurs + '"></div>' +
      '<div class="field"><label>' + L('Harga asli per pcs', '개당 원가') + ' (' + cur.sym + ')</label><input type="number" step="any" min="0" data-calc="price" value="' + C.price + '"></div>' +
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
  /* 작성 중인 주문은 두 곳에 남긴다.
   *  - 접수 전(입력 중): 이 탭의 sessionStorage. 새로 고치거나 다른 화면에 다녀와도 입력하던 내용이 남는다.
   *  - 접수 후: 서버에 저장된 주문(결제 전). 주문번호와 결제 금액이 서버에 정해져 있어 언제 어느 기기에서 열어도 같다.
   *    주소에 주문번호가 붙고, 이 기기에는 "결제를 마치지 않은 주문" 번호만 적어 둔다(localStorage). */
  var DRAFT_KEY = 'nuh-pay-draft', OPEN_KEY = 'nuh-pay-open', DRAFT_FIELDS = ['svc', 'batchId', 'buyer', 'item', 'qty', 'base', 'voucher', 'off'];
  function readStore(where, key) { try { return JSON.parse(window[where].getItem(key)) || null; } catch (e) { return null; } }
  function writeStore(where, key, v) { try { if (v == null) window[where].removeItem(key); else window[where].setItem(key, JSON.stringify(v)); } catch (e) {} }
  function saveDraft() {
    if (!P || P.orderId || P.loading) return;
    var d = {}; DRAFT_FIELDS.forEach(function (k) { d[k] = P[k]; });
    writeStore('sessionStorage', DRAFT_KEY, d);
  }
  function openOrder() { var o = readStore('localStorage', OPEN_KEY); return o && X.isOrderId(o.id) ? o : null; }
  function forgetOpen(id) { var o = openOrder(); if (o && o.id === id) writeStore('localStorage', OPEN_KEY, null); }
  function openNotice() {
    var o = openOrder();
    if (!o || P.orderId) return '';
    return '<p class="note">' + L('Ada pesanan yang belum selesai dibayar', '결제를 마치지 않은 주문이 있습니다') + ': <b>' + o.id + '</b> · <a href="#/pay/' + encodeURIComponent(o.batchId || '-') + '/' + o.id + '">' + L('Lanjutkan pembayaran', '이어서 결제하기') + '</a></p>';
  }
  function initPay(batchId, orderId) {
    var b = S.batch(batchId), fromLink = !!b && b.stage < GO.LAST_STAGE;
    if (!fromLink) b = S.db.batches.filter(function (x) { return x.stage < GO.LAST_STAGE; })[0] || S.db.batches[0];
    P = { svc: b ? b.svc : '', batchId: b ? b.id : '', orderId: '', id: '', buyer: '', item: '', qty: 1, base: '', voucher: '', off: 0, method: payMethods()[0] || 'Transfer bank', fileName: '', file: null, err: '',
      pay: '', total: 0, fixed: false, loading: !!orderId, missing: false, gone: false, failed: false, payBy: '', empty: !b && !orderId };   // empty: 주문할 수 있는 배치가 하나도 없다
    if (!orderId) {
      if (P.empty) return;
      // 접수 전에 입력하던 내용이 있으면 되살린다. 배치 화면에서 넘어왔으면(주소에 배치가 있으면) 그 배치를 따른다.
      var d = readStore('sessionStorage', DRAFT_KEY);
      if (d) {
        DRAFT_FIELDS.forEach(function (k) { if (d[k] != null) P[k] = d[k]; });
        var db = S.batch(P.batchId);
        if (fromLink || !db || db.stage === GO.LAST_STAGE) { P.svc = b.svc; P.batchId = b.id; } else P.svc = db.svc;
      }
      return;
    }
    var mine = P;
    S.fetchOrder(orderId).then(function (o) {
      if (P !== mine) return;
      P.loading = false;
      if (!o || o.gone) { var nid = X.normOrderId(orderId); if (o && o.gone) markGone(nid); P.missing = true; P.gone = isGone(nid); forgetOpen(nid); render(); return; }
      var ob = S.batch(o.batchId) || b, base = o.base || o.total;
      // 고객이 접수한 주문(self)은 결제 금액이 이미 정해져 있다. 쿠폰은 접수할 때 적용된 만큼만 보여 준다.
      Object.assign(P, { svc: ob ? ob.svc : '', batchId: ob ? ob.id : o.batchId, orderId: o.id, id: o.id, buyer: o.buyer, item: o.item, qty: o.qty, base: base, pay: o.pay, total: o.total, fixed: !!o.self, payBy: payBy(o) });
      if (P.fixed) P.off = X.voucherOffFrom(base, o.total, o.id);
      if (o.pay !== 'unpaid' && o.pay !== 'rejected') forgetOpen(o.id);
      render();
    }, function () { if (P !== mine) return; P.loading = false; P.failed = true; render(); });   // 연결이 끊겼거나 조회가 막혔다
  }
  function payAmount() {
    var base = Number(P.base) || 0;
    if (!base) return { base: 0, off: 0, code: 0, total: 0 };
    var off = Math.min(P.off, base);
    if (!P.orderId) return { base: base, off: off, code: 0, total: base - off };     // 접수 전: 고유 코드는 접수할 때 정해진다
    var total = P.fixed ? P.total : X.payable(base, off, P.id);
    return { base: base, off: off, code: total - (base - off), total: total };   // code: 빼면 음수, (거의 공짜 주문이라) 더하면 양수
  }
  // 결제 칸: 접수 전이면 "주문 접수" 단추, 접수된 주문이면 금액·QR·증빙, 이미 낸 주문이면 안내만.
  function payPanel() {
    var h = '<div class="panel"><h2>' + L('Pembayaran', '결제') + '</h2>';
    if (!P.orderId) {
      return h + '<div id="payOut"></div><p class="err" id="payErr" role="alert">' + esc(P.err) + '</p>' +
        '<button class="btn block">' + L('Buat pesanan & lihat nominal', '주문 접수하고 결제 금액 보기') + '</button>' +
        '<p class="hint">' + L('Setelah pesanan dibuat, nomor pesanan dan nominal pembayaran tetap sama walaupun halaman dimuat ulang.', '주문을 접수하면 주문번호와 결제 금액이 정해지며, 화면을 새로 고쳐도 바뀌지 않습니다.') + '</p></div>';
    }
    if (P.pay !== 'unpaid' && P.pay !== 'rejected') {
      return h + '<p class="note">' + L('Bukti pembayaran untuk pesanan ini sudah dikirim.', '이 주문은 결제 증빙을 이미 제출했습니다.') + ' (' + esc(LL(GO.PAY[P.pay])) + ')</p>' +
        '<a class="btn block" href="#/track/' + P.orderId + '">' + L('Lihat status pesanan', '주문 상태 보기') + '</a></div>';
    }
    // 입금 기한이 지난 접수: 금액과 QR은 숨긴다(지금 새로 입금하지 않도록). 이미 입금한 고객은 증빙만 올릴 수 있다.
    return h + deadlineNote(P) + (overdue(P) ? '' :
      (payMethods().length < 2 ? '' : '<div class="field"><label>' + L('Metode pembayaran', '결제 수단') + '</label><div class="seg wide">' + payMethods().map(function (m) { return '<button type="button" class="' + (P.method === m ? 'on' : '') + '" data-act="pay-method" data-id="' + m + '">' + (m === 'QRIS' ? m : L('Transfer bank', '계좌 이체')) + '</button>'; }).join('') + '</div></div>') +
      '<div id="payOut"></div>') +
      '<div class="field"><label>' + L('Bukti pembayaran', '결제 증빙') + ' *</label><div class="file"><input type="file" id="proofFile" class="sr" accept="image/*" data-pay="file"><label for="proofFile" class="btn line">' + L('Pilih file', '파일 선택') + '</label><span id="fileName">' + esc(P.fileName || L('Belum ada file dipilih', '선택된 파일 없음')) + '</span></div><small>' + L('Screenshot atau foto bukti transfer.', '이체 화면 캡처나 사진.') + '</small></div>' +
      '<p class="err" id="payErr" role="alert">' + esc(P.err) + '</p>' +
      '<button class="btn block">' + L('Kirim bukti pembayaran', '결제 증빙 제출') + '</button></div>';
  }
  function vPay() {
    if (P.loading) return '<h1>' + L('Konfirmasi pembayaran', '결제 확인') + '</h1><p class="lead">' + L('Memuat pesanan…', '주문을 불러오는 중…') + '</p>';
    if (P.failed) return '<h1>' + L('Konfirmasi pembayaran', '결제 확인') + '</h1>' + empty(L('Gagal memuat. Coba lagi.', '불러오지 못했습니다. 다시 시도해 주세요.'));
    if (P.empty) return '<h1>' + L('Konfirmasi pembayaran', '결제 확인') + '</h1>' + empty(L('Belum ada batch yang bisa dipesan.', '주문할 수 있는 배치가 아직 없습니다.'));
    if (P.missing) return '<h1>' + L('Konfirmasi pembayaran', '결제 확인') + '</h1><p class="note warn">' + (P.gone ? goneText() : L('Nomor pesanan tidak ditemukan.', '주문번호를 찾을 수 없습니다.')) + '</p><a class="btn line" href="#/pay">' + L('Isi manual', '직접 입력하기') + '</a>';
    var svcs = S.db.services.map(function (s) { return '<button type="button" class="' + (s.id === P.svc ? 'on' : '') + '" data-act="pay-svc" data-id="' + s.id + '"' + (P.orderId ? ' disabled' : '') + '>' + esc(LL(s.name)) + '</button>'; }).join('');
    var bs = S.batchesOf(P.svc).filter(function (b) { return b.stage < GO.LAST_STAGE || (P.orderId && b.id === P.batchId); }).map(function (b) { return '<option value="' + b.id + '"' + (b.id === P.batchId ? ' selected' : '') + '>' + esc(batchName(b)) + ' (' + esc(monthLabel(b.month)) + ')</option>'; }).join('');
    var lock = P.orderId ? ' readonly' : '';
    return (P.orderId
        ? '<h1>' + L('Konfirmasi pembayaran', '결제 확인') + '</h1><p class="lead">' + L('Bayar sesuai nominal, lalu unggah bukti pembayaran.', '안내된 금액을 결제한 뒤 증빙을 올려 주세요.') + '</p>'
        : '<h1>' + L('Pesan sekarang', '주문하기') + '</h1><p class="lead">' + L('Isi data pesanan, lalu tekan "Buat pesanan & lihat nominal". Setelah itu bayar dan unggah bukti.', '주문 정보를 적고 "주문 접수하고 결제 금액 보기"를 누르세요. 그다음 결제하고 증빙을 올립니다.') + '</p>') +
      '<form class="two" data-form="pay"><div class="panel"><h2>' + L('Data pesanan', '주문 정보') + '</h2>' +
      openNotice() +
      (P.orderId ? '<p class="note">' + L('Pesanan', '주문') + ' <b>' + P.orderId + '</b> · <a href="#/pay">' + L('Isi manual', '직접 입력하기') + '</a><br>' + L('Simpan nomor ini untuk melanjutkan pembayaran atau melacak pesanan.', '이 번호를 보관해 두세요. 결제를 이어서 하거나 조회할 때 씁니다.') + '</p>'
        : '<p class="hint">' + L('Sudah punya nomor pesanan?', '주문번호가 있나요?') + ' <a href="#/confirm">' + L('Konfirmasi pembayaran', '결제 확인하기') + ' →</a></p>') +
      '<div class="field"><label>' + L('Pilih layanan', '서비스 선택') + ' *</label><div class="seg wide">' + svcs + '</div></div>' +
      '<div class="field"><label>' + L('Nomor batch', '배치 번호') + ' *</label><select data-pay="batchId"' + (P.orderId ? ' disabled' : '') + '>' + bs + '</select></div>' + lateNotice() +
      '<div class="grid2"><div class="field"><label>' + L('Nama / username pembeli', '구매자 이름·아이디') + ' *</label><input data-pay="buyer" maxlength="' + GO.LIMITS.buyer + '" value="' + esc(P.buyer) + '"' + lock + '></div>' +
      '<div class="field"><label>' + L('Jumlah (pcs)', '수량') + '</label><input type="number" min="1" max="' + GO.LIMITS.qty + '" data-pay="qty" value="' + P.qty + '"' + lock + '></div></div>' +
      '<div class="field"><label>Item *</label><input data-pay="item" maxlength="' + GO.LIMITS.item + '" value="' + esc(P.item) + '" placeholder="Photocard random 1 pc"' + lock + '></div>' +
      '<div class="field"><label>' + L('Total harga (Rp)', '총 금액 (Rp)') + ' *</label><input type="number" data-pay="base" value="' + P.base + '"' + lock + '></div>' +
      (P.fixed ? '<div class="field"><label>' + L('Voucher diskon', '할인 쿠폰') + '</label><p class="fixedval" id="vMsg">' + (P.off ? L('Voucher aktif', '쿠폰 적용됨') + ': −' + rp(P.off) : L('Tidak ada voucher dipakai', '적용된 쿠폰 없음')) + '</p></div>' :
      '<div class="field"><label>' + L('Voucher diskon', '할인 쿠폰') + '</label><div class="inline"><input data-pay="voucher" value="' + esc(P.voucher) + '" placeholder="' + L('Kode voucher', '쿠폰 코드') + '"' + (P.fixed ? ' readonly' : '') + '><button type="button" class="btn line" data-act="pay-voucher"' + (P.fixed ? ' disabled' : '') + '>' + L('Pakai', '적용') + '</button></div><small id="vMsg">' + (P.off ? L('Voucher aktif', '쿠폰 적용됨') + ': −' + rp(P.off) : L('Tidak ada voucher dipakai', '적용된 쿠폰 없음')) + '</small></div>') +
      '</div>' + payPanel() + '</form>';
  }
  // 주문이 마감된 배치에 새 주문을 넣으려 할 때의 안내. 이미 진행 중인 배치와 같은 처리를 해 줄 수 없다는 점을 결제 전에 알린다.
  function lateNotice() {
    var b = S.batch(P.batchId);
    if (P.orderId || !b || b.stage < 1) return '';
    return '<p class="note warn"><b>' + L('Perhatian', '주의') + '</b> ' + L('Batch ini sudah tutup order. Pesanan baru tetap diterima, tetapi diproses terpisah dari batch ini dan bisa ikut pengiriman berikutnya.', '이 배치는 주문이 마감됐습니다. 새 주문은 받지만 이 배치와 따로 처리되며 다음 배송에 포함될 수 있습니다.') +
      ' (' + L('Tahap sekarang', '현재 단계') + ': ' + esc(LL(GO.STAGES[b.stage])) + ')</p>';
  }
  // 관리자 화면에서 마감 뒤 주문을 알아보게 하는 표시
  function selfBadge(o) { return o.self ? ' <span class="badge">' + L('Dibuat pelanggan', '고객 접수') + '</span>' : ''; }
  function lateBadge(o) { return o.late ? ' <span class="badge run">' + L('Setelah tutup order', '마감 뒤 주문') + '</span>' : ''; }
  // 진짜 QR을 그린다(js/vendor/qrcode.js). 가운데에 마크를 얹어도 읽히도록 오류 복원 수준을 높게 잡는다.
  // 가장 높은 수준(H, 30%)이 기본이고, QRIS처럼 내용이 길어 칸이 너무 잘아지면 한 단계 낮춘다(Q, 25%).
  // 마크가 가리는 넓이는 5%쯤이라 둘 다 여유가 있다. 작은 화면에서는 칸 크기가 더 중요했다(직접 읽혀 본 결과).
  function makeQR(text, level) {
    var qr = qrcode(0, level); qr.addData(unescape(encodeURIComponent(text)), 'Byte'); qr.make(); return qr;
  }
  function drawQR(canvas, text) {
    var qr = makeQR(text, 'H');
    if (qr.getModuleCount() > 57) qr = makeQR(text, 'Q');
    var n = qr.getModuleCount(), quiet = 4, px = Math.max(2, Math.ceil(720 / (n + quiet * 2)));
    canvas.width = canvas.height = (n + quiet * 2) * px;
    var c = canvas.getContext('2d');
    c.fillStyle = '#fff'; c.fillRect(0, 0, canvas.width, canvas.height); c.fillStyle = '#111';
    for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) if (qr.isDark(y, x)) c.fillRect((x + quiet) * px, (y + quiet) * px, px, px);
    drawMark(canvas);
  }
  // QR 위 가운데에 상호 마크를 그대로 얹는다. 흰 사각형으로 파내지 않는다(마크 그림의 바탕이 투명하다).
  var QR_MARK = 0.24, markImg = null;
  function drawMark(canvas) {
    if (!GO.BRAND.markQr) return;
    if (!markImg) { markImg = new Image(); markImg.src = ROOT + GO.BRAND.markQr; }
    function paint() {
      if (!canvas.isConnected) return;
      var s = Math.round(canvas.width * QR_MARK), o = Math.round((canvas.width - s) / 2);
      canvas.getContext('2d').drawImage(markImg, o, o, s, s);
      canvas.dataset.mark = '1';
    }
    if (markImg.complete && markImg.naturalWidth) paint(); else markImg.addEventListener('load', paint, { once: true });
  }
  // QR에 담을 내용: 가게 QRIS가 등록되어 있으면 그 주문 금액을 넣은 QRIS, 없으면 예시 문구.
  // 고객에게 보여 줄 결제 수단: 실제 정보가 등록된 것만 (가게 QRIS, 가게 계좌). 예시 QR·예시 계좌는 보여 주지 않는다.
  function payMethods() {
    var m = [];
    if (GO.logic.qrisValid(GO.BRAND.qris)) m.push('QRIS');
    if (GO.BRAND.bank && GO.BRAND.bank.number) m.push('Transfer bank');
    return m;
  }
  // 결제 금액 아래의 "어떻게 낼지" 안내
  function payHow() {
    var bank = GO.BRAND.bank || {};
    if (P.method === 'QRIS' && payMethods().indexOf('QRIS') >= 0)
      return '<div class="qr"><canvas width="400" height="400" id="qrC"></canvas><div><b>' + L('QRIS dinamis', '동적 QRIS') + '</b><p>' + L('Nominal terisi otomatis saat di-scan, tidak perlu ketik harga.', '스캔하면 금액이 자동 입력되어 직접 칠 필요가 없습니다.') + '</p></div></div>';
    if (payMethods().indexOf('Transfer bank') >= 0)
      return '<p class="note"><b>' + esc(bank.name) + ' ' + esc(bank.number) + '</b> a.n. ' + esc(bank.holder || GO.BRAND.name) + '<br>' + L('Transfer tepat sesuai nominal di atas.', '위 금액과 정확히 같게 이체해 주세요.') + '</p>';
    return '<p class="note" id="payByChat"><b>' + L('Cara bayar', '결제 방법') + '</b> ' + L('Rekening atau QR untuk pembayaran akan dikirim admin lewat chat. Bayar tepat sesuai nominal di atas, lalu unggah bukti di bawah.', '입금 계좌나 QR은 운영자가 채팅으로 보내 드립니다. 위 금액과 정확히 같게 보낸 뒤 아래에 증빙을 올려 주세요.') + '</p>';
  }
  function qrText(id, total) { return GO.logic.qrisWithAmount(GO.BRAND.qris, total); }
  function drawPay() {
    var out = $('#payOut'); if (!out) return;
    var a = payAmount();
    if (!a.total) { out.innerHTML = '<p class="hint box">' + L('Isi total harga untuk menampilkan nominal pembayaran.', '총 금액을 입력하면 결제 금액이 표시됩니다.') + '</p>'; return; }
    if (!P.orderId) {
      out.innerHTML = '<div class="amount">' +
        '<div class="brk"><div><b>' + L('Total harga', '총 금액') + '</b></div><span>' + rp(a.base) + '</span></div>' +
        (a.off ? '<div class="brk"><div><b>Voucher</b></div><span>−' + rp(a.off) + '</span></div>' : '') +
        '<div class="brk"><div><b>' + L('Kode unik', '고유 코드') + '</b><small>' + L('ditentukan saat pesanan dibuat', '주문을 접수하면 정해집니다') + '</small></div><span>−Rp1–' + GO.UNIQUE_MAX + '</span></div>' +
        '<div class="total"><span>' + L('Nominal sebelum dikurangi kode unik', '고유 코드를 빼기 전 금액') + '</span><b>' + rp(a.total) + '</b></div></div>';
      return;
    }
    out.innerHTML = '<div class="amount">' +
      '<div class="brk"><div><b>' + L('Total harga', '총 금액') + '</b></div><span>' + rp(a.base) + '</span></div>' +
      (a.off ? '<div class="brk"><div><b>Voucher</b></div><span>−' + rp(a.off) + '</span></div>' : '') +
      '<div class="brk"><div><b>' + L('Kode unik', '고유 코드') + '</b><small>' + L('potongan kecil untuk mencocokkan transfer Anda', '입금 확인용으로 조금 빼 드립니다') + '</small></div><span>' + (a.code < 0 ? '−' : '+') + rp(Math.abs(a.code)) + '</span></div>' +
      '<div class="total"><span>' + L('Nominal yang dibayar', '결제할 금액') + '</span><b>' + rp(a.total) + '</b></div></div>' +
      payHow();
    var q = $('#qrC'); if (q) drawQR(q, qrText(P.id, a.total));
  }
  // 새 주문 접수: 서버가 주문번호와 결제 금액을 정해 저장한다. 그 뒤에는 주소에 주문번호가 붙은 결제 화면으로 간다.
  function reservePay() {
    var a = payAmount();
    P.err = (!String(P.buyer).trim() || !String(P.item).trim() || !a.base) ? L('Lengkapi nama pembeli, item, dan total harga.', '구매자, 품목, 총 금액을 입력해 주세요.') : '';
    $('#payErr').textContent = P.err;
    if (P.err) return;
    var btn = $('form[data-form=pay] .btn.block');
    btn.disabled = true;
    S.createOrder({ batchId: P.batchId, buyer: P.buyer, item: P.item, qty: Math.max(1, Math.round(Number(P.qty)) || 1), base: a.base, voucher: P.off ? P.voucher : '' }).then(function (o) {
      writeStore('sessionStorage', DRAFT_KEY, null);
      writeStore('localStorage', OPEN_KEY, { id: o.id, batchId: o.batchId });
      rememberOrder(o);
      go('#/pay/' + o.batchId + '/' + o.id);
    }, function (e) {
      btn.disabled = false;
      $('#payErr').textContent = L('Gagal membuat pesanan. Coba lagi.', '주문을 접수하지 못했습니다. 다시 시도해 주세요.') + ' (' + errText(e) + ')';
    });
  }
  /* 증빙 사진을 올리기 전에 줄인다: 긴 쪽 1600px, JPEG. 휴대폰 사진(수 MB)도 수백 KB가 된다.
   * 읽지 못하는 형식이면 거절한다(예: 일부 기기의 HEIC). */
  function shrinkPhoto(file) {
    var MAX = GO.LIMITS.photo;
    if (!window.createImageBitmap) return Promise.reject(new Error('Upload a JPG, PNG or WebP image.'));
    return createImageBitmap(file).then(function (img) {
      function at(side, q) {
        var r = Math.min(1, side / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * r)); c.height = Math.max(1, Math.round(img.height * r));
        var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        return new Promise(function (ok) { c.toBlob(ok, 'image/jpeg', q); });
      }
      return at(1600, 0.82).then(function (b) { return b && b.size <= MAX ? b : at(1200, 0.7); }).then(function (b) { return b && b.size <= MAX ? b : at(900, 0.6); })
        .then(function (b) { if (!b || b.size > MAX) throw new Error('The photo is too large.'); return b; });
    }, function () { throw new Error('Upload a JPG, PNG or WebP image.'); });
  }
  function submitPay() {
    if (!P.orderId) { reservePay(); return; }
    var a = payAmount();
    if (!a.total) { P.err = L('Lengkapi nama pembeli, item, dan total harga.', '구매자, 품목, 총 금액을 입력해 주세요.'); }
    else if (!P.fileName) { P.err = L('Unggah bukti pembayaran terlebih dahulu.', '결제 증빙을 먼저 올려 주세요.'); }
    else P.err = '';
    if (P.err) { $('#payErr').textContent = P.err; return; }
    var payload = { orderId: P.orderId, voucher: !P.fixed && P.off ? P.voucher : '', method: P.method, proofName: P.fileName };
    var btn = $('form[data-form=pay] .btn.block');
    btn.disabled = true;
    var upload = S.mode === 'server' && P.file ? shrinkPhoto(P.file).then(function (blob) { return S.uploadProof(P.orderId, blob); }) : Promise.resolve();
    upload.then(function () { return S.submitPayment(payload); }).then(function (o) {
      forgetOpen(o.id);
      P = null; receipts[o.id] = o; rememberOrder(o);
      go('#/track/' + o.id);
      showReceipt(o.id);
    }, function (e) {
      btn.disabled = false;
      $('#payErr').textContent = L('Gagal mengirim. Coba lagi.', '제출하지 못했습니다. 다시 시도해 주세요.') + ' (' + errText(e) + ')';
    });
  }

  /* ── 영수증 ── */
  function showReceipt(orderId) {
    var o = receipts[orderId] || S.order(orderId); if (!o) return;
    var b = S.batch(o.batchId);
    var when = new Date(o.createdAt).toLocaleString(loc(), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    var m = document.createElement('div');
    m.className = 'modal'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
    m.innerHTML = '<div class="receipt"><button class="x" data-act="modal-close" aria-label="' + L('Tutup', '닫기') + '">×</button>' +
      '<div class="r-head"><b>' + esc(GO.BRAND.name) + '</b><small>' + L('Bukti pesanan', '주문 영수증') + '</small></div>' +
      '<dl><dt>No.</dt><dd>' + o.id + '</dd><dt>' + L('Tanggal', '일시') + '</dt><dd>' + esc(when) + '</dd><dt>' + L('Pembeli', '구매자') + '</dt><dd>' + esc(o.buyer) + '</dd><dt>' + L('Metode', '결제 수단') + '</dt><dd>' + esc(o.method || '-') + '</dd><dt>Status</dt><dd>' + esc(LL(GO.PAY[o.pay])) + '</dd></dl>' +
      '<div class="r-item"><div><b>' + esc(o.item) + '</b><small>' + esc(batchLine(b)) + ' · ' + o.qty + ' pcs</small></div></div>' +
      '<div class="total"><span>TOTAL</span><b>' + rp(o.total) + '</b></div>' +
      '<p class="thanks">' + L('Simpan nomor pesanan ini untuk melacak pesanan.', '이 주문번호를 보관해 두세요. 조회할 때 필요합니다.') + '<br>' + L('Terima kasih sudah order.', '주문해 주셔서 감사합니다.') + '</p>' +
      '<button class="btn block" data-act="receipt-save" data-id="' + o.id + '">' + L('Simpan gambar', '이미지로 저장') + '</button></div>';
    document.body.appendChild(m);
    m.querySelector('.x').focus();
  }
  function saveReceipt(orderId) {
    var o = receipts[orderId] || S.order(orderId), b = S.batch(o.batchId);
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
    rule(); row('Item', o.item.length > 34 ? o.item.slice(0, 33) + '…' : o.item); row('Batch', batchLine(b)); row(L('Jumlah', '수량'), o.qty + ' pcs');
    rule(); row('TOTAL', rp(o.total), true);
    c.textAlign = 'center'; c.fillStyle = '#767676'; c.font = '20px sans-serif'; c.fillText(L('Terima kasih sudah order.', '주문해 주셔서 감사합니다.'), W / 2, H - 70);
    var a = document.createElement('a'); a.download = o.id + '.png'; a.href = cv.toDataURL('image/png'); a.click();
  }

  /* ── 관리자 ── */
  var A = { batchId: '', text: '', rows: null, engine: '', q: '', edit: {}, saved: '', priceMode: 'each', payers: {}, newCodes: null };
  /* 표에서 고친 값은 "저장"을 누르기 전까지 A.edit 에만 둔다 (열쇠: 'b:배치' 또는 'o:주문').
   * 화면을 다시 그려도 남아 있고, 저장을 눌러야 서버로 가서 고객 화면에 반영된다. */
  function batchDraft(b) { return A.edit['b:' + b.id] || { stage: b.stage, note: b.note }; }
  // 단계만 바꾸고 안내문은 예전 글 그대로일 때: 고객에게 단계와 맞지 않는 안내가 보일 수 있다
  function noteStale(b, d) { return d.stage !== b.stage && d.note === b.note && !!b.note; }
  // 다른 곳에서 이미 같은 값이 됐거나 지워진 항목의 고친 값은 버린다
  function pruneEdits() {
    Object.keys(A.edit).forEach(function (key) {
      var id = key.slice(2), d = A.edit[key], b = key[0] === 'b' && S.batch(id), o = key[0] === 'o' && S.order(id), s = key[0] === 's' && S.service(id), v = key[0] === 'v' && voucherByCode(id);
      if (!(b || o || s || v) || (b && d.stage === b.stage && d.note === b.note) || (o && d.pay === o.pay) || (s && svcSame(s, d)) || (v && d.note === (v.note || ''))) delete A.edit[key];
    });
  }
  // 서비스 표: 저장된 값과 화면 값 (열쇠 's:서비스')
  function voucherByCode(code) { return S.db.vouchers.filter(function (v) { return v.code === code; })[0]; }
  function svcFields(s) { return { nameId: s.name[0], nameKo: s.name[1], descId: s.desc[0], descKo: s.desc[1], cur: s.cur }; }
  function svcSame(s, d) { var f = svcFields(s); return Object.keys(f).every(function (k) { return f[k] === d[k]; }); }
  function saveCell(act, id, key) {
    return '<button class="btn sm' + (A.edit[key] ? '' : ' line') + '" data-act="' + act + '" data-id="' + id + '"' + (A.edit[key] ? '' : ' disabled') + '>' + L('Simpan', '저장') + '</button>' +
      (A.saved === key ? '<span class="rowsaved" role="status">' + L('Tersimpan', '저장됨') + '</span>' : '');
  }
  function unsavedText() {
    var n = Object.keys(A.edit).length;
    return n ? L('Ada perubahan yang belum disimpan', '저장하지 않은 변경이 있습니다') + ': ' + n + '. ' + L('Tekan Simpan di baris yang ditandai agar tampil di halaman pelanggan.', '표시된 줄의 저장을 눌러야 고객 화면에 반영됩니다.') : '';
  }
  // 표의 칸을 고칠 때마다: 저장된 값과 다르면 그 줄을 "저장 전"으로 표시한다. 화면은 다시 그리지 않는다.
  function draftRow(t) {
    var tr = t.closest('tr'), k, key, d, dirty;
    if ((k = t.getAttribute('data-bstage') || t.getAttribute('data-bnote'))) {
      var b = S.batch(k); if (!b) return;
      d = { stage: +tr.querySelector('[data-bstage]').value, note: tr.querySelector('[data-bnote]').value.trim() };
      key = 'b:' + k; dirty = d.stage !== b.stage || d.note !== b.note;
      tr.querySelector('.rowwarn').hidden = !noteStale(b, d);
    } else if ((k = t.getAttribute('data-opay'))) {
      var o = S.order(k); if (!o) return;
      d = { pay: t.value }; key = 'o:' + k; dirty = d.pay !== o.pay;
    } else if ((k = t.getAttribute('data-svc'))) {
      var s = S.service(k); if (!s) return;
      d = {}; tr.querySelectorAll('[data-svc]').forEach(function (x) { d[x.getAttribute('data-f')] = x.value.trim(); });
      key = 's:' + k; dirty = !svcSame(s, d);
    } else if ((k = t.getAttribute('data-vnote'))) {
      var vc = voucherByCode(k); if (!vc) return;
      d = { note: t.value.trim() }; key = 'v:' + k; dirty = d.note !== (vc.note || '');
    } else return;
    if (dirty) A.edit[key] = d; else delete A.edit[key];
    tr.classList.toggle('dirty', dirty);
    var sb = tr.querySelector('[data-act$="-save"]'); sb.disabled = !dirty; sb.classList.toggle('line', !dirty);   // 고칠 것이 생기면 버튼이 진해진다
    var u = $('#unsaved'); if (u) { u.textContent = unsavedText(); u.hidden = !u.textContent; }
  }
  function saved(key) {
    delete A.edit[key]; A.saved = key; render();
    setTimeout(function () { A.saved = ''; var e = $('.rowsaved'); if (e) e.remove(); }, 2500);
  }
  function vAdmin(tab) {
    if (!S.isAdmin) return vLogin();
    tab = tab || 'guide';
    /* 위 탭은 일의 종류로 묶는다(2026-11-12 사용자 결정). 묶음 안의 화면은 탭 아래 작은 메뉴로 고른다.
     *   판매 설정: 배치 · 쿠폰 · 가게 설정   주문·결제: 주문 입력 · 결제 확인
     * 주소(#/admin/batch 등)는 화면마다 그대로라서 예전 링크도 그대로 열린다. */
    var groups = [
      ['guide', L('Panduan', '사용 안내'), [['guide', L('Panduan', '사용 안내')]]],
      ['setup', L('Pengaturan jualan', '판매 설정'), [['batch', L('Batch', '배치')], ['voucher', L('Voucher', '쿠폰')], ['shop', L('Pengaturan toko', '가게 설정')]]],
      ['orders', L('Pesanan & pembayaran', '주문·결제'), [['order', L('Input pesanan', '주문 입력')], ['pay', L('Verifikasi pembayaran', '결제 확인')]]],
      ['calc', L('Kalkulator', '계산기'), [['calc', L('Kalkulator', '계산기')]]],
      ['log', L('Riwayat', '활동 기록'), [['log', L('Riwayat', '활동 기록')]]]
    ];
    var group = groups.filter(function (g) { return g[2].some(function (x) { return x[0] === tab; }); })[0] || groups[0];
    var pendingN = S.db.orders.filter(function (o) { return o.pay === 'pending'; }).length;
    return '<div class="head"><div><h1>' + L('Admin', '관리자') + '</h1><p class="lead">' + L('Data yang diisi di sini langsung tampil di halaman pelanggan.', '여기서 입력한 내용이 고객 화면에 바로 나타납니다.') + '</p></div><div class="btns"><button class="btn" data-act="export">' + L('Unduh CSV pesanan', '주문 CSV 내려받기') + '</button>' + (S.canReset ? '<button class="btn line" data-act="reset">' + L('Reset data contoh', '예시 데이터로 초기화') + '</button>' : '') + (S.mode === 'server' ? '<button class="btn line" data-act="logout">' + L('Keluar', '로그아웃') + '</button>' : '') + '</div></div>' +
      '<p class="note">' + (S.mode === 'server' ? L('Masuk sebagai admin. Perubahan tersimpan di server dan terlihat di semua perangkat.', '관리자로 로그인했습니다. 변경 내용은 서버에 저장되어 모든 기기에서 보입니다.') : L('Mockup: belum ada login admin dan data hanya tersimpan di browser ini.', '목업: 관리자 로그인이 아직 없고, 데이터는 이 브라우저에만 저장됩니다.')) + '</p>' +
      '<div class="tabs">' + groups.map(function (g) { var first = g[2][0][0], dot = g[0] === 'orders' && pendingN ? ' <i class="dot">' + pendingN + '</i>' : ''; return '<a class="' + (g === group ? 'on' : '') + '" href="#/admin/' + first + '">' + esc(g[1]) + dot + '</a>'; }).join('') + '</div>' +
      (group[2].length > 1 ? '<div class="subtabs" role="navigation" aria-label="' + esc(group[1]) + '">' + group[2].map(function (x) { return '<a class="' + (x[0] === tab ? 'on' : '') + '" href="#/admin/' + x[0] + '"' + (x[0] === tab ? ' aria-current="page"' : '') + '>' + esc(x[1]) + (x[0] === 'pay' && pendingN ? ' <i class="dot">' + pendingN + '</i>' : '') + '</a>'; }).join('') + '</div>' : '') +
      (pruneEdits(), '<p class="note unsaved" id="unsaved" role="status"' + (unsavedText() ? '' : ' hidden') + '>' + unsavedText() + '</p>') +
      ({ guide: aGuide, batch: aBatch, order: aOrder, pay: aPay, voucher: aVoucher, calc: vCalc, shop: aShop, log: aLog }[tab] || aGuide)();
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
      [L('Buat voucher', '쿠폰 만들기'), L('Tab Voucher → tambah voucher untuk semua orang (dengan batas pakai), atau buat voucher sekali pakai untuk dikirim satu per pelanggan.', '쿠폰 탭에서 누구나 쓰는 쿠폰(사용 한도 지정)을 추가하거나, 한 사람에게 한 장씩 보낼 한 장짜리 쿠폰을 만듭니다.'), 'voucher'],
      [L('Hitung harga', '가격 계산'), L('Tab Kalkulator → simpan rumus fee sebagai default. Harga mata uang asing di Input pesanan dihitung dengan rumus ini.', '계산기 탭에서 수수료 수식을 기본값으로 저장합니다. 주문 입력의 외화 가격은 이 수식으로 환산됩니다.'), null]
    ];
    return '<ol class="how">' + g.map(function (x, i) {
      return '<li><em>' + (i + 1) + '</em><div><b>' + esc(x[0]) + '</b><p>' + esc(x[1]) + '</p>' + (x[2] ? '<a href="#/admin/' + x[2] + '">' + L('Buka', '열기') + ' →</a>' : '<a href="#/admin/calc">' + L('Buka', '열기') + ' →</a>') + '</div></li>';
    }).join('') + '</ol><p class="hint">Voucher: ' + (S.db.vouchers.map(function (v) { return v.code + ' (−' + rp(v.off) + ')'; }).join(', ') || '-') + ' · <a href="#/admin/voucher">' + L('Voucher', '쿠폰') + ' →</a></p>';
  }
  /* 가게 설정 탭: 서비스 종류, 쿠폰, 백업 */
  function aShop() {
    var curOpts = function (sel) { return Object.keys(GO.CURRENCIES).map(function (c) { return '<option value="' + c + '"' + (c === sel ? ' selected' : '') + '>' + c + '</option>'; }).join(''); };
    var svcRows = S.db.services.map(function (s) {
      var key = 's:' + s.id, d = A.edit[key] || svcFields(s);
      function inp(f, max) { return '<td><input data-svc="' + s.id + '" data-f="' + f + '" value="' + esc(d[f]) + '" maxlength="' + max + '" aria-label="' + f + '"></td>'; }
      return '<tr' + (A.edit[key] ? ' class="dirty"' : '') + '><td><b>' + esc(s.id) + '</b></td>' + inp('nameId', GO.LIMITS.svcName) + inp('nameKo', GO.LIMITS.svcName) + inp('descId', GO.LIMITS.svcDesc) + inp('descKo', GO.LIMITS.svcDesc) +
        '<td><select data-svc="' + s.id + '" data-f="cur" aria-label="cur">' + curOpts(d.cur) + '</select></td>' +
        '<td class="acts">' + saveCell('svc-save', s.id, key) + '<button class="link" data-act="svc-del" data-id="' + s.id + '">' + L('Hapus', '삭제') + '</button></td></tr>';
    }).join('');
    return '<div class="panel"><h2>' + L('Layanan', '서비스') + '</h2><p class="lead">' + L('Nama dan keterangan tampil di halaman pelanggan. Layanan yang masih punya batch tidak bisa dihapus.', '이름과 설명은 고객 화면에 나옵니다. 배치가 남아 있는 서비스는 지울 수 없습니다.') + '</p>' +
      '<div class="tbl"><table class="edit"><thead><tr><th>' + L('Kode', '코드') + '</th><th>' + L('Nama (ID)', '이름 (인도네시아어)') + '</th><th>' + L('Nama (KO)', '이름 (한국어)') + '</th><th>' + L('Keterangan (ID)', '설명 (인도네시아어)') + '</th><th>' + L('Keterangan (KO)', '설명 (한국어)') + '</th><th>' + L('Mata uang', '통화') + '</th><th><span class="sr">' + L('Aksi', '동작') + '</span></th></tr></thead><tbody>' + svcRows + '</tbody></table></div>' +
      '<p class="err" id="svcDelErr" role="alert"></p>' +
      '<h3 class="sub">' + L('Tambah layanan', '서비스 추가') + '</h3><form data-form="svc" class="grid3">' +
      '<div class="field"><label>' + L('Kode', '코드') + ' (a-z, 2–10)</label><input name="id" required pattern="[a-zA-Z][a-zA-Z0-9]{1,9}" placeholder="cn"></div>' +
      '<div class="field"><label>' + L('Nama (ID)', '이름 (인도네시아어)') + '</label><input name="nameId" required maxlength="' + GO.LIMITS.svcName + '"></div>' +
      '<div class="field"><label>' + L('Nama (KO)', '이름 (한국어)') + '</label><input name="nameKo" required maxlength="' + GO.LIMITS.svcName + '"></div>' +
      '<div class="field"><label>' + L('Keterangan (ID)', '설명 (인도네시아어)') + '</label><input name="descId" maxlength="' + GO.LIMITS.svcDesc + '"></div>' +
      '<div class="field"><label>' + L('Keterangan (KO)', '설명 (한국어)') + '</label><input name="descKo" maxlength="' + GO.LIMITS.svcDesc + '"></div>' +
      '<div class="field"><label>' + L('Mata uang', '통화') + '</label><select name="cur">' + curOpts('IDR') + '</select></div>' +
      '<div class="field"><label>&nbsp;</label><button class="btn">' + L('Tambah', '추가') + '</button></div></form><p class="err" id="svcErr" role="alert"></p></div>' +

      '<div class="panel"><h2>' + L('QR pemesanan', '주문 QR') + '</h2><p class="lead">' + L('Pelanggan scan QR ini dan langsung masuk ke halaman pesan. Pakai di Instagram, poster, atau chat, menggantikan Google Form. QR per batch ada di tab Batch (tombol QR).', '손님이 이 QR을 찍으면 바로 주문 화면으로 갑니다. 구글 폼 대신 인스타그램·포스터·채팅에 쓰세요. 배치별 QR은 배치 화면의 QR 단추에 있습니다.') + '</p>' +
      '<button class="btn line" data-act="order-qr" data-id="">' + L('Lihat QR pemesanan', '주문 QR 보기') + '</button></div>' +

      '<div class="panel"><h2>' + L('Unduh data', '자료 내려받기') + '</h2><p class="lead">' + L('CSV bisa dibuka di Excel atau Google Sheets. Cadangan lengkap (JSON) berisi semua data untuk disimpan; belum ada fitur memulihkan dari file ini.', 'CSV는 엑셀이나 구글 시트에서 열립니다. 전체 백업(JSON)은 모든 자료를 보관용으로 담습니다. 이 파일로 되살리는 기능은 아직 없습니다.') + '</p>' +
      '<div class="btns"><button class="btn line" data-act="export">' + L('Pesanan (CSV)', '주문 (CSV)') + '</button><button class="btn line" data-act="export-batches">' + L('Batch (CSV)', '배치 (CSV)') + '</button><button class="btn line" data-act="export-vouchers">Voucher (CSV)</button><button class="btn line" data-act="export-backup">' + L('Cadangan lengkap (JSON)', '전체 백업 (JSON)') + '</button></div></div>';
  }
  /* 쿠폰 탭: 쿠폰 목록·추가·한 장짜리 여러 장. 서비스 설정과 섞여 헷갈려 따로 뺐다(2026-11-12 사용자 요청) */
  function aVoucher() {
    var vRows = S.db.vouchers.map(function (v) {
      var used = S.voucherUses(v), key = 'v:' + v.code, note = A.edit[key] ? A.edit[key].note : (v.note || '');
      var by = S.db.orders.filter(function (o) { return o.voucher === v.code; }).map(function (o) { return o.id; });
      return '<tr' + (A.edit[key] ? ' class="dirty"' : '') + '><td><b>' + esc(v.code) + '</b>' + (v.max === 1 ? ' <span class="badge">' + L('sekali pakai', '한 장짜리') + '</span>' : '') + '</td><td class="r">−' + rp(v.off) + '</td>' +
        '<td class="r">' + used + ' / ' + (v.max ? v.max : L('tanpa batas', '무제한')) + (v.max && used >= v.max ? ' <span class="badge">' + L('Habis', '다 씀') + '</span>' : '') + (by.length ? '<small class="vby">' + by.map(esc).join(', ') + '</small>' : '') + '</td>' +
        '<td><input data-vnote="' + esc(v.code) + '" value="' + esc(note) + '" maxlength="' + GO.LIMITS.note + '" placeholder="' + L('Catatan, mis. untuk siapa', '메모 (예: 누구에게 줬는지)') + '" aria-label="' + L('Catatan', '메모') + '"></td>' +
        '<td class="acts">' + saveCell('vnote-save', esc(v.code), key) + '<button class="link" data-act="voucher-del" data-id="' + esc(v.code) + '">' + L('Hapus', '삭제') + '</button></td></tr>';
    }).join('');
    return '<div class="panel"><h2>Voucher</h2><p class="lead">' + L('Batas pakai dihitung dari pesanan yang memakai voucher ini (pesanan yang ditolak atau dihapus tidak dihitung). Kosongkan untuk tanpa batas.', '사용 한도는 이 쿠폰을 쓴 주문 수로 셉니다(반려되거나 지워진 주문은 세지 않음). 비워 두면 무제한입니다.') + '</p>' +
      (vRows ? '<div class="tbl"><table class="edit"><thead><tr><th>' + L('Kode', '코드') + '</th><th class="r">' + L('Potongan', '할인') + '</th><th class="r">' + L('Terpakai / batas', '사용 / 한도') + '</th><th>' + L('Catatan', '메모') + '</th><th><span class="sr">' + L('Aksi', '동작') + '</span></th></tr></thead><tbody>' + vRows + '</tbody></table></div>' : empty(L('Belum ada voucher.', '쿠폰이 없습니다.'))) +
      '<h3 class="sub">' + L('Tambah voucher', '쿠폰 추가') + '</h3><form data-form="voucher" class="grid3">' +
      '<div class="field"><label>' + L('Kode', '코드') + ' (A-Z, 0-9)</label><input name="code" required pattern="[A-Za-z0-9_\-]{3,30}" maxlength="' + GO.LIMITS.voucher + '" placeholder="NUH10K"></div>' +
      '<div class="field"><label>' + L('Potongan (Rp)', '할인 (Rp)') + '</label><input name="off" type="number" min="1" max="' + GO.LIMITS.amount + '" required></div>' +
      '<div class="field"><label>' + L('Batas pakai', '사용 한도') + '</label><input name="max" type="number" min="0" max="' + GO.LIMITS.voucherUses + '" placeholder="' + L('tanpa batas', '무제한') + '"></div>' +
      '<div class="field"><label>&nbsp;</label><button class="btn">' + L('Tambah', '추가') + '</button></div></form><p class="err" id="voucherErr" role="alert"></p>' +
      '<h3 class="sub">' + L('Buat voucher sekali pakai', '한 장짜리 쿠폰 여러 장 만들기') + '</h3><p class="hint">' + L('Untuk "1 orang 1 kali": buat satu kode untuk satu pelanggan, lalu kirim lewat chat. Kode hanya bisa dipakai sekali.', '"1인 1회"용: 고객 한 사람에게 코드 한 장씩 만들어 채팅으로 건넵니다. 한 번만 쓸 수 있습니다.') + '</p>' +
      '<form data-form="vbulk" class="grid3">' +
      '<div class="field"><label>' + L('Potongan (Rp)', '할인 (Rp)') + '</label><input name="off" type="number" min="1" max="' + GO.LIMITS.amount + '" required></div>' +
      '<div class="field"><label>' + L('Jumlah kode', '장 수') + ' (1–' + GO.LIMITS.voucherBulk + ')</label><input name="count" type="number" min="1" max="' + GO.LIMITS.voucherBulk + '" value="1" required></div>' +
      '<div class="field"><label>' + L('Catatan', '메모') + '</label><input name="note" maxlength="' + GO.LIMITS.note + '" placeholder="' + L('mis. pelanggan baru November', '예: 11월 신규 고객') + '"></div>' +
      '<div class="field"><label>&nbsp;</label><button class="btn">' + L('Buat', '만들기') + '</button></div></form><p class="err" id="vbulkErr" role="alert"></p>' +
      (A.newCodes ? '<div class="field"><label for="newCodes">' + L('Kode baru (salin dan kirim satu per pelanggan)', '새로 만든 코드 (복사해서 한 사람에게 한 장씩 보내세요)') + '</label><textarea id="newCodes" rows="' + Math.min(8, A.newCodes.length + 1) + '" readonly>' + esc(A.newCodes.join('\n')) + '</textarea></div>' : '') +
      '</div>';
  }
  /* ── 주문 QR: 찍으면 고객 사이트의 주문 화면으로 간다. batchId 가 있으면 그 배치가 골라진 채로 열린다 ── */
  function orderLink(batchId) { return new URL(ROOT || './', location.href).href.replace(/#.*$/, '') + '#/pay' + (batchId ? '/' + batchId : ''); }
  function showOrderQR(batchId) {
    var b = batchId && S.batch(batchId), link = orderLink(batchId);
    var title = b ? batchName(b) + ' (' + LL(S.service(b.svc).name) + ')' : GO.BRAND.name;
    var m = document.createElement('div');
    m.className = 'modal'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
    m.innerHTML = '<div class="receipt orderqr"><button class="x" data-act="modal-close" aria-label="' + L('Tutup', '닫기') + '">×</button>' +
      '<div class="r-head"><b>' + L('QR pemesanan', '주문 QR') + '</b><small>' + esc(title) + '</small></div>' +
      '<canvas id="orderQrC" width="400" height="400"></canvas>' +
      '<p class="hint qrlink" id="orderQrLink">' + esc(link) + '</p>' +
      '<div class="btns"><button class="btn" data-act="order-qr-save" data-id="' + esc(batchId || '') + '">' + L('Simpan gambar', '이미지로 저장') + '</button><button class="btn line" data-act="order-qr-copy">' + L('Salin link', '링크 복사') + '</button></div></div>';
    document.body.appendChild(m);
    drawQR(m.querySelector('#orderQrC'), link);
    m.querySelector('.x').focus();
  }
  // 홍보용 그림: 위에 상호와 배치 이름, 가운데 QR(마크 포함), 아래 "Scan untuk pesan". 손님이 보는 그림이라 인도네시아어로 적는다.
  function saveOrderQR(batchId) {
    var src = $('#orderQrC'); if (!src) return;
    var b = batchId && S.batch(batchId), W = 900, H = 1180, c = document.createElement('canvas');
    c.width = W; c.height = H;
    var g = c.getContext('2d');
    function finish() {
      g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
      g.strokeStyle = '#e0e0e0'; g.lineWidth = 2; g.strokeRect(20, 20, W - 40, H - 40);
      g.textAlign = 'center'; g.fillStyle = '#d6336c'; g.font = 'bold 56px Nunito, sans-serif'; g.fillText(GO.BRAND.name, W / 2, 110);
      g.fillStyle = '#111'; g.font = 'bold 34px Nunito, sans-serif';
      g.fillText(b ? batchName(b) : 'Jastip Korea · Jepang · Tiket', W / 2, 170);
      if (b) { g.fillStyle = '#666'; g.font = '26px Nunito, sans-serif'; g.fillText(S.service(b.svc).name[0] + (b.closeDate ? ' · Tutup order ' + b.closeDate : ''), W / 2, 212); }
      g.drawImage(src, 110, 250, 680, 680);
      g.fillStyle = '#d6336c'; g.font = 'bold 44px Nunito, sans-serif'; g.fillText('Scan untuk pesan', W / 2, 1010);
      g.fillStyle = '#666'; g.font = '24px Nunito, sans-serif'; g.fillText(orderLink(batchId).replace(/^https?:\/\//, ''), W / 2, 1060);
      var a = document.createElement('a');
      a.download = GO.BRAND.name.toLowerCase() + '-qr-' + (batchId || 'order') + '.png'; a.href = c.toDataURL('image/png'); a.click();
    }
    // 가운데 마크가 그려진 뒤에 저장한다
    var tries = 0;
    (function wait() { if (src.dataset.mark === '1' || tries++ > 20) finish(); else setTimeout(wait, 50); })();
  }
  function download(name, text, type) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: type })); a.download = name; a.click();
  }
  function stamp() { return X.shopDate(new Date().toISOString()); }
  function svcOptions(sel) { return S.db.services.map(function (s) { return '<option value="' + s.id + '"' + (s.id === sel ? ' selected' : '') + '>' + esc(LL(s.name)) + '</option>'; }).join(''); }
  function batchOptions(sel) { return S.db.batches.slice().sort(function (a, b) { return a.month < b.month ? 1 : a.month > b.month ? -1 : b.no - a.no; }).map(function (b) { return '<option value="' + b.id + '"' + (b.id === sel ? ' selected' : '') + '>' + esc(LL(S.service(b.svc).name) + ' / ' + batchName(b) + ' (' + b.month + ')') + '</option>'; }).join(''); }
  function aBatch() {
    var rows = S.db.batches.slice().sort(function (a, b) { return a.month < b.month ? 1 : a.month > b.month ? -1 : a.svc < b.svc ? -1 : a.svc > b.svc ? 1 : b.no - a.no; }).map(function (b) {
      var br = X.batchRecap(b.id, S.db.orders), d = batchDraft(b), key = 'b:' + b.id;
      return '<tr' + (A.edit[key] ? ' class="dirty"' : '') + '><td>' + b.month + '</td><td>' + esc(LL(S.service(b.svc).name)) + '</td><td><a href="' + ROOT + '#/b/' + b.id + '">' + esc(batchName(b)) + '</a></td>' +
        '<td class="r">' + br.count + '</td><td class="r btotal">' + rp(br.total) + '</td><td class="r">' + rp(br.paidTotal) + '</td>' +
        '<td><select data-bstage="' + b.id + '" aria-label="' + L('Tahap', '단계') + '">' + GO.STAGES.map(function (st, i) { return '<option value="' + i + '"' + (i === d.stage ? ' selected' : '') + '>' + esc(LL(st)) + '</option>'; }).join('') + '</select></td>' +
        '<td><input data-bnote="' + b.id + '" value="' + esc(d.note) + '" placeholder="' + L('Info untuk pelanggan', '고객 안내 문구') + '" aria-label="Info">' +
        '<small class="rowwarn"' + (noteStale(b, d) ? '' : ' hidden') + '>' + L('Tahap diubah. Periksa juga info ini.', '단계를 바꿨습니다. 안내문도 확인하세요.') + '</small></td>' +
        '<td class="acts">' + saveCell('batch-save', b.id, key) + (b.stage < GO.LAST_STAGE ? '<button class="link" data-act="order-qr" data-id="' + b.id + '">QR</button>' : '') + '<button class="link" data-act="batch-del" data-id="' + b.id + '">' + L('Hapus', '삭제') + '</button></td></tr>';
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
      '<h2 class="sub">' + L('Semua batch', '전체 배치') + '</h2><p class="hint">' + L('Setelah mengubah tahap atau info, tekan Simpan.', '단계나 안내문을 바꾼 뒤 저장을 누르세요.') + '</p><div class="tbl"><table class="edit"><thead><tr><th>' + L('Bulan', '월') + '</th><th>' + L('Layanan', '서비스') + '</th><th>Batch</th><th class="r">' + L('Pesanan', '주문') + '</th><th class="r">' + L('Total pesanan', '주문 금액') + '</th><th class="r">' + L('Sudah dibayar', '결제 완료 금액') + '</th><th>' + L('Tahap', '단계') + '</th><th>Info</th><th><span class="sr">' + L('Aksi', '동작') + '</span></th></tr></thead><tbody>' + rows + '</tbody></table></div>';
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
      var chosen = S.batch(A.batchId), other = [];
      A.rows.forEach(function (r) { if (r.batchNo !== null && chosen && r.batchNo !== chosen.no && other.indexOf(r.batchNo) < 0) other.push(r.batchNo); });
      var mismatch = other.length ? '<p class="note warn" id="batchMismatch"><b>' + L('Perhatian', '주의') + '</b> ' + L('Di teks tertulis', '글에 적힌 배치') + ': Batch ' + other.join(', ') + '. ' + L('Batch yang dipilih', '고른 배치') + ': ' + esc(batchName(chosen)) + '. ' + L('Jika disimpan, pesanan masuk ke batch yang dipilih.', '저장하면 고른 배치에 들어갑니다.') + '</p>' : '';
      prev = mismatch + '<h2 class="sub">' + L('Hasil pemisahan', '분류 결과') + ' <small>(' + (A.engine === 'ai' ? 'AI' : L('aturan otomatis', '규칙 기반 자동 분류')) + ')</small></h2>' +
        (A.rows.length ? '<div class="tbl"><table class="edit"><thead><tr><th>' + L('Pembeli', '구매자') + '</th><th>Item</th><th>' + L('Jumlah', '수량') + '</th><th>' + L('Harga asli', '원래 가격') + '</th><th>Total (Rp)</th><th><span class="sr">' + L('Aksi', '동작') + '</span></th></tr></thead><tbody>' +
          A.rows.map(function (r, i) {
            function cell(f, type) { return '<td class="' + (r.missing.indexOf(f) >= 0 || (f === 'total' && !r.total) ? 'miss' : '') + '"><input ' + (type ? 'type="number" ' : '') + 'data-row="' + i + '" data-f="' + f + '" value="' + esc(r[f] == null ? '' : r[f]) + '" aria-label="' + f + '"></td>'; }
            return '<tr>' + cell('buyer') + cell('item') + cell('qty', 1) + '<td class="src">' + (r.price != null ? esc((GO.CURRENCIES[r.cur] || {}).sym + ' ' + r.price.toLocaleString('id-ID')) + ' <small>' + ((r.priceIs || A.priceMode) === 'total' ? L('total', '합계') : '/pcs') + '</small>' : '-') + '</td>' + cell('total', 1) + '<td><button class="link" data-act="row-del" data-id="' + i + '">' + L('Hapus', '삭제') + '</button></td></tr>';
          }).join('') + '</tbody></table></div>' +
          '<p class="hint">' + L('Kolom bertanda merah belum terbaca. Isi dulu sebelum menyimpan. Harga mata uang asing dihitung dengan kurs batch dan rumus default kalkulator.', '빨간 칸은 읽지 못한 항목입니다. 채운 뒤 저장하세요. 외화 가격은 배치 환율과 계산기 기본 수식으로 환산했습니다.') + '</p>' +
          '<p class="err" id="rowErr" role="alert"></p><button class="btn" data-act="rows-save">' + L('Simpan', '저장') + ' ' + A.rows.length + ' ' + L('pesanan', '건') + '</button>'
          : empty(L('Tidak ada baris yang bisa dibaca.', '읽을 수 있는 줄이 없습니다.')));
    }
    var list = S.ordersOf(A.batchId).map(function (o) {
      var key = 'o:' + o.id, pay = A.edit[key] ? A.edit[key].pay : o.pay;
      return '<tr' + (A.edit[key] ? ' class="dirty"' : '') + '><td>' + o.id + selfBadge(o) + deadlineBadge(o) + lateBadge(o) + '</td><td>' + esc(o.buyer) + '</td><td>' + esc(o.item) + '</td><td class="r">' + o.qty + '</td><td class="r">' + rp(o.total) + '</td>' +
        '<td><select data-opay="' + o.id + '" aria-label="' + L('Pembayaran', '결제') + '">' + Object.keys(GO.PAY).map(function (k) { return '<option value="' + k + '"' + (k === pay ? ' selected' : '') + '>' + esc(LL(GO.PAY[k])) + '</option>'; }).join('') + '</select></td>' +
        '<td class="acts">' + saveCell('order-save', o.id, key) + '<button class="link" data-act="order-del" data-id="' + o.id + '">' + L('Hapus', '삭제') + '</button></td></tr>';
    }).join('');
    return '<div class="panel find"><h2>' + L('Cari pesanan', '주문 찾기') + '</h2><p class="lead">' + L('Untuk pelanggan yang lupa nomor pesanan: cari dengan nama atau sebagian nomor.', '주문번호를 잊은 고객을 위해: 이름이나 번호 일부로 찾습니다.') + '</p>' +
      '<div class="field"><label>' + L('Nama atau nomor pesanan', '이름 또는 주문번호') + '</label><input data-admin="q" value="' + esc(A.q) + '" autocomplete="off"></div><div id="adminFind"></div></div>' +
      '<div class="panel"><h2>' + L('Tempel daftar order', '주문 목록 붙여 넣기') + '</h2>' +
      '<p class="lead">' + L('Satu baris = satu pesanan. Urutan bebas: sistem mengenali pembeli, item, jumlah, dan harga.', '한 줄에 주문 하나. 순서는 자유이며 구매자·품목·수량·가격을 알아서 구분합니다.') + '</p>' +
      '<div class="field"><label>' + L('Masuk ke batch', '넣을 배치') + '</label><select data-admin="batchId">' + batchOptions(A.batchId) + '</select></div>' +
      '<div class="field"><label>' + L('Harga tanpa keterangan dibaca sebagai', '표시 없는 가격은') + '</label><select data-admin="priceMode">' +
        '<option value="each"' + (A.priceMode !== 'total' ? ' selected' : '') + '>' + L('harga per pcs (dikali jumlah)', '개당 가격 (수량을 곱함)') + '</option>' +
        '<option value="total"' + (A.priceMode === 'total' ? ' selected' : '') + '>' + L('harga total (tidak dikali)', '합계 금액 (곱하지 않음)') + '</option></select>' +
        '<small>' + L('Tanda di teks diutamakan: "@25k", "25k/pcs" = per pcs, "total 50k" = total.', '글에 적힌 표시가 먼저입니다: "@25k", "25k/pcs" = 개당, "total 50k" = 합계.') + '</small></div>' +
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
      hits.map(function (o) { var b = S.batch(o.batchId); return '<tr><td><b>' + o.id + '</b>' + deadlineBadge(o) + '</td><td>' + esc(b ? batchName(b) : '-') + lateBadge(o) + '</td><td>' + esc(o.buyer) + '</td><td>' + esc(o.item) + '</td><td class="r">' + rp(o.total) + '</td><td>' + payBadge(o.pay) + '</td></tr>'; }).join('') + '</tbody></table></div>'
      : '<p class="hint">' + L('Pesanan tidak ditemukan.', '주문을 찾지 못했습니다.') + '</p>';
  }
  // 활동 기록 탭
  var ACTIONS = {
    login: ['Masuk', '로그인'], reset: ['Reset data', '데이터 초기화'],
    'batch.add': ['Tambah batch', '배치 추가'], 'batch.update': ['Ubah batch', '배치 변경'], 'batch.delete': ['Hapus batch', '배치 삭제'],
    'order.add': ['Tambah pesanan', '주문 추가'], 'order.pay': ['Ubah status bayar', '결제 상태 변경'], 'order.delete': ['Hapus pesanan', '주문 삭제'], 'order.expire': ['Pesanan kedaluwarsa dihapus', '기한 지난 접수 자동 삭제'],
    calc: ['Simpan rumus kalkulator', '계산기 수식 저장'],
    'voucher.add': ['Tambah voucher', '쿠폰 추가'], 'voucher.delete': ['Hapus voucher', '쿠폰 삭제'], 'voucher.bulk': ['Buat voucher sekali pakai', '한 장짜리 쿠폰 발급'], 'voucher.note': ['Ubah catatan voucher', '쿠폰 메모 변경'],
    'service.add': ['Tambah layanan', '서비스 추가'], 'service.update': ['Ubah layanan', '서비스 변경'], 'service.delete': ['Hapus layanan', '서비스 삭제']
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
    var unit = X.lineUnitPrice(r, A.priceMode);                 // 개당 가격 (글이나 화면에서 고른 기준에 따라)
    if (r.cur === 'IDR') return Math.round(unit * r.qty);
    var d = S.db.calcDefaults;
    // 배치의 통화와 같으면 배치 환율, 다르면 그 통화의 기본 환율
    var kurs = S.service(batch.svc).cur === r.cur ? batch.kurs : GO.CURRENCIES[r.cur].kurs;
    return X.calcPrice({ price: unit, qty: r.qty, kurs: kurs, feeGo: d.feeGo, feeCo: d.feeCo, tax: d.tax, extra: 0 }).total;
  }
  // 고객이 접수만 하고 아직 결제하지 않은 주문. 사이트는 고객에게 먼저 연락할 수 없으므로, 운영자가 보고 채팅으로 알릴 수 있게 센다.
  function waitingNote() {
    var w = S.db.orders.filter(function (o) { return !!payBy(o); }), late = w.filter(overdue).length;
    return w.length ? '<p class="note" id="waiting">' + L('Pesanan pelanggan yang belum dibayar', '고객이 접수하고 아직 결제하지 않은 주문') + ': <b>' + w.length + '</b>' +
      (late ? ' · ' + L('lewat batas bayar', '입금 기한 지남') + ': <b>' + late + '</b>' : '') + '. ' +
      L('Pesanan seperti ini dihapus otomatis', '이런 접수는 자동으로 지워집니다') + ': ' + GO.PURGE_HOURS + ' ' + L('jam setelah dibuat', '시간 뒤 (접수 시각 기준)') + '. ' +
      L('Lihat di daftar pesanan tiap batch.', '배치별 주문 목록에서 볼 수 있습니다.') + '</p>' : '';
  }
  function aPay() {
    // 확인 대기 / 결제 완료 / 반려: 승인하거나 반려한 결제도 여기서 다시 본다(입금자, 증빙 사진, 쿠폰)
    var view = A.payView || 'pending';
    var seg = '<div class="seg" id="payView">' + ['pending', 'paid', 'rejected'].map(function (v) {
      var n = S.db.orders.filter(function (o) { return o.pay === v; }).length;
      return '<button type="button" class="' + (v === view ? 'on' : '') + '" data-act="pay-view" data-id="' + v + '">' + esc(LL(GO.PAY[v])) + ' ' + n + '</button>';
    }).join('') + '</div>';
    if (view !== 'pending') return waitingNote() + seg + donePay(view);
    var list = S.db.orders.filter(function (o) { return o.pay === 'pending'; });
    var dup = X.duplicateTotals(S.db.orders);
    return waitingNote() + seg + (list.length ? (Object.keys(dup).length ? '<p class="note warn"><b>' + L('Perhatian', '주의') + '</b> ' + L('Ada pesanan dengan nominal yang sama. Cocokkan dengan bukti dan nama sebelum menyetujui.', '결제 금액이 같은 주문이 있습니다. 승인하기 전에 증빙과 이름을 대조하세요.') + '</p>' : '') + '<div class="tbl"><table><thead><tr><th>' + L('No. pesanan', '주문번호') + '</th><th>Batch</th><th>' + L('Pembeli', '구매자') + '</th><th>Item</th><th class="r">Total</th><th>' + L('Bukti', '증빙') + '</th><th>' + L('Nama pengirim', '입금자 이름') + '</th><th><span class="sr">' + L('Aksi', '동작') + '</span></th></tr></thead><tbody>' +
      list.map(function (o) {
        var b = S.batch(o.batchId);
        return '<tr><td>' + o.id + '</td><td class="wrap">' + esc(batchName(b)) + lateBadge(o) + '</td><td>' + esc(o.buyer) + '</td><td class="wrap">' + esc(o.item) + '</td><td class="r">' + rp(o.total) + (dup[o.total] ? ' <span class="badge pay-rejected">' + L('Nominal sama', '금액 같음') + '</span>' : '') + '</td><td class="wrap">' + (o.photo ? '<button type="button" class="link" data-act="proof-view" data-id="' + o.id + '">' + L('Lihat foto', '사진 보기') + '</button>' : esc(o.proofName || '-')) + '<small class="vby">' + esc(o.method || '') + '</small></td>' +
          '<td class="payer"><input data-payer="' + o.id + '" value="' + esc(A.payers[o.id] != null ? A.payers[o.id] : (o.payer || '')) + '" maxlength="' + GO.LIMITS.payer + '" placeholder="' + L('sesuai mutasi bank', '은행 입금 내역대로') + '" aria-label="' + L('Nama pengirim', '입금자 이름') + '">' +
            (o.voucher ? '<small class="vby">Voucher ' + esc(o.voucher) + '</small>' : '') + '<small class="rowwarn" data-payerwarn="' + o.id + '" hidden></small></td>' +
          '<td class="acts"><button class="btn sm" data-act="pay-ok" data-id="' + o.id + '">' + L('Setujui', '승인') + '</button><button class="btn line sm" data-act="pay-no" data-id="' + o.id + '">' + L('Tolak', '반려') + '</button></td></tr>';
      }).join('') + '</tbody></table></div>' + (S.mode === 'local' ? '<p class="hint">' + L('Mockup hanya menyimpan nama file bukti, bukan gambarnya.', '목업에서는 증빙 이미지가 아니라 파일 이름만 저장합니다.') + '</p>' : '')
      : empty(L('Tidak ada pembayaran yang menunggu verifikasi.', '확인을 기다리는 결제가 없습니다.')));
  }

  // 처리한 결제(결제 완료·반려) 목록. 접수 시각이 최근인 것부터. 상태를 되돌리는 것은 주문 입력 화면에서 한다.
  function donePay(view) {
    var list = S.db.orders.filter(function (o) { return o.pay === view; }).sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0; });
    if (!list.length) return empty(view === 'paid' ? L('Belum ada pembayaran yang disetujui.', '승인한 결제가 아직 없습니다.') : L('Tidak ada pembayaran yang ditolak.', '반려한 결제가 없습니다.'));
    return '<div class="tbl" id="donePay"><table><thead><tr><th>' + L('No. pesanan', '주문번호') + '</th><th>Batch</th><th>' + L('Pembeli', '구매자') + '</th><th>Item</th><th class="r">Total</th><th>' + L('Bukti', '증빙') + '</th><th>' + L('Nama pengirim', '입금자 이름') + '</th></tr></thead><tbody>' +
      list.map(function (o) {
        var b = S.batch(o.batchId);
        return '<tr data-done="' + o.id + '"><td>' + o.id + selfBadge(o) + '</td><td class="wrap">' + esc(b ? batchName(b) : '-') + lateBadge(o) + '</td><td>' + esc(o.buyer) + '</td><td class="wrap">' + esc(o.item) + '</td><td class="r">' + rp(o.total) + '</td>' +
          '<td class="wrap">' + (o.photo ? '<button type="button" class="link" data-act="proof-view" data-id="' + o.id + '">' + L('Lihat foto', '사진 보기') + '</button>' : esc(o.proofName || '-')) + '<small class="vby">' + esc(o.method || '') + '</small></td>' +
          '<td class="wrap">' + esc(o.payer || '-') + (o.voucher ? '<small class="vby">Voucher ' + esc(o.voucher) + '</small>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="hint">' + L('Urut dari pesanan terbaru. Untuk mengubah status, buka', '최근 접수한 주문부터 보여 줍니다. 상태를 바꾸려면') + ' <a href="#/admin/order">' + L('Input pesanan', '주문 입력') + '</a>.</p>';
  }
  // 같은 입금자가 같은 쿠폰을 이미 썼으면 승인 화면의 그 줄에 알린다 (자동으로 막지는 않는다: 운영자가 판단한다)
  function payerWarn(id) {
    var w = document.querySelector('[data-payerwarn="' + id + '"]'), inp = document.querySelector('[data-payer="' + id + '"]');
    if (!w || !inp) return '';
    var hit = X.payerClash(S.db.orders, id, inp.value);
    w.hidden = !hit;
    w.textContent = hit ? L('Pengirim yang sama sudah memakai voucher ini di pesanan', '같은 입금자가 이 쿠폰을 이미 쓴 주문이 있습니다') + ': ' + hit : '';
    return hit;
  }
  // 전체 주문을 스프레드시트용 CSV 파일로 내려받는다 (Excel·Google Sheets에서 열림)
  function exportOrders() {
    var rows = [['order_no', 'date', 'service', 'month', 'batch', 'batch_stage', 'buyer', 'item', 'qty', 'total_idr', 'payment', 'method', 'after_close', 'voucher', 'payer']];
    S.db.orders.forEach(function (o) {
      var b = S.batch(o.batchId), s = S.service(b.svc);
      rows.push([o.id, X.shopDate(o.createdAt), LL(s.name), b.month, batchName(b), LL(GO.STAGES[b.stage]), o.buyer, o.item, o.qty, o.total, LL(GO.PAY[o.pay]), o.method, o.late ? 'yes' : '', o.voucher || '', o.payer || '']);
    });
    var blob = new Blob(['﻿' + X.toCSV(rows)], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = GO.BRAND.name.toLowerCase() + '-orders.csv'; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  /* 아래쪽 안내: 가게 소개, 이용 순서, 바로 가기. 내용이 짧은 화면에서도 빈 곳 대신 다음에 할 일을 보여 준다. */
  function footer() {
    var year = new Date().getFullYear(), mock = S.mode === 'local' ? ' · mockup' : '';
    var brand = '<div class="foot-brand"><img src="' + ROOT + GO.BRAND.mark + '" alt="" width="40" height="40"><div><b>' + esc(GO.BRAND.name) + '</b><p>' + esc(LL(GO.BRAND.tagline)) + '</p></div></div>';
    if (GO.app === 'admin') {
      return '<div class="foot-grid admin">' + brand + '<div><h3>' + L('Admin', '관리자') + '</h3><ul class="foot-links">' +
        [['batch', L('Batch', '배치')], ['order', L('Input pesanan', '주문 입력')], ['pay', L('Verifikasi pembayaran', '결제 확인')], ['voucher', L('Voucher', '쿠폰')], ['shop', L('Pengaturan toko', '가게 설정')]].map(function (x) { return '<li><a href="#/admin/' + x[0] + '">' + esc(x[1]) + '</a></li>'; }).join('') +
        '<li><a href="' + ROOT + '" target="_blank" rel="noopener">' + L('Lihat situs pelanggan', '고객 사이트 보기') + ' ↗</a></li></ul></div></div>' +
        '<p class="foot-note">© ' + year + ' ' + esc(GO.BRAND.name) + mock + '</p>';
    }
    var steps = [
      [L('Pesan', '주문하기'), L('Pilih batch, isi pesanan, dan dapatkan nomor pesanan.', '배치를 고르고 주문을 접수하면 주문번호가 나옵니다.'), '#/pay'],
      [L('Bayar & unggah bukti', '결제·증빙'), L('Bayar tepat sesuai nominal, lalu unggah foto bukti.', '안내된 금액을 그대로 보내고 증빙 사진을 올립니다.'), '#/confirm'],
      [L('Lacak', '조회'), L('Cek tahap pengiriman dengan nomor pesanan.', '주문번호로 배송 단계를 확인합니다.'), '#/track']
    ];
    return '<div class="foot-grid">' + brand +
      '<div><h3>' + L('Cara order', '이용 순서') + '</h3><ol class="foot-steps">' + steps.map(function (x, i) { return '<li><em>' + (i + 1) + '</em><div><a href="' + x[2] + '">' + esc(x[0]) + '</a><p>' + esc(x[1]) + '</p></div></li>'; }).join('') + '</ol></div>' +
      '<div><h3>' + L('Layanan', '서비스') + '</h3><ul class="foot-links">' + S.db.services.map(function (s) { return '<li><a href="#/s/' + s.id + '">' + esc(LL(s.name)) + '</a></li>'; }).join('') + '</ul>' +
      '<p class="foot-tip">' + L('Nomor pesanan ada di struk. Simpan baik-baik.', '주문번호는 영수증에 있습니다. 잘 보관해 주세요.') + '</p></div></div>' +
      '<p class="foot-note">© ' + year + ' ' + esc(GO.BRAND.name) + ' · ' + S.db.services.map(function (s) { return esc(LL(s.name)); }).join(' · ') + mock + '</p>';
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

  /* ── 결제 알림 창 ──
   * 이 기기에서 접수했거나 조회한 주문 가운데 아직 결제하지 않은 것(또는 증빙이 반려된 것)이 있으면, 사이트를 열 때 한 번 알린다.
   * 사이트를 닫아 둔 고객에게는 알릴 수 없다(연락처를 받지 않는다). 그 몫은 관리자 화면의 "결제 전 접수" 표시가 맡는다. */
  var remindShown = false;
  function remindUnpaid() {
    if (remindShown || GO.app !== 'site') return Promise.resolve();
    remindShown = true;
    // 끝난 주문(결제 완료, 취소됨)만 빼고 다시 확인한다: 확인 대기로 알던 주문이 그 사이 반려됐을 수 있고,
    // 예전에 저장된 목록에는 결제 상태가 없다. 목록은 10건까지라 확인 요청도 10건까지이고, 창에는 3건까지 보여 준다.
    var list = myOrders().filter(function (x) { return x.pay !== 'paid' && x.pay !== 'gone'; });
    if (!list.length) return Promise.resolve();
    return Promise.all(list.map(function (x) {
      // 돌려주는 값: 주문 / { gone } 기한까지 결제되지 않아 지워짐 / { missing } 없는 번호(운영자가 지움) / null 확인하지 못함(다음에 다시 본다)
      return S.fetchOrder(x.id).then(function (o) { return !o ? { id: x.id, missing: true } : o.gone ? { id: x.id, item: x.item, gone: true } : o; }, function () { return null; });
    })).then(function (found) {
      var r = route(), due = [], cancelled = [];
      found.forEach(function (o) {
        if (!o) return;
        if (o.missing) { forgetOrder(o.id); return; }
        if (o.gone) { markGone(o.id); cancelled.push(o); return; }   // 한 번 알리고, 이 기기에는 "취소됨"으로 남긴다
        rememberOrder(o);
        if ((o.pay === 'unpaid' || o.pay === 'rejected') && !(r[0] === 'pay' && r[2] === o.id)) due.push(o);   // 지금 그 주문의 결제 화면이면 띄우지 않는다
      });
      if ((due.length || cancelled.length) && !$('.modal')) showRemind(due.slice(0, 3), cancelled);
    });
  }
  function showRemind(due, cancelled) {
    var m = document.createElement('div');
    m.className = 'modal'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-labelledby', 'remindTitle');
    m.innerHTML = '<div class="remind"><button class="x" data-act="modal-close" aria-label="' + L('Tutup', '닫기') + '">×</button>' +
      '<h2 id="remindTitle">' + (due.length ? L('Ada pesanan yang belum dibayar', '결제하지 않은 주문이 있습니다') : L('Pesanan dibatalkan', '접수가 취소되었습니다')) + '</h2>' +
      due.map(function (o) {
        return '<div class="remind-item"><b>' + esc(o.item) + '</b><small>' + o.id + (overdue(o) ? '' : ' · ' + rp(o.total)) + '</small>' +
          (o.pay === 'rejected' ? '<p class="note warn">' + L('Bukti pembayaran ditolak. Silakan kirim ulang.', '결제 증빙이 반려되었습니다. 다시 제출해 주세요.') + '</p>'
            : deadlineNote(o) || '<p class="note warn">' + L('Pesanan ini belum dibayar.', '이 주문은 아직 결제하지 않았습니다.') + '</p>') +
          '<a class="btn block" data-act="remind-go" href="#/pay/' + encodeURIComponent(o.batchId) + '/' + o.id + '">' + L('Bayar sekarang', '지금 결제하기') + '</a></div>';
      }).join('') +
      cancelled.map(function (o) {
        return '<div class="remind-item" data-cancelled="1"><b>' + esc(o.item || '') + '</b><small>' + o.id + '</small><p class="note warn">' + goneText() + '</p>' +
          '<a class="btn line block" data-act="remind-go" href="#/pay">' + L('Buat pesanan baru', '새로 접수하기') + '</a></div>';
      }).join('') + '</div>';
    document.body.appendChild(m);
    m.querySelector('.x').focus();
  }
  GO.remind = function () { remindShown = false; return remindUnpaid(); };   // 검사에서 다시 띄워 볼 때 쓴다

  /* ── 라우터 ── */
  // 주소에 깨진 %형식이 있어도 멈추지 않는다: 풀 수 없는 조각은 그대로 쓴다
  function route() { return location.hash.replace(/^#\/?/, '').split('/').map(function (p) { try { return decodeURIComponent(p); } catch (e) { return p; } }); }
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
    else if (page === 'confirm') html = vConfirm();
    else if (page === 'admin') html = vAdmin(r[1]);
    else { page = 'home'; html = vHome(); }
    $('#app').innerHTML = html;
    linkLabels();
    // 결제 화면은 주문번호가 주소에 있으면 "결제 확인", 없으면 "주문하기" 메뉴에 속한다
    var navKey = page === 's' || page === 'b' ? 'home' : page === 'pay' ? (r[2] ? 'confirm' : 'order') : page;
    $('#nav').innerHTML = (GO.app === 'admin'
      // 고객 사이트 보기는 새 탭으로 연다: 관리자 사이트가 그대로 남아 있어 돌아오기 쉽다
      ? [['site', ROOT, L('Lihat situs pelanggan', '고객 사이트 보기') + ' ↗', true]]
      : [['home', '#/', L('Layanan', '서비스')], ['order', '#/pay', L('Pesan', '주문하기')], ['track', '#/track', L('Lacak pesanan', '주문 조회')], ['confirm', '#/confirm', L('Konfirmasi', '결제 확인')]]
          // 로그인한 운영자에게만 관리자 사이트로 돌아가는 길을 보여 준다 (고객에게는 보이지 않는다)
          .concat(S.mode === 'server' && S.isAdmin ? [['admin', 'admin/', L('Kembali ke admin', '관리자로 돌아가기')]] : []))
      .map(function (n) { return '<a href="' + n[1] + '"' + (n[3] ? ' target="_blank" rel="noopener"' : '') + (n[0] === navKey ? ' class="on" aria-current="page"' : '') + '>' + n[2] + '</a>'; }).join('');
    $('#langs').innerHTML = [['id', 'ID', 'Bahasa Indonesia'], ['en', 'EN', 'English'], ['ko', 'KO', '한국어']].map(function (l) { return '<button type="button" class="link' + (l[0] === lang ? ' on' : '') + '" data-act="lang" data-id="' + l[0] + '" title="' + l[2] + '" aria-label="' + l[2] + '" aria-pressed="' + (l[0] === lang) + '">' + l[1] + '</button>'; }).join('');
    $('#jumpTop').setAttribute('aria-label', L('Ke atas', '맨 위로')); $('#jumpTop').title = L('Ke atas', '맨 위로');
    $('#jumpBottom').setAttribute('aria-label', L('Ke bawah', '맨 아래로')); $('#jumpBottom').title = L('Ke bawah', '맨 아래로');
    showJump();
    document.documentElement.lang = lang;
    document.title = GO.BRAND.name + (GO.app === 'admin' ? ' Admin' : ''); $('#logo').innerHTML = '<img src="' + ROOT + GO.BRAND.mark + '" alt="" width="26" height="26">' + esc(GO.BRAND.name) + (GO.app === 'admin' ? ' <small>Admin</small>' : ''); $('#foot').innerHTML = footer();
    if (page === 'admin' && r[1] === 'calc' && S.isAdmin) drawCalc();
    if (page === 'admin' && r[1] === 'pay' && S.isAdmin) document.querySelectorAll('[data-payer]').forEach(function (x) { payerWarn(x.getAttribute('data-payer')); });
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
    else if (f === 'confirm') {
      var cq = e.target.q.value, cm = $('#confirmMsg');
      S.fetchOrder(cq).then(function (found) {
        if (found && !found.gone) go('#/pay/' + found.batchId + '/' + found.id);
        else { var cid = X.normOrderId(cq); if (found && found.gone) markGone(cid); cm.textContent = isGone(cid) ? goneText() : L('Nomor pesanan tidak ditemukan.', '주문번호를 찾을 수 없습니다.'); cm.className = 'err'; }
      }, function () { cm.textContent = L('Gagal memuat. Coba lagi.', '불러오지 못했습니다. 다시 시도해 주세요.'); cm.className = 'err'; });
    }
    else if (f === 'login') {
      S.login(e.target.password.value).then(render, function (err) {
        $('#loginErr').textContent = err.status === 401 ? L('Kata sandi salah.', '비밀번호가 맞지 않습니다.') : L('Gagal masuk. Coba lagi.', '로그인하지 못했습니다. 다시 시도해 주세요.');
      });
    }
    else if (f === 'svc') {
      var sf = e.target, sid = sf.id.value.trim().toLowerCase();
      if (!/^[a-z][a-z0-9]{1,9}$/.test(sid)) { $('#svcErr').textContent = L('Kode: 2–10 huruf kecil/angka, diawali huruf.', '코드는 영문 소문자로 시작하는 2~10자(영문·숫자)입니다.'); return; }
      var ns = S.addService({ id: sid, name: [sf.nameId.value.trim(), sf.nameKo.value.trim()], desc: [sf.descId.value.trim(), sf.descKo.value.trim()], cur: sf.cur.value });
      if (!ns) $('#svcErr').textContent = errText({ message: 'That service code already exists.' }); else render();
    }
    else if (f === 'vbulk') {
      var bf = e.target;
      S.addVoucherBatch({ off: bf.off.value, count: bf.count.value, note: bf.note.value.trim() }).then(function (codes) { A.newCodes = codes; render(); }, function (err) { $('#vbulkErr').textContent = errText(err); });
    }
    else if (f === 'voucher') {
      var vf = e.target, nv = S.addVoucher({ code: vf.code.value, off: vf.off.value, max: vf.max.value });
      if (!nv) $('#voucherErr').textContent = errText({ message: 'That voucher code already exists.' }); else render();
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
    else if (act === 'pay-svc') { P.svc = id; P.batchId = (S.batchesOf(id).filter(function (b) { return b.stage < GO.LAST_STAGE; })[0] || {}).id; saveDraft(); render(); }
    else if (act === 'pay-method') { P.method = id; render(); }
    else if (act === 'pay-voucher') {
      S.checkVoucher(P.voucher).then(function (v) {
        if (!P) return;
        P.off = v ? v.off : 0; saveDraft();
        $('#vMsg').textContent = v ? L('Voucher aktif', '쿠폰 적용됨') + ': −' + rp(v.off) : L('Kode voucher tidak ditemukan atau sudah habis.', '쿠폰 코드를 찾을 수 없거나 사용 한도를 다 썼습니다.');
        drawPay();
      });
    }
    else if (act === 'receipt') showReceipt(id);
    else if (act === 'my-clear') { try { localStorage.removeItem(MY_KEY); } catch (x) {} render(); }
    else if (act === 'modal-close') t.closest('.modal').remove();
    else if (act === 'remind-go') t.closest('.modal').remove();   // 알림 창의 "지금 결제하기": 창을 닫고 그 주문의 결제 화면으로 간다
    else if (act === 'receipt-save') saveReceipt(id);
    else if (act === 'export') exportOrders();
    else if (act === 'reset') { if (confirm(L('Semua data kembali ke contoh awal. Lanjutkan?', '모든 데이터가 처음 예시로 돌아갑니다. 계속할까요?'))) { S.reset().then(function () { A.rows = null; C = null; render(); }); } }
    else if (act === 'logout') S.logout().then(render);
    else if (act === 'batch-save') { var bd = A.edit['b:' + id]; if (bd) { S.updateBatch(id, { stage: bd.stage, note: bd.note }); saved('b:' + id); } }
    else if (act === 'order-save') {
      var od = A.edit['o:' + id], cur = S.order(id);
      if (od && od.pay === 'unpaid' && cur && cur.pay !== 'unpaid' && !X.canUnpay(cur)) {
        // 되돌리는 순간 자동으로 지워질 접수: 막고 이유를 알린다(서버도 같은 이유로 거절한다)
        delete A.edit['o:' + id]; GO.onStoreError({ message: 'This order is past its payment deadline. Reject or delete it instead.' });
      } else if (od && od.pay !== 'rejected' && cur && !X.canRevive(cur, S.db.orders, S.db.vouchers)) {
        // 반려된 사이 쿠폰 한도가 찼다: 막고 이유를 알린다(서버도 같은 이유로 거절한다)
        delete A.edit['o:' + id]; GO.onStoreError({ message: 'The voucher on this order was used up while it was rejected.' });
      } else if (od) { S.updateOrder(id, { pay: od.pay }); saved('o:' + id); }
    }
    else if (act === 'batch-del') { if (confirm(L('Hapus batch ini beserta pesanannya?', '이 배치와 그 안의 주문을 삭제할까요?'))) { S.removeBatch(id); render(); } }
    else if (act === 'order-del') { if (confirm(L('Hapus pesanan ini?', '이 주문을 삭제할까요?'))) { S.removeOrder(id); render(); } }
    else if (act === 'pay-ok') {
      var pn = ($('[data-payer="' + id + '"]') || {}).value || '', clash = payerWarn(id);
      if (clash && !confirm(L('Pengirim yang sama sudah memakai voucher ini. Tetap setujui?', '같은 입금자가 이 쿠폰을 이미 썼습니다. 그래도 승인할까요?'))) return;
      S.updateOrder(id, { pay: 'paid', payer: pn.trim() }); delete A.payers[id]; render();
    }
    else if (act === 'pay-no') { var pr = ($('[data-payer="' + id + '"]') || {}).value || ''; S.updateOrder(id, pr.trim() ? { pay: 'rejected', payer: pr.trim() } : { pay: 'rejected' }); delete A.payers[id]; render(); }
    else if (act === 'proof-view') {
      var pm = document.createElement('div');
      pm.className = 'modal'; pm.setAttribute('role', 'dialog'); pm.setAttribute('aria-modal', 'true');
      pm.innerHTML = '<div class="receipt photo"><button class="x" data-act="modal-close" aria-label="' + L('Tutup', '닫기') + '">×</button><b>' + esc(id) + '</b><img src="/api/admin/proof/' + encodeURIComponent(id) + '" alt="' + L('Bukti pembayaran', '결제 증빙') + '"></div>';
      document.body.appendChild(pm); pm.querySelector('.x').focus();
    }
    else if (act === 'pay-view') { A.payView = id; render(); }
    else if (act === 'vnote-save') { var vn = A.edit['v:' + id]; if (vn) { S.setVoucherNote(id, vn.note); saved('v:' + id); } }
    else if (act === 'sample') { A.text = $('[data-admin="text"]').getAttribute('placeholder'); A.rows = null; render(); }
    else if (act === 'classify') {
      var batch = S.batch(A.batchId);
      GO.ai.classify(A.text).then(function (res) {
        A.engine = res.engine;
        A.rows = res.rows.map(function (r) { r.total = rowTotal(r, batch); return r; });
        render();
      });
    }
    else if (act === 'svc-save') {
      var sd = A.edit['s:' + id];
      if (sd) {
        if (!sd.nameId || !sd.nameKo) { GO.onStoreError({ message: 'Check the service fields.' }); return; }
        S.updateService(id, { name: [sd.nameId, sd.nameKo], desc: [sd.descId, sd.descKo], cur: sd.cur }); saved('s:' + id);
      }
    }
    else if (act === 'svc-del') {
      if (!confirm(L('Hapus layanan ini?', '이 서비스를 삭제할까요?'))) return;
      if (S.removeService(id)) render(); else $('#svcDelErr').textContent = L('Layanan ini masih punya batch. Hapus batch-nya dulu.', '이 서비스에 배치가 남아 있습니다. 배치를 먼저 지워 주세요.');
    }
    else if (act === 'voucher-del') { if (confirm(L('Hapus voucher ini? Pesanan yang sudah memakainya tidak berubah.', '이 쿠폰을 삭제할까요? 이미 쓴 주문의 금액은 바뀌지 않습니다.'))) { S.removeVoucher(id); render(); } }
    else if (act === 'export-batches') download(GO.BRAND.name.toLowerCase() + '-batches-' + stamp() + '.csv', '\ufeff' + X.toCSV(X.batchRows(S.db)), 'text/csv;charset=utf-8');
    else if (act === 'export-vouchers') download(GO.BRAND.name.toLowerCase() + '-vouchers-' + stamp() + '.csv', '\ufeff' + X.toCSV(X.voucherRows({ vouchers: S.db.vouchers.map(function (v) { return Object.assign({}, v, { used: S.voucherUses(v) }); }) })), 'text/csv;charset=utf-8');
    else if (act === 'order-qr') showOrderQR(id);
    else if (act === 'order-qr-save') saveOrderQR(id);
    else if (act === 'order-qr-copy') { var ql = $('#orderQrLink'); if (ql && navigator.clipboard) navigator.clipboard.writeText(ql.textContent).then(function () { t.textContent = L('Link disalin', '링크를 복사했습니다'); }, function () {}); }
    else if (act === 'export-backup') download(GO.BRAND.name.toLowerCase() + '-backup-' + stamp() + '.json', JSON.stringify(X.backup(S.db), null, 1), 'application/json');
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
      if (k === 'file') { P.file = t.files[0] || null; P.fileName = t.files[0] ? t.files[0].name : ''; $('#fileName').textContent = P.fileName || L('Belum ada file dipilih', '선택된 파일 없음'); return; }
      P[k] = t.value;
      if (k === 'voucher') { P.off = 0; }
      saveDraft();                                 // 새로 고치거나 다른 화면에 다녀와도 남도록
      if (k === 'batchId') { render(); return; }   // 마감 안내가 배치에 따라 달라진다
      drawPay();
    } else if ((k = t.getAttribute('data-admin'))) {
      A[k] = t.value;
      if (k === 'batchId') { A.rows = null; render(); }
      if (k === 'priceMode' && A.rows) { var pb = S.batch(A.batchId); A.rows.forEach(function (r) { r.total = rowTotal(r, pb); }); render(); }
      if (k === 'q') drawFind();
    } else if (t.hasAttribute('data-row')) {
      var r = A.rows[+t.getAttribute('data-row')], f = t.getAttribute('data-f');
      r[f] = t.value; r.missing = r.missing.filter(function (m) { return m !== f; });
      t.parentNode.classList.toggle('miss', !String(t.value).trim());
    }
  });
  document.addEventListener('change', function (e) {
    draftRow(e.target);                         // 바로 저장하지 않는다. 저장 버튼을 눌러야 반영된다
  });
  document.addEventListener('input', function (e) {
    if (e.target.hasAttribute('data-bnote') || e.target.hasAttribute('data-svc') || e.target.hasAttribute('data-vnote')) draftRow(e.target);
    if (e.target.hasAttribute('data-payer')) { A.payers[e.target.getAttribute('data-payer')] = e.target.value; payerWarn(e.target.getAttribute('data-payer')); }
  });
  // 저장하지 않은 변경이 있는데 창을 닫거나 새로 고치려 하면 브라우저가 한 번 묻는다
  window.addEventListener('beforeunload', function (e) { if (Object.keys(A.edit).length) { e.preventDefault(); e.returnValue = ''; } });
  document.addEventListener('keydown', function (e) { var m = $('.modal'); if (e.key === 'Escape' && m) m.remove(); });
  // 화면을 옮길 때마다 서버 내용을 다시 읽는다. 무언가 입력하는 중이면 화면을 다시 그리지 않는다.
  function typing() { var a = document.activeElement; return !!(a && a.closest && a.closest('#app') && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)); }
  window.addEventListener('hashchange', function () {
    render(); window.scrollTo(0, 0);
    S.refresh().then(function (changed) { if (changed && !typing()) render(); });
  });
  GO.onStoreError = function (e) { render(); alert(L('Perubahan tidak tersimpan: ', '변경 내용이 저장되지 않았습니다: ') + errText(e)); };
  GO.render = render;
  S.init().then(render).then(remindUnpaid);
})(window.GO);
