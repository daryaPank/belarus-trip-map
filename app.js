(() => {
  const cfg=window.TRIP_MAP_CONFIG||{};
  const editor=new URLSearchParams(location.search).get("edit")==="1";
  if(editor){
    document.body.classList.add("editor");
    document.getElementById("modeLabel").textContent="редактор";
  }

  const cities={
    minsk:{name:"Минск",lat:53.9006,lon:27.5590,zoom:12.4},
    brest:{name:"Брест",lat:52.0976,lon:23.7341,zoom:13},
    grodno:{name:"Гродно",lat:53.6830,lon:23.8200,zoom:12.5}
  };
  const categoryLabels={
    history:"история / архитектура",
    beautiful:"красивая локация",
    park:"парк",
    food:"еда",
    coffee:"кофейня",
    souvenir:"сувениры"
  };
  const dayNames={1:"Пн",2:"Вт",3:"Ср",4:"Чт",5:"Пт",6:"Сб",7:"Вс"};
  const cityFiles={minsk:"minsk.pmtiles",brest:"brest.pmtiles",grodno:"grodno.pmtiles"};

  let places=[];
  let currentCity="grodno";
  let activeFilter="all";
  let selected=null;
  let editId=null;
  let scheduleDraft=[];
  let markers=[];
  let map=null;

  const mapEl=document.getElementById("map");
  const sheet=document.getElementById("sheet");
  const empty=document.getElementById("empty");
  const tabs=[...document.querySelectorAll(".tab")];
  const filters=[...document.querySelectorAll(".filter")];
  const modal=document.getElementById("modal");
  const form=document.getElementById("placeForm");
  const cat=document.getElementById("category");
  const veganRow=document.getElementById("veganRow");
  const status=document.getElementById("formStatus");
  const dayButtons=[...document.querySelectorAll("#dayPicker button")];

  const apiReady=()=>cfg.supabaseUrl&&cfg.supabaseKey;
  const apiHeaders=()=>({
    "apikey":cfg.supabaseKey,
    "Authorization":`Bearer ${cfg.supabaseKey}`,
    "Content-Type":"application/json"
  });

  function makeStyle(city){
    const pmtilesUrl=new URL(`./maps/${cityFiles[city]}`,location.href).href;
    return {
      version:8,
      glyphs:"https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf",
      sources:{
        pm:{
          type:"vector",
          url:`pmtiles://${pmtilesUrl}`,
          attribution:'© OpenStreetMap contributors · Protomaps'
        }
      },
      layers:[
        {id:"background",type:"background",paint:{"background-color":"#f4f2ea"}},
        {id:"water",type:"fill",source:"pm","source-layer":"water",filter:["==",["geometry-type"],"Polygon"],paint:{"fill-color":"#cfe3ee"}},
        {id:"forest",type:"fill",source:"pm","source-layer":"landuse",filter:["in",["get","kind"],["literal",["forest","wood","park","nature_reserve","grass","garden"]]],paint:{"fill-color":"#dfead7","fill-opacity":0.82}},
        {id:"residential",type:"fill",source:"pm","source-layer":"landuse",filter:["==",["get","kind"],"residential"],paint:{"fill-color":"#eceae4"}},
        {id:"buildings",type:"fill",source:"pm","source-layer":"buildings",minzoom:13,filter:["!=",["get","kind"],"address"],paint:{"fill-color":"#dedbd4","fill-outline-color":"#d0cdc5"}},
        {id:"roads-other",type:"line",source:"pm","source-layer":"roads",filter:["in",["get","kind_detail"],["literal",["service","unclassified","road","pedestrian","track","path","cycleway","steps"]]],paint:{"line-color":"#ffffff","line-width":["interpolate",["linear"],["zoom"],11,0.5,15,2.2]}},
        {id:"roads-main-casing",type:"line",source:"pm","source-layer":"roads",filter:["in",["get","kind_detail"],["literal",["motorway","trunk","primary","secondary","tertiary","residential"]]],paint:{"line-color":"#d3d0c9","line-width":["interpolate",["linear"],["zoom"],9,1.2,15,6]}},
        {id:"roads-main",type:"line",source:"pm","source-layer":"roads",filter:["in",["get","kind_detail"],["literal",["motorway","trunk","primary","secondary","tertiary","residential"]]],paint:{"line-color":"#fffdf8","line-width":["interpolate",["linear"],["zoom"],9,0.8,15,4.2]}},
        {id:"road-labels",type:"symbol",source:"pm","source-layer":"roads",minzoom:13,filter:["has","name"],layout:{
          "symbol-placement":"line","text-field":["get","name"],"text-font":["Noto Sans Regular"],
          "text-size":["interpolate",["linear"],["zoom"],13,10,16,13],"text-max-angle":35
        },paint:{"text-color":"#6c6963","text-halo-color":"#fffdf8","text-halo-width":1.2}},
        {id:"place-labels",type:"symbol",source:"pm","source-layer":"places",filter:["has","name"],layout:{
          "text-field":["get","name"],"text-font":["Noto Sans Regular"],
          "text-size":["interpolate",["linear"],["zoom"],8,11,14,15]
        },paint:{"text-color":"#3d3b38","text-halo-color":"#f4f2ea","text-halo-width":1.4}}
      ]
    };
  }

  function initMap(){
    if(!window.maplibregl||!window.pmtiles){
      empty.style.display="block";
      empty.textContent="Не удалось загрузить модуль карты. Проверь интернет и обнови страницу.";
      return;
    }
    const protocol=new pmtiles.Protocol({metadata:true});
    maplibregl.addProtocol("pmtiles",protocol.tile);

    const c=cities[currentCity];
    map=new maplibregl.Map({
      container:"map",
      style:makeStyle(currentCity),
      center:[c.lon,c.lat],
      zoom:c.zoom,
      attributionControl:false,
      dragRotate:false,
      pitchWithRotate:false
    });
    map.touchZoomRotate.disableRotation();
    map.on("load",()=>renderMarkers());
    map.on("error",e=>{
      const msg=String(e?.error?.message||"");
      if(msg.includes("pmtiles")||msg.includes("404")||msg.includes("Failed")){
        empty.style.display="block";
        empty.textContent="Карта города ещё не загружена. Если это первая установка v5 — сначала собери offline map packs в GitHub Actions.";
      }
    });
  }

  function markerIcon(category){
    if(category==="coffee") return "☕";
    if(category==="food") return "🍴";
    if(category==="park") return "🌿";
    if(category==="beautiful") return "◉";
    if(category==="souvenir") return "🎁";
    return "◆";
  }

  function visiblePlaces(){
    return places.filter(p=>p.city===currentCity&&(activeFilter==="all"||p.category===activeFilter));
  }

  function clearMarkers(){
    markers.forEach(m=>m.remove());
    markers=[];
  }

  function renderMarkers(){
    if(!map) return;
    clearMarkers();
    const cityPlaces=places.filter(p=>p.city===currentCity);
    empty.style.display=cityPlaces.length?"none":"block";
    if(!cityPlaces.length) empty.textContent="Для этого города точек пока нет.";

    visiblePlaces().forEach(p=>{
      const lat=Number(p.lat),lon=Number(p.lon);
      if(!Number.isFinite(lat)||!Number.isFinite(lon)) return;
      const el=document.createElement("button");
      el.type="button";
      el.className="trip-marker"+(String(p.id)===String(selected)?" selected":"");
      el.setAttribute("aria-label",p.name);
      el.innerHTML=`<span>${markerIcon(p.category)}</span>`;
      el.addEventListener("click",()=>openPlace(p.id));
      const marker=new maplibregl.Marker({element:el,anchor:"bottom"})
        .setLngLat([lon,lat]).addTo(map);
      markers.push(marker);
    });
  }

  function selectCity(key){
    currentCity=key;
    selected=null;
    sheet.classList.remove("open");
    tabs.forEach(t=>t.setAttribute("aria-selected",t.dataset.city===key?"true":"false"));
    if(map){
      const c=cities[key];
      map.setStyle(makeStyle(key));
      map.jumpTo({center:[c.lon,c.lat],zoom:c.zoom});
      map.once("styledata",()=>renderMarkers());
    }
  }

  tabs.forEach(t=>t.addEventListener("click",()=>selectCity(t.dataset.city)));
  filters.forEach(f=>f.addEventListener("click",()=>{
    activeFilter=f.dataset.filter;
    filters.forEach(x=>x.classList.toggle("active",x===f));
    closePlace();
    renderMarkers();
  }));

  document.getElementById("zoomIn").addEventListener("click",()=>map&&map.zoomIn());
  document.getElementById("zoomOut").addEventListener("click",()=>map&&map.zoomOut());

  async function loadPlaces(){
    if(!apiReady()){
      renderMarkers();
      return;
    }
    try{
      const r=await fetch(`${cfg.supabaseUrl}/rest/v1/places?select=*&order=created_at.asc`,{headers:apiHeaders()});
      if(!r.ok) throw new Error(await r.text());
      places=await r.json();
      await storePlacesLocally(places);
      renderMarkers();
    }catch(e){
      const cached=await readPlacesLocally();
      if(cached.length){
        places=cached;
        renderMarkers();
      }else{
        console.error("Supabase load failed",e);
      }
    }
  }

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
  }

  function parseSchedule(value){
    if(Array.isArray(value)) return value;
    if(typeof value==="string"){
      try{
        const v=JSON.parse(value);
        return Array.isArray(v)?v:[];
      }catch(_){return []}
    }
    return [];
  }

  function groupSchedule(schedule){
    const byDay=new Map(parseSchedule(schedule).map(x=>[Number(x.day),x]));
    const groups=[];
    let current=null;
    for(let d=1;d<=7;d++){
      const x=byDay.get(d);
      if(!x) continue;
      const key=x.closed?"closed":`${x.open||""}-${x.close||""}`;
      if(current&&current.key===key&&current.end===d-1){
        current.end=d;
      }else{
        current={start:d,end:d,key,item:x};
        groups.push(current);
      }
    }
    return groups;
  }

  function formatSchedule(schedule){
    const groups=groupSchedule(schedule);
    if(!groups.length) return "";
    return groups.map(g=>{
      const days=g.start===g.end?dayNames[g.start]:`${dayNames[g.start]}–${dayNames[g.end]}`;
      return g.item.closed?`${days} закрыто`:`${days} ${g.item.open}–${g.item.close}`;
    }).join(" · ");
  }

  function openPlace(id){
    selected=id;
    const p=places.find(x=>String(x.id)===String(id));
    if(!p) return;

    document.getElementById("placeTitle").textContent=p.name;
    const tags=[`<span class="tag">${categoryLabels[p.category]||p.category}</span>`];
    if(p.vegan&&(p.category==="food"||p.category==="coffee")){
      tags.push(`<span class="tag vegan">🌿 vegan-friendly</span>`);
    }
    document.getElementById("placeTags").innerHTML=tags.join("");
    document.getElementById("placeText").textContent=p.note||"";
    document.getElementById("placeAddress").textContent=p.address||"";

    const hours=document.getElementById("placeHours");
    const formatted=formatSchedule(p.opening_schedule);
    const legacy=!formatted&&p.opening_hours?String(p.opening_hours):"";
    if(formatted||legacy){
      hours.textContent=`🕒 ${formatted||legacy}`;
      hours.hidden=false;
    }else{
      hours.textContent="";
      hours.hidden=true;
    }

    const source=document.getElementById("placeSource");
    source.innerHTML=p.source_url?`<a href="${escapeHtml(p.source_url)}" target="_blank" rel="noopener">Источник</a>`:"";
    sheet.classList.add("open");
    renderMarkers();
  }

  function closePlace(){
    selected=null;
    sheet.classList.remove("open");
    renderMarkers();
  }
  document.getElementById("closeSheet").addEventListener("click",closePlace);

  function updateVegan(){
    veganRow.classList.toggle("show",cat.value==="food"||cat.value==="coffee");
    if(!veganRow.classList.contains("show")) document.getElementById("vegan").checked=false;
  }
  cat.addEventListener("change",updateVegan);

  function normalizeName(s){
    return String(s||"").toLowerCase().replace(/ё/g,"е").replace(/[«»"'`]/g,"").replace(/\s+/g," ").trim();
  }
  function normalizeUrl(s){
    try{
      const u=new URL(String(s||""));
      u.hash="";
      u.search="";
      return u.href.replace(/\/$/,"");
    }catch(_){return ""}
  }

  function findDuplicate({name,city,sourceUrl},excludeId=null){
    const nn=normalizeName(name);
    const su=normalizeUrl(sourceUrl);
    return places.find(p=>{
      if(String(p.id)===String(excludeId)) return false;
      if(p.city!==city) return false;
      if(nn&&normalizeName(p.name)===nn) return true;
      if(su&&normalizeUrl(p.source_url)===su) return true;
      return false;
    })||null;
  }

  async function lookupNominatim(name,address,city){
    const cityName=cities[city].name;
    const candidates=[
      `${name}, ${address}, ${cityName}, Беларусь`,
      `${address}, ${cityName}, Беларусь`,
      `${name}, ${cityName}, Беларусь`,
      `улица ${address}, ${cityName}, Беларусь`
    ].filter((q,i,a)=>q&&a.indexOf(q)===i);

    let networkFailed=false;
    for(const q of candidates){
      try{
        const u=`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=by&extratags=1&q=${encodeURIComponent(q)}`;
        const r=await fetch(u,{headers:{"Accept-Language":"ru"}});
        if(!r.ok) continue;
        const d=await r.json();
        if(Array.isArray(d)&&d.length){
          const lat=Number(d[0].lat),lon=Number(d[0].lon);
          if(Number.isFinite(lat)&&Number.isFinite(lon)){
            return{
              lat,lon,
              osmHours:d[0]?.extratags?.opening_hours||""
            };
          }
        }
      }catch(_){
        networkFailed=true;
        break;
      }
    }
    if(networkFailed) return null;
    return null;
  }

  async function lookupPhoton(name,address,city){
    const q=[name,address,cities[city].name,"Беларусь"].filter(Boolean).join(", ");
    try{
      const u=`https://photon.komoot.io/api/?limit=1&q=${encodeURIComponent(q)}`;
      const r=await fetch(u,{headers:{"Accept-Language":"ru"}});
      if(!r.ok) return null;
      const d=await r.json();
      const coords=d?.features?.[0]?.geometry?.coordinates;
      if(Array.isArray(coords)&&coords.length>=2){
        const lon=Number(coords[0]),lat=Number(coords[1]);
        if(Number.isFinite(lat)&&Number.isFinite(lon)) return{lat,lon,osmHours:""};
      }
    }catch(_){}
    return null;
  }

  async function geocode(name,address,city){
    const a=await lookupNominatim(name,address,city);
    if(a) return a;
    const b=await lookupPhoton(name,address,city);
    if(b) return b;
    throw new Error("Не удалось найти адрес. Попробуй формат «улица + дом» или повтори позже.");
  }

  const osmDays={Mo:1,Tu:2,We:3,Th:4,Fr:5,Sa:6,Su:7};
  function expandDayToken(token){
    token=token.trim();
    if(token.includes("-")){
      const [a,b]=token.split("-");
      if(!osmDays[a]||!osmDays[b]) return null;
      const out=[];
      let d=osmDays[a];
      while(true){
        out.push(d);
        if(d===osmDays[b]) break;
        d=d===7?1:d+1;
        if(out.length>7) return null;
      }
      return out;
    }
    return osmDays[token]?[osmDays[token]]:null;
  }

  function parseOsmHours(raw){
    raw=String(raw||"").trim();
    if(!raw) return [];
    if(raw==="24/7"){
      return Array.from({length:7},(_,i)=>({day:i+1,open:"00:00",close:"24:00",closed:false}));
    }
    const result=new Map();
    const parts=raw.split(";").map(x=>x.trim()).filter(Boolean);

    for(const part of parts){
      const m=part.match(/^([A-Za-z,-]+)\s+(off|closed|(\d{2}:\d{2})-(\d{2}:\d{2}))$/i);
      if(!m) return [];
      const daySpec=m[1];
      const days=[];
      for(const t of daySpec.split(",")){
        const expanded=expandDayToken(t);
        if(!expanded) return [];
        days.push(...expanded);
      }
      const closed=/^(off|closed)$/i.test(m[2]);
      for(const day of days){
        result.set(day,closed
          ?{day,open:"",close:"",closed:true}
          :{day,open:m[3],close:m[4],closed:false});
      }
    }
    return [...result.values()].sort((a,b)=>a.day-b.day);
  }

  function autoNote(city,category,vegan){
    const labels={
      history:"Историко-архитектурная точка",
      beautiful:"Красивая локация",
      park:"Парк или зелёная зона",
      food:"Место для еды",
      coffee:"Кофейня",
      souvenir:"Место с сувенирами"
    };
    let text=`${labels[category]||"Интересная точка"} в ${cities[city].name}.`;
    if(vegan&&(category==="food"||category==="coffee")) text+=" 🌿 Отмечено как vegan-friendly.";
    return text;
  }

  function resetSchedule(){
    scheduleDraft=[];
    dayButtons.forEach(b=>b.classList.remove("active"));
    document.getElementById("closedDay").checked=false;
    document.getElementById("openTime").disabled=false;
    document.getElementById("closeTime").disabled=false;
    renderSchedulePreview();
  }

  function renderSchedulePreview(){
    const el=document.getElementById("schedulePreview");
    el.textContent=formatSchedule(scheduleDraft)||"График не задан";
  }

  dayButtons.forEach(b=>b.addEventListener("click",()=>b.classList.toggle("active")));
  document.getElementById("closedDay").addEventListener("change",e=>{
    document.getElementById("openTime").disabled=e.target.checked;
    document.getElementById("closeTime").disabled=e.target.checked;
  });
  document.getElementById("applyHoursBtn").addEventListener("click",()=>{
    const days=dayButtons.filter(b=>b.classList.contains("active")).map(b=>Number(b.dataset.day));
    if(!days.length){
      status.className="form-status error";
      status.textContent="Сначала выбери хотя бы один день.";
      return;
    }
    const closed=document.getElementById("closedDay").checked;
    const open=document.getElementById("openTime").value;
    const close=document.getElementById("closeTime").value;
    if(!closed&&(!open||!close)){
      status.className="form-status error";
      status.textContent="Выбери время открытия и закрытия.";
      return;
    }
    const mapByDay=new Map(scheduleDraft.map(x=>[Number(x.day),x]));
    days.forEach(day=>mapByDay.set(day,{day,open:closed?"":open,close:closed?"":close,closed}));
    scheduleDraft=[...mapByDay.values()].sort((a,b)=>a.day-b.day);
    dayButtons.forEach(b=>b.classList.remove("active"));
    status.textContent="";
    renderSchedulePreview();
  });
  document.getElementById("clearScheduleBtn").addEventListener("click",resetSchedule);

  function openAddForm(){
    editId=null;
    form.reset();
    document.getElementById("formTitle").textContent="Добавить точку";
    document.getElementById("city").value=currentCity;
    resetSchedule();
    updateVegan();
    status.className="form-status";
    status.textContent="";
    modal.classList.add("open");
  }

  function openEditForm(){
    const p=places.find(x=>String(x.id)===String(selected));
    if(!p) return;
    editId=p.id;
    form.reset();
    document.getElementById("formTitle").textContent="Редактировать точку";
    document.getElementById("name").value=p.name||"";
    document.getElementById("city").value=p.city||currentCity;
    document.getElementById("category").value=p.category||"beautiful";
    document.getElementById("address").value=p.address||"";
    document.getElementById("source").value=p.source_url||"";
    document.getElementById("note").value=p.note||"";
    document.getElementById("vegan").checked=Boolean(p.vegan);
    scheduleDraft=parseSchedule(p.opening_schedule).map(x=>({...x,day:Number(x.day)}));
    renderSchedulePreview();
    updateVegan();
    status.className="form-status";
    status.textContent="";
    modal.classList.add("open");
  }

  document.getElementById("addBtn").addEventListener("click",openAddForm);
  document.getElementById("editBtn").addEventListener("click",openEditForm);
  document.getElementById("cancelBtn").addEventListener("click",()=>modal.classList.remove("open"));

  form.addEventListener("submit",async e=>{
    e.preventDefault();
    status.className="form-status";

    const fd=new FormData(form);
    const category=String(fd.get("category"));
    const city=String(fd.get("city"));
    const name=String(fd.get("name")||"").trim();
    const address=String(fd.get("address")||"").trim();
    const sourceUrl=String(fd.get("source")||"").trim()||null;
    const manualNote=String(fd.get("note")||"").trim();
    const vegan=(category==="food"||category==="coffee")&&fd.get("vegan")==="on";

    const duplicate=findDuplicate({name,city,sourceUrl},editId);
    if(duplicate){
      status.className="form-status error";
      status.textContent=`Такая точка уже есть: ${duplicate.name}. Открой её на карте и используй «Редактировать».`;
      return;
    }

    try{
      status.textContent="Проверяю адрес…";
      const geo=await geocode(name,address,city);

      let finalSchedule=scheduleDraft;
      let hoursSource=finalSchedule.length?"manual":null;
      if(!finalSchedule.length&&geo.osmHours){
        const parsed=parseOsmHours(geo.osmHours);
        if(parsed.length){
          finalSchedule=parsed;
          hoursSource="osm";
        }
      }

      const row={
        name,city,category,address,
        lat:geo.lat,lon:geo.lon,
        source_url:sourceUrl,
        note:manualNote||autoNote(city,category,vegan),
        vegan,
        opening_schedule:finalSchedule,
        opening_hours_source:hoursSource
      };

      if(!apiReady()) throw new Error("Supabase не подключён.");
      status.textContent="Сохраняю…";

      let r;
      if(editId){
        r=await fetch(`${cfg.supabaseUrl}/rest/v1/places?id=eq.${encodeURIComponent(editId)}`,{
          method:"PATCH",
          headers:{...apiHeaders(),"Prefer":"return=representation"},
          body:JSON.stringify(row)
        });
      }else{
        r=await fetch(`${cfg.supabaseUrl}/rest/v1/places`,{
          method:"POST",
          headers:{...apiHeaders(),"Prefer":"return=representation"},
          body:JSON.stringify(row)
        });
      }
      if(!r.ok) throw new Error(await r.text());
      const saved=await r.json();
      const item=saved[0];

      if(editId){
        const i=places.findIndex(p=>String(p.id)===String(editId));
        if(i>=0) places[i]=item;
      }else{
        places.push(item);
      }
      await storePlacesLocally(places);
      modal.classList.remove("open");
      selectCity(row.city);
      if(editId) openPlace(item.id);
    }catch(err){
      status.className="form-status error";
      status.textContent=err?.message||"Не удалось сохранить точку.";
    }
  });

  async function backfillHours(){
    if(!editor||!apiReady()) return;
    const btn=document.getElementById("hoursRefreshBtn");
    btn.disabled=true;
    const targets=places.filter(p=>{
      const hasStructured=parseSchedule(p.opening_schedule).length>0;
      return !hasStructured&&(p.category==="food"||p.category==="coffee"||p.category==="souvenir");
    });

    if(!targets.length){
      alert("У всех подходящих точек график уже заполнен или точек для проверки нет.");
      btn.disabled=false;
      return;
    }

    let updated=0;
    for(let i=0;i<targets.length;i++){
      btn.textContent=`↻ ${i+1}/${targets.length}`;
      const p=targets[i];
      try{
        const hit=await lookupNominatim(p.name,p.address,p.city);
        const parsed=parseOsmHours(hit?.osmHours||"");
        if(parsed.length){
          const r=await fetch(`${cfg.supabaseUrl}/rest/v1/places?id=eq.${encodeURIComponent(p.id)}`,{
            method:"PATCH",
            headers:{...apiHeaders(),"Prefer":"return=representation"},
            body:JSON.stringify({opening_schedule:parsed,opening_hours_source:"osm"})
          });
          if(r.ok){
            const saved=await r.json();
            const idx=places.findIndex(x=>String(x.id)===String(p.id));
            if(idx>=0) places[idx]=saved[0];
            updated++;
          }
        }
      }catch(_){}
      await new Promise(resolve=>setTimeout(resolve,1200));
    }
    await storePlacesLocally(places);
    btn.textContent="↻ Часы";
    btn.disabled=false;
    renderMarkers();
    alert(`Готово. Обновлено графиков: ${updated}. Остальные оставлены без изменений.`);
  }
  document.getElementById("hoursRefreshBtn").addEventListener("click",backfillHours);

  async function storePlacesLocally(data){
    try{
      localStorage.setItem("trip_places_cache_v5",JSON.stringify(data));
      localStorage.setItem("trip_places_cache_time",String(Date.now()));
    }catch(_){}
  }
  async function readPlacesLocally(){
    try{
      const raw=localStorage.getItem("trip_places_cache_v5");
      const data=raw?JSON.parse(raw):[];
      return Array.isArray(data)?data:[];
    }catch(_){return []}
  }

  const offlineModal=document.getElementById("offlineModal");
  document.getElementById("offlineBtn").addEventListener("click",()=>offlineModal.classList.add("open"));
  document.getElementById("offlineCancelBtn").addEventListener("click",()=>offlineModal.classList.remove("open"));

  const externalAssets=[
    "https://unpkg.com/maplibre-gl@5.13.0/dist/maplibre-gl.css",
    "https://unpkg.com/maplibre-gl@5.13.0/dist/maplibre-gl.js",
    "https://unpkg.com/pmtiles@4.5.0/dist/pmtiles.js",
    "https://protomaps.github.io/basemaps-assets/fonts/Noto%20Sans%20Regular/0-255.pbf",
    "https://protomaps.github.io/basemaps-assets/fonts/Noto%20Sans%20Regular/1024-1279.pbf"
  ];

  async function cacheUrl(cache,url){
    const r=await fetch(url,{cache:"reload",mode:"cors"});
    if(!r.ok) throw new Error(`${url}: ${r.status}`);
    await cache.put(url,r.clone());
  }

  async function downloadOffline(){
    const out=document.getElementById("offlineStatus");
    const btn=document.getElementById("offlineDownloadBtn");
    if(!("caches" in window)){
      out.textContent="Этот браузер не поддерживает Cache Storage.";
      return;
    }
    btn.disabled=true;
    try{
      const cache=await caches.open("trip-offline-v5");
      let step=0;
      const total=externalAssets.length+3;

      for(const url of externalAssets){
        step++;
        out.textContent=`Сохраняю файлы приложения… ${step}/${total}`;
        await cacheUrl(cache,url);
      }

      for(const city of ["minsk","brest","grodno"]){
        step++;
        out.textContent=`Скачиваю ${cities[city].name}… ${step}/${total}`;
        const url=new URL(`./maps/${cityFiles[city]}`,location.href).href;
        const r=await fetch(url,{cache:"reload"});
        if(!r.ok) throw new Error(`Карта ${cities[city].name} не найдена (${r.status}). Сначала запусти Build offline city maps в GitHub Actions.`);
        await cache.put(url,r.clone());
      }

      await loadPlaces();
      out.textContent="Готово. Карты трёх городов и последняя версия точек сохранены на этом iPhone.";
    }catch(e){
      out.textContent=`Не удалось скачать: ${e.message}`;
    }finally{
      btn.disabled=false;
    }
  }
  document.getElementById("offlineDownloadBtn").addEventListener("click",downloadOffline);

  if("serviceWorker" in navigator){
    navigator.serviceWorker.register("./service-worker.js").catch(()=>{});
  }

  resetSchedule();
  updateVegan();
  initMap();
  loadPlaces();
})();
