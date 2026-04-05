
// ══ GLOBALS ══
const SUPA_URL='https://amngdnnacihxfygponxw.supabase.co';
const SUPA_KEY='sb_publishable_wAxh6qCrdA5Zru2YzcrOBQ_wI5saZZP';
const supa=supabase.createClient(SUPA_URL,SUPA_KEY);
const API=window.location.hostname==='localhost'?'http://localhost:3001':window.location.origin;
let ACCESS_TOKEN=null,CURRENT_MODULE=null;
const R={USD:38.5,EUR:41.8,GBP:47.2};
let PLATS=[],PRODS=[],PRESULTS={},TCG='pokemon',CADDED=0;
let TRACKED_PRODUCTS=[];
let LAST_TRACKER_SEARCH=null;
let LAST_TRACKER_MODEL_GROUPS=[];
let LAST_BROAD_QUERY=null;
let LAST_BROAD_GROUPS=[];

const $=id=>document.getElementById(id);
function set(id,v){const e=$(id);if(e)e.textContent=v;}
function fTRY(p){return p?(Math.round(p).toLocaleString('tr-TR')+'₺'):'—';}
function escJS(v){return String(v||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\n/g,' ');}
function titleCaseTR(v){return String(v||'').split(' ').filter(Boolean).map(w=>w.charAt(0).toLocaleUpperCase('tr-TR')+w.slice(1)).join(' ');}
function findFirstPlatformByType(type){return (PLATS||[]).find(p=>p.type===type)||null;}
function trackerModelKeyFromName(name='',query=''){
  let s=String(name||'').toLowerCase();
  let qStr=String(query||'').toLowerCase();
  
  const unneeded = ['kılıf','kilif','case','koruyucu','kablo','cable','adaptör','adaptor','şarj','sarj','silikon','deri','cüzdan'];
  const queryHasUnneeded = unneeded.some(u => qStr.includes(u));
  const nameHasUnneeded = unneeded.some(u => s.includes(u));
  
  // If the user didn't specifically search for an accessory, but the product is one, bucket it away
  if (!queryHasUnneeded && nameHasUnneeded) {
    return 'Kılıf & Aksesuar';
  }

  const qTokens=qStr.split(/\s+/).filter(t=>t.length>2);
  const removable=new Set([
    'stanley','termos','termosu','vacuum','vakumlu','mug','cup','tumbler','bardak','matara',
    'drinkware','taşı','tasi','taşi','tasima','taşıma','resmi','orijinal','çelik','pipetli','with','ve',
    'amazon','amazoncomtr','trendyol','hepsiburada','a101','teknosa','n11','cimri','akakce',
    'turkiye','türkiye','official','store','satis','satış','sale','litre','ml'
  ]);
  s=s.normalize('NFKD').replace(/[\u0300-\u036f]/g,'');
  s=s.replace(/[^a-z0-9çğıöşü\s.-]/g,' ');
  s=s.replace(/\b\d+(?:[.,]\d+)?\s?(ml|l|lt|litre|oz|gb|tb|cm|mm|w)\b/g,' ');
  
  const allTokens = s.split(/\s+/).filter(Boolean);
  let tokens=allTokens.filter(t=>t.length>1 && !removable.has(t));
  
  const priority=['quencher','aerolight','transit','flowstate','classic','klasik','protour','flip','carry','all','day','adventure','trigger','action','master'];
  const picked=[];
  for(const k of priority){ if(tokens.includes(k) && !picked.includes(k)) picked.push(k); }
  
  if (picked.length === 0) {
    for(const t of tokens){ if(!picked.includes(t)) picked.push(t); if(picked.length>=2) break; }
  }
  
  const key=picked.join(' ').trim();
  return key || "Diğer Modeller";
}
function groupTrackerSearchResults(results=[],query=''){
  const map=new Map();
  (results||[]).forEach((item)=>{
    const key=trackerModelKeyFromName(item.name||query,query);
    if(!map.has(key)){
      map.set(key,{key,displayName:titleCaseTR(key),items:[],lowestPrice:Infinity,highestPrice:0,image:item.image||null,query:key||query});
    }
    const group=map.get(key);
    group.items.push(item);
    if(item.image && !group.image) group.image=item.image;
    if(item.priceTRY && item.priceTRY<group.lowestPrice) group.lowestPrice=item.priceTRY;
    if(item.priceTRY && item.priceTRY>group.highestPrice) group.highestPrice=item.priceTRY;
  });
  return Array.from(map.values())
    .filter(g=>g.items.length)
    .map(g=>({
      ...g,
      lowestPrice:isFinite(g.lowestPrice)?g.lowestPrice:0,
      highestPrice:g.highestPrice||g.lowestPrice||0,
      sourceCount:new Set(g.items.map(x=>x.source).filter(Boolean)).size,
      sampleNames:g.items.slice(0,3).map(x=>x.name).filter(Boolean)
    }))
    .sort((a,b)=>(a.lowestPrice||Infinity)-(b.lowestPrice||Infinity));
}
function hdr(){return{'Content-Type':'application/json','Authorization':'Bearer '+ACCESS_TOKEN};}
function openM(id){$(id).classList.remove('hidden');$(id).classList.add('flex');}
function closeM(id){$(id).classList.add('hidden');$(id).classList.remove('flex');}

// Auth fetch override
const _origFetch=window.fetch.bind(window);
window.fetch=function(url,opts={}){
  if(typeof url==='string'&&(url.startsWith(API)||url.startsWith('/'))&&ACCESS_TOKEN){
    opts={...opts,headers:{...(opts.headers||{}),'Authorization':'Bearer '+ACCESS_TOKEN}};
  }
  return _origFetch(url,opts);
};

// ══ AUTH ══
function showTab(tab){
  const isL=tab==='login';
  $('formLogin').classList.toggle('hidden',!isL);$('formReg').classList.toggle('hidden',isL);
  $('tabLogin').className='flex-1 py-3 text-[11px] font-bold uppercase tracking-widest border-b-2 '+(isL?'text-primary-container border-primary-container':'text-outline border-transparent');
  $('tabReg').className='flex-1 py-3 text-[11px] font-bold uppercase tracking-widest border-b-2 '+(!isL?'text-primary-container border-primary-container':'text-outline border-transparent');
}
function showMsg(el,msg,type){el.classList.remove('hidden');el.className='mt-3 text-xs text-center '+(type==='error'?'text-error':type==='success'?'text-secondary':'text-on-surface-variant');el.textContent=msg;}

async function doLogin(){
  const email=$('loginEmail').value.trim(),pass=$('loginPass').value,msg=$('loginMsg');
  if(!email||!pass){showMsg(msg,'Email ve şifre girin','error');return;}
  showMsg(msg,'Giriş yapılıyor...','info');
  const{data,error}=await supa.auth.signInWithPassword({email,password:pass});
  if(error){showMsg(msg,error.message,'error');return;}
  onLogin(data.session);
}
async function doRegister(){
  const email=$('regEmail').value.trim(),pass=$('regPass').value,pass2=$('regPass2').value,msg=$('regMsg');
  if(!email||!pass){showMsg(msg,'Tüm alanları doldurun','error');return;}
  if(pass!==pass2){showMsg(msg,'Şifreler eşleşmiyor','error');return;}
  if(pass.length<8){showMsg(msg,'En az 8 karakter','error');return;}
  showMsg(msg,'Hesap oluşturuluyor...','info');
  const{data,error}=await supa.auth.signUp({email,password:pass});
  if(error){showMsg(msg,error.message,'error');return;}
  if(data.session)onLogin(data.session);
  else showMsg(msg,'✓ Onay emaili gönderildi!','success');
}
async function doGoogleLogin(){
  const{error}=await supa.auth.signInWithOAuth({provider:'google',options:{redirectTo:window.location.origin}});
  if(error)alert(error.message);
}
async function doLogout(){
  await supa.auth.signOut();ACCESS_TOKEN=null;CURRENT_MODULE=null;
  $('authOverlay').style.display='flex';
  $('entryScreen').style.display='none';
  $('sidebar').style.display='none';
  $('topBar').style.display='none';
  $('mainContent').style.display='none';
  const ui=$('userInfo'); if(ui){ ui.classList.add('hidden'); ui.classList.remove('flex'); }
}
function onLogin(session){
  ACCESS_TOKEN=session.access_token;
  $('authOverlay').style.display='none';
  const ui=$('userInfo');
  if(ui){
    ui.classList.remove('hidden');ui.classList.add('flex');
    if($('userEmailTxt')) $('userEmailTxt').textContent=session.user.email;
  }
  showEntry();
  loadRates();loadPlats();
  setInterval(loadRates,10*60*1000);
}

