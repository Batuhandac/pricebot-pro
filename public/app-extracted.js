
    const S = {
      platforms: [],
      rates: {},
      logs: [],
      platformProducts: [],
      platformResults: {},
      currentTCG: 'pokemon',
      selectedProductPlatformId: null,
      selectedProductId: null,
      detailChart: null,
      strategies: {}
    };

    const pageMeta = {
      dashboard: ['Dashboard', 'Platform durumları, kurlar ve son aktiviteler.'],
      platforms: ['Platformlar', 'ikas ve Shopify mağazalarını ekle, test et ve yönet.'],
      catalog: ['Kart Kataloğu', 'Hızlı arama, tek çağrılı listeleme ve platforma aktarım.'],
      products: ['Ürün Yönetimi', 'Ürünleri çek, global fiyat hesapla ve güncellemeleri gönder.'],
      productdetail: ['Ürün Detayı', 'Tek ürün görünümü, fiyat kaynakları ve geçmiş grafik.'],
      engine: ['Fiyat Motoru', 'Stratejiler ve periyodik scheduler yönetimi.'],
      logs: ['Loglar', 'Sistem aktiviteleri ve hata takibi.']
    };

    const fmtTRY = (n) => `${Number(n || 0).toLocaleString('tr-TR', { maximumFractionDigits: 2 })}₺`;
    const fmtN = (n) => Number(n || 0).toLocaleString('tr-TR', { maximumFractionDigits: 2 });
    const escapeHtml = (s='') => String(s).replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
    const imgProxy = (url='') => !url ? '' : `/api/image-proxy?url=${encodeURIComponent(url.replace(/s-l\d+\.(jpg|jpeg|png|webp)/i, 's-l400.$1'))}`;
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const encodePayload = (obj) => btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
    const decodePayload = (s) => JSON.parse(decodeURIComponent(escape(atob(s))));

    async function api(path, options = {}) {
      const response = await fetch(path, {
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        ...options
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      return data;
    }

    function setBusy(el, busy, labelBusy = 'Yükleniyor…', labelIdle = null) {
      if (!el) return;
      if (!el.dataset.originalText) el.dataset.originalText = el.innerHTML;
      el.disabled = busy;
      el.innerHTML = busy ? labelBusy : (labelIdle || el.dataset.originalText);
      el.classList.toggle('opacity-60', busy);
    }

    function nav(page) {
      document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
      document.getElementById(`page-${page}`).classList.add('active');
      document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.page === page));
      document.getElementById('page-title').textContent = pageMeta[page][0];
      document.getElementById('page-subtitle').textContent = pageMeta[page][1];
      if (page === 'engine') renderEngine();
      if (page === 'logs') loadLogs();
    }

    function resetPlatformForm() {
      document.getElementById('plat-name').value = '';
      document.getElementById('ikas-storeName').value = '';
      document.getElementById('ikas-clientId').value = '';
      document.getElementById('ikas-clientSecret').value = '';
      document.getElementById('ikas-priceListId').value = '';
      document.getElementById('shop-storeDomain').value = '';
      document.getElementById('shop-accessToken').value = '';
    }

    function onTypeChange() {
      const type = document.getElementById('plat-type').value;
      document.getElementById('cfg-ikas').classList.toggle('hidden', type !== 'ikas');
      document.getElementById('cfg-shopify').classList.toggle('hidden', type !== 'shopify');
    }

    async function loadRates(force = false) {
      try {
        S.rates = await api(`/api/rates${force ? '?force=1' : ''}`);
        document.getElementById('rate-usd').textContent = fmtTRY(S.rates.USD);
        document.getElementById('rate-eur').textContent = fmtTRY(S.rates.EUR);
        document.getElementById('rate-gbp').textContent = fmtTRY(S.rates.GBP);
        document.getElementById('rate-updated').textContent = `Güncelleme: ${new Date(S.rates.updatedAt || Date.now()).toLocaleString('tr-TR')}`;
      } catch (error) {
        toast(error.message, 'error');
      }
    }

    async function loadPlatforms() {
      S.platforms = await api('/api/platforms');
      document.getElementById('platform-count').textContent = S.platforms.length;
      renderPlatformList();
      renderPlatformSelects();
      renderDashboard();
    }

    async function loadStrategies() {
      S.strategies = await api('/api/strategies');
      renderStrategies();
    }

    async function loadLogs() {
      const platformId = document.getElementById('logs-platform-select')?.value || '';
      const suffix = platformId ? `?platformId=${encodeURIComponent(platformId)}&limit=150` : '?limit=150';
      S.logs = await api(`/api/logs${suffix}`);
      renderLogs();
      renderDashboard();
    }

    function renderDashboard() {
      const metrics = [
        { label: 'Platform', value: S.platforms.length, sub: 'Kayıtlı entegrasyon' },
        { label: 'Log', value: S.logs.length, sub: 'Yüklenen aktivite' },
        { label: 'USD/TRY', value: S.rates.USD ? fmtTRY(S.rates.USD) : '-', sub: 'Canlı kur' },
        { label: 'Son hesap', value: Object.keys(S.platformResults).length, sub: 'Hafızadaki sonuç' }
      ];
      document.getElementById('dashboard-metrics').innerHTML = metrics.map(m => `
        <div class="glass rounded-3xl p-5">
          <div class="text-slate-400 text-sm">${m.label}</div>
          <div class="text-3xl font-black mt-2">${m.value}</div>
          <div class="text-xs text-slate-500 mt-2">${m.sub}</div>
        </div>
      `).join('');

      const platforms = S.platforms.length ? S.platforms.map(p => `
        <div class="chip rounded-2xl p-4 flex items-center justify-between gap-4">
          <div>
            <div class="font-semibold">${escapeHtml(p.name)}</div>
            <div class="text-sm text-slate-400">${p.type}</div>
          </div>
          <button onclick="openProductsFor('${p.id}')" class="px-3 py-2 rounded-xl chip text-sm">Ürünler</button>
        </div>
      `).join('') : `<div class="text-slate-400 text-sm">Henüz platform yok.</div>`;
      document.getElementById('dashboard-platforms').innerHTML = platforms;

      const lastLogs = (S.logs || []).slice(0, 6);
      document.getElementById('dashboard-logs').innerHTML = lastLogs.length ? lastLogs.map(renderLogCard).join('') : `<div class="text-slate-400 text-sm">Log bulunamadı.</div>`;
    }

    function renderPlatformSelects() {
      const options = ['<option value="">Platform seç</option>'].concat(
        S.platforms.map(p => `<option value="${p.id}">${escapeHtml(p.name)} (${p.type})</option>`)
      ).join('');
      document.getElementById('products-platform-select').innerHTML = options;
      document.getElementById('catalog-platform-select').innerHTML = options;
      document.getElementById('logs-platform-select').innerHTML = `<option value="">Tümü</option>` + S.platforms.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
    }

    function renderPlatformList() {
      const root = document.getElementById('platform-list');
      if (!S.platforms.length) {
        root.innerHTML = `<div class="text-slate-400">Kayıtlı platform yok.</div>`;
        return;
      }
      root.innerHTML = S.platforms.map(p => `
        <div class="chip rounded-3xl p-5">
          <div class="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
            <div>
              <div class="flex items-center gap-3">
                <h3 class="font-bold text-lg">${escapeHtml(p.name)}</h3>
                <span class="text-xs px-2 py-1 rounded-full chip">${p.type}</span>
              </div>
              <div class="text-sm text-slate-400 mt-2">${Object.entries(p.configPreview || {}).map(([k,v]) => `${k}: ${escapeHtml(String(v || '-'))}`).join(' • ')}</div>
            </div>
            <div class="flex flex-wrap gap-2">
              <button onclick="testPlatform('${p.id}')" class="px-4 py-2 rounded-2xl chip">🔌 Test</button>
              <button onclick="openProductsFor('${p.id}')" class="px-4 py-2 rounded-2xl chip">📦 Ürünler</button>
              <button onclick="runNow('${p.id}')" class="px-4 py-2 rounded-2xl chip">▶ Hemen Çalıştır</button>
              <button onclick="deletePlatform('${p.id}')" class="px-4 py-2 rounded-2xl bg-red-500/15 text-red-300 border border-red-400/20">Sil</button>
            </div>
          </div>
        </div>
      `).join('');
    }

    function renderStrategies() {
      const root = document.getElementById('strategy-list');
      root.innerHTML = Object.entries(S.strategies).map(([name, s]) => `
        <div class="chip rounded-2xl p-4">
          <div class="font-semibold capitalize">${name}</div>
          <div class="grid grid-cols-2 gap-2 mt-3 text-sm text-slate-300">
            <div>Margin: <span class="font-semibold">%${s.marginAboveGlobal}</span></div>
            <div>Max Raise: <span class="font-semibold">%${s.maxRaise}</span></div>
            <div>Max Drop: <span class="font-semibold">%${s.maxDrop}</span></div>
            <div>Min Margin: <span class="font-semibold">%${s.minMargin}</span></div>
          </div>
        </div>
      `).join('');
    }

    async function renderEngine() {
      renderStrategies();
      const root = document.getElementById('scheduler-list');
      if (!S.platforms.length) {
        root.innerHTML = `<div class="text-slate-400">Önce platform ekleyin.</div>`;
        return;
      }
      root.innerHTML = `<div class="text-slate-400 text-sm">Yükleniyor…</div>`;
      const items = await Promise.all(S.platforms.map(async p => ({ platform: p, state: await api(`/api/platforms/${p.id}/scheduler`) })));
      root.innerHTML = items.map(({ platform, state }) => `
        <div class="chip rounded-3xl p-4 space-y-4">
          <div class="flex items-start justify-between gap-4">
            <div>
              <div class="font-semibold">${escapeHtml(platform.name)}</div>
              <div class="text-sm text-slate-400">${platform.type}</div>
            </div>
            <span class="text-xs px-2 py-1 rounded-full ${state.enabled ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-500/15 text-slate-300'}">${state.enabled ? 'Aktif' : 'Pasif'}</span>
          </div>
          <div class="grid grid-cols-2 gap-3 text-sm">
            <div class="chip rounded-2xl p-3">Interval<br><span class="font-semibold">${state.intervalHours || '-'} saat</span></div>
            <div class="chip rounded-2xl p-3">Çalışıyor mu?<br><span class="font-semibold">${state.running ? 'Evet' : 'Hayır'}</span></div>
            <div class="chip rounded-2xl p-3">Son run<br><span class="font-semibold">${state.lastRunAt ? new Date(state.lastRunAt).toLocaleString('tr-TR') : '-'}</span></div>
            <div class="chip rounded-2xl p-3">Son başarı<br><span class="font-semibold">${state.lastSuccessAt ? new Date(state.lastSuccessAt).toLocaleString('tr-TR') : '-'}</span></div>
          </div>
          <div class="flex flex-wrap gap-2">
            <button onclick="startSchedPrompt('${platform.id}')" class="px-4 py-2 rounded-2xl bg-white text-black font-semibold">Başlat</button>
            <button onclick="stopSched('${platform.id}')" class="px-4 py-2 rounded-2xl chip">Durdur</button>
            <button onclick="runNow('${platform.id}')" class="px-4 py-2 rounded-2xl chip">Run Now</button>
          </div>
        </div>
      `).join('');
    }

    async function savePlatform() {
      const type = document.getElementById('plat-type').value;
      const name = document.getElementById('plat-name').value.trim();
      if (!name) return toast('Platform adı gerekli', 'error');
      let config = {};
      if (type === 'ikas') {
        config = {
          storeName: document.getElementById('ikas-storeName').value.trim(),
          clientId: document.getElementById('ikas-clientId').value.trim(),
          clientSecret: document.getElementById('ikas-clientSecret').value.trim(),
          priceListId: document.getElementById('ikas-priceListId').value.trim()
        };
      } else if (type === 'shopify') {
        config = {
          storeDomain: document.getElementById('shop-storeDomain').value.trim(),
          accessToken: document.getElementById('shop-accessToken').value.trim()
        };
      } else {
        config = { stub: true };
      }
      if (type === 'ikas' && (!config.storeName || !config.clientId || !config.clientSecret)) return toast('ikas bilgileri eksik', 'error');
      if (type === 'shopify' && (!config.storeDomain || !config.accessToken)) return toast('Shopify bilgileri eksik', 'error');
      const btn = document.getElementById('save-platform-btn');
      try {
        setBusy(btn, true);
        await api('/api/platforms', { method: 'POST', body: JSON.stringify({ name, type, config }) });
        resetPlatformForm();
        await loadPlatforms();
        await loadLogs();
        toast('Platform kaydedildi', 'success');
      } catch (error) {
        toast(error.message, 'error');
      } finally {
        setBusy(btn, false, null, 'Kaydet');
      }
    }

    async function testPlatform(id) {
      try {
        const r = await api(`/api/platforms/${id}/test`, { method: 'POST' });
        toast(`Bağlantı OK — ${r.productCount} ürün`, 'success');
        await loadLogs();
      } catch (error) {
        toast(error.message, 'error');
      }
    }

    async function deletePlatform(id) {
      if (!confirm('Bu platform silinsin mi?')) return;
      try {
        await api(`/api/platforms/${id}`, { method: 'DELETE' });
        await loadPlatforms();
        await loadLogs();
        toast('Platform silindi', 'success');
      } catch (error) {
        toast(error.message, 'error');
      }
    }

    function openProductsFor(id) {
      nav('products');
      document.getElementById('products-platform-select').value = id;
      loadPlatformProducts();
    }

    async function loadPlatformProducts() {
      const platformId = document.getElementById('products-platform-select').value;
      if (!platformId) return toast('Platform seçin', 'error');
      const btn = document.getElementById('load-products-btn');
      try {
        setBusy(btn, true);
        const data = await api(`/api/platforms/${platformId}/products`, { method: 'POST' });
        S.platformProducts = data.products || [];
        S.platformResults = {};
        renderProductTable();
        document.getElementById('products-summary').textContent = `${data.total} ürün yüklendi`;
      } catch (error) {
        toast(error.message, 'error');
      } finally {
        setBusy(btn, false, null, 'Ürünleri Çek');
      }
    }

    async function calcPrices() {
      const platformId = document.getElementById('products-platform-select').value;
      if (!platformId) return toast('Platform seçin', 'error');
      if (!S.platformProducts.length) await loadPlatformProducts();
      const btn = document.getElementById('calc-prices-btn');
      try {
        setBusy(btn, true, 'Hesaplanıyor…');
        const data = await api(`/api/platforms/${platformId}/calculate-prices`, {
          method: 'POST',
          body: JSON.stringify({ products: S.platformProducts })
        });
        S.platformResults = Object.fromEntries((data.results || []).map(r => [r.variantId || r.productId, r]));
        renderProductTable();
        document.getElementById('products-summary').textContent = `${data.total} ürün için hesaplandı`;
        await loadLogs();
      } catch (error) {
        toast(error.message, 'error');
      } finally {
        setBusy(btn, false, null, 'Fiyat Hesapla');
      }
    }

    async function pushPrices() {
      const platformId = document.getElementById('products-platform-select').value;
      if (!platformId) return toast('Platform seçin', 'error');
      const updates = Object.values(S.platformResults)
        .filter(r => ['raise', 'drop'].includes(r.action))
        .map(r => ({ id: r.productId, variantId: r.variantId, newPrice: r.suggested }));
      if (!updates.length) return toast('Gönderilecek fiyat yok', 'warn');
      const btn = document.getElementById('push-prices-btn');
      try {
        setBusy(btn, true, 'Gönderiliyor…');
        const data = await api(`/api/platforms/${platformId}/update-prices`, {
          method: 'POST',
          body: JSON.stringify({ updates })
        });
        toast(`${data.updated} fiyat gönderildi`, 'success');
        await loadLogs();
      } catch (error) {
        toast(error.message, 'error');
      } finally {
        setBusy(btn, false, null, 'Güncellemeleri Gönder');
      }
    }

    function renderProductTable() {
      const root = document.getElementById('products-table');
      if (!S.platformProducts.length) {
        root.innerHTML = `<tr><td colspan="8" class="px-4 py-10 text-center text-slate-400">Henüz ürün yüklenmedi.</td></tr>`;
        return;
      }
      root.innerHTML = S.platformProducts.map(p => {
        const r = S.platformResults[p.variantId || p.id] || {};
        const actionClass = `status-${r.action || 'skip'}`;
        return `
          <tr class="border-t border-white/5 hover:bg-white/5 cursor-pointer" onclick="openProductDetail('${p.id}','${document.getElementById('products-platform-select').value}')">
            <td class="px-4 py-3">
              <div class="font-semibold">${escapeHtml(p.name)}</div>
              <div class="text-xs text-slate-500">${escapeHtml(p.productName || '')}</div>
            </td>
            <td class="px-4 py-3 text-slate-300">${escapeHtml(p.sku || '-')}</td>
            <td class="px-4 py-3">${fmtTRY(p.currentPrice)}</td>
            <td class="px-4 py-3">${r.averageTRY ? fmtTRY(r.averageTRY) : '-'}</td>
            <td class="px-4 py-3 font-semibold">${r.suggested ? fmtTRY(r.suggested) : '-'}</td>
            <td class="px-4 py-3 ${actionClass}">${(r.action || '-').toUpperCase()}</td>
            <td class="px-4 py-3">${fmtN(p.stockCount || 0)}</td>
            <td class="px-4 py-3 text-slate-300">${r.confidence || '-'}</td>
          </tr>
        `;
      }).join('');
    }

    async function openProductDetail(productId, platformId) {
      S.selectedProductId = productId;
      S.selectedProductPlatformId = platformId;
      nav('productdetail');
      const root = document.getElementById('product-detail-root');
      root.innerHTML = `<div class="glass rounded-3xl p-6 xl:col-span-2 text-slate-400">Detay yükleniyor…</div>`;
      try {
        const data = await api(`/api/platforms/${platformId}/products/${productId}/detail`);
        renderProductDetail(data);
      } catch (error) {
        root.innerHTML = `<div class="glass rounded-3xl p-6 xl:col-span-2 text-red-300">${escapeHtml(error.message)}</div>`;
      }
    }

    function backToProducts() {
      nav('products');
    }

    function renderProductDetail(data) {
      const { product, pricing, sources, history, confidence, category } = data;
      const root = document.getElementById('product-detail-root');
      root.innerHTML = `
        <div class="space-y-6">
          <div class="glass rounded-3xl p-6">
            <div class="aspect-square rounded-3xl bg-slate-950/70 border border-white/5 overflow-hidden flex items-center justify-center mb-4">
              ${product.image ? `<img src="${escapeHtml(imgProxy(product.image))}" class="w-full h-full object-cover" />` : `<div class="text-slate-500">Görsel yok</div>`}
            </div>
            <h2 class="text-2xl font-black">${escapeHtml(product.name)}</h2>
            <div class="text-slate-400 mt-2">${escapeHtml(product.productName || '')}</div>
            <div class="grid grid-cols-2 gap-3 mt-5 text-sm">
              <div class="chip rounded-2xl p-4">Kategori<br><span class="font-semibold capitalize">${category}</span></div>
              <div class="chip rounded-2xl p-4">Confidence<br><span class="font-semibold">${confidence}</span></div>
              <div class="chip rounded-2xl p-4">Mevcut<br><span class="font-semibold">${fmtTRY(product.currentPrice)}</span></div>
              <div class="chip rounded-2xl p-4">Önerilen<br><span class="font-semibold">${fmtTRY(pricing.suggested)}</span></div>
              <div class="chip rounded-2xl p-4">Fark<br><span class="font-semibold ${'status-' + pricing.action}">${fmtTRY(pricing.diff)}</span></div>
              <div class="chip rounded-2xl p-4">Aksiyon<br><span class="font-semibold uppercase ${'status-' + pricing.action}">${pricing.action}</span></div>
            </div>
          </div>
        </div>
        <div class="space-y-6">
          <div class="glass rounded-3xl p-6">
            <div class="flex items-center justify-between mb-4">
              <h3 class="font-bold text-lg">Fiyat Geçmişi</h3>
              <div class="text-sm text-slate-400">Snapshot: ${history.length}</div>
            </div>
            <canvas id="detail-chart" height="120"></canvas>
          </div>
          <div class="glass rounded-3xl p-6">
            <h3 class="font-bold text-lg mb-4">Kaynaklar</h3>
            <div class="space-y-3">
              ${(sources || []).length ? sources.map(s => `
                <div class="chip rounded-2xl p-4 flex items-center justify-between gap-4">
                  <div>
                    <div class="font-semibold">${escapeHtml(s.source)}</div>
                    <div class="text-xs text-slate-500">USD: ${s.priceUSD || '-'} • EUR: ${s.priceEUR || '-'}</div>
                  </div>
                  <div class="font-semibold">${fmtTRY(s.priceTRY)}</div>
                </div>
              `).join('') : `<div class="text-slate-400">Kaynak verisi yok.</div>`}
            </div>
          </div>
        </div>
      `;

      const labels = history.map(h => new Date(h.at).toLocaleString('tr-TR'));
      const current = history.map(h => h.currentPrice);
      const suggested = history.map(h => h.suggested);
      const avg = history.map(h => h.averageTRY);
      if (S.detailChart) S.detailChart.destroy();
      const ctx = document.getElementById('detail-chart');
      S.detailChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets: [
            { label: 'Mevcut', data: current, tension: .35 },
            { label: 'Global Ortalama', data: avg, tension: .35 },
            { label: 'Önerilen', data: suggested, tension: .35 }
          ]
        },
        options: {
          responsive: true,
          plugins: { legend: { labels: { color: '#cbd5e1' } } },
          scales: {
            x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,.06)' } },
            y: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,.06)' } }
          }
        }
      });
    }

    async function doSearch() {
      const q = document.getElementById('catalog-search').value.trim();
      if (!q) return toast('Arama terimi girin', 'error');
      const btn = document.getElementById('catalog-search-btn');
      const root = document.getElementById('catalog-grid');
      try {
        setBusy(btn, true, 'Aranıyor…');
        root.innerHTML = '<div class="text-slate-400 col-span-full">Sonuçlar yükleniyor…</div>';
        const endpoint = {
          pokemon: '/api/catalog/pokemon/search',
          yugioh: '/api/catalog/yugioh/search',
          magic: '/api/catalog/magic/search',
          onepiece: '/api/catalog/onepiece/search'
        }[S.currentTCG];
        const cards = await api(`${endpoint}?q=${encodeURIComponent(q)}&limit=16`);
        renderCatalog(cards);
      } catch (error) {
        root.innerHTML = `<div class="text-red-300 col-span-full">${escapeHtml(error.message)}</div>`;
      } finally {
        setBusy(btn, false, null, 'Ara');
      }
    }

    function renderCatalog(cards) {
      const root = document.getElementById('catalog-grid');
      if (!cards.length) {
        root.innerHTML = `<div class="text-slate-400 col-span-full">Sonuç bulunamadı.</div>`;
        return;
      }
      root.innerHTML = cards.map(card => `
        <div class="glass rounded-3xl p-4 flex flex-col gap-4">
          <div class="aspect-[3/4] rounded-2xl overflow-hidden bg-slate-950/70 border border-white/5 flex items-center justify-center">
            ${card.image ? `<img loading="lazy" src="${escapeHtml(imgProxy(card.image))}" class="w-full h-full object-cover" />` : `<div class="text-slate-500">Görsel yok</div>`}
          </div>
          <div>
            <div class="font-bold line-clamp-2">${escapeHtml(card.name || card.title || '')}</div>
            <div class="text-sm text-slate-400 mt-1">${escapeHtml(card.set || '')} ${card.rarity ? '• ' + escapeHtml(card.rarity) : ''}</div>
          </div>
          <div class="grid grid-cols-2 gap-2 text-sm">
            <div class="chip rounded-2xl p-3">USD<br><span class="font-semibold">${card.priceUSD ? '$' + fmtN(card.priceUSD) : '-'}</span></div>
            <div class="chip rounded-2xl p-3">EUR<br><span class="font-semibold">${card.priceEUR ? '€' + fmtN(card.priceEUR) : '-'}</span></div>
          </div>
          <div class="flex gap-2 mt-auto">
            <button onclick="quickImportCardByPayload('${encodePayload({ ...card, game: S.currentTCG })}')" class="flex-1 px-4 py-3 rounded-2xl bg-white text-black font-semibold">Platforma Aktar</button>
          </div>
        </div>
      `).join('');
    }

    function quickImportCardByPayload(payload) {
      const card = decodePayload(payload);
      quickImportCard(card);
    }

    async function quickImportCard(card) {
      const platformId = document.getElementById('catalog-platform-select').value;
      if (!platformId) return toast('Önce aktarım platformu seçin', 'error');
      try {
        const tryPrice = card.priceUSD ? card.priceUSD * (S.rates.USD || 0) : card.priceEUR ? card.priceEUR * (S.rates.EUR || 0) : 0;
        await api(`/api/platforms/${platformId}/import-card`, {
          method: 'POST',
          body: JSON.stringify({ card: { ...card, priceTRY: tryPrice } })
        });
        toast('Kart aktarıldı', 'success');
        await loadLogs();
      } catch (error) {
        toast(error.message, 'error');
      }
    }

    async function startSchedPrompt(id) {
      const intervalHours = Number(prompt('Kaç saatte bir çalışsın?', '6') || '6');
      if (!intervalHours) return;
      try {
        await api(`/api/platforms/${id}/scheduler/start`, { method: 'POST', body: JSON.stringify({ intervalHours }) });
        toast('Scheduler başlatıldı', 'success');
        await renderEngine();
        await loadLogs();
      } catch (error) {
        toast(error.message, 'error');
      }
    }

    async function stopSched(id) {
      try {
        await api(`/api/platforms/${id}/scheduler/stop`, { method: 'POST' });
        toast('Scheduler durduruldu', 'success');
        await renderEngine();
        await loadLogs();
      } catch (error) {
        toast(error.message, 'error');
      }
    }

    async function runNow(id) {
      try {
        const r = await api(`/api/platforms/${id}/scheduler/run-now`, { method: 'POST' });
        if (r.skipped) toast('Job zaten çalışıyor', 'warn');
        else toast(`${r.updated} ürün güncellendi`, 'success');
        await renderEngine();
        await loadLogs();
      } catch (error) {
        toast(error.message, 'error');
      }
    }

    function renderLogs() {
      const root = document.getElementById('logs-list');
      if (!S.logs.length) {
        root.innerHTML = `<div class="glass rounded-3xl p-6 text-slate-400">Log yok.</div>`;
        return;
      }
      root.innerHTML = S.logs.map(renderLogCard).join('');
    }

    function renderLogCard(log) {
      const levelClass = {
        success: 'text-emerald-300 bg-emerald-500/10 border-emerald-400/20',
        error: 'text-red-300 bg-red-500/10 border-red-400/20',
        warn: 'text-amber-300 bg-amber-500/10 border-amber-400/20',
        info: 'text-sky-300 bg-sky-500/10 border-sky-400/20'
      }[log.level] || 'text-slate-300 bg-slate-500/10 border-slate-400/20';
      return `
        <div class="glass rounded-3xl p-5">
          <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <div class="flex items-center gap-2 flex-wrap">
                <span class="px-2 py-1 rounded-full text-xs border ${levelClass}">${log.level}</span>
                <span class="px-2 py-1 rounded-full text-xs chip">${escapeHtml(log.type)}</span>
                ${log.platform_id ? `<span class="px-2 py-1 rounded-full text-xs chip">${escapeHtml(log.platform_id)}</span>` : ''}
              </div>
              <div class="font-medium mt-3">${escapeHtml(log.message)}</div>
            </div>
            <div class="text-sm text-slate-500 whitespace-nowrap">${new Date(log.created_at).toLocaleString('tr-TR')}</div>
          </div>
        </div>
      `;
    }

    function toast(message, type = 'info') {
      const el = document.createElement('div');
      el.className = `fixed right-4 bottom-4 z-50 px-4 py-3 rounded-2xl shadow-2xl border max-w-md ${
        type === 'success' ? 'bg-emerald-500/15 text-emerald-200 border-emerald-300/20' :
        type === 'error' ? 'bg-red-500/15 text-red-200 border-red-300/20' :
        type === 'warn' ? 'bg-amber-500/15 text-amber-200 border-amber-300/20' :
        'bg-sky-500/15 text-sky-200 border-sky-300/20'
      }`;
      el.textContent = message;
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 2800);
    }

    document.querySelectorAll('.nav-item').forEach(el => el.addEventListener('click', () => nav(el.dataset.page)));
    document.getElementById('plat-type').addEventListener('change', onTypeChange);
    document.getElementById('save-platform-btn').addEventListener('click', savePlatform);
    document.getElementById('load-products-btn').addEventListener('click', loadPlatformProducts);
    document.getElementById('calc-prices-btn').addEventListener('click', calcPrices);
    document.getElementById('push-prices-btn').addEventListener('click', pushPrices);
    document.getElementById('catalog-search-btn').addEventListener('click', doSearch);
    document.getElementById('catalog-search').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
    document.getElementById('reload-logs-btn').addEventListener('click', loadLogs);
    document.getElementById('refresh-all-btn').addEventListener('click', async () => {
      await loadRates(true);
      await loadPlatforms();
      await loadLogs();
      await loadStrategies();
      toast('Panel yenilendi', 'success');
    });
    document.querySelectorAll('.tab').forEach(el => el.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
      el.classList.add('active');
      S.currentTCG = el.dataset.tcg;
    }));

    onTypeChange();
    (async function init() {
      try {
        await loadRates();
        await loadPlatforms();
        await loadLogs();
        await loadStrategies();
      } catch (error) {
        toast(error.message, 'error');
      }
    })();
  