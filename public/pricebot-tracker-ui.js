// ==========================================
// PRICEBOT PRO - SEARCH & UI OVERHAUL (v2)
// ==========================================

// Global state items specifically for UI
let searchTimeout = null;
let currentDetailData = null;

// --- 1. AUTOCOMPLETE & SUGGESTIONS ---
async function fetchSuggestions(query) {
  try {
    const res = await fetch('/api/tracker/suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ACCESS_TOKEN}` },
      body: JSON.stringify({ query })
    });
    if (res.ok) {
      const data = await res.json();
      return data.suggestions || [];
    }
  } catch (e) {
    console.error('Suggest error:', e);
  }
  return [];
}

function showSuggestions() {
  const query = document.getElementById('serpQuery').value.trim();
  if (query.length < 2) {
    document.getElementById('suggestDropdown').classList.add('hidden');
    return;
  }
}

async function onSearchInput(val) {
  const query = val.trim();
  const dropdown = document.getElementById('suggestDropdown');
  const content = document.getElementById('suggestContent');
  const spinner = document.getElementById('searchSpinner');
  
  if (query.length < 2) {
    dropdown.classList.add('hidden');
    spinner.classList.add('hidden');
    return;
  }

  spinner.classList.remove('hidden');
  clearTimeout(searchTimeout);
  
  searchTimeout = setTimeout(async () => {
    const suggestions = await fetchSuggestions(query);
    spinner.classList.add('hidden');
    
    if (suggestions.length === 0) {
      dropdown.classList.add('hidden');
      return;
    }
    
    content.innerHTML = suggestions.map(s => `
      <div class="px-6 py-3 hover:bg-surface-container cursor-pointer flex items-center justify-between border-b border-outline-variant/5 last:border-b-0" onclick="quickSearch('${s.query.replace(/'/g, "\\'")}')">
        <div class="flex items-center gap-3">
          <span class="text-lg">${s.icon || '🔍'}</span>
          <div>
            <div class="font-bold text-sm text-on-surface">${s.name}</div>
            <div class="text-[10px] text-on-surface-variant uppercase tracking-wider">${s.category}</div>
          </div>
        </div>
        ${s.price ? `<div class="font-bold text-secondary text-sm">${fTRY(s.price)}</div>` : ''}
      </div>
    `).join('');
    
    dropdown.classList.remove('hidden');
  }, 300);
}

function onSearchKeydown(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    document.getElementById('suggestDropdown').classList.add('hidden');
    doSerpSearch();
  }
}

function quickSearch(query) {
  document.getElementById('serpQuery').value = query;
  document.getElementById('suggestDropdown').classList.add('hidden');
  doSerpSearch();
}

// Hide dropdown when clicking outside
document.addEventListener('click', (e) => {
  const wrapper = document.getElementById('searchWrapper');
  if (wrapper && !wrapper.contains(e.target)) {
    const dropdown = document.getElementById('suggestDropdown');
    if (dropdown) dropdown.classList.add('hidden');
  }
});


// --- 2. POPULAR PRODUCTS & HOME ---
async function loadPopularProducts() {
  try {
    const res = await fetch('/api/tracker/popular');
    if (!res.ok) return;
    const data = await res.json();
    
    const grid = document.getElementById('popularGrid');
    if (!grid) return;
    
    let html = '';
    // Show top 2 items from each category briefly
    data.categories.forEach(cat => {
      cat.items.slice(0, 2).forEach(item => {
        html += `
          <div class="bg-surface-container-low border border-outline-variant/10 p-4 hover:border-primary-container/30 transition-all cursor-pointer flex flex-col group" onclick="quickSearch('${item.query}')">
            <div class="aspect-square bg-surface-container mb-3 flex items-center justify-center overflow-hidden relative">
               ${item.image 
                 ? `<img src="${item.image}" class="max-w-[70%] max-h-[70%] object-contain group-hover:scale-110 transition-transform"/>` 
                 : `<span class="text-4xl opacity-50">${cat.icon}</span>`}
               <div class="absolute top-2 right-2 bg-surface text-on-surface text-[9px] px-2 py-0.5 uppercase font-bold tracking-widest">${cat.category}</div>
            </div>
            <div class="font-bold text-xs leading-tight text-on-surface group-hover:text-primary-container transition-colors line-clamp-2 mb-2 flex-grow">${item.name}</div>
            ${item.lowestPrice ? `<div class="font-headline font-extrabold text-secondary mt-auto">${fTRY(item.lowestPrice)}</div>` : `<div class="text-[10px] text-on-surface-variant mt-auto">Tarama yap...</div>`}
          </div>
        `;
      });
    });
    
    grid.innerHTML = html;
  } catch (e) {
    console.error('Popular products load error:', e);
  }
}


