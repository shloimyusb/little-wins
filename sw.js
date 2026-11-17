/* Versioned public shell only. Supabase Auth/API traffic is never cached. */
const CACHE='little-wins-supabase-b4f8ff4f09ed';
const BASE=new URL('./',self.registration.scope);
const FILES=['./','config.js','client.js','tablet.js','pwa.js','recovery.js','parents.js','ios.css','manifest.webmanifest',...['32','180','192','512'].map(size=>'icons/icon-'+size+'.png'),...['classic','gentle','bell','cheerful','beep','sparkle','victory','doorbell','robot','arcade','soft','triple'].map(name=>'sounds/'+name+'.wav')];
const urls=FILES.map(path=>new URL(path,BASE).href),paths=new Set(urls.map(url=>new URL(url).pathname));
self.addEventListener('install',event=>event.waitUntil((async()=>{const cache=await caches.open(CACHE);await cache.addAll(urls);for(const client of await self.clients.matchAll({includeUncontrolled:true}))client.postMessage({type:'UPDATE_CACHED'});})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('little-wins-supabase-')&&key!==CACHE)await caches.delete(key);await self.clients.claim();for(const client of await self.clients.matchAll())client.postMessage({type:'OFFLINE_READY'});})()));
self.addEventListener('message',event=>{if(event.data?.type==='SKIP_WAITING')self.skipWaiting()});
self.addEventListener('fetch',event=>{const request=event.request,url=new URL(request.url);if(request.method!=='GET'||url.origin!==BASE.origin)return;
 if(request.mode==='navigate'&&(url.pathname===BASE.pathname||url.pathname===new URL('index.html',BASE).pathname)){event.respondWith((async()=>{const cache=await caches.open(CACHE),saved=await cache.match(BASE.href);if(saved)return saved;try{return await fetch(request)}catch{return new Response('Connect once to prepare Little Wins for offline access.',{status:503,headers:{'Content-Type':'text/plain'}})}})());return;}
 if(paths.has(url.pathname))event.respondWith((async()=>{const cache=await caches.open(CACHE),saved=await cache.match(url.href);return saved||fetch(request);})());
});
