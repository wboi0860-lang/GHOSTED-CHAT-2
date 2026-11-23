/* Ghosted OneSignal Service Worker (Web & Android PWA Push Notifications) */
importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js');

self.addEventListener('notificationclick', function (event) {
  try {
    const data = (event.notification && event.notification.data) || {};
    const custom = (data.custom && data.custom.a) || data;
    const pushType = custom.type || data.type || '';
    const targetUrl =
      custom.url ||
      data.url ||
      (pushType
        ? '/?push_type=' +
          encodeURIComponent(pushType) +
          (custom.call_id ? '&call_id=' + encodeURIComponent(custom.call_id) : '') +
          (custom.caller_ghost ? '&caller=' + encodeURIComponent(custom.caller_ghost) : '') +
          (custom.peer_ghost ? '&peer=' + encodeURIComponent(custom.peer_ghost) : '') +
          (custom.request_id ? '&request_id=' + encodeURIComponent(custom.request_id) : '') +
          (custom.status_id ? '&status_id=' + encodeURIComponent(custom.status_id) : '')
        : '/');

    event.waitUntil(
      self.clients
        .matchAll({ type: 'window', includeUncontrolled: true })
        .then(function (clientList) {
          for (let i = 0; i < clientList.length; i++) {
            const client = clientList[i];
            if ('focus' in client) {
              client.postMessage({
                type: 'GHOSTED_ONESIGNAL_CLICK',
                data: custom,
                url: targetUrl,
              });
              return client.focus();
            }
          }
          if (self.clients.openWindow) {
            return self.clients.openWindow(targetUrl);
          }
        })
    );
  } catch (e) {
    // Allow OneSignal default click handler to proceed
  }
});
