/* 3층: 저장소 — 데이터를 읽고 쓰는 유일한 통로.
 *
 * 두 가지 방식으로 동작하고, 화면 코드는 어느 쪽인지 몰라도 된다.
 *   server  /api 가 응답하면 서버(Cloudflare D1)의 데이터를 쓴다. 모든 기기가 같은 내용을 본다.
 *   local   /api 가 없으면(파일만 올린 목업) 이 브라우저의 localStorage에 둔다.
 *
 * 화면이 빠르게 그려지도록 읽은 내용은 db에 들고 있는다.
 *   읽기        db에서 바로 읽는다 (service, batch, batchesOf ...)
 *   관리자 쓰기  db를 먼저 고치고 서버에 보낸다. 서버가 거절하면 다시 읽어 와 되돌린다.
 *   고객 흐름    조회·결제는 서버가 판단해야 하므로 Promise를 돌려준다 (track, fetchOrder, submitPayment ...)
 */
(function (GO) {
  var KEY = 'jastip-mockup-v4';
  var X = GO.logic;
  var db, mode = 'local', admin = false, loginReady = true, loginWeak = false, canReset = true, lastPull = 0;

  /* ── local ── */
  // 목업판에서도 서버와 같은 규칙: 접수 뒤 PURGE_HOURS 가 지나도록 결제 전인 고객 접수는 지운다
  function purgeLocal() {
    var n = db.orders.length;
    db.orders = db.orders.filter(function (o) { return X.payState(o) !== 'gone'; });
    if (db.orders.length !== n) save();
  }
  function loadLocal() {
    try { db = JSON.parse(localStorage.getItem(KEY)); } catch (e) { db = null; }
    if (!db || !db.services) { db = GO.seed(); save(); }
    purgeLocal();
  }
  function save() {
    if (mode !== 'local') return;
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* 저장 불가 환경에서는 메모리로만 동작 */ }
  }
  function find(list, id) { return list.filter(function (x) { return x.id === id; })[0]; }

  /* ── server ── */
  function api(method, path, data) {
    return fetch('/api' + path, {
      method: method, credentials: 'same-origin',
      headers: data ? { 'content-type': 'application/json' } : {},
      body: data ? JSON.stringify(data) : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (j) {
        if (!res.ok) { var e = new Error(j.error || 'HTTP ' + res.status); e.status = res.status; throw e; }
        return j;
      });
    });
  }
  function setState(s) {
    db = { services: s.services, batches: s.batches, orders: s.orders || [], vouchers: s.vouchers || [], calcDefaults: s.calcDefaults || (db && db.calcDefaults) || GO.seed().calcDefaults };
  }
  function pull() { return api('GET', admin ? '/admin/state' : '/public').then(function (s) { lastPull = Date.now(); setState(s); }); }
  // 관리자 쓰기를 서버에 보낸다. 실패하면 서버 내용을 다시 읽어 화면을 되돌린다.
  function push(method, path, data) {
    if (mode !== 'server') return;
    api(method, path, data).catch(function (e) {
      if (e.status === 401) admin = false;
      pull().catch(function () {}).then(function () { if (GO.onStoreError) GO.onStoreError(e); });
    });
  }

  function voucherOf(code) { code = String(code || '').trim().toUpperCase(); return db.vouchers.filter(function (x) { return x.code === code; })[0] || null; }
  // 목업판: 이 쿠폰을 쓴 주문 수 (반려된 주문과 except 주문은 빼고). 서버판은 서버가 센다.
  function voucherUsed(code, except) { return db.orders.filter(function (o) { return o.voucher === code && o.pay !== 'rejected' && o.id !== except; }).length; }
  // 목업판: 쓸 수 있는 쿠폰이면 그 쿠폰, 코드를 안 적었으면 null. 없거나 다 쓴 쿠폰이면 오류를 던진다.
  function usableVoucher(code, except) {
    if (!String(code || '').trim()) return null;
    var v = voucherOf(code);
    if (!v) throw new Error('Voucher not found.');
    if (!X.voucherLeft(v, voucherUsed(v.code, except))) throw new Error('This voucher has been used up.');
    return v;
  }

  GO.store = {
    get db() { return db; },
    get mode() { return mode; },
    get isAdmin() { return mode === 'local' || admin; },
    get loginReady() { return loginReady; },
    get loginWeak() { return loginWeak; },        // 서버의 관리자 비밀번호가 너무 짧아 로그인이 꺼져 있다
    get canReset() { return canReset; },          // 예시 데이터 초기화: 목업판과 내 컴퓨터에서만

    /* 처음 한 번: 서버가 있는지 확인하고 데이터를 읽는다 */
    init: function () {
      return api('GET', '/public').then(function (s) {
        if (!s || !s.services) throw new Error('no api');
        mode = 'server'; setState(s); lastPull = Date.now();
        return api('GET', '/me').then(function (me) {
          admin = !!me.admin; loginReady = !!me.configured; loginWeak = !!me.weak; canReset = !!me.canReset;
          if (admin) return pull();
        }).catch(function () {});
      }).catch(function () { mode = 'local'; loadLocal(); });
    },
    /* 웹 푸시 알림 (서버판에서만). 공개 열쇠가 비어 있으면 알림 기능이 꺼져 있다 */
    pushKey: function () { return mode === 'server' ? api('GET', '/push/key').then(function (r) { return r.key || ''; }, function () { return ''; }) : Promise.resolve(''); },
    pushSubscribe: function (orderId, sub, lang) { var j = sub.toJSON(); return api('POST', '/push/subscribe', { orderId: orderId, endpoint: j.endpoint, keys: j.keys, lang: lang }); },
    pushUnsubscribe: function (endpoint, orderId) { return api('POST', '/push/unsubscribe', { endpoint: endpoint, orderId: orderId || '' }); },
    /* 서버 내용을 다시 읽는다. 바뀐 것이 있으면 true */
    refresh: function (force) {
      if (mode !== 'server') return Promise.resolve(false);
      if (!force && Date.now() - lastPull < 15000) return Promise.resolve(false);   // 화면을 옮길 때마다 서버를 부르지 않는다
      var before = JSON.stringify(db);
      return pull().then(function () { return JSON.stringify(db) !== before; }).catch(function () { return false; });
    },
    reset: function () {
      if (mode === 'local') { db = GO.seed(); save(); return Promise.resolve(); }
      return api('POST', '/admin/reset').then(setState);
    },

    /* ── 읽기 (db에서 바로) ── */
    service: function (id) { return find(db.services, id); },
    batch: function (id) { return find(db.batches, id); },
    order: function (id) { return find(db.orders, X.normOrderId(id)); },
    batchesOf: function (svc, month) {
      return db.batches.filter(function (b) { return b.svc === svc && (!month || b.month === month); })
        .sort(function (a, b) { return b.no - a.no; });
    },
    monthsOf: function (svc) {
      var seen = {};
      db.batches.forEach(function (b) { if (b.svc === svc) seen[b.month] = 1; });
      return Object.keys(seen).sort().reverse();
    },
    ordersOf: function (batchId) { return db.orders.filter(function (o) { return o.batchId === batchId; }); },
    /* 고객 화면용 배치 집계: 수량만. (금액·주문 수·결제 현황은 관리자 화면에서 logic.batchRecap 으로 계산한다)
     * 서버의 공개 데이터에는 주문이 없고 배치마다 수량(stats.pcs)이 붙어 온다. */
    recap: function (batchId) {
      var b = find(db.batches, batchId);
      return { pcs: b && b.stats ? b.stats.pcs : X.batchRecap(batchId, X.publicOrders(db.orders)).pcs };
    },
    monthRecap: function (list) {
      var self = this, r = { batches: list.length, ongoing: 0, pcs: 0 };
      list.forEach(function (b) { if (b.stage < GO.LAST_STAGE) r.ongoing++; r.pcs += self.recap(b.id).pcs; });
      return r;
    },
    /* 배치 하나의 품목별 수량 [{ item, qty }] (Promise). 누가 무엇을 샀는지는 담지 않는다. */
    batchItems: function (batchId) {
      var b = find(db.batches, batchId);
      if (mode === 'server' && b && b.stats) return api('GET', '/batch-items?id=' + encodeURIComponent(batchId)).then(function (r) { return r.items; });
      return Promise.resolve(X.batchRecap(batchId, X.publicOrders(db.orders)).items.map(function (it) { return { item: it.item, qty: it.qty }; }));
    },
    /* 관리자 활동 기록 (server에서만). local이면 null */
    fetchLog: function () {
      if (mode !== 'server') return Promise.resolve(null);
      return api('GET', '/admin/log').then(function (r) { return r.log; });
    },
    newOrderId: function () {
      // 무작위 8자리. 맞히기 어렵도록 암호용 난수를 쓴다.
      var id, bytes;
      do { bytes = new Uint8Array(8); globalThis.crypto.getRandomValues(bytes); id = X.orderIdFrom(bytes); } while (find(db.orders, id));
      return id;
    },

    /* ── 고객 흐름 (Promise) ── */
    track: function (q) {
      // 돌려주는 목록의 gone 은 "기한까지 결제되지 않아 지워진 접수"라는 뜻이다
      if (mode === 'local') { var was = this.order(q), dead = !!was && X.payState(was) === 'gone'; purgeLocal(); var local = X.searchOrders(db.orders, q); local.gone = dead; return Promise.resolve(local); }
      return api('GET', '/track?q=' + encodeURIComponent(q)).then(function (r) { var list = r.orders || []; list.gone = !!r.gone; return list; });
    },
    fetchOrder: function (id) {
      // 없는 번호는 null, 기한까지 결제되지 않아 지워진 접수는 { gone: true }. 그 밖의 실패(연결 끊김, 횟수 제한)는 실패로 넘긴다.
      if (mode === 'local') { var old = this.order(String(id || '').trim()); if (old && X.payState(old) === 'gone') { purgeLocal(); return Promise.resolve({ gone: true }); } var o = this.order(String(id || '').trim()); return Promise.resolve(o ? Object.assign({}, o, { payBy: X.payBy(o), buyer: X.maskName(o.buyer), proofName: '' }) : null); }   // 기한은 증빙 이름을 가리기 전에 정한다(서버와 같다)
      return api('GET', '/order?id=' + encodeURIComponent(String(id || '').trim())).then(function (r) { return r.order; }, function (e) { if (e.status === 404) return null; if (e.status === 410) return { gone: true }; throw e; });
    },
    checkVoucher: function (code) {
      code = String(code || '').trim().toUpperCase();
      if (mode === 'local') { try { return Promise.resolve(usableVoucher(code)); } catch (e) { return Promise.resolve(null); } }
      return api('POST', '/voucher', { code: code }).then(function (v) { return v; }, function () { return null; });
    },
    /* 고객이 새 주문을 접수한다(결제 전). p = { batchId, buyer, item, qty, base, voucher } → 저장된 주문 (Promise)
     * 주문번호와 결제 금액은 여기서 정해져 저장된다. 서버가 있으면 서버가 정한다(같은 규칙: logic.js 의 payable). */
    createOrder: function (p) {
      if (mode === 'server') return api('POST', '/order', p).then(function (r) { return r.order; });
      purgeLocal();
      var v, pb = find(db.batches, p.batchId), base = Math.round(Number(p.base)), id, total, i;
      try { v = usableVoucher(p.voucher); } catch (e) { return Promise.reject(e); }
      if (!pb || !(base > 0)) return Promise.reject(new Error('Check the order fields.'));
      for (i = 0; i < 8; i++) {                    // 결제 전·확인 대기 주문과 금액이 겹치지 않는 번호를 고른다
        id = this.newOrderId(); total = X.payable(base, v ? v.off : 0, id);
        if (!db.orders.some(function (o) { return o.total === total && (o.pay === 'unpaid' || o.pay === 'pending'); })) break;
      }
      var o = { id: id, self: 1, late: pb.stage >= 1 ? pb.stage : 0, batchId: pb.id, buyer: String(p.buyer).trim().replace(/^@/, ''), item: String(p.item).trim(),
        qty: Math.max(1, Math.round(Number(p.qty)) || 1), base: base, total: total, pay: 'unpaid', method: '', proofName: '', createdAt: new Date().toISOString(), voucher: v ? v.code : '' };
      db.orders.push(o); save();
      return Promise.resolve(o);
    },
    /* 결제 증빙 사진(Blob)을 올린다. 서버판에서만 저장한다(목업판은 파일 이름만 둔다). */
    uploadProof: function (orderId, blob) {
      if (mode !== 'server') return Promise.resolve(null);
      return fetch('/api/proof/' + encodeURIComponent(orderId), { method: 'POST', credentials: 'same-origin', headers: { 'content-type': blob.type }, body: blob })
        .then(function (res) { return res.json().catch(function () { return {}; }).then(function (j) { if (!res.ok) { var e = new Error(j.error || 'HTTP ' + res.status); e.status = res.status; throw e; } return j; }); });
    },
    /* 접수된 주문의 결제 증빙을 낸다. p = { orderId, voucher, method, proofName } → 저장된 주문 (Promise) */
    submitPayment: function (p) {
      if (mode === 'server') return api('POST', '/pay', p).then(function (r) { return pull().catch(function () {}).then(function () { return r.order; }); });
      var o = this.order(p.orderId), v = null;
      if (!o) return Promise.reject(new Error('Order not found.'));
      if (!o.self) { try { v = usableVoucher(p.voucher, o.id); } catch (e) { return Promise.reject(e); } }
      if (o.pay !== 'unpaid' && o.pay !== 'rejected') return Promise.reject(new Error('This order has already been submitted.'));
      if (o.self && !X.canRevive(o, db.orders, db.vouchers)) return Promise.reject(new Error('The voucher on this order was used up while it was rejected.'));
      var base = o.base || o.total;
      // 고객이 접수한 주문(self)은 접수할 때 금액이 정해졌다. 운영자가 넣은 주문은 여기서 쿠폰과 고유 코드를 붙인다.
      Object.assign(o, { base: base, total: o.self ? o.total : X.payable(base, v ? v.off : 0, o.id), pay: 'pending', method: p.method, proofName: p.proofName });
      if (!o.self) o.voucher = v ? v.code : '';
      save();
      return Promise.resolve(o);
    },

    /* ── 관리자 로그인 (server에서만 의미가 있다) ── */
    login: function (password) {
      return api('POST', '/login', { password: password }).then(function () { admin = true; return pull(); });
    },
    logout: function () {
      return api('POST', '/logout').catch(function () {}).then(function () { admin = false; return pull(); });
    },

    /* ── 관리자 쓰기 (db를 먼저 고치고 서버에 보낸다) ── */
    addOrder: function (o) {
      o.id = o.id || this.newOrderId();
      o.createdAt = o.createdAt || new Date().toISOString();
      o.pay = o.pay || 'unpaid';
      o.base = o.total;
      db.orders.push(o); save();
      push('POST', '/admin/order', { id: o.id, batchId: o.batchId, buyer: o.buyer, item: o.item, qty: o.qty, total: o.total });
      return o;
    },
    updateOrder: function (id, patch) {
      var o = find(db.orders, id);
      // 되돌리는 순간 지워질 접수는 미결제로 바꾸지 않는다(logic.js 의 canUnpay). 화면이 먼저 막고 이유를 알린다; 여기는 마지막 안전판이다.
      if (o && patch && patch.pay === 'unpaid' && o.pay !== 'unpaid' && !X.canUnpay(o)) return o;
      // 반려된 사이 쿠폰 한도가 찬 주문은 되살리지 않는다(logic.js 의 canRevive). 화면이 먼저 막는다; 여기는 마지막 안전판이다.
      if (o && patch && patch.pay && patch.pay !== 'rejected' && !X.canRevive(o, db.orders, db.vouchers)) return o;
      if (o) { Object.assign(o, patch); save(); push('PATCH', '/admin/order/' + encodeURIComponent(id), 'payer' in patch ? { pay: o.pay, payer: o.payer } : { pay: o.pay }); }
      return o;
    },
    removeOrder: function (id) {
      db.orders = db.orders.filter(function (o) { return o.id !== id; }); save();
      push('DELETE', '/admin/order/' + encodeURIComponent(id));
    },
    addBatch: function (b) {
      b.id = b.svc + '-' + b.no;
      if (find(db.batches, b.id)) return null;
      db.batches.push(b); save();
      push('POST', '/admin/batch', b);
      return b;
    },
    updateBatch: function (id, patch) {
      var b = find(db.batches, id);
      if (b) { Object.assign(b, patch); save(); push('PATCH', '/admin/batch/' + encodeURIComponent(id), patch); }
      return b;
    },
    removeBatch: function (id) {
      db.batches = db.batches.filter(function (b) { return b.id !== id; });
      db.orders = db.orders.filter(function (o) { return o.batchId !== id; });
      save(); push('DELETE', '/admin/batch/' + encodeURIComponent(id));
    },
    /* 쿠폰: { code, off, max }. 같은 코드가 있으면 null */
    voucherUses: function (v) { return mode === 'server' ? (v.used || 0) : voucherUsed(v.code); },
    addVoucher: function (v) {
      v = { code: String(v.code || '').trim().toUpperCase(), off: Math.round(Number(v.off)), max: Math.max(0, Math.round(Number(v.max)) || 0), used: 0, note: '' };
      if (voucherOf(v.code)) return null;
      db.vouchers.push(v); save();
      push('POST', '/admin/voucher', { code: v.code, off: v.off, max: v.max });
      return v;
    },
    /* 한 장짜리 쿠폰 여러 장 { off, count, note } → 만든 코드 목록 (Promise). 서버판은 서버가 코드를 뽑는다. */
    addVoucherBatch: function (p) {
      if (mode === 'server') return api('POST', '/admin/voucher/bulk', p).then(function (r) { return pull().catch(function () {}).then(function () { return r.codes; }); });
      var codes = [], n = Math.round(Number(p.count)), off = Math.round(Number(p.off));
      if (!(n >= 1 && n <= GO.LIMITS.voucherBulk) || !(off >= 1)) return Promise.reject(new Error('Check the voucher fields.'));
      while (codes.length < n) {
        var b = new Uint8Array(6); globalThis.crypto.getRandomValues(b);
        var c = X.voucherCodeFrom(b);
        if (!voucherOf(c) && codes.indexOf(c) < 0) codes.push(c);
      }
      codes.forEach(function (c) { db.vouchers.push({ code: c, off: off, max: 1, used: 0, note: String(p.note || '').trim() }); });
      save();
      return Promise.resolve(codes);
    },
    setVoucherNote: function (code, note) {
      var v = voucherOf(code); if (!v) return;
      v.note = note; save();
      push('PATCH', '/admin/voucher/' + encodeURIComponent(code), { note: note });
    },
    removeVoucher: function (code) {
      db.vouchers = db.vouchers.filter(function (v) { return v.code !== code; });
      db.orders.forEach(function (o) { if (o.voucher === code) o.voucher = ''; });   // 같은 코드를 다시 만들면 0부터 센다(서버와 같게)
      save(); push('DELETE', '/admin/voucher/' + encodeURIComponent(code));
    },
    /* 서비스: { id, name: [id, ko], desc: [id, ko], cur } */
    addService: function (s) {
      if (find(db.services, s.id)) return null;
      db.services.push(s); save();
      push('POST', '/admin/service', { id: s.id, nameId: s.name[0], nameKo: s.name[1], descId: s.desc[0], descKo: s.desc[1], cur: s.cur });
      return s;
    },
    updateService: function (id, s) {
      var cur = find(db.services, id); if (!cur) return null;
      Object.assign(cur, { name: s.name, desc: s.desc, cur: s.cur }); save();
      push('PATCH', '/admin/service/' + encodeURIComponent(id), { nameId: s.name[0], nameKo: s.name[1], descId: s.desc[0], descKo: s.desc[1], cur: s.cur });
      return cur;
    },
    // 배치가 남아 있으면 지우지 않고 false
    removeService: function (id) {
      if (db.batches.some(function (b) { return b.svc === id; })) return false;
      db.services = db.services.filter(function (s) { return s.id !== id; }); save();
      push('DELETE', '/admin/service/' + encodeURIComponent(id));
      return true;
    },
    setCalcDefaults: function (c) {
      db.calcDefaults = JSON.parse(JSON.stringify(c)); save();
      push('PUT', '/admin/calc', db.calcDefaults);
    }
  };
})(globalThis.GO);
