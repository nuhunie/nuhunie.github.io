/* 1층: 데이터 모델 — 화면·계산과 무관한 "무엇을 저장하는가"만 정의한다.
 *
 * Service  { id, name[id,ko], desc[id,ko], cur }
 * Batch    { id, svc→Service, no, title, month'YYYY-MM', stage(0~5), closeDate, kurs, note }
 * Order    { id('NUH-8자리'), batchId→Batch, buyer, item, qty, base, total(IDR), pay, method, proofName, createdAt }
 * Voucher  { code, off(IDR) }
 * CalcDefaults  계산기 기본 수식
 */
// globalThis: 브라우저에서는 window, 서버(Cloudflare Functions)에서는 전역 객체. 같은 파일을 양쪽에서 쓴다.
globalThis.GO = globalThis.GO || {};
var GO = globalThis.GO;

// 상호와 주문번호 머리글자. 가게 이름이 정해지면 여기 두 값만 바꾸면 화면·영수증 전체에 반영된다.
GO.BRAND = { name: 'Nuhunie', orderPrefix: 'NUH', mark: 'assets/mark-a.png',
  tagline: ['Jastip Korea, Jepang, dan tiket. Order, bayar, dan lacak di satu tempat.', '한국·일본 구매대행과 티켓 대행. 주문, 결제, 조회를 한곳에서.'] };
// mark: 로고·QR 가운데·탭 아이콘에 쓰는 마크 (다른 시안: assets/mark-b.png)

// 배치 진행 단계: 순서가 곧 진행도다 (index가 클수록 뒤 단계)
GO.STAGES = [
  ['Open order', '주문 접수 중'],
  ['Order ditutup', '주문 마감'],
  ['Sudah dibeli', '현지 구매 완료'],
  ['Dikirim ke Indonesia', '인도네시아로 배송 중'],
  ['Tiba di gudang', '창고 도착'],
  ['Selesai', '배송 완료']
];
GO.LAST_STAGE = GO.STAGES.length - 1;

// 결제 상태
GO.PAY = {
  unpaid: ['Belum bayar', '미결제'],
  pending: ['Menunggu verifikasi', '확인 대기'],
  paid: ['Lunas', '결제 완료'],
  rejected: ['Ditolak', '반려']
};

GO.CURRENCIES = {
  JPY: { label: 'JPY – Yen Jepang', sym: '¥', kurs: 110 },
  KRW: { label: 'KRW – Won Korea', sym: '₩', kurs: 11.5 },
  IDR: { label: 'IDR – Rupiah', sym: 'Rp', kurs: 1 }
};

