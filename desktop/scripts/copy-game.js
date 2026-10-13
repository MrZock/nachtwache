// Kopiert die Spieldateien (dieselben wie in der Web-Version) in desktop/app
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', '..'), out = path.join(__dirname, '..', 'app');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const f of ['index.html', 'game.js', 'render3d.js', 'three.min.js', 'style.css']) fs.copyFileSync(path.join(root, f), path.join(out, f));
console.log('Spieldateien kopiert nach', out);
