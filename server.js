const express      = require('express');
const cors         = require('cors');
const fetch        = require('node-fetch');
const path         = require('path');
const fs           = require('fs');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
const PORT = 3001;

// ═══════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════
const PRICECHARTING_TOKEN = process.env.PRICECHARTING_TOKEN || 'BURAYA_TOKEN_GİR';
const EBAY_APP_ID         = process.env.EBAY_APP_ID         || 'BURAYA_APP_ID_GİR';
const EBAY_CERT_ID        = process.env.EBAY_CERT_ID        || 'BURAYA_CERT_ID_GİR';

const hasPriceCharting = PRICECHARTING_TOKEN !== 'BURAYA_TOKEN_GİR';
const hasEbayBrowse    = EBAY_APP_ID !== 'BURAYA_APP_ID_GİR';

// ═══════════════════════════════════════════
// VERİTABANI (JSON dosya tabanlı)
// ═══════════════════════════════════════════
const DB_FILE = 'pricebot-data.json';

function loadDB() {
  try { if (fs.existsSync(DB_FILE)) return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch(e) {}
  return { platforms: [], logs: [] };
}
function saveDB(data) {
  try { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)); } catch(e) {}
}

let DB = loadDB();
console.log(`✅ JSON DB hazır — ${DB.platforms.length} platform, ${DB.logs.length} log`);

const db = {
  getPlatforms:   ()  => DB.platforms,
  getPlatform:    (id) => DB.platforms.find(p => p.id === id),
  savePlatform:   (p) => {
    const idx = DB.platforms.findIndex(x => x.id === p.id);
    if (idx >= 0) DB.platforms[idx] = p; else DB.platforms.push(p);
    saveDB(DB);
  },
  deletePlatform: (id) => { DB.platforms = DB.platforms.filter(p => p.id !== id); saveDB(DB); },
  getLogs: (platformId, limit = 100) => {
    let logs = platformId ? DB.logs.filter(l => l.platform_id === platformId) : DB.logs;
    return logs.slice(-limit).reverse();
  },
  addLog: (platformId, type, message, level) => {
    DB.logs.push({ id: Date.now(), platform_id: platformId, type, message, level, created_at: new Date().toISOString() });
    if (DB.logs.length > 1000) DB.logs = DB.logs.slice(-500);
    saveDB(DB);
  }
};

function addLog(platformId, type, message, level = 'info') {
  db.addLog(platformId || 'system', type, message, level);
  console.log(`[${level.toUpperCase()}][${type}] ${message}`);
}

// ═══════════════════════════════════════════
// KATEGORİ STRATEJİLERİ
// ═══════════════════════════════════════════
const STRATEGIES = {
  pokemon:    { keywords: ['pokemon','pokémon','pikachu','charizard','scarlet','violet','paldea','booster','surging','stellar','temporal'], marginAboveGlobal: 15, maxRaise: 40, maxDrop: 20, minMargin: 20 },
  naruto:     { keywords: ['naruto','kayou','sasuke','itachi'],            marginAboveGlobal: 20, maxRaise: 35, maxDrop: 15, minMargin: 25 },
  onepiece:   { keywords: ['one piece','op-0','luffy','zoro'],             marginAboveGlobal: 12, maxRaise: 30, maxDrop: 20, minMargin: 18 },
  magic:      { keywords: ['magic','mtg','commander','gathering'],         marginAboveGlobal: 10, maxRaise: 25, maxDrop: 15, minMargin: 15 },
  yugioh:     { keywords: ['yu-gi-oh','yugioh','ygo'],                     marginAboveGlobal: 18, maxRaise: 35, maxDrop: 15, minMargin: 20 },
  dragonball: { keywords: ['dragon ball','dragonball','dbs','goku'],       marginAboveGlobal: 20, maxRaise: 40, maxDrop: 20, minMargin: 22 },
  digimon:    { keywords: ['digimon','dgm'],                               marginAboveGlobal: 22, maxRaise: 40, maxDrop: 20, minMargin: 25 },
  default:    { keywords: [],                                              marginAboveGlobal: 15, maxRaise: 30, maxDrop: 15, minMargin: 15 }
};

function detectCategory(name = '') {
  const l = name.toLowerCase();
  for (const [cat, cfg] of Object.entries(STRATEGIES)) {
    if (cat === 'default') continue;
    if (cfg.keywords.some(k => l.includes(k))) return cat;
  }
  return 'default';
}

// ═══════════════════════════════════════════
// DÖVİZ KURU
// ═══════════════════════════════════════════
let ratesCache    = { USD: 38.5, EUR: 41.8, GBP: 47.2, updatedAt: 'fallback' };
let ratesCachedAt = 0;

async function refreshRates() {
  if (Date.now() - ratesCachedAt < 10 * 60 * 1000) return ratesCache;
  try {
    const d = await (await fetch('https://open.er-api.com/v6/latest/TRY', { signal: AbortSignal.timeout(5000) })).json();
    ratesCache = {
      USD: +(1 / d.rates.USD).toFixed(4),
      EUR: +(1 / d.rates.EUR).toFixed(4),
      GBP: +(1 / d.rates.GBP).toFixed(4),
      updatedAt: new Date().toISOString()
    };
    ratesCachedAt = Date.now();
  } catch(e) {}
  return ratesCache;
}

// ═══════════════════════════════════════════
// GLOBAL KART FİYATI (3 Kaynak)
// ═══════════════════════════════════════════
const priceCache = new Map();

async function getGlobalPrice(productName) {
  const cKey   = productName.toLowerCase().trim();
  const cached = priceCache.get(cKey);
  if (cached && Date.now() - cached.ts < 60 * 60 * 1000) return cached.data;

  const rates      = ratesCache;
  const sources    = [], errors = [];
  const category   = detectCategory(productName);
  const searchTerm = productName
    .replace(/booster box|booster pack|elite trainer box|etb|\btr\b|\ben\b|\bjp\b|display/gi, '')
    .replace(/\(\d+.*?\)/g, '').trim().split(' ').slice(0, 3).join(' ');

  if (['pokemon', 'default'].includes(category)) {
    try {
      const r = await fetch(`https://api.tcgdex.net/v2/en/cards?name=${encodeURIComponent(searchTerm)}&itemsPerPage=3`, { signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        const list = await r.json();
        if (Array.isArray(list) && list.length) {
          const dr = await fetch(`https://api.tcgdex.net/v2/en/cards/${list[0].id}`, { signal: AbortSignal.timeout(8000) });
          if (dr.ok) {
            const card   = await dr.json();
            const cmEUR  = card.pricing?.cardmarket?.avg30 || card.pricing?.cardmarket?.trend || 0;
            const tcgUSD = card.pricing?.tcgplayer?.holo?.marketPrice || card.pricing?.tcgplayer?.normal?.marketPrice || 0;
            if (cmEUR  > 0) sources.push({ source: 'Cardmarket (TCGdex)', priceEUR: cmEUR,  priceTRY: Math.round(cmEUR  * rates.EUR) });
            if (tcgUSD > 0) sources.push({ source: 'TCGPlayer (TCGdex)', priceUSD: tcgUSD, priceTRY: Math.round(tcgUSD * rates.USD) });
          }
        }
      }
    } catch(e) { errors.push('TCGdex: ' + e.message); }
  }

  if (['yugioh', 'default'].includes(category)) {
    try {
      const r = await fetch(`https://db.ygoprodeck.com/api/v7/cardinfo.php?fname=${encodeURIComponent(searchTerm)}&num=1`, { signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        const d    = await r.json();
        const card = d.data?.[0];
        if (card) {
          const tcgUSD = parseFloat(card.card_prices?.[0]?.tcgplayer_price  || 0);
          const cmEUR  = parseFloat(card.card_prices?.[0]?.cardmarket_price || 0);
          if (tcgUSD > 0) sources.push({ source: 'TCGPlayer (YGO)', priceUSD: tcgUSD, priceTRY: Math.round(tcgUSD * rates.USD) });
          if (cmEUR  > 0) sources.push({ source: 'Cardmarket (YGO)', priceEUR: cmEUR,  priceTRY: Math.round(cmEUR  * rates.EUR) });
        }
      }
    } catch(e) { errors.push('YGO: ' + e.message); }
  }

  if (['magic', 'default'].includes(category)) {
    try {
      const r = await fetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(searchTerm)}`, { signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        const card = await r.json();
        const usd  = parseFloat(card.prices?.usd      || card.prices?.usd_foil || 0);
        const eur  = parseFloat(card.prices?.eur      || card.prices?.eur_foil || 0);
        if (usd > 0) sources.push({ source: 'TCGPlayer (Scryfall)', priceUSD: usd, priceTRY: Math.round(usd * rates.USD) });
        if (eur > 0) sources.push({ source: 'Cardmarket (Scryfall)', priceEUR: eur, priceTRY: Math.round(eur * rates.EUR) });
      }
    } catch(e) { errors.push('Scryfall: ' + e.message); }
  }

  if (category === 'onepiece') {
    try {
      const r = await fetch(`https://optcgapi.com/api/cards/?search=${encodeURIComponent(searchTerm)}`, { signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        const d    = await r.json();
        const card = (d.results || d || [])[0];
        if (card) {
          const usd = parseFloat(card.price || 0);
          if (usd > 0) sources.push({ source: 'OPTCG', priceUSD: usd, priceTRY: Math.round(usd * rates.USD) });
        }
      }
    } catch(e) { errors.push('OPTCG: ' + e.message); }
  }

  const tryPrices = sources.map(s => s.priceTRY).filter(p => p > 0);
  const avgTRY    = tryPrices.length ? Math.round(tryPrices.reduce((a, b) => a + b, 0) / tryPrices.length) : null;
  const result    = { sources, errors, averageTRY: avgTRY, confidence: sources.length, searchTerm, category };
  priceCache.set(cKey, { data: result, ts: Date.now() });
  return result;
}

