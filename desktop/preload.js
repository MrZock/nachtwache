// Teilt dem Spiel mit, dass es als Windows-App läuft (zeigt z. B. den „Beenden“-Knopf)
const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('BLACKOUT_DESKTOP', true);