supa.auth.onAuthStateChange((event,session)=>{if(session)onLogin(session);});
(async()=>{const{data}=await supa.auth.getSession();if(data.session)onLogin(data.session);})();

// ══ ENTRY SCREEN ══
function showEntry(){
  CURRENT_MODULE=null;
  $('entryScreen').style.display='flex';
  $('sidebar').style.display='none';
  $('topBar').style.display='none';
  $('mainContent').style.display='none';
}

function enterModule(mod){
  CURRENT_MODULE=mod;
  $('entryScreen').style.display='none';
  $('sidebar').style.display='flex';
  $('topBar').style.display='flex';
  $('mainContent').style.display='block';
  
  buildSidebar(mod);
  
  if(mod==='cards'){
    $('topTitle').textContent='Card Market — Obsidian Architect';
    go('dashboard');
  } else if(mod==='tracker'){
    $('topTitle').textContent='Price Tracker — Obsidian Architect';
    go('market-search');
    loadTrackedProducts();
  }
}

function buildSidebar(mod){
  const nav=$('sidebarNav');
  if(mod==='cards'){
    nav.innerHTML=`
      <button class="nav-btn w-full flex flex-col items-center py-3 text-outline hover:text-primary hover:bg-surface-container transition-colors" data-page="dashboard"><span class="material-symbols-outlined text-xl mb-1">dashboard</span><span class="text-[10px] font-bold uppercase tracking-wider font-headline">Dashboard</span></button>
      <button class="nav-btn w-full flex flex-col items-center py-3 text-outline hover:text-primary hover:bg-surface-container transition-colors" data-page="catalog"><span class="material-symbols-outlined text-xl mb-1">menu_book</span><span class="text-[10px] font-bold uppercase tracking-wider font-headline">Catalog</span></button>
      <button class="nav-btn w-full flex flex-col items-center py-3 text-outline hover:text-primary hover:bg-surface-container transition-colors" data-page="products"><span class="material-symbols-outlined text-xl mb-1">inventory_2</span><span class="text-[10px] font-bold uppercase tracking-wider font-headline">Products</span></button>
      <button class="nav-btn w-full flex flex-col items-center py-3 text-outline hover:text-primary hover:bg-surface-container transition-colors" data-page="integrations"><span class="material-symbols-outlined text-xl mb-1">settings_input_component</span><span class="text-[10px] font-bold uppercase tracking-wider font-headline">Integrate</span></button>
      <button class="nav-btn w-full flex flex-col items-center py-3 text-outline hover:text-primary hover:bg-surface-container transition-colors" data-page="engine"><span class="material-symbols-outlined text-xl mb-1">auto_fix_high</span><span class="text-[10px] font-bold uppercase tracking-wider font-headline">Engine</span></button>
      <button class="nav-btn w-full flex flex-col items-center py-3 text-outline hover:text-primary hover:bg-surface-container transition-colors" data-page="logs"><span class="material-symbols-outlined text-xl mb-1">history_edu</span><span class="text-[10px] font-bold uppercase tracking-wider font-headline">Logs</span></button>`;
  } else if(mod==='tracker'){
    nav.innerHTML=`
      <button class="nav-btn w-full flex flex-col items-center py-3 text-outline hover:text-secondary hover:bg-surface-container transition-colors" data-page="market-search"><span class="material-symbols-outlined text-xl mb-1">monitoring</span><span class="text-[10px] font-bold uppercase tracking-wider font-headline">Tracker</span></button>
      <button class="nav-btn w-full flex flex-col items-center py-3 text-outline hover:text-secondary hover:bg-surface-container transition-colors" data-page="integrations"><span class="material-symbols-outlined text-xl mb-1">settings_input_component</span><span class="text-[10px] font-bold uppercase tracking-wider font-headline">Integrate</span></button>
      <button class="nav-btn w-full flex flex-col items-center py-3 text-outline hover:text-secondary hover:bg-surface-container transition-colors" data-page="logs"><span class="material-symbols-outlined text-xl mb-1">history_edu</span><span class="text-[10px] font-bold uppercase tracking-wider font-headline">Logs</span></button>`;
  }
  nav.querySelectorAll('.nav-btn').forEach(btn=>btn.addEventListener('click',()=>go(btn.dataset.page)));
}

function go(page){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('on'));
  document.querySelectorAll('.nav-btn').forEach(b=>{b.classList.remove('text-primary','text-secondary','border-l-2','border-primary','border-secondary','bg-surface-container-high');b.classList.add('text-outline');});
  const pg=$('page-'+page);if(pg)pg.classList.add('on');
  const btn=document.querySelector(`.nav-btn[data-page="${page}"]`);
  if(btn){
    const accent=CURRENT_MODULE==='tracker'?'secondary':'primary';
    btn.classList.remove('text-outline');btn.classList.add('text-'+accent,'border-l-2','border-'+accent,'bg-surface-container-high');
  }
  if(page==='products')fillPlatSel('prodPlatSel');
  if(page==='integrations')renderPlatCards();
  if(page==='market-search')loadTrackedProducts();
}

// ══ RATES ══
async function loadRates(){
  try{
    const d=await(await fetch(API+'/api/rates')).json();
    R.USD=d.USD;R.EUR=d.EUR;R.GBP=d.GBP;
    set('tUSD',d.USD);set('tEUR',d.EUR);set('entryUSD',d.USD);set('entryEUR',d.EUR);
    set('dRateUSD',d.USD+' ₺');set('dRateEUR',d.EUR+' ₺');set('dRateGBP',d.GBP+' ₺');
    set('dRateTime','Güncellendi: '+new Date(d.updatedAt).toLocaleTimeString('tr-TR'));
    $('sDot').className='w-1.5 h-1.5 rounded-full bg-secondary';set('sTxt','Aktif');
  }catch(e){$('sDot').className='w-1.5 h-1.5 rounded-full bg-error';set('sTxt','Kapalı');}
}