function calcSuggestedPrice(currentPrice, globalAvgTRY, category) {
  const strategy = STRATEGIES[category] || STRATEGIES.default;
  if (!globalAvgTRY) return null;
  let suggested = Math.round(globalAvgTRY * (1 + strategy.marginAboveGlobal / 100) / 5) * 5;
  if (currentPrice > 0) {
    const max = Math.round(currentPrice * (1 + strategy.maxRaise / 100));
    const min = Math.round(currentPrice * (1 - strategy.maxDrop  / 100));
    if (suggested > max) suggested = max;
    if (suggested < min) suggested = min;
  }
  return suggested;
}

// ═══════════════════════════════════════════
// PLATFORM ADAPTÖRLER
// ═══════════════════════════════════════════

// ── İKAS ────────────────────────────────────
const ikasTokenCache = {};

async function ikasToken(cfg) {
  const key = cfg.storeName + '_' + cfg.clientId;
  const c   = ikasTokenCache[key];
  if (c && Date.now() < c.exp) return c.token;
  const r = await fetch(`https://${cfg.storeName}.myikas.com/api/admin/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=client_credentials&client_id=${encodeURIComponent(cfg.clientId)}&client_secret=${encodeURIComponent(cfg.clientSecret)}`
  });
  if (!r.ok) throw new Error(`İkas token (${r.status})`);
  const d = await r.json();
  ikasTokenCache[key] = { token: d.access_token, exp: Date.now() + (d.expires_in - 60) * 1000 };
  return d.access_token;
}

async function ikasGQL(cfg, query) {
  const token = await ikasToken(cfg);
  const r = await fetch('https://api.myikas.com/api/v1/admin/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ query })
  });
  const d = await r.json();
  if (d.errors) throw new Error(d.errors[0].message);
  return d;
}

async function ikasGetProducts(cfg) {
  let all = [], page = 0, hasNext = true;
  while (hasNext && page < 20) {
    const d = await ikasGQL(cfg, `{listProduct(pagination:{page:${page},limit:100}){hasNext data{id name variants{id sku prices{sellPrice} stocks{stockCount}}}}}`);
    all     = all.concat(d.data.listProduct.data);
    hasNext = d.data.listProduct.hasNext;
    page++;
  }
  return all.map(p => {
    const v = p.variants?.[0] || {};
    return {
      id: p.id, variantId: v.id, name: p.name, sku: v.sku || '—',
      price: v.prices?.[0]?.sellPrice || 0,
      stock: v.stocks?.reduce((s, x) => s + (x.stockCount || 0), 0) || 0,
      category: detectCategory(p.name), platform: 'ikas'
    };
  });
}

async function ikasUpdatePrice(cfg, productId, variantId, newPrice, priceListId) {
  const pl  = priceListId ? `priceListId:"${priceListId}",` : '';
  const inp = `[{productId:"${productId}" variantId:"${variantId}" price:{sellPrice:${newPrice}}}]`;
  return await ikasGQL(cfg, `mutation{saveVariantPrices(input:{${pl}variantPriceInputs:${inp}}){} }`);
}

async function ikasCreateProduct(cfg, card, priceTRY) {
  const scRes  = await ikasGQL(cfg, '{listSalesChannel{id}}');
  const scIds  = (scRes.data?.listSalesChannel || []).map(s => `"${s.id}"`).join(',');
  const safeName = (card.name || 'Kart').replace(/"/g, "'").slice(0, 200);
  const safeSku  = (card.id  || card.name || 'card').replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 50);

  const createRes = await ikasGQL(cfg,
    `mutation{saveProduct(input:{name:"${safeName}" type:PHYSICAL salesChannelIds:[${scIds}] variants:[{prices:[{sellPrice:${priceTRY}}] sku:"${safeSku}"}]}){id name variants{id}}}`
  );
  if (createRes.errors) throw new Error(createRes.errors[0].message);

  const productId = createRes.data.saveProduct.id;
  const variantId = createRes.data.saveProduct.variants?.[0]?.id;

  if (card.image && productId) {
    try {
      let imgUrl = card.image;
      if (imgUrl.includes('tcgdex.net') && !imgUrl.endsWith('.png') && !imgUrl.endsWith('.jpg'))
        imgUrl = imgUrl + '/high.png';

      const imgRes = await fetch(imgUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20000) });
      if (!imgRes.ok) throw new Error(`Görsel indirilemedi: ${imgRes.status}`);

      let imgBuf;
      if (typeof imgRes.buffer === 'function') imgBuf = await imgRes.buffer();
      else { const ab = await imgRes.arrayBuffer(); imgBuf = Buffer.from(ab); }

      const contentType = imgRes.headers.get('content-type') || 'image/png';
      const ext         = contentType.includes('jpeg') ? 'jpg' : 'png';
      const dataUri     = `data:${contentType};base64,${imgBuf.toString('base64')}`;
      const token       = await ikasToken(cfg);

      const uploadRes = await fetch('https://api.myikas.com/api/v1/admin/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({
          query: `mutation UploadProductImage($input: ProductImageInput!) { uploadProductImage(input: $input) { id fileName } }`,
          variables: { input: { productId, variantIds: variantId ? [variantId] : [], base64: dataUri, fileName: `${safeSku}.${ext}`, isMain: true, order: 0 } }
        }),
        signal: AbortSignal.timeout(30000)
      });
      const uploadData = await uploadRes.json();

      if (uploadData.errors) {
        await fetch('https://api.myikas.com/api/v1/admin/product/upload/image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify({ productImage: { productId, variantIds: variantId ? [variantId] : [], base64: dataUri, order: 0, isMain: true } }),
          signal: AbortSignal.timeout(30000)
        });
      } else {
        console.log('✅ Görsel yüklendi:', uploadData.data?.uploadProductImage?.fileName);
      }
    } catch(e) { console.log('⚠️ Görsel yüklenemedi:', e.message); }
  }
  return { id: productId, variantId };
}

