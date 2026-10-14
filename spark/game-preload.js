// Für Spiele, die SPARK startet: gleiche Schnittstelle wie die eigene Windows-App von BLACKOUT
// (Vollbild-App, Spielstände als Dateien in „Dokumente/<Spiel>“).
const { contextBridge, ipcRenderer } = require('electron');
const arg = process.argv.find(a => a.startsWith('--spark-save=')), name = arg ? arg.slice(13) : 'SPARK';
contextBridge.exposeInMainWorld('BLACKOUT_DESKTOP', true);
contextBridge.exposeInMainWorld('SPARK', { launcher: true });
contextBridge.exposeInMainWorld('BLACKOUT_SAVE', {
  dir: ipcRenderer.sendSync('game-save', name, 'dir'),
  read: k => ipcRenderer.sendSync('game-save', name, 'read', k | 0),
  write: (k, s) => ipcRenderer.sendSync('game-save', name, 'write', k | 0, String(s)),
  del: k => ipcRenderer.sendSync('game-save', name, 'del', k | 0),
});
