// electron/preload.js
// Preload script - runs in renderer process but has access to Node.js
// Used to safely expose specific functionality to the web app

const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Platform info
  getPlatform: () => ipcRenderer.invoke('get-platform'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  
  // Notifications
  showNotification: (title, body) => 
    ipcRenderer.invoke('show-notification', { title, body }),
  
  // Window controls
  minimizeToTray: () => ipcRenderer.send('minimize-to-tray'),
  
  // Deep link handling
  onDeepLink: (callback) => {
    ipcRenderer.on('deep-link', (event, url) => callback(url));
  },
  
  // Check if running in Electron
  isElectron: true,
});

// Log that preload script has loaded
console.log('Electron preload script loaded');