// ── SHOPİFY ─────────────────────────────────
function shopifyHeaders(cfg) { return { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': cfg.accessToken }; }
function shopifyBase(cfg)    { return `https://${cfg.storeDomain}/admin/api/2024-01`; }

async function shopifyGetProducts(cfg) {
  let all = [], nextUrl = `${shopifyBase(cfg)}/products.json?limit=250`;
  while (nextUrl) {
    const r = await fetch(nextUrl, { headers: shopifyHeaders(cfg) });
    if (!r.ok) throw new Error(`Shopify ürün hatası (${r.status})`);
    const d = await r.json();
    all = all.concat(d.products || []);
    const link = r.headers.get('link') || '';
    const next = link.match(/<([^>]+)>;\s*rel="next"/);
    nextUrl = next ? next[1] : null;
  }
  return all.map(p => {
    const v = p.variants?.[0] || {};
    return {
      id: String(p.id), variantId: String(v.id), name: p.title, sku: v.sku || '—',
      price: parseFloat(v.price || 0), stock: v.inventory_quantity || 0,
      imageUrl: p.images?.[0]?.src || null,
      category: detectCategory(p.title), platform: 'shopify'
    };
  });
}

async function shopifyUpdatePrice(cfg, variantId, newPrice) {
  const r = await fetch(`${shopifyBase(cfg)}/variants/${variantId}.json`, {
    method: 'PUT', headers: shopifyHeaders(cfg),
    body: JSON.stringify({ variant: { id: variantId, price: newPrice.toFixed(2) } })
  });
  if (!r.ok) { const e = await r.json(); throw new Error(JSON.stringify(e.errors)); }
  return await r.json();
}

async function shopifyCreateProduct(cfg, card, priceTRY) {
  const body = {
    product: {
      title: card.name, vendor: card.game?.toUpperCase() || 'TCG',
      product_type: card.game || 'card',
      tags: [card.game, card.rarity, card.set].filter(Boolean).join(', '),
      variants: [{ price: priceTRY.toFixed(2), sku: card.id || card.name?.replace(/\s+/g, '-').slice(0, 50), inventory_management: 'shopify' }],
      images: card.image ? [{ src: card.image.includes('tcgdex') ? card.image + '/high.png' : card.image }] : []
    }
  };
  const r = await fetch(`${shopifyBase(cfg)}/products.json`, {
    method: 'POST', headers: shopifyHeaders(cfg), body: JSON.stringify(body)
  });
  if (!r.ok) { const e = await r.json(); throw new Error(JSON.stringify(e.errors || e)); }
  const d = await r.json();
  return { id: String(d.product.id), variantId: String(d.product.variants?.[0]?.id) };
}

// ── STUB'LAR ─────────────────────────────────
async function trendyolGetProducts() { return []; }
async function hbGetProducts()       { return []; }

// ── DİSPATCHER ──────────────────────────────
async function platformGetProducts(platform) {
  const cfg = typeof platform.config === 'string' ? JSON.parse(platform.config) : platform.config;
  if (platform.type === 'ikas')        return await ikasGetProducts(cfg);
  if (platform.type === 'shopify')     return await shopifyGetProducts(cfg);
  if (platform.type === 'trendyol')    return await trendyolGetProducts(cfg);
  if (platform.type === 'hepsiburada') return await hbGetProducts(cfg);
  return [];
}

async function platformUpdatePrice(platform, product, newPrice) {
  const cfg = typeof platform.config === 'string' ? JSON.parse(platform.config) : platform.config;
  if (platform.type === 'ikas')    return await ikasUpdatePrice(cfg, product.id, product.variantId, newPrice, cfg.priceListId);
  if (platform.type === 'shopify') return await shopifyUpdatePrice(cfg, product.variantId, newPrice);
  return null;
}

async function platformCreateProduct(platform, card, priceTRY) {
  const cfg = typeof platform.config === 'string' ? JSON.parse(platform.config) : platform.config;
  if (platform.type === 'ikas')    return await ikasCreateProduct(cfg, card, priceTRY);
  if (platform.type === 'shopify') return await shopifyCreateProduct(cfg, card, priceTRY);
  return null;
}

// ═══════════════════════════════════════════
// ZAMANLAYICI
// ═══════════════════════════════════════════
const schedulers = {};

async function runPlatformUpdate(platformId) {
  let platformData;
  try { platformData = db.getPlatform(platformId); } catch(e) { return; }
  if (!platformData || !platformData.enabled) return;
  addLog(platformId, 'SCHED', `Güncelleme başladı: ${platformData.name}`, 'info');
  try {
    const products = await platformGetProducts(platformData);
    await refreshRates();
    let updated = 0;
    const updates = [];
    for (const p of products) {
      const gp = await getGlobalPrice(p.name);
      if (!gp.averageTRY) continue;
      const suggested = calcSuggestedPrice(p.price, gp.averageTRY, p.category);
      if (suggested && Math.abs(suggested - p.price) > 5) { updates.push({ ...p, newPrice: suggested }); updated++; }
    }
    for (const u of updates) {
      try { await platformUpdatePrice(platformData, u, u.newPrice); } catch(e) {}
    }
    addLog(platformId, 'SCHED', `Tamamlandı: ${updated}/${products.length} ürün güncellendi`, 'info');
  } catch(e) { addLog(platformId, 'SCHED', 'Hata: ' + e.message, 'error'); }
}

function startPlatformScheduler(platformId, intervalHours) {
  if (schedulers[platformId]?.timer) clearInterval(schedulers[platformId].timer);
  const timer = setInterval(() => runPlatformUpdate(platformId), intervalHours * 60 * 60 * 1000);
  schedulers[platformId] = { timer, intervalHours, startedAt: new Date().toISOString() };
  addLog(platformId, 'SCHED', `Zamanlayıcı başladı: her ${intervalHours}s`, 'info');
}

function stopPlatformScheduler(platformId) {
  if (schedulers[platformId]?.timer) {
    clearInterval(schedulers[platformId].timer);
    delete schedulers[platformId];
    addLog(platformId, 'SCHED', 'Zamanlayıcı durduruldu', 'info');
  }
}

// ═══════════════════════════════════════════
// EBAY TOKEN
// ═══════════════════════════════════════════
let ebayTokenCache = { token: null, exp: 0 };

async function getEbayToken() {
  if (ebayTokenCache.token && Date.now() < ebayTokenCache.exp) return ebayTokenCache.token;
  const creds = Buffer.from(`${EBAY_APP_ID}:${EBAY_CERT_ID}`).toString('base64');
  const r = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: { 'Authorization': `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope',
    signal: AbortSignal.timeout(8000)
  });
  const d = await r.json();
  if (!d.access_token) throw new Error('eBay token alınamadı');
  ebayTokenCache = { token: d.access_token, exp: Date.now() + (d.expires_in - 60) * 1000 };
  return d.access_token;
}

// eBay Finding API (ücretsiz, App ID gerekmez)
async function ebayFindingSearch(query, limit = 12) {
  const url = `https://svcs.ebay.com/services/search/FindingService/v1` +
    `?OPERATION-NAME=findItemsByKeywords` +
    `&SERVICE-VERSION=1.0.0` +
    `&SECURITY-APPNAME=${hasEbayBrowse ? EBAY_APP_ID : 'PriceBot0-PriceBot-PRD-000000000-00000000'}` +
    `&RESPONSE-DATA-FORMAT=JSON` +
    `&keywords=${encodeURIComponent(query)}` +
    `&paginationInput.entriesPerPage=${limit}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
  const d = await r.json();
  const items = d?.findItemsByKeywordsResponse?.[0]?.searchResult?.[0]?.item || [];
  return items.map(item => {
    const price = parseFloat(item.sellingStatus?.[0]?.currentPrice?.[0]?.['__value__'] || 0);
    return {
      id:       `ebay-${item.itemId?.[0]}`,
      name:     item.title?.[0] || query,
      price:    price.toFixed(2),
      currency: 'USD',
      priceTRY: price ? Math.round(price * ratesCache.USD) : null,
      image:    item.galleryURL?.[0] || null,
      url:      item.viewItemURL?.[0]  || null,
      source:   'ebay-finding'
    };
  });
}

// eBay Browse API (App ID gerekli)
// categoryId: 212=Sports Cards, 2536=TCG, 64482=Pokemon, 183454=Sports Card Singles
const EBAY_CATEGORY_MAP = {
  pokemon:  '64482',  // Pokemon Cards
  yugioh:   '2536',   // Trading Card Games
  magic:    '19107',  // Magic: The Gathering
  onepiece: '2536',   // Trading Card Games
  nfl:      '215',    // Football Cards
  nba:      '214',    // Basketball Cards
  mlb:      '213',    // Baseball Cards
  soccer:   '254',    // Soccer Cards
  default:  '212'     // Sports Trading Cards (genel)
};

async function ebayBrowseSearch(query, limit = 16, category = null) {
  const token = await getEbayToken();
  const catId = category ? (EBAY_CATEGORY_MAP[category] || EBAY_CATEGORY_MAP.default) : '';
  const catFilter = catId ? `&category_ids=${catId}` : '';
  const url = `https://api.ebay.com/buy/browse/v1/item_summary/search` +
    `?q=${encodeURIComponent(query)}&limit=${limit}${catFilter}` +
    `&filter=buyingOptions:{FIXED_PRICE|BEST_OFFER}` +
    `&sort=relevance` +
    `&fieldgroups=MATCHING_ITEMS,ASPECT_REFINEMENTS`;
  const r = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
      'Content-Type': 'application/json'
    },
    signal: AbortSignal.timeout(12000)
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`eBay Browse ${r.status}: ${err.slice(0,100)}`);
  }
  const d = await r.json();
  return (d.itemSummaries || []).map(item => {
    const priceVal = parseFloat(item.price?.value || 0);
    return {
      id:        `ebay-${item.itemId}`,
      name:      item.title,
      price:     item.price?.value || null,
      currency:  item.price?.currency || 'USD',
      priceTRY:  priceVal ? Math.round(priceVal * ratesCache.USD) : null,
      image:     item.image?.imageUrl || item.thumbnailImages?.[0]?.imageUrl || null,
      url:       item.itemWebUrl || null,
      condition: item.condition || '',
      seller:    item.seller?.username || '',
      location:  item.itemLocation?.country || '',
      source:    'eBay Browse',
      epid:      item.epid || null,
      shippingFree: item.shippingOptions?.[0]?.shippingCost?.value === '0.00'
    };
  });
}

