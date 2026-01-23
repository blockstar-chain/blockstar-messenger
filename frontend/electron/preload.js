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


  // ─── NEW: Wallet Bridge ───
  walletOpenBrowser: (url) => ipcRenderer.invoke('wallet-open-browser', url),
  walletStartServer: () => ipcRenderer.invoke('wallet-start-server'),
  walletStopServer: () => ipcRenderer.invoke('wallet-stop-server'),

  onWalletConnected: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('wallet-connected', handler);
    return () => ipcRenderer.removeListener('wallet-connected', handler);
  },

  onWalletCancelled: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('wallet-cancelled', handler);
    return () => ipcRenderer.removeListener('wallet-cancelled', handler);
  },

  onWalletSigned: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('wallet-signed', handler);
    return () => ipcRenderer.removeListener('wallet-signed', handler);
  },

  // Check if running in Electron
  isElectron: true,
});

// Log that preload script has loaded
console.log('Electron preload script loaded');
