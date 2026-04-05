const fs = require('fs');
let code = fs.readFileSync('server.js', 'utf8');

// evaluate the extraction and group logic
eval(code.substring(code.indexOf('const ACCESSORY_KEYWORDS'), code.indexOf('function calculateBeatPrice')));

const mockResults = [
  { name: 'Apple iPhone 15 Pro Max 256GB Siyah', priceTRY: 80000, source: 'Trendyol', image: 'img1.png' },
  { name: 'iPhone 15 Pro Max Kılıf Şeffaf', priceTRY: 200, source: 'Trendyol', image: 'img2.png' },
  { name: 'Apple iPhone 15 Pro Max 512GB Mavi', priceTRY: 90000, source: 'Trendyol', image: 'img3.png' }
];

console.dir(groupSearchResults(mockResults, 'iphone 15 pro max'), {depth: null});