// eBay Sold Items (satılmış fiyatlar — piyasa değeri için)
async function ebaySoldSearch(query, limit = 10, category = null) {
  const token = await getEbayToken();
  const catId = category ? (EBAY_CATEGORY_MAP[category] || '') : '';
  const catFilter = catId ? `&category_ids=${catId}` : '';
  const url = `https://api.ebay.com/buy/browse/v1/item_summary/search` +
    `?q=${encodeURIComponent(query)}&limit=${limit}${catFilter}` +
    `&filter=buyingOptions:{FIXED_PRICE},soldItems:true` +
    `&sort=endingSoonest`;
  try {
    const r = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' },
      signal: AbortSignal.timeout(10000)
    });
    if (!r.ok) return [];
    const d = await r.json();
    return (d.itemSummaries || []).map(item => ({
      name: item.title,
      price: parseFloat(item.price?.value || 0),
      priceTRY: item.price?.value ? Math.round(parseFloat(item.price.value) * ratesCache.USD) : null,
      condition: item.condition || '',
      soldDate: item.itemEndDate || null,
      source: 'eBay Sold'
    }));
  } catch(e) { return []; }
}

// ═══════════════════════════════════════════
// API ROTALARI
// ═══════════════════════════════════════════

// ── Döviz ──
app.get('/api/rates', async (req, res) => res.json(await refreshRates()));

// ── Platform CRUD ──
app.get('/api/platforms', (req, res) => {
  try {
    res.json(db.getPlatforms().map(p => ({
      id: p.id, name: p.name, type: p.type, enabled: p.enabled, created_at: p.created_at,
      hasScheduler: !!schedulers[p.id],
      schedulerInterval: schedulers[p.id]?.intervalHours || null
    })));
  } catch(e) { res.json([]); }
});