// ══ PLATFORMS ══
async function loadPlats(){
  try{
    const d=await(await fetch(API+'/api/platforms')).json();
    PLATS=d;set('dPlat',d.length);set('dSched',d.filter(p=>p.hasScheduler).length);
    fillPlatSel('prodPlatSel');fillPlatSel('trAddPlatform');
  }catch(e){}
}
function fillPlatSel(selId){
  const s=$(selId);if(!s)return;const cur=s.value;
  s.innerHTML='<option value="">Seçin...</option>'+PLATS.map(p=>`<option value="${p.id}">${p.name} (${p.type})</option>`).join('');
  if(cur)s.value=cur;
}
function renderPlatCards(){
  const el=$('platCards');if(!el)return;
  if(!PLATS.length){el.innerHTML='<div class="col-span-2 text-on-surface-variant text-sm p-8 text-center">Platform eklenmedi.</div>';return;}
  el.innerHTML=PLATS.map(p=>`
    <div class="bg-surface-container-high p-6 border-t-2 ${p.hasScheduler?'border-t-secondary':'border-t-outline-variant/20'}">
      <div class="flex items-center gap-4 mb-4">
        <div class="w-12 h-12 ${p.type==='ikas'?'bg-[#00cfb4]':'bg-[#95bf47]'} flex items-center justify-center font-black text-white text-xl">${p.type==='ikas'?'i':'S'}</div>
        <div><h3 class="font-headline text-lg font-bold">${p.name}</h3><div class="flex items-center gap-2"><span class="w-2 h-2 rounded-full ${p.enabled?'bg-secondary':'bg-error'}"></span><span class="text-[10px] font-bold uppercase ${p.enabled?'text-secondary':'text-error'}">${p.enabled?'Connected':'Disabled'}</span></div></div>
      </div>
      <div class="flex gap-2">
        <button onclick="testPlat('${p.id}')" class="flex-1 py-2 text-[10px] font-bold uppercase text-primary bg-primary/10 hover:bg-primary/20">Test</button>
        <button onclick="delPlat('${p.id}')" class="px-3 py-2 text-error bg-error/10 hover:bg-error/20"><span class="material-symbols-outlined text-sm">delete</span></button>
      </div>
    </div>`).join('');
}
function renderDashPlats(){
  const el=$('dPlatList');if(!PLATS.length)return;
  el.innerHTML=PLATS.map(p=>`<div class="bg-surface-container-lowest p-4 border-l-2 ${p.hasScheduler?'border-secondary':'border-outline-variant/30'} cursor-pointer" onclick="go('integrations')"><span class="font-bold text-sm">${p.name}</span> <span class="text-[9px] text-on-surface-variant uppercase">${p.type}</span></div>`).join('');
}
function pickPlat(type,el){
  $('platType').value=type;
  document.querySelectorAll('.pt-btn').forEach(b=>{b.classList.remove('border-primary-container','bg-primary-container/10');b.classList.add('border-outline-variant/20');});
  el.classList.remove('border-outline-variant/20');el.classList.add('border-primary-container','bg-primary-container/10');
  $('fIkas').classList.toggle('hidden',type!=='ikas');$('fShopify').classList.toggle('hidden',type!=='shopify');
}
async function savePlat(){
  const type=$('platType').value,name=$('platName').value.trim();if(!name){alert('İsim girin!');return;}
  let cfg={};
  if(type==='ikas'){cfg={storeName:$('ikasStore').value.trim(),clientId:$('ikasClientId').value.trim(),clientSecret:$('ikasSecret').value.trim(),priceListId:$('ikasPriceList').value.trim()};if(!cfg.storeName||!cfg.clientId||!cfg.clientSecret){alert('Tüm alanları doldurun!');return;}}
  else if(type==='shopify'){cfg={storeDomain:$('shopifyDomain').value.trim(),accessToken:$('shopifyToken').value.trim()};if(!cfg.storeDomain||!cfg.accessToken){alert('Tüm alanları doldurun!');return;}}
  try{
    await fetch(API+'/api/platforms',{method:'POST',headers:hdr(),body:JSON.stringify({id:type+'_'+Date.now(),name,type,config:cfg})});
    closeM('mAddPlat');loadPlats();
  }catch(e){alert(e.message);}
}
async function testPlat(id){try{const r=await(await fetch(API+'/api/platforms/'+id+'/test',{method:'POST',headers:hdr(),body:'{}'})).json();alert(r.ok?'✓ '+r.productCount+' ürün':'Hata: '+r.error);}catch(e){alert(e.message);}}
async function delPlat(id){if(!confirm('Silinsin mi?'))return;await fetch(API+'/api/platforms/'+id,{method:'DELETE'});loadPlats();}

// ══ PRODUCTS (Card) ══
async function loadProds(){
  const id=$('prodPlatSel').value;if(!id)return;
  $('prodBody').innerHTML='<tr><td colspan="5" class="px-5 py-8 text-center text-primary text-xs animate-pulse">Yükleniyor...</td></tr>';
  try{const r=await(await fetch(API+'/api/platforms/'+id+'/products',{method:'POST',headers:hdr(),body:'{}'})).json();PRODS=r.products;renderProdTable();}
  catch(e){$('prodBody').innerHTML=`<tr><td colspan="5" class="px-5 py-6 text-center text-error text-sm">${e.message}</td></tr>`;}
}
async function calcPrices(){
  const id=$('prodPlatSel').value;if(!id||!PRODS.length)return;
  for(const p of PRODS){try{const r=await(await fetch(API+'/api/global-price',{method:'POST',headers:hdr(),body:JSON.stringify({productName:p.name})})).json();if(r.averageTRY){let sg=Math.round(r.averageTRY*1.15/5)*5;const df=sg-p.price,act=Math.abs(df)<5?'eq':df>0?'up':'dn';PRESULTS[p.id]={suggested:sg,globalAvgTRY:r.averageTRY,action:act,diff:df};}}catch(e){}await new Promise(r=>setTimeout(r,40));}
  renderProdTable();
}
function renderProdTable(){
  const tb=$('prodBody');if(!PRODS.length){tb.innerHTML='<tr><td colspan="5" class="px-5 py-6 text-center text-on-surface-variant text-sm">Ürün yok.</td></tr>';return;}
  tb.innerHTML=PRODS.slice(0,200).map(p=>{
    const rs=PRESULTS[p.id];
    const badge=rs?(rs.action==='up'?'<span class="px-2 py-0.5 bg-green-900/40 text-green-300 text-[10px] font-bold">↑</span>':rs.action==='dn'?'<span class="px-2 py-0.5 bg-red-900/40 text-red-300 text-[10px] font-bold">↓</span>':'<span class="px-2 py-0.5 bg-surface-container-highest text-on-surface-variant text-[10px] font-bold">—</span>'):'';
    return`<tr class="hover:bg-surface-container-lowest"><td class="px-5 py-4 font-bold text-xs">${p.name}</td><td class="px-5 py-4 font-mono text-sm">${fTRY(p.price)}</td><td class="px-5 py-4 text-on-surface-variant text-sm">${rs?fTRY(rs.globalAvgTRY):'—'}</td><td class="px-5 py-4 font-mono font-bold text-primary text-sm">${rs?fTRY(rs.suggested):'—'}</td><td class="px-5 py-4">${badge}</td></tr>`;
  }).join('');
}
async function pushPrices(){
  const id=$('prodPlatSel').value;if(!id)return;
  const ups=PRODS.filter(p=>PRESULTS[p.id]&&PRESULTS[p.id].action!=='eq').map(p=>({id:p.id,variantId:p.variantId,newPrice:PRESULTS[p.id].suggested}));
  if(!ups.length){alert('Güncellenecek ürün yok');return;}
  const r=await(await fetch(API+'/api/platforms/'+id+'/update-prices',{method:'POST',headers:hdr(),body:JSON.stringify({updates:ups})})).json();
  alert(r.updated+' fiyat güncellendi');
}

