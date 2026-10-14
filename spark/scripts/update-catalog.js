// Baut catalog/games.json aus catalog/games.src.json: Größe und SHA-256 jeder Spieldatei.
// Nach jeder Änderung an einem Spiel ausführen (npm run catalog) und mit committen –
// SPARK erkennt Updates an den Prüfsummen und lädt nur geänderte Dateien neu.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const dir = path.join(__dirname, '..', 'catalog');
const src = JSON.parse(fs.readFileSync(path.join(dir, 'games.src.json'), 'utf8'));
const TEXT = /\.(js|html|css|json|txt|svg)$/i;
const out = { updated: new Date().toISOString(), games: [] };
for (const g of src.games) {
  const root = path.resolve(dir, g.local || '.');
  const files = g.files.map(f => {
    let buf = fs.readFileSync(path.join(root, f));
    // GitHub liefert Textdateien mit LF aus – lokal kann Git CRLF daraus machen
    if (TEXT.test(f)) buf = Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
    return { path: f, size: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex') };
  });
  const { local, ...rest } = g;
  out.games.push(Object.assign(rest, { files, size: files.reduce((s, f) => s + f.size, 0) }));
  console.log(g.name + ' ' + g.version + ': ' + files.length + ' Dateien, ' + Math.round(files.reduce((s, f) => s + f.size, 0) / 1024) + ' KB');
}
fs.writeFileSync(path.join(dir, 'games.json'), JSON.stringify(out, null, 2) + '\n');
console.log('catalog/games.json geschrieben');
