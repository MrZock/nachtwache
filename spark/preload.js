// Schnittstelle zwischen SPARK-Oberfläche und Launcher (nur diese Funktionen, kein Node im Fenster)
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('spark', {
  state: () => ipcRenderer.invoke('state'),
  refresh: () => ipcRenderer.invoke('refresh'),
  install: id => ipcRenderer.invoke('install', id),
  uninstall: id => ipcRenderer.invoke('uninstall', id),
  play: id => ipcRenderer.invoke('play', id),
  folder: id => ipcRenderer.invoke('folder', id),
  saves: id => ipcRenderer.invoke('saves', id),
  onProgress: fn => ipcRenderer.on('progress', (e, d) => fn(d)),
  onChanged: fn => ipcRenderer.on('changed', () => fn()),
  set: (k, v) => ipcRenderer.invoke('set', k, v),
  checkUpdate: () => ipcRenderer.invoke('update-check'),
  runUpdate: () => ipcRenderer.invoke('update-run'),
  openWeb: which => ipcRenderer.invoke('open-web', which),
  onUpdate: fn => { ipcRenderer.on('update', (e, d) => fn(d)); ipcRenderer.on('uprogress', (e, d) => fn(d)); },
});