// ══ CATALOG (Card) — basitleştirilmiş ══
function setTCG(game,el){
  TCG=game;
  document.querySelectorAll('.cat-tab').forEach(t=>{t.classList.remove('text-primary-container','border-primary-container');t.classList.add('text-outline','border-transparent');});
  el.classList.remove('text-outline','border-transparent');el.classList.add('text-primary-container','border-primary-container');
  $('catQ').value=''; // clear query
  if (game === 'pokemon') {
    loadSets();
  } else {
    $('catGrid').innerHTML='<div class="col-span-full py-12 text-center text-on-surface-variant text-sm">Arama yapın.</div>';
  }
  set('catHeroTitle',{pokemon:'Pokémon Market',yugioh:'Yu-Gi-Oh Market',magic:'MTG Market',onepiece:'One Piece Market',sealed:'Sealed Products',sport:'Sports Cards'}[game]||game);
}
async function loadSets(){
  $('catGrid').innerHTML='<div class="col-span-full py-12 text-center text-primary-container text-xs animate-pulse">Setler yükleniyor...</div>';
  try{
    const sets = await(await fetch(API+'/api/catalog/pokemon/sets')).json();
    if(sets.error) throw new Error(sets.error);
    const sorted = Array.isArray(sets) ? sets.filter(s=>s.logo).reverse().slice(0, 50) : [];
    $('catGrid').innerHTML=sorted.map(s=>`
      <div class="bg-surface-container-high border border-outline-variant/10 hover:border-primary/50 cursor-pointer flex flex-col p-4 items-center justify-center h-48 group transition-all" onclick="document.getElementById('catQ').value='set.id:${s.id}'; doSearch();">
        ${s.logo?`<img src="${s.logo}.png" class="max-w-[80%] max-h-[60%] object-contain scale-95 group-hover:scale-100 transition-transform" alt="${s.name}">`:`<h4 class="font-bold text-center">${s.name}</h4>`}
        <p class="text-[10px] text-on-surface-variant font-bold uppercase tracking-widest mt-6">${s.name}</p>
        <p class="text-[9px] text-primary-fixed-dim/60 font-bold uppercase tracking-widest mt-1">${s.cardCount.total} Kart</p>
      </div>`).join('');
  }catch(e){
    $('catGrid').innerHTML=`<div class="col-span-full py-8 text-center text-error text-sm">${e.message}</div>`;
  }
}

async function doSearch(){
  const q=$('catQ').value.trim();
  if(!q && TCG==='pokemon'){ loadSets(); return; }
  else if(!q) return;

  $('catGrid').innerHTML='<div class="col-span-full py-12 text-center text-primary-container text-xs animate-pulse">Aranıyor...</div>';
  try{
    let cards=[];
    if(TCG==='pokemon'){
      if(q.startsWith('set.id:')){
         const setId = q.replace('set.id:','');
         const setDat = await(await fetch(API+'/api/catalog/pokemon/set/'+setId)).json();
         if(setDat.error) throw new Error(setDat.error);
         const clist = setDat.cards || [];
         cards=clist.map(c=>({id:c.id,name:c.name,image:c.image?c.image+'/high.png':null,set:setDat.name||'',rarity:c.rarity||''}));
      } else {
         const list=await(await fetch(API+'/api/catalog/pokemon/search?q='+encodeURIComponent(q))).json();
         if(list.error) throw new Error(list.error);
         cards=(Array.isArray(list)?list:[]).slice(0,50).map(c=>({id:c.id,name:c.name,image:c.image?c.image+'/high.png':null,set:c.set?.name||'',rarity:c.rarity||''}));
      }
    }
    else if(TCG==='yugioh'){cards=await(await fetch(API+'/api/catalog/yugioh/search?q='+encodeURIComponent(q))).json();}
    else if(TCG==='magic'){cards=await(await fetch(API+'/api/catalog/magic/search?q='+encodeURIComponent(q))).json();}
    $('catGrid').innerHTML=cards.length?cards.map(c=>`<div class="bg-surface-container-high border border-outline-variant/10 hover:border-primary/50 cursor-pointer flex flex-col"><div class="aspect-[3/4] bg-surface-container-lowest overflow-hidden">${c.image?`<img src="${API}/api/image-proxy?url=${encodeURIComponent(c.image)}" class="w-full h-full object-cover" onerror="this.style.display='none'">`:'<div class="w-full h-full flex items-center justify-center text-4xl">🎴</div>'}</div><div class="p-3"><h4 class="font-bold text-xs truncate">${c.name}</h4><p class="text-[10px] text-on-surface-variant truncate">${c.set||c.rarity||''}</p></div></div>`).join(''):'<div class="col-span-full py-12 text-center text-on-surface-variant text-sm">Sonuç bulunamadı.</div>';
  }catch(e){$('catGrid').innerHTML=`<div class="col-span-full py-8 text-center text-error text-sm">${e.message}</div>`;}
}

// ══ PRICE TRACKER ══
async function loadTrackedProducts(){
  const ticker = document.getElementById('tickerContent');
  if(ticker) ticker.innerHTML = '<span class="text-[10px] font-bold text-secondary uppercase tracking-widest flex items-center gap-2"><span class="w-1.5 h-1.5 rounded-full bg-secondary"></span> VERİLER GÜNCELLENİYOR...</span>';

  try{
    const products=await(await fetch(API+'/api/tracker/products')).json();
    TRACKED_PRODUCTS=products;
    renderTrackedProductsBento();
    
    if(ticker && products.length){
      const tItems = products.slice(0, 5).map(p => {
        const outP = p.our_price||p.ourPrice||0;
        const lwst = p.lowest_competitor||p.lowestCompetitor||0;
        const color = outP > lwst ? 'text-error' : 'text-secondary';
        const bgDot = outP > lwst ? 'bg-error' : 'bg-secondary';
        return `<span class="text-[10px] font-bold ${color} uppercase tracking-widest flex items-center gap-2"><span class="w-1.5 h-1.5 rounded-full ${bgDot}"></span> ${p.name.slice(0,15)}: ${fTRY(lwst)}</span>`;
      });
      ticker.innerHTML = tItems.join(' <span class="mx-4 text-outline-variant">•</span> ');
    }
  }catch(e){console.error(e);}
}

// ─── SEARCH: USE SERVER-SIDE GROUPS ──────────────────────────────────────────
// Override doSerpSearch to use d.groups from server (smarter than client-side grouping)
window.doSerpSearch = async function doSerpSearch(overrideQuery=null, isModelInspect=false) {
  const q = overrideQuery || ($('serpQuery') ? $('serpQuery').value.trim() : '');
  if (!q) return;
  if ($('serpQuery')) $('serpQuery').value = q;
  if ($el) safeHide('suggestDropdown');
  if ($el) safeHide('popularSection');

  const container = $('serpResults');
  if (container) container.innerHTML = `
    <div class="col-span-full py-20 flex flex-col items-center justify-center gap-4 text-center">
      <span class="material-symbols-outlined text-5xl text-secondary animate-pulse">radar</span>
      <div>
        <div class="font-headline font-extrabold text-sm uppercase tracking-widest text-on-surface">${q} taranıyor...</div>
        <div class="text-xs text-on-surface-variant mt-1">Türkiye pazarındaki 250+ kaynak kontrol ediliyor</div>
      </div>
    </div>`;

  const titleEl = $('marketResultsTitle');
  if (titleEl) titleEl.textContent = `Sonuçlar: ${q}`;
  const backBtn = $('btnBackToModels');
  if (backBtn) backBtn.classList.add('hidden');

  try {
    const res = await fetch(API + '/api/tracker/search', {
      method: 'POST',
      headers: hdr(),
      body: JSON.stringify({ query: q })
    });
    const d = await res.json();

    if (d.error) {
      if (container) container.innerHTML = `<div class="col-span-full py-10 text-center text-error text-sm">${d.error}</div>`;
      return;
    }

    LAST_TRACKER_SEARCH = d;

    // Prefer server-side groups (smarter parsing) over client-side
    const serverGroups = d.groups || [];
    if (serverGroups.length > 0) {
      LAST_TRACKER_MODEL_GROUPS = serverGroups;
      LAST_BROAD_QUERY = q;
      LAST_BROAD_GROUPS = serverGroups;

      if (serverGroups.length === 1 || isModelInspect) {
        renderSmartGroupDetail(serverGroups[0]);
      } else {
        renderSmartGroups(q, serverGroups);
      }
      return;
    }

    // Fallback: client-side grouping if server groups empty
    const groups = groupTrackerSearchResults(d.results || [], q);
    LAST_TRACKER_MODEL_GROUPS = groups;
    LAST_BROAD_QUERY = q;
    LAST_BROAD_GROUPS = groups;

    if (!groups.length) {
      if (container) container.innerHTML = '<div class="col-span-full py-10 text-center text-on-surface-variant text-sm">Sonuç bulunamadı.</div>';
      return;
    }
    if (groups.length <= 1 || isModelInspect) {
      renderTrackerSearchGroupDetail(0);
    } else {
      renderTrackerSearchGroups(q, groups);
    }
  } catch(e) {
    if (container) container.innerHTML = `<div class="col-span-full py-10 text-center text-error text-sm">${e.message}</div>`;
  }
};