// --- 3. OVERRIDE SEARCH LOGIC (Server-side grouping) ---
// This overrides the doSerpSearch in pricebot-tracker.js
window.doSerpSearch = async function(overrideQuery=null, isModelInspect=false) {
  const qStr = overrideQuery || document.getElementById('serpQuery').value.trim();
  if(!qStr) return alert("Arama terimi girin.");
  
  // Update UI state
  document.getElementById('popularSection').classList.add('hidden');
  document.getElementById('serpResults').innerHTML = `<div class="col-span-full py-20 text-center text-on-surface-variant animate-pulse"><span class="material-symbols-outlined text-4xl block mb-2">radar</span><span class="font-bold uppercase tracking-widest text-xs">Piyasa taranıyor...</span></div>`;
  document.getElementById('marketResultsTitle').textContent = `Sonuçlar: ${qStr}`;
  
  if(!isModelInspect) {
    document.getElementById('btnBackToModels').classList.add('hidden');
    document.getElementById('accessoryToggle').classList.add('hidden');
    LAST_BROAD_QUERY = qStr;
  }

  try {
    const res = await fetch('/api/tracker/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ACCESS_TOKEN}` },
      body: JSON.stringify({ query: qStr, location: 'Turkey' })
    });
    const d = await res.json();
    if(d.error) throw new Error(d.error);
    
    const groups = d.groups || []; // Server returns grouped models
    if(!isModelInspect) {
      LAST_BROAD_GROUPS = groups;
      renderTrackerSearchGroups(qStr, groups);
    }
  } catch(e) {
    document.getElementById('serpResults').innerHTML = `<div class="col-span-full py-10 text-center text-error"><span class="material-symbols-outlined text-4xl block mb-2">error</span>${e.message}</div>`;
  }
};

window.renderTrackerSearchGroups = function(qStr, groups) {
  const container = document.getElementById('serpResults');
  document.getElementById('marketResultsTitle').textContent = `Sonuçlar: ${qStr} (${groups.length} Model)`;
  document.getElementById('btnBackToModels').classList.add('hidden');
  document.getElementById('accessoryToggle').classList.remove('hidden');

  if(!groups || groups.length === 0) {
    container.innerHTML = `<div class="col-span-full py-10 text-center text-on-surface-variant">Sonuç bulunamadı.</div>`;
    return;
  }

  // Filter out accessories if checkbox isn't checked
  const showAcc = document.getElementById('showAccessories')?.checked || false;
  const filteredGroups = groups.filter(g => showAcc || g.key !== '__accessories__');

  let html = '';
  filteredGroups.forEach(g => {
    const isAcc = g.key === '__accessories__';
    const bColor = isAcc ? 'border-outline-variant/20' : 'border-primary-container/20';
    const tag = isAcc ? `<span class="bg-surface-container text-on-surface-variant px-2 py-1 text-[9px] uppercase font-bold tracking-widest">Aksesuar</span>` : `<span class="bg-primary-container/10 text-primary-container px-2 py-1 text-[9px] uppercase font-bold tracking-widest">Ana Model</span>`;

    html += `
      <div class="bg-surface-container-low border ${bColor} p-6 flex flex-col hover:bg-surface-container-high transition-all cursor-pointer group" onclick="openModelDetail('${g.key}')">
        <div class="flex justify-between items-start mb-4">
          ${tag}
          <span class="text-xs text-on-surface-variant font-mono">${g.sourceCount} pazar yeri</span>
        </div>
        <div class="aspect-square bg-surface-container mb-4 flex items-center justify-center p-4">
           ${g.image ? `<img src="${g.image}" class="max-w-full max-h-full object-contain group-hover:scale-110 transition-transform"/>` : `<span class="material-symbols-outlined text-4xl text-on-surface-variant">image</span>`}
        </div>
        <h3 class="font-bold text-lg leading-tight mb-2 group-hover:text-primary transition-colors text-white line-clamp-2">${g.displayName}</h3>
        <p class="text-[10px] text-on-surface-variant mb-4 uppercase tracking-wider">${g.variantCount || g.items.length} Varyant Seçeneği</p>
        <div class="mt-auto">
          <p class="text-[10px] uppercase font-bold tracking-widest text-on-surface-variant mb-1">Piyasa Başlangıç</p>
          <div class="text-2xl font-headline font-extrabold ${isAcc ? 'text-on-surface' : 'text-secondary'}">${fTRY(g.lowestPrice)}</div>
        </div>
      </div>
    `;
  });
  container.innerHTML = html;
};

window.toggleAccessories = function() {
  if (LAST_BROAD_GROUPS && LAST_BROAD_GROUPS.length > 0) {
    renderTrackerSearchGroups(LAST_BROAD_QUERY, LAST_BROAD_GROUPS);
  }
};

