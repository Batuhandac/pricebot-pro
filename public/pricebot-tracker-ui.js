// ==========================================
// PRICEBOT PRO - SEARCH UI ENHANCEMENTS v3
// NO overrides of core doSerpSearch - just addons
// ==========================================

let searchTimeout = null;
let currentDetailData = null;

// Safe element helper
function $el(id) { return document.getElementById(id); }
function safeHide(id) { const e = $el(id); if(e) e.classList.add('hidden'); }
function safeShow(id) { const e = $el(id); if(e) e.classList.remove('hidden'); }

// ─── 1. AUTOCOMPLETE ─────────────────────────────────
async function onSearchInput(val) {
  const query = val.trim();
  clearTimeout(searchTimeout);

  if (query.length < 2) {
    safeHide('suggestDropdown');
    return;
  }

  searchTimeout = setTimeout(async () => {
    try {
      const res = await fetch('/api/tracker/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (ACCESS_TOKEN||'') },
        body: JSON.stringify({ query })
      });
      if (!res.ok) return;
      const data = await res.json();
      const suggestions = data.suggestions || [];

      const content = $el('suggestContent');
      const dropdown = $el('suggestDropdown');
      if (!content || !dropdown) return;

      if (suggestions.length === 0) { dropdown.classList.add('hidden'); return; }

      content.innerHTML = suggestions.map(s => `
        <div class="px-5 py-3 hover:bg-surface-container cursor-pointer flex items-center justify-between border-b border-outline-variant/5 last:border-b-0"
             onclick="quickSearch('${s.query.replace(/'/g, "\\'")}')">
          <div class="flex items-center gap-3">
            <span class="text-xl">${s.icon || '🔍'}</span>
            <div>
              <div class="font-bold text-sm text-on-surface">${s.name}</div>
              <div class="text-[10px] text-on-surface-variant uppercase tracking-wider">${s.category}</div>
            </div>
          </div>
        </div>
      `).join('');
      dropdown.classList.remove('hidden');
    } catch(e) { /* silent */ }
  }, 280);
}

function showSuggestions() {
  const query = ($el('serpQuery') || {}).value || '';
  if (query.trim().length >= 2) onSearchInput(query);
}

function onSearchKeydown(e) {
  if (e.key === 'Escape') { safeHide('suggestDropdown'); return; }
  if (e.key === 'Enter') {
    e.preventDefault();
    safeHide('suggestDropdown');
    if (typeof doSerpSearch === 'function') doSerpSearch();
  }
}

function quickSearch(query) {
  const el = $el('serpQuery');
  if (el) el.value = query;
  safeHide('suggestDropdown');
  safeHide('popularSection');
  if (typeof doSerpSearch === 'function') doSerpSearch();
}

// Hide dropdown on outside click
document.addEventListener('click', (e) => {
  const w = $el('searchWrapper');
  if (w && !w.contains(e.target)) safeHide('suggestDropdown');
});

// ─── 2. POPULAR PRODUCTS ─────────────────────────────
async function loadPopularProducts() {
  try {
    const res = await fetch('/api/tracker/popular');
    if (!res.ok) return;
    const data = await res.json();
    const grid = $el('popularGrid');
    if (!grid) return;

    let html = '';
    (data.categories || []).forEach(cat => {
      (cat.items || []).slice(0, 2).forEach(item => {
        html += `
          <div onclick="quickSearch('${item.query}')"
               class="bg-surface-container-low border border-outline-variant/10 p-4 hover:border-primary-container/30 transition-all cursor-pointer flex flex-col group">
            <div class="aspect-square bg-surface-container mb-3 flex items-center justify-center overflow-hidden relative">
              <span class="text-4xl opacity-60 group-hover:scale-110 transition-transform">${cat.icon}</span>
              <div class="absolute top-2 right-2 bg-surface/80 text-on-surface text-[9px] px-2 py-0.5 uppercase font-bold tracking-widest">${cat.category}</div>
            </div>
            <div class="font-bold text-xs leading-tight text-on-surface group-hover:text-primary-container transition-colors line-clamp-2 mb-2 flex-grow">${item.name}</div>
            <div class="text-[10px] text-secondary font-bold mt-auto flex items-center gap-1">
              <span class="material-symbols-outlined text-xs">search</span> Tara
            </div>
          </div>`;
      });
    });

    grid.innerHTML = html;
    safeShow('popularSection');
  } catch(e) { console.warn('Popular products:', e); }
}

