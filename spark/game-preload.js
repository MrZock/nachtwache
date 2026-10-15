// Für Spiele, die SPARK startet: gleiche Schnittstelle wie die eigene Windows-App von BLACKOUT
// (Vollbild-App, Spielstände als Dateien in „Dokumente/<Spiel>“).
const { contextBridge, ipcRenderer } = require('electron');
const arg = process.argv.find(a => a.startsWith('--spark-save=')), name = arg ? arg.slice(13) : 'SPARK';
contextBridge.exposeInMainWorld('BLACKOUT_DESKTOP', true);
// SPARK-Schnittstelle: Spiele starten (Einladungen), Online-Räume melden/lesen, sichere Ablage (von Windows verschlüsselt)
contextBridge.exposeInMainWorld('SPARK', {
  launcher: true,
  launch: (id, q) => ipcRenderer.invoke('spark-launch', String(id), q && typeof q === 'object' ? { join: String(q.join || '') } : {}),
  running: () => ipcRenderer.invoke('spark-running'),
  rooms: () => ipcRenderer.invoke('spark-rooms'),
  show: () => ipcRenderer.send('spark-show'),
  badge: n => ipcRenderer.send('spark-badge', n | 0),
  presence: p => ipcRenderer.send('spark-presence', p && typeof p === 'object' ? { room: String(p.room || ''), role: String(p.role || '') } : null),
  vault: {
    get: k => ipcRenderer.invoke('spark-vault', 'get', String(k)),
    set: (k, v) => ipcRenderer.invoke('spark-vault', 'set', String(k), String(v)),
    del: k => ipcRenderer.invoke('spark-vault', 'del', String(k)),
  },
});
contextBridge.exposeInMainWorld('BLACKOUT_SAVE', {
  dir: ipcRenderer.sendSync('game-save', name, 'dir'),
  read: k => ipcRenderer.sendSync('game-save', name, 'read', k | 0),
  write: (k, s) => ipcRenderer.sendSync('game-save', name, 'write', k | 0, String(s)),
  del: k => ipcRenderer.sendSync('game-save', name, 'del', k | 0),
});