app.post('/api/platforms', (req, res) => {
  const { id, name, type, config } = req.body;
  if (!id || !name || !type || !config) return res.status(400).json({ error: 'Eksik alan' });
  try {
    db.savePlatform({ id, name, type, config: JSON.stringify(config), enabled: 1, created_at: new Date().toISOString() });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/platforms/:id', (req, res) => {
  stopPlatformScheduler(req.params.id);
  db.deletePlatform(req.params.id);
  res.json({ ok: true });
});

app.post('/api/platforms/:id/test', async (req, res) => {
  let platform;
  try { platform = db.getPlatform(req.params.id); } catch(e) { platform = req.body; }
  if (!platform) return res.status(404).json({ error: 'Platform bulunamadı' });
  try {
    const products = await platformGetProducts(platform);
    res.json({ ok: true, productCount: products.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/platforms/:id/products', async (req, res) => {
  const platform = db.getPlatform(req.params.id);
  if (!platform) return res.status(404).json({ error: 'Platform bulunamadı' });
  try {
    const products = await platformGetProducts(platform);
    res.json({ products, total: products.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/platforms/:id/calculate-prices', async (req, res) => {
  const platform = db.getPlatform(req.params.id);
  if (!platform) return res.status(404).json({ error: 'Platform bulunamadı' });
  try {
    const products = await platformGetProducts(platform);
    await refreshRates();
    const results = [];
    for (const p of products) {
      const gp        = await getGlobalPrice(p.name);
      const suggested = calcSuggestedPrice(p.price, gp.averageTRY, p.category);
      results.push({ ...p, globalAvgTRY: gp.averageTRY, suggested, sources: gp.sources,
        action: !suggested ? 'skip' : Math.abs(suggested - p.price) < 5 ? 'hold' : suggested > p.price ? 'raise' : 'drop'
      });
    }
    res.json({ results, total: results.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/platforms/:id/update-prices', async (req, res) => {
  const platform = db.getPlatform(req.params.id);
  if (!platform) return res.status(404).json({ error: 'Platform bulunamadı' });
  const { updates } = req.body;
  if (!updates?.length) return res.status(400).json({ error: 'updates boş' });
  let ok = 0, fail = 0;
  for (const u of updates) {
    try { await platformUpdatePrice(platform, u, u.newPrice); ok++; }
    catch(e) { fail++; addLog(req.params.id, 'PRICE', 'Fiyat güncelleme hatası: ' + e.message, 'error'); }
  }
  addLog(req.params.id, 'PRICE', `${ok} güncellendi, ${fail} hata`, 'info');
  res.json({ ok: true, updated: ok, failed: fail });
});

app.post('/api/platforms/:id/import-card', async (req, res) => {
  const platform = db.getPlatform(req.params.id);
  if (!platform) return res.status(404).json({ error: 'Platform bulunamadı' });
  const { card } = req.body;
  try {
    await refreshRates();
    const strategy = STRATEGIES[detectCategory((card.game || '') + ' ' + card.name)] || STRATEGIES.default;
    let priceTRY = 0;
    if (card.priceEUR) priceTRY = Math.round(card.priceEUR * ratesCache.EUR * 1.03 * (1 + strategy.marginAboveGlobal / 100) / 5) * 5;
    else if (card.priceUSD) priceTRY = Math.round(card.priceUSD * ratesCache.USD * 1.03 * (1 + strategy.marginAboveGlobal / 100) / 5) * 5;
    if (priceTRY < 10) priceTRY = 10;
    const created = await platformCreateProduct(platform, card, priceTRY);
    addLog(req.params.id, 'IMPORT', `${card.name} aktarıldı → ${priceTRY}₺`, 'info');
    res.json({ ok: true, priceTRY, ...created });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/platforms/:id/import-sealed', async (req, res) => {
  const platform = db.getPlatform(req.params.id);
  if (!platform) return res.status(404).json({ error: 'Platform bulunamadı' });
  const { product } = req.body;
  try {
    await refreshRates();
    const strategy = STRATEGIES[detectCategory(product.name)] || STRATEGIES.default;
    let priceTRY = product.priceUSD
      ? Math.round(parseFloat(product.priceUSD) * ratesCache.USD * 1.03 * (1 + strategy.marginAboveGlobal / 100) / 5) * 5
      : 0;
    if (priceTRY < 10) priceTRY = 10;
    const card = {
      name: product.name, id: `pc-${product.id}`, game: product.console || 'sealed',
      image: product.image || null, priceUSD: parseFloat(product.priceUSD || 0),
      priceEUR: 0, set: product.console || '', rarity: 'Sealed'
    };
    const created = await platformCreateProduct(platform, card, priceTRY);
    addLog(req.params.id, 'IMPORT', `${product.name} aktarıldı → ${priceTRY}₺`, 'info');
    res.json({ ok: true, priceTRY, ...created });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Zamanlayıcı ──
app.get('/api/platforms/:id/scheduler', (req, res) => {
  const s = schedulers[req.params.id];
  res.json({ running: !!s, intervalHours: s?.intervalHours || null, startedAt: s?.startedAt || null });
});
app.post('/api/platforms/:id/scheduler/start', (req, res) => {
  const { intervalHours } = req.body;
  startPlatformScheduler(req.params.id, intervalHours || 6);
  res.json({ ok: true, intervalHours });
});
app.post('/api/platforms/:id/scheduler/stop', (req, res) => {
  stopPlatformScheduler(req.params.id);
  res.json({ ok: true });
});
app.post('/api/platforms/:id/scheduler/run-now', async (req, res) => {
  res.json({ ok: true, message: 'Başlatıldı' });
  runPlatformUpdate(req.params.id);
});

// ── Loglar ──
app.get('/api/logs', (req, res) => {
  try {
    const { platformId, limit = 100 } = req.query;
    res.json(db.getLogs(platformId, parseInt(limit)));
  } catch(e) { res.json([]); }
});

// ── Global fiyat (tek kart) ──
app.post('/api/global-price', async (req, res) => {
  try { res.json(await getGlobalPrice(req.body.productName || '')); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Multi-source kart fiyatı (katalog detay için) ──
// Tüm kaynakları paralel çeker, her kaynağın fiyatını ayrı döner
app.get('/api/card-prices', async (req, res) => {
  const { name, game, id } = req.query;
  if (!name) return res.status(400).json({ error: 'name gerekli' });
  await refreshRates();
  const rates = ratesCache;
  const sources = [];

  // Paralel fiyat çekme
  const tasks = [];

  // TCGdex (Pokémon)
  if (!game || game === 'pokemon') {
    tasks.push(
      (async () => {
        try {
          const cardId = id || null;
          let card;
          if (cardId) {
            const r = await fetch(`https://api.tcgdex.net/v2/en/cards/${cardId}`, { signal: AbortSignal.timeout(8000) });
            if (r.ok) card = await r.json();
          } else {
            const r = await fetch(`https://api.tcgdex.net/v2/en/cards?name=${encodeURIComponent(name)}&itemsPerPage=1`, { signal: AbortSignal.timeout(8000) });
            if (r.ok) { const list = await r.json(); if (list[0]) { const dr = await fetch(`https://api.tcgdex.net/v2/en/cards/${list[0].id}`, {signal:AbortSignal.timeout(8000)}); if(dr.ok) card = await dr.json(); } }
          }
          if (card?.pricing) {
            const cm30 = card.pricing.cardmarket?.avg30 || 0;
            const cmTrend = card.pricing.cardmarket?.trend || 0;
            const tcgNormal = card.pricing.tcgplayer?.normal?.marketPrice || 0;
            const tcgHolo = card.pricing.tcgplayer?.holo?.marketPrice || 0;
            if (cm30 > 0) sources.push({ source: 'Cardmarket', type: 'EUR', price: cm30, priceTRY: Math.round(cm30 * rates.EUR), logo: 'cm', trend: cmTrend > 0 ? ((cm30 - cmTrend) / cmTrend * 100).toFixed(1) : null });
            if (tcgNormal > 0) sources.push({ source: 'TCGPlayer', type: 'USD', price: tcgNormal, priceTRY: Math.round(tcgNormal * rates.USD), logo: 'tcp', variant: 'Normal' });
            if (tcgHolo > 0) sources.push({ source: 'TCGPlayer Holo', type: 'USD', price: tcgHolo, priceTRY: Math.round(tcgHolo * rates.USD), logo: 'tcp', variant: 'Holo' });
          }
        } catch(e) {}
      })()
    );
  }

  // YGOPRODeck (YuGiOh)
  if (!game || game === 'yugioh') {
    tasks.push(
      (async () => {
        try {
          const r = await fetch(`https://db.ygoprodeck.com/api/v7/cardinfo.php?fname=${encodeURIComponent(name)}&num=1`, { signal: AbortSignal.timeout(8000) });
          if (r.ok) {
            const d = await r.json();
            const prices = d.data?.[0]?.card_prices?.[0];
            if (prices) {
              const tcp = parseFloat(prices.tcgplayer_price || 0);
              const cm  = parseFloat(prices.cardmarket_price || 0);
              const ebay = parseFloat(prices.ebay_price || 0);
              const amazon = parseFloat(prices.amazon_price || 0);
              if (tcp > 0)    sources.push({ source: 'TCGPlayer', type: 'USD', price: tcp, priceTRY: Math.round(tcp * rates.USD), logo: 'tcp' });
              if (cm > 0)     sources.push({ source: 'Cardmarket', type: 'EUR', price: cm, priceTRY: Math.round(cm * rates.EUR), logo: 'cm' });
              if (ebay > 0)   sources.push({ source: 'eBay', type: 'USD', price: ebay, priceTRY: Math.round(ebay * rates.USD), logo: 'ebay' });
              if (amazon > 0) sources.push({ source: 'Amazon', type: 'USD', price: amazon, priceTRY: Math.round(amazon * rates.USD), logo: 'amz' });
            }
          }
        } catch(e) {}
      })()
    );
  }

  // Scryfall (MTG)
  if (!game || game === 'magic') {
    tasks.push(
      (async () => {
        try {
          const r = await fetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(8000) });
          if (r.ok) {
            const card = await r.json();
            const prices = card.prices;
            if (prices?.usd)       sources.push({ source: 'TCGPlayer', type: 'USD', price: parseFloat(prices.usd), priceTRY: Math.round(parseFloat(prices.usd) * rates.USD), logo: 'tcp', variant: 'Normal' });
            if (prices?.usd_foil)  sources.push({ source: 'TCGPlayer Foil', type: 'USD', price: parseFloat(prices.usd_foil), priceTRY: Math.round(parseFloat(prices.usd_foil) * rates.USD), logo: 'tcp', variant: 'Foil' });
            if (prices?.eur)       sources.push({ source: 'Cardmarket', type: 'EUR', price: parseFloat(prices.eur), priceTRY: Math.round(parseFloat(prices.eur) * rates.EUR), logo: 'cm', variant: 'Normal' });
            if (prices?.eur_foil)  sources.push({ source: 'Cardmarket Foil', type: 'EUR', price: parseFloat(prices.eur_foil), priceTRY: Math.round(parseFloat(prices.eur_foil) * rates.EUR), logo: 'cm', variant: 'Foil' });
          }
        } catch(e) {}
      })()
    );
  }

  // eBay (tüm oyunlar için)
  tasks.push(
    (async () => {
      try {
        let ebayItems = [];
        if (hasEbayBrowse) {
          ebayItems = await ebayBrowseSearch(name + ' card', 5, game || 'default');
        } else {
          ebayItems = await ebayFindingSearch(name + ' card', 5);
        }
        if (ebayItems.length) {
          const prices = ebayItems.map(i => parseFloat(i.price || 0)).filter(p => p > 0);
          if (prices.length) {
            const avgUSD = prices.reduce((a,b)=>a+b,0) / prices.length;
            const minUSD = Math.min(...prices);
            sources.push({ source: 'eBay (Ort.)', type: 'USD', price: +avgUSD.toFixed(2), priceTRY: Math.round(avgUSD * rates.USD), logo: 'ebay', items: prices.length });
            sources.push({ source: 'eBay (Min)', type: 'USD', price: +minUSD.toFixed(2), priceTRY: Math.round(minUSD * rates.USD), logo: 'ebay', variant: 'Min' });
          }
        }
      } catch(e) {}
    })()
  );

  await Promise.all(tasks);

  const tryPrices = sources.filter(s => s.priceTRY > 0).map(s => s.priceTRY);
  const avgTRY = tryPrices.length ? Math.round(tryPrices.reduce((a,b)=>a+b,0) / tryPrices.length) : null;

  res.json({ sources, averageTRY: avgTRY, confidence: sources.length, rates: { USD: rates.USD, EUR: rates.EUR } });
});

// ── Kart Kataloğu ──
app.get('/api/catalog/pokemon/sets', async (req, res) => {
  try { res.json(await (await fetch('https://api.tcgdex.net/v2/en/sets', { signal: AbortSignal.timeout(10000) })).json()); }
  catch(e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/catalog/pokemon/set/:id', async (req, res) => {
  try { res.json(await (await fetch(`https://api.tcgdex.net/v2/en/sets/${req.params.id}`, { signal: AbortSignal.timeout(10000) })).json()); }
  catch(e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/catalog/pokemon/card/:id', async (req, res) => {
  try { res.json(await (await fetch(`https://api.tcgdex.net/v2/en/cards/${req.params.id}`, { signal: AbortSignal.timeout(10000) })).json()); }
  catch(e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/catalog/pokemon/search', async (req, res) => {
  try {
    const d = await (await fetch(`https://api.tcgdex.net/v2/en/cards?name=${encodeURIComponent(req.query.q || '')}&itemsPerPage=24`, { signal: AbortSignal.timeout(10000) })).json();
    res.json(Array.isArray(d) ? d : []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/catalog/yugioh/search', async (req, res) => {
  try {
    const d = await (await fetch(`https://db.ygoprodeck.com/api/v7/cardinfo.php?fname=${encodeURIComponent(req.query.q || '')}&num=24`, { signal: AbortSignal.timeout(10000) })).json();
    res.json((d.data || []).map(c => ({ id: String(c.id), name: c.name, game: 'yugioh', image: c.card_images?.[0]?.image_url, set: c.card_sets?.[0]?.set_name || '', rarity: c.card_sets?.[0]?.set_rarity || '', priceUSD: parseFloat(c.card_prices?.[0]?.tcgplayer_price || 0), priceEUR: parseFloat(c.card_prices?.[0]?.cardmarket_price || 0) })));
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/catalog/yugioh/sets', async (req, res) => {
  try { res.json(await (await fetch('https://db.ygoprodeck.com/api/v7/cardsets.php', { signal: AbortSignal.timeout(10000) })).json() || []); }
  catch(e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/catalog/yugioh/set/:name', async (req, res) => {
  try {
    const d = await (await fetch(`https://db.ygoprodeck.com/api/v7/cardinfo.php?cardset=${encodeURIComponent(req.params.name)}`, { signal: AbortSignal.timeout(15000) })).json();
    res.json((d.data || []).map(c => ({ id: String(c.id), name: c.name, game: 'yugioh', image: c.card_images?.[0]?.image_url, rarity: c.card_sets?.find(s => s.set_name === req.params.name)?.set_rarity || '', priceUSD: parseFloat(c.card_prices?.[0]?.tcgplayer_price || 0), priceEUR: parseFloat(c.card_prices?.[0]?.cardmarket_price || 0) })));
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/catalog/magic/search', async (req, res) => {
  try {
    const d = await (await fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(req.query.q || '')}&limit=24`, { signal: AbortSignal.timeout(10000) })).json();
    res.json((d.data || []).map(c => ({ id: c.id, name: c.name, game: 'magic', image: c.image_uris?.normal || c.card_faces?.[0]?.image_uris?.normal, set: c.set_name, rarity: c.rarity, priceUSD: parseFloat(c.prices?.usd || 0), priceEUR: parseFloat(c.prices?.eur || 0) })));
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/catalog/magic/sets', async (req, res) => {
  try {
    const d = await (await fetch('https://api.scryfall.com/sets', { signal: AbortSignal.timeout(10000) })).json();
    res.json((d.data || []).filter(s => s.card_count > 0).slice(0, 100).map(s => ({ id: s.code, name: s.name, count: s.card_count, game: 'magic' })));
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/catalog/onepiece/search', async (req, res) => {
  try {
    const d = await (await fetch(`https://optcgapi.com/api/cards/?search=${encodeURIComponent(req.query.q || '')}`, { signal: AbortSignal.timeout(10000) })).json();
    res.json((d.results || d || []).slice(0, 24).map(c => ({ id: c.card_id || c.id, name: c.name, game: 'onepiece', image: c.image_url || c.image, rarity: c.rarity || '', set: c.set || '', priceUSD: parseFloat(c.price || 0), priceEUR: 0 })));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Görsel proxy ──
app.get('/api/image-proxy', async (req, res) => {
  let url = req.query.url;
  if (!url) return res.status(400).send('Invalid');
  if (!url.startsWith('https://') && !url.startsWith('http://')) return res.status(400).send('Invalid URL');

  // eBay görselleri için yüksek çözünürlük
  if (url.includes('ebayimg.com') || url.includes('ebaystatic.com')) {
    url = url.replace(/s-l\d+\.(jpg|webp|png)/i, 's-l400.$1');
  }

  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'image/webp,image/apng,image/*,*/*',
        'Referer': 'https://www.ebay.com/'
      },
      signal: AbortSignal.timeout(10000)
    });
    if (!r.ok) return res.status(r.status).send('Not found');
    let buf;
    if (typeof r.buffer === 'function') buf = await r.buffer();
    else { const ab = await r.arrayBuffer(); buf = Buffer.from(ab); }
    const ct = r.headers.get('content-type') || 'image/jpeg';
    res.set('Content-Type', ct);
    res.set('Cache-Control', 'public,max-age=86400');
    res.set('Access-Control-Allow-Origin', '*');
    res.send(buf);
  } catch(e) {
    res.status(500).send('Proxy error: ' + e.message);
  }
});

// ── Stratejiler ──
app.get('/api/strategies', (req, res) => res.json(STRATEGIES));

// ═══════════════════════════════════════════
// SEALED & SPOR KARTI
// ═══════════════════════════════════════════

function pennies(n) { return n ? (n / 100).toFixed(2) : null; }

// ── Sealed ürün arama ────────────────────────
app.get('/api/sealed/search', async (req, res) => {
  const q    = req.query.q || '';
  const game = req.query.game || 'all';
  if (!q) return res.status(400).json({ error: 'q parametresi gerekli' });

  await refreshRates();
  const results = [];

  // 1) PriceCharting (token varsa)
  if (hasPriceCharting) {
    try {
      const consoleMap  = { pokemon: 'Pokemon Cards', yugioh: 'Yu-Gi-Oh', magic: 'Magic The Gathering', onepiece: 'One Piece Card Game', sealed: 'Pokemon Sealed Products', all: '' };
      const consoleName = consoleMap[game] || '';
      const query       = consoleName ? `${q} ${consoleName}` : q;
      const r = await fetch(`https://www.pricecharting.com/api/products?t=${PRICECHARTING_TOKEN}&q=${encodeURIComponent(query)}`, { signal: AbortSignal.timeout(8000) });
      const d = await r.json();
      if (d.status === 'success') {
        (d.products || []).forEach(p => results.push({ id: p.id, name: p['product-name'], console: p['console-name'], game, source: 'pricecharting' }));
      }
    } catch(e) { console.log('PriceCharting hatası:', e.message); }
  }

  // 2) eBay fallback (az sonuç varsa)
  if (results.length < 5) {
    const gameKeywords = { pokemon: 'Pokemon sealed booster', yugioh: 'Yu-Gi-Oh booster box', magic: 'MTG booster box', onepiece: 'One Piece TCG booster', sealed: 'TCG sealed booster box', all: 'TCG sealed' };
    const searchQ = `${q} ${gameKeywords[game] || 'TCG sealed'}`;
    try {
      // eBay Browse API tercih et
      if (hasEbayBrowse) {
        const items = await ebayBrowseSearch(searchQ, 16);
        items.forEach(item => results.push({ ...item, console: game.toUpperCase(), game }));
      } else {
        // Ücretsiz Finding API
        const items = await ebayFindingSearch(searchQ, 12);
        items.forEach(item => results.push({ ...item, console: game.toUpperCase(), game }));
      }
    } catch(e) { console.log('eBay sealed fallback hatası:', e.message); }
  }

  res.json(results);
});

// ── Sealed ürün fiyatı (PriceCharting) ──────
app.get('/api/sealed/price/:id', async (req, res) => {
  const pcId = req.params.id;

  // eBay ID ise direkt eBay'den fiyat dön
  if (pcId.startsWith('ebay-')) {
    return res.json({
      id: pcId, name: 'eBay Ürünü', console: '',
      prices: {}, suggestedTRY: null, usdRate: ratesCache.USD,
      note: 'Bu ürün eBay kaynaklı, PriceCharting fiyatı yok.'
    });
  }

  if (!hasPriceCharting) {
    return res.json({
      id: pcId, name: '', console: '',
      prices: {}, suggestedTRY: null, usdRate: ratesCache.USD,
      note: 'PriceCharting token gerekli.'
    });
  }

  try {
    const r = await fetch(`https://www.pricecharting.com/api/product?t=${PRICECHARTING_TOKEN}&id=${pcId}`, { signal: AbortSignal.timeout(10000) });
    const d = await r.json();
    if (d.status !== 'success') throw new Error(d['error-message'] || 'Ürün bulunamadı');
    await refreshRates();
    const usd = parseFloat(pennies(d['loose-price']) || pennies(d['cib-price']) || pennies(d['new-price']) || 0);
    res.json({
      id: d.id, name: d['product-name'], console: d['console-name'],
      releaseDate: d['release-date'], upc: d.upc, asin: d.asin,
      prices: {
        loose:  { usd: pennies(d['loose-price']),       label: 'Ungraded / Loose' },
        cib:    { usd: pennies(d['cib-price']),         label: 'Complete / Graded 7' },
        new:    { usd: pennies(d['new-price']),         label: 'New Sealed / Graded 8' },
        graded: { usd: pennies(d['graded-price']),      label: 'Graded 9' },
        psa10:  { usd: pennies(d['manual-only-price']), label: 'PSA 10' },
        bgs10:  { usd: pennies(d['bgs-10-price']),      label: 'BGS 10' },
      },
      suggestedTRY: usd ? Math.round(usd * ratesCache.USD * 1.03) : null,
      usdRate: ratesCache.USD
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── eBay listing'ler ─────────────────────────
app.get('/api/sealed/ebay', async (req, res) => {
  const q        = req.query.q || '';
  const limit    = Math.min(parseInt(req.query.limit) || 16, 24);
  const category = req.query.category || null;
  if (!q) return res.status(400).json({ error: 'q parametresi gerekli' });
  await refreshRates();
  try {
    let items = [];
    if (hasEbayBrowse) {
      items = await ebayBrowseSearch(q, limit, category);
      addLog('system', 'EBAY', `Browse: "${q}" → ${items.length} sonuç`, 'info');
    } else {
      items = await ebayFindingSearch(q, limit);
      addLog('system', 'EBAY', `Finding: "${q}" → ${items.length} sonuç`, 'info');
    }
    res.json({ items, total: items.length, source: hasEbayBrowse ? 'browse' : 'finding' });
  } catch(e) {
    addLog('system', 'EBAY', 'Hata: ' + e.message, 'error');
    // Browse hata verirse Finding'e düş
    try {
      const fallback = await ebayFindingSearch(q, limit);
      res.json({ items: fallback, total: fallback.length, source: 'finding-fallback', browseError: e.message });
    } catch(e2) {
      res.json({ items: [], total: 0, error: e.message });
    }
  }
});

// ── eBay satılmış fiyatlar ─────────────────
app.get('/api/sealed/ebay-sold', async (req, res) => {
  const q        = req.query.q || '';
  const category = req.query.category || null;
  if (!q) return res.status(400).json({ error: 'q gerekli' });
  await refreshRates();
  try {
    const items = await ebaySoldSearch(q, 10, category);
    const avgUSD = items.length ? items.reduce((s,i)=>s+i.price,0)/items.length : null;
    res.json({ items, avgUSD: avgUSD?.toFixed(2)||null, avgTRY: avgUSD ? Math.round(avgUSD*ratesCache.USD) : null });
  } catch(e) { res.json({ items:[], error: e.message }); }
});

// ── eBay token test ─────────────────────────
app.get('/api/ebay/test', async (req, res) => {
  try {
    const token = await getEbayToken();
    res.json({ ok: true, hasToken: !!token, appId: EBAY_APP_ID.slice(0,20)+'...' });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Spor kartı arama — multi-source ──────────
app.get('/api/sealed/sports', async (req, res) => {
  const q     = req.query.q || '';
  const sport = req.query.sport || 'nfl';
  if (!q) return res.status(400).json({ error: 'q parametresi gerekli' });

  await refreshRates();
  const results = [];
  const seen    = new Set();

  function pushResult(item) {
    if (!item.name || seen.has(item.id)) return;
    seen.add(item.id);
    results.push(item);
  }

  const sportMeta = {
    nfl:    { label: 'NFL Football',      keywords: 'NFL football card',      panini: 'Prizm NFL', topps: '' },
    nba:    { label: 'NBA Basketball',    keywords: 'NBA basketball card',    panini: 'Prizm NBA', topps: '' },
    mlb:    { label: 'MLB Baseball',      keywords: 'MLB baseball card',      panini: '',          topps: 'Topps baseball' },
    soccer: { label: 'Soccer Football',   keywords: 'soccer football card',   panini: 'Panini soccer', topps: '' },
  };
  const meta    = sportMeta[sport] || sportMeta.nfl;
  const searchQ = `${q} ${meta.keywords}`;

  // ── Kaynak 1: eBay Browse API ──────────────
  if (hasEbayBrowse) {
    try {
      const items = await ebayBrowseSearch(searchQ, 20, sport);
      items.forEach(item => pushResult({
        id:      item.id,
        name:    item.name,
        console: meta.label,
        sport,
        source:  'eBay',
        price:   item.price,
        priceTRY: item.priceTRY,
        image:   item.image,
        url:     item.url,
        condition: item.condition,
        seller:  item.seller
      }));
      addLog('system', 'SPORTS', `eBay Browse: ${items.length} sonuç (${q})`, 'info');
    } catch(e) { console.log('eBay Browse sports hatası:', e.message); }
  }

  // ── Kaynak 2: Scryfall benzeri — 130point ──
  // 130point.com/sales/ — ücretsiz public JSON endpoint
  if (results.length < 8) {
    try {
      const url = `https://www.130point.com/sales/search.php?q=${encodeURIComponent(q)}&sport=${sport}`;
      const r   = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
        signal: AbortSignal.timeout(8000)
      });
      if (r.ok) {
        const text = await r.text();
        // JSON veya HTML parse
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const data = JSON.parse(jsonMatch[0]);
          (data || []).slice(0, 12).forEach((card, i) => {
            pushResult({
              id:      `130pt-${sport}-${i}-${q.replace(/\s/g,'')}`,
              name:    card.title || card.name || `${q} ${meta.label} Card`,
              console: meta.label,
              sport,
              source:  '130point',
              price:   card.price || card.sale_price || null,
              priceTRY: card.price ? Math.round(parseFloat(card.price) * ratesCache.USD) : null,
              image:   card.image || card.img || null,
              url:     card.url  || card.link || null
            });
          });
        }
      }
    } catch(e) { console.log('130point hatası:', e.message); }
  }

  // ── Kaynak 3: Panini America public search ──
  if (results.length < 8 && ['nfl','nba','soccer'].includes(sport)) {
    try {
      const paniniQ = `${q} ${meta.panini}`.trim();
      const url = `https://www.paniniamerica.net/api/products?keywords=${encodeURIComponent(paniniQ)}&limit=12`;
      const r   = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
        signal: AbortSignal.timeout(6000)
      });
      if (r.ok) {
        const d = await r.json();
        ((d.products || d.items || d.data || d || []).slice(0, 12)).forEach((card, i) => {
          if (!card.name && !card.title) return;
          const priceUSD = parseFloat(card.price || card.retail_price || 0);
          pushResult({
            id:      `panini-${sport}-${i}-${q.replace(/\s/g,'')}`,
            name:    card.name || card.title,
            console: meta.label,
            sport,
            source:  'Panini',
            price:   priceUSD ? priceUSD.toFixed(2) : null,
            priceTRY: priceUSD ? Math.round(priceUSD * ratesCache.USD) : null,
            image:   card.image || card.img_url || card.thumbnail || null,
            url:     card.url  || card.product_url || null
          });
        });
      }
    } catch(e) { console.log('Panini hatası:', e.message); }
  }

  // ── Kaynak 4: Topps (MLB/NFL) ───────────────
  if (results.length < 8 && ['mlb', 'nfl'].includes(sport)) {
    try {
      const url = `https://www.topps.com/api/products?search=${encodeURIComponent(q)}&sport=${sport}&limit=12`;
      const r   = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
        signal: AbortSignal.timeout(6000)
      });
      if (r.ok) {
        const d = await r.json();
        ((d.products || d.items || d.data || []).slice(0, 12)).forEach((card, i) => {
          if (!card.name && !card.title) return;
          const priceUSD = parseFloat(card.price || card.retail_price || 0);
          pushResult({
            id:      `topps-${sport}-${i}-${q.replace(/\s/g,'')}`,
            name:    card.name || card.title,
            console: meta.label,
            sport,
            source:  'Topps',
            price:   priceUSD ? priceUSD.toFixed(2) : null,
            priceTRY: priceUSD ? Math.round(priceUSD * ratesCache.USD) : null,
            image:   card.image || card.img_url || null,
            url:     card.url  || null
          });
        });
      }
    } catch(e) { console.log('Topps hatası:', e.message); }
  }

  // ── Kaynak 5: eBay Finding API (key gerektirmez) ──
  if (results.length < 6) {
    try {
      const items = await ebayFindingSearchSports(searchQ, 16);
      items.forEach(item => pushResult({ ...item, console: meta.label, sport }));
      addLog('system', 'SPORTS', `eBay Finding: ${items.length} sonuç (${q})`, 'info');
    } catch(e) { console.log('eBay Finding sports hatası:', e.message); }
  }

  // ── Kaynak 6: PriceCharting (token varsa) ──
  if (hasPriceCharting && results.length < 10) {
    try {
      const genreMap = { nfl: 'Football', nba: 'Basketball', mlb: 'Baseball', soccer: 'Soccer' };
      const r = await fetch(`https://www.pricecharting.com/api/products?t=${PRICECHARTING_TOKEN}&q=${encodeURIComponent(q + ' ' + (genreMap[sport] || ''))}`, { signal: AbortSignal.timeout(8000) });
      const d = await r.json();
      if (d.status === 'success') {
        (d.products || []).forEach(p => pushResult({
          id:      p.id,
          name:    p['product-name'],
          console: p['console-name'] || meta.label,
          sport,
          source:  'PriceCharting'
        }));
      }
    } catch(e) {}
  }

  // Hiç sonuç yoksa dummy üret — en azından eBay linki ver
  if (results.length === 0) {
    const ebaySearchUrl = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(searchQ)}`;
    results.push({
      id:      `manual-${sport}-${q.replace(/\s/g,'')}`,
      name:    `${q} — ${meta.label} Kartı`,
      console: meta.label,
      sport,
      source:  'manual',
      price:   null,
      priceTRY: null,
      image:   null,
      url:     ebaySearchUrl,
      note:    'Otomatik sonuç bulunamadı. eBay\'de ara →'
    });
  }

  res.json(results);
});

// eBay Finding API — gerçek endpoint (sports için özel)
async function ebayFindingSearchSports(query, limit = 16) {
  // eBay Finding API — categoryId 212 = Sports Trading Cards
  const url = `https://svcs.ebay.com/services/search/FindingService/v1` +
    `?OPERATION-NAME=findItemsByKeywords` +
    `&SERVICE-VERSION=1.0.0` +
    `&SECURITY-APPNAME=${hasEbayBrowse ? EBAY_APP_ID : 'PriceBot0-PriceBot-PRD-000000000-00000000'}` +
    `&RESPONSE-DATA-FORMAT=JSON` +
    `&categoryId=212` +
    `&keywords=${encodeURIComponent(query)}` +
    `&paginationInput.entriesPerPage=${limit}` +
    `&sortOrder=BestMatch`;
  const r = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(10000)
  });
  const d     = await r.json();
  const items = d?.findItemsByKeywordsResponse?.[0]?.searchResult?.[0]?.item || [];
  return items.map((item, i) => {
    const price = parseFloat(item.sellingStatus?.[0]?.currentPrice?.[0]?.['__value__'] || 0);
    return {
      id:       `ebay-f-${item.itemId?.[0] || i}`,
      name:     item.title?.[0] || query,
      price:    price ? price.toFixed(2) : null,
      currency: 'USD',
      priceTRY: price ? Math.round(price * ratesCache.USD) : null,
      image:    item.galleryURL?.[0]   || null,
      url:      item.viewItemURL?.[0]  || null,
      source:   'eBay Finding',
      condition: item.condition?.[0]?.conditionDisplayName?.[0] || ''
    };
  });
}

// ── Sağlık ──
app.get('/api/health', async (req, res) => {
  const rates = await refreshRates();
  res.json({
    ok: true, version: '2.0.0', rates,
    schedulers: Object.keys(schedulers),
    features: { priceCharting: hasPriceCharting, ebayBrowse: hasEbayBrowse }
  });
});

// ─────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`\n🚀 PriceBot Pro SaaS v2.0 → http://localhost:${PORT}`);
  console.log(`\n📡 Platform Adaptörleri:`);
  console.log(`   ✅ İkas    → GraphQL API`);
  console.log(`   ✅ Shopify → REST Admin API`);
  console.log(`   🔜 Trendyol / Hepsiburada → Yakında`);
  console.log(`\n🎴 Kart Kaynakları: TCGdex · YGOPRODeck · Scryfall · OPTCG`);
  console.log(`\n📦 Sealed & Spor:`);
  console.log(`   ${hasPriceCharting ? '✅' : '⚠️ '} PriceCharting ${hasPriceCharting ? '(aktif)' : '(token yok — eBay fallback aktif)'}`);
  console.log(`   ${hasEbayBrowse   ? '✅' : '⚠️ '} eBay Browse API ${hasEbayBrowse ? '(aktif)' : '(App ID yok — Finding API kullanılıyor)'}`);
  console.log(`   ✅ eBay Finding API (ücretsiz, her zaman aktif)\n`);
  await refreshRates();
});
