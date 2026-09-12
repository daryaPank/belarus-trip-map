
(() => {
  const TILE=256;
  const cfg=window.TRIP_MAP_CONFIG||{};
  const editor=new URLSearchParams(location.search).get("edit")==="1";
  if(editor){document.body.classList.add("editor");document.getElementById("modeLabel").textContent="режим добавления"}

  const cities={
    minsk:{name:"Минск",lat:53.9006,lon:27.5590,zoom:12},
    brest:{name:"Брест",lat:52.0976,lon:23.7341,zoom:13},
    grodno:{name:"Гродно",lat:53.6830,lon:23.8200,zoom:12}
  };
  const categoryLabels={history:"история / архитектура",beautiful:"красивая локация",park:"парк",food:"еда",coffee:"кофейня"};

  // Демоданные работают до подключения Supabase.
  let places=[
    {id:"demo1",city:"grodno",name:"Старый замок",category:"history",lat:53.6770,lon:23.8230,address:"Замковая гора, Гродно",note:"Королевская резиденция над Неманом — история и сильные виды на реку.",vegan:false},
    {id:"demo2",city:"grodno",name:"Новый замок",category:"history",lat:53.6763,lon:23.8253,address:"ул. Замковая, 20",note:"Королевский дворец XVIII века напротив Старого замка.",vegan:false},
    {id:"demo3",city:"grodno",name:"Смотровая «Крыша мира»",category:"beautiful",lat:53.68235,lon:23.83155,address:"ул. Советская, 18",note:"Центральная смотровая с крышами старого города.",vegan:false},
    {id:"demo4",city:"grodno",name:"Коложский парк",category:"park",lat:53.67841,lon:23.81859,address:"район Коложи",note:"Зелёный склон над Неманом вокруг Коложской церкви.",vegan:false},
    {id:"demo5",city:"grodno",name:"Парк Жилибера",category:"park",lat:53.6852,lon:23.8379,address:"центр Гродно",note:"Центральный парк для короткой паузы между городскими точками.",vegan:false},
    {id:"demo6",city:"grodno",name:"The Cult",category:"food",lat:53.685167,lon:23.825747,address:"ул. Виленская, 37",note:"Вариант для полноценного ужина в исторической части.",vegan:false},
    {id:"demo7",city:"grodno",name:"Бистро «Семолина»",category:"food",lat:53.679919,lon:23.830400,address:"ул. Советская, 7",note:"Удобно встроить прямо в прогулку по пешеходной Советской.",vegan:false},
    {id:"demo8",city:"grodno",name:"Поляна City",category:"food",lat:53.681531,lon:23.831739,address:"ул. Советская, 25",note:"Еда прямо в центре без отдельного крюка.",vegan:false},
    {id:"demo9",city:"grodno",name:"ТЕПЛО",category:"coffee",lat:53.680591,lon:23.827355,address:"ул. Большая Троицкая, 37",note:"Небольшая кофейня в квартале Большой Троицкой.",vegan:false},
    {id:"demo10",city:"grodno",name:"Джезва",category:"coffee",lat:53.679637,lon:23.830131,address:"ул. Советская, 5",note:"Кофе в джезве, в том числе приготовление на песке.",vegan:false},
    {id:"demo11",city:"grodno",name:"Бар «Урбанист»",category:"food",lat:53.676975,lon:23.828594,address:"ул. Мостовая, 31",note:"Вечерняя барная точка в центре.",vegan:false},
    {id:"demo12",city:"grodno",name:"Наше место",category:"coffee",lat:53.6713,lon:23.8233,address:"ул. Дарвина, 24",note:"Кофе плюс вид с высокого берега Немана на старый город.",vegan:false},
    {id:"demo13",city:"grodno",name:"Проходная",category:"coffee",lat:53.676975,lon:23.828594,address:"ул. Мостовая, 31",note:"Спешелти-кофейня в центре.",vegan:false},
    {id:"demo14",city:"grodno",name:"Крепкий Белый",category:"coffee",lat:53.678100,lon:23.827400,address:"ул. Замковая, 10",note:"Кофейня рядом с замками.",vegan:true},
    {id:"demo15",city:"grodno",name:"Справа",category:"coffee",lat:53.676975,lon:23.828594,address:"ул. Мостовая, 31",note:"Кафе в центральном квартале.",vegan:false},
    {id:"demo16",city:"grodno",name:"Лесопарк Пышки",category:"park",lat:53.7138,lon:23.7941,address:"урочище Пышки",note:"Большой лесной массив для длинной прогулки.",vegan:false}
  ];

  const map=document.getElementById("map"),sheet=document.getElementById("sheet"),empty=document.getElementById("empty");
  const tabs=[...document.querySelectorAll(".tab")],filters=[...document.querySelectorAll(".filter")];
  let currentCity="grodno",activeFilter="all",state={...cities.grodno},selected=null,drag=null;
  const pointers=new Map();

  const apiReady=()=>cfg.supabaseUrl&&cfg.supabaseKey;
  const apiHeaders=()=>({"apikey":cfg.supabaseKey,"Authorization":`Bearer ${cfg.supabaseKey}`,"Content-Type":"application/json"});

  async function loadPlaces(){
    if(!apiReady()) return;
    try{
      const r=await fetch(`${cfg.supabaseUrl}/rest/v1/places?select=*&order=created_at.asc`,{headers:apiHeaders()});
      if(!r.ok) throw new Error(await r.text());
      places=await r.json();
      render();
    }catch(e){console.error("Supabase load failed",e)}
  }

  function wx(lon,z){return((lon+180)/360)*TILE*2**z}
  function wy(lat,z){const r=lat*Math.PI/180,n=Math.log(Math.tan(Math.PI/4+r/2));return(1-n/Math.PI)/2*TILE*2**z}
  function lonFromX(x,z){return x/(TILE*2**z)*360-180}
  function latFromY(y,z){const n=Math.PI-2*Math.PI*y/(TILE*2**z);return 180/Math.PI*Math.atan(.5*(Math.exp(n)-Math.exp(-n)))}
  function visiblePlaces(){return places.filter(p=>p.city===currentCity&&(activeFilter==="all"||p.category===activeFilter))}

  function render(){
    map.querySelectorAll(".tile,.marker").forEach(e=>e.remove());
    const r=map.getBoundingClientRect();if(!r.width||!r.height)return;
    const z=Math.round(Math.max(2,Math.min(18,state.zoom)));state.zoom=z;
    const cx=wx(state.lon,z),cy=wy(state.lat,z),left=cx-r.width/2,top=cy-r.height/2;
    const x0=Math.floor(left/TILE),y0=Math.floor(top/TILE),x1=Math.floor((left+r.width)/TILE),y1=Math.floor((top+r.height)/TILE),max=2**z;
    for(let tx=x0;tx<=x1;tx++)for(let ty=y0;ty<=y1;ty++){
      if(ty<0||ty>=max)continue;
      const img=document.createElement("img");img.className="tile";img.alt="";img.draggable=false;
      img.src=`https://tile.openstreetmap.org/${z}/${((tx%max)+max)%max}/${ty}.png`;
      img.style.left=`${tx*TILE-left}px`;img.style.top=`${ty*TILE-top}px`;map.appendChild(img);
    }
    const vp=visiblePlaces();empty.style.display=places.some(p=>p.city===currentCity)?"none":"block";
    vp.forEach(p=>{
      if(!Number.isFinite(Number(p.lat))||!Number.isFinite(Number(p.lon)))return;
      const b=document.createElement("button");b.className="marker"+(String(p.id)===String(selected)?" selected":"");b.type="button";b.setAttribute("aria-label",p.name);
      b.style.left=`${wx(Number(p.lon),z)-left}px`;b.style.top=`${wy(Number(p.lat),z)-top}px`;
      const icon=p.category==="coffee"?"☕":p.category==="food"?"🍴":p.category==="park"?"🌿":p.category==="beautiful"?"◉":"◆";
      b.innerHTML=`<span>${icon}</span>`;b.addEventListener("click",e=>{e.stopPropagation();openPlace(p.id)});map.appendChild(b);
    });
  }

  function openPlace(id){
    selected=id;const p=places.find(x=>String(x.id)===String(id));if(!p)return;
    document.getElementById("placeTitle").textContent=p.name;
    const tags=[`<span class="tag">${categoryLabels[p.category]||p.category}</span>`];
    if(p.vegan&&(p.category==="food"||p.category==="coffee"))tags.push(`<span class="tag vegan">🌿 vegan-friendly</span>`);
    document.getElementById("placeTags").innerHTML=tags.join("");
    document.getElementById("placeText").textContent=p.note||"";
    document.getElementById("placeAddress").textContent=p.address||"";
    const hours=document.getElementById("placeHours");
    if(p.opening_hours){
      hours.textContent=`🕒 ${p.opening_hours}`;
      hours.hidden=false;
    }else{
      hours.textContent="";
      hours.hidden=true;
    }
    const s=document.getElementById("placeSource");
    s.innerHTML=p.source_url?`<a href="${escapeHtml(p.source_url)}" target="_blank" rel="noopener">Источник</a>`:"";
    sheet.classList.add("open");render();
  }
  function closePlace(){selected=null;sheet.classList.remove("open");render()}
  function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}

  function selectCity(key){
    currentCity=key;state={...cities[key]};selected=null;sheet.classList.remove("open");
    tabs.forEach(t=>t.setAttribute("aria-selected",t.dataset.city===key?"true":"false"));render();
  }
  tabs.forEach(t=>t.addEventListener("click",()=>selectCity(t.dataset.city)));
  filters.forEach(f=>f.addEventListener("click",()=>{activeFilter=f.dataset.filter;filters.forEach(x=>x.classList.toggle("active",x===f));closePlace()}));
  document.getElementById("closeSheet").addEventListener("click",closePlace);
  document.getElementById("zoomIn").addEventListener("click",()=>{state.zoom=Math.min(18,state.zoom+1);render()});
  document.getElementById("zoomOut").addEventListener("click",()=>{state.zoom=Math.max(2,state.zoom-1);render()});

  map.addEventListener("pointerdown",e=>{
    if(e.target.closest(".marker,.map-controls,.sheet,.add-btn"))return;
    pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});map.setPointerCapture(e.pointerId);
    if(pointers.size===1)drag={x:e.clientX,y:e.clientY,cx:wx(state.lon,state.zoom),cy:wy(state.lat,state.zoom)};
  });
  map.addEventListener("pointermove",e=>{
    if(!pointers.has(e.pointerId)||pointers.size!==1||!drag)return;
    pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    state.lon=lonFromX(drag.cx-(e.clientX-drag.x),state.zoom);state.lat=latFromY(drag.cy-(e.clientY-drag.y),state.zoom);render();
  });
  function endPointer(e){pointers.delete(e.pointerId);if(!pointers.size)drag=null}
  map.addEventListener("pointerup",endPointer);map.addEventListener("pointercancel",endPointer);
  window.addEventListener("resize",render);

  // ---------- editor ----------
  const modal=document.getElementById("modal"),form=document.getElementById("placeForm"),cat=document.getElementById("category");
  const veganRow=document.getElementById("veganRow"),status=document.getElementById("formStatus");
  function updateVegan(){veganRow.classList.toggle("show",cat.value==="food"||cat.value==="coffee");if(!veganRow.classList.contains("show"))document.getElementById("vegan").checked=false}
  cat.addEventListener("change",updateVegan);updateVegan();
  document.getElementById("addBtn").addEventListener("click",()=>{form.reset();document.getElementById("city").value=currentCity;updateVegan();status.textContent="";modal.classList.add("open")});
  document.getElementById("cancelBtn").addEventListener("click",()=>modal.classList.remove("open"));

  async function geocode(name,address,city){
    const cityName=cities[city].name;
    const cleanAddress=String(address||"").trim();
    const cleanName=String(name||"").trim();

    const candidates=[
      `${cleanAddress}, ${cityName}, Беларусь`,
      `улица ${cleanAddress}, ${cityName}, Беларусь`,
      `${cleanName}, ${cleanAddress}, ${cityName}, Беларусь`,
      `${cleanName}, ${cityName}, Беларусь`
    ].filter((q,i,a)=>q && a.indexOf(q)===i);

    async function tryNominatim(q){
      const u=`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=by&q=${encodeURIComponent(q)}`;
      const r=await fetch(u,{headers:{"Accept-Language":"ru"}});
      if(!r.ok) return null;
      const d=await r.json();
      if(!Array.isArray(d)||!d.length) return null;
      const lat=Number(d[0].lat),lon=Number(d[0].lon);
      return Number.isFinite(lat)&&Number.isFinite(lon)?{lat,lon}:null;
    }

    async function tryPhoton(q){
      const u=`https://photon.komoot.io/api/?limit=1&q=${encodeURIComponent(q)}`;
      const r=await fetch(u,{headers:{"Accept-Language":"ru"}});
      if(!r.ok) return null;
      const d=await r.json();
      const coords=d?.features?.[0]?.geometry?.coordinates;
      if(!Array.isArray(coords)||coords.length<2) return null;
      const lon=Number(coords[0]),lat=Number(coords[1]);
      return Number.isFinite(lat)&&Number.isFinite(lon)?{lat,lon}:null;
    }

    let hadNetworkFailure=false;

    for(const q of candidates){
      try{
        const hit=await tryNominatim(q);
        if(hit) return hit;
      }catch(_){ hadNetworkFailure=true; break; }
    }

    for(const q of candidates){
      try{
        const hit=await tryPhoton(q);
        if(hit) return hit;
      }catch(_){ hadNetworkFailure=true; break; }
    }

    if(hadNetworkFailure){
      throw new Error("Не удалось проверить адрес из-за сетевой ошибки. Попробуй ещё раз чуть позже.");
    }
    throw new Error("Не нашла адрес. Попробуй написать только улицу и дом, например: Комсомольская 32.");
  }

  function autoNote(city,category,vegan){
    const labels={
      history:"Историко-архитектурная точка",
      beautiful:"Красивая локация",
      park:"Парк или зелёная зона",
      food:"Место для еды",
      coffee:"Кофейня"
    };
    let text=`${labels[category]||"Интересная точка"} в ${cities[city].name}.`;
    if(vegan&&(category==="food"||category==="coffee")) text+=` 🌿 Отмечено как vegan-friendly.`;
    return text;
  }

  form.addEventListener("submit",async e=>{
    e.preventDefault();
    status.className="form-status";
    status.textContent="Проверяю адрес…";

    const fd=new FormData(form);
    const category=String(fd.get("category"));
    const city=String(fd.get("city"));
    const name=String(fd.get("name")||"").trim();
    const address=String(fd.get("address")||"").trim();
    const sourceUrl=String(fd.get("source")||"").trim()||null;
    const openingHours=String(fd.get("opening_hours")||"").trim();
    const vegan=(category==="food"||category==="coffee")&&fd.get("vegan")==="on";

    try{
      const g=await geocode(name,address,city);
      const manualNote=String(fd.get("note")||"").trim();

      const row={
        name,
        city,
        category,
        address,
        lat:g.lat,
        lon:g.lon,
        source_url:sourceUrl,
        opening_hours:openingHours,
        note:manualNote||autoNote(city,category,vegan),
        vegan
      };

      if(!apiReady())throw new Error("Сначала подключи Supabase в config.js");

      status.textContent="Сохраняю…";
      const r=await fetch(`${cfg.supabaseUrl}/rest/v1/places`,{
        method:"POST",
        headers:{...apiHeaders(),"Prefer":"return=representation"},
        body:JSON.stringify(row)
      });
      if(!r.ok)throw new Error(await r.text());

      const created=await r.json();
      places.push(created[0]);
      modal.classList.remove("open");
      selectCity(row.city);
    }catch(err){
      status.className="form-status error";
      status.textContent=err?.message||"Не удалось сохранить точку. Попробуй ещё раз.";
    }
  });

  if("serviceWorker" in navigator)navigator.serviceWorker.register("./service-worker.js").catch(()=>{});
  render();loadPlaces();
})();
