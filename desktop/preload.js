// Teilt dem Spiel mit, dass es als Windows-App läuft (zeigt z. B. den „Beenden“-Knopf)
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('BLACKOUT_DESKTOP', true);
// Spielstände als Dateien in „Dokumente/BLACKOUT“ (synchron, damit auch beim Schließen gespeichert wird)
contextBridge.exposeInMainWorld('BLACKOUT_SAVE', {
  dir: ipcRenderer.sendSync('save', 'dir'),
  read: k => ipcRenderer.sendSync('save', 'read', k | 0),
  write: (k, s) => ipcRenderer.sendSync('save', 'write', k | 0, String(s)),
  del: k => ipcRenderer.sendSync('save', 'del', k | 0),
});
