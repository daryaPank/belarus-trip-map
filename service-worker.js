const STATIC_CACHE="trip-static-v5";
const DATA_CACHE="trip-data-v5";
const OFFLINE_CACHE="trip-offline-v5";

const APP=[
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./config.js",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install",event=>{
  event.waitUntil(caches.open(STATIC_CACHE).then(cache=>cache.addAll(APP)));
  self.skipWaiting();
});

self.addEventListener("activate",event=>{
  event.waitUntil((async()=>{
    const keep=new Set([STATIC_CACHE,DATA_CACHE,OFFLINE_CACHE]);
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>k.startsWith("trip-")&&!keep.has(k)).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});

function parseRange(header,total){
  const m=/bytes=(\d+)-(\d*)/.exec(header||"");
  if(!m) return null;
  const start=Number(m[1]);
  const end=m[2]?Number(m[2]):total-1;
  if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<start||start>=total) return null;
  return{start,end:Math.min(end,total-1)};
}

async function servePmtilesRange(request){
  const offline=await caches.open(OFFLINE_CACHE);
  const full=await offline.match(request.url);
  if(full){
    const buffer=await full.arrayBuffer();
    const range=parseRange(request.headers.get("Range"),buffer.byteLength);
    if(!range) return new Response(buffer,{status:200,headers:{"Content-Length":String(buffer.byteLength),"Accept-Ranges":"bytes"}});
    const slice=buffer.slice(range.start,range.end+1);
    return new Response(slice,{
      status:206,
      headers:{
        "Content-Type":"application/octet-stream",
        "Content-Length":String(slice.byteLength),
        "Content-Range":`bytes ${range.start}-${range.end}/${buffer.byteLength}`,
        "Accept-Ranges":"bytes"
      }
    });
  }
  return fetch(request);
}

self.addEventListener("fetch",event=>{
  const request=event.request;
  if(request.method!=="GET") return;
  const url=new URL(request.url);

  if(url.pathname.endsWith(".pmtiles")&&request.headers.has("Range")){
    event.respondWith(servePmtilesRange(request));
    return;
  }

  if(url.hostname.endsWith(".supabase.co")&&url.pathname.includes("/rest/v1/places")){
    event.respondWith((async()=>{
      const cache=await caches.open(DATA_CACHE);
      try{
        const fresh=await fetch(request);
        if(fresh.ok) await cache.put(request,fresh.clone());
        return fresh;
      }catch(_){
        const cached=await cache.match(request);
        if(cached) return cached;
        throw _;
      }
    })());
    return;
  }

  event.respondWith((async()=>{
    const cached=await caches.match(request);
    if(cached) return cached;
    try{
      const fresh=await fetch(request);
      if(url.origin===self.location.origin&&fresh.ok){
        const cache=await caches.open(STATIC_CACHE);
        cache.put(request,fresh.clone());
      }
      return fresh;
    }catch(err){
      const fallback=await caches.match("./index.html");
      if(request.mode==="navigate"&&fallback) return fallback;
      throw err;
    }
  })());
});
