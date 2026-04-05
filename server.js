const express = require('express');
const cors    = require('cors');
const fetch   = require('node-fetch');
const path    = require('path');
const fs      = require('fs');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
const PORT = process.env.PORT || 3001;

// ═══════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════
const PRICECHARTING_TOKEN  = process.env.PRICECHARTING_TOKEN  || '';
const EBAY_APP_ID          = process.env.EBAY_APP_ID          || '';
const EBAY_CERT_ID         = process.env.EBAY_CERT_ID         || '';
const SUPABASE_URL         = process.env.SUPABASE_URL         || '';
const SUPABASE_SECRET_KEY  = process.env.SUPABASE_SECRET_KEY  || '';
const SUPABASE_PUBLISHABLE = process.env.SUPABASE_PUBLISHABLE_KEY || '';
const SERPAPI_KEY          = process.env.SERPAPI_KEY           || '';

const hasPriceCharting = !!PRICECHARTING_TOKEN;
const hasEbayBrowse    = !!EBAY_APP_ID && !!EBAY_CERT_ID;
const hasSupabase      = !!SUPABASE_URL && !!SUPABASE_SECRET_KEY;
const hasSerpAPI       = !!SERPAPI_KEY;

// ═══════════════════════════════════════════
// SUPABASE HELPER
// ═══════════════════════════════════════════
async function sbQuery(table, method = 'GET', body = null, filter = '') {
  if (!hasSupabase) throw new Error('Supabase yapılandırılmamış');
  const url  = `${SUPABASE_URL}/rest/v1/${table}${filter}`;
  const opts = {
    method,
    headers: {
      'Content-Type':  'application/json',
      'apikey':        SUPABASE_SECRET_KEY,
      'Authorization': 'Bearer ' + SUPABASE_SECRET_KEY,
      'Prefer':        method === 'POST' ? 'return=representation' : method === 'PATCH' ? 'return=representation' : ''
    }
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(url, opts);
  if (!r.ok) { const e = await r.text(); throw new Error(`Supabase ${method} ${table}: ${e}`); }
  const txt = await r.text();
  return txt ? JSON.parse(txt) : [];
}

async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Giriş yapmanız gerekiyor' });
  const token = authHeader.split(' ')[1];
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': SUPABASE_PUBLISHABLE, 'Authorization': 'Bearer ' + token }
    });
    if (!r.ok) throw new Error('Geçersiz token');
    const user = await r.json();
    req.userId    = user.id;
    req.userEmail = user.email;
    next();
  } catch(e) {
    res.status(401).json({ error: 'Oturum süresi doldu' });
  }
}

async function getPlatformForUser(platformId, userId) {
  if (hasSupabase) {
    const rows = await sbQuery('platforms', 'GET', null, `?id=eq.${platformId}&user_id=eq.${userId}`);
    if (!rows.length) throw new Error('Platform bulunamadı');
    return rows[0];
  }
  const p = db.getPlatform(platformId);
  if (!p) throw new Error('Platform bulunamadı');
  return p;
}

// ═══════════════════════════════════════════
// JSON DB (Supabase yoksa fallback)
// ═══════════════════════════════════════════
const DB_FILE = 'pricebot-data.json';
function loadDB() {
  try { if (fs.existsSync(DB_FILE)) return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch(e) {}
  return { platforms: [], logs: [], trackedProducts: [] };
}
function saveDB(data) {
  try { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)); } catch(e) {}
}
let DB = loadDB();
if (!DB.trackedProducts) DB.trackedProducts = [];

const db = {
  getPlatforms:   ()   => DB.platforms,
  getPlatform:    (id) => DB.platforms.find(p => p.id === id),
  savePlatform:   (p)  => { const i = DB.platforms.findIndex(x => x.id === p.id); if(i>=0) DB.platforms[i]=p; else DB.platforms.push(p); saveDB(DB); },
  deletePlatform: (id) => { DB.platforms = DB.platforms.filter(p => p.id !== id); saveDB(DB); },
  getLogs:        (pid, lim=100) => { let l = pid ? DB.logs.filter(x=>x.platform_id===pid) : DB.logs; return l.slice(-lim).reverse(); },
  addLog:         (pid, type, msg, lvl) => { DB.logs.push({id:Date.now(),platform_id:pid,type,message:msg,level:lvl,created_at:new Date().toISOString()}); if(DB.logs.length>1000) DB.logs=DB.logs.slice(-500); saveDB(DB); },
  // Price Tracker DB
  getTrackedProducts: (userId) => DB.trackedProducts.filter(p => p.user_id === userId),
  getTrackedProduct:  (id, userId) => DB.trackedProducts.find(p => p.id === id && p.user_id === userId),
  saveTrackedProduct: (p) => { const i = DB.trackedProducts.findIndex(x => x.id === p.id); if(i>=0) DB.trackedProducts[i]=p; else DB.trackedProducts.push(p); saveDB(DB); },
  deleteTrackedProduct: (id) => { DB.trackedProducts = DB.trackedProducts.filter(p => p.id !== id); saveDB(DB); }
};

function normalizeTrackedProduct(p) {
  if (!p) return null;
  return {
    ...p,
    search_query: p.searchQuery !== undefined ? p.searchQuery : p.search_query,
    our_price: p.ourPrice !== undefined ? p.ourPrice : p.our_price,
    cost_price: p.costPrice !== undefined ? p.costPrice : p.cost_price,
    platform_id: p.platformId !== undefined ? p.platformId : p.platform_id,
    platform_product_id: p.platformProductId !== undefined ? p.platformProductId : p.platform_product_id,
    platform_variant_id: p.platformVariantId !== undefined ? p.platformVariantId : p.platform_variant_id,
    suggested_price: p.suggestedPrice !== undefined ? p.suggestedPrice : p.suggested_price,
    lowest_competitor: p.lowestCompetitor !== undefined ? p.lowestCompetitor : p.lowest_competitor,
    last_competitors: p.lastCompetitors !== undefined ? p.lastCompetitors : p.last_competitors,
    price_history: p.priceHistory !== undefined ? p.priceHistory : p.price_history,
    last_scan_at: p.lastScanAt !== undefined ? p.lastScanAt : p.last_scan_at,
    competitor_count: p.competitorCount !== undefined ? p.competitorCount : p.competitor_count,
    auto_sync: p.autoSync !== undefined ? p.autoSync : p.auto_sync,
    scheduler_minutes: p.schedulerMinutes !== undefined ? p.schedulerMinutes : p.scheduler_minutes
  };
}

function sbPatchPayload(updates) {
  const norm = normalizeTrackedProduct(updates);
  const allowed = ['id','user_id','name','search_query','our_price','cost_price','platform_id','rules','suggested_price','lowest_competitor','last_competitors','price_history','last_scan_at','competitor_count','auto_sync','scheduler_minutes','platform_product_id','platform_variant_id'];
  const res = {};
  for (const k of allowed) {
    if (norm[k] !== undefined) res[k] = norm[k];
  }
  return res;
}

console.log(`✅ DB hazır — Supabase: ${hasSupabase ? 'aktif' : 'JSON fallback'}`);

function addLog(platformId, type, message, level = 'info') {
  console.log(`[${level.toUpperCase()}][${type}] ${message}`);
  if (!hasSupabase) db.addLog(platformId || 'system', type, message, level);
}

// ═══════════════════════════════════════════
// KATEGORİ STRATEJİLERİ
// ═══════════════════════════════════════════
const STRATEGIES = {
  pokemon:    { keywords:['pokemon','pokémon','pikachu','charizard','scarlet','violet','paldea','booster','surging','stellar','temporal'], marginAboveGlobal:15, maxRaise:40, maxDrop:20, minMargin:20 },
  naruto:     { keywords:['naruto','kayou','sasuke','itachi'],            marginAboveGlobal:20, maxRaise:35, maxDrop:15, minMargin:25 },
  onepiece:   { keywords:['one piece','op-0','luffy','zoro'],             marginAboveGlobal:12, maxRaise:30, maxDrop:20, minMargin:18 },
  magic:      { keywords:['magic','mtg','commander','gathering'],         marginAboveGlobal:10, maxRaise:25, maxDrop:15, minMargin:15 },
  yugioh:     { keywords:['yu-gi-oh','yugioh','ygo'],                     marginAboveGlobal:18, maxRaise:35, maxDrop:15, minMargin:20 },
  dragonball: { keywords:['dragon ball','dragonball','dbs','goku'],       marginAboveGlobal:20, maxRaise:40, maxDrop:20, minMargin:22 },
  digimon:    { keywords:['digimon','dgm'],                               marginAboveGlobal:22, maxRaise:40, maxDrop:20, minMargin:25 },
  default:    { keywords:[],                                              marginAboveGlobal:15, maxRaise:30, maxDrop:15, minMargin:15 }
};
function detectCategory(name='') {
  const l = name.toLowerCase();
  for (const [cat,cfg] of Object.entries(STRATEGIES)) {
    if (cat==='default') continue;
    if (cfg.keywords.some(k=>l.includes(k))) return cat;
  }
  return 'default';
}

// ═══════════════════════════════════════════
// DÖVİZ KURU
// ═══════════════════════════════════════════
let ratesCache = { USD:38.5, EUR:41.8, GBP:47.2, updatedAt:'fallback' };
let ratesCachedAt = 0;
async function refreshRates() {
  if (Date.now()-ratesCachedAt < 10*60*1000) return ratesCache;
  try {
    const d = await (await fetch('https://open.er-api.com/v6/latest/TRY',{signal:AbortSignal.timeout(5000)})).json();
    ratesCache = { USD:+(1/d.rates.USD).toFixed(4), EUR:+(1/d.rates.EUR).toFixed(4), GBP:+(1/d.rates.GBP).toFixed(4), updatedAt:new Date().toISOString() };
    ratesCachedAt = Date.now();
  } catch(e) {}
  return ratesCache;
}

// ═══════════════════════════════════════════
// SERPAPI — GOOGLE SHOPPING TR
// ═══════════════════════════════════════════
const serpCache = new Map();

