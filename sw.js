const CACHE='salla-offline-v1';
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.add('/offline.html')).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('salla-offline-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{if(e.request.mode==='navigate'&&e.request.method==='GET')e.respondWith(fetch(e.request).catch(()=>caches.match('/offline.html')))});