// ─── RENDER: SERVER GROUPS (Hepsiburada Style) ───────────────────────────────
window.renderSmartGroups = function(query, groups) {
  const container = $('serpResults');
  if (!container) return;

  const mainGroups = groups.filter(g => g.key !== '__accessories__');
  const accGroup = groups.find(g => g.key === '__accessories__');

  const titleEl = $('marketResultsTitle');
  if (titleEl) titleEl.textContent = `${query} — ${mainGroups.length} Model Bulundu`;
  const backBtn = $('btnBackToModels');
  if (backBtn) backBtn.classList.add('hidden');

  let html = mainGroups.map(g => `
    <div onclick="renderSmartGroupDetail(window.__lastSmartGroups.find(x=>x.key==='${escJS(g.key)}'))"
         class="bg-surface-container-low border border-primary-container/10 hover:border-primary-container/50
                transition-all group overflow-hidden cursor-pointer flex flex-col">
      <div class="relative h-56 w-full bg-surface-container-lowest flex items-center justify-center p-6">
        ${g.image
          ? `<img src="${g.image}" alt="${g.displayName}" class="w-full h-full object-contain transition-all duration-500 scale-90 group-hover:scale-100 group-hover:grayscale-0 grayscale">`
          : `<span class="material-symbols-outlined text-5xl text-on-surface-variant/30 group-hover:text-on-surface-variant transition-colors">shopping_bag</span>`}
        <div class="absolute top-3 left-3 bg-secondary-container text-on-secondary-container text-[9px] font-black px-2 py-1 uppercase tracking-wider">
          ${g.variantCount > 1 ? `${g.variantCount} Varyant` : 'Model'}
        </div>
        <div class="absolute top-3 right-3 text-[9px] text-on-surface-variant font-bold">${g.sourceCount || g.items?.length || 0} kaynak</div>
      </div>
      <div class="p-5 flex flex-col flex-1">
        <h3 class="font-headline text-lg font-extrabold text-on-surface leading-tight mb-1 line-clamp-2 group-hover:text-primary-container transition-colors">
          ${g.displayName}
        </h3>
        <div class="mt-auto pt-4 flex items-end justify-between border-t border-outline-variant/10">
          <div>
            <p class="text-[9px] uppercase font-bold text-on-surface-variant mb-0.5">Piyasa Başlangıç</p>
            <p class="text-xl font-headline font-extrabold text-secondary">${fTRY(g.lowestPrice)}</p>
          </div>
          <span class="text-[10px] text-primary-container font-bold uppercase tracking-wider group-hover:underline">İncele →</span>
        </div>
      </div>
    </div>`).join('');

  if (accGroup && accGroup.items?.length) {
    html += `
      <div onclick="renderSmartGroupDetail(window.__lastSmartGroups.find(x=>x.key==='__accessories__'))"
           class="bg-surface-container border border-outline-variant/10 hover:border-outline-variant/30
                  transition-all group overflow-hidden cursor-pointer flex flex-col opacity-70 hover:opacity-100">
        <div class="p-5">
          <div class="text-[9px] uppercase font-bold text-on-surface-variant mb-2 tracking-widest">Aksesuar & Kılıf</div>
          <p class="text-sm font-bold text-on-surface">${accGroup.items.length} Aksesuar Ürünü</p>
          <p class="text-lg font-bold text-on-surface-variant mt-1">${fTRY(accGroup.lowestPrice)} den başlayan</p>
        </div>
      </div>`;
  }

  container.innerHTML = html;
  window.__lastSmartGroups = groups;
};

// ─── RENDER: GROUP DETAIL (Variants + Items) ──────────────────────────────────
window.renderSmartGroupDetail = function(group) {
  if (!group) return;
  const container = $('serpResults');
  if (!container) return;

  const titleEl = $('marketResultsTitle');
  if (titleEl) titleEl.textContent = `${group.displayName} — ${group.items?.length || 0} Sonuç`;
  const backBtn = $('btnBackToModels');
  if (backBtn) {
    backBtn.classList.remove('hidden');
    backBtn.querySelector('button').onclick = () => renderSmartGroups(LAST_BROAD_QUERY, LAST_BROAD_GROUPS);
  }

  const items = group.items || [];
  if (!items.length) {
    container.innerHTML = '<div class="col-span-full py-10 text-center text-on-surface-variant">Bu gruba ait ürün bulunamadı.</div>';
    return;
  }

  container.innerHTML = items.map(r => {
    const isLowest = r.priceTRY === group.lowestPrice;
    return `
    <div class="bg-surface-container-low border border-outline-variant/15 hover:border-secondary/30
                transition-all group overflow-hidden flex flex-col">
      <div class="relative h-48 w-full bg-surface-container-lowest flex items-center justify-center p-4">
        ${r.image
          ? `<img src="${r.image}" class="max-h-full object-contain transition-all duration-500 scale-90 group-hover:scale-100">`
          : `<span class="material-symbols-outlined text-4xl text-on-surface-variant/30">image</span>`}
        ${isLowest ? `<div class="absolute top-3 left-3 bg-secondary text-on-secondary text-[9px] font-black px-2 py-1 uppercase">EN UCUZ</div>` : ''}
      </div>
      <div class="p-5 flex flex-col flex-1">
        <div class="flex justify-between items-center mb-2">
          <span class="text-[10px] font-bold uppercase text-on-surface-variant tracking-widest">${r.source || 'Genel'}</span>
          ${r.rating ? `<span class="text-[10px] text-primary-container">★ ${r.rating}</span>` : ''}
        </div>
        <h3 class="text-sm font-body text-on-surface leading-tight mb-2 line-clamp-2" title="${r.name}">${r.name}</h3>
        
        <div class="flex flex-wrap gap-1.5 mb-4 flex-1 content-start">
          ${(() => {
            const tags = [];
            
            // Extract memory/storage
            const memMatch = r.name.match(/\b(\d+)\s?(gb|tb)\b/i);
            if (memMatch) tags.push(`<span class="bg-surface-container-highest text-on-surface text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-sm">${memMatch[0].replace(/\s/g, '')}</span>`);
            
            // Extract typical colors (Turkish and English)
            const colorMatch = r.name.match(/\b(siyah|beyaz|mavi|kırmızı|yeşil|sarı|mor|pembe|grafit|titanyum|gümüş|gece yarısı|yıldız ışığı|black|white|blue|red|green|silver|titanium|midnight|starlight)\b/i);
            if (colorMatch) tags.push(`<span class="bg-primary/15 text-primary-container text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-sm">${colorMatch[0]}</span>`);
            
            // Refurbished warning tag
            if (/yenilenmiş|teşhir|ikinci el|defolu/i.test(r.name)) {
               tags.push(`<span class="bg-error/20 text-error text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-sm border border-error/50">YENİLENMİŞ / KULLANILMIŞ</span>`);
            }
            
            return tags.join('');
          })()}
        </div>
        <div class="mt-auto">
          <p class="text-xl font-headline font-extrabold ${isLowest ? 'text-secondary' : 'text-on-surface'} mb-1">${fTRY(r.priceTRY)}</p>
          ${r.link ? `<a href="${r.link}" target="_blank" class="text-[10px] text-primary hover:underline">Mağazaya git →</a>` : ''}
        </div>
        <button onclick="prefillTracker('${escJS(group.displayName)}',${group.lowestPrice||0},'${escJS(group.query||LAST_BROAD_QUERY||'')}')"
                class="mt-4 w-full bg-secondary/10 border border-secondary/20 text-secondary py-2.5 font-bold uppercase text-[10px] tracking-[0.1em]
                       hover:bg-secondary hover:text-on-secondary transition-all">
          Takibe Al
        </button>
      </div>
    </div>`;
  }).join('');
};