window.openModelDetail = function(modelKey) {
  const group = LAST_BROAD_GROUPS.find(g => g.key === modelKey);
  if (!group) return;
  
  document.getElementById('marketResultsTitle').textContent = `Model Detayı: ${group.displayName}`;
  document.getElementById('btnBackToModels').classList.remove('hidden');
  document.getElementById('accessoryToggle').classList.add('hidden');
  
  const container = document.getElementById('serpResults');
  let html = '';
  
  // If it's an accessory group, just list all items
  const variantsToList = group.key === '__accessories__' 
    ? group.items.map(it => ({ key: it.name, lowestPrice: it.priceTRY, image: it.image, itemCount: 1, rawItems: [it] }))
    : group.variants.map(v => ({...v, rawItems: v.items}));
    
  variantsToList.forEach(v => {
    html += `
      <div class="bg-surface p-5 border border-outline-variant/10 hover:border-secondary/30 transition-all flex flex-col justify-between">
        <div class="flex items-start gap-4 mb-4">
          <div class="w-16 h-16 bg-surface-container flex-shrink-0 flex items-center justify-center p-1">
             ${v.image ? `<img src="${v.image}" class="max-w-full max-h-full object-contain"/>` : ''}
          </div>
          <div>
             <h4 class="font-bold text-sm text-white mb-1 leading-tight">${v.key}</h4>
             <span class="text-[10px] bg-surface-container-high px-2 py-0.5 text-on-surface-variant uppercase tracking-widest">${v.itemCount} ilan</span>
          </div>
        </div>
        <div class="flex items-end justify-between mt-auto pt-4 border-t border-outline-variant/10">
          <div>
            <div class="text-[9px] uppercase font-bold text-on-surface-variant mb-0.5">En Düşük Fiyat</div>
            <div class="font-headline font-bold text-secondary text-lg">${fTRY(v.lowestPrice)}</div>
          </div>
          <button onclick="injectDetailedProductInfo(${JSON.stringify(v.rawItems).replace(/"/g, '&quot;')}, '${group.displayName.replace(/'/g, "\\'")}', '${v.key.replace(/'/g, "\\'")}', '${group.image}')" class="bg-surface-container-high hover:bg-secondary hover:text-on-secondary-fixed text-on-surface px-4 py-2 font-bold uppercase text-[10px] tracking-widest transition-all">
            Detay & Takip
          </button>
        </div>
      </div>
    `;
  });
  
  container.innerHTML = html;
};

// Injection to fake an open product detail page
window.injectDetailedProductInfo = function(rawItemsArr, modelName, variantKey, mainImage) {
  // Sort items by price
  const items = rawItemsArr.sort((a,b) => (a.priceTRY||Infinity) - (b.priceTRY||Infinity));
  const cheapest = items[0];
  
  // Prep standard fake detail object
  currentDetailData = {
    groupMetadata: LAST_BROAD_GROUPS.find(g => g.displayName === modelName),
    variantKey: variantKey,
    product: {
      image: cheapest.image || mainImage,
      name: `${modelName} ${variantKey}`,
      description: cheapest.name
    },
    sources: items.map(it => ({
      source: it.source || it.platform || 'General',
      price: it.priceTRY,
      url: it.link,
      image: it.image
    })),
    pricingInfo: {
      lowestPrice: cheapest.priceTRY,
    }
  };
  
  renderProductDetailView();
  showPage('market-detail');
};


