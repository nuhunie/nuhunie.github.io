/* 3층: 저장소 — 데이터를 읽고 쓰는 유일한 통로.
 * 목업에서는 브라우저 localStorage에 둔다. 실제 서비스에서는 이 파일의
 * 함수 안쪽만 서버 API 호출로 바꾸면 화면 코드는 그대로다. */
(function (GO) {
  var KEY = 'jastip-mockup-v3';
  var db;

  function load() {
    try { db = JSON.parse(localStorage.getItem(KEY)); } catch (e) { db = null; }
    if (!db || !db.services) { db = GO.seed(); save(); }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* 저장 불가 환경에서는 메모리로만 동작 */ }
  }
  function find(list, id) { return list.filter(function (x) { return x.id === id; })[0]; }

  GO.store = {
    get db() { return db; },
    reset: function () { db = GO.seed(); save(); },

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

    newOrderId: function () {
      var id;
      do { id = GO.BRAND.orderPrefix + '-' + Math.floor(100000 + Math.random() * 900000); } while (find(db.orders, id));
      return id;
    },
    addOrder: function (o) {
      o.id = o.id || this.newOrderId();
      o.createdAt = o.createdAt || new Date().toISOString();
      o.pay = o.pay || 'unpaid';
      db.orders.push(o); save(); return o;
    },
    updateOrder: function (id, patch) { var o = find(db.orders, id); if (o) { Object.assign(o, patch); save(); } return o; },
    removeOrder: function (id) { db.orders = db.orders.filter(function (o) { return o.id !== id; }); save(); },

    addBatch: function (b) {
      b.id = b.svc + '-' + b.no;
      if (find(db.batches, b.id)) return null;
      db.batches.push(b); save(); return b;
    },
    updateBatch: function (id, patch) { var b = find(db.batches, id); if (b) { Object.assign(b, patch); save(); } return b; },
    removeBatch: function (id) {
      db.batches = db.batches.filter(function (b) { return b.id !== id; });
      db.orders = db.orders.filter(function (o) { return o.batchId !== id; });
      save();
    },

    voucher: function (code) {
      code = String(code || '').trim().toUpperCase();
      return db.vouchers.filter(function (v) { return v.code === code; })[0];
    },
    setCalcDefaults: function (c) { db.calcDefaults = JSON.parse(JSON.stringify(c)); save(); }
  };

  load();
})(window.GO);
