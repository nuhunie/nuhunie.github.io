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
  function loadLocal() {
    try { db = JSON.parse(localStorage.getItem(KEY)); } catch (e) { db = null; }
    if (!db || !db.services) { db = GO.seed(); save(); }
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
    /* 서버 내용을 다시 읽는다. 바뀐 것이 있으면 true */
    refresh: function () {
      if (mode !== 'server') return Promise.resolve(false);
      if (Date.now() - lastPull < 15000) return Promise.resolve(false);   // 화면을 옮길 때마다 서버를 부르지 않는다
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
    order: function (id) { return find(db.orders, String(id || '').toUpperCase()); },
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
      var id, i, bytes;
      do {
        bytes = new Uint8Array(8); globalThis.crypto.getRandomValues(bytes);
        id = GO.BRAND.orderPrefix + '-';
        for (i = 0; i < 8; i++) id += X.ORDER_CHARS.charAt(bytes[i] & 31);
      } while (find(db.orders, id));
      return id;
    },

    /* ── 고객 흐름 (Promise) ── */
    track: function (q) {
      if (mode === 'local') return Promise.resolve(X.searchOrders(db.orders, q));
      return api('GET', '/track?q=' + encodeURIComponent(q)).then(function (r) { return r.orders; });
    },
    fetchOrder: function (id) {
      if (mode === 'local') { var o = this.order(String(id || '').trim()); return Promise.resolve(o ? Object.assign({}, o, { buyer: X.maskName(o.buyer), proofName: '' }) : null); }
      return api('GET', '/order?id=' + encodeURIComponent(String(id || '').trim())).then(function (r) { return r.order; }, function () { return null; });
    },
    checkVoucher: function (code) {
      code = String(code || '').trim().toUpperCase();
      if (mode === 'local') return Promise.resolve(db.vouchers.filter(function (v) { return v.code === code; })[0] || null);
      return api('POST', '/voucher', { code: code }).then(function (v) { return v; }, function () { return null; });
    },
    /* 이 결제 금액을 확인 대기 중인 다른 주문이 쓰고 있지 않은지 (Promise<boolean>). 확인하지 못하면 true */
    amountFree: function (total) {
      if (mode === 'local') return Promise.resolve(!db.orders.some(function (o) { return o.pay === 'pending' && o.total === total; }));
      return api('POST', '/amount-check', { total: total }).then(function (r) { return r.free !== false; }, function () { return true; });
    },
    /* p = { orderId | id, batchId, buyer, item, qty, base, voucher, method, proofName }  →  저장된 주문 */
    submitPayment: function (p) {
      if (mode === 'server') return api('POST', '/pay', p).then(function (r) { return pull().catch(function () {}).then(function () { return r.order; }); });
      var v = db.vouchers.filter(function (x) { return x.code === String(p.voucher || '').trim().toUpperCase(); })[0];
      var o = p.orderId ? this.order(p.orderId) : null;
      var base = o ? (o.base || o.total) : Math.round(Number(p.base));
      var id = o ? o.id : p.id;
      var patch = { base: base, total: base - Math.min(v ? v.off : 0, base) + X.uniqueCode(id), pay: 'pending', method: p.method, proofName: p.proofName };
      if (o) Object.assign(o, patch);
      else { var pb = find(db.batches, p.batchId); o = Object.assign({ id: id, self: 1, late: pb && pb.stage >= 1 ? pb.stage : 0, batchId: p.batchId, buyer: String(p.buyer).trim().replace(/^@/, ''), item: String(p.item).trim(), qty: Math.max(1, Number(p.qty) || 1), createdAt: new Date().toISOString() }, patch); db.orders.push(o); }
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
      if (o) { Object.assign(o, patch); save(); push('PATCH', '/admin/order/' + encodeURIComponent(id), { pay: o.pay }); }
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
    setCalcDefaults: function (c) {
      db.calcDefaults = JSON.parse(JSON.stringify(c)); save();
      push('PUT', '/admin/calc', db.calcDefaults);
    }
  };
})(globalThis.GO);
