# Tracker UI Overhaul

Bu plan, gönderdiğiniz yeni tasarım şablonlarının "Market Search" ve "Product Detail" olarak SPA (Single Page Application) yapısına entegrasyonunu sağlamayı amaçlamaktadır.

## User Review Required

> [!WARNING]
> Gönderdiğiniz tasarımlar çok güzel ve modern ancak yapısal olarak mevcut "Tüm Takip Edilen Ürünler (Dashboard Tablosu)" listesinin tasarımını içermiyor. 
> 
> İki seçenek mevcut:
> 1. Dashboard sayfasını tamamen **iptal edip**, sistemin ana girişini doğrudan "Market Search" arama ekranı yapmak. (Arama yapıp ürün bulunur, takibe alınan ürünler de belki bu arama ekranının altında "Takipte Olan Ürünler" şeklinde ayrı bir bento card grid olarak gösterilir.)
> 2. Mevcut "Tracker Dashboard" tablo listesini korumak, ancak yeni tasarım çizgilerine (fontlar, hover efektleri, renkler, paddingler vb.) uygun olarak **revize etmek**. Arama ve Ekleme butonları yeni "Market Search" tam ekran sayfasına (modal yerine) yönlendirir.
> 
> *Tavsiyem*: Seçenek 2'yi uygulamamızdır. Dashboard ekranını (Takip Edilen Ürünler Tablosu) görsel olarak yeni UI stiline yükseltip, arama işlemini modal yerine yepyeni tam ekran `page-market-search` sayfasına, detayları da `page-market-detail` sayfasına taşıyalım.

## Proposed Changes

### Frontend Global Yapı (index.html)
- **Tailwind Config & CSS:** Gönderdiğiniz şablonda bulunan yeni Tailwind renk havuzu (inverse-on-surface, secondary-container vb.) ve yeni fontlar (Material Symbols güncellemeleri, Manrope & Inter entegrasyonu) `<head>` içine aktarılacak.
- **Header & Sidebar:** Top AppBar ve SideNavBar'daki renk kodlamaları, profil fotoğrafı ve ikon hover yapıları tasarımdaki zengin gradient/glow yapılarıyla değiştirilecek. Eski Sidebar ve Header kodları güncellenecek.
- **Ticker Tape:** Sitenin en üstüne kayan yazı (Ticker Tape: BTC/USD, DYSON LIVE vb.) script/CSS ile sisteme yerleştirilecek, backend'den gelen canlı verilerle beslenecek yapıya getirilecek (şu anlık rastgele veriler veya bilinen tracked products verileri dönecek).

### Yeni Görünümler (Views)
- **`[DELETE]` Modallar:** `mTrackerSearch` ve `mTrackerDetail` modalları tamamen HTML'den silinecek.
- **`[NEW]` `page-market-search` (Market Search View):**
  - Tam sayfa olarak arama motoru hissi yaratacak. 
  - `doSerpSearch()` fonksiyonu, arama sonuçlarını bu yeni Bento Grid "Market Results" kartlarında listeleyecek.
  - Kartlarda `"Cimri Lowest"`, `"Akakçe Lowest"` ve `"View Market Details"` butonları yer alacak. "View Market Details" tıklandığında eski modal yerine spesifik arama yapıp doğrudan ürünün içine girecek (`page-market-detail`).
- **`[NEW]` `page-market-detail` (Product Detail View):**
  - Spesifik bir ürün için tıklandığında açılacak. "Chronos Elite V2 Smartwatch" yazan detay sayfası tasarımı birebir uyarlanacak.
  - `openTrackerDetail()` modifikasyona uğrayıp, `mTrackerDetail`'e innerHTML yazmak yerine `page-market-detail` ekranını görünür yapacak (`showPage('page-market-detail')`).
  - Grafikler (`trackerChart`), "Market Comparison" tablosu ve altındaki "Automation & Sync (Shopify / İkas)" kartları, seçilen ürünün verilerine (Supabase veya JSON file'dan alınan backend verilerine) göre dinamik olarak populate edilecek.

## Open Questions

1. Ticker Tape (Yukarıda kayan yazı şeridi) verilerini gerçek piyasa verilerinden ziyade, Tracker'daki "En son fiyatı düşen 5 ürün" veya "Takip edilen ürünlerin anlık özetleri" şeklinde doldurmak mantıklı olur mu? Yoksa statik mi bırakalım?
2. Arama ekranı "samsung" gibi geniş aramalarda çıkan varyasyonları (eski mantıktaki gibi) "Bento Grid Result Card"lar olarak alt alta mı dizsin (her kart bir telefonu/modeli temsil edecek - örneğin "Samsung S24 Ultra", yanındaki kart "Samsung S23 FE")? İstediğiniz bu sanırım.

## Verification Plan
1. Backend ve UI entegrasyonlarının birbirine oturup oturmadığını gözlemlemek için tarayıcıda `tracker` modülünü çalıştıracağız.
2. `doSerpSearch("Dyson")` ile Bento grid kartlarının 50 farklı arama sonucunu gruplayarak yeni arayüzde doğru render edildiğinden emin olunacak.
3. Modeli tıkla (`openTrackerDetail`) -> İkas/Shopify Sync kartlarının ve fiyat tablosunun detay sayfasında çalıştığını manuel kontrol edeceğiz.