GO.seed = function () {
  var services = [
    { id: 'kr', name: ['Jastip Korea', '한국 구매대행'], desc: ['Album, photocard, merch resmi dari Korea', '한국 앨범·포토카드·공식 굿즈'], cur: 'KRW' },
    { id: 'jp', name: ['Jastip Jepang', '일본 구매대행'], desc: ['Merch, lucky draw, dan barang toko Jepang', '일본 굿즈·럭키드로우·매장 상품'], cur: 'JPY' },
    { id: 'tix', name: ['Jastip Tiket', '티켓 대행'], desc: ['Tiket konser dan fanmeeting', '콘서트·팬미팅 티켓'], cur: 'KRW' }
  ];
  var batches = [
    { id: 'kr-5', svc: 'kr', no: 5, title: 'EMS Korea', month: '2026-11', stage: 0, closeDate: '2026-11-20', kurs: 11.5, note: 'Order ditutup 20 Nov. Estimasi tiba awal Desember.' },
    { id: 'kr-4', svc: 'kr', no: 4, title: 'Handcarry Korea', month: '2026-11', stage: 2, closeDate: '2026-11-05', kurs: 11.5, note: 'Barang sudah dibeli, berangkat 15 Nov.' },
    { id: 'kr-3', svc: 'kr', no: 3, title: 'Handcarry Korea', month: '2026-11', stage: 4, closeDate: '2026-11-01', kurs: 11.4, note: 'Sedang disortir di gudang Surabaya.' },
    { id: 'kr-2', svc: 'kr', no: 2, title: 'Handcarry Korea', month: '2026-10', stage: 5, closeDate: '2026-10-12', kurs: 11.3, note: '' },
    { id: 'kr-1', svc: 'kr', no: 1, title: 'EMS Korea', month: '2026-10', stage: 5, closeDate: '2026-10-03', kurs: 11.3, note: '' },
    { id: 'jp-2', svc: 'jp', no: 2, title: 'Handcarry Jepang', month: '2026-11', stage: 1, closeDate: '2026-11-08', kurs: 108, note: 'Order ditutup, pembelian mulai 13 Nov.' },
    { id: 'jp-1', svc: 'jp', no: 1, title: 'Handcarry Jepang', month: '2026-10', stage: 5, closeDate: '2026-10-10', kurs: 107, note: '' },
    { id: 'tix-1', svc: 'tix', no: 1, title: 'Tiket Konser Seoul', month: '2026-11', stage: 0, closeDate: '2026-11-25', kurs: 11.5, note: 'War tiket 26 Nov pukul 18.00 WIB.' }
  ];
  // [batchId, buyer, item, qty, total, pay]
  var rows = [
    ['kr-5', 'nadya', 'Photocard random 1 pc', 1, 25000, 'unpaid'],
    ['kr-5', 'sasa', 'Album mini (versi A)', 1, 285000, 'pending'],
    ['kr-4', 'dinda', 'Album single', 2, 420000, 'paid'],
    ['kr-4', 'bima', 'Photocard lucky draw', 3, 165000, 'paid'],
    ['kr-4', 'tiara', 'Lightstick strap', 1, 135000, 'pending'],
    ['kr-4', 'fuse_id', 'Album full (versi B)', 1, 310000, 'unpaid'],
    ['kr-3', 'ayu', 'Album solo', 1, 298000, 'paid'],
    ['kr-3', 'kiki', 'Photocard set', 2, 96000, 'paid'],
    ['kr-2', 'nadya', 'Album mini (versi A)', 1, 280000, 'paid'],
    ['kr-2', 'dinda', 'Photocard random 1 pc', 4, 79200, 'paid'],
    ['kr-1', 'sasa', 'Keyring', 2, 150000, 'paid'],
    ['jp-2', 'rara', 'Acrylic stand', 1, 235720, 'paid'],
    ['jp-2', 'nadya', 'Trading card lucky draw', 2, 180000, 'pending'],
    ['jp-1', 'tiara', 'Tote bag', 1, 320000, 'paid'],
    ['tix-1', 'dinda', 'Tiket CAT 1 Seoul', 1, 3200000, 'unpaid']
  ];
  var orders = rows.map(function (r, i) {
    return {
      id: GO.BRAND.orderPrefix + '-' + GO.logic.orderCode(100101 + i * 137),
      batchId: r[0], buyer: r[1], item: r[2], qty: r[3], total: r[4], pay: r[5],
      method: r[5] === 'unpaid' ? '' : 'QRIS',
      proofName: r[5] === 'unpaid' ? '' : 'bukti-' + (i + 1) + '.jpg',
      createdAt: '2026-11-' + String(1 + (i % 11)).padStart(2, '0') + 'T21:22:00'
    };
  });
  return {
    services: services,
    batches: batches,
    orders: orders,
    vouchers: [{ code: 'GO5000', off: 5000 }],
    calcDefaults: {
      cur: 'JPY', kurs: 110, price: 2000, qty: 1,
      feeGo: { mode: 'pct', val: 10 },
      feeCo: { mode: 'nom', val: 10000 },
      tax: { mode: 'pct', val: 0, base: 'conv' },
      extra: 0
    }
  };
};