// --- 4. RENDER NEW V2 DETAIL PAGE ---
function renderProductDetailView() {
  const d = currentDetailData;
  if(!d) return;

  document.getElementById('detName').textContent = d.product.name;
  document.getElementById('detQuery').textContent = `Özgün ilan: ${d.product.description}`;
  document.getElementById('detImg').src = d.product.image || '';
  document.getElementById('detLowPrice').textContent = fTRY(d.pricingInfo.lowestPrice);
  document.getElementById('detSellerCount').textContent = d.sources.length;

  // Build Image Gallery
  const images = [...new Set(d.sources.map(s => s.image).filter(Boolean))];
  if(d.product.image) images.unshift(d.product.image); // exact main first
  const uniqImgs = [...new Set(images)];
  
  document.getElementById('detImgCount').textContent = `${uniqImgs.length} GÖRSEL`;
  document.getElementById('detImgGallery').innerHTML = uniqImgs.map(img => `
    <div class="w-16 h-16 flex-shrink-0 bg-surface-container cursor-pointer border border-transparent hover:border-primary-container p-1 transition-all" onclick="document.getElementById('detImg').src='${img}'">
      <img src="${img}" class="w-full h-full object-contain" />
    </div>
  `).join('');

  // Variants extracting from metadata
  const meta = d.groupMetadata;
  const colCont = document.getElementById('detColorSelector');
  const strCont = document.getElementById('detStorageSelector');
  
  if (meta && meta.variants && meta.variants.length > 0) {
    colCont.classList.remove('hidden');
    
    // Simplistic variant mapping for UI preview
    document.getElementById('detColorChips').innerHTML = meta.variants.map(v => {
      const isSelected = v.key === d.variantKey;
      const bClass = isSelected ? 'bg-primary-container text-on-primary-container border-primary-container' : 'bg-surface-container text-on-surface-variant border-outline-variant/10 hover:border-primary-container/50';
      return `<button class="px-4 py-2 border text-[10px] font-bold uppercase tracking-widest transition-all ${bClass}">${v.key.split(' | ')[0] || v.key}</button>`;
    }).filter((x, i, a) => a.indexOf(x) === i).join(''); // simple unique
  } else {
    colCont.classList.add('hidden');
    strCont.classList.add('hidden');
  }

  // Populate comparison table
  document.getElementById('detTableBody').innerHTML = d.sources.map(s => `
    <tr class="border-b border-outline-variant/5 hover:bg-surface-container-high transition-colors">
      <td class="px-4 py-3 font-bold">${s.source}</td>
      <td class="px-4 py-3 text-right font-mono text-secondary">${fTRY(s.price)}</td>
      <td class="px-3 py-3 text-center">
        ${s.url ? `<a href="${s.url}" target="_blank" class="text-[10px] text-on-surface-variant uppercase font-bold tracking-widest hover:underline bg-surface-container px-2 py-1">Git</a>` : '-'}
      </td>
    </tr>
  `).join('');
}


// --- 5. CARD MARKET (AUTO SETS & POPULAR) ---
async function initCardMarketEnhancements() {
  // Load popular cards immediately for pokemon (default)
  await loadPopularTCGCards('pokemon');
  
  // Attach listener to set load
  const origSetFetch = fetchSets; // assuming fetchSets exists
  window.fetchSets = async function(game) {
    if(origSetFetch) await origSetFetch(game);
    await loadPopularTCGCards(game); // Also load popular cards whenever game changes
  };
}

async function loadPopularTCGCards(game) {
  try {
    const res = await fetch(`/api/catalog/popular-cards?game=${game}`);
    if (!res.ok) return;
    const data = await res.json();
    
    // Inject popular cards into the catalog UI
    // Ensure there's a popular cards container or create one above cFilter div
    let popWrap = document.getElementById('popCardsWrapper');
    if (!popWrap) {
      const catArea = document.getElementById('catalogArea');
      if(catArea) {
        popWrap = document.createElement('div');
        popWrap.id = 'popCardsWrapper';
        popWrap.className = 'mb-10';
        catArea.insertBefore(popWrap, catArea.firstChild);
      }
    }
    
    if (popWrap && data.cards && data.cards.length > 0) {
      popWrap.innerHTML = `
        <div class="flex items-center gap-2 mb-4">
          <span class="w-1 h-4 bg-primary"></span>
          <h3 class="font-headline font-extrabold uppercase tracking-widest text-sm text-on-surface-variant">🔥 ${game.toUpperCase()} - Popüler Kartlar</h3>
        </div>
        <div class="grid grid-cols-2 lg:grid-cols-6 gap-4">
          ${data.cards.map(c => `
            <div class="bg-surface-container-low border border-outline-variant/10 p-3 flex flex-col hover:border-primary-container/40 transition-all cursor-pointer">
              <div class="aspect-[3/4] bg-surface-container mb-3 flex items-center justify-center p-2 relative">
                ${c.image ? `<img src="${c.image}" class="max-w-full max-h-full object-contain drop-shadow-xl" />` : `<span class="opacity-30">Görsel Yok</span>`}
                ${c.set ? `<span class="absolute bottom-0 inset-x-0 bg-surface/80 text-center text-[8px] font-bold uppercase py-0.5 line-clamp-1 backdrop-blur-sm">${c.set}</span>` : ''}
              </div>
              <div class="font-bold text-xs text-center text-on-surface line-clamp-1 truncate w-full" title="${c.name}">${c.name}</div>
              <div class="flex gap-2 justify-center mt-2 border-t border-outline-variant/10 pt-2">
                ${c.priceUSD ? `<span class="text-[10px] font-mono text-tertiary font-bold">$${c.priceUSD}</span>` : ''}
                ${c.priceTRY ? `<span class="text-[10px] font-mono text-secondary font-bold">${fTRY(c.priceTRY)}</span>` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      `;
    }
  } catch(e) {
    console.error('Popular cards error:', e);
  }
}

// Ensure init
document.addEventListener('DOMContentLoaded', () => {
  loadPopularProducts();
  setTimeout(initCardMarketEnhancements, 1000);
});