// ─── RENDER: TRACKED PRODUCTS ──────────────────────────────────────────────
function renderTrackedProductsBento() {
  const tStr = 'My Armory (Tracked Products)';
  const tEl = document.getElementById('marketResultsTitle');
  if(tEl) tEl.textContent = tStr;
  const bEl = document.getElementById('btnBackToModels');
  if(bEl) bEl.classList.add('hidden');
  const sEl = document.getElementById('serpQuery');
  if(sEl) sEl.value = '';
  
  const container = document.getElementById('serpResults');
  if(!container)return;
  if(!TRACKED_PRODUCTS.length){
     container.innerHTML='<div class="col-span-full py-16 text-center text-on-surface-variant text-sm border-2 border-dashed border-outline-variant/20">Henüz ürün takip edilmiyor. Piyasa araması yaparak ürün ekleyebilirsiniz.</div>';
     return;
  }
  
  container.innerHTML = TRACKED_PRODUCTS.map(p => {
    const ourPrice=p.our_price||p.ourPrice||0;
    const lowestComp=p.lowest_competitor||p.lowestCompetitor||0;
    const suggested=p.suggested_price||p.suggestedPrice||0;
    
    return `
    <div class="bg-surface-container-low border border-outline-variant/15 hover:border-primary-container/40 transition-all group overflow-hidden">
      <div class="p-6">
        <div class="flex justify-between items-start mb-2">
          <span class="text-[10px] font-bold uppercase text-on-surface-variant tracking-widest">TRACKED</span>
          <span class="text-[10px] ${ourPrice > lowestComp ? 'text-error' : 'text-secondary'} font-bold">${ourPrice > lowestComp ? '▼ BEATEN' : '▲ WINNING'}</span>
        </div>
        <h3 class="text-xl font-headline font-extrabold text-on-surface leading-tight mb-6 truncate" title="${p.name}">${p.name}</h3>
        <div class="grid grid-cols-2 gap-4 mb-6">
          <div class="bg-surface-container p-3 border-b-2 border-primary-container/20">
            <p class="text-[9px] uppercase font-bold text-on-surface-variant mb-1">Our Price</p>
            <p class="text-lg font-headline font-extrabold text-primary-container">${fTRY(ourPrice)}</p>
          </div>
          <div class="bg-surface-container p-3 border-b-2 border-outline-variant/20">
            <p class="text-[9px] uppercase font-bold text-on-surface-variant mb-1">Market Low</p>
            <p class="text-lg font-headline font-extrabold text-on-surface">${fTRY(lowestComp)}</p>
          </div>
        </div>
        <button onclick="openTrackerDetail('${p.id}')" class="w-full bg-surface-container-high border border-primary-container/40 text-primary-container py-3 font-bold uppercase text-[10px] tracking-[0.15em] hover:bg-primary-container hover:text-on-primary-container transition-all sharp-edge">
            View Details
        </button>
      </div>
    </div>`;
  }).join('');
}

function renderTrackerSearchGroups(query,groups){
  document.getElementById('marketResultsTitle').textContent = `Market Results (${groups.length} models)`;
  document.getElementById('btnBackToModels').classList.add('hidden');
  
  $('serpResults').innerHTML= groups.map((g,idx)=>`
    <div class="bg-surface-container-low border border-outline-variant/15 hover:border-primary-container/40 transition-all group overflow-hidden">
      <div class="relative h-64 w-full bg-surface-container-lowest flex items-center justify-center p-8">
        ${g.image ? `<img src="${g.image}" alt="${g.displayName||query}" class="w-full h-full object-contain grayscale group-hover:grayscale-0 transition-all duration-500 scale-90 group-hover:scale-100">` : `<div class="text-4xl text-on-surface-variant">🛒</div>`}
        <div class="absolute top-4 right-4 bg-secondary-container text-on-secondary-container text-[9px] font-black px-2 py-1 uppercase tracking-tighter">Model</div>
      </div>
      <div class="p-6">
        <h3 class="text-xl font-headline font-extrabold text-on-surface leading-tight mb-6 truncate">${g.displayName||g.sampleNames?.[0]||query}</h3>
        <div class="grid grid-cols-2 gap-4 mb-6">
          <div class="bg-surface-container p-3 border-b-2 border-primary-container/20">
            <p class="text-[9px] uppercase font-bold text-on-surface-variant mb-1">Market Low</p>
            <p class="text-lg font-headline font-extrabold text-primary-container">${fTRY(g.lowestPrice)}</p>
          </div>
          <div class="bg-surface-container p-3 border-b-2 border-outline-variant/20">
            <p class="text-[9px] uppercase font-bold text-on-surface-variant mb-1">Competitors</p>
            <p class="text-lg font-headline font-extrabold text-on-surface">${g.items.length}</p>
          </div>
        </div>
        <button onclick="doSerpSearch('${escJS(g.displayName||g.sampleNames?.[0]||query)}', true)" class="w-full bg-surface-container-high border border-primary-container/40 text-primary-container py-3 font-bold uppercase text-[10px] tracking-[0.15em] hover:bg-primary-container hover:text-on-primary-container transition-all sharp-edge">
            Analyze Market
        </button>
      </div>
    </div>`).join('');
}

