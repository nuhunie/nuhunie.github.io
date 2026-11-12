/* 2층: 알고리즘 — 화면(DOM)도 저장소도 모르는 순수 함수만 둔다.
 * 입력이 같으면 결과가 같다. 서버로 옮길 때 이 파일은 그대로 가져가면 된다.
 *
 *  A. 가격 계산      calcPrice
 *  B. 고유 코드      uniqueCode      (입금액 끝자리로 주문을 식별)
 *  C. 집계           batchRecap, monthRecap
 *  D. 주문 조회      searchOrders, orderProgress
 *  E. 자동 분류      classifyLine, classifyText   (붙여 넣은 글 → 주문 항목)
 *  F. 내보내기      toCSV
 */
(function (GO) {
  var X = (GO.logic = {});

  /* ── A. 가격 계산 ─────────────────────────────────────────────
   * 수수료 한 칸은 세 가지 방식 중 하나:
   *   pct  기준 금액의 val%
   *   nom  val × 수량 (1개당 고정 금액)
   *   mul  기준 금액 × val (배수)
   */
  X.fee = function (rule, base, qty) {
    var v = Number(rule.val) || 0;
    if (rule.mode === 'pct') return base * v / 100;
    if (rule.mode === 'nom') return v * qty;
    return base * v;
  };

  X.calcPrice = function (c) {
    var qty = Math.max(1, Number(c.qty) || 1);
    var conv = Math.max(0, Number(c.price) || 0) * qty * Math.max(0, Number(c.kurs) || 0); // 1) 환산가 (음수 원가·환율은 0으로 본다)
    var feeGo = X.fee(c.feeGo, conv, qty);                           // 2) GO 수수료
    var feeCo = X.fee(c.feeCo, conv, qty);                           // 3) CO 수수료
    var taxBase = c.tax.base === 'convfee' ? conv + feeGo + feeCo : conv;
    var tax = X.fee(c.tax, taxBase, qty);                            // 4) 세금
    var extra = Number(c.extra) || 0;                                // 5) 기타 비용
    var total = Math.max(0, Math.round(conv + feeGo + feeCo + tax + extra));
    return { qty: qty, conv: conv, feeGo: feeGo, feeCo: feeCo, tax: tax, extra: extra, total: total, perPcs: Math.round(total / qty) };
  };

  /* ── B. 고유 코드: 주문번호에서 1~999를 뽑아 입금액에 더한다 ──
   * 같은 가격의 주문이 여러 건이어도 입금액 끝자리로 구분하기 위한 값이다.
   * 99가지로는 같은 가격 주문 12건이면 절반 확률로 겹쳐서 999가지로 쓴다. */
  X.uniqueCode = function (orderId) {
    var h = 0;
    for (var i = 0; i < orderId.length; i++) h = (h * 31 + orderId.charCodeAt(i)) % 1000003;
    return (h % 999) + 1;
  };
  // 결제할 금액 = 주문 금액 − 쿠폰 + 고유 코드. 쿠폰이 금액보다 커도 0 아래로 내려가지 않는다.
  X.payable = function (base, off, orderId) { return base - Math.min(off || 0, base) + X.uniqueCode(orderId); };
  // 무작위 바이트 8개로 주문번호를 만든다. 맞히기 어렵도록 부르는 쪽이 암호용 난수를 넘긴다.
  X.orderIdFrom = function (bytes) {
    var id = GO.BRAND.orderPrefix + '-';
    for (var i = 0; i < 8; i++) id += X.ORDER_CHARS.charAt(bytes[i] & 31);
    return id;
  };
  /* ── QRIS: 가게 QR 한 장에 주문 금액을 넣는다 ──
   * QRIS 내용은 "번호 2자리 + 길이 2자리 + 값" 이 이어진 글자열이다 (국제 규격 EMV QR).
   * 01번 = 고정(11)/금액 지정(12), 54번 = 금액, 맨 끝 63번 = 앞 내용 전체의 검사값.
   * 금액을 넣으면 검사값이 달라지므로 다시 계산해 붙인다. 은행 앱은 검사값이 틀리면 읽지 않는다. */
  X.crc16 = function (s) {
    var bytes = new TextEncoder().encode(String(s)), crc = 0xFFFF;
    for (var i = 0; i < bytes.length; i++) {
      crc ^= bytes[i] << 8;
      for (var k = 0; k < 8; k++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
    }
    return ('000' + crc.toString(16).toUpperCase()).slice(-4);
  };
  X.qrisParse = function (payload) {
    var p = String(payload || '').trim(), out = [], i = 0;
    while (i < p.length) {
      var head = p.substr(i, 4), len = Number(head.slice(2));
      if (!/^\d{4}$/.test(head) || i + 4 + len > p.length) return null;
      out.push({ id: head.slice(0, 2), val: p.substr(i + 4, len) });
      i += 4 + len;
    }
    return out.length ? out : null;
  };
  X.qrisValid = function (payload) {
    var p = String(payload || '').trim(), t = X.qrisParse(p);
    if (!t || t[0].id !== '00' || t[t.length - 1].id !== '63' || t[t.length - 1].val.length !== 4) return false;
    return X.crc16(p.slice(0, -4)) === t[t.length - 1].val.toUpperCase();
  };
  // 금액이 든 새 QRIS 글자열을 돌려준다. 원본이 올바르지 않거나 금액이 0 이하면 빈 글자열.
  X.qrisWithAmount = function (payload, amount) {
    var n = Math.round(Number(amount));
    if (!X.qrisValid(payload) || !(n > 0)) return '';
    var t = X.qrisParse(payload).filter(function (x) { return x.id !== '01' && x.id !== '54' && x.id !== '63'; });
    t.splice(1, 0, { id: '01', val: '12' });
    var at = t.findIndex(function (x) { return Number(x.id) > 54; });
    t.splice(at < 0 ? t.length : at, 0, { id: '54', val: String(n) });
    var body = t.map(function (x) { return x.id + ('0' + x.val.length).slice(-2) + x.val; }).join('') + '6304';
    return body + X.crc16(body);
  };
  // 공개 리캡에 넣는 주문: 고객이 직접 만든 주문(self)은 승인(결제 완료)된 뒤에만 넣는다.
  // 아무나 적은 글이 공개 화면에 바로 뜨지 않게 하려는 것이다. 서버의 PUBLIC_ORDERS 조건과 같은 규칙.
  X.publicOrders = function (orders) {
    return orders.filter(function (o) { return !(o.self && o.pay !== 'paid'); });
  };
  // 확인 대기 중인 주문 가운데 결제 금액이 같은 것들: { 금액: 건수 }. 운영자가 입금을 구분하기 어려운 경우다.
  X.duplicateTotals = function (orders) {
    var n = {}, out = {};
    orders.forEach(function (o) { if (o.pay === 'pending') n[o.total] = (n[o.total] || 0) + 1; });
    Object.keys(n).forEach(function (k) { if (n[k] > 1) out[k] = n[k]; });
    return out;
  };

  /* ── B2. 주문번호: 머리글자-8자리 ──
   * 숫자 6자리는 훑어서 맞힐 수 있어, 영문+숫자 8자리(32^8 ≈ 1조 가지)로 쓴다.
   * 헷갈리는 글자(0 O 1 I)는 쓰지 않는다. */
  X.ORDER_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  // 고객이 적은 주문번호를 맞춰 준다: 소문자, 띄어쓰기, 빠진 하이픈 ("nuh usmtqleg" → "NUH-USMTQLEG").
  // 글자를 바꾸거나 채워 주지는 않는다. 앞머리까지 번호 전체가 맞아야 찾는 것은 그대로다.
  X.normOrderId = function (v) {
    var p = GO.BRAND.orderPrefix, s = String(v == null ? '' : v).toUpperCase().replace(/[\s\-_.]/g, '');
    return s.indexOf(p) === 0 ? p + '-' + s.slice(p.length) : s;
  };
  // 가게 시간(자카르타) 기준 날짜 'YYYY-MM-DD'. 서버가 적은 시각은 세계 표준시(끝에 Z)라 그대로 자르면
  // 자카르타 새벽 주문이 전날로 찍힌다. 시간대 표시가 없는 값(예시 데이터)은 이미 가게 시간으로 적힌 것으로 본다.
  X.shopDate = function (iso) {
    var s = String(iso || ''), t = /(Z|[+\-]\d\d:?\d\d)$/i.test(s) ? Date.parse(s) : NaN;
    return isNaN(t) ? s.slice(0, 10) : new Date(t + GO.BRAND.utcOffset * 3600000).toISOString().slice(0, 10);
  };
  X.isOrderId = function (v) {
    return new RegExp('^' + GO.BRAND.orderPrefix + '-[' + X.ORDER_CHARS + ']{8}$').test(String(v || ''));
  };
  // 숫자 하나로 늘 같은 8자리를 만든다. 예시 데이터와 검사에만 쓴다 (실제 주문번호는 무작위로 만든다).
  X.orderCode = function (n) {
    var h = ((Number(n) || 0) + 987654321) % 2147483647, out = '';
    for (var i = 0; i < 8; i++) { h = (h * 48271) % 2147483647; out += X.ORDER_CHARS.charAt(h % 32); }
    return out;
  };

  /* ── C. 집계 ───────────────────────────────────────────────── */
  X.batchRecap = function (batchId, orders) {
    var r = { count: 0, pcs: 0, total: 0, paid: 0, pending: 0, unpaid: 0, paidTotal: 0, items: [] };
    var byItem = {};
    orders.forEach(function (o) {
      if (o.batchId !== batchId) return;
      r.count++; r.pcs += o.qty; r.total += o.total;
      if (o.pay === 'paid') { r.paid++; r.paidTotal += o.total; }
      else if (o.pay === 'pending') r.pending++;
      else r.unpaid++;
      var it = byItem[o.item] || (byItem[o.item] = { item: o.item, qty: 0, total: 0 });
      it.qty += o.qty; it.total += o.total;
    });
    r.items = Object.keys(byItem).map(function (k) { return byItem[k]; })
      .sort(function (a, b) { return b.qty - a.qty; });
    return r;
  };

  X.monthRecap = function (batches, orders) {
    var r = { batches: batches.length, ongoing: 0, count: 0, pcs: 0, total: 0, paidTotal: 0 };
    batches.forEach(function (b) {
      if (b.stage < GO.LAST_STAGE) r.ongoing++;
      var br = X.batchRecap(b.id, orders);
      r.count += br.count; r.pcs += br.pcs; r.total += br.total; r.paidTotal += br.paidTotal;
    });
    return r;
  };

  /* ── D. 주문 조회 ──────────────────────────────────────────── */
  X.searchOrders = function (orders, q) {
    // 주문번호 전체가 맞아야 찾는다. 주문번호는 본인만 아는 열쇠다.
    // 아이디로는 찾지 않는다: 아이디는 공개된 값이라 남의 주문을 보게 된다.
    q = X.normOrderId(q);
    var out = [];
    orders.forEach(function (o) {
      if (o.id !== q) return;
      var copy = {}; for (var k in o) copy[k] = o[k];
      copy.payBy = X.payBy(o);                      // 기한은 증빙 이름을 가리기 전에 정한다
      copy.buyer = X.maskName(o.buyer); copy.proofName = '';
      out.push(copy);
    });
    return out;
  };

  // 주문 한 건의 진행 단계 = [결제] + 배치 단계 1~5. cur는 "지금 있는 칸"이다.
  //   결제 전        → 0 (결제 칸)
  //   결제 후        → 배치 단계와 같은 칸 (배치가 아직 접수 중이면 결제 칸에 머문다)
  // 배치 상세의 단계 표시와 같은 규칙: cur 앞은 지나온 칸, cur는 현재 칸.
  X.orderProgress = function (order, batch) {
    var paid = order.pay === 'paid';
    return { cur: paid ? batch.stage : 0, finished: paid && batch.stage === GO.LAST_STAGE };
  };

  /* ── 입금 기한: 고객이 접수한 결제 전 주문에만 있다 ──
   *   payBy(o)          기한 시각(ISO 글자). 해당 없는 주문이면 ''
   *   payState(o, now)  'none' 해당 없음 · 'open' 기한 안 · 'overdue' 기한 지남(유예 중: 증빙만 받는다) · 'gone' 지울 때가 됨
   * 운영자가 넣은 주문, 증빙을 낸 주문, 반려된 주문에는 기한이 없다(운영자가 다룬다).
   * 증빙을 한 번이라도 낸 주문(proofName 이 있음)은 운영자가 미결제로 되돌려도 기한이 없다: 자동으로 지워지면 안 된다.
   * 그래서 기한은 증빙 이름을 가리기 전의 주문으로 계산한다(고객에게 내보낼 때는 payBy 를 먼저 붙이고 가린다). */
  X.payBy = function (o, hours) {
    if (!o || !o.self || o.pay !== 'unpaid' || o.proofName || !o.createdAt) return '';
    var t = Date.parse(o.createdAt);
    return isNaN(t) ? '' : new Date(t + (hours || GO.PAY_HOURS) * 3600000).toISOString();
  };
  X.payState = function (o, now, payHours, purgeHours) {
    var by = X.payBy(o, payHours);
    if (!by) return 'none';
    var n = now == null ? Date.now() : now;
    if (n >= Date.parse(o.createdAt) + (purgeHours || GO.PURGE_HOURS) * 3600000) return 'gone';
    return n >= Date.parse(by) ? 'overdue' : 'open';
  };
  // 운영자가 이 주문을 미결제로 되돌려도 되는가. 고객이 접수하고 증빙을 낸 적 없는 주문이 지울 때를 넘겼으면 안 된다:
  // 미결제가 되는 순간 "기한이 지난 결제 전 접수"가 되어 곧바로 지워진다. 그런 주문은 반려하거나 삭제한다. (2026-11-12 사용자 결정)
  X.canUnpay = function (o, now, payHours, purgeHours) {
    if (!o) return false;
    var as = {}; for (var k in o) as[k] = o[k]; as.pay = 'unpaid';
    return X.payState(as, now, payHours, purgeHours) !== 'gone';
  };

  X.maskName = function (n) {
    n = String(n || '');
    return n.length <= 2 ? n.charAt(0) + '*' : n.slice(0, 2) + '***';
  };

  /* ── E. 자동 분류 ──────────────────────────────────────────────
   * 한 줄 = 주문 한 건. 줄에서 "확실한 것부터" 떼어 내고 남은 글을 나눈다.
   *   1) 줄머리 번호·기호 제거
   *   2) batch N        → batchNo
   *   3) 통화가 붙은 수 → price + cur   (Rp, k/rb/jt, ¥/yen, ₩/won)
   *   4) 수량 표현      → qty           (2pcs, x2, 2x)
   *   5) @아이디        → buyer
   *   6) 남은 글을 구분자로 나눠 buyer(없으면 첫 조각) / item(나머지)
   *   7) 남은 맨숫자: 1000 이상이면 price, 1~99면 qty
   * 빠진 칸은 missing에 적어 화면에서 사람이 확인하게 한다.
   */
  function num(s, suffix) {
    suffix = (suffix || '').toLowerCase();
    if (suffix) {
      var f = parseFloat(String(s).replace(/\./g, '').replace(',', '.'));
      if (/^\d+[.,]\d{1,2}$/.test(s)) f = parseFloat(String(s).replace(',', '.'));
      return Math.round(f * (suffix === 'jt' || suffix === 'juta' ? 1e6 : 1e3));
    }
    // 천 단위는 늘 세 자리씩 끊는다. 끝이 구분자 + 두 자리("25.000,00", "25,000.00")면 소수부이므로 버린다.
    return parseInt(String(s).replace(/[.,]\d{2}$/, '').replace(/[.,]/g, ''), 10);
  }

  var PRICE_RULES = [
    { re: /(?:rp\.?|idr)\s*([\d.,]+)\s*(k|rb|ribu|jt|juta)?\b/i, cur: 'IDR' },
    { re: /([\d.,]+)\s*(k|rb|ribu|jt|juta)\b/i, cur: 'IDR' },
    { re: /(?:¥|jpy\s*)([\d.,]+)/i, cur: 'JPY' },
    { re: /([\d.,]+)\s*(?:yen|jpy|円|엔)/i, cur: 'JPY' },
    { re: /(?:₩|krw\s*)([\d.,]+)/i, cur: 'KRW' },
    { re: /([\d.,]+)\s*(?:won|krw|원)/i, cur: 'KRW' }
  ];
  var QTY_RULES = [/(\d+)\s*(?:pcs|pc|buah|ea|개)\b/i, /\bx\s*(\d+)\b/i, /\b(\d+)\s*x\b/i];

  X.classifyLine = function (line) {
    // priceIs: 가격이 개당('each')인지 합계('total')인지 글에 적혀 있을 때만 채운다. 없으면 null(화면의 기본값을 따른다)
    var r = { buyer: '', item: '', qty: null, price: null, cur: null, priceIs: null, batchNo: null, raw: line, missing: [] };
    var s = line.trim().replace(/^(\d+[.)]|[-•*])\s+/, '');
    var m, i;

    if ((m = s.match(/batch\s*#?\s*(\d+)/i))) { r.batchNo = +m[1]; s = s.replace(m[0], ' '); }

    for (i = 0; i < PRICE_RULES.length && r.price === null; i++) {
      if ((m = s.match(PRICE_RULES[i].re))) {
        r.price = num(m[1], m[2]); r.cur = PRICE_RULES[i].cur;
        // 가격이 개당인지 합계인지 적혀 있으면 읽는다: "@25k", "25k/pcs", "25k per pcs" → 개당, "total 50k" → 합계
        var before = s.slice(0, m.index), after = s.slice(m.index + m[0].length), e;
        if ((e = before.match(/@\s*$/))) { r.priceIs = 'each'; before = before.slice(0, e.index); }
        else if ((e = before.match(/\b(?:total|ttl|tot)\s*:?\s*$/i))) { r.priceIs = 'total'; before = before.slice(0, e.index); }
        if ((e = after.match(/^\s*(?:\/\s*(?:pcs|pc|ea|biji|buah)|per\s*(?:pcs|pc|biji|buah)|each|satuan)\b/i))) { r.priceIs = 'each'; after = after.slice(e[0].length); }
        else if ((e = after.match(/^\s*(?:total|ttl)\b/i))) { r.priceIs = 'total'; after = after.slice(e[0].length); }
        s = before + ' ' + after;
      }
    }
    if ((m = s.match(/@([\w.]+)/))) { r.buyer = m[1]; s = s.replace(m[0], ' '); }

    var parts = s.split(/\s*[\/|,;\t]\s*|\s+-\s+|\s{2,}/).map(function (p) { return p.trim(); }).filter(Boolean);
    // 수량: 조각 전체가 수량 표현인 것("2pcs", "x2")을 먼저 찾는다.
    // 품목 이름 속의 "1 pc boy group" 같은 표현을 수량으로 오인하지 않기 위해서다.
    parts = parts.filter(function (p) {
      var q = r.qty === null && p.match(/^(?:x\s*(\d+)|(\d+)\s*(?:pcs|pc|buah|ea|개|x))$/i);
      if (q) r.qty = +(q[1] || q[2]);
      return !q;
    });
    // 품목 칸 안에 섞인 수량: "2x album", "album 2pcs", "album x2". 이름 속의 "random 1 pc" 는 건드리지 않도록
    // 뒤에 붙는 "N pcs" 는 2 이상만 수량으로 본다.
    if (r.qty === null && parts.length > 1) {
      parts = parts.map(function (p) {
        if (r.qty !== null) return p;
        var a = p.match(/^(\d+)\s*x\s+(\S.*)$/i), b = p.match(/^(\S.*?)\s+x\s*(\d+)$/i), c = p.match(/^(\S.*?)\s+(\d+)\s*(?:pcs|pc|buah|ea|개)$/i);
        if (a && +a[1] >= 1) { r.qty = +a[1]; return a[2].trim(); }
        if (b && +b[2] >= 1) { r.qty = +b[2]; return b[1].trim(); }
        if (c && +c[2] >= 2) { r.qty = +c[2]; return c[1].trim(); }
        return p;
      });
    }
    // 구분자 없이 한 덩어리로 쓴 줄이면 글 안에서 수량 표현을 찾는다
    if (r.qty === null && parts.length === 1) {
      for (i = 0; i < QTY_RULES.length && r.qty === null; i++) {
        if ((m = parts[0].match(QTY_RULES[i]))) { r.qty = +m[1]; parts[0] = parts[0].replace(m[0], ' ').replace(/\s+/g, ' ').trim(); }
      }
    }
    // 통화 표시 없이 글 속에 섞인 금액("keyring 75.000")
    if (r.price === null) {
      parts = parts.map(function (p) {
        var pm = r.price === null && p.match(/(?:^|\s)(\d{1,3}(?:[.,]\d{3})+|\d{4,})(?=\s|$)/);
        if (!pm || pm[0].trim() === p) return p;
        r.price = num(pm[1]); r.cur = 'IDR';
        return p.replace(pm[0], ' ').replace(/\s+/g, ' ').trim();
      });
    }
    var text = [];
    parts.forEach(function (p) {
      if (/^[\d.,]+$/.test(p)) {
        var n = num(p);
        if (n >= 1000 && r.price === null) { r.price = n; r.cur = 'IDR'; return; }
        if (n >= 1 && n <= 99 && r.qty === null) { r.qty = n; return; }
      }
      text.push(p);
    });
    if (!r.buyer && text.length > 1) r.buyer = text.shift().replace(/:$/, '');
    else if (!r.buyer && text.length === 1 && (m = text[0].match(/^(\S+)\s*:?\s+(.+)$/))) { r.buyer = m[1].replace(/:$/, ''); text = [m[2]]; }
    r.item = text.join(' ').trim();

    if (r.qty === null) r.qty = 1;
    if (!r.buyer) r.missing.push('buyer');
    if (!r.item) r.missing.push('item');
    if (r.price === null) r.missing.push('price');
    return r;
  };

  // 붙여 넣은 줄의 합계 금액(원래 통화 기준). 가격이 개당이면 수량을 곱하고, 합계면 그대로 쓴다.
  // 글에 표시가 없으면 화면에서 고른 기본값(fallback: 'each' | 'total')을 따른다.
  X.lineUnitPrice = function (r, fallback) {
    if (r.price == null) return null;
    var each = (r.priceIs || fallback || 'each') === 'each';
    return each ? r.price : r.price / Math.max(1, r.qty || 1);
  };
  // 한 장짜리 쿠폰 코드: 'ONE' + 무작위 6자리(주문번호와 같은 글자). 맞히기 어렵도록 부르는 쪽이 암호용 난수 6바이트를 넘긴다.
  X.voucherCodeFrom = function (bytes) {
    var c = 'ONE';
    for (var i = 0; i < 6; i++) c += X.ORDER_CHARS.charAt(bytes[i] & 31);
    return c;
  };
  // 입금자 이름 비교용: 대소문자·악센트·문장부호·띄어쓰기 차이는 같은 이름으로 본다 ("SITI A." = "siti  a")
  X.normPayer = function (name) {
    return String(name || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  };
  // 이 주문(orderId)의 입금자가 같은 쿠폰을 쓴 다른 주문의 입금자와 같으면 그 주문번호. 아니면 ''.
  // 반려된 주문은 세지 않는다. 쿠폰을 쓰지 않은 주문이나 이름이 비어 있으면 비교하지 않는다.
  X.payerClash = function (orders, orderId, name) {
    var me = orders.filter(function (o) { return o.id === orderId; })[0], n = X.normPayer(name);
    if (!me || !me.voucher || !n) return '';
    var hit = orders.filter(function (o) { return o.id !== orderId && o.voucher === me.voucher && o.pay !== 'rejected' && o.payer && X.normPayer(o.payer) === n; })[0];
    return hit ? hit.id : '';
  };
  // 반려된 주문을 되살려도 되는가(반려 → 결제 완료·확인 대기·결제 전). 반려된 사이 그 주문의 쿠폰을 다른 주문들이 한도까지 썼으면 안 된다.
  // 반려된 주문은 사용 수에 들지 않으므로, 되살리는 순간 한도를 넘게 된다. (2026-11-12 사용자 결정: 막는다)
  X.canRevive = function (order, orders, vouchers) {
    if (!order || order.pay !== 'rejected' || !order.voucher) return true;
    var v = vouchers.filter(function (x) { return x.code === order.voucher; })[0];
    if (!v || !v.max) return true;
    var used = orders.filter(function (o) { return o.voucher === order.voucher && o.pay !== 'rejected' && o.id !== order.id; }).length;
    return used < v.max;
  };
  // 쿠폰을 더 쓸 수 있는가. max 가 없거나 0이면 한도 없음.
  X.voucherLeft = function (v, used) { return !v.max || (used || 0) < v.max; };

  /* ── 백업: 관리자가 내려받는 표와 전체 자료 ── */
  X.batchRows = function (db) {
    var rows = [['batch_id', 'service', 'no', 'title', 'month', 'stage', 'close_date', 'kurs', 'note', 'orders', 'pcs', 'total_idr', 'paid_idr']];
    db.batches.forEach(function (b) {
      var r = X.batchRecap(b.id, db.orders), s = db.services.filter(function (x) { return x.id === b.svc; })[0];
      rows.push([b.id, s ? s.name[0] : b.svc, b.no, b.title, b.month, GO.STAGES[b.stage] ? GO.STAGES[b.stage][0] : b.stage, b.closeDate, b.kurs, b.note, r.count, r.pcs, r.total, r.paidTotal]);
    });
    return rows;
  };
  X.voucherRows = function (db) {
    return [['code', 'discount_idr', 'max_uses', 'used', 'note']].concat(db.vouchers.map(function (v) { return [v.code, v.off, v.max || '', v.used || 0, v.note || '']; }));
  };
  // 전체 자료를 한 파일로. 다시 불러오는 기능은 아직 없다(보관용).
  X.backup = function (db, now) {
    return { app: GO.BRAND.name, version: 1, exportedAt: new Date(now == null ? Date.now() : now).toISOString(),
      services: db.services, batches: db.batches, orders: db.orders, vouchers: db.vouchers, calcDefaults: db.calcDefaults };
  };

  X.classifyText = function (text) {
    var batchNo = null, out = [];
    String(text || '').split(/\r?\n/).forEach(function (line) {
      if (!line.trim()) return;
      var r = X.classifyLine(line);
      // "Batch 4" 같은 제목 줄은 주문이 아니라 아래 줄들의 배치 번호로 쓴다
      if (r.batchNo !== null && !r.item && r.price === null) { batchNo = r.batchNo; return; }
      if (r.batchNo === null) r.batchNo = batchNo;
      out.push(r);
    });
    return out;
  };

  /* ── F. 내보내기: 표(배열의 배열) → CSV 글자. 스프레드시트에서 바로 열 수 있다 ── */
  X.toCSV = function (rows) {
    return rows.map(function (r) {
      return r.map(function (v) {
        v = String(v == null ? '' : v);
        if (/^[\s]*[=+\-@]/.test(v) || /^[\t\r]/.test(v)) v = "'" + v;   // 수식으로 실행되지 않게 막는다 (앞에 탭·공백을 둔 것도)
        return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
      }).join(',');
    }).join('\r\n');
  };

  /* AI 연결 지점. 화면은 항상 GO.ai.classify(text)만 부른다.
   * GO.config.aiEndpoint가 있으면 서버(예: Claude API를 호출하는 Worker)에 맡기고,
   * 없거나 실패하면 위의 규칙 분류기로 처리한다. 응답 형식은 classifyText와 같다. */
  GO.config = GO.config || { aiEndpoint: '' };
  GO.ai = {
    classify: function (text) {
      if (!GO.config.aiEndpoint) return Promise.resolve({ engine: 'rules', rows: X.classifyText(text) });
      return fetch(GO.config.aiEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: text }) })
        .then(function (res) { if (!res.ok) throw new Error(res.status); return res.json(); })
        .then(function (j) { return { engine: 'ai', rows: j.rows }; })
        .catch(function () { return { engine: 'rules', rows: X.classifyText(text) }; });
    }
  };
})(globalThis.GO);