async function serpAPISearch(query, location = 'Turkey') {
  if (!hasSerpAPI) return { results: [], error: 'SerpAPI key yok' };
  
  const cKey = query.toLowerCase().trim();
  const cached = serpCache.get(cKey);
  if (cached && Date.now() - cached.ts < 30 * 60 * 1000) return cached.data;

  try {
    const params = new URLSearchParams({
      engine: 'google_shopping',
      q: query,
      gl: 'tr',
      hl: 'tr',
      location: location,
      api_key: SERPAPI_KEY
    });
    const r = await fetch(`https://serpapi.com/search.json?${params}`, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`SerpAPI ${r.status}`);
    const d = await r.json();

    const results = (d.shopping_results || []).map(item => {
      const priceStr = (item.extracted_price || item.price || '').toString().replace(/[^\d.,]/g, '').replace(',', '.');
      const priceTRY = parseFloat(priceStr) || 0;
      
      // Platform tespiti
      let platform = 'other';
      const src = (item.source || '').toLowerCase();
      if (src.includes('trendyol')) platform = 'trendyol';
      else if (src.includes('hepsiburada')) platform = 'hepsiburada';
      else if (src.includes('amazon')) platform = 'amazon';
      else if (src.includes('n11')) platform = 'n11';
      else if (src.includes('cimri')) platform = 'cimri';
      else if (src.includes('akakce') || src.includes('akakçe')) platform = 'akakce';
      else if (src.includes('incehesap')) platform = 'incehesap';
      else if (src.includes('gittigidiyor')) platform = 'gittigidiyor';
      else if (src.includes('çiçeksepeti') || src.includes('ciceksepeti')) platform = 'ciceksepeti';

      return {
        id: item.product_id || `serp-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
        name: item.title || query,
        priceTRY,
        priceFormatted: item.price || `${priceTRY}₺`,
        platform,
        source: item.source || 'Bilinmeyen',
        link: item.link || item.product_link || null,
        image: item.thumbnail || null,
        rating: item.rating || null,
        reviews: item.reviews || null,
        delivery: item.delivery || null,
        badge: item.tag || null
      };
    }).filter(r => r.priceTRY > 0);

    const data = {
      results,
      totalResults: results.length,
      lowestPrice: results.length ? Math.min(...results.map(r => r.priceTRY)) : null,
      lowestSeller: results.length ? results.reduce((a, b) => a.priceTRY < b.priceTRY ? a : b) : null,
      avgPrice: results.length ? Math.round(results.reduce((s, r) => s + r.priceTRY, 0) / results.length) : null,
      platforms: [...new Set(results.map(r => r.platform))],
      query,
      searchedAt: new Date().toISOString()
    };

    serpCache.set(cKey, { data, ts: Date.now() });
    return data;
  } catch(e) {
    return { results: [], error: e.message, query };
  }
}

// ═══════════════════════════════════════════
// AKILLI ÜRÜN MODEL ÇIKARIMI & VARYANT
// ═══════════════════════════════════════════
const ACCESSORY_KEYWORDS = ['kılıf','kilif','case','cover','kapak','koruyucu','koruma','protector','screen','cam','tempered','kablo','cable','charger','şarj','sarj','adaptör','adapter','adaptor','silikon','deri','leather','cüzdan','wallet','stand','mount','tutucu','holder','askı','kayış','strap','band','popsocket','sticker','çıkartma','skin','folio','pouch','çanta','bag','powerbank','güç','batarya','battery','yedek','replacement','onarım','repair','aksesuar','accessory','araç','car','oto','dock','hub','dongle','otg','splitter','switch','extender','uzatma','çevirici','converter'];
const COLOR_KEYWORDS = ['siyah','black','beyaz','white','mavi','blue','kırmızı','red','yeşil','green','sarı','yellow','mor','purple','pembe','pink','gri','grey','gray','gümüş','silver','altın','gold','turuncu','orange','bej','beige','lacivert','navy','turkuaz','turquoise','bordo','burgundy','krem','cream','titan','titanium','titanyum','grafit','graphite','bronze','bakır','copper','indigo','lavanta','lavender','midnight','starlight','space gray','space grey','desert','natural','blue titanium','black titanium','white titanium','natural titanium','desert titanium'];
const STORAGE_REGEX = /\b(\d+)\s?(gb|tb|mb)\b/gi;
const RAM_REGEX = /\b(\d+)\s?gb\s?(ram)\b/gi;
const SIZE_REGEX = /\b(\d+(?:[.,]\d+)?)\s?(inç|inch|"|cm|mm)\b/gi;

function extractProductModel(name = '', queryHint = '') {
  const original = name;
  let s = name.toLowerCase().replace(/\s+/g, ' ').trim();
  const q = queryHint.toLowerCase().trim();

  // Detect if it's an accessory
  const isAccessory = ACCESSORY_KEYWORDS.some(kw => s.includes(kw)) && !ACCESSORY_KEYWORDS.some(kw => q.includes(kw));

  // Extract variants
  const variants = {};
  
  // Color
  const foundColors = [];
  for (const c of COLOR_KEYWORDS) {
    if (s.includes(c)) foundColors.push(c.charAt(0).toUpperCase() + c.slice(1));
  }
  if (foundColors.length) variants.color = foundColors[0];
  
  // Storage
  const storageMatch = s.match(STORAGE_REGEX);
  if (storageMatch) {
    const storages = storageMatch.map(m => m.toUpperCase().replace(/\s/g, ''));
    // Pick the one most likely to be storage (not RAM)
    const ramMatch = s.match(RAM_REGEX);
    const ramValues = ramMatch ? ramMatch.map(m => m.toUpperCase().replace(/\s/g, '')) : [];
    const storageOnly = storages.filter(st => !ramValues.some(r => r.startsWith(st.replace('GB','').replace('TB',''))));
    if (storageOnly.length) variants.storage = storageOnly[0];
    if (ramValues.length) variants.ram = ramValues[0];
  }

  // Size
  const sizeMatch = s.match(SIZE_REGEX);
  if (sizeMatch) variants.size = sizeMatch[0].replace(/\s/g, '');

  // Extract brand + model key
  // Remove known noise words
  const noiseWords = new Set([
    'fiyat','fiyatı','fiyatları','satın','al','resmi','orijinal','original','genuine','official',
    'garantili','ithalatçı','distribütör','türkiye','turkey','edition','sürüm','version',
    'amazon','trendyol','hepsiburada','n11','cimri','akakce','teknosa','a101','mediamarkt',
    'com','tr','www','https','http','indirim','kampanya','fırsat','deal','sale','outlet',
    'ücretsiz','kargo','free','shipping','hediye','gift','bonus','kutu','box','paket','set',
    'adet','pcs','li','lu','lü','lı','stok','stock','yeni','new','son','latest','model',
    'ürün','product','mağaza','store','satıcı','seller','tedarik','supply','sipariş','order',
    've','and','ile','with','için','for','veya','or','the','a','an','de','da','den','dan'
  ]);

  // Clean up for model extraction
  let cleaned = s
    .replace(/[()[\]{}'"!?.,;:\/\\|@#$%^&*+=~`<>]/g, ' ')
    .replace(/\b\d+(?:[.,]\d+)?\s?(tl|₺|lira|try)\b/gi, '')
    .replace(STORAGE_REGEX, ' ')
    .replace(SIZE_REGEX, ' ');

  // Remove colors from model key
  for (const c of COLOR_KEYWORDS) {
    cleaned = cleaned.replace(new RegExp('\\b' + c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi'), ' ');
  }
  // Remove accessory keywords
  for (const kw of ACCESSORY_KEYWORDS) {
    cleaned = cleaned.replace(new RegExp('\\b' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi'), ' ');
  }

  const tokens = cleaned.split(/\s+/).filter(t => t.length > 1 && !noiseWords.has(t));
  
  // Take first 3-4 meaningful tokens as the model key
  const modelTokens = tokens.slice(0, 4);
  const modelKey = modelTokens.join(' ').trim() || 'Diğer';

  return {
    original,
    modelKey,
    displayName: modelTokens.map(t => t.charAt(0).toUpperCase() + t.slice(1)).join(' '),
    isAccessory,
    variants,
    variantKey: Object.values(variants).join(' | ') || 'Standart'
  };
}

function groupSearchResults(results = [], query = '') {
  const modelMap = new Map();
  const accessoryGroup = { key: '__accessories__', displayName: 'Kılıf & Aksesuar', items: [], variants: new Map(), images: [], lowestPrice: Infinity, highestPrice: 0 };

  for (const item of results) {
    const parsed = extractProductModel(item.name || '', query);
    
    if (parsed.isAccessory) {
      accessoryGroup.items.push({ ...item, _parsed: parsed });
      if (item.priceTRY && item.priceTRY < accessoryGroup.lowestPrice) accessoryGroup.lowestPrice = item.priceTRY;
      if (item.priceTRY && item.priceTRY > accessoryGroup.highestPrice) accessoryGroup.highestPrice = item.priceTRY;
      if (item.image) accessoryGroup.images.push(item.image);
      continue;
    }

    const key = parsed.modelKey;
    if (!modelMap.has(key)) {
      modelMap.set(key, {
        key,
        displayName: parsed.displayName,
        items: [],
        variants: new Map(),
        images: [],
        lowestPrice: Infinity,
        highestPrice: 0
      });
    }

    const group = modelMap.get(key);
    group.items.push({ ...item, _parsed: parsed });
    if (item.image && !group.images.includes(item.image)) group.images.push(item.image);
    if (item.priceTRY && item.priceTRY < group.lowestPrice) group.lowestPrice = item.priceTRY;
    if (item.priceTRY && item.priceTRY > group.highestPrice) group.highestPrice = item.priceTRY;

    // Build variant map
    const vk = parsed.variantKey;
    if (!group.variants.has(vk)) {
      group.variants.set(vk, { ...parsed.variants, items: [], lowestPrice: Infinity, image: item.image });
    }
    const variant = group.variants.get(vk);
    variant.items.push(item);
    if (item.priceTRY && item.priceTRY < variant.lowestPrice) variant.lowestPrice = item.priceTRY;
    if (item.image && !variant.image) variant.image = item.image;
  }

  // Convert to array
  const groups = Array.from(modelMap.values())
    .map(g => ({
      ...g,
      lowestPrice: isFinite(g.lowestPrice) ? g.lowestPrice : 0,
      highestPrice: g.highestPrice || 0,
      image: g.images[0] || null,
      variantCount: g.variants.size,
      variants: Array.from(g.variants.entries()).map(([k, v]) => ({
        key: k,
        ...v,
        lowestPrice: isFinite(v.lowestPrice) ? v.lowestPrice : 0,
        itemCount: v.items.length
      })),
      sourceCount: new Set(g.items.map(x => x.source).filter(Boolean)).size,
      platformCount: new Set(g.items.map(x => x.platform).filter(Boolean)).size
    }))
    .sort((a, b) => (a.lowestPrice || Infinity) - (b.lowestPrice || Infinity));

  // Add accessories at the end if any
  if (accessoryGroup.items.length > 0) {
    groups.push({
      ...accessoryGroup,
      lowestPrice: isFinite(accessoryGroup.lowestPrice) ? accessoryGroup.lowestPrice : 0,
      highestPrice: accessoryGroup.highestPrice || 0,
      image: accessoryGroup.images[0] || null,
      variantCount: 0,
      variants: [],
      sourceCount: new Set(accessoryGroup.items.map(x => x.source).filter(Boolean)).size,
      platformCount: new Set(accessoryGroup.items.map(x => x.platform).filter(Boolean)).size
    });
  }

  return groups;
}

// Popüler ürün seed'leri (Türkiye pazarı)
const POPULAR_PRODUCTS = [
  { category: 'Telefon', icon: '📱', items: [
    { name: 'iPhone 16 Pro Max', query: 'iPhone 16 Pro Max', image: null },
    { name: 'iPhone 16', query: 'iPhone 16', image: null },
    { name: 'Samsung Galaxy S25 Ultra', query: 'Samsung Galaxy S25 Ultra', image: null },
    { name: 'Xiaomi 15 Pro', query: 'Xiaomi 15 Pro', image: null },
  ]},
  { category: 'Bilgisayar', icon: '💻', items: [
    { name: 'MacBook Air M4', query: 'MacBook Air M4', image: null },
    { name: 'MacBook Pro M4', query: 'MacBook Pro M4 Pro', image: null },
    { name: 'ASUS ROG Laptop', query: 'ASUS ROG laptop', image: null },
    { name: 'Lenovo ThinkPad', query: 'Lenovo ThinkPad', image: null },
  ]},
  { category: 'Kulaklık', icon: '🎧', items: [
    { name: 'AirPods Pro 2', query: 'AirPods Pro 2', image: null },
    { name: 'AirPods 4', query: 'AirPods 4', image: null },
    { name: 'Sony WH-1000XM5', query: 'Sony WH-1000XM5', image: null },
    { name: 'Samsung Galaxy Buds3 Pro', query: 'Samsung Galaxy Buds3 Pro', image: null },
  ]},
  { category: 'Oyun', icon: '🎮', items: [
    { name: 'PlayStation 5 Pro', query: 'PlayStation 5 Pro', image: null },
    { name: 'Xbox Series X', query: 'Xbox Series X', image: null },
    { name: 'Nintendo Switch 2', query: 'Nintendo Switch 2', image: null },
    { name: 'PS5 DualSense', query: 'PS5 DualSense controller', image: null },
  ]},
  { category: 'Ev Aletleri', icon: '🏠', items: [
    { name: 'Dyson V15', query: 'Dyson V15 süpürge', image: null },
    { name: 'Dyson Airwrap', query: 'Dyson Airwrap', image: null },
    { name: 'iRobot Roomba', query: 'iRobot Roomba', image: null },
    { name: 'Philips Air Fryer', query: 'Philips Airfryer XXL', image: null },
  ]},
  { category: 'Tablet', icon: '📱', items: [
    { name: 'iPad Pro M4', query: 'iPad Pro M4', image: null },
    { name: 'iPad Air M3', query: 'iPad Air M3', image: null },
    { name: 'Samsung Galaxy Tab S10', query: 'Samsung Galaxy Tab S10', image: null },
  ]},
];

const popularCache = new Map();

// Popüler kartlar (TCG)
const POPULAR_CARD_SEEDS = {
  pokemon: ['Charizard', 'Pikachu', 'Mewtwo', 'Lugia', 'Rayquaza', 'Umbreon', 'Gengar', 'Eevee'],
  yugioh: ['Blue-Eyes White Dragon', 'Dark Magician', 'Exodia', 'Red-Eyes Black Dragon', 'Pot of Greed', 'Ash Blossom'],
  magic: ['Black Lotus', 'Lightning Bolt', 'Counterspell', 'Sol Ring', 'Force of Will', 'Mox Pearl']
};
const popularCardCache = new Map();

// ═══════════════════════════════════════════
// PRICE TRACKER — Rakip Fiyat Algoritması
// ═══════════════════════════════════════════
function calculateBeatPrice(competitorPrices, rules) {
  if (!competitorPrices.length) return null;
  
  const lowestCompetitor = Math.min(...competitorPrices.map(p => p.priceTRY).filter(p => p > 0));
  if (!lowestCompetitor || lowestCompetitor <= 0) return null;

  const beatAmount = rules.beatByAmount || 0.10; // TL
  const beatPercent = rules.beatByPercent || 0;   // %
  const minMarginPercent = rules.minMarginPercent || 5;
  const costPrice = rules.costPrice || 0;
  const maxDropPercent = rules.maxDropPercent || 30;
  const currentPrice = rules.currentPrice || 0;

  // En düşük rakibin altına in
  let suggestedPrice;
  if (beatPercent > 0) {
    suggestedPrice = Math.round(lowestCompetitor * (1 - beatPercent / 100) * 100) / 100;
  } else {
    suggestedPrice = lowestCompetitor - beatAmount;
  }

  // Minimum marj koruması
  if (costPrice > 0) {
    const minPrice = costPrice * (1 + minMarginPercent / 100);
    if (suggestedPrice < minPrice) {
      suggestedPrice = minPrice;
    }
  }

  // Maksimum düşüş koruması
  if (currentPrice > 0 && maxDropPercent > 0) {
    const floor = currentPrice * (1 - maxDropPercent / 100);
    if (suggestedPrice < floor) {
      suggestedPrice = floor;
    }
  }

  // 10 kuruş yuvarla
  suggestedPrice = Math.round(suggestedPrice * 10) / 10;

  return {
    suggestedPrice,
    lowestCompetitor,
    savings: lowestCompetitor - suggestedPrice,
    isBelow: suggestedPrice < lowestCompetitor,
    marginProtected: costPrice > 0 && suggestedPrice <= costPrice * (1 + minMarginPercent / 100),
    dropProtected: currentPrice > 0 && suggestedPrice <= currentPrice * (1 - maxDropPercent / 100)
  };
}

// ═══════════════════════════════════════════
// GLOBAL KART FİYATI (mevcut)
// ═══════════════════════════════════════════
const priceCache = new Map();
async function getGlobalPrice(productName) {
  const cKey = productName.toLowerCase().trim();
  const cached = priceCache.get(cKey);
  if (cached && Date.now()-cached.ts < 60*60*1000) return cached.data;
  const rates = ratesCache, sources = [], errors = [];
  const category = detectCategory(productName);
  const searchTerm = productName.replace(/booster box|booster pack|elite trainer box|etb|\btr\b|\ben\b|\bjp\b|display/gi,'').replace(/\(\d+.*?\)/g,'').trim().split(' ').slice(0,3).join(' ');

  if (['pokemon','default'].includes(category)) {
    try {
      const r = await fetch(`https://api.tcgdex.net/v2/en/cards?name=${encodeURIComponent(searchTerm)}&itemsPerPage=3`,{signal:AbortSignal.timeout(8000)});
      if (r.ok) { const list = await r.json(); if (Array.isArray(list) && list.length) { const dr = await fetch(`https://api.tcgdex.net/v2/en/cards/${list[0].id}`,{signal:AbortSignal.timeout(8000)}); if (dr.ok) { const card = await dr.json(); const cmEUR=card.pricing?.cardmarket?.avg30||card.pricing?.cardmarket?.trend||0; const tcgUSD=card.pricing?.tcgplayer?.holo?.marketPrice||card.pricing?.tcgplayer?.normal?.marketPrice||0; if(cmEUR>0)sources.push({source:'Cardmarket (TCGdex)',priceEUR:cmEUR,priceTRY:Math.round(cmEUR*rates.EUR)}); if(tcgUSD>0)sources.push({source:'TCGPlayer (TCGdex)',priceUSD:tcgUSD,priceTRY:Math.round(tcgUSD*rates.USD)}); } } }
    } catch(e) { errors.push('TCGdex:'+e.message); }
  }
  if (['yugioh','default'].includes(category)) {
    try { const r = await fetch(`https://db.ygoprodeck.com/api/v7/cardinfo.php?fname=${encodeURIComponent(searchTerm)}&num=1`,{signal:AbortSignal.timeout(8000)}); if (r.ok) { const d=await r.json(); const card=d.data?.[0]; if(card){ const tcp=parseFloat(card.card_prices?.[0]?.tcgplayer_price||0),cm=parseFloat(card.card_prices?.[0]?.cardmarket_price||0); if(tcp>0)sources.push({source:'TCGPlayer (YGO)',priceUSD:tcp,priceTRY:Math.round(tcp*rates.USD)}); if(cm>0)sources.push({source:'Cardmarket (YGO)',priceEUR:cm,priceTRY:Math.round(cm*rates.EUR)}); } } } catch(e) { errors.push('YGO:'+e.message); }
  }
  if (['magic','default'].includes(category)) {
    try { const r = await fetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(searchTerm)}`,{signal:AbortSignal.timeout(8000)}); if (r.ok) { const card=await r.json(); const usd=parseFloat(card.prices?.usd||card.prices?.usd_foil||0),eur=parseFloat(card.prices?.eur||card.prices?.eur_foil||0); if(usd>0)sources.push({source:'TCGPlayer (Scryfall)',priceUSD:usd,priceTRY:Math.round(usd*rates.USD)}); if(eur>0)sources.push({source:'Cardmarket (Scryfall)',priceEUR:eur,priceTRY:Math.round(eur*rates.EUR)}); } } catch(e) { errors.push('Scryfall:'+e.message); }
  }
  if (category==='onepiece') {
    try { const r=await fetch(`https://optcgapi.com/api/cards/?search=${encodeURIComponent(searchTerm)}`,{signal:AbortSignal.timeout(8000)}); if(r.ok){const d=await r.json();const card=(d.results||d||[])[0];if(card){const usd=parseFloat(card.price||0);if(usd>0)sources.push({source:'OPTCG',priceUSD:usd,priceTRY:Math.round(usd*rates.USD)});}} } catch(e) { errors.push('OPTCG:'+e.message); }
  }
  const tryPrices=sources.map(s=>s.priceTRY).filter(p=>p>0);
  const avgTRY=tryPrices.length?Math.round(tryPrices.reduce((a,b)=>a+b,0)/tryPrices.length):null;
  const result={sources,errors,averageTRY:avgTRY,confidence:sources.length,searchTerm,category};
  priceCache.set(cKey,{data:result,ts:Date.now()});
  return result;
}

function calcSuggestedPrice(currentPrice, globalAvgTRY, category) {
  const st=STRATEGIES[category]||STRATEGIES.default;
  if(!globalAvgTRY)return null;
  let sg=Math.round(globalAvgTRY*(1+st.marginAboveGlobal/100)/5)*5;
  if(currentPrice>0){const mx=Math.round(currentPrice*(1+st.maxRaise/100)),mn=Math.round(currentPrice*(1-st.maxDrop/100));if(sg>mx)sg=mx;if(sg<mn)sg=mn;}
  return sg;
}

// ═══════════════════════════════════════════
// PLATFORM ADAPTÖRLER
// ═══════════════════════════════════════════
const ikasTokenCache = {};
async function ikasToken(cfg) {
  const key=cfg.storeName+'_'+cfg.clientId;const c=ikasTokenCache[key];
  if(c&&Date.now()<c.exp)return c.token;
  const r=await fetch(`https://${cfg.storeName}.myikas.com/api/admin/oauth/token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:`grant_type=client_credentials&client_id=${encodeURIComponent(cfg.clientId)}&client_secret=${encodeURIComponent(cfg.clientSecret)}`});
  if(!r.ok)throw new Error(`İkas token (${r.status})`);
  const d=await r.json();ikasTokenCache[key]={token:d.access_token,exp:Date.now()+(d.expires_in-60)*1000};return d.access_token;
}
async function ikasGQL(cfg,query) {
  const token=await ikasToken(cfg);
  const r=await fetch('https://api.myikas.com/api/v1/admin/graphql',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({query})});
  const d=await r.json();if(d.errors)throw new Error(d.errors[0].message);return d;
}
async function ikasGetProducts(cfg) {
  let all=[],page=0,hasNext=true;
  while(hasNext&&page<20){const d=await ikasGQL(cfg,`{listProduct(pagination:{page:${page},limit:100}){hasNext data{id name variants{id sku prices{sellPrice} stocks{stockCount}}}}}`);all=all.concat(d.data.listProduct.data);hasNext=d.data.listProduct.hasNext;page++;}
  return all.map(p=>{const v=p.variants?.[0]||{};return{id:p.id,variantId:v.id,name:p.name,sku:v.sku||'—',price:v.prices?.[0]?.sellPrice||0,stock:v.stocks?.reduce((s,x)=>s+(x.stockCount||0),0)||0,category:detectCategory(p.name),platform:'ikas'};});
}
async function ikasUpdatePrice(cfg,productId,variantId,newPrice,priceListId) {
  const pl=priceListId?`priceListId:"${priceListId}",`:'';
  return await ikasGQL(cfg,`mutation{saveVariantPrices(input:{${pl}variantPriceInputs:[{productId:"${productId}" variantId:"${variantId}" price:{sellPrice:${newPrice}}}]}){} }`);
}
async function ikasCreateProduct(cfg,card,priceTRY) {
  const scRes=await ikasGQL(cfg,'{listSalesChannel{id}}');
  const scIds=(scRes.data?.listSalesChannel||[]).map(s=>`"${s.id}"`).join(',');
  const safeName=(card.name||'Kart').replace(/"/g,"'").slice(0,200);
  const safeSku=(card.id||card.name||'card').replace(/[^a-zA-Z0-9-]/g,'-').slice(0,50);
  const createRes=await ikasGQL(cfg,`mutation{saveProduct(input:{name:"${safeName}" type:PHYSICAL salesChannelIds:[${scIds}] variants:[{prices:[{sellPrice:${priceTRY}}] sku:"${safeSku}"}]}){id name variants{id}}}`);
  if(createRes.errors)throw new Error(createRes.errors[0].message);
  const productId=createRes.data.saveProduct.id;const variantId=createRes.data.saveProduct.variants?.[0]?.id;
  if(card.image&&productId){
    try{
      let imgUrl=card.image;if(imgUrl.includes('tcgdex.net')&&!imgUrl.endsWith('.png')&&!imgUrl.endsWith('.jpg'))imgUrl+='/high.png';
      const imgRes=await fetch(imgUrl,{headers:{'User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(20000)});
      if(!imgRes.ok)throw new Error(`Görsel ${imgRes.status}`);
      let imgBuf;if(typeof imgRes.buffer==='function')imgBuf=await imgRes.buffer();else{const ab=await imgRes.arrayBuffer();imgBuf=Buffer.from(ab);}
      const ct=imgRes.headers.get('content-type')||'image/png';const ext=ct.includes('jpeg')?'jpg':'png';
      const dataUri=`data:${ct};base64,${imgBuf.toString('base64')}`;const token=await ikasToken(cfg);
      const up=await fetch('https://api.myikas.com/api/v1/admin/graphql',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({query:`mutation UploadProductImage($input: ProductImageInput!) { uploadProductImage(input: $input) { id fileName } }`,variables:{input:{productId,variantIds:variantId?[variantId]:[],base64:dataUri,fileName:`${safeSku}.${ext}`,isMain:true,order:0}}}),signal:AbortSignal.timeout(30000)});
      const upd=await up.json();
      if(upd.errors){await fetch('https://api.myikas.com/api/v1/admin/product/upload/image',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({productImage:{productId,variantIds:variantId?[variantId]:[],base64:dataUri,order:0,isMain:true}}),signal:AbortSignal.timeout(30000)});}
    }catch(e){console.log('⚠️ Görsel yüklenemedi:',e.message);}
  }
  return{id:productId,variantId};
}

function shopifyHeaders(cfg){return{'Content-Type':'application/json','X-Shopify-Access-Token':cfg.accessToken};}
function shopifyBase(cfg){return`https://${cfg.storeDomain}/admin/api/2024-01`;}
async function shopifyGetProducts(cfg) {
  let all=[],nextUrl=`${shopifyBase(cfg)}/products.json?limit=250`;
  while(nextUrl){const r=await fetch(nextUrl,{headers:shopifyHeaders(cfg)});if(!r.ok)throw new Error(`Shopify (${r.status})`);const d=await r.json();all=all.concat(d.products||[]);const link=r.headers.get('link')||'';const next=link.match(/<([^>]+)>;\s*rel="next"/);nextUrl=next?next[1]:null;}
  return all.map(p=>{const v=p.variants?.[0]||{};return{id:String(p.id),variantId:String(v.id),name:p.title,sku:v.sku||'—',price:parseFloat(v.price||0),stock:v.inventory_quantity||0,imageUrl:p.images?.[0]?.src||null,category:detectCategory(p.title),platform:'shopify'};});
}
async function shopifyUpdatePrice(cfg,variantId,newPrice) {
  const r=await fetch(`${shopifyBase(cfg)}/variants/${variantId}.json`,{method:'PUT',headers:shopifyHeaders(cfg),body:JSON.stringify({variant:{id:variantId,price:newPrice.toFixed(2)}})});
  if(!r.ok){const e=await r.json();throw new Error(JSON.stringify(e.errors));}return await r.json();
}
async function shopifyCreateProduct(cfg,card,priceTRY) {
  const body={product:{title:card.name,vendor:card.game?.toUpperCase()||'TCG',product_type:card.game||'card',tags:[card.game,card.rarity,card.set].filter(Boolean).join(', '),variants:[{price:priceTRY.toFixed(2),sku:card.id||card.name?.replace(/\s+/g,'-').slice(0,50),inventory_management:'shopify'}],images:card.image?[{src:card.image.includes('tcgdex')?card.image+'/high.png':card.image}]:[]}};
  const r=await fetch(`${shopifyBase(cfg)}/products.json`,{method:'POST',headers:shopifyHeaders(cfg),body:JSON.stringify(body)});
  if(!r.ok){const e=await r.json();throw new Error(JSON.stringify(e.errors||e));}
  const d=await r.json();return{id:String(d.product.id),variantId:String(d.product.variants?.[0]?.id)};
}

async function platformGetProducts(platform) {
  const cfg=typeof platform.config==='string'?JSON.parse(platform.config):platform.config;
  if(platform.type==='ikas')return await ikasGetProducts(cfg);
  if(platform.type==='shopify')return await shopifyGetProducts(cfg);
  return[];
}
async function platformUpdatePrice(platform,product,newPrice) {
  const cfg=typeof platform.config==='string'?JSON.parse(platform.config):platform.config;
  if(platform.type==='ikas')return await ikasUpdatePrice(cfg,product.id,product.variantId,newPrice,cfg.priceListId);
  if(platform.type==='shopify')return await shopifyUpdatePrice(cfg,product.variantId,newPrice);
  return null;
}
async function platformCreateProduct(platform,card,priceTRY) {
  const cfg=typeof platform.config==='string'?JSON.parse(platform.config):platform.config;
  if(platform.type==='ikas')return await ikasCreateProduct(cfg,card,priceTRY);
  if(platform.type==='shopify')return await shopifyCreateProduct(cfg,card,priceTRY);
  return null;
}
function buildTrackerPlatformCard(product = {}) {
  const competitors = Array.isArray(product.last_competitors) ? product.last_competitors : [];
  const firstImage = competitors.find(x => x && x.image)?.image || product.image || null;
  return {
    id: product.id || `tracker-${Date.now()}`,
    name: product.name || product.productName || 'Ürün',
    game: 'tracker',
    image: firstImage,
    set: 'Price Tracker',
    rarity: ''
  };
}

// ═══════════════════════════════════════════
// ZAMANLAYICI
// ═══════════════════════════════════════════
const schedulers = {};
async function runPlatformUpdate(platformId) {
  let platformData;
  try{platformData=hasSupabase?null:db.getPlatform(platformId);}catch(e){return;}
  if(!platformData)return;
  addLog(platformId,'SCHED',`Güncelleme: ${platformData.name}`,'info');
  try{
    const products=await platformGetProducts(platformData);await refreshRates();let updated=0;
    for(const p of products){const gp=await getGlobalPrice(p.name);if(!gp.averageTRY)continue;const sg=calcSuggestedPrice(p.price,gp.averageTRY,p.category);if(sg&&Math.abs(sg-p.price)>5){try{await platformUpdatePrice(platformData,p,sg);updated++;}catch(e){}}}
    addLog(platformId,'SCHED',`${updated}/${products.length} güncellendi`,'info');
  }catch(e){addLog(platformId,'SCHED','Hata:'+e.message,'error');}
}

// Price Tracker zamanlayıcı
const trackerSchedulers = {};
async function runTrackerUpdate(productId, userId) {
  const tracked = db.getTrackedProduct(productId, userId);
  if (!tracked) return;
  
  addLog('tracker', 'TRACKER', `Fiyat tarama: ${tracked.name}`, 'info');
  try {
    const serpData = await serpAPISearch(tracked.searchQuery || tracked.name);
    let competitors = serpData.results || [];
    
    // Group and pick the target model to prevent tracking cheap accessories
    const groups = groupSearchResults(competitors, tracked.searchQuery || tracked.name);
    const targetGroup = groups.find(g => g.key !== '__accessories__');
    if (targetGroup && targetGroup.items && targetGroup.items.length > 0) {
       competitors = targetGroup.items;
       serpData.lowestPrice = targetGroup.lowestPrice;
       serpData.avgPrice = Math.round(targetGroup.items.reduce((s,r)=>s+r.priceTRY,0)/targetGroup.items.length);
    }
    
    // Fiyat geçmişine ekle
    if (!tracked.priceHistory) tracked.priceHistory = [];
    tracked.priceHistory.push({
      ts: new Date().toISOString(),
      competitors: competitors.slice(0, 10).map(c => ({ source: c.source, platform: c.platform, price: c.priceTRY })),
      lowestPrice: serpData.lowestPrice,
      avgPrice: serpData.avgPrice
    });
    // Son 100 kayıt tut
    if (tracked.priceHistory.length > 100) tracked.priceHistory = tracked.priceHistory.slice(-100);
    
    // Önerilen fiyat hesapla
    if (competitors.length && tracked.rules) {
      const calc = calculateBeatPrice(competitors, { ...tracked.rules, currentPrice: tracked.ourPrice || 0 });
      if (calc) {
        tracked.suggestedPrice = calc.suggestedPrice;
        tracked.lowestCompetitor = calc.lowestCompetitor;
        tracked.lastScanAt = new Date().toISOString();
        tracked.competitorCount = competitors.length;
      }
    }
    
    tracked.lastCompetitors = competitors.slice(0, 20);
    db.saveTrackedProduct(tracked);
    addLog('tracker', 'TRACKER', `${tracked.name}: En düşük ${serpData.lowestPrice}₺, ${competitors.length} rakip`, 'success');
  } catch(e) {
    addLog('tracker', 'TRACKER', `Hata: ${e.message}`, 'error');
  }
}

function startTrackerScheduler(productId, userId, intervalMinutes = 60) {
  const key = `tracker_${productId}`;
  if (trackerSchedulers[key]?.timer) clearInterval(trackerSchedulers[key].timer);
  trackerSchedulers[key] = {
    timer: setInterval(() => runTrackerUpdate(productId, userId), intervalMinutes * 60 * 1000),
    intervalMinutes,
    startedAt: new Date().toISOString()
  };
  // İlk çalıştırma
  setTimeout(() => runTrackerUpdate(productId, userId), 2000);
}

function stopTrackerScheduler(productId) {
  const key = `tracker_${productId}`;
  if (trackerSchedulers[key]?.timer) { clearInterval(trackerSchedulers[key].timer); delete trackerSchedulers[key]; }
}

function startPlatformScheduler(id,h){
  if(schedulers[id]?.timer)clearInterval(schedulers[id].timer);
  schedulers[id]={timer:setInterval(()=>runPlatformUpdate(id),h*60*60*1000),intervalHours:h,startedAt:new Date().toISOString()};
}
function stopPlatformScheduler(id){if(schedulers[id]?.timer){clearInterval(schedulers[id].timer);delete schedulers[id];}}

// ═══════════════════════════════════════════
// EBAY
// ═══════════════════════════════════════════
let ebayTokenCache={token:null,exp:0};
async function getEbayToken() {
  if(ebayTokenCache.token&&Date.now()<ebayTokenCache.exp)return ebayTokenCache.token;
  const creds=Buffer.from(`${EBAY_APP_ID}:${EBAY_CERT_ID}`).toString('base64');
  const r=await fetch('https://api.ebay.com/identity/v1/oauth2/token',{method:'POST',headers:{'Authorization':`Basic ${creds}`,'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope',signal:AbortSignal.timeout(8000)});
  const d=await r.json();if(!d.access_token)throw new Error('eBay token alınamadı');
  ebayTokenCache={token:d.access_token,exp:Date.now()+(d.expires_in-60)*1000};return d.access_token;
}

const EBAY_CATEGORY_MAP={pokemon:'64482',yugioh:'2536',magic:'19107',onepiece:'2536',nfl:'215',nba:'214',mlb:'213',soccer:'254',default:'212'};

async function ebayBrowseSearch(query,limit=16,category=null) {
  const token=await getEbayToken();
  const catId=category?(EBAY_CATEGORY_MAP[category]||EBAY_CATEGORY_MAP.default):'';
  const catFilter=catId?`&category_ids=${catId}`:'';
  const url=`https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(query)}&limit=${limit}${catFilter}&filter=buyingOptions:{FIXED_PRICE|BEST_OFFER}&sort=relevance`;
  const r=await fetch(url,{headers:{'Authorization':`Bearer ${token}`,'X-EBAY-C-MARKETPLACE-ID':'EBAY_US'},signal:AbortSignal.timeout(12000)});
  if(!r.ok){const e=await r.text();throw new Error(`eBay Browse ${r.status}: ${e.slice(0,100)}`);}
  const d=await r.json();
  return(d.itemSummaries||[]).map(item=>{const pv=parseFloat(item.price?.value||0);return{id:`ebay-${item.itemId}`,name:item.title,price:item.price?.value||null,currency:item.price?.currency||'USD',priceTRY:pv?Math.round(pv*ratesCache.USD):null,image:item.image?.imageUrl||item.thumbnailImages?.[0]?.imageUrl||null,url:item.itemWebUrl||null,condition:item.condition||'',seller:item.seller?.username||'',location:item.itemLocation?.country||'',source:'eBay Browse'};});
}

async function ebayFindingSearch(query,limit=12) {
  const appId=hasEbayBrowse?EBAY_APP_ID:'PriceBot0-PriceBot-PRD-000000000-00000000';
  const url=`https://svcs.ebay.com/services/search/FindingService/v1?OPERATION-NAME=findItemsByKeywords&SERVICE-VERSION=1.0.0&SECURITY-APPNAME=${appId}&RESPONSE-DATA-FORMAT=JSON&keywords=${encodeURIComponent(query)}&paginationInput.entriesPerPage=${limit}`;
  const r=await fetch(url,{signal:AbortSignal.timeout(10000)});
  const d=await r.json();
  const items=d?.findItemsByKeywordsResponse?.[0]?.searchResult?.[0]?.item||[];
  return items.map(item=>{const price=parseFloat(item.sellingStatus?.[0]?.currentPrice?.[0]?.['__value__']||0);return{id:`ebay-f-${item.itemId?.[0]}`,name:item.title?.[0]||query,price:price?price.toFixed(2):null,currency:'USD',priceTRY:price?Math.round(price*ratesCache.USD):null,image:item.galleryURL?.[0]||null,url:item.viewItemURL?.[0]||null,source:'eBay Finding'};});
}

function parseEbayRSS(xml) {
  const items=[];const blocks=xml.match(/<item>([\s\S]*?)<\/item>/g)||[];
  for(const block of blocks){
    const get=tag=>{const m=block.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));return m?(m[1]||m[2]||'').trim():'';};
    const title=get('title'),link=get('link')||get('guid'),desc=get('description');
    const pm=(desc+title).match(/\$[\d,]+\.?\d*/);const price=pm?parseFloat(pm[0].replace(/[$,]/g,'')):null;
    const im=desc.match(/src="([^"]+)"/);
    if(title)items.push({title,link,price,image:im?im[1]:null});
  }
  return items;
}

async function ebayRSSSearch(query,limit=20) {
  const url=`https://rss.ebay.com/rover/1/711-53200-19255-0/1?ff3=2&toolid=10001&campid=5337590274&customid=&lgeo=1&vectorid=229466&keyword=${encodeURIComponent(query)}`;
  const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0 (compatible; PriceBot/2.0)'},signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw new Error(`eBay RSS ${r.status}`);
  const xml=await r.text();const parsed=parseEbayRSS(xml);
  return parsed.slice(0,limit).map((item,i)=>({id:`rss-${i}-${Date.now()}`,name:item.title,price:item.price?item.price.toFixed(2):null,priceTRY:item.price?Math.round(item.price*ratesCache.USD):null,image:item.image,url:item.link,source:'eBay RSS'}));
}

async function ebaySoldSearch(query,limit=10,category=null) {
  if(!hasEbayBrowse)return[];
  try{
    const token=await getEbayToken();const catId=category?(EBAY_CATEGORY_MAP[category]||''):'';const catFilter=catId?`&category_ids=${catId}`:'';
    const url=`https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(query)}&limit=${limit}${catFilter}&filter=buyingOptions:{FIXED_PRICE},soldItems:true&sort=endingSoonest`;
    const r=await fetch(url,{headers:{'Authorization':`Bearer ${token}`,'X-EBAY-C-MARKETPLACE-ID':'EBAY_US'},signal:AbortSignal.timeout(10000)});
    if(!r.ok)return[];
    const d=await r.json();
    return(d.itemSummaries||[]).map(item=>({name:item.title,price:parseFloat(item.price?.value||0),priceTRY:item.price?.value?Math.round(parseFloat(item.price.value)*ratesCache.USD):null,condition:item.condition||'',soldDate:item.itemEndDate||null,source:'eBay Sold'}));
  }catch(e){return[];}
}

// ═══════════════════════════════════════════
// API ROTALARI
// ═══════════════════════════════════════════

// Herkese açık
app.get('/api/rates', async(req,res)=>res.json(await refreshRates()));
app.get('/api/strategies', (req,res)=>res.json(STRATEGIES));
app.post('/api/global-price', async(req,res)=>{try{res.json(await getGlobalPrice(req.body.productName||''));}catch(e){res.status(500).json({error:e.message});}});

// Görsel proxy
app.get('/api/image-proxy', async(req,res)=>{
  let url=req.query.url;if(!url)return res.status(400).send('Invalid');
  if(url.includes('ebayimg.com'))url=url.replace(/s-l\d+\.(jpg|webp|png)/i,'s-l400.$1');
  try{
    const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0','Accept':'image/webp,image/*,*/*','Referer':'https://www.ebay.com/'},signal:AbortSignal.timeout(10000)});
    if(!r.ok)return res.status(r.status).send('Not found');
    let buf;if(typeof r.buffer==='function')buf=await r.buffer();else{const ab=await r.arrayBuffer();buf=Buffer.from(ab);}
    res.set('Content-Type',r.headers.get('content-type')||'image/jpeg');res.set('Cache-Control','public,max-age=86400');res.set('Access-Control-Allow-Origin','*');res.send(buf);
  }catch(e){res.status(500).send('Error');}
});

app.get('/api/auth/me', requireAuth, (req,res)=>res.json({id:req.userId,email:req.userEmail}));

// ═══════════════════════════════════════════
// PRICE TRACKER API
// ═══════════════════════════════════════════

// SerpAPI arama (geliştirilmiş — server-side gruplama)
app.post('/api/tracker/search', requireAuth, async(req, res) => {
  const { query, location } = req.body;
  if (!query) return res.status(400).json({ error: 'query gerekli' });
  try {
    await refreshRates();
    const data = await serpAPISearch(query, location || 'Turkey');
    // Server-side akıllı gruplama
    const groups = groupSearchResults(data.results || [], query);
    res.json({ ...data, groups });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Autocomplete önerileri
app.post('/api/tracker/suggest', requireAuth, async(req, res) => {
  const { query } = req.body;
  if (!query || query.length < 2) return res.json({ suggestions: [] });
  
  const q = query.toLowerCase().trim();
  const suggestions = [];
  
  // Popüler ürünlerden eşleşenleri bul
  for (const cat of POPULAR_PRODUCTS) {
    for (const item of cat.items) {
      if (item.name.toLowerCase().includes(q) || item.query.toLowerCase().includes(q)) {
        suggestions.push({ name: item.name, query: item.query, category: cat.category, icon: cat.icon, type: 'popular' });
      }
    }
  }
  
  // Daha önce aranmış cache'den eşleşenleri bul
  for (const [key, cached] of serpCache.entries()) {
    if (key.includes(q) && cached.data?.results?.length) {
      const topResult = cached.data.results[0];
      if (!suggestions.some(s => s.query === key)) {
        suggestions.push({ name: key, query: key, category: 'Önceki Arama', icon: '🔍', type: 'recent', image: topResult?.image, price: cached.data.lowestPrice });
      }
    }
  }
  
  // Genel kategori önerileri
  const categoryHints = [
    { trigger: 'iphone', suggestions: ['iPhone 16 Pro Max', 'iPhone 16 Pro', 'iPhone 16', 'iPhone 15', 'iPhone SE'] },
    { trigger: 'samsung', suggestions: ['Samsung Galaxy S25 Ultra', 'Samsung Galaxy S25+', 'Samsung Galaxy A55', 'Samsung Galaxy Tab S10'] },
    { trigger: 'macbook', suggestions: ['MacBook Air M4', 'MacBook Pro M4', 'MacBook Pro M4 Max', 'MacBook Air M3'] },
    { trigger: 'airpods', suggestions: ['AirPods Pro 2', 'AirPods 4', 'AirPods Max'] },
    { trigger: 'dyson', suggestions: ['Dyson V15 Detect', 'Dyson Airwrap', 'Dyson Supersonic', 'Dyson V12'] },
    { trigger: 'playstation', suggestions: ['PlayStation 5 Pro', 'PlayStation 5 Slim', 'PS5 DualSense Edge'] },
    { trigger: 'ps5', suggestions: ['PlayStation 5 Pro', 'PlayStation 5 Slim', 'PS5 DualSense Edge'] },
    { trigger: 'xbox', suggestions: ['Xbox Series X', 'Xbox Series S', 'Xbox Controller'] },
    { trigger: 'ipad', suggestions: ['iPad Pro M4', 'iPad Air M3', 'iPad Mini', 'iPad 10. Nesil'] },
    { trigger: 'xiaomi', suggestions: ['Xiaomi 15 Pro', 'Xiaomi 14T Pro', 'Xiaomi Redmi Note 14 Pro'] },
    { trigger: 'nintendo', suggestions: ['Nintendo Switch 2', 'Nintendo Switch OLED'] },
    { trigger: 'sony', suggestions: ['Sony WH-1000XM5', 'Sony WF-1000XM5', 'Sony Alpha A7 IV'] },
    { trigger: 'apple', suggestions: ['Apple Watch Ultra 2', 'Apple Watch Series 10', 'Apple Vision Pro'] },
  ];
  
  for (const hint of categoryHints) {
    if (q.includes(hint.trigger)) {
      for (const s of hint.suggestions) {
        if (!suggestions.some(x => x.query === s)) {
          suggestions.push({ name: s, query: s, category: 'Öneri', icon: '💡', type: 'hint' });
        }
      }
    }
  }
  
  res.json({ suggestions: suggestions.slice(0, 10) });
});

// Popüler ürünler
app.get('/api/tracker/popular', async(req, res) => {
  const cacheKey = 'popular_all';
  const cached = popularCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < 60 * 60 * 1000) {
    return res.json(cached.data);
  }
  
  // Popüler kategorileri fiyat bilgisi ile döndür
  // SerpAPI varsa ilk kategoriden birkaç fiyat çek
  const categories = POPULAR_PRODUCTS.map(cat => ({
    ...cat,
    items: cat.items.map(item => {
      // Cache'den fiyat varsa ekle
      const cKey = item.query.toLowerCase().trim();
      const sc = serpCache.get(cKey);
      return {
        ...item,
        lowestPrice: sc?.data?.lowestPrice || null,
        image: sc?.data?.results?.[0]?.image || item.image,
        resultCount: sc?.data?.totalResults || 0
      };
    })
  }));
  
  const data = { categories, updatedAt: new Date().toISOString() };
  popularCache.set(cacheKey, { data, ts: Date.now() });
  res.json(data);
});

// Popüler TCG kartları  
app.get('/api/catalog/popular-cards', async(req, res) => {
  const game = req.query.game || 'pokemon';
  const cacheKey = `popular_cards_${game}`;
  const cached = popularCardCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < 2 * 60 * 60 * 1000) {
    return res.json(cached.data);
  }
  
  await refreshRates();
  const seeds = POPULAR_CARD_SEEDS[game] || POPULAR_CARD_SEEDS.pokemon;
  const cards = [];
  
  for (const seed of seeds.slice(0, 6)) {
    try {
      if (game === 'pokemon') {
        const r = await fetch(`https://api.tcgdex.net/v2/en/cards?name=${encodeURIComponent(seed)}&itemsPerPage=1`, { signal: AbortSignal.timeout(6000) });
        if (r.ok) {
          const list = await r.json();
          if (list[0]) {
            const dr = await fetch(`https://api.tcgdex.net/v2/en/cards/${list[0].id}`, { signal: AbortSignal.timeout(6000) });
            if (dr.ok) {
              const card = await dr.json();
              const cmEUR = card.pricing?.cardmarket?.avg30 || card.pricing?.cardmarket?.trend || 0;
              const tcgUSD = card.pricing?.tcgplayer?.holo?.marketPrice || card.pricing?.tcgplayer?.normal?.marketPrice || 0;
              cards.push({
                id: card.id, name: card.name, game: 'pokemon',
                image: card.image ? card.image + '/high.png' : list[0].image ? list[0].image + '/high.png' : null,
                set: card.set?.name || '', rarity: card.rarity || '',
                priceEUR: cmEUR, priceUSD: tcgUSD,
                priceTRY: cmEUR ? Math.round(cmEUR * ratesCache.EUR) : tcgUSD ? Math.round(tcgUSD * ratesCache.USD) : 0
              });
            }
          }
        }
      } else if (game === 'yugioh') {
        const r = await fetch(`https://db.ygoprodeck.com/api/v7/cardinfo.php?fname=${encodeURIComponent(seed)}&num=1`, { signal: AbortSignal.timeout(6000) });
        if (r.ok) {
          const d = await r.json();
          const c = d.data?.[0];
          if (c) {
            cards.push({
              id: String(c.id), name: c.name, game: 'yugioh',
              image: c.card_images?.[0]?.image_url || null,
              set: c.card_sets?.[0]?.set_name || '', rarity: c.card_sets?.[0]?.set_rarity || '',
              priceUSD: parseFloat(c.card_prices?.[0]?.tcgplayer_price || 0),
              priceEUR: parseFloat(c.card_prices?.[0]?.cardmarket_price || 0),
              priceTRY: parseFloat(c.card_prices?.[0]?.tcgplayer_price || 0) ? Math.round(parseFloat(c.card_prices[0].tcgplayer_price) * ratesCache.USD) : 0
            });
          }
        }
      } else if (game === 'magic') {
        const r = await fetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(seed)}`, { signal: AbortSignal.timeout(6000) });
        if (r.ok) {
          const c = await r.json();
          cards.push({
            id: c.id, name: c.name, game: 'magic',
            image: c.image_uris?.normal || c.card_faces?.[0]?.image_uris?.normal || null,
            set: c.set_name || '', rarity: c.rarity || '',
            priceUSD: parseFloat(c.prices?.usd || 0), priceEUR: parseFloat(c.prices?.eur || 0),
            priceTRY: parseFloat(c.prices?.usd || 0) ? Math.round(parseFloat(c.prices.usd) * ratesCache.USD) : 0
          });
        }
      }
    } catch(e) { /* skip */ }
  }
  
  const data = { cards, game, updatedAt: new Date().toISOString() };
  popularCardCache.set(cacheKey, { data, ts: Date.now() });
  res.json(data);
});


// Ürün takibe al
app.post('/api/tracker/products', requireAuth, async(req, res) => {
  const { name, searchQuery, ourPrice, costPrice, platformId, rules } = req.body;
  if (!name) return res.status(400).json({ error: 'name gerekli' });
  
  const product = {
    id: `tp_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
    user_id: req.userId,
    name,
    search_query: searchQuery || name,
    our_price: ourPrice || 0,
    cost_price: costPrice || 0,
    platform_id: platformId || null,
    rules: rules || { beatByAmount: 0.10, minMarginPercent: 5, maxDropPercent: 30 },
    suggested_price: null,
    lowest_competitor: null,
    last_competitors: [],
    price_history: [],
    last_scan_at: null,
    competitor_count: 0,
    auto_sync: false,
    scheduler_minutes: 60,
    created_at: new Date().toISOString()
  };
  
  try {
    if (hasSupabase) {
      await sbQuery('tracked_products', 'POST', product);
    } else {
      db.saveTrackedProduct(product);
    }
    
    // İlk tarama yap
    const serpData = await serpAPISearch(product.search_query);
    let competitors = serpData.results || [];
    
    // Group and pick the target model to prevent cheap accessories
    const groups = groupSearchResults(competitors, product.search_query);
    const targetGroup = groups.find(g => g.key !== '__accessories__');
    if (targetGroup && targetGroup.items && targetGroup.items.length > 0) {
       competitors = targetGroup.items;
       serpData.lowestPrice = targetGroup.lowestPrice;
       serpData.avgPrice = Math.round(competitors.reduce((s,r)=>s+r.priceTRY,0)/competitors.length);
    }

    product.last_competitors = competitors.slice(0, 20);
    product.competitor_count = competitors.length;
    
    if (competitors.length && product.rules) {
      const calc = calculateBeatPrice(competitors, { ...product.rules, currentPrice: product.our_price });
      if (calc) {
        product.suggested_price = calc.suggestedPrice;
        product.lowest_competitor = calc.lowestCompetitor;
        product.last_scan_at = new Date().toISOString();
      }
    }
    
    product.price_history = [{
      ts: new Date().toISOString(),
      lowestPrice: serpData.lowestPrice,
      avgPrice: serpData.avgPrice,
      competitors: competitors.slice(0, 10).map(c => ({ source: c.source, platform: c.platform, price: c.priceTRY }))
    }];
    
    // Supabase'e güncelle
    if (hasSupabase) {
      await sbQuery('tracked_products', 'PATCH', {
        last_competitors: product.last_competitors,
        competitor_count: product.competitor_count,
        suggested_price: product.suggested_price,
        lowest_competitor: product.lowest_competitor,
        last_scan_at: product.last_scan_at,
        price_history: product.price_history
      }, `?id=eq.${product.id}`);
    } else {
      db.saveTrackedProduct(product);
    }
    addLog('tracker', 'TRACKER', `${name} takibe alındı — ${serpData.results?.length || 0} rakip`, 'success');
    res.json({ ok: true, product });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Takip edilen ürünleri listele
app.get('/api/tracker/products', requireAuth, async(req, res) => {
  try {
    let products;
    if (hasSupabase) {
      products = await sbQuery('tracked_products', 'GET', null, `?user_id=eq.${req.userId}&order=created_at.desc`);
    } else {
      products = db.getTrackedProducts(req.userId);
    }
    // Zamanlayıcı durumunu ekle
    products = products.map(p => ({
      ...p,
      hasScheduler: !!trackerSchedulers[`tracker_${p.id}`],
      schedulerMinutes: trackerSchedulers[`tracker_${p.id}`]?.intervalMinutes || null
    }));
    res.json(products);
  } catch(e) {
    res.json([]);
  }
});

// Tek ürün detay
app.get('/api/tracker/products/:id', requireAuth, async(req, res) => {
  try {
    let p;
    if (hasSupabase) {
      const rows = await sbQuery('tracked_products', 'GET', null, `?id=eq.${req.params.id}&user_id=eq.${req.userId}`);
      if (!rows.length) return res.status(404).json({ error: 'Bulunamadı' });
      p = rows[0];
    } else {
      p = db.getTrackedProduct(req.params.id, req.userId);
      if (!p) return res.status(404).json({ error: 'Bulunamadı' });
    }
    res.json(p);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Ürünü güncelle
app.patch('/api/tracker/products/:id', requireAuth, async(req, res) => {
  try {
    let p;
    if (hasSupabase) {
      const rows = await sbQuery('tracked_products', 'GET', null, `?id=eq.${req.params.id}&user_id=eq.${req.userId}`);
      if (!rows.length) return res.status(404).json({ error: 'Bulunamadı' });
      p = rows[0];
    } else {
      p = db.getTrackedProduct(req.params.id, req.userId);
      if (!p) return res.status(404).json({ error: 'Bulunamadı' });
    }
    
    const updates = req.body;
    let norm = normalizeTrackedProduct(updates);
    
    if (hasSupabase) {
      const payload = sbPatchPayload(norm);
      await sbQuery('tracked_products', 'PATCH', payload, `?id=eq.${p.id}`);
      p = { ...p, ...payload };
    } else {
      Object.assign(p, norm);
      db.saveTrackedProduct(p);
    }
    res.json({ ok: true, product: p });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Ürünü sil
app.delete('/api/tracker/products/:id', requireAuth, async(req, res) => {
  try {
    stopTrackerScheduler(req.params.id);
    if (hasSupabase) {
      await sbQuery('tracked_products', 'DELETE', null, `?id=eq.${req.params.id}&user_id=eq.${req.userId}`);
    } else {
      db.deleteTrackedProduct(req.params.id);
    }
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Manuel tarama tetikle
app.post('/api/tracker/products/:id/scan', requireAuth, async(req, res) => {
  try {
    let p;
    if (hasSupabase) {
      const rows = await sbQuery('tracked_products', 'GET', null, `?id=eq.${req.params.id}&user_id=eq.${req.userId}`);
      if (!rows.length) return res.status(404).json({ error: 'Bulunamadı' });
      p = rows[0];
    } else {
      p = db.getTrackedProduct(req.params.id, req.userId);
      if (!p) return res.status(404).json({ error: 'Bulunamadı' });
    }
    
    const serpData = await serpAPISearch(p.search_query || p.name);
    const competitors = (serpData.results || []).slice(0, 20);
    const history = Array.isArray(p.price_history) ? p.price_history : [];
    
    history.push({
      ts: new Date().toISOString(),
      lowestPrice: serpData.lowestPrice,
      avgPrice: serpData.avgPrice,
      competitors: (serpData.results || []).slice(0, 10).map(c => ({ source: c.source, platform: c.platform, price: c.priceTRY }))
    });
    if (history.length > 100) history.splice(0, history.length - 100);
    
    const updates = {
      last_competitors: competitors,
      competitor_count: serpData.results?.length || 0,
      last_scan_at: new Date().toISOString(),
      price_history: history
    };
    
    if (serpData.results?.length && p.rules) {
      const calc = calculateBeatPrice(serpData.results, { ...p.rules, currentPrice: p.our_price || 0 });
      if (calc) {
        updates.suggested_price = calc.suggestedPrice;
        updates.lowest_competitor = calc.lowestCompetitor;
      }
    }
    
    if (hasSupabase) {
      await sbQuery('tracked_products', 'PATCH', updates, `?id=eq.${p.id}`);
    } else {
      Object.assign(p, updates);
      db.saveTrackedProduct(p);
    }
    
    res.json({ ok: true, product: { ...p, ...updates }, serpData });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Takip ürününden platform ürünü oluştur
app.post('/api/tracker/products/:id/create-platform-product', requireAuth, async(req, res) => {
  try {
    let p;
    if (hasSupabase) {
      const rows = await sbQuery('tracked_products', 'GET', null, `?id=eq.${req.params.id}&user_id=eq.${req.userId}`);
      if (!rows.length) return res.status(404).json({ error: 'Bulunamadı' });
      p = normalizeTrackedProduct(rows[0]);
    } else {
      p = db.getTrackedProduct(req.params.id, req.userId);
      if (!p) return res.status(404).json({ error: 'Bulunamadı' });
    }

    const platformId = req.body?.platformId || p.platform_id || p.platformId;
    if (!platformId) return res.status(400).json({ error: 'Önce bir platform bağlamalısınız' });

    const platform = await getPlatformForUser(platformId, req.userId);
    const priceTRY = Math.max(10, Math.round(Number(req.body?.price || p.suggested_price || p.suggestedPrice || p.lowest_competitor || p.lowestCompetitor || p.our_price || p.ourPrice || 0)));
    const card = buildTrackerPlatformCard(p);
    const created = await platformCreateProduct(platform, card, priceTRY);

    const updates = {
      platform_id: platformId,
      platform_product_id: created?.id || null,
      platform_variant_id: created?.variantId || null,
      our_price: priceTRY
    };

    if (hasSupabase) {
      await sbQuery('tracked_products', 'PATCH', updates, `?id=eq.${req.params.id}&user_id=eq.${req.userId}`);
    } else {
      Object.assign(p, updates);
      db.saveTrackedProduct(p);
    }

    addLog(platformId, 'TRACKER-CREATE', `${p.name} platformda oluşturuldu`, 'success');
    res.json({ ok: true, priceTRY, created, product: { ...p, ...updates } });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Fiyatı platforma push et
app.post('/api/tracker/products/:id/push', requireAuth, async(req, res) => {
  try {
    let p;
    if (hasSupabase) {
      const rows = await sbQuery('tracked_products', 'GET', null, `?id=eq.${req.params.id}&user_id=eq.${req.userId}`);
      if (!rows.length) return res.status(404).json({ error: 'Bulunamadı' });
      p = normalizeTrackedProduct(rows[0]);
    } else {
      p = db.getTrackedProduct(req.params.id, req.userId);
      if (!p) return res.status(404).json({ error: 'Bulunamadı' });
      p = normalizeTrackedProduct(p);
    }
    
    const platformId = p.platform_id;
    if (!platformId) return res.status(400).json({ error: 'Platform bağlı değil' });
    
    const price = req.body.price || p.suggested_price;
    if (!price) return res.status(400).json({ error: 'Fiyat hesaplanmamış' });
    
    const platform = await getPlatformForUser(platformId, req.userId);
    // Platform ürün ID'si varsa güncelle
    if (p.platform_product_id && p.platform_variant_id) {
      await platformUpdatePrice(platform, { id: p.platform_product_id, variantId: p.platform_variant_id }, price);
    } else {
      return res.status(400).json({ error: 'Platform ürünü oluşturulmamış, önce platform ürünü oluşturun' });
    }
    
    p.our_price = price;
    
    if (hasSupabase) {
      await sbQuery('tracked_products', 'PATCH', { our_price: price }, `?id=eq.${p.id}`);
    } else {
      db.saveTrackedProduct(p);
    }
    
    addLog(platformId, 'TRACKER-PUSH', `${p.name} → ${price}₺`, 'success');
    res.json({ ok: true, price });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Zamanlayıcı başlat
app.post('/api/tracker/products/:id/scheduler/start', requireAuth, async(req, res) => {
  try {
    let p;
    if (hasSupabase) {
      const rows = await sbQuery('tracked_products', 'GET', null, `?id=eq.${req.params.id}&user_id=eq.${req.userId}`);
      if (!rows.length) return res.status(404).json({ error: 'Bulunamadı' });
      p = rows[0];
    } else {
      p = db.getTrackedProduct(req.params.id, req.userId);
      if (!p) return res.status(404).json({ error: 'Bulunamadı' });
    }
    const minutes = req.body.intervalMinutes || 60;
    startTrackerScheduler(p.id, req.userId, minutes);
    if (hasSupabase) {
      await sbQuery('tracked_products', 'PATCH', { scheduler_minutes: minutes }, `?id=eq.${p.id}`);
    } else {
      p.scheduler_minutes = minutes;
      db.saveTrackedProduct(p);
    }
    res.json({ ok: true, intervalMinutes: minutes });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Zamanlayıcı durdur
app.post('/api/tracker/products/:id/scheduler/stop', requireAuth, async(req, res) => {
  try {
    stopTrackerScheduler(req.params.id);
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Toplu beat hesaplama
app.post('/api/tracker/calculate-beat', requireAuth, async(req, res) => {
  const { competitorPrices, rules } = req.body;
  if (!competitorPrices?.length) return res.status(400).json({ error: 'competitorPrices gerekli' });
  const result = calculateBeatPrice(competitorPrices, rules || {});
  res.json(result);
});

// SerpAPI durum
app.get('/api/tracker/status', (req, res) => {
  res.json({
    serpAPI: hasSerpAPI,
    activeTrackers: Object.keys(trackerSchedulers).length,
    cacheSize: serpCache.size
  });
});

// ── PLATFORMLAR ──
app.get('/api/platforms', requireAuth, async(req,res)=>{
  try{
    let rows;
    if(hasSupabase){rows=await sbQuery('platforms','GET',null,`?user_id=eq.${req.userId}&order=created_at.asc`);}
    else{rows=db.getPlatforms();}
    res.json(rows.map(p=>({id:p.id,name:p.name,type:p.type,enabled:p.enabled,created_at:p.created_at,config:p.config,hasScheduler:!!schedulers[p.id],schedulerInterval:schedulers[p.id]?.intervalHours||null})));
  }catch(e){res.json([]);}
});

app.post('/api/platforms', requireAuth, async(req,res)=>{
  const{id,name,type,config}=req.body;
  if(!id||!name||!type||!config)return res.status(400).json({error:'Eksik alan'});
  try{
    const cfg=typeof config==='string'?config:JSON.stringify(config);
    if(hasSupabase){await sbQuery('platforms','POST',{id,name,type,config:cfg,enabled:true,user_id:req.userId});}
    else{db.savePlatform({id,name,type,config:cfg,enabled:1,created_at:new Date().toISOString()});}
    res.json({ok:true});
  }catch(e){res.status(500).json({error:e.message});}
});

app.delete('/api/platforms/:id', requireAuth, async(req,res)=>{
  stopPlatformScheduler(req.params.id);
  try{
    if(hasSupabase){await sbQuery('platforms','DELETE',null,`?id=eq.${req.params.id}&user_id=eq.${req.userId}`);}
    else{db.deletePlatform(req.params.id);}
    res.json({ok:true});
  }catch(e){res.status(500).json({error:e.message});}
});

app.post('/api/platforms/:id/test', requireAuth, async(req,res)=>{
  try{const p=await getPlatformForUser(req.params.id,req.userId);const products=await platformGetProducts(p);res.json({ok:true,productCount:products.length});}
  catch(e){res.status(500).json({error:e.message});}
});

app.post('/api/platforms/:id/products', requireAuth, async(req,res)=>{
  try{const p=await getPlatformForUser(req.params.id,req.userId);const products=await platformGetProducts(p);res.json({products,total:products.length});}
  catch(e){res.status(500).json({error:e.message});}
});

app.post('/api/platforms/:id/update-prices', requireAuth, async(req,res)=>{
  try{
    const p=await getPlatformForUser(req.params.id,req.userId);
    const{updates}=req.body;if(!updates?.length)return res.status(400).json({error:'updates boş'});
    let ok=0,fail=0;
    for(const u of updates){try{await platformUpdatePrice(p,u,u.newPrice);ok++;}catch(e){fail++;}}
    res.json({ok:true,updated:ok,failed:fail});
  }catch(e){res.status(500).json({error:e.message});}
});

app.post('/api/platforms/:id/import-card', requireAuth, async(req,res)=>{
  try{
    const p=await getPlatformForUser(req.params.id,req.userId);
    const{card}=req.body;await refreshRates();
    const st=STRATEGIES[detectCategory((card.game||'')+' '+card.name)]||STRATEGIES.default;
    let priceTRY=0;
    if(card.priceEUR)priceTRY=Math.round(card.priceEUR*ratesCache.EUR*1.03*(1+st.marginAboveGlobal/100)/5)*5;
    else if(card.priceUSD)priceTRY=Math.round(card.priceUSD*ratesCache.USD*1.03*(1+st.marginAboveGlobal/100)/5)*5;
    if(priceTRY<10)priceTRY=10;
    const created=await platformCreateProduct(p,card,priceTRY);
    res.json({ok:true,priceTRY,...created});
  }catch(e){res.status(500).json({error:e.message});}
});

app.post('/api/platforms/:id/import-sealed', requireAuth, async(req,res)=>{
  try{
    const p=await getPlatformForUser(req.params.id,req.userId);
    const{product}=req.body;await refreshRates();
    const st=STRATEGIES[detectCategory(product.name)]||STRATEGIES.default;
    let priceTRY=product.priceUSD?Math.round(parseFloat(product.priceUSD)*ratesCache.USD*1.03*(1+st.marginAboveGlobal/100)/5)*5:0;
    if(priceTRY<10)priceTRY=10;
    const card={name:product.name,id:`pc-${product.id}`,game:product.console||'sealed',image:product.image||null,priceUSD:parseFloat(product.priceUSD||0),priceEUR:0,set:product.console||'',rarity:'Sealed'};
    const created=await platformCreateProduct(p,card,priceTRY);
    res.json({ok:true,priceTRY,...created});
  }catch(e){res.status(500).json({error:e.message});}
});

app.post('/api/platforms/:id/import-tracker-product', requireAuth, async(req,res)=>{
  try{
    const p=await getPlatformForUser(req.params.id,req.userId);
    const product=req.body?.product||{};
    if(!product.name)return res.status(400).json({error:'product.name gerekli'});
    const priceTRY=Math.max(10, Math.round(Number(req.body?.priceTRY || product.priceTRY || product.lowestPrice || 0)));
    const card=buildTrackerPlatformCard(product);
    const created=await platformCreateProduct(p,card,priceTRY);
    res.json({ok:true,priceTRY,...created});
  }catch(e){res.status(500).json({error:e.message});}
});

app.post('/api/platforms/:id/scheduler/start', requireAuth, async(req,res)=>{
  try{await getPlatformForUser(req.params.id,req.userId);const{intervalHours}=req.body;startPlatformScheduler(req.params.id,intervalHours||6);res.json({ok:true,intervalHours});}
  catch(e){res.status(500).json({error:e.message});}
});
app.post('/api/platforms/:id/scheduler/stop', requireAuth, async(req,res)=>{
  try{await getPlatformForUser(req.params.id,req.userId);stopPlatformScheduler(req.params.id);res.json({ok:true});}
  catch(e){res.status(500).json({error:e.message});}
});
app.post('/api/platforms/:id/scheduler/run-now', requireAuth, async(req,res)=>{
  try{await getPlatformForUser(req.params.id,req.userId);res.json({ok:true});runPlatformUpdate(req.params.id);}
  catch(e){res.status(500).json({error:e.message});}
});

// Loglar
app.get('/api/logs', requireAuth, async(req,res)=>{
  try{
    const{platformId,limit=100}=req.query;
    if(hasSupabase){
      let filter=`?user_id=eq.${req.userId}&order=created_at.desc&limit=${limit}`;
      if(platformId)filter+=`&platform_id=eq.${platformId}`;
      res.json(await sbQuery('logs','GET',null,filter));
    }else{res.json(db.getLogs(platformId,parseInt(limit)));}
  }catch(e){res.json([]);}
});

// Kart kataloğu (herkese açık)
app.get('/api/catalog/pokemon/sets',async(req,res)=>{try{res.json(await(await fetch('https://api.tcgdex.net/v2/en/sets',{signal:AbortSignal.timeout(10000)})).json());}catch(e){res.status(500).json({error:e.message});}});
app.get('/api/catalog/pokemon/set/:id',async(req,res)=>{try{res.json(await(await fetch(`https://api.tcgdex.net/v2/en/sets/${req.params.id}`,{signal:AbortSignal.timeout(10000)})).json());}catch(e){res.status(500).json({error:e.message});}});
app.get('/api/catalog/pokemon/card/:id',async(req,res)=>{try{res.json(await(await fetch(`https://api.tcgdex.net/v2/en/cards/${req.params.id}`,{signal:AbortSignal.timeout(10000)})).json());}catch(e){res.status(500).json({error:e.message});}});
app.get('/api/catalog/pokemon/search',async(req,res)=>{try{const d=await(await fetch(`https://api.tcgdex.net/v2/en/cards?name=${encodeURIComponent(req.query.q||'')}&itemsPerPage=24`,{signal:AbortSignal.timeout(10000)})).json();res.json(Array.isArray(d)?d:[]);}catch(e){res.status(500).json({error:e.message});}});
app.get('/api/catalog/yugioh/search',async(req,res)=>{try{const d=await(await fetch(`https://db.ygoprodeck.com/api/v7/cardinfo.php?fname=${encodeURIComponent(req.query.q||'')}&num=24`,{signal:AbortSignal.timeout(10000)})).json();res.json((d.data||[]).map(c=>({id:String(c.id),name:c.name,game:'yugioh',image:c.card_images?.[0]?.image_url,set:c.card_sets?.[0]?.set_name||'',rarity:c.card_sets?.[0]?.set_rarity||'',priceUSD:parseFloat(c.card_prices?.[0]?.tcgplayer_price||0),priceEUR:parseFloat(c.card_prices?.[0]?.cardmarket_price||0)})));}catch(e){res.status(500).json({error:e.message});}});
app.get('/api/catalog/yugioh/sets',async(req,res)=>{try{res.json(await(await fetch('https://db.ygoprodeck.com/api/v7/cardsets.php',{signal:AbortSignal.timeout(10000)})).json()||[]);}catch(e){res.status(500).json({error:e.message});}});
app.get('/api/catalog/yugioh/set/:name',async(req,res)=>{try{const d=await(await fetch(`https://db.ygoprodeck.com/api/v7/cardinfo.php?cardset=${encodeURIComponent(req.params.name)}`,{signal:AbortSignal.timeout(15000)})).json();res.json((d.data||[]).map(c=>({id:String(c.id),name:c.name,game:'yugioh',image:c.card_images?.[0]?.image_url,rarity:c.card_sets?.find(s=>s.set_name===req.params.name)?.set_rarity||'',priceUSD:parseFloat(c.card_prices?.[0]?.tcgplayer_price||0),priceEUR:parseFloat(c.card_prices?.[0]?.cardmarket_price||0)})));}catch(e){res.status(500).json({error:e.message});}});
app.get('/api/catalog/magic/search',async(req,res)=>{try{const d=await(await fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(req.query.q||'')}&limit=24`,{signal:AbortSignal.timeout(10000)})).json();res.json((d.data||[]).map(c=>({id:c.id,name:c.name,game:'magic',image:c.image_uris?.normal||c.card_faces?.[0]?.image_uris?.normal,set:c.set_name,rarity:c.rarity,priceUSD:parseFloat(c.prices?.usd||0),priceEUR:parseFloat(c.prices?.eur||0)})));}catch(e){res.status(500).json({error:e.message});}});
app.get('/api/catalog/magic/sets',async(req,res)=>{try{const d=await(await fetch('https://api.scryfall.com/sets',{signal:AbortSignal.timeout(10000)})).json();res.json((d.data||[]).filter(s=>s.card_count>0).slice(0,100).map(s=>({id:s.code,name:s.name,count:s.card_count,game:'magic'})));}catch(e){res.status(500).json({error:e.message});}});
app.get('/api/catalog/onepiece/search',async(req,res)=>{try{const d=await(await fetch(`https://optcgapi.com/api/cards/?search=${encodeURIComponent(req.query.q||'')}`,{signal:AbortSignal.timeout(10000)})).json();res.json((d.results||d||[]).slice(0,24).map(c=>({id:c.card_id||c.id,name:c.name,game:'onepiece',image:c.image_url||c.image,rarity:c.rarity||'',set:c.set||'',priceUSD:parseFloat(c.price||0),priceEUR:0})));}catch(e){res.status(500).json({error:e.message});}});

// Multi-source kart fiyatı
app.get('/api/card-prices', async(req,res)=>{
  const{name,game,id}=req.query;if(!name)return res.status(400).json({error:'name gerekli'});
  await refreshRates();const rates=ratesCache,sources=[],tasks=[];
  if(!game||game==='pokemon'){tasks.push((async()=>{try{let card;if(id){const r=await fetch(`https://api.tcgdex.net/v2/en/cards/${id}`,{signal:AbortSignal.timeout(8000)});if(r.ok)card=await r.json();}else{const r=await fetch(`https://api.tcgdex.net/v2/en/cards?name=${encodeURIComponent(name)}&itemsPerPage=1`,{signal:AbortSignal.timeout(8000)});if(r.ok){const l=await r.json();if(l[0]){const dr=await fetch(`https://api.tcgdex.net/v2/en/cards/${l[0].id}`,{signal:AbortSignal.timeout(8000)});if(dr.ok)card=await dr.json();}}}if(card?.pricing){const cm=card.pricing.cardmarket?.avg30||0,t=card.pricing.cardmarket?.trend||0,tn=card.pricing.tcgplayer?.normal?.marketPrice||0,th=card.pricing.tcgplayer?.holo?.marketPrice||0;if(cm>0)sources.push({source:'Cardmarket',type:'EUR',price:cm,priceTRY:Math.round(cm*rates.EUR),logo:'cm',trend:t>0?((cm-t)/t*100).toFixed(1):null});if(tn>0)sources.push({source:'TCGPlayer',type:'USD',price:tn,priceTRY:Math.round(tn*rates.USD),logo:'tcp',variant:'Normal'});if(th>0)sources.push({source:'TCGPlayer Holo',type:'USD',price:th,priceTRY:Math.round(th*rates.USD),logo:'tcp',variant:'Holo'});}}catch(e){}})());}
  if(!game||game==='yugioh'){tasks.push((async()=>{try{const r=await fetch(`https://db.ygoprodeck.com/api/v7/cardinfo.php?fname=${encodeURIComponent(name)}&num=1`,{signal:AbortSignal.timeout(8000)});if(r.ok){const d=await r.json();const p=d.data?.[0]?.card_prices?.[0];if(p){const tc=parseFloat(p.tcgplayer_price||0),cm=parseFloat(p.cardmarket_price||0),eb=parseFloat(p.ebay_price||0),am=parseFloat(p.amazon_price||0);if(tc>0)sources.push({source:'TCGPlayer',type:'USD',price:tc,priceTRY:Math.round(tc*rates.USD),logo:'tcp'});if(cm>0)sources.push({source:'Cardmarket',type:'EUR',price:cm,priceTRY:Math.round(cm*rates.EUR),logo:'cm'});if(eb>0)sources.push({source:'eBay',type:'USD',price:eb,priceTRY:Math.round(eb*rates.USD),logo:'ebay'});if(am>0)sources.push({source:'Amazon',type:'USD',price:am,priceTRY:Math.round(am*rates.USD),logo:'amz'});}}}catch(e){}})());}
  if(!game||game==='magic'){tasks.push((async()=>{try{const r=await fetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}`,{signal:AbortSignal.timeout(8000)});if(r.ok){const c=await r.json();const p=c.prices;if(p?.usd)sources.push({source:'TCGPlayer',type:'USD',price:parseFloat(p.usd),priceTRY:Math.round(parseFloat(p.usd)*rates.USD),logo:'tcp',variant:'Normal'});if(p?.usd_foil)sources.push({source:'TCGPlayer Foil',type:'USD',price:parseFloat(p.usd_foil),priceTRY:Math.round(parseFloat(p.usd_foil)*rates.USD),logo:'tcp',variant:'Foil'});if(p?.eur)sources.push({source:'Cardmarket',type:'EUR',price:parseFloat(p.eur),priceTRY:Math.round(parseFloat(p.eur)*rates.EUR),logo:'cm',variant:'Normal'});if(p?.eur_foil)sources.push({source:'Cardmarket Foil',type:'EUR',price:parseFloat(p.eur_foil),priceTRY:Math.round(parseFloat(p.eur_foil)*rates.EUR),logo:'cm',variant:'Foil'});}}catch(e){}})());}
  tasks.push((async()=>{try{const items=hasEbayBrowse?await ebayBrowseSearch(name+' card',5,game||'default'):await ebayFindingSearch(name+' card',5);if(items.length){const prices=items.map(i=>parseFloat(i.price||0)).filter(p=>p>0);if(prices.length){const avg=prices.reduce((a,b)=>a+b,0)/prices.length,min=Math.min(...prices);sources.push({source:'eBay (Ort.)',type:'USD',price:+avg.toFixed(2),priceTRY:Math.round(avg*rates.USD),logo:'ebay',items:prices.length});sources.push({source:'eBay (Min)',type:'USD',price:+min.toFixed(2),priceTRY:Math.round(min*rates.USD),logo:'ebay',variant:'Min'});}}}catch(e){}})());
  await Promise.all(tasks);
  const tryPrices=sources.filter(s=>s.priceTRY>0).map(s=>s.priceTRY);
  const avgTRY=tryPrices.length?Math.round(tryPrices.reduce((a,b)=>a+b,0)/tryPrices.length):null;
  res.json({sources,averageTRY:avgTRY,confidence:sources.length,rates:{USD:rates.USD,EUR:rates.EUR}});
});

// ── Sealed ──
function pennies(n){return n?(n/100).toFixed(2):null;}

app.get('/api/sealed/search', async(req,res)=>{
  const q=req.query.q||'',game=req.query.game||'all';
  if(!q)return res.status(400).json({error:'q gerekli'});
  await refreshRates();const results=[];
  if(hasPriceCharting){try{const cMap={pokemon:'Pokemon Cards',yugioh:'Yu-Gi-Oh',magic:'Magic The Gathering',onepiece:'One Piece Card Game',sealed:'Pokemon Sealed Products',all:''};const cn=cMap[game]||'';const r=await fetch(`https://www.pricecharting.com/api/products?t=${PRICECHARTING_TOKEN}&q=${encodeURIComponent(cn?`${q} ${cn}`:q)}`,{signal:AbortSignal.timeout(8000)});const d=await r.json();if(d.status==='success')(d.products||[]).forEach(p=>results.push({id:p.id,name:p['product-name'],console:p['console-name'],game,source:'pricecharting'}));}catch(e){}}
  if(results.length<5){const gKw={pokemon:'Pokemon sealed booster',yugioh:'Yu-Gi-Oh booster box',magic:'MTG booster box',onepiece:'One Piece TCG booster',sealed:'TCG sealed booster box',all:'TCG sealed'};const searchQ=`${q} ${gKw[game]||'TCG sealed'}`;try{const items=hasEbayBrowse?await ebayBrowseSearch(searchQ,16):await ebayRSSSearch(searchQ,16);items.forEach(i=>results.push({...i,console:game.toUpperCase(),game}));}catch(e){}}
  res.json(results);
});

app.get('/api/sealed/price/:id', async(req,res)=>{
  const pcId=req.params.id;
  if(pcId.startsWith('ebay-')||pcId.startsWith('rss-'))return res.json({id:pcId,name:'eBay Ürünü',console:'',prices:{},suggestedTRY:null,usdRate:ratesCache.USD});
  if(!hasPriceCharting)return res.json({id:pcId,name:'',console:'',prices:{},suggestedTRY:null,usdRate:ratesCache.USD,note:'PriceCharting token gerekli'});
  try{
    const r=await fetch(`https://www.pricecharting.com/api/product?t=${PRICECHARTING_TOKEN}&id=${pcId}`,{signal:AbortSignal.timeout(10000)});
    const d=await r.json();if(d.status!=='success')throw new Error(d['error-message']||'Bulunamadı');
    await refreshRates();const usd=parseFloat(pennies(d['loose-price'])||pennies(d['cib-price'])||pennies(d['new-price'])||0);
    res.json({id:d.id,name:d['product-name'],console:d['console-name'],releaseDate:d['release-date'],upc:d.upc,asin:d.asin,prices:{loose:{usd:pennies(d['loose-price']),label:'Ungraded / Loose'},cib:{usd:pennies(d['cib-price']),label:'Complete / Graded 7'},new:{usd:pennies(d['new-price']),label:'New Sealed / Graded 8'},graded:{usd:pennies(d['graded-price']),label:'Graded 9'},psa10:{usd:pennies(d['manual-only-price']),label:'PSA 10'},bgs10:{usd:pennies(d['bgs-10-price']),label:'BGS 10'}},suggestedTRY:usd?Math.round(usd*ratesCache.USD*1.03):null,usdRate:ratesCache.USD});
  }catch(e){res.status(500).json({error:e.message});}
});

app.get('/api/sealed/ebay', async(req,res)=>{
  const q=req.query.q||'',limit=Math.min(parseInt(req.query.limit)||16,24),category=req.query.category||null;
  if(!q)return res.status(400).json({error:'q gerekli'});
  await refreshRates();
  try{
    let items=hasEbayBrowse?await ebayBrowseSearch(q,limit,category):await ebayRSSSearch(q,limit);
    res.json({items,total:items.length,source:hasEbayBrowse?'browse':'rss'});
  }catch(e){
    try{const fb=await ebayRSSSearch(q,limit);res.json({items:fb,total:fb.length,source:'rss-fallback'});}
    catch(e2){res.json({items:[],total:0,error:e.message});}
  }
});

app.get('/api/sealed/ebay-sold', async(req,res)=>{
  const q=req.query.q||'',category=req.query.category||null;
  if(!q)return res.status(400).json({error:'q gerekli'});
  await refreshRates();
  try{const items=await ebaySoldSearch(q,10,category);const avgUSD=items.length?items.reduce((s,i)=>s+i.price,0)/items.length:null;res.json({items,avgUSD:avgUSD?.toFixed(2)||null,avgTRY:avgUSD?Math.round(avgUSD*ratesCache.USD):null});}
  catch(e){res.json({items:[],error:e.message});}
});

app.get('/api/sealed/sports', async(req,res)=>{
  const q=req.query.q||'',sport=req.query.sport||'nfl';
  if(!q)return res.status(400).json({error:'q gerekli'});
  await refreshRates();const results=[],seen=new Set();
  function push(item){if(!item.name||seen.has(item.id))return;seen.add(item.id);results.push(item);}
  const meta={nfl:{label:'NFL Football',kw:'NFL football card'},nba:{label:'NBA Basketball',kw:'NBA basketball card'},mlb:{label:'MLB Baseball',kw:'MLB baseball card'},soccer:{label:'Soccer',kw:'soccer card Panini'}};
  const m=meta[sport]||meta.nfl,searchQ=`${q} ${m.kw}`;
  if(hasEbayBrowse){try{(await ebayBrowseSearch(searchQ,20,sport)).forEach(i=>push({...i,console:m.label,sport}));}catch(e){}}
  if(results.length<8){try{(await ebayRSSSearch(searchQ,20)).forEach(i=>push({...i,console:m.label,sport}));}catch(e){}}
  if(hasPriceCharting&&results.length<10){try{const gm={nfl:'Football',nba:'Basketball',mlb:'Baseball',soccer:'Soccer'};const r=await fetch(`https://www.pricecharting.com/api/products?t=${PRICECHARTING_TOKEN}&q=${encodeURIComponent(q+' '+(gm[sport]||''))}`,{signal:AbortSignal.timeout(8000)});const d=await r.json();if(d.status==='success')(d.products||[]).forEach(p=>push({id:p.id,name:p['product-name'],console:p['console-name']||m.label,sport,source:'PriceCharting'}));}catch(e){}}
  res.json(results);
});

app.get('/api/ebay/test', async(req,res)=>{
  try{const token=await getEbayToken();res.json({ok:true,hasToken:!!token});}
  catch(e){res.status(500).json({ok:false,error:e.message});}
});

app.get('/api/health', async(req,res)=>{
  const rates=await refreshRates();
  res.json({ok:true,version:'3.0.0',rates,schedulers:Object.keys(schedulers),trackerSchedulers:Object.keys(trackerSchedulers),features:{priceCharting:hasPriceCharting,ebayBrowse:hasEbayBrowse,supabase:hasSupabase,serpAPI:hasSerpAPI}});
});

// ─────────────────────────────────────────────
app.listen(PORT, async()=>{
  console.log(`\n🚀 PriceBot Pro v3.0 → http://localhost:${PORT}`);
  console.log(`   Supabase:       ${hasSupabase?'✅ aktif':'⚠️  JSON fallback'}`);
  console.log(`   eBay:           ${hasEbayBrowse?'✅ Browse API':'⚠️  RSS fallback'}`);
  console.log(`   PriceCharting:  ${hasPriceCharting?'✅ aktif':'⚠️  kapalı'}`);
  console.log(`   SerpAPI:        ${hasSerpAPI?'✅ aktif':'⚠️  kapalı'}\n`);
  await refreshRates();
});