function renderTrackerSearchGroupDetail(idx){
  const group=LAST_TRACKER_MODEL_GROUPS[idx];
  if(!group)return;
  
  document.getElementById('marketResultsTitle').textContent = `Target: ${group.displayName||LAST_TRACKER_SEARCH?.query||''}`;
  document.getElementById('btnBackToModels').classList.remove('hidden');

  $('serpResults').innerHTML= group.items.map(r=>`
    <div class="bg-surface-container-low border border-outline-variant/15 hover:border-primary-container/40 transition-all group overflow-hidden">
      <div class="relative h-48 w-full bg-surface-container-lowest flex items-center justify-center p-4 content-center">
        ${r.image ? `<img src="${r.image}" class="max-h-full object-contain grayscale group-hover:grayscale-0 transition-all duration-500 scale-90 group-hover:scale-100">` : `<div class="text-3xl text-on-surface-variant">🛒</div>`}
      </div>
      <div class="p-6">
        <div class="flex justify-between items-start mb-2">
          <span class="text-[10px] font-bold uppercase text-on-surface-variant tracking-widest">${r.source}</span>
          ${r.priceTRY===group.lowestPrice?'<span class="bg-secondary-container text-on-secondary-container text-[9px] px-2 py-0.5 rounded-full font-bold">BEST PRICE</span>':''}
        </div>
        <h3 class="text-sm font-body font-bold text-on-surface leading-tight mb-4 line-clamp-2" title="${r.name}">${r.name}</h3>
        <div class="flex flex-col mb-4">
          <p class="text-xl font-headline font-extrabold ${r.priceTRY===group.lowestPrice?'text-secondary':'text-on-surface'}">${fTRY(r.priceTRY)}</p>
          ${r.link?`<a href="${r.link}" target="_blank" class="text-[10px] text-primary hover:underline mt-1">Go to Store →</a>`:''}
        </div>
        <button onclick="prefillTracker('${escJS(group.displayName||LAST_TRACKER_SEARCH?.query||'')}',${group.lowestPrice||0},'${escJS(group.query||LAST_TRACKER_SEARCH?.query||'')}')" class="w-full bg-secondary text-on-secondary-fixed py-3 font-bold uppercase text-[10px] tracking-[0.15em] hover:brightness-110 transition-all sharp-edge">
            Track Product
        </button>
      </div>
    </div>`).join('');
}
async function quickExportTrackerCandidate(platformId,groupIdx){
  const group=LAST_TRACKER_MODEL_GROUPS[groupIdx];
  if(!group)return;
  try{
    const r=await(await fetch(API+'/api/platforms/'+platformId+'/import-tracker-product',{method:'POST',headers:hdr(),body:JSON.stringify({
      product:{
        id:'srch_'+Date.now(),
        name:group.displayName||group.sampleNames?.[0]||LAST_TRACKER_SEARCH?.query||'Ürün',
        image:group.image||null,
        query:group.query||LAST_TRACKER_SEARCH?.query||'',
        priceTRY:group.lowestPrice||0
      }
    })})).json();
    if(r.error)throw new Error(r.error);
    alert('Ürün platforma aktarıldı: '+fTRY(r.priceTRY||group.lowestPrice||0));
  }catch(e){alert('Aktarım hatası: '+e.message);}
}
async function doSerpSearch(overrideQuery=null, isModelInspect=false){
  const q= overrideQuery || $('serpQuery').value.trim();
  if(!q)return;
  $('serpQuery').value = q;
  $('serpResults').innerHTML='<div class="py-8 text-center text-secondary text-xs animate-pulse">Google Shopping TR taranıyor...</div>';
  try{
    const d=await(await fetch(API+'/api/tracker/search',{method:'POST',headers:hdr(),body:JSON.stringify({query:q})})).json();
    if(d.error){$('serpResults').innerHTML=`<div class="py-4 text-center text-error text-sm">${d.error}</div>`;return;}
    if(!d.results?.length){$('serpResults').innerHTML='<div class="py-4 text-center text-on-surface-variant text-sm">Sonuç bulunamadı.</div>';return;}
    LAST_TRACKER_SEARCH=d;
    LAST_TRACKER_MODEL_GROUPS=groupTrackerSearchResults(d.results,q);
    
    if(!isModelInspect) {
      LAST_BROAD_QUERY = q;
      LAST_BROAD_GROUPS = [...LAST_TRACKER_MODEL_GROUPS];
    }
    
    if(LAST_TRACKER_MODEL_GROUPS.length<=1 || isModelInspect){
      renderTrackerSearchGroupDetail(0);
      return;
    }
    renderTrackerSearchGroups(q,LAST_TRACKER_MODEL_GROUPS);
  }catch(e){$('serpResults').innerHTML=`<div class="py-4 text-center text-error text-sm">${e.message}</div>`;}
}

async function prefillTracker(name,price,searchQuery){
  const bn = window.event ? window.event.currentTarget : null;
  if(bn){ bn.disabled=true; bn.innerHTML='Takip Ediliyor...'; }
  try {
    const d = await(await fetch(API+'/api/tracker/products',{
      method:'POST',
      headers:hdr(),
      body:JSON.stringify({
        name: name,
        searchQuery: searchQuery || name,
        ourPrice: Math.round((price||0)*0.98),
        costPrice: Math.round((price||0)*0.8),
        platformId: null,
        rules: { beatByAmount: 1, minMarginPercent: 5, maxDropPercent: 30 }
      })
    })).json();
    if(d.error) throw new Error(d.error);
    
    await loadTrackedProducts();
    openTrackerDetail(d.product.id);
  } catch(e) {
    alert('Ekleme Hatası: ' + e.message);
    if(bn){ bn.disabled=false; bn.innerHTML='Track Product'; }
  }
}

async function createTrackedPlatformProduct(id, platformId=null){
  try{
    const bodyArgs = platformId ? { platformId } : {};
    const r=await(await fetch(API+'/api/tracker/products/'+id+'/create-platform-product',{method:'POST',headers:hdr(),body:JSON.stringify(bodyArgs)})).json();
    if(r.error)throw new Error(r.error);
    alert('Platform ürünü oluşturuldu ve bağlandı. Bundan sonra anlık fiyat güncellemesi yapılabilir.');
    loadTrackedProducts();
    openTrackerDetail(id);
  }catch(e){alert('Oluşturma hatası: '+e.message);}
}
async function pushTrackedPrice(id,price){
  try{
    const r=await(await fetch(API+'/api/tracker/products/'+id+'/push',{method:'POST',headers:hdr(),body:JSON.stringify({price})})).json();
    if(r.error)throw new Error(r.error);
    alert('Fiyat platforma gönderildi: '+fTRY(price));
    loadTrackedProducts();
    openTrackerDetail(id);
  }catch(e){alert('Push hatası: '+e.message);}
}

async function addTrackedProduct(){
  const name=$('trAddName').value.trim();if(!name){alert('Ürün adı girin!');return;}
  const msg=$('trAddMsg');showMsg(msg,'Takibe alınıyor, rakipler taranıyor...','info');
  try{
    const d=await(await fetch(API+'/api/tracker/products',{method:'POST',headers:hdr(),body:JSON.stringify({
      name,
      searchQuery:$('trAddQuery').value.trim()||name,
      ourPrice:parseFloat($('trAddPrice').value)||0,
      costPrice:parseFloat($('trAddCost').value)||0,
      platformId:$('trAddPlatform').value||null,
      rules:{
        beatByAmount:parseFloat($('trAddBeat').value)||0.10,
        minMarginPercent:parseFloat($('trAddMargin').value)||5,
        maxDropPercent:parseFloat($('trAddMaxDrop').value)||30
      }
    })})).json();
    if(d.error)throw new Error(d.error);
    showMsg(msg,'✓ Takibe alındı — '+d.product?.competitorCount+' rakip bulundu','success');
    setTimeout(()=>{closeM('mTrackerAdd');loadTrackedProducts();},1000);
  }catch(e){showMsg(msg,'Hata: '+e.message,'error');}
}

async function scanProduct(id){
  const row=document.querySelector(`tr[onclick*="${id}"]`);
  if(row)row.style.opacity='0.5';
  try{
    await fetch(API+'/api/tracker/products/'+id+'/scan',{method:'POST',headers:hdr(),body:'{}'});
    loadTrackedProducts();
  }catch(e){alert(e.message);}
  if(row)row.style.opacity='1';
}

async function deleteTracked(id){
  if(!confirm('Takipten kaldırılsın mı?'))return;
  await fetch(API+'/api/tracker/products/'+id,{method:'DELETE'});
  loadTrackedProducts();
}

let currentDetailId = null;
function showPage(p) { go(p); }

