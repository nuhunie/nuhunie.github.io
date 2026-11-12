/* 1층: 데이터 모델 — 화면·계산과 무관한 "무엇을 저장하는가"만 정의한다.
 *
 * Service  { id, name[id,ko], desc[id,ko], cur }
 * Batch    { id, svc→Service, no, title, month'YYYY-MM', stage(0~5), closeDate, kurs, note }
 * Order    { id('NUH-8자리'), batchId→Batch, buyer, item, qty, base, total(IDR), pay, method, proofName, createdAt }
 *          + self(고객이 접수한 주문), late(마감 뒤에 접수한 단계), payBy(입금 기한: 고객이 접수하고 증빙을 낸 적 없는 결제 전 주문에만)
 * Voucher  { code, off(IDR) }
 * CalcDefaults  계산기 기본 수식
 */
// globalThis: 브라우저에서는 window, 서버(Cloudflare Functions)에서는 전역 객체. 같은 파일을 양쪽에서 쓴다.
globalThis.GO = globalThis.GO || {};
var GO = globalThis.GO;

// 상호와 주문번호 머리글자. 가게 이름이 정해지면 여기 두 값만 바꾸면 화면·영수증 전체에 반영된다.
GO.BRAND = { name: 'Nuhunie', orderPrefix: 'NUH', mark: 'assets/mark-a.png', markQr: 'assets/mark-a-cut.png', qris: '', bank: { name: 'BCA', number: '2801662821', holder: 'Indah Purnama Devi' }, utcOffset: 7,
  tagline: ['Jastip Korea, Jepang, dan tiket. Order, bayar, dan lacak di satu tempat.', '한국·일본 구매대행과 티켓 대행. 주문, 결제, 조회를 한곳에서.'] };
// mark: 로고·탭 아이콘에 쓰는 마크 (다른 시안: assets/mark-b.png).  markQr: QR 위에 얹는 마크(바탕이 투명한 그림)
// 결제는 계좌 이체만 쓴다(2026-11-12 요청자 결정: QR 은 쓰지 않음). qris 를 비워 두면 QR 은 나오지 않는다.
// bank: 가게 입금 계좌. 번호가 비어 있으면 계좌 이체 안내를 숨기고 "운영자가 채팅으로 알려 준다"고 안내한다(예시 계좌를 보여 주지 않는다).
// utcOffset: 가게 시간대(자카르타 = UTC+7). CSV의 날짜를 이 시간으로 적는다.
// qris: 가게 QRIS 그림을 읽어서 나온 글자열. 넣으면 결제 화면 QR이 '가게 QRIS + 그 주문 금액'으로 바뀐다. 비어 있으면 예시 QR.

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

// 고유 코드 범위: 주문마다 1~UNIQUE_MAX 를 결제 금액에서 빼 준다(입금 확인용). 가게가 주문당 최대 이만큼 부담한다.
// (2026-11-12 사용자 결정: 더하기 1~999 → 빼기 1~300. 같은 가격의 결제 전 주문이 150건 몰려도 겹칠 확률 1% 아래)
GO.UNIQUE_MAX = 300;

// 결제 상태
GO.PAY = {
  unpaid: ['Belum bayar', '미결제'],
  pending: ['Menunggu verifikasi', '확인 대기'],
  paid: ['Lunas', '결제 완료'],
  rejected: ['Ditolak', '반려']
};

// 고객이 직접 접수한 주문의 입금 기한 (2026-11-12 사용자 결정: 24시간)
//   PAY_HOURS    접수 뒤 이 시간 안에 입금하고 증빙을 낸다. 지나면 결제 화면이 금액과 QR을 숨긴다(새로 입금하지 않도록).
//   PURGE_HOURS  접수 뒤 이 시간이 지나도 결제 전이면 접수를 지운다.
//                둘의 차이는 유예 시간이다: 기한 직전에 입금한 고객이 증빙을 낼 수 있어야 한다.
GO.PAY_HOURS = 24;
GO.PURGE_HOURS = 48;

// 입력 한도. 서버 검사와 화면 입력칸이 같이 쓴다.
GO.LIMITS = { photo: 800 * 1024, buyer: 40, item: 120, proof: 200, qty: 999, amount: 1e9, voucher: 30, voucherUses: 100000, voucherBulk: 100, note: 100, payer: 60, svcName: 40, svcDesc: 120 };

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
    vouchers: [{ code: 'NUH5000', off: 5000 }],
    calcDefaults: {
      cur: 'JPY', kurs: 110, price: 2000, qty: 1,
      feeGo: { mode: 'pct', val: 10 },
      feeCo: { mode: 'nom', val: 10000 },
      tax: { mode: 'pct', val: 0, base: 'conv' },
      extra: 0
    }
  };
};
