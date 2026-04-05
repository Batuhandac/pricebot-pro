const fs = require('fs');
const js = fs.readFileSync('public/pricebot-tracker-ui.js', 'utf8');
console.log(js.includes('fTRY'));