async function openTrackerDetail(id){
  currentDetailId = id;
  showPage('market-detail');
  $('detStatus').textContent = 'Loading...';
  
  try{
    const p=await(await fetch(API+'/api/tracker/products/'+id)).json();
    if(p.error)throw new Error(p.error);
    
    const competitors=p.last_competitors||p.lastCompetitors||[];
    const history=p.price_history||p.priceHistory||[];
    const ourPrice=p.our_price||p.ourPrice||0;
    const lowestComp=p.lowest_competitor||p.lowestCompetitor||0;
    const suggested=p.suggested_price||p.suggestedPrice||0;
    const lastScan=p.last_scan_at||p.lastScanAt;
    const searchQ=p.search_query||p.searchQuery||p.name;
    const isBelow=(lowestComp&&ourPrice&&lowestComp<ourPrice);
    
    const hasPlatformLink = !!(p.platform_id || p.platformId);
    const hasCreatedPlatformProduct = !!(p.platform_product_id || p.platformProductId);
    const activeIkas = findFirstPlatformByType('ikas');
    const activeShopify = findFirstPlatformByType('shopify');
    
    // Core info
    $('detStatus').textContent = p.auto_sync ? 'Active Monitoring' : 'Idle Monitoring';
    $('detName').textContent = p.name;
    $('detSku').textContent = 'SKU: ' + id;
    $('detQuery').textContent = `Search Query: "${searchQ}"`;
    $('detLowPrice').textContent = fTRY(lowestComp);
    $('detOurPrice').textContent = fTRY(ourPrice);
    $('detSuggPrice').textContent = 'Sugg: ' + fTRY(suggested);
    
    if(ourPrice && lowestComp) {
       const spread = ((lowestComp - ourPrice) / ourPrice * 100).toFixed(1);
       const span = $('detLowSpread');
       span.textContent = spread + '%';
       span.className = `text-xs font-bold ${spread > 0 ? 'text-secondary' : 'text-error'}`;
    }

    // Images
    const imgs = new Set();
    if (competitors[0] && competitors[0].image) imgs.add(competitors[0].image);
    competitors.forEach(c => { if(c.image) imgs.add(c.image); });
    const imgArr = Array.from(imgs);
    
    if(imgArr.length > 0) {
       $('detImg').src = imgArr[0];
       // Build Gallery
       $('detImgGallery').innerHTML = imgArr.map(src => `<div class="shrink-0 w-16 h-16 bg-surface-container border border-outline-variant/20 hover:border-primary-container p-1 cursor-pointer transition-colors" onclick="document.getElementById('detImg').src='${src}'"><img src="${src}" class="w-full h-full object-contain mix-blend-lighten"></div>`).join('');
    } else {
       $('detImg').src = "https://lh3.googleusercontent.com/aida-public/AB6AXuDI12gOVw9kEKeSzHuMBdTVa8cT2ALvTCL2DDBuENWaDuCMmNPd72j5ReEPIknpfY6JKE-UXRZreqyX1O7cR1y4WkK9QjO77Av0l-iQQepPrMky7nhY9kl4dnSAzoaDSQmcUPloY23Veol8xTgtWO6mVUlMPUDVZxYFXBAerb33JuIDAJ_b4qIpAYLb30NYMIa-Uupz7Qhefa7KyK9o-7Bm-e-zKCVAZh_WRw2T6-xxoIPR-1qkYp-EPzzcl4maXlh75fFCqx0bwts"; // fallback
       $('detImgGallery').innerHTML = '';
    }

    // Dynamic SKU / GB / Custom Tags Evaluator
    const tags = new Set();
    const gbPattern = /\\b(\\d+)\\s?(gb|tb|mb)\\b/gi;
    const colorPattern = /\\b(Siyah|Beyaz|Mavi|Kırmızı|Yeşil|Sarı|Mor|Pembe|Grafit|Titanyum|Black|White|Blue|Red|Green)\\b/gi;
    competitors.forEach(c => {
       const mGB = c.name.match(gbPattern);
       if(mGB) mGB.forEach(m => tags.add(m.toUpperCase().replace(/\\s/g,''))); // '128 GB' -> '128GB'
       const mCol = c.name.match(colorPattern);
       if(mCol) mCol.forEach(m => tags.add(titleCaseTR(m)));
    });
    
    if(tags.size > 0) {
       $('detTags').innerHTML = Array.from(tags).map(t => `<span class="bg-primary/10 border border-primary/20 text-primary-container px-2 py-1 text-[10px] font-bold uppercase tracking-widest">${t}</span>`).join('');
    } else {
       $('detTags').innerHTML = '';
    }

    $('detLastSync').textContent = lastScan ? new Date(lastScan).toLocaleTimeString('tr-TR') : 'Never';
    
    // Market Compare Table
    $('detTableBody').innerHTML = competitors.map(c => `
      <tr class="bg-surface hover:bg-surface-bright/10 transition-colors">
        <td class="px-6 py-4 font-semibold text-white">${c.source||c.platform}</td>
        <td class="px-4 py-4 text-right text-secondary font-mono">${fTRY(c.priceTRY)}</td>
        <td class="px-4 py-4 text-center">
          ${c.link?`<a href="${c.link}" target="_blank" class="text-primary hover:underline">Link</a>`:'-'}
        </td>
      </tr>
    `).join('');

    // Chart Update
    const ctx=$('trackerChart');
    if(window._chartInst) window._chartInst.destroy();
    if(history.length>1 && ctx){
        const labels=history.map(h=>new Date(h.ts).toLocaleDateString('tr-TR',{day:'numeric',month:'short'}));
        window._chartInst = new Chart(ctx,{type:'line',data:{labels,datasets:[
          {label:'Market Low',data:history.map(h=>h.lowestPrice),borderColor:'#ef4444',borderWidth:2,tension:.4,pointRadius:2,fill:false},
          {label:'Avg Price',data:history.map(h=>h.avgPrice),borderColor:'#4edea3',borderWidth:2,tension:.4,pointRadius:2,fill:false,borderDash:[5,3]}
        ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:true,labels:{color:'#a08e7a',font:{size:10}}}},scales:{x:{grid:{display:false},ticks:{font:{size:9},color:'#a08e7a'}},y:{grid:{color:'rgba(83,68,52,.15)'},ticks:{font:{size:9},color:'#a08e7a',callback:v=>v.toLocaleString('tr-TR')+'₺'}}}}});
    }

    // Shopify / Ikas sync setup
    if(!activeShopify) {
       $('detShopifyStatus').textContent = "Not connected";
       $('detShopifyAction').innerHTML = `<button onclick="go('integrations')" class="text-[10px] text-outline underline">Connect</button>`;
    } else {
       $('detShopifyStatus').textContent = `Connected`;
       if(hasCreatedPlatformProduct) {
           $('detShopifyAction').innerHTML = `<button onclick="pushTrackedPrice('${p.id}',${suggested})" class="bg-surface-container-high text-secondary font-bold px-4 py-2 text-[10px] uppercase tracking-widest border-b border-secondary hover:bg-surface-container-highest transition-all">Publish ${fTRY(suggested)}</button>`;
       } else {
           $('detShopifyAction').innerHTML = `<button onclick="createTrackedPlatformProduct('${p.id}', '${activeShopify.id}')" class="bg-surface-container-high text-primary font-bold px-4 py-2 text-[10px] uppercase tracking-widest border-b border-primary hover:bg-surface-container-highest transition-all">Create Product</button>`;
       }
    }

    if(!activeIkas) {
       $('detIkasStatus').textContent = "Not connected";
       $('detIkasAction').innerHTML = `<button onclick="go('integrations')" class="text-[10px] text-outline underline">Connect</button>`;
    } else {
       $('detIkasStatus').textContent = `Connected`;
       if(hasCreatedPlatformProduct) {
           $('detIkasAction').innerHTML = `<button onclick="pushTrackedPrice('${p.id}',${suggested})" class="bg-surface-container-high text-secondary font-bold px-4 py-2 text-[10px] uppercase tracking-widest border-b border-secondary hover:bg-surface-container-highest transition-all">Publish ${fTRY(suggested)}</button>`;
       } else {
           $('detIkasAction').innerHTML = `<button onclick="createTrackedPlatformProduct('${p.id}', '${activeIkas.id}')" class="bg-surface-container-high text-primary font-bold px-4 py-2 text-[10px] uppercase tracking-widest border-b border-primary hover:bg-surface-container-highest transition-all">Create Product</button>`;
       }
    }

  }catch(e){console.error(e);}
}
