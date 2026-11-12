/* 서비스 워커: 웹 푸시 알림을 받아 휴대폰 알림으로 띄우고, 누르면 그 주문 화면을 연다.
 * 화면 파일을 저장해 두는(오프라인) 기능은 넣지 않았다: 배포한 새 화면이 바로 보이도록.
 * 사이트 맨 위(/sw.js)에 있어야 사이트 전체에서 쓸 수 있다. */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = {}; }
  // 알림을 받으면 반드시 하나를 띄운다(브라우저 규칙). 내용이 깨졌으면 가게 이름만 띄운다.
  var url = typeof d.url === 'string' && d.url.charAt(0) === '/' && d.url.charAt(1) !== '/' ? d.url : '/';   // 이 사이트 안의 주소만
  e.waitUntil(self.registration.showNotification(String(d.title || 'Nuhunie').slice(0, 80), {
    body: String(d.body || '').slice(0, 200),
    icon: '/assets/mark-a.png',
    badge: '/assets/mark-a.png',
    tag: typeof d.tag === 'string' ? d.tag : undefined,   // 같은 배치의 알림은 새 것으로 바꿔 끼운다
    data: { url: url }
  }));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      if (new URL(list[i].url).origin === self.location.origin && 'focus' in list[i]) return list[i].navigate(url).then(function (c) { return (c || list[i]).focus(); }).catch(function () { return self.clients.openWindow(url); });
    }
    return self.clients.openWindow(url);
  }));
});
