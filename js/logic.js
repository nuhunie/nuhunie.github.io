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
    var conv = (Number(c.price) || 0) * qty * (Number(c.kurs) || 0); // 1) 환산가
    var feeGo = X.fee(c.feeGo, conv, qty);                           // 2) GO 수수료
    var feeCo = X.fee(c.feeCo, conv, qty);                           // 3) CO 수수료
    var taxBase = c.tax.base === 'convfee' ? conv + feeGo + feeCo : conv;
    var tax = X.fee(c.tax, taxBase, qty);                            // 4) 세금
    var extra = Number(c.extra) || 0;                                // 5) 기타 비용
    var total = Math.round(conv + feeGo + feeCo + tax + extra);
    return { qty: qty, conv: conv, feeGo: feeGo, feeCo: feeCo, tax: tax, extra: extra, total: total, perPcs: Math.round(total / qty) };
  };

  /* ── B. 고유 코드: 주문번호에서 1~99를 뽑아 입금액에 더한다 ── */
  X.uniqueCode = function (orderId) {
    var h = 0;
    for (var i = 0; i < orderId.length; i++) h = (h * 31 + orderId.charCodeAt(i)) % 9973;
    return (h % 99) + 1;
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
    q = String(q || '').trim().toLowerCase().replace(/^@/, '');
    if (q.length < 2) return [];
    return orders.filter(function (o) {
      return o.id.toLowerCase().indexOf(q) >= 0 || o.buyer.toLowerCase() === q;
    });
  };

  // 주문 한 건의 진행 단계 = [결제] + 배치 단계 1~5. cur는 "지금 있는 칸"이다.
  //   결제 전        → 0 (결제 칸)
  //   결제 후        → 배치 단계와 같은 칸 (배치가 아직 접수 중이면 결제 칸에 머문다)
  // 배치 상세의 단계 표시와 같은 규칙: cur 앞은 지나온 칸, cur는 현재 칸.
  X.orderProgress = function (order, batch) {
    var paid = order.pay === 'paid';
    return { cur: paid ? batch.stage : 0, finished: paid && batch.stage === GO.LAST_STAGE };
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
    return parseInt(String(s).replace(/[.,]/g, ''), 10);
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
    var r = { buyer: '', item: '', qty: null, price: null, cur: null, batchNo: null, raw: line, missing: [] };
    var s = line.trim().replace(/^(\d+[.)]|[-•*])\s+/, '');
    var m, i;

    if ((m = s.match(/batch\s*#?\s*(\d+)/i))) { r.batchNo = +m[1]; s = s.replace(m[0], ' '); }

    for (i = 0; i < PRICE_RULES.length && r.price === null; i++) {
      if ((m = s.match(PRICE_RULES[i].re))) {
        r.price = num(m[1], m[2]); r.cur = PRICE_RULES[i].cur; s = s.replace(m[0], ' ');
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
        if (/^[=+\-@]/.test(v)) v = "'" + v;           // 수식으로 실행되지 않게 막는다
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