// ─── 3. CARD MARKET: POPULAR CARDS ───────────────────
async function loadPopularTCGCards(game) {
  try {
    const res = await fetch(`/api/catalog/popular-cards?game=${game}`);
    if (!res.ok) return;
    const data = await res.json();
    const cards = data.cards || [];

    let wrap = $el('popCardsWrapper');
    if (!wrap) {
      const catArea = $el('catalogArea');
      if (!catArea) return;
      wrap = document.createElement('div');
      wrap.id = 'popCardsWrapper';
      catArea.insertBefore(wrap, catArea.firstChild);
    }

    if (cards.length === 0) { wrap.innerHTML = ''; return; }

    const gameLabel = { pokemon: 'Pokémon', yugioh: 'Yu-Gi-Oh!', magic: 'Magic: The Gathering' }[game] || game;
    const fireIcon = game === 'pokemon' ? '⚡' : game === 'yugioh' ? '🐉' : '✨';

    wrap.innerHTML = `
      <div class="mb-10">
        <div class="flex items-center gap-3 mb-6">
          <span class="text-2xl">${fireIcon}</span>
          <div>
            <h3 class="font-headline font-extrabold text-base text-on-surface uppercase tracking-widest">
              ${gameLabel} — Popüler Kartlar
            </h3>
            <p class="text-[10px] text-on-surface-variant uppercase tracking-wider">Piyasa fiyatı ile</p>
          </div>
          <div class="ml-auto flex items-center gap-1 text-secondary text-xs font-bold">
            <span class="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse"></span> LIVE
          </div>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          ${cards.map(c => `
            <div class="bg-surface-container-low border border-outline-variant/10 hover:border-primary-container/40
                        transition-all cursor-pointer group flex flex-col overflow-hidden">
              <div class="aspect-[3/4] bg-surface-container flex items-center justify-center p-2 relative overflow-hidden">
                ${c.image
                  ? `<img src="${c.image}" class="max-w-full max-h-full object-contain drop-shadow-xl group-hover:scale-105 transition-transform duration-300" />`
                  : `<span class="text-4xl opacity-20">🃏</span>`}
                ${c.set ? `
                  <div class="absolute bottom-0 inset-x-0 bg-surface/80 backdrop-blur-sm py-1 px-2">
                    <div class="text-[8px] font-bold text-on-surface-variant uppercase truncate text-center">${c.set}</div>
                  </div>` : ''}
              </div>
              <div class="p-3 flex flex-col flex-1">
                <div class="font-bold text-xs text-on-surface line-clamp-1 truncate mb-2" title="${c.name}">${c.name}</div>
                <div class="mt-auto space-y-1">
                  ${c.priceUSD ? `
                    <div class="flex justify-between items-center">
                      <span class="text-[9px] text-on-surface-variant uppercase">USD</span>
                      <span class="font-mono text-[11px] font-bold text-tertiary">$${c.priceUSD}</span>
                    </div>` : ''}
                  ${c.priceTRY ? `
                    <div class="flex justify-between items-center border-t border-outline-variant/10 pt-1">
                      <span class="text-[9px] text-on-surface-variant uppercase">TRY</span>
                      <span class="font-mono text-[11px] font-bold text-secondary">${fTRY(c.priceTRY)}</span>
                    </div>` : ''}
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  } catch(e) { console.warn('Popular cards error:', e); }
}

// ─── 4. HOOK INTO TCG GAME SWITCHER ──────────────────
// Wrap TCG's existing switchTCG or fetchSets to auto-load popular cards
(function patchTCGHooks() {
  ['switchTCG', 'fetchSets'].forEach(fnName => {
    const orig = window[fnName];
    if (typeof orig === 'function') {
      window[fnName] = async function(...args) {
        const result = await orig.apply(this, args);
        const game = typeof args[0] === 'string' ? args[0] : (window.TCG || 'pokemon');
        loadPopularTCGCards(game);
        return result;
      };
    }
  });
})();

// ─── 5. INIT ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Wait for auth then load
  const waitForAuth = setInterval(() => {
    if (typeof ACCESS_TOKEN !== 'undefined') {
      clearInterval(waitForAuth);
      setTimeout(loadPopularProducts, 500);
      setTimeout(() => loadPopularTCGCards(window.TCG || 'pokemon'), 1200);
    }
  }, 200);
  // Fallback (no auth needed for popular)
  setTimeout(loadPopularProducts, 800);
  setTimeout(() => loadPopularTCGCards('pokemon'), 1500);
});
